# Part 22 — `FunctionalInterface`, Lambda Runtime Support, `invokedynamic`, and `java.lang.invoke` Boundary

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `22-functionalinterface-lambda-runtime-support-invokedynamic-boundary.md`  
> Scope: Java 8–25  
> Fokus: memahami lambda bukan hanya sebagai syntax pendek, tetapi sebagai kontrak bahasa, target typing, runtime linkage, method handle, dan boundary JVM.

---

## 1. Tujuan Part Ini

Di level pemula, lambda sering dipahami sebagai:

```java
x -> x + 1
```

atau sebagai “anonymous function”.

Itu tidak salah, tetapi tidak cukup untuk engineer yang perlu mendesain framework, library, runtime adapter, instrumentation, performance-sensitive pipelines, event systems, workflow engines, rule engines, atau extensibility points.

Di part ini kita membangun mental model bahwa lambda di Java adalah gabungan dari beberapa lapisan:

```text
Source code
  ↓
Lambda expression / method reference
  ↓
Target type: functional interface
  ↓
Compile-time SAM conversion
  ↓
Bytecode invokedynamic call site
  ↓
Bootstrap method, biasanya LambdaMetafactory
  ↓
MethodHandle ke implementation method
  ↓
Runtime function object
```

Target setelah part ini:

1. memahami apa itu functional interface secara formal;
2. memahami kenapa lambda butuh target type;
3. memahami lambda capture semantics;
4. memahami lambda identity dan kenapa tidak boleh mengandalkan class name/identity;
5. memahami method reference sebagai bentuk adaptasi method ke SAM;
6. memahami kenapa lambda Java 8 tidak dikompilasi seperti anonymous inner class biasa;
7. memahami peran `invokedynamic`;
8. memahami peran `java.lang.invoke.MethodHandle`, `MethodType`, `CallSite`, `MethodHandles.Lookup`, dan `LambdaMetafactory`;
9. memahami batas penggunaan `java.lang.invoke` untuk aplikasi biasa vs framework/runtime library;
10. mampu mendesain API yang menerima behavior tanpa membuat kontrak rapuh.

---

## 2. Peta Besar: Dari Interface ke Runtime Function Object

Lambda di Java tidak berdiri sendiri. Lambda selalu “dikonversi” ke sebuah target type.

Contoh:

```java
Runnable r = () -> System.out.println("run");
```

`()` -> `System.out.println("run")` tidak memiliki tipe final sampai compiler melihat target type-nya, yaitu `Runnable`.

`Runnable` memiliki satu abstract method:

```java
void run();
```

Maka lambda tersebut cocok.

Contoh lain:

```java
Supplier<String> s = () -> "hello";
Callable<String> c = () -> "hello";
```

Ekspresi lambda-nya sama, tetapi target type berbeda:

```text
() -> "hello"
  dapat menjadi Supplier<String>
  dapat menjadi Callable<String>
  dapat menjadi custom interface lain yang SAM-nya cocok
```

Inilah alasan lambda Java bukan “function value” bebas seperti di sebagian bahasa lain. Lambda Java adalah ekspresi yang membutuhkan target type.

---

## 3. Functional Interface: Kontrak, Bukan Sekadar Annotation

`@FunctionalInterface` berada di `java.lang`.

Secara konseptual, functional interface adalah interface yang memiliki tepat satu abstract method. Method itu sering disebut:

```text
SAM = Single Abstract Method
```

Contoh:

```java
@FunctionalInterface
interface Validator<T> {
    boolean isValid(T value);
}
```

Lambda bisa ditargetkan ke interface tersebut:

```java
Validator<String> notBlank = s -> s != null && !s.isBlank();
```

### 3.1 `@FunctionalInterface` bersifat informative tetapi berguna

Annotation ini bukan yang “membuat” interface menjadi functional interface. Interface tetap bisa menjadi functional interface walau tidak dianotasi.

Namun annotation ini memberi compiler kontrak eksplisit:

```java
@FunctionalInterface
interface Broken {
    void a();
    void b(); // compile error
}
```

Manfaatnya:

1. mendokumentasikan intensi API;
2. mencegah perubahan yang merusak SAM contract;
3. membantu reviewer membaca desain;
4. menjaga binary/source compatibility untuk API publik.

### 3.2 Default method tidak menghitung sebagai abstract method

```java
@FunctionalInterface
interface Rule<T> {
    boolean test(T input);

    default Rule<T> and(Rule<T> other) {
        return input -> this.test(input) && other.test(input);
    }
}
```

`and` tidak merusak SAM karena punya implementation.

### 3.3 Static method juga tidak menghitung

```java
@FunctionalInterface
interface Parser<T> {
    T parse(String input);

    static Parser<Integer> integer() {
        return Integer::parseInt;
    }
}
```

Static method adalah utility/factory, bukan abstract instance method.

### 3.4 Method dari `Object` tidak menghitung sebagai SAM tambahan

Misalnya:

```java
@FunctionalInterface
interface NamedAction {
    void execute();

    String toString();
}
```

`toString()` berasal dari `Object`, sehingga tidak membuat interface menjadi punya dua abstract method yang relevan untuk SAM.

Namun desain seperti ini biasanya membingungkan. Jangan menambahkan deklarasi `toString`, `equals`, atau `hashCode` ke functional interface kecuali ada alasan sangat kuat.

---

## 4. Target Typing: Lambda Butuh Konteks

Lambda expression bisa muncul di beberapa konteks:

```java
Predicate<String> p = s -> s.length() > 3;
```

assignment context.

```java
stream.filter(s -> s.length() > 3);
```

method invocation context.

```java
var p = (Predicate<String>) s -> s.length() > 3;
```

cast context.

Yang tidak boleh:

```java
var p = s -> s.length() > 3; // tidak valid
```

Kenapa?

Karena compiler tidak tahu target type-nya. Apakah ini:

```java
Predicate<String>
Function<String, Boolean>
CustomValidator<String>
```

Semua mungkin secara bentuk.

Mental model:

```text
Lambda expression bukan object literal yang sudah bertipe.
Lambda expression adalah ekspresi poly yang membutuhkan target type.
```

---

## 5. SAM Method Shape: Parameter, Return, Checked Exception

Functional interface tidak hanya ditentukan oleh nama method, tetapi oleh shape:

```text
parameter types
return type
throws contract
generic substitution
```

Contoh:

```java
@FunctionalInterface
interface ThrowingParser<T> {
    T parse(String input) throws Exception;
}
```

Lambda ini cocok:

```java
ThrowingParser<Integer> p = s -> Integer.parseInt(s);
```

Lambda ini juga cocok:

```java
ThrowingParser<Integer> p = s -> {
    if (s == null) throw new Exception("null");
    return Integer.parseInt(s);
};
```

Tetapi lambda yang dilempar ke `Function<String, Integer>` tidak bisa melempar checked exception secara langsung:

```java
Function<String, Integer> f = s -> {
    // throw new IOException(); // compile error
    return Integer.parseInt(s);
};
```

Ini sangat penting untuk API design.

Jika API callback perlu boleh gagal dengan checked exception, jangan pakai `java.util.function.Function` begitu saja. Desain functional interface sendiri:

```java
@FunctionalInterface
interface CheckedFunction<T, R, E extends Exception> {
    R apply(T value) throws E;
}
```

Namun hati-hati: generic exception type bisa membuat API sulit dipakai.

---

## 6. Lambda Capture Semantics

Lambda bisa menggunakan variable dari scope luar jika variable itu `final` atau effectively final.

```java
int threshold = 10;

Predicate<Integer> bigger = n -> n > threshold;
```

`threshold` tidak dideklarasikan final, tetapi effectively final karena tidak diubah setelah assignment.

Tidak boleh:

```java
int threshold = 10;

Predicate<Integer> bigger = n -> n > threshold;

threshold = 20; // membuat threshold tidak effectively final
```

### 6.1 Kenapa harus effectively final?

Karena local variable hidup di stack frame method. Lambda bisa hidup lebih lama dari method yang membuatnya.

Contoh:

```java
Predicate<Integer> build() {
    int threshold = 10;
    return n -> n > threshold;
}
```

Setelah `build()` selesai, stack frame hilang. Lambda tetap butuh nilai `threshold`. Java menyimpan salinan nilai capture ke object/function instance yang dibuat.

Kalau local variable boleh berubah, semantics-nya akan rumit:

```text
apakah lambda melihat nilai lama?
nilai baru?
reference ke slot stack?
bagaimana jika method sudah selesai?
bagaimana memory visibility-nya?
```

Java memilih aturan sederhana: local capture harus final/effectively final.

### 6.2 Capture reference tidak berarti object immutable

```java
List<String> names = new ArrayList<>();

Runnable r = () -> names.add("A");
```

`names` sebagai variable reference tidak berubah, tetapi object yang direferensikan bisa berubah.

Ini valid, tetapi bisa berbahaya.

```java
List<String> names = new ArrayList<>();

Runnable r1 = () -> names.add("A");
Runnable r2 = () -> names.add("B");
```

Jika dipakai lintas thread, ini race condition jika list tidak thread-safe.

Mental model:

```text
Effectively final melindungi variable binding,
bukan object state.
```

### 6.3 Capturing `this`

Dalam instance method:

```java
class Service {
    private int count;

    Runnable task() {
        return () -> System.out.println(this.count);
    }
}
```

Lambda capture `this`.

Ini berbeda dari anonymous inner class:

```java
Runnable task() {
    return new Runnable() {
        @Override
        public void run() {
            System.out.println(this); // this = anonymous class instance
        }
    };
}
```

Di lambda:

```java
Runnable task() {
    return () -> System.out.println(this); // this = enclosing Service instance
}
```

Ini penting untuk memory leak.

Jika lambda disimpan di static registry, event bus, atau scheduler, ia bisa mempertahankan reference ke enclosing object.

```java
class BigService {
    private final byte[] huge = new byte[100_000_000];

    Runnable leak() {
        return () -> System.out.println(huge.length);
    }
}
```

Lambda mempertahankan `this`, sehingga `huge` ikut tertahan.

---

## 7. Stateless vs Capturing Lambda

Ada dua jenis besar lambda secara operasional:

```text
stateless lambda:
  tidak capture apa pun

capturing lambda:
  capture variable/local/this
```

Contoh stateless:

```java
Function<String, Integer> length = String::length;
Predicate<String> notBlank = s -> !s.isBlank();
```

Contoh capturing:

```java
int min = 3;
Predicate<String> minLength = s -> s.length() >= min;
```

### 7.1 Identity stateless lambda tidak boleh diasumsikan

JVM bisa saja meng-cache instance stateless lambda, tetapi program tidak boleh bergantung pada itu.

Jangan desain seperti ini:

```java
Predicate<String> a = s -> !s.isBlank();
Predicate<String> b = s -> !s.isBlank();

System.out.println(a == b); // jangan bergantung
```

### 7.2 Capturing lambda biasanya membutuhkan instance berbeda

```java
Predicate<String> minLength(int min) {
    return s -> s.length() >= min;
}
```

Setiap nilai `min` perlu disimpan.

```java
Predicate<String> p3 = minLength(3);
Predicate<String> p5 = minLength(5);
```

Secara konseptual, masing-masing function object punya captured state berbeda.

### 7.3 Production implication

Stateless lambda cocok untuk constant:

```java
private static final Predicate<String> NOT_BLANK = s -> s != null && !s.isBlank();
```

Capturing lambda harus diperlakukan seperti object stateful ringan.

Hindari capture object besar, request context, entity manager, transaction context, atau security context tanpa sengaja.

---

## 8. Method Reference: Adaptasi Method ke Functional Interface

Method reference adalah shorthand untuk lambda tertentu.

Jenis umum:

```java
ClassName::staticMethod
objectRef::instanceMethod
ClassName::instanceMethod
ClassName::new
ArrayType::new
```

Contoh static method:

```java
Function<String, Integer> parse = Integer::parseInt;
```

Setara kira-kira dengan:

```java
Function<String, Integer> parse = s -> Integer.parseInt(s);
```

Contoh bound instance method:

```java
String prefix = "ID-";
Predicate<String> starts = prefix::equals;
```

Setara:

```java
Predicate<String> starts = s -> prefix.equals(s);
```

Contoh unbound instance method:

```java
Function<String, Integer> length = String::length;
```

Setara:

```java
Function<String, Integer> length = s -> s.length();
```

Contoh constructor reference:

```java
Supplier<List<String>> listFactory = ArrayList::new;
Function<Integer, List<String>> sizedListFactory = ArrayList::new;
```

Target type menentukan constructor mana yang dipakai.

---

## 9. Method Reference Ambiguity

Method reference bisa ambigu ketika overload ada.

```java
class Parser {
    static int parse(String s) { return Integer.parseInt(s); }
    static int parse(Object o) { return Integer.parseInt(o.toString()); }
}
```

Kadang compiler butuh target type eksplisit:

```java
Function<String, Integer> f = Parser::parse;
```

Jika API overload terlalu banyak menerima functional interface mirip, caller bisa kesulitan:

```java
void register(Predicate<String> p) {}
void register(Function<String, Boolean> f) {}
```

Pemanggilan:

```java
register(s -> s.length() > 0); // bisa ambigu
```

Desain API sebaiknya menghindari overload dengan functional interface yang bentuknya mirip.

---

## 10. Lambda vs Anonymous Inner Class

Lambda bukan sekadar anonymous inner class yang lebih pendek.

Perbedaan penting:

### 10.1 `this`

Lambda:

```java
class Demo {
    void test() {
        Runnable r = () -> System.out.println(this.getClass());
    }
}
```

`this` adalah `Demo`.

Anonymous class:

```java
class Demo {
    void test() {
        Runnable r = new Runnable() {
            @Override
            public void run() {
                System.out.println(this.getClass());
            }
        };
    }
}
```

`this` adalah anonymous class.

### 10.2 Identity dan class shape

Anonymous inner class menghasilkan class lebih eksplisit pada compile-time, misalnya:

```text
Demo$1.class
```

Lambda biasanya dikompilasi menggunakan `invokedynamic` dan runtime linkage.

Jangan mengandalkan:

```java
lambda.getClass().getName()
```

untuk business logic, serialization key, metrics dimension, atau audit action name.

### 10.3 Serialization

Anonymous class serialization sudah berbahaya jika tidak didesain dengan hati-hati. Lambda serialization lebih berbahaya lagi karena representasi serialized lambda bukan kontrak domain yang stabil untuk long-term persistence.

Jangan menyimpan lambda serialized ke database, message queue, cache distributed, atau workflow state.

---

## 11. Compile-Time View: Lambda Conversion

Lambda conversion terjadi ketika lambda expression ditargetkan ke functional interface.

Contoh:

```java
Predicate<String> p = s -> s.length() > 3;
```

Compiler memeriksa:

1. target type adalah interface;
2. interface punya satu functional method;
3. parameter lambda cocok dengan parameter SAM;
4. return lambda cocok dengan return SAM;
5. checked exception lambda kompatibel dengan `throws` SAM;
6. generic type inference bisa diselesaikan.

Jika semua cocok, compiler menghasilkan bytecode yang memakai `invokedynamic` call site.

---

## 12. Runtime View: Kenapa `invokedynamic`?

Sebelum Java 8, pendekatan paling obvious untuk lambda adalah compile menjadi anonymous inner class. Tetapi Java memilih mekanisme lain: `invokedynamic`.

`invokedynamic` diperkenalkan di Java 7 untuk memberi JVM mekanisme dynamic linkage yang fleksibel. Java 8 memakainya untuk lambda.

Keuntungan desain ini:

1. bytecode tidak terkunci pada strategi implementasi class tertentu;
2. JVM/JDK bisa mengubah cara membuat lambda object tanpa mengubah bytecode source;
3. stateless lambda bisa dioptimalkan;
4. capturing lambda bisa dibuat efisien;
5. runtime bisa menghasilkan class tersembunyi/implementation detail;
6. future optimization bisa dilakukan di JDK/JVM.

Mental model:

```text
javac tidak berkata:
  "buat class anonymous ini"

javac berkata:
  "di titik ini, hubungkan call site untuk menghasilkan function object yang cocok"
```

---

## 13. Apa itu Call Site?

Call site adalah lokasi instruksi pemanggilan di bytecode.

Untuk `invokedynamic`, target method tidak ditentukan secara statis seperti `invokevirtual` atau `invokestatic`. Sebaliknya, JVM memanggil bootstrap method untuk menentukan linkage.

Simplified model:

```text
invokedynamic instruction
  has name + method type + bootstrap method + bootstrap args
      ↓
bootstrap method returns CallSite
      ↓
CallSite contains MethodHandle target
      ↓
future executions use linked target
```

Untuk lambda Java, bootstrap method umumnya berada di:

```java
java.lang.invoke.LambdaMetafactory
```

---

## 14. `LambdaMetafactory`: Pabrik Runtime Function Object

`LambdaMetafactory` memfasilitasi pembuatan “function object” sederhana yang mengimplementasikan satu atau lebih interface dengan delegasi ke `MethodHandle`.

Contoh source:

```java
Function<String, Integer> f = s -> s.length();
```

Secara kasar, compiler menghasilkan sesuatu seperti:

```text
invokedynamic apply() : Function
  bootstrap = LambdaMetafactory.metafactory
  SAM method = Function.apply(Object)
  implementation method = synthetic static method lambda$...
  instantiated type = String -> Integer
```

Jangan bayangkan ini sebagai kode Java literal. Ini model konseptual.

### 14.1 Synthetic implementation method

Untuk lambda:

```java
Function<String, Integer> f = s -> s.length();
```

Compiler bisa membuat method synthetic kira-kira:

```java
private static Integer lambda$main$0(String s) {
    return s.length();
}
```

Lalu runtime membuat function object yang `apply`-nya mendelegasikan ke method tersebut.

### 14.2 Capturing lambda

```java
int min = 3;
Predicate<String> p = s -> s.length() >= min;
```

Implementation method kira-kira butuh parameter captured:

```java
private static boolean lambda$build$0(int min, String s) {
    return s.length() >= min;
}
```

Call site menerima `min` sebagai captured argument dan menghasilkan `Predicate`.

---

## 15. `java.lang.invoke`: Low-Level JVM Interaction Primitives

Package `java.lang.invoke` menyediakan primitive low-level untuk berinteraksi dengan JVM.

Class penting:

```text
MethodHandle
MethodType
MethodHandles
MethodHandles.Lookup
CallSite
ConstantCallSite
MutableCallSite
VolatileCallSite
LambdaMetafactory
StringConcatFactory
VarHandle
```

Kita tidak akan membahas seluruh package sedalam framework authoring full, tetapi perlu memahami boundary-nya.

---

## 16. `MethodType`: Signature sebagai Object

`MethodType` merepresentasikan signature method:

```text
(return type, parameter types)
```

Contoh:

```java
MethodType mt = MethodType.methodType(int.class, String.class);
```

Artinya:

```text
(String) -> int
```

Dalam lambda runtime, method type dipakai untuk menggambarkan:

1. SAM method erased type;
2. implementation method type;
3. instantiated generic method type;
4. invokedynamic call site type.

Mental model:

```text
Class<T> = runtime type token untuk tipe.
MethodType = runtime type token untuk shape method.
```

---

## 17. `MethodHandle`: Typed, Direct, Composable Handle ke Operation

`MethodHandle` adalah typed reference ke method, constructor, field access, atau operasi lain.

Ia berbeda dari reflection `Method`.

Reflection:

```java
Method m = String.class.getMethod("length");
Object result = m.invoke("abc");
```

Method handle:

```java
MethodHandles.Lookup lookup = MethodHandles.lookup();
MethodHandle mh = lookup.findVirtual(
    String.class,
    "length",
    MethodType.methodType(int.class)
);

int len = (int) mh.invokeExact("abc");
```

### 17.1 `invokeExact` vs `invoke`

`invokeExact` membutuhkan signature yang persis cocok.

```java
int len = (int) mh.invokeExact("abc");
```

Jika type tidak exact, error.

`invoke` lebih fleksibel dan bisa melakukan adaptasi tertentu.

```java
Object len = mh.invoke("abc");
```

Namun fleksibilitas ini punya cost dan risiko runtime failure.

### 17.2 MethodHandle lebih dekat ke JVM daripada reflection

MethodHandle bisa dioptimalkan JVM lebih baik dalam banyak skenario karena linkage lebih explicit dan typed.

Namun jangan otomatis mengganti semua reflection dengan method handles. Untuk aplikasi biasa, reflection sering cukup. MethodHandle cocok untuk:

1. framework invocation hot path;
2. serializer/deserializer;
3. mapper;
4. dynamic language runtime;
5. expression engine;
6. rule engine;
7. plugin adapter;
8. runtime code generation;
9. high-performance property access.

---

## 18. `MethodHandles.Lookup`: Capability-Based Access

Untuk mendapatkan method handle, kamu butuh `Lookup`.

```java
MethodHandles.Lookup lookup = MethodHandles.lookup();
```

`Lookup` membawa access capability dari lokasi caller.

Ini bukan sekadar utility object. Ini bagian dari security/encapsulation model.

Contoh:

```java
MethodHandle mh = lookup.findVirtual(
    SomeClass.class,
    "method",
    MethodType.methodType(void.class)
);
```

Akses private butuh capability yang sesuai.

Sejak JPMS, akses juga dipengaruhi oleh module boundary:

```text
public member belum tentu reflectively accessible jika package tidak exported/opened sesuai konteks.
```

Framework modern perlu memahami `Lookup` karena:

1. method handle access;
2. private lookup;
3. lambda metafactory custom;
4. hidden class / dynamic class use cases;
5. module encapsulation.

---

## 19. `CallSite`: Linked Dynamic Invocation Point

`CallSite` menyimpan target `MethodHandle` untuk invokedynamic.

Jenis umum:

### 19.1 `ConstantCallSite`

Target tidak berubah setelah dibuat.

Cocok untuk lambda statis atau linkage stabil.

### 19.2 `MutableCallSite`

Target bisa berubah.

Berguna untuk dynamic language runtime, tetapi perlu sinkronisasi visibility.

### 19.3 `VolatileCallSite`

Target bisa berubah dengan volatile-like visibility semantics.

Lebih mahal, tetapi visibility lebih kuat.

Untuk lambda Java biasa, kamu jarang menyentuh `CallSite` langsung. Tetapi memahami konsep ini membantu membaca bytecode dan memahami kenapa lambda linkage bisa efisien.

---

## 20. Lambda Bytecode Mental Model

Misalnya source:

```java
import java.util.function.Function;

public class LambdaDemo {
    public static void main(String[] args) {
        Function<String, Integer> f = s -> s.length();
        System.out.println(f.apply("abc"));
    }
}
```

Jika kamu jalankan:

```bash
javac LambdaDemo.java
javap -c -p -v LambdaDemo
```

Kamu akan melihat kira-kira:

```text
invokedynamic #... apply:()Ljava/util/function/Function;
```

dan method synthetic:

```text
private static java.lang.Integer lambda$main$0(java.lang.String);
```

Jangan hafalkan output persisnya. Output bisa berbeda antar versi JDK. Pahami pola:

```text
lambda source
  → invokedynamic
  → bootstrap LambdaMetafactory
  → implementation method handle
```

---

## 21. Generic Functional Interface dan Erasure

Contoh:

```java
Function<String, Integer> f = s -> s.length();
```

`Function<T, R>` memiliki SAM:

```java
R apply(T t);
```

Setelah erasure:

```java
Object apply(Object t);
```

Tetapi compiler/JVM tetap perlu menjaga type adaptation:

```text
Object -> cast String -> length -> box int to Integer -> Object
```

`LambdaMetafactory` menerima beberapa method type untuk menjembatani:

1. erased SAM method type;
2. implementation method type;
3. instantiated method type.

Ini alasan error lambda generic kadang terlihat rumit.

Mental model:

```text
Source generics membantu compile-time.
Runtime tetap bekerja dengan erased types + casts/adapters.
```

---

## 22. Primitive Specialization: Menghindari Boxing

`java.util.function` menyediakan interface specialized:

```text
IntPredicate
LongPredicate
DoublePredicate
IntFunction<R>
ToIntFunction<T>
IntUnaryOperator
IntBinaryOperator
ObjIntConsumer<T>
```

Bandingkan:

```java
Function<Integer, Integer> square = x -> x * x;
```

Ini bisa boxing/unboxing.

Lebih baik untuk hot numeric path:

```java
IntUnaryOperator square = x -> x * x;
```

Dalam stream:

```java
List<Integer> numbers = List.of(1, 2, 3);

int sum = numbers.stream()
    .mapToInt(Integer::intValue)
    .map(x -> x * x)
    .sum();
```

Kapan peduli?

1. hot loop;
2. high-throughput stream;
3. parsing besar;
4. financial/risk calculation;
5. telemetry aggregation;
6. rule evaluation jutaan kali.

Kapan tidak perlu?

1. admin API;
2. small list;
3. config parsing;
4. non-hot business flow.

---

## 23. Exception Design untuk Functional API

`java.util.function` tidak melempar checked exception.

Contoh problem:

```java
List<Path> paths = List.of();

paths.stream()
    .map(path -> Files.readString(path)) // IOException compile error
    .toList();
```

Solusi buruk:

```java
.map(path -> {
    try {
        return Files.readString(path);
    } catch (IOException e) {
        throw new RuntimeException(e);
    }
})
```

Solusi yang lebih eksplisit:

```java
@FunctionalInterface
interface ThrowingFunction<T, R> {
    R apply(T input) throws Exception;
}
```

Adapter:

```java
static <T, R> Function<T, R> unchecked(ThrowingFunction<T, R> fn) {
    return input -> {
        try {
            return fn.apply(input);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    };
}
```

Pemakaian:

```java
paths.stream()
    .map(unchecked(Files::readString))
    .toList();
```

Namun untuk production, lebih baik exception wrapper domain-specific:

```java
class FileReadRuntimeException extends RuntimeException {
    FileReadRuntimeException(Path path, Exception cause) {
        super("Failed to read file: " + path, cause);
    }
}
```

Adapter dengan context:

```java
static Function<Path, String> readFileUnchecked() {
    return path -> {
        try {
            return Files.readString(path);
        } catch (IOException e) {
            throw new FileReadRuntimeException(path, e);
        }
    };
}
```

Mental model:

```text
Functional style tidak menghilangkan failure model.
Ia hanya memindahkan tempat failure tersebut harus dimodelkan.
```

---

## 24. API Design: Kapan Pakai `java.util.function`, Kapan Buat Interface Sendiri?

Gunakan `java.util.function` jika semantics generic dan jelas:

```java
Predicate<T>
Function<T, R>
Consumer<T>
Supplier<T>
BiFunction<T, U, R>
UnaryOperator<T>
BinaryOperator<T>
```

Contoh:

```java
void filter(Predicate<Order> predicate) {}
```

Buat interface sendiri jika semantics domain penting:

```java
@FunctionalInterface
interface EligibilityRule {
    boolean isEligible(Application application);
}
```

Daripada:

```java
Predicate<Application> rule
```

Kenapa?

Karena nama method dan type membawa makna domain.

```java
EligibilityRule rule = application -> application.score() >= 80;
```

lebih jelas daripada:

```java
Predicate<Application> rule = application -> application.score() >= 80;
```

### 24.1 Domain-specific SAM bisa punya default composition

```java
@FunctionalInterface
interface EligibilityRule {
    boolean isEligible(Application application);

    default EligibilityRule and(EligibilityRule other) {
        return app -> this.isEligible(app) && other.isEligible(app);
    }

    default EligibilityRule or(EligibilityRule other) {
        return app -> this.isEligible(app) || other.isEligible(app);
    }

    static EligibilityRule alwaysAllow() {
        return app -> true;
    }
}
```

Ini memberi vocabulary domain.

### 24.2 Jangan overdo

Tidak semua callback butuh custom interface. Jika hanya transform generic:

```java
map(Function<T, R> mapper)
```

itu wajar.

Jika callback adalah business decision:

```java
evaluate(ApprovalPolicy policy)
```

lebih baik custom interface.

---

## 25. Lambda dan State Machine / Workflow System

Untuk domain workflow/regulatory, lambda sering menggoda:

```java
Map<State, Predicate<Case>> guards = new HashMap<>();
guards.put(State.SUBMITTED, c -> c.hasRequiredDocuments());
guards.put(State.REVIEW, c -> c.assignedOfficer() != null);
```

Ini berguna untuk prototype. Tetapi untuk production, hati-hati.

Masalah:

1. lambda tidak punya nama domain yang stabil;
2. sulit audit rule version;
3. sulit serialize workflow definition;
4. sulit explain decision;
5. sulit permissioning;
6. sulit tracing;
7. sulit diff antar release;
8. sulit externalize configuration.

Lebih defensible:

```java
interface GuardRule {
    String code();
    GuardResult evaluate(CaseContext context);
}
```

Implementasi bisa memakai lambda internal, tetapi API luar tetap named object:

```java
record LambdaGuardRule(
    String code,
    Predicate<CaseContext> predicate
) implements GuardRule {

    @Override
    public GuardResult evaluate(CaseContext context) {
        boolean passed = predicate.test(context);
        return passed ? GuardResult.pass(code) : GuardResult.fail(code);
    }
}
```

Dengan begitu:

```text
lambda = implementation detail
rule code = audit identity
GuardResult = explainable output
```

---

## 26. Lambda Identity, Equality, dan Debuggability

Functional objects biasanya tidak punya meaningful equality.

```java
Predicate<String> a = s -> s.isBlank();
Predicate<String> b = s -> s.isBlank();

System.out.println(a.equals(b)); // jangan harapkan true
```

Jika kamu butuh rule identity, jangan pakai lambda object identity.

Gunakan wrapper:

```java
record NamedPredicate<T>(
    String name,
    Predicate<T> predicate
) implements Predicate<T> {

    @Override
    public boolean test(T value) {
        return predicate.test(value);
    }
}
```

Pemakaian:

```java
NamedPredicate<String> notBlank =
    new NamedPredicate<>("NOT_BLANK", s -> s != null && !s.isBlank());
```

Untuk logging:

```java
log.debug("Evaluating rule {}", rule.name());
```

Jangan:

```java
log.debug("Evaluating rule {}", predicate);
```

Output lambda `toString()` bukan kontrak stabil.

---

## 27. Lambda dan Serialization: Jangan Jadikan Persisted Contract

Lambda bisa dibuat serializable jika target type extends `Serializable`.

```java
@FunctionalInterface
interface SerializableRule<T> extends Predicate<T>, Serializable {
}
```

Lalu:

```java
SerializableRule<String> r = s -> s.length() > 3;
```

Secara teknis bisa diserialisasi. Namun ini hampir selalu buruk untuk long-term persistence.

Masalah:

1. bergantung pada compiler-generated metadata;
2. rentan berubah saat refactor;
3. tidak cocok untuk cross-version persistence;
4. tidak bagus untuk audit;
5. tidak portable sebagai business rule;
6. bisa punya security implications saat deserialization.

Untuk workflow/rule engine, persist:

```text
rule code
rule version
parameters
expression DSL
decision table
configuration record
```

Bukan serialized lambda.

---

## 28. Lambda dan Checked Security/Permission Boundary

Lambda sering dipakai sebagai callback:

```java
runAs(user, () -> service.updateCase(id));
```

Hati-hati: lambda bisa capture terlalu banyak.

```java
runAs(user, () -> {
    adminOnlyService.delete(id);
});
```

Boundary security harus berada di service/action, bukan diasumsikan karena lambda dikirim dari tempat “benar”.

Desain lebih defensible:

```java
interface AuthorizedAction<R> {
    Permission requiredPermission();
    R execute();
}
```

Atau:

```java
record ActionCommand<R>(
    String actionCode,
    Permission requiredPermission,
    Supplier<R> operation
) {}
```

Runtime executor:

```java
<R> R execute(User user, ActionCommand<R> command) {
    authorization.check(user, command.requiredPermission());
    return command.operation().get();
}
```

Tetapi tetap audit `actionCode`, bukan lambda identity.

---

## 29. Lambda di Hot Path: Allocation, Escape, Inlining

Tidak semua lambda menyebabkan allocation yang bermakna.

JVM bisa:

1. cache stateless lambda;
2. inline call target;
3. eliminate allocation via escape analysis;
4. optimize method handle linkage;
5. specialize hot paths at JIT level.

Namun jangan membuat klaim mutlak seperti:

```text
lambda selalu gratis
lambda selalu lambat
```

Keduanya salah.

Yang perlu kamu evaluasi:

1. apakah lambda stateless atau capturing;
2. apakah dibuat di hot loop;
3. apakah capture object besar;
4. apakah target functional interface boxed;
5. apakah pipeline stream menghasilkan allocation tambahan;
6. apakah JIT bisa melihat target;
7. apakah lambda melewati module/classloader boundary;
8. apakah lambda disimpan jangka panjang.

Contoh buruk:

```java
for (int i = 0; i < items.size(); i++) {
    int threshold = computeThreshold(i);
    predicates.add(x -> x.score() > threshold);
}
```

Ini membuat banyak capturing lambda.

Kadang benar. Kadang memory leak.

---

## 30. Lambdas dalam Logging

Jangan confuse `Supplier<String>` logging dengan lazy logging yang benar.

Misalnya custom logger:

```java
logger.debug(() -> expensiveMessage());
```

Ini bagus jika logger hanya memanggil supplier ketika debug enabled.

Tetapi jika logger API menerima `String`, ini tetap eager:

```java
logger.debug(expensiveMessage());
```

Untuk `System.Logger`, ada overload yang menerima `Supplier<String>`.

Pattern umum:

```java
logger.log(DEBUG, () -> "expensive " + compute());
```

Namun jangan capture sensitive data yang bisa hidup lebih lama dari request jika supplier disimpan.

---

## 31. `java.lang.invoke` Boundary untuk Framework Author

Jika kamu membangun framework kecil, kapan mulai mempertimbangkan method handles?

### Cocok

1. sering memanggil method reflectively;
2. perlu property accessor cepat;
3. mapping antar object besar;
4. serializer/deserializer hot path;
5. rule engine dynamic dispatch;
6. plugin method binding;
7. DI container constructor invocation;
8. adapter generated at runtime.

### Tidak perlu

1. business service biasa;
2. REST controller biasa;
3. one-off reflection saat startup;
4. admin utility;
5. batch kecil;
6. readability lebih penting daripada nanosecond optimization.

### Reflection to MethodHandle pattern

Startup:

```java
record Accessor(MethodHandle getter) {}

Accessor buildGetter(Class<?> type, String fieldName) throws Exception {
    MethodHandles.Lookup lookup = MethodHandles.lookup();
    Field field = type.getDeclaredField(fieldName);
    field.setAccessible(true);

    MethodHandle getter = lookup.unreflectGetter(field);
    return new Accessor(getter);
}
```

Hot path:

```java
Object value = accessor.getter().invoke(entity);
```

Untuk production, kamu perlu menangani:

1. access checks;
2. module opens;
3. primitive vs boxed type;
4. exception handling;
5. method handle adaptation;
6. caching per class;
7. class loader leak prevention.

---

## 32. `VarHandle` Boundary

`VarHandle` adalah typed reference ke variable atau family of variables:

```text
static field
instance field
array element
off-heap/memory layout component
```

Ia sering menjadi pengganti modern untuk beberapa use case `sun.misc.Unsafe`.

Contoh sederhana:

```java
class Counter {
    volatile int value;
}

VarHandle VALUE = MethodHandles.lookup().findVarHandle(
    Counter.class,
    "value",
    int.class
);
```

Pemakaian:

```java
Counter c = new Counter();

VALUE.setVolatile(c, 10);
int current = (int) VALUE.getVolatile(c);
boolean ok = VALUE.compareAndSet(c, 10, 11);
```

Di part ini kita tidak mendalami memory ordering karena sudah masuk concurrency/memory model. Yang penting:

```text
VarHandle adalah bagian dari java.lang.invoke boundary,
bukan API callback/lambda langsung.
```

Ia relevan karena sama-sama berada di runtime linkage/typed operation family.

---

## 33. `LambdaMetafactory` untuk Custom Runtime Adapter

Sebagian besar aplikasi tidak perlu memanggil `LambdaMetafactory` langsung.

Tetapi framework bisa menggunakannya untuk membuat implementation functional interface secara efisien dari method handle.

Conceptual example:

```java
// Pseudocode-ish; real LambdaMetafactory use requires exact MethodType discipline.
CallSite site = LambdaMetafactory.metafactory(
    lookup,
    "apply",
    invokedType,
    samMethodType,
    implMethod,
    instantiatedMethodType
);
```

Hasilnya adalah `CallSite` yang target-nya bisa menghasilkan function object.

Kapan ini berguna?

1. membuat adapter dari method ke interface;
2. menghindari reflection invocation per call;
3. membuat rule/mapper compiled runtime;
4. membangun DSL engine yang output-nya function object;
5. dynamic proxy alternative untuk SAM-only interface.

Namun cost kompleksitas tinggi. Salah sedikit bisa menghasilkan:

```text
LambdaConversionException
WrongMethodTypeException
IllegalAccessException
ClassCastException
LinkageError
```

Rule praktis:

```text
Gunakan LambdaMetafactory hanya jika kamu bisa membuktikan reflection/proxy menjadi bottleneck
atau kamu memang sedang membangun runtime/framework layer.
```

---

## 34. Dynamic Proxy vs LambdaMetafactory vs MethodHandle

| Mekanisme | Cocok Untuk | Kelebihan | Risiko |
|---|---|---|---|
| Reflection `Method.invoke` | simple dynamic call | mudah dipakai | lebih lambat, runtime checks |
| Dynamic Proxy | interface multi-method | mudah intercept | overhead, invocation handler generic |
| MethodHandle | typed dynamic invocation | lebih JVM-friendly | type discipline sulit |
| LambdaMetafactory | SAM adapter cepat | efisien untuk function object | kompleks, brittle |
| Code generation | framework berat | performa tinggi/fleksibel | maintenance/security/classloader |

Untuk kebanyakan business application:

```text
reflection at startup + direct calls at runtime
```

lebih baik daripada terlalu cepat masuk ke `java.lang.invoke`.

Untuk framework hot path:

```text
discover once
bind method handle
cache carefully
invoke many times
```

bisa worth it.

---

## 35. Hidden Complexity: ClassLoader dan Lambda

Lambda implementation class adalah detail runtime. Class loader tetap relevan.

Jika lambda dibuat dari class yang dimuat plugin class loader, lambda bisa mempertahankan class loader tersebut.

Contoh leak pattern:

```java
static final List<Runnable> GLOBAL_TASKS = new ArrayList<>();

void pluginInit() {
    PluginService service = new PluginService();
    GLOBAL_TASKS.add(() -> service.run());
}
```

Jika plugin unload diharapkan, lambda di global list menahan:

```text
lambda → captured service → service class → plugin class loader
```

Akibat: class loader leak.

Solusi:

1. explicit deregistration;
2. weak references jika cocok;
3. lifecycle-aware registry;
4. jangan simpan lambda plugin ke static global tanpa owner;
5. gunakan named command object dengan close/unregister lifecycle.

---

## 36. Lambda dan Observability

Lambda membuat stack trace/debug kadang kurang ekspresif:

```text
com.example.MyService.lambda$process$3(MyService.java:123)
```

Ini cukup untuk developer, tetapi kurang untuk audit/business.

Untuk event/rule/workflow, bungkus dengan metadata:

```java
record StepHandler(
    String stepCode,
    String description,
    Consumer<WorkflowContext> handler
) {
    void execute(WorkflowContext context) {
        handler.accept(context);
    }
}
```

Tracing:

```java
void executeStep(StepHandler step, WorkflowContext context) {
    span.setAttribute("workflow.step", step.stepCode());
    step.execute(context);
}
```

Dengan begitu observability tidak tergantung pada synthetic method name.

---

## 37. Functional Interface Evolution and Compatibility

Functional interface publik adalah kontrak API.

Aman:

```java
@FunctionalInterface
interface Rule {
    boolean test(Context c);

    default Rule negate() {
        return c -> !test(c);
    }
}
```

Menambah default method biasanya source/binary compatible.

Berbahaya:

```java
@FunctionalInterface
interface Rule {
    boolean test(Context c);

    boolean explain(Context c); // merusak SAM
}
```

Ini merusak source compatibility untuk lambda users.

Untuk evolusi, gunakan:

1. default method;
2. subinterface baru;
3. context object;
4. return object yang bisa dievolusi;
5. separate metadata interface.

Contoh:

```java
interface Rule {
    RuleResult evaluate(Context c);
}

record RuleResult(
    boolean passed,
    String reasonCode,
    Map<String, Object> facts
) {}
```

Ini lebih evolvable daripada:

```java
boolean test(Context c);
```

Jika domain butuh explanation.

---

## 38. Context Object vs Multi-Parameter Functional Interface

Daripada:

```java
@FunctionalInterface
interface TransitionGuard {
    boolean allowed(User user, CaseData caseData, State from, State to, Instant now);
}
```

Lebih evolvable:

```java
@FunctionalInterface
interface TransitionGuard {
    boolean allowed(TransitionContext context);
}
```

Dengan:

```java
record TransitionContext(
    User user,
    CaseData caseData,
    State from,
    State to,
    Instant now,
    Map<String, Object> attributes
) {}
```

Keuntungan:

1. parameter bisa bertambah tanpa mengubah SAM;
2. lebih mudah logging;
3. lebih mudah testing;
4. lebih mudah audit;
5. lebih mudah pass ke nested rules.

Kerugian:

1. context bisa menjadi god object;
2. caller bisa memasukkan data terlalu banyak;
3. mutability harus dijaga;
4. validation context harus jelas.

Rule:

```text
Untuk API publik/evolvable, context object sering lebih baik.
Untuk helper internal kecil, BiFunction/Tri custom boleh.
```

---

## 39. Failure Modes

### 39.1 Menganggap lambda punya identity stabil

Buruk:

```java
audit(rule.getClass().getName());
```

Lebih baik:

```java
audit(ruleCode);
```

### 39.2 Menyimpan serialized lambda

Buruk:

```java
database.save(serialize(ruleLambda));
```

Lebih baik:

```java
database.save(new RuleDefinition("AGE_AT_LEAST", 1, Map.of("min", 18)));
```

### 39.3 Capture mutable state lintas thread

Buruk:

```java
List<String> errors = new ArrayList<>();

items.parallelStream().forEach(item -> {
    if (!valid(item)) errors.add(item.id());
});
```

Lebih baik:

```java
List<String> errors = items.parallelStream()
    .filter(item -> !valid(item))
    .map(Item::id)
    .toList();
```

### 39.4 Capture request/security context ke async task

Buruk:

```java
SecurityContext ctx = SecurityContext.current();

executor.submit(() -> {
    service.runWith(ctx);
});
```

Jika context tidak immutable atau sudah expired, ini risk.

Lebih baik: capture minimal immutable identity/token/snapshot.

```java
UserId userId = SecurityContext.current().userId();

executor.submit(() -> service.runAs(userId));
```

### 39.5 Overload ambiguity

Buruk:

```java
void onEvent(Consumer<Event> c) {}
void onEvent(Function<Event, Void> f) {}
```

Lebih baik buat nama berbeda atau domain-specific interface.

### 39.6 Checked exception disembunyikan sembarangan

Buruk:

```java
.map(unchecked(Files::readString))
```

tanpa context.

Lebih baik wrapper domain-specific dengan path/action.

### 39.7 Menggunakan `java.lang.invoke` terlalu dini

Buruk:

```text
Membuat MethodHandle/LambdaMetafactory layer kompleks untuk code path yang bukan bottleneck.
```

Lebih baik:

```text
Mulai dari readable direct/reflection code.
Measure.
Optimalkan boundary yang terbukti hot.
```

### 39.8 Functional interface publik berubah menambah abstract method

Ini merusak semua caller lambda.

Gunakan `@FunctionalInterface` agar compiler menjaga kontrak.

---

## 40. Production Patterns

### 40.1 Named functional wrapper

```java
record NamedFunction<T, R>(
    String code,
    Function<T, R> function
) implements Function<T, R> {

    @Override
    public R apply(T value) {
        return function.apply(value);
    }
}
```

### 40.2 Rule result, bukan boolean saja

```java
@FunctionalInterface
interface CaseRule {
    RuleResult evaluate(CaseContext context);
}

record RuleResult(
    boolean passed,
    String code,
    String message
) {
    static RuleResult pass(String code) {
        return new RuleResult(true, code, "passed");
    }

    static RuleResult fail(String code, String message) {
        return new RuleResult(false, code, message);
    }
}
```

### 40.3 Safe composition

```java
interface CaseRule {
    RuleResult evaluate(CaseContext context);

    default CaseRule and(CaseRule other) {
        return context -> {
            RuleResult first = this.evaluate(context);
            if (!first.passed()) return first;
            return other.evaluate(context);
        };
    }
}
```

### 40.4 Startup binding, runtime direct use

```java
final class AccessorCache {
    private final Map<Class<?>, MethodHandle> getters = new ConcurrentHashMap<>();

    Object getId(Object entity) {
        try {
            MethodHandle mh = getters.computeIfAbsent(entity.getClass(), this::findIdGetter);
            return mh.invoke(entity);
        } catch (Throwable e) {
            throw new IllegalStateException("Failed to read id from " + entity.getClass().getName(), e);
        }
    }

    private MethodHandle findIdGetter(Class<?> type) {
        try {
            MethodHandles.Lookup lookup = MethodHandles.publicLookup();
            return lookup.findVirtual(type, "id", MethodType.methodType(String.class));
        } catch (ReflectiveOperationException e) {
            throw new IllegalArgumentException("No public id() method on " + type.getName(), e);
        }
    }
}
```

Catatan:

- ini contoh konsep;
- production perlu type adaptation;
- jangan cache class dari plugin tanpa eviction/lifecycle;
- perhatikan module access.

---

## 41. Java 8–25 Evolution Map

### Java 8

Fondasi utama:

```text
lambda expressions
method references
default methods
java.util.function
java.lang.FunctionalInterface
java.lang.invoke.LambdaMetafactory usage for lambda
```

### Java 9+

JPMS memengaruhi reflective/method handle access. `MethodHandles.Lookup` menjadi lebih penting untuk framework yang perlu akses private/module-aware.

### Java 9

`StringConcatFactory` memakai pola `invokedynamic` untuk string concatenation. Ini bukan lambda, tetapi menunjukkan strategi JDK: menjaga bytecode stabil sambil memindahkan strategi runtime ke bootstrap/linkage layer.

### Java 11–17

Stabilitas ekosistem lambda semakin matang. Framework mulai lebih banyak memakai method handles untuk performa dan JPMS-aware access.

### Java 16–17

Records/sealed types memberi pola functional-style data modelling yang sering dikombinasikan dengan lambda/rule objects.

### Java 21

Virtual threads membuat penggunaan lambda untuk task submission semakin umum:

```java
Thread.startVirtualThread(() -> service.run());
```

Namun capture semantics tetap sama. Jangan capture context sembarangan.

### Java 25

Core model tetap konsisten: lambda tetap target-typed ke functional interface; `java.lang.invoke` tetap low-level primitive JVM; JPMS/module access tetap penting.

---

## 42. Design Heuristics

Gunakan heuristic berikut:

### 42.1 Untuk callback sederhana

Gunakan `java.util.function`.

```java
void retry(Supplier<Result> operation)
```

### 42.2 Untuk domain rule

Buat custom functional interface.

```java
interface ApprovalRule {
    RuleResult evaluate(ApprovalContext context);
}
```

### 42.3 Untuk audited workflow

Jangan gunakan bare lambda sebagai identity.

```java
record WorkflowStep(String code, Consumer<Context> action) {}
```

### 42.4 Untuk checked exception

Modelkan secara eksplisit.

```java
interface ThrowingOperation<E extends Exception> {
    void run() throws E;
}
```

### 42.5 Untuk hot dynamic invocation

Pertimbangkan `MethodHandle`, tetapi ukur dulu.

### 42.6 Untuk public API

Tambahkan `@FunctionalInterface` pada SAM interface.

### 42.7 Untuk evolvable API

Gunakan context object dan result object.

---

## 43. Testing Strategy

### 43.1 Test behavior, bukan lambda identity

Buruk:

```java
assertEquals(expectedLambda, actualLambda);
```

Baik:

```java
assertTrue(actualRule.evaluate(context).passed());
```

### 43.2 Test composition

```java
CaseRule a = ctx -> RuleResult.pass("A");
CaseRule b = ctx -> RuleResult.fail("B", "failed");

RuleResult result = a.and(b).evaluate(context);

assertFalse(result.passed());
assertEquals("B", result.code());
```

### 43.3 Test capture bug

Pastikan lambda tidak capture mutable object yang berubah tak terduga.

```java
List<String> config = new ArrayList<>(List.of("A"));

Supplier<Integer> size = config::size;

config.add("B");

assertEquals(2, size.get());
```

Ini bukan bug jika intentional. Tetapi harus dipahami.

### 43.4 Test exception wrapping

```java
Function<Path, String> reader = readFileUnchecked();

assertThrows(FileReadRuntimeException.class, () -> reader.apply(Path.of("missing")));
```

### 43.5 Test API evolution

Untuk public functional interface, compile test client module yang memakai lambda. Ini menangkap perubahan SAM yang merusak source compatibility.

---

## 44. Checklist Production

Sebelum memakai lambda/functional interface di desain serius, tanyakan:

1. Apakah callback ini generic atau domain-specific?
2. Apakah nama method SAM membawa makna yang cukup?
3. Apakah butuh checked exception?
4. Apakah butuh audit identity?
5. Apakah butuh explanation/result object?
6. Apakah lambda capture object besar?
7. Apakah lambda capture `this`?
8. Apakah lambda disimpan lebih lama dari request?
9. Apakah lambda dikirim ke thread lain?
10. Apakah lambda dipakai di hot path?
11. Apakah primitive specialization diperlukan?
12. Apakah overload API membuat lambda ambigu?
13. Apakah public functional interface diberi `@FunctionalInterface`?
14. Apakah perubahan API mendatang akan merusak SAM?
15. Apakah observability bergantung pada synthetic lambda name?
16. Apakah serialization lambda dihindari?
17. Apakah class loader lifecycle diperhatikan?
18. Apakah module access diperhatikan jika memakai `java.lang.invoke`?
19. Apakah method handle cache punya eviction/lifecycle?
20. Apakah benchmark dilakukan sebelum optimasi low-level?

---

## 45. Mini Capstone Part Ini: Rule Engine Ringan yang Defensible

### 45.1 Problem

Kita ingin membuat rule evaluation sederhana untuk application processing.

Naive:

```java
Predicate<Application> rule = app -> app.age() >= 18;
```

Problem:

```text
tidak ada rule code
tidak ada message
tidak ada audit identity
tidak ada explainability
tidak ada version
```

### 45.2 Lebih baik

```java
record Application(
    String id,
    int age,
    boolean documentsComplete
) {}

record RuleContext(
    Application application
) {}

record RuleResult(
    String ruleCode,
    boolean passed,
    String message
) {
    static RuleResult pass(String code) {
        return new RuleResult(code, true, "passed");
    }

    static RuleResult fail(String code, String message) {
        return new RuleResult(code, false, message);
    }
}

@FunctionalInterface
interface ApplicationRule {
    RuleResult evaluate(RuleContext context);

    default ApplicationRule and(ApplicationRule other) {
        return context -> {
            RuleResult first = this.evaluate(context);
            if (!first.passed()) return first;
            return other.evaluate(context);
        };
    }
}

record NamedApplicationRule(
    String code,
    ApplicationRule rule
) implements ApplicationRule {

    @Override
    public RuleResult evaluate(RuleContext context) {
        return rule.evaluate(context);
    }
}
```

### 45.3 Rule definitions

```java
NamedApplicationRule adultRule = new NamedApplicationRule(
    "AGE_AT_LEAST_18",
    ctx -> ctx.application().age() >= 18
        ? RuleResult.pass("AGE_AT_LEAST_18")
        : RuleResult.fail("AGE_AT_LEAST_18", "Applicant must be at least 18")
);

NamedApplicationRule docsRule = new NamedApplicationRule(
    "DOCUMENTS_COMPLETE",
    ctx -> ctx.application().documentsComplete()
        ? RuleResult.pass("DOCUMENTS_COMPLETE")
        : RuleResult.fail("DOCUMENTS_COMPLETE", "Documents are incomplete")
);
```

### 45.4 Evaluation

```java
ApplicationRule combined = adultRule.and(docsRule);

RuleResult result = combined.evaluate(
    new RuleContext(new Application("APP-001", 17, true))
);

System.out.println(result);
```

Output konseptual:

```text
RuleResult[ruleCode=AGE_AT_LEAST_18, passed=false, message=Applicant must be at least 18]
```

### 45.5 Kenapa desain ini lebih baik?

Karena lambda hanya dipakai sebagai implementation detail.

Kontrak domain tetap:

```text
ApplicationRule
RuleResult
ruleCode
message
composition semantics
```

Ini lebih cocok untuk audit, tracing, testing, dan evolusi.

---

## 46. Latihan

### Latihan 1 — Functional Interface Design

Desain functional interface untuk `TransitionGuard` pada workflow case management.

Requirement:

1. guard menerima context;
2. hasil tidak hanya boolean;
3. hasil punya reason code;
4. bisa compose dengan `and`;
5. bisa audit rule code.

### Latihan 2 — Capture Analysis

Analisis kode berikut:

```java
class HandlerFactory {
    private final Service service;

    HandlerFactory(Service service) {
        this.service = service;
    }

    Runnable create(String id) {
        return () -> service.handle(id);
    }
}
```

Jawab:

1. apa yang dicapture?
2. apakah `this` dicapture?
3. object apa saja yang bisa tertahan hidup lebih lama?
4. kapan ini menjadi leak?

### Latihan 3 — Checked Exception Adapter

Buat adapter:

```java
static <T, R> Function<T, R> wrap(
    ThrowingFunction<T, R> fn,
    BiFunction<T, Exception, RuntimeException> exceptionMapper
)
```

Tujuannya agar setiap exception punya context input.

### Latihan 4 — Bytecode Observation

Buat class sederhana:

```java
Function<String, Integer> f = s -> s.length();
```

Compile dan inspect:

```bash
javac Demo.java
javap -c -p -v Demo
```

Cari:

1. `invokedynamic`;
2. `BootstrapMethods`;
3. `LambdaMetafactory`;
4. synthetic `lambda$...` method.

### Latihan 5 — API Evolution

Interface awal:

```java
@FunctionalInterface
interface Rule {
    boolean test(Context context);
}
```

Bagaimana cara menambahkan explainability tanpa merusak caller lambda existing?

---

## 47. Ringkasan

Lambda di Java bukan sekadar syntax pendek. Lambda adalah fitur yang berdiri di atas target typing, functional interface, SAM conversion, generic erasure adaptation, `invokedynamic`, dan runtime linkage melalui `java.lang.invoke`.

Pemahaman yang perlu dibawa:

```text
Lambda expression membutuhkan target type.
Target type adalah functional interface.
Functional interface harus punya satu abstract method.
@FunctionalInterface menjaga intensi API.
Lambda capture binding local yang final/effectively final.
Capture reference tidak membuat object immutable.
Lambda identity/class/toString bukan kontrak stabil.
Method reference adalah adaptasi method ke SAM.
Checked exception harus dimodelkan secara sadar.
java.util.function cocok untuk callback generic.
Custom SAM cocok untuk domain semantics.
invokedynamic membuat implementasi lambda fleksibel.
LambdaMetafactory adalah bootstrap umum untuk lambda runtime.
MethodHandle adalah typed runtime handle ke operation.
java.lang.invoke cocok untuk framework/runtime boundary, bukan semua business code.
```

Untuk sistem production, terutama workflow/regulatory/case management, gunakan lambda sebagai implementation detail. Jangan jadikan lambda sebagai identitas bisnis, artefak audit, serialized workflow state, atau boundary security.

---

## 48. Referensi Resmi dan Lanjutan

- Java SE 25 API — `java.lang.FunctionalInterface`
- Java SE 25 API — `java.util.function`
- Java SE 25 API — `java.lang.invoke`
- Java SE 25 API — `LambdaMetafactory`
- Java SE 25 API — `MethodHandle`
- Java SE 25 API — `MethodType`
- Java SE 25 API — `MethodHandles.Lookup`
- Java SE 25 API — `CallSite`
- Java SE 25 API — `VarHandle`
- Java Language Specification — Lambda Expressions
- Java Virtual Machine Specification — `invokedynamic`
- OpenJDK JEP 126 — Lambda Expressions & Virtual Extension Methods
- OpenJDK JEP 292 — Implement Selected ECMAScript 6 Features in Nashorn, `invokedynamic` ecosystem context
- OpenJDK JEP 280 — Indify String Concatenation
- OpenJDK JEP 416 — Reimplement Core Reflection with Method Handles

---

## 49. Status Seri

Part ini adalah **Part 22 dari 32**.

Seri belum selesai.

Part berikutnya:

```text
23-classvalue-cleaner-runtime-attached-metadata-resource-cleanup.md
```

Judul:

```text
Part 23 — ClassValue, Cleaner, Runtime-Attached Metadata, and Resource Cleanup
```

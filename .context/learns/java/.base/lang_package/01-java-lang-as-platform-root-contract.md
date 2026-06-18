# Part 1 — `java.lang` as the Root Contract of the Java Platform

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `01-java-lang-as-platform-root-contract.md`  
> Scope: Java 8–25  
> Main packages: `java.lang.*` with orientation toward later `org.w3c.dom.*` and `org.xml.sax.*` parts

---

## 1. Tujuan Part Ini

Part ini membangun fondasi mental bahwa `java.lang` bukan sekadar package yang otomatis di-import. `java.lang` adalah **kontrak dasar antara source code Java, compiler, bytecode, JVM, runtime image, library, dan aplikasi**.

Banyak engineer memakai `String`, `Object`, `Class`, `Throwable`, `System`, `Thread`, `Enum`, `Record`, `Module`, `Runtime`, atau wrapper seperti `Integer` setiap hari, tetapi memahaminya secara terpisah sebagai “class biasa”. Engineer yang sangat kuat melihatnya sebagai **surface API dari platform runtime**.

Setelah part ini, kamu harus bisa menjawab pertanyaan berikut dengan mental model yang kuat:

1. Mengapa `java.lang` otomatis tersedia di setiap source file Java?
2. Mengapa hampir semua desain Java akhirnya menyentuh `Object`, `Class`, `String`, dan `Throwable`?
3. Apa hubungan `java.lang` dengan compiler dan JVM?
4. Mengapa `java.lang` berada di module `java.base` sejak Java 9?
5. Apa bedanya Java language feature, Java SE API, JVM behavior, dan JDK implementation detail?
6. Mengapa `java.lang` menjadi tempat lahirnya banyak konsep language-level seperti enum, record, annotation, module, runtime version, process, dan thread?
7. Bagaimana cara membaca `java.lang` sebagai kontrak platform, bukan kumpulan utility class?
8. Apa saja jebakan arsitektural yang muncul ketika engineer salah memahami `java.lang`?

---

## 2. Posisi `java.lang` dalam Java Platform

Dalam Java, setiap compilation unit secara implisit memiliki import:

```java
import java.lang.*;
```

Artinya, class seperti `String`, `Object`, `System`, `Math`, `Integer`, `Thread`, `RuntimeException`, dan `Class` bisa dipakai tanpa menulis import eksplisit.

Namun automatic import bukan alasan utama mengapa `java.lang` penting. Automatic import adalah **gejala** dari posisi `java.lang` yang fundamental.

`java.lang` berisi class dan interface yang mendukung:

- object model;
- type model;
- exception model;
- primitive-wrapper bridge;
- text/string model;
- runtime access;
- process access;
- thread access;
- class loading boundary;
- annotation contract;
- enum/record/module runtime representation;
- versioning;
- low-level language runtime support.

Sejak Java 9, `java.lang` berada di module `java.base`. Module `java.base` mendefinisikan foundational APIs dari Java SE Platform dan merupakan module yang secara implisit dibutuhkan oleh semua module lain.

Mental model sederhana:

```text
Your Java Source Code
        │
        ▼
Java Compiler
        │
        ▼
Bytecode + Constant Pool + Class Metadata
        │
        ▼
JVM Class Loading / Linking / Initialization
        │
        ▼
Runtime Objects, Threads, Exceptions, Strings
        │
        ▼
java.lang API as the visible contract
```

`java.lang` adalah salah satu area API yang paling dekat dengan fakta bahwa Java bukan hanya bahasa, tetapi **runtime platform**.

---

## 3. Empat Lapisan yang Sering Tercampur

Untuk memahami `java.lang` secara advance, kita harus membedakan empat hal:

```text
1. Java Language
2. Java SE API
3. JVM Specification / Runtime Behavior
4. JDK Implementation
```

### 3.1 Java Language

Java language adalah aturan source code:

- syntax `class`, `interface`, `record`, `enum`;
- inheritance;
- generics;
- lambda;
- try/catch/finally;
- switch;
- module declaration;
- annotation syntax;
- string literal;
- numeric literal;
- primitive types;
- pattern matching;
- sealed classes.

Contoh:

```java
String name = "Fajar";
```

Dari sisi Java language, ini adalah deklarasi variable bertipe `String` dengan string literal.

### 3.2 Java SE API

Java SE API adalah library standard yang didefinisikan oleh platform:

- `java.lang.String`;
- `java.lang.Object`;
- `java.lang.Class`;
- `java.lang.Throwable`;
- `java.lang.System`;
- `java.lang.Thread`;
- `java.lang.Module`;
- `org.w3c.dom.Document`;
- `org.xml.sax.XMLReader`.

Source code memakai API ini, tetapi API ini juga sering merepresentasikan konsep language-level.

Contoh:

```java
Class<?> type = String.class;
```

`String.class` adalah syntax language, tetapi hasilnya adalah object API `java.lang.Class`.

### 3.3 JVM Specification / Runtime Behavior

JVM menentukan behavior runtime:

- bagaimana class dimuat;
- bagaimana bytecode diverifikasi;
- bagaimana constant pool bekerja;
- bagaimana method dispatch terjadi;
- bagaimana exception dilempar;
- bagaimana monitor bekerja;
- bagaimana class initialization dilakukan;
- bagaimana stack frame dan heap digunakan.

Contoh:

```java
Object x = "abc";
System.out.println(x.getClass());
```

Bahasa Java mengizinkan assignment ke `Object`, API `Object#getClass()` mengembalikan `Class<?>`, tetapi fakta bahwa object runtime tetap punya exact class `String` adalah behavior JVM object model.

### 3.4 JDK Implementation

JDK implementation adalah implementasi konkret:

- HotSpot object layout;
- compact strings;
- string deduplication;
- specific GC behavior;
- class data sharing;
- internal classes;
- implementation-specific parser behavior;
- vendor-specific fixes.

Contoh penting:

```java
String s = "hello";
```

Secara API, `String` immutable. Secara implementation, sejak Java 9 banyak JDK memakai compact string representation dengan `byte[]` plus coder, bukan `char[]` seperti Java lama. Sebagai developer, kamu boleh memahami implikasi performanya, tetapi tidak boleh menulis business logic yang bergantung pada field internal tersebut.

### 3.5 Kenapa Pemisahan Ini Penting?

Banyak bug advance muncul karena engineer mencampur empat lapisan ini.

Contoh kesalahan:

```java
// Salah secara desain: mengandalkan nama class lambda/generated class
String className = someLambda.getClass().getName();
```

Masalahnya:

- lambda adalah language feature;
- runtime memakai mekanisme `invokedynamic` dan generated/hidden implementation detail;
- `getClass()` memang API `java.lang.Object`;
- tetapi nama class lambda bukan contract domain yang stabil.

Engineer top-tier akan bertanya:

```text
Apakah yang saya pakai ini language contract, API contract, JVM contract,
atau hanya implementation detail?
```

---

## 4. `java.lang` sebagai “Root Contract”

`java.lang` dapat dilihat sebagai root contract dalam beberapa dimensi.

---

## 4.1 Root of Object Model: `Object`

Semua reference type di Java memiliki akar pada `java.lang.Object`, baik langsung maupun tidak langsung.

```java
class CaseFile {
}
```

Secara konsep:

```java
class CaseFile extends Object {
}
```

`Object` menyediakan kontrak minimal:

```java
public boolean equals(Object obj)
public int hashCode()
public String toString()
public final Class<?> getClass()
protected Object clone() throws CloneNotSupportedException
protected void finalize() throws Throwable // deprecated/legacy
public final void wait() throws InterruptedException
public final void notify()
public final void notifyAll()
```

Ini bukan sekadar method utilitas.

`Object` menentukan bagaimana object dapat:

- dibandingkan;
- dipakai sebagai key di hash table;
- didiagnosis;
- diinspeksi tipe runtime-nya;
- dipakai dalam monitor synchronization;
- berpartisipasi dalam lifecycle legacy.

Salah memahami `Object` dapat merusak:

- `HashMap`;
- cache;
- entity identity;
- distributed ID model;
- logging;
- concurrency;
- framework proxy behavior.

Contoh bug klasik:

```java
final class CaseId {
    private final String value;

    CaseId(String value) {
        this.value = value;
    }
}

Map<CaseId, String> map = new HashMap<>();
map.put(new CaseId("CASE-001"), "open");

System.out.println(map.get(new CaseId("CASE-001"))); // null
```

Mengapa? Karena `equals` dan `hashCode` belum didefinisikan secara logical.

Di sistem regulatory/case management, bug seperti ini bukan sekadar bug teknis. Ia bisa menyebabkan:

- duplicate case;
- failed lookup;
- incorrect deduplication;
- inconsistent audit;
- broken workflow correlation.

---

## 4.2 Root of Type Model: `Class<T>`

`Class<T>` adalah runtime representation dari class/interface/array/primitive/void.

```java
Class<String> stringType = String.class;
Class<?> runtimeType = "abc".getClass();
Class<Integer> intWrapperType = Integer.class;
Class<Integer> primitiveIntType = int.class; // type is Class<Integer> at compile-time oddity
Class<Void> voidType = void.class;
```

`Class` bukan reflection “tambahan”. `Class` adalah jembatan antara source-level type dan runtime-level type.

`Class` dipakai oleh:

- serializers;
- deserializers;
- DI containers;
- ORMs;
- validation frameworks;
- test frameworks;
- plugin systems;
- service discovery;
- dynamic proxies;
- class loading logic;
- module introspection.

Contoh:

```java
public <T> T requireType(Object value, Class<T> expectedType) {
    if (!expectedType.isInstance(value)) {
        throw new IllegalArgumentException(
            "Expected " + expectedType.getName() + " but got " +
            (value == null ? "null" : value.getClass().getName())
        );
    }
    return expectedType.cast(value);
}
```

Ini bukan hanya “reflection”. Ini adalah runtime type safety boundary.

Kesalahan umum:

```java
if (value.getClass() == expectedType) {
    // terlalu strict; subclass tidak diterima
}
```

Lebih tepat untuk banyak use case:

```java
if (expectedType.isInstance(value)) {
    // polymorphic check
}
```

Namun kadang exact class memang benar, misalnya:

- serialization format harus exact;
- security boundary melarang subclass spoofing;
- value object tidak boleh di-proxy;
- equality memakai exact class.

Engineer kuat tidak bertanya “mana yang benar secara umum?”, tetapi:

```text
Boundary ini butuh exact type atau assignable type?
```

---

## 4.3 Root of Text Model: `String`

`String` adalah salah satu class paling penting di Java.

Ia muncul di:

- class names;
- method names;
- package names;
- file paths;
- URLs;
- SQL;
- XML;
- JSON;
- logs;
- configuration;
- exceptions;
- identifiers;
- enum names;
- system properties;
- environment values;
- command-line arguments.

`String` sering terlihat sederhana, tetapi menjadi boundary antara:

```text
Human Meaning ↔ Machine Representation
```

Contoh:

```java
String caseRef = "ACEAS-2026-000123";
```

Pertanyaan desain:

- Apakah case reference case-sensitive?
- Apakah whitespace harus di-trim?
- Apakah Unicode normalization diperlukan?
- Apakah `equalsIgnoreCase` cukup aman?
- Apakah string ini boleh dilog?
- Apakah string ini user-provided?
- Apakah string ini digunakan sebagai key?
- Apakah string ini external contract?
- Apakah string ini canonical atau display-only?

String bug sering bukan bug syntax, tetapi bug meaning.

Contoh buruk:

```java
if (role.toLowerCase().equals("admin")) {
    grantAdminAccess();
}
```

Masalah:

- default locale dapat mempengaruhi lowercase;
- role seharusnya mungkin canonicalized saat masuk;
- authorization tidak boleh bergantung pada string bebas;
- enum atau value object mungkin lebih tepat;
- external role mapping perlu explicit contract.

Lebih baik:

```java
String normalizedRole = role.strip().toUpperCase(Locale.ROOT);

if ("ADMIN".equals(normalizedRole)) {
    grantAdminAccess();
}
```

Lebih kuat lagi dalam domain serius:

```java
enum RoleCode {
    ADMIN,
    CASE_OFFICER,
    SUPERVISOR
}
```

---

## 4.4 Root of Failure Model: `Throwable`

Semua exception dan error di Java berakar pada `Throwable`.

```text
Throwable
├── Error
└── Exception
    └── RuntimeException
```

`Throwable` menyimpan:

- message;
- cause;
- stack trace;
- suppressed exceptions;
- writable stack trace behavior;
- exception chaining.

Exception bukan hanya mekanisme “error handling”. Ia adalah bagian dari API contract.

Contoh:

```java
public CaseFile loadCase(CaseId caseId) throws CaseNotFoundException
```

Signature ini mengatakan:

```text
Operasi loadCase bisa gagal karena case tidak ditemukan,
dan caller dipaksa mempertimbangkannya.
```

Namun checked exception tidak selalu lebih baik. Untuk domain modern, sering lebih baik memakai:

```java
Optional<CaseFile> findCase(CaseId caseId)
```

atau:

```java
CaseFile requireCase(CaseId caseId)
```

Dengan behavior:

- `findCase`: absence expected;
- `requireCase`: absence exceptional;
- `loadCase`: external/environment/data access operation.

Engineer kuat memodelkan failure berdasarkan sifatnya:

| Failure Type | Contoh | Biasanya |
|---|---|---|
| Domain rejection | invalid transition | explicit domain result / domain exception |
| Absence expected | case not found in search | `Optional` / empty result |
| Programming error | null passed where forbidden | unchecked exception |
| Infrastructure failure | DB unavailable | checked/unchecked translated infra exception |
| JVM/runtime failure | OOM, linkage error | generally not recoverable locally |

---

## 4.5 Root of Runtime Access: `System`, `Runtime`, `Process`, `ProcessHandle`

`java.lang` memberi akses ke dunia luar runtime:

```java
System.currentTimeMillis();
System.nanoTime();
System.getenv("ENV");
System.getProperty("java.version");
Runtime.getRuntime().availableProcessors();
new ProcessBuilder("java", "-version").start();
ProcessHandle.current().pid();
```

Ini adalah OS/runtime boundary.

Kesalahan di area ini sering berdampak production:

- memakai wall-clock untuk duration;
- membaca env var secara scattered;
- command injection lewat `ProcessBuilder`;
- process deadlock karena stdout/stderr tidak dikonsumsi;
- shutdown hook menggantung;
- salah asumsi CPU di container;
- mengubah system properties saat runtime;
- test tidak isolated karena global state.

Mental model:

```text
System/Runtime/Process APIs are global boundary APIs.
Global boundary APIs require discipline.
```

Contoh buruk:

```java
long start = System.currentTimeMillis();
// work
long duration = System.currentTimeMillis() - start;
```

Lebih baik untuk elapsed time:

```java
long start = System.nanoTime();
// work
long durationNanos = System.nanoTime() - start;
```

`currentTimeMillis` bisa bergerak karena clock adjustment. `nanoTime` dimaksudkan untuk measuring elapsed time.

---

## 4.6 Root of Execution Carrier: `Thread`

`Thread` berada di `java.lang`, bukan `java.util.concurrent`, karena thread adalah konsep runtime dasar.

Modern Java punya abstraction lebih tinggi:

- `ExecutorService`;
- `CompletableFuture`;
- structured concurrency;
- virtual threads;
- reactive runtimes.

Namun `Thread` tetap penting karena banyak hal runtime melekat pada thread:

- name;
- daemon status;
- priority;
- interrupt flag;
- uncaught exception handler;
- context class loader;
- `ThreadLocal` map;
- stack trace;
- identity in logs;
- platform vs virtual thread behavior.

Contoh production-critical:

```java
private static final ThreadLocal<String> CURRENT_USER = new ThreadLocal<>();
```

Ini terlihat praktis, tetapi berbahaya jika tidak ada cleanup:

```java
try {
    CURRENT_USER.set(userId);
    processRequest();
} finally {
    CURRENT_USER.remove();
}
```

Jika lupa `remove()` pada thread pool, user context bisa bocor ke request berikutnya.

Di regulatory system, ini bisa menyebabkan:

- audit actor salah;
- authorization decision salah;
- tenant leakage;
- correlation ID kacau;
- log misleading.

---

## 4.7 Root of Language Metadata: `Enum`, `Record`, `Module`, Annotation Types

`java.lang` juga menjadi tempat representasi runtime beberapa fitur bahasa.

### Enum

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Semua enum extends `java.lang.Enum`.

Enum memberi:

- identity tetap per constant;
- type safety;
- `name()`;
- `ordinal()`;
- `valueOf`;
- natural ordering berdasarkan declaration order.

Namun `ordinal()` hampir tidak boleh dipakai sebagai persistence contract.

### Record

```java
record CaseId(String value) {
}
```

Record adalah class biasa dengan runtime contract khusus:

- extends `Object`;
- tidak bisa extends class lain;
- memiliki record components;
- generated canonical constructor;
- generated `equals`, `hashCode`, `toString`;
- dapat diinspeksi lewat `Class#isRecord` dan record component metadata.

### Module

Sejak Java 9, module adalah runtime concept yang direpresentasikan oleh `java.lang.Module`.

```java
Module module = String.class.getModule();
System.out.println(module.getName()); // java.base
```

Module bukan sekadar build metadata. Ia mempengaruhi:

- readability;
- exports;
- opens;
- reflection;
- service loading;
- runtime encapsulation;
- illegal access behavior.

### Annotations

Beberapa annotation language-level berada di `java.lang`:

```java
@Override
@Deprecated
@SuppressWarnings("unchecked")
@SafeVarargs
@FunctionalInterface
```

Ini bukan dekorasi. Ini kontrak dengan compiler, tooling, dan pembaca code.

---

## 5. Peta Besar Isi `java.lang`

Kita bisa mengelompokkan `java.lang` seperti berikut.

---

## 5.1 Object and Type Foundation

Representative types:

- `Object`
- `Class<T>`
- `ClassLoader`
- `Package`
- `Module`
- `ModuleLayer`
- `ClassValue<T>`
- `StackTraceElement`
- `StackWalker`

Pertanyaan desain:

- Apa identitas object ini?
- Apa tipe runtime-nya?
- Dari class loader mana ia datang?
- Module mana yang mendefinisikannya?
- Apakah reflection diperbolehkan?
- Apakah class metadata bisa di-cache dengan aman?
- Apakah stack trace bisa dipakai sebagai contract?

---

## 5.2 Text and Character Foundation

Representative types:

- `String`
- `StringBuilder`
- `StringBuffer`
- `CharSequence`
- `Character`
- `StringJoiner` is in `java.util`, but related conceptually

Pertanyaan desain:

- Apakah ini text, identifier, code, display label, atau serialized data?
- Apakah normalized?
- Apakah case-sensitive?
- Apakah locale-sensitive?
- Apakah user-provided?
- Apakah boleh disimpan/dilog?
- Apakah perlu streaming/builder?

---

## 5.3 Primitive Bridge and Value Wrappers

Representative types:

- `Boolean`
- `Byte`
- `Short`
- `Integer`
- `Long`
- `Float`
- `Double`
- `Character`
- `Void`
- `Number`

Pertanyaan desain:

- Apakah null valid?
- Apakah boxing terjadi di hot path?
- Apakah overflow mungkin?
- Apakah identity dibandingkan secara tidak sengaja?
- Apakah floating point valid untuk domain ini?
- Apakah wrapper dipakai untuk generics atau domain meaning?

---

## 5.4 Failure and Exception Foundation

Representative types:

- `Throwable`
- `Exception`
- `RuntimeException`
- `Error`
- `AssertionError`
- `OutOfMemoryError`
- `StackOverflowError`
- `LinkageError`
- `ClassNotFoundException`
- `NoClassDefFoundError`
- `InterruptedException`
- `IllegalArgumentException`
- `IllegalStateException`
- `NullPointerException`
- `UnsupportedOperationException`

Pertanyaan desain:

- Apakah failure ini expected atau exceptional?
- Apakah caller bisa recover?
- Apakah retry masuk akal?
- Apakah cause chain harus dipertahankan?
- Apakah stack trace mahal?
- Apakah exception type menjadi public API?

---

## 5.5 Runtime and Environment Foundation

Representative types:

- `System`
- `Runtime`
- `Process`
- `ProcessBuilder`
- `ProcessHandle`
- `Runtime.Version`
- `SecurityManager` legacy/deprecated path

Pertanyaan desain:

- Apakah code ini bergantung pada global state?
- Apakah property/env dibaca di satu tempat atau tersebar?
- Apakah time source benar?
- Apakah command execution aman?
- Apakah shutdown behavior deterministic?
- Apakah runtime version detection robust?

---

## 5.6 Execution and Context Foundation

Representative types:

- `Thread`
- `ThreadGroup` legacy
- `ThreadLocal<T>`
- `InheritableThreadLocal<T>`

Pertanyaan desain:

- Apakah context eksplisit atau tersembunyi?
- Apakah thread lifecycle dikelola langsung atau oleh executor/container?
- Apakah cleanup ThreadLocal terjamin?
- Apakah virtual thread mengubah asumsi?
- Apakah context class loader benar?

---

## 5.7 Language-Level Contracts

Representative types:

- `Enum<E>`
- `Record`
- `Deprecated`
- `Override`
- `SuppressWarnings`
- `SafeVarargs`
- `FunctionalInterface`

Pertanyaan desain:

- Apakah enum adalah closed set atau external code list?
- Apakah record hanya data carrier atau domain object?
- Apakah annotation ini compiler contract atau documentation saja?
- Apakah deprecation punya migration path?
- Apakah functional interface stabil untuk lambda users?

---

## 6. Java 8–25 Evolution Map untuk `java.lang`

Seri ini membahas Java 8 sampai 25, jadi kita perlu melihat evolution secara praktis.

Tujuannya bukan menghafal semua JEP, tetapi memahami perubahan yang mempengaruhi cara kita mendesain software.

---

## 6.1 Java 8 Baseline

Java 8 penting karena banyak enterprise system masih punya legacy compatibility terhadap Java 8.

Ciri penting:

- lambda dan functional interface sudah ada;
- default methods ada;
- `java.lang.FunctionalInterface` ada;
- `StringJoiner` ada di `java.util`;
- belum ada module system;
- belum ada `StackWalker`;
- belum ada `ProcessHandle`;
- belum ada record;
- belum ada sealed class;
- `SecurityManager` masih dianggap supported mechanism;
- internal JDK access masih lebih longgar dibanding post-Java 9;
- `String` internal masih berbeda dari compact strings modern.

Design consequence:

```text
Jika library harus support Java 8, jangan pakai API Java 9+ secara direct
kecuali lewat multi-release JAR, reflection guarded access, atau build variant.
```

---

## 6.2 Java 9: Module System and Runtime Image Shift

Java 9 membawa perubahan besar:

- JPMS/module system;
- `java.base` sebagai foundational module;
- `java.lang.Module`;
- `ModuleLayer`;
- stronger encapsulation direction;
- `StackWalker`;
- `ProcessHandle`;
- compact strings implementation;
- version string scheme modern;
- jshell and runtime image changes.

Design consequence:

```text
Code yang dulu bebas reflective access ke JDK internals mulai rapuh.
Framework dan library harus sadar module readability/exports/opens.
```

Contoh:

```java
Module module = SomeClass.class.getModule();
System.out.println(module.getName());
```

Ini tidak ada di Java 8.

---

## 6.3 Java 10–11: Modern Baseline Begins

Java 11 menjadi LTS yang sangat luas dipakai.

Area relevan:

- local-variable type inference `var` adalah language feature, bukan `java.lang` API;
- `String` mendapat API modern seperti `isBlank`, `lines`, `strip`, `repeat`;
- launch/run behavior makin modern;
- Java 11 sering menjadi migration target dari Java 8.

Design consequence:

```text
Untuk enterprise library modern, Java 11 sering menjadi minimum yang masuk akal,
tetapi Java 8 compatibility masih memerlukan disiplin API.
```

---

## 6.4 Java 12–17: Records, Sealed Types, Helpful NPE, Stronger Encapsulation

Area relevan:

- helpful NullPointerException;
- records akhirnya final/stable di Java 16;
- sealed classes final/stable di Java 17;
- stronger encapsulation of JDK internals;
- Java 17 menjadi LTS besar.

Design consequence:

```text
Records dan sealed types mengubah cara kita memodelkan DTO, commands,
events, algebraic domain models, dan state machines.
```

Contoh:

```java
sealed interface Decision permits Approved, Rejected, NeedMoreInfo {
}

record Approved(String approver) implements Decision {
}

record Rejected(String reason) implements Decision {
}

record NeedMoreInfo(String request) implements Decision {
}
```

Ini memberi closed hierarchy yang jauh lebih kuat daripada stringly typed status.

---

## 6.5 Java 18–21: UTF-8 Default, Virtual Threads, Sequenced APIs Nearby

Area relevan ke seri ini:

- default charset menjadi UTF-8 sejak Java 18;
- virtual threads final di Java 21;
- `Thread` API harus dipahami ulang dalam konteks virtual threads;
- structured concurrency masih mengalami proses preview/incubator di beberapa versi;
- Java 21 menjadi LTS penting.

Design consequence:

```text
Code yang bergantung pada default charset host lama harus diperiksa.
Code yang memakai ThreadLocal/context propagation harus dievaluasi ulang
pada virtual-thread-heavy application.
```

---

## 6.6 Java 22–25: Modern Runtime, Preview Features, Compatibility Discipline

Java 22–25 membawa banyak feature modern dan preview di area language/runtime.

Untuk seri ini, prinsipnya:

- kita bahas API stabil yang relevan;
- preview feature hanya disentuh jika mempengaruhi mental model;
- Java 25 diperlakukan sebagai upper bound seri;
- Java 8 tetap diperlakukan sebagai lower bound compatibility.

Design consequence:

```text
Engineer senior tidak hanya bertanya “bisa dipakai di Java terbaru?”
Tapi juga “apakah runtime target, compiler target, library consumer,
dan deployment image mendukung API ini?”
```

---

## 7. `java.lang` dan Compiler: Banyak API Mewakili Syntax

Beberapa class `java.lang` sangat dekat dengan Java syntax.

| Syntax / Concept | Runtime/API Representation |
|---|---|
| string literal | `java.lang.String` |
| class literal `X.class` | `java.lang.Class<X>` |
| every object | `java.lang.Object` |
| `throw` / `catch` | `java.lang.Throwable` hierarchy |
| enum declaration | subclass of `java.lang.Enum` |
| record declaration | subclass of `java.lang.Record` |
| annotation declaration/use | annotation interfaces + `java.lang.annotation` support |
| module declaration | `java.lang.Module` runtime object |
| lambda target | functional interface, often marked with `@FunctionalInterface` |
| synchronized block | monitor associated with `Object` |
| try-with-resources | `AutoCloseable` in `java.lang` |
| `assert` | `AssertionError` |

Ini berarti ketika kamu membaca Java source, sering ada `java.lang` contract yang bekerja di belakang layar.

Contoh:

```java
try (Resource r = open()) {
    r.use();
}
```

Ini bergantung pada:

```java
interface AutoCloseable {
    void close() throws Exception;
}
```

Compiler mengubah try-with-resources menjadi logic yang menjaga suppressed exceptions.

Jadi `AutoCloseable` bukan sekadar interface biasa. Ia bagian dari language desugaring contract.

---

## 8. `java.lang` dan JVM: Runtime Meaning di Balik API

Banyak API `java.lang` merupakan permukaan dari behavior JVM.

---

## 8.1 `getClass()` dan Runtime Type

```java
Object value = "abc";
System.out.println(value.getClass().getName());
```

Output:

```text
java.lang.String
```

Source-level type variable adalah `Object`, tetapi runtime object punya exact class.

Ini fundamental untuk:

- dynamic dispatch;
- serialization;
- reflection;
- debugging;
- class loader issues;
- proxy framework;
- polymorphism.

---

## 8.2 `synchronized` dan Object Monitor

```java
synchronized (lock) {
    // critical section
}
```

`lock` adalah object. Monitor melekat pada object.

Itu alasan `Object` punya:

```java
wait()
notify()
notifyAll()
```

Walaupun modern Java lebih sering memakai `java.util.concurrent`, object monitor tetap menjadi primitive runtime.

---

## 8.3 `Throwable` dan Stack Unwinding

```java
throw new IllegalStateException("Invalid state");
```

Ketika exception dilempar, JVM melakukan stack unwinding sampai menemukan handler yang cocok.

`Throwable` object membawa stack trace dan cause chain. Ini menjadi diagnostic artifact utama di production.

---

## 8.4 Class Loading and Linkage Errors

```java
Class.forName("com.example.Plugin")
```

Ini bukan hanya lookup string. Ini bisa menyebabkan:

- class loading;
- linking;
- initialization;
- failure seperti `ClassNotFoundException`, `NoClassDefFoundError`, `ExceptionInInitializerError`, `LinkageError`.

Perbedaan error ini penting untuk production diagnosis.

---

## 9. `java.lang` dan Framework Internals

Framework enterprise yang kamu pakai hampir pasti heavily dependent pada `java.lang`.

---

## 9.1 Dependency Injection

DI container perlu:

- `Class<?>` untuk bean type;
- annotation metadata;
- class loader;
- constructor/method metadata;
- exception wrapping;
- module access;
- generic type handling outside `java.lang` but rooted in `Class`.

Simplified registry:

```java
final class SimpleContainer {
    private final Map<Class<?>, Object> beans = new HashMap<>();

    public <T> void register(Class<T> type, T instance) {
        beans.put(type, type.cast(instance));
    }

    public <T> T get(Class<T> type) {
        Object value = beans.get(type);
        if (value == null) {
            throw new IllegalStateException("No bean registered for " + type.getName());
        }
        return type.cast(value);
    }
}
```

Di balik Spring/CDI, konsep dasarnya jauh lebih kompleks, tetapi root-nya tetap `Class`, `Object`, `Throwable`, annotation, class loader, dan module access.

---

## 9.2 Serialization/Mapping

Mapper butuh:

- object type;
- field/property metadata;
- record component metadata;
- enum constants;
- string conversion;
- numeric wrapper conversion;
- exception taxonomy;
- class loader boundary.

Contoh problem:

```java
enum Status {
    OPEN,
    CLOSED
}
```

Jika external API mengirim:

```json
{"status":"PENDING"}
```

`Enum.valueOf(Status.class, "PENDING")` akan melempar `IllegalArgumentException`.

Pertanyaannya bukan hanya “catch exception atau tidak”, tetapi:

```text
Apakah unknown external enum adalah invalid input, forward-compatible value,
atau domain state baru yang perlu treatment khusus?
```

---

## 9.3 ORM and Entity Identity

ORM sangat sensitif terhadap `Object#equals` dan `hashCode`.

Contoh naive:

```java
class CaseEntity {
    Long id;

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof CaseEntity other)) return false;
        return Objects.equals(id, other.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

Problem:

- sebelum persisted, `id == null`;
- setelah persisted, hash berubah;
- proxy subclass dapat mengganggu equality;
- entity lifecycle mempengaruhi collection behavior.

Root-nya tetap `Object` contract.

---

## 9.4 Logging and Observability

Logging memakai:

- `Throwable` stack trace;
- `Thread` name;
- `System` time/environment;
- `String` formatting;
- `Class` logger category;
- stack walking untuk caller location;
- `ThreadLocal` untuk MDC/correlation ID.

Jika salah, log bisa:

- mahal;
- misleading;
- bocor data sensitif;
- kehilangan cause;
- mengandung wrong actor/correlation;
- tidak berguna untuk incident response.

---

## 10. `java.lang` sebagai Contract Boundary dalam Arsitektur

Untuk sistem besar, `java.lang` sering menjadi bagian dari boundary design.

---

## 10.1 Boundary: Identity

Pertanyaan:

```text
Apakah dua object mewakili entity/value yang sama?
```

API terkait:

- `Object#equals`;
- `Object#hashCode`;
- `System.identityHashCode`;
- `Class#getName`;
- enum identity;
- record equality.

Example decision:

```java
record CaseReference(String value) {
    public CaseReference {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Case reference is required");
        }
        value = value.strip().toUpperCase(Locale.ROOT);
    }
}
```

Dengan record, equality menjadi value-based berdasarkan canonical value.

---

## 10.2 Boundary: Type

Pertanyaan:

```text
Apakah operasi ini menerima subtype, exact type, atau closed set?
```

API terkait:

- `Class#isInstance`;
- `Class#isAssignableFrom`;
- `Class#cast`;
- `Enum`;
- sealed class metadata;
- record metadata.

---

## 10.3 Boundary: Failure

Pertanyaan:

```text
Bagaimana caller tahu operasi ini gagal, dan apa yang bisa dilakukan?
```

API terkait:

- `Throwable`;
- checked exceptions;
- unchecked exceptions;
- `Error`;
- suppressed exceptions;
- cause chain;
- `InterruptedException`.

---

## 10.4 Boundary: Runtime Environment

Pertanyaan:

```text
Apa dependency aplikasi terhadap environment?
```

API terkait:

- `System.getenv`;
- `System.getProperty`;
- `Runtime.Version`;
- `Runtime`;
- `ProcessHandle`;
- `Thread`;
- `ClassLoader`;
- `Module`.

---

## 10.5 Boundary: Text/Data Interchange

Pertanyaan:

```text
Apakah string ini adalah user text, machine code, serialized payload,
identifier, XML name, atau display label?
```

API terkait:

- `String`;
- `CharSequence`;
- `Character`;
- numeric wrappers;
- DOM/SAX later;
- exception messages;
- system properties.

---

## 11. Important Mental Models

---

## 11.1 “Small API, Large Consequence” Model

Banyak method `java.lang` terlihat kecil, tetapi konsekuensinya besar.

Contoh:

```java
public int hashCode()
```

Salah implementasi bisa merusak:

- `HashMap`;
- `HashSet`;
- cache;
- distributed dedup;
- idempotency;
- workflow correlation.

Contoh:

```java
public String toString()
```

Salah implementasi bisa:

- membocorkan PII;
- men-trigger lazy loading;
- membuat log terlalu besar;
- menyebabkan recursive output;
- menyembunyikan diagnostic penting.

Contoh:

```java
ThreadLocal.remove()
```

Lupa satu call bisa menyebabkan cross-request contamination.

---

## 11.2 “Contract vs Convenience” Model

Banyak engineer memakai API karena convenient. Engineer kuat bertanya apakah API itu contract yang tepat.

Contoh:

```java
String status = "APPROVED";
```

Convenient, tetapi tidak selalu contract yang tepat.

Alternatif:

```java
enum CaseStatus {
    APPROVED,
    REJECTED
}
```

Atau jika external code list dinamis:

```java
record CaseStatusCode(String value) {
}
```

Enum cocok untuk closed set internal. String/value object cocok untuk external/dynamic codes.

---

## 11.3 “Global State Requires Governance” Model

`System`, `Runtime`, default locale, default charset, default timezone, system properties, environment, class loader, and thread context are global-ish concerns.

Global state harus:

- dibaca di boundary;
- dibungkus dalam abstraction;
- dites dengan isolation;
- tidak dimutasi sembarangan;
- dicatat dalam deployment contract.

Buruk:

```java
class PaymentRule {
    private static final String COUNTRY = System.getenv("COUNTRY");
}
```

Masalah:

- dibaca saat class initialization;
- sulit dites;
- tidak jelas config source;
- perubahan env tidak terbaca;
- error tidak eksplisit jika missing.

Lebih baik:

```java
record RuntimeConfig(String country) {
    static RuntimeConfig fromEnvironment(Map<String, String> env) {
        String country = env.get("COUNTRY");
        if (country == null || country.isBlank()) {
            throw new IllegalStateException("COUNTRY environment variable is required");
        }
        return new RuntimeConfig(country);
    }
}
```

---

## 11.4 “Runtime Type Is Not Domain Type” Model

`Class<?>` memberi runtime type, bukan otomatis domain meaning.

Contoh:

```java
if (event.getClass() == ApprovedEvent.class) {
    // runtime type check
}
```

Ini mungkin benar untuk dispatcher internal, tetapi buruk jika dipakai sebagai domain rule yang seharusnya bergantung pada explicit event type/code.

Domain type harus deliberate.

```java
sealed interface CaseEvent permits ApplicationSubmitted, DecisionMade {
    CaseId caseId();
}
```

Ini lebih kuat karena domain model dibatasi secara language/runtime, bukan string/class-name guessing.

---

## 11.5 “Diagnostic Surface Is Part of System Design” Model

`Throwable`, `String`, `Class`, `Thread`, `StackTraceElement`, and `System` membentuk diagnostic surface.

Production diagnostic yang baik butuh:

- exception type jelas;
- message actionable;
- cause chain preserved;
- correlation ID benar;
- thread name useful;
- class/module info bila relevan;
- sensitive data tidak bocor;
- stack trace tidak hilang;
- suppressed exceptions tidak diabaikan.

Buruk:

```java
catch (Exception e) {
    throw new RuntimeException("Failed");
}
```

Lebih baik:

```java
catch (IOException e) {
    throw new CaseDocumentReadException(
        "Failed to read case document: documentId=" + safeDocumentId,
        e
    );
}
```

Tetap hati-hati: jangan memasukkan PII/secret ke message.

---

## 12. API Reading Discipline untuk `java.lang`

Untuk part-part berikutnya, cara membaca API harus lebih serius daripada sekadar melihat method list.

Gunakan checklist ini.

---

## 12.1 Baca Class-Level Contract

Contoh ketika membaca `String`:

Jangan langsung cari method `substring`. Baca dulu:

- apakah class immutable?
- apakah final?
- apakah thread-safe?
- apakah ada special treatment oleh language/compiler?
- apakah ada serialization behavior?
- apakah ada relation dengan Unicode?

---

## 12.2 Baca Method Contract, Bukan Nama Method

Contoh:

```java
String.trim()
String.strip()
```

Keduanya terlihat mirip, tetapi tidak identik. `strip` Unicode-aware whitespace; `trim` historically based on code points <= U+0020.

Nama method tidak cukup.

---

## 12.3 Cari “Since”, “Deprecated”, “forRemoval”

Untuk Java 8–25, penting mengetahui:

- API ini ada sejak kapan?
- Apakah deprecated?
- Apakah for removal?
- Apa replacement-nya?
- Apakah bisa dipakai jika target runtime Java 8?

Contoh area penting:

- `finalize()` deprecated/legacy;
- `SecurityManager` deprecated for removal path;
- some Thread methods legacy/deprecated;
- primitive wrapper constructors deprecated;
- SAX1 APIs deprecated.

---

## 12.4 Bedakan API Spec dan Implementation Note

API spec adalah contract.

Implementation note adalah informasi implementasi yang boleh membantu pemahaman, tetapi tidak boleh menjadi dasar correctness business logic.

Contoh:

- `String` immutable adalah API contract;
- compact string internal adalah implementation detail;
- `HashMap` collision strategy bukan bagian `java.lang`, tetapi contoh serupa: jangan bergantung pada internal bucket structure.

---

## 12.5 Baca Exception Behavior

Method contract sering menjelaskan exception.

Pertanyaan:

- exception apa yang dilempar?
- checked atau unchecked?
- kapan null menyebabkan NPE?
- apakah method menerima null?
- apakah failure deterministik?
- apakah failure bergantung pada security/module/class loader?

---

## 12.6 Baca Thread-Safety and Mutability

Untuk setiap type:

- immutable?
- mutable?
- thread-safe?
- synchronized?
- value-based?
- identity-sensitive?
- safe to cache?
- safe to expose?

Contoh:

- `String`: immutable;
- `StringBuilder`: mutable, not synchronized;
- `StringBuffer`: synchronized legacy;
- `Throwable`: mutable stack/cause/suppressed state;
- `System` properties: global mutable;
- `Class`: runtime metadata object, generally stable;
- `ThreadLocal`: per-thread mutable storage.

---

## 13. Relevansi terhadap DOM dan SAX

Walaupun part ini fokus `java.lang`, seri ini juga akan membahas DOM dan SAX. Fondasi `java.lang` penting karena DOM/SAX banyak bergantung pada konsep-konsep ini.

---

## 13.1 DOM Sangat Bergantung pada `Object`, `String`, dan Exceptions

DOM API memakai banyak `String`:

- element name;
- namespace URI;
- prefix;
- local name;
- attribute value;
- text content.

DOM juga punya object identity:

- satu `Node` bisa punya parent;
- node punya owner document;
- import/adopt mengubah ownership;
- `NodeList` bisa live.

DOM exception model memakai runtime exceptions seperti `DOMException`, bukan checked exception untuk semua kasus.

Jadi memahami `Object`, `String`, identity, mutability, dan exception design membantu membaca DOM.

---

## 13.2 SAX Sangat Bergantung pada `String`, `ClassLoader`, `Throwable`, dan State

SAX event callback memakai banyak `String`:

```java
startElement(String uri, String localName, String qName, Attributes attributes)
characters(char[] ch, int start, int length)
```

SAX parsing juga sangat terkait dengan:

- parser configuration;
- feature strings;
- property strings;
- exceptions;
- handler object state;
- class loader/provider discovery;
- secure processing configuration.

Jika kamu salah memahami string identity, namespace, exception propagation, atau mutable handler state, SAX parser akan terlihat “aneh”.

---

## 14. Top-Tier Engineering Perspective

Top 1% bukan berarti hafal semua method `java.lang`. Yang lebih penting:

```text
Mampu memetakan API dasar ke konsekuensi sistem.
```

Berikut perspektif yang akan dipakai sepanjang seri.

---

## 14.1 API as Contract, Not Convenience

Misalnya, `equals` bukan method “untuk membandingkan”. Ia adalah contract untuk seluruh ekosistem collection, cache, deduplication, dan domain identity.

---

## 14.2 Runtime as a Boundary

`System`, `Runtime`, `ClassLoader`, `Module`, `Thread`, dan `Process` adalah boundary ke runtime dan OS.

Boundary harus eksplisit, tidak tersebar sembarangan.

---

## 14.3 Failure Is a First-Class Design Axis

Exception hierarchy harus dirancang seperti domain/API surface, bukan hasil spontan dari catch block.

---

## 14.4 Text Is Not Trivial

`String` sering menjadi sumber bug security, interoperability, dan regulatory audit karena dianggap “cuma text”.

---

## 14.5 Compatibility Is a Product Constraint

Java 8–25 bukan hanya daftar versi. Ini constraint terhadap:

- source compatibility;
- binary compatibility;
- runtime compatibility;
- module compatibility;
- library ecosystem;
- deployment image;
- tooling;
- reflection;
- security defaults.

---

## 15. Common Failure Modes Karena Salah Memahami `java.lang`

---

## 15.1 Broken Equality

```java
class UserId {
    String value;
}
```

Dipakai sebagai key:

```java
Map<UserId, User> users = new HashMap<>();
```

Tanpa `equals/hashCode`, lookup logical akan gagal.

---

## 15.2 Mutable Hash Key

```java
class Key {
    String value;

    @Override
    public boolean equals(Object o) { /* based on value */ }
    @Override
    public int hashCode() { return value.hashCode(); }
}

Key key = new Key("A");
map.put(key, "value");
key.value = "B";
map.get(key); // likely fails
```

---

## 15.3 Incorrect Runtime Type Check

```java
if (Base.class.isAssignableFrom(value.getClass())) {
}
```

Ini benar, tetapi lebih readable:

```java
if (value instanceof Base) {
}
```

Atau dynamic:

```java
if (Base.class.isInstance(value)) {
}
```

Bug arah umum:

```java
if (value.getClass().isAssignableFrom(Base.class)) {
    // often wrong direction
}
```

---

## 15.4 Lost Exception Cause

```java
catch (SQLException e) {
    throw new RuntimeException("DB failed");
}
```

Cause hilang.

Lebih baik:

```java
catch (SQLException e) {
    throw new RepositoryException("DB failed while loading case", e);
}
```

---

## 15.5 ThreadLocal Leak

```java
CURRENT_USER.set(user);
service.handle();
// missing remove
```

Pada thread pool, context bisa bocor.

---

## 15.6 Wall-Clock Duration Bug

```java
long duration = System.currentTimeMillis() - start;
```

Jika system clock berubah, duration bisa salah.

---

## 15.7 Stringly Typed Domain

```java
if (status.equals("APPROVED")) {
}
```

Masalah:

- typo;
- no exhaustiveness;
- no type safety;
- external/internal status tercampur;
- refactoring lemah.

---

## 15.8 Enum Ordinal Persistence

```java
status.ordinal()
```

Jika urutan enum berubah, data lama rusak.

Gunakan explicit code.

```java
enum CaseStatus {
    APPROVED("APP"),
    REJECTED("REJ");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

---

## 15.9 ClassLoader Identity Surprise

Dua class dengan nama sama dari class loader berbeda bukan class yang sama.

```text
com.example.Plugin loaded by LoaderA ≠ com.example.Plugin loaded by LoaderB
```

Ini bisa menyebabkan `ClassCastException` yang tampak tidak masuk akal.

---

## 15.10 Using Implementation Detail as Contract

Contoh:

- bergantung pada internal `String` field;
- mengandalkan lambda generated class name;
- mengandalkan stack trace exact shape;
- mengakses internal JDK packages;
- bergantung pada parser implementation behavior.

---

## 16. Production Checklist untuk `java.lang` Awareness

Gunakan checklist ini saat review code.

### Identity and Equality

- Apakah class yang dipakai sebagai key punya `equals/hashCode` benar?
- Apakah key immutable?
- Apakah equality exact-class atau polymorphic?
- Apakah proxy/framework mempengaruhi equality?
- Apakah record cocok?

### Type Boundary

- Apakah runtime type check memakai `instanceof`, `isInstance`, atau exact class dengan alasan jelas?
- Apakah class loader boundary diperhitungkan?
- Apakah module access mempengaruhi reflection?
- Apakah generic erasure menyebabkan blind spot?

### String/Text

- Apakah string ini identifier atau display text?
- Apakah canonicalization dilakukan di boundary?
- Apakah locale dipilih eksplisit?
- Apakah Unicode behavior dipahami?
- Apakah data sensitif tidak masuk log?

### Failure

- Apakah exception type meaningful?
- Apakah cause dipertahankan?
- Apakah checked/unchecked dipilih sadar?
- Apakah `InterruptedException` ditangani benar?
- Apakah `Error` tidak ditelan sembarangan?

### Runtime/Global State

- Apakah env/properties dibaca terpusat?
- Apakah time source benar?
- Apakah process execution aman?
- Apakah shutdown hook sederhana dan bounded?
- Apakah system property mutation dikontrol?

### Thread/Context

- Apakah ThreadLocal dibersihkan?
- Apakah context propagation eksplisit?
- Apakah thread name berguna?
- Apakah virtual thread assumptions dicek?
- Apakah context class loader relevan?

### Compatibility

- Apakah API tersedia di target Java minimum?
- Apakah deprecated/forRemoval API dihindari?
- Apakah Java 8 behavior berbeda dari Java 17/21/25?
- Apakah module encapsulation mempengaruhi runtime?
- Apakah library perlu multi-release strategy?

---

## 17. Thought Exercises

### Exercise 1 — Exact Type vs Assignable Type

Kamu membuat plugin registry:

```java
interface Plugin {
    void run();
}

final class ImportPlugin implements Plugin {
    public void run() {}
}
```

Registry menerima class plugin.

Pertanyaan:

1. Kapan kamu memakai `Plugin.class.isAssignableFrom(candidate)`?
2. Kapan kamu memakai `candidate == ImportPlugin.class`?
3. Apa risiko jika plugin class berasal dari class loader berbeda?
4. Apa dampak JPMS module exports/opens terhadap plugin discovery?

---

### Exercise 2 — Status Modelling

Kamu punya external API yang mengirim status:

```json
{"status":"UNDER_REVIEW"}
```

Pertanyaan:

1. Apakah status sebaiknya langsung di-map ke enum?
2. Apa yang terjadi jika external system menambah status baru?
3. Apakah internal workflow state sama dengan external status code?
4. Bagaimana kamu mencegah stringly typed rules tersebar?

---

### Exercise 3 — Exception Boundary

Repository method:

```java
CaseFile getCase(String caseId)
```

Pertanyaan:

1. Apa behavior jika case tidak ditemukan?
2. Apakah return `null`, `Optional`, checked exception, atau runtime exception?
3. Bagaimana jika database down?
4. Apa exception message yang aman dan actionable?

---

### Exercise 4 — Runtime Config

Aplikasi membaca:

```java
System.getenv("REGION")
System.getenv("DB_URL")
System.getProperty("app.mode")
```

Pertanyaan:

1. Apakah boleh dibaca langsung dari mana saja?
2. Bagaimana test isolation dilakukan?
3. Bagaimana missing/invalid config dilaporkan?
4. Apakah config dibaca saat startup atau lazy?

---

### Exercise 5 — XML Preview Relevance

Nanti saat membaca DOM/SAX, kamu akan melihat banyak `String` untuk names dan namespaces.

Pertanyaan:

1. Mengapa `qName` tidak boleh selalu dianggap sama dengan local name?
2. Mengapa namespace URI lebih reliable daripada prefix?
3. Bagaimana `String` canonicalization bisa membantu atau justru merusak XML namespace semantics?

---

## 18. Ringkasan

`java.lang` adalah root contract Java Platform karena ia menyentuh hampir semua area fundamental:

- object identity melalui `Object`;
- runtime type melalui `Class`;
- text melalui `String`;
- failure melalui `Throwable`;
- runtime boundary melalui `System`, `Runtime`, `Process`, `ProcessHandle`;
- execution carrier melalui `Thread` dan `ThreadLocal`;
- language-level metadata melalui `Enum`, `Record`, `Module`, dan annotations;
- compatibility boundary melalui Java 8–25 API evolution.

Cara berpikir yang harus dibawa ke part berikutnya:

```text
java.lang is not a convenience package.
It is the visible surface of Java's object, type, failure, text,
runtime, and language contracts.
```

Kalau kamu memahami `java.lang` dengan benar, kamu akan lebih kuat dalam:

- framework debugging;
- API design;
- domain modelling;
- production incident analysis;
- migration Java 8 → 17/21/25;
- XML parsing design;
- security hardening;
- compatibility reasoning;
- performance and memory diagnosis.

---

## 19. Referensi Resmi untuk Part Ini

- Java SE 25 API — Module `java.base`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/module-summary.html`
- Java SE 25 API — Package `java.lang`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/package-summary.html`
- Java SE 25 API — Class `Module`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Module.html`
- Java SE 25 API — Package `org.w3c.dom`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.xml/org/w3c/dom/package-summary.html`
- Java SE 25 API — Package `org.xml.sax`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.xml/org/xml/sax/package-summary.html`
- OpenJDK JDK 25 Project: `https://openjdk.org/projects/jdk/25/`

---

## 20. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

- Part 0 — Orientation: Why `java.lang`, DOM, and SAX Still Matter in Modern Java
- Part 1 — `java.lang` as the Root Contract of the Java Platform

Part berikutnya:

- Part 2 — `Object`: Identity, Equality, Hashing, Monitor, Lifecycle

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 0 — Orientation: Why `java.lang`, DOM, and SAX Still Matter in Modern Java](./00-orientation-java-lang-dom-sax-core-runtime-platform-contracts.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 2 — `Object`: Identity, Equality, Hashing, Monitor, Lifecycle](./02-object-identity-equality-hashing-monitor-lifecycle.md)

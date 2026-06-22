# Learn Java Part 006 — Functional Programming di Java

> Target: Java hingga versi 25  
> Audiens: software engineer yang ingin memahami Java secara mendalam, bukan sekadar bisa memakai syntax  
> Fokus: lambda, functional interface, method reference, Stream API, collector, parallel stream, Stream Gatherers, correctness, performance, dan desain API

---

## 0. Posisi Bagian Ini dalam Roadmap

Pada bagian sebelumnya kita sudah membahas:

1. orientasi Java sebagai bahasa, platform, runtime, dan ekosistem;
2. toolchain dan cara source code menjadi artifact/runtime process;
3. fondasi syntax dan semantics;
4. object model;
5. type system dan generics;
6. modern Java language features.

Bagian ini membahas **functional programming di Java**.

Namun perlu diluruskan sejak awal: Java bukan bahasa functional murni. Java tetap berakar kuat pada:

- object identity;
- mutability;
- nominal typing;
- class/interface;
- heap allocation;
- exception model;
- imperative control flow;
- runtime polymorphism.

Functional programming di Java adalah **tambahan model ekspresi** untuk memodelkan *behavior as value* dan pipeline transformasi data. Jadi tujuan kita bukan mengubah Java menjadi Haskell, Scala, atau Clojure, tetapi memahami bagaimana fitur functional Java bisa dipakai secara aman dalam bahasa yang tetap object-oriented dan runtime-oriented.

Mental model utama bagian ini:

```text
Functional Java = object-oriented Java + behavior sebagai value + declarative data processing
```

Kalau salah dipahami, functional style di Java bisa menghasilkan kode yang:

- terlihat ringkas tetapi sulit di-debug;
- terlihat declarative tetapi menyimpan side effect tersembunyi;
- terlihat parallel tetapi lebih lambat;
- terlihat immutable tetapi ternyata memutasi state luar;
- terlihat type-safe tetapi gagal karena generic/wildcard/raw type;
- terlihat elegan tetapi buruk untuk observability dan incident analysis.

Engineer kuat tidak memakai lambda/stream karena “modern”, tetapi karena ia tahu kapan abstraction ini memperjelas invariant, kapan menurunkan noise, kapan menambah biaya, dan kapan harus kembali ke loop biasa.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. menjelaskan apa itu lambda di Java dari sisi syntax, type system, runtime, dan desain API;
2. memahami functional interface sebagai **target type** untuk lambda dan method reference;
3. membedakan `Function`, `Consumer`, `Supplier`, `Predicate`, `UnaryOperator`, dan `BinaryOperator` secara konseptual;
4. mendesain custom functional interface yang tepat, bukan asal membuat `Function<A, B>` di semua tempat;
5. memahami method reference: static, bound instance, unbound instance, constructor, dan array constructor reference;
6. memahami Stream API sebagai pipeline lazy, single-use, source-driven, dan terminal-triggered;
7. membedakan intermediate operation, terminal operation, stateless operation, stateful operation, short-circuiting operation, ordered/unordered operation;
8. memahami `map`, `filter`, `flatMap`, `reduce`, `collect`, `groupingBy`, `partitioningBy`, `toMap`, dan custom collector;
9. memahami kenapa stream behavioral parameter harus non-interfering dan umumnya stateless;
10. memahami kapan parallel stream membantu dan kapan justru merusak correctness/performance;
11. memahami Stream Gatherers sebagai extension point untuk custom intermediate operations sejak Java 24 dan tersedia di Java 25;
12. membangun mental model production: debugging, logging, observability, allocation, boxing, exception handling, dan failure mode.

---

## 2. Peta Besar Functional Programming di Java

Functional programming di Java terdiri dari beberapa lapisan:

```text
Language level:
  lambda expression
  method reference
  target typing
  effectively final capture

Type level:
  functional interface
  single abstract method
  generic functional shape
  primitive specialization

Library level:
  java.util.function
  java.util.stream
  Optional
  Collector
  Gatherer

Runtime level:
  invokedynamic
  lambda metafactory
  object allocation / reuse
  JIT inlining
  escape analysis

Design level:
  behavior parameterization
  declarative transformation
  pipeline semantics
  side-effect control
  composable policies
```

Yang sering salah: engineer hanya belajar `list.stream().map(...).filter(...).toList()` lalu merasa sudah paham functional Java.

Padahal inti sebenarnya adalah:

```text
Kita bisa mengirim behavior sebagai argument, menyimpan behavior sebagai value,
menyusun behavior menjadi pipeline, lalu mengeksekusinya di boundary yang jelas.
```

Contoh:

```java
record CaseRecord(String id, CaseStatus status, int severity) {}

enum CaseStatus {
    OPEN, UNDER_REVIEW, ESCALATED, CLOSED
}

Predicate<CaseRecord> highSeverity = c -> c.severity() >= 8;
Predicate<CaseRecord> stillActive = c -> c.status() != CaseStatus.CLOSED;

List<CaseRecord> candidates = cases.stream()
        .filter(stillActive)
        .filter(highSeverity)
        .toList();
```

Kode di atas bukan hanya “lebih pendek”. Ia memisahkan:

- data: `CaseRecord`;
- predicate/policy: `highSeverity`, `stillActive`;
- pipeline: proses pemilihan;
- result: daftar kandidat.

Dengan desain yang benar, ini membuat business rule lebih eksplisit.

Dengan desain yang salah, predicate bisa menjadi anonymous business logic tersebar di mana-mana.

---

## 3. Lambda Expression

### 3.1 Apa Itu Lambda?

Lambda expression adalah expression yang mendeskripsikan implementasi dari satu method abstrak pada functional interface.

Contoh:

```java
Predicate<String> nonBlank = s -> !s.isBlank();
```

`Predicate<String>` memiliki satu abstract method:

```java
boolean test(String value);
```

Lambda:

```java
s -> !s.isBlank()
```

adalah implementasi untuk method tersebut.

Secara konseptual:

```text
Lambda = expression yang menghasilkan instance dari functional interface tertentu
```

Bukan:

```text
Lambda = function bebas seperti di bahasa functional murni
```

Di Java, lambda selalu butuh target type.

Ini valid:

```java
Predicate<String> p = s -> s.length() > 5;
```

Ini tidak valid:

```java
var x = s -> s.length() > 5; // compile error
```

Kenapa?

Karena compiler tidak tahu `s` itu apa dan lambda ini harus menjadi functional interface yang mana.

Lambda di Java adalah **poly expression**: tipenya tergantung konteks.

---

### 3.2 Target Typing

Lambda mendapat tipe dari konteks. Konteks umum:

#### Assignment context

```java
Predicate<String> p = s -> s.isBlank();
```

#### Method invocation context

```java
List<String> names = List.of("alice", "", "bob");

List<String> result = names.stream()
        .filter(s -> !s.isBlank())
        .toList();
```

`filter` mengharapkan `Predicate<? super T>`, maka lambda disesuaikan ke predicate.

#### Cast context

```java
Object x = (Predicate<String>) s -> s.length() > 3;
```

Jarang perlu, tetapi kadang berguna saat overload ambiguous.

---

### 3.3 Bentuk Syntax Lambda

#### Satu parameter, expression body

```java
Predicate<String> p = s -> s.length() > 3;
```

#### Satu parameter dengan tipe eksplisit

```java
Predicate<String> p = (String s) -> s.length() > 3;
```

#### Banyak parameter

```java
BiFunction<Integer, Integer, Integer> add = (a, b) -> a + b;
```

#### Tanpa parameter

```java
Supplier<Long> now = () -> System.currentTimeMillis();
```

#### Block body

```java
Function<String, Integer> parse = s -> {
    String trimmed = s.trim();
    return Integer.parseInt(trimmed);
};
```

#### Void-compatible body

```java
Consumer<String> printer = s -> System.out.println(s);
```

#### Statement expression body

```java
Consumer<String> printer = System.out::println;
```

---

### 3.4 Lambda Body: Expression vs Block

Expression body:

```java
Function<Integer, Integer> square = x -> x * x;
```

Block body:

```java
Function<Integer, Integer> square = x -> {
    int result = x * x;
    return result;
};
```

Rule praktis:

- gunakan expression body untuk transformasi singkat dan jelas;
- gunakan block body jika butuh validasi, logging, branching, atau naming intermediate;
- jangan memaksakan expression body sampai logika domain menjadi teka-teki.

Contoh buruk:

```java
Function<CaseRecord, String> label = c ->
        c.status() == CaseStatus.CLOSED ? "DONE" :
        c.severity() >= 8 ? "URGENT" :
        c.status() == CaseStatus.ESCALATED ? "ESCALATED" :
        "NORMAL";
```

Lebih baik:

```java
Function<CaseRecord, String> label = c -> {
    if (c.status() == CaseStatus.CLOSED) {
        return "DONE";
    }
    if (c.severity() >= 8) {
        return "URGENT";
    }
    if (c.status() == CaseStatus.ESCALATED) {
        return "ESCALATED";
    }
    return "NORMAL";
};
```

Atau bahkan lebih baik sebagai method domain:

```java
static String labelOf(CaseRecord c) {
    if (c.status() == CaseStatus.CLOSED) return "DONE";
    if (c.severity() >= 8) return "URGENT";
    if (c.status() == CaseStatus.ESCALATED) return "ESCALATED";
    return "NORMAL";
}
```

Lalu:

```java
Function<CaseRecord, String> label = CaseLabels::labelOf;
```

---

### 3.5 Capture dan Effectively Final

Lambda boleh mengakses variable lokal dari enclosing scope hanya jika variable itu `final` atau **effectively final**.

```java
int threshold = 10;
Predicate<Integer> large = x -> x > threshold;
```

`threshold` tidak diberi keyword `final`, tetapi effectively final karena tidak diubah setelah assigned.

Ini tidak valid:

```java
int threshold = 10;
threshold = 20;
Predicate<Integer> large = x -> x > threshold; // compile error
```

Kenapa Java membatasi ini?

Karena local variable hidup di stack frame method, sedangkan lambda bisa hidup lebih lama dari method tersebut. Java menangkap nilai variable, bukan memberikan akses mutasi langsung ke local variable stack.

Mental model:

```text
Lambda capture = capture reference/value yang stabil, bukan capture slot local variable mutable.
```

Namun hati-hati: `final` reference tidak berarti object-nya immutable.

```java
List<String> names = new ArrayList<>();
Consumer<String> add = s -> names.add(s); // valid, tetapi side effect
```

`names` effectively final, tetapi isi list tetap bisa berubah.

Ini sering menjadi sumber bug:

```java
List<String> result = new ArrayList<>();
items.stream()
        .filter(this::isValid)
        .forEach(result::add); // side effect eksternal
```

Lebih baik:

```java
List<String> result = items.stream()
        .filter(this::isValid)
        .toList();
```

Rule:

```text
Effectively final mencegah rebinding variable, bukan mencegah mutasi object.
```

---

### 3.6 Lambda dan `this`

Dalam lambda, `this` tetap merujuk ke instance enclosing class, bukan object lambda.

```java
class Handler {
    private final String name = "handler";

    Runnable lambda() {
        return () -> System.out.println(this.name);
    }
}
```

Berbeda dengan anonymous class:

```java
class Handler {
    private final String name = "handler";

    Runnable anonymous() {
        return new Runnable() {
            private final String name = "anonymous";

            @Override
            public void run() {
                System.out.println(this.name); // anonymous
            }
        };
    }
}
```

Ini penting ketika refactoring anonymous class menjadi lambda.

---

### 3.7 Lambda vs Anonymous Class

Lambda:

```java
Runnable r = () -> System.out.println("run");
```

Anonymous class:

```java
Runnable r = new Runnable() {
    @Override
    public void run() {
        System.out.println("run");
    }
};
```

Perbedaan penting:

| Aspek | Lambda | Anonymous Class |
|---|---|---|
| Target | Functional interface | Class/interface instantiation |
| `this` | Enclosing instance | Anonymous object |
| Syntax | Ringkas | Verbose |
| Bisa punya field sendiri | Tidak secara eksplisit | Bisa |
| Bisa override multiple methods | Tidak | Bisa jika class/interface punya method concrete/abstract sesuai |
| Identity | Jangan diandalkan | Object instance eksplisit |
| Runtime strategy | `invokedynamic`/metafactory | anonymous class bytecode |

Rule:

- gunakan lambda untuk behavior kecil dan jelas;
- gunakan anonymous class jika perlu state/field/object identity khusus;
- gunakan named class jika behavior punya domain meaning, lifecycle, dependency, atau testability yang penting.

---

### 3.8 Lambda Bukan Selalu Gratis

Lambda biasanya murah, tetapi bukan berarti selalu nol biaya.

Potential cost:

- capture object;
- boxing/unboxing;
- virtual call;
- allocation;
- stack trace lebih sulit dibaca;
- debugging pipeline lebih sulit;
- accidental retention terhadap object besar;
- lambda capturing `this` bisa memperpanjang lifetime object.

Contoh accidental retention:

```java
class LargeService {
    private final byte[] cache = new byte[100_000_000];

    Supplier<String> supplier(String value) {
        return () -> this.normalize(value); // captures this
    }

    String normalize(String value) {
        return value.trim().toLowerCase();
    }
}
```

Jika supplier disimpan lama, instance `LargeService` ikut tertahan.

Alternatif:

```java
static String normalize(String value) {
    return value.trim().toLowerCase();
}

Supplier<String> supplier(String value) {
    return () -> normalize(value); // tidak perlu capture this
}
```

---

## 4. Functional Interface

### 4.1 Definisi

Functional interface adalah interface yang memiliki tepat satu abstract method.

Contoh:

```java
@FunctionalInterface
interface CasePolicy {
    boolean allows(CaseRecord record);
}
```

Ini dapat digunakan sebagai target lambda:

```java
CasePolicy highSeverity = record -> record.severity() >= 8;
```

Annotation `@FunctionalInterface` tidak wajib, tetapi sangat disarankan karena membantu compiler menangkap pelanggaran desain.

Contoh salah:

```java
@FunctionalInterface
interface BadPolicy {
    boolean allows(CaseRecord record);
    String description(); // compile error karena ada dua abstract methods
}
```

---

### 4.2 Single Abstract Method Bukan Berarti Hanya Satu Method Total

Functional interface boleh punya:

- satu abstract method;
- default methods;
- static methods;
- private methods;
- methods dari `Object` seperti `toString`, `equals`, `hashCode` tidak dihitung sebagai functional method.

Contoh:

```java
@FunctionalInterface
interface CasePolicy {
    boolean allows(CaseRecord record);

    default CasePolicy and(CasePolicy other) {
        Objects.requireNonNull(other);
        return record -> this.allows(record) && other.allows(record);
    }

    default CasePolicy or(CasePolicy other) {
        Objects.requireNonNull(other);
        return record -> this.allows(record) || other.allows(record);
    }

    static CasePolicy alwaysAllow() {
        return record -> true;
    }
}
```

Penggunaan:

```java
CasePolicy highSeverity = c -> c.severity() >= 8;
CasePolicy active = c -> c.status() != CaseStatus.CLOSED;

CasePolicy escalationCandidate = active.and(highSeverity);
```

Ini jauh lebih ekspresif daripada menyebar `Predicate<CaseRecord>` di seluruh codebase jika konsepnya memang domain policy.

---

### 4.3 `java.util.function`

Package `java.util.function` menyediakan functional interface umum.

Bentuk utama:

| Interface | Bentuk Konsep | Abstract Method | Contoh |
|---|---|---|---|
| `Function<T, R>` | T -> R | `R apply(T t)` | mapping DTO ke domain |
| `Consumer<T>` | T -> void | `void accept(T t)` | logging, sending, accumulating |
| `Supplier<T>` | () -> T | `T get()` | lazy creation, factory |
| `Predicate<T>` | T -> boolean | `boolean test(T t)` | filter, validation |
| `UnaryOperator<T>` | T -> T | `T apply(T t)` | normalize, transform same type |
| `BinaryOperator<T>` | (T,T) -> T | `T apply(T a, T b)` | merge, reduce |
| `BiFunction<T,U,R>` | (T,U) -> R | `R apply(T t, U u)` | combine two inputs |
| `BiConsumer<T,U>` | (T,U) -> void | `void accept(T t, U u)` | write pair |
| `BiPredicate<T,U>` | (T,U) -> boolean | `boolean test(T t, U u)` | compare/check relation |

Contoh:

```java
Function<String, String> normalize = s -> s.trim().toLowerCase(Locale.ROOT);
Predicate<String> nonBlank = s -> !s.isBlank();
Supplier<UUID> newId = UUID::randomUUID;
Consumer<String> log = System.out::println;
BinaryOperator<Integer> max = Integer::max;
```

---

### 4.4 Primitive Specialization

Generic functional interface menggunakan reference type. Jika memakai primitive, boxing bisa terjadi.

```java
Function<Integer, Integer> square = x -> x * x;
```

Di sini `Integer` bisa menyebabkan boxing/unboxing.

Alternatif:

```java
IntUnaryOperator square = x -> x * x;
```

Primitive specialization penting di hot path:

| Generic | Primitive Alternative |
|---|---|
| `Function<T, Integer>` | `ToIntFunction<T>` |
| `Function<Integer, R>` | `IntFunction<R>` |
| `Predicate<Integer>` | `IntPredicate` |
| `Consumer<Integer>` | `IntConsumer` |
| `Supplier<Integer>` | `IntSupplier` |
| `UnaryOperator<Integer>` | `IntUnaryOperator` |
| `BinaryOperator<Integer>` | `IntBinaryOperator` |

Contoh allocation-heavy:

```java
List<Integer> values = IntStream.range(0, 1_000_000)
        .boxed()
        .map(x -> x * x)
        .toList();
```

Lebih baik jika tetap primitive:

```java
int sum = IntStream.range(0, 1_000_000)
        .map(x -> x * x)
        .sum();
```

Rule:

```text
Kalau datanya numerik dan berada di hot path, pertimbangkan IntStream/LongStream/DoubleStream dan primitive functional interface.
```

---

### 4.5 Kapan Memakai Standard Functional Interface vs Custom Interface

Gunakan standard functional interface jika konsepnya generic dan tidak punya domain semantics khusus.

```java
Function<String, String> normalize = s -> s.trim().toLowerCase(Locale.ROOT);
Predicate<String> nonBlank = s -> !s.isBlank();
```

Gunakan custom functional interface jika behavior adalah konsep domain/API penting.

Buruk:

```java
void register(Function<CaseRecord, Boolean> policy) { ... }
```

Lebih baik:

```java
@FunctionalInterface
interface CaseEscalationPolicy {
    boolean shouldEscalate(CaseRecord record);
}

void register(CaseEscalationPolicy policy) { ... }
```

Keuntungan custom interface:

- nama method lebih domain-specific;
- bisa menambahkan default combinator;
- bisa dokumentasi lebih jelas;
- stack trace dan API lebih readable;
- menghindari `Function<A, B>` everywhere anti-pattern.

---

### 4.6 Exception di Functional Interface

Standard functional interface tidak mendeklarasikan checked exception.

Ini tidak valid jika `parseFile` throws `IOException`:

```java
files.stream()
        .map(path -> parseFile(path))
        .toList();
```

Solusi buruk:

```java
files.stream()
        .map(path -> {
            try {
                return parseFile(path);
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        })
        .toList();
```

Ini kadang boleh, tetapi jangan otomatis.

Opsi desain:

#### Opsi 1 — Loop biasa jika error handling penting

```java
List<Document> documents = new ArrayList<>();
for (Path path : files) {
    try {
        documents.add(parseFile(path));
    } catch (IOException e) {
        log.warn("Failed to parse {}", path, e);
    }
}
```

#### Opsi 2 — Bungkus hasil menjadi domain result

```java
sealed interface ParseResult permits ParseResult.Success, ParseResult.Failed {
    record Success(Path path, Document document) implements ParseResult {}
    record Failed(Path path, IOException error) implements ParseResult {}
}

ParseResult parseSafely(Path path) {
    try {
        return new ParseResult.Success(path, parseFile(path));
    } catch (IOException e) {
        return new ParseResult.Failed(path, e);
    }
}

List<ParseResult> results = files.stream()
        .map(this::parseSafely)
        .toList();
```

#### Opsi 3 — Custom throwing functional interface

```java
@FunctionalInterface
interface ThrowingFunction<T, R, E extends Exception> {
    R apply(T value) throws E;
}
```

Tetapi hati-hati: integrasi dengan Stream API tetap perlu adapter.

Rule:

```text
Jika error adalah bagian penting dari domain flow, jangan sembunyikan dalam RuntimeException anonim di lambda.
```

---

## 5. Method Reference

### 5.1 Apa Itu Method Reference?

Method reference adalah bentuk ringkas lambda ketika lambda hanya meneruskan parameter ke method yang sudah ada.

```java
Function<String, Integer> length = s -> s.length();
```

Bisa ditulis:

```java
Function<String, Integer> length = String::length;
```

Method reference tetap butuh target functional interface.

---

### 5.2 Static Method Reference

```java
Function<String, Integer> parse = Integer::parseInt;
```

Setara dengan:

```java
Function<String, Integer> parse = s -> Integer.parseInt(s);
```

Contoh domain:

```java
List<CaseId> ids = rawIds.stream()
        .map(CaseId::parse)
        .toList();
```

---

### 5.3 Bound Instance Method Reference

Object sudah diketahui.

```java
PrintStream out = System.out;
Consumer<String> printer = out::println;
```

Setara:

```java
Consumer<String> printer = s -> out.println(s);
```

Contoh:

```java
AuditWriter writer = new AuditWriter();
Consumer<AuditEvent> sink = writer::write;
```

Hati-hati: method reference ini menangkap `writer`. Jika `sink` hidup lama, `writer` juga tertahan.

---

### 5.4 Unbound Instance Method Reference

Class diketahui, instance menjadi parameter pertama.

```java
Function<String, Integer> length = String::length;
```

Setara:

```java
Function<String, Integer> length = s -> s.length();
```

Contoh lain:

```java
BiPredicate<String, String> equalsIgnoreCase = String::equalsIgnoreCase;
```

Setara:

```java
BiPredicate<String, String> equalsIgnoreCase = (a, b) -> a.equalsIgnoreCase(b);
```

Mental model:

```text
TypeName::instanceMethod
= parameter pertama adalah receiver object.
```

---

### 5.5 Constructor Reference

```java
Supplier<ArrayList<String>> listFactory = ArrayList::new;
```

```java
Function<String, CaseId> idFactory = CaseId::new;
```

Jika constructor punya dua parameter:

```java
BiFunction<String, Integer, CaseRecord> factory = CaseRecord::new;
```

---

### 5.6 Array Constructor Reference

```java
IntFunction<String[]> stringArray = String[]::new;

String[] values = Stream.of("a", "b")
        .toArray(String[]::new);
```

Ini umum dipakai saat mengubah stream menjadi array bertipe spesifik.

---

### 5.7 Method Reference dan Overload Ambiguity

Method reference bisa ambiguous jika ada overload.

```java
class Parser {
    static int parse(String s) { return Integer.parseInt(s); }
    static int parse(Object o) { return Integer.parseInt(o.toString()); }
}

Function<String, Integer> f = Parser::parse;
```

Compiler biasanya bisa memilih berdasarkan target type. Tetapi di API kompleks, ambiguity bisa muncul.

Solusi:

```java
Function<String, Integer> f = s -> Parser.parse(s);
```

Rule:

```text
Gunakan method reference jika membuat intent lebih jelas.
Gunakan lambda eksplisit jika parameter binding perlu dibaca jelas.
```

---

### 5.8 Method Reference Bisa Mengurangi atau Merusak Readability

Bagus:

```java
users.stream()
        .map(User::email)
        .toList();
```

Kurang jelas:

```java
records.stream()
        .filter(this::eligible)
        .map(this::convert)
        .forEach(this::dispatch);
```

Kode ini ringkas, tetapi pembaca harus lompat ke banyak method untuk tahu apa yang terjadi.

Terkadang lebih baik:

```java
records.stream()
        .filter(record -> isActive(record) && hasValidOwner(record))
        .map(record -> toDispatchCommand(record))
        .forEach(command -> dispatcher.dispatch(command));
```

Rule praktis:

- method reference bagus untuk accessor, constructor, pure conversion, dan named operation jelas;
- lambda lebih baik jika ingin menunjukkan parameter, branching kecil, atau binding eksplisit;
- named method lebih baik jika logikanya domain-significant.

---

## 6. Function Composition

### 6.1 `Function.compose` dan `Function.andThen`

```java
Function<String, String> trim = String::trim;
Function<String, String> lower = s -> s.toLowerCase(Locale.ROOT);

Function<String, String> normalize = trim.andThen(lower);
```

`andThen`:

```text
f.andThen(g) = g(f(x))
```

`compose`:

```text
f.compose(g) = f(g(x))
```

Contoh:

```java
Function<String, Integer> parse = Integer::parseInt;
Function<Integer, Integer> square = x -> x * x;

Function<String, Integer> parseThenSquare = parse.andThen(square);
Function<String, Integer> alsoParseThenSquare = square.compose(parse);
```

---

### 6.2 Predicate Composition

```java
Predicate<CaseRecord> active = c -> c.status() != CaseStatus.CLOSED;
Predicate<CaseRecord> highSeverity = c -> c.severity() >= 8;
Predicate<CaseRecord> escalationCandidate = active.and(highSeverity);
```

Built-in combinator:

- `and`
- `or`
- `negate`
- `Predicate.not(...)`

Contoh:

```java
List<String> nonBlank = values.stream()
        .filter(Predicate.not(String::isBlank))
        .toList();
```

---

### 6.3 Consumer Composition

```java
Consumer<AuditEvent> log = event -> logger.info("{}", event);
Consumer<AuditEvent> persist = repository::save;

Consumer<AuditEvent> logThenPersist = log.andThen(persist);
```

Hati-hati: `Consumer` menandakan side effect. Composition dengan `Consumer` berarti urutan effect penting.

Jika `log` sukses tetapi `persist` gagal, apa invariant sistem?

```java
logThenPersist.accept(event);
```

Pertanyaan production:

- Apakah event boleh tercatat di log tetapi gagal persist?
- Apakah perlu retry?
- Apakah perlu transaction?
- Apakah perlu idempotency?
- Apakah error dari consumer pertama menghentikan consumer kedua?

Functional composition tidak menghapus kebutuhan desain failure model.

---

### 6.4 Composition untuk Domain Policy

Daripada menulis rule besar:

```java
boolean shouldEscalate(CaseRecord c) {
    return c.status() != CaseStatus.CLOSED
            && c.severity() >= 8
            && c.ownerId() != null
            && !c.flags().contains("NO_ESCALATION");
}
```

Bisa dimodelkan:

```java
Predicate<CaseRecord> active = c -> c.status() != CaseStatus.CLOSED;
Predicate<CaseRecord> highSeverity = c -> c.severity() >= 8;
Predicate<CaseRecord> hasOwner = c -> c.ownerId() != null;
Predicate<CaseRecord> notSuppressed = c -> !c.flags().contains("NO_ESCALATION");

Predicate<CaseRecord> shouldEscalate = active
        .and(highSeverity)
        .and(hasOwner)
        .and(notSuppressed);
```

Namun jika rule ini regulatory-critical, sebaiknya beri nama domain:

```java
final class EscalationRules {
    static boolean isEscalationCandidate(CaseRecord c) {
        return isActive(c)
                && isHighSeverity(c)
                && hasOwner(c)
                && isNotSuppressed(c);
    }

    static boolean isActive(CaseRecord c) { ... }
    static boolean isHighSeverity(CaseRecord c) { ... }
    static boolean hasOwner(CaseRecord c) { ... }
    static boolean isNotSuppressed(CaseRecord c) { ... }
}
```

Lalu:

```java
cases.stream()
        .filter(EscalationRules::isEscalationCandidate)
        .toList();
```

Rule:

```text
Composition bagus untuk membangun pipeline.
Named domain function bagus untuk membuat rule accountable, auditable, dan testable.
```

---

## 7. Stream API: Mental Model

### 7.1 Stream Bukan Collection

`Collection` menyimpan data.

`Stream` merepresentasikan pipeline pemrosesan data.

```text
Collection = container data
Stream     = pipeline operasi atas data
```

Contoh:

```java
List<String> names = List.of("Alice", "Bob", "Charlie");

Stream<String> stream = names.stream()
        .filter(name -> name.length() > 3);
```

Pada titik ini data belum diproses. Stream bersifat lazy.

Pemrosesan terjadi ketika terminal operation dipanggil:

```java
List<String> result = stream.toList();
```

---

### 7.2 Source → Intermediate Operations → Terminal Operation

Pipeline stream:

```text
source
  -> intermediate operation
  -> intermediate operation
  -> terminal operation
```

Contoh:

```java
List<String> result = names.stream()             // source
        .filter(name -> name.length() > 3)       // intermediate
        .map(String::toUpperCase)                // intermediate
        .toList();                               // terminal
```

Intermediate operation mengembalikan stream baru.

Terminal operation menghasilkan non-stream result atau side effect.

---

### 7.3 Lazy Evaluation

```java
Stream<String> pipeline = names.stream()
        .filter(name -> {
            System.out.println("filter " + name);
            return name.length() > 3;
        })
        .map(name -> {
            System.out.println("map " + name);
            return name.toUpperCase();
        });

System.out.println("before terminal");
List<String> result = pipeline.toList();
```

Output dimulai setelah `toList()`.

Mental model:

```text
Intermediate operation menyusun rencana.
Terminal operation menjalankan rencana.
```

---

### 7.4 Pull-Based Execution

Stream pipeline umumnya dieksekusi secara pull-based dari terminal operation.

Contoh:

```java
Optional<String> first = names.stream()
        .filter(name -> name.length() > 3)
        .map(String::toUpperCase)
        .findFirst();
```

`findFirst` tidak perlu memproses semua element jika sudah menemukan hasil.

Ini memungkinkan short-circuiting.

---

### 7.5 Stream Single-Use

Stream tidak bisa dipakai ulang.

```java
Stream<String> s = names.stream();

long count = s.count();
List<String> list = s.toList(); // IllegalStateException
```

Jika butuh pipeline reusable, simpan supplier:

```java
Supplier<Stream<String>> streamSupplier = names::stream;

long count = streamSupplier.get().count();
List<String> list = streamSupplier.get().toList();
```

Rule:

```text
Jangan simpan Stream sebagai field. Simpan Collection/Supplier/Iterable, lalu buat stream saat dibutuhkan.
```

---

### 7.6 Non-Interference

Behavioral parameter stream tidak boleh mengganggu source.

Buruk:

```java
List<String> names = new ArrayList<>(List.of("a", "b", "c"));

names.stream()
        .filter(s -> {
            names.add("x"); // modifies source
            return true;
        })
        .toList();
```

Ini bisa menghasilkan `ConcurrentModificationException` atau behavior tidak jelas.

Rule:

```text
Lambda dalam stream tidak boleh memodifikasi source stream.
```

---

### 7.7 Statelessness

Behavioral parameter umumnya harus stateless.

Buruk:

```java
Set<String> seen = new HashSet<>();

List<String> unique = names.stream()
        .filter(name -> seen.add(name))
        .toList();
```

Untuk sequential stream kecil, ini sering “terlihat bekerja”. Tetapi:

- side effect tersembunyi;
- tidak thread-safe untuk parallel stream;
- order-dependent;
- sulit dites;
- sulit di-reason.

Lebih baik:

```java
List<String> unique = names.stream()
        .distinct()
        .toList();
```

Jika butuh distinct by key, pertimbangkan loop eksplisit atau collector/gatherer yang jelas.

---

### 7.8 Encounter Order

Beberapa source memiliki encounter order:

- `List` ordered;
- array ordered;
- `LinkedHashSet` ordered;
- `HashSet` not guaranteed ordered;
- `TreeSet` sorted;
- `ConcurrentHashMap.keySet()` not naturally ordered.

Order mempengaruhi:

- `findFirst`;
- `forEachOrdered`;
- `limit`;
- `skip`;
- `distinct`;
- parallel stream performance;
- collector result ordering.

Contoh:

```java
List<String> result = Set.of("b", "a", "c").stream()
        .toList();
```

Jangan mengandalkan urutan dari unordered source.

---

### 7.9 Stateless vs Stateful Intermediate Operations

Stateless intermediate operation:

- `map`
- `filter`
- `flatMap`
- `peek`

Stateful intermediate operation:

- `distinct`
- `sorted`
- `limit`
- `skip`
- `takeWhile`
- `dropWhile`

Stateful operation bisa membutuhkan buffering atau coordination.

Contoh:

```java
List<String> sorted = names.stream()
        .sorted()
        .toList();
```

`sorted` harus melihat semua element sebelum bisa menghasilkan urutan final.

---

### 7.10 Short-Circuiting

Short-circuiting operation bisa berhenti sebelum source habis.

Intermediate:

- `limit`
- `takeWhile`

Terminal:

- `findFirst`
- `findAny`
- `anyMatch`
- `allMatch`
- `noneMatch`

Contoh:

```java
boolean hasHighSeverity = cases.stream()
        .anyMatch(c -> c.severity() >= 8);
```

Jika satu case cocok, pipeline bisa berhenti.

---

## 8. Core Stream Operations

### 8.1 `filter`

`filter` memilih element berdasarkan predicate.

```java
List<CaseRecord> active = cases.stream()
        .filter(c -> c.status() != CaseStatus.CLOSED)
        .toList();
```

Rule:

- predicate sebaiknya pure;
- jangan logging berlebihan di predicate;
- jangan memutasi object di predicate;
- gunakan named method jika rule domain penting.

---

### 8.2 `map`

`map` mengubah satu element menjadi satu element lain.

```java
List<String> ids = cases.stream()
        .map(CaseRecord::id)
        .toList();
```

Mapping DTO:

```java
record CaseDto(String id, String status, int severity) {}

CaseDto toDto(CaseRecord c) {
    return new CaseDto(c.id(), c.status().name(), c.severity());
}

List<CaseDto> dtos = cases.stream()
        .map(this::toDto)
        .toList();
```

---

### 8.3 `flatMap`

`flatMap` mengubah satu element menjadi banyak element, lalu meratakan hasilnya.

Contoh:

```java
record CaseRecord(String id, List<String> tags) {}

List<String> allTags = cases.stream()
        .flatMap(c -> c.tags().stream())
        .distinct()
        .toList();
```

Mental model:

```text
map:     T -> R
flatMap: T -> Stream<R>, lalu flatten
```

Contoh dengan nested object:

```java
record Order(String id, List<OrderLine> lines) {}
record OrderLine(String productId, int quantity) {}

List<String> productIds = orders.stream()
        .flatMap(order -> order.lines().stream())
        .map(OrderLine::productId)
        .distinct()
        .toList();
```

---

### 8.4 `peek`

`peek` adalah intermediate operation yang terutama dimaksudkan untuk debugging.

```java
List<String> result = names.stream()
        .peek(name -> System.out.println("before filter: " + name))
        .filter(name -> name.length() > 3)
        .peek(name -> System.out.println("after filter: " + name))
        .toList();
```

Anti-pattern:

```java
orders.stream()
        .peek(order -> order.setStatus(PROCESSED))
        .toList();
```

Jangan gunakan `peek` untuk business side effect.

Lebih baik:

```java
List<Order> processed = orders.stream()
        .map(order -> order.withStatus(PROCESSED))
        .toList();
```

Atau loop eksplisit jika memang mutasi side-effectful:

```java
for (Order order : orders) {
    order.markProcessed();
}
```

---

### 8.5 `limit`, `skip`, `takeWhile`, `dropWhile`

```java
List<String> firstTen = names.stream()
        .limit(10)
        .toList();
```

```java
List<String> afterFirstTen = names.stream()
        .skip(10)
        .toList();
```

```java
List<Integer> prefix = numbers.stream()
        .takeWhile(n -> n < 100)
        .toList();
```

`takeWhile` dan `dropWhile` bergantung pada encounter order. Untuk unordered source, semantic-nya tidak seperti “filter”.

---

### 8.6 `sorted`

```java
List<CaseRecord> sorted = cases.stream()
        .sorted(Comparator.comparingInt(CaseRecord::severity).reversed())
        .toList();
```

Performance concern:

- membutuhkan semua element;
- O(n log n);
- membutuhkan memory tambahan;
- comparator harus konsisten;
- expensive comparator bisa sangat mahal.

Buruk:

```java
cases.stream()
        .sorted(Comparator.comparing(c -> externalService.score(c)))
        .toList();
```

Jangan panggil service/network di comparator.

---

### 8.7 `distinct`

```java
List<String> unique = names.stream()
        .distinct()
        .toList();
```

`distinct` bergantung pada `equals`/`hashCode`.

Jika object mutable dipakai, hasil bisa membingungkan.

```java
record CaseKey(String id) {}
```

Gunakan value object/record yang equality-nya jelas.

---

## 9. Terminal Operations

### 9.1 `toList`

Sejak Java 16, `Stream.toList()` tersedia.

```java
List<String> result = names.stream()
        .filter(Predicate.not(String::isBlank))
        .toList();
```

Perhatikan: result dari `Stream.toList()` adalah unmodifiable list.

```java
List<String> result = names.stream().toList();
result.add("x"); // UnsupportedOperationException
```

Jika butuh mutable list:

```java
List<String> result = names.stream()
        .collect(Collectors.toCollection(ArrayList::new));
```

---

### 9.2 `forEach` dan `forEachOrdered`

`forEach` adalah terminal operation untuk side effect.

```java
names.stream().forEach(System.out::println);
```

Pada parallel stream, order `forEach` tidak dijamin.

```java
names.parallelStream().forEach(System.out::println);
```

Jika perlu order:

```java
names.parallelStream().forEachOrdered(System.out::println);
```

Tetapi `forEachOrdered` bisa mengurangi manfaat parallelism.

Rule:

```text
Jika tujuanmu menghasilkan collection baru, jangan pakai forEach + add.
Gunakan collect/toList.
```

Buruk:

```java
List<String> result = new ArrayList<>();
names.stream().forEach(name -> result.add(name.toUpperCase()));
```

Baik:

```java
List<String> result = names.stream()
        .map(String::toUpperCase)
        .toList();
```

---

### 9.3 `count`

```java
long count = names.stream()
        .filter(Predicate.not(String::isBlank))
        .count();
```

Hati-hati dengan side effect di intermediate operation. Stream implementation boleh mengoptimalkan pipeline jika hasil tidak berubah. Jangan mengandalkan `peek` atau side effect untuk selalu dieksekusi.

---

### 9.4 `anyMatch`, `allMatch`, `noneMatch`

```java
boolean hasEscalated = cases.stream()
        .anyMatch(c -> c.status() == CaseStatus.ESCALATED);
```

```java
boolean allClosed = cases.stream()
        .allMatch(c -> c.status() == CaseStatus.CLOSED);
```

```java
boolean noneHighSeverity = cases.stream()
        .noneMatch(c -> c.severity() >= 8);
```

Ini short-circuiting.

Untuk empty stream:

```java
Stream.<String>empty().allMatch(s -> false);  // true
Stream.<String>empty().anyMatch(s -> true);   // false
Stream.<String>empty().noneMatch(s -> true);  // true
```

Ini bukan bug; ini mengikuti logika quantifier:

- `allMatch`: semua element memenuhi predicate; jika tidak ada element yang melanggar, true;
- `anyMatch`: ada element yang memenuhi predicate; jika tidak ada element, false;
- `noneMatch`: tidak ada element yang memenuhi predicate; jika tidak ada element, true.

---

### 9.5 `findFirst` dan `findAny`

```java
Optional<CaseRecord> firstHigh = cases.stream()
        .filter(c -> c.severity() >= 8)
        .findFirst();
```

`findFirst` menghormati encounter order.

`findAny` lebih fleksibel, terutama untuk parallel stream:

```java
Optional<CaseRecord> anyHigh = cases.parallelStream()
        .filter(c -> c.severity() >= 8)
        .findAny();
```

Rule:

- gunakan `findFirst` jika order adalah bagian dari semantics;
- gunakan `findAny` jika hanya butuh salah satu dan ingin memberi ruang optimasi.

---

### 9.6 `min` dan `max`

```java
Optional<CaseRecord> highestSeverity = cases.stream()
        .max(Comparator.comparingInt(CaseRecord::severity));
```

`min/max` mengembalikan `Optional` karena stream bisa kosong.

Jangan langsung:

```java
CaseRecord record = cases.stream()
        .max(Comparator.comparingInt(CaseRecord::severity))
        .get(); // risk
```

Lebih baik:

```java
CaseRecord record = cases.stream()
        .max(Comparator.comparingInt(CaseRecord::severity))
        .orElseThrow(() -> new NoSuchElementException("No cases available"));
```

---

## 10. Reduction

### 10.1 Apa Itu Reduction?

Reduction menggabungkan banyak element menjadi satu result.

Contoh:

```java
int sum = numbers.stream()
        .reduce(0, (a, b) -> a + b);
```

Mental model:

```text
(((identity op e1) op e2) op e3) ...
```

---

### 10.2 Identity Harus Benar

```java
int sum = numbers.stream()
        .reduce(0, Integer::sum);
```

`0` adalah identity untuk addition.

Untuk multiplication:

```java
int product = numbers.stream()
        .reduce(1, (a, b) -> a * b);
```

`1` adalah identity untuk multiplication.

Salah:

```java
int product = numbers.stream()
        .reduce(0, (a, b) -> a * b); // selalu 0
```

Rule:

```text
identity op x harus menghasilkan x.
```

---

### 10.3 Accumulator Harus Associative untuk Parallel

Associative berarti:

```text
(a op b) op c == a op (b op c)
```

Addition integer secara matematis associative, tetapi floating point tidak sepenuhnya associative karena precision.

Buruk untuk parallel:

```java
int result = numbers.parallelStream()
        .reduce(0, (a, b) -> a - b);
```

Subtraction tidak associative.

Sequential bisa memberi hasil tertentu, parallel bisa berbeda.

Rule:

```text
Untuk parallel reduce, operasi harus associative dan identity harus benar.
```

---

### 10.4 `reduce` vs `collect`

Gunakan `reduce` untuk immutable reduction:

```java
int total = numbers.stream()
        .reduce(0, Integer::sum);
```

Gunakan `collect` untuk mutable accumulation:

```java
List<String> result = names.stream()
        .collect(Collectors.toCollection(ArrayList::new));
```

Anti-pattern:

```java
List<String> result = names.stream()
        .reduce(new ArrayList<>(),
                (list, name) -> {
                    list.add(name);
                    return list;
                },
                (left, right) -> {
                    left.addAll(right);
                    return left;
                });
```

Lebih baik:

```java
List<String> result = names.stream()
        .collect(Collectors.toCollection(ArrayList::new));
```

---

## 11. Collector

### 11.1 Apa Itu Collector?

Collector adalah strategi terminal reduction yang mengakumulasi element stream ke mutable result container, lalu opsional melakukan transformasi akhir.

Komponen collector:

1. `supplier`: membuat container baru;
2. `accumulator`: memasukkan element ke container;
3. `combiner`: menggabungkan dua container;
4. `finisher`: transformasi akhir;
5. `characteristics`: metadata seperti `CONCURRENT`, `UNORDERED`, `IDENTITY_FINISH`.

---

### 11.2 Built-in Collectors

#### `toList`

```java
List<String> result = names.stream()
        .collect(Collectors.toList());
```

Catatan: mutability result `Collectors.toList()` tidak sebaiknya dijadikan kontrak. Jika butuh mutable spesifik:

```java
List<String> result = names.stream()
        .collect(Collectors.toCollection(ArrayList::new));
```

#### `toSet`

```java
Set<String> result = names.stream()
        .collect(Collectors.toSet());
```

Jika butuh order:

```java
Set<String> result = names.stream()
        .collect(Collectors.toCollection(LinkedHashSet::new));
```

#### `joining`

```java
String csv = names.stream()
        .collect(Collectors.joining(","));
```

#### `counting`

```java
long count = names.stream()
        .collect(Collectors.counting());
```

Biasanya `stream.count()` lebih langsung jika tidak downstream collector.

---

### 11.3 `groupingBy`

```java
Map<CaseStatus, List<CaseRecord>> byStatus = cases.stream()
        .collect(Collectors.groupingBy(CaseRecord::status));
```

Dengan downstream collector:

```java
Map<CaseStatus, Long> countByStatus = cases.stream()
        .collect(Collectors.groupingBy(
                CaseRecord::status,
                Collectors.counting()
        ));
```

Dengan mapping downstream:

```java
Map<CaseStatus, List<String>> idsByStatus = cases.stream()
        .collect(Collectors.groupingBy(
                CaseRecord::status,
                Collectors.mapping(CaseRecord::id, Collectors.toList())
        ));
```

Dengan map factory:

```java
EnumMap<CaseStatus, List<CaseRecord>> byStatus = cases.stream()
        .collect(Collectors.groupingBy(
                CaseRecord::status,
                () -> new EnumMap<>(CaseStatus.class),
                Collectors.toList()
        ));
```

Rule:

```text
Untuk enum key, pertimbangkan EnumMap agar lebih efisien dan eksplisit.
```

---

### 11.4 `partitioningBy`

`partitioningBy` adalah grouping khusus untuk boolean key.

```java
Map<Boolean, List<CaseRecord>> partitioned = cases.stream()
        .collect(Collectors.partitioningBy(c -> c.severity() >= 8));
```

Hasil punya key `true` dan `false`.

Dengan downstream:

```java
Map<Boolean, Long> counts = cases.stream()
        .collect(Collectors.partitioningBy(
                c -> c.severity() >= 8,
                Collectors.counting()
        ));
```

---

### 11.5 `toMap`

```java
Map<String, CaseRecord> byId = cases.stream()
        .collect(Collectors.toMap(CaseRecord::id, Function.identity()));
```

Jika duplicate key, ini throw exception.

Untuk duplicate key, berikan merge function:

```java
Map<String, CaseRecord> latestById = cases.stream()
        .collect(Collectors.toMap(
                CaseRecord::id,
                Function.identity(),
                (oldValue, newValue) -> newValue
        ));
```

Jika ingin preserve order:

```java
Map<String, CaseRecord> byId = cases.stream()
        .collect(Collectors.toMap(
                CaseRecord::id,
                Function.identity(),
                (a, b) -> b,
                LinkedHashMap::new
        ));
```

Rule:

```text
Setiap toMap harus menjawab: bagaimana jika key duplicate?
```

Jika duplicate adalah data integrity issue, biarkan fail tetapi beri error yang jelas lewat preprocessing atau custom collector.

---

### 11.6 `collectingAndThen`

```java
List<String> immutable = names.stream()
        .collect(Collectors.collectingAndThen(
                Collectors.toCollection(ArrayList::new),
                List::copyOf
        ));
```

Berguna saat ingin final transform.

---

### 11.7 `teeing`

`teeing` menjalankan dua collector lalu menggabungkan hasilnya.

```java
record SeverityStats(int min, int max) {}

SeverityStats stats = cases.stream()
        .collect(Collectors.teeing(
                Collectors.mapping(CaseRecord::severity, Collectors.minBy(Integer::compareTo)),
                Collectors.mapping(CaseRecord::severity, Collectors.maxBy(Integer::compareTo)),
                (min, max) -> new SeverityStats(
                        min.orElse(0),
                        max.orElse(0)
                )
        ));
```

Namun jika terlalu kompleks, loop eksplisit bisa lebih readable.

---

### 11.8 Custom Collector

Misal kita ingin mengumpulkan statistics severity.

```java
record SeverityAccumulator(int count, int sum, int max) {
    SeverityAccumulator add(CaseRecord c) {
        return new SeverityAccumulator(
                count + 1,
                sum + c.severity(),
                Math.max(max, c.severity())
        );
    }

    SeverityAccumulator combine(SeverityAccumulator other) {
        return new SeverityAccumulator(
                count + other.count,
                sum + other.sum,
                Math.max(max, other.max)
        );
    }

    SeveritySummary finish() {
        double avg = count == 0 ? 0 : (double) sum / count;
        return new SeveritySummary(count, avg, max);
    }
}

record SeveritySummary(int count, double average, int max) {}
```

Collector:

```java
Collector<CaseRecord, AtomicReference<SeverityAccumulator>, SeveritySummary> collector =
        Collector.of(
                () -> new AtomicReference<>(new SeverityAccumulator(0, 0, Integer.MIN_VALUE)),
                (ref, c) -> ref.set(ref.get().add(c)),
                (left, right) -> {
                    left.set(left.get().combine(right.get()));
                    return left;
                },
                ref -> ref.get().finish()
        );
```

Tetapi ini kurang ideal karena `AtomicReference` tidak perlu untuk sequential mutation container.

Lebih baik gunakan mutable accumulator internal:

```java
final class MutableSeverityAccumulator {
    int count;
    int sum;
    int max = Integer.MIN_VALUE;

    void add(CaseRecord c) {
        count++;
        sum += c.severity();
        max = Math.max(max, c.severity());
    }

    MutableSeverityAccumulator combine(MutableSeverityAccumulator other) {
        count += other.count;
        sum += other.sum;
        max = Math.max(max, other.max);
        return this;
    }

    SeveritySummary finish() {
        double avg = count == 0 ? 0 : (double) sum / count;
        return new SeveritySummary(count, avg, max == Integer.MIN_VALUE ? 0 : max);
    }
}

Collector<CaseRecord, MutableSeverityAccumulator, SeveritySummary> severitySummaryCollector =
        Collector.of(
                MutableSeverityAccumulator::new,
                MutableSeverityAccumulator::add,
                MutableSeverityAccumulator::combine,
                MutableSeverityAccumulator::finish
        );
```

Penggunaan:

```java
SeveritySummary summary = cases.stream()
        .collect(severitySummaryCollector);
```

Rule custom collector:

- supplier harus membuat container baru;
- accumulator boleh mutate container miliknya;
- combiner harus benar untuk parallel;
- finisher harus tidak mengekspos mutable internal secara berbahaya;
- jangan mark `CONCURRENT` kecuali benar-benar thread-safe dan unordered semantics jelas.

---

## 12. Optional dalam Functional Style

Walaupun `Optional` bukan bagian langsung dari Stream API, ia sering muncul sebagai hasil terminal operation.

### 12.1 Optional Sebagai Result, Bukan Field

Bagus:

```java
Optional<CaseRecord> findById(String id) { ... }
```

Kurang baik:

```java
record CaseRecord(String id, Optional<String> ownerId) {}
```

Untuk field/domain model, biasanya lebih baik gunakan nullable internal dengan boundary jelas, atau value object khusus. `Optional` paling cocok sebagai return type yang menyatakan “mungkin tidak ada”.

---

### 12.2 Optional Pipeline

```java
String label = repository.findById(id)
        .filter(c -> c.status() != CaseStatus.CLOSED)
        .map(CaseRecord::id)
        .orElse("N/A");
```

Jika error path penting:

```java
CaseRecord record = repository.findById(id)
        .orElseThrow(() -> new CaseNotFoundException(id));
```

---

### 12.3 `Optional.stream`

Untuk menggabungkan optional dengan stream:

```java
List<Owner> owners = cases.stream()
        .map(CaseRecord::ownerIdOptional)
        .flatMap(Optional::stream)
        .map(ownerRepository::findOwner)
        .flatMap(Optional::stream)
        .toList();
```

Namun jangan terlalu jauh sampai pipeline sulit dibaca.

---

## 13. Parallel Stream

### 13.1 Apa Itu Parallel Stream?

Parallel stream memecah pekerjaan stream ke beberapa task yang biasanya berjalan di `ForkJoinPool.commonPool()`.

```java
List<Result> results = inputs.parallelStream()
        .map(this::expensiveCpuBoundTransform)
        .toList();
```

Parallel stream bukan “buat lebih cepat” button. Ia adalah trade-off.

---

### 13.2 Kapan Parallel Stream Mungkin Membantu

Parallel stream lebih mungkin membantu jika:

- data cukup besar;
- operasi CPU-bound;
- tiap element independen;
- source mudah di-split, misalnya array atau `ArrayList`;
- operation stateless dan non-blocking;
- tidak ada shared mutable state;
- collector/reduction associative dan parallel-safe;
- order tidak terlalu membatasi;
- common pool tidak sedang dipakai workload lain yang sensitif.

Contoh yang relatif cocok:

```java
long count = LongStream.range(0, 100_000_000)
        .parallel()
        .filter(this::isPrime)
        .count();
```

---

### 13.3 Kapan Parallel Stream Buruk

Parallel stream buruk jika:

- workload kecil;
- operation I/O-bound;
- memanggil database/network/API;
- source sulit di-split seperti `LinkedList`;
- order harus dipertahankan ketat;
- ada lock/contention;
- lambda mutate shared collection;
- reduction tidak associative;
- dijalankan di server request path tanpa kontrol executor;
- common pool sudah sibuk.

Buruk:

```java
List<UserProfile> profiles = userIds.parallelStream()
        .map(userClient::fetchProfile) // network call
        .toList();
```

Masalah:

- common pool bisa terblokir;
- timeout/cancellation tidak terstruktur;
- rate limit external service bisa dilanggar;
- observability buruk;
- backpressure tidak jelas.

Lebih baik gunakan controlled executor, virtual threads, structured concurrency, atau reactive/concurrent design yang eksplisit.

---

### 13.4 Shared Mutable State Bug

Buruk:

```java
List<String> result = new ArrayList<>();

names.parallelStream()
        .map(String::toUpperCase)
        .forEach(result::add); // race condition
```

Baik:

```java
List<String> result = names.parallelStream()
        .map(String::toUpperCase)
        .toList();
```

---

### 13.5 Ordered vs Unordered Parallel

Ordered pipeline bisa mengurangi parallel benefit.

```java
List<String> result = names.parallelStream()
        .filter(Predicate.not(String::isBlank))
        .limit(10)
        .toList();
```

`limit` pada ordered parallel stream bisa mahal karena perlu menjaga prefix order.

Jika order tidak penting:

```java
List<String> result = names.parallelStream()
        .unordered()
        .filter(Predicate.not(String::isBlank))
        .limit(10)
        .toList();
```

Tetapi jangan panggil `unordered()` jika order adalah bagian dari business semantics.

---

### 13.6 Parallel Stream di Backend Server

Rule keras untuk production backend:

```text
Jangan gunakan parallelStream() secara casual di request path backend.
```

Alasan:

- menggunakan common pool global;
- sulit diprediksi saat traffic tinggi;
- bisa berinteraksi buruk dengan framework thread model;
- sulit dipasang timeout/cancellation per request;
- bisa mengganggu komponen lain yang juga memakai common pool;
- parallelism default mengikuti CPU, bukan kapasitas downstream;
- tidak cocok untuk I/O blocking.

Alternatif:

- loop biasa;
- executor eksplisit;
- virtual threads;
- structured concurrency;
- batch processing framework;
- reactive stream jika benar-benar perlu backpressure async.

---

## 14. Stream Gatherers

### 14.1 Mengapa Gatherer Dibutuhkan?

Sebelum gatherer, Stream API punya banyak intermediate operation built-in:

- `map`
- `filter`
- `flatMap`
- `distinct`
- `sorted`
- `limit`
- `skip`
- `takeWhile`
- `dropWhile`

Tetapi banyak operasi praktis sulit dimodelkan tanpa hack:

- fixed-size batching/windowing;
- sliding window;
- scan/prefix accumulation;
- stateful transformation;
- short-circuit custom logic;
- concurrent mapping dengan concurrency limit;
- deduplicate adjacent items;
- many-to-many transformation.

Menambahkan semua operasi ini langsung ke `Stream` akan membuat API membengkak. Gatherer menyediakan extension point untuk custom intermediate operation.

Mental model:

```text
Collector = extension point untuk terminal operation
Gatherer  = extension point untuk intermediate operation
```

---

### 14.2 `Stream.gather`

Di Java 25, `Stream` memiliki operasi:

```java
<R> Stream<R> gather(Gatherer<? super T, ?, R> gatherer)
```

Secara konsep:

```java
source.gather(customIntermediateOperation).collect(...)
```

---

### 14.3 Apa Itu Gatherer?

Gatherer adalah object yang mendefinisikan transformasi dari stream input ke stream output.

Gatherer bisa melakukan:

- one-to-one: seperti `map`;
- one-to-many: seperti `filter` atau expansion;
- many-to-one: seperti fold/window aggregate;
- many-to-many: seperti sliding windows;
- stateful transformation;
- short-circuiting;
- parallel-capable transformation jika combiner tersedia.

---

### 14.4 Komponen Gatherer

Gatherer memiliki empat fungsi konseptual:

1. initializer: membuat state;
2. integrator: memproses element input dan mungkin emit output;
3. combiner: menggabungkan state untuk parallel execution;
4. finisher: aksi akhir ketika input habis.

Mental model:

```text
state = initializer()
for each input:
    continue = integrator(state, input, downstream)
    if !continue: stop
finisher(state, downstream)
```

---

### 14.5 Built-in Gatherers

Java menyediakan `java.util.stream.Gatherers`.

Built-in gatherers meliputi:

- `windowFixed`
- `windowSliding`
- `fold`
- `scan`
- `mapConcurrent`

#### `windowFixed`

```java
List<List<String>> batches = names.stream()
        .gather(Gatherers.windowFixed(3))
        .toList();
```

Input:

```text
a b c d e f g
```

Output:

```text
[a,b,c] [d,e,f] [g]
```

Use case:

- batch API call;
- batch DB insert;
- chunked processing;
- file processing chunk;
- bounded batch validation.

Namun hati-hati: gatherer batching bukan otomatis backpressure distributed system. Jika downstream melakukan network call, tetap perlu timeout/retry/rate-limit.

#### `windowSliding`

```java
List<List<Integer>> windows = List.of(1, 2, 3, 4, 5).stream()
        .gather(Gatherers.windowSliding(3))
        .toList();
```

Output:

```text
[1,2,3] [2,3,4] [3,4,5]
```

Use case:

- moving average;
- trend detection;
- adjacent comparison;
- event sequence pattern detection.

#### `scan`

`scan` menghasilkan running accumulation.

Konsep:

```text
input:  1 2 3 4
scan:   1 3 6 10
```

Use case:

- running total;
- cumulative severity;
- state progression;
- prefix computation.

#### `fold`

`fold` mirip reduction yang menghasilkan satu output di akhir, tetapi sebagai gatherer ia tetap bagian dari intermediate stream.

Use case:

- custom aggregation dalam pipeline;
- staged aggregation;
- many-to-one transformation.

#### `mapConcurrent`

`mapConcurrent` menjalankan mapping function secara concurrent dengan limit.

Konsep:

```java
List<Result> results = inputs.stream()
        .gather(Gatherers.mapConcurrent(8, this::expensiveCall))
        .toList();
```

Ini lebih eksplisit daripada `parallelStream()` karena ada limit concurrency. Namun tetap harus dirancang dengan timeout, cancellation, dan failure model.

---

### 14.6 Gatherer vs Collector

| Aspek | Collector | Gatherer |
|---|---|---|
| Posisi | Terminal operation | Intermediate operation |
| Input | Stream element | Stream element |
| Output | Non-stream final result | Stream output baru |
| Contoh | `toList`, `groupingBy` | `windowFixed`, `scan` |
| Extension point | `collect(...)` | `gather(...)` |
| Bisa continue pipeline | Tidak | Ya |

Contoh collector:

```java
Map<CaseStatus, Long> countByStatus = cases.stream()
        .collect(Collectors.groupingBy(CaseRecord::status, Collectors.counting()));
```

Contoh gatherer:

```java
List<List<CaseRecord>> batches = cases.stream()
        .gather(Gatherers.windowFixed(100))
        .toList();
```

---

### 14.7 Kapan Memakai Gatherer?

Gunakan gatherer jika operasi kamu adalah intermediate operation reusable yang:

- butuh state internal;
- mengubah cardinality input-output;
- butuh windowing/batching;
- butuh short-circuit custom;
- sulit diekspresikan dengan `map/filter/flatMap` tanpa side effect;
- ingin tetap berada dalam Stream pipeline.

Jangan gunakan gatherer jika:

- loop biasa lebih jelas;
- logic domain lebih baik sebagai service/method eksplisit;
- operasi terlalu kompleks dan butuh observability step-by-step;
- error handling perlu granular;
- tim belum familiar dan readability akan turun.

Rule:

```text
Gatherer adalah alat untuk membuat intermediate operation yang reusable,
bukan izin untuk menaruh stateful magic tersembunyi di pipeline.
```

---

## 15. Functional Style dalam Domain Modeling

### 15.1 Policy sebagai Predicate

```java
record CaseRecord(
        String id,
        CaseStatus status,
        int severity,
        boolean assigned,
        Set<String> flags
) {}

enum CaseStatus {
    OPEN, UNDER_REVIEW, ESCALATED, CLOSED
}

final class CasePredicates {
    static Predicate<CaseRecord> active() {
        return c -> c.status() != CaseStatus.CLOSED;
    }

    static Predicate<CaseRecord> highSeverity() {
        return c -> c.severity() >= 8;
    }

    static Predicate<CaseRecord> assigned() {
        return CaseRecord::assigned;
    }

    static Predicate<CaseRecord> notSuppressed() {
        return c -> !c.flags().contains("NO_ESCALATION");
    }

    static Predicate<CaseRecord> escalationCandidate() {
        return active()
                .and(highSeverity())
                .and(assigned())
                .and(notSuppressed());
    }
}
```

Penggunaan:

```java
List<CaseRecord> candidates = cases.stream()
        .filter(CasePredicates.escalationCandidate())
        .toList();
```

---

### 15.2 Mapper sebagai Function

```java
record CaseSummary(String id, String label, int severity) {}

final class CaseMappers {
    static CaseSummary toSummary(CaseRecord c) {
        return new CaseSummary(
                c.id(),
                c.status() + ":" + c.severity(),
                c.severity()
        );
    }
}
```

```java
List<CaseSummary> summaries = cases.stream()
        .filter(CasePredicates.active())
        .map(CaseMappers::toSummary)
        .toList();
```

---

### 15.3 Validation Pipeline

```java
@FunctionalInterface
interface Validator<T> {
    ValidationResult validate(T value);

    default Validator<T> and(Validator<T> other) {
        return value -> {
            ValidationResult first = this.validate(value);
            if (!first.valid()) {
                return first;
            }
            return other.validate(value);
        };
    }
}

record ValidationResult(boolean valid, String message) {
    static ValidationResult ok() {
        return new ValidationResult(true, "OK");
    }

    static ValidationResult failed(String message) {
        return new ValidationResult(false, message);
    }
}
```

Validators:

```java
Validator<CaseRecord> mustBeActive = c ->
        c.status() == CaseStatus.CLOSED
                ? ValidationResult.failed("Case is closed")
                : ValidationResult.ok();

Validator<CaseRecord> mustHaveSeverity = c ->
        c.severity() <= 0
                ? ValidationResult.failed("Severity must be positive")
                : ValidationResult.ok();

Validator<CaseRecord> validator = mustBeActive.and(mustHaveSeverity);
```

Ini contoh functional style yang memperjelas composition.

Namun jika validasi perlu mengumpulkan semua error, bukan fail-fast, desainnya berbeda:

```java
@FunctionalInterface
interface AccumulatingValidator<T> {
    List<String> validate(T value);

    default AccumulatingValidator<T> and(AccumulatingValidator<T> other) {
        return value -> Stream.concat(
                this.validate(value).stream(),
                other.validate(value).stream()
        ).toList();
    }
}
```

Perhatikan trade-off: `Stream.concat` berulang-ulang pada banyak validator bisa tidak ideal. Loop eksplisit mungkin lebih efisien.

---

### 15.4 Command Handler Registry

Functional interface bisa digunakan untuk registry behavior.

```java
sealed interface Command permits OpenCase, CloseCase, EscalateCase {}
record OpenCase(String id) implements Command {}
record CloseCase(String id) implements Command {}
record EscalateCase(String id, int severity) implements Command {}

@FunctionalInterface
interface CommandHandler<C extends Command> {
    void handle(C command);
}
```

Registry sederhana:

```java
final class CommandRegistry {
    private final Map<Class<? extends Command>, CommandHandler<? extends Command>> handlers = new HashMap<>();

    <C extends Command> void register(Class<C> type, CommandHandler<C> handler) {
        handlers.put(type, handler);
    }

    @SuppressWarnings("unchecked")
    <C extends Command> void dispatch(C command) {
        CommandHandler<C> handler = (CommandHandler<C>) handlers.get(command.getClass());
        if (handler == null) {
            throw new IllegalArgumentException("No handler for " + command.getClass().getName());
        }
        handler.handle(command);
    }
}
```

Penggunaan:

```java
CommandRegistry registry = new CommandRegistry();
registry.register(OpenCase.class, command -> openCase(command.id()));
registry.register(CloseCase.class, command -> closeCase(command.id()));
registry.register(EscalateCase.class, command -> escalateCase(command.id(), command.severity()));
```

Ini powerful, tetapi ada trade-off:

- generic cast tersembunyi;
- runtime dispatch by class;
- butuh testing registry;
- error jika handler tidak lengkap;
- sealed switch bisa lebih aman untuk closed hierarchy.

Alternatif dengan pattern switch:

```java
void dispatch(Command command) {
    switch (command) {
        case OpenCase c -> openCase(c.id());
        case CloseCase c -> closeCase(c.id());
        case EscalateCase c -> escalateCase(c.id(), c.severity());
    }
}
```

Rule:

```text
Functional registry bagus untuk extensibility.
Sealed switch bagus untuk exhaustiveness dan closed domain.
```

---

## 16. Debugging Functional Java

### 16.1 Stack Trace Lambda

Lambda stack trace sering berisi nama synthetic atau `lambda$method$0`.

Contoh:

```text
at MyService.lambda$process$2(MyService.java:42)
```

Tips:

- jangan buat pipeline terlalu panjang;
- ekstrak named method untuk logic penting;
- gunakan variable intermediate untuk debugging;
- jangan semua logic domain ditulis inline.

Buruk:

```java
return cases.stream()
        .filter(c -> c.status() != CLOSED && c.owner() != null && c.severity() > 7)
        .map(c -> new Dispatch(c.id(), c.owner().id(), compute(c)))
        .filter(d -> repository.exists(d.ownerId()) && service.isAllowed(d))
        .sorted(comparing(Dispatch::priority).reversed())
        .limit(100)
        .toList();
```

Lebih mudah di-debug:

```java
Predicate<CaseRecord> eligibleCase = CaseRules::isEligibleForDispatch;
Function<CaseRecord, Dispatch> toDispatch = this::toDispatch;
Predicate<Dispatch> dispatchAllowed = this::isDispatchAllowed;

return cases.stream()
        .filter(eligibleCase)
        .map(toDispatch)
        .filter(dispatchAllowed)
        .sorted(comparing(Dispatch::priority).reversed())
        .limit(100)
        .toList();
```

---

### 16.2 Logging di Stream

Untuk debugging lokal, `peek` boleh:

```java
cases.stream()
        .peek(c -> log.debug("before filter: {}", c.id()))
        .filter(CaseRules::isEligible)
        .peek(c -> log.debug("after filter: {}", c.id()))
        .toList();
```

Untuk production business logging, jangan bergantung pada `peek`.

Lebih baik logging di boundary:

```java
List<CaseRecord> eligible = cases.stream()
        .filter(CaseRules::isEligible)
        .toList();

log.info("Selected {} eligible cases from {} input cases", eligible.size(), cases.size());
```

Jika perlu audit per item, gunakan explicit loop atau service dengan semantics jelas.

---

### 16.3 Breakpoint di Lambda

IDE modern bisa breakpoint di lambda, tetapi readability tetap penting.

Jika lambda kompleks:

```java
.filter(c -> {
    boolean active = c.status() != CLOSED;
    boolean highSeverity = c.severity() >= 8;
    boolean hasOwner = c.ownerId() != null;
    return active && highSeverity && hasOwner;
})
```

Lebih baik ekstrak:

```java
.filter(CaseRules::isEscalationCandidate)
```

Lalu debug method itu.

---

## 17. Performance Engineering untuk Lambda dan Stream

### 17.1 Stream vs Loop

Stream tidak otomatis lebih cepat. Loop sering lebih cepat di hot path karena:

- less abstraction;
- fewer virtual calls;
- fewer allocations;
- easier JIT optimization;
- no pipeline object overhead;
- easier early exit with complex logic.

Stream bisa cukup cepat untuk banyak use case karena JIT dapat inline banyak operation. Tetapi jangan asumsi.

Rule:

```text
Gunakan stream untuk clarity.
Gunakan benchmark/profiling untuk performance decision.
```

---

### 17.2 Boxing Overhead

Buruk:

```java
int total = numbers.stream()
        .map(n -> n * 2)
        .reduce(0, Integer::sum);
```

Jika `numbers` adalah `List<Integer>`, tetap ada boxed integer.

Untuk range numerik:

```java
int total = IntStream.range(0, 1_000_000)
        .map(n -> n * 2)
        .sum();
```

Primitive streams:

- `IntStream`
- `LongStream`
- `DoubleStream`

---

### 17.3 Allocation

Pipeline seperti ini bisa menghasilkan banyak object intermediate jika mapping membuat object baru:

```java
List<CaseSummary> summaries = cases.stream()
        .map(this::toSummary)
        .toList();
```

Itu bukan masalah jika memang butuh DTO result.

Masalah jika hanya butuh count:

```java
long count = cases.stream()
        .map(this::toSummary)
        .filter(summary -> summary.severity() >= 8)
        .count();
```

Lebih baik:

```java
long count = cases.stream()
        .filter(c -> c.severity() >= 8)
        .count();
```

Rule:

```text
Jangan membuat object intermediate jika result akhir tidak membutuhkannya.
```

---

### 17.4 Sorting dan Comparator Cost

Comparator dipanggil banyak kali.

Buruk:

```java
items.stream()
        .sorted(Comparator.comparing(item -> expensiveCompute(item)))
        .toList();
```

Jika compute mahal, precompute key:

```java
record ScoredItem(Item item, int score) {}

List<Item> sorted = items.stream()
        .map(item -> new ScoredItem(item, expensiveCompute(item)))
        .sorted(Comparator.comparingInt(ScoredItem::score))
        .map(ScoredItem::item)
        .toList();
```

---

### 17.5 `flatMap` dan Banyak Stream Kecil

```java
orders.stream()
        .flatMap(order -> order.lines().stream())
        .toList();
```

Ini idiomatik. Tetapi di hot path besar, membuat banyak stream kecil bisa menambah overhead.

Loop bisa lebih efisien:

```java
List<OrderLine> lines = new ArrayList<>();
for (Order order : orders) {
    lines.addAll(order.lines());
}
```

Rule:

```text
Stream bagus untuk clarity; loop bagus untuk tight hot path dan kontrol memory.
```

---

## 18. Common Anti-Patterns

### 18.1 `forEach` untuk Mengumpulkan Result

Buruk:

```java
List<String> result = new ArrayList<>();
items.stream()
        .map(this::convert)
        .forEach(result::add);
```

Baik:

```java
List<String> result = items.stream()
        .map(this::convert)
        .toList();
```

---

### 18.2 Side Effect di `map`

Buruk:

```java
orders.stream()
        .map(order -> {
            order.markProcessed();
            return order;
        })
        .toList();
```

Baik jika immutable:

```java
orders.stream()
        .map(Order::processedCopy)
        .toList();
```

Atau loop eksplisit jika mutasi memang tujuan:

```java
for (Order order : orders) {
    order.markProcessed();
}
```

---

### 18.3 `peek` untuk Business Logic

Buruk:

```java
cases.stream()
        .peek(auditService::recordSelected)
        .filter(CaseRules::isEligible)
        .toList();
```

`peek` tidak sebaiknya menjadi tempat business side effect.

---

### 18.4 `parallelStream` untuk I/O

Buruk:

```java
ids.parallelStream()
        .map(repository::findById)
        .toList();
```

Gunakan concurrency primitive yang eksplisit.

---

### 18.5 Terlalu Banyak Logic Inline

Buruk:

```java
cases.stream()
        .filter(c -> c.status() != CLOSED && c.severity() > 8 && c.ownerId() != null && !c.flags().contains("X"))
        .map(c -> new Dto(c.id(), c.ownerId().toString(), c.status().name().toLowerCase()))
        .toList();
```

Baik:

```java
cases.stream()
        .filter(CaseRules::isDispatchCandidate)
        .map(CaseDtoMapper::toDto)
        .toList();
```

---

### 18.6 Stream Pipeline untuk Control Flow Kompleks

Buruk:

```java
requests.stream()
        .map(this::validate)
        .filter(Result::success)
        .map(Result::value)
        .map(this::authorize)
        .filter(Result::success)
        .map(Result::value)
        .map(this::execute)
        .toList();
```

Jika setiap step bisa gagal dengan reason berbeda, loop atau explicit workflow sering lebih defensible.

---

### 18.7 `toMap` Tanpa Duplicate Strategy

Buruk:

```java
Map<String, User> users = list.stream()
        .collect(Collectors.toMap(User::email, Function.identity()));
```

Jika duplicate email mungkin terjadi, buat keputusan eksplisit.

---

### 18.8 Null dalam Stream

Stream bisa membawa `null`, tetapi sebaiknya dihindari.

Buruk:

```java
List<String> result = values.stream()
        .map(this::maybeNull)
        .map(String::trim) // NPE
        .toList();
```

Lebih baik:

```java
List<String> result = values.stream()
        .map(this::maybeNull)
        .filter(Objects::nonNull)
        .map(String::trim)
        .toList();
```

Atau ubah API agar return `Optional`.

---

## 19. Decision Framework: Stream atau Loop?

Gunakan stream jika:

- transformasi data linear dan jelas;
- operasi pure/stateless;
- pipeline pendek sampai sedang;
- result adalah collection/map/reduction;
- declarative style meningkatkan readability;
- tidak butuh complex error handling per element.

Gunakan loop jika:

- ada banyak branching;
- error handling granular;
- butuh logging/audit per step;
- butuh early break kompleks;
- performance hot path;
- mutasi memang tujuan utama;
- debugging/observability lebih penting daripada ringkas;
- ada checked exception yang meaningful;
- workflow punya state machine/transition semantics.

Contoh stream cocok:

```java
List<String> activeIds = cases.stream()
        .filter(CaseRules::isActive)
        .map(CaseRecord::id)
        .toList();
```

Contoh loop lebih cocok:

```java
List<DispatchCommand> commands = new ArrayList<>();
for (CaseRecord c : cases) {
    ValidationResult validation = validator.validate(c);
    if (!validation.valid()) {
        audit.rejected(c.id(), validation.message());
        continue;
    }

    AuthorizationResult authorization = authorizer.authorize(c);
    if (!authorization.allowed()) {
        audit.denied(c.id(), authorization.reason());
        continue;
    }

    DispatchCommand command = mapper.toCommand(c);
    commands.add(command);
    audit.selected(c.id(), command.id());
}
```

Loop ini lebih panjang, tetapi lebih defensible untuk regulatory/audit workflow.

---

## 20. Production Guidelines

### 20.1 Untuk API Design

- Jangan expose `Stream` dari repository sebagai default. Stream memiliki lifecycle dan resource concern.
- Jika mengembalikan `Stream` dari API yang memakai resource, dokumentasikan siapa yang menutup resource.
- Prefer `List`, `Iterable`, `Page`, atau callback untuk API boundary yang jelas.
- Gunakan functional interface custom untuk domain behavior.
- Jangan jadikan `Function<T,R>` sebagai pengganti semua konsep domain.
- Jangan simpan stream di field.
- Jangan simpan lambda yang capture object besar tanpa sadar.

Contoh resource stream:

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines.filter(Predicate.not(String::isBlank)).count();
}
```

`Files.lines` harus ditutup.

---

### 20.2 Untuk Error Handling

- Jangan bungkus semua checked exception menjadi `RuntimeException` tanpa domain meaning.
- Jika error per element penting, modelkan sebagai result object.
- Jika fail-fast, gunakan explicit exception dengan message jelas.
- Jika partial success allowed, pisahkan success/failure.

Contoh:

```java
record ImportResult(List<Imported> imported, List<ImportFailure> failures) {}
record ImportFailure(String rowId, String reason) {}
```

---

### 20.3 Untuk Observability

- Jangan mengandalkan `peek` untuk audit.
- Log di boundary pipeline.
- Ekstrak named methods agar stack trace bermakna.
- Untuk batch besar, catat input size, output size, filtered count, error count, latency.
- Untuk stream dari file/resource, catat close/error behavior.

---

### 20.4 Untuk Performance

- Hindari boxing di hot numeric pipeline.
- Hindari `parallelStream` tanpa benchmark.
- Hindari comparator mahal.
- Hindari object intermediate yang tidak perlu.
- Hindari nested stream yang membuat banyak stream kecil di hot path.
- Gunakan JMH untuk microbenchmark.
- Gunakan JFR/async-profiler untuk real profiling.

---

## 21. Mini Project — Case Functional Pipeline

### 21.1 Requirement

Buat modul kecil untuk memilih case yang harus dieskalasi.

Input:

```java
record CaseRecord(
        String id,
        CaseStatus status,
        int severity,
        String ownerId,
        Set<String> flags,
        Instant createdAt
) {}

enum CaseStatus {
    OPEN, UNDER_REVIEW, ESCALATED, CLOSED
}
```

Rules:

1. case tidak boleh `CLOSED`;
2. severity minimal 8;
3. owner harus ada;
4. flags tidak boleh mengandung `NO_ESCALATION`;
5. case yang sudah `ESCALATED` boleh masuk tetapi diberi label berbeda;
6. output diurutkan severity descending, lalu createdAt ascending;
7. ambil maksimal 100 case;
8. hasil berupa `EscalationCandidate`.

Output:

```java
record EscalationCandidate(
        String caseId,
        String ownerId,
        int severity,
        String label
) {}
```

---

### 21.2 Implementasi

```java
final class EscalationRules {
    private EscalationRules() {}

    static boolean isNotClosed(CaseRecord c) {
        return c.status() != CaseStatus.CLOSED;
    }

    static boolean isHighSeverity(CaseRecord c) {
        return c.severity() >= 8;
    }

    static boolean hasOwner(CaseRecord c) {
        return c.ownerId() != null && !c.ownerId().isBlank();
    }

    static boolean isNotSuppressed(CaseRecord c) {
        return !c.flags().contains("NO_ESCALATION");
    }

    static boolean isEscalationCandidate(CaseRecord c) {
        return isNotClosed(c)
                && isHighSeverity(c)
                && hasOwner(c)
                && isNotSuppressed(c);
    }
}
```

Mapper:

```java
final class EscalationMapper {
    private EscalationMapper() {}

    static EscalationCandidate toCandidate(CaseRecord c) {
        return new EscalationCandidate(
                c.id(),
                c.ownerId(),
                c.severity(),
                label(c)
        );
    }

    private static String label(CaseRecord c) {
        return c.status() == CaseStatus.ESCALATED ? "ALREADY_ESCALATED" : "NEW_ESCALATION";
    }
}
```

Pipeline:

```java
final class EscalationSelector {
    List<EscalationCandidate> select(List<CaseRecord> cases) {
        return cases.stream()
                .filter(EscalationRules::isEscalationCandidate)
                .sorted(Comparator
                        .comparingInt(CaseRecord::severity).reversed()
                        .thenComparing(CaseRecord::createdAt))
                .limit(100)
                .map(EscalationMapper::toCandidate)
                .toList();
    }
}
```

Discussion:

- rule domain diekstrak;
- pipeline tetap readable;
- sorting sebelum mapping karena comparator butuh field domain;
- `limit` setelah sorting karena ingin top 100 by severity;
- result immutable secara structural jika record fields immutable;
- `toList()` menghasilkan unmodifiable list.

---

### 21.3 Testing

```java
class EscalationSelectorTest {
    @Test
    void selectsOnlyEligibleCases() {
        EscalationSelector selector = new EscalationSelector();

        List<CaseRecord> input = List.of(
                new CaseRecord("C1", CaseStatus.OPEN, 9, "U1", Set.of(), Instant.parse("2026-01-01T00:00:00Z")),
                new CaseRecord("C2", CaseStatus.CLOSED, 10, "U2", Set.of(), Instant.parse("2026-01-02T00:00:00Z")),
                new CaseRecord("C3", CaseStatus.OPEN, 7, "U3", Set.of(), Instant.parse("2026-01-03T00:00:00Z")),
                new CaseRecord("C4", CaseStatus.OPEN, 10, "U4", Set.of("NO_ESCALATION"), Instant.parse("2026-01-04T00:00:00Z"))
        );

        List<EscalationCandidate> result = selector.select(input);

        assertEquals(List.of(
                new EscalationCandidate("C1", "U1", 9, "NEW_ESCALATION")
        ), result);
    }
}
```

---

## 22. Latihan Bertahap

### Latihan 1 — Lambda Target Typing

Buat lambda yang sama:

```java
x -> x.length() > 3
```

Lalu assign ke:

- `Predicate<String>`;
- `Function<String, Boolean>`;
- custom interface `StringRule`.

Amati method yang dipanggil pada tiap interface.

---

### Latihan 2 — Method Reference

Ubah lambda berikut menjadi method reference jika readability membaik:

```java
s -> s.trim()
s -> Integer.parseInt(s)
(a, b) -> a.compareToIgnoreCase(b)
() -> new ArrayList<String>()
n -> new String[n]
```

Tentukan mana yang sebaiknya tetap lambda.

---

### Latihan 3 — Stream Pipeline

Diberikan list `CaseRecord`, buat pipeline untuk:

1. memilih active case;
2. mengambil owner ID;
3. membuang owner kosong;
4. distinct;
5. sort;
6. return list.

Versi pertama pakai lambda inline. Versi kedua ekstrak named methods.

Bandingkan readability.

---

### Latihan 4 — Collector

Buat `Map<CaseStatus, Long>` count by status.

Lalu buat `EnumMap<CaseStatus, Long>`.

Lalu buat `Map<CaseStatus, List<String>>` berisi ID case per status.

---

### Latihan 5 — Duplicate Key

Diberikan list case dengan duplicate ID, buat map:

1. fail jika duplicate;
2. ambil yang terbaru;
3. ambil severity tertinggi;
4. kumpulkan semua duplicate ke list.

---

### Latihan 6 — Parallel Stream Trap

Buat program yang memakai `parallelStream().forEach(result::add)` ke `ArrayList`.

Amati hasil/race.

Perbaiki dengan collector.

---

### Latihan 7 — Gatherers

Dengan Java 25, gunakan `Gatherers.windowFixed(100)` untuk membagi list case menjadi batch 100.

Untuk setiap batch, hitung jumlah high severity case.

Pikirkan:

- apakah order penting?
- apakah batch terakhir boleh kurang dari 100?
- apakah memory aman?
- apakah lebih baik loop eksplisit?

---

## 23. Checklist Pemahaman

Kamu dianggap memahami bagian ini jika bisa menjawab:

1. Mengapa lambda butuh target type?
2. Apa bedanya lambda dan anonymous class dalam konteks `this`?
3. Apa arti effectively final?
4. Mengapa `final List<T>` tetap bisa dimutasi?
5. Apa itu functional interface?
6. Kapan membuat custom functional interface lebih baik daripada `Function<T,R>`?
7. Apa beda `Function`, `Consumer`, `Supplier`, `Predicate`, `UnaryOperator`, `BinaryOperator`?
8. Mengapa primitive specialization penting?
9. Apa beda static, bound instance, unbound instance, dan constructor method reference?
10. Mengapa stream lazy?
11. Apa yang memicu eksekusi stream?
12. Mengapa stream single-use?
13. Apa itu non-interference?
14. Mengapa stateful lambda berbahaya di stream?
15. Apa beda `map` dan `flatMap`?
16. Kapan `peek` boleh digunakan?
17. Apa beda `reduce` dan `collect`?
18. Mengapa identity dan associativity penting untuk reduce?
19. Apa empat komponen collector?
20. Apa risiko `toMap` tanpa merge function?
21. Kapan parallel stream membantu?
22. Mengapa parallel stream buruk untuk network/database call?
23. Apa itu Gatherer?
24. Apa beda Gatherer dan Collector?
25. Kapan loop lebih baik daripada stream?

---

## 24. Ringkasan Mental Model

Functional Java yang baik bukan tentang membuat semua kode menjadi stream pipeline.

Functional Java yang baik adalah kemampuan untuk:

- memperlakukan behavior sebagai value;
- membuat policy composable;
- membuat transformation eksplisit;
- mengurangi noise imperative ketika cocok;
- menjaga side effect tetap di boundary yang jelas;
- mempertahankan observability;
- memahami runtime dan performance cost;
- memilih loop ketika loop lebih benar.

Core rule:

```text
Use lambda to pass behavior.
Use functional interface to name behavior shape.
Use method reference to reuse named behavior.
Use stream to express data transformation.
Use collector to express terminal accumulation.
Use gatherer to express reusable intermediate transformation.
Use loop when control flow, error handling, auditability, or performance needs explicitness.
```

Java modern memberi banyak alat functional, tetapi top-tier engineer tetap memilih berdasarkan semantics, bukan gaya.

---

## 25. Referensi Resmi dan Lanjutan

Referensi utama:

1. Java Language Specification SE 25 — Lambda Expressions, Method Reference Expressions, Type Inference, Evaluation Order  
   https://docs.oracle.com/javase/specs/jls/se25/html/index.html

2. Java SE 25 API — `java.util.function`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/package-summary.html

3. Java SE 25 API — `java.util.stream.Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

4. Java SE 25 API — `java.util.stream` package summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

5. Java SE 25 API — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

6. Java SE 25 API — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

7. Java SE 25 API — `Gatherer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherer.html

8. Java SE 25 API — `Gatherers`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html

9. JEP 485 — Stream Gatherers  
   https://openjdk.org/jeps/485

10. Oracle Java Tutorials — Lambda Expressions  
    https://docs.oracle.com/javase/tutorial/java/javaOO/lambdaexpressions.html

---

## 26. Catatan untuk Lanjut ke Bagian 7

Bagian ini sengaja membahas stream dan functional style sebelum collections deep dive.

Di Bagian 7, kita akan turun lebih dalam ke:

- `List`, `Set`, `Map`, `Queue`, `Deque`;
- `ArrayList`, `LinkedList`, `HashMap`, `TreeMap`, `ConcurrentHashMap`;
- hashing, collision, load factor, resizing;
- immutable collections;
- algorithmic complexity;
- memory layout dan performance semantics.

Functional pipeline sering bekerja di atas collections. Tanpa memahami collections, stream pipeline hanya terlihat cantik tetapi tidak jelas biayanya.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-part-005.md">⬅️ Learn Java Part 005 — Modern Java Language Features</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-part-007.md">Learn Java Part 007 — Collections, Data Structures, dan Performance Semantics ➡️</a>
</div>

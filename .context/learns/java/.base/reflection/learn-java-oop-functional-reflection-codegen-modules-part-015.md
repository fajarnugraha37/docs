# learn-java-oop-functional-reflection-codegen-modules-part-015

# Lambdas Under the Hood: Capture, Target Typing, `invokedynamic`, and SAM

> Seri: **Java OOP, Functional, Reflection, Code Generation, Modules & Package Management**  
> Part: **015 / 030**  
> Topik: **Lambda expressions dari sudut language semantics, compiler typing, runtime translation, dan desain API**

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya, kita membangun mental model functional Java: function sebagai nilai, purity, effect boundary, deterministic decision, dan functional core / imperative shell.

Part ini masuk lebih rendah: **apa sebenarnya lambda di Java?**

Banyak engineer memakai lambda setiap hari:

```java
users.stream()
    .filter(user -> user.isActive())
    .map(User::email)
    .toList();
```

Tapi untuk menjadi engineer yang kuat, kita perlu tahu:

1. lambda bukan object literal biasa;
2. lambda tidak punya type sendiri secara mandiri;
3. lambda selalu butuh **target type**;
4. target type harus berupa **functional interface**;
5. captured variable harus final atau effectively final;
6. `this` dalam lambda berbeda dari `this` dalam anonymous class;
7. runtime lambda tidak wajib dikompilasi menjadi anonymous inner class;
8. Java menggunakan mekanisme `invokedynamic` dan `LambdaMetafactory` untuk implementasi umum lambda;
9. lambda dapat mempengaruhi API design, error handling, observability, debugging, reflection, serialization, code generation, dan modular boundary.

Jadi tujuan part ini bukan menghafal syntax lambda. Tujuannya adalah memahami **semantic contract** dan **runtime implication**.

---

## 1. Mental Model Utama

Lambda di Java adalah **expression yang merepresentasikan implementasi dari satu abstract method milik functional interface**, dengan type ditentukan oleh konteks pemakaian.

Contoh:

```java
Predicate<String> nonBlank = s -> !s.isBlank();
```

Lambda:

```java
s -> !s.isBlank()
```

bukan punya type intrinsik seperti `Lambda<String, Boolean>`.

Type-nya muncul karena konteks kiri:

```java
Predicate<String>
```

`Predicate<T>` punya satu abstract method:

```java
boolean test(T value);
```

Maka compiler membaca lambda tersebut sebagai implementasi dari:

```java
boolean test(String s) {
    return !s.isBlank();
}
```

Dengan kata lain:

```text
lambda expression
  + target type
  + functional interface method
  = executable function object
```

Tanpa target type, lambda tidak bisa berdiri sendiri.

Ini berbeda dari beberapa bahasa lain yang punya function type native seperti:

```text
(String) -> Boolean
```

Java tidak memiliki function type sebagai first-class type di source language. Java memakai **interface** sebagai carrier untuk function.

---

## 2. Lambda Bukan Sekadar Syntax Sugar Untuk Anonymous Class

Secara desain, lambda memang terasa seperti versi ringkas anonymous class:

```java
Runnable r1 = new Runnable() {
    @Override
    public void run() {
        System.out.println("Hello");
    }
};

Runnable r2 = () -> System.out.println("Hello");
```

Tapi secara semantic dan runtime, keduanya tidak identik.

Perbedaan penting:

| Aspek | Anonymous Class | Lambda |
|---|---|---|
| Type source-level | Anonymous subclass/class implementation | Expression dengan target functional interface |
| `this` | instance anonymous class | enclosing instance |
| Class identity | class baru eksplisit di bytecode/class file model | runtime translation lebih fleksibel |
| Field tambahan | bisa punya field instance | tidak punya field deklaratif sendiri |
| Constructor | anonymous class bisa punya initializer | lambda tidak punya constructor source-level |
| Capture | captured value disimpan pada object anonymous class | captured value diteruskan ke lambda object/runtime factory |
| Intent | object implementation | function behavior |

Jadi statement “lambda adalah anonymous class yang dipersingkat” berguna untuk pemula, tapi tidak cukup untuk engineer senior.

Mental model yang lebih tepat:

```text
Anonymous class = object-oriented local implementation.
Lambda          = target-typed function body converted into functional interface instance.
```

---

## 3. Functional Interface dan SAM

Lambda hanya bisa dikonversi ke **functional interface**.

Functional interface adalah interface yang memiliki tepat satu abstract method yang harus diimplementasikan.

Contoh:

```java
@FunctionalInterface
interface Rule<T> {
    boolean allows(T value);
}
```

Lambda:

```java
Rule<Integer> positive = number -> number > 0;
```

mengimplementasikan method:

```java
boolean allows(Integer value);
```

Istilah umum: **SAM** — Single Abstract Method.

Namun “single abstract method” perlu dipahami dengan detail:

```java
@FunctionalInterface
interface NamedRule<T> {
    boolean allows(T value);

    default String name() {
        return getClass().getSimpleName();
    }

    static <T> NamedRule<T> alwaysTrue() {
        return value -> true;
    }
}
```

Interface ini tetap functional interface karena hanya punya satu abstract method: `allows`.

Default method tidak dihitung sebagai abstract method. Static method juga tidak dihitung.

---

## 4. Mengapa `@FunctionalInterface` Penting

Annotation ini tidak wajib:

```java
interface Rule<T> {
    boolean allows(T value);
}
```

Tetap bisa dipakai untuk lambda.

Tapi untuk API serius, gunakan:

```java
@FunctionalInterface
interface Rule<T> {
    boolean allows(T value);
}
```

Manfaatnya:

1. compiler memastikan interface tetap functional;
2. pembaca tahu interface ini memang didesain untuk lambda;
3. perubahan API tidak diam-diam merusak pemakaian lambda;
4. dokumentasi intent lebih jelas.

Contoh bahaya tanpa annotation:

```java
interface Rule<T> {
    boolean allows(T value);

    boolean rejects(T value); // tambahan baru
}
```

Semua lambda yang sebelumnya assignable ke `Rule<T>` akan gagal compile karena interface tidak lagi functional.

Dengan `@FunctionalInterface`, perubahan itu langsung ditolak oleh compiler pada definisi interface.

Rule desain:

> Jika interface memang dimaksudkan sebagai lambda target, selalu beri `@FunctionalInterface`.

---

## 5. Target Typing: Lambda Tidak Punya Type Sendiri

Lambda memerlukan target type.

Valid:

```java
Predicate<String> p = s -> s.length() > 3;
```

Tidak valid:

```java
var p = s -> s.length() > 3; // compile error
```

Mengapa?

Karena `var` membutuhkan initializer yang sudah punya type pasti. Lambda justru membutuhkan konteks target type untuk mengetahui type parameter dan return expectation.

Valid jika target type diberikan melalui cast:

```java
var p = (Predicate<String>) s -> s.length() > 3;
```

Tapi ini biasanya tidak lebih baik dari deklarasi eksplisit.

Target type bisa datang dari:

1. assignment;
2. method parameter;
3. cast;
4. conditional expression;
5. return context;
6. overload resolution context.

Contoh assignment:

```java
Function<String, Integer> length = s -> s.length();
```

Contoh method parameter:

```java
void register(Predicate<String> predicate) {
    // ...
}

register(s -> s.startsWith("A"));
```

Contoh return context:

```java
Predicate<String> activeNameRule() {
    return name -> !name.isBlank();
}
```

Contoh cast:

```java
Object obj = (Runnable) () -> System.out.println("run");
```

---

## 6. Target Type Menentukan Parameter dan Return

Lambda body dianalisis terhadap method signature functional interface.

```java
@FunctionalInterface
interface Transformer<I, O> {
    O transform(I input);
}

Transformer<String, Integer> length = s -> s.length();
```

Compiler menyimpulkan:

```text
s      : String
return : Integer/int-compatible
```

Karena target method:

```java
Integer transform(String input);
```

Parameter bisa ditulis eksplisit:

```java
Transformer<String, Integer> length = (String s) -> s.length();
```

Atau implisit:

```java
Transformer<String, Integer> length = s -> s.length();
```

Untuk banyak parameter:

```java
BiFunction<Integer, Integer, Integer> add = (a, b) -> a + b;
```

Parameter type tidak boleh dicampur sebagian:

```java
// Tidak valid
// BiFunction<Integer, Integer, Integer> add = (Integer a, b) -> a + b;
```

Pilih salah satu:

```java
BiFunction<Integer, Integer, Integer> add1 = (a, b) -> a + b;
BiFunction<Integer, Integer, Integer> add2 = (Integer a, Integer b) -> a + b;
```

---

## 7. Expression Lambda vs Block Lambda

Ada dua bentuk umum.

Expression lambda:

```java
Function<String, Integer> length = s -> s.length();
```

Block lambda:

```java
Function<String, Integer> length = s -> {
    if (s == null) {
        return 0;
    }
    return s.length();
};
```

Expression lambda lebih cocok untuk transformasi singkat.

Block lambda cocok saat:

1. ada branching;
2. perlu validasi;
3. perlu local variable;
4. perlu logging kecil;
5. logic masih cukup lokal.

Namun block lambda panjang sering menjadi smell.

Buruk:

```java
orders.forEach(order -> {
    validate(order);
    var customer = customerRepository.findById(order.customerId()).orElseThrow();
    var invoice = invoiceService.generate(order, customer);
    emailService.send(invoice);
    auditService.record(order.id(), "INVOICE_SENT");
});
```

Ini bukan lagi lambda sebagai small behavior. Ini workflow tersembunyi.

Lebih baik:

```java
orders.forEach(this::processOrderInvoice);
```

Dengan method bernama:

```java
private void processOrderInvoice(Order order) {
    validate(order);
    var customer = customerRepository.findById(order.customerId()).orElseThrow();
    var invoice = invoiceService.generate(order, customer);
    emailService.send(invoice);
    auditService.record(order.id(), "INVOICE_SENT");
}
```

Rule desain:

> Lambda yang terlalu panjang biasanya kehilangan salah satu manfaat terpentingnya: local readability.

---

## 8. Capture Semantics: Apa yang Boleh Diakses Lambda?

Lambda bisa mengakses:

1. parameter lambda;
2. local variable yang final atau effectively final;
3. field instance;
4. field static;
5. method instance;
6. method static;
7. `this` dari enclosing scope.

Contoh:

```java
class Prefixer {
    private final String prefix;

    Prefixer(String prefix) {
        this.prefix = prefix;
    }

    Function<String, String> create() {
        String separator = ":";
        return value -> prefix + separator + value;
    }
}
```

Lambda menangkap:

```text
this.prefix  -> melalui enclosing instance
separator    -> captured local value
value        -> lambda parameter
```

---

## 9. Effectively Final

Local variable yang dicapture harus final atau effectively final.

Valid:

```java
String prefix = "ID-";
Function<Integer, String> f = n -> prefix + n;
```

Karena `prefix` tidak diubah setelah assignment.

Tidak valid:

```java
String prefix = "ID-";
Function<Integer, String> f = n -> prefix + n;
prefix = "NO-"; // membuat prefix tidak effectively final
```

Tidak valid juga:

```java
int count = 0;
Runnable r = () -> System.out.println(count);
count++;
```

Mengapa Java membatasi ini?

Mental model sederhana:

Local variable hidup di stack frame method. Lambda dapat hidup lebih lama dari method yang membuatnya. Jika lambda bisa menangkap local variable mutable secara langsung, Java harus memperkenalkan model closure mutable dengan semantics tambahan.

Java memilih model yang lebih sederhana:

```text
Captured local variable = captured value, not mutable local variable slot.
```

Maka variable harus final/effectively final.

---

## 10. Capturing Reference Bukan Berarti Object-nya Immutable

Ini jebakan penting.

```java
List<String> names = new ArrayList<>();
Runnable r = () -> names.add("A");
r.run();
```

Ini valid.

Kenapa?

Karena variable `names` tidak direassign. Reference-nya effectively final.

Yang berubah adalah object yang direferensikan, bukan variable local-nya.

Dengan kata lain:

```text
final reference != immutable object
```

Bahaya:

```java
List<String> errors = new ArrayList<>();
records.forEach(record -> {
    if (!isValid(record)) {
        errors.add("Invalid: " + record.id());
    }
});
```

Ini tampak praktis, tapi ada risiko:

1. jika collection diproses parallel, mutable shared list bisa rusak;
2. side effect tersembunyi dalam lambda;
3. sulit dites sebagai pure transformation;
4. ordering bisa jadi implicit assumption.

Lebih aman untuk sequential sederhana:

```java
List<String> errors = records.stream()
    .filter(record -> !isValid(record))
    .map(record -> "Invalid: " + record.id())
    .toList();
```

Atau jika perlu akumulasi kompleks, gunakan collector yang sesuai.

---

## 11. Capture dan Lifetime Object

Saat lambda menangkap object, lambda dapat memperpanjang lifetime object tersebut.

Contoh:

```java
class LargeContext {
    private final byte[] buffer = new byte[100_000_000];

    Runnable createTask() {
        return () -> System.out.println(buffer.length);
    }
}
```

Jika `Runnable` disimpan lama, `LargeContext` atau minimal captured state bisa ikut hidup lama.

Lebih subtle:

```java
class CaseService {
    private final HeavyCache cache;
    private final AuditClient auditClient;

    Runnable createAuditTask(String caseId) {
        return () -> auditClient.record(caseId);
    }
}
```

Lambda menggunakan `auditClient`, tetapi karena aksesnya melalui `this`, capture bisa melibatkan enclosing instance tergantung bentuk translasi dan referensi yang dibutuhkan.

Lebih eksplisit:

```java
Runnable createAuditTask(String caseId) {
    AuditClient audit = this.auditClient;
    return () -> audit.record(caseId);
}
```

Ini menurunkan risiko lambda membawa seluruh service object secara konseptual.

Rule desain:

> Untuk lambda yang disimpan lama, dijalankan async, atau masuk queue, capture state sesedikit mungkin dan buat dependency eksplisit.

---

## 12. `this` Dalam Lambda vs Anonymous Class

Perbedaan ini sangat penting.

```java
class Example {
    void run() {
        Runnable anonymous = new Runnable() {
            @Override
            public void run() {
                System.out.println(this.getClass().getName());
            }
        };

        Runnable lambda = () -> System.out.println(this.getClass().getName());
    }
}
```

Dalam anonymous class:

```java
this
```

mengacu ke instance anonymous class.

Dalam lambda:

```java
this
```

mengacu ke enclosing `Example` instance.

Implikasi:

1. lambda tidak memperkenalkan `this` baru;
2. lambda lebih seperti lexical scope;
3. anonymous class lebih seperti local object declaration;
4. porting anonymous class ke lambda bisa mengubah behavior jika menggunakan `this`.

Contoh bug:

```java
class ListenerRegistry {
    void register(Runnable listener) {
        // ...
    }

    void setup() {
        register(new Runnable() {
            @Override
            public void run() {
                unregister(this); // this = listener anonymous object
            }
        });
    }

    void unregister(Object listener) {
        // ...
    }
}
```

Jika diubah sembarangan:

```java
void setup() {
    register(() -> unregister(this)); // this = ListenerRegistry, not listener
}
```

Behavior berubah.

---

## 13. Shadowing dan Scope

Lambda tidak memperkenalkan scope untuk nama local variable dengan cara yang sama seperti anonymous class.

Contoh:

```java
void process(String value) {
    Function<String, String> f = value -> value.trim(); // tidak valid
}
```

Parameter lambda `value` konflik dengan local parameter method `value`.

Gunakan nama lain:

```java
void process(String value) {
    Function<String, String> f = input -> input.trim();
}
```

Anonymous class dapat punya parameter method yang shadowing field/class member dengan cara berbeda, tapi untuk lambda, pikirkan lexical scope secara lebih ketat.

Rule readability:

> Nama parameter lambda harus menjelaskan role lokal, bukan sekadar `x`, kecuali fungsi benar-benar matematis atau sangat pendek.

Baik:

```java
orders.stream()
    .filter(order -> order.status() == OrderStatus.SUBMITTED)
    .map(order -> order.id())
    .toList();
```

Cukup untuk konteks pendek:

```java
numbers.stream()
    .map(n -> n * n)
    .toList();
```

Buruk untuk domain complex:

```java
cases.stream()
    .filter(x -> x.getA() != null && x.getB().isAfter(now) && x.getC() > 3)
    .toList();
```

Lebih baik:

```java
cases.stream()
    .filter(this::isEscalationCandidate)
    .toList();
```

---

## 14. Method Reference

Method reference adalah bentuk ringkas lambda saat lambda hanya memanggil method/constructor tertentu.

Contoh:

```java
Function<String, Integer> length = String::length;
```

Setara secara konseptual dengan:

```java
Function<String, Integer> length = value -> value.length();
```

Jenis umum:

| Bentuk | Contoh | Makna |
|---|---|---|
| Static method | `Integer::parseInt` | `s -> Integer.parseInt(s)` |
| Bound instance method | `printer::print` | `x -> printer.print(x)` |
| Unbound instance method | `String::length` | `s -> s.length()` |
| Constructor | `ArrayList::new` | `() -> new ArrayList<>()` atau sesuai target |
| Array constructor | `String[]::new` | `n -> new String[n]` |

Method reference sangat bagus jika nama method sudah menyampaikan intent.

Baik:

```java
users.stream()
    .map(User::email)
    .toList();
```

Buruk jika membuat pembaca harus memecahkan overload rumit:

```java
processor.register(this::handle);
```

Jika ada banyak overload `handle`, lambda eksplisit bisa lebih jelas:

```java
processor.register(event -> handleCaseSubmitted(event));
```

Rule desain:

> Method reference bagus ketika meningkatkan signal. Jangan pakai jika membuat binding method menjadi teka-teki overload.

---

## 15. Constructor Reference

Constructor reference menggunakan target functional interface untuk menentukan constructor mana yang dipanggil.

```java
Supplier<List<String>> listFactory = ArrayList::new;
```

Setara:

```java
Supplier<List<String>> listFactory = () -> new ArrayList<>();
```

Dengan parameter:

```java
Function<Integer, List<String>> sizedListFactory = ArrayList::new;
```

Setara:

```java
Function<Integer, List<String>> sizedListFactory = capacity -> new ArrayList<>(capacity);
```

Constructor reference berguna untuk factory injection:

```java
final class BatchProcessor<T, C extends Collection<T>> {
    private final Supplier<C> collectionFactory;

    BatchProcessor(Supplier<C> collectionFactory) {
        this.collectionFactory = collectionFactory;
    }

    C collect(List<T> input) {
        C result = collectionFactory.get();
        result.addAll(input);
        return result;
    }
}

var processor = new BatchProcessor<String, ArrayList<String>>(ArrayList::new);
```

Namun hati-hati jika constructor punya side effect atau hidden dependency.

Buruk:

```java
Supplier<ReportClient> factory = ReportClient::new; // constructor membuka connection?
```

Lebih baik dependency berat dibuat eksplisit oleh composition root/DI container.

---

## 16. Lambda dan Overload Resolution

Lambda bisa membuat overload ambigu.

Contoh:

```java
void process(Function<String, Integer> function) {}
void process(Predicate<String> predicate) {}

process(s -> s.length());
```

Ini memilih `Function<String, Integer>` karena return expression `s.length()` menghasilkan integer-compatible value.

Tapi contoh ini bisa ambigu:

```java
void register(Consumer<String> consumer) {}
void register(Function<String, Void> function) {}

register(s -> System.out.println(s));
```

Block/expression compatibility dapat mempengaruhi pemilihan overload.

Lebih berbahaya:

```java
void handle(Callable<String> callable) {}
void handle(Supplier<String> supplier) {}

handle(() -> "value"); // ambiguous
```

Karena keduanya compatible dengan lambda tanpa parameter yang return `String`.

Solusi:

```java
handle((Supplier<String>) () -> "value");
```

Atau desain API jangan membuat overload dengan shape lambda yang mirip.

Rule API design:

> Hindari overload method yang hanya berbeda pada functional interface dengan signature lambda serupa.

Buruk:

```java
void onFailure(Consumer<Throwable> handler) {}
void onFailure(Function<Throwable, ErrorResponse> mapper) {}
```

Lebih jelas:

```java
void onFailureDo(Consumer<Throwable> handler) {}
void onFailureMap(Function<Throwable, ErrorResponse> mapper) {}
```

---

## 17. Lambda Body Compatibility: `void` vs Value

Functional interface method bisa `void` atau return value.

```java
Consumer<String> print = s -> System.out.println(s);
Function<String, Integer> length = s -> s.length();
```

Ada expression yang bisa compatible dengan void dan value context.

Contoh method invocation expression:

```java
list -> list.add("x")
```

`List.add` return boolean. Lambda ini bisa cocok untuk:

```java
Predicate<List<String>> p = list -> list.add("x");
```

Tapi secara desain ini buruk karena predicate mengubah list.

Bisa juga sebagai consumer jika statement expression dipakai dalam void-compatible context:

```java
Consumer<List<String>> c = list -> list.add("x");
```

Perhatikan: bentuk yang sama bisa punya makna berbeda tergantung target type.

Rule desain:

> Jika expression punya side effect dan return value, jangan biarkan target typing menyembunyikan intent. Gunakan block lambda bila perlu.

Lebih jelas:

```java
Consumer<List<String>> c = list -> {
    list.add("x");
};
```

---

## 18. Checked Exception Problem

Functional interfaces standar `java.util.function` tidak mendeklarasikan checked exception.

Contoh:

```java
Function<Path, String> read = path -> Files.readString(path); // compile error
```

`Files.readString` dapat melempar `IOException`.

Solusi buruk:

```java
Function<Path, String> read = path -> {
    try {
        return Files.readString(path);
    } catch (IOException e) {
        throw new RuntimeException(e);
    }
};
```

Ini kadang acceptable di boundary tertentu, tapi jangan dilakukan tanpa sadar.

Pilihan desain:

### 18.1 Tangani exception dekat sumber

```java
List<String> lines = new ArrayList<>();
for (Path path : paths) {
    try {
        lines.add(Files.readString(path));
    } catch (IOException e) {
        log.warn("Cannot read path {}", path, e);
    }
}
```

### 18.2 Buat throwing functional interface

```java
@FunctionalInterface
interface ThrowingFunction<T, R, E extends Exception> {
    R apply(T value) throws E;
}
```

Lalu adapter:

```java
static <T, R> Function<T, R> unchecked(ThrowingFunction<T, R, ?> function) {
    return value -> {
        try {
            return function.apply(value);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    };
}
```

Pemakaian:

```java
List<String> contents = paths.stream()
    .map(unchecked(Files::readString))
    .toList();
```

Tapi adapter seperti ini harus dipakai hati-hati. Ia mengubah error channel dari checked ke unchecked.

### 18.3 Gunakan result type

```java
sealed interface ReadResult permits ReadResult.Success, ReadResult.Failure {
    record Success(Path path, String content) implements ReadResult {}
    record Failure(Path path, IOException error) implements ReadResult {}
}

static ReadResult read(Path path) {
    try {
        return new ReadResult.Success(path, Files.readString(path));
    } catch (IOException e) {
        return new ReadResult.Failure(path, e);
    }
}

List<ReadResult> results = paths.stream()
    .map(MyReader::read)
    .toList();
```

Ini lebih eksplisit untuk batch processing.

Rule desain:

> Checked exception dalam lambda memaksa keputusan arsitektural: apakah error menjadi exception, data, skip, retry, atau failure event?

---

## 19. Lambda dan Side Effect

Lambda sering dipakai dalam pipeline. Semakin banyak side effect di dalamnya, semakin sulit reasoning.

Buruk:

```java
Map<String, Integer> counts = new HashMap<>();
items.forEach(item -> counts.merge(item.category(), 1, Integer::sum));
```

Untuk sequential kecil ini mungkin acceptable, tapi untuk stream pipeline lebih baik:

```java
Map<String, Long> counts = items.stream()
    .collect(Collectors.groupingBy(Item::category, Collectors.counting()));
```

Side effect berbahaya saat:

1. lambda dijalankan lazy;
2. lambda dijalankan lebih dari sekali;
3. lambda dijalankan parallel;
4. lambda disimpan dan dipanggil nanti;
5. lambda dieksekusi framework dalam transaction berbeda;
6. lambda digunakan untuk retry;
7. lambda dipakai sebagai callback async.

Contoh retry hazard:

```java
retry.execute(() -> {
    audit.record("attempt");
    return externalClient.submit(command);
});
```

Jika retry 3 kali, audit juga 3 kali. Mungkin benar, mungkin salah.

Lebih eksplisit:

```java
retry.execute(() -> externalClient.submit(command));
audit.record("submitted-after-retry-success");
```

Atau audit attempt memang dimodelkan:

```java
retry.execute(attempt -> {
    audit.recordAttempt(command.id(), attempt.number());
    return externalClient.submit(command);
});
```

Rule desain:

> Lambda tidak membuat side effect menjadi aman. Ia hanya membuat side effect lebih mudah disembunyikan.

---

## 20. Lambda dan Laziness

Lambda sering dipakai untuk menunda eksekusi.

Contoh `Supplier`:

```java
String value = cache.getOrCompute(key, () -> expensiveCalculation(key));
```

`expensiveCalculation` hanya dijalankan jika dibutuhkan.

Ini sangat berguna untuk:

1. lazy fallback;
2. lazy error message;
3. lazy resource creation;
4. lazy retry operation;
5. lazy transaction callback;
6. lazy authorization check;
7. lazy test fixture.

Contoh lazy exception:

```java
User user = repository.findById(id)
    .orElseThrow(() -> new UserNotFoundException(id));
```

Exception object baru dibuat hanya jika optional kosong.

Namun laziness bisa menjebak.

```java
Supplier<String> supplier = () -> requestContext.currentUserId();
```

Jika supplier dijalankan setelah request selesai, context bisa hilang atau berubah.

Lebih aman:

```java
String userId = requestContext.currentUserId();
Supplier<String> supplier = () -> userId;
```

Rule desain:

> Untuk lambda yang dieksekusi nanti, bedakan antara menangkap value sekarang dan membaca context nanti.

---

## 21. Lambda dan Execution Timing

Ketika melihat lambda, tanya:

```text
Kapan lambda ini dieksekusi?
```

Kemungkinan:

1. langsung dieksekusi oleh method yang dipanggil;
2. dieksekusi lazy saat terminal operation;
3. disimpan untuk event callback;
4. dieksekusi async di thread lain;
5. dieksekusi ulang oleh retry;
6. dieksekusi oleh framework saat lifecycle tertentu;
7. tidak pernah dieksekusi karena conditional path.

Contoh Stream:

```java
Stream<String> stream = users.stream()
    .map(user -> {
        System.out.println("mapping " + user.id());
        return user.email();
    });
```

Belum ada output karena intermediate operation lazy.

Eksekusi baru terjadi saat terminal operation:

```java
List<String> emails = stream.toList();
```

Contoh callback:

```java
button.onClick(event -> service.submit(event.payload()));
```

Lambda dieksekusi nanti, saat event terjadi.

Contoh async:

```java
CompletableFuture.supplyAsync(() -> repository.load(id));
```

Lambda dieksekusi di thread lain.

Implikasi:

1. transaction context mungkin tidak ikut;
2. security context mungkin tidak ikut;
3. MDC/correlation id mungkin tidak ikut;
4. thread-local mungkin tidak ikut;
5. entity manager/session mungkin sudah closed;
6. captured mutable state bisa race.

Rule desain:

> Jangan hanya baca lambda body. Baca juga executor/owner yang akan memanggil lambda.

---

## 22. Lambda dan Concurrency: Capture Tidak Menjamin Thread Safety

Walaupun seri concurrency sudah dibahas terpisah, lambda punya trap khusus.

```java
List<String> result = new ArrayList<>();
items.parallelStream().forEach(item -> result.add(transform(item)));
```

Ini tidak aman.

`result` reference effectively final, tapi `ArrayList` tidak thread-safe.

Lebih baik:

```java
List<String> result = items.parallelStream()
    .map(this::transform)
    .toList();
```

Atau collector thread-safe/appropriate jika perlu.

Contoh lain:

```java
int[] count = {0};
items.parallelStream().forEach(item -> count[0]++);
```

Ini compile, tapi race condition.

Kenapa compile?

Karena reference ke array effectively final. Isi array mutable.

Rule desain:

> Effectively final adalah aturan capture, bukan jaminan immutability dan bukan jaminan thread safety.

---

## 23. Lambda Runtime Model: Dari Source ke Execution

Secara high-level, pipeline-nya:

```text
Source lambda
  -> compiler type checking using target type
  -> bytecode with invokedynamic call site
  -> bootstrap via LambdaMetafactory
  -> runtime object implementing functional interface
  -> invocation through interface method
```

Contoh source:

```java
Predicate<String> nonBlank = s -> !s.isBlank();
```

Compiler tidak sekadar membuat file `.class` anonymous inner class seperti Java lama.

Umumnya compiler menghasilkan:

1. private synthetic method berisi body lambda;
2. `invokedynamic` instruction pada lokasi lambda expression;
3. bootstrap metadata untuk `LambdaMetafactory`;
4. runtime object yang mengimplementasikan target functional interface.

Secara konseptual:

```java
private static boolean lambda$main$0(String s) {
    return !s.isBlank();
}
```

Lalu call site membuat `Predicate<String>` yang method `test`-nya delegate ke method tersebut.

Detail persis dapat berubah antar compiler/JDK dan bukan API contract yang boleh diandalkan aplikasi.

Rule penting:

> Jangan membuat logic aplikasi bergantung pada nama synthetic lambda method, class lambda runtime, atau bentuk bytecode spesifik.

---

## 24. Apa Itu `invokedynamic`?

`invokedynamic` adalah instruksi JVM untuk dynamic method invocation yang linkage-nya ditentukan oleh bootstrap method.

Sebelum Java 7/8, JVM punya instruksi invocation seperti:

1. `invokestatic`
2. `invokevirtual`
3. `invokeinterface`
4. `invokespecial`

`invokedynamic` menambahkan mekanisme programmable linkage.

Untuk lambda, idenya:

```text
At lambda expression site:
  JVM calls bootstrap method once to link call site.
  Bootstrap returns CallSite.
  Later executions reuse linked call site.
```

`LambdaMetafactory` biasanya menjadi bootstrap untuk membuat function object yang mengimplementasikan functional interface.

Manfaat pendekatan ini:

1. runtime bebas memilih strategi implementasi;
2. tidak perlu class anonymous eksplisit untuk setiap lambda di compile-time;
3. memberi ruang optimisasi JVM;
4. menjaga binary strategy lebih fleksibel;
5. mendukung method reference/lambda secara efisien.

Namun bagi programmer, contract source-level tetap:

```text
lambda -> functional interface instance
```

Jangan desain aplikasi berdasarkan `invokedynamic` kecuali sedang membuat framework, compiler, bytecode tool, atau static analyzer.

---

## 25. `LambdaMetafactory`

`LambdaMetafactory` adalah API di `java.lang.invoke` yang biasanya digunakan sebagai bootstrap method untuk lambda expression dan method reference.

Secara konseptual, ia menerima informasi seperti:

1. functional interface method signature;
2. implementation method handle;
3. captured argument;
4. adaptation requirement;
5. serializability marker bila relevan;
6. bridge method bila diperlukan.

Ia menghasilkan call site yang saat dipanggil memberikan object implementasi functional interface.

Contoh mental model:

```text
Predicate<String> p = s -> s.isBlank();
```

Dapat dibayangkan sebagai:

```text
Create object implementing Predicate
  whose test(String s)
  calls lambda body method
```

Tapi object itu bukan harus class yang Anda bisa prediksi namanya.

Jika Anda print class lambda:

```java
Predicate<String> p = s -> s.isBlank();
System.out.println(p.getClass());
```

Output-nya bisa seperti:

```text
class Example$$Lambda/0x0000000800c00a08
```

Jangan gunakan output itu untuk logic.

Buruk:

```java
if (handler.getClass().getName().contains("$$Lambda")) {
    // special case
}
```

Ini brittle.

---

## 26. Capturing vs Non-Capturing Lambda Runtime

Lambda non-capturing:

```java
Runnable r = () -> System.out.println("Hello");
```

Tidak menangkap local variable atau instance state.

Lambda capturing:

```java
String message = "Hello";
Runnable r = () -> System.out.println(message);
```

Menangkap `message`.

Implikasi umum:

1. non-capturing lambda lebih mudah di-cache/reuse oleh runtime;
2. capturing lambda butuh menyimpan captured value;
3. capturing lambda berpotensi membuat allocation lebih sering;
4. captured object bisa memperpanjang lifetime;
5. identity lambda tidak boleh diandalkan.

Contoh:

```java
Supplier<String> a = () -> "x";
Supplier<String> b = () -> "x";
System.out.println(a == b); // jangan andalkan true/false tertentu
```

Lambda object identity bukan semantic contract aplikasi.

Rule desain:

> Perlakukan lambda sebagai behavior, bukan entity dengan identity bisnis.

---

## 27. Lambda Identity dan Equality

Functional interface tidak otomatis punya value equality berdasarkan lambda body.

```java
Predicate<String> a = s -> s.isBlank();
Predicate<String> b = s -> s.isBlank();

System.out.println(a.equals(b)); // umumnya false
```

Lambda bukan value object.

Jangan gunakan lambda sebagai key jika Anda berharap equality by behavior.

Buruk:

```java
Map<Predicate<Order>, String> ruleNames = new HashMap<>();
ruleNames.put(order -> order.amount() > 1000, "HIGH_VALUE");
```

Tidak ada cara umum untuk membandingkan isi lambda secara aman.

Lebih baik:

```java
record NamedRule<T>(String code, Predicate<T> predicate) {}
```

Atau:

```java
interface Rule<T> {
    String code();
    boolean test(T value);
}
```

Jika rule perlu identity, beri identity eksplisit.

Rule desain:

> Behavior bisa disimpan dalam lambda, tetapi identity harus dimodelkan sebagai data eksplisit.

---

## 28. Lambda Serialization: Hindari Kecuali Benar-Benar Paham

Lambda bisa dibuat serializable jika target type extend `Serializable`.

```java
@FunctionalInterface
interface SerializablePredicate<T> extends Predicate<T>, Serializable {}

SerializablePredicate<String> p = s -> s.isBlank();
```

Tapi ini area berbahaya.

Masalah:

1. serialized form lambda tidak dimaksudkan sebagai long-term stable business format;
2. perubahan nama class/method dapat merusak deserialization;
3. captured object juga harus serializable;
4. security risk deserialization;
5. debugging sulit;
6. module/package evolution dapat merusak compatibility.

Buruk:

```java
saveToDatabase((SerializablePredicate<Order>) order -> order.amount() > 1000);
```

Lebih baik simpan rule sebagai data:

```java
record RuleDefinition(String field, String operator, String value) {}
```

Lalu compile/evaluate saat runtime:

```java
Predicate<Order> predicate = ruleCompiler.compile(ruleDefinition);
```

Rule desain:

> Jangan persist lambda. Persist intent/data, bukan executable closure.

---

## 29. Lambda dan Reflection

Lambda runtime object bisa direfleksikan seperti object biasa, tetapi hasilnya bukan model source-level yang stabil.

```java
Predicate<String> p = s -> s.isBlank();
Class<?> clazz = p.getClass();
System.out.println(clazz.getDeclaredMethods().length);
```

Anda mungkin melihat method synthetic atau generated structure, tetapi:

1. nama class tidak stabil;
2. method detail tidak untuk API publik;
3. captured fields dapat berbeda;
4. module access dapat membatasi reflection;
5. compiler/JDK dapat mengubah strategy.

Jika framework perlu memahami behavior lambda, biasanya tidak bisa secara umum “membaca isi lambda”.

Contoh yang sering diinginkan tapi tidak reliable:

```java
query.where(User::email).eq("a@b.com");
```

Bagaimana framework tahu `User::email` menunjuk field `email`?

Beberapa framework memakai trick serialized lambda untuk mengekstrak method name. Ini brittle dan harus diperlakukan sebagai framework-specific mechanism, bukan general Java best practice.

Lebih stabil:

```java
query.where(UserFields.EMAIL).eq("a@b.com");
```

atau generated metamodel:

```java
query.where(QUser.user.email).eq("a@b.com");
```

Rule desain:

> Lambda bagus untuk executable behavior, buruk sebagai metadata jika tidak ada protocol eksplisit.

---

## 30. Lambda dan Code Generation

Code generator sering menghasilkan API yang menerima lambda.

Contoh builder DSL:

```java
CaseQuery query = CaseQuery.builder()
    .where(case_ -> case_.status().eq(SUBMITTED))
    .orderBy(case_ -> case_.createdAt().desc())
    .build();
```

Ini bisa sangat expressive jika lambda parameter bukan entity asli, tetapi generated DSL object.

```java
@FunctionalInterface
interface CaseQuerySpec {
    PredicateSpec apply(QCase case_);
}
```

Lambda di sini bukan metadata yang dibongkar dari bytecode. Lambda hanya callback yang menerima generated metamodel object.

Lebih baik:

```text
lambda executes against DSL model
```

Daripada:

```text
framework introspects lambda implementation
```

Contoh aman:

```java
query.where(q -> q.status().eq(CaseStatus.SUBMITTED));
```

Karena `q.status()` adalah method pada DSL object, bukan method reference yang perlu dibongkar.

Rule code generation:

> Generate model/protocol yang dieksekusi oleh lambda. Jangan bergantung pada introspeksi isi lambda kecuali Anda mengontrol seluruh toolchain dan compatibility story.

---

## 31. Lambda dan JPMS / Module Boundary

Lambda tidak menghapus aturan access control.

Jika lambda body mengakses private member, akses itu berasal dari lexical context tempat lambda didefinisikan.

Contoh:

```java
class SecretHolder {
    private String secret = "x";

    Supplier<String> supplier() {
        return () -> secret;
    }
}
```

Lambda boleh mengakses `secret` karena didefinisikan di dalam class tersebut.

Namun framework/module lain yang menerima supplier tidak otomatis mendapat reflective access ke private member.

```java
Supplier<String> supplier = holder.supplier();
externalFramework.inspect(supplier);
```

External framework hanya punya object functional interface. Ia tidak punya hak magis untuk membaca lexical source.

JPMS juga mempengaruhi deep reflection. Jika framework mencoba membongkar implementation class lambda, strong encapsulation dapat menghalangi.

Rule desain:

> Lambda dapat membawa behavior melewati boundary, tetapi tidak membuat private/module internals menjadi API yang boleh di-reflect.

---

## 32. Lambda dan Security/Authorization Boundary

Lambda sering dipakai untuk menunda operasi:

```java
authorization.require("CASE_APPROVE", () -> caseService.approve(command));
```

Ini bisa bagus karena authorization wrapper mengontrol execution.

Tapi desainnya harus jelas:

```java
<T> T require(String permission, Supplier<T> action) {
    if (!currentUser.has(permission)) {
        throw new ForbiddenException(permission);
    }
    return action.get();
}
```

Untuk action yang return void:

```java
void require(String permission, Runnable action) {
    if (!currentUser.has(permission)) {
        throw new ForbiddenException(permission);
    }
    action.run();
}
```

Risiko:

```java
var result = caseService.approve(command);
authorization.require("CASE_APPROVE", () -> result);
```

Operasi sudah terjadi sebelum authorization.

Rule desain:

> Untuk lambda security wrapper, pastikan operasi sensitif berada di dalam lambda, bukan dievaluasi sebelum lambda dibuat.

---

## 33. Lambda dan Transaction Boundary

Contoh callback transaction:

```java
transactionTemplate.execute(() -> {
    Case c = repository.load(command.caseId());
    c.approve(command.actor());
    repository.save(c);
    return c.id();
});
```

Ini jelas: lambda dieksekusi dalam transaction.

Tapi hati-hati dengan lazy object keluar boundary:

```java
Supplier<List<Item>> supplier = transactionTemplate.execute(() -> {
    Order order = repository.load(orderId);
    return () -> order.items();
});

supplier.get(); // mungkin di luar transaction/session
```

Jika `items()` lazy-loaded, ini bisa gagal.

Lebih baik materialize data di dalam boundary:

```java
List<ItemDto> items = transactionTemplate.execute(() -> {
    Order order = repository.load(orderId);
    return order.items().stream()
        .map(ItemDto::from)
        .toList();
});
```

Rule desain:

> Jangan keluarkan lambda yang bergantung pada transaction/session yang sudah selesai.

---

## 34. Lambda dan Observability

Lambda bisa menyembunyikan operasi penting dalam stack trace dan log.

Contoh:

```java
rules.forEach(rule -> rule.apply(caseFile));
```

Jika gagal, stack trace mungkin menunjukkan lambda line number, tapi tidak rule identity.

Lebih baik:

```java
for (Rule rule : rules) {
    try {
        rule.apply(caseFile);
    } catch (Exception e) {
        throw new RuleExecutionException(rule.code(), caseFile.id(), e);
    }
}
```

Atau lambda membawa named operation:

```java
record NamedAction(String name, Runnable action) {}
```

Pemakaian:

```java
List<NamedAction> actions = List.of(
    new NamedAction("validate-documents", () -> validateDocuments(caseFile)),
    new NamedAction("check-risk", () -> checkRisk(caseFile))
);

for (NamedAction action : actions) {
    log.info("Running action {}", action.name());
    action.action().run();
}
```

Rule desain:

> Jika lambda merepresentasikan business step penting, beri nama step secara eksplisit.

---

## 35. Lambda dan Debuggability

Lambda pendek mudah dibaca.

```java
.map(User::email)
```

Lambda panjang sulit di-debug.

```java
.map(user -> {
    var profile = profileService.load(user.id());
    var score = scoringService.score(profile);
    if (score > 80) {
        audit.record(user.id(), score);
    }
    return new UserScore(user.id(), score);
})
```

Masalah:

1. breakpoint dalam lambda kadang kurang nyaman;
2. stack trace menunjukkan synthetic lambda method;
3. line number bisa mencakup banyak logic;
4. variable capture tidak jelas;
5. exception context minim.

Lebih baik:

```java
.map(this::scoreUser)
```

Dengan method:

```java
private UserScore scoreUser(User user) {
    var profile = profileService.load(user.id());
    var score = scoringService.score(profile);
    if (score > 80) {
        audit.record(user.id(), score);
    }
    return new UserScore(user.id(), score);
}
```

Rule praktis:

> Jika lambda butuh breakpoint khusus, nama method mungkin lebih baik.

---

## 36. Lambda dan API Design

Functional parameter membuat API menjadi flexible.

Contoh:

```java
<T> T withRetry(Supplier<T> operation) {
    // retry logic
}
```

Tapi functional parameter yang terlalu generic dapat menghilangkan domain meaning.

Buruk:

```java
void process(Function<Object, Object> function) {}
```

Lebih baik:

```java
@FunctionalInterface
interface CaseTransitionPolicy {
    TransitionDecision decide(CaseSnapshot snapshot);
}
```

Pemakaian:

```java
CaseTransitionPolicy policy = snapshot -> {
    if (snapshot.hasOpenSanction()) {
        return TransitionDecision.reject("OPEN_SANCTION");
    }
    return TransitionDecision.allow();
};
```

Manfaat custom interface:

1. nama domain jelas;
2. method name domain-specific;
3. Javadoc bisa menjelaskan contract;
4. exception policy bisa spesifik;
5. default helper method bisa ditambahkan;
6. API lebih stabil;
7. lebih mudah mock/test;
8. lebih mudah observability.

Bandingkan:

```java
Function<CaseSnapshot, TransitionDecision>
```

Ini generic dan ringkas, tapi kehilangan semantic name.

Rule desain:

> Gunakan `java.util.function` untuk operasi umum. Gunakan custom functional interface untuk domain contract penting.

---

## 37. Menamai Functional Interface Method

Nama method SAM penting.

Kurang jelas:

```java
@FunctionalInterface
interface Handler<T> {
    void handle(T value);
}
```

Cukup generic.

Lebih domain-specific:

```java
@FunctionalInterface
interface CaseEscalationPolicy {
    EscalationDecision evaluate(CaseSnapshot snapshot);
}
```

Atau:

```java
@FunctionalInterface
interface CaseActionAuthorizer {
    AuthorizationDecision authorize(CaseActionContext context);
}
```

Method name memberi mental model:

| Method | Cocok untuk |
|---|---|
| `test` | predicate umum |
| `apply` | transformation umum |
| `accept` | consumer umum |
| `get` | supplier umum |
| `evaluate` | rule/policy |
| `authorize` | authorization decision |
| `resolve` | resolver |
| `map` | mapper |
| `generate` | generator |
| `load` | loader, mungkin I/O |
| `execute` | command/action |
| `decide` | decision policy |

Rule:

> Untuk domain extension point, method SAM harus menyampaikan business intent, bukan sekadar technical shape.

---

## 38. Lambda dan Null Handling

Lambda parameter bisa null jika caller memberi null.

```java
Function<String, Integer> length = s -> s.length();
length.apply(null); // NullPointerException
```

Functional interface tidak otomatis memberi null-safety.

API yang menerima lambda harus menentukan:

1. apakah lambda boleh null?
2. apakah input lambda boleh null?
3. apakah output lambda boleh null?
4. apakah exception dari lambda dibungkus?
5. apakah lambda boleh punya side effect?

Contoh API defensif:

```java
final class RuleEngine<T> {
    private final List<Predicate<T>> rules = new ArrayList<>();

    void addRule(Predicate<T> rule) {
        rules.add(Objects.requireNonNull(rule, "rule"));
    }

    boolean allows(T value) {
        Objects.requireNonNull(value, "value");
        return rules.stream().allMatch(rule -> rule.test(value));
    }
}
```

Jika null punya makna domain, modelkan eksplisit.

```java
sealed interface Input permits Input.Present, Input.Absent {
    record Present(String value) implements Input {}
    record Absent() implements Input {}
}
```

Rule desain:

> Lambda tidak menyelesaikan null problem. Contract API tetap harus menyatakan null policy.

---

## 39. Lambda dan Primitive Specialization

Autoboxing dalam lambda dapat menambah overhead.

```java
Function<Integer, Integer> square = n -> n * n;
```

Ini memakai `Integer`, bukan `int` murni.

Untuk primitive-heavy code, gunakan specialization:

```java
IntUnaryOperator square = n -> n * n;
```

Contoh lain:

| Generic | Primitive specialization |
|---|---|
| `Function<T, R>` | `IntFunction<R>`, `LongFunction<R>`, `DoubleFunction<R>` |
| `Predicate<T>` | `IntPredicate`, `LongPredicate`, `DoublePredicate` |
| `Consumer<T>` | `IntConsumer`, `LongConsumer`, `DoubleConsumer` |
| `Supplier<T>` | `IntSupplier`, `LongSupplier`, `DoubleSupplier`, `BooleanSupplier` |
| `UnaryOperator<T>` | `IntUnaryOperator`, `LongUnaryOperator`, `DoubleUnaryOperator` |
| `BinaryOperator<T>` | `IntBinaryOperator`, `LongBinaryOperator`, `DoubleBinaryOperator` |

Dalam enterprise business code, boxing overhead sering tidak dominan. Dalam hot loop, parsing, metrics, serialization, numeric processing, dan large collection transformation, primitive specialization dapat membantu.

Rule desain:

> Jangan premature optimize semua lambda. Tapi untuk hot numeric path, hindari boxing dengan primitive functional interfaces.

---

## 40. Lambda dan Type Inference Pitfalls

Target typing dan generics bisa membuat error message membingungkan.

Contoh:

```java
static <T> T choose(T a, T b) {
    return a;
}

var result = choose(
    (Predicate<String>) s -> s.isBlank(),
    (Function<String, Integer>) s -> s.length()
);
```

Compiler perlu mencari common type yang cocok. Hasilnya bisa menjadi type yang tidak Anda harapkan atau compile error.

Contoh API generic:

```java
static <T, R> List<R> map(List<T> input, Function<T, R> mapper) {
    return input.stream().map(mapper).toList();
}

var result = map(List.of("a", "bb"), s -> s.length());
```

Ini bagus.

Tapi jika mapper terlalu generic atau overload terlalu banyak, inference menjadi rapuh.

Rule desain API:

1. jangan membuat generic parameter yang tidak perlu;
2. hindari overload functional interface mirip;
3. gunakan nama method berbeda untuk intent berbeda;
4. beri explicit type witness hanya jika perlu;
5. untuk public API, prioritaskan call-site clarity.

Contoh explicit type witness:

```java
List<Integer> lengths = MyUtil.<String, Integer>map(
    List.of("a", "bb"),
    s -> s.length()
);
```

Jika pengguna sering perlu type witness, API mungkin terlalu rumit.

---

## 41. Lambda Dalam DSL

Lambda dapat membuat DSL fluent.

Contoh:

```java
workflow.step("validate", step -> step
    .requires(CasePermission.VIEW)
    .action(ctx -> validator.validate(ctx.caseId()))
    .onFailure((ctx, error) -> notifier.notify(ctx.caseId(), error))
);
```

Ini expressive, tapi bisa menjadi terlalu magical.

Checklist DSL lambda:

1. Apakah setiap lambda punya target type jelas?
2. Apakah parameter lambda punya nama domain?
3. Apakah error propagation jelas?
4. Apakah execution timing jelas?
5. Apakah lambda dieksekusi immediately atau later?
6. Apakah transaction/security context jelas?
7. Apakah observability memberi nama step?
8. Apakah stack trace mudah dipahami?
9. Apakah serialization/configuration diperlukan?
10. Apakah DSL tetap bisa direfactor?

Buruk:

```java
engine.doIt(x -> y -> z -> process(x, y, z));
```

Terlalu clever.

Lebih baik:

```java
engine.registerTransition("submit-to-review", transition -> transition
    .from(DRAFT)
    .to(UNDER_REVIEW)
    .when(this::hasRequiredDocuments)
    .perform(this::submitForReview)
);
```

Rule desain:

> Lambda DSL harus membuat domain lebih terlihat, bukan membuat control flow tersembunyi.

---

## 42. Lambda Dalam Framework Callback

Banyak framework menerima callback:

```java
transactionTemplate.execute(status -> { ... });
retryTemplate.execute(context -> { ... });
router.get("/cases/{id}", request -> { ... });
validator.rule("age", value -> value >= 18);
```

Saat memakai callback, pertanyaan penting:

1. Siapa yang memanggil lambda?
2. Kapan dipanggil?
3. Berapa kali dipanggil?
4. Di thread apa dipanggil?
5. Dalam context apa dipanggil?
6. Exception diperlakukan bagaimana?
7. Return value dipakai bagaimana?
8. Apakah lambda boleh blocking?
9. Apakah lambda boleh menyimpan parameter framework?
10. Apakah lambda boleh memanggil API framework setelah method return?

Contoh bug:

```java
Request saved;
router.get("/x", request -> {
    saved = request; // tidak valid untuk local, tapi bisa field
    return ok();
});
```

Menyimpan object request untuk dipakai nanti biasanya salah karena lifecycle request terbatas.

Rule desain:

> Callback parameter biasanya valid hanya selama callback execution, kecuali dokumentasi framework menyatakan sebaliknya.

---

## 43. Lambda dan Testing

Lambda inline sulit dites langsung jika logic besar.

Buruk:

```java
engine.register(rule -> {
    if (rule.caseAgeDays() > 30 && rule.priority() == HIGH) {
        return ESCALATE;
    }
    return KEEP;
});
```

Lebih baik ekstrak:

```java
CaseEscalationPolicy policy = this::decideEscalation;
engine.register(policy);
```

Method dites:

```java
EscalationDecision decideEscalation(CaseSnapshot snapshot) {
    if (snapshot.caseAgeDays() > 30 && snapshot.priority() == Priority.HIGH) {
        return EscalationDecision.ESCALATE;
    }
    return EscalationDecision.KEEP;
}
```

Atau class terpisah jika policy punya dependency/complexity:

```java
final class AgePriorityEscalationPolicy implements CaseEscalationPolicy {
    @Override
    public EscalationDecision evaluate(CaseSnapshot snapshot) {
        if (snapshot.caseAgeDays() > 30 && snapshot.priority() == Priority.HIGH) {
            return EscalationDecision.ESCALATE;
        }
        return EscalationDecision.KEEP;
    }
}
```

Rule:

> Inline lambda cocok untuk glue kecil. Business rule penting lebih baik punya nama dan test target.

---

## 44. Lambda dan Documentation

Functional parameter harus didokumentasikan lebih eksplisit daripada parameter data biasa.

Contoh API:

```java
<T> T withLock(String lockName, Supplier<T> operation) {
    // ...
}
```

Javadoc yang perlu dijelaskan:

```java
/**
 * Executes {@code operation} while holding the named lock.
 *
 * <p>The operation is invoked at most once by this method. The operation is
 * executed synchronously on the calling thread. If the operation throws a
 * runtime exception, the exception is propagated after the lock is released.
 *
 * @param lockName lock identifier; must not be blank
 * @param operation operation to run under the lock; must not be null
 * @return operation result
 */
```

Kenapa perlu?

Karena lambda punya behavior. Behavior membutuhkan contract:

1. invocation count;
2. thread;
3. context;
4. exception propagation;
5. null policy;
6. ordering;
7. side-effect expectation;
8. reentrancy;
9. timeout/cancellation;
10. lifecycle.

Rule desain:

> Setiap public API yang menerima lambda harus mendokumentasikan execution semantics.

---

## 45. Lambda Design Smells

### 45.1 Lambda terlalu panjang

```java
.map(x -> {
    // 40 lines
})
```

Refactor ke method/class.

### 45.2 Lambda menyembunyikan I/O

```java
.filter(order -> fraudService.check(order))
```

`filter` terlihat pure, tapi memanggil remote service.

Lebih eksplisit:

```java
.map(order -> fraudAssessmentService.assess(order))
.filter(FraudAssessment::allowed)
```

### 45.3 Lambda dengan mutation tersembunyi

```java
.peek(x -> audit.add(x))
```

`peek` untuk debugging/observing, bukan workflow utama.

### 45.4 Lambda sebagai business identity

```java
Map<Predicate<Case>, String> ruleMap;
```

Modelkan rule dengan code/name.

### 45.5 Lambda dipersist

Jangan persist executable closure.

### 45.6 Lambda mengambil terlalu banyak context

```java
return () -> this.doEverything(command, request, session, transaction, cache);
```

Capture minimal.

### 45.7 Overload ambiguity

```java
register(() -> value);
```

API perlu diperjelas.

### 45.8 Method reference terlalu clever

```java
foo(this::bar);
```

Jika overload `bar` banyak, explicit lambda lebih jelas.

---

## 46. Production Checklist Saat Menulis Lambda

Tanyakan:

1. Apakah target type jelas?
2. Apakah lambda pendek dan readable?
3. Apakah parameter bernama jelas?
4. Apakah lambda pure atau punya side effect?
5. Jika side effect, apakah timing dan count jelas?
6. Apakah lambda bisa dieksekusi lebih dari sekali?
7. Apakah lambda bisa dieksekusi async/thread lain?
8. Apakah captured variable immutable atau mutable?
9. Apakah captured state memperpanjang lifetime object besar?
10. Apakah lambda bergantung pada request/security/transaction/thread-local context?
11. Apakah checked exception ditangani secara sadar?
12. Apakah null contract jelas?
13. Apakah observability cukup jika lambda gagal?
14. Apakah business rule penting sebaiknya punya nama?
15. Apakah method reference meningkatkan kejelasan?
16. Apakah overload API membuat lambda ambigu?
17. Apakah lambda dipakai sebagai metadata? Jika ya, apakah ada protocol eksplisit?
18. Apakah lambda akan dipersist/serialized? Jika ya, desain ulang.
19. Apakah primitive specialization diperlukan di hot path?
20. Apakah public API mendokumentasikan execution semantics?

---

## 47. Decision Matrix: Lambda, Method Reference, Anonymous Class, Named Class

| Kebutuhan | Pilihan Umum | Alasan |
|---|---|---|
| Behavior sangat pendek | Lambda | ringkas dan lokal |
| Hanya meneruskan ke method bernama | Method reference | intent jelas |
| Butuh `this` sebagai object callback sendiri | Anonymous class | lambda `this` mengacu enclosing instance |
| Butuh field/method tambahan lokal | Anonymous class atau named class | lambda tidak punya deklarasi member |
| Business rule penting | Named method/class/custom functional interface | testable dan observable |
| Public extension point | Custom functional interface | contract domain jelas |
| Framework callback kecil | Lambda | ergonomis |
| Logic panjang/complex | Named method/class | maintainable |
| Metadata query DSL | Generated metamodel + lambda | jangan introspect lambda body |
| Long-lived async task | Named class atau lambda capture minimal | lifecycle jelas |

---

## 48. Studi Kasus: Case Escalation Rules

Misal kita punya sistem case management.

Kebutuhan:

1. case overdue lebih dari 14 hari;
2. case high priority;
3. case punya unresolved compliance flag;
4. rule harus bisa diberi nama;
5. rule harus observable;
6. rule harus bisa dites;
7. rule engine harus menerima rule custom.

### 48.1 Versi terlalu generic

```java
List<Predicate<CaseSnapshot>> rules = List.of(
    c -> c.ageDays() > 14,
    c -> c.priority() == Priority.HIGH,
    c -> c.flags().contains(Flag.UNRESOLVED_COMPLIANCE)
);

boolean escalate = rules.stream().allMatch(rule -> rule.test(snapshot));
```

Masalah:

1. rule tidak punya nama;
2. jika gagal sulit tahu rule mana;
3. tidak ada severity;
4. tidak ada reason code;
5. sulit audit;
6. lambda identity tidak berguna.

### 48.2 Versi lebih production-grade

```java
@FunctionalInterface
interface CaseEscalationCondition {
    boolean matches(CaseSnapshot snapshot);
}

record NamedCondition(
    String code,
    String description,
    CaseEscalationCondition condition
) {
    boolean matches(CaseSnapshot snapshot) {
        return condition.matches(snapshot);
    }
}
```

Rules:

```java
List<NamedCondition> conditions = List.of(
    new NamedCondition(
        "CASE_OVERDUE_14_DAYS",
        "Case is older than 14 days",
        snapshot -> snapshot.ageDays() > 14
    ),
    new NamedCondition(
        "CASE_HIGH_PRIORITY",
        "Case has high priority",
        snapshot -> snapshot.priority() == Priority.HIGH
    ),
    new NamedCondition(
        "UNRESOLVED_COMPLIANCE_FLAG",
        "Case has unresolved compliance flag",
        snapshot -> snapshot.flags().contains(Flag.UNRESOLVED_COMPLIANCE)
    )
);
```

Evaluation:

```java
record ConditionResult(String code, boolean matched) {}

List<ConditionResult> results = conditions.stream()
    .map(condition -> new ConditionResult(
        condition.code(),
        condition.matches(snapshot)
    ))
    .toList();

boolean escalate = results.stream().allMatch(ConditionResult::matched);
```

Lebih baik:

1. rule punya code;
2. audit bisa mencatat result per rule;
3. lambda tetap dipakai untuk behavior;
4. identity rule ada sebagai data;
5. test bisa fokus ke condition;
6. observability lebih kuat.

### 48.3 Dengan Failure Context

```java
List<ConditionResult> evaluateAll(CaseSnapshot snapshot, List<NamedCondition> conditions) {
    List<ConditionResult> results = new ArrayList<>();

    for (NamedCondition condition : conditions) {
        try {
            results.add(new ConditionResult(
                condition.code(),
                condition.matches(snapshot)
            ));
        } catch (RuntimeException e) {
            throw new RuleEvaluationException(condition.code(), snapshot.caseId(), e);
        }
    }

    return List.copyOf(results);
}
```

Di sini kita sengaja tidak memakai stream supaya failure context lebih eksplisit. Ini bukan anti-functional; ini engineering judgement.

Rule akhir:

> Lambda adalah alat. Untuk workflow kritikal, clarity, auditability, dan failure model lebih penting daripada gaya functional yang ringkas.

---

## 49. Ringkasan Mental Model

Ingat model ini:

```text
lambda expression
  tidak punya type mandiri
  membutuhkan target type
  target type harus functional interface
  body dicek terhadap SAM signature
  captured local variable harus final/effectively final
  this mengacu enclosing scope
  runtime umumnya memakai invokedynamic + LambdaMetafactory
  object identity lambda tidak boleh diandalkan
  lambda bagus untuk behavior, buruk untuk metadata/persistence
```

Dan untuk desain:

```text
Small local behavior       -> lambda
Named existing operation   -> method reference
Important domain rule      -> named method/class + custom functional interface
Runtime metadata           -> generated metamodel/protocol, not lambda introspection
Long-lived async callback  -> capture minimal, document lifecycle
Public API callback        -> document execution semantics
```

---

## 50. What Top 1% Engineer Should Internalize

Top engineer tidak sekadar “bisa pakai lambda”. Ia tahu:

1. kapan lambda meningkatkan clarity;
2. kapan lambda menyembunyikan workflow;
3. kapan target typing membuat API ambigu;
4. kapan custom functional interface lebih baik dari `Function`/`Predicate`;
5. kapan method reference terlalu clever;
6. kapan capture memperpanjang lifetime object;
7. kapan effectively final tidak berarti immutable;
8. kapan lambda side effect berbahaya karena retry/laziness/async;
9. kapan checked exception perlu dimodelkan ulang;
10. kapan rule harus punya identity eksplisit;
11. mengapa introspeksi lambda bukan fondasi metadata yang stabil;
12. mengapa lambda runtime class bukan API;
13. bagaimana `invokedynamic` memberi fleksibilitas implementasi;
14. bagaimana public API dengan lambda harus mendokumentasikan execution semantics.

Lambda adalah salah satu fitur Java yang terlihat kecil, tetapi menyentuh banyak aspek besar:

- type system;
- interface design;
- generics;
- runtime linkage;
- side-effect modeling;
- async execution;
- framework callback;
- debugging;
- API design;
- generated-code design;
- module encapsulation.

Gunakan lambda bukan untuk terlihat modern, tetapi untuk membuat behavior lebih eksplisit, lebih lokal, dan lebih aman.

---

# Referensi

- Oracle Java SE 25, Java Language Specification, terutama bagian lambda expressions, method references, functional interfaces, dan method invocation.
- Oracle Java SE 25, Java Virtual Machine Specification, terutama bagian `invokedynamic` dan method invocation/linkage.
- Oracle Java SE 25 API, `java.lang.invoke.LambdaMetafactory`.
- Oracle Java SE 25 API, `java.util.function` package.
- Oracle Java SE 25 API, `java.lang.FunctionalInterface`.
- Oracle Java Tutorials, Lambda Expressions dan target typing.

---

# Status Seri

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-016.md
```

Topik berikutnya:

```text
Functional Interfaces and Higher-Order API Design
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Functional Java Mental Model: Functions, Effects, and Referential Transparency](./learn-java-oop-functional-reflection-codegen-modules-part-014.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Functional Interfaces and Higher-Order API Design](./learn-java-oop-functional-reflection-codegen-modules-part-016.md)

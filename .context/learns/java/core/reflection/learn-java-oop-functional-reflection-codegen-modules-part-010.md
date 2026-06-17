# learn-java-oop-functional-reflection-codegen-modules-part-010

# Nested, Inner, Local, and Anonymous Classes

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `010`  
> Topik: Nested, Inner, Local, and Anonymous Classes  
> Level: Advanced / architecture-oriented Java  

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu tidak hanya bisa membedakan `static nested class`, `inner class`, `local class`, dan `anonymous class`, tetapi juga mampu menjawab pertanyaan desain yang lebih penting:

- kapan sebuah type sebaiknya menjadi top-level class;
- kapan ia sebaiknya disembunyikan sebagai nested class;
- kapan nested class harus `static`;
- kapan inner class non-static berbahaya karena membawa reference ke enclosing instance;
- kapan anonymous class masih lebih tepat daripada lambda;
- bagaimana nested class terlihat oleh reflection, compiler, bytecode, framework, testing, dan module/package boundary;
- bagaimana nested class bisa membantu encapsulation, builder, iterator, adapter, visitor, domain-scoped implementation, dan generated-code boundary;
- kapan nested class justru membuat architecture menjadi gelap, sulit dites, dan rentan memory leak.

Bagian ini bukan materi syntax. Syntax hanya permukaan. Yang penting adalah **scoping, ownership, lifetime, visibility, dan semantic coupling**.

---

## 1. Mental Model Utama

Java memberi beberapa cara menaruh class di dalam scope lain:

```java
public class Outer {
    static class StaticNested {}

    class Inner {}

    void method() {
        class Local {}

        Runnable anonymous = new Runnable() {
            @Override
            public void run() {}
        };
    }
}
```

Semua ini terlihat seperti variasi kecil, tetapi semantik runtime-nya berbeda.

Pertanyaan paling penting bukan:

> “Apa bedanya nested dan inner class?”

Pertanyaan yang lebih berguna:

> “Apakah type ini perlu identitas publik sendiri, atau hanya detail implementasi dari type/scope lain?”

Dan:

> “Apakah object ini perlu reference implisit ke enclosing instance?”

Karena di Java, **non-static inner class membawa hubungan runtime dengan object luar**.

---

## 2. Taxonomy: Empat Bentuk Class di Dalam Scope

Secara praktis, kamu akan bertemu empat bentuk utama:

| Bentuk | Dideklarasikan di | Punya nama? | Punya enclosing instance? | Use case utama |
|---|---|---:|---:|---|
| Static nested class | body class/interface | Ya | Tidak otomatis | Helper/implementation type yang logically owned by outer type |
| Inner class | body class, non-static | Ya | Ya | Object yang butuh akses state outer instance |
| Local class | block/method/constructor | Ya, local | Bisa capture context | Type lokal untuk algoritma kecil/terisolasi |
| Anonymous class | expression | Tidak | Bisa capture context | One-off subtype/implementation |

Terminologi penting:

- **Nested class** adalah class yang dideklarasikan di dalam class/interface lain.
- **Inner class** adalah nested class yang tidak static.
- Local class dan anonymous class juga berada di scope lokal.
- Static nested class bukan inner class dalam arti semantic karena tidak punya enclosing instance otomatis.

---

## 3. Static Nested Class

### 3.1 Bentuk Dasar

```java
public final class Money {
    private final long minorUnits;
    private final Currency currency;

    private Money(long minorUnits, Currency currency) {
        this.minorUnits = minorUnits;
        this.currency = Objects.requireNonNull(currency);
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private long minorUnits;
        private Currency currency;

        public Builder minorUnits(long minorUnits) {
            this.minorUnits = minorUnits;
            return this;
        }

        public Builder currency(Currency currency) {
            this.currency = currency;
            return this;
        }

        public Money build() {
            return new Money(minorUnits, currency);
        }
    }
}
```

`Builder` logically belong ke `Money`, tetapi tidak butuh reference ke instance `Money` tertentu. Karena itu ia harus `static`.

### 3.2 Mental Model

Static nested class adalah:

> top-level-like class yang namanya berada di namespace outer class.

Ia punya akses ke private member outer class secara bahasa, tetapi ia **tidak otomatis punya object outer**.

```java
public class Outer {
    private int value = 10;

    static class Nested {
        int read(Outer outer) {
            return outer.value; // boleh, lewat object eksplisit
        }
    }
}
```

Perhatikan: akses ke `value` butuh `Outer outer` eksplisit.

### 3.3 Kapan Menggunakan Static Nested Class

Gunakan static nested class ketika type tersebut:

- hanya relevan dalam konteks outer type;
- bukan bagian dari API package yang berdiri sendiri;
- tidak memerlukan reference otomatis ke outer instance;
- membantu memperjelas ownership;
- menjadi implementation detail, helper, builder, key, policy, state, snapshot, atau descriptor.

Contoh bagus:

```java
public final class CaseWorkflow {
    public record Transition(String from, String to, String action) {}

    private static final class RuleIndex {
        private final Map<String, List<Transition>> byState;

        private RuleIndex(List<Transition> transitions) {
            this.byState = transitions.stream()
                    .collect(Collectors.groupingBy(Transition::from));
        }
    }
}
```

`RuleIndex` tidak perlu diketahui package lain. Ia hanya detail internal `CaseWorkflow`.

### 3.4 Static Nested Class sebagai Boundary

Static nested class bagus untuk menyatakan:

> “Type ini bukan domain concept global. Type ini hanya alat untuk class ini.”

Contoh:

```java
public final class AuditDiff {
    private final List<Entry> entries;

    public static final class Entry {
        private final String field;
        private final Object before;
        private final Object after;

        public Entry(String field, Object before, Object after) {
            this.field = field;
            this.before = before;
            this.after = after;
        }
    }
}
```

Namun hati-hati. Jika `Entry` mulai digunakan luas di banyak tempat, berarti ia bukan detail `AuditDiff` lagi. Ia mungkin layak menjadi top-level `AuditDiffEntry`.

---

## 4. Inner Class Non-Static

### 4.1 Bentuk Dasar

```java
public class Order {
    private final List<Line> lines = new ArrayList<>();

    public class LineView {
        public int count() {
            return lines.size();
        }
    }

    public LineView view() {
        return new LineView();
    }
}
```

`LineView` bisa mengakses `lines` langsung karena setiap instance `LineView` terkait dengan satu instance `Order`.

Secara konseptual:

```text
LineView object ──implisit──> Order object
```

### 4.2 Enclosing Instance

Inner class non-static membawa reference implisit ke enclosing instance.

Itulah kekuatannya, dan juga risikonya.

Misalnya:

```java
public class ReportService {
    private byte[] largeBuffer = new byte[100_000_000];

    public Runnable createTask() {
        return new Task();
    }

    private class Task implements Runnable {
        @Override
        public void run() {
            System.out.println("running");
        }
    }
}
```

`Task` terlihat tidak memakai `largeBuffer`, tetapi sebagai inner class non-static, object `Task` tetap membawa reference ke `ReportService`. Jika `Task` disimpan di queue global, `ReportService` dan `largeBuffer` ikut tertahan.

Versi lebih aman:

```java
public class ReportService {
    private byte[] largeBuffer = new byte[100_000_000];

    public Runnable createTask() {
        return new Task();
    }

    private static class Task implements Runnable {
        @Override
        public void run() {
            System.out.println("running");
        }
    }
}
```

Rule praktis:

> Default-kan nested class menjadi `static`. Buat non-static hanya kalau benar-benar membutuhkan enclosing instance.

### 4.3 Instansiasi Inner Class

Dari dalam outer:

```java
public class Outer {
    class Inner {}

    Inner create() {
        return new Inner();
    }
}
```

Dari luar:

```java
Outer outer = new Outer();
Outer.Inner inner = outer.new Inner();
```

Syntax `outer.new Inner()` memperlihatkan realita penting: inner object membutuhkan outer object.

### 4.4 Kapan Inner Class Tepat

Inner class tepat ketika:

- object benar-benar merepresentasikan view/operation terhadap outer object tertentu;
- object tidak masuk akal tanpa outer instance;
- object harus mengakses invariant private outer secara intensif;
- lifetime inner object dikendalikan oleh outer object;
- inner object tidak keluar jauh dari outer boundary.

Contoh yang masuk akal: iterator custom.

```java
public final class IntRingBuffer implements Iterable<Integer> {
    private final int[] elements;
    private int size;

    public IntRingBuffer(int capacity) {
        this.elements = new int[capacity];
    }

    @Override
    public Iterator<Integer> iterator() {
        return new RingIterator();
    }

    private final class RingIterator implements Iterator<Integer> {
        private int index;

        @Override
        public boolean hasNext() {
            return index < size;
        }

        @Override
        public Integer next() {
            if (!hasNext()) {
                throw new NoSuchElementException();
            }
            return elements[index++];
        }
    }
}
```

`RingIterator` memang terikat pada satu `IntRingBuffer`.

### 4.5 Kapan Inner Class Salah

Inner class mencurigakan jika:

- tidak memakai state outer sama sekali;
- object-nya disimpan lebih lama daripada outer;
- dikirim ke thread pool, scheduler, callback registry, event bus;
- dipakai oleh framework yang menyimpan callback secara global;
- membuat testing sulit;
- membuat serialization membawa graph object besar tanpa sadar.

Contoh buruk:

```java
public class UserImportService {
    private final DataSource dataSource;
    private final Cache cache;
    private final LargeConfig config;

    public Runnable importJob(Path file) {
        return new ImportJob(file);
    }

    private class ImportJob implements Runnable {
        private final Path file;

        private ImportJob(Path file) {
            this.file = file;
        }

        @Override
        public void run() {
            // hanya pakai file dan service method tertentu
        }
    }
}
```

Lebih eksplisit:

```java
public class UserImportService {
    public Runnable importJob(Path file) {
        return new ImportJob(file);
    }

    private static final class ImportJob implements Runnable {
        private final Path file;

        private ImportJob(Path file) {
            this.file = file;
        }

        @Override
        public void run() {
            // dependencies eksplisit, tidak bawa UserImportService diam-diam
        }
    }
}
```

---

## 5. Local Class

### 5.1 Bentuk Dasar

Local class dideklarasikan di dalam block, biasanya method.

```java
public List<String> normalize(List<String> input) {
    class Normalizer {
        String normalizeOne(String value) {
            return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        }
    }

    Normalizer normalizer = new Normalizer();
    return input.stream()
            .map(normalizer::normalizeOne)
            .toList();
}
```

`Normalizer` hanya dikenal di dalam method `normalize`.

### 5.2 Use Case Local Class

Local class berguna ketika:

- helper type terlalu kecil untuk top-level class;
- helper type hanya bermakna di satu method;
- kamu butuh beberapa method/state lokal;
- anonymous class terlalu padat;
- lambda tidak cukup karena butuh multiple methods atau named state.

Contoh parser kecil:

```java
public ValidationResult validate(String expression) {
    class Cursor {
        private int index;

        boolean hasNext() {
            return index < expression.length();
        }

        char next() {
            return expression.charAt(index++);
        }
    }

    Cursor cursor = new Cursor();
    while (cursor.hasNext()) {
        char c = cursor.next();
        // validation logic
    }
    return ValidationResult.ok();
}
```

### 5.3 Local Class dan Captured Variable

Local class dapat mengakses variable lokal yang final atau effectively final.

```java
public Predicate<String> minLength(int min) {
    class MinLengthPredicate implements Predicate<String> {
        @Override
        public boolean test(String value) {
            return value != null && value.length() >= min;
        }
    }
    return new MinLengthPredicate();
}
```

`min` dicapture.

Tidak boleh:

```java
public Predicate<String> invalid(int min) {
    min++;

    class P implements Predicate<String> {
        @Override
        public boolean test(String value) {
            return value.length() >= min; // tidak valid karena min tidak effectively final
        }
    }

    return new P();
}
```

Mental model:

> Local variable hidup di stack method. Jika object local class bisa hidup setelah method selesai, compiler harus capture nilai variable, bukan reference mutable ke stack frame.

Karena itu Java mensyaratkan final/effectively final.

### 5.4 Local Class vs Private Static Nested Class

Gunakan local class jika helper benar-benar method-specific.

Gunakan private static nested class jika:

- logic cukup besar;
- perlu unit test lebih mudah;
- perlu reuse oleh beberapa method;
- method menjadi terlalu panjang;
- helper punya invariant sendiri.

Contoh: jika local class mencapai puluhan baris, sering lebih sehat dinaikkan menjadi private static nested class.

---

## 6. Anonymous Class

### 6.1 Bentuk Dasar

Anonymous class mendeklarasikan dan menginstansiasi subtype sekaligus.

```java
Runnable task = new Runnable() {
    @Override
    public void run() {
        System.out.println("running");
    }
};
```

Ia tidak punya nama source-level.

### 6.2 Anonymous Class untuk Interface

```java
Comparator<String> byLength = new Comparator<>() {
    @Override
    public int compare(String a, String b) {
        return Integer.compare(a.length(), b.length());
    }
};
```

Sejak Java 8, banyak kasus ini lebih ringkas dengan lambda:

```java
Comparator<String> byLength = (a, b) -> Integer.compare(a.length(), b.length());
```

Namun anonymous class belum obsolete.

### 6.3 Anonymous Class untuk Abstract Class

Lambda hanya bisa untuk functional interface. Anonymous class bisa extend abstract class.

```java
abstract class RetryPolicy {
    abstract boolean shouldRetry(int attempt, Throwable error);

    Duration delay(int attempt) {
        return Duration.ofMillis(100L * attempt);
    }
}

RetryPolicy policy = new RetryPolicy() {
    @Override
    boolean shouldRetry(int attempt, Throwable error) {
        return attempt < 3 && error instanceof IOException;
    }
};
```

### 6.4 Anonymous Class dengan State

```java
Supplier<Long> sequence = new Supplier<>() {
    private long current;

    @Override
    public Long get() {
        return ++current;
    }
};
```

Lambda tidak bisa punya field sendiri secara langsung. Bisa capture mutable holder, tetapi itu sering lebih buruk.

### 6.5 Anonymous Class dan `this`

Ini perbedaan besar dengan lambda.

Anonymous class punya `this` sendiri:

```java
public class Demo {
    void run() {
        Runnable r = new Runnable() {
            @Override
            public void run() {
                System.out.println(this.getClass().getName());
            }
        };
    }
}
```

Di lambda, `this` merujuk ke enclosing instance:

```java
public class Demo {
    void run() {
        Runnable r = () -> System.out.println(this.getClass().getName());
    }
}
```

Jadi anonymous class masih berguna jika kamu butuh object identity/type sendiri.

### 6.6 Anonymous Class dan Diamond Operator

Modern Java memungkinkan diamond pada anonymous class dalam kondisi tertentu.

```java
Comparator<String> c = new Comparator<>() {
    @Override
    public int compare(String a, String b) {
        return a.compareTo(b);
    }
};
```

Tetap, jangan mengejar ringkas jika hasilnya membuat behavior tersembunyi.

---

## 7. Nested Class vs Lambda

Lambda bukan anonymous inner class. Ini penting.

| Aspek | Anonymous class | Lambda |
|---|---|---|
| Punya class body | Ya | Tidak secara source-level |
| Bisa extend abstract class | Ya | Tidak |
| Bisa implement interface multi-method | Ya | Tidak, harus functional interface |
| Punya `this` sendiri | Ya | Tidak |
| Bisa punya field | Ya | Tidak langsung |
| Cocok untuk | Object one-off dengan identity/state | Function kecil |
| Semantik | subtype/object | function-like implementation of SAM |

Contoh memilih lambda:

```java
users.sort(Comparator.comparing(User::lastLoginAt));
```

Contoh memilih anonymous class:

```java
TestWatcher watcher = new TestWatcher() {
    @Override
    protected void failed(Throwable e, Description description) {
        dumpDiagnostics(description);
    }
};
```

Karena `TestWatcher` bukan sekadar function kecil.

---

## 8. Access, Visibility, dan Encapsulation

Nested class dapat diberi modifier seperti member lain:

```java
public class Outer {
    public static class PublicNested {}
    protected static class ProtectedNested {}
    static class PackagePrivateNested {}
    private static class PrivateNested {}
}
```

Top-level class hanya bisa `public` atau package-private. Nested class bisa lebih granular.

Ini berguna untuk encapsulation:

```java
public final class Tokenizer {
    public List<Token> tokenize(String input) {
        Scanner scanner = new Scanner(input);
        return scanner.scanAll();
    }

    private static final class Scanner {
        private final String input;
        private int index;

        private Scanner(String input) {
            this.input = input;
        }

        private List<Token> scanAll() {
            // implementation detail
            return List.of();
        }
    }
}
```

`Scanner` bukan API package. Ia detail `Tokenizer`.

Namun jangan terlalu menyembunyikan hal yang punya domain meaning. Encapsulation bukan berarti semua class harus dimasukkan ke class besar.

---

## 9. Synthetic Members dan Compiler Reality

Nested/inner/local/anonymous class sering menghasilkan artifact compiler tambahan.

Misalnya source:

```java
public class Outer {
    private int value;

    class Inner {
        int read() {
            return value;
        }
    }
}
```

Compiler perlu membuat representasi class terpisah, secara umum seperti:

```text
Outer.class
Outer$Inner.class
```

Untuk inner class, compiler juga menyimpan reference ke outer instance, kira-kira seperti:

```java
final class Outer$Inner {
    private final Outer this$0;

    Outer$Inner(Outer outer) {
        this.this$0 = outer;
    }

    int read() {
        return this$0.value;
    }
}
```

Nama dan detail persisnya implementation detail compiler, tetapi mental model ini penting untuk memahami memory retention dan reflection behavior.

Anonymous/local class juga menghasilkan class file dengan nama synthetic-like, misalnya:

```text
Outer$1.class
Outer$1Local.class
```

Jangan membuat logic produksi bergantung pada nama file/class seperti ini.

---

## 10. Reflection View

Reflection dapat melihat banyak metadata terkait nested/local/anonymous class.

Contoh:

```java
Class<?> type = object.getClass();

System.out.println(type.isMemberClass());
System.out.println(type.isLocalClass());
System.out.println(type.isAnonymousClass());
System.out.println(type.getEnclosingClass());
System.out.println(type.getEnclosingMethod());
System.out.println(type.getDeclaringClass());
```

Gunakan ini untuk diagnostics, framework utility, atau tool, tetapi hati-hati:

- anonymous class name tidak stabil untuk API;
- local class tidak cocok dijadikan serialized type contract;
- inner class constructor mungkin punya parameter synthetic untuk outer instance;
- framework yang mengharapkan no-arg constructor bisa gagal;
- nested private class butuh access handling;
- JPMS dapat membatasi reflective access dari module lain.

Contoh jebakan reflective constructor:

```java
public class Outer {
    class Inner {
        Inner() {}
    }
}
```

Secara source, `Inner()` tampak tanpa argumen. Tetapi secara runtime, constructor inner class perlu enclosing `Outer`.

Framework yang mencoba `Inner.class.getDeclaredConstructor().newInstance()` bisa gagal karena constructor aktual tidak sesederhana yang terlihat.

---

## 11. Serialization dan Framework Boundary

Nested/inner/anonymous class sering bermasalah dengan serialization framework.

Masalah umum:

1. **Inner class membawa outer instance**  
   Serialization bisa mencoba membawa graph object besar.

2. **Anonymous/local class tidak punya nama stabil**  
   Buruk untuk long-term compatibility.

3. **Synthetic fields membingungkan mapper**  
   Framework reflection bisa melihat field compiler-generated.

4. **Constructor tidak sesuai ekspektasi**  
   Inner class membutuhkan enclosing instance.

5. **Private nested class sebagai DTO publik**  
   Mapper/API docs/schema generator bisa kesulitan atau menghasilkan schema aneh.

Rule praktis:

> Jangan gunakan non-static inner, local, atau anonymous class sebagai DTO/API payload/persistent entity/serialized contract.

Gunakan top-level class, record, atau public static nested class jika contract memang nested secara semantik.

Contoh acceptable:

```java
public final class SearchResponse {
    private final List<Item> items;

    public static final class Item {
        private final String id;
        private final String title;
    }
}
```

Lebih modern bisa:

```java
public record SearchResponse(List<Item> items) {
    public record Item(String id, String title) {}
}
```

Karena nested record secara implisit static.

---

## 12. Nested Records, Enums, and Interfaces

Dalam Java modern, nested type bukan hanya class biasa.

```java
public final class WorkflowDefinition {
    public enum State {
        DRAFT, SUBMITTED, APPROVED, REJECTED
    }

    public record Transition(State from, State to, String action) {}

    public sealed interface Rule permits RoleRule, AmountRule {}

    public record RoleRule(String role) implements Rule {}

    public record AmountRule(BigDecimal maxAmount) implements Rule {}
}
```

Ini bisa bagus jika semua type benar-benar bagian dari namespace `WorkflowDefinition`.

Tetapi hati-hati jika domain tumbuh:

```text
WorkflowDefinition.State
WorkflowDefinition.Transition
WorkflowDefinition.Rule
```

Jika type-type itu mulai digunakan oleh banyak bounded context/module lain, top-level package structure mungkin lebih jelas.

Rule:

> Nested type bagus untuk semantic ownership. Buruk jika hanya dipakai untuk menyembunyikan package design yang belum matang.

---

## 13. Builder Pattern dan Nested Class

Builder sering menjadi static nested class.

```java
public final class ReportRequest {
    private final LocalDate from;
    private final LocalDate to;
    private final Set<String> statuses;

    private ReportRequest(Builder builder) {
        if (builder.from == null || builder.to == null) {
            throw new IllegalStateException("date range is required");
        }
        if (builder.from.isAfter(builder.to)) {
            throw new IllegalStateException("from must be <= to");
        }
        this.from = builder.from;
        this.to = builder.to;
        this.statuses = Set.copyOf(builder.statuses);
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private LocalDate from;
        private LocalDate to;
        private Set<String> statuses = new LinkedHashSet<>();

        private Builder() {}

        public Builder from(LocalDate from) {
            this.from = from;
            return this;
        }

        public Builder to(LocalDate to) {
            this.to = to;
            return this;
        }

        public Builder addStatus(String status) {
            this.statuses.add(status);
            return this;
        }

        public ReportRequest build() {
            return new ReportRequest(this);
        }
    }
}
```

Kenapa `Builder` static?

Karena builder membangun `ReportRequest`, bukan hidup di dalam instance `ReportRequest` yang sudah ada.

Non-static builder biasanya smell:

```java
public class ReportRequest {
    public class Builder { // mencurigakan
    }
}
```

Untuk membuat builder, kamu butuh outer `ReportRequest` lebih dulu. Itu bertentangan dengan tujuan builder.

---

## 14. Iterator, Cursor, dan View Object

Inner class sering cocok untuk iterator/view yang benar-benar terikat ke outer instance.

```java
public final class CaseHistory implements Iterable<CaseHistory.Entry> {
    private final List<Entry> entries;

    public CaseHistory(List<Entry> entries) {
        this.entries = List.copyOf(entries);
    }

    @Override
    public Iterator<Entry> iterator() {
        return new HistoryIterator();
    }

    private final class HistoryIterator implements Iterator<Entry> {
        private int index;

        @Override
        public boolean hasNext() {
            return index < entries.size();
        }

        @Override
        public Entry next() {
            if (!hasNext()) {
                throw new NoSuchElementException();
            }
            return entries.get(index++);
        }
    }

    public record Entry(Instant at, String action) {}
}
```

`HistoryIterator` memang tidak bermakna tanpa `CaseHistory` tertentu.

Namun jika iterator object keluar lama, concurrency/mutation concerns tetap berlaku.

---

## 15. State Machine Modeling dengan Nested Types

Nested types bisa membuat state machine kecil lebih cohesive.

```java
public final class ApprovalWorkflow {
    public enum State {
        DRAFT,
        SUBMITTED,
        APPROVED,
        REJECTED
    }

    public record Command(String action, String actorRole) {}

    private static final class TransitionKey {
        private final State from;
        private final String action;

        private TransitionKey(State from, String action) {
            this.from = from;
            this.action = action;
        }

        @Override
        public boolean equals(Object o) {
            if (!(o instanceof TransitionKey other)) return false;
            return from == other.from && Objects.equals(action, other.action);
        }

        @Override
        public int hashCode() {
            return Objects.hash(from, action);
        }
    }

    private final Map<TransitionKey, State> transitions = Map.of(
            new TransitionKey(State.DRAFT, "submit"), State.SUBMITTED,
            new TransitionKey(State.SUBMITTED, "approve"), State.APPROVED,
            new TransitionKey(State.SUBMITTED, "reject"), State.REJECTED
    );

    public State apply(State current, Command command) {
        State next = transitions.get(new TransitionKey(current, command.action()));
        if (next == null) {
            throw new IllegalStateException("invalid transition");
        }
        return next;
    }
}
```

Di sini `TransitionKey` adalah implementation detail. Static nested private class tepat.

Tetapi `State` dan `Command` mungkin perlu public jika bagian dari API workflow.

---

## 16. Domain Encapsulation vs Over-Nesting

Over-nesting adalah problem nyata.

Contoh terlalu nested:

```java
public class CaseModule {
    public static class Application {
        public static class Appeal {
            public static class Decision {
                public static class Reason {}
            }
        }
    }
}
```

Ini biasanya tanda bahwa package design tidak jelas.

Lebih baik:

```text
case/
  application/
    Application.java
  appeal/
    Appeal.java
    AppealDecision.java
    AppealReason.java
```

Nested class bukan pengganti package architecture.

Gunakan nested type untuk semantic containment, bukan sebagai folder palsu.

---

## 17. Testing Strategy

Private nested class sulit dites langsung. Itu bukan selalu masalah.

Jika nested class private hanya implementation detail, test behavior outer class:

```java
class TokenizerTest {
    @Test
    void tokenizesWords() {
        Tokenizer tokenizer = new Tokenizer();
        assertThat(tokenizer.tokenize("a b")).hasSize(2);
    }
}
```

Namun jika private nested class punya logic kompleks, ada tiga kemungkinan:

1. logic terlalu kompleks untuk disembunyikan;
2. perlu diekstrak ke package-private top-level class;
3. perlu dipertahankan private tetapi diuji melalui scenario behavior yang cukup.

Contoh ekstraksi sehat:

```text
parser/
  ExpressionParser.java
  TokenCursor.java        // package-private
  Token.java
```

`TokenCursor` tidak public, tetapi bisa dites dari package yang sama.

Rule:

> Jangan membuat nested class private hanya supaya API terlihat bersih, kalau akibatnya logic penting menjadi sulit diverifikasi.

---

## 18. ClassLoader, Naming, dan Runtime Identity

Nested class tetap class biasa di runtime.

Ia punya:

- binary name;
- class loader;
- package;
- module;
- modifiers;
- constructors;
- methods;
- fields;
- annotations.

Contoh binary name:

```java
Map.Entry.class.getName();
// "java.util.Map$Entry"
```

Canonical name biasanya:

```java
Map.Entry.class.getCanonicalName();
// "java.util.Map.Entry"
```

Anonymous/local class bisa punya canonical name `null`.

Jangan gunakan canonical/simple name anonymous/local class untuk stable persistence, logging contract, metrics dimension, cache key lintas versi, atau schema name.

---

## 19. JPMS dan Nested Classes

JPMS bekerja pada module/package boundary, bukan nested-class boundary.

Jika package diekspor:

```java
module com.example.workflow {
    exports com.example.workflow.api;
}
```

Maka public nested type di public class dalam package tersebut juga menjadi bagian dari reachable API.

Contoh:

```java
package com.example.workflow.api;

public final class WorkflowApi {
    public static final class Request {}
}
```

`WorkflowApi.Request` adalah public API jika package diekspor.

Jadi jangan berpikir nested public class otomatis “lebih internal”. Public tetap public.

Untuk internal type, gunakan:

```java
private static final class InternalIndex {}
```

atau letakkan di package yang tidak diekspor:

```text
com.example.workflow.internal
```

---

## 20. Generated Code Boundary

Code generator sering menghasilkan nested class untuk:

- builder;
- descriptor;
- metadata;
- enum-like constants;
- schema type;
- field accessor;
- parser helper;
- visitor implementation.

Risiko generated nested class:

1. Nama terlalu panjang dan tidak stabil.
2. Public nested type menjadi API tidak sengaja.
3. Private nested type diakses framework reflection lalu gagal di JPMS.
4. Anonymous/local generated class sulit didiagnosis.
5. Binary compatibility rusak jika nested public type diganti top-level type.

Guideline untuk generator:

- generated public nested type harus dianggap contract;
- generated private static nested type aman sebagai implementation detail;
- hindari non-static inner generated type kecuali sangat perlu;
- hindari anonymous class untuk logic yang perlu traceability;
- generated type name harus deterministik;
- generated nested type harus punya ownership jelas.

---

## 21. Performance Consideration

Nested class sendiri bukan masalah performa besar. Yang lebih penting:

- apakah inner class menahan outer instance;
- apakah anonymous object dibuat berulang di hot path;
- apakah local/anonymous class membuat allocation yang tidak perlu;
- apakah class terlalu banyak mengganggu startup/class loading;
- apakah reflection terhadap nested/private class mahal karena tidak dicache;
- apakah generated nested class memperbesar bytecode secara signifikan.

Contoh hot path buruk:

```java
for (Order order : orders) {
    Validator validator = new Validator() {
        @Override
        public boolean valid(Order o) {
            return o.total().signum() >= 0;
        }
    };
    validator.valid(order);
}
```

Lebih baik:

```java
private static final Validator NON_NEGATIVE_TOTAL = order -> order.total().signum() >= 0;

for (Order order : orders) {
    NON_NEGATIVE_TOTAL.valid(order);
}
```

Tapi jangan premature optimize. Utamakan semantic clarity dulu.

---

## 22. Failure Model

### 22.1 Memory Leak karena Inner Class

```java
public class ScreenController {
    private final byte[] screenCache = new byte[50_000_000];

    public void register(EventBus bus) {
        bus.register(new Listener());
    }

    private class Listener implements EventListener {
        @Override
        public void onEvent(Event event) {
            // maybe does not use screenCache
        }
    }
}
```

Jika `EventBus` global menyimpan `Listener`, maka `ScreenController` ikut tertahan.

Mitigasi:

```java
private static final class Listener implements EventListener {
    private final WeakReference<ScreenController> controller;

    private Listener(ScreenController controller) {
        this.controller = new WeakReference<>(controller);
    }

    @Override
    public void onEvent(Event event) {
        ScreenController c = controller.get();
        if (c != null) {
            // handle
        }
    }
}
```

Atau unregister lifecycle secara eksplisit.

### 22.2 Framework Constructor Failure

```java
public class ApiResponse {
    public class Item {
        public Item() {}
    }
}
```

Mapper mungkin gagal membuat `Item` karena butuh `ApiResponse` instance.

Mitigasi:

```java
public class ApiResponse {
    public static class Item {
        public Item() {}
    }
}
```

### 22.3 Serialization Membawa Outer Object

```java
public class ExportJob implements Serializable {
    private LargeContext context;

    public class RowMapper implements Serializable {
        public String map(Row row) {
            return row.value();
        }
    }
}
```

`RowMapper` bisa membawa `ExportJob` tanpa sadar.

Mitigasi: static nested class.

### 22.4 Anonymous Class Sulit Diobservasi

Stack trace:

```text
com.example.WorkflowService$3.apply(WorkflowService.java:217)
```

Sulit dipahami dibanding:

```text
com.example.WorkflowService$ApprovalTransition.apply(...)
```

Jika behavior penting, beri nama.

### 22.5 Nested Public Type Menjadi API Tidak Sengaja

```java
public class InternalHelper {
    public static class Config {}
}
```

Jika package exported atau library public, `InternalHelper.Config` bisa dipakai consumer. Setelah itu sulit dihapus tanpa breaking change.

Mitigasi:

- jadikan private/package-private;
- letakkan di non-exported package;
- review public nested type sebagai API publik.

---

## 23. Decision Matrix

| Kebutuhan | Pilihan yang cenderung tepat |
|---|---|
| Type reusable lintas package/module | Top-level public/package-private class |
| Type hanya detail satu outer class | Private static nested class |
| Type butuh namespace outer dan public sebagai API | Public static nested class/record/enum |
| Object harus terikat ke instance outer tertentu | Non-static inner class |
| Helper hanya untuk satu method | Local class |
| One-off implementation kecil | Lambda atau anonymous class |
| One-off dengan state/multiple override | Anonymous class |
| Function kecil tanpa identity | Lambda |
| DTO/API payload | Top-level class/record atau static nested record/class |
| Persistent/serialized contract | Hindari local/anonymous/non-static inner |
| Generated helper internal | Private static nested class |
| Framework-instantiated class | Top-level atau static nested class |

---

## 24. Design Heuristics

### 24.1 Default to Static

Jika kamu menulis:

```java
private class Helper {}
```

tanya dulu:

> “Apakah Helper benar-benar membutuhkan outer instance?”

Jika tidak, jadikan:

```java
private static class Helper {}
```

### 24.2 Jangan Sembunyikan Domain Concept

Jika type punya nama domain kuat dan dipakai banyak tempat, jangan dipaksa nested.

Buruk:

```java
public class Case {
    public static class OfficerDecision {}
}
```

Jika `OfficerDecision` adalah concept penting, lebih baik:

```java
public final class OfficerDecision {}
```

atau package domain yang jelas.

### 24.3 Jangan Pakai Anonymous Class untuk Behavior Besar

Buruk:

```java
processor.register(new Handler() {
    @Override
    public void handle(Event event) {
        // 150 lines
    }
});
```

Lebih baik:

```java
processor.register(new AppealSubmittedHandler(...));
```

### 24.4 Public Nested Type adalah API

Jika public, treat as API:

- dokumentasikan;
- versioning-aware;
- compatibility-aware;
- jangan rename sembarangan;
- jangan ubah constructor/signature sembarangan.

### 24.5 Local Class Harus Tetap Lokal Secara Konsep

Jika local class mulai:

- punya banyak method;
- butuh test sendiri;
- butuh dependency injection;
- butuh logging/metrics;
- muncul di stack trace penting;

maka naikkan menjadi named nested/top-level class.

---

## 25. Refactoring Patterns

### 25.1 Inner to Static Nested

Sebelum:

```java
public class Parser {
    private class Cursor {
        private int index;
    }
}
```

Sesudah:

```java
public class Parser {
    private static class Cursor {
        private int index;
    }
}
```

Jika butuh data outer, inject eksplisit:

```java
private static class Cursor {
    private final String input;

    private Cursor(String input) {
        this.input = input;
    }
}
```

Manfaat:

- dependency eksplisit;
- no hidden outer retention;
- easier testing;
- clearer constructor.

### 25.2 Anonymous to Named Class

Sebelum:

```java
registry.register(new Rule() {
    @Override
    public boolean matches(Context context) {
        return context.amount().compareTo(BigDecimal.ZERO) > 0;
    }
});
```

Sesudah:

```java
registry.register(new PositiveAmountRule());

private static final class PositiveAmountRule implements Rule {
    @Override
    public boolean matches(Context context) {
        return context.amount().compareTo(BigDecimal.ZERO) > 0;
    }
}
```

### 25.3 Nested to Top-Level

Sebelum:

```java
public class Workflow {
    public static class Transition {}
}
```

Jika `Transition` tumbuh menjadi domain concept lintas workflow:

```java
public final class WorkflowTransition {}
```

atau:

```text
workflow/
  Workflow.java
  Transition.java
  TransitionRule.java
```

### 25.4 Local Class to Method Extraction

Kadang local class ada karena method terlalu besar. Mungkin solusi bukan nested class, tetapi ekstraksi method/object.

Sebelum:

```java
void process() {
    class Validator {}
    class Mapper {}
    class Writer {}
}
```

Mungkin lebih sehat:

```java
void process() {
    validate();
    map();
    write();
}
```

---

## 26. Code Review Checklist

Saat melihat nested/inner/local/anonymous class, tanyakan:

1. Apakah class ini perlu menjadi nested?
2. Apakah ia harus `static`?
3. Apakah ia membawa outer instance tanpa sadar?
4. Apakah lifetime-nya lebih panjang daripada outer object?
5. Apakah ia digunakan sebagai callback/listener/task?
6. Apakah ia akan diserialisasi?
7. Apakah framework perlu membuat instance-nya?
8. Apakah public nested type ini sengaja menjadi API?
9. Apakah nama nested type stabil dan bermakna?
10. Apakah anonymous class terlalu besar?
11. Apakah local class menyembunyikan logic penting?
12. Apakah package-private top-level class lebih jelas?
13. Apakah nested type membuat package architecture kabur?
14. Apakah reflection/JPMS akan bermasalah?
15. Apakah testing tetap bisa memverifikasi invariant penting?

---

## 27. Anti-Pattern Catalog

### 27.1 Non-Static Helper Class

```java
public class Service {
    private class Helper {}
}
```

Jika `Helper` tidak memakai state outer, ini smell.

### 27.2 Anonymous Class dengan Business Logic Besar

```java
new Handler() {
    @Override
    public void handle(Event e) {
        // business process panjang
    }
};
```

Sulit dites, sulit diobservasi, stack trace buruk.

### 27.3 Public Nested Class Tanpa API Intention

```java
public class Util {
    public static class InternalCacheKey {}
}
```

Membocorkan internal detail.

### 27.4 DTO sebagai Inner Class

```java
public class Response {
    public class Item {}
}
```

Harusnya static nested atau top-level.

### 27.5 Over-Nesting sebagai Package Replacement

```java
SystemA.ModuleB.FeatureC.CommandD
```

Pakai package/module structure, bukan nested class berlapis-lapis.

### 27.6 Local Class untuk Menyembunyikan Complexity

```java
void doEverything() {
    class Step1 {}
    class Step2 {}
    class Step3 {}
}
```

Ini biasanya method/object decomposition problem.

---

## 28. Practical Patterns

### 28.1 Private Static Nested Implementation

```java
public final class RateLimiter {
    private final Window window = new Window();

    public boolean allow() {
        return window.tryAcquire(Instant.now());
    }

    private static final class Window {
        private Instant start = Instant.now();
        private int count;

        boolean tryAcquire(Instant now) {
            // implementation
            return true;
        }
    }
}
```

Good when implementation is conceptually subordinate.

### 28.2 Public Static Nested Request/Response Type

```java
public final class UserSearchApi {
    public record Request(String keyword, int page, int size) {}

    public record Response(List<Item> items) {}

    public record Item(String id, String displayName) {}
}
```

Good for scoped API namespace, but still public API.

### 28.3 Package-Private Top-Level Alternative

```java
// File: WorkflowService.java
public final class WorkflowService {
    private final TransitionIndex index;
}

// File: TransitionIndex.java
final class TransitionIndex {
}
```

Good when helper deserves its own file and tests, but not public API.

### 28.4 Local Class for Method-Only Algorithm

```java
public List<Token> tokenize(String input) {
    class Cursor {
        int index;
        boolean hasNext() { return index < input.length(); }
        char next() { return input.charAt(index++); }
    }

    Cursor cursor = new Cursor();
    // scanning
    return List.of();
}
```

Good if small and local.

### 28.5 Anonymous Class for One-Off Override with State

```java
Iterator<Row> iterator = new Iterator<>() {
    private int index;

    @Override
    public boolean hasNext() {
        return index < rows.size();
    }

    @Override
    public Row next() {
        return rows.get(index++);
    }
};
```

Acceptable if short and local.

---

## 29. Top 1% Mental Model

Engineer biasa melihat nested class sebagai fitur syntax.

Engineer kuat melihatnya sebagai **ownership and lifetime declaration**.

Pertanyaan desainnya:

- Apakah type ini milik package, module, API, atau object tertentu?
- Apakah lifetime object ini boleh lebih panjang dari enclosing object?
- Apakah reference ke outer instance eksplisit atau tersembunyi?
- Apakah class ini menjadi bagian dari API publik?
- Apakah framework/reflection/build tool bisa memahami class ini?
- Apakah nested class memperjelas invariant atau menyembunyikan complexity?
- Apakah anonymous/local class membuat observability buruk?
- Apakah `static` menghilangkan coupling yang tidak perlu?

Nested class yang baik membuat ownership jelas.
Nested class yang buruk membuat dependency tersembunyi.

---

## 30. Summary

- Nested class adalah class di dalam class/interface lain.
- Static nested class tidak membawa enclosing instance otomatis.
- Inner class non-static membawa reference implisit ke outer object.
- Local class hidup dalam scope block/method dan bisa capture effectively final variable.
- Anonymous class cocok untuk one-off implementation, terutama jika butuh state, `this`, atau multiple override.
- Lambda bukan anonymous inner class; semantik `this`, identity, dan body berbeda.
- Default-kan helper nested class menjadi `static` kecuali butuh state outer.
- Hindari non-static inner/local/anonymous class sebagai DTO, entity, serialized contract, atau framework-instantiated type.
- Public nested type tetap public API.
- Nested class bukan pengganti package architecture.
- Gunakan nested type untuk semantic ownership, encapsulation, dan implementation hiding.

---

## 31. Latihan

### Latihan 1 — Static atau Non-Static?

Untuk tiap class berikut, tentukan apakah sebaiknya static nested, inner, top-level, local, anonymous, atau lambda:

1. `Order.Builder`
2. `Order.LineIterator`
3. `Workflow.TransitionKey`
4. `ApplicationSubmittedHandler`
5. `Comparator<User>` by created date
6. `ApiResponse.Item`
7. `CsvParser.Cursor`
8. `PaymentStatus`
9. `RetryPolicy` dengan override banyak method
10. `ValidationError` yang dipakai lintas module

### Latihan 2 — Refactor

Ubah kode berikut agar tidak menahan outer instance tanpa perlu:

```java
public class BatchService {
    private final byte[] cache = new byte[100_000_000];

    public Runnable createJob(String id) {
        return new Job(id);
    }

    private class Job implements Runnable {
        private final String id;

        private Job(String id) {
            this.id = id;
        }

        @Override
        public void run() {
            System.out.println(id);
        }
    }
}
```

### Latihan 3 — API Review

Review desain berikut:

```java
public class CaseApi {
    public class Request {}
    public class Response {}
    public class Error {}
}
```

Apa risikonya untuk JSON mapper, OpenAPI generator, dan consumer API?

### Latihan 4 — Package vs Nested

Kapan desain ini masih wajar:

```java
public final class WorkflowDefinition {
    public enum State {}
    public record Transition() {}
}
```

Kapan harus dipecah menjadi top-level package types?

---

## 32. Referensi

Referensi yang relevan untuk pendalaman:

- Java Language Specification, Java SE 25, terutama bagian class declarations, inner classes, local classes, anonymous classes, scope, access control, dan binary names.
- Oracle Java Tutorials / dev.java nested classes, local classes, anonymous classes, dan when-to-use guidance.
- Java SE 25 API `java.lang.Class`, terutama metadata seperti `isMemberClass`, `isLocalClass`, `isAnonymousClass`, `getEnclosingClass`, `getEnclosingMethod`, dan `getDeclaringClass`.
- Dokumentasi JPMS/JEP 261 untuk memahami package/module boundary dan strong encapsulation.

---

## 33. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-011.md
```

Topik berikutnya:

```text
Generics for API Designers: Variance, Bounds, Erasure, and Type Tokens
```

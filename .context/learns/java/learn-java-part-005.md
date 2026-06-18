# Learn Java Part 005 — Modern Java Language Features

> Target: Java hingga versi 25  
> Audience: software engineer yang ingin memahami Java modern bukan hanya sebagai syntax, tetapi sebagai alat modeling, refactoring, dan production engineering.  
> Fokus bagian ini: `var`, switch expression, pattern matching, records, sealed classes, text blocks, unnamed variables/patterns, module import declarations, dan relasinya dengan Java 25.

---

## 0. Posisi Materi Ini dalam Roadmap

Pada bagian sebelumnya kita sudah membangun fondasi:

- **Part 000**: Java sebagai bahasa + platform + runtime + ecosystem.
- **Part 001**: toolchain, build, runtime configuration, Maven/Gradle, project layout.
- **Part 002**: syntax dan semantics dasar Java.
- **Part 003**: object model, identity, lifecycle, inheritance, interface, equality.
- **Part 004**: type system, generics, erasure, variance, API design.

Bagian ini masuk ke **modern Java language features**. Tujuannya bukan sekadar “apa fitur baru Java”, tetapi:

1. memahami masalah desain yang ingin diselesaikan oleh fitur tersebut;
2. memahami semantics-nya secara akurat;
3. tahu kapan fitur itu memperjelas model;
4. tahu kapan fitur itu justru membuat kode lebih buruk;
5. mampu mengombinasikan fitur-fitur modern untuk membangun domain model yang kuat.

Modern Java bukan berarti “Java berubah menjadi Kotlin/Scala”. Modern Java tetap Java: nominal type system, object-oriented core, strong backward compatibility, explicitness, dan runtime JVM. Namun sejak Java 10 sampai Java 25, Java mendapat beberapa fitur yang mengurangi ceremony dan membuat modeling data/state lebih aman.

---

## 1. Peta Besar Fitur Modern Java

Secara kasar, evolusi modern Java bergerak ke empat arah:

```text
1. Mengurangi ceremony lokal
   -> var, compact source files, instance main methods, module imports

2. Membuat decision logic lebih aman
   -> switch expression, pattern matching, exhaustiveness

3. Membuat data modeling lebih eksplisit
   -> records, record patterns

4. Membatasi hierarchy agar domain lebih defendable
   -> sealed classes/interfaces
```

Timeline fitur yang relevan:

| Fitur | Final / Status penting | Inti manfaat |
|---|---:|---|
| Local-variable type inference `var` | Java 10 | Mengurangi redundancy pada local variables. |
| `var` untuk lambda parameter | Java 11 | Membuat lambda parameter bisa memakai annotation dengan syntax inferred. |
| Switch expressions | Java 14 | `switch` bisa menghasilkan value dan lebih aman dari fall-through. |
| Text blocks | Java 15 | Multiline string literal untuk SQL, JSON, XML, templates, test fixture. |
| Pattern matching for `instanceof` | Java 16 | Test type + bind variable dalam satu operasi aman. |
| Records | Java 16 | Transparent data carrier dengan boilerplate minimal. |
| Sealed classes/interfaces | Java 17 | Membatasi subclass/implementation yang sah. |
| Record patterns | Java 21 | Deconstruct record dalam pattern matching. |
| Pattern matching for `switch` | Java 21 | Multi-way dispatch berbasis type/pattern dengan exhaustiveness. |
| Unnamed variables and patterns `_` | Java 22 | Menandai variable/pattern yang memang tidak dipakai. |
| Module import declarations | Java 25 | `import module M;` untuk mengimpor exported API dari module. |
| Primitive types in patterns, `instanceof`, and `switch` | Java 25 preview | Membuat primitive lebih seragam dalam pattern/switch. |

Hal terpenting: fitur-fitur ini bukan berdiri sendiri. Kombinasi yang paling mengubah cara berpikir Java modern adalah:

```text
records + sealed hierarchy + pattern matching + switch expression
```

Kombinasi ini membuat Java lebih kuat untuk memodelkan:

- command;
- event;
- domain state;
- error/rejection;
- workflow transition;
- parse tree;
- validation result;
- protocol message;
- regulatory case lifecycle.

---

## 2. Mental Model: Java Modern Bukan “Less Code”, Tapi “Less Accidental Code”

Banyak developer salah membaca modern Java sebagai usaha membuat Java lebih pendek. Itu tidak sepenuhnya benar.

Yang ingin dikurangi adalah **accidental code**, bukan **essential code**.

Contoh accidental code:

```java
public final class CustomerId {
    private final String value;

    public CustomerId(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CustomerId that)) return false;
        return java.util.Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(value);
    }

    @Override
    public String toString() {
        return "CustomerId[value=" + value + "]";
    }
}
```

Versi record:

```java
public record CustomerId(String value) {
    public CustomerId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("customer id must not be blank");
        }
    }
}
```

Yang hilang bukan domain logic. Yang hilang adalah boilerplate yang rentan salah.

Prinsip desainnya:

```text
Tulis explicit code untuk invariant, decision, side effect, dan business rule.
Kurangi code mekanis yang hanya mengulang informasi yang sudah tersedia di type declaration.
```

---

# 5.1 `var` — Local Variable Type Inference

## 5.1.1 Masalah yang Diselesaikan

Sebelum `var`, Java sering memaksa kita mengulang type yang sudah jelas dari initializer:

```java
Map<CustomerId, List<ComplianceCase>> casesByCustomer = new HashMap<CustomerId, List<ComplianceCase>>();
```

Dengan diamond operator sudah lebih pendek:

```java
Map<CustomerId, List<ComplianceCase>> casesByCustomer = new HashMap<>();
```

Dengan `var`:

```java
var casesByCustomer = new HashMap<CustomerId, List<ComplianceCase>>();
```

`var` memindahkan fokus dari “apa type di kiri” ke “apa object yang dibuat di kanan”. Namun `var` tidak selalu lebih baik. Ia hanya baik jika initializer cukup jelas.

---

## 5.1.2 Apa Itu `var` Secara Semantik

`var` adalah **local variable type inference**.

Artinya:

```java
var name = initializer;
```

Compiler menentukan type variable dari type initializer.

Ini bukan dynamic typing.

```java
var x = "hello";
x = 10; // compile error
```

Mental model:

```text
var bukan “variable tanpa type”.
var adalah “biarkan compiler menulis type lokal yang sudah bisa disimpulkan”.
```

Setelah compile, variable tetap punya static type yang pasti.

---

## 5.1.3 Tempat `var` Boleh Digunakan

`var` boleh untuk:

### Local variable dengan initializer

```java
var name = "Fajar";
var count = 10;
var ids = List.of("A", "B", "C");
```

### Enhanced for-loop

```java
for (var id : ids) {
    System.out.println(id);
}
```

### Traditional for-loop

```java
for (var i = 0; i < 10; i++) {
    System.out.println(i);
}
```

### Try-with-resources

```java
try (var reader = Files.newBufferedReader(Path.of("input.txt"))) {
    System.out.println(reader.readLine());
}
```

### Lambda parameter, sejak Java 11

```java
Function<String, String> normalize = (var s) -> s.trim().toLowerCase();
```

Kegunaan utamanya adalah saat ingin memberi annotation pada lambda parameter:

```java
BiFunction<String, String, String> join = (@Deprecated var a, @Deprecated var b) -> a + b;
```

Contoh annotation `@Deprecated` di atas hanya demonstrasi syntax, bukan rekomendasi desain.

---

## 5.1.4 Tempat `var` Tidak Boleh Digunakan

Tidak boleh untuk field:

```java
class User {
    var name = "x"; // compile error
}
```

Tidak boleh untuk method parameter:

```java
void process(var request) { // compile error
}
```

Tidak boleh untuk return type:

```java
var findUser() { // compile error
    return new User();
}
```

Tidak boleh tanpa initializer:

```java
var x; // compile error
```

Tidak boleh dengan initializer `null`:

```java
var x = null; // compile error
```

Tidak boleh dengan array initializer tanpa target type:

```java
var numbers = {1, 2, 3}; // compile error
```

Harus ditulis:

```java
var numbers = new int[] {1, 2, 3};
```

---

## 5.1.5 `var` dan Type yang Terlalu Spesifik

Perhatikan ini:

```java
var users = new ArrayList<User>();
```

Type variable `users` adalah `ArrayList<User>`, bukan `List<User>`.

Kalau API ingin bergantung pada interface, tulis eksplisit:

```java
List<User> users = new ArrayList<>();
```

Ini penting. `var` mengambil type dari kanan. Jika kanan concrete, kiri menjadi concrete.

Mental model:

```text
var mengikuti initializer, bukan intention kita.
Jika intention adalah abstraction, tulis abstraction secara eksplisit.
```

Contoh buruk:

```java
var repository = new JpaCustomerRepository(entityManager);
```

Kalau variable ini seharusnya dilihat sebagai contract:

```java
CustomerRepository repository = new JpaCustomerRepository(entityManager);
```

---

## 5.1.6 `var` dan Numeric Type Surprise

```java
var a = 1;   // int
var b = 1L;  // long
var c = 1.0; // double
var d = 1.0f;// float
```

`var` tidak menebak dari nama variable atau konteks bisnis. Ia hanya mengikuti literal.

Contoh bug subtle:

```java
var timeout = 30; // int, bukan Duration
```

Lebih baik:

```java
Duration timeout = Duration.ofSeconds(30);
```

atau:

```java
var timeout = Duration.ofSeconds(30);
```

Yang kedua masih jelas karena initializer membawa domain type.

---

## 5.1.7 `var` dan Anonymous Class

`var` bisa mempertahankan type anonymous class yang tidak bisa ditulis secara eksplisit:

```java
var handler = new Object() {
    void handle() {
        System.out.println("handling");
    }
};

handler.handle();
```

Tanpa `var`, jika ditulis:

```java
Object handler = new Object() {
    void handle() {}
};

handler.handle(); // compile error
```

Ini fitur kuat, tapi jarang perlu di production application code. Gunakan dengan hati-hati.

---

## 5.1.8 Kapan Menggunakan `var`

Gunakan `var` ketika:

### Initializer sudah jelas

```java
var customerId = new CustomerId(rawCustomerId);
var createdAt = Instant.now();
var path = Path.of("data", "input.txt");
```

### Type eksplisit membuat noise

```java
var grouped = cases.stream()
    .collect(Collectors.groupingBy(ComplianceCase::status));
```

### Dalam loop sederhana

```java
for (var event : events) {
    dispatcher.dispatch(event);
}
```

### Dalam try-with-resources

```java
try (var stream = Files.lines(path)) {
    stream.forEach(System.out::println);
}
```

---

## 5.1.9 Kapan Jangan Menggunakan `var`

Jangan gunakan `var` jika initializer tidak cukup informatif:

```java
var result = service.execute(request);
```

Apa type `result`? `boolean`? `Response`? `Result<Case>`? `List<Event>`?

Lebih baik:

```java
CaseSubmissionResult result = service.execute(request);
```

Jangan gunakan `var` jika type penting untuk business meaning:

```java
var amount = calculateAmount();
```

Lebih baik:

```java
Money amount = calculateAmount();
```

Jangan gunakan `var` jika membuat abstraction bocor:

```java
var repository = new OracleCaseRepository(...);
```

Lebih baik:

```java
CaseRepository repository = new OracleCaseRepository(...);
```

---

## 5.1.10 Style Rule untuk Engineer Serius

Gunakan aturan ini:

```text
Use var when it removes duplication.
Do not use var when it removes meaning.
```

Checklist:

1. Apakah pembaca bisa tahu type dari initializer tanpa membuka method lain?
2. Apakah type-nya membawa domain meaning penting?
3. Apakah kita ingin variable ini dilihat sebagai interface, bukan implementation?
4. Apakah hasil method call ambigu?
5. Apakah nama variable cukup kuat untuk menggantikan type eksplisit?

Contoh baik:

```java
var violations = validationService.validate(command);
```

Ini hanya baik jika `violations` sangat jelas dari nama method dan variable.

Lebih eksplisit:

```java
List<ValidationViolation> violations = validationService.validate(command);
```

Dalam domain/regulatory system, eksplisit sering lebih baik karena tipe adalah bagian dari auditability dan maintainability.

---

# 5.2 Switch Expressions

## 5.2.1 Masalah pada `switch` Lama

`switch` lama di Java punya beberapa masalah:

1. default fall-through;
2. statement-only, tidak menghasilkan value;
3. scope antar `case` sering membingungkan;
4. rawan lupa `break`;
5. sulit dipakai untuk expression-oriented modeling.

Contoh lama:

```java
String label;
switch (status) {
    case DRAFT:
        label = "Draft";
        break;
    case SUBMITTED:
        label = "Submitted";
        break;
    case APPROVED:
        label = "Approved";
        break;
    default:
        label = "Unknown";
}
```

Masalahnya: `label` harus mutable dan assignment tersebar.

---

## 5.2.2 Switch Expression Modern

```java
String label = switch (status) {
    case DRAFT -> "Draft";
    case SUBMITTED -> "Submitted";
    case APPROVED -> "Approved";
};
```

Mental model:

```text
switch expression adalah decision table yang menghasilkan satu value.
```

Ini membuat code lebih aman karena:

- tidak perlu mutable temporary variable;
- tidak ada accidental fall-through dengan `->`;
- compiler bisa membantu exhaustiveness;
- decision logic lebih lokal.

---

## 5.2.3 `case ->` vs `case :`

Modern switch mendukung arrow label:

```java
switch (status) {
    case DRAFT -> System.out.println("draft");
    case SUBMITTED -> System.out.println("submitted");
    case APPROVED -> System.out.println("approved");
}
```

Dengan `->`, satu case tidak jatuh ke case berikutnya.

Switch lama:

```java
switch (status) {
    case DRAFT:
        System.out.println("draft");
    case SUBMITTED:
        System.out.println("submitted");
}
```

Jika tidak ada `break`, `DRAFT` akan lanjut ke `SUBMITTED`. Ini sering bug.

---

## 5.2.4 Multiple Labels

```java
String severity = switch (status) {
    case DRAFT, RETURNED -> "editable";
    case SUBMITTED, UNDER_REVIEW -> "in-progress";
    case APPROVED, REJECTED -> "terminal";
};
```

Gunakan multiple labels jika beberapa state memang punya konsekuensi sama.

Jangan gabungkan case hanya karena implementasi saat ini sama, jika secara domain mereka berbeda dan mungkin diverge.

---

## 5.2.5 Block Case dan `yield`

Jika logic butuh beberapa statement:

```java
String message = switch (decision) {
    case APPROVE -> {
        audit.log("approval message generated");
        yield "Approved";
    }
    case REJECT -> {
        audit.log("rejection message generated");
        yield "Rejected";
    }
};
```

`yield` mengembalikan value dari block case.

Rule:

```text
Gunakan expression langsung untuk mapping sederhana.
Gunakan block + yield jika ada logic kecil yang masih lokal.
Jika block terlalu panjang, extract method.
```

---

## 5.2.6 Exhaustiveness

Switch expression harus menghasilkan value untuk semua kemungkinan.

Untuk enum:

```java
String label = switch (status) {
    case DRAFT -> "Draft";
    case SUBMITTED -> "Submitted";
    case APPROVED -> "Approved";
    case REJECTED -> "Rejected";
};
```

Jika `status` enum punya value baru dan switch tidak lengkap, compiler bisa membantu mendeteksi.

Namun hati-hati dengan `default`.

```java
String label = switch (status) {
    case DRAFT -> "Draft";
    default -> "Other";
};
```

`default` membuat code tahan compile ketika enum bertambah, tapi bisa menyembunyikan business case baru.

Dalam domain serius, sering lebih baik **tidak memakai default** untuk enum/sealed hierarchy agar compiler memaksa kita menangani varian baru.

---

## 5.2.7 Switch Expression untuk Domain State

Contoh regulatory case lifecycle:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}

boolean isTerminal(CaseStatus status) {
    return switch (status) {
        case APPROVED, REJECTED, CLOSED -> true;
        case DRAFT, SUBMITTED, UNDER_REVIEW -> false;
    };
}
```

Ini lebih baik dari:

```java
return status == APPROVED || status == REJECTED || status == CLOSED;
```

Karena switch memberi struktur eksplisit untuk seluruh state.

---

## 5.2.8 Switch Expression Anti-Pattern

### Terlalu banyak business logic dalam switch

```java
return switch (command.type()) {
    case "APPROVE" -> {
        validateA();
        updateB();
        notifyC();
        auditD();
        publishE();
        yield result;
    }
    // banyak case lain...
};
```

Ini bukan decision table lagi. Ini orchestration besar.

Lebih baik:

```java
return switch (command) {
    case ApproveCommand c -> approveHandler.handle(c);
    case RejectCommand c -> rejectHandler.handle(c);
    case ReopenCommand c -> reopenHandler.handle(c);
};
```

Switch cukup menentukan dispatch. Detail business rule pindah ke handler.

---

# 5.3 Pattern Matching

## 5.3.1 Masalah Sebelum Pattern Matching

Java lama sering memakai pola:

```java
if (obj instanceof String) {
    String s = (String) obj;
    System.out.println(s.toUpperCase());
}
```

Ada tiga operasi:

1. test type;
2. cast;
3. bind ke variable.

Problem:

- verbose;
- cast bisa salah;
- variable terpisah dari condition;
- logic makin buruk pada hierarchy besar.

Pattern matching menggabungkan test + extraction.

---

## 5.3.2 Pattern Matching for `instanceof`

```java
if (obj instanceof String s) {
    System.out.println(s.toUpperCase());
}
```

Mental model:

```text
Jika obj adalah String, maka dalam branch true tersedia variable s bertipe String.
```

Variable `s` hanya valid ketika match pasti terjadi.

---

## 5.3.3 Flow-Sensitive Scope

```java
if (obj instanceof String s && s.length() > 5) {
    System.out.println(s.toUpperCase());
}
```

Ini valid karena `s` tersedia setelah sisi kiri `&&` terbukti benar.

Tapi ini tidak valid:

```java
if (obj instanceof String s || s.length() > 5) { // compile error
    System.out.println(s);
}
```

Kenapa? Karena pada `||`, sisi kanan bisa dievaluasi ketika sisi kiri false. Jika sisi kiri false, `s` tidak ada.

Mental model:

```text
Pattern variable hidup hanya di jalur kontrol yang menjamin pattern match berhasil.
```

---

## 5.3.4 Pattern Matching for `switch`

Dengan Java modern, `switch` bisa dispatch berdasarkan type:

```java
String describe(Object value) {
    return switch (value) {
        case String s -> "string: " + s;
        case Integer i -> "integer: " + i;
        case Long l -> "long: " + l;
        case null -> "null";
        default -> "unknown";
    };
}
```

Ini bukan hanya syntax sugar. Ini mengubah cara kita menulis multi-way type dispatch.

Sebelumnya:

```java
if (value == null) {
    return "null";
} else if (value instanceof String s) {
    return "string: " + s;
} else if (value instanceof Integer i) {
    return "integer: " + i;
} else {
    return "unknown";
}
```

Switch pattern lebih baik jika:

- jumlah case lebih dari dua;
- semua case ada pada satu domain decision;
- perlu exhaustiveness;
- type hierarchy closed/sealed.

---

## 5.3.5 `case null`

Java lama terkenal karena `switch(null)` dapat menghasilkan `NullPointerException`.

Pattern switch memungkinkan `case null`:

```java
String describe(Object value) {
    return switch (value) {
        case null -> "missing";
        case String s -> "string " + s;
        default -> "other";
    };
}
```

Namun jangan jadikan ini alasan membiarkan `null` tersebar. Dalam domain model, lebih baik cegah null pada boundary.

---

## 5.3.6 Guards dengan `when`

Pattern bisa diberi guard:

```java
String classify(Object value) {
    return switch (value) {
        case String s when s.isBlank() -> "blank string";
        case String s -> "string";
        case Integer i when i > 0 -> "positive integer";
        case Integer i -> "integer";
        case null -> "null";
        default -> "other";
    };
}
```

Guard berguna untuk kondisi tambahan setelah type cocok.

Rule:

```text
Pattern = bentuk data.
Guard = kondisi tambahan atas data yang sudah diekstrak.
```

Jangan taruh logic berat di guard.

Buruk:

```java
case CaseRecord c when repository.exists(c.id()) && remoteService.isValid(c) -> ...
```

Kenapa buruk?

- switch menjadi punya side effect;
- sulit dites;
- ordering case menjadi riskan;
- remote call di decision expression mengejutkan.

Lebih baik validasi di luar atau extract policy method yang jelas.

---

## 5.3.7 Dominance: Urutan Case Penting

```java
return switch (value) {
    case Object o -> "object";
    case String s -> "string"; // unreachable / dominated
};
```

`Object` menangkap semua non-null object, sehingga `String` tidak pernah tercapai.

Urutkan dari paling spesifik ke paling umum:

```java
return switch (value) {
    case String s -> "string";
    case Number n -> "number";
    case Object o -> "object";
    case null -> "null";
};
```

Pattern switch bukan sekadar mapping; ia punya semantics matching berurutan dan dominance checking.

---

## 5.3.8 Record Patterns

Record pattern memungkinkan deconstruction:

```java
record Point(int x, int y) {}

String describe(Object value) {
    return switch (value) {
        case Point(int x, int y) -> "Point(" + x + ", " + y + ")";
        default -> "unknown";
    };
}
```

Tanpa record pattern:

```java
if (value instanceof Point p) {
    int x = p.x();
    int y = p.y();
}
```

Dengan record pattern, test dan deconstruction menyatu.

---

## 5.3.9 Nested Record Patterns

```java
record CustomerId(String value) {}
record Customer(CustomerId id, String name) {}
record CaseRecord(String caseNo, Customer customer) {}

String describe(Object value) {
    return switch (value) {
        case CaseRecord(String caseNo, Customer(CustomerId(String id), String name)) ->
            caseNo + " belongs to " + name + " / " + id;
        default -> "unknown";
    };
}
```

Ini kuat, tapi bisa cepat menjadi terlalu padat.

Rule:

```text
Gunakan nested pattern jika struktur kecil dan jelas.
Jika nesting lebih dari 2 level, pertimbangkan extract method atau variable eksplisit.
```

---

## 5.3.10 Pattern Matching dan Sealed Hierarchy

Pattern matching paling kuat jika hierarchy tertutup.

```java
sealed interface CaseCommand permits SubmitCase, ApproveCase, RejectCase {}

record SubmitCase(String caseNo) implements CaseCommand {}
record ApproveCase(String caseNo, String officerId) implements CaseCommand {}
record RejectCase(String caseNo, String reason) implements CaseCommand {}

CommandResult handle(CaseCommand command) {
    return switch (command) {
        case SubmitCase c -> submit(c);
        case ApproveCase c -> approve(c);
        case RejectCase c -> reject(c);
    };
}
```

Karena `CaseCommand` sealed, compiler tahu semua implementation yang mungkin. Jika kita menambah:

```java
record ReopenCase(String caseNo, String reason) implements CaseCommand {}
```

Compiler akan memaksa switch diperbarui.

Ini sangat kuat untuk domain yang perlu defensibility.

---

## 5.3.11 Primitive Types in Patterns, `instanceof`, and `switch` di Java 25

Java 25 memiliki preview feature untuk memperluas pattern matching agar dapat bekerja dengan primitive types di pattern context, dan memperluas `instanceof`/`switch` agar lebih seragam dengan primitive types.

Karena statusnya preview di Java 25, aturan production-nya:

```text
Boleh dipelajari dan dieksperimen.
Jangan jadikan default untuk production code kecuali organisasi memang punya policy preview-feature adoption.
```

Compile/run preview feature:

```bash
javac --release 25 --enable-preview Example.java
java --enable-preview Example
```

Dalam materi utama kita akan memperlakukan fitur ini sebagai arah evolusi, bukan fondasi production.

---

# 5.4 Records

## 5.4.1 Masalah yang Diselesaikan Records

Banyak class di Java sebenarnya hanya data carrier:

```java
public final class Violation {
    private final String code;
    private final String message;

    public Violation(String code, String message) {
        this.code = code;
        this.message = message;
    }

    public String code() {
        return code;
    }

    public String message() {
        return message;
    }

    @Override
    public boolean equals(Object o) { ... }

    @Override
    public int hashCode() { ... }

    @Override
    public String toString() { ... }
}
```

Dengan record:

```java
public record Violation(String code, String message) {}
```

Compiler membuat:

- private final fields;
- canonical constructor;
- accessor `code()` dan `message()`;
- `equals`;
- `hashCode`;
- `toString`.

Mental model:

```text
Record adalah nominal transparent data carrier.
```

Nominal berarti type tetap punya nama. `CustomerId(String value)` berbeda dari `CaseId(String value)` walaupun shape-nya sama.

Transparent berarti komponen datanya adalah bagian eksplisit dari API record.

---

## 5.4.2 Record Bukan Sekadar Lombok `@Data`

Record bukan hanya generator getter/setter.

Perbedaan penting:

| Aspek | Record | Lombok `@Data` class biasa |
|---|---|---|
| Semantics bahasa | Ya | Tidak, compile-time code generation library |
| Immutable by default | Field final | Tergantung class |
| Accessor style | `name()` | biasanya `getName()` |
| Identity intention | data/value-like | tergantung desain |
| Pattern matching support | kuat | tidak setransparan record |
| Constructor semantics | canonical/compact | class biasa |

Record menyatakan intention: “type ini adalah data aggregate transparan”.

---

## 5.4.3 Canonical Constructor

Record:

```java
public record CustomerId(String value) {}
```

Canonical constructor-nya secara konseptual:

```java
public CustomerId(String value) {
    this.value = value;
}
```

Kita bisa menulis canonical constructor eksplisit:

```java
public record CustomerId(String value) {
    public CustomerId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("value must not be blank");
        }
        this.value = value;
    }
}
```

---

## 5.4.4 Compact Constructor

Lebih idiomatik:

```java
public record CustomerId(String value) {
    public CustomerId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("value must not be blank");
        }
    }
}
```

Dalam compact constructor:

- parameter tersedia dengan nama komponen;
- assignment ke field dilakukan otomatis setelah body;
- kita bisa validasi/normalize parameter.

Contoh normalization:

```java
public record CustomerId(String value) {
    public CustomerId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("value must not be blank");
        }
        value = value.trim().toUpperCase(Locale.ROOT);
    }
}
```

Mental model:

```text
Compact constructor adalah tempat menjaga invariant record sebelum state disimpan.
```

---

## 5.4.5 Record dan Shallow Immutability

Record field memang final, tapi object di dalamnya belum tentu immutable.

```java
public record CaseBatch(List<String> caseNumbers) {}
```

Masalah:

```java
var list = new ArrayList<String>();
list.add("C-001");

var batch = new CaseBatch(list);
list.add("C-002");

System.out.println(batch.caseNumbers()); // bisa berubah
```

Solusi:

```java
public record CaseBatch(List<String> caseNumbers) {
    public CaseBatch {
        caseNumbers = List.copyOf(caseNumbers);
    }
}
```

Namun accessor masih mengembalikan list immutable copy.

Untuk array:

```java
public record Payload(byte[] bytes) {}
```

Ini rawan karena array mutable.

Lebih aman:

```java
public record Payload(byte[] bytes) {
    public Payload {
        bytes = bytes.clone();
    }

    @Override
    public byte[] bytes() {
        return bytes.clone();
    }
}
```

Rule:

```text
Record immutable secara field assignment, bukan otomatis deep immutable.
Untuk mutable component, lakukan defensive copy.
```

---

## 5.4.6 Record untuk Value Object

Contoh value object:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (amount.signum() < 0) {
            throw new IllegalArgumentException("amount must not be negative");
        }
    }

    public Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("currency mismatch");
        }
        return new Money(amount.add(other.amount), currency);
    }
}
```

Record boleh punya method. Record bukan “anemic” secara otomatis.

Prinsip:

```text
Record bagus untuk value object jika identity-nya memang berdasarkan seluruh komponennya.
```

---

## 5.4.7 Record untuk DTO

```java
public record SubmitCaseRequest(
    String applicantId,
    String subject,
    String description
) {}
```

Record cocok untuk DTO jika:

- field-nya fixed;
- tidak butuh lazy loading;
- tidak butuh framework proxy;
- serialization framework mendukung record;
- constructor validation sesuai kebutuhan.

Untuk public API, hati-hati: komponen record adalah API contract. Mengubah komponen record bisa breaking.

---

## 5.4.8 Record untuk Domain Event

```java
public record CaseSubmitted(
    String eventId,
    String caseNo,
    String submittedBy,
    Instant submittedAt
) implements DomainEvent {}
```

Record sangat cocok untuk event karena event biasanya:

- immutable;
- data-centric;
- harus mudah di-log;
- harus mudah di-serialize;
- identity-nya bukan object identity runtime.

Namun event versioning tetap harus dipikirkan.

Contoh evolution:

```java
public record CaseSubmittedV1(String caseNo, Instant submittedAt) implements DomainEvent {}
public record CaseSubmittedV2(String caseNo, String submittedBy, Instant submittedAt) implements DomainEvent {}
```

Atau gunakan envelope:

```java
public record EventEnvelope<T>(
    String eventId,
    String eventType,
    int schemaVersion,
    Instant occurredAt,
    T payload
) {}
```

---

## 5.4.9 Record dan JPA/Hibernate

Entity JPA biasanya tidak cocok menjadi record karena JPA tradisional butuh:

- no-arg constructor;
- mutable fields;
- proxy/lazy loading;
- identity lifecycle;
- dirty checking.

Record lebih cocok untuk:

- projection;
- read model;
- DTO query result;
- domain value object tertentu;
- event payload.

Contoh projection:

```java
public record CaseSummary(String caseNo, String status, Instant submittedAt) {}
```

---

## 5.4.10 Record Anti-Pattern

### Record dengan terlalu banyak komponen

```java
public record CaseRecord(
    String a, String b, String c, String d, String e,
    String f, String g, String h, String i, String j
) {}
```

Jika komponen terlalu banyak, kemungkinan type ini belum dimodelkan dengan benar.

Pecah menjadi value object:

```java
public record ApplicantInfo(String applicantId, String name) {}
public record CaseContent(String subject, String description) {}
public record CaseMetadata(Instant createdAt, String createdBy) {}

public record CaseDraft(
    ApplicantInfo applicant,
    CaseContent content,
    CaseMetadata metadata
) {}
```

### Record untuk mutable aggregate root

Jika object punya lifecycle kompleks, identity, mutation, invariant lintas operasi, record mungkin bukan pilihan utama.

```java
public record CaseAggregate(...) { }
```

Bisa saja, tetapi hati-hati. Aggregate root sering butuh behavior dan controlled mutation/event application. Class biasa mungkin lebih tepat.

---

# 5.5 Sealed Classes and Interfaces

## 5.5.1 Masalah yang Diselesaikan Sealed Types

Inheritance biasa terlalu terbuka.

```java
public interface CaseCommand {}
```

Siapa pun bisa membuat implementation:

```java
class DangerousCommand implements CaseCommand {}
```

Dalam domain serius, ini bisa membuat model tidak defendable. Kita ingin mengatakan:

```text
CaseCommand hanya boleh berupa SubmitCase, ApproveCase, RejectCase, ReopenCase.
Tidak ada bentuk lain.
```

Sealed interface:

```java
public sealed interface CaseCommand
    permits SubmitCase, ApproveCase, RejectCase, ReopenCase {
}
```

---

## 5.5.2 Syntax Dasar

```java
public sealed class Shape permits Circle, Rectangle, Square {}

public final class Circle extends Shape {}
public final class Rectangle extends Shape {}
public final class Square extends Shape {}
```

Untuk interface:

```java
public sealed interface PaymentMethod permits CardPayment, BankTransfer {}

public record CardPayment(String cardToken) implements PaymentMethod {}
public record BankTransfer(String accountNo) implements PaymentMethod {}
```

Record bersifat final secara implisit, sehingga cocok sebagai permitted subtype.

---

## 5.5.3 `final`, `sealed`, dan `non-sealed`

Subtype dari sealed type harus memilih salah satu:

### `final`

```java
public final class Circle extends Shape {}
```

Tidak bisa diturunkan lagi.

### `sealed`

```java
public sealed class Rectangle extends Shape permits FilledRectangle, EmptyRectangle {}
```

Masih tertutup, tapi membuka subset baru.

### `non-sealed`

```java
public non-sealed class CustomShape extends Shape {}
```

Membuka kembali inheritance.

Gunakan `non-sealed` dengan hati-hati. Ia melemahkan guarantee sealed hierarchy.

---

## 5.5.4 Sealed Types dan Exhaustiveness

Sealed hierarchy membuat compiler bisa mengecek switch lengkap:

```java
sealed interface Decision permits Approved, Rejected, Returned {}
record Approved(String officerId) implements Decision {}
record Rejected(String reason) implements Decision {}
record Returned(String reason) implements Decision {}

String message(Decision decision) {
    return switch (decision) {
        case Approved a -> "Approved by " + a.officerId();
        case Rejected r -> "Rejected: " + r.reason();
        case Returned r -> "Returned: " + r.reason();
    };
}
```

Jika nanti ditambah:

```java
record Escalated(String toUnit) implements Decision {}
```

Maka switch di atas harus diperbarui.

Ini sangat penting untuk domain yang state/decision-nya harus eksplisit.

---

## 5.5.5 Sealed Type sebagai Algebraic Data Type ala Java

Java tidak punya algebraic data type secara literal seperti beberapa bahasa functional. Namun kombinasi sealed interface + records mendekati bentuk tersebut.

```java
sealed interface ValidationResult permits Valid, Invalid {}

record Valid() implements ValidationResult {}
record Invalid(List<Violation> violations) implements ValidationResult {
    public Invalid {
        violations = List.copyOf(violations);
        if (violations.isEmpty()) {
            throw new IllegalArgumentException("violations must not be empty");
        }
    }
}
```

Pemakaian:

```java
String render(ValidationResult result) {
    return switch (result) {
        case Valid ignored -> "valid";
        case Invalid invalid -> "invalid: " + invalid.violations().size();
    };
}
```

Ini lebih aman daripada:

```java
class ValidationResult {
    boolean valid;
    List<Violation> violations;
}
```

Karena model boolean + nullable list sering menciptakan illegal states:

| `valid` | `violations` | Apakah valid? |
|---:|---|---|
| true | empty | masuk akal |
| true | non-empty | kontradiktif |
| false | empty | kontradiktif |
| false | null | rawan NPE |
| false | non-empty | masuk akal |

Dengan sealed hierarchy, illegal combination bisa dihilangkan.

---

## 5.5.6 Sealed Types untuk State Machine

Contoh lifecycle enforcement case:

```java
sealed interface CaseState permits Draft, Submitted, UnderReview, Approved, Rejected, Closed {}

record Draft(String caseNo) implements CaseState {}
record Submitted(String caseNo, Instant submittedAt) implements CaseState {}
record UnderReview(String caseNo, String officerId) implements CaseState {}
record Approved(String caseNo, String approvalNo) implements CaseState {}
record Rejected(String caseNo, String reason) implements CaseState {}
record Closed(String caseNo, Instant closedAt) implements CaseState {}
```

Transition:

```java
CaseState submit(CaseState state, Instant now) {
    return switch (state) {
        case Draft d -> new Submitted(d.caseNo(), now);
        case Submitted s -> throw new IllegalStateException("already submitted");
        case UnderReview r -> throw new IllegalStateException("already under review");
        case Approved a -> throw new IllegalStateException("already approved");
        case Rejected r -> throw new IllegalStateException("already rejected");
        case Closed c -> throw new IllegalStateException("already closed");
    };
}
```

Ini verbose, tapi sangat defendable. Untuk regulatory workflows, explicit invalid transition sering lebih baik daripada silent no-op.

Versi lebih scalable:

```java
sealed interface TransitionResult permits TransitionAccepted, TransitionRejected {}
record TransitionAccepted(CaseState nextState, DomainEvent event) implements TransitionResult {}
record TransitionRejected(String reason) implements TransitionResult {}
```

---

## 5.5.7 Sealed Type vs Enum

Enum cocok jika setiap value tidak membawa data berbeda:

```java
enum CaseStatus {
    DRAFT, SUBMITTED, APPROVED, REJECTED
}
```

Sealed hierarchy cocok jika tiap state/variant membawa data berbeda:

```java
sealed interface CaseState permits Draft, Submitted, Approved, Rejected {}

record Draft(String caseNo) implements CaseState {}
record Submitted(String caseNo, Instant submittedAt) implements CaseState {}
record Approved(String caseNo, String approvalNo, Instant approvedAt) implements CaseState {}
record Rejected(String caseNo, String reason, Instant rejectedAt) implements CaseState {}
```

Decision rule:

```text
Gunakan enum untuk finite labels.
Gunakan sealed hierarchy untuk finite shapes.
```

---

## 5.5.8 Sealed Type Anti-Pattern

### Membuat hierarchy tertutup padahal extension memang requirement

Jika library harus memungkinkan user menambah implementation, sealed type bisa salah.

```java
public sealed interface Plugin permits InternalPluginA, InternalPluginB {}
```

Kalau plugin harus extensible oleh customer, jangan sealed.

### Terlalu banyak nested subtype

Sealed hierarchy dengan puluhan subtype bisa menjadi sulit dipahami. Jika subtype banyak karena data berasal dari external taxonomy, mungkin enum + metadata table lebih tepat.

### `non-sealed` tanpa alasan kuat

```java
public non-sealed class OtherDecision implements Decision {}
```

Ini membuka kembali hierarchy dan mengurangi manfaat exhaustiveness.

---

# 5.6 Text Blocks

## 5.6.1 Masalah Sebelum Text Blocks

Sebelum text blocks, multiline string di Java buruk:

```java
String json = "{\n" +
    "  \"caseNo\": \"C-001\",\n" +
    "  \"status\": \"SUBMITTED\"\n" +
    "}";
```

Dengan text block:

```java
String json = """
    {
      "caseNo": "C-001",
      "status": "SUBMITTED"
    }
    """;
```

Text block membuat structured text lebih natural.

---

## 5.6.2 Syntax Dasar

Text block memakai triple quote:

```java
String sql = """
    SELECT case_no, status, submitted_at
    FROM cases
    WHERE status = ?
    ORDER BY submitted_at DESC
    """;
```

Opening delimiter harus diikuti line terminator. Ini valid:

```java
String s = """
    hello
    """;
```

Ini tidak valid:

```java
String s = """hello"""; // invalid text block syntax
```

Jika hanya butuh satu line, gunakan string literal biasa.

---

## 5.6.3 Incidental Indentation

Text block menghapus incidental indentation berdasarkan posisi closing delimiter.

```java
String text = """
    alpha
    beta
    gamma
    """;
```

Nilai string secara konseptual:

```text
alpha
beta
gamma
```

Indentasi yang hanya mengikuti struktur code dihapus.

Jika ingin mempertahankan indentasi, atur posisi closing delimiter:

```java
String text = """
        alpha
          beta
        gamma
    """;
```

Whitespace adalah bagian dari data. Untuk SQL/JSON/test expected output, selalu cek hasil aktual.

---

## 5.6.4 Final Newline

Text block biasanya menyertakan newline terakhir jika closing delimiter berada di line baru:

```java
String s = """
    hello
    """;
```

Nilainya kira-kira:

```text
hello\n
```

Jika ingin menekan newline akhir, gunakan line continuation escape:

```java
String s = """
    hello\
    """;
```

Atau gunakan `.stripTrailing()` jika memang sesuai:

```java
String s = """
    hello
    """.stripTrailing();
```

Namun jangan sembarang strip untuk data yang whitespace-sensitive.

---

## 5.6.5 Escape dalam Text Blocks

Text blocks mengurangi kebutuhan escaping quote:

```java
String json = """
    { "message": "hello" }
    """;
```

Tetapi escape tetap tersedia:

```java
String path = """
    C:\\data\\input.txt
    """;
```

Untuk menulis triple quote di dalam text block, perlu escape secukupnya.

---

## 5.6.6 Use Case Text Blocks

### SQL

```java
String query = """
    SELECT c.case_no, c.status, c.submitted_at
    FROM enforcement_case c
    WHERE c.status = ?
      AND c.submitted_at >= ?
    ORDER BY c.submitted_at DESC
    """;
```

### JSON fixture

```java
String payload = """
    {
      "caseNo": "C-001",
      "command": "SUBMIT",
      "submittedBy": "officer-001"
    }
    """;
```

### Expected output test

```java
String expected = """
    CASE C-001
    STATUS SUBMITTED
    OFFICER officer-001
    """;
```

### HTML/email template kecil

```java
String body = """
    <html>
      <body>
        <p>Your case has been submitted.</p>
      </body>
    </html>
    """;
```

Untuk template kompleks, gunakan templating engine. Text block bukan template engine.

---

## 5.6.7 Text Block Anti-Pattern

### Menyusun SQL dengan concatenation raw input

```java
String sql = """
    SELECT * FROM users WHERE name = '
    """ + name + "'"; // SQL injection risk
```

Text block tidak membuat query aman. Tetap gunakan prepared statement/bind parameter.

### Menaruh business configuration besar di code

Jika JSON/YAML sangat besar, lebih baik file resource.

### Snapshot test rapuh

Text block bagus untuk expected output, tapi whitespace bisa membuat test terlalu rapuh. Gunakan normalization jika whitespace bukan bagian penting.

---

# 5.7 Unnamed Variables and Patterns

## 5.7.1 Masalah yang Diselesaikan

Kadang Java memaksa kita memberi nama variable yang tidak akan digunakan.

Contoh:

```java
for (var event : events) {
    count++;
}
```

`event` tidak dipakai. Nama itu noise.

Dengan unnamed variable:

```java
for (var _ : events) {
    count++;
}
```

`_` menyatakan intention: value ini sengaja tidak dipakai.

---

## 5.7.2 Unnamed Variable

Unnamed variable dapat digunakan pada deklarasi variable yang memang tidak akan dipakai.

Contoh enhanced for:

```java
int count = 0;
for (var _ : events) {
    count++;
}
```

Contoh catch parameter:

```java
try {
    parse(input);
} catch (NumberFormatException _) {
    return Optional.empty();
}
```

Contoh lambda parameter:

```java
button.addActionListener(_ -> refresh());
```

Contoh try-with-resources jika resource hanya perlu lifecycle close:

```java
try (var _ = lock.acquire()) {
    criticalSection.run();
}
```

Ini memberi sinyal bahwa variable bukan lupa dipakai, tetapi memang tidak perlu dipakai.

---

## 5.7.3 Unnamed Pattern

Unnamed pattern sangat berguna dalam record pattern.

```java
record Point(int x, int y) {}

String axis(Point point) {
    return switch (point) {
        case Point(int x, _) when x == 0 -> "y-axis";
        case Point(_, int y) when y == 0 -> "x-axis";
        default -> "other";
    };
}
```

Jika kita hanya peduli satu komponen, `_` mengurangi noise.

---

## 5.7.4 `_` Bukan Variable yang Bisa Dipakai

Ini salah:

```java
for (var _ : events) {
    System.out.println(_); // compile error
}
```

`_` bukan nama variable normal. Ia placeholder unnamed.

---

## 5.7.5 Kapan Menggunakan `_`

Gunakan `_` jika:

- variable memang sengaja tidak dipakai;
- nama variable hanya noise;
- pattern hanya dipakai untuk mencocokkan shape;
- ingin menghindari warning unused variable;
- ingin memperjelas intent reviewer.

Contoh baik:

```java
return switch (event) {
    case CaseSubmitted(_, String caseNo, _) -> handleSubmitted(caseNo);
    case CaseClosed(String caseNo, _) -> handleClosed(caseNo);
};
```

Namun jangan overuse.

Buruk:

```java
case CaseSubmitted(_, _, _) -> ...
```

Jika semua komponen diabaikan, mungkin cukup type pattern:

```java
case CaseSubmitted submitted -> ...
```

atau jika object tidak dipakai:

```java
case CaseSubmitted _ -> ...
```

---

# 5.8 Module Import Declarations

## 5.8.1 Masalah yang Diselesaikan

Java sering butuh banyak import untuk contoh kecil:

```java
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

class Example {
    // ...
}
```

Java 25 memperkenalkan module import declarations sebagai fitur final:

```java
import module java.base;
```

Atau:

```java
import module java.sql;
```

Mental model:

```text
import module M mengimpor public top-level classes/interfaces dari package yang diekspor oleh module M, termasuk exported API dari module yang dibaca secara transitif sesuai aturan module graph.
```

Ini bukan `requires` dalam `module-info.java`. Ini import di source file.

---

## 5.8.2 Syntax

```java
import module java.base;

void main() {
    var names = List.of("alpha", "beta", "gamma");
    var upper = names.stream()
        .map(String::toUpperCase)
        .toList();
    System.out.println(upper);
}
```

Dengan `import module java.base`, banyak class dari `java.util`, `java.io`, `java.math`, dan package lain yang diekspor `java.base` bisa dipakai tanpa import satu per satu.

---

## 5.8.3 Apa yang Diimpor?

`import module M;` mengimpor on-demand:

1. public top-level classes/interfaces dari package yang diekspor oleh module `M` ke current module;
2. public top-level classes/interfaces dari package yang diekspor oleh module yang dibaca karena `requires transitive` dari module `M`.

Contoh konseptual:

```java
import module java.sql;
```

Dapat membuat API `java.sql` dan related exported API yang relevan tersedia secara ringkas.

---

## 5.8.4 Module Import Bukan Pengganti Semua Import

Untuk production code besar, explicit imports sering lebih readable:

```java
import java.time.Instant;
import java.util.List;
import java.util.Map;
```

Kenapa?

- reviewer langsung tahu dependency class;
- konflik nama lebih jelas;
- IDE organize imports bekerja familiar;
- public API file lebih eksplisit.

Module import cocok untuk:

- learning;
- demo;
- scripts;
- compact source files;
- exploratory programming;
- contoh dokumentasi;
- file kecil dengan banyak JDK API.

Untuk application/service code besar, jadikan module import sebagai pilihan sadar, bukan default otomatis.

---

## 5.8.5 Ambiguity

Jika dua module/package menyediakan simple name yang sama, import on-demand bisa ambigu.

Contoh umum di Java dengan wildcard import:

```java
import java.util.*;
import java.sql.*;

Date date; // ambigu: java.util.Date atau java.sql.Date?
```

Module import juga bisa membuat simple name ambiguity. Solusi:

```java
java.time.LocalDate date = java.time.LocalDate.now();
```

atau gunakan explicit import untuk class yang penting.

---

## 5.8.6 Style Rule untuk Module Import

Gunakan aturan ini:

```text
Use module import to reduce ceremony in small/demo/learning code.
Use explicit imports to improve dependency readability in long-lived production code.
```

Dalam codebase enterprise, saya akan mengizinkan module import untuk:

- sample code;
- migration playground;
- CLI kecil;
- generated educational snippet;
- compact source file.

Saya akan membatasi atau melarang untuk:

- service production besar;
- domain core;
- public library API;
- file dengan naming conflict tinggi;
- code yang butuh audit import dependency secara eksplisit.

---

# 5.9 Kombinasi Fitur: Modern Domain Modeling

Sekarang kita gabungkan fitur-fitur di atas.

## 5.9.1 Problem: Command Handling Tradisional

```java
class CaseCommand {
    String type;
    String caseNo;
    String reason;
    String officerId;
}
```

Masalah:

- `reason` hanya relevan untuk reject/reopen;
- `officerId` mungkin hanya relevan untuk approve;
- `type` string raw;
- illegal state mudah terjadi;
- compiler tidak tahu varian command yang valid;
- switch berbasis string raw rawan typo.

---

## 5.9.2 Modern Model dengan Sealed Interface + Records

```java
sealed interface CaseCommand permits SubmitCase, ApproveCase, RejectCase, ReopenCase {}

record SubmitCase(String caseNo, String submittedBy) implements CaseCommand {
    public SubmitCase {
        requireNonBlank(caseNo, "caseNo");
        requireNonBlank(submittedBy, "submittedBy");
    }
}

record ApproveCase(String caseNo, String officerId) implements CaseCommand {
    public ApproveCase {
        requireNonBlank(caseNo, "caseNo");
        requireNonBlank(officerId, "officerId");
    }
}

record RejectCase(String caseNo, String officerId, String reason) implements CaseCommand {
    public RejectCase {
        requireNonBlank(caseNo, "caseNo");
        requireNonBlank(officerId, "officerId");
        requireNonBlank(reason, "reason");
    }
}

record ReopenCase(String caseNo, String reason) implements CaseCommand {
    public ReopenCase {
        requireNonBlank(caseNo, "caseNo");
        requireNonBlank(reason, "reason");
    }
}
```

Utility:

```java
static void requireNonBlank(String value, String name) {
    if (value == null || value.isBlank()) {
        throw new IllegalArgumentException(name + " must not be blank");
    }
}
```

Keuntungan:

- setiap command punya shape sendiri;
- field irrelevant hilang;
- invariant lokal di constructor;
- compiler tahu semua command;
- switch bisa exhaustive.

---

## 5.9.3 Handling dengan Pattern Switch

```java
CommandResult handle(CaseCommand command) {
    return switch (command) {
        case SubmitCase c -> submit(c);
        case ApproveCase c -> approve(c);
        case RejectCase c -> reject(c);
        case ReopenCase c -> reopen(c);
    };
}
```

Jika command baru ditambahkan, compiler memaksa handler diperbarui.

Ini penting untuk lifecycle enforcement karena tidak boleh ada command baru yang “lolos tanpa rule”.

---

## 5.9.4 Menggunakan Record Pattern Jika Butuh Deconstruction

```java
String auditMessage(CaseCommand command) {
    return switch (command) {
        case SubmitCase(String caseNo, String submittedBy) ->
            "Submit case " + caseNo + " by " + submittedBy;
        case ApproveCase(String caseNo, String officerId) ->
            "Approve case " + caseNo + " by " + officerId;
        case RejectCase(String caseNo, String officerId, String reason) ->
            "Reject case " + caseNo + " by " + officerId + ": " + reason;
        case ReopenCase(String caseNo, String reason) ->
            "Reopen case " + caseNo + ": " + reason;
    };
}
```

Gunakan deconstruction jika method memang fokus pada data components.

Jika logic butuh behavior command, lebih baik bind object:

```java
case RejectCase c -> reject(c)
```

bukan:

```java
case RejectCase(String caseNo, String officerId, String reason) -> reject(caseNo, officerId, reason)
```

Kecuali function target memang lebih natural menerima komponen individual.

---

## 5.9.5 Result Type dengan Sealed Hierarchy

Daripada return `null` atau throw exception untuk semua error:

```java
sealed interface CommandResult permits Accepted, Rejected, Failed {}

record Accepted(String caseNo, List<DomainEvent> events) implements CommandResult {
    public Accepted {
        events = List.copyOf(events);
    }
}

record Rejected(String caseNo, String reason) implements CommandResult {}
record Failed(String caseNo, Throwable cause) implements CommandResult {}
```

Render:

```java
HttpResponse render(CommandResult result) {
    return switch (result) {
        case Accepted a -> HttpResponse.ok(a);
        case Rejected r -> HttpResponse.badRequest(r.reason());
        case Failed f -> HttpResponse.serverError("technical failure");
    };
}
```

Ini memisahkan:

- accepted business outcome;
- domain rejection;
- technical failure.

Dalam regulatory systems, perbedaan ini penting untuk audit dan user communication.

---

# 5.10 Feature Interaction dan Design Trade-Off

## 5.10.1 Records + Sealed Types

Kombinasi ideal untuk finite data variants:

```java
sealed interface Notification permits EmailNotification, SmsNotification {}
record EmailNotification(String to, String subject, String body) implements Notification {}
record SmsNotification(String to, String message) implements Notification {}
```

Kapan cocok:

- varian terbatas;
- tiap varian membawa data berbeda;
- value-like;
- dispatch dilakukan dengan switch/pattern;
- tidak perlu inheritance extension oleh consumer.

Kapan tidak cocok:

- hierarchy harus extensible;
- object butuh identity lifecycle kompleks;
- framework butuh proxy subclass;
- subtype datang dari plugin eksternal.

---

## 5.10.2 Switch Expression + Sealed Type

Ini memberi exhaustiveness.

```java
String channel(Notification notification) {
    return switch (notification) {
        case EmailNotification _ -> "email";
        case SmsNotification _ -> "sms";
    };
}
```

Jika `PushNotification` ditambahkan, compiler membantu.

---

## 5.10.3 `var` + Records

```java
var event = new CaseSubmitted(caseNo, submittedBy, Instant.now());
```

Ini jelas karena initializer menyebut type record.

Tapi ini kurang jelas:

```java
var event = factory.create(command);
```

Lebih baik:

```java
DomainEvent event = factory.create(command);
```

atau:

```java
CaseSubmitted event = factory.createSubmitted(command);
```

---

## 5.10.4 Text Blocks + Records untuk Test

```java
record CaseDto(String caseNo, String status) {}

@Test
void serializeCase() {
    var dto = new CaseDto("C-001", "SUBMITTED");

    var expected = """
        {
          "caseNo" : "C-001",
          "status" : "SUBMITTED"
        }
        """;

    assertThat(objectMapper.writeValueAsString(dto))
        .isEqualToIgnoringWhitespace(expected);
}
```

Text block membuat expected JSON terbaca. Namun gunakan assertion yang sesuai whitespace semantics.

---

# 5.11 Modern Java Refactoring Patterns

## 5.11.1 Refactor Class Boilerplate ke Record

Sebelum:

```java
public final class CaseId {
    private final String value;

    public CaseId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("blank");
        }
        this.value = value;
    }

    public String value() { return value; }

    // equals/hashCode/toString
}
```

Sesudah:

```java
public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("blank");
        }
        value = value.trim();
    }
}
```

Checklist sebelum refactor:

1. Apakah equality berdasarkan semua field?
2. Apakah semua field adalah state inti?
3. Apakah object tidak butuh identity lifecycle mutable?
4. Apakah framework mendukung record?
5. Apakah accessor name change dari `getX()` ke `x()` aman?

---

## 5.11.2 Refactor `if instanceof + cast` ke Pattern Matching

Sebelum:

```java
if (message instanceof CaseSubmitted) {
    CaseSubmitted submitted = (CaseSubmitted) message;
    handleSubmitted(submitted);
}
```

Sesudah:

```java
if (message instanceof CaseSubmitted submitted) {
    handleSubmitted(submitted);
}
```

Kalau banyak branch:

```java
return switch (message) {
    case CaseSubmitted submitted -> handleSubmitted(submitted);
    case CaseApproved approved -> handleApproved(approved);
    case CaseRejected rejected -> handleRejected(rejected);
    default -> ignore(message);
};
```

---

## 5.11.3 Refactor String Type Code ke Sealed Types

Sebelum:

```java
record Event(String type, String payload) {}
```

Sesudah:

```java
sealed interface Event permits CaseSubmitted, CaseApproved, CaseRejected {}
record CaseSubmitted(String caseNo, Instant at) implements Event {}
record CaseApproved(String caseNo, String officerId, Instant at) implements Event {}
record CaseRejected(String caseNo, String reason, Instant at) implements Event {}
```

Ini mengubah `type` dari string runtime convention menjadi compile-time model.

---

## 5.11.4 Refactor Mapping Method ke Switch Expression

Sebelum:

```java
String label(Status status) {
    if (status == Status.DRAFT) return "Draft";
    if (status == Status.SUBMITTED) return "Submitted";
    if (status == Status.APPROVED) return "Approved";
    throw new IllegalArgumentException("unknown");
}
```

Sesudah:

```java
String label(Status status) {
    return switch (status) {
        case DRAFT -> "Draft";
        case SUBMITTED -> "Submitted";
        case APPROVED -> "Approved";
    };
}
```

---

# 5.12 Production Design Guidelines

## 5.12.1 Jangan Mengejar Modern Syntax Tanpa Modern Model

Buruk:

```java
var result = switch (type) {
    case "A" -> new HashMap<String, Object>();
    case "B" -> new HashMap<String, Object>();
    default -> new HashMap<String, Object>();
};
```

Ini modern syntax di atas weak model.

Lebih baik:

```java
sealed interface ReportRequest permits DailyReport, MonthlyReport {}
record DailyReport(LocalDate date) implements ReportRequest {}
record MonthlyReport(YearMonth month) implements ReportRequest {}
```

Lalu:

```java
Report generate(ReportRequest request) {
    return switch (request) {
        case DailyReport r -> generateDaily(r);
        case MonthlyReport r -> generateMonthly(r);
    };
}
```

---

## 5.12.2 Jangan Sembunyikan Domain Type dengan `var`

```java
var x = service.calculate(command);
```

Jika hasilnya domain-significant, tulis type:

```java
PenaltyAssessment assessment = service.calculate(command);
```

Dalam code review, tanyakan:

```text
Apakah type ini bagian dari meaning?
Jika ya, jangan sembunyikan.
```

---

## 5.12.3 Records Harus Menjaga Invariant

Buruk:

```java
record Email(String value) {}
```

Lebih baik:

```java
record Email(String value) {
    Email {
        if (value == null || !value.contains("@")) {
            throw new IllegalArgumentException("invalid email");
        }
        value = value.trim().toLowerCase(Locale.ROOT);
    }
}
```

Record tanpa invariant hanya memindahkan masalah ke tempat lain.

---

## 5.12.4 Sealed Hierarchy Harus Mewakili Boundary yang Stabil

Sealed cocok untuk closed world.

Contoh closed world:

- internal command types;
- domain decision outcomes;
- validation result;
- case state;
- parser AST;
- workflow transition result.

Tidak cocok untuk open world:

- plugin implementation;
- third-party extension;
- arbitrary user-defined strategy;
- framework extension point.

---

## 5.12.5 Pattern Switch Jangan Jadi God Dispatcher

Jika switch berisi banyak side effect, pecah:

```java
return switch (command) {
    case SubmitCase c -> submitHandler.handle(c);
    case ApproveCase c -> approveHandler.handle(c);
    case RejectCase c -> rejectHandler.handle(c);
};
```

Bukan:

```java
return switch (command) {
    case SubmitCase c -> {
        validate();
        updateDb();
        publishKafka();
        sendEmail();
        yield ok();
    }
    // ...
};
```

Switch harus menjadi decision boundary, bukan dumping ground.

---

# 5.13 Java 25 Specific Notes

## 5.13.1 Stable di Java 25

Fitur berikut stable/permanent di Java 25:

- local variable type inference;
- switch expressions;
- pattern matching for `instanceof`;
- pattern matching for `switch`;
- records;
- record patterns;
- sealed classes/interfaces;
- text blocks;
- unnamed variables and patterns;
- module import declarations;
- compact source files and instance main methods;
- flexible constructor bodies.

## 5.13.2 Preview di Java 25

Fitur yang relevan dan masih preview di Java 25:

- primitive types in patterns, `instanceof`, and `switch`.

Preview feature policy:

```text
Untuk belajar: silakan gunakan.
Untuk production: butuh approval engineering policy.
Untuk library public: sangat hati-hati, karena syntax/semantics bisa berubah.
```

Compile preview:

```bash
javac --release 25 --enable-preview Example.java
java --enable-preview Example
```

Dengan Maven, konfigurasi compiler plugin harus mengaktifkan preview. Dengan Gradle, task compile/run/test harus diberi flag preview.

---

# 5.14 Migration Strategy untuk Codebase Lama

## 5.14.1 Jangan Migrasi Semua Sekaligus

Modernisasi syntax harus mengikuti risiko.

Urutan aman:

1. gunakan text blocks untuk test fixtures/SQL yang jelas;
2. gunakan switch expression untuk mapping enum sederhana;
3. gunakan pattern matching for `instanceof` menggantikan cast manual;
4. ubah simple immutable DTO/value object ke record;
5. gunakan sealed hierarchy untuk closed domain variants;
6. gunakan pattern switch untuk sealed hierarchy;
7. gunakan unnamed variables/patterns untuk mengurangi noise;
8. gunakan module imports hanya di area yang disepakati.

---

## 5.14.2 Refactoring Guardrails

Sebelum mengubah class ke record:

- cek serialization compatibility;
- cek JSON property naming;
- cek framework binding;
- cek equals/hashCode behavior lama;
- cek constructor validation;
- cek mutability expectation;
- cek API consumers.

Sebelum mengubah hierarchy ke sealed:

- cari semua implementation;
- pastikan tidak ada plugin/external implementation;
- pastikan package/module structure memungkinkan;
- pastikan testing mencakup all variants;
- pastikan switch exhaustiveness diinginkan.

Sebelum mengubah switch lama:

- cek fall-through disengaja atau bug;
- cek default behavior;
- cek null behavior;
- cek side effect per case;
- cek exception behavior.

---

# 5.15 Code Review Checklist

## 5.15.1 `var`

- Apakah initializer jelas?
- Apakah type domain penting disembunyikan?
- Apakah variable seharusnya interface type?
- Apakah method call return type ambigu?
- Apakah nama variable cukup informatif?

## 5.15.2 Switch Expression

- Apakah switch exhaustive?
- Apakah `default` menyembunyikan enum/sealed variant baru?
- Apakah case terlalu panjang?
- Apakah side effect berlebihan?
- Apakah null perlu ditangani eksplisit?

## 5.15.3 Pattern Matching

- Apakah pattern case diurutkan dari spesifik ke umum?
- Apakah guard bebas side effect?
- Apakah dominance jelas?
- Apakah nested pattern masih readable?
- Apakah sealed hierarchy bisa membuat switch exhaustive?

## 5.15.4 Records

- Apakah record benar-benar data carrier?
- Apakah semua component bagian dari logical equality?
- Apakah mutable component sudah defensive copy?
- Apakah invariant ada di constructor?
- Apakah record digunakan sebagai JPA entity secara salah?

## 5.15.5 Sealed Types

- Apakah domain memang closed?
- Apakah permitted subclasses lengkap?
- Apakah `non-sealed` punya alasan kuat?
- Apakah hierarchy terlalu besar?
- Apakah switch atas hierarchy exhaustive?

## 5.15.6 Text Blocks

- Apakah whitespace/newline disengaja?
- Apakah raw input tidak di-concat ke SQL?
- Apakah data besar seharusnya resource file?
- Apakah test assertion memperhitungkan whitespace semantics?

## 5.15.7 Unnamed Variables/Patterns

- Apakah `_` benar-benar menyatakan unused value?
- Apakah `_` membuat pattern lebih jelas?
- Apakah terlalu banyak `_` membuat logic kehilangan meaning?

## 5.15.8 Module Imports

- Apakah file kecil/demo/learning?
- Apakah explicit imports lebih baik?
- Apakah ada risiko simple-name ambiguity?
- Apakah codebase punya convention soal module imports?

---

# 5.16 Latihan Bertahap

## Latihan 1 — `var` Judgment

Untuk setiap baris, putuskan apakah `var` baik atau buruk, lalu jelaskan alasannya.

```java
var id = new CaseId(rawId);
var result = service.process(command);
var items = new ArrayList<LineItem>();
List<LineItem> items2 = new ArrayList<>();
var timeout = Duration.ofSeconds(30);
var amount = calculateAmount();
```

Target pemahaman:

- initializer clarity;
- domain type meaning;
- abstraction vs implementation type.

---

## Latihan 2 — Refactor Switch Lama

Ubah code ini menjadi switch expression:

```java
String severity;
switch (violationLevel) {
    case LOW:
        severity = "info";
        break;
    case MEDIUM:
        severity = "warning";
        break;
    case HIGH:
    case CRITICAL:
        severity = "error";
        break;
    default:
        throw new IllegalArgumentException("Unknown level");
}
```

Pertanyaan lanjutan:

- apakah `default` perlu?
- jika enum bertambah, apa perilaku yang diinginkan?

---

## Latihan 3 — Class ke Record

Refactor class ini menjadi record dengan invariant:

```java
public final class OfficerId {
    private final String value;

    public OfficerId(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Invariant:

- tidak boleh null;
- tidak boleh blank;
- trim whitespace;
- simpan uppercase dengan `Locale.ROOT`.

---

## Latihan 4 — Sealed Command Model

Modelkan command berikut sebagai sealed interface + records:

- `CreateCase`
- `AssignOfficer`
- `ApproveCase`
- `RejectCase`
- `CloseCase`

Lalu buat method:

```java
String auditAction(CaseCommand command)
```

Gunakan pattern switch exhaustive.

---

## Latihan 5 — Validation Result

Buat sealed result:

```java
ValidationResult
```

Varian:

- `Valid`
- `Invalid(List<Violation>)`

Rule:

- `Invalid` tidak boleh punya list kosong;
- list harus defensive copy;
- render result dengan switch expression.

---

## Latihan 6 — Text Block Fixture

Buat JSON fixture dengan text block untuk:

```json
{
  "caseNo": "C-001",
  "status": "SUBMITTED",
  "violations": [
    { "code": "V001", "message": "Missing document" }
  ]
}
```

Lalu tulis test yang membandingkan JSON secara semantic, bukan raw string whitespace.

---

## Latihan 7 — Module Import Playground

Buat file `Playground.java`:

```java
import module java.base;

void main() {
    var names = List.of("alpha", "beta", "gamma");
    var result = names.stream()
        .map(String::toUpperCase)
        .toList();
    System.out.println(result);
}
```

Compile/run dengan JDK 25.

Pertanyaan:

- class apa saja yang tidak perlu import eksplisit?
- apakah style ini cocok untuk service production?
- kapan explicit imports lebih baik?

---

# 5.17 Mini Project — Modern Java Domain Model

Buat mini project `case-lifecycle-modern-java`.

## Requirement

Modelkan lifecycle sederhana:

```text
Draft -> Submitted -> UnderReview -> Approved
                      -> Rejected
Approved -> Closed
Rejected -> Closed
```

Command:

- Submit
- AssignReviewer
- Approve
- Reject
- Close

Output command:

- accepted transition;
- rejected transition;
- technical failure tidak perlu dimodelkan dulu.

## Constraint

Gunakan:

- records untuk value object/event/result;
- sealed interface untuk command dan state;
- switch expression untuk transition;
- pattern matching untuk command handling;
- text block untuk test fixture;
- `_` untuk unused pattern jika relevan;
- `var` hanya jika memperjelas.

## Deliverables

1. `CaseState` sealed hierarchy.
2. `CaseCommand` sealed hierarchy.
3. `TransitionResult` sealed hierarchy.
4. `CaseTransitionService`.
5. Unit tests untuk valid/invalid transition.
6. README berisi state transition table.

## Evaluation Criteria

- Tidak ada illegal state yang bisa dibuat tanpa explicit exception.
- Switch atas state/command exhaustive.
- Tidak ada `default` yang menyembunyikan state baru.
- Record constructor menjaga invariant.
- Test mencakup transition valid dan invalid.
- Naming menjelaskan domain.

---

# 5.18 Ringkasan Mental Model

## `var`

```text
Mengurangi type repetition lokal.
Bukan dynamic typing.
Jangan sembunyikan domain meaning.
```

## Switch Expression

```text
Decision table yang menghasilkan value.
Lebih aman dari switch lama karena tidak perlu mutable temp dan fall-through accidental.
```

## Pattern Matching

```text
Test shape/type dan bind data secara aman.
Paling kuat ketika dipakai dengan records dan sealed hierarchy.
```

## Records

```text
Nominal transparent data carrier.
Cocok untuk value object, DTO, event, result.
Tidak otomatis deep immutable.
```

## Sealed Types

```text
Closed hierarchy untuk finite domain variants.
Membantu exhaustiveness dan regulatory defensibility.
```

## Text Blocks

```text
Multiline string literal untuk structured text.
Whitespace adalah data, jadi tetap harus hati-hati.
```

## Unnamed Variables/Patterns

```text
Gunakan `_` untuk menyatakan value sengaja tidak dipakai.
Mengurangi noise dalam loop, lambda, catch, dan pattern.
```

## Module Import Declarations

```text
Import exported API dari module secara ringkas.
Sangat berguna untuk learning/demo/small files.
Untuk production besar, explicit imports sering lebih defendable.
```

---

# 5.19 Sumber Resmi dan Bacaan Lanjutan

Sumber utama:

- Java SE 25 Specifications: https://docs.oracle.com/javase/specs/
- JDK 25 Documentation: https://docs.oracle.com/en/java/javase/25/
- Java Language Changes Summary, JDK 25: https://docs.oracle.com/en/java/javase/25/language/java-language-changes-summary.html
- Java Language Changes by Release, JDK 25: https://docs.oracle.com/en/java/javase/25/language/java-language-changes-release.html

JEP terkait:

- JEP 286 — Local-Variable Type Inference: https://openjdk.org/jeps/286
- JEP 323 — Local-Variable Syntax for Lambda Parameters: https://openjdk.org/jeps/323
- Local Variable Type Inference Style Guide: https://openjdk.org/projects/amber/guides/lvti-style-guide
- JEP 361 — Switch Expressions: https://openjdk.org/jeps/361
- JEP 394 — Pattern Matching for `instanceof`: https://openjdk.org/jeps/394
- JEP 441 — Pattern Matching for `switch`: https://openjdk.org/jeps/441
- JEP 440 — Record Patterns: https://openjdk.org/jeps/440
- JEP 395 — Records: https://openjdk.org/jeps/395
- JEP 409 — Sealed Classes: https://openjdk.org/jeps/409
- JEP 378 — Text Blocks: https://openjdk.org/jeps/378
- Programmer’s Guide to Text Blocks: https://openjdk.org/projects/amber/guides/text-blocks-guide
- JEP 456 — Unnamed Variables and Patterns: https://openjdk.org/jeps/456
- JEP 511 — Module Import Declarations: https://openjdk.org/jeps/511
- JEP 507 — Primitive Types in Patterns, `instanceof`, and `switch` Third Preview: https://openjdk.org/jeps/507

---

# 5.20 Closing Thought

Modern Java bukan tentang membuat Java terlihat trendi. Nilainya ada pada kemampuan membuat model lebih eksplisit:

```text
Data yang hanya data -> record.
Varian yang finite -> sealed hierarchy.
Decision yang harus lengkap -> switch expression.
Extraction yang aman -> pattern matching.
Structured text -> text block.
Unused binding -> underscore.
Local obvious type -> var.
Small modular demo -> module import.
```

Jika dipakai dengan disiplin, fitur-fitur ini membuat Java lebih kuat untuk membangun sistem yang kompleks, terutama sistem dengan lifecycle, policy, audit, dan failure semantics yang harus jelas.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Learn Java hingga Java 25 — Part 004](./learn-java-part-004.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: Learn Java Part 006 — Functional Programming di Java](./learn-java-part-006.md)

</div>
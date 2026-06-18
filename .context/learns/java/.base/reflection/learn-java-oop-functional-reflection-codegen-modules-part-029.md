# learn-java-oop-functional-reflection-codegen-modules-part-029

# API Evolution, Binary Compatibility, Semantic Versioning, and Library Design

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `029`  
> Topik: API evolution, binary compatibility, semantic versioning, dan library design  
> Target: engineer yang ingin mampu mendesain Java API/library yang stabil, evolvable, aman untuk downstream users, aman untuk build system, aman untuk reflection/code generation, dan defensible dalam sistem besar.

---

## 0. Mengapa Part Ini Penting

Banyak engineer bisa membuat API yang bekerja hari ini. Jauh lebih sedikit yang bisa membuat API yang masih bisa berevolusi setelah:

- dipakai oleh 20 service lain,
- dipakai oleh plugin pihak ketiga,
- dipakai lewat reflection,
- dipakai oleh annotation processor,
- dibungkus proxy framework,
- dipublish sebagai Maven artifact,
- dipakai oleh aplikasi yang tidak selalu recompile bersamaan,
- dipakai oleh client dengan versi library berbeda,
- dipakai dalam runtime modular JPMS,
- dipakai dalam generated code yang sulit diperbaiki manual.

Di sistem kecil, breaking change biasanya terlihat cepat. Di sistem besar, breaking change bisa muncul sebagai:

- `NoSuchMethodError`,
- `NoSuchFieldError`,
- `IllegalAccessError`,
- `AbstractMethodError`,
- `ClassCastException`,
- `IncompatibleClassChangeError`,
- silent behavior drift,
- serialization incompatibility,
- schema mismatch,
- generated code compilation failure,
- plugin loading failure,
- dependency convergence failure,
- framework reflection failure,
- unpredictable runtime behavior setelah deploy.

Masalahnya: tidak semua perubahan yang terlihat kecil di source code aman untuk runtime.

Contoh sederhana:

```java
// v1
public class FeeCalculator {
    public BigDecimal calculate(BigDecimal amount) {
        return amount.multiply(new BigDecimal("0.10"));
    }
}
```

Di v2:

```java
// v2
public class FeeCalculator {
    public Money calculate(Money amount) {
        return amount.multiply(new BigDecimal("0.10"));
    }
}
```

Secara desain mungkin lebih benar, tetapi bagi client yang sudah compile terhadap v1, method lama `calculate(BigDecimal)` hilang. Jika client lama berjalan dengan jar v2 tanpa recompile, runtime bisa melempar `NoSuchMethodError`.

Part ini membangun mental model agar perubahan API tidak dinilai hanya dari “compile di module saya”, tetapi dari sudut:

1. **source compatibility** — apakah source client lama masih bisa dikompilasi ulang?
2. **binary compatibility** — apakah binary client lama masih bisa berjalan tanpa recompile?
3. **behavioral compatibility** — apakah perilaku yang diandalkan client tetap valid?
4. **semantic compatibility** — apakah makna domain/API tetap sama?
5. **operational compatibility** — apakah deployment, classpath/module-path, generated code, reflection, serialization, dan dependency graph tetap aman?

Top engineer tidak hanya bertanya:

> “Apakah perubahan ini compile?”

Tapi bertanya:

> “Siapa saja consumer-nya, bagaimana mereka mengikat API ini, apakah mereka recompile bersamaan, apakah binary lama masih akan jalan, apakah behavior contract berubah, dan bagaimana migration path-nya?”

---

## 1. Vocabulary Penting

Sebelum masuk detail, kita harus membedakan beberapa istilah.

### 1.1 API

API adalah surface yang sengaja boleh dipakai oleh consumer.

Di Java, API bisa berupa:

- public class,
- public interface,
- public method,
- public constructor,
- public field,
- protected member yang bisa diakses subclass,
- exported package dalam JPMS,
- annotation contract,
- SPI interface,
- enum constant,
- record component,
- exception type,
- generic signature,
- configuration key,
- resource name,
- service provider file,
- generated code contract,
- serialization form,
- module descriptor.

Kesalahan umum adalah menganggap API hanya `public` method. Dalam praktik, semua hal yang dapat diandalkan consumer adalah API, walaupun tidak sengaja.

Contoh internal detail yang tanpa sadar menjadi API:

```java
public class CaseStatusMapper {
    public static final String APPROVED = "APPROVED";
}
```

Jika consumer mulai memakai constant ini, maka nama constant, value string, dan class location menjadi API.

### 1.2 Public API vs Internal API

Tidak semua `public` berarti public API secara desain.

Kadang class dibuat `public` karena:

- framework membutuhkan reflection,
- generated code membutuhkan akses,
- package boundary tidak cukup,
- module belum dipakai,
- test perlu akses,
- Java visibility limitation.

Karena itu library serius biasanya membedakan:

```text
com.example.caseapi              -> stable public API
com.example.caseapi.spi          -> extension/provider API
com.example.caseapi.internal     -> internal implementation, no compatibility promise
com.example.caseapi.generated    -> generated implementation detail
```

Namun naming saja tidak cukup. Build, documentation, module exports, package sealing, ArchUnit rule, dan release policy harus mendukung boundary tersebut.

### 1.3 Compatibility

Compatibility adalah kemampuan versi baru untuk tetap bekerja dengan consumer lama atau baru.

Ada beberapa level:

| Jenis Compatibility | Pertanyaan Utama |
|---|---|
| Source compatibility | Apakah source client lama masih compile ulang terhadap versi baru? |
| Binary compatibility | Apakah binary client lama masih run dengan versi baru tanpa compile ulang? |
| Behavioral compatibility | Apakah perilaku yang diandalkan client tetap sama? |
| Serialization compatibility | Apakah object/data lama masih bisa dibaca/dipakai? |
| Reflective compatibility | Apakah code reflection/scanner/framework masih menemukan member yang sama? |
| Generated-code compatibility | Apakah generated source/binary lama masih compatible dengan runtime baru? |
| Module compatibility | Apakah module graph, exports, opens, services tetap valid? |
| Dependency compatibility | Apakah dependency transitive dan version constraints tetap aman? |

JLS Chapter 13 mendefinisikan standar minimum binary compatibility untuk Java. Namun behavioral compatibility tidak bisa sepenuhnya dijamin oleh compiler atau JVM; itu adalah tanggung jawab desain API dan testing.

### 1.4 Library vs Application

Perubahan pada application internal biasanya lebih bebas karena semua source dapat dikompilasi dan dideploy bersama.

Perubahan pada library lebih sensitif karena:

- consumer tidak selalu diketahui,
- consumer tidak selalu update bersamaan,
- consumer mungkin memakai API dengan cara tidak diduga,
- binary lama bisa bertemu jar baru,
- dependency manager bisa memilih versi berbeda,
- public contract sulit ditarik kembali.

Rule of thumb:

> Semakin luas distribution API, semakin konservatif evolution policy-nya.

---

## 2. Mental Model: Java Linking dan Mengapa Binary Compatibility Ada

Java code dikompilasi menjadi `.class`. Class file menyimpan referensi simbolik ke class, method, field, dan descriptor.

Contoh source:

```java
FeeCalculator calculator = new FeeCalculator();
BigDecimal fee = calculator.calculate(amount);
```

Compiled bytecode tidak menyimpan “niat programmer”. Ia menyimpan referensi ke method dengan bentuk kira-kira:

```text
com/example/FeeCalculator.calculate(Ljava/math/BigDecimal;)Ljava/math/BigDecimal;
```

Artinya, method identity di binary level bukan hanya nama method. Ia mencakup:

- owner class,
- method name,
- parameter descriptor,
- return descriptor,
- access shape tertentu,
- static vs instance nature.

Jika v2 menghapus atau mengubah descriptor method tersebut, binary lama tidak bisa resolve method yang dicari.

### 2.1 Source Bisa Compile, Binary Bisa Gagal

Misalnya v1:

```java
public class CaseId {
    public String value() {
        return value;
    }
}
```

v2:

```java
public class CaseId {
    public CharSequence value() {
        return value;
    }
}
```

Secara source, return type `CharSequence` mungkin terlihat lebih general. Namun client lama yang sudah compiled mencari method descriptor dengan return `String`. Jika method `value():String` tidak ada, binary compatibility bisa rusak.

Solusi evolution bisa dengan menambah method baru sambil mempertahankan method lama:

```java
public class CaseId {
    /**
     * @deprecated use {@link #asText()} instead.
     */
    @Deprecated(since = "2.1", forRemoval = false)
    public String value() {
        return value;
    }

    public CharSequence asText() {
        return value;
    }
}
```

### 2.2 Binary Compatibility Bukan Behavioral Compatibility

Perubahan ini bisa binary compatible:

```java
// v1
public int maxRetry() {
    return 3;
}

// v2
public int maxRetry() {
    return 0;
}
```

Signature sama. Binary aman. Tapi behavior berubah drastis.

Atau:

```java
// v1
public List<Violation> validate(Application app) {
    return List.of();
}

// v2
public List<Violation> validate(Application app) {
    throw new UnsupportedOperationException("Not supported yet");
}
```

Binary compatible, source compatible, tetapi behavioral breaking.

Kesimpulan:

> Binary compatibility adalah lantai minimum. API evolution yang baik harus menjaga behavioral contract juga.

---

## 3. Source Compatibility

Source compatibility berarti source code consumer lama dapat dikompilasi ulang terhadap versi API baru.

Contoh source-compatible change:

```java
public interface CaseRepository {
    Optional<Case> findById(CaseId id);
}
```

Menambahkan method default:

```java
public interface CaseRepository {
    Optional<Case> findById(CaseId id);

    default boolean existsById(CaseId id) {
        return findById(id).isPresent();
    }
}
```

Banyak consumer source lama masih compile karena implementor tidak wajib implement method default baru.

Namun source compatibility bisa rusak oleh hal-hal seperti:

- rename class,
- remove method,
- change package,
- make class non-public,
- change method parameter type,
- change generic bound,
- add abstract method to interface,
- remove enum constant yang dipakai source,
- change annotation element without default,
- change checked exception declaration in restrictive way for overriding/implementation,
- introduce overload causing ambiguity.

### 3.1 Overload Bisa Merusak Source Compatibility

v1:

```java
public class Reporter {
    public void report(String message) {}
}
```

Client:

```java
reporter.report(null);
```

v2:

```java
public class Reporter {
    public void report(String message) {}
    public void report(Throwable error) {}
}
```

Sekarang `report(null)` bisa ambiguous. Ini source incompatibility walaupun v2 hanya menambah method.

### 3.2 Generics Bisa Merusak Source Lebih Halus

v1:

```java
public interface Handler<T> {
    void handle(T value);
}
```

v2:

```java
public interface Handler<T extends Command> {
    void handle(T value);
}
```

Consumer yang memakai `Handler<String>` tidak lagi compile.

### 3.3 Annotation Bisa Merusak Source

v1:

```java
public @interface Rule {
    String code();
}
```

v2:

```java
public @interface Rule {
    String code();
    int priority();
}
```

Semua penggunaan lama:

```java
@Rule(code = "A")
```

akan gagal compile karena element `priority` tidak punya default.

Evolution yang lebih aman:

```java
public @interface Rule {
    String code();
    int priority() default 0;
}
```

---

## 4. Binary Compatibility

Binary compatibility berarti binaries lama yang sudah dikompilasi dapat berjalan dengan versi library baru tanpa recompilation.

JLS Chapter 13 memberi aturan spesifik. Di sini kita tidak menghafal semua rule, tetapi membangun decision model.

### 4.1 Umumnya Binary Compatible

Perubahan yang biasanya aman secara binary:

- menambah class baru,
- menambah interface baru,
- menambah method baru ke class,
- menambah field baru,
- menambah constructor baru,
- menambah nested type baru,
- menambah private method,
- menambah private field,
- mengubah body method tanpa mengubah signature,
- menambah default method ke interface dalam banyak kasus,
- menambah overloaded method selama tidak mempengaruhi binary lama,
- menambah annotation pada element existing, jika tidak mempengaruhi processor/runtime behavior secara breaking.

Namun “binary compatible” bukan berarti aman secara behavioral.

### 4.2 Umumnya Binary Breaking

Perubahan yang berbahaya:

- menghapus public/protected class,
- menghapus public/protected method,
- menghapus public/protected field,
- rename class/package,
- mengubah method parameter types,
- mengubah method return type pada descriptor level,
- mengubah field type,
- mengubah instance method menjadi static,
- mengubah static method menjadi instance,
- mengubah class menjadi interface atau sebaliknya,
- mengubah superclass dengan cara yang menghilangkan inherited member yang dipakai,
- mengubah access public menjadi protected/package/private,
- mengubah non-final class menjadi final,
- mengubah non-final method menjadi final jika subclass lama override,
- menambah abstract method ke interface yang diimplementasi class lama,
- mengubah concrete class menjadi abstract,
- menghapus enum constant yang diakses binary,
- mengubah package export dalam JPMS,
- menghapus service provider yang diandalkan runtime.

### 4.3 Contoh `NoSuchMethodError`

v1 library:

```java
public class DecisionEngine {
    public Decision decide(Application app) {
        return Decision.pending();
    }
}
```

Client compiled terhadap v1.

v2 library:

```java
public class DecisionEngine {
    public Decision decide(Application app, DecisionContext context) {
        return Decision.pending();
    }
}
```

Client lama masih memanggil:

```text
DecisionEngine.decide(Application):Decision
```

Runtime dengan v2 tidak menemukan method itu. Hasilnya bisa `NoSuchMethodError`.

Aman:

```java
public class DecisionEngine {
    /**
     * @deprecated use {@link #decide(Application, DecisionContext)}.
     */
    @Deprecated(since = "2.3", forRemoval = false)
    public Decision decide(Application app) {
        return decide(app, DecisionContext.defaultContext());
    }

    public Decision decide(Application app, DecisionContext context) {
        return Decision.pending();
    }
}
```

### 4.4 Contoh `AbstractMethodError`

v1:

```java
public interface RuleEvaluator {
    Result evaluate(CaseData data);
}
```

Implementor lama:

```java
public final class AgeRuleEvaluator implements RuleEvaluator {
    @Override
    public Result evaluate(CaseData data) {
        return Result.pass();
    }
}
```

v2:

```java
public interface RuleEvaluator {
    Result evaluate(CaseData data);
    Result explain(CaseData data);
}
```

Class lama tidak punya implementation `explain`. Jika runtime memanggil `explain`, bisa terjadi `AbstractMethodError`.

Aman:

```java
public interface RuleEvaluator {
    Result evaluate(CaseData data);

    default Result explain(CaseData data) {
        return evaluate(data);
    }
}
```

Tetapi default method juga harus didesain hati-hati agar tidak mengubah semantic contract secara mengejutkan.

### 4.5 Contoh `IllegalAccessError`

v1:

```java
public class CaseFormatter {
    public String format(CaseData data) {
        return data.id().value();
    }
}
```

v2:

```java
class CaseFormatter { // package-private sekarang
    public String format(CaseData data) {
        return data.id().value();
    }
}
```

Consumer binary lama masih mencoba akses public class lama. Runtime bisa gagal karena access berubah.

### 4.6 Contoh `IncompatibleClassChangeError`

v1:

```java
public class RuleRegistry {
    public Rule get(String code) { ... }
}
```

v2:

```java
public interface RuleRegistry {
    Rule get(String code);
}
```

Mengubah class menjadi interface adalah perubahan bentuk fundamental. Binary lama yang mengharapkan class bisa gagal dengan `IncompatibleClassChangeError`.

---

## 5. Behavioral Compatibility

Behavioral compatibility adalah yang paling sulit karena tidak sepenuhnya direpresentasikan dalam signature.

Contoh perubahan behavioral breaking:

```java
// v1
public Optional<Case> findById(CaseId id) {
    return Optional.empty(); // not found
}

// v2
public Optional<Case> findById(CaseId id) {
    throw new CaseNotFoundException(id); // not found
}
```

Signature sama, tetapi consumer yang mengandalkan empty Optional rusak.

### 5.1 Contract yang Harus Ditulis

API publik harus menjelaskan:

- apakah parameter boleh null,
- apakah return boleh null,
- apakah collection mutable,
- apakah urutan collection stabil,
- apakah method thread-safe,
- apakah method idempotent,
- apakah method deterministic,
- apakah exception apa yang dapat dilempar,
- apakah result cached,
- apakah method melakukan I/O,
- apakah method blocking,
- apakah method membaca waktu saat ini,
- apakah method memodifikasi input,
- apakah method menyimpan reference input,
- apakah object immutable,
- apakah equality berdasarkan identity atau value,
- apakah enum/string code stabil untuk persistence,
- apakah annotation diproses compile-time/runtime,
- apakah generated code boleh diedit.

Tanpa contract tertulis, consumer akan menebak. Tebakan consumer lama kemudian menjadi “unofficial API”.

### 5.2 Behavioral Compatibility dalam Domain Regulatory

Misalnya API:

```java
public interface EscalationPolicy {
    EscalationDecision decide(CaseSnapshot snapshot);
}
```

Perubahan dari:

```text
Jika overdue > 14 hari => ESCALATE
```

menjadi:

```text
Jika overdue >= 14 hari => ESCALATE
```

adalah behavioral breaking bagi workflow yang mengandalkan hari ke-14 masih belum escalate.

Signature tidak berubah, tetapi business outcome berubah.

Karena itu API domain harus punya:

- test scenario,
- decision table,
- examples,
- changelog,
- migration note,
- versioned rule if necessary.

---

## 6. Semantic Versioning di Java

Semantic Versioning umumnya memakai format:

```text
MAJOR.MINOR.PATCH
```

Makna umum:

| Version Part | Makna |
|---|---|
| MAJOR | Ada breaking change pada public API |
| MINOR | Ada fitur baru backward-compatible |
| PATCH | Bug fix backward-compatible |

Namun di Java, SemVer harus dipakai dengan pemahaman compatibility yang lebih detail.

### 6.1 SemVer Butuh Public API yang Jelas

SemVer tidak bermakna jika public API tidak didefinisikan.

Harus jelas:

```text
Stable API:
- com.acme.caseapi.*
- com.acme.caseapi.spi.*

Internal, no compatibility guarantee:
- com.acme.caseapi.internal.*
- com.acme.caseapi.generated.*
```

Dengan JPMS:

```java
module com.acme.caseapi {
    exports com.acme.caseapi;
    exports com.acme.caseapi.spi;
}
```

Package yang tidak diexport lebih jelas sebagai internal.

### 6.2 Versioning Policy yang Lebih Realistis

Untuk Java library enterprise, policy praktis:

| Change Type | Version Impact |
|---|---|
| Fix typo in Javadoc | PATCH |
| Fix internal bug without changing behavior contract | PATCH |
| Add new method to class | MINOR |
| Add default method to interface | MINOR, but review behavior/conflict |
| Add abstract method to SPI interface | MAJOR unless special migration path |
| Remove deprecated method | MAJOR |
| Rename package/class | MAJOR |
| Change method parameter type | MAJOR |
| Change return type | Usually MAJOR |
| Add enum constant | MINOR, but can break exhaustive switch behavior source-level |
| Remove enum constant | MAJOR |
| Add record component | MAJOR for constructor/pattern/serialization consumers |
| Add annotation element with default | MINOR |
| Add annotation element without default | MAJOR |
| Tighten validation | Usually MAJOR or at least behavioral breaking |
| Loosen validation | MINOR or PATCH depending contract |
| Change exception behavior | Usually MAJOR if documented/relied on |
| Change transitive dependency exposed in API | MINOR or MAJOR depending source/binary impact |
| Change JPMS exports | MAJOR |
| Add JPMS descriptor | Potentially MINOR/MAJOR depending consumers |

### 6.3 Pre-1.0 Versioning

SemVer mengatakan `0.y.z` untuk initial development, public API belum stabil. Tetapi di enterprise, banyak library `0.x` tetap dipakai production.

Jangan jadikan `0.x` sebagai alasan breaking change sembarangan.

Policy yang lebih sehat:

```text
0.x may break, but every breaking change must still have:
- changelog
- migration note
- owner approval
- downstream impact check
```

### 6.4 Versioning untuk Multi-Module Repository

Dalam multi-module Java repo:

```text
case-api
case-spi
case-impl
case-testkit
case-annotation-processor
case-generated-runtime
```

Ada dua strategi:

1. **Lockstep versioning**  
   Semua module release dengan versi sama.

2. **Independent versioning**  
   Tiap module punya versi sendiri.

Lockstep lebih sederhana untuk enterprise internal platform. Independent lebih fleksibel tetapi butuh governance kuat.

Untuk platform internal dengan banyak consumer, biasanya lockstep + BOM lebih aman:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.acme.case</groupId>
      <artifactId>case-platform-bom</artifactId>
      <version>2.4.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

---

## 7. API Surface Design: Semakin Kecil, Semakin Evolvable

API evolution dimulai sebelum API dipublish.

Rule paling penting:

> Jangan expose lebih banyak daripada yang sanggup kamu support dalam jangka panjang.

### 7.1 Public Class Cost

Setiap public class menambah:

- naming commitment,
- package commitment,
- constructor commitment,
- inheritance commitment jika non-final,
- method commitment,
- field/constant commitment,
- serialization/reflection expectation,
- documentation responsibility,
- testing matrix,
- compatibility burden.

Karena itu default desain library:

```java
public final class CaseIds {
    private CaseIds() {}

    public static CaseId parse(String value) {
        return new DefaultCaseId(value);
    }

    private static final class DefaultCaseId implements CaseId {
        private final String value;
        // internal
    }
}
```

Expose interface/value abstraction, sembunyikan implementation.

### 7.2 Prefer Factory Method untuk Evolvability

Constructor publik sulit dievolusi.

```java
public final class Money {
    public Money(BigDecimal amount, Currency currency) {
        ...
    }
}
```

Jika nanti perlu rounding mode, locale, scale policy, atau validation context, constructor sulit diubah.

Lebih evolvable:

```java
public final class Money {
    private Money(BigDecimal amount, Currency currency) {
        ...
    }

    public static Money of(BigDecimal amount, Currency currency) {
        return new Money(amount, currency);
    }
}
```

Atau builder untuk complex object:

```java
public final class CaseSearchRequest {
    private final CaseStatus status;
    private final LocalDate from;
    private final LocalDate to;
    private final int pageSize;

    private CaseSearchRequest(Builder builder) { ... }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        public Builder status(CaseStatus status) { ... }
        public Builder dateRange(LocalDate from, LocalDate to) { ... }
        public Builder pageSize(int pageSize) { ... }
        public CaseSearchRequest build() { ... }
    }
}
```

Builder juga bukan silver bullet. Jika object kecil dan stabil, record bisa cukup.

### 7.3 Final by Default untuk Implementation Class

Non-final public class adalah invitation untuk subclassing.

Jika class bisa disubclass, kamu harus mendukung:

- constructor behavior,
- protected method contract,
- overridable method order,
- equality under subclass,
- initialization safety,
- binary compatibility for subclass binaries,
- future method additions yang bisa konflik dengan subclass method.

Jika tidak sengaja mendesain extension point, gunakan:

```java
public final class DefaultCaseFormatter implements CaseFormatter {
    ...
}
```

atau sembunyikan class sebagai package-private.

### 7.4 Interface sebagai API, Class sebagai Implementation

Pattern umum:

```java
public interface CaseFormatter {
    String format(CaseView view);
}

final class DefaultCaseFormatter implements CaseFormatter {
    @Override
    public String format(CaseView view) {
        ...
    }
}
```

Namun interface juga commitment. Jangan membuat interface hanya karena “best practice”. Buat interface jika ada:

- multiple implementation,
- SPI boundary,
- testing seam yang valid,
- plugin/provider mechanism,
- dependency inversion boundary,
- stable role abstraction.

### 7.5 Avoid Public Fields

Public mutable fields hampir selalu buruk.

```java
public class Config {
    public int timeoutMs;
}
```

Masalah:

- tidak bisa validasi assignment,
- tidak bisa ubah representasi internal,
- tidak bisa intercept mutation,
- binary compatibility field descriptor sensitif,
- reflection/generation bisa mengandalkannya.

Prefer immutable object:

```java
public record TimeoutConfig(Duration timeout) {
    public TimeoutConfig {
        Objects.requireNonNull(timeout, "timeout");
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
    }
}
```

---

## 8. Class Evolution Rules

### 8.1 Menambah Method ke Class

Umumnya binary compatible:

```java
public final class CaseValidator {
    public ValidationResult validate(CaseDraft draft) { ... }

    // v2
    public ValidationResult validate(CaseDraft draft, ValidationContext context) { ... }
}
```

Tapi bisa source issue karena overload ambiguity.

Berhati-hati dengan:

```java
validator.validate(null);
```

Atau lambda target ambiguity:

```java
service.register(x -> x.toString());
```

Jika overload baru membuat target type ambigu, consumer source bisa rusak.

### 8.2 Mengubah Return Type

Covariant return type pada overriding berbeda dengan mengubah API method existing.

v1:

```java
public Number value() { ... }
```

v2:

```java
public Integer value() { ... }
```

Compiler bisa menghasilkan bridge dalam konteks overriding tertentu, tetapi perubahan public method biasa bisa berisiko. Jangan mengandalkan intuisi. Treat sebagai breaking kecuali sudah diverifikasi dengan binary compatibility checker.

Safe pattern:

```java
/** @deprecated use {@link #integerValue()} */
@Deprecated(since = "2.0", forRemoval = false)
public Number value() {
    return integerValue();
}

public Integer integerValue() {
    return value;
}
```

### 8.3 Mengubah Parameter Type

v1:

```java
public void submit(Application application) { ... }
```

v2:

```java
public void submit(CaseApplication application) { ... }
```

Breaking.

Safe evolution:

```java
public void submit(Application application) {
    if (application instanceof CaseApplication caseApplication) {
        submit(caseApplication);
        return;
    }
    throw new IllegalArgumentException("Unsupported application type");
}

public void submit(CaseApplication application) { ... }
```

Namun behavior harus jelas.

### 8.4 Mengubah Constructor

Constructor adalah API. Menghapus atau mengubah constructor adalah breaking.

v1:

```java
public CaseClient(String baseUrl) { ... }
```

v2:

```java
public CaseClient(URI baseUri, HttpClient client) { ... }
```

Safe:

```java
/** @deprecated use builder() */
@Deprecated(since = "2.0", forRemoval = false)
public CaseClient(String baseUrl) {
    this(URI.create(baseUrl), HttpClient.newHttpClient());
}

public static Builder builder() { ... }
```

### 8.5 Mengubah Access Modifier

Widening access biasanya lebih aman:

```text
private -> package-private -> protected -> public
```

Narrowing access biasanya breaking:

```text
public -> protected/package/private
```

Namun widening juga menambah API surface. Jangan public-kan internal hanya untuk test/framework tanpa memikirkan long-term cost.

### 8.6 Menambahkan `final`

Mengubah class dari non-final menjadi final bisa merusak subclass lama.

```java
// v1
public class RuleEngine { }

// v2
public final class RuleEngine { }
```

Jika ada consumer yang extend `RuleEngine`, mereka rusak.

Karena itu lebih baik final sejak awal jika tidak dimaksudkan untuk subclass.

### 8.7 Mengubah Superclass

v1:

```java
public class CaseException extends RuntimeException { }
```

v2:

```java
public class CaseException extends Exception { }
```

Ini bukan hanya binary/source issue; ini mengubah checked/unchecked behavior. Sangat breaking.

Bahkan mengubah superclass internal bisa mempengaruhi inherited methods, serialization, `instanceof`, catch block, dan framework behavior.

---

## 9. Interface Evolution Rules

Interface sering dipakai sebagai public contract. Evolusinya harus lebih hati-hati.

### 9.1 Menambah Abstract Method

Breaking untuk implementor lama.

```java
public interface AuditSink {
    void write(AuditEvent event);

    // breaking
    void flush();
}
```

Aman dengan default:

```java
public interface AuditSink {
    void write(AuditEvent event);

    default void flush() {
        // no-op by default
    }
}
```

Tetapi default no-op bisa misleading jika `flush` penting untuk durability.

### 9.2 Default Method Bukan Selalu Aman

Default method bisa conflict.

```java
interface A {
    default String name() { return "A"; }
}

interface B {
    default String name() { return "B"; }
}

class C implements A, B {
    @Override
    public String name() {
        return A.super.name();
    }
}
```

Jika v2 menambahkan default method ke interface yang sebelumnya tidak punya, class yang implement beberapa interface bisa mengalami conflict saat recompile.

Binary lama mungkin tetap jalan sampai method dipakai atau class di-resolve dalam kondisi tertentu, tetapi source compatibility bisa bermasalah.

### 9.3 SPI Interface Lebih Sensitif dari Consumer Interface

Ada dua jenis interface:

1. **Consumer-facing interface**: consumer memanggil, library mengimplementasi.
2. **Provider/SPI interface**: consumer mengimplementasi, library memanggil.

SPI lebih sulit dievolusi.

```java
public interface RuleProvider {
    Stream<Rule> rules();
}
```

Menambah abstract method akan merusak provider lama.

Safe SPI evolution pattern:

```java
public interface RuleProvider {
    Stream<Rule> rules();

    default ProviderMetadata metadata() {
        return ProviderMetadata.unknown();
    }
}
```

Atau versi baru interface:

```java
public interface RuleProviderV2 extends RuleProvider {
    ProviderMetadata metadata();
}
```

Library:

```java
if (provider instanceof RuleProviderV2 v2) {
    metadata = v2.metadata();
} else {
    metadata = ProviderMetadata.unknown();
}
```

### 9.4 Sealed Interface Evolution

Sealed interface sangat berguna untuk closed world modeling, tetapi evolution-nya sensitif.

```java
public sealed interface Decision permits Approved, Rejected, Pending { }
```

Menambah subtype:

```java
public sealed interface Decision permits Approved, Rejected, Pending, Escalated { }
```

Bisa mengganggu consumer yang memakai exhaustive switch. Binary compatibility perlu dicek, tetapi source consumer dengan switch exhaustive harus menambah case baru.

Untuk public API yang sering bertambah variants, sealed hierarchy mungkin bukan pilihan terbaik.

---

## 10. Record Evolution Rules

Record adalah API yang sangat transparent. Component adalah contract.

```java
public record CaseSummary(CaseId id, CaseStatus status) { }
```

Public API record mencakup:

- record component names,
- component types,
- canonical constructor,
- accessor methods,
- `equals`, `hashCode`, `toString` semantics,
- serialization form if serialized,
- pattern matching/deconstruction expectations,
- generated mapper expectations.

### 10.1 Menambah Record Component

v1:

```java
public record CaseSummary(CaseId id, CaseStatus status) { }
```

v2:

```java
public record CaseSummary(CaseId id, CaseStatus status, LocalDateTime updatedAt) { }
```

Ini breaking untuk code yang memanggil canonical constructor lama:

```java
new CaseSummary(id, status);
```

Bisa juga mengubah equality/hash/toString.

Safe-ish pattern:

```java
public record CaseSummary(CaseId id, CaseStatus status, LocalDateTime updatedAt) {
    /**
     * @deprecated use canonical constructor with updatedAt.
     */
    @Deprecated(since = "2.0", forRemoval = false)
    public CaseSummary(CaseId id, CaseStatus status) {
        this(id, status, LocalDateTime.MIN);
    }
}
```

Tetapi equality tetap berubah karena component baru masuk equality. Jika equality contract harus tetap sama, record mungkin bukan struktur yang tepat untuk API yang sering berevolusi.

### 10.2 Mengubah Component Type

```java
// v1
public record CaseSummary(String id) { }

// v2
public record CaseSummary(CaseId id) { }
```

Breaking. Tambahkan API baru dan deprecate lama.

### 10.3 Record untuk Public DTO: Kapan Cocok

Record cocok jika:

- shape stabil,
- semua component memang bagian dari identity/value,
- shallow immutability cukup,
- canonical constructor acceptable,
- evolution jarang,
- consumer nyaman dengan transparent representation.

Record kurang cocok jika:

- field sering bertambah,
- backward-compatible constructor penting,
- equality harus custom/stabil terlepas field baru,
- object punya lifecycle kompleks,
- framework serialization butuh mutable no-arg pattern,
- data shape harus sangat version tolerant.

---

## 11. Enum Evolution Rules

Enum sering dipakai sebagai status, code, type, atau category.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

### 11.1 Menambah Enum Constant

Menambah constant biasanya binary compatible, tetapi bisa source/behavior issue.

Consumer:

```java
return switch (status) {
    case DRAFT -> "Draft";
    case SUBMITTED -> "Submitted";
    case APPROVED -> "Approved";
    case REJECTED -> "Rejected";
};
```

Jika v2 menambah:

```java
ESCALATED
```

Consumer source harus memperbarui exhaustive switch.

Jika consumer punya default:

```java
default -> "Unknown";
```

source compile, tetapi behavior mungkin tidak diinginkan.

### 11.2 Menghapus/Rename Enum Constant

Breaking serius.

```java
APPROVED -> ACCEPTED
```

Akan merusak:

- source reference,
- binary reference,
- serialized enum,
- database persistence jika memakai `name()`,
- JSON payload,
- switch mapping,
- generated code.

Safe migration:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,

    /**
     * @deprecated use ACCEPTED.
     */
    @Deprecated(since = "2.0", forRemoval = false)
    APPROVED,

    ACCEPTED,
    REJECTED;

    public CaseStatus canonical() {
        return this == APPROVED ? ACCEPTED : this;
    }
}
```

Namun ini menambah complexity. Untuk persistent status, stable external code sering lebih aman:

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    ACCEPTED("APPROVED"), // external code tetap lama
    REJECTED("REJECTED");

    private final String externalCode;

    CaseStatus(String externalCode) {
        this.externalCode = externalCode;
    }

    public String externalCode() {
        return externalCode;
    }
}
```

### 11.3 Jangan Persist `ordinal()`

Ordinal berubah jika constant order berubah. Persist stable code, bukan ordinal.

---

## 12. Annotation Evolution Rules

Annotation adalah API jika dipakai oleh framework, processor, generator, atau runtime scanner.

### 12.1 Menambah Element dengan Default

Aman:

```java
public @interface Rule {
    String code();
    int priority() default 0;
}
```

### 12.2 Menambah Element tanpa Default

Breaking:

```java
public @interface Rule {
    String code();
    int priority(); // existing usages fail compile
}
```

### 12.3 Mengubah Retention

```java
@Retention(RetentionPolicy.RUNTIME)
```

menjadi:

```java
@Retention(RetentionPolicy.CLASS)
```

Bisa merusak runtime framework yang membaca annotation via reflection.

Sebaliknya `CLASS` menjadi `RUNTIME` bisa expose metadata baru dan mempengaruhi framework behavior.

### 12.4 Mengubah Target

Menghapus target existing breaking:

```java
@Target(ElementType.TYPE)
```

menjadi:

```java
@Target(ElementType.METHOD)
```

Existing usage pada class gagal compile.

Menambah target biasanya source compatible, tetapi bisa menyebabkan processor/framework menemukan annotation di tempat baru dan harus siap.

### 12.5 Mengubah Meaning Default

```java
public @interface Retryable {
    int maxAttempts() default 3;
}
```

Mengubah default menjadi `1` adalah behavioral breaking walaupun source/binary mungkin aman.

---

## 13. Generic API Evolution

Generics menambah lapisan compatibility.

### 13.1 Erasure Bisa Menyembunyikan Breaking Source

v1:

```java
public List findAll() { ... } // raw
```

v2:

```java
public List<CaseSummary> findAll() { ... }
```

Binary descriptor sama karena erasure `List`. Bisa binary compatible, tetapi source warnings berubah, dan behavior expectation berubah.

### 13.2 Mengubah Generic Bound

v1:

```java
public interface Repository<T> {
    T save(T entity);
}
```

v2:

```java
public interface Repository<T extends Entity> {
    T save(T entity);
}
```

Consumer dengan `Repository<Command>` rusak.

### 13.3 Wildcard Evolution

v1:

```java
public void registerAll(List<Rule> rules) { ... }
```

v2:

```java
public void registerAll(List<? extends Rule> rules) { ... }
```

Ini lebih flexible source-wise, tetapi binary signature after erasure mungkin sama. Namun perubahan generic signature dapat mempengaruhi reflection consumers, documentation, and compilation.

### 13.4 Generic Signature adalah Reflective API

Framework bisa membaca generic metadata:

```java
Field field = clazz.getDeclaredField("rules");
Type type = field.getGenericType();
```

Perubahan dari:

```java
List<Rule>
```

ke:

```java
Collection<Rule>
```

atau:

```java
List<? extends Rule>
```

bisa merusak mapper/serializer/generator walaupun runtime erasure terlihat mirip.

---

## 14. Exception Evolution

Exception adalah bagian dari behavioral dan source API.

### 14.1 Checked Exception

v1:

```java
public void submit(CaseDraft draft) throws ValidationException;
```

v2:

```java
public void submit(CaseDraft draft) throws ValidationException, ExternalServiceException;
```

Menambah checked exception dapat merusak source consumer yang recompile.

Binary? Throws clause bukan bagian dari method descriptor, tetapi source compatibility tetap rusak.

### 14.2 Unchecked Exception

Unchecked exception tidak muncul sebagai compile requirement, tetapi tetap behavioral contract jika documented.

```java
public Case find(CaseId id) {
    throw new CaseNotFoundException(id);
}
```

Mengganti dengan:

```java
throw new IllegalArgumentException("not found");
```

bisa merusak handler yang catch `CaseNotFoundException`.

### 14.3 Exception Hierarchy

Desain exception harus evolvable:

```java
public sealed class CaseApiException extends RuntimeException
        permits ValidationFailureException, CaseNotFoundException, CaseConflictException {
    ...
}
```

Sealed exception hierarchy memberi closed taxonomy, tetapi menambah subtype baru bisa mempengaruhi exhaustive pattern matching.

Alternatif lebih evolvable:

```java
public class CaseApiException extends RuntimeException {
    private final ErrorCode code;
}
```

Dengan stable `ErrorCode`.

---

## 15. Serialization and Data Compatibility

Java API bukan hanya method. Banyak API menghasilkan data yang disimpan atau dikirim.

### 15.1 Java Serialization

Jika class `Serializable`, serialized form menjadi API.

Perubahan field, class name, package, `serialVersionUID`, hierarchy, dan custom serialization bisa breaking.

Untuk library modern, hindari Java native serialization sebagai public compatibility contract kecuali memang wajib.

### 15.2 JSON/API Payload

Record/class DTO yang dikirim sebagai JSON punya compatibility rules:

- adding optional field biasanya compatible,
- removing field breaking,
- renaming field breaking,
- changing field type breaking,
- changing enum values breaking,
- changing default value behavioral breaking,
- changing nullability breaking,
- changing date format breaking,
- changing number precision breaking.

Walaupun topik ini bukan REST/JAX-RS, object model Java yang menjadi payload tetap harus memperhatikan data compatibility.

### 15.3 Database/Event Compatibility

Enum/status/value object yang dipersist juga punya evolution constraint.

```java
public record CaseEvent(
        EventId id,
        CaseId caseId,
        CaseStatus status,
        Instant occurredAt
) {}
```

Mengubah `status` dari enum ke object, mengubah field name, atau mengubah timestamp semantics bisa mempengaruhi event consumers lama.

---

## 16. Reflection Compatibility

Reflection consumers melihat hal yang berbeda dari ordinary source consumers.

Framework bisa bergantung pada:

- class name,
- package name,
- constructor no-arg,
- field name,
- method name,
- annotation presence,
- annotation retention,
- parameter names,
- record components,
- generic signatures,
- visibility,
- module opens,
- runtime-visible metadata.

### 16.1 Rename Field Bisa Breaking untuk Reflection

```java
public class CaseDto {
    public String caseId;
}
```

rename:

```java
public class CaseDto {
    public String id;
}
```

Source consumer yang memakai getter mungkin aman, tetapi JSON mapper field-based bisa rusak.

### 16.2 Parameter Name Compatibility

Jika framework memakai parameter names:

```java
public CaseCommand(String caseId, String reason) { ... }
```

mengubah nama parameter menjadi:

```java
public CaseCommand(String id, String reason) { ... }
```

bisa mempengaruhi reflection-based binding jika compiled with `-parameters`.

### 16.3 JPMS Opens

Jika module v1:

```java
module com.acme.caseapi {
    exports com.acme.caseapi;
    opens com.acme.caseapi.dto to com.fasterxml.jackson.databind;
}
```

v2 menghapus `opens`, runtime serialization/deserialization bisa gagal walaupun source/binary class masih ada.

---

## 17. Generated-Code Compatibility

Generated code sering compile terhadap generated/runtime API tertentu.

Contoh annotation processor v1 generate:

```java
public final class ApplicationRule_Index {
    public static List<RuleDescriptor> descriptors() { ... }
}
```

Runtime library v2 mengharapkan:

```java
public static RuleIndex index()
```

Jika generated source tidak diregenerate, runtime gagal.

### 17.1 Version Handshake

Generated code harus menyimpan generator/runtime version:

```java
@Generated(
    value = "com.acme.rules.processor.RuleProcessor",
    date = "2026-06-16"
)
public final class ApplicationRule_Index {
    public static final String GENERATED_BY = "rules-processor";
    public static final String GENERATOR_VERSION = "2.4.0";
    public static final int ABI_VERSION = 3;
}
```

Runtime:

```java
if (ApplicationRule_Index.ABI_VERSION != SUPPORTED_ABI_VERSION) {
    throw new IllegalStateException(
        "Generated rule index ABI mismatch. Regenerate sources."
    );
}
```

### 17.2 Generated Code as Public API?

Idealnya generated implementation bukan public API. Tetapi jika consumer imports generated classes, mereka menjadi API de facto.

Naming policy:

```text
com.acme.rules.generated.internal
```

Documentation:

```text
Do not import generated classes directly. Use RuleRegistry API.
```

---

## 18. JPMS Module Evolution

JPMS membuat boundary lebih explicit.

### 18.1 Adding Export

Menambah exported package memperluas API. Binary consumer lama aman, tetapi public surface bertambah.

```java
exports com.acme.caseapi.experimental;
```

Jika experimental, dokumentasikan atau hindari export.

### 18.2 Removing Export

Breaking.

Consumer module yang `requires` dan import package tersebut tidak compile/run.

### 18.3 Changing Requires

Menambah `requires transitive` bisa expose dependency baru ke downstream.

Menghapus `requires transitive` bisa membuat downstream source tidak compile jika mereka mengandalkan implied readability.

### 18.4 Opens Evolution

`opens` adalah reflection contract.

Menghapus/mempersempit `opens` bisa merusak frameworks.

Qualified opens lebih baik:

```java
opens com.acme.caseapi.dto to com.fasterxml.jackson.databind;
```

Daripada:

```java
open module com.acme.caseapi { ... }
```

Namun qualified opens juga menambah coupling ke framework module name.

### 18.5 Service Evolution

Module descriptor:

```java
uses com.acme.rules.RuleProvider;
provides com.acme.rules.RuleProvider with com.acme.rules.DefaultRuleProvider;
```

Menghapus provider bisa behavioral breaking bagi runtime discovery.

Mengubah provider class name bisa aman jika descriptor tetap benar, tetapi reflection/logging/tooling yang mengandalkan class name bisa terpengaruh.

---

## 19. Dependency Compatibility

API evolution juga dipengaruhi dependency.

### 19.1 Exposed Dependency

Jika public API memakai type dari dependency:

```java
public JsonNode toJson(CaseSummary summary); // Jackson JsonNode exposed
```

Maka Jackson menjadi bagian dari public API.

Upgrade major Jackson bisa mempengaruhi consumer.

Better if possible:

```java
public String toJson(CaseSummary summary);
```

atau expose abstraction sendiri:

```java
public interface JsonDocument { ... }
```

Tetapi jangan membuat abstraction palsu jika semua consumer memang butuh Jackson.

### 19.2 Transitive Dependency Drift

Maven/Gradle bisa memilih versi dependency berbeda akibat mediation/conflict resolution.

Library yang stabil harus:

- minimize exposed dependencies,
- avoid leaking implementation dependency in API,
- publish BOM if multi-artifact,
- use dependency convergence checks,
- document supported dependency versions,
- avoid shading unless necessary,
- relocate shaded packages,
- test with realistic dependency graph.

### 19.3 Optional Dependency

Optional dependency cocok untuk integration adapter.

```text
case-core
case-jackson-adapter
case-jakarta-adapter
case-spring-adapter
```

Jangan masukkan semua framework dependency ke core API.

---

## 20. Deprecation Strategy

Deprecation adalah migration mechanism, bukan tempat sampah API.

### 20.1 Good Deprecation

```java
/**
 * Finds a case by its legacy string id.
 *
 * @deprecated since 2.2, use {@link #findById(CaseId)} instead.
 * This method will be removed no earlier than 3.0.
 */
@Deprecated(since = "2.2", forRemoval = false)
public Optional<Case> findById(String id) {
    return findById(CaseId.parse(id));
}
```

Good deprecation includes:

- since version,
- replacement API,
- removal policy,
- behavior equivalence note,
- migration example,
- warning if not equivalent.

### 20.2 Bad Deprecation

```java
@Deprecated
public void process(Object value) { ... }
```

Masalah:

- sejak kapan tidak jelas,
- kenapa deprecated tidak jelas,
- pakai apa sebagai pengganti tidak jelas,
- kapan dihapus tidak jelas.

### 20.3 `forRemoval`

Gunakan `forRemoval = true` hanya jika removal benar-benar direncanakan.

```java
@Deprecated(since = "2.5", forRemoval = true)
public void oldSubmit(CaseDraft draft) { ... }
```

Ini memberi sinyal kuat ke consumer dan tooling.

### 20.4 Deprecation Window

Untuk enterprise internal platform, policy bisa:

```text
- Deprecated in MINOR release.
- Kept for at least one major release cycle or 6 months.
- Removal only in MAJOR release.
- Removal requires downstream scan.
```

Untuk high-risk API:

```text
- Add replacement.
- Emit warning/metric when old API used.
- Provide migration script if possible.
- Keep compatibility adapter.
- Remove only after adoption reaches threshold.
```

---

## 21. Adapter Layer as Migration Tool

Breaking change kadang perlu. Tetapi migration path bisa mengurangi risiko.

### 21.1 Old API Delegates to New API

```java
public final class CaseService {
    /** @deprecated use submit(SubmitCaseCommand) */
    @Deprecated(since = "2.0", forRemoval = false)
    public SubmitResult submit(CaseDraft draft) {
        return submit(new SubmitCaseCommand(draft, SubmitOptions.defaults()));
    }

    public SubmitResult submit(SubmitCaseCommand command) {
        ...
    }
}
```

### 21.2 New API Wraps Old Implementation

Saat refactor internal belum selesai:

```java
public SubmitResult submit(SubmitCaseCommand command) {
    return legacySubmit(command.draft());
}
```

Ini menjaga public API dulu, lalu internal dapat dimigrasi bertahap.

### 21.3 Compatibility Facade

```java
public final class LegacyCaseClient {
    private final CaseClient delegate;

    public LegacyCaseClient(CaseClient delegate) {
        this.delegate = delegate;
    }

    public LegacyCaseResponse submit(LegacyCaseRequest request) {
        SubmitCaseCommand command = LegacyMapper.toCommand(request);
        SubmitResult result = delegate.submit(command);
        return LegacyMapper.toResponse(result);
    }
}
```

Facade berguna untuk memisahkan legacy contract dari new core API.

---

## 22. API Review Checklist

Sebelum publish API, tanyakan:

### 22.1 Boundary

- Apakah class/package ini memang perlu public?
- Apakah package ini harus diexport JPMS?
- Apakah ada internal package yang bocor?
- Apakah public type memakai implementation dependency?
- Apakah public API memakai framework-specific type?

### 22.2 Construction

- Apakah constructor publik stabil?
- Apakah factory lebih baik?
- Apakah builder diperlukan?
- Apakah default value jelas?
- Apakah invariant divalidasi?

### 22.3 Mutability

- Apakah object immutable?
- Apakah collection return mutable?
- Apakah defensive copy dilakukan?
- Apakah equality/hash stable?
- Apakah object aman jadi map key/cache key?

### 22.4 Nullability

- Parameter boleh null?
- Return boleh null?
- `Optional` dipakai di tempat tepat?
- Empty collection atau null?
- Annotation nullability tersedia?

### 22.5 Error

- Exception apa yang dilempar?
- Checked/unchecked decision jelas?
- Error code stabil?
- Result type perlu?
- Validation error accumulation perlu?

### 22.6 Evolution

- Bagaimana menambah field/method nanti?
- Apakah record shape terlalu cepat dipublish?
- Apakah enum akan bertambah?
- Apakah sealed hierarchy akan berubah?
- Apakah interface ini SPI yang akan sulit dievolusi?
- Apakah overload baru akan ambiguous?

### 22.7 Reflection/Generation

- Apakah framework butuh no-arg constructor?
- Apakah field/method name akan dibaca reflection?
- Apakah parameter names perlu stabil?
- Apakah annotation retention tepat?
- Apakah generated code punya ABI version?

### 22.8 Dependency

- Apakah API expose third-party type?
- Apakah dependency transitive perlu?
- Apakah BOM tersedia?
- Apakah optional adapter dipisah?
- Apakah shading/relocation perlu?

### 22.9 Documentation

- Apakah behavior contract tertulis?
- Apakah examples ada?
- Apakah thread-safety jelas?
- Apakah deprecation replacement jelas?
- Apakah migration guide ada?

---

## 23. Compatibility Testing

Testing API evolution tidak cukup dengan unit test biasa.

### 23.1 Binary Compatibility Test

Workflow:

1. Compile sample consumer terhadap library v1.
2. Jalankan sample consumer dengan library v2 tanpa recompile.
3. Pastikan tidak ada linkage error.

Structure:

```text
compat-tests/
  consumer-v1-source/
  compiled-consumer-v1/
  library-v2-under-test/
```

Test command concept:

```bash
javac -cp case-api-1.0.jar Consumer.java
java  -cp case-api-2.0.jar:. Consumer
```

### 23.2 Source Compatibility Test

1. Ambil representative consumer source.
2. Compile ulang terhadap v2.
3. Capture compile errors/warnings.

### 23.3 Behavioral Compatibility Test

Gunakan golden tests:

```java
@Test
void overdueFourteenDaysShouldStillNotEscalateIfPolicySaysGreaterThanFourteen() {
    CaseSnapshot snapshot = snapshotWithOverdueDays(14);

    EscalationDecision decision = policy.decide(snapshot);

    assertThat(decision.type()).isEqualTo(EscalationType.NONE);
}
```

Jika behavior sengaja berubah, test harus diupdate bersama migration note.

### 23.4 API Diff Tools

Untuk Java ecosystem, biasanya dipakai tool seperti:

- japicmp,
- Revapi,
- Clirr historically,
- jdeprscan for deprecated JDK APIs,
- jdeps for dependency/module analysis,
- custom ArchUnit rules,
- Maven Enforcer,
- Gradle dependency verification/locking.

CI policy:

```text
- API diff runs on every release PR.
- Breaking change requires explicit label and major version bump.
- Deprecated API removal requires migration issue reference.
- Public API additions require documentation.
```

---

## 24. Changelog and Migration Guide

Changelog bukan formalitas. Untuk API evolution, changelog adalah operational control.

### 24.1 Good Changelog Entry

```markdown
## 2.4.0

### Added
- Added `CaseRepository.existsById(CaseId)` as a default method.

### Deprecated
- Deprecated `CaseRepository.findById(String)` since string ids bypass validation.
  Use `CaseRepository.findById(CaseId)`.

### Changed
- `DefaultEscalationPolicy` now treats public holidays as non-working days.
  This may change escalation date calculation.

### Migration
Before:
```java
repository.findById("CASE-001");
```

After:
```java
repository.findById(CaseId.parse("CASE-001"));
```
```

### 24.2 Bad Changelog Entry

```markdown
- Refactor case APIs.
- Fix bugs.
- Update dependencies.
```

Tidak cukup untuk downstream impact analysis.

### 24.3 Migration Guide Structure

Untuk major version:

```text
1. Summary
2. Who is affected
3. Breaking changes
4. Replacement APIs
5. Mechanical migration steps
6. Behavioral changes
7. Dependency changes
8. JPMS/module changes
9. Generated code regeneration steps
10. Rollback considerations
```

---

## 25. Designing an Evolvable Java Library: Reference Architecture

Misalnya kita desain internal library untuk regulatory case rules.

### 25.1 Artifact Layout

```text
case-rules-bom
case-rules-api
case-rules-spi
case-rules-core
case-rules-annotations
case-rules-processor
case-rules-testkit
case-rules-jackson-adapter
case-rules-spring-adapter
```

### 25.2 Package Layout

```text
com.acme.caserules.api
com.acme.caserules.api.model
com.acme.caserules.spi
com.acme.caserules.annotation
com.acme.caserules.internal
com.acme.caserules.generated
```

### 25.3 Module Descriptor

```java
module com.acme.caserules.api {
    exports com.acme.caserules.api;
    exports com.acme.caserules.api.model;
    exports com.acme.caserules.spi;

    uses com.acme.caserules.spi.RuleProvider;
}
```

Implementation module:

```java
module com.acme.caserules.core {
    requires com.acme.caserules.api;

    provides com.acme.caserules.spi.RuleProvider
        with com.acme.caserules.internal.DefaultRuleProvider;
}
```

### 25.4 Stable API

```java
public interface RuleEngine {
    EvaluationResult evaluate(EvaluationRequest request);
}
```

Request object:

```java
public final class EvaluationRequest {
    private final CaseSnapshot snapshot;
    private final EvaluationContext context;

    private EvaluationRequest(Builder builder) {
        this.snapshot = Objects.requireNonNull(builder.snapshot, "snapshot");
        this.context = builder.context == null
                ? EvaluationContext.defaults()
                : builder.context;
    }

    public static Builder builder(CaseSnapshot snapshot) {
        return new Builder(snapshot);
    }

    public CaseSnapshot snapshot() {
        return snapshot;
    }

    public EvaluationContext context() {
        return context;
    }

    public static final class Builder {
        private final CaseSnapshot snapshot;
        private EvaluationContext context;

        private Builder(CaseSnapshot snapshot) {
            this.snapshot = Objects.requireNonNull(snapshot, "snapshot");
        }

        public Builder context(EvaluationContext context) {
            this.context = context;
            return this;
        }

        public EvaluationRequest build() {
            return new EvaluationRequest(this);
        }
    }
}
```

Builder memberi ruang evolution untuk menambah option tanpa mengubah constructor.

### 25.5 Stable Result

Jika result shape stabil:

```java
public record EvaluationResult(
        Decision decision,
        List<Violation> violations,
        List<AuditFact> auditFacts
) {
    public EvaluationResult {
        Objects.requireNonNull(decision, "decision");
        violations = List.copyOf(violations);
        auditFacts = List.copyOf(auditFacts);
    }
}
```

Jika result shape sering berubah, class builder bisa lebih evolvable daripada record.

### 25.6 SPI Evolution

```java
public interface RuleProvider {
    Stream<RuleDefinition> rules();

    default ProviderMetadata metadata() {
        return ProviderMetadata.unknown();
    }
}
```

Jangan menambah abstract method sembarangan.

### 25.7 Annotation Evolution

```java
@Retention(RetentionPolicy.CLASS)
@Target(ElementType.TYPE)
public @interface RuleDefinitionType {
    String code();
    String version() default "1";
    int priority() default 0;
}
```

Jika processor compile-time saja, `CLASS` mungkin cukup. Jika runtime scanner butuh annotation, pilih `RUNTIME` dari awal dan pertahankan.

### 25.8 Generated Code ABI

```java
public final class GeneratedRuleIndex {
    public static final int ABI_VERSION = 1;

    public static List<RuleDescriptor> descriptors() {
        return List.of(...);
    }
}
```

Runtime check:

```java
if (GeneratedRuleIndex.ABI_VERSION != RuleRuntime.SUPPORTED_GENERATED_ABI) {
    throw new RuleInitializationException("Generated rule index is incompatible. Regenerate rules.");
}
```

---

## 26. Common Anti-Patterns

### 26.1 “It Is Public But Not API”

Jika public dan reachable, someone will use it.

Better:

- package-private,
- non-exported JPMS package,
- internal package with enforcement,
- javadoc warning,
- ArchUnit rule,
- separate artifact.

### 26.2 Exposing Third-Party Types Everywhere

```java
public Mono<Case> find(...);        // exposes Reactor
public JsonNode serialize(...);     // exposes Jackson
public ResponseEntity<Case> get();  // exposes Spring
```

Kadang benar untuk adapter module, tetapi buruk untuk core API jika ingin framework-agnostic.

### 26.3 Record for Everything

Record bagus, tetapi public record adalah commitment terhadap exact component list.

Jangan gunakan public record untuk shape yang cepat berubah kecuali migration cost diterima.

### 26.4 Enum for Unbounded Domain

Jika value bisa ditambah oleh database/config/agency, enum mungkin salah.

Gunakan:

```java
public record CaseType(String code) { ... }
```

atau lookup model.

### 26.5 Interface for Every Class

Interface yang hanya mirror implementation tanpa abstraction nyata menambah API surface dan evolution burden.

### 26.6 Throwing Generic Exceptions

```java
throw new RuntimeException("failed");
```

Consumer tidak bisa handle secara stabil.

Prefer domain exception or result model.

### 26.7 Hidden Behavioral Breaking in Patch Release

Patch release seharusnya tidak mengubah business semantics secara mengejutkan.

Jika patch memperbaiki bug yang consumer sudah mengandalkan, tetap dokumentasikan as behavioral change.

### 26.8 Removing Deprecated Too Quickly

Deprecation tanpa window membuat consumer kehilangan migration path.

### 26.9 Depending on Transitive Dependencies

Consumer memakai dependency yang kebetulan transitively available.

Library owner kemudian menghapus transitive dependency dan consumer compile/runtime rusak.

Consumer harus declare direct dependencies. Library owner bisa membantu dengan BOM and documentation.

---

## 27. Decision Matrix: Apakah Perubahan Ini Breaking?

| Proposed Change | Source Risk | Binary Risk | Behavioral Risk | Recommendation |
|---|---:|---:|---:|---|
| Add method to final class | Low | Low | Medium | Check overload ambiguity and docs |
| Remove method | High | High | High | Major + deprecation first |
| Add abstract method to interface | High | High | High | Avoid; use default or V2 interface |
| Add default method to interface | Medium | Low/Medium | Medium | Check conflict and semantics |
| Add enum constant | Medium | Low | Medium | Document; check exhaustive switch users |
| Rename enum constant | High | High | High | Avoid; add new + deprecate old |
| Add record component | High | High/Medium | High | Usually major |
| Add annotation element with default | Low | Low | Medium | OK; processor must handle |
| Add annotation element without default | High | High/Medium | Medium | Major |
| Change generic bound | High | Medium | Medium | Usually major |
| Change method body only | Low | Low | Medium/High | Need behavioral tests |
| Tighten validation | Medium | Low | High | Treat as breaking unless bug fix documented |
| Expose new package via JPMS | Low | Low | Medium | Adds API surface; document |
| Remove exported package | High | High | High | Major |
| Remove opens for framework | Low source | Runtime high | High | Major or migration |
| Upgrade exposed dependency major | Medium | Medium/High | Medium | Review as API change |

---

## 28. Release Gate for Serious Java API

Sebelum release:

```text
[ ] Public API diff checked.
[ ] Binary compatibility checked.
[ ] Source compatibility checked against representative consumers.
[ ] Behavioral golden tests pass.
[ ] Deprecated APIs have replacement docs.
[ ] No accidental public/internal package exposure.
[ ] JPMS exports/opens reviewed.
[ ] Dependency changes reviewed.
[ ] BOM updated.
[ ] Generated code ABI version checked.
[ ] Reflection metadata changes reviewed.
[ ] Changelog written.
[ ] Migration guide written for breaking/behavioral changes.
[ ] Version bump matches compatibility impact.
```

For major releases:

```text
[ ] Breaking changes grouped and justified.
[ ] Migration adapters considered.
[ ] Old API deprecation window honored.
[ ] Downstream owners notified.
[ ] Rollback plan exists.
```

---

## 29. How to Think Like a Top 1% Java API Designer

A top engineer does not design API only for immediate implementation. They design for:

1. **Minimal surface**  
   Only expose what must be stable.

2. **Clear ownership**  
   Every public type has an owner and compatibility promise.

3. **Explicit contracts**  
   Behavior, nullability, mutability, exception, thread-safety, ordering, and persistence semantics are documented.

4. **Evolution path**  
   New requirements can be added without breaking all consumers.

5. **Binary awareness**  
   Source compile is not enough. Runtime linking matters.

6. **Behavioral discipline**  
   Compatible signature can still be incompatible behavior.

7. **Dependency hygiene**  
   Implementation dependencies do not leak into core API accidentally.

8. **Tooling enforcement**  
   Compatibility rules are checked by CI, not memory.

9. **Migration empathy**  
   Consumers need replacement API, examples, and time.

10. **Architectural honesty**  
   If an API is experimental, say it. If internal, enforce it. If stable, support it.

---

## 30. Practical Refactoring Recipes

### 30.1 Rename Method Safely

Goal:

```java
findByLegacyId(String) -> findById(CaseId)
```

Step 1 — Add new method:

```java
public Optional<Case> findById(CaseId id) { ... }
```

Step 2 — Keep old method delegating:

```java
@Deprecated(since = "2.1", forRemoval = false)
public Optional<Case> findByLegacyId(String id) {
    return findById(CaseId.parse(id));
}
```

Step 3 — Add metric/log for old method usage if runtime observable.

Step 4 — Update internal consumers.

Step 5 — Publish migration guide.

Step 6 — Remove only in next major after window.

### 30.2 Replace Constructor with Builder

Step 1:

```java
public final class CaseClient {
    @Deprecated(since = "2.0", forRemoval = false)
    public CaseClient(String baseUrl) {
        this(builder().baseUri(URI.create(baseUrl)));
    }

    private CaseClient(Builder builder) { ... }

    public static Builder builder() { return new Builder(); }
}
```

Step 2 — Migrate docs.

Step 3 — Remove public constructor in major.

### 30.3 Change Enum to Value Object

Old:

```java
public enum CaseType {
    INDIVIDUAL,
    CORPORATE
}
```

New:

```java
public record CaseTypeCode(String value) {
    public CaseTypeCode {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) {
            throw new IllegalArgumentException("value must not be blank");
        }
    }
}
```

Migration:

```java
public enum CaseType {
    INDIVIDUAL("INDIVIDUAL"),
    CORPORATE("CORPORATE");

    private final String code;

    public CaseTypeCode toCode() {
        return new CaseTypeCode(code);
    }
}
```

Do not remove enum immediately.

### 30.4 Evolve SPI with V2 Interface

```java
public interface RuleProvider {
    Stream<RuleDefinition> rules();
}

public interface RuleProviderV2 extends RuleProvider {
    ProviderMetadata metadata();
}
```

Runtime:

```java
ProviderMetadata metadata = provider instanceof RuleProviderV2 v2
        ? v2.metadata()
        : ProviderMetadata.unknown();
```

Later major:

```java
public interface RuleProvider {
    Stream<RuleDefinition> rules();
    ProviderMetadata metadata();
}
```

---

## 31. Mini Case Study: Breaking Change Analysis

### Scenario

Current API:

```java
public interface CaseActionService {
    ActionResult execute(String caseId, String actionCode);
}
```

Problems:

- string id invalid risk,
- action code untyped,
- no actor/audit context,
- no idempotency key,
- no dry-run option,
- hard to extend.

Proposed new API:

```java
public interface CaseActionService {
    ActionResult execute(ExecuteActionCommand command);
}

public record ExecuteActionCommand(
        CaseId caseId,
        ActionCode actionCode,
        Actor actor,
        Optional<IdempotencyKey> idempotencyKey
) { }
```

### Analysis

Breaking risks:

- old method removed: binary breaking,
- record uses `Optional` as component: questionable for DTO/API,
- adding future component to record breaking,
- actor requirement behavioral breaking,
- idempotency changes behavior.

### Better Evolution

```java
public interface CaseActionService {
    /**
     * @deprecated since 2.0, use {@link #execute(ExecuteActionCommand)}.
     */
    @Deprecated(since = "2.0", forRemoval = false)
    default ActionResult execute(String caseId, String actionCode) {
        return execute(ExecuteActionCommand.builder()
                .caseId(CaseId.parse(caseId))
                .actionCode(ActionCode.parse(actionCode))
                .actor(Actor.system("legacy-api"))
                .build());
    }

    ActionResult execute(ExecuteActionCommand command);
}
```

Use class builder instead of public record if evolution expected:

```java
public final class ExecuteActionCommand {
    private final CaseId caseId;
    private final ActionCode actionCode;
    private final Actor actor;
    private final IdempotencyKey idempotencyKey;
    private final boolean dryRun;

    private ExecuteActionCommand(Builder builder) { ... }

    public static Builder builder() { return new Builder(); }

    public Optional<IdempotencyKey> idempotencyKey() {
        return Optional.ofNullable(idempotencyKey);
    }

    public boolean dryRun() {
        return dryRun;
    }
}
```

This allows future fields without changing constructor.

---

## 32. Summary

API evolution is not about avoiding change. It is about making change survivable.

The central distinctions:

- **source compatibility**: can old source recompile?
- **binary compatibility**: can old binaries run without recompilation?
- **behavioral compatibility**: does the meaning still hold?
- **semantic versioning**: does the version number honestly communicate compatibility impact?
- **library design**: did we minimize API surface and provide future extension points?

Java gives strong tools:

- static typing,
- binary compatibility rules,
- interfaces/default methods,
- records,
- sealed types,
- annotations,
- JPMS exports/opens,
- Maven/Gradle dependency management,
- reflection metadata,
- deprecation metadata.

But those tools do not automatically produce stable APIs. Stability comes from discipline:

- define public API explicitly,
- hide internal implementation,
- avoid accidental dependencies,
- design construction carefully,
- document behavior,
- deprecate responsibly,
- test compatibility,
- version honestly,
- provide migration path.

For serious Java systems, API evolution is architecture.

---

## 33. References

- Java Language Specification, Chapter 13: Binary Compatibility  
  https://docs.oracle.com/javase/specs/jls/se21/html/jls-13.html
- Java Language Specification, Java SE 25  
  https://docs.oracle.com/javase/specs/jls/se25/html/index.html
- Java SE 25 API: `java.lang.Deprecated`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Deprecated.html
- Java SE 25 API: Deprecated List  
  https://docs.oracle.com/en/java/javase/25/docs/api/deprecated-list.html
- Semantic Versioning 2.0.0  
  https://semver.org/
- JEP 261: Module System  
  https://openjdk.org/jeps/261
- Java SE 25 API: `java.lang.module`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/module/package-summary.html
- Maven POM Reference  
  https://maven.apache.org/pom.html
- Maven Dependency Mechanism  
  https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html
- Gradle Dependency Management User Guide  
  https://docs.gradle.org/current/userguide/dependency_management.html

---

## 34. Latihan Mandiri

1. Ambil satu public interface dari project nyata. Klasifikasikan setiap method: stable API, SPI, internal accidental exposure, atau legacy compatibility.
2. Simulasikan perubahan method parameter type. Tulis apakah source, binary, dan behavioral compatibility rusak.
3. Ambil satu enum yang dipersist. Tulis migration plan jika salah satu constant harus rename.
4. Ambil satu record public. Evaluasi apakah record component list akan stabil 2 tahun ke depan.
5. Buat deprecation plan untuk satu method lama: since version, replacement, examples, removal window.
6. Buat mini compatibility test: compile consumer terhadap v1 jar, jalankan dengan v2 jar.
7. Buat decision table untuk version bump: patch/minor/major untuk perubahan API di module Anda.
8. Cek apakah public API Anda expose third-party type yang sebenarnya implementation detail.
9. Cek apakah generated code Anda punya ABI/version handshake.
10. Cek apakah module exports/opens Anda benar-benar sesuai public/reflection boundary.

---

## 35. Checklist Part 029

Setelah menyelesaikan part ini, Anda seharusnya mampu:

- membedakan source, binary, behavioral, reflective, generated-code, module, dan dependency compatibility,
- menjelaskan mengapa source compile tidak cukup sebagai bukti aman,
- mengenali perubahan Java API yang breaking,
- mendesain deprecation yang berguna,
- memakai SemVer dengan lebih jujur,
- memilih record/class/interface/enum/sealed type dengan mempertimbangkan evolution,
- mendesain API surface yang minimal dan stabil,
- membuat migration adapter,
- menyusun API review checklist,
- membuat compatibility gate dalam CI,
- memperlakukan public API sebagai aset arsitektur jangka panjang.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-028](./learn-java-oop-functional-reflection-codegen-modules-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-030](./learn-java-oop-functional-reflection-codegen-modules-part-030.md)

</div>
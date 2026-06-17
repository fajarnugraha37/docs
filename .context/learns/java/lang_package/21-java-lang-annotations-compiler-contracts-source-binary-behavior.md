# Part 21 — Annotations in `java.lang`: Compiler Contracts, Source/Binary Behavior, and API Evolution

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `21-java-lang-annotations-compiler-contracts-source-binary-behavior.md`  
> Scope: Java 8–25  
> Packages/classes mainly discussed: `java.lang.Deprecated`, `java.lang.Override`, `java.lang.SuppressWarnings`, `java.lang.SafeVarargs`, `java.lang.FunctionalInterface`

---

## 1. Tujuan Part Ini

Bagian ini membahas annotation bawaan di `java.lang` yang sering terlihat “kecil”, tetapi sebenarnya membentuk kontrak penting antara:

1. source code;
2. compiler;
3. IDE;
4. build tool;
5. static analyzer;
6. API consumer;
7. library maintainer;
8. runtime reflection dalam kasus tertentu.

Kita tidak sedang membahas annotation framework seperti Spring `@Component`, JPA `@Entity`, Jakarta Validation `@NotNull`, atau custom annotation processor. Fokus bagian ini adalah annotation yang berada langsung di `java.lang`:

```java
@Override
@Deprecated
@SuppressWarnings
@SafeVarargs
@FunctionalInterface
```

Kelima annotation ini punya karakter yang berbeda:

| Annotation | Fungsi utama | Target mental model |
|---|---|---|
| `@Override` | Meminta compiler memverifikasi method benar-benar override/implement | correctness contract |
| `@Deprecated` | Menandai API discouraged, obsolete, atau menuju removal | API lifecycle contract |
| `@SuppressWarnings` | Membatasi compiler warning pada scope tertentu | warning hygiene contract |
| `@SafeVarargs` | Assertion bahwa generic varargs body aman | type-safety assertion contract |
| `@FunctionalInterface` | Meminta compiler memverifikasi interface tetap SAM | lambda target contract |

Target akhir bagian ini:

- kamu paham annotation ini bukan dekorasi;
- kamu tahu kapan annotation menjadi bagian dari public API signal;
- kamu bisa membaca warning compiler sebagai design feedback, bukan noise;
- kamu bisa melakukan deprecation secara bertanggung jawab;
- kamu tahu risiko `@SuppressWarnings` dan `@SafeVarargs`;
- kamu bisa menjaga functional interface agar tidak rusak secara source/binary compatibility;
- kamu punya pola review code untuk annotation yang matang.

---

## 2. Mental Model Utama

### 2.1 Annotation sebagai metadata kontraktual

Annotation adalah metadata yang ditempelkan pada elemen program. Namun metadata tidak selalu berarti “runtime reflection”. Banyak annotation bawaan Java justru terutama dimaksudkan untuk compiler.

Perhatikan perbedaan ini:

```java
@Override
public String toString() {
    return "Order{id=" + id + "}";
}
```

`@Override` tidak mengubah runtime behavior. Kalau annotation ini dihapus, bytecode behavior method tetap sama. Tetapi annotation ini mengubah **compile-time verification**: compiler akan menolak jika method tersebut ternyata tidak override method superclass/interface.

Jadi mental modelnya:

```text
Annotation bukan selalu instruksi runtime.
Annotation sering merupakan perjanjian antara programmer dan toolchain.
```

### 2.2 Annotation `java.lang` adalah “language-level guardrail”

Framework annotation biasanya memberi instruksi ke framework:

```java
@Entity
@RestController
@Transactional
```

Annotation `java.lang` memberi sinyal ke compiler/toolchain tentang maksud bahasa:

```java
@Override              // saya bermaksud override
@Deprecated            // API ini tidak lagi disarankan
@SuppressWarnings      // warning ini sengaja diterima di scope ini
@SafeVarargs           // generic varargs ini aman
@FunctionalInterface   // interface ini sengaja menjadi SAM
```

Kalau framework annotation salah, kadang error muncul saat runtime atau wiring. Kalau annotation `java.lang` salah, compiler biasanya bisa membantu lebih cepat.

### 2.3 Warning adalah design signal

Developer rata-rata memperlakukan warning seperti gangguan:

```text
“Build masih hijau, warning nanti saja.”
```

Top-tier engineer memperlakukan warning sebagai sinyal:

```text
“Ada mismatch antara yang kode lakukan, yang compiler bisa buktikan, dan yang API contract janjikan.”
```

Tidak semua warning berarti bug. Tetapi warning yang dibiarkan tanpa disiplin akan menciptakan noise. Kalau warning sudah terlalu banyak, warning penting tidak lagi terlihat.

Prinsip utama:

```text
Warning budget harus mendekati nol.
Kalau warning harus disuppress, suppress secara sempit dan beralasan.
```

---

## 3. Posisi Annotation Ini dalam Java 8–25

### 3.1 Java 8 baseline

Di Java 8, kelima annotation ini sudah tersedia. Java 8 penting karena memperkenalkan lambda dan functional interface sebagai mainstream feature.

Dampaknya:

- `@FunctionalInterface` menjadi penting untuk API berbasis lambda;
- `@SafeVarargs` penting untuk generic utility method;
- `@Deprecated`, `@Override`, dan `@SuppressWarnings` sudah umum dipakai.

### 3.2 Java 9 enhanced deprecation

Java 9 memperkaya `@Deprecated` dengan dua elemen:

```java
@Deprecated(since = "9", forRemoval = true)
```

Sebelum Java 9, deprecation hanya menandai “jangan dipakai”. Setelah Java 9, deprecation bisa membawa informasi lebih tajam:

- sejak kapan deprecated;
- apakah direncanakan untuk dihapus.

Ini sangat penting untuk API governance.

### 3.3 Java 8–25 compatibility lens

Saat kamu menulis library yang harus berjalan di Java 8–25, hal pentingnya:

- `@Deprecated(since = ..., forRemoval = ...)` tidak bisa dipakai kalau source target benar-benar Java 8 karena elemen itu belum ada di Java 8 API;
- `@FunctionalInterface` aman sejak Java 8;
- `@SafeVarargs` sejak Java 7, tetapi rules aplikasinya berkembang;
- warning names yang didukung compiler bisa berbeda antar compiler/tool;
- `@SuppressWarnings` string values tidak semuanya distandardisasi secara ketat oleh Java Language Specification.

Untuk library cross-version, kamu harus sadar bahwa annotation bisa mempengaruhi source compatibility meskipun tidak mengubah business logic.

---

## 4. `@Override`: Correctness Contract untuk Method Dispatch

### 4.1 Apa yang dilakukan `@Override`

`@Override` memberi tahu compiler:

```text
Method ini harus override method superclass atau implement method interface.
Kalau tidak, compile harus gagal.
```

Contoh benar:

```java
class Invoice {
    @Override
    public String toString() {
        return "Invoice{}";
    }
}
```

Contoh bug yang ditangkap compiler:

```java
class Invoice {
    @Override
    public String tostring() { // salah kapitalisasi
        return "Invoice{}";
    }
}
```

Tanpa `@Override`, kode di atas akan compile, tetapi method `tostring()` tidak pernah dipakai oleh mekanisme `toString()` Java.

### 4.2 Override vs overload

Bug umum:

```java
class Base {
    void process(String value) {}
}

class Child extends Base {
    void process(Object value) {} // overload, bukan override
}
```

Kalau niatnya override, ini bug. Dengan `@Override`:

```java
class Child extends Base {
    @Override
    void process(Object value) {} // compile error
}
```

Mental model:

```text
Override ikut dynamic dispatch.
Overload dipilih compile-time berdasarkan static type argument.
```

### 4.3 `@Override` dan interface methods

Di Java modern, `@Override` boleh dipakai untuk method yang mengimplementasikan interface.

```java
interface Handler {
    void handle(String input);
}

class LoggingHandler implements Handler {
    @Override
    public void handle(String input) {
        System.out.println(input);
    }
}
```

Ini sebaiknya selalu dilakukan.

### 4.4 `@Override` dan default methods

Interface default method bisa dioverride:

```java
interface Auditable {
    default String auditLabel() {
        return "generic";
    }
}

class CaseFile implements Auditable {
    @Override
    public String auditLabel() {
        return "case-file";
    }
}
```

Default method membuat interface evolution lebih fleksibel, tetapi juga membuka collision. `@Override` membantu memastikan method yang kamu tulis memang match dengan signature target.

### 4.5 `@Override` dan records

Record menghasilkan beberapa method otomatis seperti `equals`, `hashCode`, `toString`, dan accessor component.

```java
record UserId(String value) {
    @Override
    public String toString() {
        return value;
    }
}
```

Ini valid. Tetapi hati-hati: mengubah generated behavior record bisa mengubah debugging, serialization expectation, dan test equality expectation.

### 4.6 Kapan `@Override` wajib secara engineering discipline

Gunakan `@Override` untuk:

- semua override superclass;
- semua implementasi interface;
- semua override default method;
- `equals`, `hashCode`, `toString`;
- method lifecycle dari framework jika method benar-benar override superclass/interface.

Jangan gunakan untuk method yang hanya kebetulan dinamai sama tetapi tidak override.

### 4.7 Failure modes `@Override`

#### Failure mode 1 — typo method signature

```java
class Entity {
    public boolean equals(Entity other) { // overload, bukan Object.equals
        return true;
    }
}
```

Seharusnya:

```java
class Entity {
    @Override
    public boolean equals(Object other) {
        return other instanceof Entity;
    }
}
```

#### Failure mode 2 — visibility mismatch

```java
class Base {
    protected void validate() {}
}

class Child extends Base {
    @Override
    private void validate() {} // tidak boleh mempersempit visibility
}
```

#### Failure mode 3 — generic erasure confusion

```java
class Base<T> {
    void save(T value) {}
}

class UserRepo extends Base<User> {
    @Override
    void save(User value) {}
}
```

Ini valid, tetapi generic bridge method dapat muncul di bytecode. `@Override` memastikan source-level intent benar.

---

## 5. `@Deprecated`: API Lifecycle Contract

### 5.1 Makna deprecation

`@Deprecated` berarti elemen program tidak lagi disarankan digunakan. Penyebabnya bisa berbeda:

1. API berbahaya;
2. API obsolete;
3. API punya replacement yang lebih baik;
4. API desainnya salah;
5. API akan dihapus;
6. API tidak kompatibel dengan model platform modern;
7. API masih ada untuk backward compatibility.

Jadi jangan menyamakan deprecation dengan removal.

```text
Deprecated = discouraged.
forRemoval = true = removal intention signal.
```

### 5.2 Java 8 style

```java
/**
 * @deprecated use {@link #findById(UserId)} instead.
 */
@Deprecated
public User findById(String id) {
    return findById(new UserId(id));
}
```

Di Java 8, informasi pentingnya biasanya ada di Javadoc `@deprecated` tag.

### 5.3 Java 9+ enhanced deprecation

```java
/**
 * @deprecated since 2.4, use {@link #findById(UserId)} instead.
 */
@Deprecated(since = "2.4", forRemoval = false)
public User findById(String id) {
    return findById(new UserId(id));
}
```

Untuk API yang akan dihapus:

```java
/**
 * @deprecated since 3.0, use {@link #search(SearchCriteria)} instead.
 */
@Deprecated(since = "3.0", forRemoval = true)
public List<User> search(String keyword) {
    return search(SearchCriteria.keyword(keyword));
}
```

### 5.4 Deprecation sebagai migration protocol

Deprecation yang baik bukan sekadar tanda silang di IDE. Ia adalah migration protocol.

Minimal harus menjawab:

1. apa yang salah dengan API lama;
2. sejak kapan deprecated;
3. apakah akan dihapus;
4. replacement-nya apa;
5. apakah replacement behavior identik atau ada perbedaan;
6. bagaimana migrasi caller;
7. apa risiko jika tidak migrasi.

Contoh buruk:

```java
@Deprecated
public void submit() {}
```

Caller tidak tahu harus apa.

Contoh lebih baik:

```java
/**
 * @deprecated since 4.2. This method performs submission without idempotency key.
 * Use {@link #submit(SubmitCommand)} so retries can be deduplicated safely.
 * This method will be removed in 5.0.
 */
@Deprecated(since = "4.2", forRemoval = true)
public SubmissionResult submit() {
    return submit(SubmitCommand.withoutIdempotencyKey());
}
```

### 5.5 Deprecation bukan mekanisme authorization

Jangan pakai deprecation untuk “melarang” penggunaan internal API jika API masih public dan bisa dipanggil.

Buruk:

```java
@Deprecated
public void internalResetState() {}
```

Lebih baik:

- ubah visibility;
- pindahkan ke internal package/module;
- dokumentasikan sebagai unsupported;
- gunakan module export/open boundary;
- gunakan architecture tests.

### 5.6 Deprecation pada class vs method

Deprecating class:

```java
/**
 * @deprecated since 2.0, use {@link NewXmlParser}.
 */
@Deprecated(since = "2.0", forRemoval = true)
public final class LegacyXmlParser {}
```

Deprecating method:

```java
@Deprecated(since = "2.1", forRemoval = false)
public void parse(File file) {}
```

Deprecating constructor:

```java
@Deprecated(since = "3.0", forRemoval = true)
public Client() {}
```

Deprecating field:

```java
@Deprecated(since = "1.8", forRemoval = false)
public static final int OLD_TIMEOUT = 30;
```

Deprecating package/module juga mungkin, tetapi perlu Javadoc dan build/tool support yang benar.

### 5.7 `@Deprecated` dan binary compatibility

Menambahkan `@Deprecated` pada API public biasanya tidak memecahkan binary compatibility. Existing compiled clients masih bisa berjalan.

Tetapi efeknya besar pada:

- source recompilation warnings;
- IDE warnings;
- build pipelines dengan `-Werror`;
- generated docs;
- dependency upgrade planning.

Jadi deprecation adalah perubahan API governance, walaupun bukan breaking binary change.

### 5.8 Kapan `forRemoval = true` layak

Gunakan `forRemoval = true` hanya jika benar-benar ada rencana removal.

Checklist:

- replacement sudah tersedia;
- migration path jelas;
- caller impact diketahui;
- release notes disiapkan;
- telemetry/pencarian usage sudah dilakukan;
- removal version kira-kira jelas;
- compatibility policy mengizinkan.

Jangan pakai `forRemoval = true` untuk menakut-nakuti caller tanpa rencana nyata.

### 5.9 Failure modes `@Deprecated`

#### Failure mode 1 — deprecated tanpa replacement

```java
@Deprecated
public Token login(String username, String password) {}
```

Ini membuat caller bingung.

#### Failure mode 2 — replacement tidak behavior-compatible

```java
/** @deprecated use newSearch */
@Deprecated
List<Result> search(String keyword) {}

List<Result> newSearch(String keyword) {}
```

Kalau `newSearch` case-sensitive sementara `search` case-insensitive, migrasi bisa mengubah behavior diam-diam.

#### Failure mode 3 — deprecation terlalu lama tanpa aksi

API deprecated bertahun-tahun tetapi tidak pernah dihapus atau dimigrasi menciptakan “graveyard API”. Warning menjadi noise.

#### Failure mode 4 — internal API publik dideprecate alih-alih dienkapsulasi

Deprecation tidak menggantikan desain boundary.

---

## 6. `@SuppressWarnings`: Warning Hygiene Contract

### 6.1 Apa yang dilakukan `@SuppressWarnings`

`@SuppressWarnings` memberi tahu compiler untuk menekan warning tertentu pada elemen yang diberi annotation dan elemen-elemen di dalamnya.

Contoh:

```java
@SuppressWarnings("unchecked")
public <T> T cast(Object value) {
    return (T) value;
}
```

Ini tidak membuat cast lebih aman. Ini hanya menyembunyikan warning.

Mental model:

```text
@SuppressWarnings bukan bukti safety.
@SuppressWarnings adalah janji bahwa safety dibuktikan oleh invariant lain yang compiler tidak tahu.
```

### 6.2 Scope matters

Buruk:

```java
@SuppressWarnings("unchecked")
public class LegacyMapper {
    // 1000 lines of code
}
```

Lebih baik:

```java
public final class LegacyMapper {
    public <T> T map(Object source, Class<T> targetType) {
        Object result = doMap(source, targetType);
        return targetType.cast(result);
    }

    @SuppressWarnings("unchecked")
    private static <T> List<T> trustedListCast(Object value) {
        // Safe because caller validates that every element is target-compatible.
        return (List<T>) value;
    }
}
```

Prinsip:

```text
Suppress warning pada scope tersempit yang mungkin.
Tambahkan komentar invariant jika safety tidak obvious.
```

### 6.3 Warning names yang umum

Warning name bergantung compiler, tetapi beberapa umum di `javac`/IDE:

| Warning | Makna umum |
|---|---|
| `unchecked` | operasi generic yang tidak bisa diverifikasi runtime |
| `deprecation` | penggunaan API deprecated |
| `removal` | penggunaan API deprecated for removal |
| `rawtypes` | raw generic type |
| `serial` | serializable class tanpa `serialVersionUID` |
| `fallthrough` | fall-through switch mencurigakan |
| `finally` | finally block tidak normal |
| `try` | try-with-resources warning tertentu |
| `cast` | cast tidak perlu |
| `preview` | penggunaan preview feature |

Tidak semua warning name portable secara sempurna antar compiler/tool.

### 6.4 `unchecked`: warning yang paling sering disalahgunakan

Contoh:

```java
@SuppressWarnings("unchecked")
List<String> names = (List<String>) rawValue;
```

Masalahnya, runtime hanya tahu `List`, bukan `List<String>`. Elemen di dalam list bisa saja `Integer`.

Lebih aman:

```java
static List<String> requireStringList(Object value) {
    if (!(value instanceof List<?> list)) {
        throw new IllegalArgumentException("Expected List");
    }

    List<String> result = new ArrayList<>(list.size());
    for (Object element : list) {
        if (!(element instanceof String s)) {
            throw new IllegalArgumentException("Expected List<String>");
        }
        result.add(s);
    }
    return List.copyOf(result);
}
```

Kalau memang cast tidak bisa dihindari, isolasi di method kecil.

### 6.5 `deprecation`: kapan boleh disuppress

Boleh disuppress jika:

- sedang membuat adapter migration;
- compatibility layer harus tetap memanggil API lama;
- replacement belum tersedia pada target runtime lama;
- testing legacy behavior;
- kamu sengaja menjembatani API lama ke API baru.

Contoh:

```java
@SuppressWarnings("deprecation")
private static LegacyResult callLegacyApi(LegacyClient client) {
    // Intentional: this adapter isolates deprecated API usage until all clients migrate.
    return client.oldExecute();
}
```

Jangan suppress deprecation hanya karena malas migrasi.

### 6.6 `rawtypes`: raw type sebagai compatibility boundary

Kadang raw type muncul saat interop dengan API lama:

```java
@SuppressWarnings({"rawtypes", "unchecked"})
private static Map<String, Object> normalizeRawMap(Map raw) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (Object entryObject : raw.entrySet()) {
        Map.Entry entry = (Map.Entry) entryObject;
        result.put(String.valueOf(entry.getKey()), entry.getValue());
    }
    return result;
}
```

Ini masih tidak ideal. Lebih baik validasi dan salin ke struktur typed.

### 6.7 Suppression harus punya audit trail lokal

Contoh style yang baik:

```java
@SuppressWarnings("unchecked")
private static <T> T getRequired(Map<String, ?> values, String key, Class<T> type) {
    Object value = values.get(key);
    if (!type.isInstance(value)) {
        throw new IllegalArgumentException("Key " + key + " must be " + type.getName());
    }

    // Safe because type.isInstance(value) was checked immediately above.
    return (T) value;
}
```

Tapi sebenarnya bisa lebih baik:

```java
private static <T> T getRequired(Map<String, ?> values, String key, Class<T> type) {
    Object value = values.get(key);
    return type.cast(value);
}
```

Jadi sebelum suppress, tanya:

```text
Apakah ada API yang membuat invariant eksplisit sehingga suppress tidak perlu?
```

### 6.8 Failure modes `@SuppressWarnings`

#### Failure mode 1 — class-level suppression

```java
@SuppressWarnings("unchecked")
public class EverythingIsFine {}
```

Ini menyembunyikan future bug.

#### Failure mode 2 — suppression tanpa invariant

```java
@SuppressWarnings("unchecked")
List<Order> orders = (List<Order>) input;
```

Tidak jelas kenapa aman.

#### Failure mode 3 — suppress warning yang tidak dipahami

Kalau developer tidak tahu arti warning, suppression adalah technical debt.

#### Failure mode 4 — suppress deprecation for removal

```java
@SuppressWarnings("removal")
void useDoomedApi() {}
```

Ini harus sangat jarang dan punya rencana migrasi.

---

## 7. `@SafeVarargs`: Assertion untuk Generic Varargs

### 7.1 Masalah generic varargs

Varargs di Java direpresentasikan sebagai array. Generic di Java menggunakan type erasure. Kombinasi keduanya rawan.

Contoh:

```java
static void process(List<String>... lists) {
    // lists sebenarnya array of List, bukan array of List<String> runtime-safe
}
```

Compiler dapat memberi warning:

```text
Possible heap pollution from parameterized vararg type
```

### 7.2 Apa itu heap pollution

Heap pollution terjadi ketika variable dari parameterized type menunjuk object yang bukan type parameterized yang dijanjikan.

Contoh klasik:

```java
static void unsafe(List<String>... stringLists) {
    Object[] array = stringLists;
    array[0] = List.of(42); // memasukkan List<Integer> ke slot List<String>

    String value = stringLists[0].get(0); // ClassCastException
}
```

Runtime array hanya tahu ini `List[]`. Ia tidak tahu parameter generic `String`.

### 7.3 Makna `@SafeVarargs`

`@SafeVarargs` adalah assertion programmer bahwa method/constructor tidak melakukan operasi tidak aman pada varargs parameter.

Contoh aman:

```java
@SafeVarargs
public static <T> List<T> immutableListOf(T... values) {
    return List.of(values);
}
```

Tetapi “aman” harus dipahami hati-hati. Kalau array varargs disimpan atau diekspos, bisa tidak aman.

### 7.4 Syarat penggunaan

`@SafeVarargs` hanya boleh dipakai pada method/constructor yang tidak bisa dioverride atau pada constructor. Secara umum:

- `static` method;
- `final` method;
- constructor;
- private method pada Java modern.

Kenapa? Karena kalau method bisa dioverride, subclass bisa membuat body tidak aman tetapi tetap mewarisi kontrak safety secara membingungkan.

### 7.5 Contoh safe varargs yang benar

```java
@SafeVarargs
public static <T> List<T> concat(List<? extends T>... lists) {
    List<T> result = new ArrayList<>();
    for (List<? extends T> list : lists) {
        result.addAll(list);
    }
    return List.copyOf(result);
}
```

Kenapa relatif aman?

- tidak menulis ke array `lists`;
- tidak menyimpan array untuk dipakai nanti;
- tidak mengekspos array ke caller lain;
- hanya membaca elemen list sebagai `? extends T`.

### 7.6 Contoh yang tidak aman walaupun diberi `@SafeVarargs`

```java
@SafeVarargs
static <T> T[] cacheAndReturn(T... values) {
    GlobalCache.lastValues = values; // buruk: menyimpan varargs array
    return values;                   // buruk: mengekspos array
}
```

`@SafeVarargs` tidak membuat kode aman. Ia hanya menekan warning berdasarkan assertion developer.

### 7.7 Generic varargs API design alternative

Daripada:

```java
static <T> Result validate(Validator<T>... validators) {}
```

Pertimbangkan:

```java
static <T> Result validate(List<Validator<T>> validators) {}
```

Atau:

```java
static <T> Result validate(Collection<? extends Validator<? super T>> validators) {}
```

Trade-off:

| Bentuk API | Pros | Cons |
|---|---|---|
| varargs | nyaman untuk caller | heap pollution warning, array semantics |
| `List` | type lebih eksplisit | caller perlu membuat list |
| `Collection` | fleksibel | ordering mungkin tidak eksplisit |
| builder | scalable | verbose |

### 7.8 Failure modes `@SafeVarargs`

#### Failure mode 1 — annotation sebagai “warning eraser”

```java
@SafeVarargs
static <T> void unsafe(List<T>... lists) {
    Object[] array = lists;
    array[0] = List.of("wrong");
}
```

#### Failure mode 2 — menyimpan varargs array

```java
private static Object[] cached;

@SafeVarargs
static <T> void remember(T... values) {
    cached = values;
}
```

#### Failure mode 3 — varargs array dimodifikasi

```java
@SafeVarargs
static <T> void mutate(T... values) {
    values[0] = null;
}
```

Tidak selalu type-unsafe, tetapi side effect-nya mengejutkan caller.

#### Failure mode 4 — API public terlalu nyaman tapi tidak defensible

Kalau API akan dipakai banyak tim, pertimbangkan list/collection daripada generic varargs jika safety reasoning sulit dijelaskan.

---

## 8. `@FunctionalInterface`: Lambda Target Contract

### 8.1 Apa itu functional interface

Functional interface adalah interface yang memiliki tepat satu abstract method. Ia bisa menjadi target lambda atau method reference.

Contoh:

```java
@FunctionalInterface
public interface CaseValidator {
    ValidationResult validate(CaseFile file);
}
```

Pemakaian:

```java
CaseValidator validator = file -> ValidationResult.ok();
```

### 8.2 `@FunctionalInterface` bukan syarat lambda

Interface tanpa annotation tetap bisa menjadi functional interface jika memenuhi aturan SAM.

```java
interface Transformer<T, R> {
    R transform(T value);
}

Transformer<String, Integer> length = String::length;
```

Tetapi tanpa annotation, compiler tidak akan menjaga intent saat interface berubah.

### 8.3 Fungsi utama `@FunctionalInterface`

Annotation ini memberi tahu compiler:

```text
Interface ini dimaksudkan tetap functional interface.
Kalau nanti ada abstract method tambahan, compile harus gagal.
```

Contoh bug:

```java
@FunctionalInterface
interface Processor {
    void process(String value);

    void close(); // compile error: bukan functional interface lagi
}
```

### 8.4 Default method tidak merusak SAM

```java
@FunctionalInterface
interface Processor {
    void process(String value);

    default Processor andThen(Processor next) {
        return value -> {
            process(value);
            next.process(value);
        };
    }
}
```

Default method boleh banyak karena bukan abstract method.

### 8.5 Static method tidak merusak SAM

```java
@FunctionalInterface
interface Rule<T> {
    boolean test(T value);

    static <T> Rule<T> alwaysTrue() {
        return value -> true;
    }
}
```

### 8.6 Object methods tidak dihitung sebagai SAM tambahan

Method yang override `Object` tidak membuat functional interface gagal.

```java
@FunctionalInterface
interface NamedTask {
    void run();

    @Override
    String toString(); // tidak dihitung sebagai abstract SAM tambahan dalam cara yang sama
}
```

Tetapi desain seperti ini jarang perlu dan bisa membingungkan.

### 8.7 Functional interface sebagai public API

Saat kamu expose functional interface public, kamu sedang membuat kontrak lambda target.

Contoh:

```java
@FunctionalInterface
public interface RetryPredicate {
    boolean shouldRetry(Throwable failure, int attempt);
}
```

Caller bisa menulis:

```java
RetryPredicate predicate = (failure, attempt) -> attempt < 3;
```

Jika kamu mengubah method signature:

```java
boolean shouldRetry(Throwable failure, int attempt, Duration elapsed);
```

Itu source-breaking untuk lambda caller.

### 8.8 API evolution untuk functional interface

Aman:

```java
@FunctionalInterface
public interface RetryPredicate {
    boolean shouldRetry(Throwable failure, int attempt);

    default RetryPredicate and(RetryPredicate other) {
        Objects.requireNonNull(other);
        return (failure, attempt) ->
                this.shouldRetry(failure, attempt) && other.shouldRetry(failure, attempt);
    }
}
```

Berbahaya:

```java
@FunctionalInterface
public interface RetryPredicate {
    boolean shouldRetry(Throwable failure, int attempt);

    boolean shouldLog(Throwable failure); // breaking
}
```

Kalau butuh capability baru, opsi:

1. tambah default method;
2. buat interface baru;
3. gunakan context object sejak awal;
4. gunakan builder/config object;
5. gunakan sealed hierarchy jika cocok.

### 8.9 Design tip: gunakan context object jika parameter akan berkembang

Kurang future-proof:

```java
@FunctionalInterface
interface AccessDecisionRule {
    boolean allow(User user, Resource resource, Action action);
}
```

Lebih evolvable:

```java
public record AccessDecisionContext(
        User user,
        Resource resource,
        Action action,
        Instant requestTime,
        Map<String, Object> attributes
) {}

@FunctionalInterface
interface AccessDecisionRule {
    boolean allow(AccessDecisionContext context);
}
```

Dengan context object, kamu bisa menambah informasi tanpa mengubah SAM signature secara langsung, meskipun record component addition sendiri juga API evolution yang perlu hati-hati.

### 8.10 Failure modes `@FunctionalInterface`

#### Failure mode 1 — lupa annotation pada API public

Interface awalnya SAM, lalu developer lain menambah abstract method dan merusak lambda caller.

#### Failure mode 2 — terlalu spesifik

```java
@FunctionalInterface
interface Handler {
    void handle(String userId, String caseId, boolean urgent, int retryCount);
}
```

Parameter list panjang membuat lambda tidak readable dan sulit evolusi.

#### Failure mode 3 — checked exception buruk

```java
@FunctionalInterface
interface ThrowingHandler<T> {
    void handle(T value) throws Exception;
}
```

Ini bisa berguna, tetapi sering membuat pipeline sulit dikomposisi.

#### Failure mode 4 — lambda identity assumption

Jangan mengandalkan class name, identity, serialization, atau stable structure dari lambda.

---

## 9. Source, Class, Runtime Retention: Mengapa Tidak Semua Annotation Terlihat Saat Runtime

Annotation punya retention policy. Untuk annotation `java.lang` yang kita bahas, efek utamanya berbeda-beda.

Secara praktis:

| Annotation | Umumnya dipakai oleh | Efek utama |
|---|---|---|
| `@Override` | compiler | compile-time check |
| `@SuppressWarnings` | compiler | compile-time warning suppression |
| `@SafeVarargs` | compiler | warning suppression + assertion |
| `@FunctionalInterface` | compiler | compile-time SAM verification |
| `@Deprecated` | compiler, javadoc, tools, runtime metadata | API lifecycle signal |

`@Deprecated` punya karakter khusus karena metadata deprecation juga bisa tersedia untuk tools dan reflection tergantung retention/metadata class file.

Mental model penting:

```text
Jangan menganggap annotation ada saat runtime hanya karena terlihat di source.
```

Kalau kamu membangun framework yang membaca annotation runtime, kamu biasanya bekerja dengan annotation dari `java.lang.annotation` atau framework-specific annotations, bukan annotation compiler seperti `@Override`.

---

## 10. Warning Hygiene sebagai Engineering Practice

### 10.1 Warning policy yang sehat

Untuk codebase serius:

1. warning baru harus dianggap regression;
2. suppression harus scope kecil;
3. suppression harus punya alasan;
4. deprecation harus punya migration issue;
5. `forRemoval = true` harus punya deadline/rencana;
6. unchecked cast harus dibungkus di boundary kecil;
7. raw type tidak boleh menyebar ke domain layer;
8. generated code boleh punya policy berbeda;
9. legacy adapter boleh punya policy berbeda tapi terisolasi.

### 10.2 Build strategy

Ideal:

```text
main source: warning budget near zero
legacy adapter: isolated suppressions
generated source: separate compiler config
test source: moderate flexibility but still reviewed
```

Contoh Maven/Gradle strategy secara konsep:

- enable compiler warnings;
- fail build untuk warning tertentu pada module baru;
- lakukan migration bertahap untuk module lama;
- dokumentasikan suppression category;
- pakai static analysis untuk forbidden API/deprecated for removal.

### 10.3 Jangan langsung `-Werror` tanpa migration plan

`-Werror` bagus untuk codebase bersih. Tetapi pada codebase legacy besar, langsung mengaktifkan fail-on-warning bisa membuat tim suppress warning secara brutal.

Strategi lebih baik:

1. baseline warning saat ini;
2. cegah warning baru;
3. bersihkan warning per module;
4. naikkan strictness bertahap;
5. isolasi generated/legacy code;
6. jadikan zero-warning sebagai invariant untuk module baru.

---

## 11. API Evolution: Deprecated vs Default Method vs Overload vs New Type

Misal kamu punya API:

```java
public interface CaseRepository {
    CaseFile find(String id);
}
```

Lalu kamu ingin mengganti `String id` menjadi `CaseId`.

### Opsi 1 — overload baru, deprecate lama

```java
public interface CaseRepository {
    /**
     * @deprecated since 2.0, use {@link #find(CaseId)}.
     */
    @Deprecated(since = "2.0", forRemoval = false)
    default CaseFile find(String id) {
        return find(new CaseId(id));
    }

    CaseFile find(CaseId id);
}
```

Pros:

- migration jelas;
- caller lama masih jalan;
- source warning muncul.

Cons:

- interface implementor bisa terdampak;
- default method behavior harus aman;
- ambiguity overload bisa terjadi.

### Opsi 2 — type baru tanpa deprecate dulu

```java
public interface CaseRepositoryV2 {
    CaseFile find(CaseId id);
}
```

Pros:

- boundary bersih;
- tidak merusak interface lama.

Cons:

- duplikasi API;
- migration lebih besar;
- adapter diperlukan.

### Opsi 3 — context object

```java
public record FindCaseQuery(CaseId id, boolean includeArchived) {}

public interface CaseRepository {
    CaseFile find(FindCaseQuery query);
}
```

Pros:

- evolvable untuk parameter tambahan;
- caller lebih self-documenting.

Cons:

- lebih verbose;
- butuh desain query object yang stabil.

### Opsi 4 — deprecate for removal langsung

```java
@Deprecated(since = "2.0", forRemoval = true)
CaseFile find(String id);
```

Gunakan jika:

- API lama benar-benar berbahaya;
- replacement matang;
- caller punya waktu migrasi;
- removal policy jelas.

---

## 12. Interaction dengan Generics dan Type Erasure

Annotation ini sering muncul di wilayah generics karena compiler tahu sebagian type information hilang saat runtime.

### 12.1 Unchecked cast yang defensible

```java
public final class TypedRegistry {
    private final Map<Class<?>, Object> values = new HashMap<>();

    public <T> void put(Class<T> type, T value) {
        values.put(type, type.cast(value));
    }

    public <T> Optional<T> get(Class<T> type) {
        Object value = values.get(type);
        if (value == null) {
            return Optional.empty();
        }
        return Optional.of(type.cast(value));
    }
}
```

Tidak perlu `@SuppressWarnings` karena `Class::cast` membawa runtime check.

### 12.2 Unchecked cast yang terisolasi

Kadang `Class<T>` tidak cukup, misalnya `List<String>` karena erasure.

```java
public final class TypeSafeLists {
    public static <T> List<T> checkedCopy(Object value, Class<T> elementType) {
        if (!(value instanceof List<?> input)) {
            throw new IllegalArgumentException("Expected list");
        }

        List<T> result = new ArrayList<>(input.size());
        for (Object element : input) {
            result.add(elementType.cast(element));
        }
        return List.copyOf(result);
    }
}
```

Ini lebih baik daripada suppress cast `List<T>` langsung.

### 12.3 Generic varargs dengan safe copy

```java
@SafeVarargs
public static <T> Set<T> setOfNonNull(T... values) {
    LinkedHashSet<T> result = new LinkedHashSet<>();
    for (T value : values) {
        result.add(Objects.requireNonNull(value));
    }
    return Set.copyOf(result);
}
```

Invariant:

- hanya membaca varargs;
- tidak menyimpan array;
- hasil immutable copy;
- null ditolak eksplisit.

---

## 13. Interaction dengan Modules dan Encapsulation

Annotation `java.lang` sendiri berada di `java.base`, sehingga selalu tersedia. Tetapi API yang kamu tandai dengan annotation bisa berada dalam module yang punya boundary kuat.

### 13.1 Deprecated exported API

```java
module com.example.caseapi {
    exports com.example.caseapi;
}
```

```java
package com.example.caseapi;

public interface CaseClient {
    @Deprecated(since = "3.1", forRemoval = true)
    CaseFile getCase(String id);
}
```

Karena package diexport, deprecation signal terlihat oleh consumers.

### 13.2 Deprecated internal API tidak cukup

```java
module com.example.caseimpl {
    exports com.example.caseimpl.internal; // buruk
}
```

Lalu:

```java
@Deprecated
public final class InternalCaseMutationEngine {}
```

Kalau package internal diexport, kamu sudah membocorkan boundary. Deprecation hanya menandai masalah, bukan memperbaikinya.

Lebih baik tidak export internal package.

---

## 14. Annotation dan Documentation Quality

### 14.1 `@Deprecated` harus selalu punya Javadoc `@deprecated`

Buruk:

```java
@Deprecated
public void oldMethod() {}
```

Baik:

```java
/**
 * @deprecated since 2.3, use {@link #newMethod(NewRequest)}.
 * The old method does not support idempotency and is unsafe for retry.
 */
@Deprecated(since = "2.3", forRemoval = true)
public void oldMethod() {}
```

### 14.2 Dokumentasi suppression

Tidak perlu komentar untuk suppression yang obvious dan sangat lokal, tetapi untuk unchecked cast/generic boundary, berikan alasan.

```java
@SuppressWarnings("unchecked")
private static <T> Handler<T> handlerFromRegistry(Map<Class<?>, Handler<?>> registry, Class<T> type) {
    // Safe because put() stores Handler<T> under the exact Class<T> key.
    return (Handler<T>) registry.get(type);
}
```

Namun perhatikan: jika invariant hanya ada di komentar, mudah rusak. Lebih baik desain data structure yang menjaga invariant.

---

## 15. Production Patterns

### 15.1 Deprecation adapter pattern

```java
public final class PaymentClient {
    /**
     * @deprecated since 4.0, use {@link #authorize(AuthorizationRequest)}.
     */
    @Deprecated(since = "4.0", forRemoval = true)
    public AuthorizationResult authorize(String accountId, long cents) {
        return authorize(new AuthorizationRequest(new AccountId(accountId), Money.cents(cents)));
    }

    public AuthorizationResult authorize(AuthorizationRequest request) {
        Objects.requireNonNull(request);
        // new implementation
        return AuthorizationResult.approved();
    }
}
```

Pattern:

- method lama menjadi adapter tipis;
- behavior lama dipertahankan sejauh mungkin;
- logic utama pindah ke API baru;
- warning memberi migrasi bertahap.

### 15.2 Narrow unchecked boundary pattern

```java
public final class AttributeBag {
    private final Map<String, Object> values;

    public AttributeBag(Map<String, ?> values) {
        this.values = Map.copyOf(values);
    }

    public <T> Optional<T> get(String key, Class<T> type) {
        Object value = values.get(key);
        if (value == null) {
            return Optional.empty();
        }
        return Optional.of(type.cast(value));
    }
}
```

Tidak perlu unchecked cast. Runtime check eksplisit.

### 15.3 Functional interface with context pattern

```java
public record CaseTransitionContext(
        String caseId,
        String fromState,
        String toState,
        String actorId,
        Instant now
) {}

@FunctionalInterface
public interface CaseTransitionGuard {
    boolean allow(CaseTransitionContext context);

    default CaseTransitionGuard and(CaseTransitionGuard other) {
        Objects.requireNonNull(other);
        return context -> this.allow(context) && other.allow(context);
    }
}
```

Pattern ini bagus untuk workflow/regulatory system karena:

- rule bisa dikomposisi;
- caller lambda jelas;
- context bisa dites;
- logging/audit bisa membawa context.

### 15.4 Safe generic varargs collector

```java
public final class Rules {
    private Rules() {}

    @SafeVarargs
    public static <T> Rule<T> allOf(Rule<? super T>... rules) {
        List<Rule<? super T>> copy = List.of(rules);
        return value -> {
            for (Rule<? super T> rule : copy) {
                if (!rule.test(value)) {
                    return false;
                }
            }
            return true;
        };
    }
}

@FunctionalInterface
interface Rule<T> {
    boolean test(T value);
}
```

Caveat: `List.of(rules)` membuat list dari array content, tetapi pastikan array tidak disimpan langsung dengan niat mutable.

---

## 16. Failure Modelling

### 16.1 Failure category: correctness failure

Contoh:

```java
public boolean equals(User other) {
    return id.equals(other.id);
}
```

Bug:

- bukan override `Object.equals(Object)`;
- collection behavior salah;
- `HashSet`/`HashMap` tidak bekerja sesuai harapan.

Mitigation:

```java
@Override
public boolean equals(Object other) {
    return other instanceof User user && id.equals(user.id);
}
```

### 16.2 Failure category: migration failure

Deprecation buruk:

```java
@Deprecated
void oldSubmit() {}
```

Dampak:

- caller tidak tahu replacement;
- migration tidak jalan;
- warning menjadi noise;
- removal nanti menjadi chaotic.

Mitigation:

- Javadoc jelas;
- `since` jelas;
- `forRemoval` hanya jika benar;
- adapter tersedia;
- release note.

### 16.3 Failure category: type safety failure

Suppression sembrono:

```java
@SuppressWarnings("unchecked")
List<Order> orders = (List<Order>) externalInput;
```

Dampak:

- `ClassCastException` muncul jauh dari boundary;
- error sulit dilacak;
- data corruption bisa terjadi sebelum crash.

Mitigation:

- validate element;
- copy into typed structure;
- isolate cast;
- prefer `Class::cast`.

### 16.4 Failure category: lambda API evolution failure

Awal:

```java
@FunctionalInterface
interface Rule {
    boolean test(Request request);
}
```

Kemudian:

```java
interface Rule {
    boolean test(Request request);
    String reason();
}
```

Dampak:

- lambda caller tidak compile;
- source compatibility rusak;
- consumer upgrade mahal.

Mitigation:

```java
@FunctionalInterface
interface Rule {
    boolean test(Request request);

    default String reason() {
        return "unspecified";
    }
}
```

Atau buat interface baru.

### 16.5 Failure category: unsafe varargs

```java
@SafeVarargs
static <T> T[] expose(T... values) {
    return values;
}
```

Dampak:

- caller bisa memodifikasi array;
- heap pollution possible;
- invariant hilang.

Mitigation:

```java
@SafeVarargs
static <T> List<T> copyOf(T... values) {
    return List.copyOf(Arrays.asList(values));
}
```

---

## 17. Review Checklist untuk Code Review

Saat melihat `@Override`:

- Apakah semua override punya annotation?
- Apakah `equals/hashCode/toString` benar-benar override?
- Apakah method interface implementation diberi annotation?
- Apakah ada overload yang sebenarnya dimaksud override?

Saat melihat `@Deprecated`:

- Apakah ada Javadoc `@deprecated`?
- Apakah ada replacement?
- Apakah `since` benar?
- Apakah `forRemoval` dipakai dengan disiplin?
- Apakah migration behavior kompatibel?
- Apakah deprecation ini harusnya diganti encapsulation?

Saat melihat `@SuppressWarnings`:

- Scope sudah tersempit?
- Warning name spesifik?
- Ada invariant/comment jika tidak obvious?
- Bisa dihindari dengan API yang lebih type-safe?
- Apakah suppression menyembunyikan warning future?

Saat melihat `@SafeVarargs`:

- Method memenuhi syarat tidak bisa dioverride?
- Body tidak menulis ke varargs array?
- Body tidak menyimpan array?
- Body tidak mengekspos array?
- Apakah collection parameter lebih baik?

Saat melihat `@FunctionalInterface`:

- Apakah interface memang public lambda contract?
- Apakah SAM signature future-proof?
- Apakah tambahan behavior bisa default method?
- Apakah checked exception tepat?
- Apakah context object lebih baik daripada parameter panjang?

---

## 18. Java 8–25 Practical Guidance

### 18.1 Jika target source Java 8

- Gunakan `@Deprecated` tanpa `since/forRemoval`.
- Jelaskan since/removal di Javadoc.
- Gunakan `@FunctionalInterface` untuk semua public SAM.
- Gunakan `@Override` secara konsisten.
- Gunakan `@SafeVarargs` hanya jika benar-benar aman.
- Hindari suppression luas.

Contoh Java 8-compatible:

```java
/**
 * @deprecated since 2.0, use {@link #find(CaseId)}. Planned for removal in 3.0.
 */
@Deprecated
public CaseFile find(String id) {
    return find(new CaseId(id));
}
```

### 18.2 Jika target source Java 9+

Gunakan enhanced deprecation:

```java
/**
 * @deprecated since 2.0, use {@link #find(CaseId)}.
 */
@Deprecated(since = "2.0", forRemoval = true)
public CaseFile find(String id) {
    return find(new CaseId(id));
}
```

### 18.3 Jika target library multi-release

Jika kamu punya source berbeda untuk Java 8 dan Java 9+, hati-hati agar annotation tidak membuat API metadata membingungkan.

Prinsip:

- public API signal harus konsisten;
- jangan membuat Java 9+ variant memberi deprecation berbeda tanpa alasan;
- dokumentasi release harus menjelaskan behavior;
- compile dengan `--release` sesuai target.

---

## 19. Latihan / Thought Exercise

### Latihan 1 — Fix override bug

Kode:

```java
final class User {
    private final String id;

    User(String id) {
        this.id = id;
    }

    public boolean equals(User other) {
        return other != null && id.equals(other.id);
    }

    public int hashcode() {
        return id.hashCode();
    }
}
```

Tugas:

- perbaiki agar benar untuk `HashSet<User>`;
- tambahkan annotation yang tepat;
- jelaskan bug yang sebelumnya terjadi.

### Latihan 2 — Design deprecation

API lama:

```java
public interface NotificationSender {
    void send(String recipient, String subject, String body);
}
```

Kebutuhan baru:

- harus ada idempotency key;
- harus ada correlation id;
- harus support priority;
- API lama masih dipakai 20 module.

Tugas:

- desain API baru;
- deprecate API lama;
- buat migration note;
- tentukan apakah `forRemoval = true` layak.

### Latihan 3 — Remove unsafe suppression

Kode:

```java
@SuppressWarnings("unchecked")
static Map<String, Integer> parse(Object input) {
    return (Map<String, Integer>) input;
}
```

Tugas:

- rewrite supaya melakukan runtime validation;
- hindari unchecked cast jika mungkin;
- tentukan error message yang operasional.

### Latihan 4 — Evaluate `@SafeVarargs`

Kode:

```java
@SafeVarargs
static <T> T[] chooseFirst(T... values) {
    return values;
}
```

Tugas:

- jelaskan apakah annotation ini defensible;
- desain alternatif yang lebih aman.

### Latihan 5 — Functional interface evolution

Kode:

```java
@FunctionalInterface
interface EscalationRule {
    boolean shouldEscalate(CaseFile file);
}
```

Kebutuhan baru:

- rule perlu tahu actor;
- rule perlu tahu current time;
- rule perlu mengembalikan reason.

Tugas:

- desain evolusi API tanpa menghancurkan semua lambda caller sekaligus;
- bedakan solusi short-term dan long-term.

---

## 20. Ringkasan

Annotation di `java.lang` bukan dekorasi kecil. Mereka adalah kontrak penting antara developer dan toolchain.

Inti yang harus diingat:

1. `@Override` adalah correctness guardrail. Pakai hampir selalu untuk override/implement method.
2. `@Deprecated` adalah API lifecycle signal. Deprecation yang baik harus memberi migration path.
3. `@SuppressWarnings` adalah pisau tajam. Scope harus sempit dan invariant harus jelas.
4. `@SafeVarargs` adalah assertion safety, bukan magic. Jangan gunakan jika body menyimpan, mengekspos, atau memutasi varargs array secara berbahaya.
5. `@FunctionalInterface` menjaga interface tetap lambda-compatible. Public SAM adalah kontrak API yang harus dievolusi hati-hati.
6. Warning bukan noise. Warning adalah feedback dari compiler/toolchain tentang mismatch antara intent dan bukti static.
7. Untuk Java 8–25, perhatikan enhanced deprecation Java 9+ dan compatibility saat menggunakan `since/forRemoval`.

Mental model paling penting:

```text
Annotation java.lang adalah cara kita membuat maksud programmer eksplisit,
agar compiler dan tools bisa menjaga kontrak yang manusia sering lewatkan.
```

---

## 21. Production Checklist

Gunakan checklist ini untuk codebase serius:

- [ ] Semua override method diberi `@Override`.
- [ ] Semua public functional interface diberi `@FunctionalInterface`.
- [ ] Semua deprecation punya Javadoc `@deprecated` dengan replacement.
- [ ] `@Deprecated(since = ..., forRemoval = ...)` digunakan jika target source mendukung Java 9+.
- [ ] `forRemoval = true` hanya digunakan jika ada rencana removal nyata.
- [ ] Tidak ada class-level `@SuppressWarnings` tanpa alasan kuat.
- [ ] `unchecked` suppression diisolasi di method kecil.
- [ ] Setiap suppression non-obvious punya komentar invariant.
- [ ] Generic varargs public API dievaluasi apakah lebih baik diganti `List`/`Collection`.
- [ ] `@SafeVarargs` hanya dipakai jika body benar-benar aman.
- [ ] Warning compiler dimonitor sebagai quality signal.
- [ ] Legacy/generated code punya warning policy terpisah dari business code baru.
- [ ] Deprecated API usage dimonitor dan dimigrasikan, bukan disuppress massal.

---

## 22. Koneksi ke Part Berikutnya

Bagian ini membahas annotation yang berfungsi sebagai compiler contract. Part berikutnya akan masuk ke lambda runtime support dan boundary `java.lang.invoke`.

Koneksi konseptualnya:

```text
@FunctionalInterface
    ↓
SAM conversion
    ↓
lambda expression
    ↓
invokedynamic
    ↓
LambdaMetafactory / method handles
```

Jadi setelah memahami `@FunctionalInterface` sebagai source-level contract, kita akan melihat bagaimana lambda sebenarnya direalisasikan di runtime dan kenapa lambda bukan sekadar anonymous inner class modern.


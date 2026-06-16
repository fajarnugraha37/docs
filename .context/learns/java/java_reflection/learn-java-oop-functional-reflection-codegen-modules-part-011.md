# learn-java-oop-functional-reflection-codegen-modules-part-011

# Generics for API Designers: Variance, Bounds, Erasure, and Type Tokens

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `011`  
> Fokus: generics sebagai alat desain API, bukan sekadar syntax `List<T>`.

---

## 0. Tujuan Part Ini

Generics adalah salah satu fitur Java yang paling sering dipakai tetapi paling sering dipahami secara parsial.

Sebagian developer berhenti pada pemahaman:

```java
List<String> names = new ArrayList<>();
```

Itu benar, tetapi belum cukup untuk desain sistem besar.

Pada level engineer senior/top-tier, generics harus dipahami sebagai mekanisme untuk:

1. membuat API lebih type-safe;
2. mengurangi casting eksplisit;
3. mengekspresikan constraint antar type;
4. mendesain collection/registry/factory/pipeline yang fleksibel;
5. menjaga binary compatibility;
6. memahami batas runtime akibat type erasure;
7. menghindari heap pollution dan raw type leak;
8. mendesain extension point yang kuat tanpa over-abstraction.

Part ini tidak membahas generics sebagai fitur pemula. Kita akan membahas generics sebagai **type-level design tool**.

---

## 1. Mental Model Utama

Generics di Java adalah **compile-time type abstraction** yang sebagian besar informasinya dihapus saat runtime melalui **type erasure**.

Artinya:

```java
List<String> a = new ArrayList<>();
List<Integer> b = new ArrayList<>();
```

Secara compile-time, `a` dan `b` berbeda.

Tetapi pada runtime, keduanya sama-sama object `ArrayList`.

```java
System.out.println(a.getClass() == b.getClass()); // true
```

Mental model yang benar:

```text
Source code:
  List<String>
  List<Integer>
  Repository<OrderId, Order>

Compiler:
  type checking
  inference
  casts insertion
  bridge method generation

Bytecode/runtime:
  mostly raw erased types
  metadata partially retained in signatures
  actual generic arguments not generally available from object instance
```

Jadi generics bukan runtime specialization seperti template C++.

Generics di Java lebih dekat ke:

```text
compile-time safety layer over ordinary runtime classes
```

---

## 2. Kenapa Java Memakai Type Erasure?

Java generics ditambahkan belakangan setelah Java sudah punya ecosystem besar yang memakai raw collections seperti:

```java
List list = new ArrayList();
list.add("abc");
Object value = list.get(0);
```

Agar kode lama tetap kompatibel, Java generics didesain dengan erasure.

Konsekuensinya:

1. tidak ada class runtime berbeda untuk `List<String>` dan `List<Integer>`;
2. generic type argument tidak selalu tersedia di runtime;
3. tidak bisa `new T()` langsung;
4. tidak bisa `new List<String>[10]` secara aman;
5. tidak bisa `instanceof List<String>`;
6. compiler perlu menyisipkan cast;
7. compiler kadang membuat bridge method untuk menjaga polymorphism.

Keuntungannya:

1. backward compatibility;
2. tidak ada runtime overhead besar untuk membuat specialized class per type argument;
3. generic library lama dan baru bisa coexist;
4. JVM tidak perlu memahami generic specialization secara penuh.

Kerugiannya:

1. runtime generic introspection terbatas;
2. raw type masih mungkin bocor;
3. heap pollution bisa terjadi;
4. API designer harus sangat hati-hati pada boundary reflection, serialization, DI, ORM, dan code generation.

---

## 3. Parameterized Type

Generic class:

```java
public final class Box<T> {
    private final T value;

    public Box(T value) {
        this.value = value;
    }

    public T value() {
        return value;
    }
}
```

Pemakaian:

```java
Box<String> name = new Box<>("Fajar");
String value = name.value();
```

`Box<T>` adalah generic type declaration.

`Box<String>` adalah parameterized type.

`T` adalah type parameter.

`String` adalah type argument.

```text
Generic declaration:
  Box<T>

Parameterized type:
  Box<String>

Type parameter:
  T

Type argument:
  String
```

Kesalahan umum:

```text
Menganggap T adalah variable runtime.
```

Padahal `T` adalah construct compile-time, bukan object runtime.

---

## 4. Generic Class vs Generic Method

Generic class:

```java
public final class Repository<ID, E> {
    public E findById(ID id) {
        throw new UnsupportedOperationException();
    }
}
```

Generic method:

```java
public static <T> T requireNonNull(T value, String message) {
    if (value == null) {
        throw new IllegalArgumentException(message);
    }
    return value;
}
```

Perbedaan desain:

```text
Generic class:
  type parameter adalah bagian dari identity/configuration object tersebut.

Generic method:
  type parameter hanya dibutuhkan untuk satu operasi.
```

Contoh salah desain:

```java
public final class JsonParser<T> {
    public T parse(String json) {
        throw new UnsupportedOperationException();
    }
}
```

Masalahnya: karena type erasure, `JsonParser<T>` tidak tahu `T` di runtime kecuali `Class<T>` atau type token disediakan.

Desain yang lebih jujur:

```java
public final class JsonParser {
    public <T> T parse(String json, Class<T> type) {
        throw new UnsupportedOperationException();
    }
}
```

Atau untuk generic nested type:

```java
public final class JsonParser {
    public <T> T parse(String json, TypeRef<T> type) {
        throw new UnsupportedOperationException();
    }
}
```

Rule:

```text
Jangan jadikan class generic kalau type parameter hanya dibutuhkan oleh satu method.
```

---

## 5. Invariance: `List<String>` Bukan `List<Object>`

Ini salah satu bagian paling penting.

Walaupun:

```java
String extends Object
```

bukan berarti:

```java
List<String> extends List<Object>
```

Contoh kenapa tidak boleh:

```java
List<String> strings = new ArrayList<>();

// Jika ini legal:
// List<Object> objects = strings;

// Maka ini juga legal:
// objects.add(123);

// Lalu strings berisi Integer, padahal harus String.
```

Karena itu generic type Java bersifat **invariant** secara default.

```text
String <: Object
bukan berarti
List<String> <: List<Object>
```

Mental model:

```text
Generic container yang bisa read dan write tidak aman dibuat covariant secara default.
```

---

## 6. Wildcard: Mengizinkan Fleksibilitas Tanpa Mengorbankan Safety

Wildcard dipakai ketika API tidak butuh type exact, tetapi butuh range type tertentu.

Ada tiga bentuk umum:

```java
List<?>              // unknown type
List<? extends T>    // unknown subtype of T
List<? super T>      // unknown supertype of T
```

Wildcard bukan “any type secara bebas”.

Wildcard berarti:

```text
Ada satu type tertentu, tetapi kita tidak tahu namanya.
```

Contoh:

```java
List<?> values = List.of("a", "b", "c");
Object first = values.get(0);

// values.add("x"); // compile error
```

Kenapa tidak bisa add?

Karena `List<?>` bisa saja sebenarnya `List<Integer>`, `List<Order>`, atau `List<UUID>`.

Yang aman hanya membaca sebagai `Object`.

---

## 7. Upper Bound: `? extends T`

Contoh:

```java
public static double sum(Collection<? extends Number> numbers) {
    double total = 0;
    for (Number number : numbers) {
        total += number.doubleValue();
    }
    return total;
}
```

Bisa menerima:

```java
List<Integer> integers = List.of(1, 2, 3);
List<Double> doubles = List.of(1.5, 2.5);

sum(integers);
sum(doubles);
```

`? extends Number` artinya:

```text
Collection of some unknown subtype of Number.
```

Aman untuk membaca sebagai `Number`.

Tidak aman untuk menulis arbitrary `Number` ke dalamnya.

```java
void broken(Collection<? extends Number> numbers) {
    // numbers.add(1);       // compile error
    // numbers.add(1.5);     // compile error
    numbers.add(null);       // technically allowed, but usually useless/bad style
}
```

Kenapa?

Karena collection itu mungkin `Collection<Integer>`. Menambahkan `Double` akan merusak safety.

Mental model:

```text
? extends T = producer of T
```

---

## 8. Lower Bound: `? super T`

Contoh:

```java
public static void addDefaults(Collection<? super Integer> target) {
    target.add(1);
    target.add(2);
    target.add(3);
}
```

Bisa menerima:

```java
Collection<Integer> integers = new ArrayList<>();
Collection<Number> numbers = new ArrayList<>();
Collection<Object> objects = new ArrayList<>();

addDefaults(integers);
addDefaults(numbers);
addDefaults(objects);
```

`? super Integer` artinya:

```text
Collection of some unknown supertype of Integer.
```

Aman untuk menulis `Integer`.

Tetapi saat membaca, hanya aman sebagai `Object`.

```java
void read(Collection<? super Integer> values) {
    Object value = values.iterator().next();
    // Integer x = values.iterator().next(); // compile error
}
```

Mental model:

```text
? super T = consumer of T
```

---

## 9. PECS: Producer Extends, Consumer Super

Aturan terkenal:

```text
PECS = Producer Extends, Consumer Super
```

Jika parameter menghasilkan `T` untuk kita baca:

```java
void copyFrom(Collection<? extends Order> source)
```

Jika parameter menerima `T` untuk kita tulis:

```java
void copyTo(Collection<? super Order> target)
```

Jika parameter dibaca dan ditulis sebagai exact type:

```java
void mutate(List<Order> orders)
```

Contoh lengkap:

```java
public static <T> void copy(
        Collection<? extends T> source,
        Collection<? super T> target
) {
    for (T item : source) {
        target.add(item);
    }
}
```

Pemakaian:

```java
List<Integer> integers = List.of(1, 2, 3);
List<Number> numbers = new ArrayList<>();

copy(integers, numbers);
```

Kenapa ini bagus?

Karena source cukup menjadi producer, target cukup menjadi consumer.

API tidak memaksa exact same type yang tidak perlu.

---

## 10. Wildcard vs Type Parameter

Kadang orang bingung kapan pakai `?`, kapan pakai `<T>`.

Gunakan wildcard ketika type tidak perlu diberi nama dan tidak perlu menghubungkan beberapa posisi.

```java
public int sizeOf(Collection<?> values) {
    return values.size();
}
```

Gunakan type parameter ketika type yang sama harus menghubungkan input-output atau beberapa parameter.

```java
public static <T> T first(List<T> values) {
    return values.get(0);
}
```

Contoh lain:

```java
public static <T> void move(Collection<? extends T> source,
                            Collection<? super T> target) {
    for (T item : source) {
        target.add(item);
    }
}
```

Rule:

```text
Jika type hanya muncul satu kali dalam signature, wildcard sering lebih tepat.
Jika type perlu menghubungkan beberapa posisi, gunakan type parameter.
```

Buruk:

```java
public static <T> int size(Collection<T> values) {
    return values.size();
}
```

Lebih sederhana:

```java
public static int size(Collection<?> values) {
    return values.size();
}
```

---

## 11. Bounded Type Parameter

Generic type parameter bisa diberi bound.

```java
public final class NumberBox<T extends Number> {
    private final T value;

    public NumberBox(T value) {
        this.value = value;
    }

    public double asDouble() {
        return value.doubleValue();
    }
}
```

Bound memberi compiler informasi bahwa `T` minimal adalah `Number`.

Tanpa bound:

```java
class Box<T> {
    double asDouble(T value) {
        // return value.doubleValue(); // compile error
        return 0;
    }
}
```

Dengan bound:

```java
class Box<T extends Number> {
    double asDouble(T value) {
        return value.doubleValue();
    }
}
```

---

## 12. Multiple Bounds

Java mendukung multiple bounds:

```java
public static <T extends AutoCloseable & Runnable> void runAndClose(T resource) throws Exception {
    try {
        resource.run();
    } finally {
        resource.close();
    }
}
```

Jika ada class bound, class harus pertama:

```java
<T extends SomeClass & SomeInterface>
```

Bukan:

```java
// <T extends SomeInterface & SomeClass> // invalid jika SomeClass adalah class
```

Mental model:

```text
Multiple bounds = T harus memenuhi semua capability tersebut.
```

Gunakan multiple bounds dengan hati-hati. Terlalu banyak bound sering menandakan API terlalu sempit atau abstraction belum tepat.

---

## 13. F-Bounded Polymorphism

F-bounded polymorphism adalah pola ketika type parameter dibatasi oleh type yang memakai dirinya sendiri.

Contoh klasik:

```java
public interface Comparable<T> {
    int compareTo(T other);
}
```

Contoh fluent builder:

```java
public abstract class SelfTypedBuilder<B extends SelfTypedBuilder<B>> {
    private String name;

    public B name(String name) {
        this.name = name;
        return self();
    }

    protected abstract B self();
}

public final class UserBuilder extends SelfTypedBuilder<UserBuilder> {
    private String email;

    public UserBuilder email(String email) {
        this.email = email;
        return this;
    }

    @Override
    protected UserBuilder self() {
        return this;
    }
}
```

Pemakaian:

```java
new UserBuilder()
        .name("Fajar")
        .email("fajar@example.com");
```

Tanpa self type, fluent method pada superclass bisa mengembalikan superclass type dan memutus chain method subclass.

Namun, F-bound punya biaya kompleksitas tinggi.

Gunakan hanya jika:

1. fluent API lintas inheritance benar-benar dibutuhkan;
2. public API akan sering dipakai;
3. alternatif composition/step builder lebih buruk;
4. team mampu memahami signature-nya.

Jangan gunakan hanya agar terlihat advanced.

---

## 14. Recursive Generic Bound dan Comparable

Contoh yang sering muncul:

```java
public static <T extends Comparable<T>> T max(Collection<T> values) {
    T max = null;
    for (T value : values) {
        if (max == null || value.compareTo(max) > 0) {
            max = value;
        }
    }
    return max;
}
```

Tetapi signature ini kadang terlalu sempit.

Yang lebih fleksibel:

```java
public static <T extends Comparable<? super T>> T max(Collection<? extends T> values) {
    T max = null;
    for (T value : values) {
        if (max == null || value.compareTo(max) > 0) {
            max = value;
        }
    }
    return max;
}
```

Kenapa `Comparable<? super T>`?

Karena sebuah class bisa comparable terhadap supertype-nya.

Mental model:

```text
Kalau object T akan dibandingkan, comparer boleh menerima T atau supertype dari T.
```

Ini contoh API design yang tampak rumit tetapi punya alasan substitutability.

---

## 15. Generic Factory Problem: Kenapa Tidak Bisa `new T()`?

Ini tidak bisa:

```java
public final class Factory<T> {
    public T create() {
        // return new T(); // compile error
        return null;
    }
}
```

Kenapa?

Karena `T` hilang akibat erasure, dan compiler tidak tahu constructor apa yang tersedia.

Solusi 1: `Supplier<T>`

```java
public final class Factory<T> {
    private final Supplier<T> supplier;

    public Factory(Supplier<T> supplier) {
        this.supplier = supplier;
    }

    public T create() {
        return supplier.get();
    }
}
```

Pemakaian:

```java
Factory<ArrayList<String>> factory = new Factory<>(ArrayList::new);
ArrayList<String> list = factory.create();
```

Solusi 2: `Class<T>`

```java
public final class ReflectiveFactory<T> {
    private final Class<T> type;

    public ReflectiveFactory(Class<T> type) {
        this.type = type;
    }

    public T create() {
        try {
            return type.getDeclaredConstructor().newInstance();
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot instantiate " + type.getName(), e);
        }
    }
}
```

Kelemahannya:

1. butuh no-arg constructor;
2. reflection lebih rentan gagal di runtime;
3. JPMS bisa membatasi access;
4. error baru muncul saat runtime.

Untuk API bersih, `Supplier<T>` sering lebih baik daripada reflection.

---

## 16. Generic Array Problem

Ini tidak boleh:

```java
// List<String>[] lists = new List<String>[10]; // compile error
```

Kenapa?

Array di Java bersifat reified dan covariant.

Generics bersifat erased dan invariant.

Kombinasi generic array bisa merusak type safety.

Contoh mental:

```java
List<String>[] stringLists = null;
Object[] objects = stringLists;
objects[0] = List.of(123); // secara array mungkin lolos jika runtime hanya lihat List[]
String s = stringLists[0].get(0); // boom
```

Karena itu Java membatasi generic array creation.

Gunakan `List<List<String>>` daripada `List<String>[]`.

Jika benar-benar butuh array internal, isolasi unsafe cast dan jangan bocorkan keluar.

---

## 17. Reifiable vs Non-Reifiable Types

Reifiable type adalah type yang informasi runtime-nya tersedia penuh.

Contoh reifiable:

```java
String
int
String[]
List<?> 
Raw List
```

Non-reifiable:

```java
List<String>
Map<String, Integer>
T
List<T>
```

Karena `List<String>` dan `List<Integer>` sama-sama menjadi `List` pada runtime.

Konsekuensi:

```java
if (value instanceof List<String>) { // invalid
}
```

Yang bisa:

```java
if (value instanceof List<?>) {
    List<?> list = (List<?>) value;
}
```

Tetapi isi list tetap harus dicek manual jika boundary tidak trusted.

---

## 18. Heap Pollution

Heap pollution terjadi ketika variable parameterized type mereferensikan object yang bukan type parameterized yang sesuai.

Contoh raw type:

```java
List<String> names = new ArrayList<>();
List raw = names;
raw.add(123);

String first = names.get(0); // ClassCastException
```

Compile warning biasanya muncul:

```text
unchecked call
unchecked conversion
raw type warning
```

Jangan abaikan warning generics.

Di production, unchecked warning sering berarti:

1. boundary legacy;
2. reflection boundary;
3. serialization boundary;
4. raw collection leak;
5. unsafe framework integration;
6. type token tidak cukup lengkap.

Rule:

```text
Setiap unchecked warning harus dihapus atau diisolasi di satu tempat kecil dengan komentar invariant.
```

Buruk:

```java
@SuppressWarnings("unchecked")
public class BigService {
    // entire class suppressed
}
```

Lebih baik:

```java
public final class TypeSafeRegistry {
    private final Map<Key<?>, Object> values = new HashMap<>();

    public <T> void put(Key<T> key, T value) {
        values.put(key, value);
    }

    public <T> Optional<T> get(Key<T> key) {
        Object value = values.get(key);
        if (value == null) {
            return Optional.empty();
        }
        return Optional.of(key.cast(value));
    }
}
```

Suppression diisolasi di `Key.cast`, bukan menyebar ke seluruh aplikasi.

---

## 19. Raw Types: Legacy Compatibility, Bukan Gaya Coding

Raw type:

```java
List list = new ArrayList();
```

Parameterized:

```java
List<String> list = new ArrayList<>();
```

Raw type masih ada untuk compatibility dengan kode pre-generics.

Jangan pakai raw type di kode modern kecuali:

1. berhadapan dengan legacy API;
2. bridging reflection/class literal case tertentu;
3. mengisolasi compatibility layer;
4. menulis framework-level code dengan alasan jelas.

Bahkan untuk unknown type, gunakan wildcard:

```java
List<?> values
```

bukan:

```java
List values
```

Perbedaannya besar:

```java
void raw(List values) {
    values.add(123); // allowed with warning
}

void safe(List<?> values) {
    // values.add(123); // compile error
}
```

Wildcard menjaga safety. Raw type melepas safety.

---

## 20. Type Inference

Java bisa menebak type argument dari context.

```java
Map<String, List<Integer>> map = new HashMap<>();
```

Diamond operator:

```java
new HashMap<>()
```

Generic method inference:

```java
List<String> names = List.of("a", "b");
```

Compiler menebak `T = String`.

Kadang inference gagal atau menghasilkan type terlalu umum.

Contoh:

```java
var list = List.of();
```

`list` menjadi `List<Object>`.

Lebih jelas:

```java
List<String> list = List.of();
```

Atau:

```java
var list = List.<String>of();
```

Rule:

```text
Biarkan inference membantu, tetapi jangan sampai type intent hilang dari API boundary.
```

Gunakan explicit type pada boundary penting:

```java
Map<CustomerId, CustomerProfile> profiles = loadProfiles();
```

Lebih informatif daripada:

```java
var profiles = loadProfiles();
```

terutama ketika method name tidak cukup eksplisit.

---

## 21. `var` dan Generics

`var` tidak membuat Java menjadi dynamically typed.

```java
var names = new ArrayList<String>();
```

Compiler tetap menetapkan static type.

Masalah muncul ketika initializer tidak membawa type intent cukup.

```java
var names = new ArrayList<>();
```

Sering terinfer sebagai:

```java
ArrayList<Object>
```

Lalu:

```java
names.add("a");
names.add(1);
```

Mungkin compile, tetapi desainnya buruk karena intent hilang.

Lebih baik:

```java
var names = new ArrayList<String>();
```

Atau:

```java
List<String> names = new ArrayList<>();
```

Rule praktis:

```text
Gunakan var kalau initializer sudah sangat jelas.
Jangan gunakan var jika generic type intent adalah bagian penting dari pembacaan kode.
```

---

## 22. Generic Type Metadata di Reflection

Walaupun type argument erased dari object runtime, sebagian metadata generic masih tersedia di class/method/field signature.

Contoh:

```java
public final class UserRepository implements Repository<UserId, User> {
}
```

Reflection dapat membaca generic interface declaration:

```java
Type[] interfaces = UserRepository.class.getGenericInterfaces();
```

Untuk field:

```java
public final class Holder {
    private List<String> names;
}
```

Reflection bisa membaca:

```java
Field field = Holder.class.getDeclaredField("names");
Type type = field.getGenericType();
```

Tetapi untuk object instance:

```java
List<String> names = new ArrayList<>();
```

Runtime object `names` tidak membawa `String` sebagai actual element type.

Mental model:

```text
Generic metadata dapat tersedia pada declarations.
Generic metadata tidak otomatis tersedia pada every object instance.
```

Framework seperti JSON mapper biasanya membaca generic type dari:

1. field declaration;
2. method return type;
3. subclass signature;
4. explicit type token.

---

## 23. Type Token Pattern

Karena `Class<T>` tidak cukup untuk type generic nested:

```java
Class<List<String>> // tidak bisa ditulis normal
```

Kita butuh type token.

Pattern umum:

```java
public abstract class TypeRef<T> {
    private final Type type;

    protected TypeRef() {
        Type superClass = getClass().getGenericSuperclass();
        if (!(superClass instanceof ParameterizedType parameterizedType)) {
            throw new IllegalStateException("Missing type parameter");
        }
        this.type = parameterizedType.getActualTypeArguments()[0];
    }

    public final Type type() {
        return type;
    }
}
```

Pemakaian:

```java
TypeRef<List<String>> type = new TypeRef<>() {};
```

Anonymous subclass menyimpan generic superclass signature yang bisa dibaca reflection.

Ini digunakan oleh banyak library dengan variasi nama seperti:

```text
TypeReference
TypeToken
ParameterizedTypeReference
```

Kapan butuh type token?

1. parsing JSON ke `List<OrderDto>`;
2. deserializing nested generic type;
3. registry by generic type;
4. generic HTTP client response body;
5. framework metadata binding.

Kapan `Class<T>` cukup?

```java
parse(json, User.class)
```

untuk non-parameterized type.

---

## 24. Typesafe Heterogeneous Container

Kadang kita ingin map yang key-nya membawa type.

Contoh sederhana:

```java
public final class TypedKey<T> {
    private final String name;
    private final Class<T> type;

    private TypedKey(String name, Class<T> type) {
        this.name = Objects.requireNonNull(name);
        this.type = Objects.requireNonNull(type);
    }

    public static <T> TypedKey<T> of(String name, Class<T> type) {
        return new TypedKey<>(name, type);
    }

    public T cast(Object value) {
        return type.cast(value);
    }
}
```

Registry:

```java
public final class TypedContext {
    private final Map<TypedKey<?>, Object> values = new HashMap<>();

    public <T> void put(TypedKey<T> key, T value) {
        values.put(key, value);
    }

    public <T> Optional<T> get(TypedKey<T> key) {
        Object value = values.get(key);
        if (value == null) {
            return Optional.empty();
        }
        return Optional.of(key.cast(value));
    }
}
```

Usage:

```java
TypedKey<String> USERNAME = TypedKey.of("username", String.class);
TypedKey<Integer> RETRY_COUNT = TypedKey.of("retryCount", Integer.class);

TypedContext context = new TypedContext();
context.put(USERNAME, "fajar");
context.put(RETRY_COUNT, 3);

String username = context.get(USERNAME).orElseThrow();
```

Ini contoh generics sebagai API design tool.

Map internal menyimpan `Object`, tetapi API publik tetap type-safe.

---

## 25. Generic Repository: Contoh yang Sering Over-Abstraction

Banyak enterprise code membuat:

```java
public interface Repository<ID, E> {
    E findById(ID id);
    void save(E entity);
    void deleteById(ID id);
}
```

Ini tidak selalu salah.

Tapi sering menjadi salah ketika semua domain dipaksa mengikuti CRUD generik.

Masalah:

1. tidak semua aggregate punya lifecycle sama;
2. tidak semua save valid secara domain;
3. query berbeda-beda;
4. delete bisa ilegal untuk domain tertentu;
5. generic abstraction menutupi invariant;
6. service layer menjadi procedural CRUD wrapper.

Lebih baik untuk domain penting:

```java
public interface CaseRepository {
    Optional<Case> findById(CaseId id);
    void submit(Case submittedCase);
    void markEscalated(CaseId id, EscalationReason reason);
}
```

Generics cocok untuk infrastructure-level abstraction.

Untuk domain API, jangan menghapus semantic domain hanya demi reusable generic interface.

Rule:

```text
Generic abstraction boleh mengurangi duplikasi mekanis.
Generic abstraction tidak boleh menghapus makna domain.
```

---

## 26. Generic Builder: Useful, Tapi Mudah Berlebihan

Generic builder bisa membantu ketika type state perlu dikontrol.

Contoh step builder:

```java
public final class HttpRequestBuilder {
    public interface MethodStep {
        UrlStep method(String method);
    }

    public interface UrlStep {
        OptionalStep url(URI uri);
    }

    public interface OptionalStep {
        OptionalStep header(String name, String value);
        HttpRequest build();
    }

    public static MethodStep builder() {
        return new Steps();
    }

    private static final class Steps implements MethodStep, UrlStep, OptionalStep {
        private String method;
        private URI uri;
        private final Map<String, String> headers = new LinkedHashMap<>();

        @Override
        public UrlStep method(String method) {
            this.method = method;
            return this;
        }

        @Override
        public OptionalStep url(URI uri) {
            this.uri = uri;
            return this;
        }

        @Override
        public OptionalStep header(String name, String value) {
            headers.put(name, value);
            return this;
        }

        @Override
        public HttpRequest build() {
            return new HttpRequest(method, uri, Map.copyOf(headers));
        }
    }
}
```

Ini bukan generic secara type parameter, tetapi contoh type-driven API.

Generic builder yang terlalu kompleks bisa membuat API sulit dibaca.

Prinsip:

```text
Gunakan type system untuk mencegah kesalahan penting, bukan untuk menunjukkan semua kemungkinan secara teoretis.
```

---

## 27. Phantom Types: State di Type Level

Phantom type adalah type parameter yang tidak dipakai sebagai field langsung, tetapi merepresentasikan state/phase.

Contoh:

```java
interface Draft {}
interface Submitted {}

public final class CaseForm<S> {
    private final String title;

    private CaseForm(String title) {
        this.title = title;
    }

    public static CaseForm<Draft> draft(String title) {
        return new CaseForm<>(title);
    }

    public CaseForm<Submitted> submit() {
        return new CaseForm<>(title);
    }
}
```

Method hanya menerima submitted:

```java
public void route(CaseForm<Submitted> form) {
    // only submitted form can be routed
}
```

Usage:

```java
CaseForm<Draft> draft = CaseForm.draft("Appeal case");
CaseForm<Submitted> submitted = draft.submit();

route(submitted);
// route(draft); // compile error
```

Kapan cocok?

1. state transition kecil tapi penting;
2. compile-time safety lebih bernilai daripada kompleksitas;
3. API internal/library digunakan luas;
4. state illegal harus dicegah sebelum runtime.

Kapan tidak cocok?

1. state banyak dan berubah dinamis;
2. object disimpan/dimuat dari database;
3. framework serialization tidak nyaman;
4. team tidak familiar;
5. runtime state tetap perlu diverifikasi.

Phantom type adalah alat tajam, bukan default design.

---

## 28. Generics dan Exceptions

Java tidak mengizinkan generic class extend `Throwable`.

Ini tidak valid:

```java
// public class Problem<T> extends Exception {}
```

Alasannya berkaitan dengan runtime exception matching dan erasure.

Namun generic method dengan thrown type bisa ada dalam pattern tertentu.

Contoh advanced:

```java
@SuppressWarnings("unchecked")
public static <E extends Throwable> void sneakyThrow(Throwable t) throws E {
    throw (E) t;
}
```

Ini biasanya dipakai library internal tertentu, tetapi sangat tidak dianjurkan untuk business code karena merusak keterbacaan error channel.

Rule:

```text
Jangan gunakan generics untuk menyembunyikan exception contract.
```

Lebih baik modelkan error secara eksplisit dengan sealed result atau exception hierarchy yang jelas.

---

## 29. Generics dan Overloading

Erasure membuat beberapa overload tidak bisa coexist.

Tidak valid:

```java
public void process(List<String> values) {}
public void process(List<Integer> values) {}
```

Keduanya erase ke:

```java
process(List values)
```

Solusi:

```java
public void processStrings(List<String> values) {}
public void processIntegers(List<Integer> values) {}
```

Atau tambahkan type token:

```java
public <T> void process(List<T> values, Class<T> type) {}
```

Atau gunakan domain wrapper:

```java
record Usernames(List<String> values) {}
record RetryCounts(List<Integer> values) {}

public void process(Usernames usernames) {}
public void process(RetryCounts retryCounts) {}
```

Domain wrapper sering lebih jelas daripada generic overload hack.

---

## 30. Bridge Methods

Type erasure bisa membuat compiler perlu menghasilkan bridge method.

Contoh:

```java
class Node<T> {
    public void setData(T data) {}
}

class MyNode extends Node<Integer> {
    @Override
    public void setData(Integer data) {}
}
```

Setelah erasure, `Node<T>.setData(T)` menjadi kira-kira:

```java
setData(Object data)
```

Tetapi `MyNode` punya:

```java
setData(Integer data)
```

Agar polymorphism tetap bekerja, compiler bisa membuat synthetic bridge method:

```java
public void setData(Object data) {
    setData((Integer) data);
}
```

Konsekuensi untuk engineer:

1. reflection bisa melihat method synthetic/bridge;
2. stack trace kadang memunculkan bridge method;
3. bytecode tools harus handle bridge method;
4. framework method scanner harus filter dengan benar;
5. API compatibility bisa terpengaruh oleh generic signature changes.

---

## 31. Generic Signature dan Binary Compatibility

Generics sebagian besar compile-time, tetapi signature generic tetap penting untuk source compatibility dan tool/framework.

Perubahan ini tampak kecil:

```java
List<Order> findOrders();
```

menjadi:

```java
Collection<Order> findOrders();
```

Dari perspektif source consumer, mungkin cukup fleksibel.

Tapi binary compatibility dan override contract perlu dianalisis.

Perubahan ini lebih berbahaya:

```java
List<Order> findOrders();
```

menjadi:

```java
List<? extends Order> findOrders();
```

Bisa memengaruhi caller yang melakukan mutation.

Perubahan bound juga berbahaya:

```java
class Registry<T>
```

menjadi:

```java
class Registry<T extends Named>
```

Source consumer lama mungkin tidak compile.

Rule public API:

```text
Generic signature adalah bagian dari API contract.
Jangan ubah tanpa compatibility review.
```

---

## 32. Generics dan Public API Design

Checklist signature:

### 32.1 Jangan terlalu konkret

Buruk:

```java
void process(ArrayList<Order> orders)
```

Lebih baik:

```java
void process(List<Order> orders)
```

Atau jika hanya iterasi:

```java
void process(Iterable<? extends Order> orders)
```

### 32.2 Jangan terlalu abstrak tanpa alasan

Buruk:

```java
void process(Object value)
```

Atau:

```java
<T> void process(T value)
```

Jika hanya butuh `Order`, tulis `Order`.

```java
void process(Order order)
```

### 32.3 Gunakan wildcard di input, hindari wildcard di return jika membingungkan

Input fleksibel:

```java
void addAll(Collection<? extends Order> orders)
```

Return sebaiknya jelas:

```java
List<Order> findOrders()
```

Daripada:

```java
List<? extends Order> findOrders()
```

Return wildcard sering menyulitkan caller.

### 32.4 Jangan expose mutable generic internal

Buruk:

```java
public List<Order> orders() {
    return orders;
}
```

Lebih aman:

```java
public List<Order> orders() {
    return List.copyOf(orders);
}
```

Atau jaga internal immutable.

---

## 33. Generics dan Domain Modeling

Generics bagus untuk pola yang benar-benar generic.

Contoh masuk akal:

```java
public record Page<T>(
        List<T> items,
        int page,
        int size,
        long total
) {}
```

Karena paging memang generic terhadap item type.

Contoh lain:

```java
public record Result<T, E>(T value, E error) {}
```

Tetapi hati-hati: generic result terlalu longgar jika error domain butuh struktur.

Lebih domain-specific:

```java
sealed interface SubmissionResult permits SubmissionAccepted, SubmissionRejected {}
```

Generics bisa memperjelas domain jika type parameter mewakili variasi mekanis.

Generics bisa mengaburkan domain jika type parameter menggantikan konsep yang seharusnya dinamai.

Rule:

```text
Jika type parameter punya makna domain penting, pertimbangkan named type.
```

---

## 34. Generics dan Code Generation

Code generator sering memakai generics untuk menghasilkan API type-safe.

Contoh:

```java
public final class Column<T> {
    private final String name;
    private final Class<T> javaType;
}
```

Generated metamodel:

```java
public final class UserTable {
    public static final Column<UserId> ID = Column.of("id", UserId.class);
    public static final Column<String> NAME = Column.of("name", String.class);
    public static final Column<Instant> CREATED_AT = Column.of("created_at", Instant.class);
}
```

Query API:

```java
where(UserTable.NAME.eq("Fajar"));
// where(UserTable.CREATED_AT.eq("wrong")); // compile error
```

Ini contoh kuat generics + code generation.

Namun generator harus menjaga:

1. generic signature stable;
2. no raw type leaks;
3. generated warnings minimal;
4. generated code readable enough for debugging;
5. binary/source compatibility antar versi schema.

---

## 35. Generics dan Reflection Boundary

Reflection tidak otomatis menghormati generic safety.

Contoh:

```java
Field field = Holder.class.getDeclaredField("names");
field.setAccessible(true);
field.set(holder, List.of(1, 2, 3));
```

Jika `names` adalah `List<String>`, reflection bisa melanggar invariant jika access dibuka.

Framework yang melakukan binding harus:

1. membaca generic declaration;
2. resolve type variable terhadap context class;
3. validate element type;
4. handle nested parameterized type;
5. handle wildcard;
6. handle raw type;
7. fail fast dengan error jelas.

Generics memberi compiler safety. Reflection bisa melewati compiler safety.

Rule:

```text
Setiap reflective write ke generic field adalah trust boundary.
```

---

## 36. Generics dan Serialization/Deserialization

Masalah umum:

```java
List<OrderDto> orders = jsonParser.parse(json, List.class);
```

Runtime hanya tahu `List`, tidak tahu `OrderDto`.

Akibatnya parser bisa menghasilkan:

```text
List<Map<String, Object>>
```

bukan `List<OrderDto>`.

Lebih benar:

```java
List<OrderDto> orders = jsonParser.parse(json, new TypeRef<List<OrderDto>>() {});
```

Atau API library-specific equivalent.

Untuk response generic:

```java
record ApiResponse<T>(T data, String status) {}
```

Parsing butuh type penuh:

```java
TypeRef<ApiResponse<List<OrderDto>>> type = new TypeRef<>() {};
```

Kalau hanya pakai `ApiResponse.class`, type `T` hilang.

Rule:

```text
Generic DTO di boundary serialization harus membawa Type, bukan hanya Class.
```

---

## 37. Generics dan Dependency Injection

DI container sering resolve bean by type.

Contoh:

```java
interface Handler<T> {
    void handle(T command);
}

final class SubmitCaseHandler implements Handler<SubmitCaseCommand> {
    public void handle(SubmitCaseCommand command) {}
}
```

Framework bisa membaca `Handler<SubmitCaseCommand>` dari generic superclass/interface metadata.

Tetapi jika type hilang karena raw type atau proxy, resolution bisa gagal.

Risiko:

1. multiple beans with erased same raw type;
2. proxy class tidak membawa generic signature yang sama;
3. bridge method scanning salah;
4. reflection under JPMS dibatasi;
5. generic metadata tidak tersedia pada lambda/anonymous form tertentu.

Untuk framework-heavy systems, generic type harus diuji di runtime integration test, bukan diasumsikan.

---

## 38. Variance di Java vs Bahasa Lain

Java memakai use-site variance:

```java
List<? extends Number>
List<? super Integer>
```

Beberapa bahasa lain memakai declaration-site variance:

```text
Producer<out T>
Consumer<in T>
```

Karena Java memakai use-site variance, API designer harus menentukan variance di method signature.

Contoh:

```java
void publishAll(Collection<? extends Event> events)
```

Bukan memaksa caller punya:

```java
Collection<Event>
```

Kekuatan Java:

```text
variance bisa ditentukan per use case
```

Kelemahannya:

```text
signature bisa menjadi verbose dan membingungkan
```

---

## 39. Common Anti-Patterns

### 39.1 Generic Everything

Buruk:

```java
public <A, B, C, D> D process(A a, B b, C c) {
    return null;
}
```

Ini bukan type-safety. Ini kehilangan model.

### 39.2 Type Parameter Tidak Dipakai Bermakna

Buruk:

```java
public final class Service<T> {
    public void execute() {}
}
```

Jika `T` tidak memengaruhi field, method, atau contract, mungkin tidak perlu.

### 39.3 Return Wildcard Berlebihan

Buruk:

```java
List<? extends Order> findOrders();
```

Caller susah memakai hasilnya.

### 39.4 Raw Type Suppression Global

Buruk:

```java
@SuppressWarnings({"rawtypes", "unchecked"})
public class LegacyAdapter {
    // 1000 lines
}
```

### 39.5 Generic Domain yang Menghapus Bahasa Bisnis

Buruk:

```java
Workflow<State, Actor, Action, Context, Output>
```

Jika semua hal menjadi generic, domain reader kehilangan makna.

### 39.6 Type Token Dilupakan di Boundary

Buruk:

```java
parse(json, ApiResponse.class)
```

untuk `ApiResponse<List<OrderDto>>`.

### 39.7 `Class<T>` Dipakai Untuk Semua Hal

`Class<T>` tidak cukup untuk nested generic type.

---

## 40. Design Heuristics

Gunakan generics ketika:

1. logic benar-benar independent dari concrete type;
2. type relationship penting untuk safety;
3. API akan dipakai luas;
4. compiler bisa mencegah bug penting;
5. generic signature masih bisa dipahami;
6. generic abstraction tidak menghilangkan semantic domain.

Hindari generics ketika:

1. hanya satu concrete type dipakai;
2. type parameter tidak memengaruhi contract;
3. signature menjadi lebih sulit daripada problem-nya;
4. runtime tetap butuh banyak `instanceof`;
5. domain concept menjadi kabur;
6. reflection/serialization boundary menjadi rapuh.

---

## 41. Practical API Decision Matrix

| Need | Preferred Design |
|---|---|
| Method membaca collection dari subtype | `Collection<? extends T>` |
| Method menulis item ke collection | `Collection<? super T>` |
| Method membaca dan menulis exact type | `Collection<T>` |
| Type muncul sekali dan tidak perlu nama | wildcard |
| Type menghubungkan input dan output | `<T>` type parameter |
| Runtime butuh concrete non-generic class | `Class<T>` |
| Runtime butuh nested generic type | `TypeRef<T>` / type token |
| Generic factory | `Supplier<T>` lebih dulu, reflection belakangan |
| Domain finite alternatives | sealed hierarchy/enum, bukan generics |
| Infrastructure reusable container | generics cocok |
| Public API return | hindari wildcard jika menyulitkan caller |
| Legacy raw API | isolate adapter + local suppression |

---

## 42. Worked Example: Type-Safe Command Bus

Kita desain command bus sederhana.

Command:

```java
public interface Command<R> {
}
```

Concrete command:

```java
public record SubmitCaseCommand(String title) implements Command<SubmitCaseResult> {
}

public record SubmitCaseResult(String caseId) {
}
```

Handler:

```java
public interface CommandHandler<C extends Command<R>, R> {
    R handle(C command);
}
```

Registry key:

```java
public final class CommandType<C extends Command<R>, R> {
    private final Class<C> commandClass;

    private CommandType(Class<C> commandClass) {
        this.commandClass = Objects.requireNonNull(commandClass);
    }

    public static <C extends Command<R>, R> CommandType<C, R> of(Class<C> commandClass) {
        return new CommandType<>(commandClass);
    }

    public Class<C> commandClass() {
        return commandClass;
    }
}
```

Command bus:

```java
public final class CommandBus {
    private final Map<Class<?>, CommandHandler<?, ?>> handlers = new HashMap<>();

    public <C extends Command<R>, R> void register(
            CommandType<C, R> type,
            CommandHandler<C, R> handler
    ) {
        handlers.put(type.commandClass(), handler);
    }

    public <C extends Command<R>, R> R execute(CommandType<C, R> type, C command) {
        CommandHandler<?, ?> rawHandler = handlers.get(type.commandClass());
        if (rawHandler == null) {
            throw new IllegalStateException("No handler for " + type.commandClass().getName());
        }
        @SuppressWarnings("unchecked")
        CommandHandler<C, R> handler = (CommandHandler<C, R>) rawHandler;
        return handler.handle(command);
    }
}
```

Usage:

```java
CommandType<SubmitCaseCommand, SubmitCaseResult> SUBMIT_CASE =
        CommandType.of(SubmitCaseCommand.class);

CommandBus bus = new CommandBus();

bus.register(SUBMIT_CASE, command -> new SubmitCaseResult("CASE-001"));

SubmitCaseResult result = bus.execute(SUBMIT_CASE, new SubmitCaseCommand("Appeal"));
```

Apa yang terjadi?

Internal map tetap erased:

```java
Map<Class<?>, CommandHandler<?, ?>>
```

Tetapi public API menjaga hubungan:

```text
CommandType<C, R>
CommandHandler<C, R>
execute(...): R
```

Unchecked cast tetap ada, tetapi diisolasi di satu tempat.

Itulah pola framework-level generics yang sehat.

Catatan penting:

Command bus seperti ini cocok sebagai contoh type-level API. Dalam production, tetap perlu pertimbangkan transaction, idempotency, observability, authorization, error model, dan lifecycle. Itu di luar scope part ini.

---

## 43. Worked Example: Safer Event Router dengan Variance

Event base:

```java
public interface Event {
    Instant occurredAt();
}

public record CaseSubmitted(String caseId, Instant occurredAt) implements Event {
}
```

Subscriber:

```java
public interface Subscriber<E extends Event> {
    void on(E event);
}
```

Router:

```java
public final class EventRouter {
    private final Map<Class<?>, List<Subscriber<?>>> subscribers = new HashMap<>();

    public <E extends Event> void subscribe(Class<E> eventType, Subscriber<? super E> subscriber) {
        subscribers.computeIfAbsent(eventType, ignored -> new ArrayList<>()).add(subscriber);
    }

    public <E extends Event> void publish(Class<E> eventType, E event) {
        List<Subscriber<?>> handlers = subscribers.getOrDefault(eventType, List.of());
        for (Subscriber<?> raw : handlers) {
            @SuppressWarnings("unchecked")
            Subscriber<? super E> subscriber = (Subscriber<? super E>) raw;
            subscriber.on(event);
        }
    }
}
```

Kenapa subscriber `? super E`?

Karena subscriber yang bisa menerima `Event` juga bisa menerima `CaseSubmitted`.

```java
Subscriber<Event> auditSubscriber = event -> System.out.println(event.occurredAt());

router.subscribe(CaseSubmitted.class, auditSubscriber);
```

Ini contoh “consumer super”.

Unchecked cast tetap ada di implementation, tetapi API publik aman.

---

## 44. Testing Generic API

Untuk generic API serius, test bukan hanya behavior happy path.

Test juga:

1. compile-time usage examples;
2. wildcard flexibility;
3. raw type boundary isolation;
4. reflection metadata availability;
5. serialization/deserialization type preservation;
6. proxy/framework integration;
7. binary compatibility if public library;
8. generated code warning-free compilation.

Compile-time tests bisa dilakukan dengan:

1. sample module;
2. test fixtures;
3. annotation processor compile testing;
4. build that treats warnings as errors;
5. API compatibility checker.

Generics bug sering muncul bukan saat unit test biasa, tetapi saat API digunakan oleh caller berbeda.

---

## 45. Code Review Checklist

Gunakan checklist ini saat melihat generic code.

### 45.1 Type Parameter

- Apakah type parameter benar-benar diperlukan?
- Apakah namanya jelas?
- Apakah bound terlalu sempit?
- Apakah bound terlalu longgar?
- Apakah type parameter menghubungkan input-output secara bermakna?

### 45.2 Wildcard

- Apakah input producer memakai `extends`?
- Apakah input consumer memakai `super`?
- Apakah wildcard return menyulitkan caller?
- Apakah wildcard bisa diganti named type parameter agar relasi lebih jelas?

### 45.3 Erasure

- Apakah runtime membutuhkan type yang hilang?
- Apakah perlu `Class<T>`?
- Apakah perlu `TypeRef<T>`?
- Apakah ada `instanceof List<String>` attempt?
- Apakah overload conflict karena erasure?

### 45.4 Safety

- Apakah ada raw type?
- Apakah ada unchecked warning?
- Apakah suppression lokal dan dijelaskan?
- Apakah heap pollution mungkin terjadi?
- Apakah generic array creation dihindari?

### 45.5 API Design

- Apakah generic abstraction menghapus domain meaning?
- Apakah public API terlalu kompleks?
- Apakah caller mendapat benefit nyata?
- Apakah signature stable untuk evolusi jangka panjang?
- Apakah framework/reflection boundary diuji?

---

## 46. Key Takeaways

Generics di Java adalah alat compile-time untuk mengekspresikan hubungan type.

Hal terpenting:

1. generic type Java invariant secara default;
2. wildcard memberi fleksibilitas use-site;
3. `? extends T` cocok untuk producer;
4. `? super T` cocok untuk consumer;
5. type erasure membatasi runtime type information;
6. `Class<T>` cukup untuk simple class, tidak cukup untuk nested generic type;
7. `TypeRef<T>`/type token diperlukan untuk banyak serialization/reflection boundary;
8. raw type adalah legacy escape hatch, bukan gaya modern;
9. unchecked warning harus diisolasi;
10. generic signature adalah API contract;
11. generics bagus untuk infrastructure abstraction;
12. generics bisa buruk jika menghapus bahasa domain;
13. API generic yang bagus sering menyembunyikan unsafe implementation kecil di balik public API yang type-safe.

Mental model final:

```text
Generics adalah cara membuat compiler menjaga hubungan antar type.
Tetapi runtime Java tetap berjalan di atas erased ordinary classes.

Top engineer tidak hanya tahu syntax generics.
Top engineer tahu kapan type system harus dipakai,
kapan harus berhenti,
dan di mana boundary runtime harus dibuat eksplisit.
```

---

## 47. Latihan

### Latihan 1

Ubah signature berikut agar lebih fleksibel:

```java
void process(List<Order> orders)
```

Jika method hanya membaca order.

Jawaban yang diharapkan:

```java
void process(List<? extends Order> orders)
```

Atau lebih umum:

```java
void process(Iterable<? extends Order> orders)
```

### Latihan 2

Desain method `copy` yang bisa copy dari `List<Integer>` ke `List<Number>`.

Jawaban:

```java
public static <T> void copy(List<? extends T> source, List<? super T> target) {
    for (T item : source) {
        target.add(item);
    }
}
```

### Latihan 3

Jelaskan kenapa ini tidak valid:

```java
if (value instanceof List<String>) {
}
```

Jawaban:

Karena `List<String>` adalah non-reifiable type. Type argument `String` hilang akibat erasure, sehingga runtime tidak bisa membedakan `List<String>` dari `List<Integer>`.

### Latihan 4

Perbaiki API ini:

```java
public final class Parser<T> {
    public T parse(String text) {
        return null;
    }
}
```

Kemungkinan jawaban:

```java
public final class Parser {
    public <T> T parse(String text, Class<T> type) {
        return null;
    }

    public <T> T parse(String text, TypeRef<T> type) {
        return null;
    }
}
```

### Latihan 5

Cari unchecked warning di codebase Anda. Klasifikasikan:

1. legacy boundary;
2. reflection boundary;
3. serialization boundary;
4. framework integration;
5. bad generic design.

Lalu isolasi suppression ke method terkecil.

---

## 48. Penutup

Part ini adalah jembatan dari object model menuju polymorphism dan functional API design yang lebih kuat.

Generics akan muncul lagi di bagian reflection, annotation processing, code generation, modules, dan API evolution. Karena itu, bagian ini harus dipahami bukan sebagai fitur lokal, tetapi sebagai fondasi desain API Java modern.

Pada part berikutnya kita akan masuk ke polymorphism lanjutan: overloading, overriding, dispatch, bridge methods, double dispatch, visitor, dan pattern matching.

---

**Status seri:** belum selesai.  
**Part berikutnya:** `learn-java-oop-functional-reflection-codegen-modules-part-012.md` — Advanced Polymorphism: Overloading, Overriding, Dispatch, and Pattern Matching.

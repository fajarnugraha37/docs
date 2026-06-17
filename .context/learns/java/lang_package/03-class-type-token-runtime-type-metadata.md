# Part 3 — `Class<T>` and Runtime Type Tokens

Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
File: `03-class-type-token-runtime-type-metadata.md`  
Target Java: 8–25

---

## 1. Tujuan Part Ini

Bagian ini membahas `java.lang.Class<T>` sebagai salah satu kontrak paling penting dalam Java runtime.

Banyak developer mengenal `Class` hanya dari hal-hal seperti:

```java
String.class
obj.getClass()
Class.forName("com.example.Foo")
```

Tetapi untuk engineer level tinggi, `Class<T>` bukan sekadar API reflection. `Class<T>` adalah **runtime type token**: object runtime yang merepresentasikan tipe Java yang sudah dikenali JVM.

`Class<T>` dipakai di balik banyak sistem serius:

- dependency injection container;
- serializer/deserializer;
- JSON/XML mapper;
- plugin system;
- JDBC driver loading;
- annotation scanner;
- object mapper;
- validation framework;
- ORM;
- test framework;
- application server;
- classpath/module-path scanner;
- dynamic proxy;
- AOP;
- command registry;
- event handler registry;
- generic factory;
- runtime diagnostics;
- compatibility layer Java 8–25.

Tujuan part ini adalah membuat kamu memahami:

1. apa sebenarnya `Class<T>`;
2. kapan `Class<T>` dibuat;
3. apa perbedaan type, class, object, class file, dan `Class` object;
4. bagaimana primitive, array, enum, record, annotation, interface, sealed type direpresentasikan;
5. bagaimana class loading memengaruhi identitas tipe;
6. kenapa generic type hilang di runtime;
7. bagaimana membuat API yang menerima type token dengan aman;
8. bagaimana menghindari jebakan `Class.forName`, initialization side effect, classloader leak, dan `isAssignableFrom` yang terbalik;
9. bagaimana `Class<T>` berubah dari Java 8 sampai Java 25.

---

## 2. Mental Model Utama

### 2.1 `Class<T>` adalah object runtime yang mewakili tipe

Saat Java program berjalan, JVM tidak hanya memiliki object seperti:

```java
String s = "hello";
```

JVM juga memiliki metadata tentang tipe `String` itu sendiri. Metadata runtime itu diekspos ke program melalui object `Class`:

```java
Class<String> type = String.class;
```

`String.class` bukan source code. Bukan file `.class`. Bukan object `String`. Itu adalah **object metadata** yang merepresentasikan tipe `java.lang.String` yang sudah dimuat oleh JVM.

Mental model sederhana:

```text
Source code       -> String.java
Compiled bytecode -> String.class file
Loaded type       -> java.lang.String known by JVM
Runtime token     -> Class<String> object
Instance          -> new String(...), "hello"
```

Jadi:

```java
String.class != "hello"
```

`String.class` mewakili tipe.  
`"hello"` adalah instance dari tipe itu.

---

### 2.2 Satu tipe yang dimuat biasanya punya satu `Class` object per defining class loader

Dalam satu class loader tertentu, satu binary name seperti `com.example.User` biasanya direpresentasikan oleh satu `Class<?>` object.

Tetapi ini penting:

> Identitas runtime sebuah class bukan hanya nama class. Identitasnya adalah kombinasi antara **binary name** dan **defining class loader**.

Dua class dengan nama sama bisa dianggap berbeda jika dimuat oleh class loader berbeda.

```text
Class identity = binary name + defining class loader
```

Contoh konseptual:

```text
loaderA loads com.example.Plugin
loaderB loads com.example.Plugin

com.example.Plugin from loaderA != com.example.Plugin from loaderB
```

Ini bisa menyebabkan error yang membingungkan:

```text
java.lang.ClassCastException: com.example.Plugin cannot be cast to com.example.Plugin
```

Pesannya terlihat absurd, tetapi benar. Nama sama, loader berbeda, tipe runtime berbeda.

---

### 2.3 `Class<T>` adalah type token, bukan generic type lengkap

`Class<T>` bisa merepresentasikan raw runtime class:

```java
Class<String> stringType = String.class;
Class<Integer> intWrapper = Integer.class;
Class<List> listType = List.class;
```

Tetapi `Class<T>` tidak bisa merepresentasikan generic instantiation lengkap seperti:

```java
List<String>
Map<String, Integer>
Optional<User>
```

Karena Java menggunakan type erasure. Pada runtime, `List<String>` dan `List<Integer>` sama-sama memiliki raw class:

```java
List.class
```

Jadi ini tidak valid:

```java
// Tidak valid Java
Class<List<String>> type = List<String>.class;
```

Untuk generic runtime metadata yang lebih kaya, Java menggunakan `java.lang.reflect.Type`, `ParameterizedType`, atau pattern `TypeReference<T>` di library seperti Jackson/Gson. Tetapi `Class<T>` tetap menjadi dasar paling penting.

---

### 2.4 `Class` object tidak selalu berarti class biasa

Nama `Class` agak menyesatkan karena `Class<?>` dapat merepresentasikan banyak jenis type:

```java
String.class          // class biasa
Runnable.class        // interface
int.class             // primitive type
void.class            // void pseudo-type
String[].class        // array class
int[].class           // primitive array class
Override.class        // annotation type
Thread.State.class    // enum type
RecordExample.class   // record class
SealedType.class      // sealed class/interface
```

Jadi `Class<?>` lebih tepat dibaca sebagai:

> runtime token for a Java type known to the JVM.

Bukan hanya “class”.

---

## 3. Konsep Fundamental

### 3.1 Cara mendapatkan `Class` object

Ada beberapa cara utama.

#### 3.1.1 Class literal

```java
Class<String> c1 = String.class;
Class<Integer> c2 = Integer.class;
Class<int[]> c3 = int[].class;
Class<Void> c4 = Void.class;
Class<Void> c5 = void.class;
```

Class literal adalah cara paling aman dan paling eksplisit.

Kelebihan:

- compile-time checked;
- tidak perlu string class name;
- tidak bergantung pada lookup dinamis;
- tidak men-trigger class loading berbasis nama;
- mudah direfactor oleh IDE.

Gunakan ini jika tipe diketahui saat compile time.

---

#### 3.1.2 Dari instance: `obj.getClass()`

```java
Object value = "hello";
Class<?> runtimeType = value.getClass();

System.out.println(runtimeType.getName()); // java.lang.String
```

`getClass()` mengembalikan runtime class actual object tersebut, bukan declared type variable.

```java
CharSequence cs = "hello";

System.out.println(cs.getClass());
// class java.lang.String
```

Declared type variable adalah `CharSequence`, tetapi runtime object adalah `String`.

Important:

```java
Object x = null;
x.getClass(); // NullPointerException
```

Karena `getClass()` method instance dari `Object`, tidak bisa dipanggil pada `null`.

---

#### 3.1.3 `Class.forName(String)`

```java
Class<?> type = Class.forName("com.example.User");
```

Ini mencari class berdasarkan nama.

Useful untuk:

- plugin loading;
- optional dependency;
- JDBC driver legacy loading;
- framework bootstrap;
- runtime adapter;
- compatibility shim.

Tetapi berbahaya jika dipakai sembarangan karena:

- raw string mudah salah;
- bisa men-trigger class initialization;
- bergantung pada class loader;
- bisa gagal di module system;
- exception handling lebih kompleks;
- bisa membuka attack surface jika input class name dari user.

---

#### 3.1.4 `Class.forName(String, boolean, ClassLoader)`

```java
Class<?> type = Class.forName(
    "com.example.User",
    false,
    Thread.currentThread().getContextClassLoader()
);
```

Parameter kedua menentukan apakah class harus di-initialize.

```java
Class.forName(name, true, loader);  // load + link + initialize
Class.forName(name, false, loader); // load + link, tidak initialize saat itu
```

Class initialization dapat menjalankan static initializer:

```java
public class DangerousConfig {
    static {
        System.out.println("Static initializer executed");
        connectToRemoteSystem();
    }
}
```

Jika kamu hanya ingin metadata, hindari initialization kecuali perlu.

---

#### 3.1.5 `ClassLoader.loadClass`

```java
ClassLoader loader = Thread.currentThread().getContextClassLoader();
Class<?> type = loader.loadClass("com.example.User");
```

Secara mental:

- `ClassLoader.loadClass` berurusan dengan mekanisme loading;
- `Class.forName` adalah API convenient yang dapat melibatkan loading dan initialization;
- overload `Class.forName(name, initialize, loader)` memberi kontrol lebih eksplisit.

Jangan pilih berdasarkan kebiasaan. Pilih berdasarkan kontrak:

| Tujuan | API yang lebih cocok |
|---|---|
| Tipe diketahui saat compile time | `SomeType.class` |
| Tipe runtime dari object | `obj.getClass()` |
| Load class by name dan initialize | `Class.forName(name)` atau `Class.forName(name, true, loader)` |
| Load class by name tanpa initialize langsung | `Class.forName(name, false, loader)` atau `loader.loadClass(name)` |
| Plugin/app-server context loader | sering perlu context class loader |
| Module-aware loading | perlu pahami module boundary |

---

### 3.2 Binary name, canonical name, simple name, type name

`Class` punya beberapa nama berbeda. Ini sering jadi sumber bug.

```java
Class<?> c = java.util.Map.Entry.class;

System.out.println(c.getName());          // java.util.Map$Entry
System.out.println(c.getCanonicalName()); // java.util.Map.Entry
System.out.println(c.getSimpleName());    // Entry
System.out.println(c.getTypeName());      // java.util.Map$Entry or human-oriented type name
```

Untuk array:

```java
System.out.println(String[].class.getName());          // [Ljava.lang.String;
System.out.println(String[].class.getCanonicalName()); // java.lang.String[]
System.out.println(int[].class.getName());             // [I
System.out.println(int[].class.getCanonicalName());    // int[]
```

Mental model:

| Method | Makna umum | Cocok untuk |
|---|---|---|
| `getName()` | JVM/binary-ish name | internal identity, class loading tertentu |
| `getCanonicalName()` | nama Java source-like jika ada | display/config tertentu |
| `getSimpleName()` | nama pendek | UI/logging ringan |
| `getTypeName()` | type-oriented name | diagnostic |

Hindari memakai `getSimpleName()` untuk persistence, routing, registry key, atau protocol contract. Nama pendek tidak unik.

---

### 3.3 Primitive type tokens

Java primitive juga punya `Class` token:

```java
Class<Integer> wrapper = Integer.class;
Class<Integer> primitive = int.class; // secara generic tetap Class<Integer> secara API? hati-hati assignment detail
```

Lebih aman tulis:

```java
Class<?> primitive = int.class;
Class<?> wrapper = Integer.class;
```

Perbedaan penting:

```java
System.out.println(int.class.isPrimitive());      // true
System.out.println(Integer.class.isPrimitive());  // false
System.out.println(int.class == Integer.class);   // false
```

`int.class` dan `Integer.class` adalah tipe berbeda.

Autoboxing tidak membuat primitive dan wrapper menjadi class yang sama.

Contoh bug umum:

```java
Map<Class<?>, Object> defaults = new HashMap<>();
defaults.put(Integer.class, 0);

Object value = defaults.get(int.class); // null
```

Jika registry kamu menerima primitive dan wrapper, normalize lebih dulu:

```java
static Class<?> wrapPrimitive(Class<?> type) {
    if (!type.isPrimitive()) return type;
    if (type == int.class) return Integer.class;
    if (type == long.class) return Long.class;
    if (type == boolean.class) return Boolean.class;
    if (type == double.class) return Double.class;
    if (type == float.class) return Float.class;
    if (type == short.class) return Short.class;
    if (type == byte.class) return Byte.class;
    if (type == char.class) return Character.class;
    if (type == void.class) return Void.class;
    throw new IllegalArgumentException("Unknown primitive: " + type);
}
```

---

### 3.4 Array class tokens

Array juga punya `Class` object:

```java
Class<?> a = String[].class;
Class<?> b = int[].class;
Class<?> c = String[][].class;
```

Useful APIs:

```java
Class<?> arrayType = String[][].class;

System.out.println(arrayType.isArray());                  // true
System.out.println(arrayType.getComponentType());          // class [Ljava.lang.String;
System.out.println(arrayType.getComponentType().isArray()); // true
System.out.println(arrayType.getComponentType()
                           .getComponentType());           // class java.lang.String
```

Untuk mendapatkan element type terdalam:

```java
static Class<?> innermostComponentType(Class<?> type) {
    Class<?> current = type;
    while (current.isArray()) {
        current = current.getComponentType();
    }
    return current;
}
```

Array class memiliki karakteristik:

- dibuat oleh JVM;
- superclass-nya `Object`;
- mengimplementasikan `Cloneable` dan `Serializable`;
- element type bisa primitive atau reference;
- arrays covariant untuk reference arrays;
- primitive arrays tidak compatible dengan wrapper arrays.

```java
Object[] objects = new String[10]; // valid karena array covariance
objects[0] = 123;                  // ArrayStoreException runtime
```

`Class` bisa membantu mendeteksi array boundary dalam mapper/serializer.

---

### 3.5 `void.class` dan `Void.class`

```java
Class<?> v1 = void.class;
Class<?> v2 = Void.class;

System.out.println(v1 == v2);          // false
System.out.println(v1.isPrimitive());  // true
System.out.println(v2.isPrimitive());  // false
```

`void.class` merepresentasikan pseudo-type `void`.  
`Void.class` adalah wrapper reference type `java.lang.Void`.

Use case:

- reflection method return type;
- command handler that returns no payload;
- generic API representing “no result”.

Contoh:

```java
if (method.getReturnType() == void.class) {
    // method has no return value
}
```

Jangan samakan `void.class` dengan `Void.class`.

---

## 4. API dan Contract yang Perlu Dipahami

### 4.1 Type classification methods

`Class<?>` menyediakan banyak predicate:

```java
Class<?> type = String.class;

type.isPrimitive();
type.isArray();
type.isInterface();
type.isAnnotation();
type.isEnum();
type.isRecord();
type.isSealed();
type.isAnonymousClass();
type.isLocalClass();
type.isMemberClass();
type.isSynthetic();
type.isHidden();
```

Tidak semua ada di Java 8. Beberapa ditambahkan setelahnya:

| API | Era umum |
|---|---:|
| `isPrimitive`, `isArray`, `isInterface`, `isEnum`, `isAnnotation` | sudah ada sejak lama / Java 8 |
| `getModule` | Java 9 |
| `getNestHost`, `getNestMembers` | Java 11 |
| `isHidden` | Java 15 |
| `isRecord`, `getRecordComponents` | Java 16 |
| `isSealed`, `getPermittedSubclasses` | Java 17 |

Jika library kamu harus support Java 8–25, jangan langsung reference API baru di code path yang akan dijalankan di Java 8, karena bisa menyebabkan linkage error.

---

### 4.2 `isInstance`

```java
Class<?> type = CharSequence.class;

System.out.println(type.isInstance("hello")); // true
System.out.println(type.isInstance(123));     // false
System.out.println(type.isInstance(null));    // false
```

`type.isInstance(obj)` adalah dynamic equivalent dari:

```java
obj instanceof CharSequence
```

Use case:

```java
static boolean accepts(Class<?> expectedType, Object value) {
    return value == null || expectedType.isInstance(value);
}
```

Catatan: primitive `Class` tidak bekerja seperti autoboxing.

```java
System.out.println(int.class.isInstance(1));     // false
System.out.println(Integer.class.isInstance(1)); // true
```

---

### 4.3 `cast`

```java
Class<String> type = String.class;
Object value = "hello";

String s = type.cast(value);
```

`cast` useful ketika tipe diketahui secara runtime tetapi kamu ingin generic return type lebih aman.

```java
static <T> T requireType(Object value, Class<T> type) {
    if (value == null) {
        throw new IllegalArgumentException("value is null");
    }
    return type.cast(value);
}
```

Ini lebih baik daripada unchecked cast tersebar:

```java
return (T) value; // lebih rawan dan warning
```

`Class.cast` tetap melakukan runtime check dan bisa throw `ClassCastException`.

---

### 4.4 `asSubclass`

`asSubclass` mengubah `Class<?>` menjadi `Class<? extends U>` jika runtime class memang subclass dari target.

```java
Class<?> raw = Class.forName("com.example.MyTask");
Class<? extends Runnable> taskType = raw.asSubclass(Runnable.class);
```

Jika bukan subclass:

```java
ClassCastException
```

Use case:

- plugin loading;
- command loading;
- SPI validation;
- factory registry;
- module extension point.

Contoh aman:

```java
public static <T> Class<? extends T> loadImplementation(
        String className,
        Class<T> contract,
        ClassLoader loader
) throws ClassNotFoundException {
    Class<?> raw = Class.forName(className, false, loader);
    return raw.asSubclass(contract);
}
```

Dengan ini kamu tidak hanya load class, tapi juga validate bahwa class tersebut memenuhi kontrak.

---

### 4.5 `isAssignableFrom`

Ini API yang sering dibalik.

```java
A.class.isAssignableFrom(B.class)
```

Artinya:

> Apakah value bertipe `B` bisa di-assign ke variable bertipe `A`?

Contoh:

```java
System.out.println(CharSequence.class.isAssignableFrom(String.class)); // true
System.out.println(String.class.isAssignableFrom(CharSequence.class)); // false
```

Baca seperti ini:

```text
left = target/supertype/slot type
right = candidate/subtype/value type

left.isAssignableFrom(right)
```

Contoh registry:

```java
static void requireHandlerType(Class<?> candidate) {
    if (!Handler.class.isAssignableFrom(candidate)) {
        throw new IllegalArgumentException(candidate + " is not a Handler");
    }
}
```

Jangan dibalik menjadi:

```java
candidate.isAssignableFrom(Handler.class) // biasanya salah
```

Rule mental:

```java
TargetType.class.isAssignableFrom(CandidateType.class)
```

---

### 4.6 Constructor access: modern replacement for `newInstance`

Legacy:

```java
Object obj = type.newInstance(); // deprecated sejak Java 9
```

Modern:

```java
Object obj = type.getDeclaredConstructor().newInstance();
```

Kenapa `Class.newInstance()` buruk?

- hanya memanggil no-arg constructor;
- exception handling kurang jelas;
- propagates checked exceptions in awkward way;
- access handling lebih lemah;
- deprecated.

Pattern yang lebih eksplisit:

```java
static <T> T instantiateNoArg(Class<T> type) {
    try {
        return type.getDeclaredConstructor().newInstance();
    } catch (ReflectiveOperationException e) {
        throw new IllegalArgumentException("Cannot instantiate " + type.getName(), e);
    }
}
```

Tetapi untuk production framework, instantiation via reflection harus memperhatikan:

- access control;
- module opens;
- constructor side effects;
- checked exception wrapping;
- security posture;
- native image constraints;
- performance caching;
- class loader lifecycle.

---

## 5. Evolusi Java 8–25

### 5.1 Java 8 baseline

Di Java 8, `Class<T>` sudah sangat kaya:

- class literal;
- reflection metadata;
- annotation access;
- enum detection;
- generic superclass/interface metadata;
- class loader access;
- protection domain;
- resource loading;
- member/enclosing class metadata;
- synthetic/local/anonymous detection.

Tetapi belum ada module metadata, record metadata, sealed metadata, hidden class detection, nestmate API, dan beberapa modern runtime concepts.

---

### 5.2 Java 9: module awareness

Java 9 memperkenalkan JPMS. `Class` mendapat relasi langsung ke `Module`:

```java
Module module = String.class.getModule();
System.out.println(module.getName()); // java.base
```

Ini mengubah dunia reflection.

Sebelum Java 9, pertanyaan utama reflection adalah:

```text
Apakah member public/private? Apakah accessible?
```

Setelah Java 9, pertanyaan menjadi:

```text
Apakah package diekspor?
Apakah package dibuka?
Module mana membaca module mana?
Apakah reflective access legal?
```

`Class<T>` kini berada dalam runtime module boundary.

---

### 5.3 Java 11: nestmates

Java 11 membawa nest-based access control. `Class` punya API seperti:

```java
Class<?> host = SomeInner.class.getNestHost();
Class<?>[] members = SomeOuter.class.getNestMembers();
boolean same = A.class.isNestmateOf(B.class);
```

Ini berkaitan dengan cara compiler merepresentasikan inner/nested classes dan access private antar class dalam nest yang sama.

Untuk kebanyakan application code, ini jarang dipakai langsung. Untuk bytecode tools, proxies, agents, dan framework runtime, ini penting.

---

### 5.4 Java 15: hidden classes

Hidden classes mendukung framework/runtime yang menghasilkan class dinamis yang tidak dimaksudkan ditemukan secara normal by name.

`Class` menyediakan:

```java
type.isHidden()
```

Use case lebih banyak di framework/internal runtime:

- lambda implementation;
- dynamic language runtime;
- proxies;
- generated adapters.

Pelajaran untuk engineer aplikasi:

> Jangan berasumsi semua runtime class punya nama stabil, bisa di-load ulang via `Class.forName`, atau cocok dipakai sebagai persistent identity.

---

### 5.5 Java 16: records

Record menjadi final di Java 16. `Class` punya:

```java
type.isRecord();
type.getRecordComponents();
```

Ini memungkinkan mapper/serializer membaca record components secara runtime.

Contoh:

```java
record UserView(String id, String name) {}

System.out.println(UserView.class.isRecord()); // true
```

Record bukan hanya “class with getters”. Record punya runtime contract khusus:

- record components;
- canonical constructor;
- generated equals/hashCode/toString;
- transparent carrier semantics.

---

### 5.6 Java 17: sealed classes

Sealed classes final di Java 17. `Class` punya:

```java
type.isSealed();
type.getPermittedSubclasses();
```

Ini penting untuk modelling domain closed hierarchy.

```java
sealed interface Decision permits Approved, Rejected, Escalated {}
record Approved(String by) implements Decision {}
record Rejected(String reason) implements Decision {}
record Escalated(String queue) implements Decision {}
```

Runtime dapat mengetahui permitted subclasses.

Caveat:

- tidak berarti semua subclass sudah initialized;
- tidak berarti classpath scanning tidak perlu;
- tidak otomatis membuat serialization aman;
- module/package rules tetap berlaku.

---

### 5.7 Java 21–25: modern runtime assumptions

Java 21 membawa virtual threads sebagai fitur final. Walau `Class` tidak khusus virtual-thread-centric, framework runtime yang memakai reflection/class metadata harus memahami bahwa execution carrier berubah.

Java 22–25 melanjutkan banyak evolusi platform, preview features, dan API modern. Untuk seri ini, prinsip pentingnya:

- jangan mengikat desain library pada detail JDK implementation;
- gunakan API standard jika ada;
- bedakan Java language feature, JVM feature, dan Java SE API;
- ketika support 8–25, hindari direct linkage ke API baru tanpa strategi compatibility.

---

## 6. Contoh Kode Bertahap

### 6.1 Type-safe registry dengan `Class<T>`

Masalah: kamu ingin menyimpan service berdasarkan tipe dan mengambilnya dengan type-safe.

Versi naive:

```java
Map<Class<?>, Object> registry = new HashMap<>();

registry.put(UserService.class, new UserService());

UserService service = (UserService) registry.get(UserService.class);
```

Masalah:

- unchecked cast;
- salah put bisa tidak ketahuan;
- primitive/wrapper issue;
- class loader issue untuk plugin system.

Versi lebih aman:

```java
public final class TypeRegistry {
    private final Map<Class<?>, Object> values = new HashMap<>();

    public <T> void put(Class<T> type, T value) {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(value, "value");

        if (!type.isInstance(value)) {
            throw new IllegalArgumentException(
                "Value of type " + value.getClass().getName()
                    + " is not instance of " + type.getName()
            );
        }

        values.put(type, value);
    }

    public <T> Optional<T> get(Class<T> type) {
        Objects.requireNonNull(type, "type");
        Object value = values.get(type);
        if (value == null) {
            return Optional.empty();
        }
        return Optional.of(type.cast(value));
    }
}
```

Usage:

```java
TypeRegistry registry = new TypeRegistry();

registry.put(UserService.class, new UserService());

UserService userService = registry.get(UserService.class)
    .orElseThrow();
```

Inilah contoh `Class<T>` sebagai runtime type token.

---

### 6.2 Plugin loader dengan contract validation

Misal semua plugin harus implement interface:

```java
public interface JobPlugin {
    String name();
    void run(JobContext context);
}
```

Loader:

```java
public final class PluginLoader {
    private final ClassLoader classLoader;

    public PluginLoader(ClassLoader classLoader) {
        this.classLoader = Objects.requireNonNull(classLoader, "classLoader");
    }

    public Class<? extends JobPlugin> loadPluginType(String className) {
        Objects.requireNonNull(className, "className");
        try {
            Class<?> raw = Class.forName(className, false, classLoader);
            return raw.asSubclass(JobPlugin.class);
        } catch (ClassNotFoundException e) {
            throw new IllegalArgumentException("Plugin class not found: " + className, e);
        } catch (ClassCastException e) {
            throw new IllegalArgumentException("Class is not a JobPlugin: " + className, e);
        }
    }

    public JobPlugin instantiate(String className) {
        Class<? extends JobPlugin> pluginType = loadPluginType(className);
        try {
            return pluginType.getDeclaredConstructor().newInstance();
        } catch (ReflectiveOperationException e) {
            throw new IllegalArgumentException(
                "Cannot instantiate plugin: " + pluginType.getName(), e
            );
        }
    }
}
```

Kenapa `Class.forName(..., false, classLoader)`?

Karena pada tahap validasi type, kita belum tentu ingin menjalankan static initializer plugin.

---

### 6.3 Safe command dispatcher berbasis `Class<T>`

Misal:

```java
interface Command {}
interface CommandHandler<C extends Command> {
    void handle(C command);
}
```

Registry:

```java
public final class CommandBus {
    private final Map<Class<?>, CommandHandler<?>> handlers = new HashMap<>();

    public <C extends Command> void register(
            Class<C> commandType,
            CommandHandler<? super C> handler
    ) {
        Objects.requireNonNull(commandType, "commandType");
        Objects.requireNonNull(handler, "handler");
        handlers.put(commandType, handler);
    }

    public <C extends Command> void dispatch(C command) {
        Objects.requireNonNull(command, "command");

        Class<?> runtimeType = command.getClass();
        CommandHandler<?> handler = handlers.get(runtimeType);

        if (handler == null) {
            throw new IllegalStateException(
                "No handler registered for " + runtimeType.getName()
            );
        }

        dispatchUnchecked(command, handler);
    }

    @SuppressWarnings("unchecked")
    private static <C extends Command> void dispatchUnchecked(
            C command,
            CommandHandler<?> rawHandler
    ) {
        CommandHandler<C> handler = (CommandHandler<C>) rawHandler;
        handler.handle(command);
    }
}
```

Ada satu unchecked cast, tetapi terlokalisasi dalam boundary yang dijaga oleh registry invariant.

Top-tier engineering bukan berarti menghindari unchecked cast 100%. Kadang tidak mungkin karena type erasure. Yang penting:

- cast dilokalisasi;
- invariant jelas;
- API publik tetap type-safe;
- failure terjadi cepat;
- error message operable.

---

### 6.4 Class metadata inspector

Contoh utility diagnostik:

```java
public final class ClassDebug {
    public static String describe(Class<?> type) {
        Objects.requireNonNull(type, "type");

        StringBuilder sb = new StringBuilder();
        sb.append("name=").append(type.getName()).append('\n');
        sb.append("canonicalName=").append(type.getCanonicalName()).append('\n');
        sb.append("simpleName=").append(type.getSimpleName()).append('\n');
        sb.append("typeName=").append(type.getTypeName()).append('\n');
        sb.append("primitive=").append(type.isPrimitive()).append('\n');
        sb.append("array=").append(type.isArray()).append('\n');
        sb.append("interface=").append(type.isInterface()).append('\n');
        sb.append("annotation=").append(type.isAnnotation()).append('\n');
        sb.append("enum=").append(type.isEnum()).append('\n');
        sb.append("classLoader=").append(type.getClassLoader()).append('\n');
        sb.append("module=").append(type.getModule()).append('\n');

        if (type.isArray()) {
            sb.append("componentType=").append(type.getComponentType()).append('\n');
        }

        return sb.toString();
    }
}
```

Caveat untuk Java 8: `getModule()` tidak tersedia. Jika support Java 8, utility ini tidak bisa langsung dikompilasi dengan `--release 8`.

Strategi:

- pisahkan source set Java 9+;
- gunakan multi-release JAR;
- gunakan reflection guarded;
- atau tentukan baseline runtime minimal lebih tinggi.

---

## 7. Design Patterns / Usage Patterns

### 7.1 Type token parameter

Pattern:

```java
public <T> T read(String key, Class<T> type) {
    Object raw = storage.get(key);
    return type.cast(raw);
}
```

Ini umum di:

- config reader;
- HTTP client;
- JSON parser;
- message bus;
- typed attributes;
- service locator;
- test fixture loader.

Kelebihan:

- caller eksplisit memberi expected type;
- runtime check menggunakan `Class.cast`;
- generic return type lebih nyaman.

Keterbatasan:

- tidak cukup untuk `List<User>`;
- primitive/wrapper harus dipikirkan;
- nullable semantics harus jelas.

---

### 7.2 Contract-first dynamic loading

Jangan hanya load class by name lalu instantiate.

Buruk:

```java
Object plugin = Class.forName(name).getDeclaredConstructor().newInstance();
JobPlugin p = (JobPlugin) plugin;
```

Lebih baik:

```java
Class<?> raw = Class.forName(name, false, loader);
Class<? extends JobPlugin> pluginType = raw.asSubclass(JobPlugin.class);
JobPlugin plugin = pluginType.getDeclaredConstructor().newInstance();
```

Kenapa?

- validate contract lebih awal;
- error message lebih jelas;
- static initialization dapat dikontrol;
- lebih mudah enforce allowlist/blocklist.

---

### 7.3 Metadata cache by `Class<?>`

Framework sering cache metadata:

```java
private final ConcurrentMap<Class<?>, EntityMetadata> metadataCache = new ConcurrentHashMap<>();

public EntityMetadata metadataFor(Class<?> type) {
    return metadataCache.computeIfAbsent(type, this::inspect);
}
```

Caveat:

Jika framework berjalan di environment dengan reloadable classloader, cache seperti ini bisa menyebabkan class loader leak.

Kenapa?

```text
static cache -> Class<?> -> ClassLoader -> all classes/resources
```

Alternatif:

- gunakan `ClassValue<T>`;
- cache per application context;
- weak keys dengan hati-hati;
- explicit close/clear saat undeploy;
- hindari static cache global untuk plugin/reloadable environment.

---

### 7.4 API boundary with `Class<T>` and `Supplier<T>`

Kadang `Class<T>` tidak cukup untuk membuat object.

Buruk:

```java
public <T> T create(Class<T> type) {
    return type.getDeclaredConstructor().newInstance();
}
```

Ini memaksa:

- no-arg constructor;
- reflection;
- module opens;
- constructor visibility;
- runtime exception complexity.

Lebih fleksibel:

```java
public <T> void register(Class<T> type, Supplier<? extends T> factory) {
    // store factory
}
```

Pattern:

- `Class<T>` untuk identity/metadata;
- `Supplier<T>`/factory untuk construction;
- validator untuk contract;
- lifecycle manager untuk cleanup.

---

### 7.5 Avoid stringly typed class identity

Buruk:

```java
if (obj.getClass().getName().equals("com.example.User")) {
    ...
}
```

Lebih baik:

```java
if (obj instanceof User user) {
    ...
}
```

Atau dynamic:

```java
if (expectedType.isInstance(obj)) {
    ...
}
```

String class name kadang perlu untuk config/plugin, tapi jangan jadikan default.

---

## 8. Failure Modes

### 8.1 Salah arah `isAssignableFrom`

Bug:

```java
if (!candidate.isAssignableFrom(Handler.class)) {
    throw new IllegalArgumentException();
}
```

Seharusnya:

```java
if (!Handler.class.isAssignableFrom(candidate)) {
    throw new IllegalArgumentException();
}
```

Rule:

```text
Target/Supertype.isAssignableFrom(Candidate/Subtype)
```

---

### 8.2 Menganggap `getClass() == SomeClass.class` sama dengan `instanceof`

```java
if (obj.getClass() == Payment.class) {
    ...
}
```

Ini hanya true jika runtime class persis `Payment`, bukan subclass.

Jika ingin polymorphic:

```java
if (obj instanceof Payment) {
    ...
}
```

Atau:

```java
if (Payment.class.isInstance(obj)) {
    ...
}
```

`getClass() ==` cocok untuk exact type semantics, misalnya equality pattern tertentu. Tapi jangan pakai untuk polymorphic check.

---

### 8.3 Class initialization side effects

```java
Class.forName("com.example.ExpensiveBootstrap");
```

Bisa menjalankan:

```java
static {
    connectToDatabase();
    startThread();
    readEnvironment();
}
```

Mitigasi:

```java
Class.forName(name, false, loader)
```

Dan desain class agar static initializer tidak melakukan kerja berat/side effect eksternal.

---

### 8.4 Class loader leak via static map

```java
public final class GlobalMetadataCache {
    private static final Map<Class<?>, Metadata> CACHE = new ConcurrentHashMap<>();
}
```

Di app server/plugin system, ini bisa mencegah class loader lama di-GC.

Mitigasi:

- cache scoped to lifecycle;
- clear cache on shutdown;
- `ClassValue`;
- weak references dengan desain benar;
- jangan simpan `Class<?>` plugin di static singleton parent loader.

---

### 8.5 Generic type hilang

```java
void handle(Class<List<String>> type) { } // tidak bisa pakai List<String>.class
```

Runtime class `List<String>` dan `List<Integer>` sama-sama `List.class`.

Jika butuh generic metadata:

```java
Type type = new TypeReference<List<User>>() {}.getType(); // library-specific pattern
```

Atau desain API berbeda:

```java
readList(User.class)
readMap(String.class, User.class)
```

---

### 8.6 Primitive/wrapper mismatch

```java
int.class != Integer.class
int.class.isInstance(1) == false
```

Registry harus normalize jika ingin memperlakukan primitive dan wrapper sebagai equivalent.

---

### 8.7 Relying on class names for security

Buruk:

```java
if (className.startsWith("com.mycompany.safe.")) {
    Class<?> c = Class.forName(className);
    ...
}
```

Masalah:

- classpath shadowing;
- dependency confusion;
- malicious class in allowed package;
- static initializer side effect;
- wrong class loader;
- package name bukan trust boundary.

Lebih aman:

- allowlist exact classes;
- verify signer/module/code source jika relevan;
- load without initialization first;
- validate interface/base type;
- instantiate with controlled permissions/environment;
- avoid user-controlled class names.

---

### 8.8 Module reflection failure

Di Java 9+, reflection bisa gagal meskipun member ada.

Contoh masalah:

```text
InaccessibleObjectException
```

Penyebab:

- package tidak `opens` ke module caller;
- strong encapsulation;
- internal JDK class tidak boleh diakses;
- command-line `--add-opens` tidak disediakan.

Pelajaran:

> `Class` metadata bisa terlihat sebagian, tetapi reflective access tetap tunduk pada module boundary.

---

### 8.9 Menganggap semua class punya canonical name

Anonymous/local/hidden class bisa punya canonical name `null`.

```java
Runnable r = new Runnable() {
    @Override public void run() {}
};

System.out.println(r.getClass().getCanonicalName()); // bisa null
```

Jangan jadikan `getCanonicalName()` sebagai mandatory ID tanpa null handling.

---

## 9. Performance, Memory, Security Considerations

### 9.1 `Class` object access murah, reflection operation belum tentu

Mengambil token:

```java
String.class
obj.getClass()
```

murah.

Tetapi melakukan repeated reflective lookup bisa mahal:

```java
clazz.getDeclaredMethods()
clazz.getDeclaredFields()
clazz.getDeclaredConstructor()
```

Untuk framework hot path:

- cache metadata;
- precompute mappers;
- avoid repeated annotation scanning;
- avoid scanning whole classpath at request time;
- separate bootstrap cost from runtime request path.

---

### 9.2 Cache harus lifecycle-aware

Cache metadata bisa mempercepat, tapi juga bisa leak.

Pertanyaan desain:

- Apakah class loader bisa berubah?
- Apakah aplikasi bisa redeploy?
- Apakah plugin bisa unload?
- Apakah cache static global?
- Apakah key `Class<?>` berasal dari child loader?
- Apakah value menyimpan `Method`, `Field`, lambda, atau object yang juga menahan loader?

Top-tier design bukan “cache everything”. Top-tier design adalah **cache sesuai lifecycle owner**.

---

### 9.3 Dynamic class loading adalah security boundary

Jika sistem menerima class name dari config/user/input eksternal, kamu sedang membuka surface:

- arbitrary class initialization;
- classpath probing;
- denial of service via expensive static init;
- malicious implementation;
- dependency shadowing;
- deserialization gadget-like behavior;
- class loader confusion.

Minimum hardening:

```java
private static final Set<String> ALLOWED_PLUGINS = Set.of(
    "com.example.plugins.CsvImportPlugin",
    "com.example.plugins.XmlImportPlugin"
);

public Class<? extends JobPlugin> loadAllowedPlugin(String className) {
    if (!ALLOWED_PLUGINS.contains(className)) {
        throw new SecurityException("Plugin not allowed: " + className);
    }
    // load false + asSubclass
}
```

Package prefix bukan cukup.

---

### 9.4 Initialization cost and failure

Class initialization is synchronized by JVM per class. Jika static initializer lambat atau deadlock, sistem bisa terganggu.

Buruk:

```java
public final class GlobalClient {
    static final Client CLIENT = connect();
}
```

Masalah:

- static init failure menyebabkan `ExceptionInInitializerError`;
- subsequent access bisa menyebabkan `NoClassDefFoundError`;
- sulit retry;
- sulit test;
- sulit configure;
- startup unpredictability.

Lebih baik:

- explicit lifecycle;
- dependency injection;
- lazy holder hanya untuk pure/local initialization;
- avoid remote IO in static initializer.

---

### 9.5 Reflection and native image / AOT

Jika aplikasi menargetkan GraalVM native image atau AOT-like environment, dynamic `Class.forName`, reflection, proxy, resource lookup, dan annotation scanning perlu konfigurasi khusus.

Desain portable:

- minimize uncontrolled reflection;
- centralize reflective operations;
- make metadata explicit;
- generate code at build time jika perlu;
- expose configuration surface;
- avoid random classpath scanning at runtime.

---

## 10. Production Checklist

Gunakan checklist ini saat membuat API berbasis `Class<T>`.

### 10.1 Type token API

- [ ] Apakah `Class<T>` memang cukup, atau butuh generic `Type`?
- [ ] Apakah null value punya semantic jelas?
- [ ] Apakah primitive dan wrapper perlu dinormalisasi?
- [ ] Apakah `Class.cast` digunakan daripada unchecked cast menyebar?
- [ ] Apakah unchecked cast dilokalisasi di satu boundary dengan invariant jelas?
- [ ] Apakah error message menyebut expected type dan actual type?

### 10.2 Dynamic loading

- [ ] Apakah class name berasal dari trusted config?
- [ ] Apakah ada allowlist?
- [ ] Apakah menggunakan class loader yang benar?
- [ ] Apakah load dilakukan tanpa initialization jika hanya validasi metadata?
- [ ] Apakah contract divalidasi dengan `asSubclass` atau `isAssignableFrom`?
- [ ] Apakah static initializer class target aman?
- [ ] Apakah module boundary dipertimbangkan?

### 10.3 Reflection metadata

- [ ] Apakah metadata scanning dilakukan di bootstrap, bukan request hot path?
- [ ] Apakah cache metadata lifecycle-aware?
- [ ] Apakah cache bisa dibersihkan saat undeploy/plugin unload?
- [ ] Apakah class loader leak diuji?
- [ ] Apakah Java 8–25 compatibility dipertimbangkan?

### 10.4 Naming

- [ ] Apakah tidak memakai `getSimpleName()` sebagai persistent key?
- [ ] Apakah `getCanonicalName()` null-safe?
- [ ] Apakah binary name vs canonical name dipahami?
- [ ] Apakah nested class `$` handling benar?

### 10.5 Java version compatibility

- [ ] Apakah code yang harus jalan di Java 8 tidak direct-call `getModule`, `isRecord`, `isSealed`?
- [ ] Apakah multi-release JAR atau reflective guard digunakan jika perlu?
- [ ] Apakah build memakai `--release` yang sesuai?
- [ ] Apakah tests dijalankan di runtime target minimum dan maksimum?

---

## 11. Latihan / Thought Exercise

### Latihan 1 — `isAssignableFrom`

Prediksi hasil:

```java
System.out.println(Object.class.isAssignableFrom(String.class));
System.out.println(String.class.isAssignableFrom(Object.class));
System.out.println(CharSequence.class.isAssignableFrom(String.class));
System.out.println(String.class.isAssignableFrom(CharSequence.class));
System.out.println(Runnable.class.isAssignableFrom(Thread.class));
System.out.println(Thread.class.isAssignableFrom(Runnable.class));
```

Jawaban:

```text
true
false
true
false
true
false
```

Karena `left.isAssignableFrom(right)` berarti object bertipe `right` bisa dimasukkan ke variable bertipe `left`.

---

### Latihan 2 — Primitive registry bug

Apa output-nya?

```java
Map<Class<?>, String> names = new HashMap<>();
names.put(Integer.class, "integer");

System.out.println(names.get(int.class));
System.out.println(names.get(Integer.class));
```

Jawaban:

```text
null
integer
```

Karena `int.class` dan `Integer.class` berbeda.

---

### Latihan 3 — Runtime type vs declared type

```java
CharSequence value = "abc";
System.out.println(value.getClass() == CharSequence.class);
System.out.println(value.getClass() == String.class);
System.out.println(CharSequence.class.isInstance(value));
```

Jawaban:

```text
false
true
true
```

Declared type variable `CharSequence`, runtime object `String`.

---

### Latihan 4 — Class name trap

Apa kemungkinan output?

```java
Runnable r = new Runnable() {
    @Override public void run() {}
};

System.out.println(r.getClass().getName());
System.out.println(r.getClass().getCanonicalName());
System.out.println(r.getClass().getSimpleName());
```

Kemungkinan:

```text
com.example.Main$1
null
<empty or implementation-dependent simple anonymous name behavior>
```

Lesson:

- anonymous class tidak punya canonical name;
- jangan gunakan canonical/simple name sebagai guaranteed ID;
- untuk diagnostics, handle null/empty.

---

### Latihan 5 — Design challenge

Desain API berikut:

```java
<T> T readConfig(String key, Class<T> type)
```

Pertanyaan:

1. Bagaimana jika value tidak ada?
2. Bagaimana jika expected type primitive?
3. Bagaimana jika config value string perlu dikonversi ke enum?
4. Bagaimana jika caller ingin `List<String>`?
5. Apakah method harus return `T`, `Optional<T>`, atau menerima default value?
6. Apakah conversion failure termasuk `IllegalArgumentException`, custom exception, atau checked exception?
7. Apakah `Class<T>` cukup untuk semua use case?

Jawaban desain yang matang biasanya akan memecah API:

```java
<T> Optional<T> get(String key, Class<T> type);
<T> T getOrDefault(String key, Class<T> type, T defaultValue);
<T extends Enum<T>> Optional<T> getEnum(String key, Class<T> enumType);
<T> List<T> getList(String key, Class<T> elementType);
```

Dan memiliki conversion registry yang eksplisit.

---

## 12. Ringkasan

`Class<T>` adalah salah satu API paling fundamental di Java karena ia menjadi jembatan antara source-level type system dan runtime metadata JVM.

Hal yang harus melekat:

1. `Class<T>` adalah runtime token untuk tipe, bukan instance dari domain object.
2. `String.class`, `obj.getClass()`, `Class.forName`, dan `ClassLoader.loadClass` punya maksud berbeda.
3. Runtime class identity dipengaruhi oleh defining class loader.
4. Primitive, array, interface, enum, annotation, record, sealed type semua direpresentasikan oleh `Class<?>`.
5. `Class<T>` tidak merepresentasikan generic type lengkap seperti `List<User>`.
6. `isAssignableFrom` dibaca sebagai target type menerima candidate type.
7. `Class.cast` dan `asSubclass` membantu menjaga dynamic code tetap type-safe.
8. `Class.forName` bisa memicu initialization side effect jika tidak dikontrol.
9. Reflection dan module system sejak Java 9 mengubah access boundary.
10. Metadata cache berbasis `Class<?>` harus lifecycle-aware agar tidak menyebabkan class loader leak.

Untuk engineer senior, `Class<T>` bukan sekadar reflection API. Ia adalah fondasi banyak desain runtime:

- registries;
- plugin systems;
- serializers;
- DI containers;
- mappers;
- framework metadata;
- compatibility layers;
- runtime diagnostics.

Pemahaman tajam tentang `Class<T>` membuat kamu lebih siap membaca dan merancang framework-level Java code.

---

## 13. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

**Part 4 — `String`: Semantics, Immutability, Interning, Unicode, Performance**

Kenapa setelah `Class<T>` kita masuk ke `String`?

Karena `String` adalah tipe Java yang paling sering dipakai, tetapi juga salah satu yang paling sering disalahpahami. Ia berhubungan dengan:

- literal pool;
- immutability;
- interning;
- Unicode;
- compact strings;
- concatenation;
- memory pressure;
- protocol design;
- security;
- logging;
- identifiers;
- normalization.

Jika `Class<T>` adalah fondasi metadata runtime, maka `String` adalah fondasi representasi teks dan boundary antar sistem.

---

## 14. Status Seri

Progress saat ini:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - berikutnya
...
Part 32 - belum
```

Seri belum selesai. Masih ada 29 part setelah ini.

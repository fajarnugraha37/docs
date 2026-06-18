# learn-java-oop-functional-reflection-codegen-modules-part-018

# Reflection Deep Dive I: Class Metadata, Members, Access, and Type Inspection

> Seri: Java OOP, Functional, Reflection, Code Generation, Modules & Package Management  
> Part: 018  
> Status seri: belum selesai  
> Fokus: memahami reflection sebagai mekanisme inspeksi metadata runtime secara akurat, aman, dan maintainable.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun mental model tentang:

- object model Java;
- type system;
- class anatomy;
- equality dan immutability;
- inheritance, interface, sealed hierarchy, record, enum;
- generics;
- polymorphism;
- composition;
- functional style;
- lambda dan functional interface;
- nullability, optional, result modeling, dan error channel.

Sekarang kita masuk ke area yang sering dipakai framework, library, test tooling, mapper, serializer, DI container, validator, ORM, RPC layer, plugin system, dan code generator: **reflection**.

Reflection sering dipahami secara dangkal sebagai:

> “Java bisa membaca class, field, method, constructor saat runtime.”

Itu benar, tapi belum cukup.

Mental model yang lebih tepat:

> Reflection adalah kemampuan runtime Java untuk memperlakukan metadata program sebagai data: class, method, field, constructor, annotation, generic signature, record component, enum constant, sealed hierarchy, module membership, nest membership, enclosing context, dan access boundary dapat diinspeksi dan, pada level tertentu, digunakan untuk operasi dinamis.

Part ini fokus pada **metadata inspection**:

- `Class<?>`;
- `Field`;
- `Method`;
- `Constructor`;
- `Parameter`;
- `RecordComponent`;
- `AnnotatedElement`;
- `Type` dan generic metadata;
- modifier;
- annotation metadata;
- enum/record/sealed/nested metadata;
- module/access boundary;
- design dan failure model.

Part berikutnya, Part 019, akan masuk ke **dynamic invocation, proxy, dan framework mechanics**.

---

## 1. Reflection Bukan “Magic”: Reflection Adalah Metadata Runtime

Reflection bukan compiler kedua. Reflection tidak membuat Java menjadi dynamically typed language sepenuhnya. Reflection hanya membuka sebagian informasi yang tersedia pada runtime.

Java tetap memiliki:

- compile-time type checking;
- bytecode verification;
- class loading;
- access control;
- module encapsulation;
- type erasure;
- runtime class identity;
- classloader boundary.

Reflection bekerja di dalam batas-batas itu.

Contoh sederhana:

```java
Class<?> type = String.class;

System.out.println(type.getName());
System.out.println(type.getPackageName());
System.out.println(type.getModule().getName());
System.out.println(type.isInterface());
System.out.println(type.isRecord());
System.out.println(type.isEnum());
```

Di sini `String.class` bukan object `String`. Ia adalah object metadata yang merepresentasikan runtime class `java.lang.String`.

Perhatikan perbedaan besar:

```java
String value = "hello";        // domain/runtime value
Class<?> metadata = String.class; // metadata about a type
```

Top engineer harus selalu membedakan:

| Hal | Contoh | Makna |
|---|---:|---|
| Object domain | `new Customer(...)` | object yang dipakai business logic |
| Runtime class metadata | `Customer.class` | metadata class `Customer` |
| Static type | `Customer c` | type yang dilihat compiler |
| Runtime class | `c.getClass()` | class aktual object pada runtime |
| Generic signature | `List<Customer>` | sebagian metadata generics, tergantung deklarasi |
| Erased type | `List` | bentuk runtime dasar akibat erasure |

---

## 2. Mengapa Reflection Ada?

Reflection berguna ketika kode tidak tahu semua type secara statis di compile time, tetapi tetap perlu:

1. membaca metadata;
2. menemukan member;
3. membaca annotation;
4. membuat object;
5. memanggil method;
6. membaca/menulis field;
7. membangun mapping;
8. melakukan discovery;
9. menghubungkan plugin/provider;
10. mengimplementasikan framework behavior.

Contoh penggunaan nyata:

| Area | Reflection digunakan untuk |
|---|---|
| Dependency injection | menemukan constructor, field, method, annotation |
| Serialization | menemukan property/field/record component |
| ORM | mapping entity ke tabel/kolom, proxy, lazy loading |
| Validation | membaca annotation constraint |
| Testing | menemukan test method, lifecycle hook |
| RPC/REST framework | mapping method ke endpoint/operation |
| Mapper | mapping field/component antar DTO |
| Config binding | binding config ke object |
| Plugin system | loading class/provider dari nama atau service metadata |
| Code generation | membaca model sumber/runtime sebagai input generator |

Namun reflection juga membawa risiko:

- access violation;
- runtime failure instead of compile-time failure;
- weaker refactoring safety;
- performance overhead bila tidak dicache;
- module encapsulation conflict;
- generic erasure confusion;
- hidden coupling;
- framework magic yang sulit di-debug;
- security/integrity risk bila deep reflection dipakai sembarangan.

Jadi reflection adalah alat untuk **infrastructure layer**, bukan default style untuk domain logic.

---

## 3. `Class<?>`: Root Metadata untuk Runtime Type

`Class<?>` adalah entry point utama reflection.

Ada beberapa cara mendapatkan `Class`:

```java
Class<String> a = String.class;

String text = "abc";
Class<?> b = text.getClass();

Class<?> c = Class.forName("java.lang.String");
```

Perbedaannya penting:

| Cara | Karakter |
|---|---|
| `String.class` | static, type-safe, tidak butuh instance |
| `obj.getClass()` | berdasarkan runtime object aktual |
| `Class.forName(name)` | dynamic lookup by name, dapat trigger class loading/initialization tergantung overload |

Contoh:

```java
CharSequence x = "hello";

System.out.println(x.getClass());      // class java.lang.String
System.out.println(CharSequence.class); // interface java.lang.CharSequence
```

Static type `CharSequence` tidak sama dengan runtime class `String`.

Ini penting untuk serializer, mapper, DI, dan polymorphic processing.

---

## 4. `Class<T>` dan Kenapa Sering Pakai `Class<?>`

`Class<T>` generic karena object class metadata bisa membawa informasi type literal tertentu:

```java
Class<String> stringType = String.class;
```

Tapi dalam banyak API reflection, type belum diketahui:

```java
void inspect(Class<?> type) {
    System.out.println(type.getName());
}
```

`Class<?>` berarti:

> “Sebuah class metadata dari type apa pun, saya tidak tahu T-nya, dan saya tidak akan memperlakukan object ini seolah-olah tahu T.”

Bandingkan:

```java
Class raw = String.class;      // raw type, hindari
Class<?> safe = String.class;  // lebih benar
```

Raw `Class` menghilangkan type safety dan dapat memicu unchecked warning.

---

## 5. Class Identity: Nama Class Tidak Cukup

Dalam Java, class identity bukan hanya fully qualified name.

Secara praktis:

```text
class identity = class name + defining class loader
```

Dalam modular/runtime kompleks, dua class dengan nama sama bisa berbeda jika dimuat oleh classloader berbeda.

Contoh konseptual:

```text
loaderA loads com.example.Plugin
loaderB loads com.example.Plugin
```

Meskipun namanya sama, bagi JVM itu bisa menjadi dua runtime class berbeda.

Konsekuensi:

- cast dapat gagal walaupun nama class sama;
- framework plugin dapat mengalami `ClassCastException` misterius;
- cache metadata harus memperhitungkan classloader lifecycle;
- static singleton per classloader, bukan selalu global process-wide;
- reflection cache yang menyimpan `Class<?>` terlalu lama dapat menyebabkan classloader leak.

Anti-pattern:

```java
static final Map<String, Metadata> CACHE = new ConcurrentHashMap<>();
```

Lebih aman:

```java
static final ClassValue<Metadata> CACHE = new ClassValue<>() {
    @Override
    protected Metadata computeValue(Class<?> type) {
        return Metadata.from(type);
    }
};
```

`ClassValue` cocok untuk metadata per-class dan lebih classloader-aware dibanding global map manual.

---

## 6. Metadata Dasar dari `Class<?>`

Contoh:

```java
record CustomerId(String value) {}

sealed interface CaseCommand permits SubmitCase, ApproveCase {}
record SubmitCase(String caseId) implements CaseCommand {}
record ApproveCase(String caseId, String approverId) implements CaseCommand {}
```

Inspection:

```java
static void inspectType(Class<?> type) {
    System.out.println("name=" + type.getName());
    System.out.println("simpleName=" + type.getSimpleName());
    System.out.println("canonicalName=" + type.getCanonicalName());
    System.out.println("package=" + type.getPackageName());
    System.out.println("module=" + type.getModule().getName());
    System.out.println("interface=" + type.isInterface());
    System.out.println("record=" + type.isRecord());
    System.out.println("enum=" + type.isEnum());
    System.out.println("array=" + type.isArray());
    System.out.println("primitive=" + type.isPrimitive());
    System.out.println("sealed=" + type.isSealed());
}
```

`Class<?>` dapat menjawab banyak pertanyaan:

| API | Makna |
|---|---|
| `getName()` | binary/internal-facing name |
| `getSimpleName()` | nama pendek |
| `getCanonicalName()` | canonical Java name, bisa `null` untuk anonymous/local tertentu |
| `getPackageName()` | package name |
| `getModule()` | module tempat class berada |
| `getSuperclass()` | superclass langsung |
| `getInterfaces()` | interface langsung |
| `getModifiers()` | modifier encoded sebagai int |
| `isInterface()` | apakah interface |
| `isAnnotation()` | apakah annotation interface |
| `isEnum()` | apakah enum |
| `isRecord()` | apakah record |
| `isSealed()` | apakah sealed |
| `isArray()` | apakah array class |
| `isPrimitive()` | apakah primitive class literal |
| `isAnonymousClass()` | anonymous class |
| `isLocalClass()` | local class |
| `isMemberClass()` | member/nested class |
| `getEnclosingClass()` | enclosing class untuk local/anonymous/member tertentu |
| `getDeclaringClass()` | declaring class untuk member class |
| `getNestHost()` | nest host |
| `getNestMembers()` | nest members |

---

## 7. `getName`, `getCanonicalName`, `getSimpleName`: Jangan Salah Pilih

Contoh:

```java
class Outer {
    static class Nested {}
}
```

Inspection:

```java
System.out.println(Outer.Nested.class.getName());
System.out.println(Outer.Nested.class.getCanonicalName());
System.out.println(Outer.Nested.class.getSimpleName());
```

Output konseptual:

```text
com.example.Outer$Nested
com.example.Outer.Nested
Nested
```

Perbedaan:

| Method | Cocok untuk |
|---|---|
| `getName()` | binary name, class loading, logs teknis |
| `getCanonicalName()` | nama Java yang lebih human-readable, bisa null |
| `getSimpleName()` | UI/log pendek, tapi tidak unik |

Jangan menyimpan identity bisnis berdasarkan `getSimpleName()`.

Contoh buruk:

```java
String handlerKey = handler.getClass().getSimpleName();
```

Masalah:

- collision antar package;
- anonymous/lambda class nama tidak stabil;
- refactor rename merusak behavior;
- obfuscation dapat mengubah nama.

Lebih baik gunakan explicit stable key:

```java
interface CommandHandler {
    String commandType();
}
```

atau annotation dengan stable value:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
@interface HandlesCommand {
    String value();
}
```

---

## 8. Public vs Declared Members

Reflection API sering punya pasangan method:

- `getMethods()` vs `getDeclaredMethods()`;
- `getFields()` vs `getDeclaredFields()`;
- `getConstructors()` vs `getDeclaredConstructors()`;
- `getClasses()` vs `getDeclaredClasses()`.

Mental model:

| API | Mengembalikan |
|---|---|
| `getMethods()` | public methods, termasuk inherited public methods |
| `getDeclaredMethods()` | semua method yang dideklarasikan langsung di class itu, termasuk private/protected/package-private/public, tidak termasuk inherited |
| `getFields()` | public fields, termasuk inherited public fields |
| `getDeclaredFields()` | semua field yang dideklarasikan langsung di class itu |
| `getConstructors()` | public constructors |
| `getDeclaredConstructors()` | semua constructors yang dideklarasikan langsung |

Contoh:

```java
class Base {
    public void inheritedPublic() {}
    private void basePrivate() {}
}

class Child extends Base {
    private String id;
    public void ownPublic() {}
    private void ownPrivate() {}
}
```

`Child.class.getMethods()` akan melihat `ownPublic`, `inheritedPublic`, dan method public dari `Object`.

`Child.class.getDeclaredMethods()` hanya melihat method yang dideklarasikan di `Child`, termasuk `ownPrivate`, tapi tidak melihat `inheritedPublic`.

Kesalahan umum:

```java
for (Method m : type.getMethods()) {
    // mengira hanya method domain class sendiri
}
```

Padahal method dari `Object`, superclass, dan interface public juga masuk.

Untuk framework scanner, biasanya lebih baik:

- gunakan `getDeclared...`;
- traverse superclass/interface secara eksplisit;
- tentukan rules sendiri;
- filter synthetic/bridge/static/private sesuai kebutuhan.

---

## 9. Inspecting Fields

Contoh domain:

```java
class CaseFile {
    private final String id;
    private CaseStatus status;
    private int version;

    CaseFile(String id, CaseStatus status) {
        this.id = id;
        this.status = status;
    }
}
```

Inspection:

```java
for (Field field : CaseFile.class.getDeclaredFields()) {
    System.out.printf(
        "name=%s type=%s genericType=%s modifiers=%s%n",
        field.getName(),
        field.getType().getName(),
        field.getGenericType().getTypeName(),
        Modifier.toString(field.getModifiers())
    );
}
```

Important APIs:

| API | Makna |
|---|---|
| `getName()` | nama field |
| `getType()` | erased/raw runtime field type sebagai `Class<?>` |
| `getGenericType()` | declared generic type sebagai `Type` |
| `getModifiers()` | modifier |
| `isSynthetic()` | generated/synthetic field |
| `getDeclaringClass()` | class tempat field dideklarasikan |
| `getAnnotations()` | annotation yang berlaku |
| `getDeclaredAnnotations()` | annotation langsung |
| `getAnnotatedType()` | type-use annotation metadata |

Perbedaan `getType()` vs `getGenericType()`:

```java
class Box {
    List<String> names;
}
```

```java
Field f = Box.class.getDeclaredField("names");

System.out.println(f.getType());        // interface java.util.List
System.out.println(f.getGenericType()); // java.util.List<java.lang.String>
```

Tapi jangan salah: generic metadata hanya tersedia karena deklarasi menyimpan signature attribute. Runtime object `new ArrayList<String>()` tidak membawa `String` sebagai runtime element type akibat erasure.

---

## 10. Field Reflection dan Encapsulation

Membaca field private dengan reflection bukan desain default yang sehat.

```java
Field field = CaseFile.class.getDeclaredField("status");
field.setAccessible(true);
Object value = field.get(caseFile);
```

Ini melewati intent encapsulation class.

Konsekuensi:

- invariant dapat dilanggar;
- final field semantics dapat terganggu;
- JPMS bisa menolak deep reflection;
- security/integrity boundary menjadi lemah;
- code menjadi coupling ke representasi internal;
- refactoring field name menjadi runtime failure.

Untuk framework infrastructure, ini kadang perlu. Untuk domain/application logic, biasanya ini smell.

Alternatif:

- gunakan public API;
- gunakan constructor/property binding yang eksplisit;
- gunakan record component;
- gunakan accessor method;
- gunakan mapper generated compile-time;
- gunakan annotation processor;
- gunakan SPI.

Rule praktis:

> Reflection terhadap private field boleh dipakai oleh infrastructure layer yang jelas ownership-nya, bukan oleh business logic untuk “shortcut”.

---

## 11. Inspecting Methods

Contoh:

```java
class CaseWorkflow {
    public void submit(String caseId) {}
    protected boolean canApprove(String userId) { return true; }
    private void audit(String action) {}
}
```

Inspection:

```java
for (Method method : CaseWorkflow.class.getDeclaredMethods()) {
    System.out.printf(
        "name=%s return=%s params=%s modifiers=%s bridge=%s synthetic=%s%n",
        method.getName(),
        method.getReturnType().getName(),
        Arrays.toString(method.getParameterTypes()),
        Modifier.toString(method.getModifiers()),
        method.isBridge(),
        method.isSynthetic()
    );
}
```

Important APIs:

| API | Makna |
|---|---|
| `getName()` | nama method |
| `getReturnType()` | erased return type |
| `getGenericReturnType()` | generic return type |
| `getParameterTypes()` | erased parameter types |
| `getGenericParameterTypes()` | generic parameter types |
| `getExceptionTypes()` | declared checked/unchecked exception classes |
| `getGenericExceptionTypes()` | generic exception metadata |
| `getModifiers()` | modifiers |
| `isBridge()` | bridge method dari compiler |
| `isSynthetic()` | method synthetic/generated compiler |
| `isVarArgs()` | varargs method |
| `isDefault()` | default method di interface |
| `getDeclaringClass()` | class/interface pemilik method |
| `getParameters()` | parameter metadata, jika tersedia |

---

## 12. Method Overload: Reflection Butuh Parameter Types

Method name saja tidak cukup.

```java
class UserService {
    void find(String username) {}
    void find(long id) {}
}
```

Reflection lookup:

```java
Method byUsername = UserService.class.getDeclaredMethod("find", String.class);
Method byId = UserService.class.getDeclaredMethod("find", long.class);
```

Anti-pattern:

```java
Method selected = Arrays.stream(type.getDeclaredMethods())
    .filter(m -> m.getName().equals("find"))
    .findFirst()
    .orElseThrow();
```

Masalah:

- overload ambiguity;
- order reflection array tidak boleh diasumsikan sebagai source order;
- bridge/synthetic method bisa ikut;
- inherited method tidak terlihat jika pakai `getDeclaredMethods()`;
- varargs bisa membingungkan.

Robust method key:

```java
record MethodKey(String name, List<Class<?>> parameterTypes) {
    static MethodKey of(Method method) {
        return new MethodKey(method.getName(), List.of(method.getParameterTypes()));
    }
}
```

---

## 13. Bridge and Synthetic Methods

Compiler Java dapat membuat method tambahan.

Contoh generics:

```java
interface Repository<T> {
    T findById(String id);
}

class UserRepository implements Repository<User> {
    @Override
    public User findById(String id) {
        return new User(id);
    }
}
```

Karena erasure, compiler dapat menghasilkan bridge method untuk menjaga polymorphism.

Reflection scanner yang tidak hati-hati dapat melihat method tambahan.

Filter umum:

```java
static boolean isBusinessMethod(Method method) {
    int mod = method.getModifiers();
    return !method.isBridge()
        && !method.isSynthetic()
        && !Modifier.isStatic(mod);
}
```

Tidak semua synthetic/bridge harus selalu diabaikan, tetapi untuk scanner business annotation atau command handler, biasanya perlu difilter.

---

## 14. Inspecting Constructors

Constructors direpresentasikan oleh `Constructor<T>`.

Contoh:

```java
class CaseCommand {
    private final String caseId;

    public CaseCommand(String caseId) {
        this.caseId = Objects.requireNonNull(caseId);
    }
}
```

Inspection:

```java
for (Constructor<?> ctor : CaseCommand.class.getDeclaredConstructors()) {
    System.out.printf(
        "constructor params=%s modifiers=%s synthetic=%s varArgs=%s%n",
        Arrays.toString(ctor.getParameterTypes()),
        Modifier.toString(ctor.getModifiers()),
        ctor.isSynthetic(),
        ctor.isVarArgs()
    );
}
```

Important APIs:

| API | Makna |
|---|---|
| `getParameterTypes()` | erased parameter types |
| `getGenericParameterTypes()` | generic parameter metadata |
| `getExceptionTypes()` | declared exception types |
| `getModifiers()` | modifiers |
| `getParameters()` | parameter metadata |
| `isVarArgs()` | varargs constructor |
| `isSynthetic()` | synthetic constructor |
| `getDeclaringClass()` | class pemilik constructor |

Constructor reflection sering dipakai oleh:

- DI container;
- serializer;
- object mapper;
- test fixture generator;
- configuration binder;
- plugin loader.

Design implication:

> Jika class didesain untuk dibuat oleh framework, constructor design adalah bagian dari public/semi-public contract.

---

## 15. Constructor Selection: Jangan Asal Ambil Constructor Pertama

Anti-pattern:

```java
Constructor<?> ctor = type.getDeclaredConstructors()[0];
```

Masalah:

- order tidak boleh dijadikan contract;
- compiler bisa menambahkan synthetic constructor;
- overloaded constructor dapat ambigu;
- non-public constructor mungkin tidak accessible;
- record canonical constructor punya pola khusus;
- framework annotation bisa menentukan constructor pilihan.

Lebih robust:

```java
static Constructor<?> selectSinglePublicConstructor(Class<?> type) {
    Constructor<?>[] ctors = type.getConstructors();
    if (ctors.length != 1) {
        throw new IllegalArgumentException(
            "Expected exactly one public constructor: " + type.getName()
        );
    }
    return ctors[0];
}
```

Atau gunakan annotation eksplisit:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.CONSTRUCTOR)
@interface InjectedConstructor {}
```

```java
static Constructor<?> selectAnnotatedConstructor(Class<?> type) {
    List<Constructor<?>> matches = Arrays.stream(type.getDeclaredConstructors())
        .filter(c -> c.isAnnotationPresent(InjectedConstructor.class))
        .toList();

    if (matches.size() != 1) {
        throw new IllegalArgumentException(
            "Expected exactly one @InjectedConstructor in " + type.getName()
        );
    }
    return matches.get(0);
}
```

Framework yang baik tidak mengandalkan kebetulan; ia punya explicit selection rule.

---

## 16. Parameter Metadata: Nama Parameter Tidak Selalu Ada

Reflection dapat membaca parameter:

```java
class Handler {
    void handle(String caseId, int version) {}
}
```

```java
Method method = Handler.class.getDeclaredMethod("handle", String.class, int.class);

for (Parameter parameter : method.getParameters()) {
    System.out.println(parameter.getName());
    System.out.println(parameter.getType());
    System.out.println(parameter.isNamePresent());
}
```

Masalah penting:

> Nama parameter hanya reliable jika class dikompilasi dengan opsi `-parameters`.

Tanpa itu, nama bisa menjadi:

```text
arg0
arg1
```

Jangan desain framework binding production yang bergantung pada parameter name tanpa memastikan compiler flag.

Lebih robust:

- pakai annotation parameter:

```java
void handle(@Param("caseId") String caseId) {}
```

- pakai record component name;
- pakai explicit schema;
- pakai generated metadata;
- fail fast saat `parameter.isNamePresent()` false.

Contoh fail-fast:

```java
static String requiredParameterName(Parameter p) {
    if (!p.isNamePresent()) {
        throw new IllegalStateException(
            "Parameter names are not available. Compile with -parameters or use explicit annotation."
        );
    }
    return p.getName();
}
```

---

## 17. Modifiers: Membaca Visibility dan Semantic Flag

Modifier disimpan sebagai integer bitmask.

```java
int modifiers = method.getModifiers();

boolean isPublic = Modifier.isPublic(modifiers);
boolean isStatic = Modifier.isStatic(modifiers);
boolean isFinal = Modifier.isFinal(modifiers);
```

Contoh utility:

```java
static boolean isCandidateHandler(Method method) {
    int mod = method.getModifiers();

    return Modifier.isPublic(mod)
        && !Modifier.isStatic(mod)
        && !method.isBridge()
        && !method.isSynthetic();
}
```

Namun modifier saja tidak cukup.

Contoh:

- `public` method di non-exported package module belum tentu accessible dari module lain;
- `public` member dalam non-public class punya visibility yang berbeda;
- nestmate access, private members, module opens, dan reflection access punya aturan tambahan;
- default interface method butuh `method.isDefault()`;
- varargs butuh `method.isVarArgs()`.

---

## 18. Annotation Metadata: Reflection sebagai Metadata Reader

Annotation sering menjadi cara framework membaca intent.

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@interface CommandHandler {
    String value();
}

class CaseHandlers {
    @CommandHandler("SUBMIT_CASE")
    public void submit(SubmitCase command) {}
}
```

Inspection:

```java
for (Method method : CaseHandlers.class.getDeclaredMethods()) {
    CommandHandler annotation = method.getAnnotation(CommandHandler.class);
    if (annotation != null) {
        System.out.println(annotation.value());
    }
}
```

Important APIs from `AnnotatedElement`:

| API | Makna |
|---|---|
| `isAnnotationPresent(A.class)` | cek annotation |
| `getAnnotation(A.class)` | ambil annotation yang berlaku |
| `getAnnotations()` | public/inherited semantics tertentu |
| `getDeclaredAnnotation(A.class)` | annotation langsung |
| `getDeclaredAnnotations()` | semua annotation langsung |
| `getAnnotationsByType(A.class)` | repeatable annotation support |

Important reminder:

> Reflection hanya dapat membaca annotation pada runtime jika retention policy adalah `RUNTIME`.

```java
@Retention(RetentionPolicy.RUNTIME)
@interface RuntimeVisible {}

@Retention(RetentionPolicy.CLASS)
@interface ClassOnly {}

@Retention(RetentionPolicy.SOURCE)
@interface SourceOnly {}
```

- `SOURCE`: hilang setelah compile;
- `CLASS`: masuk class file tetapi tidak tersedia via reflection runtime biasa;
- `RUNTIME`: tersedia via reflection.

---

## 19. Annotation Inheritance: Jangan Asumsi Semua Annotation Diwariskan

`@Inherited` hanya berlaku pada class annotation, bukan method/field annotation.

Contoh:

```java
@Inherited
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
@interface Audited {}

@Audited
class BaseService {}

class ChildService extends BaseService {}
```

```java
System.out.println(ChildService.class.isAnnotationPresent(Audited.class)); // true
```

Tapi untuk method:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@interface TransactionalOperation {}

class Base {
    @TransactionalOperation
    void execute() {}
}

class Child extends Base {
    @Override
    void execute() {}
}
```

Annotation method tidak otomatis “turun” ke overriding method.

Framework yang ingin mendukung inheritance annotation harus implement lookup sendiri:

- cek method di class aktual;
- cek overridden method di superclass;
- cek interface method;
- cek bridge method mapping;
- tentukan precedence.

Ini sulit. Karena itu annotation framework harus punya rules jelas.

---

## 20. Type-Use Annotation dan `AnnotatedType`

Annotation bukan hanya bisa ditempel ke declaration, tetapi juga ke use of type.

Contoh:

```java
@Target(ElementType.TYPE_USE)
@Retention(RetentionPolicy.RUNTIME)
@interface NonEmpty {}

class Request {
    List<@NonEmpty String> tags;
}
```

Untuk membaca annotation pada `String` di dalam `List<String>`, tidak cukup pakai `field.getAnnotations()`.

Perlu:

```java
Field field = Request.class.getDeclaredField("tags");
AnnotatedType annotatedType = field.getAnnotatedType();
```

Jika parameterized:

```java
if (annotatedType instanceof AnnotatedParameterizedType apt) {
    for (AnnotatedType arg : apt.getAnnotatedActualTypeArguments()) {
        System.out.println(Arrays.toString(arg.getAnnotations()));
    }
}
```

Ini relevan untuk:

- validation;
- static analysis;
- schema generation;
- nullability annotation;
- type-use constraints;
- API documentation generator.

---

## 21. Generic Metadata: `Type` Bukan Selalu `Class<?>`

`Class<?>` cukup untuk non-generic runtime class. Tapi generic declaration membutuhkan `Type` hierarchy.

Important interfaces/classes:

| Type | Makna |
|---|---|
| `Class<?>` | normal class/interface/primitive/array raw runtime type |
| `ParameterizedType` | `List<String>`, `Map<String, Integer>` |
| `TypeVariable<?>` | type variable seperti `T` |
| `WildcardType` | `?`, `? extends Number`, `? super User` |
| `GenericArrayType` | generic array seperti `T[]` |

Contoh:

```java
class Example<T extends Number> {
    List<String> names;
    List<? extends Number> numbers;
    T value;
    T[] values;
}
```

Inspection:

```java
for (Field field : Example.class.getDeclaredFields()) {
    Type type = field.getGenericType();
    System.out.println(field.getName() + " -> " + type + " / " + type.getClass());
}
```

Expected model:

| Field | Generic Type |
|---|---|
| `names` | `ParameterizedType` |
| `numbers` | `ParameterizedType` with `WildcardType` argument |
| `value` | `TypeVariable` |
| `values` | `GenericArrayType` |

---

## 22. Utility: Resolving Generic Types Safely

Reflection generic parsing harus defensive.

Contoh helper:

```java
static Optional<Class<?>> rawClassOf(Type type) {
    if (type instanceof Class<?> c) {
        return Optional.of(c);
    }
    if (type instanceof ParameterizedType p && p.getRawType() instanceof Class<?> c) {
        return Optional.of(c);
    }
    if (type instanceof GenericArrayType g) {
        return rawClassOf(g.getGenericComponentType())
            .map(component -> Array.newInstance(component, 0).getClass());
    }
    return Optional.empty();
}
```

Kenapa `Optional<Class<?>>`?

Karena tidak semua `Type` bisa direduksi menjadi concrete class secara aman:

- `T` belum tentu diketahui;
- `? extends Number` bukan class tunggal;
- generic array bisa kompleks;
- owner type nested generic bisa rumit.

Anti-pattern:

```java
Class<?> c = (Class<?>) field.getGenericType(); // bisa ClassCastException
```

---

## 23. Runtime Object Generic Type Tidak Bisa Disimpulkan Sembarangan

Contoh:

```java
List<String> names = new ArrayList<>();
System.out.println(names.getClass()); // class java.util.ArrayList
```

Runtime class `ArrayList` tidak menyimpan bahwa instance ini adalah `ArrayList<String>`.

Reflection bisa membaca generic info dari **declaration**:

```java
class Holder {
    List<String> names;
}
```

Tapi bukan dari object instance ordinary:

```java
Object x = new ArrayList<String>();
// x.getClass() hanya ArrayList.class
```

Framework seperti Jackson/Gson/Guice sering memakai type token/super type token untuk membawa generic metadata.

Contoh konsep:

```java
abstract class TypeRef<T> {
    private final Type type;

    protected TypeRef() {
        Type superType = getClass().getGenericSuperclass();
        if (!(superType instanceof ParameterizedType p)) {
            throw new IllegalStateException("Missing type parameter");
        }
        this.type = p.getActualTypeArguments()[0];
    }

    Type type() {
        return type;
    }
}
```

Usage:

```java
TypeRef<List<String>> ref = new TypeRef<>() {};
System.out.println(ref.type()); // java.util.List<java.lang.String>
```

Ini bekerja karena anonymous subclass menyimpan generic superclass signature.

---

## 24. Records Reflection

Record punya metadata khusus: `RecordComponent`.

Contoh:

```java
record CreateCaseRequest(String applicantId, List<String> documentIds) {}
```

Inspection:

```java
Class<CreateCaseRequest> type = CreateCaseRequest.class;

System.out.println(type.isRecord());

for (RecordComponent component : type.getRecordComponents()) {
    System.out.printf(
        "component=%s type=%s genericType=%s accessor=%s%n",
        component.getName(),
        component.getType().getName(),
        component.getGenericType().getTypeName(),
        component.getAccessor().getName()
    );
}
```

`RecordComponent` berbeda dari `Field`.

Record component menghasilkan:

- private final field;
- public accessor method;
- canonical constructor parameter;
- record component metadata.

Untuk record-aware mapper/schema generator, lebih baik membaca `getRecordComponents()` daripada menebak dari fields.

Kenapa?

- field internal bisa berubah detail;
- component adalah API record;
- component order bermakna untuk canonical constructor;
- annotation bisa berada di component, accessor, field, constructor parameter, tergantung target annotation.

---

## 25. Record Annotation Placement: Subtle but Important

Contoh:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.RECORD_COMPONENT, ElementType.FIELD, ElementType.METHOD, ElementType.PARAMETER})
@interface ColumnName {
    String value();
}

record UserRow(@ColumnName("USER_ID") String userId) {}
```

Satu annotation pada record component bisa dipropagasikan ke beberapa tempat jika target mendukungnya, tetapi rules-nya perlu dipahami.

Scanner robust harus menentukan sumber metadata:

- record component annotation;
- accessor method annotation;
- backing field annotation;
- canonical constructor parameter annotation.

Jangan campur tanpa precedence jelas.

Contoh policy:

```text
For records:
1. prefer RECORD_COMPONENT annotation;
2. fallback to accessor annotation;
3. fallback to field annotation;
4. ignore constructor parameter annotation unless binding constructor arguments.
```

Policy eksplisit menghindari konflik metadata.

---

## 26. Enum Reflection

Enum class dapat diinspeksi:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

```java
Class<CaseStatus> type = CaseStatus.class;

System.out.println(type.isEnum());
System.out.println(Arrays.toString(type.getEnumConstants()));
```

Untuk constant-specific annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.FIELD)
@interface ExternalCode {
    String value();
}

enum CaseStatus {
    @ExternalCode("D")
    DRAFT,

    @ExternalCode("S")
    SUBMITTED
}
```

Reflection:

```java
for (CaseStatus status : CaseStatus.values()) {
    Field constant = CaseStatus.class.getField(status.name());
    ExternalCode code = constant.getAnnotation(ExternalCode.class);
    System.out.println(status + " -> " + code.value());
}
```

Remember:

- enum constants are represented as public static final fields;
- `ordinal()` is not stable for persistence;
- `name()` is stable only if rename policy ketat;
- explicit code field/annotation lebih aman untuk external contract.

---

## 27. Sealed Type Reflection

Sealed class/interface dapat diinspeksi:

```java
sealed interface Decision permits Approved, Rejected, Escalated {}
record Approved(String by) implements Decision {}
record Rejected(String reason) implements Decision {}
record Escalated(String queue) implements Decision {}
```

```java
Class<Decision> type = Decision.class;

System.out.println(type.isSealed());

for (Class<?> permitted : type.getPermittedSubclasses()) {
    System.out.println(permitted.getName());
}
```

Use cases:

- schema generation for closed hierarchy;
- exhaustive documentation;
- command/result registry validation;
- test coverage generation;
- serialization subtype whitelist;
- state machine validation.

Caveat:

- sealed hierarchy tells permitted direct subclasses, not necessarily every final leaf if hierarchy has `non-sealed` branch;
- class loading/module boundaries still matter;
- subtype serialization still needs explicit mapping policy.

---

## 28. Array and Primitive Reflection

Primitive class literals:

```java
System.out.println(int.class.isPrimitive());      // true
System.out.println(Integer.class.isPrimitive());  // false
System.out.println(void.class.getName());         // void
```

Array class:

```java
Class<?> type = String[].class;
System.out.println(type.isArray());              // true
System.out.println(type.getComponentType());      // class java.lang.String
```

Multi-dimensional array:

```java
Class<?> type = int[][].class;
System.out.println(type.isArray());              // true
System.out.println(type.getComponentType());      // class [I
System.out.println(type.getComponentType().getComponentType()); // int
```

Dynamic array creation:

```java
Object array = Array.newInstance(String.class, 3);
Array.set(array, 0, "A");
System.out.println(Array.get(array, 0));
```

Use cases:

- serializer;
- generic mapper;
- schema generator;
- varargs handler;
- framework binder.

Caveat:

- primitive arrays are not `Object[]`;
- array covariance can throw `ArrayStoreException`;
- generic arrays have type erasure caveats.

---

## 29. Nested, Local, Anonymous, Lambda Reflection

Nested/member class:

```java
class Outer {
    static class StaticNested {}
    class Inner {}
}
```

Inspection:

```java
System.out.println(Outer.StaticNested.class.isMemberClass());
System.out.println(Outer.Inner.class.getDeclaringClass());
```

Anonymous class:

```java
Runnable r = new Runnable() {
    @Override public void run() {}
};

System.out.println(r.getClass().isAnonymousClass());
System.out.println(r.getClass().getCanonicalName()); // often null
```

Lambda:

```java
Runnable lambda = () -> {};
System.out.println(lambda.getClass().getName());
```

Lambda class name is implementation detail. Do not depend on it.

Anti-pattern:

```java
String key = callback.getClass().getName();
```

For lambdas, use explicit metadata:

```java
record NamedCallback(String name, Runnable action) {}
```

---

## 30. Modules and Reflection: `public` Is Not Enough

Since JPMS, access is not only about Java language modifiers.

A class/member can be `public`, but reflective access can still be blocked by module boundaries.

Important concepts:

| Concept | Meaning |
|---|---|
| `exports` | package API visible to other modules at compile/runtime |
| `opens` | package opened for deep reflection |
| qualified export/open | only specific target modules |
| unnamed module | classpath world |
| automatic module | jar on module path without descriptor |

Example `module-info.java`:

```java
module com.example.caseapp {
    exports com.example.caseapp.api;

    opens com.example.caseapp.dto to com.fasterxml.jackson.databind;
}
```

Meaning:

- `api` package is public API;
- `dto` package is not exported as compile API;
- `dto` is opened to Jackson for reflection.

This is strong design.

Bad approach:

```java
open module com.example.caseapp {
    requires com.fasterxml.jackson.databind;
}
```

This opens all packages to deep reflection. Sometimes practical, but weakens encapsulation broadly.

Better approach:

- export only API packages;
- open only DTO/entity packages needing framework reflection;
- prefer qualified opens;
- document why each open exists.

---

## 31. `AccessibleObject`, `setAccessible`, and `trySetAccessible`

`Field`, `Method`, and `Constructor` extend `AccessibleObject`.

Historically:

```java
field.setAccessible(true);
```

was used to suppress Java language access checks.

Modern Java with modules makes this more constrained.

Better defensive pattern:

```java
if (!field.canAccess(target) && !field.trySetAccessible()) {
    throw new IllegalStateException(
        "Cannot access field " + field + ". Consider opening the package or using public API."
    );
}
```

Difference:

| API | Behavior |
|---|---|
| `canAccess(obj)` | checks whether caller can access this member for given receiver |
| `trySetAccessible()` | attempts to enable access, returns false if cannot |
| `setAccessible(true)` | attempts and throws exception if fails |

Design guidance:

- prefer public access if possible;
- use `trySetAccessible()` for framework scanner with good error message;
- avoid blanket `setAccessible(true)` without module-aware diagnostics;
- fail fast during startup, not mid-request;
- expose module `opens` intentionally.

---

## 32. Reflection Performance Model

Reflection is slower than direct access if used naively, but the bigger problem is often not raw nanoseconds. The bigger problems are:

- repeated scanning;
- repeated annotation parsing;
- repeated method lookup by name;
- repeated access checks;
- allocation of metadata structures;
- no caching;
- doing reflection inside hot request loops;
- making every request rebuild mapping plans.

Bad:

```java
Object map(Object source, Class<?> targetType) {
    for (Field field : targetType.getDeclaredFields()) {
        // repeated every call
    }
    ...
}
```

Better:

```java
final class MapperPlan {
    final List<FieldMapping> mappings;
}

final class MapperPlanCache {
    private static final ClassValue<MapperPlan> CACHE = new ClassValue<>() {
        @Override
        protected MapperPlan computeValue(Class<?> type) {
            return buildPlan(type);
        }
    };

    static MapperPlan planFor(Class<?> type) {
        return CACHE.get(type);
    }
}
```

Pattern:

```text
scan once -> validate once -> build immutable plan -> execute many times
```

This is how robust frameworks should behave.

---

## 33. Reflection Caching: Cache Metadata, Not Accidents

Cache key harus tepat.

Bad:

```java
Map<String, List<Field>> fieldsByClassName = new ConcurrentHashMap<>();
```

Problems:

- same name across classloaders;
- class reloading;
- plugin unload leak;
- shaded/relocated classes;
- generated classes.

Better:

```java
ClassValue<List<Field>> fieldsByClass = new ClassValue<>() {
    @Override
    protected List<Field> computeValue(Class<?> type) {
        return Arrays.stream(type.getDeclaredFields())
            .filter(f -> !f.isSynthetic())
            .toList();
    }
};
```

For method caches that include target method signature:

```java
record MethodSignature(String name, List<Class<?>> parameterTypes) {}
```

For mapper cache:

```java
record MappingKey(Class<?> sourceType, Class<?> targetType) {}
```

But if using static map with `Class<?>`, consider lifecycle and classloader leak.

---

## 34. Reflection and Refactoring Safety

Reflection converts many compile-time errors into runtime errors.

Example:

```java
Field field = User.class.getDeclaredField("emailAddress");
```

If field renamed to `email`, compiler may not catch it.

Mitigation:

1. Use annotation rather than field name convention.
2. Use generated code.
3. Use method references when possible.
4. Add startup validation.
5. Add integration tests for scanning.
6. Fail fast with complete diagnostics.
7. Avoid stringly typed contract.

Example better metadata:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.FIELD)
@interface ExternalField {
    String value();
}

class UserDto {
    @ExternalField("email_address")
    private String email;
}
```

Still reflective, but external contract is not Java field name.

---

## 35. Reflection Scanner Design: A Production Pattern

Suppose we design a command handler scanner.

Annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@interface Handles {
    String value();
}
```

Handlers:

```java
class CaseCommandHandlers {
    @Handles("SUBMIT_CASE")
    public void submit(SubmitCase command) {}

    @Handles("APPROVE_CASE")
    public void approve(ApproveCase command) {}
}
```

Naive scanner:

```java
for (Method m : handler.getClass().getDeclaredMethods()) {
    if (m.isAnnotationPresent(Handles.class)) {
        registry.put(m.getAnnotation(Handles.class).value(), m);
    }
}
```

Robust scanner needs rules:

- method must not be synthetic;
- method must not be bridge;
- method must be instance method;
- method must have exactly one parameter;
- return type must be allowed;
- annotation value must be nonblank;
- duplicate command key must fail;
- access must be checked once at startup;
- module access error must produce actionable message;
- invocation plan must be cached;
- error should mention class, method, annotation, module.

Example:

```java
record HandlerMethod(
    String commandType,
    Object target,
    Method method,
    Class<?> commandClass
) {}
```

```java
static List<HandlerMethod> scanHandlers(Object target) {
    Class<?> type = target.getClass();
    List<HandlerMethod> result = new ArrayList<>();

    for (Method method : type.getDeclaredMethods()) {
        Handles handles = method.getDeclaredAnnotation(Handles.class);
        if (handles == null) {
            continue;
        }

        validateHandlerMethod(type, method, handles);

        if (!method.canAccess(target) && !method.trySetAccessible()) {
            throw new IllegalStateException(
                "Cannot access handler method " + method
                    + ". Open package " + type.getPackageName()
                    + " in module " + type.getModule().getName()
            );
        }

        result.add(new HandlerMethod(
            handles.value(),
            target,
            method,
            method.getParameterTypes()[0]
        ));
    }

    return List.copyOf(result);
}
```

```java
static void validateHandlerMethod(Class<?> owner, Method method, Handles handles) {
    int mod = method.getModifiers();

    if (method.isSynthetic() || method.isBridge()) {
        throw new IllegalArgumentException("Handler method must not be synthetic/bridge: " + method);
    }
    if (Modifier.isStatic(mod)) {
        throw new IllegalArgumentException("Handler method must be instance method: " + method);
    }
    if (handles.value().isBlank()) {
        throw new IllegalArgumentException("Handler command type must not be blank: " + method);
    }
    if (method.getParameterCount() != 1) {
        throw new IllegalArgumentException("Handler method must have exactly one parameter: " + method);
    }
    if (method.getReturnType() != void.class) {
        throw new IllegalArgumentException("Handler method must return void: " + method);
    }
}
```

This is reflection used responsibly.

---

## 36. Reflection Error Model

Common exceptions:

| Exception | Typical cause |
|---|---|
| `ClassNotFoundException` | dynamic class lookup failed |
| `NoSuchFieldException` | field name/signature not found |
| `NoSuchMethodException` | method/constructor signature not found |
| `IllegalAccessException` | access not allowed |
| `InvocationTargetException` | invoked method/constructor threw exception |
| `InstantiationException` | cannot instantiate abstract/interface/etc. |
| `InaccessibleObjectException` | module/access suppression denied |
| `SecurityException` | security restrictions |
| `ClassCastException` | wrong runtime class/classloader boundary |
| `LinkageError` | class linking/version conflict |
| `ExceptionInInitializerError` | class initialization failed |

Design principle:

> Do not leak low-level reflection exceptions directly to application users. Convert them into startup diagnostics or infrastructure errors with context.

Bad:

```text
java.lang.NoSuchMethodException: Foo.<init>()
```

Better:

```text
Invalid command handler com.example.Foo:
Expected exactly one public constructor or one constructor annotated with @HandlerConstructor.
Found constructors:
- Foo(String id)
- Foo(String id, Clock clock)
Fix: annotate the intended constructor or expose one public constructor.
```

Reflection-heavy systems live or die by diagnostics.

---

## 37. Reflection and Class Initialization Side Effects

Some reflective operations can trigger class loading or initialization depending on API and usage.

`Class.forName("com.example.X")` commonly triggers class initialization with the simple overload.

Prefer explicit overload when you need control:

```java
ClassLoader loader = Thread.currentThread().getContextClassLoader();
Class<?> type = Class.forName("com.example.X", false, loader);
```

The second argument controls initialization.

Why this matters:

```java
class Dangerous {
    static final Connection CONNECTION = openConnection();
}
```

A scanner that accidentally initializes classes can:

- open network connection;
- initialize logging before config;
- start thread;
- fail startup because env missing;
- cause circular initialization;
- trigger expensive work.

Rule:

> Reflection scanners should avoid triggering class initialization unless they intentionally need initialized class behavior.

Also: avoid heavy static initializers in classes that may be scanned.

---

## 38. Reflection and Security/Integrity

Reflection can undermine encapsulation when used as deep reflection.

Risks:

- reading private sensitive fields;
- mutating private state;
- bypassing validation;
- writing final fields;
- accessing JDK internals;
- breaking module boundaries;
- making code dependent on unsupported internals.

Modern Java has increasingly emphasized strong encapsulation and integrity boundaries, especially after JPMS.

Production rule:

```text
Reflection is acceptable when:
- purpose is infrastructure-level;
- boundary is explicit;
- module opens are intentional;
- metadata is cached;
- failure is startup-time and diagnostic;
- private state mutation is avoided unless framework contract requires it;
- public API alternative was considered.
```

Reflection is suspicious when:

```text
- business logic uses field names as strings;
- private fields are modified to bypass invariant;
- code scans the entire classpath per request;
- code depends on generated/lambda class names;
- module opens everything to everyone;
- tests rely on reflection to mutate internals instead of testing behavior.
```

---

## 39. Reflection vs Annotation Processing vs Code Generation

Reflection is runtime metadata processing.

Annotation processing is compile-time metadata processing.

Code generation can happen compile-time, build-time, or runtime.

Decision matrix:

| Requirement | Better choice |
|---|---|
| Need dynamic plugin discovery | Reflection / ServiceLoader |
| Need fastest DTO mapping | Generated code |
| Need compile-time validation | Annotation processor |
| Need runtime annotation behavior | Reflection |
| Need avoid module opens | Public API / generated code / annotation processor |
| Need support arbitrary user classes | Reflection plus metadata cache |
| Need refactoring safety | Generated code / compiler plugin / annotation processor |
| Need low startup overhead | Build-time metadata/index |

Reflection is flexible but late-bound.

Generated code is explicit and fast but more complex to maintain.

Annotation processing catches more errors early but has build integration complexity.

Top engineer does not ask:

> “Can reflection do this?”

They ask:

> “Should this be discovered at runtime, generated at build time, or enforced at compile time?”

---

## 40. Reflection and Framework Boundaries

Frameworks often need reflection, but application code should not blindly inherit that style.

Examples:

### 40.1 Serializer Boundary

Serializer may need:

- record components;
- getters;
- fields;
- constructors;
- annotations;
- generic type info.

Application code should expose stable DTO shape.

### 40.2 DI Boundary

DI container may inspect constructors/annotations.

Application code should avoid constructor ambiguity and hidden cycles.

### 40.3 ORM Boundary

ORM may inspect fields/getters and mutate proxies.

Domain code should understand proxy/equality/lazy loading pitfalls.

### 40.4 Validation Boundary

Validator reads annotations and type-use metadata.

Application code should not encode complex business workflow purely as annotation magic.

### 40.5 Test Boundary

Test framework scans methods and annotations.

Application tests should prefer public behavior; reflection in tests can be acceptable for infrastructure components but harmful if it locks internal representation.

---

## 41. Practical Metadata Scanner Example: Record Schema Generator

Goal: generate a simple schema from record components.

```java
record FieldSchema(String name, String type, boolean required) {}
record TypeSchema(String name, List<FieldSchema> fields) {}
```

Annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.RECORD_COMPONENT)
@interface Required {}
```

DTO:

```java
record CreateCaseRequest(
    @Required String applicantId,
    List<String> documentIds,
    int priority
) {}
```

Generator:

```java
static TypeSchema schemaOf(Class<?> type) {
    if (!type.isRecord()) {
        throw new IllegalArgumentException("Expected record type: " + type.getName());
    }

    List<FieldSchema> fields = Arrays.stream(type.getRecordComponents())
        .map(component -> new FieldSchema(
            component.getName(),
            component.getGenericType().getTypeName(),
            component.isAnnotationPresent(Required.class)
        ))
        .toList();

    return new TypeSchema(type.getName(), fields);
}
```

This uses record metadata rather than private fields.

Better because:

- aligned with record API;
- stable for transparent carrier;
- no private field access;
- no module `opens` required for public record component methods/metadata;
- easier to document.

---

## 42. Practical Metadata Scanner Example: Sealed Result Documentation

Given:

```java
sealed interface SubmitResult permits SubmitResult.Accepted, SubmitResult.Rejected {
    record Accepted(String caseId) implements SubmitResult {}
    record Rejected(String reasonCode, String message) implements SubmitResult {}
}
```

Scanner:

```java
static void printSealedHierarchy(Class<?> root) {
    if (!root.isSealed()) {
        throw new IllegalArgumentException("Not sealed: " + root.getName());
    }

    System.out.println("Root: " + root.getName());
    for (Class<?> subtype : root.getPermittedSubclasses()) {
        System.out.println("- " + subtype.getName());
        if (subtype.isRecord()) {
            for (RecordComponent c : subtype.getRecordComponents()) {
                System.out.println("  - " + c.getName() + ": " + c.getGenericType().getTypeName());
            }
        }
    }
}
```

Use cases:

- API documentation;
- command/result registry;
- test data generator;
- schema generator;
- exhaustive handler validation.

---

## 43. Practical Metadata Scanner Example: Package Boundary Check

You can use reflection to enforce architectural conventions in tests.

Example rule:

> `..internal..` classes must not be public API.

```java
static void assertNoPublicInternalTypes(List<Class<?>> classes) {
    for (Class<?> type : classes) {
        if (type.getPackageName().contains(".internal")
            && Modifier.isPublic(type.getModifiers())) {
            throw new AssertionError("Internal type must not be public: " + type.getName());
        }
    }
}
```

In real systems, classpath scanning library or build-time analysis may be needed, because JDK reflection does not directly “list all classes in a package” reliably across classpath/module path/jars.

Important limitation:

> Reflection can inspect classes you already know or load. It is not a universal classpath indexer by itself.

For scanning many classes, consider:

- build-time index;
- annotation processor;
- explicit registration;
- `ServiceLoader`;
- classpath scanning library with module awareness;
- generated metadata.

---

## 44. Limitations of Reflection

Reflection cannot solve everything.

Key limitations:

1. It cannot recover erased runtime generic type of arbitrary object instance.
2. It cannot reliably list all classes in a package without external scanning/indexing.
3. It cannot bypass JPMS strong encapsulation unless package is opened or access allowed.
4. It cannot guarantee source order of fields/methods as business contract.
5. It cannot make string-based member names refactoring-safe.
6. It can expose synthetic/bridge/generated artifacts if not filtered.
7. It can trigger class loading/initialization side effects.
8. It can be blocked by native image closed-world constraints unless configured.
9. It can create classloader leaks if metadata caches are careless.
10. It can make domain code obscure if used outside infrastructure layer.

---

## 45. Reflection in Native Image / AOT Context

In closed-world/AOT environments, reflection becomes more constrained because runtime metadata may need to be declared ahead of time.

Even if your main runtime is standard JVM, design reflection-heavy code with this awareness:

- prefer compile-time metadata generation;
- centralize reflection usage;
- avoid ad-hoc reflection scattered everywhere;
- expose clear list of reflectively accessed types/members;
- use public constructors/accessors where possible;
- fail fast if metadata unavailable.

This is one reason modern frameworks increasingly invest in:

- build-time indexing;
- annotation processing;
- generated code;
- explicit runtime hints;
- module-aware metadata.

---

## 46. Good Reflection API Design Principles

If you are building a reflective library/framework, use these principles.

### 46.1 Make discovery explicit

Bad:

```text
Scan everything and infer behavior from names.
```

Better:

```text
Scan specific packages/types and require annotation/registration.
```

### 46.2 Fail fast

Do not discover invalid reflective metadata in the middle of request handling.

### 46.3 Cache immutable plans

Reflection scanning should be startup/build-time behavior, not hot-path behavior.

### 46.4 Do not depend on reflection ordering

Sort explicitly if stable order matters:

```java
methods.stream()
    .sorted(Comparator.comparing(Method::getName)
        .thenComparing(m -> Arrays.toString(m.getParameterTypes())))
```

### 46.5 Filter compiler artifacts

Consider:

- synthetic;
- bridge;
- static;
- inherited;
- private;
- default;
- varargs;
- native;
- abstract.

### 46.6 Respect modules

Do not tell users to add broad `--add-opens` as first solution. Prefer module descriptor discipline.

### 46.7 Provide diagnostics

Every reflection failure should mention:

- class;
- member;
- package;
- module;
- annotation involved;
- expected shape;
- actual shape;
- recommended fix.

### 46.8 Separate metadata from execution

Good architecture:

```text
Reflection scan -> metadata model -> validated plan -> execution engine
```

Bad architecture:

```text
Every execution call performs reflection lookup and ad-hoc validation
```

---

## 47. Reflection Metadata Model Example

Instead of passing raw reflection objects everywhere, convert them into framework metadata.

```java
record CommandHandlerDefinition(
    String commandType,
    Class<?> handlerClass,
    Method method,
    Class<?> commandClass
) {}
```

Validation result:

```java
sealed interface MetadataProblem permits MetadataProblem.Error, MetadataProblem.Warning {
    String message();

    record Error(String message) implements MetadataProblem {}
    record Warning(String message) implements MetadataProblem {}
}
```

Scanner returns explicit result:

```java
record MetadataScanResult<T>(List<T> definitions, List<MetadataProblem> problems) {}
```

Benefits:

- reflection is isolated;
- easier testing;
- diagnostics are structured;
- generated documentation can reuse metadata;
- execution engine does not need to know scanning details;
- future migration to annotation processor/generated code is easier.

---

## 48. Testing Reflection Code

Reflection code needs different tests than normal business code.

Test cases:

1. valid class passes;
2. missing annotation ignored or rejected as designed;
3. duplicate annotation value rejected;
4. wrong method parameter count rejected;
5. private method behavior clear;
6. bridge/synthetic method not double-counted;
7. inherited annotation behavior defined;
8. interface default method behavior defined;
9. record component annotation read correctly;
10. generic field parsed correctly;
11. parameter name missing behavior tested;
12. module access failure diagnostic tested;
13. classloader boundary if plugin-based;
14. caching does not leak or return stale metadata;
15. ordering is deterministic if output user-visible.

Example test fixture design:

```java
final class ReflectionFixtures {
    static final class ValidHandler {
        @Handles("A")
        public void handle(String command) {}
    }

    static final class DuplicateHandler {
        @Handles("A")
        public void one(String command) {}

        @Handles("A")
        public void two(String command) {}
    }

    static final class InvalidParameterCount {
        @Handles("A")
        public void handle(String one, String two) {}
    }
}
```

Avoid tests that depend on order of `getDeclaredMethods()` unless you sort.

---

## 49. Production Checklist

Use this checklist when introducing reflection.

### 49.1 Purpose

- Is reflection truly needed?
- Could public API, annotation processor, generated code, or `ServiceLoader` be better?
- Is this infrastructure layer, not domain logic?

### 49.2 Metadata source

- Are you reading class, field, method, constructor, record component, or annotation?
- Is annotation retention `RUNTIME`?
- Do you need type-use annotations?
- Do you need generic metadata?
- Is parameter name available?

### 49.3 Access

- Are members public?
- Is package exported?
- Is package opened if deep reflection is required?
- Do you use `trySetAccessible()` with diagnostics?
- Are you avoiding broad opens?

### 49.4 Correctness

- Do you handle overloads?
- Do you filter synthetic/bridge members?
- Do you define inheritance rules?
- Do you define annotation precedence?
- Do you handle records/enums/sealed classes specially?
- Do you avoid relying on reflection order?

### 49.5 Performance

- Do you scan once?
- Do you cache immutable plans?
- Do you avoid hot-path lookup?
- Is cache classloader-safe?

### 49.6 Failure model

- Do failures happen at startup?
- Are error messages actionable?
- Do errors include class/member/module/package?
- Are low-level reflection exceptions wrapped meaningfully?

### 49.7 Evolution

- What happens if field/method is renamed?
- What happens if generic signature changes?
- What happens if module descriptor changes?
- What happens if record component changes?
- What happens if sealed hierarchy gains a subtype?

---

## 50. Mental Model Summary

Reflection adalah cara Java melihat metadata dirinya sendiri pada runtime.

Namun reflection bukan pengganti desain API yang baik.

Gunakan mental model berikut:

```text
Source code
  -> compiled class file metadata
    -> class loading
      -> Class<?> metadata object
        -> fields/methods/constructors/annotations/generic signatures/modules
          -> validated metadata model
            -> cached execution plan
              -> controlled runtime behavior
```

Reflection yang buruk:

```text
string names + private access + no validation + no cache + runtime surprise
```

Reflection yang baik:

```text
explicit metadata + module-aware access + startup validation + immutable plan + diagnostics
```

Top engineer melihat reflection bukan sebagai trik, tetapi sebagai boundary:

- boundary antara static dan dynamic;
- boundary antara source dan runtime;
- boundary antara API dan implementation;
- boundary antara framework dan application;
- boundary antara encapsulation dan controlled introspection;
- boundary antara compile-time safety dan runtime flexibility.

---

## 51. Latihan Praktis

### Latihan 1 — Type Inspector

Buat utility:

```java
TypeReport inspect(Class<?> type)
```

Report harus berisi:

- name;
- package;
- module;
- superclass;
- interfaces;
- modifiers;
- isRecord;
- isEnum;
- isSealed;
- fields;
- methods;
- constructors;
- annotations.

Tambahkan filter synthetic/bridge.

### Latihan 2 — Record Schema Generator

Buat schema generator untuk record:

```java
record Schema(String typeName, List<Property> properties) {}
record Property(String name, String typeName, boolean required) {}
```

Gunakan annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.RECORD_COMPONENT)
@interface Required {}
```

### Latihan 3 — Command Handler Scanner

Buat scanner untuk:

```java
@Handles("SUBMIT")
public void handle(SubmitCommand command) {}
```

Rules:

- exactly one parameter;
- non-static;
- non-bridge;
- non-synthetic;
- command key unique;
- fail fast with diagnostics.

### Latihan 4 — Generic Field Parser

Buat parser yang membedakan:

- `Class<?>`;
- `ParameterizedType`;
- `TypeVariable<?>`;
- `WildcardType`;
- `GenericArrayType`.

Gunakan class fixture dengan field kompleks.

### Latihan 5 — Module Access Experiment

Buat dua module:

```text
module com.example.app
module com.example.framework
```

Coba reflective access ke public class di exported package vs private field di non-opened package. Tambahkan `opens ... to ...` dan amati perbedaannya.

---

## 52. Kesalahan Umum yang Harus Dihindari

1. Mengira `getDeclaredMethods()` mengembalikan method sesuai urutan source.
2. Mengira `getMethods()` hanya method class sendiri.
3. Mengira parameter name selalu tersedia.
4. Mengira `List<String>` bisa diketahui dari instance `new ArrayList<String>()`.
5. Mengira `public` cukup di era JPMS.
6. Mengabaikan synthetic/bridge methods.
7. Menggunakan `setAccessible(true)` tanpa fallback dan diagnostics.
8. Menggunakan field name sebagai external contract.
9. Mengubah private/final field untuk bypass invariant.
10. Melakukan scan reflection per request.
11. Cache berdasarkan class name string saja.
12. Tidak mempertimbangkan classloader leak.
13. Tidak membedakan field vs record component.
14. Tidak mendefinisikan annotation inheritance/precedence.
15. Menggunakan reflection di domain logic karena malas membuat API yang benar.

---

## 53. Kapan Reflection Layak Dipakai?

Reflection layak dipakai jika:

- type tidak diketahui sampai runtime;
- framework perlu membaca annotation;
- plugin/provider perlu discovery;
- metadata runtime memang bagian dari contract;
- ada caching dan validation;
- error model jelas;
- module boundary dikelola;
- alternatif compile-time terlalu rigid.

Reflection sebaiknya dihindari jika:

- hanya untuk mengakses private field karena tidak mau membuat method;
- hanya untuk menghindari desain interface yang jelas;
- hanya untuk membuat kode terlihat generic padahal domain fixed;
- dipakai di hot path tanpa cache;
- membuat refactoring menjadi rapuh;
- mengaburkan invariant object.

---

## 54. Penutup Part 018

Di Part 018 ini kita sudah membangun fondasi reflection sebagai metadata inspection:

- `Class<?>` sebagai root metadata;
- field/method/constructor inspection;
- public vs declared member;
- modifier;
- parameter metadata;
- annotation metadata;
- generic `Type` hierarchy;
- record, enum, sealed, array, primitive, nested metadata;
- JPMS access boundary;
- `AccessibleObject`;
- performance/caching;
- scanner design;
- failure model;
- testing strategy;
- production checklist.

Reflection yang matang bukan tentang “bisa akses private field”. Reflection yang matang adalah tentang membangun dynamic infrastructure yang tetap punya:

- explicit rules;
- strong diagnostics;
- controlled access;
- cache strategy;
- module awareness;
- evolution awareness;
- clean boundary dengan domain logic.

Part berikutnya akan melanjutkan ke sisi operasional reflection:

```text
learn-java-oop-functional-reflection-codegen-modules-part-019.md
Reflection Deep Dive II: Dynamic Invocation, Proxies, Framework Mechanics
```

Di sana kita akan membahas:

- method invocation;
- constructor invocation;
- field read/write;
- `InvocationTargetException`;
- dynamic proxy;
- `InvocationHandler`;
- interface-based proxy;
- class-based proxy concept;
- DI/ORM/serializer mechanics;
- reflection invocation performance;
- proxy equality traps;
- module and access problems in proxy-based frameworks.

---

## Referensi

- Java SE 25 API, `java.lang.Class`.
- Java SE 25 API, `java.lang.reflect` package.
- Java SE 25 API, `AccessibleObject`.
- Java SE 25 API, `RecordComponent`.
- Java SE 25 API, `Parameter`.
- Java SE 25 API, `AnnotatedElement`.
- Java SE 25 API, `Type`, `ParameterizedType`, `TypeVariable`, `WildcardType`, `GenericArrayType`.
- Java Language Specification Java SE 25, sections on classes, interfaces, generics, annotations, records, enums, sealed types, and access control.
- Java Virtual Machine Specification Java SE 25, loading, linking, initialization, and class file metadata model.
- OpenJDK JEP 261, Module System.
- OpenJDK JEP 395, Records.
- OpenJDK JEP 409, Sealed Classes.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Optional, Nullability, Result Modeling, and Error Channels](./learn-java-oop-functional-reflection-codegen-modules-part-017.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Reflection Deep Dive II: Dynamic Invocation, Proxies, Framework Mechanics](./learn-java-oop-functional-reflection-codegen-modules-part-019.md)

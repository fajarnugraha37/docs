# learn-java-oop-functional-reflection-codegen-modules-part-019

# Reflection Deep Dive II: Dynamic Invocation, Proxies, Framework Mechanics

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `019`  
> Topik: Reflection dynamic invocation, constructor creation, field access, proxy mechanics, and framework design boundaries  
> Target: Java engineer yang sudah menguasai dasar Java dan ingin memahami reflection bukan sebagai “magic”, tetapi sebagai runtime mechanism yang bisa dianalisis, dibatasi, dioptimalkan, dan didesain dengan aman.

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya membahas **reflection as metadata inspection**:

- `Class<?>`
- `Field`
- `Method`
- `Constructor`
- `Parameter`
- `Annotation`
- generic metadata
- record component metadata
- sealed hierarchy metadata
- nested/local/anonymous/lambda metadata
- access boundary
- metadata caching

Part ini naik satu level: **reflection as dynamic execution**.

Artinya, kita tidak hanya bertanya:

> “Class ini punya method apa?”

Tetapi mulai bertanya:

> “Bisakah saya memanggil method itu tanpa compile-time reference?”  
> “Bisakah saya membuat object dari class yang baru diketahui saat runtime?”  
> “Bisakah saya membaca atau menulis field secara dinamis?”  
> “Bisakah saya membuat object yang kelihatannya mengimplementasikan interface, tetapi semua method call-nya saya intercept?”  
> “Bagaimana DI container, mapper, validator, serializer, ORM, mocking framework, dan AOP framework melakukan itu?”

Inilah wilayah yang sering disebut “magic” dalam framework Java.

Padahal sebenarnya bukan magic. Ia adalah kombinasi dari:

1. runtime metadata,
2. dynamic access,
3. dynamic invocation,
4. class loading,
5. proxy/generation,
6. access control,
7. caching,
8. convention,
9. explicit framework contract.

Top engineer tidak cukup hanya tahu bahwa reflection “bisa memanggil method”. Ia perlu tahu:

- kapan reflection tepat,
- kapan reflection adalah design smell,
- bagaimana failure mode-nya,
- bagaimana dampaknya ke JPMS,
- bagaimana dampaknya ke performance,
- bagaimana framework memakai reflection,
- bagaimana membuat API yang tetap eksplisit walaupun memakai reflection di bawahnya.

---

## 1. Mental Model: Reflection Dynamic Execution

Reflection dynamic execution berarti program melakukan operasi yang biasanya ditentukan compile-time, tetapi diputuskan saat runtime.

Contoh operasi compile-time biasa:

```java
User user = new User("Ayu");
String name = user.name();
user.activate();
```

Compiler tahu:

- `User` class-nya apa,
- constructor mana yang dipanggil,
- method mana yang dipanggil,
- return type-nya apa,
- parameter type-nya apa,
- apakah method accessible,
- apakah checked exception perlu ditangani.

Reflection menggeser sebagian keputusan itu ke runtime:

```java
Class<?> type = Class.forName("example.User");
Constructor<?> ctor = type.getDeclaredConstructor(String.class);
Object user = ctor.newInstance("Ayu");

Method activate = type.getDeclaredMethod("activate");
activate.invoke(user);
```

Sekarang compiler tidak lagi tahu bahwa `user` adalah `User`. Compiler hanya tahu `Object`.

Konsekuensinya:

- type safety turun,
- error bergeser dari compile-time ke runtime,
- access rule perlu dicek runtime,
- exception wrapping terjadi,
- performance perlu dipikirkan,
- observability/debuggability menjadi lebih sulit,
- framework harus membangun validation sendiri.

Reflection memberi fleksibilitas, tetapi fleksibilitas itu dibayar dengan hilangnya sebagian jaminan statis.

### Prinsip Besar

Reflection bukan cara untuk “menghindari desain”. Reflection adalah alat untuk membangun **runtime binding layer** ketika compile-time binding memang tidak cukup.

Gunakan reflection untuk:

- framework infrastructure,
- metadata-driven mapping,
- serialization/deserialization,
- DI/wiring,
- plugin discovery,
- testing utility,
- migration tooling,
- dynamic adapter,
- backward-compatible integration,
- interoperability dengan unknown types.

Jangan gunakan reflection untuk:

- business logic normal,
- mengakses private field karena malas membuat API,
- melewati invariant,
- membuat kode “fleksibel” tanpa contract,
- mengganti polymorphism yang seharusnya eksplisit,
- menambal desain buruk.

---

## 2. Dynamic Invocation Dengan `Method.invoke`

### 2.1 Normal Invocation vs Reflective Invocation

Normal invocation:

```java
class CaseService {
    void approve(String caseId) {
        System.out.println("Approved " + caseId);
    }
}

CaseService service = new CaseService();
service.approve("C-001");
```

Reflective invocation:

```java
CaseService service = new CaseService();

Method method = CaseService.class.getDeclaredMethod("approve", String.class);
method.invoke(service, "C-001");
```

Yang terjadi secara konseptual:

1. cari method metadata,
2. cek method accessible atau tidak,
3. cek receiver object cocok atau tidak,
4. cek argument count,
5. cek argument assignability/conversion terbatas,
6. jalankan method,
7. wrap exception jika method melempar exception,
8. return result sebagai `Object`.

### 2.2 Return Value

Untuk method non-void:

```java
class RiskScorer {
    int score(String caseId) {
        return 80;
    }
}

RiskScorer scorer = new RiskScorer();
Method method = RiskScorer.class.getDeclaredMethod("score", String.class);
Object result = method.invoke(scorer, "C-001");

int score = (Integer) result;
```

Return value selalu keluar sebagai `Object`.

Jika method mengembalikan primitive, result akan diboxing.

- `int` menjadi `Integer`
- `boolean` menjadi `Boolean`
- `long` menjadi `Long`

Untuk `void`, result adalah `null`.

```java
Method method = CaseService.class.getDeclaredMethod("approve", String.class);
Object result = method.invoke(service, "C-001");
System.out.println(result); // null
```

### 2.3 Static Method Invocation

Untuk static method, receiver bisa `null`:

```java
class CaseIdParser {
    static boolean isValid(String caseId) {
        return caseId != null && caseId.startsWith("C-");
    }
}

Method method = CaseIdParser.class.getDeclaredMethod("isValid", String.class);
Object result = method.invoke(null, "C-001");
```

Tetapi tetap lebih jelas jika utility normal dipanggil langsung saat compile-time. Reflection pada static method biasanya muncul di:

- framework bootstrap,
- migration runner,
- command-line tool,
- test discovery,
- annotation-driven framework,
- plugin entry point.

### 2.4 Private Method Invocation

```java
class CasePolicy {
    private boolean isEscalationRequired(int riskScore) {
        return riskScore >= 80;
    }
}

CasePolicy policy = new CasePolicy();
Method method = CasePolicy.class.getDeclaredMethod("isEscalationRequired", int.class);
method.setAccessible(true);
Object result = method.invoke(policy, 90);
```

Ini bisa bekerja pada kondisi tertentu, tetapi bukan berarti desainnya benar.

Dalam modern Java, terutama dengan JPMS, deep reflection ke member non-public dapat gagal jika package tidak dibuka (`opens`) kepada module pemanggil.

Pertanyaan desain yang harus ditanyakan:

- Mengapa method private perlu dipanggil dari luar?
- Apakah seharusnya behavior itu diekstrak ke collaborator/package-private type?
- Apakah test sedang menguji implementation detail?
- Apakah framework contract sudah eksplisit?
- Apakah module membuka package secara aman?

Private reflection adalah tool, bukan permission slip untuk merusak invariant.

---

## 3. Exception Model Pada `Method.invoke`

### 3.1 InvocationTargetException

Jika method yang dipanggil melempar exception, reflection membungkusnya dalam `InvocationTargetException`.

```java
class CaseService {
    void approve(String caseId) {
        throw new IllegalStateException("Case already closed");
    }
}

try {
    Method method = CaseService.class.getDeclaredMethod("approve", String.class);
    method.invoke(new CaseService(), "C-001");
} catch (InvocationTargetException e) {
    Throwable original = e.getCause();
    System.out.println(original.getClass());
    System.out.println(original.getMessage());
}
```

Mental model:

```text
caller
  -> Method.invoke(...)
       -> target.approve(...)
            -> throws IllegalStateException
       -> reflection wraps into InvocationTargetException
  -> caller receives InvocationTargetException
```

### 3.2 Kesalahan Umum

Kesalahan buruk:

```java
catch (Exception e) {
    throw new RuntimeException("Reflection failed", e);
}
```

Masalahnya, root cause tersembunyi di dalam `InvocationTargetException`.

Lebih baik:

```java
try {
    method.invoke(target, args);
} catch (InvocationTargetException e) {
    Throwable cause = e.getCause();
    if (cause instanceof RuntimeException runtime) {
        throw runtime;
    }
    if (cause instanceof Error error) {
        throw error;
    }
    throw new RuntimeException("Target method failed", cause);
} catch (ReflectiveOperationException e) {
    throw new IllegalStateException("Invalid reflective invocation", e);
}
```

Dalam framework, biasanya ada exception translation:

```java
final class ReflectiveCallException extends RuntimeException {
    ReflectiveCallException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Lalu framework menjaga agar user mendapat error yang punya konteks:

```text
Failed to invoke handler method:
  class: com.example.case.CaseCommandHandler
  method: approve(ApproveCaseCommand)
  argument[0]: ApproveCaseCommand[caseId=C-001]
Cause: Case already closed
```

### 3.3 Checked Exception Boundary

Reflection dapat membuat checked exception terasa seperti runtime failure, karena target exception dibungkus.

Ini penting untuk desain framework:

- apakah framework akan preserve checked exception?
- apakah checked exception akan diterjemahkan ke framework exception?
- apakah method signature plugin boleh declare checked exception?
- apakah exception type menjadi bagian contract?

Contoh SPI:

```java
public interface CasePlugin {
    PluginResult execute(PluginContext context) throws PluginException;
}
```

Walaupun implementasi dipanggil via reflection, contract exception tetap eksplisit melalui interface.

Ini jauh lebih baik daripada framework memanggil arbitrary method berdasarkan nama string tanpa contract.

---

## 4. Reflective Constructor Invocation

### 4.1 Membuat Object Dengan Constructor

```java
class CaseCommand {
    private final String caseId;

    CaseCommand(String caseId) {
        this.caseId = caseId;
    }
}

Constructor<CaseCommand> constructor = CaseCommand.class.getDeclaredConstructor(String.class);
constructor.setAccessible(true);
CaseCommand command = constructor.newInstance("C-001");
```

Constructor reflection digunakan oleh:

- JSON deserializer,
- ORM,
- DI container,
- test data factory,
- plugin loader,
- generated mapper,
- configuration binder.

### 4.2 Constructor Selection Problem

Jika class punya banyak constructor:

```java
class CaseView {
    CaseView() {}
    CaseView(String caseId) {}
    CaseView(String caseId, String status) {}
}
```

Framework perlu memilih constructor berdasarkan aturan.

Contoh strategi:

1. pilih constructor ber-annotation `@Inject`,
2. jika tidak ada, pilih single public constructor,
3. jika tidak ada, pilih no-arg constructor,
4. jika ambiguous, fail fast.

Pseudo-code:

```java
static Constructor<?> selectConstructor(Class<?> type) {
    List<Constructor<?>> injectConstructors = Arrays.stream(type.getDeclaredConstructors())
            .filter(c -> c.isAnnotationPresent(Inject.class))
            .toList();

    if (injectConstructors.size() == 1) {
        return injectConstructors.get(0);
    }
    if (injectConstructors.size() > 1) {
        throw new IllegalStateException("Multiple @Inject constructors: " + type.getName());
    }

    Constructor<?>[] publicConstructors = type.getConstructors();
    if (publicConstructors.length == 1) {
        return publicConstructors[0];
    }

    try {
        return type.getDeclaredConstructor();
    } catch (NoSuchMethodException e) {
        throw new IllegalStateException("No usable constructor: " + type.getName(), e);
    }
}
```

Top engineer melihat bahwa reflection framework bukan sekadar “ambil constructor”. Ia perlu punya deterministic selection rule.

Tanpa rule, framework menjadi unpredictable.

### 4.3 Constructor Parameter Name Problem

```java
class CaseCommand {
    CaseCommand(String caseId, String reason) {}
}
```

Reflection bisa melihat parameter, tetapi nama parameter source-level tidak selalu tersedia kecuali class dikompilasi dengan metadata parameter names.

Akibatnya framework binding berdasarkan parameter name dapat gagal atau melihat nama seperti `arg0`, `arg1`.

Solusi:

- compile dengan `-parameters`,
- gunakan annotation eksplisit,
- gunakan record component names,
- gunakan generated metadata,
- gunakan configuration convention yang jelas.

Contoh annotation eksplisit:

```java
class CaseCommand {
    CaseCommand(
            @JsonProperty("caseId") String caseId,
            @JsonProperty("reason") String reason
    ) {}
}
```

Record sering lebih framework-friendly untuk data carrier:

```java
record CaseCommand(String caseId, String reason) {}
```

Karena record punya record components sebagai bagian contract bahasa.

---

## 5. Reflective Field Access

### 5.1 Membaca Field

```java
class CaseRecord {
    private String status = "OPEN";
}

CaseRecord record = new CaseRecord();
Field field = CaseRecord.class.getDeclaredField("status");
field.setAccessible(true);
Object value = field.get(record);
```

### 5.2 Menulis Field

```java
field.set(record, "CLOSED");
```

Ini sangat powerful, tetapi berbahaya.

Kenapa?

Karena field write dapat melewati:

- constructor invariant,
- setter validation,
- domain method rule,
- defensive copy,
- event emission,
- dirty tracking,
- audit logic,
- thread-safety control.

Contoh buruk:

```java
class EnforcementCase {
    private String status;

    void close(Officer officer) {
        if (!officer.canCloseCase()) {
            throw new SecurityException("Officer cannot close case");
        }
        this.status = "CLOSED";
    }
}
```

Reflection bisa melakukan:

```java
Field status = EnforcementCase.class.getDeclaredField("status");
status.setAccessible(true);
status.set(caseObject, "CLOSED");
```

Domain invariant hancur.

### 5.3 Kapan Field Access Bisa Diterima?

Field reflection lebih masuk akal pada:

- serializer/deserializer infrastructure,
- ORM state hydration,
- test utility terbatas,
- object mapper internal,
- migration tool,
- framework adapter,
- legacy interoperability.

Tetapi pada domain/application logic biasa, field reflection hampir selalu smell.

### 5.4 Field Access vs Method Access

Prefer method/constructor when possible:

```java
// Better framework contract
new CaseCommand(caseId, reason);

// Worse unless justified
field.set(command, caseId);
```

Method/constructor menjaga invariant lebih baik.

Field access sering digunakan ketika:

- no setter,
- no public constructor,
- legacy class,
- performance mapper,
- framework harus support POJO arbitrer.

Namun semakin banyak framework mengandalkan field access, semakin besar coupling ke implementation detail.

---

## 6. Access Control, `setAccessible`, and JPMS

### 6.1 Access Check Bukan Sekadar `private`

Reflection tetap tunduk pada access control.

Ada dua level besar:

1. Java language access control:
   - public,
   - protected,
   - package-private,
   - private.
2. Module access control:
   - exported package,
   - opened package,
   - qualified export/open,
   - strong encapsulation.

Pre-Java 9, banyak framework bebas melakukan `setAccessible(true)`.

Dengan JPMS, akses deep reflection ke package non-open bisa gagal.

### 6.2 Exports vs Opens

Dalam module descriptor:

```java
module com.example.caseapp {
    exports com.example.caseapp.api;
    opens com.example.caseapp.dto to com.fasterxml.jackson.databind;
}
```

Perbedaan penting:

- `exports`: package dapat dipakai compile-time oleh module lain.
- `opens`: package dapat diakses deep reflection runtime.

Maka DTO package bisa dibuka ke serializer tanpa menjadikan semua type sebagai API compile-time.

### 6.3 Design Rule

Jangan membuka seluruh module tanpa alasan:

```java
open module com.example.caseapp {
    requires com.fasterxml.jackson.databind;
}
```

Ini memberi deep reflection access ke semua package.

Lebih baik qualified opens:

```java
module com.example.caseapp {
    opens com.example.caseapp.dto to com.fasterxml.jackson.databind;
    opens com.example.caseapp.config to spring.core;
}
```

Mental model:

```text
exports = boleh dipakai sebagai API
opens   = boleh diinspeksi/diakses secara reflective runtime
```

### 6.4 Reflection Failure Modern

Failure yang umum:

```text
java.lang.reflect.InaccessibleObjectException
Unable to make field private ... accessible:
module X does not "opens package" to module Y
```

Ini bukan bug reflection. Ini boundary module yang sedang bekerja.

Solusi bukan otomatis menambahkan `--add-opens` secara global.

Evaluasi dulu:

- apakah package memang perlu dibuka?
- kepada module siapa?
- apakah aksesnya bisa diganti public API?
- apakah generated code bisa dipakai daripada reflection?
- apakah framework configuration sudah tepat?

---

## 7. Dynamic Proxy Dengan `java.lang.reflect.Proxy`

### 7.1 Apa Itu Dynamic Proxy?

JDK dynamic proxy membuat object runtime yang mengimplementasikan satu atau lebih interface. Ketika method interface dipanggil, call tersebut dikirim ke `InvocationHandler`.

Contoh interface:

```java
interface CaseRepository {
    Optional<String> findStatus(String caseId);
}
```

Proxy:

```java
InvocationHandler handler = (proxy, method, args) -> {
    if (method.getName().equals("findStatus")) {
        String caseId = (String) args[0];
        return Optional.of("OPEN");
    }
    throw new UnsupportedOperationException(method.toString());
};

CaseRepository repository = (CaseRepository) Proxy.newProxyInstance(
        CaseRepository.class.getClassLoader(),
        new Class<?>[] { CaseRepository.class },
        handler
);

Optional<String> status = repository.findStatus("C-001");
```

Secara konseptual:

```text
repository.findStatus("C-001")
  -> proxy object receives call
  -> invocation handler invoked with:
       proxy
       Method findStatus
       Object[] { "C-001" }
  -> handler returns Optional.of("OPEN")
  -> caller receives result
```

Dokumentasi resmi `InvocationHandler` menjelaskan bahwa setiap proxy instance punya associated invocation handler, dan method invocation pada proxy akan di-encode lalu dikirim ke method `invoke` handler.

### 7.2 Proxy Hanya Untuk Interface

JDK dynamic proxy hanya membuat proxy untuk interface.

```java
Proxy.newProxyInstance(
    loader,
    new Class<?>[] { SomeInterface.class },
    handler
)
```

Jika butuh proxy class konkret, biasanya framework memakai:

- subclass generation,
- bytecode generation,
- method handle/lambda metafactory,
- build-time enhancement,
- instrumentation,
- library seperti Byte Buddy/CGLIB-style approach.

Kita akan bahas lebih detail di Part 024.

### 7.3 Handling `Object` Methods

Proxy juga menerima call seperti:

- `toString()`
- `equals(Object)`
- `hashCode()`

Jika handler tidak menangani ini, behavior bisa aneh.

Contoh handler lebih aman:

```java
InvocationHandler handler = (proxy, method, args) -> {
    if (method.getDeclaringClass() == Object.class) {
        return switch (method.getName()) {
            case "toString" -> "Proxy(CaseRepository)";
            case "hashCode" -> System.identityHashCode(proxy);
            case "equals" -> proxy == args[0];
            default -> throw new UnsupportedOperationException(method.toString());
        };
    }

    if (method.getName().equals("findStatus")) {
        return Optional.of("OPEN");
    }

    throw new UnsupportedOperationException(method.toString());
};
```

Equality proxy adalah area rawan.

Jika proxy mewakili remote service, repository, transaction boundary, atau lazy entity, `equals` harus dirancang secara sadar.

### 7.4 Exception Rules Pada Proxy

Jika target method interface declare checked exception:

```java
interface Importer {
    void importFile(String path) throws IOException;
}
```

Handler boleh throw `IOException`.

Tetapi jika handler throw checked exception yang tidak declared oleh method interface, proxy akan membungkusnya ke unchecked wrapper tertentu.

Design rule:

- Jangan jadikan handler sebagai tempat exception sembarangan.
- Ikuti method contract interface.
- Translate technical error ke domain/framework exception yang jelas.

---

## 8. Proxy Sebagai Interceptor

Dynamic proxy sangat berguna untuk cross-cutting concern.

Contoh: logging interceptor.

```java
final class LoggingInvocationHandler implements InvocationHandler {
    private final Object target;

    LoggingInvocationHandler(Object target) {
        this.target = target;
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        long start = System.nanoTime();
        try {
            Object result = method.invoke(target, args);
            long elapsed = System.nanoTime() - start;
            System.out.println(method.getName() + " succeeded in " + elapsed + " ns");
            return result;
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            long elapsed = System.nanoTime() - start;
            System.out.println(method.getName() + " failed in " + elapsed + " ns: " + cause);
            throw cause;
        }
    }
}
```

Usage:

```java
CaseRepository real = new JdbcCaseRepository();

CaseRepository proxied = (CaseRepository) Proxy.newProxyInstance(
        CaseRepository.class.getClassLoader(),
        new Class<?>[] { CaseRepository.class },
        new LoggingInvocationHandler(real)
);
```

Pattern ini adalah basis konseptual untuk:

- transaction interceptor,
- security interceptor,
- retry interceptor,
- metrics interceptor,
- tracing interceptor,
- validation interceptor,
- caching interceptor,
- lazy loading proxy,
- remote client proxy.

### 8.1 Chain of Invocation Handlers

Dalam framework nyata, biasanya ada chain:

```text
caller
  -> proxy
    -> security interceptor
      -> transaction interceptor
        -> validation interceptor
          -> tracing interceptor
            -> target method
```

Desain sederhana:

```java
interface MethodInterceptor {
    Object invoke(Invocation invocation) throws Throwable;
}

final class Invocation {
    private final Object target;
    private final Method method;
    private final Object[] args;
    private final List<MethodInterceptor> interceptors;
    private int index;

    Invocation(Object target, Method method, Object[] args, List<MethodInterceptor> interceptors) {
        this.target = target;
        this.method = method;
        this.args = args == null ? new Object[0] : args.clone();
        this.interceptors = List.copyOf(interceptors);
    }

    Object proceed() throws Throwable {
        if (index < interceptors.size()) {
            return interceptors.get(index++).invoke(this);
        }
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }

    Method method() {
        return method;
    }

    Object[] args() {
        return args.clone();
    }
}
```

Interceptor:

```java
final class TimingInterceptor implements MethodInterceptor {
    @Override
    public Object invoke(Invocation invocation) throws Throwable {
        long start = System.nanoTime();
        try {
            return invocation.proceed();
        } finally {
            long elapsed = System.nanoTime() - start;
            System.out.println(invocation.method().getName() + " took " + elapsed + " ns");
        }
    }
}
```

Ini menunjukkan bahwa AOP/proxy bukan magic. Ia hanyalah structured method call pipeline.

---

## 9. Framework Mechanics: Dependency Injection Container

### 9.1 Apa Yang DI Container Lakukan?

Sederhana sekali:

1. temukan classes,
2. baca metadata annotation,
3. pilih constructor,
4. resolve dependency,
5. instantiate object,
6. inject dependency jika perlu,
7. apply lifecycle callback,
8. possibly wrap object dengan proxy,
9. simpan object di registry/scope.

### 9.2 Mini DI Container Concept

Annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
@interface Component {}

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.CONSTRUCTOR)
@interface Inject {}
```

Service:

```java
@Component
final class CasePolicy {
    boolean canApprove(String status) {
        return "OPEN".equals(status);
    }
}

@Component
final class CaseService {
    private final CasePolicy policy;

    @Inject
    CaseService(CasePolicy policy) {
        this.policy = policy;
    }
}
```

Simplified container:

```java
final class SimpleContainer {
    private final Map<Class<?>, Object> singletons = new HashMap<>();

    <T> T getBean(Class<T> type) {
        return type.cast(singletons.computeIfAbsent(type, this::create));
    }

    private Object create(Class<?> type) {
        try {
            Constructor<?> constructor = selectConstructor(type);
            Object[] args = Arrays.stream(constructor.getParameterTypes())
                    .map(this::getBean)
                    .toArray();
            constructor.setAccessible(true);
            return constructor.newInstance(args);
        } catch (InvocationTargetException e) {
            throw new IllegalStateException("Constructor failed: " + type.getName(), e.getCause());
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot create bean: " + type.getName(), e);
        }
    }

    private Constructor<?> selectConstructor(Class<?> type) {
        List<Constructor<?>> inject = Arrays.stream(type.getDeclaredConstructors())
                .filter(c -> c.isAnnotationPresent(Inject.class))
                .toList();

        if (inject.size() == 1) return inject.get(0);
        if (inject.size() > 1) throw new IllegalStateException("Multiple @Inject constructors: " + type);

        Constructor<?>[] constructors = type.getDeclaredConstructors();
        if (constructors.length == 1) return constructors[0];

        try {
            return type.getDeclaredConstructor();
        } catch (NoSuchMethodException e) {
            throw new IllegalStateException("No deterministic constructor: " + type.getName(), e);
        }
    }
}
```

Container nyata jauh lebih kompleks, tapi mental model-nya sama.

### 9.3 DI Container Failure Modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| ambiguous constructor | terlalu banyak constructor tanpa annotation | rule eksplisit |
| circular dependency | A butuh B, B butuh A | constructor injection + cycle detection |
| missing dependency | bean tidak terdaftar | fail-fast saat startup |
| inaccessible constructor | JPMS/access boundary | explicit `opens` atau public API |
| slow startup | scanning reflection terlalu luas | index, generated metadata, caching |
| hidden dependency | field injection | prefer constructor injection |
| proxy surprise | bean yang didapat bukan concrete class | depend on interface atau documented proxy behavior |

### 9.4 Design Lesson

Reflection bukan inti DI. Inti DI adalah **dependency graph construction**.

Reflection hanya salah satu cara membaca graph tersebut.

Alternatif:

- manual wiring,
- generated wiring,
- annotation processing,
- service loader,
- configuration code,
- module descriptor services.

---

## 10. Framework Mechanics: Serializer/Deserializer

### 10.1 Apa Yang Serializer Lakukan?

Untuk object:

```java
record CaseDto(String caseId, String status) {}
```

Serializer perlu:

1. baca properties/components,
2. baca value,
3. convert ke format eksternal,
4. handle null,
5. handle nested object,
6. handle collection/map,
7. apply naming strategy,
8. apply annotation config.

Deserializer perlu:

1. baca input data,
2. resolve target type,
3. pilih constructor/factory,
4. convert raw value,
5. create object,
6. set field/property jika perlu,
7. validate missing/unknown fields.

### 10.2 Record-Friendly Deserialization

Record lebih deterministic:

```java
record CaseDto(String caseId, String status) {}
```

Framework bisa melihat:

- component name,
- component type,
- canonical constructor,
- accessor method.

Pseudo-code:

```java
static Object createRecord(Class<?> recordType, Map<String, Object> values) {
    try {
        RecordComponent[] components = recordType.getRecordComponents();

        Class<?>[] parameterTypes = Arrays.stream(components)
                .map(RecordComponent::getType)
                .toArray(Class<?>[]::new);

        Object[] args = Arrays.stream(components)
                .map(c -> values.get(c.getName()))
                .toArray();

        Constructor<?> constructor = recordType.getDeclaredConstructor(parameterTypes);
        constructor.setAccessible(true);
        return constructor.newInstance(args);
    } catch (ReflectiveOperationException e) {
        throw new IllegalStateException("Cannot create record: " + recordType.getName(), e);
    }
}
```

### 10.3 Field-Based Deserialization Risk

Class:

```java
final class CaseDto {
    private String caseId;
    private String status;
}
```

Framework dapat set field langsung, tapi:

- constructor invariant tidak jalan,
- validation tidak jalan,
- final fields sulit/berbahaya,
- object bisa berada dalam state tidak valid.

Lebih baik desain DTO agar framework contract eksplisit:

```java
record CaseDto(String caseId, String status) {
    CaseDto {
        Objects.requireNonNull(caseId);
        Objects.requireNonNull(status);
    }
}
```

---

## 11. Framework Mechanics: ORM and Lazy Proxy

ORM sering memakai reflection/proxy untuk:

- create entity,
- hydrate field dari database,
- read annotations,
- track dirty state,
- lazy-load association,
- generate query metadata,
- call lifecycle callback.

### 11.1 Lazy Proxy Concept

Misal:

```java
interface OfficerRef {
    String officerId();
    String name();
}
```

Proxy bisa menunda load:

```java
final class LazyOfficerHandler implements InvocationHandler {
    private final String officerId;
    private OfficerRef target;

    LazyOfficerHandler(String officerId) {
        this.officerId = officerId;
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        if (target == null) {
            target = loadOfficer(officerId);
        }
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }

    private OfficerRef loadOfficer(String officerId) {
        return new RealOfficer(officerId, "Officer " + officerId);
    }
}
```

### 11.2 Proxy Problem With `equals`

Entity equality bisa rusak jika satu object real dan satu object proxy.

```java
Officer real = ...;
Officer proxy = ...;

real.equals(proxy); // ?
proxy.equals(real); // ?
```

Jika equality memakai `getClass()` strict:

```java
if (o == null || getClass() != o.getClass()) return false;
```

Proxy subclass dapat gagal.

Jika equality memakai `instanceof`, inheritance issue bisa muncul.

Tidak ada jawaban universal. Yang penting:

- equality policy harus explicit,
- entity identity harus stabil,
- proxy behavior harus dipertimbangkan,
- jangan campur value-object equality dengan entity/proxy equality.

### 11.3 Lazy Loading Boundary

Lazy proxy bisa menyebabkan:

- hidden database access,
- unexpected N+1 query,
- serialization recursion,
- transaction closed error,
- performance unpredictable,
- domain object terlihat pure padahal punya I/O tersembunyi.

Top engineer tidak hanya bertanya “apakah ORM bisa”. Ia bertanya:

> “Apakah object model saya sekarang menyembunyikan remote/database effect di balik method call biasa?”

---

## 12. Framework Mechanics: Validation

Validation framework sering membaca annotation:

```java
record ApproveCaseCommand(
        @NotBlank String caseId,
        @NotBlank String reason
) {}
```

Runtime flow:

```text
validate(command)
  -> inspect class metadata
  -> inspect record components / fields / getters
  -> read annotations
  -> choose validator
  -> get value reflectively
  -> produce violations
```

Simplified validator:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.RECORD_COMPONENT})
@interface NotBlank {}

static List<String> validate(Object object) {
    Class<?> type = object.getClass();
    List<String> errors = new ArrayList<>();

    if (type.isRecord()) {
        for (RecordComponent component : type.getRecordComponents()) {
            if (component.isAnnotationPresent(NotBlank.class)) {
                try {
                    Object value = component.getAccessor().invoke(object);
                    if (!(value instanceof String s) || s.isBlank()) {
                        errors.add(component.getName() + " must not be blank");
                    }
                } catch (ReflectiveOperationException e) {
                    throw new IllegalStateException("Cannot validate " + component.getName(), e);
                }
            }
        }
    }

    return errors;
}
```

Validation framework harus hati-hati:

- jangan mutate object,
- jangan menjalankan method yang punya side effect,
- jangan validasi getter yang melakukan I/O,
- cache metadata,
- buat error path jelas,
- bedakan programmer error vs validation error.

---

## 13. Framework Mechanics: Test and Mocking

Mocking framework memakai beberapa teknik:

- JDK dynamic proxy untuk interface,
- subclass generation untuk class,
- bytecode instrumentation untuk final/static/constructor mocking tertentu,
- method interception,
- invocation recording,
- argument matching,
- verification.

Conceptual mock:

```java
interface CaseGateway {
    String statusOf(String caseId);
}

Map<String, Object> stubs = new HashMap<>();
stubs.put("statusOf:C-001", "OPEN");

CaseGateway mock = (CaseGateway) Proxy.newProxyInstance(
        CaseGateway.class.getClassLoader(),
        new Class<?>[] { CaseGateway.class },
        (proxy, method, args) -> {
            String key = method.getName() + ":" + args[0];
            return stubs.get(key);
        }
);
```

Mocking terlihat sederhana, tetapi production-grade mocking framework harus menangani:

- default return values,
- primitive return,
- void method,
- equals/hashCode/toString,
- checked exception compatibility,
- generic method,
- varargs,
- default method,
- final class,
- bridge method,
- concurrency,
- classloader,
- JPMS access.

Testing design lesson:

Jika butuh terlalu banyak reflection/mocking untuk test, mungkin desain production terlalu sulit diobservasi.

---

## 14. Reflection Performance Model

Reflection lebih mahal daripada direct call, terutama jika:

- method lookup dilakukan berulang,
- access check berulang,
- boxing/unboxing banyak,
- varargs array dibuat terus,
- exception wrapping sering,
- metadata scanning luas,
- no caching,
- cold startup sensitif.

### 14.1 Jangan Lookup Di Hot Path

Buruk:

```java
for (Object item : items) {
    Method method = item.getClass().getDeclaredMethod("caseId");
    Object caseId = method.invoke(item);
}
```

Lebih baik:

```java
Method method = type.getDeclaredMethod("caseId");
method.setAccessible(true);

for (Object item : items) {
    Object caseId = method.invoke(item);
}
```

Lebih baik lagi jika sangat hot:

- MethodHandle,
- generated accessor,
- annotation processing,
- direct interface contract,
- precomputed mapper.

### 14.2 Cache Metadata, Bukan Blind Cache Object

Cache key harus hati-hati:

```java
record MethodKey(Class<?> type, String name, List<Class<?>> parameterTypes) {}
```

ClassLoader-sensitive systems harus sadar bahwa `Class<?>` identity tergantung classloader.

```text
same fully qualified name + different classloader = different Class object
```

Maka cache global static bisa menyebabkan classloader leak di application server/plugin system.

### 14.3 Caching With ClassValue

`ClassValue` sering berguna untuk metadata per class:

```java
final class PropertyModelCache {
    private static final ClassValue<List<Method>> ACCESSORS = new ClassValue<>() {
        @Override
        protected List<Method> computeValue(Class<?> type) {
            return Arrays.stream(type.getMethods())
                    .filter(m -> m.getParameterCount() == 0)
                    .filter(m -> m.getName().startsWith("get") || m.getName().startsWith("is"))
                    .toList();
        }
    };

    static List<Method> accessorsOf(Class<?> type) {
        return ACCESSORS.get(type);
    }
}
```

`ClassValue` membantu mengaitkan computed metadata dengan lifecycle class.

---

## 15. Reflection vs MethodHandle vs Generated Code

| Approach | Kelebihan | Kekurangan | Cocok Untuk |
|---|---|---|---|
| Reflection | simple, universal, metadata rich | slower, less type-safe, exception wrapping | framework bootstrap, low/medium frequency dynamic access |
| MethodHandle | more JVM-friendly, composable, lower-level | harder API, exact type discipline | hot dynamic invocation, runtime language, optimized framework path |
| Generated source | type-safe after generation, readable output | build complexity, regeneration issue | mappers, clients, DTO binding, DSL |
| Generated bytecode | fast, flexible, runtime generation | debugging harder, JPMS/classloader issue | proxy, ORM, AOP, high-performance framework |
| Direct interface | safest, clearest | less dynamic | business logic and stable extension contracts |

Design rule:

- Untuk business logic: prefer direct call/interface.
- Untuk framework metadata: reflection acceptable.
- Untuk hot dynamic path: consider MethodHandle/generated code.
- Untuk stable compile-time model: annotation processor/source generation.
- Untuk runtime interception: proxy/bytecode generation.

Part 020 akan membahas `MethodHandle` dan `VarHandle` lebih dalam.

Part 023–024 akan membahas code generation dan bytecode/proxy/instrumentation lebih dalam.

---

## 16. Reflection Boundary in API Design

### 16.1 Jangan Paksa User Menebak Convention

Buruk:

```java
// Framework magically calls method named "handle"
class ApproveCaseHandler {
    void handle(ApproveCaseCommand command) {}
}
```

Jika convention tidak terdokumentasi, user bingung:

- boleh private?
- boleh return value?
- boleh checked exception?
- boleh overload?
- boleh generic?
- boleh async?
- boleh multiple handle method?
- parameter boleh berapa?

Lebih baik eksplisit:

```java
interface CommandHandler<C, R> {
    R handle(C command);
}
```

Atau annotation dengan rules jelas:

```java
final class ApproveCaseHandler {
    @CommandEndpoint
    ApprovalResult approve(ApproveCaseCommand command) {
        return ...;
    }
}
```

Framework validator harus fail fast:

```text
Invalid @CommandEndpoint method ApproveCaseHandler.approve:
- method must be public or package-opened
- must have exactly one parameter
- return type must not be void
- cannot be overloaded with same command type
```

### 16.2 Reflection Should Be Behind Explicit Contract

Good framework design:

```text
User-facing contract: explicit and deterministic
Internal implementation: may use reflection
```

Bad framework design:

```text
User-facing contract: magical convention
Internal implementation: reflection
Failure: runtime surprise
```

### 16.3 Fail Fast at Startup

Reflection errors should ideally happen during bootstrap, not during first production request.

Bad:

```text
First user request after deployment fails because handler method is ambiguous.
```

Good:

```text
Application fails at startup:
Command handler configuration invalid: duplicate handler for ApproveCaseCommand.
```

Reflection-heavy systems need startup validation.

---

## 17. Reflection and Security/Invariants

Reflection can bypass normal encapsulation. Therefore, it must be treated as privileged infrastructure.

Risks:

- private data exposure,
- mutation of immutable-looking object,
- bypass validation,
- invoke internal method,
- leak secrets in logs,
- instantiate unsafe class,
- execute plugin code unexpectedly,
- open module/package too broadly.

Practical controls:

- whitelist target packages/classes,
- avoid scanning whole classpath blindly,
- validate annotation usage,
- avoid invoking arbitrary user-provided method names,
- restrict classloader/plugin boundary,
- prefer `opens ... to specific.module`,
- do not log full reflective values blindly,
- distinguish DTO reflection from domain reflection,
- avoid reflection into JDK internals,
- document generated/reflected surface.

Example package whitelist:

```java
static void assertAllowed(Class<?> type) {
    String name = type.getName();
    if (!name.startsWith("com.example.caseapp.handlers.")) {
        throw new SecurityException("Reflective access denied: " + name);
    }
}
```

---

## 18. Reflection and Observability

Reflection-heavy framework should produce diagnostics that map runtime failure back to user source concept.

Bad error:

```text
java.lang.IllegalArgumentException: argument type mismatch
```

Better error:

```text
Cannot invoke command handler.
Handler: com.example.case.ApproveCaseHandler#approve
Expected parameter: com.example.case.ApproveCaseCommand
Actual argument: com.example.case.RejectCaseCommand
Invocation source: command bus route 'approve-case'
```

Observability checklist:

- include class name,
- include method/constructor signature,
- include annotation involved,
- include module/package if access issue,
- include parameter index,
- include expected/actual type,
- unwrap `InvocationTargetException`,
- preserve original stack trace,
- avoid logging sensitive argument values,
- expose startup validation report.

---

## 19. Mini Case Study: Command Bus With Reflection

Tujuan: membuat command bus yang dispatch command ke handler method berdasarkan annotation.

### 19.1 Annotation

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@interface Handles {}
```

### 19.2 Commands

```java
sealed interface CaseCommand permits ApproveCase, RejectCase {}

record ApproveCase(String caseId, String reason) implements CaseCommand {}
record RejectCase(String caseId, String reason) implements CaseCommand {}
```

### 19.3 Handler

```java
final class CaseCommandHandler {
    @Handles
    ApprovalResult approve(ApproveCase command) {
        return new ApprovalResult(command.caseId(), "APPROVED");
    }

    @Handles
    RejectionResult reject(RejectCase command) {
        return new RejectionResult(command.caseId(), "REJECTED");
    }
}

record ApprovalResult(String caseId, String status) {}
record RejectionResult(String caseId, String status) {}
```

### 19.4 Handler Model

```java
record HandlerMethod(Object target, Method method, Class<?> commandType) {
    Object invoke(Object command) {
        try {
            return method.invoke(target, command);
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException runtime) throw runtime;
            if (cause instanceof Error error) throw error;
            throw new CommandInvocationException("Handler failed: " + method, cause);
        } catch (ReflectiveOperationException e) {
            throw new CommandInvocationException("Cannot invoke handler: " + method, e);
        }
    }
}

final class CommandInvocationException extends RuntimeException {
    CommandInvocationException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

### 19.5 Registry Builder

```java
final class CommandBus {
    private final Map<Class<?>, HandlerMethod> handlers;

    CommandBus(Collection<?> handlerObjects) {
        Map<Class<?>, HandlerMethod> discovered = new HashMap<>();

        for (Object handler : handlerObjects) {
            discover(handler, discovered);
        }

        this.handlers = Map.copyOf(discovered);
    }

    Object dispatch(Object command) {
        HandlerMethod handler = handlers.get(command.getClass());
        if (handler == null) {
            throw new IllegalArgumentException("No handler for command: " + command.getClass().getName());
        }
        return handler.invoke(command);
    }

    private static void discover(Object target, Map<Class<?>, HandlerMethod> discovered) {
        Class<?> type = target.getClass();

        for (Method method : type.getDeclaredMethods()) {
            if (!method.isAnnotationPresent(Handles.class)) continue;

            validateHandlerMethod(method);
            Class<?> commandType = method.getParameterTypes()[0];

            HandlerMethod previous = discovered.putIfAbsent(
                    commandType,
                    new HandlerMethod(target, method, commandType)
            );

            if (previous != null) {
                throw new IllegalStateException(
                        "Duplicate handler for " + commandType.getName() + ": "
                                + previous.method() + " and " + method
                );
            }
        }
    }

    private static void validateHandlerMethod(Method method) {
        if (method.getParameterCount() != 1) {
            throw new IllegalStateException("@Handles method must have exactly one parameter: " + method);
        }
        if (method.getReturnType() == void.class) {
            throw new IllegalStateException("@Handles method must return result: " + method);
        }
        method.setAccessible(true);
    }
}
```

### 19.6 Usage

```java
CommandBus bus = new CommandBus(List.of(new CaseCommandHandler()));

Object result = bus.dispatch(new ApproveCase("C-001", "All checks passed"));
System.out.println(result);
```

### 19.7 Lessons

This mini command bus demonstrates good reflection design:

- reflection used at boundary,
- user-facing contract is annotation + method rules,
- rules are validated at startup,
- invocation exception is unwrapped,
- duplicate handler fails fast,
- command type is explicit,
- runtime dispatch map is cached,
- business handler remains normal Java method.

But there are limitations:

- exact class match only, not polymorphic dispatch,
- no async support,
- no transaction/security/validation interceptor,
- no module `opens` strategy,
- no generic command type support,
- no compile-time validation,
- no generated index.

Next-level design may use annotation processing to generate registry at compile time.

---

## 20. When Reflection Becomes a Design Smell

Reflection smell indicators:

1. Business logic frequently calls `getDeclaredField` or `invoke`.
2. Private fields are mutated outside infrastructure.
3. Method names are string constants spread across codebase.
4. Runtime errors replace compile-time errors without validation.
5. Tests depend on private method reflection.
6. Framework silently ignores invalid methods.
7. Reflection scanning happens per request.
8. `setAccessible(true)` is used broadly.
9. JPMS solved by global `--add-opens` without analysis.
10. Proxy object behavior surprises equality/hash/toString.
11. Exceptions are wrapped repeatedly until root cause disappears.
12. Reflection is used where interface polymorphism would be simpler.

Refactoring direction:

| Smell | Better Direction |
|---|---|
| string method name dispatch | interface, sealed command, generated registry |
| private method testing | extract collaborator or test public behavior |
| field mutation | constructor/factory/domain method |
| per-request reflection lookup | startup scan + cache |
| broad `opens` | qualified opens package by package |
| runtime convention only | annotation processor validation |
| proxy equality surprise | explicit identity policy |
| slow reflective mapper | generated mapper or MethodHandle |

---

## 21. Practical Production Checklist

Before introducing reflection/dynamic proxy:

### Contract

- Is the user-facing contract explicit?
- Are method shape rules documented?
- Are invalid declarations rejected at startup?
- Are duplicate/ambiguous candidates detected?

### Access

- Is reflection limited to specific package/classes?
- Does JPMS require `opens`?
- Can `opens` be qualified?
- Are you avoiding illegal access into JDK internals?

### Safety

- Can reflection bypass invariant?
- Are private fields being mutated?
- Are sensitive values logged?
- Are arbitrary class names accepted from user input?

### Error Handling

- Is `InvocationTargetException` unwrapped?
- Is root cause preserved?
- Are errors diagnostic enough?
- Are programmer errors separated from user validation errors?

### Performance

- Is metadata lookup cached?
- Is reflection outside hot loop?
- Do you need MethodHandle/generated code?
- Are caches classloader-safe?

### Proxy

- Are `equals`, `hashCode`, `toString` handled?
- Are checked exceptions contract-compatible?
- Are default methods considered?
- Are proxy limitations documented?

### Architecture

- Is reflection hidden inside infrastructure layer?
- Is business logic still normal Java?
- Could annotation processing provide compile-time validation?
- Is generated code easier to debug?

---

## 22. Summary Mental Model

Reflection dynamic invocation gives Java the ability to operate on types not fully known at compile time.

It enables:

- DI containers,
- serializers,
- ORMs,
- validators,
- command buses,
- plugin systems,
- mocking frameworks,
- AOP/interceptors,
- dynamic clients,
- migration tooling.

But it weakens:

- compile-time type safety,
- encapsulation,
- static discoverability,
- performance predictability,
- error clarity,
- module boundary strictness.

The top-level engineering rule:

> Reflection should make the framework flexible, not make the application vague.

Good reflective design has:

- explicit contract,
- startup validation,
- narrow access,
- cached metadata,
- clear exception translation,
- module-aware access strategy,
- safe proxy semantics,
- business logic kept mostly reflection-free.

If reflection appears everywhere, architecture has probably lost its boundaries.

---

## 23. Key Takeaways

1. `Method.invoke` shifts errors from compile-time to runtime; use it behind validated contracts.
2. Target exceptions are wrapped in `InvocationTargetException`; always unwrap carefully.
3. Constructor reflection needs deterministic selection rules.
4. Field reflection is powerful but can bypass invariants; prefer constructor/method contracts.
5. JPMS changes reflection access: `exports` is not the same as `opens`.
6. JDK dynamic proxy works for interfaces and dispatches calls to `InvocationHandler`.
7. Proxy handlers must consciously handle `equals`, `hashCode`, and `toString`.
8. Frameworks use reflection for discovery and binding, but should fail fast at startup.
9. Reflection in hot paths needs caching or alternatives such as MethodHandle/generated code.
10. Reflection should be infrastructure detail, not ordinary business logic style.

---

## 24. Latihan Berpikir

### Latihan 1

Anda membuat command bus berbasis annotation. Apa yang harus terjadi jika dua method menangani command type yang sama?

Jawaban yang diharapkan:

- fail fast at startup,
- tampilkan dua method yang konflik,
- jangan pilih salah satu secara diam-diam.

### Latihan 2

Sebuah framework serializer gagal dengan `InaccessibleObjectException` setelah migrasi ke JPMS. Apa pertanyaan desain yang harus diajukan sebelum menambahkan `--add-opens`?

Pertanyaan:

- package mana yang butuh deep reflection?
- module framework mana yang perlu akses?
- bisakah pakai qualified `opens`?
- apakah class itu DTO atau domain internal?
- apakah constructor/public accessor cukup?

### Latihan 3

Sebuah service menggunakan reflection untuk memanggil private method dalam unit test. Apa alternatif desain yang lebih sehat?

Kemungkinan:

- test public behavior,
- extract private logic ke package-private collaborator,
- gunakan domain object dengan public behavior kecil,
- pisahkan pure function ke class/helper yang bisa diuji.

### Latihan 4

Proxy repository tidak meng-handle `toString`, `equals`, dan `hashCode`. Apa risiko yang muncul?

Risiko:

- log membingungkan,
- map/set behavior aneh,
- comparison salah,
- recursive invocation,
- stack overflow pada handler buruk,
- cache key rusak.

### Latihan 5

Reflection mapper terlalu lambat saat memproses 1 juta row. Apa langkah optimasi bertahap?

Urutan:

1. cache metadata,
2. pindahkan lookup dari loop,
3. hindari unnecessary boxing/conversion,
4. gunakan MethodHandle,
5. gunakan generated accessor/mapper,
6. evaluasi desain data pipeline.

---

## 25. Hubungan Dengan Part Berikutnya

Part ini menunjukkan bahwa reflection bisa menjalankan method/constructor/field secara dinamis dan membuat interface proxy.

Tetapi reflection bukan satu-satunya mekanisme dynamic access di Java.

Part berikutnya akan membahas:

- `MethodHandle`,
- `MethodHandles.Lookup`,
- `MethodType`,
- `invoke` vs `invokeExact`,
- binding receiver,
- private lookup,
- constructor handle,
- field getter/setter handle,
- `VarHandle`,
- access modes,
- kapan MethodHandle lebih tepat daripada reflection.

File berikutnya:

`learn-java-oop-functional-reflection-codegen-modules-part-020.md`

Topik:

**MethodHandles and VarHandles: Safer, Faster, Lower-Level Dynamic Access**

---

## 26. Status Seri

Seri belum selesai.

Saat ini selesai sampai:

`learn-java-oop-functional-reflection-codegen-modules-part-019.md`

Berikutnya:

`learn-java-oop-functional-reflection-codegen-modules-part-020.md`

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-018.md">⬅️ Reflection Deep Dive I: Class Metadata, Members, Access, and Type Inspection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-020.md">MethodHandles and VarHandles: Safer, Faster, Lower-Level Dynamic Access ➡️</a>
</div>

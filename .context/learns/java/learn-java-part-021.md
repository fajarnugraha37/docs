# learn-java-part-021.md

# Bagian 21 — Framework Internals: Kenapa Framework Java Bisa Bekerja

> Target pembaca: software engineer yang sudah memahami Java language, object model, generics, JVM internal, modules, testing, enterprise Java, dan performance dasar.
>
> Target hasil: kamu mampu membongkar “magic” framework Java seperti Spring, Hibernate, Jackson, Mockito, JUnit, APM agent, dan custom library: bagaimana mereka menemukan class, membaca metadata, membuat proxy, memanggil method, menghasilkan bytecode, melakukan instrumentation, serialization/deserialization, dan apa failure mode-nya di production.

---

## Daftar Isi

1. [Orientasi: Framework Java Bukan Magic](#1-orientasi-framework-java-bukan-magic)
2. [Mental Model Besar Framework Internals](#2-mental-model-besar-framework-internals)
3. [Reflection: Melihat dan Mengoperasikan Program saat Runtime](#3-reflection-melihat-dan-mengoperasikan-program-saat-runtime)
4. [Class Metadata dan `Class<T>`](#4-class-metadata-dan-classt)
5. [Reflective Access: Field, Method, Constructor](#5-reflective-access-field-method-constructor)
6. [Annotation: Metadata di Source/Class/Runtime](#6-annotation-metadata-di-sourceclassruntime)
7. [Annotation Processing: Code Generation Saat Compile Time](#7-annotation-processing-code-generation-saat-compile-time)
8. [Runtime Annotation Scanning](#8-runtime-annotation-scanning)
9. [Dynamic Proxy JDK](#9-dynamic-proxy-jdk)
10. [CGLIB, Byte Buddy, dan Runtime Code Generation](#10-cglib-byte-buddy-dan-runtime-code-generation)
11. [Spring AOP Proxy Internals](#11-spring-aop-proxy-internals)
12. [Class Loading, Classpath Scanning, dan Component Discovery](#12-class-loading-classpath-scanning-dan-component-discovery)
13. [Dependency Injection Container Internals](#13-dependency-injection-container-internals)
14. [Bean Lifecycle dan Post-Processing](#14-bean-lifecycle-dan-post-processing)
15. [Transaction Proxy dan Self-Invocation Bug](#15-transaction-proxy-dan-self-invocation-bug)
16. [Serialization Framework Internals: Jackson sebagai Studi Kasus](#16-serialization-framework-internals-jackson-sebagai-studi-kasus)
17. [ORM Framework Internals: Hibernate/JPA sebagai Studi Kasus](#17-orm-framework-internals-hibernatejpa-sebagai-studi-kasus)
18. [Testing Framework Internals: JUnit, Mockito, dan Test Doubles](#18-testing-framework-internals-junit-mockito-dan-test-doubles)
19. [Instrumentation dan Java Agent](#19-instrumentation-dan-java-agent)
20. [APM, OpenTelemetry Agent, dan Observability Magic](#20-apm-opentelemetry-agent-dan-observability-magic)
21. [JPMS, Strong Encapsulation, dan Framework](#21-jpms-strong-encapsulation-dan-framework)
22. [GraalVM Native Image dan AOT Constraint](#22-graalvm-native-image-dan-aot-constraint)
23. [Performance Cost Model](#23-performance-cost-model)
24. [Security Risk Model](#24-security-risk-model)
25. [Design Guidelines: Membuat Framework/Library Sendiri](#25-design-guidelines-membuat-frameworklibrary-sendiri)
26. [Debugging Playbook](#26-debugging-playbook)
27. [Anti-Patterns](#27-anti-patterns)
28. [Checklist Review Framework Usage](#28-checklist-review-framework-usage)
29. [Latihan Bertahap](#29-latihan-bertahap)
30. [Mini Project: Tiny Java Framework](#30-mini-project-tiny-java-framework)
31. [Referensi Resmi](#31-referensi-resmi)

---

# 1. Orientasi: Framework Java Bukan Magic

Framework Java tampak seperti magic karena kita menulis:

```java
@Service
@Transactional
public class CaseService {
    public void escalate(CaseId id) {
        ...
    }
}
```

Lalu tiba-tiba:

- object dibuat otomatis;
- dependency di-inject;
- method dibungkus transaksi;
- exception meng-trigger rollback;
- endpoint REST terdaftar;
- JSON dikonversi ke object;
- validation berjalan;
- metrics keluar;
- trace muncul;
- test bisa mock dependency;
- agent bisa mengukur method tanpa mengubah source code.

Namun semua itu dibangun dari mekanisme nyata:

```text
class loading
+ metadata
+ reflection
+ annotations
+ annotation processing
+ proxies
+ bytecode generation
+ instrumentation
+ serialization/deserialization
+ lifecycle hooks
+ conventions
+ caches
+ configuration
```

Framework bukan sihir. Framework adalah program Java yang membaca program Java lain dan membangun runtime behavior di atasnya.

## 1.1 Mengapa engineer perlu paham framework internals?

Karena banyak bug production di aplikasi Java modern bukan bug syntax, melainkan bug “hidden machinery”.

Contoh:

```java
@Transactional
public void outer() {
    inner();
}

@Transactional(propagation = REQUIRES_NEW)
public void inner() {
    ...
}
```

Engineer pemula berpikir `inner()` akan berjalan dalam transaksi baru. Tetapi di Spring proxy-based AOP, self-invocation seperti ini tidak melewati proxy, sehingga advice transaksi tidak terpanggil.

Contoh lain:

```java
@Service
public final class CaseService {
    @Transactional
    public void escalate() {}
}
```

Jika framework butuh subclass proxy, `final class` atau `final method` bisa menghalangi proxy.

Contoh lain:

```java
ObjectMapper mapper = new ObjectMapper();
mapper.enableDefaultTyping();
```

Polymorphic deserialization tanpa kontrol type dapat menjadi risk besar bila data tidak trusted.

Contoh lain:

```text
works on classpath
fails on module path
```

Karena reflective access yang dulu bebas sekarang terhalang strong encapsulation JPMS.

## 1.2 Framework internals sebagai mental model

Top-tier Java engineer harus bisa menjawab:

1. Kapan object asli dipakai dan kapan proxy dipakai?
2. Method mana yang bisa di-intercept?
3. Annotation dibaca saat compile-time, runtime, atau build-time?
4. Apakah framework memakai reflection, generated accessor, proxy, atau bytecode transformation?
5. Apakah metadata dicache?
6. Apakah behavior berubah di classpath vs module path?
7. Apakah behavior berubah di native image/AOT?
8. Apakah ada security risk dari reflection/deserialization?
9. Apakah stack trace menunjukkan proxy/generated class?
10. Apakah performance bottleneck ada di scanning, reflection, serialization, or instrumentation?

---

# 2. Mental Model Besar Framework Internals

Framework Java biasanya mengikuti pipeline:

```text
discover
  ↓
inspect metadata
  ↓
build model
  ↓
instantiate
  ↓
wire dependencies
  ↓
wrap/enhance
  ↓
invoke
  ↓
observe
```

## 2.1 Discover

Framework harus menemukan komponen.

Sumber discovery:

- classpath scanning;
- module scanning;
- explicit config;
- service loader;
- annotation processing generated index;
- manifest;
- configuration file;
- build-time metadata;
- runtime registration.

Contoh:

```java
@Component
class CaseService {}
```

Spring perlu menemukan class ini.

## 2.2 Inspect metadata

Framework membaca:

- class name;
- superclass;
- interfaces;
- annotations;
- generic signatures;
- constructors;
- fields;
- methods;
- parameter names;
- modifiers;
- record components;
- module/package info.

Mekanisme:

- reflection;
- class file reading;
- annotation metadata parser;
- generated metadata index;
- bytecode library.

## 2.3 Build model

Framework membangun model internal:

Spring:

```text
BeanDefinition
DependencyDescriptor
Pointcut
Advisor
ApplicationContext model
```

Jackson:

```text
BeanDescription
JavaType
JsonSerializer
JsonDeserializer
PropertyDefinition
TypeResolver
```

Hibernate:

```text
EntityPersister
Metamodel
Mapping
ProxyFactory
SessionFactory
```

JUnit:

```text
TestDescriptor
ExtensionContext
LauncherDiscoveryRequest
```

## 2.4 Instantiate

Framework membuat object:

- constructor call biasa;
- reflection constructor call;
- factory method;
- supplier;
- generated factory;
- Objenesis/constructor bypass pada kasus proxy tertentu;
- dependency injection container.

## 2.5 Wire dependencies

Framework menghubungkan object:

- constructor injection;
- field injection;
- setter injection;
- method parameter injection;
- provider/lazy injection;
- collection/map injection;
- qualifier/name resolution.

## 2.6 Wrap/enhance

Framework mungkin tidak memberikan object asli, melainkan object yang dibungkus:

```text
caller → proxy → interceptor/advice → target
```

Contoh advice:

- transaction;
- security;
- cache;
- retry;
- metrics;
- tracing;
- lazy loading;
- mock behavior;
- validation.

## 2.7 Invoke

Invocation dapat terjadi via:

- direct method call;
- reflection;
- method handle;
- dynamic proxy invocation handler;
- generated bytecode;
- CGLIB subclass override;
- Byte Buddy delegation;
- instrumentation advice;
- native call.

## 2.8 Observe

Framework/agent mengamati:

- method duration;
- exceptions;
- SQL;
- HTTP call;
- allocation;
- thread behavior;
- trace context;
- custom event.

---

# 3. Reflection: Melihat dan Mengoperasikan Program saat Runtime

Reflection memungkinkan Java code membaca informasi class/object dan mengoperasikan field/method/constructor saat runtime.

Contoh sederhana:

```java
Class<?> type = Class.forName("com.example.CaseService");

for (Method method : type.getDeclaredMethods()) {
    System.out.println(method.getName());
}
```

Framework memakai reflection untuk:

- menemukan annotation;
- membaca constructor;
- membaca field;
- membaca method;
- membuat object;
- memanggil method;
- membaca/menulis field;
- membaca generic signature;
- membaca parameter;
- membangun mapper;
- membangun validator;
- membangun dependency graph.

## 3.1 Reflection menggeser sebagian error dari compile-time ke runtime

Direct call:

```java
service.escalate(caseId);
```

Jika method tidak ada, compile gagal.

Reflective call:

```java
Method m = type.getMethod("escalate", CaseId.class);
m.invoke(service, caseId);
```

Jika method tidak ada, error runtime:

```text
NoSuchMethodException
IllegalAccessException
InvocationTargetException
```

Ini kekuatan sekaligus risiko reflection.

## 3.2 Reflection tidak mengubah Java type safety secara gratis

Reflection tetap tunduk pada:

- access control;
- module encapsulation;
- classloader identity;
- primitive/reference conversion rules tertentu;
- checked exception wrapper;
- security/integrity restriction modern Java.

Namun reflection dapat menembus banyak batas desain jika diberi akses.

Contoh:

```java
Field f = Case.class.getDeclaredField("status");
f.setAccessible(true);
f.set(caseObj, CaseStatus.CLOSED);
```

Ini bisa merusak invariant domain.

## 3.3 Reflection dan encapsulation

Di Java modern, strong encapsulation membuat reflective access lebih ketat, terutama dengan JPMS.

Jika package tidak dibuka, framework bisa gagal dengan error seperti:

```text
InaccessibleObjectException
```

Solusi sering berupa:

```bash
--add-opens module/package=target
```

atau desain module:

```java
opens com.example.domain to com.fasterxml.jackson.databind;
```

Prinsip:

> Reflection harus dianggap sebagai privileged access. Gunakan secara sadar, bukan sebagai default hammer.

---

# 4. Class Metadata dan `Class<T>`

`Class<T>` adalah runtime representation dari type yang sudah diload.

Contoh:

```java
Class<String> stringClass = String.class;
Class<?> runtimeClass = object.getClass();
Class<?> loaded = Class.forName("com.example.Case");
```

## 4.1 `Class<T>` bukan sekadar nama class

Dua class dengan nama sama bisa berbeda jika classloader berbeda.

```text
com.example.Plugin loaded by ClassLoader A
!=
com.example.Plugin loaded by ClassLoader B
```

Class identity:

```text
fully qualified name + defining classloader
```

Ini penting untuk:

- plugin system;
- application server;
- hot reload;
- test isolation;
- OSGi;
- Spring Boot devtools;
- agents;
- classloader leak.

## 4.2 Metadata yang bisa dibaca

```java
Class<?> c = CaseService.class;

c.getName();
c.getSimpleName();
c.getPackageName();
c.getSuperclass();
c.getInterfaces();
c.getModifiers();
c.getAnnotations();
c.getDeclaredFields();
c.getDeclaredMethods();
c.getDeclaredConstructors();
c.getRecordComponents();
c.getTypeParameters();
```

## 4.3 `getMethods()` vs `getDeclaredMethods()`

```java
getMethods()
```

Mengambil public methods dari class dan supertype.

```java
getDeclaredMethods()
```

Mengambil method yang dideklarasikan langsung pada class tersebut, termasuk private, tetapi tidak inherited.

Framework sering perlu keduanya.

## 4.4 Generic metadata

Karena generics Java memakai erasure, runtime type sering tidak menyimpan `List<String>` sebagai object generic biasa.

Tetapi generic signature bisa ada di metadata:

```java
Field field = MyClass.class.getDeclaredField("names");
Type type = field.getGenericType();
```

Framework seperti Jackson/Spring memakai `Type`, `ParameterizedType`, atau abstraction sendiri seperti `JavaType`/`ResolvableType` untuk mempertahankan generic information.

---

# 5. Reflective Access: Field, Method, Constructor

## 5.1 Field access

```java
Field field = Case.class.getDeclaredField("status");
field.setAccessible(true);

CaseStatus status = (CaseStatus) field.get(caseObj);
field.set(caseObj, CaseStatus.CLOSED);
```

Risiko:

- bypass constructor/invariant;
- bypass validation;
- break immutability expectation;
- access final field secara berbahaya;
- module access issue;
- performance overhead if uncached.

Framework memakai field access untuk:

- dependency injection;
- ORM hydration;
- JSON binding;
- testing utilities;
- serialization.

## 5.2 Method invocation

```java
Method method = CaseService.class.getMethod("escalate", CaseId.class);
Object result = method.invoke(caseService, caseId);
```

Jika target method melempar exception, reflection membungkusnya:

```text
InvocationTargetException
```

Kamu perlu ambil cause:

```java
try {
    method.invoke(target, args);
} catch (InvocationTargetException e) {
    throw e.getCause();
}
```

Framework harus menangani ini dengan benar agar error asli tidak hilang.

## 5.3 Constructor invocation

```java
Constructor<Case> ctor = Case.class.getDeclaredConstructor(CaseId.class);
ctor.setAccessible(true);
Case c = ctor.newInstance(caseId);
```

Framework memakai constructor selection untuk:

- dependency injection;
- DTO mapping;
- record deserialization;
- entity instantiation;
- test object creation.

## 5.4 Parameter name problem

Java tidak selalu menyimpan parameter name untuk reflection kecuali compile dengan:

```bash
-parameters
```

Tanpa itu, parameter bisa terlihat sebagai:

```text
arg0
arg1
```

Framework dapat memakai:

- `-parameters`;
- annotation seperti `@JsonProperty`;
- debug metadata;
- Kotlin metadata;
- record component metadata;
- bytecode analysis.

## 5.5 Reflection performance

Reflection lebih mahal daripada direct call, terutama jika:

- lookup dilakukan berulang;
- access check dilakukan berulang;
- argument boxing/varargs;
- no caching;
- invoked in hot path.

Framework biasanya mengurangi cost dengan:

- metadata cache;
- generated accessor;
- method handle;
- bytecode generation;
- precomputed mapping;
- build-time indexing.

Guideline:

```text
Reflection during startup/configuration: usually acceptable.
Reflection per item in hot loop: suspicious unless cached/optimized.
```

---

# 6. Annotation: Metadata di Source/Class/Runtime

Annotation adalah metadata yang melekat pada program element.

Contoh:

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Audited {
    String action();
}
```

Penggunaan:

```java
@Audited(action = "CASE_ESCALATE")
public void escalate(CaseId id) {}
```

## 6.1 Target

`@Target` menentukan annotation boleh dipakai di mana.

Contoh:

```java
@Target({
    ElementType.TYPE,
    ElementType.METHOD,
    ElementType.FIELD,
    ElementType.PARAMETER,
    ElementType.RECORD_COMPONENT
})
```

## 6.2 Retention

Retention menentukan annotation tersedia sampai tahap mana.

| Retention | Tersedia di source? | Tersedia di class file? | Tersedia runtime reflection? | Use case |
|---|---:|---:|---:|---|
| SOURCE | yes | no | no | Lombok-like processor, static analysis |
| CLASS | yes | yes | no | bytecode tools, build-time framework |
| RUNTIME | yes | yes | yes | Spring/Jackson/JUnit runtime behavior |

## 6.3 Annotation element

```java
public @interface RetryableCommand {
    int maxAttempts() default 3;
    String reason();
    Class<? extends Throwable>[] retryOn() default {};
}
```

Rules:

- element type terbatas;
- default value harus compile-time constant;
- annotation bukan tempat logic;
- annotation values harus stabil dan jelas.

## 6.4 Meta-annotation

Annotation bisa diberi annotation.

Spring memakai banyak meta-annotation.

Contoh konseptual:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface UseCase {}
```

Maka `@UseCase` membawa makna `@Component`.

## 6.5 Repeatable annotation

```java
@Repeatable(Policies.class)
public @interface Policy {
    String value();
}
```

Bisa dipakai berkali-kali.

## 6.6 Annotation design guideline

Annotation bagus untuk metadata deklaratif:

```java
@CommandHandler(type = EscalateCase.class)
```

Buruk jika menjadi bahasa mini yang terlalu kompleks:

```java
@BusinessRule(
  expression = "if status == OPEN and user.role in ... complicated script ..."
)
```

Jika logic kompleks, pindahkan ke code explicit.

---

# 7. Annotation Processing: Code Generation Saat Compile Time

Annotation processing berjalan saat compilation, melalui `javac`.

Mental model:

```text
source code
  ↓
javac parses/enters symbols
  ↓
annotation processors run in rounds
  ↓
processors inspect annotated elements
  ↓
processors may generate source/resource/class files
  ↓
new generated source may trigger next round
  ↓
compile output
```

## 7.1 Apa yang dilakukan annotation processor?

Processor bisa:

- membaca element/model source;
- membaca annotation values;
- generate Java source;
- generate resource;
- validate compile-time rule;
- emit warning/error;
- build metadata index.

Processor tidak seharusnya mengubah existing source file langsung.

## 7.2 Contoh use case

- MapStruct generate mapper;
- Lombok transform/augment AST, walau pendekatannya lebih invasive daripada processor standar;
- Dagger generate DI graph;
- AutoService generate service registration;
- QueryDSL generate Q-types;
- Immutables generate immutable classes;
- Micronaut/Quarkus/Spring AOT generate metadata/build-time wiring.

## 7.3 Processor skeleton

```java
@SupportedAnnotationTypes("com.example.CommandHandler")
@SupportedSourceVersion(SourceVersion.RELEASE_25)
public final class CommandHandlerProcessor extends AbstractProcessor {

    @Override
    public boolean process(
            Set<? extends TypeElement> annotations,
            RoundEnvironment roundEnv
    ) {
        for (Element element : roundEnv.getElementsAnnotatedWith(CommandHandler.class)) {
            // inspect element
            // validate
            // generate source/resource
        }
        return false;
    }
}
```

## 7.4 Rounds

Jika processor menghasilkan source baru, annotation processing bisa berjalan lagi untuk source baru tersebut.

Implication:

- processor harus idempotent;
- jangan generate file yang sama berkali-kali;
- handle `processingOver()`;
- handle error state;
- avoid relying on processor order unless explicit.

## 7.5 Compile-time validation

Annotation processing bisa membuat framework lebih aman.

Contoh rule:

```java
@CommandHandler
public class EscalateCaseHandler {
    // must implement CommandHandler<EscalateCase>
}
```

Processor dapat fail compilation jika rule dilanggar.

Ini lebih baik daripada runtime error setelah aplikasi deploy.

## 7.6 Runtime reflection vs annotation processing

| Aspect | Runtime reflection | Annotation processing |
|---|---|---|
| Kapan | runtime/startup | compile-time |
| Error | runtime | compile-time |
| Startup | bisa lebih lambat | bisa lebih cepat |
| Flexibility | tinggi | lebih statis |
| Native image | lebih sulit | lebih cocok |
| Dynamic plugin | cocok | kurang cocok |
| Complexity | lebih sederhana awal | tooling lebih kompleks |

## 7.7 Build impact

Annotation processor bisa memperlambat build.

Masalah umum:

- processor tidak incremental;
- scanning terlalu luas;
- generated source besar;
- processor melakukan I/O/network;
- processor order tidak jelas;
- processor compile classpath besar.

Guideline:

- processor deterministic;
- no network;
- minimal file I/O;
- incremental if possible;
- good error message;
- generated source readable;
- stable API.

---

# 8. Runtime Annotation Scanning

Runtime annotation scanning berarti framework mencari class/method/field yang punya annotation pada runtime/startup.

Contoh:

```java
for (Class<?> c : discoveredClasses) {
    if (c.isAnnotationPresent(Component.class)) {
        registerBean(c);
    }
}
```

Masalah utama:

```text
Bagaimana discoveredClasses didapat?
```

Java runtime tidak punya API sederhana “list all classes in classpath” yang portable sempurna. Framework harus membaca classpath/module path/resource/JAR.

## 8.1 Classpath scanning steps

Typical:

1. tentukan base package;
2. ubah package ke path resource;
3. cari resource di classloader;
4. baca directory/JAR entries;
5. filter `.class`;
6. baca class metadata;
7. cocokkan annotation/filter;
8. register candidate.

Contoh base package:

```java
@ComponentScan("com.example.caseapp")
```

Jika base package terlalu luas:

```text
com
```

startup bisa lambat dan risiko false positive meningkat.

## 8.2 Metadata reading tanpa load class

Framework canggih sering membaca bytecode metadata tanpa load class.

Mengapa?

- load class bisa trigger static initialization later if accessed incorrectly;
- lebih cepat untuk filtering;
- menghindari side effect;
- dapat membaca annotation metadata langsung dari class file.

Spring memakai metadata reading untuk scanning candidate components.

## 8.3 Scanning failure modes

| Failure | Penyebab |
|---|---|
| bean tidak ditemukan | package tidak masuk scan |
| startup lambat | base package terlalu luas |
| duplicate bean | class muncul dua kali di classpath |
| wrong version loaded | dependency conflict |
| ClassNotFoundException | optional dependency hilang |
| NoClassDefFoundError | class ada saat compile, hilang runtime |
| annotation tidak terbaca | retention bukan RUNTIME atau metadata tidak sesuai |
| module path issue | package tidak exported/opened |
| native image issue | reflection metadata tidak terdaftar |

## 8.4 Explicit registration vs scanning

Scanning nyaman untuk aplikasi.

Explicit registration lebih baik untuk:

- library;
- framework internal;
- performance-sensitive startup;
- native/AOT;
- deterministic behavior;
- security-sensitive environment.

Example explicit config:

```java
@Bean
CaseService caseService(CaseRepository repo) {
    return new CaseService(repo);
}
```

---

# 9. Dynamic Proxy JDK

JDK dynamic proxy dapat membuat class runtime yang mengimplementasikan interface tertentu.

Contoh:

```java
interface CaseService {
    void escalate(CaseId id);
}
```

Proxy:

```java
CaseService proxy = (CaseService) Proxy.newProxyInstance(
    CaseService.class.getClassLoader(),
    new Class<?>[] { CaseService.class },
    (Object proxyObj, Method method, Object[] args) -> {
        System.out.println("before " + method.getName());
        Object result = method.invoke(target, args);
        System.out.println("after " + method.getName());
        return result;
    }
);
```

Call:

```java
proxy.escalate(caseId);
```

Flow:

```text
caller
  ↓
proxy object implementing CaseService
  ↓
InvocationHandler.invoke(proxy, method, args)
  ↓
target method
```

## 9.1 Kelebihan JDK dynamic proxy

- built-in JDK;
- tidak perlu library tambahan;
- cocok untuk interface-based design;
- dipakai Spring AOP, Feign, MyBatis mapper, JDK internal patterns.

## 9.2 Batasan

- hanya bisa proxy interface;
- tidak bisa proxy concrete class langsung;
- method yang tidak ada di interface tidak bisa dipanggil melalui proxy interface;
- final/default/private nuance perlu dipahami;
- `equals/hashCode/toString` perlu ditangani;
- stack trace berisi generated proxy class.

## 9.3 InvocationHandler pitfalls

### 9.3.1 Infinite recursion

Buruk:

```java
(method, args) -> method.invoke(proxy, args)
```

Ini memanggil proxy lagi, bukan target.

Benar:

```java
(method, args) -> method.invoke(target, args)
```

### 9.3.2 Exception wrapping

```java
try {
    return method.invoke(target, args);
} catch (InvocationTargetException e) {
    throw e.getCause();
}
```

### 9.3.3 `Object` methods

Handle:

```java
equals
hashCode
toString
```

Jika tidak, behavior collection/logging bisa aneh.

## 9.4 JDK proxy dan generics

Generics erased. Proxy runtime hanya tahu interface raw/class metadata, bukan semua semantic generic. Framework perlu Type metadata dari method signature jika perlu.

---

# 10. CGLIB, Byte Buddy, dan Runtime Code Generation

JDK proxy hanya interface. Untuk class proxy, framework memakai runtime code generation.

## 10.1 Subclass proxy model

Target:

```java
class CaseService {
    public void escalate(CaseId id) {}
}
```

Generated subclass:

```java
class CaseService$$Proxy extends CaseService {
    @Override
    public void escalate(CaseId id) {
        interceptor.before();
        super.escalate(id);
        interceptor.after();
    }
}
```

Ini model umum CGLIB/Byte Buddy untuk class proxy.

## 10.2 Batasan subclass proxy

Tidak bisa override:

- final class;
- final method;
- private method;
- static method;
- constructor;
- method yang tidak visible.

Karena subclass proxy bekerja lewat inheritance/overriding.

## 10.3 Byte Buddy

Byte Buddy adalah library code generation/manipulation yang dapat membuat dan memodifikasi class runtime tanpa compiler source. Ia lebih umum daripada JDK proxy karena bisa membuat arbitrary class, bukan hanya interface proxy.

Dipakai oleh banyak tool:

- Mockito;
- Hibernate;
- Byte Buddy agent;
- APM instrumentation;
- testing tools;
- runtime proxy/enhancement.

## 10.4 CGLIB

CGLIB historis populer untuk subclass proxy. Dalam Spring, CGLIB direpackage di `spring-core`.

Konsep:

- generate subclass;
- override method;
- route call ke interceptor;
- instantiate proxy.

## 10.5 ASM

ASM adalah low-level bytecode manipulation library. Banyak library high-level memakai ASM di bawah.

ASM memberi kontrol tinggi tetapi kompleks dan rawan salah.

## 10.6 Generated class naming

Kamu mungkin melihat stack trace:

```text
com.example.CaseService$$SpringCGLIB$$0
jdk.proxy2.$Proxy123
com.example.CaseService$ByteBuddy$abc123
```

Ini bukan bug otomatis. Itu tanda kamu sedang berinteraksi dengan proxy/generated class.

## 10.7 Runtime generation vs compile-time generation

| Approach | Contoh | Kelebihan | Risiko |
|---|---|---|---|
| runtime generation | Spring proxy, Mockito | fleksibel | startup/runtime cost, JPMS/native issue |
| compile-time generation | MapStruct, Dagger | cepat runtime, type-safe | build complexity |
| build-time augmentation | Quarkus/Micronaut/Spring AOT | startup cepat | dynamic behavior terbatas |
| load-time instrumentation | APM agent | no source change | overhead/debug/security |

---

# 11. Spring AOP Proxy Internals

Spring AOP adalah proxy-based.

Artinya:

```text
caller harus memanggil proxy agar advice berjalan
```

Flow `@Transactional`:

```text
client bean
  ↓
transaction proxy
  ↓
TransactionInterceptor
  ↓
PlatformTransactionManager begins tx
  ↓
target method
  ↓
commit/rollback
```

## 11.1 JDK proxy vs CGLIB di Spring

Spring AOP memakai:

- JDK dynamic proxy jika target punya interface;
- CGLIB subclass proxy jika target tidak punya interface;
- CGLIB bisa dipaksa dengan `proxyTargetClass=true`.

## 11.2 Method interception boundary

Untuk JDK proxy:

```text
hanya method interface yang dipanggil via proxy yang bisa diintercept
```

Untuk CGLIB:

```text
public/protected/package-visible method tertentu bisa diintercept melalui subclass override
```

Tetapi:

- private method tidak bisa;
- final method tidak bisa;
- self-invocation tidak melewati proxy;
- constructor tidak diadvice.

## 11.3 Self-invocation bug

Contoh:

```java
@Service
public class CaseService {

    @Transactional
    public void outer(CaseId id) {
        inner(id);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void inner(CaseId id) {
        ...
    }
}
```

Saat `outer()` memanggil `this.inner()`, panggilan terjadi di object target sendiri, bukan lewat proxy. Maka advice `inner()` tidak berjalan.

Flow aktual:

```text
client → proxy.outer()
          ↓
        target.outer()
          ↓
        this.inner()
```

`this.inner()` tidak lewat proxy.

Solusi:

1. pindahkan `inner()` ke bean lain;
2. inject self proxy dengan hati-hati;
3. gunakan `TransactionTemplate`;
4. gunakan AspectJ weaving jika benar-benar butuh internal call interception;
5. ubah desain boundary transaksi.

Solusi terbaik biasanya memisahkan use case/transaction boundary secara eksplisit.

## 11.4 Annotation location

Dengan JDK proxy, annotation pada interface vs implementation bisa memengaruhi discovery bergantung framework/pointcut/resolution.

Guideline:

- untuk Spring service, letakkan annotation behavior di implementation method/class kecuali ada alasan jelas;
- desain interface sebagai API contract;
- jangan mengandalkan annotation pada private/internal method.

## 11.5 Multiple advice ordering

Method bisa dibungkus banyak advice:

```text
security
  ↓
transaction
  ↓
retry
  ↓
metrics
  ↓
target
```

Urutan penting.

Contoh:

- retry di luar transaction: setiap retry transaksi baru;
- retry di dalam transaction: satu transaksi mencakup retry, sering buruk;
- metrics di luar semua: mengukur total;
- metrics di dalam: mengukur target only.

Spring memakai ordering (`@Order`, `Ordered`) untuk advice tertentu.

## 11.6 Proxy identity

Injected bean mungkin proxy, bukan target:

```java
caseService.getClass()
```

bisa menghasilkan:

```text
CaseService$$SpringCGLIB$$0
```

Jika code melakukan:

```java
if (bean.getClass() == CaseService.class)
```

bisa gagal. Gunakan `instanceof`, interface, atau framework utility.

---

# 12. Class Loading, Classpath Scanning, dan Component Discovery

## 12.1 Class loading lifecycle

Secara ringkas:

```text
load
  ↓
link
  ↓
initialize
```

Framework discovery sebaiknya berhati-hati agar tidak menginisialisasi class tanpa perlu.

## 12.2 Classpath

Classpath adalah daftar lokasi class/resource.

Bisa berupa:

- directory;
- JAR;
- nested JAR;
- build output;
- dependency cache;
- test classpath.

Spring Boot executable JAR punya nested JAR structure. Framework perlu classloader yang memahami layout ini.

## 12.3 Module path

Module path membawa JPMS:

- module descriptor;
- explicit dependencies;
- exports;
- opens;
- strong encapsulation.

Framework reflection-heavy harus beradaptasi dengan `opens`.

## 12.4 Component scanning

Spring component scanning mendeteksi candidate component berdasarkan filter, umumnya annotation stereotype seperti:

- `@Component`;
- `@Service`;
- `@Repository`;
- `@Controller`;
- custom composed annotation.

Pipeline:

```text
base packages
  ↓
resource pattern resolver
  ↓
class metadata reader
  ↓
type filters
  ↓
candidate BeanDefinition
  ↓
bean registry
```

## 12.5 Why base package matters

Jika aplikasi main class di package:

```text
com.example
```

scan mencakup:

```text
com.example.*
```

Jika main class salah ditempatkan di root/default package atau package terlalu tinggi, scanning bisa terlalu luas.

Guideline:

```text
Letakkan main application class di root package aplikasi:
com.company.product.app
```

## 12.6 ServiceLoader

JDK punya `ServiceLoader` untuk plugin discovery.

Provider config:

```text
META-INF/services/com.example.Plugin
```

atau JPMS:

```java
module plugin.module {
    provides com.example.Plugin with com.example.PluginImpl;
}
```

Use case:

- JDBC driver;
- logging provider;
- compiler plugin;
- framework extension;
- custom SPI.

ServiceLoader lebih eksplisit daripada scanning seluruh classpath.

---

# 13. Dependency Injection Container Internals

Dependency Injection container melakukan:

```text
define beans
  ↓
resolve dependencies
  ↓
instantiate beans
  ↓
inject dependencies
  ↓
apply lifecycle callbacks
  ↓
wrap/proxy if needed
  ↓
publish application context
```

## 13.1 BeanDefinition

Sebelum object dibuat, container punya definisi:

```text
bean name
class
scope
constructor args
property values
factory method
qualifiers
lazy/eager
primary
conditions
init/destroy methods
```

Ini model metadata.

## 13.2 Dependency resolution

Jika constructor:

```java
public CaseService(CaseRepository repository, Clock clock) {}
```

Container mencari bean yang cocok berdasarkan:

- type;
- generic type;
- qualifier;
- name;
- primary;
- priority;
- optional/provider;
- collection/map injection.

## 13.3 Constructor injection

Preferred untuk required dependency:

```java
@Service
public class CaseService {
    private final CaseRepository repository;

    public CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Kelebihan:

- dependency eksplisit;
- object valid setelah construction;
- test mudah;
- supports immutability;
- circular dependency cepat terlihat.

## 13.4 Field injection

```java
@Autowired
private CaseRepository repository;
```

Kekurangan:

- dependency tersembunyi;
- object bisa invalid tanpa container;
- test lebih sulit;
- reflection required;
- final field sulit;
- circular dependency bisa tersembunyi.

## 13.5 Circular dependency

A butuh B, B butuh A.

```text
A → B → A
```

Penyebab:

- tanggung jawab bercampur;
- bidirectional service dependency;
- event/use case boundary buruk.

Solusi:

- refactor responsibility;
- introduce mediator/application service;
- event publish;
- split read/write;
- lazy/provider only as last resort.

## 13.6 Scope

Common scope:

- singleton;
- prototype;
- request;
- session;
- custom.

Pitfall:

```text
singleton depends directly on request-scoped object
```

Framework bisa memakai proxy untuk scoped bean.

## 13.7 Conditional configuration

Spring Boot auto-configuration memakai condition:

- class present;
- bean missing;
- property value;
- resource present;
- web application type.

Magic auto-configuration sebenarnya adalah conditional bean registration.

Debugging:

- condition evaluation report;
- actuator `/actuator/conditions`;
- startup logs.

---

# 14. Bean Lifecycle dan Post-Processing

Spring bean lifecycle simplified:

```text
instantiate
  ↓
populate properties
  ↓
aware callbacks
  ↓
BeanPostProcessor before init
  ↓
init callbacks
  ↓
BeanPostProcessor after init
  ↓
possibly proxy returned
  ↓
ready
  ↓
destroy callbacks on shutdown
```

## 14.1 BeanPostProcessor

`BeanPostProcessor` dapat memodifikasi/wrap bean.

AOP proxy sering dibuat melalui post-processor.

Mental model:

```text
target object created
  ↓
post-processor detects annotation/advisor
  ↓
proxy generated
  ↓
container stores proxy as bean
```

## 14.2 Early references

Untuk circular dependencies, container kadang mengekspos early reference.

Ini kompleks dan bisa berinteraksi buruk dengan proxy.

Guideline:

> Jangan bergantung pada circular dependency support. Anggap circular service dependency sebagai design smell.

## 14.3 Init callbacks

Contoh:

- `@PostConstruct`;
- `InitializingBean`;
- custom init method;
- application runner.

Hati-hati:

- jangan melakukan long blocking startup tanpa startup probe;
- jangan memanggil proxied method dari `@PostConstruct` dan berharap advice selalu berjalan;
- jangan mulai thread manual tanpa lifecycle management;
- jangan menelan exception startup.

## 14.4 Shutdown callbacks

Contoh:

- `@PreDestroy`;
- `DisposableBean`;
- `SmartLifecycle`;
- shutdown hook.

Penting untuk:

- close pool;
- stop consumer;
- flush telemetry;
- stop scheduler;
- release lock;
- graceful shutdown.

---

# 15. Transaction Proxy dan Self-Invocation Bug

`@Transactional` di Spring umumnya bekerja lewat proxy.

## 15.1 Transaction interceptor flow

```text
proxy method invoked
  ↓
TransactionInterceptor reads metadata
  ↓
determine transaction manager
  ↓
begin/suspend/join transaction
  ↓
invoke target method
  ↓
commit if normal
  ↓
rollback if matching exception rule
```

## 15.2 Rollback rules

Default Spring transaction biasanya rollback untuk unchecked exception (`RuntimeException`, `Error`), bukan checked exception kecuali dikonfigurasi.

Pitfall:

```java
@Transactional
public void importFile() throws IOException {
    ...
    throw new IOException("failed");
}
```

Jika tidak dikonfigurasi, checked exception bisa tidak rollback sesuai ekspektasi.

## 15.3 Method visibility

Transactional method sebaiknya public dan dipanggil dari luar via proxy.

Private method tidak bisa menjadi transaction boundary proxy-based.

## 15.4 Self invocation repeated

Bug ini sangat umum.

```java
public void approve() {
    validate();
    saveAudit(); // annotated but called internally
}

@Transactional
void saveAudit() {}
```

Jika `saveAudit()` butuh advice, pindahkan ke bean lain atau gunakan explicit transaction API.

## 15.5 Better transaction design

Pisahkan:

- orchestration;
- transaction boundary;
- domain logic;
- external I/O.

Contoh:

```java
@Service
public class EscalateCaseUseCase {
    private final EscalateCaseTransaction tx;

    public void handle(Command command) {
        tx.execute(command);
        eventPublisher.publish(...); // maybe outbox instead
    }
}

@Service
public class EscalateCaseTransaction {
    @Transactional
    public void execute(Command command) {
        ...
    }
}
```

---

# 16. Serialization Framework Internals: Jackson sebagai Studi Kasus

Jackson tampak sederhana:

```java
CaseDto dto = objectMapper.readValue(json, CaseDto.class);
String json = objectMapper.writeValueAsString(dto);
```

Tetapi internalnya kompleks.

## 16.1 Jackson architecture

Layer utama:

```text
jackson-core
  streaming parser/generator

jackson-annotations
  annotations for mapping/config

jackson-databind
  object mapping between JSON and POJO/tree
```

## 16.2 Serialization pipeline

```text
object
  ↓
ObjectMapper
  ↓
SerializerProvider
  ↓
find JsonSerializer
  ↓
BeanSerializer
  ↓
property introspection
  ↓
write fields using JsonGenerator
  ↓
JSON bytes/chars
```

## 16.3 Deserialization pipeline

```text
JSON bytes/chars
  ↓
JsonParser token stream
  ↓
ObjectMapper
  ↓
JavaType resolution
  ↓
find JsonDeserializer
  ↓
creator/constructor/factory
  ↓
set properties
  ↓
object
```

## 16.4 Introspection

Jackson membaca:

- getters/setters;
- fields;
- constructors;
- records;
- annotations;
- visibility rules;
- naming strategy;
- modules;
- generic type;
- subtype metadata.

## 16.5 ObjectMapper should be reused

`ObjectMapper` mahal untuk dibuat dan punya cache serializer/deserializer.

Guideline:

```text
buat ObjectMapper sebagai singleton/configured bean
```

Jangan:

```java
new ObjectMapper().readValue(...)
```

di hot path.

## 16.6 DTO design

DTO yang bagus:

```java
public record CaseResponse(
    String id,
    String status,
    Instant updatedAt
) {}
```

Untuk input:

```java
public record EscalateCaseRequest(
    @NotBlank String reason,
    @NotNull Severity severity
) {}
```

Pisahkan DTO dari entity/domain object.

Jangan expose JPA entity langsung sebagai API JSON.

## 16.7 Records and constructors

Records cocok untuk immutable DTO karena component metadata jelas.

Namun untuk custom validation/deserialization, gunakan:

- canonical constructor;
- `@JsonCreator`;
- `@JsonProperty`;
- validation layer.

## 16.8 Polymorphic deserialization

Jackson mendukung polymorphic type handling.

Contoh:

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
    @JsonSubTypes.Type(value = EscalateCommand.class, name = "ESCALATE"),
    @JsonSubTypes.Type(value = CloseCommand.class, name = "CLOSE")
})
sealed interface CaseCommand permits EscalateCommand, CloseCommand {}
```

Ini bisa berguna untuk command/event.

Security guideline:

- jangan biarkan untrusted input menentukan arbitrary class name;
- hindari default typing global untuk untrusted data;
- whitelist subtype;
- gunakan logical type name, bukan class name;
- validasi schema;
- limit payload size/depth;
- update dependency.

## 16.9 Serialization failure modes

| Failure | Penyebab |
|---|---|
| `UnrecognizedPropertyException` | input punya field tak dikenal |
| `InvalidDefinitionException` | tidak ada creator/constructor |
| infinite recursion | bidirectional object graph |
| lazy loading exception | serialize JPA lazy proxy di luar session |
| timezone mismatch | date/time config buruk |
| BigDecimal precision issue | number mapping salah |
| polymorphic security risk | default typing/type id tidak aman |
| performance buruk | reflection/no cache/large graph |
| stack overflow | cyclic graph |
| field hilang | visibility/naming/annotation mismatch |

## 16.10 Avoid entity serialization

Buruk:

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(...) {
    return repository.findById(...);
}
```

Risiko:

- lazy loading;
- circular reference;
- data leak;
- API coupling ke schema DB;
- versioning sulit;
- transaction/session leak;
- performance unpredictable.

Baik:

```java
@GetMapping("/cases/{id}")
public CaseResponse getCase(...) {
    return mapper.toResponse(useCase.getCase(...));
}
```

## 16.11 Custom serializer/deserializer

Gunakan jika:

- format domain khusus;
- value object;
- legacy API;
- strict validation;
- performance.

Namun jangan membuat serializer berisi business logic kompleks.

---

# 17. ORM Framework Internals: Hibernate/JPA sebagai Studi Kasus

ORM tampak seperti:

```java
CaseEntity entity = repository.findById(id).orElseThrow();
entity.setStatus(CLOSED);
```

Lalu SQL terjadi otomatis.

Internalnya:

```text
entity metadata
+ persistence context
+ dirty checking
+ proxy/lazy loading
+ SQL generation
+ flush
+ transaction synchronization
```

## 17.1 Persistence context

Persistence context adalah first-level cache/unit of work.

```text
EntityManager
  holds managed entities
  tracks changes
  flushes SQL
```

Jika entity managed berubah:

```java
entity.setStatus(CLOSED);
```

Hibernate dapat mendeteksi dirty state dan generate `UPDATE`.

## 17.2 Dirty checking

Dirty checking bisa berbasis:

- snapshot comparison;
- bytecode enhancement;
- field interception.

Biaya dirty checking meningkat jika persistence context berisi banyak entity.

Guideline:

- transaction pendek;
- jangan load ribuan entity managed jika tidak perlu;
- gunakan projection/query update/batch untuk bulk;
- clear persistence context untuk batch besar.

## 17.3 Lazy loading proxy

Association lazy:

```java
caseEntity.getDocuments()
```

bisa memicu query saat diakses.

Jika session sudah closed:

```text
LazyInitializationException
```

Jika serialization menyentuh lazy property, bisa terjadi N+1 atau exception.

## 17.4 N+1 query

Pattern:

```text
select cases
for each case:
  select documents
```

Jika 100 cases:

```text
1 + 100 queries
```

Solusi:

- fetch join;
- entity graph;
- batch size;
- projection;
- query tailored read model.

## 17.5 Entity proxy and equality

Hibernate proxy bisa membuat `getClass()` equality bermasalah.

Careful with:

```java
if (obj.getClass() != CaseEntity.class) return false;
```

Entity equality harus didesain hati-hati, biasanya berdasarkan stable identifier setelah assigned, dengan consideration proxy.

## 17.6 Bytecode enhancement

Hibernate dapat memakai bytecode enhancement untuk:

- lazy attribute loading;
- dirty tracking;
- association management;
- performance improvement.

Ini kembali ke framework internals: bytecode dapat diubah di build-time atau runtime.

---

# 18. Testing Framework Internals: JUnit, Mockito, dan Test Doubles

## 18.1 JUnit discovery

JUnit Platform menemukan test melalui:

- classpath/module scanning;
- test engine;
- annotations;
- selectors;
- filters;
- discovery request.

JUnit Jupiter membaca:

- `@Test`;
- `@BeforeEach`;
- `@AfterEach`;
- `@ParameterizedTest`;
- extensions;
- lifecycle.

## 18.2 Extension model

JUnit extension bisa hook ke lifecycle:

- before all;
- before each;
- parameter resolution;
- exception handling;
- test execution;
- after each;
- after all.

Framework seperti Spring Test menggunakan extension untuk menyiapkan application context.

## 18.3 Mockito mock internals

Mock object perlu mengintercept method call.

Mockito modern memakai Byte Buddy untuk membuat mock/proxy class.

Mocking interface lebih mudah. Mocking final class/method butuh inline mock maker/instrumentation support.

## 18.4 Test double types

| Type | Meaning |
|---|---|
| dummy | object hanya untuk memenuhi parameter |
| stub | mengembalikan jawaban terkontrol |
| mock | memverifikasi interaksi |
| spy | wrap real object sebagian |
| fake | implementasi sederhana tapi working |
| simulator | fake yang lebih kaya untuk behavior |

## 18.5 Mocking failure modes

- mock terlalu banyak → test implementation detail;
- spy memanggil real method tak sengaja;
- final/static mocking membutuhkan machinery lebih kompleks;
- mocking JPA entity/domain object bisa menutupi design smell;
- strict stubbing failure;
- test passing tapi production proxy behavior berbeda.

## 18.6 Spring test context cache

Spring Test menyimpan application context antar test untuk mempercepat.

Jika test memakai konfigurasi berbeda-beda terlalu banyak, cache miss dan test suite lambat.

Anti-pattern:

```java
@DirtiesContext
```

dipakai sembarangan.

---

# 19. Instrumentation dan Java Agent

Java instrumentation memungkinkan agent memodifikasi bytecode class.

## 19.1 Agent startup

Static agent:

```bash
java -javaagent:agent.jar -jar app.jar
```

Agent manifest punya:

```text
Premain-Class: com.example.Agent
```

Agent class:

```java
public final class Agent {
    public static void premain(String args, Instrumentation inst) {
        inst.addTransformer(new MyTransformer());
    }
}
```

## 19.2 Dynamic attach

Agent bisa attach ke JVM yang sudah berjalan jika environment mengizinkan.

Entry point:

```java
public static void agentmain(String args, Instrumentation inst) {}
```

## 19.3 ClassFileTransformer

Transformer menerima bytecode sebelum class didefine/retransform.

Conceptual:

```java
class MyTransformer implements ClassFileTransformer {
    @Override
    public byte[] transform(
        Module module,
        ClassLoader loader,
        String className,
        Class<?> classBeingRedefined,
        ProtectionDomain protectionDomain,
        byte[] classfileBuffer
    ) {
        if (className.equals("com/example/CaseService")) {
            return modifiedBytes;
        }
        return null; // no change
    }
}
```

## 19.4 Instrumentation use cases

- APM tracing;
- metrics;
- profiling;
- security monitoring;
- test coverage;
- mocking final/static;
- fault injection;
- runtime patching;
- bytecode enhancement.

## 19.5 Instrumentation risks

- class format error;
- verifier error;
- performance overhead;
- classloader leak;
- transformation order conflict;
- module access issue;
- difficult debugging;
- security exposure;
- vendor support issue;
- startup time.

## 19.6 Redefinition/retransformation limits

Not all structural changes are allowed. Depending on JVM/instrumentation capability, changing method bodies may be allowed, but adding fields/methods may be restricted.

Always check actual `Instrumentation` capabilities:

```java
inst.isRedefineClassesSupported();
inst.isRetransformClassesSupported();
inst.isNativeMethodPrefixSupported();
```

---

# 20. APM, OpenTelemetry Agent, dan Observability Magic

APM agent can trace application without source changes because it instruments known libraries.

Example:

```text
HTTP server handler
JDBC driver
HTTP client
Kafka producer/consumer
Redis client
Executor
Spring MVC
Servlet filter
```

## 20.1 How auto-instrumentation works

Pipeline:

```text
agent starts before app
  ↓
register transformers
  ↓
when target class loads, bytecode is transformed
  ↓
advice inserted at method entry/exit
  ↓
trace span created/ended
  ↓
context propagated
```

## 20.2 Context propagation

Tracing needs context:

```text
trace id
span id
baggage
```

Propagation across:

- thread boundary;
- executor;
- virtual thread;
- HTTP headers;
- messaging headers;
- reactive pipeline;
- scheduled job.

## 20.3 Agent overhead

Agent can add:

- method entry/exit overhead;
- allocation;
- context propagation cost;
- exporter overhead;
- startup cost;
- class transformation cost;
- stack trace/sampling overhead.

Guideline:

- measure overhead;
- configure sampling;
- avoid high-cardinality attributes;
- avoid capturing sensitive data;
- understand instrumentation scope.

## 20.4 Debugging agent issue

Symptoms:

- app works without agent, fails with agent;
- classloading error;
- duplicate instrumentation;
- high CPU;
- memory leak;
- weird stack trace;
- module access issue;
- incompatible library version.

Debug:

- run without agent;
- upgrade/downgrade agent;
- enable agent debug logs;
- reduce instrumentation scope;
- check transformed class;
- check library compatibility matrix.

---

# 21. JPMS, Strong Encapsulation, dan Framework

JPMS membuat module boundaries eksplisit.

## 21.1 `exports` vs `opens`

```java
exports com.example.api;
```

Mengizinkan compile-time/runtime public type access.

```java
opens com.example.dto to com.fasterxml.jackson.databind;
```

Mengizinkan deep reflection ke package tertentu.

Framework reflection-heavy sering butuh `opens`.

## 21.2 Common error

```text
java.lang.reflect.InaccessibleObjectException:
Unable to make field private ... accessible:
module app does not "opens com.example.domain" to ...
```

Solusi:

```java
module com.example.app {
    opens com.example.dto to com.fasterxml.jackson.databind;
    opens com.example.entity to org.hibernate.orm.core;
}
```

atau JVM flag:

```bash
--add-opens com.example.app/com.example.dto=com.fasterxml.jackson.databind
```

Prefer module descriptor when possible.

## 21.3 Automatic module and unnamed module

Legacy libraries on classpath run in unnamed module. Migration bertahap bisa menimbulkan mixed world:

```text
named modules + classpath unnamed module
```

Framework behavior dapat berbeda.

## 21.4 Design guideline

Untuk modular app:

- export only API packages;
- open DTO/entity packages selectively;
- avoid opening entire module unless necessary;
- document framework access;
- test on module path, not only classpath.

---

# 22. GraalVM Native Image dan AOT Constraint

Native image/AOT mengubah asumsi runtime dynamic.

Masalah:

- reflection harus diketahui build-time;
- dynamic proxy harus dikonfigurasi;
- resource harus didaftarkan;
- JNI/native access harus dikonfigurasi;
- class initialization timing berubah;
- dynamic classloading terbatas;
- instrumentation/agent berbeda;
- invokedynamic/proxy behavior perlu support.

Framework modern menyesuaikan dengan:

- build-time processing;
- generated metadata;
- reflection config;
- native hints;
- AOT engine;
- annotation processing;
- closed-world analysis.

## 22.1 Runtime reflection problem

Di JVM biasa:

```java
Class.forName(name)
```

bisa berhasil jika class ada.

Di native image, closed-world analysis perlu tahu class/members yang direfleksikan.

## 22.2 Dynamic proxy config

JDK proxy untuk interface tertentu harus diketahui.

Example concept:

```json
[
  ["com.example.CaseService", "com.example.Audited"]
]
```

## 22.3 Framework implication

Framework yang mengandalkan runtime scanning/reflection berat harus:

- generate metadata at build time;
- avoid dynamic classpath scanning;
- register reflection hints;
- generate proxies ahead-of-time;
- reduce runtime dynamism.

## 22.4 Design for AOT

If building library/framework:

- prefer explicit registration;
- provide annotation processor/AOT plugin;
- avoid arbitrary class name strings;
- expose reflection hints;
- avoid hidden dynamic classloading;
- keep proxy interfaces explicit;
- document native image requirements.

---

# 23. Performance Cost Model

## 23.1 Cost hierarchy

Approximate relative concern:

| Mechanism | Cost concern |
|---|---|
| direct call | minimal, JIT-friendly |
| virtual call | often optimized if monomorphic |
| interface call | often optimized if profile stable |
| method handle | can be optimized, depends usage |
| reflection lookup | expensive if repeated |
| reflection invoke | overhead, boxing/wrapping |
| generated bytecode | fast after generation |
| proxy | method call + interceptor chain |
| classpath scanning | startup cost |
| annotation processing | build cost |
| instrumentation | startup + runtime overhead |
| serialization | allocation + reflection/generation + I/O |

## 23.2 Startup vs steady-state

Framework cost can appear at:

- build time;
- startup time;
- first request;
- every request;
- background scan;
- class load time;
- method invocation.

Good framework design moves cost away from hot path.

## 23.3 Cache everything? Not blindly

Metadata caching helps:

- reflection metadata;
- serializers/deserializers;
- bean definitions;
- method handles;
- type resolution.

But cache can cause:

- classloader leak;
- memory growth;
- stale metadata;
- unbounded key cardinality.

Cache must be bounded or scoped to classloader/application lifecycle.

## 23.4 Reflection in hot path

Bad:

```java
for (Row row : rows) {
    Field f = row.getClass().getDeclaredField("value");
    f.setAccessible(true);
    values.add(f.get(row));
}
```

Better:

- resolve once;
- cache accessor;
- use generated mapper;
- use method handle;
- avoid reflection in loop.

## 23.5 Interceptor chain cost

Proxy chain:

```text
security
transaction
retry
metrics
tracing
validation
target
```

Each layer adds overhead and semantics.

Cost may be acceptable, but ordering and failure behavior matter.

---

# 24. Security Risk Model

## 24.1 Reflection risk

Reflection can:

- access private fields;
- bypass validation;
- mutate internal state;
- expose secrets;
- break module boundaries;
- call methods not intended as API.

Guideline:

- minimize reflective access;
- open only needed packages;
- avoid exposing reflection utilities to untrusted input;
- validate class/member names;
- never allow arbitrary method invocation from user input.

## 24.2 Deserialization risk

Deserialization risk arises when untrusted data controls:

- type;
- object graph;
- constructor/factory;
- setters;
- callbacks;
- gadget classes.

Guideline:

- avoid Java native serialization for untrusted data;
- avoid Jackson default typing for untrusted data;
- whitelist polymorphic subtypes;
- validate input schema;
- limit payload size/depth;
- keep dependencies patched;
- avoid deserializing into `Object`, `Serializable`, or broad base type without type validator.

## 24.3 Annotation processor risk

Annotation processors run during build and can execute code.

Risk:

- malicious processor;
- compromised dependency;
- reading secrets from build env;
- generating malicious source;
- exfiltration if network allowed.

Guideline:

- restrict processors;
- use trusted dependencies;
- lock versions;
- isolate build;
- no secret in build environment when possible;
- dependency scanning.

## 24.4 Java agent risk

Java agent can transform application bytecode.

Risk:

- arbitrary code execution in JVM;
- data exfiltration;
- performance overhead;
- disabled security assumptions;
- hard-to-audit behavior.

Guideline:

- allow only approved agents;
- pin versions;
- verify signatures/checksums;
- restrict attach;
- monitor overhead;
- document agent config.

---

# 25. Design Guidelines: Membuat Framework/Library Sendiri

## 25.1 Jangan mulai dari reflection

Mulai dari API yang explicit:

```java
CaseFramework.builder()
    .registerHandler(EscalateCase.class, new EscalateCaseHandler())
    .build();
```

Tambahkan annotation/scanning hanya jika benar-benar memberi value.

## 25.2 Separate metadata discovery from execution

Bad:

```java
void handle(Object command) {
    Method method = scanAllHandlersEveryTime(command);
    method.invoke(...);
}
```

Good:

```text
startup:
  scan/build registry/cache

runtime:
  lookup in map and direct/generate invocation
```

## 25.3 Fail fast

Framework harus fail at startup/build time jika config invalid.

Jangan menunggu request production pertama.

## 25.4 Clear error message

Buruk:

```text
IllegalStateException: invalid bean
```

Baik:

```text
Command handler com.example.EscalateHandler is invalid:
- expected exactly one public handle(EscalateCase) method
- found handle(Object) instead
- annotation @CommandHandler(type=EscalateCase.class)
```

## 25.5 Avoid hidden global state

Global registry static membuat:

- test sulit;
- classloader leak;
- multi-app conflict;
- dynamic reload bermasalah.

Prefer scoped context object.

## 25.6 Respect classloader

Cache by:

```text
ClassLoader + Class + metadata
```

and clear on shutdown if framework container stops.

## 25.7 Provide extension points

Good framework exposes:

- SPI;
- strategy interface;
- lifecycle;
- explicit configuration;
- validation hooks;
- observability hooks.

## 25.8 Document runtime requirements

Jika butuh:

- `-parameters`;
- `opens`;
- annotation retention runtime;
- non-final class;
- public constructor;
- no-arg constructor;
- module path config;
- reflection hints;
- agent flag;

document it.

---

# 26. Debugging Playbook

## 26.1 “Bean not found”

Check:

- package scanned?
- annotation present?
- profile active?
- condition matched?
- bean excluded?
- module/package visible?
- duplicate class?
- auto-config disabled?
- test slice limiting context?

Spring tools:

- startup logs;
- condition evaluation report;
- `/actuator/beans`;
- `/actuator/conditions`.

## 26.2 “@Transactional not working”

Check:

- method public?
- called via proxy?
- self-invocation?
- class/method final?
- proxy type JDK/CGLIB?
- transaction manager present?
- exception type triggers rollback?
- annotation on correct method?
- async thread boundary?
- test transaction behavior?

## 26.3 “Annotation not detected”

Check:

- retention `RUNTIME`?
- target correct?
- annotation on interface vs implementation?
- meta-annotation handled?
- proxy class hides target class?
- scanning base package?
- generated class?
- module visibility?

## 26.4 “Jackson cannot deserialize”

Check:

- no default constructor/creator?
- record component names?
- compiled with parameter names?
- missing `@JsonCreator/@JsonProperty`?
- unknown property?
- generic type lost?
- polymorphic subtype not registered?
- module missing, e.g. JavaTimeModule?
- visibility config?
- final/immutable field?

## 26.5 “Mockito cannot mock class”

Check:

- final class/method?
- static method?
- private method?
- inline mock maker enabled?
- JPMS opens?
- agent attach allowed?
- classloader issue?
- native image/AOT?

## 26.6 “Works in IDE, fails in packaged JAR”

Check:

- classpath differs?
- resource missing?
- nested JAR classloader?
- shading/relocation?
- annotation processor generated file not packaged?
- service loader file merged?
- reflection config?
- dependency version conflict?

## 26.7 “Works on classpath, fails on module path”

Check:

- package exported?
- package opened?
- automatic module name?
- split package?
- service provider declared?
- reflective access blocked?
- `--add-opens` needed?
- framework JPMS support?

## 26.8 “APM agent causes issue”

Check:

- reproduce without agent;
- agent version compatibility;
- duplicate agents;
- instrumentation disabled selectively;
- debug logs;
- class transform errors;
- module opens;
- overhead metrics.

---

# 27. Anti-Patterns

## 27.1 Annotation-driven everything

Jika setiap rule menjadi annotation, code jadi sulit dibaca.

Annotation bagus untuk metadata. Business logic tetap code.

## 27.2 Reflection per request tanpa cache

Startup reflection acceptable. Hot-path reflection suspicious.

## 27.3 Broad classpath scanning

Scanning `com` atau root package memperlambat startup dan meningkatkan risiko.

## 27.4 Interface only because proxy

Membuat interface untuk setiap service hanya karena proxy bisa menyebabkan noise. Pilih interface jika ada abstraction boundary nyata. Jika perlu proxy class, pahami CGLIB/Byte Buddy limitation.

## 27.5 Final everywhere in Spring AOP-heavy app

`final` bagus untuk immutability/design. Namun jika framework butuh subclass proxy, final class/method bisa menghalangi advice. Balance dengan proxy strategy.

## 27.6 Entity as API DTO

Menggabungkan ORM entity + JSON DTO + domain object adalah sumber coupling dan serialization bug.

## 27.7 Hidden side effect in getter

Framework memanggil getter untuk serialization/proxy/introspection. Getter sebaiknya tidak melakukan I/O atau mutation berat.

## 27.8 Arbitrary class name from user input

```java
Class.forName(userInput)
```

Dangerous.

## 27.9 Global ObjectMapper mutation

Mengubah shared `ObjectMapper` setelah dipakai bisa menyebabkan behavior inconsistent.

Configure once at startup.

## 27.10 Agent as magic fix

Agent bisa mengamati/mengubah behavior, tetapi juga menambah complexity. Jangan pakai tanpa observability/ownership.

---

# 28. Checklist Review Framework Usage

## 28.1 Reflection

- [ ] Reflection hanya dipakai saat perlu?
- [ ] Metadata dicache?
- [ ] Tidak ada arbitrary member access dari user input?
- [ ] Module opens minimal?
- [ ] Error handling unwrap `InvocationTargetException`?
- [ ] Hot path bebas reflection lookup berulang?

## 28.2 Annotation

- [ ] Retention benar?
- [ ] Target benar?
- [ ] Annotation tidak menjadi mini-language berlebihan?
- [ ] Meta-annotation dipahami?
- [ ] Compile-time validation dipertimbangkan?

## 28.3 Proxy/AOP

- [ ] Tahu JDK proxy atau CGLIB?
- [ ] Self-invocation tidak melanggar expectation?
- [ ] Method visibility benar?
- [ ] Class/method final sesuai proxy strategy?
- [ ] Advice order jelas?
- [ ] Transaction/retry/cache semantics benar?

## 28.4 Scanning

- [ ] Base package spesifik?
- [ ] Tidak scan root/classpath terlalu luas?
- [ ] Conditional bean terdokumentasi?
- [ ] Duplicate bean/name conflict ditangani?
- [ ] AOT/native constraint dipertimbangkan?

## 28.5 Serialization

- [ ] DTO terpisah dari entity?
- [ ] ObjectMapper singleton/configured once?
- [ ] Unknown fields policy jelas?
- [ ] Date/time/timezone policy jelas?
- [ ] Polymorphic deserialization whitelist?
- [ ] Payload size/depth limit?
- [ ] No default typing unsafe for untrusted input?

## 28.6 Instrumentation/Agent

- [ ] Agent approved?
- [ ] Version pinned?
- [ ] Overhead measured?
- [ ] Sensitive data policy?
- [ ] Compatibility tested?
- [ ] Debug plan exists?

---

# 29. Latihan Bertahap

## Latihan 1 — Reflection inspector

Buat CLI:

```bash
java ReflectionInspector com.example.CaseService
```

Output:

- class name;
- modifiers;
- constructors;
- fields;
- methods;
- annotations;
- parameter names;
- generic signatures.

Coba compile dengan dan tanpa:

```bash
-parameters
```

Bandingkan output.

## Latihan 2 — Mini annotation

Buat annotation:

```java
@Audited(action = "CASE_ESCALATE")
```

Buat scanner yang mencari method annotated dan mencetak metadata.

## Latihan 3 — Annotation processor

Buat annotation:

```java
@CommandHandler(type = EscalateCase.class)
```

Processor compile-time harus:

- validasi class punya method `handle(EscalateCase)`;
- generate registry source;
- fail compile jika salah.

## Latihan 4 — JDK dynamic proxy

Buat interface:

```java
interface CaseService {
    void escalate(String caseId);
}
```

Buat proxy yang:

- log before/after;
- ukur duration;
- unwrap exception.

## Latihan 5 — CGLIB/Byte Buddy proxy

Buat class tanpa interface dan intercept method public.

Test:

- normal method;
- final method;
- private method;
- self-invocation.

Amati method mana yang ter-intercept.

## Latihan 6 — Spring transactional self-invocation

Buat service dengan:

```java
outer() calls inner()
inner() @Transactional(REQUIRES_NEW)
```

Buktikan `inner` tidak membuat transaction baru saat dipanggil internal. Refactor ke bean lain.

## Latihan 7 — Jackson introspection

Buat DTO:

- record;
- class immutable;
- class with private constructor;
- class with generic field;
- polymorphic sealed interface.

Serialize/deserialize dan catat konfigurasi yang dibutuhkan.

## Latihan 8 — Java agent sederhana

Buat agent yang mencetak nama class saat class tertentu diload.

Run:

```bash
java -javaagent:agent.jar -jar app.jar
```

## Latihan 9 — JPMS opens

Buat modular app dengan DTO private fields.

Coba Jackson deserialize tanpa `opens`, lalu tambahkan:

```java
opens com.example.dto to com.fasterxml.jackson.databind;
```

Amati perbedaan.

---

# 30. Mini Project: Tiny Java Framework

## 30.1 Goal

Bangun framework kecil bernama:

```text
tiny-case-framework
```

Kemampuan:

- scan package;
- detect `@UseCase`;
- instantiate class;
- inject constructor dependencies;
- wrap use case dengan proxy;
- intercept method dengan audit/metrics;
- serialize command/result dengan Jackson;
- expose simple HTTP adapter optional;
- support compile-time generated registry optional.

## 30.2 Annotation

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface UseCase {}

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Audited {
    String action();
}

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface Component {}
```

## 30.3 Container

Implement:

```java
public final class TinyContainer {
    public <T> T getBean(Class<T> type) {}
}
```

Features:

- constructor injection;
- singleton scope;
- circular dependency detection;
- clear error message.

## 30.4 Proxy

For interface-based bean:

```text
JDK dynamic proxy
```

Intercept:

- `@Audited`;
- duration;
- exception.

## 30.5 Metadata cache

Cache:

- constructors;
- methods;
- annotations;
- dependency graph.

## 30.6 Jackson integration

Provide:

```java
CommandEnvelope deserialize(String json);
String serialize(Object result);
```

Use safe polymorphism:

- type name whitelist;
- no arbitrary class names.

## 30.7 Optional annotation processor

Generate:

```java
TinyGeneratedRegistry
```

containing known components to avoid runtime scanning.

## 30.8 Tests

Test:

- injection success;
- missing dependency;
- circular dependency;
- proxy advice;
- self-invocation limitation documented;
- serialization success/failure;
- performance startup with generated registry vs scanning.

## 30.9 Deliverables

- `README.md`;
- architecture diagram;
- framework code;
- sample app;
- tests;
- benchmark startup;
- security notes;
- limitations.

## 30.10 Reflection questions

1. Apa yang framework temukan saat startup?
2. Apa metadata yang dicache?
3. Di mana proxy dibuat?
4. Apa yang terjadi jika class final?
5. Apa yang terjadi jika method private?
6. Apa yang terjadi jika dependency circular?
7. Apa yang terjadi jika annotation retention salah?
8. Apa yang terjadi saat module tidak membuka package?
9. Apa yang terjadi saat native image?
10. Bagaimana framework fail fast?

---

# 31. Referensi Resmi

Referensi utama yang relevan:

1. Oracle Java SE 25 `java.lang.reflect` package documentation — reflection API untuk class, field, method, constructor.
2. Oracle Java SE 25 `java.lang.reflect.Proxy` documentation — JDK dynamic proxy.
3. Oracle Java SE 25 `javax.annotation.processing` dan `javac` documentation — annotation processing dan processing rounds.
4. Oracle Java SE 25 `java.lang.instrument` package documentation — Java agents and bytecode instrumentation.
5. Java Language Specification SE 25 — annotations, classes, interfaces, modules.
6. Java Virtual Machine Specification SE 25 — class files, loading/linking/initialization, verification.
7. Spring Framework reference — classpath scanning, AOP proxies, proxying mechanisms, bean lifecycle, transaction management.
8. Byte Buddy official documentation — runtime code generation and class manipulation.
9. FasterXML Jackson documentation and javadocs — databind, annotations, streaming, ObjectMapper.
10. Hibernate ORM documentation — proxies, bytecode enhancement, persistence context, dirty checking.
11. JUnit documentation — Platform/Jupiter/test discovery/extension model.
12. Mockito documentation — mock maker and Byte Buddy-based mocking internals.
13. OpenTelemetry Java instrumentation documentation — Java agent auto-instrumentation and context propagation.
14. GraalVM Native Image documentation — reflection/proxy/resource configuration and closed-world constraints.

---

# Penutup

Framework Java bekerja karena Java menyediakan runtime yang sangat kaya:

```text
metadata
reflection
classloading
annotations
proxies
bytecode
instrumentation
serialization
modules
```

Tetapi semakin banyak “magic” yang dipakai, semakin penting engineer memahami boundary-nya.

Framework internals bukan pengetahuan akademis. Ia membantu menjawab bug nyata:

```text
Mengapa @Transactional tidak jalan?
Mengapa bean tidak ditemukan?
Mengapa JSON tidak bisa deserialize?
Mengapa mocking final class gagal?
Mengapa APM agent mengubah behavior?
Mengapa app jalan di IDE tapi gagal di packaged JAR?
Mengapa classpath oke tapi module path gagal?
Mengapa native image butuh reflection config?
```

Engineer yang kuat tidak takut framework, tetapi juga tidak tunduk buta pada framework. Ia memahami bahwa framework adalah layer mekanisme, convention, dan trade-off yang bisa dibaca, diuji, dikonfigurasi, dan jika perlu, diganti.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-part-020.md](./learn-java-part-020.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: learn-java-part-022.md](./learn-java-part-022.md)

</div>
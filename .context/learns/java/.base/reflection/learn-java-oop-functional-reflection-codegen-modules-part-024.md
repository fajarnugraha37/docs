# learn-java-oop-functional-reflection-codegen-modules-part-024

# Dynamic Proxy, Bytecode Libraries, Agents, and Instrumentation Concepts

> Seri: **Java OOP, Functional, Reflection, Code Generation, Modules & Package Management**  
> Part: **024**  
> Topik: **Dynamic Proxy, Bytecode Libraries, Agents, and Instrumentation Concepts**  
> Target pembaca: Java engineer yang ingin memahami bagaimana framework, mocking tool, APM agent, ORM enhancer, DI container, dan runtime instrumentation bekerja di bawah permukaan.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- reflection metadata,
- dynamic invocation,
- dynamic proxy,
- `MethodHandle`,
- `VarHandle`,
- annotation design,
- annotation processing,
- source generation,
- runtime generation,
- bytecode generation.

Part ini adalah tempat kita menyatukan semuanya ke dalam satu mental model:

> Banyak fitur framework Java modern bukan “magic”.  
> Sebagian besar dibangun dari kombinasi **reflection**, **proxy**, **bytecode manipulation**, **class loading**, **agent instrumentation**, dan **module access control**.

Ketika engineer hanya memakai Spring, Hibernate, Mockito, MapStruct, Lombok, Micrometer, OpenTelemetry agent, atau APM agent dari luar, semuanya terlihat seperti konfigurasi.

Ketika kita membedah mekaniknya, pola dasarnya adalah:

```text
source code
   |
   v
compiled bytecode
   |
   +--> inspected by reflection
   +--> wrapped by proxy
   +--> generated into new class
   +--> transformed before/during class loading
   +--> enhanced by build-time tool
   +--> intercepted by Java agent
   +--> restricted by JPMS/module boundary
```

Part ini tidak bertujuan membuat kita langsung menulis bytecode mentah setiap hari. Tujuannya adalah agar kita mampu:

1. memahami failure mode framework,
2. mendesain API yang proxy-friendly,
3. menghindari classloader leak,
4. membuat abstraction yang tidak hancur saat diinstrumentasi,
5. memahami kenapa final/private/static/constructor sering menjadi batas interception,
6. memilih antara proxy, generated code, annotation processor, agent, atau explicit composition,
7. membaca error runtime yang biasanya terlihat “aneh”.

---

## 1. Mental Model Besar: Interception dan Augmentation

Banyak mekanisme di part ini sebenarnya menjawab satu pertanyaan:

> Bagaimana menambahkan perilaku baru ke program tanpa menulis perilaku itu secara manual di setiap call site?

Contoh perilaku tambahan:

- logging,
- metrics,
- tracing,
- security check,
- transaction boundary,
- retry,
- validation,
- lazy loading,
- dirty tracking,
- caching,
- mocking/stubbing,
- profiling,
- coverage,
- bytecode-level observation,
- compatibility adapter.

Ada beberapa tempat kita bisa memasukkan perilaku tambahan.

```text
1. Source level
   - programmer menulis wrapper/decorator manual
   - annotation processor generate source
   - Lombok-like compile-time AST/source transformation

2. Compile/build level
   - build plugin melakukan enhancement
   - ORM enhancer menambah field/method
   - generated mapper/client/model

3. Class loading level
   - class bytes ditransform sebelum class didefinisikan

4. Runtime object level
   - proxy membungkus object target
   - invocation handler/interceptor memutuskan perilaku

5. Runtime VM level
   - Java agent menginstrumentasi class
   - profiler/APM/coverage tool menambahkan bytecode observability
```

Secara konseptual, semua mekanisme tersebut adalah variasi dari:

```text
original behavior + injected behavior = observed behavior
```

Yang membedakan adalah:

| Mekanisme | Kapan terjadi | Apa yang diubah | Kelebihan | Risiko |
|---|---:|---|---|---|
| Manual decorator | source time | object graph | eksplisit, mudah dites | boilerplate |
| Annotation processor | compile time | generated source/resource | cepat runtime, type-safe | build complexity |
| Dynamic proxy | runtime | object interface | ringan, JDK built-in | interface-only |
| Class proxy/subclass | runtime | subclass generated | bisa wrap class concrete | final/private/constructor limit |
| Bytecode generation | runtime/build | class bytecode | powerful | debugging sulit |
| Java agent | JVM startup/attach | class bytecode saat load/retransform | global instrumentation | risiko besar |
| Build-time enhancement | build time | class file | predictable runtime | build pipeline complexity |

Top engineer tidak memilih mekanisme berdasarkan “paling canggih”, tetapi berdasarkan **control point** yang paling tepat.

---

## 2. Dynamic Proxy: Interface-Based Runtime Interception

JDK dynamic proxy adalah mekanisme bawaan Java untuk membuat object runtime yang:

- mengimplementasikan satu atau lebih interface,
- bukan class manual yang kita tulis,
- menerima method call,
- meneruskan call tersebut ke `InvocationHandler`.

Struktur konseptualnya:

```text
caller
  |
  v
proxy object implements SomeInterface
  |
  v
InvocationHandler.invoke(proxy, method, args)
  |
  +--> before logic
  +--> call target or synthesize result
  +--> after logic
  +--> exception handling
```

Contoh minimal:

```java
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

interface PricingService {
    long calculatePrice(String productCode, int quantity);
}

final class DefaultPricingService implements PricingService {
    @Override
    public long calculatePrice(String productCode, int quantity) {
        return 10_000L * quantity;
    }
}

final class MetricsHandler implements InvocationHandler {
    private final Object target;

    MetricsHandler(Object target) {
        this.target = target;
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        long start = System.nanoTime();
        try {
            return method.invoke(target, args);
        } finally {
            long elapsed = System.nanoTime() - start;
            System.out.println(method.getName() + " took " + elapsed + " ns");
        }
    }
}

public class ProxyDemo {
    public static void main(String[] args) {
        PricingService target = new DefaultPricingService();

        PricingService proxy = (PricingService) Proxy.newProxyInstance(
                PricingService.class.getClassLoader(),
                new Class<?>[] { PricingService.class },
                new MetricsHandler(target)
        );

        System.out.println(proxy.calculatePrice("ABC", 3));
    }
}
```

Yang penting bukan syntax-nya. Yang penting adalah modelnya:

```text
Proxy tidak “mengubah” target.
Proxy membuat object baru yang berdiri di depan target.
```

Implikasi desain:

- caller harus memegang reference ke proxy, bukan target asli,
- self-invocation di dalam target tidak lewat proxy,
- hanya method interface yang bisa diintercept,
- final class tidak masalah selama caller memakai interface,
- final method di target tidak relevan untuk JDK proxy karena proxy tidak override target method,
- object identity berubah karena proxy adalah object berbeda.

---

## 3. Self-Invocation Problem

Masalah klasik proxy-based framework:

```java
interface CaseService {
    void submit(String caseId);
    void validate(String caseId);
}

final class DefaultCaseService implements CaseService {
    @Override
    public void submit(String caseId) {
        validate(caseId); // self-invocation
        // submit logic
    }

    @Override
    public void validate(String caseId) {
        // validation logic
    }
}
```

Misalkan `validate` diberi annotation untuk metrics/security/transaction.

Jika caller memanggil:

```java
caseService.validate("C-001");
```

dan `caseService` adalah proxy, call masuk ke proxy.

Namun jika `submit` memanggil `validate` lewat `this.validate(...)`, call tersebut terjadi di dalam target object, bukan lewat proxy.

```text
external caller
   |
   v
proxy.submit()
   |
   v
handler.invoke(submit)
   |
   v
target.submit()
   |
   v
this.validate()  <-- bypass proxy
```

Ini menjelaskan banyak perilaku framework yang tampak “aneh”:

- annotation transaction tidak aktif pada method internal,
- security annotation tidak diterapkan pada self-call,
- metrics tidak muncul untuk internal call,
- retry/cache annotation tidak bekerja jika dipanggil dari method yang sama.

Solusi desain:

1. Pindahkan method yang harus diintercept ke collaborator lain.
2. Gunakan explicit decorator daripada proxy magic.
3. Hindari desain yang bergantung pada self-invocation interception.
4. Pahami apakah framework memakai interface proxy atau subclass proxy.
5. Jangan menganggap annotation sama dengan behavior; annotation hanya metadata.

---

## 4. Proxy Object dan Object Contract

Proxy bisa merusak asumsi tentang:

- `equals`,
- `hashCode`,
- `toString`,
- `getClass`,
- identity,
- serialization,
- class name,
- annotation lookup,
- generic metadata.

Contoh jebakan:

```java
if (service.getClass() == DefaultCaseService.class) {
    // mungkin false jika service adalah proxy
}
```

Lebih aman:

```java
if (service instanceof CaseService) {
    // contract-oriented
}
```

Masalah equality:

```java
entity.equals(proxyEntity)
proxyEntity.equals(entity)
```

Jika proxy mewakili entity/framework object, equality harus sangat hati-hati.

Beberapa rule praktis:

- Jangan desain business logic yang bergantung pada concrete runtime class jika object mungkin diproxy.
- Jangan gunakan `getClass() == X.class` untuk service/framework-managed object kecuali memang ingin exact-class check.
- Untuk service, lebih baik equality berbasis identity/reference atau tidak digunakan.
- Untuk entity/value object, equality harus didesain sadar proxy.
- Jangan jadikan proxy object sebagai stable serialization contract.
- Jangan expose proxy class name ke API publik.

---

## 5. Interface Proxy vs Class Proxy

Ada dua pola proxy utama:

```text
Interface proxy:
  proxy implements interface
  target implements interface

Class proxy:
  generated subclass extends target class
```

### 5.1 Interface Proxy

Kelebihan:

- built-in JDK,
- tidak perlu subclass concrete class,
- mendorong desain berbasis contract,
- lebih mudah dipahami,
- relatif aman terhadap final implementation class.

Keterbatasan:

- hanya method yang ada pada interface,
- caller harus memakai interface type,
- metadata concrete class tidak langsung terlihat pada proxy class,
- default method punya handling khusus.

### 5.2 Class Proxy / Subclass Proxy

Class proxy biasanya dibuat oleh bytecode library.

Konsepnya:

```java
class DefaultCaseService {
    void submit(String id) { ... }
}

class DefaultCaseServiceProxy extends DefaultCaseService {
    @Override
    void submit(String id) {
        // before
        super.submit(id);
        // after
    }
}
```

Kelebihan:

- bisa memproxy concrete class,
- caller tidak harus bergantung pada interface,
- cocok untuk legacy code.

Keterbatasan:

- final class tidak bisa disubclass,
- final method tidak bisa dioverride,
- private method tidak bisa dioverride,
- static method tidak polymorphic,
- constructor behavior sulit diintercept,
- equals/hashCode bisa bermasalah,
- framework perlu mengelola instantiation.

Design consequence:

> Jika class ingin framework-friendly untuk subclass proxy, jangan sembarangan membuat class/method final.  
> Jika class ingin immutable/value-like dan tidak boleh diproxy, final justru benar.

Tidak ada rule universal. Yang penting adalah niat desain.

---

## 6. Bytecode Manipulation: Apa yang Sebenarnya Diubah?

Java source dikompilasi menjadi `.class` file. Class file berisi bytecode dan metadata:

```text
ClassFile
  - constant pool
  - access flags
  - this/super class
  - interfaces
  - fields
  - methods
  - attributes
```

Bytecode manipulation berarti tool membaca dan/atau menulis struktur tersebut.

Contoh perubahan:

- menambahkan method,
- menambahkan field,
- mengganti body method,
- menyisipkan call logging di awal method,
- membungkus return value,
- menambahkan try/finally,
- menambahkan annotation,
- mengubah superclass/interface,
- membuat class baru,
- mengubah access flag,
- menambahkan metadata debug.

Penting:

> Bytecode manipulation bukan sekadar “reflection yang lebih cepat”.  
> Reflection membaca/menjalankan member yang sudah ada.  
> Bytecode manipulation bisa membuat atau mengubah class definition.

---

## 7. Library Bytecode: Level Abstraction

Ada beberapa level abstraksi.

### 7.1 Low-Level Bytecode Library

Low-level library memberi kontrol sangat detail terhadap instruction bytecode.

Karakteristik:

- sangat powerful,
- dekat dengan JVM instruction model,
- rawan salah,
- debugging sulit,
- cocok untuk compiler/tooling/instrumentation library.

Mental model:

```text
You are writing class files, not Java source.
```

Risiko:

- stack map frame salah,
- verifier error,
- invalid bytecode,
- broken generics signature,
- broken line number table,
- broken module/package access,
- incompatible bytecode target version.

### 7.2 Higher-Level Bytecode Library

Higher-level library menyediakan API yang lebih dekat ke Java concept:

- create subclass,
- intercept method,
- delegate to interceptor,
- define field,
- define method,
- load generated class,
- redefine class via instrumentation.

Mental model:

```text
You describe class behavior, library emits bytecode.
```

Kelebihan:

- lebih cepat produktif,
- lebih aman dari raw bytecode,
- cocok untuk runtime proxy/mocking/agent.

Risiko tetap ada:

- generated class identity,
- classloader lifecycle,
- module access,
- final/private/static limitation,
- version compatibility.

---

## 8. Build-Time Enhancement vs Runtime Enhancement

### 8.1 Build-Time Enhancement

Build-time enhancement terjadi setelah compile atau selama build.

```text
.java
  -> javac
  -> .class
  -> enhancer modifies .class
  -> packaged artifact
```

Kelebihan:

- predictable,
- failure lebih cepat di build,
- startup lebih ringan,
- production artifact sudah final,
- lebih mudah audit.

Kekurangan:

- build pipeline lebih kompleks,
- IDE/dev loop bisa berbeda dari production,
- harus memastikan enhanced class yang dipakai,
- debugging source-to-bytecode bisa membingungkan.

Contoh use case:

- ORM enhancement,
- framework indexing,
- compile-time injection,
- ahead-of-time optimization,
- generated client/model.

### 8.2 Runtime Enhancement

Runtime enhancement terjadi ketika aplikasi berjalan.

```text
application starts
  -> framework generates/enhances class
  -> classloader defines class
  -> object created
```

Kelebihan:

- fleksibel,
- bisa berdasarkan runtime config,
- cocok untuk plugin/dynamic behavior,
- tidak perlu build step khusus.

Kekurangan:

- startup cost,
- failure muncul di runtime,
- sulit dianalisis statically,
- butuh reflection/module access,
- GraalVM/native-image compatibility bisa lebih sulit,
- debugging lebih opaque.

### 8.3 Decision Rule

Gunakan build-time enhancement jika:

- behavior bisa diketahui saat build,
- butuh startup cepat,
- ingin failure cepat,
- ingin reproducible artifact.

Gunakan runtime enhancement jika:

- behavior bergantung runtime config,
- dynamic plugin diperlukan,
- framework ecosystem sudah mengandalkannya,
- cost/complexity masih dapat diterima.

---

## 9. Java Agent: Instrumentasi Di Level JVM

Java agent adalah mekanisme untuk menjalankan code agent di JVM dan mendapatkan akses ke `Instrumentation`.

Ada dua cara umum:

```text
1. Startup agent:
   java -javaagent:agent.jar -jar app.jar

2. Attach agent:
   agent di-attach ke JVM yang sudah berjalan
   tergantung environment dan permission
```

Agent biasanya memiliki entry point:

```java
public static void premain(String agentArgs, Instrumentation inst) {
    // called before main when using -javaagent
}

public static void agentmain(String agentArgs, Instrumentation inst) {
    // called when attached to running JVM
}
```

Dengan `Instrumentation`, agent dapat:

- mendaftarkan `ClassFileTransformer`,
- melihat loaded classes,
- melakukan retransform/redefine jika didukung,
- mengukur object size secara terbatas,
- menambahkan JAR ke bootstrap/system class loader search,
- memodifikasi module read/export/open dalam kondisi tertentu.

Mental model:

```text
class bytes
   |
   v
ClassFileTransformer
   |
   v
modified bytes
   |
   v
JVM defines/redefines class
```

Agent digunakan oleh:

- profiler,
- coverage tool,
- tracing/APM,
- monitoring,
- security agent,
- mocking tertentu,
- hot instrumentation,
- diagnostics tool.

Important distinction:

```text
Proxy intercepts object calls.
Agent transforms class definitions.
```

Proxy bekerja jika caller memegang proxy.  
Agent dapat mempengaruhi class bahkan jika caller tidak tahu apa-apa.

---

## 10. ClassFileTransformer

Transformer menerima byte array class sebelum didefinisikan atau saat retransform.

Pseudo flow:

```java
class MetricsTransformer implements ClassFileTransformer {
    @Override
    public byte[] transform(
            Module module,
            ClassLoader loader,
            String className,
            Class<?> classBeingRedefined,
            ProtectionDomain protectionDomain,
            byte[] classfileBuffer
    ) {
        if (!className.startsWith("com/acme/caseapp/")) {
            return null; // no transformation
        }

        // parse bytecode
        // modify method body
        // return transformed bytes
        return transformedBytes;
    }
}
```

Important rules:

- returning `null` means no transform,
- returning invalid bytes causes class load failure,
- transformer must be fast,
- transformer must avoid recursive class loading traps,
- transformer should limit scope aggressively,
- transformer should be deterministic.

Failure model:

```text
bad transformer
  -> ClassFormatError
  -> VerifyError
  -> NoClassDefFoundError
  -> LinkageError
  -> startup failure
  -> partial instrumentation
  -> performance regression
```

---

## 11. Instrumentation and Observability Agents

APM/tracing agents often instrument:

- servlet/filter handling,
- HTTP clients,
- JDBC calls,
- message consumers/producers,
- executor/task submission,
- scheduled jobs,
- logging context,
- framework lifecycle hooks.

Conceptual example:

```text
Original method:

  Response handle(Request req) {
      return next.handle(req);
  }

Instrumented method:

  Response handle(Request req) {
      Span span = tracer.startSpan("http.server");
      try {
          return next.handle(req);
      } catch (Throwable t) {
          span.recordException(t);
          throw t;
      } finally {
          span.end();
      }
  }
```

This is why instrumentation can add visibility without changing application source.

But there are risks:

- double instrumentation,
- wrong span boundary,
- context propagation bug,
- async boundary loss,
- classloader conflict,
- module access issue,
- startup overhead,
- runtime overhead,
- hidden dependency on framework internals,
- incompatible framework version.

Production rule:

> Treat agents as part of runtime architecture, not just “ops configuration”.

---

## 12. Mocking Framework Mechanics

Mocking framework may use:

- dynamic proxy for interfaces,
- subclass proxy for classes,
- bytecode generation,
- instrumentation to mock final classes/methods depending on framework/configuration,
- method interception to return stubbed values,
- invocation recording to verify calls.

Conceptual mock:

```text
test
  |
  v
mock object
  |
  v
interceptor
  |
  +--> record invocation
  +--> check stubbing
  +--> return configured result
```

This explains common test pitfalls:

- mocking final/static/private requires special machinery,
- constructor behavior is hard,
- equals/hashCode/toString may be special-cased,
- mocking too much hides bad design,
- tests become coupled to interaction details instead of behavior.

Design implication:

> If a class is impossible to test without heavy mocking/instrumentation, the design may be hiding too much work behind concrete static/global behavior.

Prefer:

- explicit dependency injection,
- small interfaces for external side effects,
- pure domain functions,
- real value objects,
- fake implementation over deep mocks when possible.

---

## 13. ORM Lazy Proxy and Enhancement Mechanics

ORM frameworks often need:

- lazy loading,
- dirty tracking,
- relationship navigation,
- change detection,
- entity lifecycle hooks.

They can achieve this via:

1. runtime proxy/subclass,
2. bytecode enhancement,
3. field interception,
4. generated accessor,
5. build-time enhancement.

Lazy proxy concept:

```text
Order proxy
  - id known
  - fields not loaded

order.getCustomer()
  -> proxy intercepts access
  -> session loads data
  -> returns customer
```

Problems:

- `equals` can trigger lazy loading,
- `toString` can trigger lazy loading,
- serialization can accidentally load graph,
- closed session can cause lazy initialization failure,
- final class/method blocks subclass proxy,
- field access bypasses accessor interception depending on enhancement mode,
- records are usually poor entity candidates because fixed final state conflicts with ORM mutation/lifecycle.

Domain design rule:

> Persistence object model and domain model may overlap, but they are not the same thing.  
> Proxy/enhancement requirements should not silently dictate your domain invariants.

---

## 14. AOP Mechanics

Aspect-oriented programming biasanya memakai interception.

Common join points:

- method execution,
- method call,
- constructor execution,
- field get/set,
- exception handler,
- annotation-based pointcut,
- package/class pattern.

Proxy-based AOP biasanya hanya method execution pada object yang diproxy.

Bytecode weaving/instrumentation bisa lebih luas, tergantung tool.

```text
Proxy AOP:
  external call -> proxy -> target method

Weaving/instrumentation:
  bytecode itself changed
```

Konsekuensi:

| Concern | Proxy AOP | Bytecode weaving/agent |
|---|---|---|
| Self-invocation | biasanya bypass | bisa diinstrumentasi |
| Private method | tidak | mungkin, tergantung weaving |
| Constructor | tidak normal | mungkin terbatas |
| Field access | tidak | mungkin |
| Complexity | lebih rendah | lebih tinggi |
| Debugging | sedang | sulit |
| Blast radius | object tertentu | bisa global |

Design smell:

- semua cross-cutting concern dimasukkan via annotation tanpa boundary jelas,
- business logic bergantung pada aspect tersembunyi,
- aspek mengubah behavior, bukan hanya menambah concern,
- ordering aspect tidak jelas,
- exception semantics berubah secara implisit.

---

## 15. Final, Private, Static, Constructor: Kenapa Sering Menjadi Batas?

### 15.1 Final Class

Final class tidak bisa disubclass.

```java
final class PaymentService {
}
```

Subclass proxy tidak bisa dibuat.

Namun interface proxy tetap bisa jika object diakses via interface:

```java
interface PaymentPort {
    void pay();
}
```

### 15.2 Final Method

Final method tidak bisa dioverride.

```java
class PaymentService {
    final void pay() {}
}
```

Subclass proxy tidak bisa intercept lewat overriding.

### 15.3 Private Method

Private method tidak polymorphic.

```java
class PaymentService {
    private void validate() {}
}
```

Subclass tidak bisa override private method.

### 15.4 Static Method

Static method bukan dynamic dispatch.

```java
PaymentRules.validate(...)
```

Static method sulit diproxy karena tidak ada object receiver.

### 15.5 Constructor

Constructor bukan normal overridable method. Object belum sepenuhnya terbentuk.

Interception constructor lebih rumit dan biasanya butuh bytecode instrumentation.

Design implication:

- Gunakan final untuk value object, immutable class, security-sensitive invariant.
- Hindari final pada service method jika framework subclass proxy dibutuhkan.
- Hindari static global behavior untuk dependency yang perlu diganti/diobservasi/dites.
- Jangan taruh heavy side effect di constructor.
- Jangan bergantung pada constructor interception.

---

## 16. ClassLoader Identity and Generated Classes

Di JVM, class identity bukan hanya nama class.

```text
class identity = fully qualified binary name + defining class loader
```

Artinya dua class dengan nama sama bisa berbeda jika didefinisikan oleh classloader berbeda.

```text
loaderA defines com.acme.Plugin
loaderB defines com.acme.Plugin

com.acme.Plugin from loaderA != com.acme.Plugin from loaderB
```

Generated/proxy/instrumented code sering bermain dengan classloader.

Failure umum:

- `ClassCastException: X cannot be cast to X`,
- memory leak karena classloader tertahan,
- duplicate generated classes,
- stale generated proxy,
- plugin unload gagal,
- DevTools reload leak,
- application server redeploy leak.

Classloader leak biasanya terjadi saat object dari child/application classloader disimpan oleh static field di parent/bootstrap/shared loader.

```text
Parent/static registry
   |
   v
reference to app class/proxy/lambda/thread
   |
   v
application classloader cannot be GCed
```

Rule:

- Jangan simpan application class di global static registry tanpa cleanup.
- Gunakan weak reference/cache yang classloader-aware jika perlu.
- Pastikan agent/framework membersihkan transformer/listener/thread.
- Hindari thread context classloader leak.
- Jangan cache `Class<?>`, `Method`, generated class secara global tanpa key classloader.
- Plugin architecture harus punya explicit lifecycle.

---

## 17. JPMS and Instrumentation

Java Platform Module System menambah lapisan boundary:

- package bisa exported atau tidak,
- package bisa opened untuk reflection atau tidak,
- module punya readability graph,
- unnamed/classpath world berbeda dari named modules.

Proxy/generation/instrumentation dapat gagal karena:

- generated class berada di module/package yang tidak punya access,
- reflection deep access ditolak,
- package tidak opened,
- class tidak readable,
- split package,
- agent perlu membuka module secara dinamis,
- framework butuh `--add-opens`.

Konsep penting:

```text
exports = compile/runtime access to public types
opens   = deep reflection access
```

Jangan samakan.

Untuk framework:

```java
module com.acme.caseapp {
    requires com.fasterxml.jackson.databind;

    exports com.acme.caseapp.api;

    opens com.acme.caseapp.web.dto to com.fasterxml.jackson.databind;
}
```

Design rule:

- Export hanya API yang memang public.
- Open package hanya untuk framework yang membutuhkan reflection.
- Prefer qualified opens daripada open module.
- Jangan `opens` semua package karena malas.
- Dokumentasikan reflective requirements.
- Test aplikasi dalam mode module path jika production memakai JPMS.
- Pastikan generated/proxy classes punya access yang benar.

---

## 18. Security and Supply Chain Risk

Bytecode/instrumentation adalah powerful. Karena powerful, risikonya besar.

Risiko:

- agent bisa mengamati data sensitif,
- transformer bisa mengubah behavior security check,
- generated code bisa menyisipkan unsafe logic,
- dependency bytecode library bisa menjadi supply-chain vector,
- build-time enhancer bisa mengubah artifact tanpa review jelas,
- reflection/proxy bisa bypass intended encapsulation,
- instrumentation bisa mengumpulkan PII/token tanpa sengaja.

Production controls:

- inventory semua Java agent yang dipasang,
- review agent version dan source,
- pin dependency version,
- verify checksum/signature jika memungkinkan,
- pisahkan agent config per environment,
- batasi data yang dikirim ke observability backend,
- jangan instrumentasi secret-bearing method sembarangan,
- audit generated/enhanced artifact,
- gunakan SBOM/dependency scanning,
- dokumentasikan `--add-opens` dan alasan.

Top engineer melihat agent bukan sebagai “plugin kecil”, tetapi sebagai code yang ikut berjalan di trust boundary aplikasi.

---

## 19. Performance Model

Proxy/instrumentation cost tidak selalu besar, tetapi tidak gratis.

Cost components:

```text
proxy call overhead
  + reflective invocation overhead
  + interceptor chain overhead
  + allocation args array
  + boxing/unboxing
  + metadata lookup
  + lock/contention in metrics
  + exception path cost
  + JIT optimization barrier
```

Bytecode-generated interceptor bisa lebih cepat dari reflection invocation, tetapi:

- startup bisa lebih mahal,
- class generation/loading punya cost,
- JIT warmup berubah,
- too many generated classes bisa membebani metaspace,
- instrumentation di hot path bisa signifikan,
- metrics/tracing yang terlalu granular bisa mahal.

Rule:

- Jangan instrumentasi method sangat hot tanpa sampling/benchmark.
- Cache metadata/interceptor chain.
- Hindari reflection lookup per call.
- Hindari allocation per call jika hot path.
- Ukur overhead di workload realistis.
- Perhatikan cold start dan warmup.
- Pastikan fallback jika agent bermasalah.

---

## 20. Debugging Generated/Instrumented Code

Debugging masalah proxy/instrumentation butuh pola berbeda.

Pertanyaan awal:

1. Object yang dipanggil adalah target asli atau proxy?
2. Proxy berbasis interface atau subclass?
3. Apakah method final/private/static?
4. Apakah call berasal dari luar proxy atau self-invocation?
5. Apakah class sudah diinstrumentasi?
6. Apakah classloader-nya sama?
7. Apakah module/package terbuka?
8. Apakah ada lebih dari satu agent?
9. Apakah instrumentation order berpengaruh?
10. Apakah error muncul saat load, link, initialize, atau invocation?

Useful inspection:

```java
Object bean = getService();

System.out.println(bean.getClass());
System.out.println(Arrays.toString(bean.getClass().getInterfaces()));
System.out.println(bean instanceof CaseService);
System.out.println(Proxy.isProxyClass(bean.getClass()));
```

Untuk JDK proxy:

```java
InvocationHandler handler = Proxy.getInvocationHandler(bean);
System.out.println(handler.getClass());
```

Untuk classloader:

```java
Class<?> type = bean.getClass();
System.out.println(type.getName());
System.out.println(type.getClassLoader());
System.out.println(type.getModule());
```

Debugging mindset:

```text
Do not debug only source code.
Debug the effective runtime shape.
```

---

## 21. API Design Agar Proxy/Instrumentation Friendly

Checklist desain service/framework-managed object:

- expose contract via interface jika proxy interface diperlukan,
- jangan bergantung pada concrete class check,
- hindari self-invocation untuk method yang perlu diintercept,
- jangan taruh business-critical behavior di annotation tersembunyi tanpa test,
- hindari final method jika subclass proxy diperlukan,
- jangan gunakan static global dependencies untuk behavior yang perlu diganti/diobservasi,
- constructor ringan dan bebas side effect berat,
- method public punya clear contract,
- exception semantics jelas,
- idempotency jelas untuk retry interceptor,
- transaction boundary explicit,
- object equality tidak bergantung pada proxy class,
- package/module opens documented,
- generated/proxy behavior dites.

Untuk value object:

- final class boleh dan sering benar,
- no proxy expected,
- immutable,
- explicit equality,
- no framework magic.

Untuk entity ORM:

- pahami syarat framework,
- hindari final jika framework butuh subclassing,
- equality sadar lifecycle/proxy,
- no heavy `toString`,
- lazy graph tidak otomatis ditraverse.

Untuk library publik:

- jangan expose generated class sebagai public contract,
- expose stable interface/record/class,
- generated implementation internal,
- document interception assumptions,
- maintain binary compatibility.

---

## 22. Memilih Mekanisme yang Tepat

Decision matrix:

| Kebutuhan | Mekanisme yang biasanya cocok |
|---|---|
| Logging/metrics di satu service | manual decorator atau proxy |
| Cross-cutting transaction/security | framework proxy/AOP |
| Compile-time mapper | annotation processor/source generation |
| Runtime plugin implementation | ServiceLoader + generated/proxy optional |
| Mock interface | JDK proxy/mock framework |
| Mock concrete/final class | bytecode/instrumentation-based mock |
| ORM lazy loading | proxy/enhancement |
| Dirty tracking | bytecode enhancement |
| APM/tracing global | Java agent instrumentation |
| Static architecture rule | annotation processor/static analysis |
| Highly stable performance hot path | explicit code or build-time generation |
| Native-image friendly design | minimize runtime reflection/proxy; prefer generated/static config |
| Strong module encapsulation | explicit exports/opens; avoid deep magic |

Rule of thumb:

```text
Prefer explicit composition first.
Use proxy when interception is localized and contract-based.
Use generated code when repeated boilerplate can be derived safely.
Use bytecode instrumentation when you need control below source/API level.
Use Java agent only when runtime-wide observation/transformation is justified.
```

---

## 23. Case Study: Regulatory Case Workflow Interceptor

Misalkan kita punya case management platform dengan operation:

```java
interface CaseCommandService {
    SubmitResult submit(SubmitCommand command);
    EscalateResult escalate(EscalateCommand command);
    CloseResult close(CloseCommand command);
}
```

Kita ingin:

- audit setiap command,
- enforce authorization,
- validate transition,
- emit metric,
- trace duration,
- retry hanya untuk transient infrastructure failure,
- tidak merusak domain decision.

Naive design:

```java
@Audited
@Secured
@Transactional
@Timed
@Retryable
public SubmitResult submit(SubmitCommand command) {
    // all logic here
}
```

Masalah:

- behavior tersembunyi di annotation,
- ordering tidak jelas,
- self-invocation risk,
- retry bisa mengulang side effect non-idempotent,
- transaction boundary tidak terlihat,
- audit bisa terjadi sebelum/ sesudah commit secara salah,
- test sering hanya mock framework.

Better architecture:

```text
HTTP/API layer
   |
   v
Command endpoint
   |
   v
Authorization decorator
   |
   v
Validation decorator
   |
   v
Transaction boundary
   |
   v
Domain command handler
   |
   v
Outbox/audit persistence
   |
   v
Post-commit publisher/metrics/tracing
```

Proxy/AOP tetap boleh dipakai, tapi boundary-nya dipahami:

```text
proxy/interceptor = mechanical cross-cutting support
domain handler    = source of business truth
```

Possible implementation:

```java
final class AuditingCaseCommandService implements CaseCommandService {
    private final CaseCommandService delegate;
    private final AuditSink auditSink;

    AuditingCaseCommandService(CaseCommandService delegate, AuditSink auditSink) {
        this.delegate = delegate;
        this.auditSink = auditSink;
    }

    @Override
    public SubmitResult submit(SubmitCommand command) {
        auditSink.before("submit", command.caseId());
        try {
            SubmitResult result = delegate.submit(command);
            auditSink.afterSuccess("submit", command.caseId(), result.decisionId());
            return result;
        } catch (RuntimeException ex) {
            auditSink.afterFailure("submit", command.caseId(), ex);
            throw ex;
        }
    }

    @Override
    public EscalateResult escalate(EscalateCommand command) {
        auditSink.before("escalate", command.caseId());
        try {
            EscalateResult result = delegate.escalate(command);
            auditSink.afterSuccess("escalate", command.caseId(), result.decisionId());
            return result;
        } catch (RuntimeException ex) {
            auditSink.afterFailure("escalate", command.caseId(), ex);
            throw ex;
        }
    }

    @Override
    public CloseResult close(CloseCommand command) {
        auditSink.before("close", command.caseId());
        try {
            CloseResult result = delegate.close(command);
            auditSink.afterSuccess("close", command.caseId(), result.decisionId());
            return result;
        } catch (RuntimeException ex) {
            auditSink.afterFailure("close", command.caseId(), ex);
            throw ex;
        }
    }
}
```

Kemudian jika boilerplate terlalu banyak, kita bisa generate decorator source atau memakai proxy dengan metadata.

Key insight:

> Generated/proxy mechanism adalah implementation detail.  
> Boundary dan semantics harus tetap jelas di architecture.

---

## 24. Failure Model Lengkap

### 24.1 Proxy Failure

| Symptom | Kemungkinan penyebab |
|---|---|
| Annotation tidak bekerja | object bukan proxy |
| Annotation tidak bekerja pada internal call | self-invocation |
| Method tidak terintercept | method tidak ada di interface / final / private |
| `ClassCastException` | classloader/proxy type mismatch |
| `equals` aneh | proxy identity/equality issue |
| `getClass()` tidak sesuai | object adalah proxy/generated subclass |
| Performance turun | interceptor/reflection overhead |

### 24.2 Bytecode Failure

| Symptom | Kemungkinan penyebab |
|---|---|
| `VerifyError` | invalid bytecode/stack frame |
| `ClassFormatError` | malformed class file |
| `NoSuchMethodError` | transformed code refer ke method tidak ada |
| `IllegalAccessError` | access/module boundary |
| `LinkageError` | duplicate/incompatible class definition |
| Debug line salah | line number/source map rusak |
| Native image gagal | dynamic behavior tidak dikonfigurasi |

### 24.3 Agent Failure

| Symptom | Kemungkinan penyebab |
|---|---|
| startup lambat | transformer terlalu luas |
| aplikasi gagal start | invalid transformation |
| trace dobel | double instrumentation |
| memory leak | classloader/thread/static registry leak |
| observability hilang | class tidak match matcher |
| security incident | data sensitif dikirim agent |
| prod-only bug | environment agent beda dari test |

---

## 25. Practical Engineering Checklist

Sebelum memakai proxy/instrumentation:

- Apa concern yang ingin ditambahkan?
- Apakah concern itu mekanis atau business-critical?
- Apakah explicit decorator cukup?
- Apakah interface proxy cukup?
- Apakah class proxy diperlukan?
- Apakah final/private/static/constructor menjadi masalah?
- Apakah self-invocation akan terjadi?
- Apakah equality/class identity aman?
- Apakah module opens/exports sudah jelas?
- Apakah classloader lifecycle aman?
- Apakah failure terjadi di build/startup/runtime?
- Apakah generated/instrumented code bisa di-debug?
- Apakah performance di hot path terukur?
- Apakah agent/dependency disetujui secara security?
- Apakah test mencakup effective runtime shape?

---

## 26. Anti-Pattern

### 26.1 Magic Annotation Architecture

```java
@Everything
public void process() { ... }
```

Masalah:

- behavior tidak terbaca,
- ordering tidak jelas,
- test rapuh,
- debugging sulit,
- framework lock-in kuat.

### 26.2 Proxy as Domain Model

Proxy adalah mekanisme runtime, bukan domain concept.

Jangan buat domain invariant bergantung pada “apakah object ini proxy”.

### 26.3 Instrument Everything

Instrumentasi terlalu luas menyebabkan:

- overhead,
- noise,
- data sensitif terekspos,
- startup lambat,
- classloading bug.

### 26.4 Generated Code Without Ownership

Generated code tetap harus punya:

- owner,
- versioning,
- source of truth,
- test,
- review strategy,
- cleanup strategy.

### 26.5 Static Utility Everywhere

Static utility sulit diproxy, sulit diganti, sulit diamati, dan sering menjadi hidden dependency.

Gunakan static untuk pure utility yang benar-benar stateless dan deterministic.

---

## 27. Ringkasan Mental Model

Kita bisa merangkum part ini dalam satu diagram:

```text
                         +------------------+
                         |   Source Code    |
                         +------------------+
                                  |
                                  v
                         +------------------+
                         |     Bytecode     |
                         +------------------+
                                  |
          +-----------------------+-----------------------+
          |                       |                       |
          v                       v                       v
+------------------+   +--------------------+   +-------------------+
| Runtime Proxy    |   | Bytecode Generator |   | Java Agent        |
| object wrapper   |   | new/enhanced class |   | transform classes |
+------------------+   +--------------------+   +-------------------+
          |                       |                       |
          v                       v                       v
+---------------------------------------------------------------+
| Effective Runtime Program Shape                               |
| - actual class                                                |
| - actual classloader                                          |
| - actual module                                               |
| - actual dispatch path                                        |
| - actual interceptor/transformer behavior                     |
+---------------------------------------------------------------+
```

Top engineer tidak hanya bertanya:

```text
What does the source say?
```

Tetapi juga:

```text
What is the effective runtime shape?
Who owns the generated/transformed behavior?
Where is the boundary?
What can fail when framework magic is removed?
What is the blast radius?
```

---

## 28. Hubungan Dengan Part Berikutnya

Part ini membahas mekanik dynamic proxy, bytecode library, agent, dan instrumentation.

Part berikutnya akan masuk ke level architecture source organization:

> **Package Architecture: Naming, Visibility, Boundaries, and Internal APIs**

Kenapa ini penting setelah proxy/instrumentation?

Karena semakin kuat kemampuan runtime mengakses dan mengubah program, semakin penting juga kita memiliki boundary source-level yang jelas:

- package mana public API,
- package mana internal,
- package mana boleh direfleksi,
- package mana boleh digenerate,
- package mana boleh diexport module,
- package mana tidak boleh disentuh framework.

Tanpa package architecture yang rapi, reflection/proxy/codegen/instrumentation berubah dari alat bantu menjadi sumber chaos.

---

## 29. Status Seri

Seri **belum selesai**.

Part yang sudah selesai sampai saat ini:

- Part 000 — Orientation
- Part 001 — Java Type System Deep Dive
- Part 002 — Class Anatomy
- Part 003 — Object Identity, Equality, Hashing, Immutability
- Part 004 — Encapsulation Beyond `private`
- Part 005 — Inheritance Deep Dive
- Part 006 — Interfaces Deep Dive
- Part 007 — Sealed Classes
- Part 008 — Records Deep Dive
- Part 009 — Enums
- Part 010 — Nested, Inner, Local, and Anonymous Classes
- Part 011 — Generics for API Designers
- Part 012 — Advanced Polymorphism
- Part 013 — Composition, Delegation, Mixins, and Object Collaboration
- Part 014 — Functional Java Mental Model
- Part 015 — Lambdas Under the Hood
- Part 016 — Functional Interfaces and Higher-Order API Design
- Part 017 — Optional, Nullability, Result Modeling, and Error Channels
- Part 018 — Reflection Deep Dive I
- Part 019 — Reflection Deep Dive II
- Part 020 — MethodHandles and VarHandles
- Part 021 — Annotation Design
- Part 022 — Annotation Processing
- Part 023 — Code Generation Strategy
- Part 024 — Dynamic Proxy, Bytecode Libraries, Agents, and Instrumentation Concepts

Berikutnya:

- **Part 025 — Package Architecture: Naming, Visibility, Boundaries, and Internal APIs**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-023](./learn-java-oop-functional-reflection-codegen-modules-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-025](./learn-java-oop-functional-reflection-codegen-modules-part-025.md)

# learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime — Part 000

# Orientation: Enterprise Runtime Mental Model

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Part: `000`  
> Topik: **Orientation: Enterprise Runtime Mental Model**  
> Target Java: **Java 8 sampai Java 25**  
> Target platform: **Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI, Enterprise Beans, container runtime, configuration, profile, feature flag**  
> Status seri: **Belum selesai — ini bagian awal/fondasi.**

---

## 0. Tujuan Bagian Ini

Bagian ini bukan langsung menghafal annotation seperti `@Inject`, `@ApplicationScoped`, `@Stateless`, `@PostConstruct`, `@Resource`, atau `@ConfigProperty`.

Bagian ini membangun **mental model runtime enterprise Java**:

- siapa yang membuat object,
- siapa yang memiliki object,
- kapan object hidup,
- kapan object mati,
- bagaimana dependency ditemukan,
- bagaimana dependency dipilih,
- bagaimana proxy bekerja,
- bagaimana interceptor/decorator masuk ke method call,
- bagaimana configuration masuk ke object graph,
- bagaimana container menghubungkan CDI, Enterprise Beans, transaction, security, resource, thread, dan deployment.

Kalau mental model ini kuat, annotation tidak lagi terasa sebagai “magic”. Annotation menjadi **metadata contract** antara kode dan runtime.

---

## 1. Kenapa Seri Ini Penting Setelah Seri Sebelumnya

Sebelumnya kita sudah membahas banyak fondasi:

- Java core,
- collections dan streams,
- concurrency dan reactive,
- data types,
- reliability,
- DSA,
- I/O dan networking,
- security dan cryptography,
- SQL/JDBC/HikariCP,
- OOP/functional/reflection/codegen/modules,
- testing/benchmarking/performance/JVM,
- memory/byte/bit/buffer/offheap/GC,
- Jakarta,
- Bean Validation,
- JPA/Jakarta Persistence,
- JAX-RS advance.

Seri ini berada di atas semua itu.

Kalau seri JPA membahas **bagaimana entity dipetakan ke database**, seri ini membahas:

> bagaimana repository/service/controller/resource/entity-manager/config/client/policy/audit component itu ditemukan, dibuat, diinjeksi, diproxy, diberi scope, diberi transaksi, dan dihancurkan oleh runtime.

Kalau seri JAX-RS membahas **bagaimana HTTP request masuk ke resource method**, seri ini membahas:

> resource object itu dibuat oleh siapa, dependency-nya datang dari mana, config-nya dipilih dari mana, security/transaction/interceptor-nya masuk lewat jalur apa, dan apa yang terjadi saat request keluar dari thread/container boundary.

Kalau seri concurrency membahas **thread, lock, async, memory visibility**, seri ini membahas:

> kenapa membuat `new Thread()` di application server bisa menjadi bug runtime, kenapa `@RequestScoped` hilang di async task, dan bagaimana managed executor/context propagation bekerja.

Kalau seri reflection/codegen membahas **kemampuan Java membaca dan membentuk struktur runtime**, seri ini membahas:

> bagaimana container memakai annotation metadata, classpath scanning, proxy generation, interception, provider discovery, dan deployment validation.

---

## 2. Masalah Utama: Banyak Developer Belajar Annotation, Bukan Runtime

Banyak developer enterprise Java belajar seperti ini:

```java
@Inject
private UserService userService;

@ApplicationScoped
public class UserService {
}
```

Lalu menyimpulkan:

> “CDI itu dependency injection.”

Itu benar, tapi terlalu dangkal.

CDI bukan hanya “inject object”. CDI adalah **runtime graph construction and contextual access model**.

EJB/Enterprise Beans bukan hanya `@Stateless`. Ia adalah **component model dengan transaction, concurrency, pooling, security, remoting, async, dan timer semantics**.

Jakarta Annotations bukan hanya `@PostConstruct`. Ia adalah **common lifecycle/resource/security metadata layer**.

Configuration bukan hanya `System.getenv("FOO")`. Ia adalah **runtime contract yang mengendalikan variasi deployment tanpa mengubah artifact**.

Feature flag bukan hanya `if (enabled)`. Ia adalah **runtime decisioning layer** yang mengatur risiko rollout, kill-switch, auditability, dan behavioral consistency.

Top engineer tidak hanya bertanya:

> “Annotation apa yang harus dipakai?”

Mereka bertanya:

> “Runtime contract apa yang sedang saya buat, siapa pemilik lifecycle-nya, boundary apa yang dilanggar, dan failure mode apa yang muncul saat ini berjalan di cluster production?”

---

## 3. Mental Model Besar: Enterprise Runtime sebagai Object Civilization

Bayangkan aplikasi Java enterprise bukan sebagai kumpulan class, tapi sebagai **peradaban object**.

Setiap object punya:

- identitas type,
- role,
- dependency,
- lifecycle,
- scope,
- thread boundary,
- config dependency,
- resource dependency,
- transaction expectation,
- security expectation,
- observability expectation.

Container adalah “pemerintah runtime” yang mengatur:

- object mana yang boleh hidup,
- kapan dibuat,
- kapan dihancurkan,
- siapa boleh memanggil siapa,
- dependency mana yang valid,
- transaksi kapan dimulai,
- interceptor mana yang membungkus call,
- resource external mana yang boleh dipakai,
- config mana yang aktif,
- context apa yang tersedia di thread sekarang.

Diagram sederhana:

```text
Source Code
  |
  | compile
  v
Artifact: JAR / WAR / EAR / bootable JAR
  |
  | deploy / bootstrap
  v
Runtime Container
  |
  +-- scans classes and metadata
  +-- resolves dependencies
  +-- builds bean metadata graph
  +-- validates ambiguity/unsatisfied dependencies
  +-- creates proxies
  +-- binds resources
  +-- activates contexts
  +-- applies interceptors/decorators
  +-- serves requests/messages/timers/jobs
  +-- destroys contextual instances
```

Tanpa mental model ini, error runtime seperti berikut terlihat random:

```text
Unsatisfied dependency for type PaymentGateway
Ambiguous dependencies for type Clock
WELD-001437 Bean type is not proxyable
ContextNotActiveException
NameNotFoundException
NoSuchMethodError
ClassCastException: com.foo.X cannot be cast to com.foo.X
TransactionRequiredException
EJBException: Concurrent access timeout
```

Dengan mental model ini, error tersebut menjadi sinyal yang bisa dipetakan ke fase runtime tertentu.

---

## 4. Pertanyaan Fondasi: Siapa yang Memiliki Object?

Di Java SE biasa:

```java
UserRepository repo = new JdbcUserRepository(dataSource);
UserService service = new UserService(repo);
```

Kode kita membuat object. Kode kita memilih implementation. Kode kita menentukan kapan object mati.

Di runtime enterprise:

```java
@Inject
UserService service;
```

Pertanyaannya bukan “bagaimana object dibuat?”, tapi:

- siapa yang membuat `UserService`?
- kapan dibuat?
- berapa instance yang dibuat?
- apakah instance itu asli atau proxy?
- apakah instance sama untuk semua request?
- apakah instance aman dipakai banyak thread?
- apakah dependency-nya sudah valid saat startup?
- apakah config-nya dibaca saat startup atau tiap call?
- apakah method call melewati interceptor?
- apakah ada transaction context?
- apakah destruction callback dipanggil?

Ini perubahan paradigma:

```text
Manual Java SE object model:
  application code owns object lifecycle

Enterprise managed object model:
  container/runtime owns object lifecycle
```

Itulah inti **Inversion of Control**.

Bukan hanya dependency-nya yang dibalik, tapi **kepemilikan runtime**.

---

## 5. Managed vs Unmanaged Object

### 5.1 Unmanaged Object

Unmanaged object adalah object yang dibuat langsung oleh kode aplikasi:

```java
var service = new UserService();
```

Ciri-ciri:

- container tidak tahu object ini,
- injection tidak otomatis terjadi,
- interceptor tidak otomatis berlaku,
- lifecycle callback tidak otomatis dipanggil,
- scope CDI tidak berlaku,
- transaction/security annotation mungkin tidak berlaku,
- destruction tidak dikelola container.

Contoh masalah:

```java
public class ReportJob {
    public void run() {
        var service = new ReportService();
        service.generate();
    }
}
```

Jika `ReportService` bergantung pada `@Inject EntityManager em`, maka dependency tidak akan otomatis terisi karena object dibuat manual.

### 5.2 Managed Object

Managed object adalah object yang ditemukan dan dikelola runtime:

```java
@ApplicationScoped
public class ReportService {
    @Inject
    AuditService auditService;
}
```

Ciri-ciri:

- container mengenali class ini sebagai bean/component,
- injection dilakukan oleh container,
- lifecycle callback dapat dipanggil,
- scope diterapkan,
- proxy dapat dibuat,
- interceptor/decorator dapat diterapkan,
- context dapat mengontrol instance yang benar.

### 5.3 Konsekuensi Desain

Dalam enterprise runtime, pertanyaan desain pertama adalah:

> Apakah object ini harus managed atau unmanaged?

Tidak semua object harus managed.

Object yang biasanya cocok unmanaged:

- value object,
- DTO,
- command object,
- event payload,
- immutable domain object,
- small calculation object,
- object yang tidak membutuhkan injection/lifecycle/context.

Object yang biasanya cocok managed:

- application service,
- repository/DAO,
- external client adapter,
- configuration holder,
- policy evaluator,
- scheduler/timer handler,
- event observer,
- interceptor/decorator,
- resource producer,
- integration boundary.

Rule praktis:

```text
Jika object butuh dependency runtime, config, resource, lifecycle, scope, transaction, security, interceptor, atau contextual behavior, pertimbangkan managed.

Jika object hanya membawa data/invariant murni, biarkan unmanaged/plain Java object.
```

---

## 6. Enterprise Runtime bukan Satu Hal

Istilah “container” sering dipakai terlalu umum. Dalam Java enterprise, ada beberapa jenis runtime/container.

### 6.1 Java SE Runtime

Ini runtime paling dasar:

```text
main(String[] args)
```

Kita sendiri yang mengatur:

- object creation,
- lifecycle,
- thread,
- config,
- shutdown,
- dependency wiring.

CDI dapat berjalan di Java SE dengan bootstrap tertentu, tapi Java SE sendiri tidak otomatis menyediakan Jakarta EE container penuh.

### 6.2 Servlet/Web Container

Contoh konsep:

- Tomcat,
- Jetty,
- Undertow,
- web profile runtime.

Tugas umum:

- menerima HTTP request,
- mapping servlet/filter/listener,
- lifecycle web application,
- session management,
- classloader webapp,
- resource dispatch.

JAX-RS runtime dapat berjalan di atas web container.

### 6.3 CDI Container

Tugas utama:

- bean discovery,
- dependency resolution,
- context management,
- injection,
- producer/disposer,
- events,
- interceptors,
- decorators,
- extension integration.

Contoh provider/implementation:

- Weld,
- OpenWebBeans,
- ArC pada Quarkus sebagai CDI-based container model.

### 6.4 EJB / Enterprise Beans Container

Tugas utama:

- session bean lifecycle,
- pooling,
- transaction management,
- concurrency management,
- security context,
- timer service,
- asynchronous method,
- remoting/local business interface.

### 6.5 Full Jakarta EE Application Server

Full runtime menggabungkan banyak subsystem:

```text
HTTP / Servlet
JAX-RS
CDI
EJB / Enterprise Beans
JPA
JTA
JMS
Bean Validation
JSON-B / JSON-P
Security
Concurrency
Mail
Batch
WebSocket
Resource adapters
JNDI
```

Contoh server/runtime di dunia Jakarta EE:

- WildFly/JBoss EAP,
- Payara/GlassFish,
- Open Liberty/WebSphere Liberty,
- TomEE,
- Helidon/Nima/MicroProfile-adjacent runtimes tergantung profile,
- Quarkus untuk model build-time optimized dengan CDI/MicroProfile/Jakarta subset.

Catatan penting:

> Tidak semua runtime mendukung semua spesifikasi. Selalu bedakan API yang ada di classpath dari capability yang benar-benar disediakan runtime.

---

## 7. Library vs Framework vs Container vs Platform

Istilah ini sering tercampur.

### 7.1 Library

Library dipanggil oleh kode kita.

```java
var value = objectMapper.readValue(json, User.class);
```

Kita mengontrol kapan library dipakai.

### 7.2 Framework

Framework memanggil kode kita.

Contoh:

```java
@Path("/users")
public class UserResource {
    @GET
    public List<UserDto> list() { ... }
}
```

JAX-RS runtime memanggil method kita saat HTTP request cocok.

### 7.3 Container

Container mengelola lifecycle dan context object.

Contoh:

```java
@ApplicationScoped
public class UserService {
    @PostConstruct
    void init() { ... }
}
```

Container menentukan kapan object dibuat, dependency diisi, dan callback dipanggil.

### 7.4 Platform

Platform adalah kumpulan spesifikasi dan kontrak.

Jakarta EE bukan satu library. Ia adalah platform spesifikasi yang mendefinisikan banyak API dan behavioral contract.

Diagram:

```text
Library:
  your code -> library

Framework:
  framework -> your code

Container:
  container -> creates/injects/proxies/contextualizes your objects

Platform:
  standardized set of APIs + behavior contracts + compatibility expectations
```

---

## 8. API, Specification, Implementation, Provider

Java enterprise sangat specification-driven.

Contoh:

```text
Jakarta CDI API
  defines annotations/interfaces/contracts

CDI Implementation
  Weld / OpenWebBeans / ArC
  actually performs discovery, injection, proxying, context management
```

Contoh lain:

```text
Jakarta Persistence API
  defines EntityManager, annotations, contracts

JPA Provider
  Hibernate ORM / EclipseLink
  implements persistence behavior
```

Kesalahan umum:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>...</version>
</dependency>
```

Lalu developer berpikir aplikasi sudah punya runtime Jakarta EE. Padahal API dependency hanya menyediakan type untuk compile. Ia tidak otomatis menyediakan container implementation.

Mental model:

```text
API JAR:
  lets your code compile

Implementation/provider:
  makes behavior happen at runtime

Application server/runtime:
  composes providers and manages deployment
```

Rule:

```text
Compilation success does not imply runtime capability.
```

---

## 9. `javax.*` vs `jakarta.*`: Namespace sebagai Runtime Boundary

Java EE lama memakai package `javax.*`:

```java
import javax.inject.Inject;
import javax.enterprise.context.ApplicationScoped;
import javax.ejb.Stateless;
import javax.annotation.PostConstruct;
import javax.persistence.EntityManager;
```

Jakarta EE modern memakai `jakarta.*`:

```java
import jakarta.inject.Inject;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.ejb.Stateless;
import jakarta.annotation.PostConstruct;
import jakarta.persistence.EntityManager;
```

Ini bukan sekadar rename cosmetic.

Di level JVM, `javax.inject.Inject` dan `jakarta.inject.Inject` adalah **type yang berbeda**.

Artinya:

```text
Class compiled with javax.* API is not automatically compatible with runtime expecting jakarta.* API.
```

Contoh masalah:

```java
// library lama
public class LegacyService {
    @javax.inject.Inject
    LegacyRepository repository;
}
```

Jika dijalankan dalam runtime Jakarta modern yang hanya memproses `jakarta.inject.Inject`, annotation lama bisa tidak dipahami sesuai ekspektasi.

### 9.1 Migration Trap

Masalah paling sering saat migration:

```text
Application source sudah jakarta.*
Tapi transitive library masih javax.*
Atau server masih Java EE 8
Atau API JAR dan server implementation beda generasi
```

Akibatnya:

- compile berhasil tapi deploy gagal,
- bean tidak ditemukan,
- annotation tidak diproses,
- provider mismatch,
- `NoSuchMethodError`,
- `ClassNotFoundException`,
- `LinkageError`.

### 9.2 Rule Migration

```text
Dalam satu deployment boundary, jangan campur javax.* dan jakarta.* untuk spesifikasi yang sama kecuali ada strategi compatibility/transform yang jelas.
```

---

## 10. Java 8 sampai Java 25: Yang Berubah untuk Enterprise Runtime

Seri ini menargetkan Java 8 sampai Java 25. Artinya kita perlu melihat perubahan Java bukan hanya syntax, tapi impact runtime.

### 10.1 Java 8 Era

Karakter umum:

- Java EE 7/8 banyak dipakai,
- namespace `javax.*`,
- application server monolitik lebih umum,
- WAR/EAR deployment dominan,
- reflection lebih bebas,
- SecurityManager masih relevan di beberapa konteks,
- lambdas/streams mulai masuk enterprise code.

### 10.2 Java 9–11 Era

Perubahan penting:

- JPMS/module system muncul,
- stronger encapsulation mulai menjadi isu,
- Java 11 menjadi LTS penting,
- banyak aplikasi enterprise mulai migration dari Java 8,
- reflective access warning mulai muncul,
- app server harus menyesuaikan runtime/module behavior.

### 10.3 Java 17 Era

Perubahan penting:

- Java 17 menjadi baseline modern penting,
- records, sealed classes, pattern matching bertahap,
- stronger encapsulation makin nyata,
- Jakarta EE 10/11 banyak menargetkan modern Java baseline,
- cloud-native Java makin dominan.

### 10.4 Java 21 Era

Perubahan penting:

- virtual threads menjadi fitur final,
- structured concurrency masih preview/incubator tergantung versi,
- enterprise runtime mulai mempertimbangkan thread model baru,
- managed executor dan context propagation perlu dipahami ulang.

### 10.5 Java 25 Era

Java 25 adalah LTS modern setelah Java 21. Untuk enterprise runtime, yang penting bukan hanya “bisa compile dengan Java 25”, tetapi:

- apakah app server mendukung Java 25,
- apakah provider CDI/JPA/JAX-RS kompatibel,
- apakah bytecode target cocok,
- apakah build plugin mendukung,
- apakah reflection/proxy/generation library mendukung,
- apakah observability agent mendukung,
- apakah container image/JDK distribution sudah sesuai.

Rule:

```text
Java version compatibility harus dicek di empat layer:
1. source language
2. bytecode target
3. dependency/provider compatibility
4. runtime/server support
```

---

## 11. Runtime Phases: Dari Code sampai Production Request

Aplikasi enterprise melewati beberapa fase.

```text
1. Source phase
2. Compile phase
3. Package phase
4. Deploy/bootstrap phase
5. Discovery phase
6. Validation phase
7. Runtime service phase
8. Shutdown phase
```

### 11.1 Source Phase

Kita menulis:

```java
@ApplicationScoped
public class PaymentService {
    @Inject
    PaymentGateway gateway;
}
```

Pada fase source, kita baru menyatakan niat:

- class ini managed bean,
- butuh dependency `PaymentGateway`,
- lifecycle mungkin application-wide.

Belum ada object dibuat.

### 11.2 Compile Phase

Compiler hanya mengecek:

- type ada,
- annotation class ada,
- syntax benar,
- method/field valid.

Compiler biasanya tidak tahu apakah nanti CDI container dapat menemukan implementation `PaymentGateway`.

Jadi compile success tidak menjamin injection success.

### 11.3 Package Phase

Build tool membentuk:

- JAR,
- WAR,
- EAR,
- bootable JAR,
- container image.

Di fase ini dependency graph diputuskan.

Kesalahan umum:

- API JAR ikut ter-package padahal harus `provided`,
- implementation dependency hilang,
- duplicate class,
- transitive dependency membawa versi lama,
- `javax` dan `jakarta` tercampur.

### 11.4 Deploy/Bootstrap Phase

Runtime mulai membaca artifact.

Ia menyiapkan:

- classloader,
- deployment unit,
- resource binding,
- scanning,
- provider initialization.

### 11.5 Discovery Phase

CDI/container mencari bean/component.

Pertanyaan:

- class mana yang dianggap bean?
- archive mana yang discan?
- annotation mana yang bean-defining?
- `beans.xml` ada/tidak?
- discovery mode apa?
- extension mengubah metadata atau tidak?

### 11.6 Validation Phase

Container memvalidasi graph.

Contoh:

```text
PaymentService needs PaymentGateway
Candidates:
  StripePaymentGateway
  MockPaymentGateway

If both have same qualifier -> ambiguous dependency
If none -> unsatisfied dependency
```

Validation fase ini penting karena banyak bug wiring bisa diketahui saat startup, bukan saat user request.

### 11.7 Runtime Service Phase

Aplikasi menerima:

- HTTP request,
- message,
- timer event,
- scheduled task,
- async callback,
- startup event.

Container mengaktifkan context yang sesuai, memilih contextual instance, menjalankan interceptor, membuka/menutup transaksi jika applicable, lalu memanggil kode aplikasi.

### 11.8 Shutdown Phase

Container menghentikan aplikasi.

Ia perlu:

- memanggil destruction callback,
- menutup resource,
- menghentikan executor,
- flush metric/log,
- menutup connection/client,
- melepaskan context.

Bug shutdown sering tersembunyi sampai rolling deployment, autoscaling, atau node termination.

---

## 12. Object Graph: Aplikasi sebagai Directed Graph

DI membuat aplikasi menjadi graph.

Contoh:

```text
CaseResource
  -> CaseApplicationService
      -> CaseRepository
          -> EntityManager
      -> CasePolicyEvaluator
          -> FeatureFlagService
          -> Configuration
      -> AuditService
          -> AuditRepository
          -> Clock
      -> NotificationGateway
          -> HttpClient
          -> ConfiguredEndpoint
```

Setiap arrow adalah dependency.

CDI/container harus menjawab:

```text
Untuk setiap dependency edge:
  type apa yang diminta?
  qualifier apa yang diminta?
  implementation mana yang cocok?
  scope implementation apa?
  apakah proxy dibutuhkan?
  apakah lifecycle valid?
  apakah cycle terjadi?
```

Graph yang sehat punya karakteristik:

- dependency direction jelas,
- boundary jelas,
- sedikit global mutable state,
- config masuk lewat boundary terkontrol,
- external resource dibungkus adapter,
- transaction boundary eksplisit,
- feature flag tidak menyebar liar,
- test dapat mengganti edge tertentu.

Graph yang buruk:

```text
Resource -> Service -> Repository -> Service -> ConfigUtil.static -> JndiUtil.static -> ExternalClient.new -> ThreadLocalContext -> GlobalRegistry
```

Gejalanya:

- sulit dites,
- sulit migrate,
- runtime dependency hidden,
- config tidak terdeteksi saat startup,
- production bug hanya muncul di environment tertentu,
- circular dependency sulit terlihat,
- observability buruk.

---

## 13. Scope: Lifecycle + Visibility + Ownership

Scope sering dipahami sebagai “berapa lama object hidup”. Itu benar, tapi belum lengkap.

Scope adalah kombinasi dari:

```text
scope = lifecycle + visibility boundary + contextual lookup rule + concurrency implication
```

Contoh:

### 13.1 Request Scope

```text
Satu HTTP request memiliki contextual instance sendiri.
```

Makna:

- hidup selama request,
- cocok untuk request-specific state,
- tidak boleh diasumsikan aktif di background thread,
- aman untuk state per request,
- bisa gagal jika dipakai di async tanpa context propagation.

### 13.2 Application Scope

```text
Satu instance konseptual untuk aplikasi.
```

Makna:

- hidup lama,
- cocok untuk stateless service atau shared resource wrapper,
- harus thread-safe jika menyimpan mutable state,
- mudah menjadi sumber memory leak jika menyimpan data request/user.

### 13.3 Dependent Scope

```text
Lifecycle mengikuti owner/injection target.
```

Makna:

- tidak selalu diproxy sebagai normal scoped bean,
- instance bisa dibuat lebih sering,
- destruction mengikuti pemilik,
- bisa berbahaya jika producer menghasilkan resource berat tanpa disposer.

Rule penting:

```text
Scope bukan hanya lifetime. Scope adalah kontrak akses contextual.
```

---

## 14. Proxy: Kenapa Object yang Di-inject Sering Bukan Object Asli

Dalam CDI, ketika kita inject normal scoped bean, yang sering masuk adalah proxy.

Contoh:

```java
@Inject
CurrentUser currentUser;
```

Jika `CurrentUser` adalah request scoped, sementara object yang meng-inject adalah application scoped, bagaimana mungkin application scoped object menyimpan reference ke request scoped object?

Jawabannya: proxy.

```text
ApplicationScoped Service
  has field -> proxy(CurrentUser)

At method call time:
  proxy asks active RequestContext:
    "Current request's CurrentUser instance mana?"
```

Diagram:

```text
CaseService (@ApplicationScoped)
  |
  | field contains
  v
CurrentUserProxy
  |
  | method call
  v
RequestContext lookup
  |
  v
Actual CurrentUser for this request
```

Tanpa proxy, injection request-scoped ke application-scoped akan salah secara lifecycle.

Proxy memungkinkan:

- lazy contextual lookup,
- scope boundary crossing,
- interceptor wrapping,
- decorator wrapping,
- transaction/security interception.

Tapi proxy membawa batasan:

- final class/method bisa bermasalah,
- self-invocation bisa bypass interceptor,
- equality/identity bisa mengecoh,
- constructor behavior tidak sama seperti manual object,
- stack trace berisi generated/proxy class,
- serialization/passivation punya aturan tambahan.

Rule:

```text
Saat memakai CDI/EJB, jangan selalu menganggap injected reference adalah instance asli.
Ia bisa menjadi contextual proxy.
```

---

## 15. Interceptor dan Decorator: Method Call bukan Garis Lurus

Tanpa container:

```text
caller -> target.method()
```

Dengan enterprise runtime:

```text
caller
  -> client proxy
  -> interceptor chain
  -> decorator chain
  -> transaction boundary
  -> security check
  -> actual target method
```

Contoh conceptual chain:

```text
CaseResource.submit()
  -> CaseService proxy
      -> CorrelationIdInterceptor
      -> MetricsInterceptor
      -> AuditInterceptor
      -> TransactionInterceptor
      -> FeatureGateInterceptor
      -> CaseServiceImpl.submit()
```

Ini sangat powerful, tetapi punya risiko:

- behavior tidak terlihat langsung di method body,
- ordering penting,
- exception handling bisa berubah,
- self-invocation bisa bypass,
- performance overhead ada,
- debugging perlu tahu chain runtime.

### 15.1 Interceptor

Interceptor cocok untuk cross-cutting concern generik:

- transaction,
- security,
- logging,
- metrics,
- tracing,
- retry,
- idempotency,
- audit envelope,
- feature gate.

### 15.2 Decorator

Decorator cocok untuk semantic wrapping terhadap business interface:

- compliance check,
- policy enrichment,
- fallback strategy,
- behavior augmentation untuk use case tertentu.

Rule:

```text
Interceptor membungkus invocation berdasarkan cross-cutting metadata.
Decorator membungkus behavior berdasarkan business type/interface.
```

---

## 16. Configuration: Runtime Contract, Bukan Sekadar Key-Value

Configuration menentukan bagaimana artifact yang sama dapat berjalan berbeda di environment berbeda.

Contoh buruk:

```java
if (System.getenv("ENV").equals("prod")) {
    endpoint = "https://prod.example.com";
} else {
    endpoint = "https://dev.example.com";
}
```

Masalah:

- environment logic masuk business code,
- fallback bisa salah,
- testing sulit,
- config tidak tervalidasi,
- secret risk,
- prod bisa memakai default dev.

Model yang lebih baik:

```text
Artifact is immutable.
Deployment provides configuration.
Runtime validates required configuration at startup.
Application consumes typed configuration through a boundary.
```

Configuration punya dimensi:

```text
Source:
  env var / system property / config file / secret manager / DB / Kubernetes ConfigMap / parameter store

Time:
  build-time / deploy-time / startup-time / runtime dynamic

Sensitivity:
  public / internal / secret

Type:
  string / number / boolean / duration / URL / enum / list / complex object

Scope:
  global / environment / tenant / module / feature / request

Failure mode:
  missing / invalid / stale / inconsistent / leaked
```

Rule:

```text
Config adalah bagian dari API antara deployment system dan application runtime.
```

---

## 17. Profile vs Feature Flag vs Qualifier vs Alternative

Empat konsep ini sering dicampur.

### 17.1 Profile

Profile memilih behavior/config berdasarkan environment atau mode besar.

Contoh:

```text
local
integration-test
uat
prod
migration
```

Profile cocok untuk:

- endpoint environment,
- logging level,
- mock adapter di local,
- datasource per environment,
- integration mode.

Profile tidak cocok untuk rollout user-by-user.

### 17.2 Feature Flag

Feature flag memilih behavior berdasarkan keputusan runtime yang bisa berubah tanpa rebuild.

Contoh:

```text
new-case-routing.enabled=true
case-risk-scoring.rollout=10%
onemap-v2.enabled-for-agency=CEA
```

Feature flag cocok untuk:

- progressive rollout,
- kill switch,
- A/B behavior,
- tenant/agency-specific enablement,
- temporary migration switch.

Feature flag tidak boleh menjadi permanent architecture branch tanpa governance.

### 17.3 Qualifier

Qualifier memilih bean berdasarkan type-safe injection metadata.

Contoh:

```java
@Inject
@PrimaryGateway
PaymentGateway gateway;
```

Qualifier cocok untuk:

- multiple implementation selection,
- semantic dependency distinction,
- compile/startup-time graph clarity.

### 17.4 Alternative

Alternative memungkinkan implementation diganti/diaktifkan untuk deployment/test tertentu.

Cocok untuk:

- test double,
- environment-specific implementation,
- migration replacement,
- controlled override.

### 17.5 Decision Table

| Kebutuhan | Konsep yang biasanya tepat |
|---|---|
| Beda config dev/uat/prod | Profile/config source |
| Beda implementation untuk test | Alternative/producer/test profile |
| Beda gateway berdasarkan semantic dependency | Qualifier |
| Rollout fitur 10% user | Feature flag |
| Kill switch production | Feature flag |
| Pilih datasource dari server resource | JNDI/resource config/producer |
| Pilih implementation saat startup dari config | Producer/alternative/conditional bean |
| Pilih implementation per request/tenant | Strategy registry + feature/config decision |

---

## 18. Enterprise Beans: Kenapa Masih Perlu Dipahami

Banyak sistem modern lebih sering memakai CDI managed bean, JAX-RS resource, MicroProfile, atau framework seperti Spring/Quarkus. Namun Enterprise Beans/EJB masih penting karena:

- banyak legacy Java EE masih memakainya,
- banyak konsep transaksi enterprise berasal dari sana,
- timer service masih ada di sistem lama,
- container-managed concurrency masih relevan,
- migration butuh memahami semantics lama,
- `@Stateless` sering masih muncul dalam codebase production.

EJB bukan sekadar annotation.

Contoh:

```java
@Stateless
public class CaseSubmissionBean {
    public void submit(CaseCommand command) { ... }
}
```

Annotation ini membawa banyak kontrak:

- instance dapat dipool,
- method invocation melalui EJB proxy,
- transaksi default biasanya container-managed,
- security dapat diterapkan,
- lifecycle diatur EJB container,
- concurrent access punya aturan,
- remote/local view mungkin ada.

Kesalahan umum:

```text
Menganggap @Stateless sama seperti @ApplicationScoped.
```

Padahal berbeda.

- `@ApplicationScoped` adalah CDI scope.
- `@Stateless` adalah Enterprise Bean component model dengan pooling/transaction/security semantics.

Mereka dapat berinteraksi, tapi bukan konsep yang sama.

---

## 19. Resource Injection dan JNDI: Dunia Lama yang Masih Ada

Sebelum config/cloud-native populer, Java EE banyak memakai JNDI/resource reference.

Contoh:

```java
@Resource(lookup = "java:jboss/datasources/AppDS")
DataSource dataSource;
```

Atau lebih portable:

```java
@Resource(name = "jdbc/AppDS")
DataSource dataSource;
```

Lalu deployment descriptor/server binding menghubungkan logical name ke actual datasource.

Mental model:

```text
Application asks for logical resource
Server binds logical resource to actual environment-specific resource
```

Ini mirip dependency injection, tapi untuk resource external yang dikelola server:

- datasource,
- JMS connection factory,
- mail session,
- executor,
- resource adapter.

Dalam cloud-native style, sebagian resource binding berpindah ke:

- env var,
- secret manager,
- Kubernetes secret/configmap,
- service discovery,
- MicroProfile Config,
- framework-specific config.

Namun JNDI masih penting untuk migration dan app server environment.

---

## 20. Deployment Artifact: JAR, WAR, EAR, Bootable JAR

### 20.1 JAR

JAR bisa berisi:

- library,
- CDI bean archive,
- runnable application,
- provider implementation,
- shared module.

### 20.2 WAR

WAR biasanya web application:

```text
WEB-INF/classes
WEB-INF/lib
WEB-INF/web.xml
META-INF / resources
```

WAR punya webapp classloader dan lifecycle sendiri.

### 20.3 EAR

EAR menggabungkan beberapa module:

```text
application.ear
  /lib
  web-module.war
  ejb-module.jar
  another-module.jar
```

EAR umum di Java EE legacy enterprise.

Risiko:

- classloader hierarchy kompleks,
- shared library ambiguity,
- deployment coupling,
- module dependency rumit,
- migration ke cloud lebih berat.

### 20.4 Bootable JAR / Fast JAR / Native-Oriented Runtime

Modern runtime sering membungkus aplikasi sebagai executable artifact atau container image.

Ciri:

- runtime embedded,
- config via environment,
- cloud-native deployment,
- startup optimized,
- build-time augmentation mungkin terjadi,
- classpath dan provider discovery lebih dikendalikan.

Rule:

```text
Artifact shape memengaruhi classloader, dependency scope, scanning, startup, deployment, dan operational model.
```

---

## 21. Dependency Management sebagai Runtime Safety

Dependency management bukan hanya urusan Maven/Gradle. Ia menentukan runtime behavior.

Contoh masalah:

```text
Compile with CDI API 4.1
Run on server supporting older CDI behavior
```

Atau:

```text
Package includes jakarta.ws.rs-api.jar inside WAR
Server already provides different version
```

Atau:

```text
Transitive dependency pulls javax.annotation-api
Application uses jakarta.annotation-api
```

Akibat:

- class shadowing,
- provider mismatch,
- annotation tidak diproses,
- deployment gagal,
- method tidak ada saat runtime.

### 21.1 Dependency Scope Mental Model

```text
compile:
  needed to compile and packaged depending build type

provided:
  needed to compile, provided by runtime/server

runtime:
  not needed to compile directly, needed at runtime

test:
  only for tests
```

Dalam app server Jakarta EE, banyak API dependency harus `provided`.

Dalam bootable JAR, kita biasanya membawa implementation sendiri.

Rule:

```text
Dependency scope harus mengikuti ownership runtime.
Jika server owns API/implementation, jangan sembarang package duplicate.
Jika aplikasi owns runtime, pastikan implementation lengkap ikut terbawa.
```

---

## 22. Container Validation: Fail Fast vs Fail Late

Salah satu kekuatan CDI/Jakarta runtime adalah startup validation.

Contoh:

```java
@ApplicationScoped
public class CaseService {
    @Inject
    RiskScoringClient client;
}
```

Jika tidak ada bean `RiskScoringClient`, container bisa gagal saat deployment.

Ini bagus.

Fail fast lebih baik daripada request production pertama gagal.

Tapi tidak semua hal bisa divalidasi saat startup:

- dynamic lookup,
- optional dependency,
- config yang dibaca manual,
- JNDI lookup lazy,
- feature flag branch yang jarang aktif,
- external service credential salah,
- database permission salah,
- classpath yang hanya dipakai saat plugin runtime.

Top engineer berusaha menggeser error dari runtime request ke startup validation.

Strategi:

- gunakan typed injection daripada lookup string manual,
- validasi required config saat startup,
- lakukan health check untuk resource external,
- hindari hidden dependency via static util,
- expose selected implementation/config source secara aman,
- test semua profile/flag penting.

---

## 23. Hidden Runtime Boundaries

Dalam enterprise Java, bug sering muncul bukan karena business logic salah, tapi karena boundary dilanggar.

### 23.1 Scope Boundary

```text
RequestScoped object dipakai setelah request selesai.
```

Gejala:

```text
ContextNotActiveException
stale user/request data
memory leak
```

### 23.2 Transaction Boundary

```text
Lazy entity dipakai di luar transaction/persistence context.
```

Gejala:

```text
LazyInitializationException
TransactionRequiredException
partial write
```

### 23.3 Thread Boundary

```text
Managed context diasumsikan ada di unmanaged thread.
```

Gejala:

```text
missing security principal
request context inactive
MDC/correlation id hilang
transaction tidak terbawa
```

### 23.4 Classloader Boundary

```text
Class yang sama dimuat oleh dua classloader berbeda.
```

Gejala:

```text
ClassCastException: X cannot be cast to X
ServiceLoader provider not found
annotation not visible
```

### 23.5 Configuration Boundary

```text
Business code membaca env var langsung tanpa config contract.
```

Gejala:

```text
prod fallback ke default lokal
config drift antar replica
secret leak di log
behavior berbeda tanpa trace
```

### 23.6 Proxy Boundary

```text
Method annotated dipanggil dari method lain dalam class yang sama.
```

Gejala:

```text
interceptor tidak jalan
transaction tidak aktif
security check bypass
metrics tidak tercatat
```

---

## 24. Self-Invocation Problem

Ini salah satu bug enterprise Java paling sering.

Contoh:

```java
@ApplicationScoped
public class CaseService {

    public void submit() {
        validate();
        persistWithTransaction();
    }

    @Transactional
    public void persistWithTransaction() {
        // write DB
    }
}
```

Developer berharap `@Transactional` aktif saat `submit()` memanggil `persistWithTransaction()`.

Namun call tersebut adalah:

```text
this.persistWithTransaction()
```

Ia tidak melewati proxy/interceptor chain.

Sehingga interceptor transaksi bisa tidak aktif.

Diagram:

```text
External caller
  -> CaseServiceProxy
      -> interceptors
      -> CaseService.submit()
            -> this.persistWithTransaction()
               bypass proxy/interceptors
```

Solusi umum:

- pindahkan method transactional ke bean lain,
- inject self proxy dengan hati-hati jika runtime mendukung dan desainnya masuk akal,
- letakkan transaction boundary di public entry method,
- jangan pecah method berdasarkan annotation jika call tetap internal.

Rule:

```text
Annotation yang bekerja lewat proxy/interceptor biasanya hanya berlaku saat invocation melewati proxy/interceptor chain.
```

---

## 25. Lifecycle Callback: Constructor Bukan Tempat Semua Hal

Contoh umum:

```java
@ApplicationScoped
public class ExternalClient {

    @Inject
    Config config;

    public ExternalClient() {
        // jangan mengakses config di sini
    }

    @PostConstruct
    void init() {
        // dependency sudah diinjeksi
    }
}
```

Urutan konseptual:

```text
1. allocate object
2. constructor called
3. dependency injection performed
4. post construct callback
5. bean ready for use
6. pre destroy callback on shutdown/context end
```

Konsekuensi:

- constructor belum punya injected fields,
- heavy I/O di constructor buruk,
- `@PostConstruct` cocok untuk validasi dan initialization ringan,
- startup failure di `@PostConstruct` bisa menggagalkan deployment,
- cleanup resource harus jelas di `@PreDestroy` atau disposer.

Rule:

```text
Constructor membangun invariant lokal object.
@PostConstruct menginisialisasi runtime-integrated state setelah injection.
```

---

## 26. Annotation sebagai Contract, Bukan Perintah Imperatif

Annotation bukan kode yang “dijalankan” seperti method call.

Annotation adalah metadata.

Contoh:

```java
@ApplicationScoped
@Audited
public class CaseService {
}
```

Artinya:

```text
Class ini membawa metadata:
  - CDI scope: ApplicationScoped
  - interceptor binding / semantic marker: Audited
```

Runtime membaca metadata itu lalu memutuskan behavior.

Jadi annotation punya beberapa kategori:

| Kategori | Contoh | Makna |
|---|---|---|
| Injection | `@Inject` | dependency diperlukan |
| Scope | `@ApplicationScoped` | lifecycle/context |
| Qualifier | custom `@Main` | pemilihan implementation |
| Interceptor binding | `@Transactional`, custom `@Audited` | invocation wrapping |
| Lifecycle | `@PostConstruct`, `@PreDestroy` | callback phase |
| Resource | `@Resource` | external resource binding |
| Security | `@RolesAllowed` | access contract |
| Stereotype | custom composed annotation | annotation composition |
| Entity/persistence | `@Entity` | persistence metadata |
| Validation | `@NotNull` | validation metadata |

Dalam seri ini, kita tidak akan membahas semua annotation persistence/validation lagi. Kita fokus pada annotation yang membentuk runtime/component/config behavior.

---

## 27. Static Utility vs Managed Boundary

Legacy Java sering penuh static util:

```java
public final class ConfigUtil {
    public static String get(String key) {
        return System.getenv(key);
    }
}
```

Atau:

```java
public final class BeanUtil {
    public static <T> T lookup(Class<T> type) { ... }
}
```

Static utility kadang berguna untuk pure function. Namun untuk runtime dependency, static utility sering menjadi hidden service locator.

Masalah:

- sulit dites,
- dependency tidak muncul di constructor/injection graph,
- lifecycle tidak jelas,
- config tidak tervalidasi,
- ordering startup tidak jelas,
- sulit observe,
- sulit override per profile/test,
- mudah melanggar context.

Lebih baik:

```java
@ApplicationScoped
public class AppConfig {
    public URI riskScoringEndpoint() { ... }
}

@ApplicationScoped
public class RiskScoringClient {
    private final AppConfig config;

    @Inject
    public RiskScoringClient(AppConfig config) {
        this.config = config;
    }
}
```

Rule:

```text
Pure deterministic stateless helper boleh static.
Runtime dependency/config/resource/context access sebaiknya managed boundary.
```

---

## 28. Top 1% Mental Habit: Selalu Tanya Ownership dan Boundary

Saat melihat class enterprise Java, biasakan bertanya:

### 28.1 Ownership

```text
Siapa yang membuat object ini?
Application code atau container?
```

### 28.2 Lifecycle

```text
Kapan object ini dibuat dan dihancurkan?
```

### 28.3 Scope

```text
Instance ini per request, per session, per application, per injection target, atau pooled?
```

### 28.4 Proxy

```text
Apakah reference ini proxy?
Apakah method call melewati proxy?
```

### 28.5 Dependency Resolution

```text
Kalau ada 2 implementation, yang mana dipilih dan kenapa?
```

### 28.6 Thread Safety

```text
Apakah object ini dipakai concurrent?
Apakah mutable field aman?
```

### 28.7 Transaction

```text
Di mana boundary transaksi sebenarnya?
Apakah call melewati interceptor?
```

### 28.8 Configuration

```text
Value ini datang dari mana?
Precedence-nya apa?
Kapan divalidasi?
Apa default-nya aman?
```

### 28.9 Feature Flag

```text
Flag ini temporary atau permanent?
Apa fallback-nya?
Bagaimana audit dan cleanup-nya?
```

### 28.10 Failure Mode

```text
Kalau dependency/config/resource/context tidak tersedia, gagal saat startup atau saat request?
```

---

## 29. Runtime Error Taxonomy

Untuk debugging, jangan mulai dari “ini error CDI/EJB aneh”. Mulai dari taxonomy.

| Error | Kemungkinan Lapisan |
|---|---|
| `ClassNotFoundException` | dependency packaging/classloader |
| `NoClassDefFoundError` | class ada saat compile tapi hilang saat runtime/initialization gagal |
| `NoSuchMethodError` | versi dependency mismatch |
| `ClassCastException: X cannot be cast to X` | duplicate class/classloader split |
| Unsatisfied dependency | CDI discovery/resolution |
| Ambiguous dependency | CDI resolution/qualifier design |
| Unproxyable bean type | proxy rule/final class/no constructor/visibility |
| Context not active | scope/context/thread boundary |
| Name not found | JNDI/resource binding |
| Transaction required | transaction boundary/persistence context |
| Concurrent access timeout | EJB singleton/stateful concurrency |
| Lifecycle callback failed | initialization/config/resource startup |
| Config missing | config source/precedence/profile/deployment |

Mental model fase:

```text
compile error:
  source/API problem

startup/deploy error:
  discovery/resolution/config/resource validation problem

first request error:
  lazy dependency/context/resource/branch problem

under load error:
  scope/thread/concurrency/pooling/resource exhaustion problem

shutdown error:
  lifecycle/resource cleanup problem
```

---

## 30. Contoh End-to-End: Case Management Service

Kita pakai contoh domain regulatory/case management karena cocok untuk enterprise runtime.

### 30.1 Requirement

Saat officer submit enforcement case:

- validate command,
- check feature flag apakah risk scoring aktif,
- load case aggregate,
- evaluate policy,
- persist state transition,
- write audit trail,
- send notification,
- expose metrics,
- ensure transaction boundary,
- use correlation id,
- avoid duplicate submission.

### 30.2 Naive Manual Design

```java
public class CaseSubmitHandler {
    public void submit(CaseCommand command) {
        var config = System.getenv("RISK_ENABLED");
        var repo = new CaseRepository(new DataSourceFactory().create());
        var audit = new AuditService();
        var notifier = new EmailNotifier();

        // business logic
    }
}
```

Masalah:

- dependency hidden,
- datasource lifecycle kacau,
- config tidak tervalidasi,
- sulit dites,
- transaksi tidak jelas,
- audit/metric/correlation tersebar,
- feature flag raw,
- resource dibuat manual,
- tidak ada container integration.

### 30.3 Managed Runtime Design

```java
@Path("/cases")
public class CaseResource {

    @Inject
    CaseSubmissionService submissionService;

    @POST
    public Response submit(CaseCommand command) {
        submissionService.submit(command);
        return Response.accepted().build();
    }
}
```

```java
@ApplicationScoped
public class CaseSubmissionService {

    private final CaseRepository repository;
    private final PolicyEvaluator policyEvaluator;
    private final AuditService auditService;
    private final NotificationGateway notificationGateway;

    @Inject
    public CaseSubmissionService(
            CaseRepository repository,
            PolicyEvaluator policyEvaluator,
            AuditService auditService,
            NotificationGateway notificationGateway) {
        this.repository = repository;
        this.policyEvaluator = policyEvaluator;
        this.auditService = auditService;
        this.notificationGateway = notificationGateway;
    }

    @Transactional
    @Audited
    @Idempotent
    public void submit(CaseCommand command) {
        // application workflow
    }
}
```

```text
Runtime chain:

HTTP request
  -> JAX-RS resource lifecycle/context
  -> CDI injection
  -> CaseSubmissionService proxy
  -> Idempotency interceptor
  -> Audit interceptor
  -> Transaction interceptor
  -> actual submit method
  -> repository/entity manager/resource
  -> audit/notification adapters
```

### 30.4 What Top Engineer Sees

A top engineer melihat bukan hanya class, tapi runtime topology:

```text
Entry boundary:
  JAX-RS resource

Application boundary:
  CaseSubmissionService

Transaction boundary:
  submit method via interceptor/proxy

Policy boundary:
  PolicyEvaluator

External boundary:
  NotificationGateway

Configuration boundary:
  typed config / feature flag service

Audit boundary:
  interceptor + explicit domain audit event

Failure boundaries:
  config startup validation
  DB transaction rollback
  notification outbox/retry
  idempotency collision
  feature flag unavailable fallback
```

---

## 31. Managed Runtime Does Not Remove Design Responsibility

DI/container bisa membuat code terlihat bersih, tetapi bisa juga menyembunyikan kompleksitas.

Bad CDI design:

```java
@ApplicationScoped
public class EverythingService {
    @Inject A a;
    @Inject B b;
    @Inject C c;
    @Inject D d;
    @Inject E e;
    @Inject F f;
    @Inject G g;
    @Inject H h;
}
```

Masalah:

- god service,
- graph terlalu lebar,
- responsibility tidak jelas,
- sulit dites secara meaningful,
- runtime failure besar,
- circular dependency risk.

DI bukan pengganti desain modular.

Rule:

```text
Dependency injection membuat dependency explicit, bukan otomatis membuat design benar.
```

---

## 32. Architectural Invariants untuk Seri Ini

Sepanjang seri ini, kita akan memegang beberapa invariant.

### Invariant 1 — Runtime Ownership Must Be Explicit

Setiap component harus jelas:

```text
owned by application code
atau
owned by container/runtime
atau
owned by external system/resource manager
```

### Invariant 2 — Dependency Must Be Visible

Dependency penting harus terlihat di injection graph atau constructor, bukan tersembunyi di static lookup.

### Invariant 3 — Configuration Must Be Typed, Validated, and Observable

Config penting harus:

- punya type,
- punya validation,
- punya source/precedence jelas,
- tidak bocor secret,
- bisa diaudit secara aman.

### Invariant 4 — Scope Must Match State

Object stateful per request jangan application scoped. Shared service application scoped harus thread-safe.

### Invariant 5 — Cross-Cutting Behavior Must Have Boundary

Audit, metrics, retry, idempotency, feature gate, transaction, security harus punya boundary jelas, bukan tersebar acak.

### Invariant 6 — Runtime Selection Must Be Explainable

Jika ada beberapa implementation, harus bisa menjawab:

```text
Kenapa implementation ini yang dipilih?
Dipilih oleh qualifier, alternative, profile, config, feature flag, atau producer?
```

### Invariant 7 — Failure Should Move Left

Semakin banyak error ditemukan saat startup/deploy/test, semakin baik.

### Invariant 8 — Migration Must Respect Namespace and Provider Compatibility

`javax.*` dan `jakarta.*` bukan detail kosmetik. Itu boundary compatibility.

---

## 33. Yang Akan Dibahas di Part Berikutnya

Part berikutnya:

```text
Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
```

Kita akan masuk ke:

- Maven/Gradle dependency graph,
- transitive dependency,
- API vs implementation,
- dependency scope,
- BOM,
- convergence,
- reproducible builds,
- `javax`/`jakarta` dependency trap,
- `NoSuchMethodError`, `ClassNotFoundException`, classloader split,
- dependency hygiene untuk enterprise runtime.

Ini penting karena sebelum CDI/container bisa bekerja, artifact dan dependency graph harus benar.

---

## 34. Quick Reference: Mental Model One-Pager

```text
Enterprise Java runtime is not just code execution.
It is managed object civilization.

Core questions:
  1. Who creates this object?
  2. Who owns its lifecycle?
  3. What is its scope?
  4. Is this reference a proxy?
  5. Does this call pass through interceptors?
  6. Which dependency candidate is selected?
  7. Which config source provides the value?
  8. Which context is active on this thread?
  9. Where is the transaction boundary?
 10. What happens at startup, request time, load, and shutdown?

Core boundaries:
  - classloader boundary
  - deployment boundary
  - dependency graph boundary
  - scope/context boundary
  - proxy/interceptor boundary
  - transaction boundary
  - security boundary
  - thread/context propagation boundary
  - configuration/profile/feature flag boundary
  - resource/JNDI/external system boundary

Core failure strategy:
  - prefer explicit dependency
  - validate at startup
  - avoid hidden static lookup
  - choose scope deliberately
  - keep config typed and safe
  - keep feature flags governed
  - understand proxy/self-invocation
  - align javax/jakarta/provider/server versions
```

---

## 35. Practice Questions

Jawab pertanyaan ini sebelum lanjut ke part 001.

### 35.1 Managed vs Unmanaged

Untuk masing-masing object berikut, tentukan apakah sebaiknya managed atau unmanaged, dan kenapa:

1. `Money`
2. `CaseCommand`
3. `CaseSubmissionService`
4. `AuditTrailRepository`
5. `RiskScoringHttpClient`
6. `PostalCodeNormalizer`
7. `CurrentOfficerContext`
8. `FeatureFlagEvaluator`
9. `CaseStatusTransition`
10. `DatabaseConnectionFactory`

### 35.2 Scope Reasoning

Apa risiko jika class berikut diberi `@ApplicationScoped`?

```java
public class CurrentUser {
    private String userId;
    private Set<String> roles;
}
```

Apa scope yang lebih masuk akal?

### 35.3 Proxy Reasoning

Kenapa `@RequestScoped` object bisa diinjeksi ke `@ApplicationScoped` service?

Apa yang sebenarnya dipegang oleh field service tersebut?

### 35.4 Self Invocation

Apa potensi bug dari kode berikut?

```java
@ApplicationScoped
public class PaymentService {

    public void pay() {
        charge();
    }

    @Transactional
    public void charge() {
        // write payment rows
    }
}
```

### 35.5 Config Boundary

Mana yang lebih aman?

```java
String endpoint = System.getenv("PAYMENT_ENDPOINT");
```

atau typed configuration boundary yang divalidasi saat startup?

Jelaskan tradeoff-nya.

---

## 36. Mini Checklist untuk Membaca Codebase Enterprise Java

Saat masuk ke codebase Jakarta/Java EE, lakukan scan berikut:

```text
Dependency/namespace:
  [ ] Apakah codebase javax.*, jakarta.*, atau mixed?
  [ ] Apakah API dependency sesuai runtime/server?
  [ ] Apakah ada duplicate API JAR di WAR/EAR?

Runtime/container:
  [ ] Runtime apa yang dipakai? Full Jakarta EE, servlet container, Quarkus, Spring, custom SE?
  [ ] Siapa provider CDI/JPA/JAX-RS?
  [ ] Apakah ada EJB/Enterprise Beans?

Bean graph:
  [ ] Bagaimana bean ditemukan? beans.xml? annotated discovery?
  [ ] Ada unsatisfied/ambiguous dependency risk?
  [ ] Ada static service locator?

Scope:
  [ ] ApplicationScoped service thread-safe?
  [ ] Request/session state tidak bocor ke singleton?
  [ ] Ada request context dipakai di async/background task?

Proxy/interceptor:
  [ ] Ada self-invocation pada method transactional/security/audited?
  [ ] Ada final class/method yang perlu diproxy?
  [ ] Interceptor ordering jelas?

Config:
  [ ] Config source dan precedence jelas?
  [ ] Required config divalidasi startup?
  [ ] Secret tidak masuk log?
  [ ] Profile/feature flag governance jelas?

Resource:
  [ ] DataSource/JMS/resource bound lewat apa?
  [ ] JNDI name portable atau vendor-specific?
  [ ] External client lifecycle dikelola?

Operations:
  [ ] Startup failure cukup fail-fast?
  [ ] Health check mengecek dependency kritikal?
  [ ] Shutdown cleanup jelas?
```

---

## 37. Sources and Further Reading

Sumber resmi dan rujukan yang relevan untuk orientasi seri ini:

1. Jakarta EE 11 release page — https://jakarta.ee/release/11/
2. Jakarta EE specifications index — https://jakarta.ee/specifications/
3. Jakarta CDI 4.1 overview — https://jakarta.ee/specifications/cdi/4.1/
4. Jakarta CDI 4.1 specification — https://jakarta.ee/specifications/cdi/4.1/jakarta-cdi-spec-4.1
5. Jakarta Enterprise Beans specification page — https://jakarta.ee/specifications/enterprise-beans/
6. Jakarta Enterprise Beans 4.0 — https://jakarta.ee/specifications/enterprise-beans/4.0/
7. Jakarta EE Platform 11 specification — https://jakarta.ee/specifications/platform/11/jakarta-platform-spec-11.0
8. OpenJDK JDK 25 project page — https://openjdk.org/projects/jdk/25/
9. MicroProfile Config specification — https://microprofile.io/specifications/config/
10. MicroProfile Config 3.1 — https://microprofile.io/specifications/config/3-1/

---

## 38. Status Seri

Seri ini **belum selesai**.

Bagian ini adalah:

```text
Part 000 dari 035
```

Bagian berikutnya:

```text
Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 35 — Final Synthesis: Choosing the Right Execution Model](../concurrency/35-final-synthesis-choosing-the-right-execution-model.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime — Part 001](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-001.md)

</div>
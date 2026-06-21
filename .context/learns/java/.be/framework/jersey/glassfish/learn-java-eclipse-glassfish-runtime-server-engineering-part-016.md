# learn-java-eclipse-glassfish-runtime-server-engineering-part-016

# Part 16 — CDI/HK2 Boundary: Service Locator, Injection Runtime, dan Extension Point GlassFish

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Fokus: Eclipse GlassFish sebagai runtime/server engineering platform  
> Target Java: 8 sampai 25  
> Target pembaca: engineer senior/principal yang ingin memahami GlassFish bukan hanya sebagai tempat deploy WAR/EAR, tetapi sebagai container runtime yang punya bootstrap graph, service registry, lifecycle, dan boundary dependency injection internal.

---

## 0. Posisi Part Ini dalam Series

Sebelumnya kita sudah membahas:

- domain model,
- `asadmin`,
- configuration surface,
- bootstrap lifecycle,
- classloading,
- deployment model,
- descriptor GlassFish,
- HTTP/Grizzly,
- thread pool,
- JDBC pool,
- transaction service,
- JMS/OpenMQ,
- EJB container runtime.

Part ini masuk ke lapisan yang lebih internal: **bagaimana GlassFish sendiri di-compose sebagai kumpulan service**, dan bagaimana hal itu berbeda dari **CDI yang digunakan aplikasi**.

Topik ini penting karena banyak engineer enterprise sering menyamakan semua bentuk injection menjadi satu konsep umum: `@Inject`. Padahal di GlassFish ada dua dunia yang harus dipisahkan:

1. **CDI/Weld world** — dunia aplikasi.
2. **HK2 world** — dunia internal runtime GlassFish.

Keduanya bisa berinteraksi, tetapi bukan hal yang sama.

---

## 1. Tujuan Pembelajaran

Setelah Part 16, kamu diharapkan mampu:

1. Menjelaskan perbedaan CDI, Weld, HK2, JNDI, dan resource injection.
2. Memahami kenapa GlassFish memakai HK2 sebagai service locator internal.
3. Membaca error injection/deployment dengan boundary yang benar.
4. Menentukan apakah sebuah masalah terjadi di:
   - application CDI graph,
   - GlassFish internal service graph,
   - JNDI/resource binding,
   - classloading,
   - deployment descriptor,
   - atau integrasi antar-container.
5. Mengerti extension point GlassFish secara aman tanpa membuat aplikasi terlalu bergantung pada internal server.
6. Memahami kapan perlu menyentuh HK2 dan kapan harus menghindarinya.
7. Membangun mental model top 1% untuk runtime dependency graph.

---

## 2. Masalah Inti: Injection Tidak Selalu Berarti Hal yang Sama

Di aplikasi modern, kata “dependency injection” sering terasa sederhana:

```java
@Inject
PaymentService paymentService;
```

Namun di application server seperti GlassFish, injection bisa berarti beberapa hal berbeda:

| Bentuk | Dunia | Contoh | Tujuan |
|---|---|---|---|
| CDI injection | Application container | `@Inject MyService` | Wiring object aplikasi |
| EJB injection | EJB container | `@EJB MyBean` | Referensi komponen enterprise |
| Resource injection | Jakarta EE/JNDI | `@Resource DataSource ds` | Binding resource dari server |
| Persistence context injection | JPA container | `@PersistenceContext EntityManager em` | Inject context persistence |
| HK2 service injection | GlassFish internal runtime | `@Inject SomeGlassFishService` | Wiring service internal server |
| Jersey HK2 injection | JAX-RS runtime internals | HK2 binder/resource config | Wiring resource/provider Jersey |
| Manual JNDI lookup | Naming service | `InitialContext.lookup(...)` | Resolve object via namespace |

Kesalahan umum: melihat semua annotation sebagai “sama-sama DI”.

Padahal setiap jenis injection punya:

- owner container berbeda,
- lifecycle berbeda,
- classloader berbeda,
- validation timing berbeda,
- scope berbeda,
- failure semantics berbeda.

Mental model yang lebih benar:

```text
Injection is not one mechanism.
Injection is a set of container-owned wiring operations executed at specific lifecycle phases.
```

Dalam bahasa Indonesia:

> Injection bukan satu mekanisme tunggal. Injection adalah operasi wiring yang dimiliki oleh container tertentu pada fase lifecycle tertentu.

---

## 3. CDI, Weld, HK2, JNDI: Empat Konsep yang Harus Dipisahkan

### 3.1 CDI

CDI adalah spesifikasi Jakarta EE untuk dependency injection dan contextual lifecycle pada aplikasi.

CDI menjawab pertanyaan:

> Bagaimana object aplikasi saling menemukan, dibuat, diberi scope, dihancurkan, dan diperluas lewat extension?

Contoh:

```java
@ApplicationScoped
public class PricingService {
    public Money calculatePrice(Order order) {
        // business logic
    }
}
```

```java
@RequestScoped
public class CheckoutController {
    @Inject
    PricingService pricingService;
}
```

CDI mengelola:

- bean discovery,
- type-safe injection,
- qualifiers,
- scopes,
- interceptors,
- decorators,
- events,
- portable extensions,
- lifecycle callbacks.

### 3.2 Weld

Weld adalah salah satu implementasi CDI. GlassFish menggunakan integrasi CDI yang historically berbasis Weld untuk menyediakan CDI runtime.

Mental model:

```text
CDI = specification
Weld = implementation
GlassFish = application server integrating the implementation
```

Analogi:

```text
JPA       = specification
EclipseLink/Hibernate = implementation
GlassFish = runtime that integrates one provider
```

### 3.3 HK2

HK2 adalah dependency injection kernel/service locator yang digunakan oleh GlassFish internal.

HK2 menjawab pertanyaan:

> Bagaimana service internal GlassFish saling ditemukan, dibuat, dan diatur lifecycle-nya?

GlassFish bukan satu class besar. Ia adalah runtime besar yang terdiri dari banyak service:

- deployment service,
- admin command service,
- config service,
- monitoring service,
- transaction service,
- connector service,
- HTTP/network service,
- security service,
- naming service,
- logging service,
- module subsystem,
- lifecycle subsystem,
- container integration service.

Service-service ini perlu wiring. Untuk itu GlassFish menggunakan HK2.

### 3.4 JNDI

JNDI adalah naming/binding layer. Ia bukan DI container dalam arti CDI/HK2, tetapi namespace lookup untuk object/resource.

JNDI menjawab pertanyaan:

> Nama ini menunjuk ke object/resource apa dalam runtime?

Contoh:

```java
@Resource(lookup = "jdbc/OrderDS")
private DataSource dataSource;
```

Atau manual:

```java
DataSource ds = (DataSource) new InitialContext().lookup("java:comp/env/jdbc/OrderDS");
```

### 3.5 Ringkasan Boundary

```text
+-------------------------------------------------------------+
|                       GlassFish Runtime                     |
|                                                             |
|  +-----------------------+        +-----------------------+  |
|  | HK2 Service Locator   |        | Jakarta EE Containers |  |
|  | internal server graph |        | app-facing services   |  |
|  +-----------------------+        +-----------------------+  |
|             |                               |                |
|             | integrates                    | exposes         |
|             v                               v                |
|  +-----------------------+        +-----------------------+  |
|  | Deployment/Admin/etc. |        | CDI/Weld, EJB, JPA,   |  |
|  | runtime services      |        | Servlet, JAX-RS, etc. |  |
|  +-----------------------+        +-----------------------+  |
|                                             |                |
|                                             v                |
|                                  +-----------------------+   |
|                                  | Application classes   |   |
|                                  +-----------------------+   |
|                                                             |
|  +-------------------------------------------------------+   |
|  | JNDI/Naming: resource and component names             |   |
|  +-------------------------------------------------------+   |
+-------------------------------------------------------------+
```

---

## 4. Kenapa GlassFish Memiliki HK2 Jika Sudah Ada CDI?

Pertanyaan penting:

> Kalau CDI sudah ada, kenapa GlassFish butuh HK2?

Jawaban pendek:

> Karena GlassFish perlu membangun dirinya sendiri sebelum aplikasi CDI berjalan.

CDI adalah container untuk aplikasi. Tetapi GlassFish harus sudah punya banyak service internal sebelum dapat memproses aplikasi:

- membaca domain config,
- membuka network listener,
- memuat deployment subsystem,
- memulai container web/EJB/JPA,
- menyiapkan naming service,
- menyiapkan transaction manager,
- menyiapkan resource adapter,
- menyiapkan admin command,
- menyiapkan monitoring.

Masalah bootstrap:

```text
GlassFish must bootstrap the containers that later bootstrap CDI applications.
```

Artinya:

```text
server internal DI must exist before application CDI is useful.
```

HK2 adalah DI/service locator untuk layer internal itu.

---

## 5. Mental Model: Dua Dependency Graph

GlassFish menjalankan minimal dua graph besar:

### 5.1 Server Service Graph

Graph internal server:

```text
DomainConfigService
   -> AdminService
   -> NetworkConfigService
   -> DeploymentService
   -> TransactionService
   -> ConnectorRuntime
   -> SecurityService
   -> MonitoringService
   -> ContainerRegistry
```

Graph ini dimiliki oleh GlassFish dan dikelola oleh HK2.

### 5.2 Application Bean Graph

Graph aplikasi:

```text
CheckoutResource
   -> CheckoutService
   -> PricingService
   -> DiscountPolicy
   -> OrderRepository
   -> DataSource
```

Graph ini dimiliki oleh aplikasi dan dikelola oleh CDI/Weld/Jakarta EE containers.

### 5.3 Boundary-nya

Boundary tidak boleh bocor sembarangan.

Aplikasi seharusnya tidak bergantung pada internal service GlassFish kecuali sedang membuat extension/add-on/plugin yang memang targetnya GlassFish.

```text
Normal application code should depend on Jakarta EE contracts,
not GlassFish internal HK2 services.
```

---

## 6. Lifecycle: Kapan HK2 Jalan, Kapan CDI Jalan?

Urutan konseptual startup:

```text
1. JVM starts
2. GlassFish launcher starts
3. Domain config is loaded
4. HK2 service locator/server services are initialized
5. Core runtime services start
6. Containers are initialized
7. Applications are deployed or restored
8. CDI bean archives are discovered
9. CDI bean graph is validated
10. Resources are bound/injected
11. Application becomes ready
```

Penting:

- HK2 sudah diperlukan di tahap awal.
- CDI aplikasi baru meaningful setelah aplikasi di-deploy.
- Injection CDI gagal biasanya terjadi pada deployment/validation aplikasi.
- Injection HK2 gagal biasanya terjadi pada bootstrap server, admin command, extension, Jersey integration, atau service internal.

---

## 7. CDI Bean Discovery di Application Server

CDI tidak otomatis menganggap semua class sebagai bean dengan cara yang sama di semua versi.

Yang mempengaruhi discovery:

- `beans.xml`,
- bean discovery mode,
- annotation scope,
- archive type,
- CDI version,
- classloader/module boundary,
- WAR vs EAR structure,
- library placement,
- Jakarta namespace version.

Contoh `beans.xml` modern:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                           https://jakarta.ee/xml/ns/jakartaee/beans_4_0.xsd"
       bean-discovery-mode="annotated">
</beans>
```

Mode penting:

| Mode | Makna Praktis |
|---|---|
| `all` | Semua class dalam archive dapat dipertimbangkan sebagai bean |
| `annotated` | Hanya class dengan bean-defining annotation |
| `none` | Archive bukan CDI bean archive |

### 7.1 Bean-Defining Annotation

Contoh annotation yang membuat class menjadi bean dalam mode `annotated`:

```java
@ApplicationScoped
public class OrderService {
}
```

Tanpa annotation:

```java
public class OrderService {
}
```

Class seperti ini bisa tidak ditemukan sebagai CDI bean tergantung mode discovery.

### 7.2 Error Umum

```text
Unsatisfied dependency for type OrderService
```

Kemungkinan:

- class tidak masuk classpath module yang benar,
- tidak ada bean-defining annotation,
- `beans.xml` mode `none`,
- dependency ada di EAR lib tapi module visibility salah,
- ada collision `javax.inject` vs `jakarta.inject`,
- bean ada tapi vetoed/excluded,
- qualifier tidak cocok.

---

## 8. CDI Validation Timing

CDI melakukan validasi saat deployment, bukan saat endpoint pertama kali dipanggil.

Contoh:

```java
@RequestScoped
public class PaymentResource {
    @Inject
    PaymentGateway gateway;
}
```

Jika tidak ada bean `PaymentGateway`, deployment bisa gagal.

Ini bagus karena:

- gagal lebih awal,
- aplikasi tidak masuk state separuh hidup,
- error wiring terdeteksi sebelum traffic.

Namun konsekuensinya:

- deployment bisa gagal meskipun endpoint belum pernah dipakai,
- optional dependency harus dimodelkan dengan benar,
- environment-specific bean harus punya qualifier/profile/alternative strategy yang jelas.

---

## 9. Qualifier: Type Saja Tidak Cukup

CDI injection menggunakan type + qualifier.

Contoh:

```java
public interface PaymentGateway {
    PaymentResult charge(PaymentRequest request);
}
```

```java
@ApplicationScoped
@CreditCard
public class CreditCardGateway implements PaymentGateway {
}
```

```java
@ApplicationScoped
@BankTransfer
public class BankTransferGateway implements PaymentGateway {
}
```

Injection:

```java
@Inject
@CreditCard
PaymentGateway gateway;
```

Jika tanpa qualifier:

```java
@Inject
PaymentGateway gateway;
```

Akan ambiguous jika ada lebih dari satu bean.

Failure:

```text
Ambiguous dependencies for type PaymentGateway
```

Mental model:

```text
CDI injection key = required type + required qualifiers
```

Bukan hanya class/interface.

---

## 10. Scope: Lifecycle Adalah Bagian dari Wiring

Scope bukan dekorasi kosmetik. Scope menentukan:

- kapan instance dibuat,
- berapa lama instance hidup,
- siapa yang memegang contextual instance,
- kapan instance dihancurkan,
- apakah proxy diperlukan,
- apakah aman untuk state.

Scope umum:

| Scope | Umur | Catatan |
|---|---|---|
| `@RequestScoped` | satu request | cocok untuk request state |
| `@SessionScoped` | HTTP session | harus hati-hati memory dan serialization |
| `@ApplicationScoped` | aplikasi | harus thread-safe jika mutable |
| `@Dependent` | mengikuti injection target | mudah menyebabkan lifecycle surprise |
| `@ConversationScoped` | conversation | jarang dipakai, kompleks |

### 10.1 Kesalahan Umum: Mutable ApplicationScoped

```java
@ApplicationScoped
public class CurrentUserHolder {
    private String currentUserId;
}
```

Ini berbahaya karena satu instance dipakai banyak request/thread.

Lebih benar:

```java
@RequestScoped
public class CurrentUserContext {
    private String currentUserId;
}
```

Atau menggunakan `SecurityContext`/principal container-managed.

---

## 11. CDI Proxy dan Kenapa Constructor Tidak Selalu Sederhana

CDI sering menggunakan proxy untuk contextual reference.

Contoh:

```java
@ApplicationScoped
public class ReportService {
    @Inject
    RequestContext requestContext;
}
```

Jika `RequestContext` request-scoped, `ReportService` tidak memegang instance concrete langsung. Ia memegang proxy yang resolve object sesuai request aktif.

Mental model:

```text
Injected reference may be a contextual proxy, not the real object.
```

Dampak:

- jangan mengandalkan `getClass()` untuk logic bisnis,
- hati-hati dengan final class/method pada beberapa konteks,
- equals/hashCode bisa tricky,
- serialization/session scope perlu dipikirkan,
- jangan simpan reference scoped object ke static field.

---

## 12. `@PostConstruct` dan `@PreDestroy`: Lifecycle Hook yang Sering Disalahgunakan

Contoh:

```java
@ApplicationScoped
public class CacheWarmupService {

    @PostConstruct
    void init() {
        // load cache
    }

    @PreDestroy
    void shutdown() {
        // release resource
    }
}
```

Prinsip:

- `@PostConstruct` bukan tempat menjalankan pekerjaan berat tanpa batas.
- Jangan melakukan remote call lambat tanpa timeout.
- Jangan block startup server terlalu lama.
- Jangan membuka thread manual tanpa managed executor.
- Jangan menganggap semua resource eksternal sudah ready kecuali lifecycle-nya jelas.

Anti-pattern:

```java
@PostConstruct
void init() {
    while (true) {
        // polling background task
    }
}
```

Lebih baik gunakan:

- managed executor,
- EJB timer,
- scheduled job resmi,
- external worker,
- lifecycle service dengan shutdown handling.

---

## 13. Resource Injection Bukan CDI Murni

Contoh:

```java
@Resource(lookup = "jdbc/OrderDS")
private DataSource dataSource;
```

Ini sering terlihat seperti CDI injection, tetapi mekanismenya resource injection/JNDI.

Failure bisa datang dari:

- resource tidak dibuat,
- resource dibuat tapi target salah,
- JNDI name salah,
- pool disable,
- driver tidak ada,
- deployment descriptor mapping salah,
- application/module namespace berbeda.

Karena itu error:

```text
Lookup failed for jdbc/OrderDS
```

bukan CDI error. Itu naming/resource binding error.

### 13.1 CDI Producer untuk Resource

Kadang bagus membungkus resource injection dengan CDI producer:

```java
@ApplicationScoped
public class DataSourceProducer {

    @Resource(lookup = "jdbc/OrderDS")
    private DataSource orderDataSource;

    @Produces
    @OrderDatabase
    public DataSource orderDataSource() {
        return orderDataSource;
    }
}
```

Lalu aplikasi memakai:

```java
@Inject
@OrderDatabase
DataSource ds;
```

Manfaat:

- qualifier lebih eksplisit,
- testing lebih mudah,
- boundary resource lebih terkendali,
- JNDI name tidak tersebar di banyak class.

Risiko:

- jangan menyembunyikan failure resource,
- jangan membuat terlalu banyak abstraction tanpa nilai.

---

## 14. CDI dan EJB: Dua Container Bisa Bekerja Sama

Contoh EJB yang juga memakai CDI:

```java
@Stateless
public class InvoiceService {

    @Inject
    TaxPolicy taxPolicy;
}
```

EJB container mengelola:

- pooling,
- transactions,
- security,
- remote/local invocation,
- timers.

CDI mengelola:

- bean injection,
- qualifiers,
- scopes,
- interceptors/decorators/events.

Aplikasi harus sadar bahwa object ini bukan POJO biasa. Ia punya container semantics.

Misalnya:

```java
@Stateless
public class OrderService {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void placeOrder(Order order) {
        // transaction boundary here
    }
}
```

Jika dipanggil via container proxy, transaction aktif. Jika dibuat manual dengan `new`, transaction tidak aktif.

Rule:

```text
Never instantiate managed components manually if you expect container behavior.
```

---

## 15. CDI dan JAX-RS/Jersey/HK2

GlassFish mengintegrasikan JAX-RS runtime. Secara historis Jersey menggunakan HK2 untuk internal injection/runtime binding.

Ini menciptakan situasi menarik:

- aplikasi JAX-RS mungkin memakai CDI injection,
- Jersey runtime punya HK2 binding internal,
- GlassFish punya HK2 service graph sendiri,
- integrasi harus menjembatani lifecycle/resource/provider.

Contoh JAX-RS resource:

```java
@Path("/orders")
@RequestScoped
public class OrderResource {

    @Inject
    OrderService orderService;

    @GET
    public List<OrderDto> list() {
        return orderService.listOrders();
    }
}
```

Di GlassFish modern, resource CDI biasanya integrated. Tetapi error bisa muncul jika:

- class/resource didaftarkan dengan cara yang bypass CDI,
- provider dibuat manual,
- mixing HK2 binder dan CDI bean tanpa bridge yang benar,
- dependency berada di classloader yang salah,
- package namespace mismatch.

Mental model:

```text
JAX-RS resource creation must be aligned with the injection mechanism you expect.
```

Jika resource dibuat oleh CDI, CDI injection jalan. Jika dibuat oleh Jersey/HK2 path tertentu, dependency CDI bisa tidak tersedia kecuali bridge/integration aktif.

---

## 16. Apa Itu HK2 Secara Praktis?

HK2 menyediakan konsep:

- `ServiceLocator`,
- descriptor/service metadata,
- contracts,
- services,
- scopes,
- injection,
- dynamic configuration,
- lifecycle callbacks,
- immediate services,
- service lookup.

Secara konseptual:

```text
ServiceLocator = registry + factory + lifecycle manager for services
```

Dalam GlassFish:

```text
GlassFish internal service asks ServiceLocator for another internal service.
```

Contoh pseudo-code:

```java
@Service
public class DeploymentService {

    @Inject
    private ArchiveHandler archiveHandler;

    @Inject
    private ApplicationRegistry appRegistry;
}
```

Ini bukan kode aplikasi normal. Ini style internal/extension.

---

## 17. Service Locator vs Dependency Injection

HK2 sering disebut dependency injection kernel, tetapi konsep `ServiceLocator` membuatnya tampak seperti service locator pattern.

Ada dua gaya:

### 17.1 Injection Style

```java
@Inject
private DeploymentService deploymentService;
```

### 17.2 Lookup Style

```java
DeploymentService service = serviceLocator.getService(DeploymentService.class);
```

Dalam aplikasi bisnis biasa, lookup style sering dihindari karena:

- dependency tersembunyi,
- testing lebih sulit,
- coupling lebih kuat,
- object graph tidak eksplisit.

Namun dalam server runtime/plugin architecture, service locator bisa berguna karena:

- service bisa optional,
- service registry dinamis,
- extension bisa ditambahkan,
- command bisa resolve service saat runtime,
- bootstrap ordering kompleks.

Rule:

```text
Service locator is often inappropriate for business application architecture,
but can be reasonable for application server internals and plugin systems.
```

---

## 18. HK2 Annotation Conceptual Model

HK2 memiliki annotation seperti:

```java
@Contract
public interface AuditSink {
    void write(AuditEvent event);
}
```

```java
@Service
public class FileAuditSink implements AuditSink {
    @Override
    public void write(AuditEvent event) {
        // write event
    }
}
```

Konsepnya:

- contract = apa yang bisa diminta,
- service = implementasi yang bisa diberikan,
- descriptor = metadata service,
- locator = tempat mencari service.

Namun jangan langsung menggunakan HK2 di aplikasi hanya karena bisa. Untuk aplikasi Jakarta EE biasa, gunakan CDI.

---

## 19. CDI Extension vs GlassFish Add-on Extension

Ada dua jenis extension yang sering tercampur:

### 19.1 CDI Portable Extension

Target: memperluas CDI behavior aplikasi.

Contoh use case:

- custom annotation processing,
- auto-register beans,
- validate architectural constraints,
- add synthetic bean,
- observe CDI lifecycle events.

File:

```text
META-INF/services/jakarta.enterprise.inject.spi.Extension
```

### 19.2 GlassFish Add-on / Server Extension

Target: memperluas behavior GlassFish server.

Use case:

- custom admin command,
- internal service,
- deployment extension,
- monitoring extension,
- server lifecycle component.

Ini masuk ke HK2/GlassFish extension world.

### 19.3 Perbedaan Risiko

| Extension | Scope | Risiko |
|---|---|---|
| CDI portable extension | aplikasi | portable antar CDI container jika patuh spec |
| GlassFish server extension | runtime server | terikat GlassFish internal API/versi |

Rule:

```text
Prefer CDI portable extension for application-level behavior.
Use GlassFish extension only when modifying server/runtime behavior is truly required.
```

---

## 20. Deployment Failure: Cara Membaca Error CDI dengan Sistematis

Misalnya error:

```text
WELD-001408: Unsatisfied dependencies for type PaymentGateway with qualifiers @Default
```

Jangan langsung “tambahkan bean sembarang”. Diagnosis:

1. Type yang diminta apa?
2. Qualifier yang diminta apa?
3. Bean implementasi ada atau tidak?
4. Apakah bean punya scope/bean-defining annotation?
5. Apakah archive menjadi CDI bean archive?
6. Apakah class terlihat dari module tersebut?
7. Apakah ada `beans.xml` yang mengubah discovery mode?
8. Apakah menggunakan `javax.inject` di runtime `jakarta.inject`?
9. Apakah implementation class gagal load karena dependency lain?
10. Apakah bean di-exclude/veto oleh extension?

### 20.1 Debug Checklist

```text
[ ] Confirm target GlassFish version
[ ] Confirm Jakarta EE namespace version
[ ] Confirm application packaging structure
[ ] Confirm beans.xml discovery mode
[ ] Confirm bean-defining annotations
[ ] Confirm qualifier match
[ ] Confirm classloader visibility
[ ] Confirm no duplicate API jars packaged
[ ] Confirm deployment log before CDI error
[ ] Confirm no earlier ClassNotFound/NoClassDefFoundError
```

---

## 21. Ambiguous Dependency: Error yang Sebenarnya Bagus

Contoh:

```text
WELD-001409: Ambiguous dependencies for type NotificationSender
```

Ini berarti CDI menemukan lebih dari satu kandidat.

Contoh:

```java
@ApplicationScoped
public class EmailNotificationSender implements NotificationSender {
}
```

```java
@ApplicationScoped
public class SmsNotificationSender implements NotificationSender {
}
```

Injection:

```java
@Inject
NotificationSender sender;
```

Solusi yang benar bukan menghapus salah satu class sembarang. Solusi yang benar adalah memperjelas model:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface EmailChannel {}
```

```java
@EmailChannel
@ApplicationScoped
public class EmailNotificationSender implements NotificationSender {
}
```

```java
@Inject
@EmailChannel
NotificationSender sender;
```

Atau gunakan `@Alternative`/priority hanya jika memang environment selection.

---

## 22. Optional Dependency: Jangan Memalsukan Null

Anti-pattern:

```java
@Inject
OptionalService optionalService; // berharap boleh tidak ada
```

CDI tidak menganggap injection point normal sebagai optional.

Opsi lebih baik:

### 22.1 Instance

```java
@Inject
Instance<OptionalService> optionalService;

public void run() {
    if (!optionalService.isUnsatisfied()) {
        optionalService.get().execute();
    }
}
```

### 22.2 Alternatives/Profile

Gunakan alternative implementation:

```java
@ApplicationScoped
public class NoopOptionalService implements OptionalService {
    public void execute() {
        // no-op
    }
}
```

### 22.3 Config-Driven Strategy

```java
@ApplicationScoped
public class OptionalServiceRouter {
    @Inject
    Instance<OptionalService> services;
}
```

Pilih pendekatan sesuai requirement, bukan asal membuat field nullable.

---

## 23. Producer Method dan Ownership Resource

Producer method sering dipakai untuk membuat object yang bukan bean biasa:

```java
@ApplicationScoped
public class HttpClientProducer {

    @Produces
    @ApplicationScoped
    public HttpClient httpClient() {
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .build();
    }
}
```

Pertanyaan penting:

- Siapa yang menutup resource?
- Apakah object thread-safe?
- Scope apa yang benar?
- Apakah config environment-specific?
- Apakah producer melempar exception saat startup?
- Apakah retry/backoff dilakukan di tempat yang benar?

Untuk resource yang perlu close:

```java
public void close(@Disposes HttpClient client) {
    // jika resource mendukung close
}
```

Namun tidak semua object perlu/ bisa ditutup.

Rule:

```text
Producer method transfers lifecycle responsibility into CDI.
Do not produce expensive resources without defining ownership and shutdown semantics.
```

---

## 24. CDI Events: Powerful tetapi Bukan Message Broker

Contoh:

```java
public record OrderPlacedEvent(String orderId) {}
```

```java
@Inject
Event<OrderPlacedEvent> events;

public void placeOrder(Order order) {
    events.fire(new OrderPlacedEvent(order.id()));
}
```

Observer:

```java
public void onOrderPlaced(@Observes OrderPlacedEvent event) {
    // handle inside same application runtime
}
```

CDI event berguna untuk decoupling internal aplikasi, tetapi bukan pengganti JMS/Kafka/outbox.

Perbedaan:

| CDI Event | Broker Message |
|---|---|
| in-process | cross-process |
| tidak durable secara default | bisa durable |
| mengikuti lifecycle aplikasi | independen dari aplikasi |
| cocok untuk modularization internal | cocok untuk integration/event-driven architecture |

Anti-pattern:

```text
Using CDI events as if they were reliable distributed events.
```

---

## 25. Interceptor dan Decorator: Runtime Behavior Injection

CDI tidak hanya membuat object. CDI juga bisa mengubah invocation behavior.

Contoh interceptor:

```java
@Audited
@Interceptor
public class AuditInterceptor {

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        long start = System.nanoTime();
        try {
            return ctx.proceed();
        } finally {
            long elapsed = System.nanoTime() - start;
            // log audit/timing
        }
    }
}
```

Risiko:

- order interceptor tidak jelas jika tidak dirancang,
- hidden behavior menyulitkan diagnosis,
- bisa mempengaruhi transaction boundary,
- bisa memperbesar latency,
- bisa swallow exception jika salah.

Guideline:

- interceptor untuk cross-cutting concern,
- jangan taruh business branching besar di interceptor,
- log latency/error dengan korelasi,
- validasi ordering jika digabung dengan transaction/security.

---

## 26. CDI vs Spring DI dalam GlassFish

Dalam aplikasi GlassFish, CDI adalah mekanisme native Jakarta EE.

Spring bisa dijalankan dalam WAR, tetapi boundary harus jelas.

Jika memakai Spring di GlassFish:

- Spring container mengelola Spring beans,
- CDI mengelola CDI beans,
- Jakarta EE mengelola resources/EJB/JPA context,
- integrasi harus eksplisit.

Risiko:

- dua DI container saling tidak tahu,
- lifecycle berbeda,
- transaction manager integration perlu hati-hati,
- proxy di atas proxy,
- duplicated configuration,
- debugging lebih sulit.

Rule:

```text
Do not casually mix DI containers.
If you mix them, define ownership boundary explicitly.
```

---

## 27. Java 8 sampai 25: Dampak ke CDI/HK2 Boundary

### 27.1 Java 8 Era

Karakteristik:

- Java EE 7/8,
- `javax.*`,
- reflection lebih permisif,
- classpath/module path belum menjadi masalah utama,
- banyak library lama.

Risiko:

- dependency lama,
- server lama,
- TLS/security lama,
- behavior redeploy/classloader leak.

### 27.2 Java 11 Era

Karakteristik:

- Java EE module removal mulai terasa,
- JAXB/JAX-WS tidak lagi bundled seperti dulu,
- illegal reflective access warning muncul,
- transisi ke Jakarta mulai dekat.

Risiko:

- missing classes,
- classpath patching,
- library tidak kompatibel.

### 27.3 Java 17 Era

Karakteristik:

- baseline modern untuk banyak enterprise,
- strong encapsulation lebih terasa,
- Jakarta EE 10 era.

Risiko:

- reflection library lama gagal,
- bytecode tool lama gagal,
- annotation processor lama gagal.

### 27.4 Java 21 Era

Karakteristik:

- baseline GlassFish 8/Jakarta EE 11 practical modern,
- virtual threads tersedia,
- GC/runtime modern.

CDI/HK2 implication:

- injection tetap container-managed,
- virtual thread tidak mengubah lifecycle CDI,
- context propagation tetap harus container-aware,
- jangan membuat thread manual untuk membawa request/CDI context.

### 27.5 Java 25 Era

Karakteristik:

- target modern terbaru,
- perlu validasi support runtime/server/library,
- reflection/bytecode tooling harus compatible.

Rule:

```text
When upgrading Java version, validate not only source compilation,
but also container bootstrap, CDI discovery, proxy generation,
reflection access, bytecode enhancement, and deployment scanning.
```

---

## 28. Namespace Migration: `javax.inject` vs `jakarta.inject`

Ini salah satu sumber error paling licin.

Di Java EE / Jakarta EE lama:

```java
import javax.inject.Inject;
```

Di Jakarta EE modern:

```java
import jakarta.inject.Inject;
```

Jika runtime GlassFish modern memakai Jakarta namespace tetapi aplikasi/dependency membawa `javax.inject`, bisa terjadi:

- annotation tidak dikenali,
- bean tidak discovered,
- injection tidak terjadi,
- deployment error aneh,
- duplicate API jar collision.

Checklist migrasi:

```text
[ ] No javax.inject in source for Jakarta EE 9+ target
[ ] No javax.enterprise.* in source for Jakarta EE 9+ target
[ ] No old javax CDI API jar packaged in WEB-INF/lib
[ ] Dependency tree checked for javax artifacts
[ ] beans.xml namespace updated
[ ] deployment descriptors updated
[ ] tests run on target GlassFish version, not only compile
```

---

## 29. Classloading + CDI: Dua Masalah yang Sering Terlihat Sama

Misalnya:

```text
Unsatisfied dependency for type FraudPolicy
```

Kelihatannya CDI problem.

Tapi bisa jadi root cause:

```text
NoClassDefFoundError: com/acme/rules/RuleEngine
```

Karena implementation class `FraudPolicyImpl` gagal load, CDI tidak bisa mendaftarkannya sebagai bean.

Urutan diagnosis:

1. Cari error paling awal di log deployment.
2. Jangan hanya baca error terakhir.
3. Jika ada `ClassNotFoundException`, selesaikan classloading dulu.
4. Jika semua class load, baru diagnosis CDI qualifier/scope/discovery.

Rule:

```text
CDI unsatisfied dependency may be a symptom of classloading failure.
```

---

## 30. HK2 Failure: Bagaimana Mengenalinya?

HK2-related failure biasanya muncul dengan indikasi seperti:

- `MultiException`,
- `ServiceLocator`,
- `UnsatisfiedDependencyException` dari package HK2,
- `Descriptor`,
- `NoSuchServiceException`,
- error saat admin command,
- error saat GlassFish bootstrap,
- error saat Jersey provider/resource runtime tertentu,
- error pada extension/add-on.

Contoh konseptual:

```text
org.glassfish.hk2.api.MultiException
```

Ini bukan otomatis CDI error.

Diagnosis:

```text
[ ] Apakah error terjadi sebelum aplikasi deploy?
[ ] Apakah stack trace berasal dari org.glassfish.hk2?
[ ] Apakah terkait admin command/server service?
[ ] Apakah terkait Jersey/HK2 binder?
[ ] Apakah aplikasi mencoba inject ServiceLocator/internal service?
[ ] Apakah ada versi HK2/Jersey jar yang ikut ter-package di aplikasi?
```

Anti-pattern:

```text
Packaging Jersey/HK2 implementation jars manually into an app deployed on GlassFish without understanding server-provided libraries.
```

Ini bisa menyebabkan duplicate runtime component dan linkage conflict.

---

## 31. Kapan Aplikasi Boleh Mengakses HK2?

Default answer:

> Tidak perlu.

Aplikasi bisnis GlassFish seharusnya bergantung pada:

- Jakarta CDI,
- Jakarta REST/JAX-RS,
- Jakarta Persistence,
- Jakarta Transactions,
- Jakarta Security,
- Jakarta Messaging,
- Jakarta Concurrency,
- MicroProfile jika tersedia dan sesuai.

HK2 boleh dipertimbangkan jika:

- kamu membuat GlassFish add-on,
- kamu membuat admin command custom,
- kamu mengembangkan extension server,
- kamu perlu memahami/patch GlassFish source,
- kamu bekerja pada Jersey HK2 integration secara sadar,
- kamu debugging runtime internal.

Jangan memakai HK2 karena:

- “lebih keren”,
- “bisa service locator”,
- “ingin akses internal server”,
- “CDI terasa lambat” tanpa bukti,
- “ingin bypass container”.

Rule:

```text
Application code should use specifications.
Server extension code may use implementation internals.
```

---

## 32. Custom GlassFish Extension: Mental Model Aman

Jika benar-benar membuat extension GlassFish, pikirkan seperti ini:

```text
Extension is part of the server runtime, not part of the business application.
```

Konsekuensi:

- version coupling lebih tinggi,
- testing harus pada versi GlassFish target,
- classloader placement lebih sensitif,
- upgrade server bisa memecahkan extension,
- security review lebih penting,
- failure extension bisa menggagalkan server/app lain.

### 32.1 Use Case Valid

- Custom admin command untuk operational workflow internal.
- Custom monitoring/diagnostic hook.
- Custom deployment behavior untuk platform internal.
- Custom integration yang memang harus berjalan di server lifecycle.

### 32.2 Use Case Tidak Valid

- Business validation.
- Domain workflow.
- Normal integration HTTP/DB/message.
- Feature flag aplikasi.
- Report generation.
- Authorization logic aplikasi.

Semua itu sebaiknya tetap di aplikasi.

---

## 33. Deployment-Time Extension vs Runtime Business Logic

Top 1% engineer tahu membedakan:

```text
Should this logic live in the application, container, or platform?
```

| Logic | Tempat Ideal |
|---|---|
| Validasi order | aplikasi |
| Audit business event | aplikasi/outbox/logging pipeline |
| Create JDBC resource | server config/asadmin/IaC |
| Validate deployment descriptor policy | build/deployment pipeline atau extension khusus |
| Add HTTP security header | reverse proxy/filter/app depending context |
| Admin command automation | `asadmin`/script/custom admin command |
| Runtime metrics collection | server monitoring/JMX/MicroProfile/app metrics |

Rule:

```text
Do not put business logic into server extension.
Do not put platform control logic into random application code.
```

---

## 34. CDI Startup Cost dan Bean Discovery Performance

Pada aplikasi besar, CDI discovery bisa mempengaruhi startup.

Faktor:

- jumlah JAR,
- jumlah class,
- annotation scanning,
- `bean-discovery-mode="all"`,
- portable extension berat,
- reflection-heavy libraries,
- duplicate dependencies,
- EAR besar dengan banyak module,
- slow filesystem/container image layer,
- generated classes/proxies.

Optimasi:

1. Gunakan `annotated` jika sesuai.
2. Hindari membawa library tidak perlu ke `WEB-INF/lib`.
3. Hindari duplicate API jars.
4. Modularisasi archive secara rasional.
5. Jangan membuat portable extension scan seluruh classpath tanpa caching/filter.
6. Precompute metadata jika mungkin di build phase.
7. Ukur startup dengan log timestamp.

Anti-pattern:

```text
Put all company shared jars into every WAR whether used or not.
```

---

## 35. CDI Context dan Threading

CDI context tidak otomatis tersedia di thread sembarang.

Anti-pattern:

```java
new Thread(() -> {
    service.doWork();
}).start();
```

Masalah:

- thread tidak container-managed,
- request context tidak aktif,
- security context bisa hilang,
- transaction context tidak ada,
- lifecycle shutdown tidak terkelola,
- leak risk.

Gunakan Jakarta Concurrency:

```java
@Resource
ManagedExecutorService executor;

public void submitJob() {
    executor.submit(() -> service.doWork());
}
```

Tetap perhatikan:

- context apa yang dipropagasikan,
- transaction boundary,
- request-scoped bean tidak selalu valid,
- timeout dan cancellation,
- shutdown behavior.

Rule:

```text
Container-managed object should execute on container-aware execution paths.
```

---

## 36. CDI dan Transaction Boundary

CDI sendiri bukan transaction manager.

Transaction bisa datang dari:

- EJB container,
- `@Transactional` Jakarta Transactions interceptor,
- manual `UserTransaction`,
- framework integration.

Contoh:

```java
@Transactional
public void submitOrder(Order order) {
    repository.save(order);
}
```

Pertanyaan diagnosis:

- Apakah method dipanggil via proxy/container?
- Apakah transaction interceptor aktif?
- Apakah method visibility sesuai?
- Apakah self-invocation melewati proxy?
- Apakah exception menyebabkan rollback?
- Apakah resource enlisted?

Self-invocation problem:

```java
@ApplicationScoped
public class OrderService {

    public void outer() {
        inner(); // may bypass interceptor semantics depending model
    }

    @Transactional
    public void inner() {
    }
}
```

Rule:

```text
Interceptors require invocation through the managed proxy/interception path.
```

---

## 37. CDI dan Security Context

Security context biasanya disediakan oleh container/security integration.

Contoh:

```java
@Inject
SecurityContext securityContext;
```

atau JAX-RS:

```java
@Context
SecurityContext securityContext;
```

Perhatikan:

- CDI injection dan JAX-RS context injection berbeda mekanisme,
- context bisa request-bound,
- async processing bisa kehilangan context jika tidak managed,
- testing harus menyediakan mock/fake context.

Anti-pattern:

```java
@ApplicationScoped
public class UserService {
    private Principal currentPrincipal;
}
```

Security principal per request, bukan global singleton state.

---

## 38. CDI dan Configuration

GlassFish/Jakarta EE modern dapat menggunakan MicroProfile Config jika tersedia pada distribusi/runtime tertentu. Namun jangan asumsikan semua server/version punya extension yang sama.

Jika configuration injection tersedia:

```java
@Inject
@ConfigProperty(name = "payment.timeout.ms")
int timeoutMs;
```

Checklist:

- Apakah MicroProfile Config tersedia di target GlassFish version?
- Apakah dependency API disediakan server atau aplikasi?
- Apakah property source tersedia?
- Apakah default value ada?
- Apakah config dibaca saat startup atau runtime?
- Apakah secret aman?

Untuk GlassFish-focused engineering, config penting dipisahkan:

| Jenis Config | Owner |
|---|---|
| domain config | GlassFish/asadmin/domain.xml |
| resource config | GlassFish/JNDI/pool |
| app config | aplikasi/MicroProfile/env/system property |
| secret | secret manager/password alias/external injection |
| deployment config | pipeline/IaC |

---

## 39. Common Anti-Patterns

### 39.1 Mengemas API Jakarta EE ke Dalam WAR

Contoh buruk:

```text
WEB-INF/lib/jakarta.enterprise.cdi-api.jar
WEB-INF/lib/jakarta.inject-api.jar
WEB-INF/lib/jakarta.servlet-api.jar
```

Server sudah menyediakan API tersebut. Packaging duplicate API dapat menyebabkan classloading/linkage problem.

### 39.2 Memakai `new` untuk Managed Bean

```java
OrderService service = new OrderService();
```

Akibat:

- injection tidak jalan,
- interceptor tidak jalan,
- transaction tidak jalan,
- lifecycle callback tidak jalan.

### 39.3 Static Service Locator

```java
public class Beans {
    static ServiceLocator locator;
}
```

Akibat:

- global mutable state,
- test sulit,
- lifecycle kacau,
- redeploy leak.

### 39.4 Menggunakan HK2 untuk Business DI

Ini mengikat aplikasi ke GlassFish internal/implementation detail.

### 39.5 Menaruh Request State di Singleton/ApplicationScoped Bean

Menyebabkan data leak antar user/request.

### 39.6 Menjadikan CDI Event sebagai Reliable Integration Event

CDI event bukan broker durable.

---

## 40. Diagnostic Playbook: Injection Failure

### 40.1 Klasifikasi Error

Pertama, klasifikasikan error:

```text
A. CDI/Weld error?
B. HK2 error?
C. JNDI/resource lookup error?
D. Classloading error?
E. Transaction/security interceptor error?
F. Deployment descriptor mismatch?
```

### 40.2 Decision Tree

```text
Error during server startup before app deployment?
  -> likely GlassFish/HK2/config/module issue

Error during app deployment validation?
  -> likely CDI/deployment/classloading/resource issue

Error only when endpoint called?
  -> likely runtime invocation/resource/transaction/context issue

Stack trace contains WELD?
  -> CDI/Weld path

Stack trace contains org.glassfish.hk2?
  -> HK2/Jersey/server service path

Stack trace contains NamingException / lookup failed?
  -> JNDI/resource path

Stack trace contains ClassNotFound/NoClassDefFound/LinkageError?
  -> classloading/dependency path
```

### 40.3 Evidence to Collect

```text
[ ] GlassFish version
[ ] Java version
[ ] Jakarta EE target version
[ ] Full server.log from startup/deployment
[ ] First error in log, not only last error
[ ] Packaging structure: WAR/EAR/lib
[ ] Dependency tree
[ ] beans.xml files
[ ] glassfish descriptors
[ ] resource definitions and targets
[ ] relevant asadmin get/list output
```

---

## 41. Practical Example: CDI Unsatisfied Dependency Because of Namespace Mix

### 41.1 Symptom

```text
Unsatisfied dependencies for type FraudService
```

### 41.2 Code

```java
import javax.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class FraudService {
}
```

Target runtime: GlassFish 8 / Jakarta EE 11.

### 41.3 Problem

Runtime expects Jakarta namespace:

```java
import jakarta.enterprise.context.ApplicationScoped;
```

The old `javax.enterprise.context.ApplicationScoped` may not be treated as Jakarta CDI bean-defining annotation.

### 41.4 Fix

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class FraudService {
}
```

Also update dependencies/descriptors.

---

## 42. Practical Example: CDI Error Caused by Classloading Failure

### 42.1 Symptom

```text
Unsatisfied dependencies for type RuleEngine
```

### 42.2 Earlier Log

```text
java.lang.NoClassDefFoundError: com/acme/rules/internal/CompiledRule
```

### 42.3 Root Cause

CDI cannot register `RuleEngineImpl` because its dependency failed to load.

### 42.4 Fix Path

1. Fix dependency packaging.
2. Remove duplicate/conflicting jars.
3. Validate classloader visibility.
4. Redeploy.
5. Only then re-evaluate CDI error.

---

## 43. Practical Example: HK2/Jersey Collision

### 43.1 Symptom

JAX-RS resource fails with HK2 service locator error.

### 43.2 Possible Cause

Application packages its own Jersey/HK2 implementation jars conflicting with server-provided Jersey/HK2.

### 43.3 Diagnosis

Check:

```text
WEB-INF/lib/jersey-*.jar
WEB-INF/lib/hk2-*.jar
WEB-INF/lib/jakarta.ws.rs-api.jar
```

If GlassFish provides JAX-RS/Jersey runtime, manually packaging implementation jars can create split runtime.

### 43.4 Fix Strategy

- Use `provided` scope for server APIs where appropriate.
- Avoid packaging implementation jars already provided by server.
- If application intentionally uses custom Jersey version, isolate and validate carefully.
- Prefer server-integrated JAX-RS for GlassFish apps.

---

## 44. Practical Example: Resource Injection Target Wrong

### 44.1 Symptom

```text
Lookup failed for jdbc/OrderDS
```

### 44.2 Investigation

```bash
asadmin list-jdbc-resources
asadmin list-jdbc-connection-pools
asadmin get resources.jdbc-resource.jdbc/OrderDS.*
```

Then check target:

```bash
asadmin list-resources --target server
asadmin list-resources --target my-cluster
```

### 44.3 Root Cause

Resource exists but targeted to different server/cluster.

### 44.4 Lesson

Not all injection failures are CDI. Resource target matters.

---

## 45. Testing Strategy untuk CDI/HK2 Boundary

### 45.1 Unit Test

Untuk pure business logic:

- jangan butuh GlassFish,
- jangan butuh CDI container jika tidak perlu,
- constructor injection membantu.

```java
public class PricingService {
    private final DiscountPolicy discountPolicy;

    public PricingService(DiscountPolicy discountPolicy) {
        this.discountPolicy = discountPolicy;
    }
}
```

### 45.2 CDI Integration Test

Untuk memastikan CDI wiring:

- gunakan CDI test framework jika sesuai,
- validate qualifiers/producers/interceptors,
- test environment-specific alternatives.

### 45.3 GlassFish Integration Test

Untuk resource/server integration:

- deploy ke GlassFish target,
- validate JNDI/resource injection,
- validate transaction/security behavior,
- validate descriptors,
- validate startup/deployment logs.

### 45.4 Server Extension Test

Untuk HK2/GlassFish extension:

- test against exact GlassFish version,
- include upgrade compatibility test,
- test server startup failure mode,
- test extension disable/rollback.

---

## 46. Design Guidelines untuk Aplikasi GlassFish Modern

### 46.1 Gunakan CDI sebagai Default Application DI

Business service:

```java
@ApplicationScoped
public class OrderApplicationService {
}
```

Request context:

```java
@RequestScoped
public class RequestMetadata {
}
```

### 46.2 Gunakan Constructor Injection Jika Praktis

```java
@ApplicationScoped
public class OrderService {
    private final OrderRepository repository;

    @Inject
    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }
}
```

Catatan: beberapa container/proxy scenario tetap butuh no-arg constructor pada tipe tertentu. Validasi dengan target runtime.

### 46.3 Gunakan Qualifier untuk Ambiguity yang Valid

Jangan bergantung pada class name atau `@Named` string jika type-safe qualifier lebih tepat.

### 46.4 Bungkus Resource Boundary

Jangan sebar JNDI lookup di mana-mana.

### 46.5 Hindari HK2 di Business Code

HK2 adalah implementation/runtime concern.

### 46.6 Jangan Manual Thread

Gunakan managed executor/container facility.

### 46.7 Jangan Manual `new` Managed Component

Gunakan injection/factory yang container-aware.

---

## 47. Review Checklist: CDI/HK2 Readiness

```text
Namespace
[ ] Source uses correct javax/jakarta namespace for target GlassFish
[ ] No duplicate Jakarta EE API jars packaged unnecessarily
[ ] Dependency tree checked for old javax artifacts

CDI discovery
[ ] beans.xml intentional
[ ] bean-discovery-mode intentional
[ ] bean-defining annotations present
[ ] package/module visibility validated

Qualifiers/scopes
[ ] Ambiguous interfaces use qualifiers
[ ] ApplicationScoped beans are thread-safe
[ ] Request state is not stored globally
[ ] Producer lifecycle is defined

Resources
[ ] JNDI names centralized or documented
[ ] Resources exist on correct target
[ ] Pool/resource startup validated

Threading/context
[ ] No unmanaged threads for container work
[ ] Async code uses managed executor or container mechanism
[ ] Request/security/transaction context assumptions documented

HK2 boundary
[ ] Business code does not depend on HK2
[ ] Server extension code is isolated and version-tested
[ ] Jersey/HK2 jars are not duplicated accidentally

Diagnostics
[ ] Deployment log retains first error
[ ] Startup/deployment/run-time errors classified separately
[ ] CI includes deployment smoke test on target GlassFish
```

---

## 48. Top 1% Mental Model

Engineer biasa melihat error ini:

```text
Unsatisfied dependency
```

lalu bertanya:

> Bean mana yang kurang?

Engineer lebih matang bertanya:

> Graph mana yang gagal dibangun?

Top 1% engineer bertanya:

1. Ini failure di graph aplikasi atau graph server?
2. Container mana pemilik lifecycle object ini?
3. Injection ini CDI, resource, EJB, JPA, HK2, atau JAX-RS context?
4. Classloader mana yang seharusnya melihat class ini?
5. Namespace target `javax` atau `jakarta`?
6. Error paling awal di log apa?
7. Apakah object dibuat oleh container atau manual code?
8. Apakah invocation melewati proxy/interceptor path?
9. Apakah context aktif pada thread ini?
10. Apakah problem ini portability issue atau GlassFish-specific issue?

Mental model final:

```text
GlassFish is not merely running your objects.
GlassFish is building multiple graphs:
- internal service graph via HK2,
- application bean graph via CDI/Weld,
- resource graph via JNDI/connectors,
- invocation graph via containers/interceptors/proxies,
- execution graph via managed threads.

Most advanced bugs happen at the boundary between these graphs.
```

---

## 49. Ringkasan

Part ini membahas boundary antara CDI dan HK2 di GlassFish.

Poin utama:

1. CDI adalah application-level DI specification.
2. Weld adalah CDI implementation yang diintegrasikan oleh GlassFish.
3. HK2 adalah service locator/dependency injection kernel untuk internal GlassFish.
4. JNDI adalah naming/resource binding layer, bukan CDI.
5. Injection failure harus diklasifikasikan berdasarkan owner container.
6. HK2 sebaiknya tidak dipakai untuk business application code.
7. GlassFish extension berbeda dari CDI portable extension.
8. Banyak CDI error sebenarnya berakar pada classloading, namespace migration, atau resource target.
9. Java 8–25 membawa risiko berbeda terhadap reflection, namespace, bytecode, dan server compatibility.
10. Top-level debugging dimulai dari pertanyaan: graph mana yang gagal dibangun?

---

## 50. Latihan

### Latihan 1 — Klasifikasi Error

Klasifikasikan error berikut sebagai CDI, HK2, JNDI/resource, classloading, atau transaction/context:

```text
WELD-001408: Unsatisfied dependencies for type PaymentGateway
```

```text
org.glassfish.hk2.api.MultiException
```

```text
javax.naming.NamingException: Lookup failed for jdbc/MainDS
```

```text
java.lang.NoClassDefFoundError: jakarta/enterprise/context/ApplicationScoped
```

```text
TransactionRequiredException: no transaction is in progress
```

### Latihan 2 — Review Packaging

Ambil satu WAR/EAR dan cek:

```text
WEB-INF/lib
EAR/lib
beans.xml
pom.xml dependency tree
```

Cari:

- duplicate Jakarta EE API jars,
- old `javax` artifacts,
- Jersey/HK2 implementation jars,
- producer resource yang tidak punya shutdown semantics,
- `@ApplicationScoped` mutable state.

### Latihan 3 — Design Boundary

Untuk sebuah aplikasi regulatory case management, tentukan mana yang harus berada di:

- CDI application service,
- JNDI/resource config,
- GlassFish domain config,
- server extension,
- CI/CD script,
- external message broker.

Kasus:

1. SLA escalation calculation.
2. JDBC connection pool.
3. Audit correlation ID.
4. Admin command untuk dump runtime config.
5. Case assignment workflow.
6. Transaction recovery configuration.

---

## 51. Referensi

- Eclipse GlassFish Documentation — https://glassfish.org/documentation
- Eclipse GlassFish Application Development Guide — https://glassfish.org/docs/latest/application-development-guide.html
- Eclipse GlassFish Add-On Component Development Guide — https://glassfish.org/docs/SNAPSHOT/add-on-component-development-guide.html
- Eclipse GlassFish HK2 API Overview — https://eclipse-ee4j.github.io/glassfish-hk2/api-overview.html
- Eclipse GlassFish HK2 Extensibility — https://eclipse-ee4j.github.io/glassfish-hk2/extensibility.html
- Eclipse GlassFish GitHub Repository — https://github.com/eclipse-ee4j/glassfish
- Eclipse GlassFish HK2 GitHub Repository — https://github.com/eclipse-ee4j/glassfish-hk2
- Jakarta Contexts and Dependency Injection Specification — https://jakarta.ee/specifications/cdi/
- Jakarta Dependency Injection Specification — https://jakarta.ee/specifications/dependency-injection/
- Jakarta EE Platform Specification — https://jakarta.ee/specifications/platform/

---

## 52. Status Seri

Part 16 selesai.

Seri belum selesai.

Part berikutnya:

**Part 17 — Security Runtime: Realm, Principal, Role Mapping, TLS, Admin Security, dan Secret Handling**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-015.md">⬅️ Part 15 — EJB Container Runtime: Pooling, Passivation, Timers, Remote Calls, dan ORB</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-017.md">Part 17 — Security Runtime: Realm, Principal, Role Mapping, TLS, Admin Security, dan Secret Handling ➡️</a>
</div>

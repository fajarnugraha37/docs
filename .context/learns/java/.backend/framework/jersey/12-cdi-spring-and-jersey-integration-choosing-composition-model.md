# Part 12 — CDI, Spring, and Jersey Integration: Choosing the Composition Model

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
File: `12-cdi-spring-and-jersey-integration-choosing-composition-model.md`  
Target: Java 8 hingga Java 25, Jersey 2.x/3.x/4.x, `javax.ws.rs` dan `jakarta.ws.rs`

---

## 0. Posisi Part Ini dalam Series

Sampai Part 11, kita sudah membangun pemahaman bahwa Jersey bukan hanya kumpulan annotation REST. Jersey adalah runtime yang membangun resource model, melakukan request matching, menjalankan provider pipeline, memilih `MessageBodyReader`/`MessageBodyWriter`, menjalankan filter/interceptor, melakukan exception mapping, dan mengelola object lifecycle dengan injection layer.

Part 11 membahas model injection Jersey melalui HK2. Part 12 naik satu level: **bagaimana Jersey berperilaku ketika tidak hidup sendirian**, melainkan berada di dalam ekosistem lain seperti:

- Jakarta EE server dengan CDI,
- Spring Framework,
- Spring Boot,
- servlet container murni,
- embedded runtime,
- hybrid legacy application,
- enterprise platform yang punya shared library dan internal framework.

Masalah utama di part ini bukan syntax. Masalah utamanya adalah **composition ownership**.

Pertanyaan besarnya:

> Ketika sebuah object dipakai oleh endpoint Jersey, siapa yang membuat object itu, siapa yang meng-inject dependency-nya, siapa yang mengelola scope-nya, siapa yang menutup resource-nya, dan siapa yang bertanggung jawab saat lifecycle-nya salah?

Kalau jawaban ini kabur, sistem bisa tetap compile dan tetap jalan, tetapi bug-nya muncul dalam bentuk yang sulit:

- dependency `null`,
- filter tidak jalan,
- `ExceptionMapper` tidak terdaftar,
- `@Transactional` tidak aktif,
- `@Autowired` tidak bekerja,
- `@Inject` bekerja di resource tetapi tidak di provider,
- request scoped object bocor ke singleton,
- security context hilang,
- classpath `javax`/`jakarta` bentrok,
- test hijau tetapi runtime production gagal,
- endpoint hidup di container A tetapi dependency dibuat oleh container B,
- object terlihat singleton padahal per-request,
- object terlihat per-request padahal singleton.

Part ini bertujuan memberi mental model agar kamu tidak sekadar tahu “cara integrasi Jersey dengan Spring/CDI”, tetapi bisa memilih model integrasi yang sehat dan men-debug ketika model itu rusak.

---

## 1. Problem yang Diselesaikan

Dalam aplikasi kecil, resource Jersey bisa langsung seperti ini:

```java
@Path("/orders")
public class OrderResource {

    private final OrderService orderService = new OrderService();

    @GET
    public List<OrderDto> list() {
        return orderService.listOrders();
    }
}
```

Untuk belajar, ini cukup. Untuk production, ini buruk karena:

1. `OrderResource` membuat dependency sendiri.
2. Dependency tidak bisa diganti untuk test.
3. Tidak ada transaction boundary jelas.
4. Tidak ada security boundary jelas.
5. Tidak ada lifecycle management.
6. Tidak ada configuration injection.
7. Tidak ada observability cross-cutting.
8. Tidak ada pooling atau cleanup terpusat.

Aplikasi enterprise biasanya memakai DI container:

- HK2 bawaan Jersey,
- CDI bawaan Jakarta EE,
- Spring ApplicationContext,
- kombinasi Spring Boot + Jersey,
- atau integrasi custom.

Di sinilah masalah muncul. Banyak developer berpikir:

> “Yang penting bisa inject service ke resource.”

Padahal integrasi yang benar bukan hanya soal inject. Integrasi yang benar harus menjawab:

```text
Object apa yang dimiliki Jersey?
Object apa yang dimiliki CDI/Spring?
Object apa yang dibuat manual?
Object mana yang request scoped?
Object mana yang singleton?
Object mana yang boleh punya proxy?
Object mana yang boleh punya thread-local context?
Object mana yang boleh dipakai async?
Object mana yang harus ditutup saat shutdown?
```

Kalau jawaban ini tidak eksplisit, aplikasi menjadi fragile.

---

## 2. Mental Model Utama: Jersey sebagai HTTP Adapter, Bukan Application Kernel

Untuk aplikasi enterprise modern, model yang paling sehat biasanya:

```text
HTTP Client
   |
   v
Jersey Runtime
   |
   v
Resource / Filter / Mapper / Provider Layer
   |
   v
Application Service Layer
   |
   v
Domain / Workflow / Integration / Persistence
```

Jersey sebaiknya diperlakukan sebagai **HTTP adapter runtime**.

Artinya, Jersey bertanggung jawab atas:

- routing request,
- parameter binding,
- entity reading/writing,
- filter/interceptor pipeline,
- exception mapping,
- HTTP response semantics,
- request context bridging,
- registration of JAX-RS/Jakarta REST providers.

Jersey sebaiknya tidak menjadi pusat seluruh aplikasi, kecuali aplikasi memang kecil atau library/platform internal memang sengaja dibangun di atas Jersey + HK2.

Application service layer biasanya lebih baik dimiliki oleh DI container utama:

- Spring jika aplikasi Spring Boot/Spring Framework,
- CDI jika aplikasi Jakarta EE,
- HK2 jika aplikasi standalone Jersey murni,
- manual composition root jika aplikasi kecil/embedded dan sengaja eksplisit.

Rule praktis:

> Pilih satu container sebagai pemilik business service. Jersey boleh menjadi pemilik resource/provider/filter, tetapi service layer sebaiknya dimiliki satu container utama yang jelas.

---

## 3. Empat Composition Model Utama

Ada empat model umum.

```text
Model A — Jersey + HK2 only
Model B — Jersey inside Jakarta EE/CDI
Model C — Jersey inside Spring/Spring Boot
Model D — Hybrid/custom bridge
```

Masing-masing punya manfaat dan risiko.

---

## 4. Model A — Jersey + HK2 Only

### 4.1 Kapan Cocok

Jersey + HK2 only cocok ketika:

- aplikasi kecil sampai menengah,
- tidak memakai Spring/CDI,
- ingin runtime ringan,
- deployment standalone/embedded,
- ingin kontrol eksplisit terhadap binding,
- platform internal memang berbasis Jersey,
- service graph tidak terlalu kompleks,
- tidak membutuhkan fitur Spring seperti transaction proxy, AOP, scheduling, actuator, data abstraction, dan security stack.

Contoh struktur:

```text
com.example.api
  OrderResource
  ErrorMapper
  CorrelationFilter

com.example.app
  OrderService
  PaymentService

com.example.infra
  OrderRepository
  DatabaseClient
  ClockProvider
```

`ResourceConfig` menjadi composition root Jersey:

```java
public class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        register(OrderResource.class);
        register(ErrorMapper.class);
        register(CorrelationFilter.class);

        register(new AbstractBinder() {
            @Override
            protected void configure() {
                bind(OrderService.class).to(OrderService.class).in(Singleton.class);
                bind(OrderRepository.class).to(OrderRepository.class).in(Singleton.class);
                bind(DatabaseClient.class).to(DatabaseClient.class).in(Singleton.class);
            }
        });
    }
}
```

### 4.2 Kelebihan

- Sederhana.
- Tidak ada dua container besar.
- Startup graph lebih mudah dipahami.
- Cocok untuk Jersey-native extension.
- Provider/filter/resource bisa langsung memakai HK2 injection.
- Tidak ada Spring/CDI proxy surprise.

### 4.3 Kekurangan

- Fitur enterprise lebih terbatas dibanding Spring/CDI.
- Transaction management harus dibangun eksplisit atau integrasi manual.
- Ecosystem library lebih sedikit.
- Developer yang terbiasa Spring/CDI bisa bingung.
- Complex lifecycle management bisa menjadi custom framework sendiri.

### 4.4 Risiko Utama

Risiko terbesarnya adalah membangun “mini Spring” secara tidak sadar.

Tanda-tandanya:

- banyak custom annotation,
- banyak factory manual,
- banyak scope custom,
- banyak lifecycle hook custom,
- banyak proxy manual,
- transaction boundary custom yang tersebar,
- security context custom tanpa standard contract,
- service locator dipakai langsung di business code.

Kalau sudah begitu, lebih baik evaluasi apakah aplikasi seharusnya memakai Spring/CDI sebagai kernel utama.

---

## 5. Model B — Jersey inside Jakarta EE / CDI

### 5.1 Mental Model

Dalam Jakarta EE server, aplikasi biasanya memiliki runtime seperti:

```text
Jakarta EE Server
  ├── Servlet Container
  ├── CDI Container
  ├── Transaction Manager
  ├── Security Runtime
  ├── Bean Validation
  ├── JSON-B / JSON-P
  └── Jakarta REST Implementation
```

Jersey bisa menjadi implementasi Jakarta REST dalam runtime ini, atau digunakan di container yang menyediakan beberapa komponen Jakarta EE.

CDI biasanya menjadi pemilik service layer:

```java
@ApplicationScoped
public class OrderService {
    public List<OrderDto> listOrders() {
        ...
    }
}
```

Resource bisa menjadi CDI-managed bean:

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

### 5.2 Yang Harus Dipahami

Dalam model CDI, ada dua layer yang harus disejajarkan:

```text
Jersey/Jakarta REST resource lifecycle
CDI bean lifecycle
```

Kalau resource class dikelola CDI, maka CDI yang membuat instance dan meng-inject dependency. Jersey melakukan dispatch ke resource tersebut.

Kalau resource class dikelola Jersey/HK2, lalu kamu berharap CDI injection otomatis bekerja, behavior-nya tergantung integrasi yang tersedia dan konfigurasi runtime.

Rule praktis:

> Di Jakarta EE/CDI app, usahakan resource, service, dan cross-cutting business component dimiliki CDI. Jersey/Jakarta REST fokus ke HTTP runtime dan provider pipeline.

### 5.3 CDI Scope vs Jersey Scope

CDI scope umum:

```text
@ApplicationScoped  -> satu instance logis untuk aplikasi
@RequestScoped      -> satu context per HTTP request/CDI request
@Dependent          -> lifecycle mengikuti injection target
@SessionScoped      -> session context jika tersedia
```

Jersey/HK2 scope umum:

```text
Singleton           -> satu instance
RequestScoped       -> per request Jersey
PerLookup           -> instance baru setiap lookup
```

Jangan menganggap scope dengan nama mirip pasti sama secara teknis. `RequestScoped` CDI dan request scope Jersey harus dijembatani oleh integrasi runtime. Dalam runtime yang salah atau konfigurasi salah, request context bisa tidak aktif.

### 5.4 Transaction Boundary

Dalam Jakarta EE/CDI, transaction sering dikontrol oleh interceptor/proxy container:

```java
@ApplicationScoped
public class OrderService {

    @Transactional
    public void approveOrder(String id) {
        ...
    }
}
```

Resource memanggil service:

```java
@Path("/orders")
@RequestScoped
public class OrderResource {

    @Inject
    OrderService orderService;

    @POST
    @Path("/{id}/approve")
    public Response approve(@PathParam("id") String id) {
        orderService.approveOrder(id);
        return Response.noContent().build();
    }
}
```

Desain yang sehat:

```text
Resource       -> HTTP semantics, auth context extraction, request DTO
Service        -> transaction boundary, workflow orchestration
Repository     -> persistence operation
```

Desain yang berisiko:

```java
@Path("/orders")
public class OrderResource {

    @Transactional
    @POST
    public Response create(CreateOrderRequest request) {
        // 200 lines of orchestration here
    }
}
```

Kenapa berisiko?

- Resource menjadi terlalu berat.
- HTTP detail bercampur domain transaction.
- Sulit reuse workflow dari non-HTTP entry point.
- Sulit test service behavior tanpa Jersey.
- Authorization dan validation bisa tercampur dengan persistence.

### 5.5 CDI Provider dan Mapper

Provider seperti `ExceptionMapper`, `ContainerRequestFilter`, dan `MessageBodyReader` juga bisa butuh injection.

Contoh:

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {

    @Inject
    ErrorCodeCatalog errorCodeCatalog;

    @Override
    public Response toResponse(DomainException exception) {
        ...
    }
}
```

Dalam CDI model, pastikan provider tersebut benar-benar CDI-managed atau didukung oleh integrasi runtime. Jika tidak, `@Inject` bisa gagal.

### 5.6 Risiko CDI Integration

Risiko umum:

1. Resource dibuat oleh Jersey, bukan CDI.
2. Provider ditemukan oleh Jersey scanning tetapi bukan CDI bean.
3. CDI proxy diserialisasi tanpa sengaja.
4. Request context tidak aktif di async thread.
5. Transaction proxy tidak aktif karena self-invocation.
6. `@Transactional` diletakkan di private method atau method yang tidak dipanggil via proxy.
7. Bean discovery mode tidak menemukan class.
8. `javax.*` dan `jakarta.*` tercampur.

### 5.7 Java 8 hingga 25 Consideration untuk CDI Model

```text
Java 8:
  Umumnya terkait Java EE/Jakarta EE legacy, javax namespace, Jersey 2.x.

Java 11:
  Banyak app mulai migrasi dari Java EE ke Jakarta-era dependency, tetapi namespace bisa masih javax.

Java 17:
  Baseline penting untuk Jakarta EE 10/11 ecosystem modern.

Java 21:
  Virtual threads mulai relevan, tetapi CDI request context dan transaction context tetap harus dipropagasi dengan benar.

Java 25:
  LTS baru; fokus pada compatibility dependency, container support, bytecode level, reflection/module access, dan observability agent compatibility.
```

---

## 6. Model C — Jersey inside Spring / Spring Boot

### 6.1 Mental Model

Dalam Spring/Spring Boot, container utama adalah `ApplicationContext`.

```text
Spring Boot Application
  ├── ApplicationContext
  ├── Web Server / Servlet Container
  ├── Jersey Servlet or Filter
  ├── ResourceConfig
  ├── Spring Beans
  └── Jersey Runtime
```

Spring Boot menyediakan starter Jersey untuk membangun RESTful web applications menggunakan JAX-RS/Jersey sebagai alternatif Spring MVC. Dokumentasi Spring Boot juga menunjukkan bahwa aplikasi biasanya menyediakan bean `ResourceConfig` untuk mendaftarkan endpoint Jersey.

Mental model yang sehat:

```text
Spring owns service layer.
Jersey owns HTTP dispatch.
ResourceConfig bridges Spring beans/resources into Jersey.
```

### 6.2 Contoh Struktur Spring Boot + Jersey

```text
com.example
  Application.java

com.example.api
  JerseyConfig.java
  OrderResource.java
  ErrorMapper.java
  CorrelationFilter.java

com.example.app
  OrderService.java

com.example.infra
  OrderRepository.java
```

Contoh konfigurasi:

```java
@Configuration
public class JerseyConfig extends ResourceConfig {

    public JerseyConfig() {
        register(OrderResource.class);
        register(ErrorMapper.class);
        register(CorrelationFilter.class);
    }
}
```

Resource sebagai Spring component:

```java
@Component
@Path("/orders")
public class OrderResource {

    private final OrderService orderService;

    public OrderResource(OrderService orderService) {
        this.orderService = orderService;
    }

    @GET
    public List<OrderDto> list() {
        return orderService.listOrders();
    }
}
```

Service sebagai Spring bean:

```java
@Service
public class OrderService {

    @Transactional(readOnly = true)
    public List<OrderDto> listOrders() {
        ...
    }
}
```

### 6.3 Constructor Injection Lebih Aman

Untuk Spring + Jersey, constructor injection membuat ownership lebih jelas.

Lebih baik:

```java
@Component
@Path("/orders")
public class OrderResource {

    private final OrderService orderService;

    public OrderResource(OrderService orderService) {
        this.orderService = orderService;
    }
}
```

Daripada:

```java
@Path("/orders")
public class OrderResource {

    @Autowired
    private OrderService orderService;
}
```

Kenapa constructor injection lebih kuat?

- dependency wajib terlihat di constructor,
- object tidak bisa dibuat valid tanpa dependency,
- test lebih mudah,
- circular dependency lebih cepat ketahuan,
- tidak bergantung pada field reflection,
- lebih aman dengan final field,
- lebih mudah dianalisis sebagai graph.

### 6.4 ResourceConfig sebagai Bridge

Dalam Spring Boot + Jersey, `ResourceConfig` adalah titik penting.

Ia menjawab:

```text
Resource/filter/provider mana yang akan dilihat Jersey?
Apakah class didaftarkan eksplisit?
Apakah package scanning digunakan?
Apakah instance Spring bean didaftarkan?
Apakah provider dari Spring context ikut masuk?
```

Pola eksplisit:

```java
@Configuration
public class JerseyConfig extends ResourceConfig {

    public JerseyConfig() {
        register(OrderResource.class);
        register(OrderExceptionMapper.class);
        register(SecurityFilter.class);
        register(JacksonFeature.class);
    }
}
```

Pola package scanning:

```java
@Configuration
public class JerseyConfig extends ResourceConfig {

    public JerseyConfig() {
        packages("com.example.api");
    }
}
```

Untuk production, explicit registration biasanya lebih defensible daripada scanning luas.

Kenapa?

- Startup lebih deterministic.
- Resource yang expose ke publik terlihat jelas.
- Provider conflict lebih mudah dilacak.
- Security-sensitive class tidak tidak sengaja teregister.
- Migration lebih mudah.

### 6.5 Servlet vs Filter Mode

Spring Boot Jersey dapat dijalankan sebagai servlet atau filter tergantung konfigurasi. Ini penting karena posisi Jersey dalam servlet chain memengaruhi:

- static resource,
- error handling,
- Spring Security filter chain,
- servlet mapping,
- forwarded headers,
- request wrapping,
- compression,
- tracing,
- actuator endpoint coexistence.

Model servlet:

```text
HTTP request
  -> Servlet container
  -> Spring Security filters
  -> Jersey Servlet
  -> Jersey resource
```

Model filter:

```text
HTTP request
  -> Servlet container
  -> Spring filters
  -> Jersey Filter
  -> downstream servlet/static resource depending mapping
```

Tidak ada satu jawaban universal. Untuk kebanyakan REST API, servlet mode dengan mapping jelas sering lebih mudah. Filter mode berguna ketika Jersey perlu berada dalam chain tertentu atau coexist dengan static content/servlet handling tertentu.

### 6.6 Spring Security + Jersey

Spring Security hidup terutama sebagai servlet filter chain. Jersey hidup setelah request melewati filter chain.

Mental model:

```text
Spring Security authenticates request
  -> SecurityContextHolder populated
  -> Jersey resource executes
  -> Resource/service reads authenticated principal through bridge
```

Ada beberapa cara mengakses identity:

1. `SecurityContextHolder` di service/resource.
2. Servlet request principal.
3. Jersey `SecurityContext`.
4. Custom request context object.
5. Method argument resolver tidak tersedia seperti Spring MVC, kecuali dibuat bridge sendiri.

Pola yang sehat:

```java
@Component
public class CurrentUserProvider {

    public CurrentUser currentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        ...
    }
}
```

Resource:

```java
@Component
@Path("/cases")
public class CaseResource {

    private final CaseService caseService;
    private final CurrentUserProvider currentUserProvider;

    public CaseResource(CaseService caseService, CurrentUserProvider currentUserProvider) {
        this.caseService = caseService;
        this.currentUserProvider = currentUserProvider;
    }

    @POST
    public Response create(CreateCaseRequest request) {
        CurrentUser user = currentUserProvider.currentUser();
        CaseId id = caseService.createCase(user, request);
        return Response.created(...).build();
    }
}
```

Jangan menyebar parsing token di banyak resource. Authentication sebaiknya selesai sebelum resource. Resource hanya menerima identity yang sudah dinormalisasi.

### 6.7 Spring Transaction + Jersey

Spring transaction berjalan melalui proxy. Karena itu, transaction boundary paling aman diletakkan di Spring service bean:

```java
@Service
public class CaseService {

    @Transactional
    public CaseId createCase(CurrentUser user, CreateCaseRequest request) {
        ...
    }
}
```

Resource memanggil service:

```java
@Path("/cases")
@Component
public class CaseResource {

    private final CaseService caseService;

    @POST
    public Response create(CreateCaseRequest request) {
        CaseId id = caseService.createCase(...);
        return Response.created(...).build();
    }
}
```

Hindari menaruh transaction orchestration berat di resource.

Problem klasik:

```java
@Service
public class CaseService {

    public void outer() {
        inner(); // self-invocation, proxy transaction may not apply
    }

    @Transactional
    public void inner() {
        ...
    }
}
```

Ini bukan masalah Jersey langsung, tetapi sering muncul di Jersey + Spring app karena developer melihat resource sebagai entry point dan lupa bahwa transaction adalah behavior Spring proxy.

### 6.8 Provider sebagai Spring Bean atau Jersey Provider?

Misalnya `ExceptionMapper`:

```java
@Component
@Provider
public class GlobalExceptionMapper implements ExceptionMapper<Throwable> {

    private final ErrorResponseFactory errorResponseFactory;

    public GlobalExceptionMapper(ErrorResponseFactory errorResponseFactory) {
        this.errorResponseFactory = errorResponseFactory;
    }
}
```

Pertanyaan penting:

```text
Apakah mapper ini dibuat oleh Spring?
Apakah mapper ini ditemukan oleh Jersey scanning?
Apakah Jersey memakai instance Spring atau membuat instance sendiri?
```

Kalau mapper didaftarkan sebagai class:

```java
register(GlobalExceptionMapper.class);
```

runtime integration harus memastikan dependency Spring bisa masuk. Kalau tidak, Jersey/HK2 bisa mencoba membuatnya sendiri dan gagal.

Alternatif eksplisit:

```java
@Configuration
public class JerseyConfig extends ResourceConfig {

    public JerseyConfig(GlobalExceptionMapper mapper) {
        register(mapper);
    }
}
```

Ini membuat ownership eksplisit: instance mapper berasal dari Spring.

Trade-off:

- Register class: lebih natural Jersey, tetapi ownership bisa implisit.
- Register instance: ownership jelas, tetapi scope harus hati-hati; instance biasanya singleton.

Jika provider membutuhkan request-scoped dependency, jangan asal register singleton instance yang menyimpan request-scoped object langsung. Gunakan provider/proxy yang aman atau ambil request data saat method dieksekusi.

### 6.9 Spring Boot 3 vs 4 dan Jakarta Namespace

Spring Boot 3 berbasis Jakarta EE 9+ namespace (`jakarta.*`). Spring Boot 4 bergerak ke baseline Jakarta EE 11/Servlet 6.1 dan Java 17+. Ini penting untuk Jersey karena:

```text
Spring Boot 2.x -> javax-era ecosystem, Jersey 2.x common
Spring Boot 3.x -> jakarta-era ecosystem, Jersey 3.x common
Spring Boot 4.x -> Jakarta EE 11 era, Jersey 4.x alignment becomes relevant
```

Jangan mencampur dependency seperti:

```text
spring-boot-starter-jersey 3.x
+ jersey 2.x
+ javax.ws.rs-api
```

atau:

```text
spring-boot-starter-jersey 2.x
+ jakarta.ws.rs-api
+ Jersey 3.x provider
```

Gejalanya bisa berupa:

- `ClassNotFoundException`,
- `NoSuchMethodError`,
- `LinkageError`,
- provider tidak ditemukan,
- annotation tidak dikenali,
- resource tidak terdaftar,
- exception mapper tidak jalan.

Rule praktis:

```text
Jersey 2.x  -> javax.ws.rs
Jersey 3.x  -> jakarta.ws.rs / Jakarta EE 10-ish era
Jersey 4.x  -> Jakarta EE 11 / Jakarta REST 4.0 era
Spring Boot 2.x -> mostly javax era
Spring Boot 3.x -> jakarta era
Spring Boot 4.x -> Jakarta EE 11 baseline
```

---

## 7. Model D — Hybrid / Custom Bridge

### 7.1 Apa Itu Hybrid

Hybrid terjadi ketika aplikasi punya lebih dari satu composition mechanism aktif.

Contoh:

```text
Jersey ResourceConfig
  + HK2 binder
  + Spring ApplicationContext
  + CDI extension
  + manual static factory
  + service locator helper
```

Hybrid kadang tidak bisa dihindari, terutama di aplikasi legacy atau platform enterprise yang berevolusi bertahun-tahun.

Tetapi hybrid harus dianggap sebagai **migration state** atau **deliberate architecture**, bukan kebetulan.

### 7.2 Hybrid yang Masih Sehat

Contoh hybrid yang sehat:

```text
Spring owns business services.
Jersey owns REST resource/provider registry.
HK2 only binds Jersey-specific request context wrappers.
Manual factory only creates low-level immutable config object.
```

Diagram:

```text
Spring ApplicationContext
  ├── OrderService
  ├── OrderRepository
  ├── TransactionManager
  └── CurrentUserProvider

Jersey Runtime
  ├── OrderResource         -> Spring bean
  ├── ExceptionMapper       -> Spring bean
  ├── CorrelationFilter     -> Jersey/Spring bridge
  └── RequestContextBinder  -> HK2 binding for JAX-RS context only
```

Di sini boundary jelas.

### 7.3 Hybrid yang Buruk

Contoh buruk:

```text
OrderService dibuat oleh Spring.
PaymentService dibuat oleh HK2.
AuditService dibuat manual static singleton.
Repository dibuat oleh CDI.
Resource kadang dibuat Jersey, kadang Spring.
ExceptionMapper dibuat dua kali.
Filter membaca security dari ThreadLocal custom.
```

Gejalanya:

- sulit tahu instance mana yang aktif,
- test tidak merepresentasikan production,
- lifecycle shutdown tidak jelas,
- proxy transaction tidak konsisten,
- request context sering hilang,
- memory leak dari static singleton,
- circular dependency sulit dilacak,
- ordering filter tidak deterministic.

### 7.4 Bridge Pattern yang Aman

Jika harus bridge, gunakan adaptor kecil.

Contoh: Jersey filter membutuhkan Spring bean.

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter {

    private final TokenVerifier tokenVerifier;

    public AuthenticationFilter(TokenVerifier tokenVerifier) {
        this.tokenVerifier = tokenVerifier;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        ...
    }
}
```

Register instance dari Spring:

```java
@Configuration
public class JerseyConfig extends ResourceConfig {

    public JerseyConfig(AuthenticationFilter authenticationFilter) {
        register(authenticationFilter);
    }
}
```

Ini lebih jelas daripada filter mengambil bean dari static `ApplicationContextHolder`.

Hindari pola ini:

```java
public class SpringContextHolder {
    public static ApplicationContext context;
}
```

Lalu:

```java
TokenVerifier verifier = SpringContextHolder.context.getBean(TokenVerifier.class);
```

Kenapa buruk?

- menyembunyikan dependency,
- sulit test,
- lifecycle tidak jelas,
- raw service locator menyebar,
- circular dependency terlambat terdeteksi,
- bisa rusak saat multiple application context.

---

## 8. Ownership Matrix

Gunakan matrix ini saat mendesain integrasi.

| Component | HK2-only | CDI/Jakarta EE | Spring/Spring Boot | Rekomendasi |
|---|---:|---:|---:|---|
| Resource class | HK2/Jersey | CDI | Spring/Jersey bridge | Ikuti container utama |
| Application service | HK2 | CDI | Spring | Satu owner saja |
| Repository | HK2/manual | CDI/JPA container | Spring Data/manual Spring bean | Jangan campur owner |
| Transaction | manual/JTA custom | Jakarta Transaction | Spring transaction | Letakkan di service layer |
| ExceptionMapper | HK2/Jersey | CDI/Jersey | Spring bean atau Jersey class | Pastikan injection aktif |
| Filter | HK2/Jersey | CDI/Jersey | Spring bean atau Jersey provider | Hindari hidden lookup |
| MessageBody provider | Jersey | Jersey/CDI-aware | Jersey/Spring-aware | Register eksplisit jika custom |
| Security identity | Jersey `SecurityContext` | Container/CDI security | Spring Security + bridge | Normalisasi ke app identity |
| Request context | Jersey request | CDI request | Servlet/Spring request | Jangan simpan di singleton |
| Config | Jersey properties | MicroProfile/Container config | Spring Environment | Validasi di startup |
| Shutdown lifecycle | Jersey/HK2 | container | Spring | Resource cleanup harus jelas |

---

## 9. Resource Ownership: Class Registration vs Instance Registration

### 9.1 Register Class

```java
register(OrderResource.class);
```

Artinya:

```text
Jersey runtime menerima class dan akan membuat/mengelola instance sesuai integration/lifecycle.
```

Kelebihan:

- natural untuk Jersey,
- scope bisa dikelola runtime,
- provider annotation terbaca,
- lifecycle Jersey konsisten.

Risiko:

- jika resource butuh dependency dari Spring/CDI, perlu integration yang benar,
- bisa gagal jika constructor tidak dikenali,
- bisa membuat instance bukan dari container yang kamu kira.

### 9.2 Register Instance

```java
register(new OrderResource(orderService));
```

atau:

```java
register(orderResourceBean);
```

Artinya:

```text
Instance sudah dibuat di luar Jersey. Jersey memakai instance itu.
```

Kelebihan:

- ownership eksplisit,
- dependency sudah lengkap,
- cocok untuk Spring bean singleton provider/filter.

Risiko:

- instance biasanya singleton,
- berbahaya jika menyimpan request state,
- scope annotation mungkin tidak bermakna seperti yang diharapkan,
- lifecycle destroy mungkin tidak dikelola Jersey,
- request-scoped dependency harus proxy-safe.

### 9.3 Rule Praktis

```text
Resource yang stateless dan dimiliki Spring/CDI boleh didaftarkan sebagai bean/class sesuai integrasi resmi.
Provider/filter yang singleton dan stateless bisa didaftarkan sebagai instance.
Object yang menyimpan request-specific state jangan didaftarkan sebagai singleton instance.
```

---

## 10. Scope Mismatch: Sumber Bug Paling Licin

### 10.1 Singleton Menyimpan Request Object

Buruk:

```java
@Singleton
public class AuditFilter implements ContainerRequestFilter {

    @Context
    private HttpServletRequest request;

    private String lastUserId;

    @Override
    public void filter(ContainerRequestContext context) {
        lastUserId = request.getUserPrincipal().getName();
    }
}
```

Masalah:

- `lastUserId` shared antar request,
- data user bisa bocor antar thread,
- race condition,
- audit salah.

Lebih benar:

```java
@Provider
public class AuditFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext context) {
        SecurityContext security = context.getSecurityContext();
        String userId = security.getUserPrincipal().getName();
        context.setProperty("audit.userId", userId);
    }
}
```

Atau gunakan request-scoped holder yang benar-benar request-scoped.

### 10.2 Request Scoped Dependency di Singleton Provider

Misal Spring:

```java
@Component
@Provider
public class MyFilter implements ContainerRequestFilter {

    private final CurrentRequestContext currentRequestContext;

    public MyFilter(CurrentRequestContext currentRequestContext) {
        this.currentRequestContext = currentRequestContext;
    }
}
```

Jika `CurrentRequestContext` request scoped, Spring akan menyuntik proxy. Ini bisa bekerja jika dipakai saat request aktif. Tetapi bisa gagal jika:

- dipakai saat startup,
- dipakai di async thread tanpa context,
- disimpan ke field lain,
- dievaluasi di constructor,
- dipakai setelah request selesai.

Rule:

> Request-scoped proxy hanya aman jika diakses dalam request lifecycle yang valid.

---

## 11. Proxy Semantics: Kenapa Annotation Kadang Tidak Jalan

Spring dan CDI sering menerapkan feature melalui proxy/interceptor.

Contoh feature berbasis proxy/interceptor:

- `@Transactional`,
- `@Secured`,
- `@RolesAllowed`,
- metrics annotation,
- retry annotation,
- async annotation,
- validation method interceptor,
- caching annotation.

Feature seperti ini biasanya aktif hanya jika method dipanggil melalui proxy container.

### 11.1 Self Invocation

```java
@Service
public class ReportService {

    public void generate() {
        loadData(); // direct call, bypass proxy
    }

    @Transactional(readOnly = true)
    public List<Row> loadData() {
        ...
    }
}
```

`@Transactional` pada `loadData()` bisa tidak aktif karena call dilakukan dari object yang sama.

### 11.2 Resource Dibuat Bukan oleh Spring/CDI

```java
@Path("/reports")
public class ReportResource {

    @Autowired
    ReportService reportService;
}
```

Jika `ReportResource` dibuat oleh Jersey tanpa Spring integration, `@Autowired` bisa tidak bekerja.

### 11.3 Provider Dibuat Bukan oleh Container Utama

```java
@Provider
public class MyMapper implements ExceptionMapper<MyException> {

    @Inject
    ErrorCatalog catalog;
}
```

Jika mapper dibuat oleh Jersey/HK2, tetapi `ErrorCatalog` adalah CDI/Spring bean yang tidak dijembatani, injection gagal.

### 11.4 Checklist Proxy

Saat annotation tidak jalan, tanyakan:

```text
1. Siapa yang membuat object ini?
2. Apakah object ini proxy atau real class?
3. Method dipanggil dari luar proxy atau self-invocation?
4. Apakah method public?
5. Apakah class/method final sehingga proxy sulit dibuat?
6. Apakah dependency didaftarkan sebagai instance manual sehingga proxy dilewati?
7. Apakah test memakai object manual sehingga behavior proxy tidak dites?
```

---

## 12. Integration Design Patterns

### 12.1 Pattern 1 — Jersey as Thin HTTP Adapter

Ini pola paling direkomendasikan untuk enterprise.

```text
Resource:
  - parameter extraction
  - request DTO validation trigger
  - current user extraction
  - call application service
  - map result to HTTP response

Service:
  - transaction
  - authorization decision if domain-related
  - workflow orchestration
  - idempotency decision
  - domain invariant

Repository/Client:
  - persistence/outbound IO
```

Contoh:

```java
@Path("/cases")
@Component
public class CaseResource {

    private final CaseCommandService caseCommandService;
    private final UriInfoProvider uriInfoProvider;

    public CaseResource(CaseCommandService caseCommandService,
                        UriInfoProvider uriInfoProvider) {
        this.caseCommandService = caseCommandService;
        this.uriInfoProvider = uriInfoProvider;
    }

    @POST
    public Response create(@Valid CreateCaseRequest request) {
        CaseId id = caseCommandService.create(request);
        URI location = uriInfoProvider.caseUri(id);
        return Response.created(location).build();
    }
}
```

### 12.2 Pattern 2 — Resource Owns HTTP Semantics, Service Owns Business Semantics

Resource:

```java
@POST
@Path("/{id}/approve")
public Response approve(@PathParam("id") String id,
                        ApproveCaseRequest request) {
    ApprovalResult result = caseService.approve(new CaseId(id), request);

    if (result.alreadyApproved()) {
        return Response.status(Response.Status.CONFLICT)
                .entity(ErrorPayload.conflict("CASE_ALREADY_APPROVED"))
                .build();
    }

    return Response.noContent().build();
}
```

Lebih baik lagi, conflict mapping bisa melalui domain exception dan mapper:

```java
@POST
@Path("/{id}/approve")
public Response approve(@PathParam("id") String id,
                        ApproveCaseRequest request) {
    caseService.approve(new CaseId(id), request);
    return Response.noContent().build();
}
```

Exception mapper:

```java
@Provider
public class DomainConflictMapper implements ExceptionMapper<DomainConflictException> {
    @Override
    public Response toResponse(DomainConflictException ex) {
        return Response.status(Response.Status.CONFLICT)
                .entity(ProblemDetails.from(ex))
                .build();
    }
}
```

### 12.3 Pattern 3 — Explicit Platform Module

Untuk organisasi besar, buat module Jersey platform:

```text
company-jersey-platform
  ├── CorrelationIdFilter
  ├── RequestLoggingFilter
  ├── ProblemDetailsMapper
  ├── ValidationExceptionMapper
  ├── SecurityContextBridge
  ├── JacksonProviderFactory
  ├── JerseyClientFactory
  └── ResourceConfigCustomizer
```

Aplikasi memakai:

```java
public class ApiConfig extends ResourceConfig {
    public ApiConfig(CompanyJerseyPlatform platform) {
        platform.registerInto(this);
        register(CaseResource.class);
    }
}
```

Tetapi hati-hati: platform module jangan menjadi black box magic. Ia harus memiliki:

- dokumentasi registration order,
- daftar provider yang didaftarkan,
- priority policy,
- error contract,
- security assumptions,
- compatibility matrix,
- testing harness.

---

## 13. Anti-Pattern yang Harus Dihindari

### 13.1 Resource sebagai God Object

```java
@Path("/applications")
public class ApplicationResource {
    // inject 20 dependencies
    // 1000 lines endpoint logic
    // transaction orchestration
    // email sending
    // audit writing
    // workflow state transition
    // PDF generation
    // external API call
}
```

Akibat:

- sulit test,
- sulit change,
- transaction terlalu panjang,
- error mapping kacau,
- observability tidak granular,
- business logic terkunci ke HTTP.

### 13.2 Static ApplicationContext Holder

```java
public final class Beans {
    public static <T> T get(Class<T> type) {
        return context.getBean(type);
    }
}
```

Akibat:

- hidden dependency,
- test sulit,
- lifecycle kabur,
- multiple context rusak,
- migration sulit.

### 13.3 Mixed Annotation Without Integration

```java
@Path("/x")
@Component
@RequestScoped
@Singleton
public class ConfusedResource { ... }
```

Masalah:

- annotation dari container berbeda bisa bertentangan,
- scope mana yang berlaku tidak jelas,
- developer berikutnya salah asumsi.

### 13.4 Package Scanning Terlalu Luas

```java
packages("com.company");
```

Risiko:

- resource internal teregister,
- provider test teregister,
- duplicate mapper,
- startup lambat,
- behavior berubah saat class baru ditambah.

Lebih aman:

```java
register(CaseResource.class);
register(DocumentResource.class);
register(GlobalExceptionMapper.class);
```

### 13.5 Register Instance yang Stateful

```java
register(new UserAwareFilter()); // has mutable fields per user
```

Jika instance singleton menyimpan state request, data bocor antar request.

---

## 14. Testing Implication

Integrasi container memengaruhi test strategy.

### 14.1 Unit Test Resource Murni

Cocok untuk logic ringan:

```java
@Test
void shouldReturnCreatedWhenCaseCreated() {
    CaseService service = mock(CaseService.class);
    CaseResource resource = new CaseResource(service);

    Response response = resource.create(new CreateCaseRequest(...));

    assertEquals(201, response.getStatus());
}
```

Kelemahan:

- tidak mengetes Jersey matching,
- tidak mengetes provider,
- tidak mengetes injection runtime,
- tidak mengetes mapper/filter.

### 14.2 JerseyTest dengan HK2

Cocok untuk Jersey runtime behavior:

```java
@Override
protected Application configure() {
    return new ResourceConfig()
            .register(CaseResource.class)
            .register(GlobalExceptionMapper.class)
            .register(new AbstractBinder() {
                @Override
                protected void configure() {
                    bind(mockCaseService).to(CaseService.class);
                }
            });
}
```

### 14.3 Spring Boot Test + Jersey

Cocok untuk full integration:

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CaseResourceIT {
    ...
}
```

Mengetes:

- Spring context,
- Jersey registration,
- security filter chain,
- transaction,
- provider,
- actual HTTP stack.

Trade-off:

- lebih lambat,
- lebih kompleks,
- butuh test data management.

### 14.4 CDI/Jakarta EE Integration Test

Gunakan container test yang mendekati runtime target jika behavior bergantung pada CDI/JTA/security.

### 14.5 Test Matrix yang Sehat

```text
Resource unit tests:
  - simple response mapping
  - edge branch without HTTP runtime

Jersey runtime tests:
  - path/method/media matching
  - filters/interceptors
  - exception mappers
  - entity providers

Container integration tests:
  - DI integration
  - transaction
  - security
  - request scope

Contract tests:
  - JSON shape
  - error shape
  - status/header semantics
```

---

## 15. Debugging Integration Failure

Saat terjadi failure, jangan langsung ubah annotation. Ikuti diagnosis berikut.

### 15.1 Dependency Injection Gagal

Gejala:

```text
UnsatisfiedDependencyException
MultiException
IllegalStateException: InjectionManager not found
NullPointerException pada dependency
No qualifying bean
UnsatisfiedResolutionException
```

Pertanyaan:

```text
1. Object yang gagal dibuat itu resource/filter/mapper/service?
2. Siapa seharusnya owner object itu?
3. Apakah object didaftarkan sebagai class atau instance?
4. Apakah dependency berada di container yang sama?
5. Apakah bridge/integration module aktif?
6. Apakah package scanning menemukan class yang salah?
7. Apakah namespace javax/jakarta cocok?
```

### 15.2 Provider Tidak Jalan

Gejala:

```text
ExceptionMapper tidak menangkap exception
Filter tidak terpanggil
Custom MessageBodyWriter tidak dipakai
Validation mapper tidak aktif
```

Pertanyaan:

```text
1. Apakah provider terdaftar?
2. Apakah annotation @Provider cukup dalam konfigurasi ini?
3. Apakah package scanning meliputi package provider?
4. Apakah provider priority kalah?
5. Apakah generic type mapper benar?
6. Apakah exception dibungkus exception lain?
7. Apakah provider dibuat oleh container yang salah?
```

### 15.3 Transaction Tidak Aktif

Pertanyaan:

```text
1. Apakah method dipanggil melalui proxy?
2. Apakah method public?
3. Apakah annotation diletakkan di service bean yang dikelola Spring/CDI?
4. Apakah self-invocation terjadi?
5. Apakah resource dibuat manual sehingga proxy dilewati?
6. Apakah test memakai direct new?
```

### 15.4 Security Context Hilang

Pertanyaan:

```text
1. Authentication dilakukan di servlet filter, Jersey filter, atau gateway?
2. Apakah Jersey dijalankan sebagai servlet atau filter?
3. Apakah filter ordering benar?
4. Apakah async thread kehilangan ThreadLocal?
5. Apakah principal di servlet request dijembatani ke Jersey SecurityContext?
6. Apakah test melewati security filter chain?
```

### 15.5 javax/jakarta Collision

Gejala:

```text
Annotation terlihat benar tetapi tidak dikenali.
Resource tidak teregister.
Provider tidak ditemukan.
ClassNotFoundException javax.ws.rs.*
ClassNotFoundException jakarta.ws.rs.*
NoSuchMethodError pada API class.
```

Diagnosis:

```text
1. Jalankan dependency tree.
2. Cari javax.ws.rs-api dan jakarta.ws.rs-api yang muncul bersamaan.
3. Cocokkan Jersey major version.
4. Cocokkan servlet API major version.
5. Cocokkan Spring Boot/Jakarta EE baseline.
6. Jangan override dependency managed version sembarangan.
```

---

## 16. Java 8 hingga Java 25: Compatibility Strategy

### 16.1 Java 8

Biasanya berarti:

- Jersey 2.x,
- `javax.ws.rs`,
- Spring Boot 2.x atau legacy Spring,
- Java EE-era dependency,
- servlet 3.x/4.x,
- older Jackson/Bean Validation versions.

Strategi:

- Hindari mencampur `jakarta.*`.
- Lock dependency version.
- Buat migration test suite.
- Dokumentasikan provider dan filter yang custom.
- Jangan upgrade satu library tanpa dependency convergence.

### 16.2 Java 11

Biasanya fase transisi:

- masih banyak `javax.*`,
- JDK module removal berdampak pada JAXB/JAX-WS lama,
- TLS/default security berubah,
- container mulai modern.

Strategi:

- Perhatikan dependency JAXB/XML jika masih dipakai.
- Perhatikan illegal reflective access warning.
- Mulai pisahkan API boundary dari framework-specific code.

### 16.3 Java 17

Baseline modern untuk banyak Jakarta ecosystem.

Strategi:

- Cocok untuk Spring Boot 3/Jakarta namespace.
- Mulai migrasi dari `javax` ke `jakarta` jika target modern.
- Perkuat contract test sebelum migration.
- Hindari deep reflection yang tidak perlu.

### 16.4 Java 21

Virtual threads mulai menjadi pertimbangan.

Tetapi untuk Jersey integration, pertanyaan penting bukan hanya “bisa virtual threads?” tetapi:

```text
Apakah servlet container mendukung model itu?
Apakah request context aman?
Apakah MDC/security context terpropagasi?
Apakah transaction context tetap valid?
Apakah blocking IO dependency benar-benar scalable?
```

### 16.5 Java 25

Java 25 sebagai LTS baru berarti organisasi akan mulai membuat target runtime baru. Untuk Jersey, fokusnya:

- dependency compatibility,
- bytecode level,
- servlet/Jakarta EE baseline,
- Spring Boot/Jakarta EE server support,
- observability agent compatibility,
- reflection/module access,
- TLS/security provider behavior,
- test suite di runtime aktual.

---

## 17. Decision Framework: Memilih Composition Model

Gunakan pertanyaan berikut.

### 17.1 Apakah Aplikasi Sudah Spring Boot?

Jika ya:

```text
Gunakan Spring sebagai owner service layer.
Gunakan Jersey sebagai JAX-RS HTTP adapter.
Daftarkan ResourceConfig eksplisit.
Letakkan transaction/security/business orchestration di Spring service.
```

### 17.2 Apakah Aplikasi Berjalan di Jakarta EE Server?

Jika ya:

```text
Gunakan CDI sebagai owner service layer.
Gunakan Jakarta REST/Jersey sebagai HTTP runtime.
Letakkan transaction di service/CDI boundary.
Pastikan provider/filter CDI-aware jika butuh injection.
```

### 17.3 Apakah Aplikasi Standalone Kecil?

Jika ya:

```text
HK2-only bisa cukup.
Gunakan AbstractBinder eksplisit.
Jangan membangun framework custom berlebihan.
```

### 17.4 Apakah Aplikasi Legacy Hybrid?

Jika ya:

```text
Dokumentasikan owner setiap component.
Buat migration map.
Kurangi static lookup.
Pindahkan business service ke satu container utama.
Register provider/filter secara eksplisit.
Tambahkan integration tests untuk scope/security/transaction.
```

---

## 18. Regulatory / Case Management Perspective

Dalam sistem regulatory, enforcement, case management, atau workflow-heavy platform, composition model bukan sekadar preferensi teknis. Ia memengaruhi defensibility.

Contoh request:

```text
POST /cases/{caseId}/approve
```

Yang harus bisa dijawab:

```text
Siapa user-nya?
Role/authority apa yang digunakan?
Input apa yang dikirim?
Validation apa yang diterapkan?
State transition apa yang terjadi?
Transaction boundary di mana?
Audit event dibuat kapan?
Notification dikirim setelah commit atau sebelum commit?
Error apa yang dikembalikan jika state sudah berubah?
Correlation ID apa yang mengikat log, audit, dan outbound calls?
```

Kalau Jersey resource, Spring/CDI service, audit filter, transaction proxy, dan security context tidak memiliki ownership jelas, jawaban di atas menjadi sulit dibuktikan.

Pola yang defensible:

```text
Jersey Filter:
  - correlation id
  - normalized request metadata
  - authenticated principal bridge

Jersey Resource:
  - endpoint contract
  - request DTO
  - response status/header

Application Service:
  - authorization decision
  - workflow state transition
  - transaction boundary
  - domain event creation

After-Commit Handler:
  - notification
  - integration event
  - external sync

ExceptionMapper:
  - stable error contract
  - no sensitive leakage
  - correlation id in response
```

---

## 19. Production Checklist

Sebelum memilih atau mereview integrasi Jersey + CDI/Spring, jawab checklist ini.

### 19.1 Ownership

```text
[ ] Resource dibuat oleh container yang jelas.
[ ] Service layer dimiliki satu container utama.
[ ] Repository dimiliki container yang sama dengan transaction manager.
[ ] Provider/filter/mapper registration eksplisit.
[ ] Tidak ada hidden static service locator.
```

### 19.2 Scope

```text
[ ] Singleton tidak menyimpan request-specific mutable state.
[ ] Request-scoped dependency tidak dipakai di luar request lifecycle.
[ ] Async code memiliki context propagation strategy.
[ ] Provider singleton aman untuk concurrent requests.
```

### 19.3 Proxy

```text
[ ] Transaction annotation berada di bean yang dikelola container.
[ ] Method dipanggil melalui proxy.
[ ] Tidak ada self-invocation yang diasumsikan transactional.
[ ] Resource manual instance tidak melewati proxy penting.
```

### 19.4 Registration

```text
[ ] ResourceConfig eksplisit.
[ ] Package scanning tidak terlalu luas.
[ ] Custom provider priority diketahui.
[ ] Duplicate mapper/provider dicegah.
[ ] JSON provider dipilih eksplisit.
```

### 19.5 Namespace and Version

```text
[ ] Jersey major version cocok dengan ws.rs namespace.
[ ] Servlet API cocok dengan Spring Boot/Jakarta EE baseline.
[ ] Bean Validation namespace cocok.
[ ] Jackson/Jersey provider cocok.
[ ] Dependency tree bebas javax/jakarta collision.
```

### 19.6 Testing

```text
[ ] Unit test resource tidak menjadi satu-satunya test.
[ ] Jersey runtime test mencakup mapper/filter/provider.
[ ] Integration test mencakup DI/security/transaction.
[ ] Contract test mencakup error response.
[ ] Test environment mendekati production container model.
```

---

## 20. Mini Exercise

### Exercise 1 — Identify Owner

Untuk setiap class berikut, tentukan owner-nya:

```text
CaseResource
CaseService
CaseRepository
GlobalExceptionMapper
CorrelationIdFilter
CurrentUserProvider
ObjectMapper
EntityManager
Jersey Client
```

Jawab dalam format:

```text
Class: CaseService
Owner: Spring/CDI/HK2/manual
Scope: singleton/request/dependent
Reason: ...
Risk if wrong: ...
```

### Exercise 2 — Debug Transaction Not Active

Resource memanggil service, tetapi data tidak rollback saat exception.

Cari kemungkinan:

```text
1. Service bukan bean container.
2. Method transactional dipanggil via self-invocation.
3. Method tidak public.
4. Resource membuat service dengan `new`.
5. Test tidak memakai Spring/CDI context.
6. Wrong transaction manager.
7. Exception type tidak trigger rollback policy.
```

### Exercise 3 — Debug Mapper Not Called

`DomainExceptionMapper` tidak terpanggil.

Cari kemungkinan:

```text
1. Mapper tidak registered.
2. Package scanning tidak meliputi mapper.
3. Exception dibungkus `CompletionException`/`ProcessingException`.
4. Mapper generic type salah.
5. Mapper kalah oleh mapper lain.
6. Mapper dibuat oleh container salah dan gagal startup.
7. Response sudah committed.
```

---

## 21. Summary Mental Model

Inti Part 12:

```text
Jersey is a runtime.
Spring/CDI/HK2 are composition mechanisms.
Do not confuse annotation visibility with lifecycle ownership.
```

Kalimat paling penting:

> Integrasi Jersey yang sehat bukan ditentukan oleh apakah injection berhasil, tetapi oleh apakah ownership, scope, proxy, transaction, security, provider registration, dan test model semuanya konsisten.

Untuk production enterprise:

```text
Use Jersey as HTTP adapter.
Use one primary container for business services.
Register resources/providers deliberately.
Keep request state out of singleton objects.
Place transaction in service layer.
Bridge identity explicitly.
Test the real runtime integration, not only direct Java calls.
```

---

## 22. Referensi

- Eclipse Jersey User Guide — Custom Injection and Lifecycle Management: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/ioc.html
- Eclipse Jersey documentation: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/
- Spring Boot Jersey how-to: https://docs.spring.io/spring-boot/how-to/jersey.html
- Spring Boot reference/starter documentation: https://docs.spring.io/spring-boot/
- Spring Boot 4.0 migration guide: https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide
- Jakarta RESTful Web Services specification page: https://jakarta.ee/specifications/restful-ws/
- Jakarta REST 4.0 API docs: https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

---

## 23. Status Series

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — selesai
Part 9  — selesai
Part 10 — selesai
Part 11 — selesai
Part 12 — selesai
Part 13 — berikutnya
...
Part 32 — target akhir / capstone
```

Seri belum selesai. Part berikutnya adalah:

> Part 13 — Jersey Client Deep Dive: Invocation Pipeline, Connectors, Providers, and Configuration

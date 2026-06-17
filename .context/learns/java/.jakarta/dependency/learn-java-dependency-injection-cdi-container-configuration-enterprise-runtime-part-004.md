---
series: learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime
part: 004
title: Runtime / Container Model: Who Owns Your Object?
version_target: Java 8 sampai Java 25, Java EE javax.* sampai Jakarta EE jakarta.*
status: draft-complete
previous_part: 003 - Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
next_part: 005 - Classloaders, Modules, and Deployment Isolation
---

# Part 004 — Runtime / Container Model: Who Owns Your Object?

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas bahwa migrasi `javax.*` ke `jakarta.*` bukan sekadar mengganti import. Ia menyentuh dependency graph, API/implementation boundary, classpath, server runtime, dan kompatibilitas transitive dependency.

Bagian ini naik satu level lebih fundamental: **di runtime enterprise Java, siapa sebenarnya yang memiliki object?**

Pertanyaan ini terlihat sederhana, tetapi hampir semua masalah besar CDI, EJB, JAX-RS, Servlet, transaction, security, config, resource injection, dan proxy bisa ditelusuri ke pertanyaan ini.

Jika kita hanya berpikir seperti Java SE biasa:

```java
OrderService service = new OrderService(new JdbcOrderRepository());
service.submit(order);
```

maka object terlihat dimiliki oleh kode kita sendiri.

Tetapi di Jakarta EE / Java EE / CDI / Enterprise runtime, sering kali object tidak dibuat langsung oleh kode aplikasi:

```java
@Inject
OrderService service;
```

atau:

```java
@Path("/orders")
@RequestScoped
public class OrderResource {
    @Inject OrderService service;
}
```

atau:

```java
@Stateless
public class OrderApplicationService {
    @Inject OrderRepository repository;
}
```

Di sini ada aktor lain: **container**.

Container bukan hanya “tempat aplikasi berjalan”. Container adalah runtime yang:

- menemukan component,
- membuat instance,
- memilih dependency,
- mengaktifkan context,
- menyuntikkan dependency,
- membuat proxy,
- menjalankan interceptor,
- mengatur lifecycle,
- menghubungkan resource,
- membuka/menutup transaksi,
- melakukan security check,
- melakukan pooling,
- menghancurkan object pada waktu yang benar.

Jadi target bagian ini adalah membangun mental model berikut:

> Dalam enterprise Java, object bukan hanya data + behavior. Object adalah **managed participant** dalam runtime contract.

Kita akan membahas:

1. perbedaan unmanaged object dan managed object,
2. apa itu container secara konseptual,
3. jenis-jenis container di Java/Jakarta ecosystem,
4. deployment unit dan runtime phase,
5. bagaimana object ditemukan, dibuat, diinjeksi, diproxy, dipakai, dan dihancurkan,
6. kenapa `new` sering menjadi boundary berbahaya,
7. kenapa annotation tidak bekerja jika object tidak dimiliki container,
8. bagaimana membaca failure berdasarkan fase runtime,
9. bagaimana top engineer mendiagnosis masalah container.

---

## 1. Masalah Utama: Banyak Engineer Salah Mengira Annotation Adalah Runtime Magic

Banyak developer melihat annotation seperti ini:

```java
@RequestScoped
public class PaymentService {

    @Inject
    FraudClient fraudClient;
}
```

lalu mengira bahwa annotation otomatis “aktif”.

Padahal annotation sendiri hanya metadata.

Annotation tidak membuat object.
Annotation tidak menjalankan injection.
Annotation tidak membuka transaksi.
Annotation tidak menjalankan security check.
Annotation tidak membuat proxy.
Annotation tidak mengaktifkan request scope.

Yang membaca annotation dan mengeksekusi kontraknya adalah runtime/container.

Contoh klasik:

```java
public class Main {
    public static void main(String[] args) {
        PaymentService service = new PaymentService();
        service.pay();
    }
}
```

Jika `PaymentService` dibuat dengan `new`, field `fraudClient` tidak otomatis diinjeksi hanya karena ada `@Inject`.

```java
@RequestScoped
public class PaymentService {
    @Inject
    FraudClient fraudClient;
}
```

Agar injection terjadi, minimal harus ada proses seperti:

1. runtime menemukan `PaymentService` sebagai bean,
2. runtime memvalidasi dependency `FraudClient`,
3. runtime membuat contextual instance,
4. runtime mengisi injection point,
5. runtime mengembalikan reference/proxy kepada client.

Dengan kata lain:

> Annotation adalah deklarasi niat. Container adalah pihak yang mengeksekusi niat itu.

Ini adalah perbedaan mental antara “Java class” dan “managed component”.

---

## 2. Java SE Object Model vs Enterprise Managed Component Model

### 2.1 Java SE Object Model

Dalam Java SE biasa:

```java
var repository = new JdbcOrderRepository(dataSource);
var service = new OrderService(repository);
var result = service.submit(order);
```

Kode aplikasi bertanggung jawab atas:

- memilih class konkret,
- membuat instance,
- mengatur dependency,
- menentukan lifecycle,
- menentukan kapan object dibuang,
- menangani thread-safety,
- menangani resource cleanup.

Bentuk ownership-nya:

```text
Application code
  |
  | new
  v
Object instance
```

Kelebihan:

- eksplisit,
- mudah dipahami,
- tidak perlu container,
- cocok untuk domain object dan utility sederhana,
- mudah dites jika desain constructor-nya baik.

Kekurangan pada skala enterprise:

- object graph besar sulit dirakit manual,
- resource lifecycle mudah bocor,
- cross-cutting concern tersebar,
- transaction/security/retry/audit sering bercampur dengan business logic,
- environment-specific dependency selection menjadi sulit,
- test replacement butuh boilerplate besar,
- observability dan policy enforcement tidak konsisten.

### 2.2 Enterprise Managed Component Model

Dalam managed runtime:

```java
@ApplicationScoped
public class OrderService {
    @Inject OrderRepository repository;
    @Inject AuditService auditService;
}
```

Kode aplikasi mendeklarasikan dependency dan contract. Container yang bertanggung jawab membuat object graph.

Bentuk ownership-nya:

```text
Container
  |
  | discovers metadata
  | validates dependencies
  | creates contextual instance/proxy
  | injects dependencies
  | invokes lifecycle callbacks
  v
Managed component
```

Kelebihan:

- object graph dirakit konsisten,
- lifecycle dikelola,
- dependency resolution type-safe,
- transaction/security/audit bisa deklaratif,
- resource injection terstandar,
- environment-specific wiring bisa dikendalikan,
- framework integration lebih natural.

Kekurangan:

- runtime behavior lebih implisit,
- error bisa muncul di deployment/startup, bukan compile time,
- proxy/self-invocation/classloader bisa mengejutkan,
- lifecycle harus dipahami,
- salah scope bisa menyebabkan memory leak atau race condition,
- salah dependency boundary bisa menyebabkan hidden coupling.

### 2.3 Tabel Perbandingan

| Aspek | Java SE Object | Managed Component |
|---|---|---|
| Pembuat object | kode aplikasi | container |
| Dependency wiring | manual | injection/resolution |
| Lifecycle | manual/GC | context + callback + destruction |
| Cross-cutting concern | manual/decorator sendiri | interceptor/decorator/container service |
| Resource access | manual lookup/factory | injection/resource reference/producer |
| Transaction | manual API/framework | declarative/container-managed |
| Security | manual check | declarative/interceptor/container integration |
| Testability | bagus jika constructor-based | bagus jika boundary jelas, buruk jika terlalu container-coupled |
| Failure utama | bug eksplisit | deployment/runtime contract mismatch |

Top engineer tidak melihat salah satunya sebagai selalu lebih baik. Mereka memilih berdasarkan boundary.

Domain object sebaiknya tetap sederhana dan sering kali unmanaged. Application service, adapter, resource, listener, transaction boundary, config boundary, dan integration component sering cocok menjadi managed component.

---

## 3. Apa Itu Container?

Secara konsep, **container** adalah runtime yang berada di antara application component dan platform services.

Platform Jakarta EE sendiri menjelaskan bahwa container dapat menginjeksi service yang dibutuhkan component, seperti declarative transaction management, security check, resource pooling, dan state management. Ini adalah inti model enterprise Java: application component tidak langsung mengelola semua service infrastruktur; container menjadi mediator runtime.

Secara praktis, container adalah kombinasi dari:

1. metadata scanner,
2. dependency graph resolver,
3. object factory,
4. lifecycle manager,
5. context manager,
6. proxy/interceptor engine,
7. resource binder,
8. security/transaction coordinator,
9. deployment validator,
10. integration layer dengan server/runtime.

Gambaran sederhana:

```text
                 +-------------------------+
                 |      Application        |
                 |  classes + annotations  |
                 +------------+------------+
                              |
                              v
+---------------------------------------------------------------+
|                         Container                             |
|                                                               |
|  scan metadata | validate graph | create beans | inject deps   |
|  manage scope  | proxy calls    | intercept    | bind resource |
|  tx/security   | lifecycle      | destroy      | observe evt   |
+-----------------------------+---------------------------------+
                              |
                              v
+---------------------------------------------------------------+
|                  Platform / Runtime Services                  |
|  DB pool | transaction manager | security | HTTP | JMS | config |
+---------------------------------------------------------------+
```

Jadi container bukan hanya “server”. Container adalah **runtime contract executor**.

---

## 4. Jenis-Jenis Container dalam Java/Jakarta Ecosystem

Istilah container di Java sering membingungkan karena ada beberapa jenis container.

### 4.1 Servlet Container / Web Container

Servlet container menangani HTTP request/response dan lifecycle web component.

Contoh runtime:

- Tomcat,
- Jetty,
- Undertow,
- Servlet container di dalam WildFly, Payara, Open Liberty, GlassFish.

Ia mengelola:

- servlet instance,
- filter,
- listener,
- request dispatch,
- session,
- async request,
- HTTP connector,
- servlet context.

Dalam Jakarta Servlet modern, Servlet API adalah server-side API untuk menangani HTTP request dan response.

Contoh component:

```java
@WebServlet("/hello")
public class HelloServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        // ...
    }
}
```

Jika pakai JAX-RS, resource endpoint mungkin tidak langsung dikelola sebagai servlet, tetapi tetap berjalan di atas HTTP/web runtime.

### 4.2 CDI Container

CDI container mengelola bean, injection, scope, context, events, interceptors, decorators, dan extensions.

Contoh implementation/provider:

- Weld,
- Apache OpenWebBeans,
- Quarkus ArC,
- CDI integration di Open Liberty/Payara/WildFly.

CDI 4.1 mendefinisikan model memperoleh object untuk meningkatkan reusability, testability, dan maintainability dibanding constructor/factory/service locator tradisional.

Component contoh:

```java
@ApplicationScoped
public class PaymentPolicyService {
    @Inject RiskPolicyRepository repository;
}
```

CDI container bertanggung jawab menjawab:

- Apakah class ini bean?
- Scope-nya apa?
- Dependency `RiskPolicyRepository` yang mana?
- Perlu proxy atau instance langsung?
- Interceptor apa yang berlaku?
- Kapan `@PostConstruct` dipanggil?
- Kapan instance dihancurkan?

### 4.3 Enterprise Beans / EJB Container

Enterprise Beans container mengelola komponen bisnis seperti session beans dan message-driven beans, serta menyediakan fitur seperti transaksi, security, pooling, concurrency, timers, asynchronous method, dan remote/local business view.

Jakarta Enterprise Beans mendefinisikan arsitektur untuk pengembangan dan deployment aplikasi bisnis berbasis component.

Contoh:

```java
@Stateless
public class CaseAssignmentService {
    public AssignmentResult assign(CaseRecord record) {
        // container may provide transaction, pooling, security, etc.
    }
}
```

EJB container menjawab pertanyaan seperti:

- Apakah instance ini pooled?
- Apakah method ini transactional?
- Apakah caller punya role yang tepat?
- Apakah call ini local atau remote?
- Apakah async method dijalankan oleh managed executor internal?
- Apakah timer persistent perlu dijalankan ulang setelah restart?

### 4.4 Full Jakarta EE Application Server

Application server penuh menggabungkan banyak container dan provider:

- web/servlet container,
- CDI container,
- EJB container,
- JPA provider integration,
- transaction manager,
- security service,
- messaging/JMS,
- resource adapter,
- naming/JNDI,
- deployment subsystem,
- management/observability subsystem.

Contoh:

- WildFly/JBoss EAP,
- Payara/GlassFish,
- Open Liberty/WebSphere Liberty,
- WebLogic,
- TomEE.

Gambaran:

```text
Jakarta EE Application Server
|
+-- Servlet/Web Container
+-- CDI Container
+-- Enterprise Beans Container
+-- Transaction Manager
+-- Security Manager
+-- JPA Provider Integration
+-- JMS Provider Integration
+-- JNDI/Naming Service
+-- Resource Pooling
+-- Deployment Manager
```

### 4.5 Lightweight / Microservice Runtime

Modern runtime seperti Quarkus, Helidon, Micronaut, dan sebagian profile Open Liberty mengoptimalkan startup, memory, native image, atau build-time processing.

Dalam konteks CDI:

- sebagian runtime melakukan banyak analisis saat build time,
- tidak semua fitur CDI Full selalu tersedia,
- CDI Lite menjadi penting untuk runtime lebih kecil,
- extension model bisa berbeda.

Mental model tetap sama: ada pihak selain kode aplikasi yang mengelola component. Tetapi kapan keputusan dibuat bisa berubah:

| Model | Banyak keputusan dibuat saat |
|---|---|
| Traditional app server | deployment/startup runtime |
| Build-time optimized runtime | build time + augmentation phase |
| Plain Java SE | manual application code |

---

## 5. Managed vs Unmanaged Object

### 5.1 Managed Object

Object managed adalah object yang lifecycle-nya diketahui dan dikelola container.

Ciri-ciri umum:

- ditemukan oleh container,
- memiliki metadata yang dipahami container,
- dependency-nya diinjeksi,
- lifecycle callback dipanggil,
- bisa diproxy,
- bisa diintercept,
- bisa memiliki scope/context,
- bisa ikut transaction/security/resource integration.

Contoh:

```java
@RequestScoped
public class CreateCaseUseCase {
    @Inject CaseRepository repository;
    @Inject EventPublisher eventPublisher;
}
```

### 5.2 Unmanaged Object

Object unmanaged dibuat sendiri oleh kode aplikasi atau library biasa.

```java
CreateCaseUseCase useCase = new CreateCaseUseCase();
```

Jika dibuat seperti ini:

- `@Inject` tidak otomatis jalan,
- `@PostConstruct` tidak otomatis jalan,
- interceptor tidak aktif,
- transaction annotation tidak aktif,
- security annotation tidak aktif,
- scope tidak berlaku,
- context tidak aktif untuk object itu.

### 5.3 Domain Object Biasanya Unmanaged

Tidak semua object harus managed.

Contoh domain object:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;
}
```

atau:

```java
public class EnforcementCase {
    private CaseStatus status;
    private List<CaseEvent> events;

    public void escalate(Officer officer, EscalationReason reason) {
        // domain invariant
    }
}
```

Object seperti ini sering lebih sehat sebagai unmanaged object:

- tidak perlu injection,
- tidak perlu lifecycle container,
- tidak perlu proxy,
- tidak perlu scope,
- lebih mudah dites,
- lebih portable,
- lebih bebas dari framework coupling.

Rule of thumb:

> Managed component cocok untuk boundary/service/adapter/runtime concern. Domain value/entity/policy kecil sering lebih sehat unmanaged.

---

## 6. The Ownership Question: Siapa Membuat, Siapa Memakai, Siapa Menghancurkan?

Untuk setiap object penting, tanyakan:

1. siapa membuatnya?
2. kapan dibuat?
3. berapa banyak instance dibuat?
4. siapa menyimpan reference-nya?
5. siapa boleh memanggilnya?
6. apakah thread-safe?
7. apakah dependency-nya stable?
8. apakah diproxy?
9. apakah interceptor berlaku?
10. siapa menghancurkannya?

Contoh `@ApplicationScoped` CDI bean:

```java
@ApplicationScoped
public class ExchangeRateClient {
    @PostConstruct
    void init() {
        // initialize reusable HTTP client metadata
    }

    @PreDestroy
    void close() {
        // cleanup resource if needed
    }
}
```

Ownership:

| Pertanyaan | Jawaban |
|---|---|
| Siapa membuat? | CDI container |
| Kapan dibuat? | tergantung lazy/eager implementation, sebelum pertama dipakai atau saat startup |
| Berapa instance? | biasanya satu contextual instance per application context |
| Siapa menyimpan? | container/context |
| Siapa memanggil? | client melalui injected reference/proxy |
| Thread-safe? | harus aman untuk concurrent access |
| Diproxy? | normal scope biasanya melalui client proxy |
| Interceptor berlaku? | ya, jika method dipanggil lewat proxy/container |
| Siapa menghancurkan? | container saat application context shutdown |

Contoh `new` object:

```java
var client = new ExchangeRateClient();
```

Ownership:

| Pertanyaan | Jawaban |
|---|---|
| Siapa membuat? | kode aplikasi |
| Kapan dibuat? | saat statement `new` dijalankan |
| Berapa instance? | sebanyak `new` dipanggil |
| Siapa menyimpan? | kode pemanggil |
| Siapa memanggil? | kode pemanggil |
| Thread-safe? | tanggung jawab developer |
| Diproxy? | tidak |
| Interceptor berlaku? | tidak |
| Siapa menghancurkan? | tidak ada callback container, hanya GC/cleanup manual |

Ini sebabnya `new` bukan sekadar syntax. Dalam managed runtime, `new` adalah keputusan ownership.

---

## 7. Kenapa `new` Bisa Menjadi Boundary Berbahaya

`new` tidak salah. Tetapi `new` berbahaya jika dipakai untuk object yang seharusnya dikelola container.

### 7.1 Injection Tidak Terjadi

```java
public class CaseResource {
    public Response submit(CaseRequest request) {
        var service = new CaseSubmissionService();
        service.submit(request);
        return Response.ok().build();
    }
}

public class CaseSubmissionService {
    @Inject CaseRepository repository;
}
```

`repository` akan `null` karena `CaseSubmissionService` bukan dibuat container.

### 7.2 Interceptor Tidak Jalan

```java
public class CaseResource {
    public Response submit(CaseRequest request) {
        var service = new CaseSubmissionService();
        service.submit(request); // @Transactional tidak berlaku
        return Response.ok().build();
    }
}

public class CaseSubmissionService {
    @Transactional
    public void submit(CaseRequest request) {}
}
```

Jika `@Transactional` dikelola interceptor/container, call ke object unmanaged tidak akan melewati interceptor.

### 7.3 Scope Tidak Berlaku

```java
@RequestScoped
public class CurrentOfficerContext {
    private Officer officer;
}
```

Jika object dibuat manual, ia tidak otomatis terkait request aktif.

### 7.4 Resource Cleanup Tidak Terjadi

```java
public class ExportClient {
    @PreDestroy
    void close() {
        // close resources
    }
}
```

Jika dibuat manual, `@PreDestroy` tidak otomatis dipanggil.

### 7.5 Policy Runtime Terlewati

Jika tim mengandalkan interceptor untuk:

- audit,
- idempotency,
- authorization,
- rate limit,
- transaction,
- feature gate,

maka membuat object manual bisa melewati policy tersebut.

Dalam sistem regulatory/enforcement, ini sangat berbahaya karena behavior yang terlihat benar secara functional bisa salah secara compliance.

---

## 8. Object Lifecycle: Dari Class Menjadi Runtime Participant

Sebuah class tidak otomatis menjadi managed component. Ada pipeline.

```text
Source code
   |
   v
Compiled class
   |
   v
Packaged artifact: JAR/WAR/EAR
   |
   v
Deployment unit loaded by runtime
   |
   v
Container scans metadata
   |
   v
Container discovers candidate component/bean
   |
   v
Container validates dependency graph
   |
   v
Container creates proxies/metadata model
   |
   v
Container creates contextual instances when needed
   |
   v
Injection + lifecycle callbacks
   |
   v
Component participates in requests/events/jobs/messages
   |
   v
Context ends / application shutdown
   |
   v
Destruction callbacks / resource cleanup
```

Setiap fase punya jenis error berbeda.

---

## 9. Runtime Phase 1: Bootstrap

Bootstrap adalah fase runtime/server mulai hidup.

Pada traditional app server:

```text
Start JVM
  -> start server kernel
  -> load server modules
  -> start services: naming, transaction, security, deployment subsystem
  -> listen for deployment
```

Pada executable microservice runtime:

```text
Start JVM
  -> start app runtime
  -> initialize CDI/container/application context
  -> start HTTP listener
```

Pada build-time optimized runtime:

```text
Build augmentation happened earlier
  -> runtime starts with precomputed metadata
  -> initialize runtime components
```

Failure umum:

- Java version tidak cocok,
- server module gagal load,
- missing provider,
- incompatible API jar,
- port conflict,
- config dasar server salah,
- security/keystore/resource subsystem gagal.

Contoh gejala:

```text
UnsupportedClassVersionError
ClassNotFoundException during server startup
Port already in use
Failed to initialize transaction subsystem
```

---

## 10. Runtime Phase 2: Deployment Unit Loading

Deployment unit adalah artifact yang diserahkan ke runtime.

Bentuk umum:

- `jar`,
- `war`,
- `ear`,
- executable jar,
- exploded deployment directory,
- container image entrypoint.

### 10.1 JAR

JAR bisa berisi:

- library biasa,
- CDI bean archive,
- EJB module,
- executable app,
- provider implementation.

### 10.2 WAR

WAR biasanya berisi web application:

```text
my-app.war
|
+-- WEB-INF/classes
+-- WEB-INF/lib/*.jar
+-- WEB-INF/web.xml
+-- META-INF/beans.xml or WEB-INF/beans.xml
```

WAR sering menjadi unit deployment untuk:

- servlet,
- filter,
- listener,
- JAX-RS resources,
- CDI beans,
- web security.

### 10.3 EAR

EAR menggabungkan beberapa module:

```text
my-enterprise-app.ear
|
+-- lib/*.jar
+-- case-web.war
+-- case-ejb.jar
+-- integration-ejb.jar
+-- META-INF/application.xml
```

EAR relevan di legacy/large enterprise karena module isolation dan shared library model lebih kompleks.

### 10.4 Failure Umum Deployment Loading

- artifact corrupt,
- duplicate library,
- wrong package namespace,
- missing deployment descriptor,
- server tidak mendukung spec version,
- WAR membawa API jar yang seharusnya `provided`,
- `javax.*` artifact dideploy ke Jakarta runtime,
- classloader conflict.

---

## 11. Runtime Phase 3: Metadata Scanning

Container perlu menemukan metadata.

Sumber metadata:

- annotation,
- deployment descriptor XML,
- service provider file,
- module descriptor,
- generated metadata,
- build-time index,
- vendor config,
- extension output.

Contoh annotation:

```java
@RequestScoped
public class CaseResource {}

@ApplicationScoped
public class CasePolicyService {}

@Stateless
public class CaseAssignmentBean {}

@Provider
public class JsonMappingExceptionMapper implements ExceptionMapper<JsonMappingException> {}
```

Container tidak menjalankan semua class di classpath. Ia mencari class yang relevan berdasarkan aturan discovery.

Mental model:

```text
Classpath/deployment archive
   |
   v
Scanner/indexer
   |
   +-- CDI bean candidates
   +-- Servlet components
   +-- JAX-RS resources/providers
   +-- EJB components
   +-- Interceptors/decorators
   +-- Extension/provider metadata
```

### 11.1 Kenapa Scanning Bisa Mahal

Pada aplikasi besar:

- ribuan class,
- banyak dependency,
- banyak annotation,
- banyak nested JAR,
- banyak reflection metadata,
- banyak provider.

Startup bisa lambat jika scanning terlalu luas.

Build-time optimized runtime mengurangi biaya ini dengan precomputed index/metadata.

### 11.2 Failure Umum Metadata Scanning

- class gagal load saat scanning,
- annotation class tidak ditemukan,
- bytecode version tidak cocok,
- duplicate annotation API,
- library membawa old `javax` annotation,
- custom extension gagal membaca type.

---

## 12. Runtime Phase 4: Discovery and Registration

Setelah metadata dibaca, container memutuskan component mana yang resmi masuk runtime model.

Contoh pertanyaan CDI:

- Apakah class ini bean?
- Apakah bean-discovery-mode mengizinkan class ini?
- Apakah punya bean-defining annotation?
- Apa bean type-nya?
- Apa qualifier-nya?
- Apa scope-nya?
- Apakah alternative aktif?

Contoh pertanyaan web container:

- Servlet apa saja yang ada?
- Filter apa saja?
- Listener apa saja?
- Mapping URL-nya apa?
- Ordering filter bagaimana?

Contoh pertanyaan EJB container:

- Session bean apa saja?
- Stateless/stateful/singleton?
- Business interface-nya apa?
- Transaction attribute default-nya apa?
- Security metadata-nya apa?

Hasilnya adalah registry internal:

```text
Runtime Metadata Registry
|
+-- BeanDefinition: CaseService
|     scope: ApplicationScoped
|     qualifiers: @Default, @Any
|     beanTypes: CaseService, Object
|
+-- BeanDefinition: OracleCaseRepository
|     scope: ApplicationScoped
|     qualifiers: @PrimaryDatabase, @Any
|
+-- InterceptorDefinition: AuditInterceptor
|     binding: @Audited
|
+-- ResourceDefinition: jdbc/CaseDS
|     type: DataSource
```

---

## 13. Runtime Phase 5: Validation

Salah satu kekuatan enterprise runtime adalah banyak error bisa diketahui saat deployment/startup, bukan saat request pertama.

CDI misalnya dapat memvalidasi dependency graph:

```java
@ApplicationScoped
public class CaseService {
    @Inject CaseRepository repository;
}
```

Container bertanya:

- Ada bean yang assignable ke `CaseRepository`?
- Qualifier cocok?
- Ada lebih dari satu kandidat?
- Candidate bisa diproxy?
- Scope valid?
- Circular dependency bisa ditangani atau tidak?

### 13.1 Unsatisfied Dependency

```text
Unsatisfied dependency for type CaseRepository with qualifiers @Default
```

Artinya container tidak menemukan bean yang cocok.

Kemungkinan akar masalah:

- implementation belum diberi bean-defining annotation,
- archive tidak discoverable,
- qualifier salah,
- package `javax`/`jakarta` mismatch,
- class tidak masuk deployment,
- dependency scope Maven salah,
- module tidak visible.

### 13.2 Ambiguous Dependency

```text
Ambiguous dependencies for type NotificationSender with qualifiers @Default
```

Artinya ada lebih dari satu kandidat.

```java
@ApplicationScoped
public class EmailNotificationSender implements NotificationSender {}

@ApplicationScoped
public class SmsNotificationSender implements NotificationSender {}

@Inject
NotificationSender sender;
```

Container tidak tahu harus pilih yang mana.

Solusi biasanya:

- qualifier,
- alternative,
- priority,
- producer,
- injection of `Instance<NotificationSender>` untuk multi implementation.

### 13.3 Unproxyable Type

Normal scoped CDI bean sering butuh proxy. Jika class tidak proxyable, deployment bisa gagal.

Contoh:

```java
@ApplicationScoped
public final class RiskPolicyService {
}
```

Atau method final tertentu yang harus diintercept.

Solusi:

- jangan final untuk managed service yang perlu proxy,
- gunakan interface,
- gunakan scope yang sesuai,
- pahami aturan proxy provider.

### 13.4 Validation sebagai Safety Net

Top engineer menyukai startup validation karena ia memindahkan error dari runtime traffic ke deployment gate.

Tetapi efek sampingnya:

- startup bisa gagal karena satu bean yang bahkan jarang dipakai,
- dependency graph harus bersih,
- conditional wiring harus eksplisit,
- test startup menjadi penting.

---

## 14. Runtime Phase 6: Instance Creation

Setelah metadata valid, container bisa membuat instance. Tetapi kapan instance dibuat tergantung model.

### 14.1 Eager vs Lazy

Beberapa component dibuat saat startup. Beberapa dibuat saat pertama kali dipakai.

Contoh conceptual:

```text
Application starts
  -> metadata registered
  -> proxy created
  -> actual instance may not exist yet

First request calls bean
  -> context resolves actual instance
  -> instance created
```

Ini penting karena log `@PostConstruct` mungkin tidak muncul saat startup untuk semua bean.

### 14.2 Constructor Rules

Container perlu cara membuat instance.

CDI dapat menggunakan constructor injection:

```java
@ApplicationScoped
public class CaseService {
    private final CaseRepository repository;

    @Inject
    public CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Jika tidak ada constructor injection, container biasanya butuh no-arg constructor atau constructor yang valid berdasarkan spec/provider.

### 14.3 Creation Order

Creation order bukan sekadar urutan class.

```text
Need CaseService
  -> need CaseRepository
     -> need DataSource
        -> need resource binding
  -> need AuditService
     -> need Clock
```

Container membuat berdasarkan dependency graph.

### 14.4 Creation Failure

Contoh gagal:

- constructor throw exception,
- producer method throw exception,
- `@PostConstruct` throw exception,
- dependency resource belum tersedia,
- config missing,
- circular dependency tidak bisa dipecahkan,
- context tidak aktif.

---

## 15. Runtime Phase 7: Injection

Injection adalah proses mengisi dependency ke injection point.

Jenis umum:

### 15.1 Constructor Injection

```java
@ApplicationScoped
public class CaseService {
    private final CaseRepository repository;

    @Inject
    public CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Kelebihan:

- dependency eksplisit,
- field bisa final,
- mudah unit test,
- object lebih jelas invariant-nya.

Kekurangan:

- beberapa framework/spec lama punya batasan,
- cyclic dependency lebih cepat terlihat.

### 15.2 Field Injection

```java
@Inject
CaseRepository repository;
```

Kelebihan:

- ringkas,
- umum di legacy Jakarta/Java EE.

Kekurangan:

- dependency tersembunyi,
- sulit unit test tanpa container/reflection,
- field tidak final,
- raw object tidak valid sebelum injection.

### 15.3 Method Injection

```java
@Inject
void setRepository(CaseRepository repository) {
    this.repository = repository;
}
```

Berguna untuk optional setup atau integration tertentu, tetapi lebih jarang dipilih untuk application service modern.

### 15.4 Resource Injection vs CDI Injection

```java
@Resource(lookup = "java:comp/env/jdbc/CaseDS")
DataSource dataSource;
```

`@Resource` bukan sama dengan CDI `@Inject`.

CDI injection mencari bean berdasarkan type/qualifier.
Resource injection sering mencari resource dari naming/container environment.

Nanti akan dibahas detail di Part 023 dan 024.

---

## 16. Runtime Phase 8: Lifecycle Callback

Lifecycle callback memberi hook pada momen tertentu.

```java
@PostConstruct
void init() {
    // after injection is complete
}

@PreDestroy
void destroy() {
    // before container destroys instance
}
```

Urutan umum:

```text
allocate object
  -> constructor
  -> dependency injection
  -> PostConstruct
  -> ready for business method
  -> PreDestroy
  -> instance discarded
```

### 16.1 Constructor Bukan Tempat Semua Init

Di constructor, injected field belum tersedia.

Buruk:

```java
@ApplicationScoped
public class ReportService {
    @Inject ConfigService config;

    public ReportService() {
        config.get("x"); // null jika field injection belum terjadi
    }
}
```

Lebih benar:

```java
@PostConstruct
void init() {
    config.get("x");
}
```

Atau gunakan constructor injection.

### 16.2 `@PostConstruct` Bukan Tempat Heavy Startup Sembarangan

`@PostConstruct` sering menggoda untuk:

- call external API,
- load huge cache,
- run migration,
- start thread,
- warm up everything.

Risiko:

- startup lambat,
- deployment gagal karena dependency eksternal sementara down,
- readiness probe salah,
- restart storm,
- resource leak.

Prinsip:

> Gunakan `@PostConstruct` untuk validasi dan initialization internal yang bounded. Untuk I/O berat, desain readiness, retry, timeout, dan operational behavior secara eksplisit.

---

## 17. Runtime Phase 9: Proxy Creation and Dispatch

Managed runtime sering tidak menyuntikkan object asli, melainkan proxy.

Contoh:

```java
@Inject
CaseService caseService;
```

Yang diterima bisa berupa:

```text
CaseService_ClientProxy
```

Proxy bertugas:

- memilih contextual instance yang benar,
- menerapkan interceptor,
- menjaga scope semantics,
- mendukung lazy resolution,
- memisahkan client dari lifecycle actual object.

Gambaran:

```text
Client bean
   |
   | calls submit()
   v
Client proxy
   |
   | resolve actual contextual instance
   | apply interceptor chain
   v
Actual CaseService instance
```

### 17.1 Kenapa Proxy Penting untuk Scope

Misal `@RequestScoped` bean diinjeksi ke `@ApplicationScoped` bean.

```java
@ApplicationScoped
public class CaseFacade {
    @Inject CurrentUser currentUser;
}

@RequestScoped
public class CurrentUser {
    public String officerId() { ... }
}
```

`CaseFacade` hidup selama aplikasi, tetapi `CurrentUser` berbeda per request.

Jika yang diinjeksi actual `CurrentUser`, maka salah total.

Yang diinjeksi harus proxy:

```text
CaseFacade singleton-ish instance
   |
   +-- CurrentUser proxy
          |
          +-- request A -> CurrentUser instance A
          +-- request B -> CurrentUser instance B
```

Proxy membuat reference stabil tetapi target dinamis sesuai context.

### 17.2 Self-Invocation Problem

```java
@ApplicationScoped
public class CaseService {

    public void submit() {
        validate(); // direct self-call
    }

    @Audited
    public void validate() {
        // audit interceptor may not run on self-invocation
    }
}
```

Jika interceptor dipasang melalui proxy, call internal `this.validate()` tidak melewati proxy.

Ini salah satu bug container paling sering.

Solusi desain:

- pindahkan method intercepted ke bean lain,
- call melalui injected proxy diri sendiri dengan hati-hati jika didukung,
- desain boundary method agar external call melewati proxy,
- jangan meletakkan policy kritikal pada method yang hanya dipanggil internal.

---

## 18. Runtime Phase 10: Interceptor and Decorator Chain

Container bisa menaruh chain di sekitar business method.

```text
Client
  -> proxy
     -> security interceptor
        -> transaction interceptor
           -> audit interceptor
              -> metrics interceptor
                 -> actual method
```

Contoh:

```java
@Transactional
@Audited
public void approveCase(CaseId id) {
    // business logic
}
```

Kode method terlihat bersih, tetapi runtime behavior lebih besar:

1. security check mungkin terjadi,
2. transaction dibuka,
3. audit context dibuat,
4. metrics timer mulai,
5. method dipanggil,
6. exception diproses,
7. transaction commit/rollback,
8. audit/metrics dicatat.

### 18.1 Konsekuensi untuk Debugging

Stack trace mungkin panjang dan penuh proxy/interceptor.

Top engineer tidak panik melihat stack trace seperti:

```text
AuditInterceptor.aroundInvoke
TransactionalInterceptor.invoke
SecurityInterceptor.invoke
CaseService$Proxy$_$$_WeldClientProxy.approveCase
```

Mereka membaca stack trace sebagai runtime chain, bukan noise.

### 18.2 Interceptor Order Matters

Urutan interceptor bisa mengubah behavior.

Contoh:

```text
Audit outside transaction:
  audit logs even if transaction fails?

Audit inside transaction:
  audit rolls back with business data?
```

Tidak ada jawaban universal. Untuk regulatory system, audit sering harus sangat sadar boundary:

- audit attempt,
- audit success,
- audit failure,
- immutable operational audit,
- business audit transactional.

---

## 19. Runtime Phase 11: Context Activation

Scope hanya bekerja jika context aktif.

Contoh CDI scope:

- request context,
- session context,
- application context,
- conversation context,
- dependent pseudo-scope.

Jika menggunakan request-scoped bean di luar request aktif:

```text
ContextNotActiveException
```

Contoh kasus:

```java
@RequestScoped
public class CurrentRequestContext {
    public String correlationId() { ... }
}

@ApplicationScoped
public class BackgroundJob {
    @Inject CurrentRequestContext requestContext;

    public void run() {
        requestContext.correlationId(); // no HTTP request context
    }
}
```

Di background job, request context mungkin tidak aktif.

### 19.1 Context Bukan ThreadLocal Sederhana, Tapi Sering Terikat Thread

Banyak implementation mengikat context ke thread/request.

Masalah muncul saat:

- async execution,
- executor manual,
- scheduler,
- messaging listener,
- reactive pipeline,
- virtual thread integration,
- callback library.

Top engineer selalu bertanya:

> Apakah context yang saya butuhkan aktif di execution boundary ini?

### 19.2 Context Propagation

Jika perlu membawa context ke async boundary, gunakan mekanisme container-managed atau MicroProfile Context Propagation, bukan asal copy ThreadLocal manual.

Ini akan dibahas detail di Part 030.

---

## 20. Runtime Phase 12: Transaction and Security Integration

Container sering mengelola transaction/security secara deklaratif.

Contoh:

```java
@Transactional
public void approveCase(CaseId id) {
    repository.markApproved(id);
    eventLog.record(id, "APPROVED");
}
```

Atau EJB:

```java
@Stateless
public class ApprovalService {
    public void approve(CaseId id) {
        // default transaction behavior may apply
    }
}
```

Security:

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(CaseId id) {
}
```

Container mengeksekusi contract tersebut berdasarkan call boundary.

### 20.1 Call Boundary Penting

Jika method dipanggil langsung internal, interceptor/security/transaction bisa tidak berlaku tergantung model.

```java
public void outer() {
    innerRequiresNew(); // may not start REQUIRES_NEW if self-invocation bypasses proxy
}

@Transactional(REQUIRES_NEW)
public void innerRequiresNew() {}
```

Desain yang benar harus memperlakukan transaction boundary sebagai runtime boundary, bukan sekadar annotation kosmetik.

### 20.2 Checked vs Runtime Exception

Dalam beberapa model transaction, jenis exception mempengaruhi rollback default. Ini akan dibahas lebih detail di Part 022 dan saat membahas CDI transaction/interceptor.

Untuk bagian ini, mental model cukup:

> Transaction bukan milik method body. Transaction adalah behavior container di sekeliling method invocation.

---

## 21. Runtime Phase 13: Destruction and Shutdown

Managed object harus dihancurkan pada saat yang benar.

Contoh:

```java
@ApplicationScoped
public class ExportBufferManager {
    @PreDestroy
    void shutdown() {
        flushBuffers();
    }
}
```

### 21.1 Destruction Berdasarkan Scope

| Scope | Kapan dihancurkan |
|---|---|
| Request | akhir request/context |
| Session | session invalidated/expired |
| Application | app shutdown/undeploy |
| Dependent | mengikuti owner/injection point tertentu |
| Stateful EJB | explicit remove/passivation/lifecycle container |

### 21.2 Shutdown Tidak Selalu Ideal

Dalam production:

- container bisa kill karena timeout,
- pod bisa termination setelah grace period,
- process bisa crash,
- node bisa mati,
- deployment bisa rolling restart.

Jadi `@PreDestroy` bagus, tetapi jangan bergantung padanya untuk satu-satunya mekanisme critical durability.

Prinsip:

> Critical business state harus committed sebelum response sukses, bukan berharap flush saat shutdown.

---

## 22. Deployment Unit and Container Boundary

Container boundary menentukan visibility dan lifecycle.

### 22.1 WAR Boundary

Dalam WAR:

```text
case-app.war
|
+-- REST resources
+-- CDI beans
+-- WEB-INF/lib
+-- WEB-INF/classes
```

Bean dalam WAR biasanya terlihat dalam application tersebut.

### 22.2 EAR Boundary

Dalam EAR:

```text
case-platform.ear
|
+-- case-api.jar
+-- case-web.war
+-- case-ejb.jar
+-- shared-lib.jar
```

Pertanyaan penting:

- Apakah `case-web.war` bisa melihat class di `case-ejb.jar`?
- Apakah dua WAR berbagi CDI context?
- Apakah shared library masuk EAR/lib atau masing-masing WAR/lib?
- Apakah EJB local interface visible?

Jawaban tergantung packaging dan server rules.

### 22.3 Container Boundary in Microservice Runtime

Dalam executable jar/container image:

```text
container image
  -> JVM process
     -> application runtime
        -> CDI/application context
        -> HTTP server
```

Boundary-nya lebih sederhana tetapi tetap ada:

- application classpath,
- build-time index,
- runtime config,
- process lifecycle,
- Kubernetes lifecycle.

---

## 23. Container as Policy Engine

Salah satu cara terbaik memahami enterprise runtime:

> Container adalah policy engine untuk object invocation.

Ketika client memanggil method, container bisa menegakkan policy:

- siapa boleh memanggil,
- transaction apa yang aktif,
- context apa yang aktif,
- dependency mana yang digunakan,
- retry/fallback apa yang dipakai,
- metric apa yang dicatat,
- audit apa yang dibuat,
- feature flag apa yang dicek,
- resource apa yang disediakan,
- exception apa yang menyebabkan rollback.

Contoh regulatory workflow:

```java
@Audited(action = "APPROVE_CASE")
@RolesAllowed("SENIOR_OFFICER")
@Transactional
@FeatureGate("case.approval.v2")
public ApprovalResult approve(CaseId caseId) {
    // business logic
}
```

Secara source code, ini satu method.

Secara runtime, ini policy boundary.

```text
approve(caseId)
  -> feature enabled?
  -> caller has role?
  -> transaction begin
  -> audit attempt
  -> business method
  -> audit success/failure
  -> commit/rollback
  -> metrics/tracing
```

Jika object dibuat manual atau method dipanggil self-invocation, policy bisa terlewati.

Itulah kenapa ownership object penting secara compliance.

---

## 24. Container as Graph Builder

DI container membangun graph.

Contoh:

```java
@ApplicationScoped
class CaseSubmissionUseCase {
    @Inject CaseRepository repository;
    @Inject EligibilityPolicy eligibilityPolicy;
    @Inject NotificationGateway notificationGateway;
}

@ApplicationScoped
class OracleCaseRepository implements CaseRepository {
    @Inject DataSource dataSource;
}

@ApplicationScoped
class DefaultEligibilityPolicy implements EligibilityPolicy {
    @Inject Clock clock;
    @Inject FeatureFlagService flags;
}
```

Graph:

```text
CaseSubmissionUseCase
  |
  +-- CaseRepository -> OracleCaseRepository
  |      |
  |      +-- DataSource
  |
  +-- EligibilityPolicy -> DefaultEligibilityPolicy
  |      |
  |      +-- Clock
  |      +-- FeatureFlagService
  |
  +-- NotificationGateway
```

Container harus memutuskan:

- implementation mana untuk interface,
- scope setiap node,
- apakah perlu proxy,
- apakah ada cycle,
- apakah ada ambiguity,
- apakah semua dependency tersedia.

Top engineer memvisualisasikan dependency injection sebagai graph, bukan sekadar annotation.

### 24.1 Graph Smells

Beberapa smell:

1. service terlalu banyak dependency,
2. cyclic dependency,
3. infrastructure dependency bocor ke domain,
4. config dibaca di mana-mana,
5. terlalu banyak optional dependency,
6. dynamic lookup tanpa observability,
7. qualifier terlalu banyak tanpa pattern,
8. singleton menyimpan request-scoped actual object,
9. runtime selection disembunyikan di producer besar.

---

## 25. Container as Lifecycle Manager

Lifecycle bukan hanya create/destroy. Lifecycle mencakup state transitions.

Contoh application startup:

```text
Undeployed
  -> Deploying
  -> Validating
  -> Starting
  -> Ready
  -> Serving
  -> Draining
  -> Stopping
  -> Undeployed
```

Bean lifecycle berbeda:

```text
Discovered
  -> Registered
  -> Resolvable
  -> Proxy available
  -> Contextual instance created
  -> Initialized
  -> In use
  -> Destroyed
```

HTTP request lifecycle:

```text
Request arrives
  -> request context activated
  -> filters/interceptors
  -> resource method
  -> response built
  -> request context destroyed
```

Transaction lifecycle:

```text
No transaction
  -> begin/join
  -> work
  -> mark rollback-only? 
  -> commit or rollback
  -> cleanup
```

A bug often occurs when engineers mix lifecycle boundaries incorrectly.

Contoh:

- menyimpan request object di application-scoped singleton,
- membuka resource di request tetapi menutup di shutdown,
- membuat thread manual yang tetap hidup setelah undeploy,
- menganggap transaction masih aktif setelah async boundary,
- mengakses session scoped bean setelah session expired.

---

## 26. Container as Integration Layer

Container menyatukan banyak subsystem.

```text
Business method call
  |
  +-- CDI resolution
  +-- Interceptor chain
  +-- Transaction manager
  +-- Security context
  +-- Persistence context
  +-- Resource pool
  +-- Config provider
  +-- Metrics/tracing
```

Ini sebabnya error sering tampak “aneh”.

Misal masalah database pool bisa muncul sebagai:

- request timeout,
- transaction rollback,
- CDI producer failure,
- JAX-RS 500,
- startup deployment failed,
- health check down.

Top engineer tidak hanya melihat exception paling atas. Mereka mencari subsystem mana yang gagal dan pada fase apa.

---

## 27. Traditional Application Server vs Embedded Runtime vs Build-Time Runtime

### 27.1 Traditional Application Server

```text
Install server once
  -> deploy many applications
  -> server provides APIs/resources/services
```

Ciri:

- WAR/EAR deployment,
- shared server modules,
- admin console/CLI,
- JNDI/resource binding,
- server-managed pool,
- multiple apps per server possible,
- provided dependencies penting.

Kelebihan:

- strong enterprise services,
- mature management,
- standard deployment model,
- cocok legacy enterprise.

Risiko:

- classloader complex,
- server/app dependency mismatch,
- heavier runtime,
- operational coupling.

### 27.2 Embedded Runtime / Executable App

```text
Application includes runtime
  -> java -jar app.jar
```

Ciri:

- app membawa sebagian besar dependency,
- runtime per service,
- cocok container/Kubernetes,
- less shared server state,
- configuration via env/config files.

Kelebihan:

- deployment lebih repeatable,
- isolation lebih baik,
- cocok CI/CD modern.

Risiko:

- artifact besar,
- dependency management responsibility pindah ke app,
- perlu handle operational features sendiri.

### 27.3 Build-Time Optimized Runtime

```text
Build step analyzes app
  -> generates metadata
  -> runtime starts faster
```

Ciri:

- banyak keputusan DI/scanning dibuat saat build,
- reflection dikurangi,
- startup cepat,
- native image possible,
- beberapa dynamic pattern dibatasi.

Kelebihan:

- startup/memory bagus,
- cloud-native friendly.

Risiko:

- runtime dynamic extension lebih terbatas,
- build-time vs runtime config harus jelas,
- behavior bisa berbeda dari full CDI runtime.

---

## 28. Java 8 sampai Java 25: Perubahan Cara Berpikir Runtime

### 28.1 Java 8 Era

Banyak Java EE 7/8 system berjalan di Java 8.

Ciri umum:

- `javax.*`,
- WAR/EAR,
- app server heavy,
- EJB masih banyak,
- reflection bebas,
- no JPMS,
- container-managed everything.

### 28.2 Java 9–11 Era

Java module system muncul, tetapi banyak enterprise app masih classpath-based.

Dampak:

- reflective access warning,
- illegal access issue,
- dependency hygiene makin penting,
- Java EE ke Jakarta transition mulai relevan.

### 28.3 Java 17 Era

Java 17 menjadi baseline penting untuk Jakarta EE 11 dan banyak modern enterprise runtime.

Dampak:

- LTS modern baseline,
- stronger encapsulation,
- old libraries mulai bermasalah,
- namespace Jakarta makin matang,
- migration dari Java 8 sering harus melewati 11/17.

### 28.4 Java 21 Era

Java 21 membawa virtual threads sebagai fitur final.

Dampak ke container:

- thread model berubah,
- blocking I/O lebih murah secara thread,
- context propagation tetap harus dipikirkan,
- ThreadLocal assumptions perlu audit,
- managed executor tetap relevan.

### 28.5 Java 25 Era

Java 25 sebagai modern LTS-era berikutnya memperkuat kebutuhan dependency/runtime hygiene.

Untuk enterprise Java:

- runtime harus support Java version,
- bytecode compatibility penting,
- old server/provider bisa tidak kompatibel,
- reflection/module access makin penting,
- build/deploy pipeline harus jelas.

Prinsip lintas versi:

> Semakin modern Java-nya, semakin kecil toleransi terhadap dependency lama, reflective hack, dan runtime ambiguity.

---

## 29. Common Failure Model: Petakan Error ke Fase

Top engineer tidak mulai dari “coba-coba annotation”. Mereka memetakan error ke fase.

| Gejala | Kemungkinan fase | Akar masalah umum |
|---|---|---|
| `ClassNotFoundException` saat deploy | loading/scanning | dependency tidak masuk artifact, scope salah, server module missing |
| `NoSuchMethodError` | linkage/runtime call | API/implementation version mismatch |
| `UnsatisfiedDependencyException` | CDI validation | bean tidak discoverable, qualifier salah, mixed namespace |
| `AmbiguousResolutionException` | CDI validation | terlalu banyak implementation tanpa qualifier |
| `UnproxyableResolutionException` | proxy validation | final class, final method, no suitable constructor |
| `ContextNotActiveException` | invocation/context | request/session scope dipakai di luar context aktif |
| `NullPointerException` pada injected field | unmanaged instance | object dibuat manual dengan `new` |
| `@Transactional` tidak jalan | invocation/proxy | self-invocation atau unmanaged object |
| `NameNotFoundException` | resource binding | JNDI name salah/resource belum bound |
| request pertama lambat | lazy initialization | bean/resource dibuat saat first use |
| shutdown hang | destruction | unmanaged thread/resource leak |
| memory leak after redeploy | classloader/lifecycle | static reference/thread tidak berhenti |

---

## 30. Case Study 1: `@Inject` Null

### 30.1 Problem

```java
@Path("/cases")
public class CaseResource {
    @POST
    public Response submit(CaseRequest request) {
        CaseSubmissionService service = new CaseSubmissionService();
        service.submit(request);
        return Response.ok().build();
    }
}

public class CaseSubmissionService {
    @Inject
    CaseRepository repository;

    public void submit(CaseRequest request) {
        repository.save(request); // NullPointerException
    }
}
```

### 30.2 Wrong Diagnosis

“CDI injection tidak jalan.”

### 30.3 Better Diagnosis

`CaseSubmissionService` adalah unmanaged object karena dibuat dengan `new`. Container tidak pernah diberi kesempatan untuk menginjeksi `repository`.

### 30.4 Fix

```java
@Path("/cases")
@RequestScoped
public class CaseResource {
    @Inject
    CaseSubmissionService service;

    @POST
    public Response submit(CaseRequest request) {
        service.submit(request);
        return Response.ok().build();
    }
}

@ApplicationScoped
public class CaseSubmissionService {
    private final CaseRepository repository;

    @Inject
    public CaseSubmissionService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

### 30.5 Lesson

The fix is not “add more annotations”. The fix is to restore correct ownership: container must own the service.

---

## 31. Case Study 2: `@Transactional` Tidak Aktif

### 31.1 Problem

```java
@ApplicationScoped
public class CaseApprovalService {

    public void approve(CaseId id) {
        validate(id);
        persistApproval(id);
    }

    @Transactional
    void persistApproval(CaseId id) {
        // expected transaction
    }
}
```

Transaction tidak terbuka.

### 31.2 Diagnosis

Kemungkinan:

1. method dipanggil self-invocation,
2. method tidak public/interceptable tergantung spec/provider,
3. class/object tidak managed,
4. transaction interceptor tidak enabled/available,
5. annotation package salah (`javax` vs `jakarta`),
6. runtime tidak mendukung annotation tersebut.

### 31.3 Better Design

```java
@ApplicationScoped
public class CaseApprovalService {
    @Inject ApprovalPersistenceService persistence;

    public void approve(CaseId id) {
        validate(id);
        persistence.persistApproval(id);
    }
}

@ApplicationScoped
public class ApprovalPersistenceService {
    @Transactional
    public void persistApproval(CaseId id) {
        // transaction boundary through proxy
    }
}
```

### 31.4 Lesson

Transactional boundary adalah invocation boundary. Pastikan call melewati container/proxy.

---

## 32. Case Study 3: Request Context in Background Job

### 32.1 Problem

```java
@RequestScoped
public class CurrentOfficer {
    public String id() { return "..."; }
}

@ApplicationScoped
public class DailyCaseJob {
    @Inject CurrentOfficer officer;

    public void run() {
        log.info(officer.id());
    }
}
```

Error:

```text
ContextNotActiveException
```

### 32.2 Diagnosis

Background job tidak berjalan dalam HTTP request. Request context tidak aktif.

### 32.3 Fix Options

Option 1: Jangan inject request context ke job.

```java
public void run(SystemActor actor) {
    // explicit actor for system job
}
```

Option 2: Gunakan explicit execution context.

```java
public record ExecutionContext(String actorId, String correlationId) {}
```

Option 3: Aktifkan request context secara container-supported jika memang sesuai.

Option 4: Gunakan managed context propagation untuk async flow yang berasal dari request.

### 32.4 Lesson

Scope adalah lifecycle boundary. Jangan menganggap semua scope aktif di semua execution path.

---

## 33. Case Study 4: Singleton Menyimpan Request Data

### 33.1 Problem

```java
@ApplicationScoped
public class CaseCache {
    private String currentOfficerId;

    public void remember(String officerId) {
        this.currentOfficerId = officerId;
    }
}
```

Dalam concurrent request, officer ID bocor antar user.

### 33.2 Diagnosis

`@ApplicationScoped` hidup untuk seluruh aplikasi dan dipakai concurrent. Mutable request-specific state tidak boleh disimpan di sana.

### 33.3 Fix

Pisahkan state:

```java
@RequestScoped
public class CurrentOfficerContext {
    private String officerId;
}

@ApplicationScoped
public class CaseCache {
    // only application-wide thread-safe cache data
}
```

Atau jadikan data sebagai parameter:

```java
public Result evaluate(CaseRecord record, OfficerId officerId) {
}
```

### 33.4 Lesson

Scope menentukan sharing. Sharing menentukan thread-safety. Thread-safety menentukan correctness.

---

## 34. Case Study 5: Resource Lookup Fails Only in UAT

### 34.1 Problem

Local works, UAT fails:

```text
NameNotFoundException: java:comp/env/jdbc/CaseDS
```

### 34.2 Diagnosis by Runtime Phase

Fase yang gagal: resource binding, bukan business logic.

Kemungkinan:

- datasource belum dibuat di server UAT,
- JNDI name berbeda,
- deployment descriptor tidak cocok,
- resource reference tidak dimapping,
- application server profile berbeda,
- module deployment path salah.

### 34.3 Fix Principle

Jangan hard-code vendor global JNDI name di semua tempat. Buat resource boundary.

```java
@ApplicationScoped
public class DataSourceProducer {
    @Resource(lookup = "java:comp/env/jdbc/CaseDS")
    DataSource dataSource;

    @Produces
    @PrimaryDatabase
    public DataSource dataSource() {
        return dataSource;
    }
}
```

Lalu service memakai CDI qualifier:

```java
@Inject
@PrimaryDatabase
DataSource dataSource;
```

### 34.4 Lesson

Resource binding adalah deployment contract. Treat it as contract, not incidental config.

---

## 35. The Container Boundary Design Principle

Ketika mendesain enterprise Java application, tentukan boundary:

### 35.1 Managed Boundary

Cocok untuk:

- HTTP resource/controller,
- application service/use case,
- transaction boundary,
- repository adapter,
- external system client,
- messaging listener,
- scheduler/job,
- config provider,
- feature flag service,
- audit service,
- policy enforcement wrapper.

### 35.2 Unmanaged Boundary

Cocok untuk:

- value object,
- domain entity,
- pure domain policy,
- DTO/command/result,
- algorithm object yang dibuat eksplisit,
- immutable configuration snapshot,
- pure function/helper tanpa runtime dependency.

### 35.3 Rule of Thumb

```text
Need container service?      -> managed component
Need pure domain behavior?   -> unmanaged object
Need lifecycle/resource?     -> managed component
Need high-frequency tiny object? -> unmanaged object
Need proxy/interceptor?      -> managed component
Need deterministic unit test? -> prefer constructor/pure object where possible
```

---

## 36. Architectural Pattern: Composition Root in Managed Runtime

Dalam Java SE, composition root biasanya ada di `main()`.

```java
public static void main(String[] args) {
    var service = new Service(new Repository(...));
}
```

Dalam CDI/Jakarta runtime, composition root tersebar di metadata container:

- bean discovery,
- producers,
- qualifiers,
- alternatives,
- resource bindings,
- config sources,
- deployment descriptors.

Ini berbahaya jika tidak dikelola.

### 36.1 Make Composition Explicit

Gunakan pattern:

```text
application/
  CaseSubmissionUseCase.java
  CaseApprovalUseCase.java

infrastructure/
  OracleCaseRepository.java
  S3DocumentStore.java
  HttpNotificationGateway.java

runtime/
  DataSourceProducer.java
  ClockProducer.java
  ConfigProducer.java
  FeatureFlagProducer.java
  RuntimeQualifiers.java
```

Dengan begitu, wiring dan runtime boundary tidak tersebar acak.

### 36.2 Document Runtime Decisions

Contoh dokumentasi kecil:

```text
Runtime decisions:
- CaseRepository default implementation: OracleCaseRepository
- DataSource provided by server JNDI java:comp/env/jdbc/CaseDS
- Clock is produced as UTC system clock in production
- FeatureFlagService implementation selected by profile
- Audit interceptor applies to @Audited methods only
```

Top engineer membuat runtime behavior reviewable.

---

## 37. Anti-Patterns

### 37.1 Annotation Sprinkling

Menambahkan annotation tanpa memahami container contract.

```java
@Transactional
@RequestScoped
@ApplicationScoped // nonsense combination if accidental
public class Something {}
```

Masalah: annotation dianggap dekorasi, bukan runtime contract.

### 37.2 Manual Construction of Managed Service

```java
new PaymentService()
```

untuk service yang punya `@Inject`, `@Transactional`, atau `@PostConstruct`.

### 37.3 Static Access to Runtime Dependency

```java
public class AppContext {
    public static DataSource dataSource;
}
```

Masalah:

- lifecycle bocor,
- test sulit,
- redeploy memory leak,
- context bypass,
- thread-safety buruk.

### 37.4 God Producer

```java
@Produces
public Object produceEverything(InjectionPoint ip) {
    // giant if/else based on type/name/config
}
```

Masalah:

- service locator tersembunyi,
- runtime behavior tidak jelas,
- debugging sulit.

### 37.5 Scope Abuse

Semua dibuat `@ApplicationScoped` demi performa tanpa memikirkan state/thread-safety.

### 37.6 Request Data in Singleton

Menyimpan user/session/request-specific data dalam application singleton.

### 37.7 Hidden Runtime Selection

Implementation dipilih berdasarkan env variable di tengah business method.

```java
if (System.getenv("ENV").equals("prod")) {
    return prodClient.call();
} else {
    return mockClient.call();
}
```

Lebih baik selection berada di wiring/config boundary.

### 37.8 Treating Container Error as Random

Misal `UnsatisfiedDependencyException` diselesaikan dengan menambahkan dependency sembarangan tanpa memeriksa discovery/qualifier/classloader.

---

## 38. Practical Design Heuristics

### 38.1 Prefer Constructor Injection for Business Services

```java
@ApplicationScoped
public class CaseEscalationService {
    private final CaseRepository repository;
    private final EscalationPolicy policy;

    @Inject
    public CaseEscalationService(CaseRepository repository, EscalationPolicy policy) {
        this.repository = repository;
        this.policy = policy;
    }
}
```

Manfaat:

- dependency eksplisit,
- mudah unit test,
- object invariant jelas,
- tidak bergantung pada reflection untuk test biasa.

### 38.2 Keep Domain Pure

```java
public class EscalationPolicy {
    public EscalationDecision evaluate(CaseRecord record, Officer officer) {
        // no @Inject needed
    }
}
```

Jika policy butuh config, inject config ke factory/application service lalu bentuk policy object explicit.

### 38.3 Use Container for Boundaries

```java
@ApplicationScoped
public class EscalationUseCase {
    private final CaseRepository repository;
    private final EscalationPolicyFactory policyFactory;
}
```

### 38.4 Put Resource Creation Behind Producers

```java
@ApplicationScoped
public class RuntimeResources {
    @Produces
    public Clock clock() {
        return Clock.systemUTC();
    }
}
```

### 38.5 Fail Fast on Invalid Runtime Contract

Jika config wajib tidak ada, startup sebaiknya gagal.

```java
@PostConstruct
void validate() {
    if (baseUrl == null || baseUrl.isBlank()) {
        throw new IllegalStateException("Missing external.case-service.base-url");
    }
}
```

Tetapi jangan call external system berat tanpa timeout/retry/readiness design.

### 38.6 Expose Runtime Decisions Safely

Untuk production debugging:

- log active profile,
- log selected implementation,
- expose health/readiness,
- expose sanitized config summary,
- expose feature flag source status,
- expose dependency versions/build info.

---

## 39. Runtime Reasoning Checklist

Saat melihat class enterprise Java, tanyakan:

```text
[ ] Apakah class ini managed atau unmanaged?
[ ] Jika managed, container mana yang memilikinya?
[ ] Scope-nya apa?
[ ] Apakah ia thread-safe untuk scope tersebut?
[ ] Apakah dependency-nya diinjeksi atau dibuat manual?
[ ] Apakah method penting dipanggil lewat proxy?
[ ] Apakah interceptor/security/transaction perlu berlaku?
[ ] Apakah lifecycle callback dipakai dengan benar?
[ ] Apakah object menyimpan state yang lebih pendek dari scope-nya?
[ ] Apakah config/resource berasal dari boundary yang jelas?
[ ] Apakah ada kemungkinan context tidak aktif?
[ ] Apakah ada self-invocation untuk method ber-annotation?
[ ] Apakah deployment unit membawa dependency yang benar?
[ ] Apakah runtime server menyediakan API/resource yang diasumsikan?
```

---

## 40. Debugging Flow: From Symptom to Container Phase

Gunakan flow ini.

### 40.1 Jika Injection Null

```text
Is object managed?
  no  -> remove manual new, inject it, or create through container
  yes -> is field actually injection point?
        is class discoverable?
        is dependency resolvable?
```

### 40.2 Jika Unsatisfied Dependency

```text
Is implementation in artifact?
Is implementation discoverable as bean?
Is namespace javax/jakarta consistent?
Is qualifier matching?
Is bean disabled by profile/alternative?
Is module visible?
```

### 40.3 Jika Ambiguous Dependency

```text
List all implementations
Check qualifiers
Check @Default presence
Use custom qualifier or alternative
Avoid using @Named string as first choice
```

### 40.4 Jika Transaction Not Working

```text
Is object managed?
Is call through proxy/container?
Is method interceptable?
Is annotation package correct?
Is transaction provider available?
Is exception rollback behavior as expected?
```

### 40.5 Jika Context Not Active

```text
Which scope?
Which execution path?
HTTP request? async? scheduler? message listener?
Need context propagation or explicit parameter?
```

### 40.6 Jika Classloading Error

```text
Which class missing/conflicting?
API or implementation?
Server-provided or application-provided?
javax/jakarta mismatch?
Duplicate jar?
Wrong Java bytecode version?
```

---

## 41. Text Diagram: Complete Invocation Path

Contoh request masuk ke endpoint approval.

```text
HTTP request
  |
  v
Servlet/Web Container
  |
  | activates request context
  | applies servlet filters
  v
JAX-RS Runtime
  |
  | matches resource/method
  | converts request body
  v
Resource Proxy / CDI-managed resource
  |
  | injects CaseApprovalUseCase proxy
  v
CDI Proxy
  |
  | resolves contextual instance
  | applies interceptors
  v
Security Interceptor
  |
  | checks role/principal
  v
Transaction Interceptor
  |
  | begins/joins transaction
  v
Audit Interceptor
  |
  | records attempt/correlation
  v
CaseApprovalUseCase actual instance
  |
  | calls repository/client/domain policy
  v
Repository Adapter
  |
  | uses DataSource/persistence context
  v
Database
  |
  v
Return path
  |
  | commit/rollback
  | audit success/failure
  | metrics/tracing
  | response serialization
  | request context destroy
  v
HTTP response
```

Jika ada error, lihat di layer mana error terjadi.

---

## 42. Enterprise Regulatory Example: Enforcement Lifecycle Runtime Boundary

Misal ada workflow enforcement:

- case created,
- screening,
- officer review,
- escalation,
- approval,
- notice generation,
- audit trail,
- external agency sync.

Naive design:

```java
public class EnforcementService {
    public void approve(String caseId) {
        var repo = new OracleRepo();
        var audit = new AuditService();
        var notice = new NoticeClient();

        repo.update(caseId);
        audit.log(caseId);
        notice.send(caseId);
    }
}
```

Masalah:

- resource creation manual,
- transaction tidak jelas,
- audit consistency tidak jelas,
- test sulit,
- external client lifecycle tidak jelas,
- config tersebar,
- no security boundary,
- no feature flag boundary,
- no retry/idempotency boundary.

Managed design:

```java
@ApplicationScoped
public class EnforcementApprovalUseCase {
    private final CaseRepository repository;
    private final NoticeGateway noticeGateway;
    private final ApprovalPolicy policy;

    @Inject
    public EnforcementApprovalUseCase(
            CaseRepository repository,
            NoticeGateway noticeGateway,
            ApprovalPolicy policy
    ) {
        this.repository = repository;
        this.noticeGateway = noticeGateway;
        this.policy = policy;
    }

    @Audited(action = "ENFORCEMENT_APPROVAL")
    @Transactional
    @RolesAllowed("ENFORCEMENT_APPROVER")
    public ApprovalResult approve(ApprovalCommand command) {
        CaseRecord record = repository.get(command.caseId());
        policy.assertCanApprove(record, command.officer());
        repository.markApproved(record.id(), command.officer());
        noticeGateway.sendApprovalNotice(record.id());
        return ApprovalResult.approved(record.id());
    }
}
```

Runtime behavior:

```text
Approval request
  -> role checked
  -> transaction opened
  -> audit attempt logged
  -> repository participates in transaction
  -> notice gateway invoked according to design
  -> result returned
  -> transaction committed/rolled back
  -> audit finalized
```

Top engineer kemudian bertanya:

- Should notice sending be inside transaction?
- If notice fails, should approval rollback?
- Should audit be transactional or out-of-band?
- Should approval emit event after commit?
- Should feature flag gate new approval path?
- Should idempotency key protect duplicate submission?
- Should external sync be async?

Container model tidak menggantikan architecture thinking. Ia memberi mechanism. Engineer tetap harus menentukan boundary.

---

## 43. What Container Does Not Solve

Container bukan silver bullet.

Ia tidak otomatis memperbaiki:

- domain model buruk,
- transaction boundary salah,
- distributed consistency,
- overcoupled service,
- circular business dependency,
- config governance buruk,
- missing observability,
- poor error semantics,
- race condition pada mutable singleton,
- wrong retry policy,
- feature flag debt,
- broken deployment pipeline.

Container memberi infrastructure contract. Architecture tetap tanggung jawab engineer.

---

## 44. Mental Model Final

Ringkasnya:

```text
Class is not component.
Annotation is not behavior.
Dependency is not automatically available.
Scope is not just lifetime.
Proxy is not implementation detail only.
Transaction is not inside method body.
Security is not just an if statement.
Config is not just string lookup.
Deployment is not just copying artifact.
```

Versi positifnya:

```text
A managed component is a class registered into a runtime contract.
An annotation declares metadata interpreted by a container.
A dependency is resolved through a graph and ownership model.
A scope defines lifecycle, visibility, and sharing.
A proxy preserves contextual semantics and interceptor boundaries.
A transaction is behavior around invocation.
Security is policy enforced at a boundary.
Configuration is a runtime contract between deployment and code.
Deployment is activation of an application model inside a runtime.
```

---

## 45. Practical Exercise

Ambil satu service di aplikasi enterprise Anda dan jawab:

```text
1. Apakah service ini dibuat dengan new atau container?
2. Scope-nya apa?
3. Apakah service ini menyimpan mutable state?
4. Apakah service ini thread-safe untuk scope tersebut?
5. Dependency-nya dari mana?
6. Apakah ada dependency yang harusnya producer/resource?
7. Apakah ada method ber-annotation yang dipanggil self-invocation?
8. Apakah transaction boundary jelas?
9. Apakah audit/security/feature flag boundary jelas?
10. Apakah service ini bisa di-unit-test tanpa container?
11. Jika startup gagal, dependency mana yang paling mungkin menyebabkan failure?
12. Jika request gagal, layer mana yang paling mungkin: web, CDI, transaction, DB, external API, config?
```

Tujuan exercise ini bukan mencari “jawaban textbook”, tetapi melatih runtime reasoning.

---

## 46. Summary

Bagian ini membangun fondasi bahwa enterprise Java bukan hanya tentang class dan annotation, tetapi tentang runtime ownership.

Poin utama:

1. Annotation hanyalah metadata; container yang menjalankan contract.
2. Object bisa managed atau unmanaged.
3. `new` adalah keputusan ownership, bukan sekadar syntax.
4. Managed object punya lifecycle, scope, injection, proxy, callback, dan policy boundary.
5. Container berperan sebagai graph builder, lifecycle manager, integration layer, dan policy engine.
6. Proxy memungkinkan scope/interceptor/transaction/security bekerja secara benar.
7. Self-invocation dan unmanaged object sering menyebabkan annotation “tidak bekerja”.
8. Scope menentukan sharing dan thread-safety.
9. Debugging enterprise runtime harus memetakan error ke fase: bootstrap, loading, scanning, discovery, validation, creation, injection, invocation, context, destruction.
10. Top engineer mendesain container boundary secara sadar, bukan menabur annotation secara reaktif.

---

## 47. Status Seri

Selesai:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[x] Part 004 — Runtime / Container Model: Who Owns Your Object?
```

Belum selesai. Bagian berikutnya:

```text
Part 005 — Classloaders, Modules, and Deployment Isolation
```

Di part berikutnya kita akan masuk ke salah satu penyebab bug enterprise Java paling sulit: classloader, module boundary, duplicate class, server-provided API, WAR/EAR isolation, JPMS, reflective access, dan kenapa error seperti `ClassCastException: X cannot be cast to X` bisa terjadi walaupun nama class-nya sama.

---

## 48. Referensi Resmi dan Baseline

Referensi yang relevan untuk bagian ini:

- Jakarta EE Platform Specification 11 — container requirements, platform model, application components, deployment/runtime contracts.
- Jakarta EE Tutorial — overview of Jakarta EE components and container services.
- Jakarta Contexts and Dependency Injection 4.1 — contextual dependency injection, bean/component model, lifecycle/contextual semantics.
- Jakarta Enterprise Beans 4.0 — enterprise component model, session/message-driven beans, container-managed services.
- Jakarta Servlet 6.1 — web container model for HTTP request/response handling.
- MicroProfile Config — configuration as runtime contract in modern enterprise Java.


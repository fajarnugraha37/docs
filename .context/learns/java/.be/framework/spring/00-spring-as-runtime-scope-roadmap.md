# Part 0 — Spring as a Runtime: Peta Mental, Scope, dan Batas Seri

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `00-spring-as-runtime-scope-roadmap.md`  
> Target: Java 8 sampai Java 25, Spring Framework 5.x sampai 7.x, Spring Boot 2.x sampai 4.x  
> Status seri: **Part 0 dari 35** — seri **belum selesai**.

---

## 0. Ringkasan Eksekutif

Spring sering dipelajari dari permukaan:

```java
@RestController
@Service
@Repository
@Autowired
@Transactional
@SpringBootApplication
```

Pendekatan itu cukup untuk membuat aplikasi berjalan, tetapi tidak cukup untuk menjadi engineer yang benar-benar menguasai Spring. Pada level advanced, Spring harus dipahami sebagai **runtime application platform**: sebuah sistem yang membangun object graph, memutuskan konfigurasi aktif, mengelola lifecycle, memasang proxy, menentukan boundary transaksi, menangani request, menghubungkan infrastructure, melakukan observability, dan memberi extension point untuk membuat framework internal.

Mental model utama seri ini:

```text
Spring bukan hanya kumpulan annotation.
Spring adalah runtime yang membaca metadata, membangun model aplikasi,
memodifikasi cara object dipanggil, lalu menghubungkan aplikasi dengan dunia luar.
```

Dalam sistem besar, bug Spring yang paling mahal biasanya bukan karena engineer tidak tahu `@Service`. Bug mahal muncul dari hal seperti:

1. Bean dibuat terlalu awal.
2. Bean yang di-inject ternyata proxy, bukan target asli.
3. Method `@Transactional` tidak aktif karena self-invocation.
4. `@Async` tidak jalan karena dipanggil dari object yang sama.
5. Auto-configuration aktif karena class tertentu ada di classpath.
6. Profile salah membuat production memakai konfigurasi test.
7. Config property tertimpa oleh environment variable.
8. Transaction commit terjadi setelah event terkirim.
9. Lazy dependency menyembunyikan startup error sampai runtime.
10. Test context berbeda dari production context.
11. Security filter chain tidak matching route yang diasumsikan.
12. Cache menyimpan hasil authorization yang seharusnya tenant-specific.
13. Virtual thread dipakai tetapi bottleneck sebenarnya connection pool.
14. Migration dari `javax.*` ke `jakarta.*` merusak binary compatibility.

Seri ini akan membangun kemampuan membaca, mendesain, men-debug, dan memperluas Spring dari dalam.

---

## 1. Kenapa Seri Ini Perlu Ada

Anda sudah menyelesaikan banyak fondasi Java enterprise:

- Java language dan runtime.
- Collections, concurrency, reactive, memory, IO, networking.
- JDBC, HikariCP, JPA, Hibernate/EclipseLink, MyBatis.
- Jakarta EE, Servlet, JSON/XML/SOAP, validation, security, mail, concurrency, batch.
- Build, deployment, observability, AWS SDK, Quarkus, Jersey, Camunda.

Karena itu seri Spring ini **tidak boleh menjadi pengulangan** dari materi-materi tersebut.

Seri ini akan fokus pada pertanyaan yang lebih dalam:

```text
Bagaimana Spring mengambil keputusan?
Bagaimana Spring membangun runtime application model?
Bagaimana annotation diubah menjadi behavior?
Bagaimana proxy memengaruhi correctness?
Bagaimana auto-configuration aktif atau tidak aktif?
Bagaimana konfigurasi dipilih dari banyak sumber?
Bagaimana transaksi, security, cache, async, event, dan observability dipasang ke method call?
Bagaimana membuat aplikasi Spring yang bisa dipelihara selama bertahun-tahun?
Bagaimana membuat internal Spring platform untuk banyak tim?
```

Tujuan akhirnya bukan sekadar “bisa Spring Boot”, tetapi:

```text
Mampu memperlakukan Spring sebagai runtime engineering system,
bukan sebagai black box.
```

---

## 2. Spring Itu Apa Sebenarnya?

Spring bisa dijelaskan dengan beberapa lapisan.

### 2.1 Spring sebagai IoC Container

Pada lapisan paling dasar, Spring adalah **Inversion of Control container**.

Artinya, aplikasi tidak lagi sepenuhnya membuat dan menghubungkan object sendiri. Kita mendeskripsikan komponen, dependency, konfigurasi, dan lifecycle-nya. Spring lalu membangun object graph.

Tanpa Spring:

```java
UserRepository repository = new JdbcUserRepository(dataSource);
PasswordHasher passwordHasher = new BCryptPasswordHasher();
UserService service = new UserService(repository, passwordHasher);
UserController controller = new UserController(service);
```

Dengan Spring, kita mendeskripsikan komponen:

```java
@Service
public class UserService {
    private final UserRepository repository;
    private final PasswordHasher passwordHasher;

    public UserService(UserRepository repository, PasswordHasher passwordHasher) {
        this.repository = repository;
        this.passwordHasher = passwordHasher;
    }
}
```

Lalu Spring membuat object, memilih implementasi, mengatur dependency, menjalankan lifecycle callback, dan menyimpan bean di container.

Namun ini baru permukaan.

Spring tidak hanya membuat object. Spring juga menyimpan **metadata** tentang object tersebut:

```text
BeanDefinition
 ├─ bean name
 ├─ bean class
 ├─ scope
 ├─ constructor args
 ├─ property values
 ├─ qualifier
 ├─ primary/fallback marker
 ├─ lazy/eager marker
 ├─ init method
 ├─ destroy method
 └─ role: application/support/infrastructure
```

Di level advanced, Anda perlu memikirkan Spring bukan sebagai “object creator”, tetapi sebagai:

```text
metadata registry + dependency resolver + lifecycle engine + extension point pipeline
```

### 2.2 Spring sebagai Application Context

`BeanFactory` adalah fondasi container. `ApplicationContext` menambahkan fitur aplikasi enterprise seperti event, message source, resource loading, environment, lifecycle, dan integration dengan banyak subsystem.

Mental model:

```text
BeanFactory        = core object factory + dependency graph
ApplicationContext = BeanFactory + application-level services
```

Dalam aplikasi modern, hampir selalu yang digunakan adalah `ApplicationContext`, bukan `BeanFactory` langsung.

### 2.3 Spring sebagai Proxy Runtime

Banyak fitur Spring tidak bekerja dengan cara mengubah kode method Anda, tetapi dengan membuat **proxy** di sekitar object.

Contoh fitur berbasis proxy:

- `@Transactional`
- `@Async`
- `@Cacheable`
- method security
- retry
- sebagian observability/interception
- AOP custom

Ketika Anda menulis:

```java
@Transactional
public void approveCase(Long id) {
    // business logic
}
```

Spring tidak menyisipkan kode transaksi ke dalam method itu secara langsung dalam mode proxy default. Spring membuat proxy yang membungkus method call:

```text
caller
  → proxy.approveCase(id)
      → open transaction
      → target.approveCase(id)
      → commit/rollback
```

Konsekuensinya besar:

```java
@Service
public class CaseService {

    public void outer() {
        inner(); // self-invocation: tidak lewat proxy
    }

    @Transactional
    public void inner() {
        // transaksi mungkin tidak aktif jika dipanggil dari outer() di object yang sama
    }
}
```

Banyak bug Spring muncul karena engineer berpikir annotation bekerja “magically on method”, padahal sebenarnya bekerja “on method call through proxy”.

### 2.4 Spring sebagai Configuration Runtime

Spring membaca konfigurasi dari banyak tempat:

- command-line arguments
- environment variables
- system properties
- config files
- profile-specific config
- config import
- default properties
- test properties
- custom property sources

Spring Boot lalu mengikat property ke object, mengevaluasi condition, dan mengaktifkan auto-configuration tertentu.

Mental model:

```text
Input konfigurasi
  → Environment
  → PropertySources order
  → Binder
  → @ConfigurationProperties
  → @Conditional...
  → BeanDefinition registration
  → Bean creation
```

Jadi konfigurasi bukan “file YAML”. Konfigurasi adalah **runtime decision input**.

### 2.5 Spring sebagai Auto-Configuration Engine

Spring Boot membuat Spring terasa sederhana karena auto-configuration.

Misalnya ketika ada dependency web di classpath, Boot dapat mengaktifkan konfigurasi web. Ketika ada HikariCP dan JDBC, Boot dapat membuat `DataSource`. Ketika ada actuator, Boot dapat membuat endpoint health/metrics. Ketika ada Jackson, Boot dapat membuat JSON message converter.

Tapi auto-configuration bukan magic. Ia adalah kumpulan konfigurasi bersyarat:

```java
@AutoConfiguration
@ConditionalOnClass(DataSource.class)
@ConditionalOnMissingBean(DataSource.class)
public class DataSourceAutoConfiguration {
    // ...
}
```

Mental model:

```text
Classpath + properties + existing beans + environment + web type
    → condition evaluation
    → selected auto-configurations
    → registered bean definitions
```

Engineer advanced harus bisa menjawab:

```text
Kenapa bean ini ada?
Kenapa bean ini tidak ada?
Auto-configuration mana yang membuatnya?
Condition mana yang match?
Condition mana yang gagal?
Bagaimana override tanpa merusak behavior lain?
```

### 2.6 Spring sebagai Web Runtime

Dalam Spring MVC, request masuk ke `DispatcherServlet`. Setelah itu Spring memilih handler, mengubah path variable, binding request body, validasi, menjalankan controller, mengubah return value, mengubah exception menjadi response, dan memilih message converter.

Mental model ringkas:

```text
HTTP request
  → servlet filter chain
  → DispatcherServlet
  → HandlerMapping
  → HandlerAdapter
  → argument resolvers
  → controller method
  → return value handlers
  → message converters
  → HTTP response
```

Dalam WebFlux, model berbeda:

```text
HTTP request
  → reactive server runtime
  → DispatcherHandler
  → reactive handler mapping
  → handler adapter
  → Mono/Flux pipeline
  → reactive response writing
```

Seri ini akan membedakan MVC, WebFlux, dan virtual-thread based imperative style secara arsitektural.

### 2.7 Spring sebagai Transaction Boundary Manager

Spring transaction management bukan hanya `@Transactional`. Ia adalah integrasi antara:

- proxy/AOP
- transaction interceptor
- transaction manager
- connection/resource binding
- transaction synchronization
- exception-to-rollback decision
- propagation behavior
- integration dengan JPA/JDBC/message/batch/event

Mental model:

```text
method call through proxy
  → TransactionInterceptor
  → PlatformTransactionManager
  → bind resource to thread/context
  → execute target method
  → commit/rollback decision
  → transaction synchronization callbacks
  → cleanup
```

Kesalahan umum:

```text
@Transactional dipasang di private method
@Transactional dipanggil via self-invocation
external API call dilakukan di dalam transaksi panjang
event dikirim sebelum commit
REQUIRES_NEW dipakai sebagai patch tanpa memahami consistency
readOnly dianggap menjamin tidak ada write
```

### 2.8 Spring sebagai Integration Platform

Spring juga memberi model untuk menghubungkan aplikasi dengan:

- database
- message broker
- HTTP external service
- cache
- file system
- scheduler
- batch processing
- metrics/tracing
- security provider
- cloud environment

Namun kekuatan Spring bukan sekadar “ada library untuk semuanya”. Kekuatan Spring adalah pola konsisten:

```text
abstraction → implementation adapter → auto-configuration → lifecycle → observability → testing support
```

Contoh:

```text
Cache abstraction      → Caffeine/Redis implementation
Transaction abstraction → JDBC/JPA/JTA implementation
Messaging abstraction  → Kafka/Rabbit/JMS implementation
Metrics abstraction    → Prometheus/OTel/Datadog registry
Resource abstraction   → classpath/file/url resources
```

Ini membuat aplikasi enterprise bisa punya boundary yang stabil walaupun implementasi berubah.

---

## 3. Evolusi Spring dari Java 8 sampai Java 25

Seri ini membahas Java 8 sampai Java 25, tetapi tidak berarti semua kombinasi Spring/Java layak dipakai.

### 3.1 Era Java 8: Spring Framework 4.x/5.x dan Spring Boot 1.x/2.x

Ciri utama:

```text
Java baseline         : Java 8 umum dipakai
Namespace enterprise  : javax.*
Servlet               : Java EE / Servlet 3.x/4.x
Spring Framework      : 4.x/5.x
Spring Boot           : 1.x/2.x
Programming style     : imperative MVC, JDBC/JPA, annotation-driven config
```

Di era ini, banyak aplikasi enterprise besar dibangun dengan:

```text
Spring Boot 2.7.x
Spring Framework 5.3.x
Java 8/11/17
javax.persistence.*
javax.validation.*
javax.servlet.*
```

Kelebihannya:

- matang
- banyak library compatible
- banyak tim sudah familiar
- cocok untuk legacy enterprise

Kekurangannya:

- tertahan di namespace `javax.*`
- tidak berada di baseline modern Spring 6/7
- migration ke Jakarta butuh effort besar
- banyak library lama mulai kehilangan support aktif

### 3.2 Era Java 17: Spring Framework 6 dan Spring Boot 3

Spring Framework 6 dan Spring Boot 3 adalah titik belok besar.

Ciri utama:

```text
Java baseline         : Java 17+
Namespace enterprise  : jakarta.*
Jakarta EE            : Jakarta EE 9/10 generation
Spring Framework      : 6.x
Spring Boot           : 3.x
Programming style     : modern Boot, observability, AOT, native image support
```

Perubahan paling terasa:

```text
javax.servlet.*      → jakarta.servlet.*
javax.persistence.*  → jakarta.persistence.*
javax.validation.*   → jakarta.validation.*
javax.transaction.*  → jakarta.transaction.*
```

Ini bukan sekadar rename import. Ini berpengaruh pada:

- compiled binary compatibility
- dependency tree
- application server/container compatibility
- generated code
- reflection metadata
- annotation scanning
- test dependency
- third-party library compatibility

### 3.3 Era Java 21: Virtual Threads dan Modern Runtime

Java 21 membawa virtual threads sebagai fitur LTS yang penting.

Untuk Spring, pertanyaan utamanya bukan:

```text
Apakah virtual thread cepat?
```

Pertanyaan yang lebih tepat:

```text
Apakah aplikasi saya bottleneck di thread blocking,
atau sebenarnya bottleneck di DB connection pool, remote service latency,
transaction duration, lock contention, serialization, atau downstream capacity?
```

Virtual threads membuat blocking code lebih murah dari sisi thread management, tetapi tidak menghapus:

- database connection limit
- remote API limit
- transaction contention
- lock contention
- CPU-bound serialization
- memory pressure
- backpressure need
- rate limiting need

Seri ini akan membandingkan:

```text
Spring MVC + platform threads
Spring MVC + virtual threads
Spring WebFlux + event loop/reactive pipeline
```

### 3.4 Era Java 25: Spring Framework 7 dan Spring Boot 4

Spring Framework 7 dan Spring Boot 4 membawa generasi baru:

```text
Java baseline         : Java 17 minimum
Modern LTS target     : Java 25
Jakarta EE baseline   : Jakarta EE 11
Spring Framework      : 7.x
Spring Boot           : 4.x
```

Perubahan penting yang perlu dipahami:

- Boot 4 memodularisasi codebase menjadi jar yang lebih kecil dan lebih fokus.
- Boot 4 mempertahankan Java 17 compatibility tetapi memberikan first-class support untuk Java 25.
- Spring Framework 7 mengarah ke Jakarta EE 11 baseline.
- Ada peningkatan null-safety dengan JSpecify.
- Ada dukungan API versioning dan HTTP service client yang lebih formal di Boot 4.
- Jackson 3 menjadi bagian penting dari ekosistem modern, walaupun beberapa dukungan Jackson 2 masih ada dalam fase transisi.

Mental model migration:

```text
Java 8 / Spring 5 / Boot 2 / javax
    → Java 17 / Spring 6 / Boot 3 / jakarta
        → Java 25 / Spring 7 / Boot 4 / Jakarta EE 11 + modular Boot
```

---

## 4. Peta Komponen Ekosistem Spring

Spring bukan satu artefak. Spring adalah portofolio.

### 4.1 Spring Framework

Spring Framework adalah fondasi.

Isi utama:

```text
spring-core
spring-beans
spring-context
spring-aop
spring-expression
spring-tx
spring-jdbc
spring-orm
spring-web
spring-webmvc
spring-webflux
spring-test
```

Yang akan dipelajari secara mendalam:

- IoC container
- bean lifecycle
- annotation metadata
- environment
- AOP/proxy
- transaction abstraction
- MVC/WebFlux runtime
- validation/binding integration
- testing framework

### 4.2 Spring Boot

Spring Boot adalah opinionated application runtime di atas Spring Framework.

Boot memberi:

- auto-configuration
- starter dependencies
- embedded server model
- externalized configuration
- actuator
- production-ready conventions
- executable jar/container-friendly packaging
- test slices
- AOT/native support

Mental model:

```text
Spring Framework = mesin inti
Spring Boot      = assembler + convention engine + production runtime layer
```

Boot bukan pengganti Spring Framework. Boot memakai Spring Framework.

### 4.3 Spring Data

Spring Data bukan hanya JPA repository.

Spring Data memberi:

- repository abstraction
- query method parsing
- repository proxy
- auditing
- pagination/sorting
- repository fragments
- datastore-specific integration

Datastore yang umum:

- JPA
- JDBC
- Redis
- MongoDB
- Elasticsearch/OpenSearch
- Cassandra/Scylla-like models melalui ekosistem tertentu
- R2DBC

Dalam seri ini Spring Data dibahas dari sisi Spring abstraction dan integration, bukan mengulang ORM detail.

### 4.4 Spring Security

Spring Security adalah security framework besar di atas Spring.

Fokus seri:

- filter chain
- authentication manager/provider
- security context
- authorization manager
- method security
- OAuth2 resource server/client
- OIDC login
- JWT decoding
- authority mapping
- policy enforcement
- authorization architecture enterprise

Tidak akan mengulang teori dasar authentication/authorization yang sudah dipelajari sebelumnya, kecuali untuk mengikatnya ke Spring runtime.

### 4.5 Spring Cloud

Spring Cloud adalah kumpulan tooling untuk distributed systems.

Contoh area:

- service discovery
- config management
- gateway
- client-side load balancing
- circuit breaker integration
- distributed tracing
- OpenFeign
- Kubernetes integration

Seri ini akan menempatkan Spring Cloud sebagai **pattern toolkit**, bukan kewajiban microservices.

### 4.6 Spring Integration

Spring Integration mengimplementasikan banyak Enterprise Integration Patterns:

- channel
- router
- transformer
- splitter
- aggregator
- gateway
- service activator
- poller
- error channel

Seri ini akan menekankan kapan Spring Integration cocok dan kapan terlalu implicit untuk workflow yang seharusnya memakai BPM/orchestration engine.

### 4.7 Spring Batch

Spring Batch adalah runtime untuk job stateful dan restartable.

Konsep penting:

- JobRepository
- JobLauncher
- JobInstance
- JobExecution
- StepExecution
- ExecutionContext
- chunk processing
- retry/skip/restart
- partitioning

Kita tidak akan mengulang batch theory umum. Fokusnya: Spring Batch sebagai stateful runtime.

### 4.8 Spring Modulith

Spring Modulith membantu membangun modular monolith dengan boundary yang dapat diverifikasi.

Fokus:

- application module
- dependency verification
- published event
- module testing
- observability modulith
- migration path ke service extraction

Ini penting karena banyak organisasi terlalu cepat membuat microservices padahal modular monolith yang benar lebih defensible.

---

## 5. Mental Model Utama yang Harus Dibawa Sepanjang Seri

### 5.1 Spring Memproses Metadata Sebelum Object

Ketika aplikasi startup, Spring tidak langsung “membuat semua object biasa”. Spring lebih dulu mengumpulkan metadata.

```text
Class/annotation/config
  → metadata reading
  → BeanDefinition
  → registry
  → post-processing
  → dependency resolution
  → instantiation
  → initialization
  → proxy wrapping
  → ready bean
```

Karena itu, banyak extension point Spring bekerja bukan pada object, tetapi pada metadata.

Contoh:

- `BeanDefinitionRegistryPostProcessor` mengubah registry sebelum bean dibuat.
- `BeanFactoryPostProcessor` mengubah bean definition sebelum instantiation.
- `BeanPostProcessor` mengubah bean setelah instantiation.
- Auto-configuration mendaftarkan bean definition secara conditional.

Jika Anda ingin membuat framework internal yang kuat, Anda harus tahu Anda sedang mengintervensi fase mana.

### 5.2 Bean Tidak Selalu Sama dengan Object Asli

Dalam Spring, “bean” yang Anda pakai bisa berupa:

1. Object asli.
2. Proxy JDK dynamic proxy.
3. Proxy CGLIB subclass.
4. Object yang dibuat oleh `FactoryBean`.
5. Scoped proxy.
6. Lazy proxy.
7. AOT-generated variant.
8. Infrastructure wrapper.

Contoh:

```java
UserService userService = applicationContext.getBean(UserService.class);
```

Yang Anda dapatkan mungkin bukan instance langsung dari `UserService`, tetapi proxy yang mengontrol akses ke target.

Mental model:

```text
bean reference != selalu target object asli
```

Ini memengaruhi:

- equality
- class inspection
- annotation lookup
- method visibility
- final method/class
- internal method call
- serialization
- mocking
- testing

### 5.3 Annotation Adalah Kontrak Metadata, Bukan Sihir

Annotation seperti `@Transactional`, `@Cacheable`, `@Async`, `@PreAuthorize`, `@EventListener`, `@Scheduled`, dan `@ConfigurationProperties` hanya berarti sesuatu jika ada infrastructure yang membaca annotation tersebut.

Contoh:

```java
@Transactional
public void submit() {}
```

Annotation ini membutuhkan:

- transaction management enabled
- transaction interceptor
- transaction manager bean
- proxy creation
- method call melalui proxy

Tanpa pipeline itu, annotation hanyalah metadata.

Mental model:

```text
annotation → detected by infrastructure → converted to runtime behavior
```

Pertanyaan advanced untuk setiap annotation:

```text
Siapa yang membaca annotation ini?
Kapan dibaca?
Apakah dibaca dari class, method, interface, atau proxy target?
Behavior runtime apa yang dihasilkan?
Apakah behavior terjadi pada startup atau saat invocation?
Apa syarat agar behavior aktif?
Apa failure mode kalau syarat tidak terpenuhi?
```

### 5.4 Auto-Configuration Berbasis Kondisi

Auto-configuration tidak aktif karena Spring Boot “ingin”. Ia aktif karena condition match.

Condition umum:

```text
class ada di classpath
bean tertentu belum ada
property bernilai tertentu
aplikasi web atau non-web
resource tersedia
single candidate tersedia
profile aktif
```

Mental model:

```text
Spring Boot = condition evaluation engine
```

Saat debugging Boot, pertanyaan utamanya:

```text
Condition mana yang match?
Condition mana yang tidak match?
Bean mana yang sudah ada sehingga auto-config back off?
Dependency apa yang men-trigger auto-config?
Property apa yang mengubah keputusan?
```

### 5.5 Banyak Fitur Spring Berbasis Thread/Context

Di aplikasi imperative tradisional, banyak state Spring disimpan dalam thread-bound context:

- transaction resource
- security context
- request context
- locale context
- MDC/logging context

Contoh:

```text
Thread A handles request
  → SecurityContextHolder contains authenticated user
  → TransactionSynchronizationManager binds JDBC connection
  → RequestContextHolder binds request attributes
```

Masalah muncul saat berpindah execution model:

- `@Async`
- custom executor
- scheduler
- reactive pipeline
- virtual threads
- message listener

Pertanyaan penting:

```text
Context apa yang perlu ikut berpindah?
Apakah aman dipindahkan?
Apakah harus dibuat baru?
Apakah context thread-local masih valid di virtual thread/reactive pipeline?
```

### 5.6 Transaction Boundary Bukan Domain Boundary

Banyak aplikasi mencampur domain boundary dengan transaction boundary.

Contoh salah pikir:

```text
Satu use case = satu @Transactional selalu.
```

Kadang benar, kadang tidak.

Dalam sistem kompleks, satu use case bisa melibatkan:

- validasi awal tanpa transaksi
- lock atau version check
- transaksi singkat untuk state change
- event outbox
- external call setelah commit
- async follow-up
- compensation path

Spring menyediakan primitive, tetapi desain consistency tetap tanggung jawab engineer.

Mental model:

```text
@Transactional adalah primitive teknis.
Consistency boundary adalah keputusan arsitektural.
```

### 5.7 Test Context Adalah Aplikasi Mini

Spring test bukan sekadar unit test dengan annotation. Setiap test context adalah aplikasi kecil dengan:

- bean definitions
- auto-configurations
- environment
- profiles
- mocks
- test slices
- transaction behavior
- embedded web layer atau non-web layer

Jika test context berbeda jauh dari production context, test bisa memberi false confidence.

Mental model:

```text
Spring test harus cepat, kecil, dan representatif terhadap boundary yang diuji.
```

---

## 6. Cara Membaca Spring dari Dalam

Untuk menjadi top-tier Spring engineer, jangan hanya membaca tutorial. Baca Spring melalui empat layer.

### 6.1 Layer 1: User-Facing Annotation/API

Contoh:

```java
@Transactional
@Cacheable
@Async
@RestController
@ConfigurationProperties
```

Di layer ini Anda bertanya:

```text
Bagaimana cara memakainya?
Parameter apa yang tersedia?
Default-nya apa?
```

Ini level awal.

### 6.2 Layer 2: Infrastructure yang Membaca Annotation

Contoh:

```text
@Transactional
  → TransactionAttributeSource
  → TransactionInterceptor
  → PlatformTransactionManager
```

```text
@Cacheable
  → CacheOperationSource
  → CacheInterceptor
  → CacheManager
```

```text
@RestController
  → RequestMappingHandlerMapping
  → RequestMappingHandlerAdapter
  → HandlerMethodArgumentResolver
  → HandlerMethodReturnValueHandler
```

Di layer ini Anda bertanya:

```text
Class infrastructure mana yang membaca metadata ini?
Kapan ia aktif?
Apa syarat bean-nya dibuat?
```

### 6.3 Layer 3: Container/Lifecycle Integration

Di sini Anda bertanya:

```text
Infrastructure itu didaftarkan oleh siapa?
Auto-configuration mana yang membuatnya?
BeanPostProcessor mana yang memasang proxy?
Apakah ordering-nya penting?
Apakah bean dibuat terlalu awal?
```

Contoh:

```text
@EnableTransactionManagement
  → imports transaction management configuration
  → registers advisor/interceptor infrastructure
  → creates proxies for matching beans
```

Boot dapat mengaktifkan sebagian infrastructure secara otomatis jika condition match.

### 6.4 Layer 4: Runtime Behavior and Failure Mode

Di layer tertinggi, Anda berpikir seperti production engineer:

```text
Apa yang terjadi jika dependency hilang?
Apa yang terjadi jika property salah?
Apa yang terjadi jika transaksi rollback?
Apa yang terjadi jika event listener gagal?
Apa yang terjadi jika proxy tidak terbentuk?
Apa yang terjadi jika context berbeda di test dan production?
Apa yang terjadi saat shutdown?
Apa yang terjadi saat traffic tinggi?
```

Top 1% Spring engineer kuat di layer 2–4, bukan hanya layer 1.

---

## 7. Peta Runtime Spring Boot Startup

Salah satu skill paling penting adalah memahami startup.

Secara sederhana:

```text
main()
  → SpringApplication created
  → application type inferred: servlet/reactive/non-web
  → listeners initialized
  → environment prepared
  → config data loaded
  → ApplicationContext created
  → initializers applied
  → bean definitions loaded
  → auto-configurations imported
  → conditions evaluated
  → BeanFactoryPostProcessors executed
  → bean post processors registered
  → singleton beans instantiated
  → embedded server started if web app
  → ApplicationRunner/CommandLineRunner executed
  → application ready
```

Namun setiap langkah punya failure mode.

### 7.1 Environment Prepared

Failure mode:

```text
profile salah
property source order salah
secret tidak tersedia
config import gagal
placeholder tidak resolve
```

### 7.2 Bean Definitions Loaded

Failure mode:

```text
component tidak terscan
bean duplicate
bean override tidak diizinkan
conditional bean tidak aktif
configuration class gagal diproses
```

### 7.3 Auto-Configurations Imported

Failure mode:

```text
starter membawa auto-config tidak diinginkan
missing class membuat condition fail
existing bean membuat auto-config back off
property salah mematikan auto-config
```

### 7.4 Singleton Beans Instantiated

Failure mode:

```text
constructor dependency tidak ada
ambiguous dependency
circular dependency
@PostConstruct gagal
external connection dibuat saat startup lalu gagal
bean terlalu mahal dibuat eager
```

### 7.5 Web Server Started

Failure mode:

```text
port conflict
servlet context gagal
filter chain gagal
TLS/config server issue
management port conflict
```

### 7.6 Application Ready

Failure mode:

```text
runner gagal
warm-up gagal
scheduler mulai terlalu cepat
message listener mulai sebelum dependency siap
readiness probe terlalu cepat hijau
```

---

## 8. Peta Extension Points Spring

Spring kuat karena extension point-nya banyak. Tetapi extension point harus dipakai sesuai fase.

### 8.1 Saat Ingin Mengubah Bean Metadata

Gunakan:

```text
BeanDefinitionRegistryPostProcessor
BeanFactoryPostProcessor
ImportBeanDefinitionRegistrar
DeferredImportSelector
```

Cocok untuk:

- membuat internal starter
- register bean programmatically
- conditional infrastructure
- framework-level integration

Tidak cocok untuk:

- business logic
- runtime request processing

### 8.2 Saat Ingin Mengubah Bean Setelah Dibuat

Gunakan:

```text
BeanPostProcessor
InstantiationAwareBeanPostProcessor
SmartInstantiationAwareBeanPostProcessor
```

Cocok untuk:

- proxy creation
- annotation processing
- dependency injection customization
- lifecycle wrapping

Risiko:

- bean dibuat terlalu awal
- ordering conflict
- infrastructure cycle
- sulit dipahami tim aplikasi

### 8.3 Saat Ingin Menambahkan Behavior ke Method Call

Gunakan:

```text
AOP advisor
MethodInterceptor
Aspect
```

Cocok untuk:

- audit
- transaction
- security
- cache
- retry
- metrics

Risiko:

- self-invocation
- final method
- proxy ordering
- exception semantics berubah

### 8.4 Saat Ingin Mengubah Web Request Handling

Gunakan:

```text
Filter
HandlerInterceptor
HandlerMethodArgumentResolver
HandlerMethodReturnValueHandler
HttpMessageConverter
ControllerAdvice
WebMvcConfigurer
```

Cocok untuk:

- correlation ID
- tenant context
- authentication pre-processing
- custom request metadata
- response envelope
- error contract
- serialization rules

Risiko:

- double handling
- ordering salah
- bypass pada route tertentu
- konflik dengan Spring Security filter chain

### 8.5 Saat Ingin Mengubah Konfigurasi Boot

Gunakan:

```text
AutoConfiguration
@ConfigurationProperties
Condition
EnvironmentPostProcessor
ApplicationContextInitializer
FailureAnalyzer
```

Cocok untuk:

- internal platform starter
- custom config source
- better startup diagnostics
- reusable infrastructure defaults

Risiko:

- hidden behavior
- sulit override
- coupling antar starter
- config precedence membingungkan

---

## 9. Boundary yang Akan Dijaga Agar Tidak Mengulang Materi Lama

Seri ini sengaja membatasi diri.

### 9.1 Tidak Mengulang Java Core

Tidak akan mengulang:

- OOP dasar
- generics dasar
- reflection dasar
- concurrency dasar
- stream/collections dasar
- memory model dasar

Yang akan dibahas adalah bagaimana Spring memakai atau terdampak oleh hal-hal itu.

Contoh:

```text
Tidak: apa itu reflection?
Ya   : kapan Spring membaca metadata via reflection, kapan via ASM, dan apa dampaknya ke AOT/native?
```

### 9.2 Tidak Mengulang JPA/Hibernate Detail

Tidak akan mengulang:

- entity mapping detail
- dirty checking detail
- persistence context detail
- JPQL detail
- N+1 theory detail

Yang akan dibahas:

- Spring transaction boundary
- repository proxy
- exception translation
- transaction synchronization
- OpenEntityManagerInView risk
- testing integration
- multi-transaction-manager scenario

### 9.3 Tidak Mengulang Servlet/Jakarta Detail

Tidak akan mengulang:

- Servlet API basic
- filter basic
- session basic
- HTTP basic

Yang akan dibahas:

- `DispatcherServlet`
- handler mapping/adapter
- argument resolver
- return value handler
- message converter
- filter vs interceptor dalam Spring
- integration dengan security dan observability

### 9.4 Tidak Mengulang Security Theory

Tidak akan mengulang:

- definisi authentication
- definisi authorization
- JWT/OAuth2/OIDC dasar
- password hashing dasar

Yang akan dibahas:

- Spring Security filter chain
- AuthenticationProvider
- AuthorizationManager
- SecurityContext propagation
- method security proxy
- OAuth2 resource server/client integration
- authorization policy enforcement enterprise

### 9.5 Tidak Mengulang Observability Umum

Tidak akan mengulang:

- apa itu log/metric/trace
- Prometheus dasar
- OpenTelemetry dasar

Yang akan dibahas:

- Actuator endpoint
- HealthIndicator
- Micrometer meter registry
- Observation API
- tracing integration
- tag cardinality Spring-specific
- custom business metrics di Spring

---

## 10. Cara Berpikir Saat Menggunakan Spring di Sistem Enterprise

### 10.1 Jangan Mulai dari Annotation, Mulai dari Boundary

Annotation adalah implementasi. Boundary adalah desain.

Contoh pertanyaan desain:

```text
Di mana request boundary?
Di mana transaction boundary?
Di mana authorization boundary?
Di mana idempotency boundary?
Di mana integration boundary?
Di mana consistency boundary?
Di mana failure recovery boundary?
Di mana observability boundary?
```

Baru setelah itu pilih primitive Spring:

```text
@RequestMapping
@Transactional
@PreAuthorize
@Cacheable
@Retryable
@EventListener
@Scheduled
@ControllerAdvice
@ConfigurationProperties
```

### 10.2 Treat Auto-Configuration as Generated Architecture

Spring Boot menghasilkan banyak arsitektur runtime untuk Anda.

Misalnya aplikasi web Boot bisa otomatis punya:

- embedded Tomcat/Jetty/Undertow
- DispatcherServlet
- Jackson ObjectMapper
- validation integration
- error handling
- static resource handler
- actuator endpoints
- security default user jika security ada
- HTTP message converters
- multipart support
- metrics instrumentation

Jangan anggap ini “default kecil”. Ini adalah architecture decision yang dibuat Boot berdasarkan classpath dan config.

Top-tier engineer harus bisa mendokumentasikan:

```text
Apa yang dibuat Boot untuk service ini?
Apa yang kami override?
Apa yang sengaja kami biarkan default?
Apa risiko dari default tersebut?
```

### 10.3 Treat Classpath as Configuration

Di Spring Boot, dependency bukan hanya compile-time library. Dependency bisa mengubah runtime behavior.

Menambah dependency dapat mengaktifkan auto-configuration baru.

Contoh konseptual:

```text
Tambah spring-boot-starter-security
  → security auto-config aktif
  → semua endpoint bisa menjadi protected by default
```

```text
Tambah actuator
  → management endpoints tersedia
  → perlu exposure/security decision
```

```text
Tambah JDBC driver + Hikari
  → DataSource auto-config bisa aktif
```

Mental model:

```text
Classpath adalah input konfigurasi.
```

Karena itu dependency governance penting.

### 10.4 Treat Context as a Runtime Graph

Aplikasi Spring bukan hanya “kode”. Ia adalah graph runtime.

```text
ApplicationContext
 ├─ Environment
 ├─ BeanFactory
 ├─ BeanDefinitions
 ├─ SingletonObjects
 ├─ BeanPostProcessors
 ├─ Advisors/Interceptors
 ├─ ApplicationListeners
 ├─ Lifecycle beans
 ├─ Web infrastructure
 ├─ Data infrastructure
 ├─ Security infrastructure
 └─ Observability infrastructure
```

Saat debugging, jangan hanya baca stacktrace. Tanya:

```text
Graph runtime yang terbentuk seperti apa?
Bean mana yang ada?
Bean mana yang tidak ada?
Proxy mana yang membungkus bean?
Property mana yang aktif?
Condition mana yang match?
```

### 10.5 Treat Spring as a Policy Injection Mechanism

Spring memungkinkan platform/team lead menyuntikkan policy lintas aplikasi:

- standard error response
- logging correlation
- tenant propagation
- security defaults
- HTTP client timeout
- retry policy
- cache policy
- metrics policy
- actuator exposure policy
- object mapper policy
- validation message policy
- transaction convention

Ini bisa dilakukan lewat internal starter dan auto-configuration.

Tetapi ada bahaya:

```text
Semakin kuat platform starter,
semakin besar risiko hidden behavior.
```

Aturan sehat:

```text
Policy harus eksplisit, terdokumentasi, overrideable, observable, dan testable.
```

---

## 11. Java 8–25: Implikasi Praktis untuk Spring Engineer

### 11.1 Java 8

Fokus Spring legacy:

- Spring Framework 5.3.x / Boot 2.7.x style
- `javax.*`
- no records
- no virtual threads
- old date/time sudah ada via Java Time, tetapi banyak legacy masih campur `Date`
- reflection/proxy behavior klasik
- common enterprise app masih banyak di sini

Skill penting:

- migration planning
- deprecation cleanup
- dependency compatibility
- `javax` to `jakarta` readiness
- test coverage sebelum upgrade

### 11.2 Java 11

Fokus:

- module system sudah ada sejak Java 9, walaupun banyak Spring app masih classpath-based
- HTTP Client JDK tersedia, tetapi Spring client abstraction tetap penting
- container runtime lebih modern
- common stepping stone dari Java 8

Skill penting:

- runtime flag changes
- removed Java EE modules awareness
- dependency cleanup

### 11.3 Java 17

Fokus:

- baseline Spring Framework 6 / Boot 3
- records bisa dipakai untuk DTO/config tertentu
- sealed classes dapat membantu domain modeling tertentu
- modern GC/runtime
- Jakarta transition

Skill penting:

- Boot 2 to 3 migration
- `jakarta.*` migration
- observability model Boot 3
- AOT/native awareness

### 11.4 Java 21

Fokus:

- virtual threads
- structured concurrency masih perlu hati-hati tergantung status fitur di versi tertentu
- pattern matching makin matang
- modern LTS untuk production

Skill penting:

- virtual thread integration
- executor design
- connection pool capacity
- blocking vs non-blocking decision
- context propagation

### 11.5 Java 25

Fokus:

- LTS modern setelah Java 21
- Spring Framework 7 dan Boot 4 first-class support
- platform upgrade planning
- new baseline untuk long-term systems

Skill penting:

- Boot 4 modularization impact
- Spring 7/Jakarta EE 11 compatibility
- Jackson 3 transition awareness
- JSpecify/null-safety direction
- updated dependency ecosystem

---

## 12. Version Compatibility Mental Model

Jangan hafalkan semua versi. Hafalkan garis besar kompatibilitas.

```text
Legacy line:
Java 8/11/17
  → Spring Framework 5.3.x
  → Spring Boot 2.7.x
  → javax.*

Modern line:
Java 17+
  → Spring Framework 6.x
  → Spring Boot 3.x
  → jakarta.*

Current/future line:
Java 17 minimum, Java 25 modern LTS
  → Spring Framework 7.x
  → Spring Boot 4.x
  → Jakarta EE 11 baseline
```

Prinsip:

```text
Spring major upgrade hampir selalu berarti platform upgrade,
bukan sekadar version bump.
```

Yang harus dicek saat upgrade:

1. Java baseline.
2. Jakarta/Java EE namespace.
3. Servlet container compatibility.
4. JPA provider compatibility.
5. Validation provider compatibility.
6. Jackson major version.
7. Spring Security major version.
8. Spring Cloud release train compatibility.
9. Test library compatibility.
10. Build plugin compatibility.
11. AOT/native compatibility jika digunakan.
12. Third-party starter compatibility.
13. Internal starter compatibility.

---

## 13. Peta Seri 35 Part

Seri lengkap:

```text
00. Spring as Runtime: scope, roadmap, mental model
01. IoC Container: BeanDefinition, Registry, Factory, Context
02. Dependency Injection Resolution Algorithm
03. Bean Lifecycle and Extension Points
04. Annotation Model, Metadata, Component Scanning
05. Configuration Model: @Configuration, @Bean, Full/Lite Mode
06. Environment, PropertySources, Profiles, Config Binding
07. Spring Boot Auto-Configuration Internals
08. Application Startup, Bootstrap, Failure Analysis
09. Spring AOP, Proxy Model, Method Interception
10. Transaction Management Beyond @Transactional
11. Spring Data Integration Model
12. Spring MVC Runtime Internals
13. REST API Engineering with Spring
14. WebFlux and Reactive Spring Architecture
15. HTTP Clients: RestTemplate, RestClient, WebClient, HTTP Interface
16. Validation, Binding, Conversion, Data Boundary
17. Error Handling, Problem Details, Failure Semantics
18. Spring Security Application Architecture
19. Caching: Semantics and Consistency Risk
20. Async, Scheduling, Events, Execution Model
21. Virtual Threads, Concurrency, Spring on Java 21–25
22. Messaging with Spring: JMS, AMQP, Kafka
23. Spring Integration and Enterprise Integration Patterns
24. Spring Batch Architecture
25. Actuator, Micrometer, Observability, Runtime Operations
26. Testing Spring Applications at Scale
27. Modular Monolith with Spring Modulith
28. Multi-Tenancy, Multi-Module, Enterprise Platform Patterns
29. Native Image, AOT, Reflection, Runtime Hints
30. Performance Engineering for Spring Applications
31. Spring Cloud and Distributed System Integration
32. Spring Security Advanced Authorization and Policy Enforcement
33. Migration Engineering: Spring 5→6→7, Boot 2→3→4
34. Building Internal Spring Platform: Starters and Guardrails
35. Capstone: Production-Grade Spring System End-to-End
```

---

## 14. Skill Rubric: Dari User Spring Biasa ke Top-Tier Spring Engineer

### 14.1 Level 1 — Annotation User

Ciri:

- tahu `@RestController`, `@Service`, `@Repository`
- bisa membuat CRUD app
- bisa memakai `@Transactional`
- bisa konfigurasi `application.yml`
- bisa run Spring Boot app

Keterbatasan:

- tidak tahu kenapa bean dibuat
- tidak tahu kenapa transaksi tidak aktif
- bingung saat auto-config konflik
- test lambat semua pakai `@SpringBootTest`

### 14.2 Level 2 — Productive Spring Developer

Ciri:

- memahami DI dan constructor injection
- bisa memakai Spring Data dengan baik
- bisa membuat REST API cukup rapi
- bisa memakai validation dan exception handler
- bisa memakai actuator dasar

Keterbatasan:

- masih melihat Spring Boot sebagai magic
- belum kuat debugging condition report
- belum kuat proxy/lifecycle
- belum bisa membuat starter/internal framework

### 14.3 Level 3 — Senior Spring Engineer

Ciri:

- paham container lifecycle
- paham AOP/proxy limitation
- paham transaction propagation
- bisa debug auto-configuration
- bisa membuat custom configuration properties
- bisa membuat test slice efisien
- bisa mendesain REST error contract
- bisa mengontrol observability

### 14.4 Level 4 — Staff/Platform Spring Engineer

Ciri:

- bisa membuat internal starter
- bisa mendesain policy lintas service
- bisa mengelola migration Boot major version
- bisa mengaudit dependency/classpath behavior
- bisa mendesain multi-tenant Spring platform
- bisa mengoptimalkan startup/runtime performance
- bisa mendesain failure model async/event/transaction
- bisa menjaga backward compatibility platform

### 14.5 Level 5 — Top 1% Spring Engineer

Ciri:

- membaca Spring sebagai runtime graph
- mampu memprediksi behavior dari condition + bean graph + proxy chain
- mampu membuat extension yang terasa native bagi Spring
- mampu memilih MVC/WebFlux/virtual threads berdasarkan bottleneck nyata
- mampu mendesain transaction/event/cache/security boundary yang defensible
- mampu mengubah Spring menjadi internal platform yang mempercepat banyak tim tanpa menyembunyikan risiko
- mampu memimpin upgrade Java/Spring besar dengan risk model yang jelas
- mampu menjelaskan failure mode sebelum terjadi di production

---

## 15. Checklist Mental Saat Melihat Kode Spring

Gunakan checklist ini setiap membaca service Spring.

### 15.1 Bean and Dependency Checklist

```text
Bean ini dibuat oleh component scan, @Bean, auto-config, atau registrar?
Scope-nya singleton/prototype/request/session/custom?
Dependency-nya explicit via constructor atau implicit?
Ada ambiguity candidate?
Ada circular dependency tersembunyi?
Ada lazy dependency yang menyembunyikan error?
Bean ini diproxy atau tidak?
```

### 15.2 Configuration Checklist

```text
Property berasal dari mana?
Profile apa yang aktif?
Ada default production yang berbahaya?
Ada secret di file biasa?
Ada property typo yang diam-diam diabaikan?
Ada @ConfigurationProperties tervalidasi?
```

### 15.3 Proxy Checklist

```text
Annotation ini butuh proxy?
Method dipanggil dari luar proxy atau self-invocation?
Method public atau tidak?
Class/method final?
Proxy JDK atau CGLIB?
Ada ordering antar advice?
```

### 15.4 Transaction Checklist

```text
Boundary transaksi ada di layer mana?
Propagation-nya disengaja?
Rollback rule-nya jelas?
Ada external API call dalam transaksi?
Ada event yang dikirim sebelum commit?
Ada async call dalam transaksi?
Ada multiple transaction manager?
```

### 15.5 Web/API Checklist

```text
Controller terlalu tebal?
DTO bocor ke domain atau entity bocor ke API?
Validation boundary jelas?
Error response konsisten?
Pagination/filtering contract jelas?
Idempotency dibutuhkan?
Versioning dibutuhkan?
```

### 15.6 Async/Event Checklist

```text
Executor jelas?
Thread pool bounded?
Rejection policy jelas?
Context propagation dibutuhkan?
Event sync atau async?
Event before/after commit?
Failure listener ditangani?
Scheduler punya lock/idempotency?
```

### 15.7 Observability Checklist

```text
Health/readiness benar?
Metrics cardinality aman?
Trace/correlation ID konsisten?
Log tidak bocor PII?
HTTP client/server metrics aktif?
Business metrics ada?
Actuator endpoint aman?
```

### 15.8 Test Checklist

```text
Test perlu full context atau slice cukup?
Context cache rusak karena property/profile berbeda-beda?
Mock mengganti behavior terlalu banyak?
Test transaction menyembunyikan commit behavior?
External dependency dimock, fake, atau Testcontainers?
Security tested?
Error contract tested?
```

---

## 16. Contoh Cara Berpikir: Kenapa `@Transactional` Tidak Jalan?

Developer biasa mungkin langsung berkata:

```text
Spring bug.
```

Spring engineer advanced akan membuat decision tree:

```text
1. Apakah transaction management aktif?
2. Apakah ada PlatformTransactionManager bean?
3. Apakah bean target dikelola Spring?
4. Apakah method dipanggil melalui proxy?
5. Apakah method public dalam mode proxy default?
6. Apakah annotation ada di method/class yang dibaca Spring?
7. Apakah proxy JDK membuat annotation di implementation tidak terdeteksi dalam skenario tertentu?
8. Apakah method final?
9. Apakah self-invocation?
10. Apakah exception yang dilempar termasuk rollback rule?
11. Apakah transaksi sebenarnya aktif tetapi database behavior disalahpahami?
12. Apakah ada transaction manager lain yang dipilih?
```

Itulah cara berpikir seri ini.

---

## 17. Contoh Cara Berpikir: Kenapa Bean Tidak Ada?

Decision tree:

```text
1. Apakah class berada dalam component scan base package?
2. Apakah annotation stereotype ada?
3. Apakah bean didaftarkan via @Bean?
4. Apakah @Profile match?
5. Apakah @Conditional match?
6. Apakah dependency class ada di classpath?
7. Apakah auto-configuration aktif?
8. Apakah existing bean membuat auto-config back off?
9. Apakah bean definition dibuat tapi gagal instantiate?
10. Apakah bean lazy sehingga belum dibuat?
11. Apakah bean ada di parent/child context yang berbeda?
12. Apakah type lookup gagal karena proxy/interface/generic?
```

---

## 18. Contoh Cara Berpikir: Kenapa Test Lambat?

Decision tree:

```text
1. Apakah semua test memakai @SpringBootTest?
2. Apakah test sebenarnya hanya butuh MVC slice?
3. Apakah context cache sering invalid karena @DirtiesContext?
4. Apakah setiap test memakai property berbeda?
5. Apakah profile test terlalu banyak variasi?
6. Apakah external container start berulang?
7. Apakah mock bean berbeda-beda sehingga context tidak reusable?
8. Apakah database migration jalan untuk semua test?
9. Apakah application runner/scheduler aktif di test?
10. Apakah lazy init bisa membantu atau justru menyembunyikan error?
```

---

## 19. Prinsip Desain Spring untuk Sistem Besar

### 19.1 Explicit at Boundaries, Conventional Inside

Gunakan convention untuk mengurangi boilerplate, tetapi boundary harus eksplisit.

```text
Internal service wiring boleh conventional.
Security boundary harus eksplisit.
Transaction boundary harus eksplisit.
External integration timeout harus eksplisit.
Error contract harus eksplisit.
Tenant boundary harus eksplisit.
```

### 19.2 Prefer Constructor Injection for Application Code

Constructor injection membuat dependency mandatory terlihat jelas.

```java
@Service
public class CaseApplicationService {
    private final CaseRepository caseRepository;
    private final CasePolicy policy;
    private final DomainEventPublisher eventPublisher;

    public CaseApplicationService(
            CaseRepository caseRepository,
            CasePolicy policy,
            DomainEventPublisher eventPublisher
    ) {
        this.caseRepository = caseRepository;
        this.policy = policy;
        this.eventPublisher = eventPublisher;
    }
}
```

Keuntungan:

- dependency eksplisit
- mudah diuji tanpa Spring
- immutable reference
- gagal cepat saat dependency missing
- tidak butuh reflection field injection

### 19.3 Keep Business Logic Spring-Light

Domain logic sebaiknya tidak bergantung berat pada Spring.

Buruk:

```java
@Component
public class FineCalculator {
    @Autowired Environment env;
    @Autowired ApplicationEventPublisher publisher;
    @Transactional
    public Money calculate(...) { ... }
}
```

Lebih baik:

```java
public final class FineCalculator {
    private final FinePolicy policy;

    public FineCalculator(FinePolicy policy) {
        this.policy = policy;
    }

    public Money calculate(...) { ... }
}
```

Spring dipakai untuk wiring application service, bukan mencemari domain object dengan runtime dependency.

### 19.4 Do Not Hide Remote Calls

Remote call harus terlihat sebagai boundary.

Buruk:

```java
caseRepository.save(caseEntity);
notificationService.notifyUser(userId); // ternyata remote HTTP call tanpa timeout
```

Lebih baik:

```java
caseRepository.save(caseEntity);
outboxRepository.append(NotificationRequested.from(caseEntity));
```

Atau jika synchronous remote call memang dibutuhkan, contract harus jelas:

```text
timeout
retry
idempotency
error mapping
circuit breaker
fallback
observability
```

### 19.5 Make Defaults Safe

Dalam internal starter/platform, default harus aman:

```text
Timeout wajib ada.
Actuator sensitive endpoint tidak exposed by default.
Metrics tag cardinality dibatasi.
Security deny-by-default.
Config property tervalidasi.
Thread pool bounded.
Retry bounded.
Cache TTL eksplisit.
```

---

## 20. Anti-Pattern Spring yang Akan Sering Kita Lawan

### 20.1 Annotation-Driven Architecture Without Design

Gejala:

```java
@Service
@Transactional
@Async
@Cacheable
@Retryable
public class EverythingService { ... }
```

Masalah:

- boundary bercampur
- ordering advice tidak jelas
- failure semantics kabur
- test sulit
- behavior bergantung proxy chain

### 20.2 God Configuration

Gejala:

```java
@Configuration
public class AppConfig {
    // 100 @Bean methods for unrelated concerns
}
```

Masalah:

- coupling tinggi
- bean ordering sulit
- sulit override
- sulit test slice

### 20.3 Overusing `ApplicationContext`

Gejala:

```java
@Service
public class SomeService {
    @Autowired ApplicationContext context;

    public void execute(String type) {
        Handler handler = context.getBean(type, Handler.class);
        handler.handle();
    }
}
```

Kadang memang perlu. Tapi sering ini service locator tersembunyi.

Alternatif:

```java
public class HandlerRegistry {
    private final Map<String, Handler> handlers;

    public HandlerRegistry(List<Handler> handlers) {
        this.handlers = handlers.stream()
            .collect(toMap(Handler::type, Function.identity()));
    }
}
```

### 20.4 Full Context Test Everywhere

Gejala:

```java
@SpringBootTest
class UserMapperTest { ... }
```

Masalah:

- lambat
- brittle
- context cache rusak
- failure tidak spesifik

### 20.5 Configuration by Accident

Gejala:

```text
Dependency ditambahkan untuk satu util class,
tapi ternyata membawa auto-configuration baru.
```

Solusi:

- audit dependency
- baca condition report
- exclude auto-config bila perlu
- gunakan starter dengan sadar

### 20.6 Transaction as Blanket

Gejala:

```java
@Transactional
public void processLargeFileAndCallExternalApiAndSendEmail() { ... }
```

Masalah:

- transaksi panjang
- lock lama
- connection held too long
- rollback tidak membatalkan external side effect
- retry berbahaya

---

## 21. Peta Belajar Praktis per Part

Setiap part setelah ini akan mengikuti format:

```text
1. Masalah nyata yang ingin diselesaikan
2. Mental model utama
3. Komponen Spring yang terlibat
4. Alur runtime step-by-step
5. Contoh kode kecil
6. Contoh desain enterprise
7. Failure mode
8. Debugging checklist
9. Best practice
10. Anti-pattern
11. Latihan pemahaman
12. Ringkasan invariants
```

Tujuannya agar materi bukan sekadar referensi, tetapi membangun keluwesan.

---

## 22. Invariants Utama yang Harus Diingat

Invariants adalah aturan mental yang sering benar dan membantu debugging.

### 22.1 Container Invariants

```text
Bean harus terdaftar sebelum bisa di-resolve.
BeanDefinition bukan bean instance.
BeanPostProcessor dapat mengubah bean yang akhirnya diterima caller.
Singleton di Spring berarti singleton per ApplicationContext, bukan singleton JVM global.
```

### 22.2 Proxy Invariants

```text
Proxy hanya bekerja jika call melewati proxy.
Self-invocation melewati proxy.
Final method/class dapat membatasi proxy class-based.
JDK proxy berbasis interface.
CGLIB proxy berbasis subclass.
```

### 22.3 Configuration Invariants

```text
Property source order menentukan nilai akhir.
Profile adalah condition, bukan environment absolut.
Classpath dapat mengubah auto-configuration.
Default config production harus aman.
```

### 22.4 Transaction Invariants

```text
Transaction boundary adalah method invocation boundary melalui proxy.
Rollback default Spring umumnya untuk unchecked exception.
External side effect tidak otomatis rollback.
Connection pool tetap finite walaupun virtual thread banyak.
```

### 22.5 Web Invariants

```text
Filter berjalan sebelum DispatcherServlet.
Interceptor berada dalam Spring MVC handler pipeline.
ArgumentResolver menentukan cara parameter controller dibuat.
MessageConverter menentukan serialization/deserialization.
ControllerAdvice hanya bekerja dalam resolver pipeline yang sesuai.
```

### 22.6 Test Invariants

```text
Semakin besar context, semakin lambat test.
Context cache hanya berguna jika konfigurasi test stabil.
Mocking bean mengubah application graph.
Transactional test dapat menyembunyikan commit-time behavior.
```

---

## 23. Apa yang Harus Anda Bisa Setelah Part 0

Setelah Part 0, Anda seharusnya bisa:

1. Menjelaskan Spring sebagai runtime, bukan sekadar framework annotation.
2. Membedakan Spring Framework, Boot, Data, Security, Cloud, Integration, Batch, Modulith.
3. Menjelaskan garis evolusi Java 8/Spring 5/Boot 2 sampai Java 25/Spring 7/Boot 4.
4. Memahami bahwa annotation adalah metadata yang perlu infrastructure.
5. Memahami bahwa banyak fitur Spring berbasis proxy.
6. Memahami bahwa classpath adalah input konfigurasi di Boot.
7. Memahami bahwa `ApplicationContext` adalah runtime graph.
8. Memiliki checklist awal untuk debugging bean, config, proxy, transaction, web, async, observability, dan test.
9. Memahami batas seri agar tidak mengulang materi sebelumnya.
10. Siap masuk ke Part 1: IoC container deep dive.

---

## 24. Latihan Pemahaman

Jawab dengan reasoning, bukan hafalan.

### Latihan 1

Sebuah method `@Transactional` tidak rollback walaupun terjadi error. Sebutkan minimal 8 kemungkinan penyebab.

Petunjuk:

```text
Pikirkan proxy, exception type, transaction manager, method visibility, self-invocation, dan external side effect.
```

### Latihan 2

Sebuah bean tidak muncul di production, tetapi muncul di local. Buat decision tree debugging.

Petunjuk:

```text
Pikirkan profile, property source, condition, classpath, component scan, auto-config, dan parent-child context.
```

### Latihan 3

Sebuah test Spring lambat 30 detik padahal hanya menguji JSON serialization. Apa desain test yang lebih baik?

Petunjuk:

```text
Pikirkan test slice, ObjectMapper, context size, dan plain unit test.
```

### Latihan 4

Anda menambahkan dependency baru dan tiba-tiba semua endpoint butuh login. Apa kemungkinan penyebabnya?

Petunjuk:

```text
Pikirkan classpath sebagai configuration dan security auto-configuration.
```

### Latihan 5

Sebuah aplikasi Spring MVC ingin migrasi ke Java 21. Tim ingin langsung mengubah semua endpoint menjadi WebFlux. Apa pertanyaan arsitektural yang harus diajukan sebelum setuju?

Petunjuk:

```text
Pikirkan bottleneck, blocking dependency, team skill, DB driver, operational model, dan virtual threads.
```

---

## 25. Ringkasan Part 0

Spring harus dipahami sebagai:

```text
IoC container
+ metadata processing engine
+ lifecycle manager
+ proxy/interception runtime
+ configuration decision engine
+ web runtime
+ transaction boundary manager
+ integration platform
+ observability/testing support
+ internal platform foundation
```

Untuk menjadi sangat kuat di Spring, Anda perlu berpindah dari pertanyaan:

```text
Annotation apa yang harus saya pakai?
```

menjadi:

```text
Runtime behavior apa yang ingin saya bentuk,
dan Spring extension point mana yang paling tepat untuk membentuknya?
```

Part berikutnya akan masuk ke fondasi paling penting:

```text
Part 1 — IoC Container Deep Dive: BeanDefinition, Registry, Factory, Context
```

Di sana kita akan membongkar bagaimana Spring membangun object graph dari metadata sampai bean siap digunakan.

---

## 26. Referensi Resmi dan Bacaan Lanjutan

Referensi berikut digunakan sebagai anchor versi dan konsep. Materi utama di atas disusun sebagai penjelasan engineering, bukan sekadar salinan dokumentasi.

1. Spring Framework Reference Documentation — Core Container, AOP, Transaction, Web MVC, WebFlux, Testing.  
   https://docs.spring.io/spring-framework/reference/

2. Spring Framework Reference — Introduction to the IoC Container and Beans.  
   https://docs.spring.io/spring-framework/reference/core/beans/introduction.html

3. Spring Framework Versions Wiki.  
   https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions

4. Spring Framework 7.0 General Availability.  
   https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability

5. Spring Boot 4.0.0 Available Now.  
   https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now

6. Spring Boot 4.0 Migration Guide.  
   https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide

7. Spring Boot Reference Documentation.  
   https://docs.spring.io/spring-boot/reference/

8. Spring Boot Externalized Configuration Reference.  
   https://docs.spring.io/spring-boot/reference/features/external-config.html

9. Spring Framework Transaction Documentation.  
   https://docs.spring.io/spring-framework/reference/data-access/transaction/

10. Spring Framework Web MVC Documentation.  
    https://docs.spring.io/spring-framework/reference/web/webmvc.html

---

## 27. Status Seri

```text
Part saat ini : 0 dari 35
Status        : belum selesai
Berikutnya    : 01-ioc-container-beandefinition-beanfactory-applicationcontext.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./01-ioc-container-beandefinition-beanfactory-applicationcontext.md">Part 1 — IoC Container Deep Dive: `BeanDefinition`, `BeanFactory`, and `ApplicationContext` ➡️</a>
</div>

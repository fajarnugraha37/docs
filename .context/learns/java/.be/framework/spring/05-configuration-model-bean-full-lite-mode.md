# Part 5 — Configuration Model: `@Configuration`, `@Bean`, Lite Mode, Full Mode

Series: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
File: `05-configuration-model-bean-full-lite-mode.md`  
Status: Part 5 of 35 — **belum selesai**

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas annotation metadata dan component scanning. Sekarang kita masuk ke salah satu area Spring yang sering terlihat sederhana, tetapi sangat menentukan correctness aplikasi: **model konfigurasi Java Spring**.

Banyak developer melihat konfigurasi Spring seperti ini:

```java
@Configuration
public class AppConfig {
    @Bean
    PaymentService paymentService() {
        return new PaymentService();
    }
}
```

Lalu menganggap:

> `@Configuration` hanya class tempat menaruh `@Bean`.

Itu benar, tetapi terlalu dangkal.

Secara internal, configuration class adalah salah satu mekanisme paling penting yang mengubah **kode Java biasa** menjadi **metadata container**. Spring membaca method `@Bean`, mengubahnya menjadi `BeanDefinition`, lalu mengatur lifecycle, dependency, scope, proxying, ordering, dan conditional activation.

Part ini membahas:

1. Apa itu configuration class.
2. Apa itu `@Bean` method sebagai factory method.
3. Perbedaan **full mode** dan **lite mode**.
4. Kenapa `@Configuration` bisa di-enhance dengan CGLIB.
5. Apa efek `proxyBeanMethods = true/false`.
6. Kenapa direct Java method call bisa berbahaya.
7. Bagaimana konfigurasi Spring Boot modern banyak memakai `proxyBeanMethods = false`.
8. Kapan full mode benar-benar diperlukan.
9. Kapan lite mode lebih baik.
10. Bagaimana mendesain configuration layer untuk aplikasi besar dan internal starter.

Tujuan akhirnya bukan hanya bisa menulis konfigurasi, tetapi bisa menjawab:

> “Apakah method ini sedang membuat object baru, atau sedang mengambil bean singleton dari container?”

Itu pertanyaan kecil, tetapi sangat menentukan correctness sistem Spring.

---

## 1. Mental Model: Configuration Class Bukan Sekadar Class Biasa

Dalam Java biasa, class adalah kumpulan field dan method.

Dalam Spring, class konfigurasi adalah **input metadata** untuk container.

Perhatikan contoh:

```java
@Configuration
public class BillingConfiguration {

    @Bean
    public BillingService billingService(PaymentGateway paymentGateway) {
        return new BillingService(paymentGateway);
    }

    @Bean
    public PaymentGateway paymentGateway() {
        return new StripePaymentGateway();
    }
}
```

Dari sudut pandang Java, ini hanya class dengan dua method.

Dari sudut pandang Spring, ini berarti:

```text
BeanDefinition: billingService
  factoryBeanName = billingConfiguration
  factoryMethodName = billingService
  dependency = PaymentGateway

BeanDefinition: paymentGateway
  factoryBeanName = billingConfiguration
  factoryMethodName = paymentGateway
```

Jadi `@Bean` method bukan “method helper”. Ia adalah **factory method yang diregistrasikan ke container**.

Container tidak berpikir:

```text
Saya akan menjalankan semua method di class ini sekarang.
```

Container berpikir:

```text
Class ini mendeskripsikan beberapa bean. Untuk setiap @Bean method, saya buat BeanDefinition. Nanti saat bean diminta, saya panggil factory method sesuai lifecycle, scope, dependency, dan proxy rule.
```

Ini penting karena Spring memisahkan:

| Level | Isi |
|---|---|
| Java source | method, constructor, return object |
| Spring metadata | bean name, bean type, scope, dependency, condition |
| Runtime lifecycle | instantiate, inject, initialize, proxy, destroy |

Top-tier Spring engineer tidak melihat `@Configuration` sebagai “tempat config”, tetapi sebagai **DSL berbasis Java untuk membangun bean graph**.

---

## 2. `@Bean` Method: Factory Method yang Diatur Container

`@Bean` memberitahu Spring bahwa return value dari method tersebut harus dikelola sebagai bean.

Contoh:

```java
@Bean
public Clock clock() {
    return Clock.systemUTC();
}
```

Secara container, ini berarti:

```text
Nama bean default : clock
Tipe bean         : Clock
Factory method    : clock()
Scope default     : singleton
Lifecycle         : dikelola Spring
```

Jika bean singleton, Spring akan memastikan method factory hanya dipakai untuk membuat singleton container sekali dalam lifecycle normal bean.

Namun ada jebakan besar:

```java
@Configuration
public class TimeConfiguration {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    public ReportService reportService() {
        return new ReportService(clock());
    }
}
```

Pertanyaannya:

> Saat `reportService()` memanggil `clock()`, apakah itu memanggil Java method biasa yang membuat object baru, atau mengambil bean `clock` dari container?

Jawabannya tergantung mode konfigurasi.

Itulah inti part ini.

---

## 3. Dua Mode Besar: Full Mode dan Lite Mode

Spring mengenal dua cara memproses `@Bean` method:

```text
Full mode  : configuration class di-enhance agar inter-bean method call melewati container.
Lite mode  : @Bean method diperlakukan seperti factory method biasa; direct Java call tetap direct Java call.
```

### 3.1 Full Mode

Full mode biasanya terjadi saat class diberi:

```java
@Configuration
public class AppConfig {
    // @Bean methods
}
```

Default `@Configuration` adalah:

```java
@Configuration(proxyBeanMethods = true)
```

Dalam full mode, Spring membuat subclass runtime menggunakan CGLIB untuk mengintersep panggilan method `@Bean`.

Artinya:

```java
@Bean
public ReportService reportService() {
    return new ReportService(clock());
}
```

Panggilan `clock()` tidak diperlakukan sebagai method Java biasa. Ia dicegat oleh proxy/enhanced subclass agar mengembalikan bean `clock` dari container.

Mental model:

```text
reportService() calls clock()
        ↓
CGLIB intercepts clock()
        ↓
check bean named "clock" in BeanFactory
        ↓
return managed singleton Clock
```

### 3.2 Lite Mode

Lite mode terjadi ketika `@Bean` method berada pada class yang bukan full `@Configuration`, misalnya:

```java
@Component
public class AppComponents {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    public ReportService reportService() {
        return new ReportService(clock());
    }
}
```

Atau:

```java
@Configuration(proxyBeanMethods = false)
public class AppConfig {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    ReportService reportService() {
        return new ReportService(clock());
    }
}
```

Dalam lite mode, direct method call adalah direct method call.

```text
reportService() calls clock()
        ↓
ordinary Java method call
        ↓
new Clock object returned
        ↓
not necessarily same as managed clock bean
```

Ini bisa menghasilkan object tambahan yang tidak dikelola container sebagai bean utama.

---

## 4. Kenapa Full Mode Ada?

Full mode ada untuk menjaga invariant ini:

```text
Inter-bean method call inside @Configuration should preserve container semantics.
```

Tanpa full mode, contoh ini berbahaya:

```java
@Configuration
public class AppConfig {

    @Bean
    public ConnectionPool connectionPool() {
        return new ConnectionPool("main");
    }

    @Bean
    public UserRepository userRepository() {
        return new UserRepository(connectionPool());
    }

    @Bean
    public AuditRepository auditRepository() {
        return new AuditRepository(connectionPool());
    }
}
```

Secara niat, mungkin developer menginginkan:

```text
1 ConnectionPool singleton dipakai oleh UserRepository dan AuditRepository
```

Tanpa intercept, yang terjadi:

```text
connectionPool bean             → ConnectionPool #1
userRepository calls method     → ConnectionPool #2
auditRepository calls method    → ConnectionPool #3
```

Itu sangat buruk untuk resource seperti:

- datasource
- connection pool
- HTTP client
- scheduler
- executor
- cache manager
- message listener container
- object mapper yang dikustomisasi
- crypto provider
- tenant resolver
- metrics registry

Full mode memastikan direct call antar-`@Bean` method tetap mengambil bean yang dikelola container.

---

## 5. Bagaimana Full Mode Bekerja Secara Internal

Ketika Spring memproses full `@Configuration`, class tersebut tidak dipakai secara polos.

Spring melakukan enhancement.

Secara konseptual:

```java
@Configuration
public class AppConfig {
    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
```

Di runtime, Spring membuat subclass seperti:

```java
class AppConfig$$SpringCGLIB extends AppConfig {

    @Override
    public Clock clock() {
        return beanFactory.getBean("clock", Clock.class);
    }
}
```

Ini bukan kode persis Spring, tetapi mental model-nya benar.

Karena itu ada beberapa konsekuensi:

1. Configuration class tidak boleh final jika perlu enhanced.
2. `@Bean` method tidak boleh final jika perlu intercepted.
3. Method private tidak bisa di-override.
4. Enhancement menambah kompleksitas startup.
5. Direct constructor call ke configuration class tidak sama dengan bean configuration class yang dikelola Spring.

Inilah alasan Spring Boot auto-configuration modern sering menggunakan:

```java
@Configuration(proxyBeanMethods = false)
```

Karena banyak auto-configuration tidak membutuhkan inter-bean direct call.

---

## 6. `proxyBeanMethods = true` vs `false`

Atribut ini menentukan apakah `@Bean` method di dalam configuration class akan diproxy untuk menjaga inter-bean method call.

### 6.1 Default

```java
@Configuration
class AppConfig {
}
```

Sama dengan:

```java
@Configuration(proxyBeanMethods = true)
class AppConfig {
}
```

### 6.2 Full Mode

```java
@Configuration(proxyBeanMethods = true)
class AppConfig {

    @Bean
    A a() {
        return new A();
    }

    @Bean
    B b() {
        return new B(a());
    }
}
```

`a()` di dalam `b()` akan melewati container.

### 6.3 Lite Mode via `proxyBeanMethods = false`

```java
@Configuration(proxyBeanMethods = false)
class AppConfig {

    @Bean
    A a() {
        return new A();
    }

    @Bean
    B b() {
        return new B(a());
    }
}
```

`a()` di dalam `b()` adalah Java call biasa.

Jika ingin aman di lite mode, lakukan dependency injection lewat parameter:

```java
@Configuration(proxyBeanMethods = false)
class AppConfig {

    @Bean
    A a() {
        return new A();
    }

    @Bean
    B b(A a) {
        return new B(a);
    }
}
```

Ini pattern yang sangat penting.

Dalam lite mode, hindari:

```java
return new B(a());
```

Gunakan:

```java
return new B(a);
```

Karena parameter `A a` di-resolve oleh container, bukan oleh Java direct call.

---

## 7. Direct Method Call: Sumber Banyak Bug Tersembunyi

Lihat contoh berikut:

```java
@Configuration(proxyBeanMethods = false)
public class JsonConfiguration {

    @Bean
    public ObjectMapper objectMapper() {
        return new ObjectMapper()
                .registerModule(new JavaTimeModule());
    }

    @Bean
    public ExternalApiClient externalApiClient() {
        return new ExternalApiClient(objectMapper());
    }
}
```

Masalahnya:

```text
objectMapper bean di container ≠ objectMapper yang diberikan ke ExternalApiClient
```

Mungkin awalnya tidak terlihat karena config sama.

Tetapi nanti ada customizer:

```java
@Bean
public Jackson2ObjectMapperBuilderCustomizer customizer() {
    return builder -> builder.featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
}
```

Atau bean `ObjectMapper` di-wrap, di-instrument, di-observe, atau diatur oleh Boot.

Object yang dibuat lewat direct call bisa melewati beberapa mekanisme tersebut.

Versi aman:

```java
@Configuration(proxyBeanMethods = false)
public class JsonConfiguration {

    @Bean
    public ObjectMapper objectMapper() {
        return new ObjectMapper()
                .registerModule(new JavaTimeModule());
    }

    @Bean
    public ExternalApiClient externalApiClient(ObjectMapper objectMapper) {
        return new ExternalApiClient(objectMapper);
    }
}
```

Rule praktis:

```text
Dalam @Configuration(proxyBeanMethods = false), jangan panggil @Bean method lain untuk dependency.
Gunakan parameter method.
```

---

## 8. Full Mode vs Lite Mode: Tabel Perbandingan

| Aspek | Full Mode | Lite Mode |
|---|---|---|
| Umumnya dipakai dengan | `@Configuration(proxyBeanMethods = true)` | `@Configuration(proxyBeanMethods = false)`, `@Component` dengan `@Bean` |
| CGLIB enhancement | Ya | Tidak |
| Direct call antar `@Bean` | Diintersep oleh container | Java call biasa |
| Singleton consistency pada direct call | Dijaga | Tidak dijaga untuk direct call |
| Startup overhead | Lebih tinggi | Lebih rendah |
| Constraint class/method | Tidak final/private untuk method yang perlu proxy | Lebih bebas |
| Cocok untuk | Inter-bean method call eksplisit | Auto-config, modular config, explicit dependency parameters |
| Risiko utama | Overhead/complexity, final method problem | Duplicate unmanaged object karena direct call |

---

## 9. Parameter Injection pada `@Bean` Method

Spring mendukung dependency injection langsung pada parameter `@Bean` method.

```java
@Bean
public BillingService billingService(
        PaymentGateway paymentGateway,
        AuditPublisher auditPublisher,
        Clock clock
) {
    return new BillingService(paymentGateway, auditPublisher, clock);
}
```

Ini sangat direkomendasikan karena:

1. Dependency eksplisit.
2. Aman di full dan lite mode.
3. Mudah dibaca.
4. Tidak bergantung pada CGLIB inter-bean call.
5. Mendukung test lebih jelas.
6. Mengurangi risiko hidden object duplication.

Bandingkan:

```java
@Bean
public BillingService billingService() {
    return new BillingService(paymentGateway(), auditPublisher(), clock());
}
```

Yang kedua terlihat rapi, tetapi menyembunyikan dependency resolution.

Untuk codebase besar, parameter injection lebih defensible.

---

## 10. Kapan Memakai Full Mode?

Full mode masih berguna.

Gunakan full mode ketika:

### 10.1 Ada Inter-Bean Method Call yang Disengaja

```java
@Configuration
public class LegacyConfiguration {

    @Bean
    public SharedResource sharedResource() {
        return new SharedResource();
    }

    @Bean
    public A a() {
        return new A(sharedResource());
    }

    @Bean
    public B b() {
        return new B(sharedResource());
    }
}
```

Jika ingin mempertahankan style ini, full mode diperlukan.

Namun dalam code baru, lebih baik:

```java
@Configuration(proxyBeanMethods = false)
public class ModernConfiguration {

    @Bean
    public SharedResource sharedResource() {
        return new SharedResource();
    }

    @Bean
    public A a(SharedResource sharedResource) {
        return new A(sharedResource);
    }

    @Bean
    public B b(SharedResource sharedResource) {
        return new B(sharedResource);
    }
}
```

### 10.2 Migrasi Legacy yang Belum Aman

Jika konfigurasi lama banyak memanggil method `@Bean` langsung, jangan asal ubah ke:

```java
@Configuration(proxyBeanMethods = false)
```

Sebelum itu, audit semua direct call.

Cari pattern:

```text
@Bean method A memanggil @Bean method B
```

Jika ada, ubah ke parameter injection terlebih dahulu.

### 10.3 Configuration Class sebagai Composition DSL

Kadang konfigurasi dipakai sebagai DSL internal:

```java
@Bean
public Pipeline pipeline() {
    return new Pipeline(
        inputStage(),
        validationStage(),
        enrichmentStage(),
        outputStage()
    );
}
```

Jika method-method tersebut memang bean dan harus singleton container, full mode menjaga semantics.

Namun tetap pertimbangkan apakah ini lebih baik diekspresikan sebagai dependency parameter.

---

## 11. Kapan Memakai Lite Mode?

Lite mode sangat cocok untuk configuration modern.

Gunakan:

```java
@Configuration(proxyBeanMethods = false)
```

ketika:

1. Tidak ada direct call antar `@Bean` method.
2. Semua dependency masuk melalui parameter method.
3. Configuration class hanya mendaftarkan bean secara eksplisit.
4. Ini auto-configuration library/starter.
5. Ingin mengurangi CGLIB enhancement overhead.
6. Ingin class final-friendly secara desain, meskipun Spring tetap punya aturan lain tergantung konteks.
7. Ingin konfigurasi lebih predictable sebagai factory method biasa.

Contoh ideal:

```java
@Configuration(proxyBeanMethods = false)
public class AuditConfiguration {

    @Bean
    public AuditClock auditClock() {
        return new SystemAuditClock(Clock.systemUTC());
    }

    @Bean
    public AuditSerializer auditSerializer(ObjectMapper objectMapper) {
        return new JacksonAuditSerializer(objectMapper);
    }

    @Bean
    public AuditPublisher auditPublisher(
            AuditSerializer auditSerializer,
            AuditRepository auditRepository,
            AuditClock auditClock
    ) {
        return new DatabaseAuditPublisher(
                auditSerializer,
                auditRepository,
                auditClock
        );
    }
}
```

Ini jelas, aman, dan mudah dipindahkan.

---

## 12. Static `@Bean` Method

`@Bean` method bisa static:

```java
@Configuration(proxyBeanMethods = false)
public class InfrastructureConfiguration {

    @Bean
    public static BeanFactoryPostProcessor customBeanFactoryPostProcessor() {
        return beanFactory -> {
            // mutate bean factory metadata
        };
    }
}
```

Static `@Bean` sering dipakai untuk infrastructure bean yang harus dibuat sangat awal, terutama:

- `BeanFactoryPostProcessor`
- `BeanDefinitionRegistryPostProcessor`
- beberapa processor internal

Kenapa static penting?

Karena static `@Bean` dapat dibuat tanpa instantiate configuration class lebih awal.

Jika non-static `@Bean` menghasilkan `BeanFactoryPostProcessor`, Spring mungkin harus membuat configuration class terlalu dini. Itu bisa mengganggu dependency injection dan post-processing configuration class itu sendiri.

Rule praktis:

```text
Jika @Bean menghasilkan BeanFactoryPostProcessor atau BeanDefinitionRegistryPostProcessor, pertimbangkan static @Bean.
```

Contoh:

```java
@Bean
public static PropertySourcesPlaceholderConfigurer propertySourcesPlaceholderConfigurer() {
    return new PropertySourcesPlaceholderConfigurer();
}
```

Dalam Spring modern, banyak kebutuhan ini sudah ditangani Boot, tetapi mental model-nya tetap penting untuk framework/library internal.

---

## 13. `@Bean` Method Visibility

Dalam Spring modern, `@Bean` method tidak harus selalu public.

Contoh:

```java
@Bean
Clock clock() {
    return Clock.systemUTC();
}
```

Namun untuk full mode, karena Spring perlu melakukan method interception, visibility dan final/private semantics penting.

Rule yang aman:

```text
Untuk application configuration biasa:
- gunakan package-private/public secara konsisten
- hindari private @Bean method
- hindari final @Bean method dalam full configuration
```

Untuk `proxyBeanMethods = false`, constraint lebih ringan karena method tidak perlu diintersep oleh CGLIB.

Namun jangan menggunakan visibility sebagai mekanisme arsitektur utama. Boundary module/package lebih penting daripada sekadar private method.

---

## 14. Naming Bean dari `@Bean` Method

Default nama bean adalah nama method.

```java
@Bean
public Clock systemClock() {
    return Clock.systemUTC();
}
```

Nama bean:

```text
systemClock
```

Bisa override:

```java
@Bean("auditClock")
public Clock clock() {
    return Clock.systemUTC();
}
```

Atau multiple aliases:

```java
@Bean({"auditClock", "systemAuditClock"})
public Clock clock() {
    return Clock.systemUTC();
}
```

Untuk codebase besar, hati-hati dengan nama bean.

Bean name adalah bagian dari runtime contract untuk:

- qualifier by name
- actuator bean inspection
- conditional bean matching
- test override
- internal starter back-off
- integration framework lookup

Rule praktis:

```text
Nama @Bean method harus stabil, semantic, dan tidak terlalu generic.
```

Buruk:

```java
@Bean
Client client() { ... }
```

Lebih baik:

```java
@Bean
PaymentGatewayClient paymentGatewayClient() { ... }
```

---

## 15. `@Bean` dengan `initMethod` dan `destroyMethod`

Spring bisa memanggil lifecycle method dari bean hasil `@Bean`.

```java
@Bean(initMethod = "start", destroyMethod = "stop")
public Worker worker() {
    return new Worker();
}
```

Saat bean dibuat:

```text
instantiate → dependency injection → post processing → init method
```

Saat context shutdown:

```text
destroy method called
```

Spring juga punya inferensi destroy method tertentu. Misalnya object dengan method `close` atau `shutdown` bisa diperlakukan sebagai disposable bean dalam beberapa konteks.

Untuk resource penting, lebih eksplisit:

```java
@Bean(destroyMethod = "close")
public ExternalClient externalClient() {
    return new ExternalClient();
}
```

Namun jika object tidak boleh ditutup oleh Spring karena lifecycle dikelola tempat lain:

```java
@Bean(destroyMethod = "")
public SomeSharedResource resourceFromExternalRuntime() {
    return externalRuntime.resource();
}
```

Rule praktis:

```text
Bean yang membuka resource harus punya lifecycle close/shutdown yang jelas.
```

Resource yang sering dilupakan:

- ExecutorService
- Scheduler
- HTTP client connection pool
- Netty event loop
- file watcher
- database connection pool
- message listener container
- metrics reporter
- cache client

---

## 16. `@Bean` dan Scope

Default scope adalah singleton.

```java
@Bean
public TokenGenerator tokenGenerator() {
    return new TokenGenerator();
}
```

Sama dengan:

```java
@Bean
@Scope("singleton")
public TokenGenerator tokenGenerator() {
    return new TokenGenerator();
}
```

Prototype:

```java
@Bean
@Scope("prototype")
public JobContext jobContext() {
    return new JobContext();
}
```

Namun hati-hati:

```java
@Bean
public JobRunner jobRunner() {
    return new JobRunner(jobContext());
}

@Bean
@Scope("prototype")
public JobContext jobContext() {
    return new JobContext();
}
```

Jika full mode, call bisa melewati container dan prototype akan dibuat saat dipanggil.

Jika lite mode, call adalah direct method call.

Tapi masalah lebih besar:

```text
Singleton bean menerima prototype dependency saat singleton dibuat.
Prototype tidak otomatis berubah per penggunaan.
```

Solusi:

```java
@Bean
public JobRunner jobRunner(ObjectProvider<JobContext> jobContextProvider) {
    return new JobRunner(jobContextProvider);
}
```

Atau method injection / scoped proxy, tergantung kasus.

Rule praktis:

```text
Jangan menganggap prototype di dalam singleton otomatis fresh setiap method call.
```

---

## 17. `@Import`: Composition Mechanism

`@Import` memungkinkan satu configuration class mengimpor konfigurasi lain.

```java
@Configuration(proxyBeanMethods = false)
@Import({DataConfiguration.class, AuditConfiguration.class})
public class ApplicationConfiguration {
}
```

Ini bukan Java inheritance. Ini composition di level metadata Spring.

Spring akan memproses imported configuration sebagai bagian dari context.

Gunakan `@Import` untuk:

1. Modularisasi konfigurasi eksplisit.
2. Membuat feature module.
3. Menghindari component scanning terlalu luas.
4. Menyusun starter internal.
5. Membuat opt-in capability.

Contoh:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Import(AuditConfiguration.class)
public @interface EnableAuditTrail {
}
```

Lalu:

```java
@EnableAuditTrail
@SpringBootApplication
public class Application {
}
```

Ini pattern klasik `@Enable...`.

---

## 18. `@ImportSelector` dan Conditional Import

Untuk import yang lebih dinamis, Spring menyediakan `ImportSelector`.

```java
public class AuditImportSelector implements ImportSelector {

    @Override
    public String[] selectImports(AnnotationMetadata importingClassMetadata) {
        return new String[] {
            "com.example.audit.AuditConfiguration"
        };
    }
}
```

Dipakai:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Import(AuditImportSelector.class)
public @interface EnableAudit {
}
```

Ini membuat annotation bisa memilih configuration class berdasarkan metadata.

Lebih advanced lagi ada `DeferredImportSelector`, yang dipakai intensif oleh auto-configuration mechanism karena import ditunda sampai configuration lain diproses.

Mental model:

```text
@Import biasa              → import langsung
ImportSelector             → import berdasarkan logic
DeferredImportSelector     → import ditunda, cocok untuk auto-config style
ImportBeanDefinitionRegistrar → register BeanDefinition manual
```

---

## 19. `ImportBeanDefinitionRegistrar`: Titik Intervensi Lebih Rendah

Jika `@Bean` dan `@Import` belum cukup, Spring menyediakan registrar.

```java
public class AuditRegistrar implements ImportBeanDefinitionRegistrar {

    @Override
    public void registerBeanDefinitions(
            AnnotationMetadata importingClassMetadata,
            BeanDefinitionRegistry registry
    ) {
        RootBeanDefinition definition = new RootBeanDefinition(AuditService.class);
        registry.registerBeanDefinition("auditService", definition);
    }
}
```

Dipakai:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Import(AuditRegistrar.class)
public @interface EnableAudit {
}
```

Gunakan ini hanya saat perlu:

- registrasi bean dinamis berdasarkan annotation attribute
- generate banyak bean definition
- framework-level integration
- registrar untuk client proxy/repository/projection
- custom infrastructure model

Jangan gunakan registrar untuk kasus sederhana.

Jika bisa dengan `@Bean`, gunakan `@Bean`.

Jika bisa dengan `@Import`, gunakan `@Import`.

Registrar adalah pisau tajam.

---

## 20. Conditional Configuration

Configuration class dan bean method dapat diberi condition.

Contoh:

```java
@Configuration(proxyBeanMethods = false)
@ConditionalOnClass(name = "com.example.ExternalClient")
public class ExternalClientConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public ExternalClient externalClient() {
        return new ExternalClient();
    }
}
```

Spring Framework menyediakan `@Conditional` umum.

Spring Boot menyediakan banyak condition siap pakai:

- `@ConditionalOnClass`
- `@ConditionalOnMissingClass`
- `@ConditionalOnBean`
- `@ConditionalOnMissingBean`
- `@ConditionalOnProperty`
- `@ConditionalOnResource`
- `@ConditionalOnWebApplication`
- `@ConditionalOnNotWebApplication`
- `@ConditionalOnExpression`

Condition adalah fondasi auto-configuration.

Mental model:

```text
Configuration bukan hanya “apa yang dibuat”, tetapi “kapan sesuatu boleh dibuat”.
```

Untuk aplikasi enterprise, condition harus jelas agar tidak terjadi activation tak terduga.

Buruk:

```java
@ConditionalOnClass(SomeLibrary.class)
@Bean
SomeService someService() { ... }
```

Jika library tidak sengaja masuk classpath, bean aktif.

Lebih defensible:

```java
@ConditionalOnClass(SomeLibrary.class)
@ConditionalOnProperty(
    prefix = "app.some-service",
    name = "enabled",
    havingValue = "true"
)
@Bean
SomeService someService() { ... }
```

---

## 21. Configuration Ordering

Ordering configuration sering menjadi sumber bug.

Di Spring Boot auto-configuration, ordering bisa dikontrol dengan annotation seperti:

```java
@AutoConfigureBefore
@AutoConfigureAfter
@AutoConfigureOrder
```

Di Spring Framework core, ordering juga muncul melalui:

- `@Order`
- `Ordered`
- import ordering
- bean dependency relation
- `@DependsOn`

Namun jangan mengandalkan ordering untuk dependency jika dependency bisa dibuat eksplisit.

Buruk:

```java
@Configuration
class AConfig {
    @Bean
    A a() { ... }
}

@Configuration
class BConfig {
    @Bean
    B b() {
        // assumes A already initialized somehow
    }
}
```

Lebih baik:

```java
@Bean
B b(A a) {
    return new B(a);
}
```

Rule praktis:

```text
Dependency harus diungkap lewat dependency graph, bukan lewat harapan ordering.
```

`@DependsOn` boleh dipakai untuk lifecycle dependency yang tidak muncul di constructor.

Contoh:

```java
@Bean
@DependsOn("databaseMigrationRunner")
ApplicationRepository applicationRepository(DataSource dataSource) {
    return new ApplicationRepository(dataSource);
}
```

Namun jangan overuse. Jika semua memakai `@DependsOn`, graph menjadi procedural script, bukan dependency graph.

---

## 22. Configuration Class vs Component Class

Kadang developer menaruh `@Bean` di `@Component`:

```java
@Component
public class ClientFactory {

    @Bean
    ExternalClient externalClient() {
        return new ExternalClient();
    }
}
```

Ini valid secara Spring, tetapi masuk lite mode.

Pertanyaannya bukan “boleh atau tidak”, tetapi “apakah jelas?”

Untuk codebase besar, lebih baik pisahkan:

```java
@Configuration(proxyBeanMethods = false)
class ExternalClientConfiguration {

    @Bean
    ExternalClient externalClient() {
        return new ExternalClient();
    }
}
```

Kenapa?

1. Configuration intent lebih eksplisit.
2. Component class tidak bercampur dengan factory metadata.
3. Lebih mudah dicari.
4. Lebih mudah dites dengan `ApplicationContextRunner`.
5. Lebih cocok untuk modular starter.

Rule praktis:

```text
Gunakan @Configuration untuk bean declaration.
Gunakan @Component/@Service untuk behavior runtime.
```

---

## 23. `@SpringBootApplication` sebagai Configuration Class

`@SpringBootApplication` adalah composed annotation yang mencakup configuration capability.

Secara konseptual, ia menggabungkan:

```java
@SpringBootConfiguration
@EnableAutoConfiguration
@ComponentScan
```

`@SpringBootConfiguration` sendiri merupakan specialization dari `@Configuration`.

Artinya main application class juga configuration class.

```java
@SpringBootApplication
public class BillingApplication {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    public static void main(String[] args) {
        SpringApplication.run(BillingApplication.class, args);
    }
}
```

Ini valid.

Tetapi untuk aplikasi besar, lebih baik main class tetap minimal:

```java
@SpringBootApplication
public class BillingApplication {
    public static void main(String[] args) {
        SpringApplication.run(BillingApplication.class, args);
    }
}
```

Dan konfigurasi dipisah:

```java
@Configuration(proxyBeanMethods = false)
class TimeConfiguration {
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}
```

Rule praktis:

```text
Main application class sebaiknya bukan dumping ground untuk @Bean.
```

---

## 24. Configuration Class dan Package Structure

Spring Boot default component scan dimulai dari package main application class.

Contoh:

```text
com.example.billing
  BillingApplication.java
  config/
  api/
  application/
  domain/
  infrastructure/
```

Jika `BillingApplication` berada di `com.example.billing`, semua subpackage akan discan.

Masalah terjadi jika main class ditempatkan terlalu tinggi:

```text
com.example.Application
```

Maka scanning bisa terlalu luas.

Atau terlalu rendah:

```text
com.example.billing.web.BillingApplication
```

Maka package sibling mungkin tidak discan.

Rule praktis:

```text
Tempatkan @SpringBootApplication di root package bounded context/app.
```

Untuk module yang ingin opt-in, gunakan `@Import` atau auto-configuration, bukan bergantung pada scan kebetulan.

---

## 25. Configuration Layering untuk Aplikasi Besar

Untuk aplikasi enterprise, configuration bisa dibagi berdasarkan responsibility.

Contoh struktur:

```text
com.example.billing
  BillingApplication.java

  config/
    TimeConfiguration.java
    JsonConfiguration.java
    WebConfiguration.java
    SecurityConfiguration.java
    AsyncConfiguration.java
    ObservabilityConfiguration.java

  module/
    payment/
      PaymentModuleConfiguration.java
    invoice/
      InvoiceModuleConfiguration.java
    audit/
      AuditModuleConfiguration.java

  infrastructure/
    http/
      ExternalClientConfiguration.java
    messaging/
      MessagingConfiguration.java
    persistence/
      PersistenceConfiguration.java
```

Namun jangan membuat configuration terlalu granular tanpa alasan.

Buruk:

```text
ClockConfiguration
ObjectMapperConfiguration
StringTrimmerConfiguration
SingleBeanConfiguration
AnotherSingleBeanConfiguration
```

Lebih baik grouping semantic:

```text
TimeConfiguration
JsonConfiguration
WebBindingConfiguration
AuditConfiguration
ExternalIntegrationConfiguration
```

Rule:

```text
Configuration class harus punya cohesion.
```

Jika tidak bisa menjelaskan kalimat ini:

```text
Class ini mengonfigurasi boundary X.
```

maka class itu mungkin salah bentuk.

---

## 26. Configuration sebagai Boundary, Bukan Tempat Business Logic

Configuration harus mendeklarasikan object graph.

Ia tidak boleh menjadi tempat business logic.

Buruk:

```java
@Configuration
class PricingConfiguration {

    @Bean
    PricingService pricingService() {
        if (LocalDate.now().isAfter(LocalDate.of(2026, 1, 1))) {
            return new NewPricingService();
        }
        return new OldPricingService();
    }
}
```

Masalah:

1. Startup behavior tergantung waktu runtime.
2. Sulit dites.
3. Sulit diaudit.
4. Mengubah business policy menjadi bean selection.

Lebih baik:

```java
@Bean
PricingPolicy pricingPolicy(PricingProperties properties) {
    return new ConfigurablePricingPolicy(properties);
}
```

Business rule tetap di domain/application layer.

Configuration hanya memilih wiring berdasarkan deployment/configuration concern.

Rule:

```text
Configuration boleh berisi assembly logic, bukan business decision logic.
```

---

## 27. `@Bean` Method dengan Conditional Business Feature

Feature flag sering menggoda untuk ditaruh sebagai conditional bean.

Contoh:

```java
@Bean
@ConditionalOnProperty(prefix = "feature.new-pricing", name = "enabled", havingValue = "true")
PricingService newPricingService() { ... }

@Bean
@ConditionalOnMissingBean(PricingService.class)
PricingService oldPricingService() { ... }
```

Ini bisa valid jika feature benar-benar deployment-level capability.

Namun berbahaya jika feature harus bisa berubah per tenant, per user, per case, atau per waktu.

Jika feature bersifat runtime decision:

```text
tenant A pakai new pricing, tenant B pakai old pricing
```

maka jangan jadikan bean conditional global.

Lebih baik:

```java
@Bean
PricingService pricingService(
        OldPricingEngine oldEngine,
        NewPricingEngine newEngine,
        FeatureFlagService featureFlagService
) {
    return new RoutingPricingService(oldEngine, newEngine, featureFlagService);
}
```

Rule:

```text
Bean conditional cocok untuk deployment variability.
Runtime variability sebaiknya berada di object behavior.
```

---

## 28. Configuration dan Testability

Configuration yang baik mudah dites.

Untuk configuration biasa:

```java
class AuditConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(AuditConfiguration.class);

    @Test
    void createsAuditPublisher() {
        contextRunner.run(context -> {
            assertThat(context).hasSingleBean(AuditPublisher.class);
        });
    }
}
```

`ApplicationContextRunner` sangat berguna untuk menguji:

- conditional bean
- property activation
- back-off behavior
- missing dependency
- custom starter
- auto-configuration

Contoh testing condition:

```java
new ApplicationContextRunner()
        .withUserConfiguration(AuditConfiguration.class)
        .withPropertyValues("app.audit.enabled=true")
        .run(context -> {
            assertThat(context).hasSingleBean(AuditPublisher.class);
        });
```

Testing configuration harus menjawab:

1. Bean dibuat saat kondisi benar?
2. Bean tidak dibuat saat kondisi salah?
3. User-defined bean mengalahkan default?
4. Missing property menghasilkan failure yang jelas?
5. Multiple bean tidak menyebabkan ambiguity?
6. Lifecycle close dipanggil?

---

## 29. Back-Off Pattern

Back-off pattern adalah pattern penting dalam Spring Boot auto-configuration.

Artinya:

```text
Auto-configuration menyediakan default bean hanya jika user belum menyediakan bean sendiri.
```

Contoh:

```java
@Bean
@ConditionalOnMissingBean
AuditPublisher auditPublisher(AuditRepository auditRepository) {
    return new DatabaseAuditPublisher(auditRepository);
}
```

Jika aplikasi punya:

```java
@Bean
AuditPublisher customAuditPublisher() {
    return new KafkaAuditPublisher();
}
```

Maka auto-config tidak membuat `DatabaseAuditPublisher`.

Ini membuat starter fleksibel.

Rule untuk internal starter:

```text
Default harus mudah dioverride tanpa menyalin seluruh configuration.
```

Back-off buruk:

```java
@Bean
AuditPublisher auditPublisher() {
    return new DatabaseAuditPublisher();
}
```

Jika user ingin override, bisa terjadi duplicate bean.

Back-off lebih baik:

```java
@Bean
@ConditionalOnMissingBean(AuditPublisher.class)
AuditPublisher auditPublisher(...) { ... }
```

Namun hati-hati juga. `@ConditionalOnMissingBean` terlalu luas bisa membuat bean hilang karena ada bean lain yang tidak dimaksudkan.

Kadang lebih baik menggunakan name atau specific type.

---

## 30. Internal Starter Configuration Pattern

Misalnya organisasi ingin membuat starter audit:

```text
company-spring-boot-starter-audit
```

Struktur:

```text
company-audit-core
company-audit-spring-boot-autoconfigure
company-audit-spring-boot-starter
```

Auto-configuration:

```java
@AutoConfiguration
@ConditionalOnClass(AuditPublisher.class)
@EnableConfigurationProperties(AuditProperties.class)
public class AuditAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    AuditClock auditClock() {
        return new SystemAuditClock(Clock.systemUTC());
    }

    @Bean
    @ConditionalOnMissingBean
    AuditSerializer auditSerializer(ObjectMapper objectMapper) {
        return new JacksonAuditSerializer(objectMapper);
    }

    @Bean
    @ConditionalOnMissingBean
    AuditPublisher auditPublisher(
            AuditSerializer serializer,
            AuditSink sink,
            AuditClock clock
    ) {
        return new DefaultAuditPublisher(serializer, sink, clock);
    }
}
```

Gunakan `proxyBeanMethods = false` atau equivalent modern style karena tidak ada direct inter-bean call.

Karakteristik starter yang baik:

1. Conditional activation jelas.
2. Default dapat dioverride.
3. Properties type-safe.
4. Tidak melakukan network call saat configuration parsing.
5. Tidak membuat thread tanpa lifecycle shutdown.
6. Tidak mengambil credential langsung dari environment secara manual jika Boot punya abstraction.
7. Punya test dengan `ApplicationContextRunner`.
8. Punya failure analyzer jika config kompleks.
9. Punya dokumentasi property.
10. Tidak menyembunyikan business policy.

---

## 31. Configuration Anti-Patterns

### 31.1 Direct `@Bean` Call dalam Lite Mode

```java
@Configuration(proxyBeanMethods = false)
class BadConfig {
    @Bean A a() { return new A(); }
    @Bean B b() { return new B(a()); }
}
```

Masalah:

```text
B menerima A baru, bukan managed A bean.
```

Perbaikan:

```java
@Bean B b(A a) { return new B(a); }
```

### 31.2 Business Logic dalam Configuration

```java
@Bean
DiscountService discountService() {
    if (LocalDate.now().getDayOfWeek() == DayOfWeek.MONDAY) {
        return new MondayDiscountService();
    }
    return new DefaultDiscountService();
}
```

Configuration menjadi business policy tersembunyi.

### 31.3 Configuration Bergantung pada Bean Terlalu Awal

```java
@Bean
BeanFactoryPostProcessor processor(SomeService service) { ... }
```

`BeanFactoryPostProcessor` berjalan sebelum bean biasa siap. Ini bisa memicu early initialization.

### 31.4 Starter Tanpa Back-Off

```java
@Bean
ObjectMapper objectMapper() { return new ObjectMapper(); }
```

Ini bisa menimpa/menduplikasi konfigurasi Boot.

Lebih baik customizer:

```java
@Bean
Jackson2ObjectMapperBuilderCustomizer auditJsonCustomizer() {
    return builder -> { ... };
}
```

### 31.5 Overusing `@DependsOn`

Jika configuration membutuhkan banyak `@DependsOn`, mungkin graph dependency salah dimodelkan.

### 31.6 Global Component Scan Terlalu Luas

```java
@ComponentScan("com")
```

Ini bisa mengambil class tidak dimaksudkan.

### 31.7 Conditional Terlalu Implicit

```java
@ConditionalOnClass(SomeLibrary.class)
```

Bean aktif hanya karena dependency transitif muncul.

Tambahkan property explicit jika behavior berdampak besar.

### 31.8 Bean Name Terlalu Generic

```java
@Bean
Client client() { ... }
```

Dalam aplikasi besar, ini cepat menjadi konflik.

---

## 32. Failure Model Configuration

Configuration failure biasanya muncul dalam bentuk startup failure.

Namun root cause-nya bisa berbeda.

### 32.1 Duplicate Bean

```text
No qualifying bean of type X available: expected single matching bean but found 2
```

Penyebab:

- dua configuration mendaftarkan tipe sama
- auto-config tidak back off
- component scan terlalu luas
- test config ikut ke production scan

Mitigasi:

- `@ConditionalOnMissingBean`
- explicit qualifier
- bounded component scan
- stable bean naming
- modular configuration

### 32.2 Missing Bean

```text
Parameter 0 of method x required a bean of type Y that could not be found
```

Penyebab:

- condition tidak match
- package tidak discan
- dependency optional ternyata wajib
- profile salah
- bean name/type mismatch

Mitigasi:

- condition evaluation report
- ApplicationContextRunner tests
- explicit `@Import`
- config property validation

### 32.3 Circular Reference

```text
The dependencies of some of the beans in the application context form a cycle
```

Penyebab:

- configuration method saling memanggil
- service graph cyclic
- FactoryBean early resolution
- proxy/lifecycle callback memicu bean terlalu awal

Mitigasi:

- redesign responsibility
- event boundary
- provider/lazy hanya jika cycle lifecycle, bukan domain cycle

### 32.4 Early Bean Initialization

Penyebab:

- BeanFactoryPostProcessor non-static membutuhkan bean instance
- BeanPostProcessor dependency terlalu berat
- configuration class punya constructor dependency yang memicu bean biasa

Mitigasi:

- static infrastructure beans
- pisahkan infrastructure config
- hindari dependency berat di post processor

### 32.5 Hidden Duplicate Object

Penyebab:

- lite mode direct `@Bean` call
- manual `new` terhadap class yang harus dikelola container
- factory method dipanggil langsung dari test/util

Mitigasi:

- parameter injection
- jangan expose configuration object sebagai factory API
- gunakan context untuk mengambil bean dalam integration test

---

## 33. Design Heuristics untuk Top-Tier Spring Configuration

Gunakan heuristik ini saat review code.

### 33.1 Configuration Harus Deklaratif

Baik:

```java
@Bean
PaymentService paymentService(PaymentGateway gateway, AuditPublisher audit) {
    return new PaymentService(gateway, audit);
}
```

Buruk:

```java
@Bean
PaymentService paymentService() {
    PaymentGateway gateway = decideGatewayBasedOnComplexBusinessRule();
    return new PaymentService(gateway);
}
```

### 33.2 Dependency Harus Terlihat dari Signature

Baik:

```java
@Bean
InvoiceService invoiceService(InvoiceRepository repository, Clock clock) { ... }
```

Buruk:

```java
@Bean
InvoiceService invoiceService() {
    return new InvoiceService(invoiceRepository(), Clock.systemUTC());
}
```

### 33.3 Prefer `proxyBeanMethods = false` untuk Config Baru

Dengan syarat:

```text
tidak ada direct inter-bean @Bean method call
```

### 33.4 Full Mode Jangan Diubah Sembarangan di Legacy

Sebelum ubah ke false:

```text
Audit semua @Bean method call dalam class tersebut.
```

### 33.5 Auto-Configuration Harus Back-Off

Default internal platform harus mudah dioverride.

### 33.6 Conditional Harus Punya Intent yang Jelas

Classpath condition saja sering terlalu implicit.

### 33.7 Resource Bean Harus Punya Shutdown

Jika bean membuka resource, lifecycle harus jelas.

### 33.8 Configuration Tidak Boleh Menjadi God Class

Jika satu configuration class berisi web, persistence, security, scheduler, messaging, audit, dan integration client, itu terlalu besar.

### 33.9 Jangan Membuat Bean untuk Value Object Sederhana Tanpa Alasan

Tidak semua object harus bean.

Buruk:

```java
@Bean
Money zeroMoney() { return Money.zero("USD"); }
```

Bean adalah runtime-managed component, bukan semua object.

### 33.10 Test Configuration Contract

Terutama untuk:

- auto-config
- starter
- conditional bean
- security config
- external client config
- messaging config
- transaction manager config

---

## 34. Case Study: Salah `proxyBeanMethods = false`

### 34.1 Kode Awal

```java
@Configuration(proxyBeanMethods = false)
public class ClientConfiguration {

    @Bean
    public ObjectMapper externalObjectMapper() {
        return new ObjectMapper()
                .registerModule(new JavaTimeModule());
    }

    @Bean
    public SignatureService signatureService() {
        return new SignatureService(externalObjectMapper());
    }

    @Bean
    public ExternalClient externalClient() {
        return new ExternalClient(externalObjectMapper(), signatureService());
    }
}
```

### 34.2 Apa yang Terjadi?

Spring membuat bean:

```text
externalObjectMapper bean       → ObjectMapper #1
signatureService bean           → SignatureService(ObjectMapper #2)
externalClient bean             → ExternalClient(ObjectMapper #3, SignatureService #4)
```

Bahkan `signatureService()` yang dipanggil di `externalClient()` juga direct call.

Jadi `ExternalClient` mungkin menerima `SignatureService` yang bukan bean `signatureService` container.

### 34.3 Gejala Production

1. Metrics tidak muncul untuk `SignatureService` bean yang dipakai client.
2. Customizer ObjectMapper tidak berlaku konsisten.
3. Test yang mengambil `SignatureService` dari context berbeda dari instance yang dipakai `ExternalClient`.
4. Lifecycle callback tidak terjadi pada instance hasil direct call jika instance itu bukan bean container.
5. Debugging membingungkan karena ada beberapa object identik.

### 34.4 Perbaikan

```java
@Configuration(proxyBeanMethods = false)
public class ClientConfiguration {

    @Bean
    public ObjectMapper externalObjectMapper() {
        return new ObjectMapper()
                .registerModule(new JavaTimeModule());
    }

    @Bean
    public SignatureService signatureService(ObjectMapper externalObjectMapper) {
        return new SignatureService(externalObjectMapper);
    }

    @Bean
    public ExternalClient externalClient(
            ObjectMapper externalObjectMapper,
            SignatureService signatureService
    ) {
        return new ExternalClient(externalObjectMapper, signatureService);
    }
}
```

Namun ini punya ambiguity jika ada banyak ObjectMapper. Lebih aman:

```java
@Bean
public SignatureService signatureService(
        @Qualifier("externalObjectMapper") ObjectMapper externalObjectMapper
) {
    return new SignatureService(externalObjectMapper);
}
```

Atau gunakan dedicated type:

```java
public final class ExternalApiObjectMapper {
    private final ObjectMapper delegate;
}
```

---

## 35. Case Study: Full Mode Menyelamatkan Legacy Config

```java
@Configuration
public class LegacyBatchConfiguration {

    @Bean
    public ExecutorService batchExecutor() {
        return Executors.newFixedThreadPool(16);
    }

    @Bean
    public BatchImporter customerImporter() {
        return new BatchImporter(batchExecutor());
    }

    @Bean
    public BatchImporter invoiceImporter() {
        return new BatchImporter(batchExecutor());
    }
}
```

Karena default full mode, `batchExecutor()` di dalam method lain akan mengembalikan managed singleton.

Jika seseorang “mengoptimalkan” menjadi:

```java
@Configuration(proxyBeanMethods = false)
```

maka bisa muncul tiga executor:

```text
batchExecutor bean       → Executor #1
customerImporter         → Executor #2
invoiceImporter          → Executor #3
```

Efek production:

- thread count naik tanpa disadari
- shutdown hanya menutup executor bean, bukan executor direct-call tambahan
- memory/thread leak
- scheduler behavior tidak konsisten

Perbaikan sebelum mengubah ke lite:

```java
@Configuration(proxyBeanMethods = false)
public class BatchConfiguration {

    @Bean(destroyMethod = "shutdown")
    public ExecutorService batchExecutor() {
        return Executors.newFixedThreadPool(16);
    }

    @Bean
    public BatchImporter customerImporter(ExecutorService batchExecutor) {
        return new BatchImporter(batchExecutor);
    }

    @Bean
    public BatchImporter invoiceImporter(ExecutorService batchExecutor) {
        return new BatchImporter(batchExecutor);
    }
}
```

---

## 36. Checklist Review Configuration

Gunakan checklist ini saat code review.

### 36.1 Untuk Setiap `@Configuration`

- Apakah `proxyBeanMethods` sengaja dipilih?
- Jika `false`, apakah tidak ada direct call antar `@Bean` method?
- Jika `true`, apakah full mode memang dibutuhkan?
- Apakah class terlalu besar?
- Apakah class punya cohesion jelas?
- Apakah ada business logic yang masuk configuration?
- Apakah ada network/file/database call saat bean declaration yang tidak seharusnya?

### 36.2 Untuk Setiap `@Bean`

- Apakah nama method semantic?
- Apakah dependency terlihat di parameter?
- Apakah lifecycle resource jelas?
- Apakah scope benar?
- Apakah perlu qualifier?
- Apakah bean ini benar-benar perlu dikelola Spring?
- Apakah bean bisa dioverride jika bagian dari starter?
- Apakah bean punya condition yang tepat?

### 36.3 Untuk Starter/Internal Platform

- Apakah default bean memakai back-off?
- Apakah property type-safe?
- Apakah condition eksplisit?
- Apakah error message jelas?
- Apakah ada test untuk enabled/disabled/missing dependency/user override?
- Apakah starter tidak menyelundupkan business policy?
- Apakah starter tidak membuat global side effect diam-diam?

---

## 37. Java 8 sampai Java 25: Implikasi terhadap Configuration Model

Configuration model Spring relatif stabil lintas Java 8 sampai 25, tetapi runtime constraints berubah.

### 37.1 Java 8 Era

Umumnya:

- Spring Framework 4/5
- Spring Boot 1/2
- `javax.*`
- CGLIB enhancement umum
- reflection-heavy runtime masih normal
- tidak ada record/sealed class/virtual thread

Configuration banyak menggunakan:

```java
@Configuration
public class AppConfig { ... }
```

Tanpa explicit `proxyBeanMethods = false` pada era lama.

### 37.2 Java 11–17 Transition

Mulai banyak aplikasi berpindah ke:

- Spring Boot 2.7 sebagai bridge
- Spring Boot 3.x dengan Java 17 baseline
- Jakarta namespace
- AOT/native mulai relevan

Configuration mulai lebih sering:

```java
@Configuration(proxyBeanMethods = false)
```

Terutama di auto-configuration.

### 37.3 Java 21–25 Modern Era

Dengan Java 21/25:

- virtual threads memengaruhi executor configuration
- records sering dipakai untuk configuration properties
- native image/AOT membuat dynamic reflection/proxy perlu lebih sadar
- Boot 4 dan Framework 7 memperkuat modern baseline

Namun prinsip tetap:

```text
Configuration harus eksplisit, deterministic, testable, dan tidak menyembunyikan lifecycle.
```

### 37.4 Records untuk Properties, Bukan Semua Bean

Modern Java mendorong immutable config:

```java
@ConfigurationProperties(prefix = "app.audit")
public record AuditProperties(
        boolean enabled,
        Duration flushInterval,
        int batchSize
) {
}
```

Tetapi jangan memaksa semua Spring bean menjadi record. Banyak bean punya lifecycle, dependency, dan behavior yang tidak cocok dimodelkan sebagai record.

---

## 38. Hubungan Part Ini dengan Part Berikutnya

Part ini menjadi jembatan ke Part 6.

Kita sudah membahas:

```text
Bagaimana configuration class mendeklarasikan bean graph.
```

Part berikutnya akan membahas:

```text
Bagaimana Environment, PropertySource, Profile, dan ConfigurationProperties memberi input dinamis ke configuration graph.
```

Dengan kata lain:

```text
Part 5 : bagaimana object graph dideklarasikan
Part 6 : bagaimana runtime/deployment config memengaruhi object graph
```

Ini penting karena banyak bug Spring production terjadi saat:

```text
configuration class benar secara Java,
tetapi property/profile/environment membuat graph yang salah.
```

---

## 39. Ringkasan Inti

Jika hanya mengingat beberapa hal, ingat ini:

1. `@Bean` method adalah factory method yang diregistrasikan sebagai `BeanDefinition`.
2. `@Configuration` full mode memakai CGLIB untuk mengintersep inter-bean method call.
3. `@Configuration(proxyBeanMethods = false)` membuat `@Bean` method diproses dalam style lite mode.
4. Dalam lite mode, direct call antar `@Bean` method adalah Java call biasa dan bisa membuat object tambahan.
5. Gunakan parameter injection pada `@Bean` method untuk dependency.
6. Full mode berguna untuk legacy/inter-bean method call, tetapi jangan dipakai tanpa sadar.
7. Lite mode cocok untuk modern configuration dan auto-configuration jika dependency eksplisit.
8. Static `@Bean` penting untuk beberapa infrastructure post processor awal.
9. Configuration harus deklaratif, bukan tempat business logic.
10. Internal starter yang baik memakai condition, back-off, type-safe properties, dan test configuration contract.

---

## 40. Latihan Mandiri

### Latihan 1 — Deteksi Hidden Duplicate Object

Analisis kode ini:

```java
@Configuration(proxyBeanMethods = false)
class ReportConfiguration {

    @Bean
    ReportFormatter reportFormatter() {
        return new PdfReportFormatter();
    }

    @Bean
    ReportService reportService() {
        return new ReportService(reportFormatter());
    }
}
```

Jawab:

1. Berapa instance `ReportFormatter` yang mungkin dibuat?
2. Apakah `ReportService` memakai managed bean `reportFormatter`?
3. Bagaimana memperbaikinya?

### Latihan 2 — Migrasi Full ke Lite

Ubah konfigurasi ini agar aman memakai `proxyBeanMethods = false`:

```java
@Configuration
class MessagingConfiguration {

    @Bean
    MessageSerializer messageSerializer() {
        return new JsonMessageSerializer();
    }

    @Bean
    MessagePublisher messagePublisher() {
        return new RabbitMessagePublisher(messageSerializer());
    }

    @Bean
    MessageAuditLogger messageAuditLogger() {
        return new MessageAuditLogger(messageSerializer());
    }
}
```

### Latihan 3 — Starter Back-Off

Buat configuration default untuk `NotificationSender` yang:

1. Aktif hanya jika property `app.notification.enabled=true`.
2. Hanya membuat default sender jika user belum menyediakan `NotificationSender`.
3. Menerima dependency `ObjectMapper` dan `RestClient` dari container.

### Latihan 4 — Lifecycle Resource

Buat `@Bean` untuk `ExecutorService` yang memastikan executor ditutup saat shutdown context.

### Latihan 5 — Configuration Review

Ambil satu Spring project nyata. Cari semua class:

```text
@Configuration(proxyBeanMethods = false)
```

Lalu audit apakah ada direct call antar method `@Bean`.

---

## 41. Referensi Resmi yang Relevan

Untuk pendalaman, baca dokumentasi resmi Spring tentang:

1. Java-based container configuration.
2. Basic concepts `@Bean` dan `@Configuration`.
3. Javadoc `@Configuration`, terutama `proxyBeanMethods` dan full/lite mode.
4. Javadoc `@Bean`, terutama lite mode behavior.
5. Spring Boot auto-configuration dan conditional bean pattern.

---

## 42. Status Seri

```text
Part saat ini : 5 dari 35
Status        : belum selesai
Berikutnya    : 06-environment-propertysource-profiles-config-binding.md
```

Seri belum mencapai bagian terakhir.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./04-annotation-metadata-component-scanning-internals.md">⬅️ Part 4 — Annotation Metadata and Component Scanning Internals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./06-environment-propertysource-profiles-config-binding.md">Environment, PropertySource, Profiles, and Config Binding ➡️</a>
</div>

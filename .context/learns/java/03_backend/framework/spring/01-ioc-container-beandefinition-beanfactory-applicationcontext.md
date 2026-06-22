# Part 1 — IoC Container Deep Dive: `BeanDefinition`, `BeanFactory`, and `ApplicationContext`

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `01-ioc-container-beandefinition-beanfactory-applicationcontext.md`  
> Status seri: Part 1 dari 35 — belum selesai  
> Fokus: memahami Spring sebagai container runtime, bukan sekadar kumpulan annotation.

---

## 0. Tujuan Part Ini

Setelah Part 0, kita sudah membangun peta besar bahwa Spring bukan hanya “framework untuk bikin REST API”, tetapi sebuah **runtime yang mengelola object graph, lifecycle, konfigurasi, proxy, resource, event, dan integration boundary**.

Part ini masuk ke pusat paling dasar Spring:

```text
BeanDefinition  ->  BeanFactory  ->  ApplicationContext  ->  runtime object graph
```

Target pemahaman setelah part ini:

1. Anda memahami bahwa Spring tidak langsung bekerja dengan object, tetapi terlebih dahulu bekerja dengan **metadata object** bernama `BeanDefinition`.
2. Anda mampu membedakan **definisi bean**, **instansiasi bean**, **dependency resolution**, dan **lifecycle management**.
3. Anda memahami kenapa `ApplicationContext` bukan sekadar “container”, tetapi kombinasi dari container + environment + event bus + resource loader + i18n + extension runtime.
4. Anda mampu membaca error Spring container seperti:
   - `NoSuchBeanDefinitionException`
   - `NoUniqueBeanDefinitionException`
   - `BeanCurrentlyInCreationException`
   - `BeanCreationException`
   - `UnsatisfiedDependencyException`
5. Anda mulai melihat Spring Boot auto-configuration sebagai **mass bean definition registration**, bukan magic.
6. Anda mampu membedakan mana object yang layak menjadi bean dan mana yang sebaiknya tetap dibuat manual.

Dokumentasi resmi Spring menyatakan bahwa `BeanFactory` menyediakan configuration framework dan fungsi dasar container, sedangkan `ApplicationContext` menambahkan fitur enterprise yang lebih luas dan menjadi superset dari `BeanFactory`. Referensi resmi juga menyebut `DefaultListableBeanFactory` sebagai implementasi kunci yang menjadi delegate dalam container level lebih tinggi seperti `GenericApplicationContext`.

---

## 1. Masalah Dasar yang Diselesaikan IoC Container

Bayangkan aplikasi enterprise tanpa container:

```java
public final class CaseController {
    private final CaseService caseService;

    public CaseController() {
        DataSource dataSource = new HikariDataSource(...);
        CaseRepository repo = new JdbcCaseRepository(dataSource);
        AuditService audit = new AuditService(dataSource);
        EmailClient email = new SmtpEmailClient(...);
        this.caseService = new CaseService(repo, audit, email);
    }
}
```

Masalahnya bukan hanya “kode jadi panjang”. Masalah sebenarnya jauh lebih struktural:

1. **Object creation bercampur dengan business logic.**
2. **Dependency graph tersembunyi di constructor manual.**
3. **Lifecycle resource sulit dikontrol.**
4. **Testing sulit karena object graph keras terikat ke implementasi.**
5. **Cross-cutting behavior sulit disisipkan.**
6. **Konfigurasi environment bercampur ke kode.**
7. **Startup failure baru terlihat saat object tertentu dipakai.**
8. **Tidak ada registry pusat untuk memahami komponen aplikasi.**

Spring IoC Container menyelesaikan ini dengan memindahkan tanggung jawab berikut ke runtime container:

```text
class discovery
bean definition registration
object instantiation
constructor argument resolution
property injection
lifecycle callback
post-processing
proxy wrapping
singleton caching
resource cleanup
```

Dengan container, kode domain/application service menjadi seperti ini:

```java
@Service
public final class CaseService {
    private final CaseRepository caseRepository;
    private final AuditService auditService;
    private final EmailClient emailClient;

    public CaseService(
            CaseRepository caseRepository,
            AuditService auditService,
            EmailClient emailClient
    ) {
        this.caseRepository = caseRepository;
        this.auditService = auditService;
        this.emailClient = emailClient;
    }
}
```

Secara kasat mata, ini terlihat seperti sekadar “dependency injection”. Tapi secara runtime, Spring melakukan jauh lebih banyak:

```text
1. menemukan class CaseService
2. membuat BeanDefinition untuk CaseService
3. menyimpan metadata bean ke registry
4. menentukan constructor mana yang dipakai
5. mencari bean yang cocok untuk CaseRepository
6. mencari bean yang cocok untuk AuditService
7. mencari bean yang cocok untuk EmailClient
8. membuat dependency terlebih dahulu
9. membuat CaseService
10. menjalankan lifecycle callback
11. memberi kesempatan BeanPostProcessor membungkus object
12. menyimpan hasil final ke singleton cache
```

Jadi container bukan “factory biasa”. Container adalah **runtime compiler ringan untuk object graph**.

---

## 2. Mental Model Paling Penting: Spring Mengelola Definisi Sebelum Mengelola Object

Banyak developer belajar Spring dari annotation:

```java
@Service
public class PaymentService { }
```

Lalu berpikir:

```text
@Service membuat object PaymentService.
```

Ini kurang tepat.

Yang lebih akurat:

```text
@Service membuat class tersebut menjadi kandidat komponen.
Component scanner membaca metadata class tersebut.
Spring mendaftarkan metadata itu sebagai BeanDefinition.
BeanFactory kemudian memakai BeanDefinition untuk membuat object saat diperlukan.
```

Urutannya:

```text
Class metadata  ->  BeanDefinition  ->  Bean instance
```

Bukan:

```text
Annotation  ->  object langsung
```

Ini penting karena banyak behavior Spring terjadi **sebelum object ada**.

Contoh:

1. `@ConditionalOnClass` menentukan apakah bean definition didaftarkan.
2. `@Profile` menentukan apakah bean definition aktif.
3. `BeanFactoryPostProcessor` bisa mengubah metadata sebelum object dibuat.
4. Auto-configuration mendaftarkan bean definition berdasarkan classpath/config.
5. Bean overriding terjadi pada level definition.
6. Ambiguous bean bisa terdeteksi sebelum object final dipakai.

Dengan kata lain:

```text
Spring startup bukan hanya membuat object.
Spring startup membangun peta object terlebih dahulu.
```

---

## 3. Apa Itu Bean?

Dalam Spring, **bean** adalah object yang:

```text
dibuat, dikonfigurasi, dirangkai, dikelola lifecycle-nya, dan disediakan oleh Spring container.
```

Bean bukan berarti:

1. harus punya getter/setter;
2. harus JavaBean klasik;
3. harus entity;
4. harus singleton;
5. harus dibuat dari annotation;
6. harus class milik aplikasi;
7. harus service bisnis.

Bean dapat berupa:

```java
@Service
public class CaseService { }
```

atau:

```java
@Bean
public ObjectMapper objectMapper() {
    return new ObjectMapper();
}
```

atau:

```xml
<bean id="caseService" class="com.example.CaseService" />
```

atau didaftarkan secara programmatic:

```java
GenericApplicationContext context = new GenericApplicationContext();
context.registerBean(CaseService.class);
context.refresh();
```

Yang membuat sesuatu menjadi bean bukan bentuk deklarasinya, tetapi fakta bahwa object tersebut berada di bawah kendali container.

---

## 4. Tidak Semua Object Harus Menjadi Bean

Ini salah satu perbedaan engineer matang dan pengguna framework biasa.

Tidak semua object perlu dikelola Spring.

### Cocok menjadi bean

Object yang biasanya cocok menjadi bean:

1. Application service.
2. Domain service yang stateless dan butuh dependency.
3. Repository/gateway.
4. HTTP client wrapper.
5. Messaging publisher/listener.
6. Scheduled job.
7. Configuration object.
8. Infrastructure component.
9. Policy/strategy object yang dipilih melalui konfigurasi.
10. Adapter ke external system.
11. Cross-cutting service seperti audit, metric, tracing.

Contoh:

```java
@Service
public final class EscalationPolicyService {
    private final HolidayCalendar holidayCalendar;
    private final CaseRepository caseRepository;

    public EscalationPolicyService(
            HolidayCalendar holidayCalendar,
            CaseRepository caseRepository
    ) {
        this.holidayCalendar = holidayCalendar;
        this.caseRepository = caseRepository;
    }
}
```

### Tidak cocok menjadi bean

Object yang biasanya tidak perlu menjadi bean:

1. DTO.
2. Command object.
3. Request object.
4. Response object.
5. Entity instance.
6. Value object.
7. Temporary calculation object.
8. Short-lived object yang dibuat ribuan kali per request.
9. Pure data holder.
10. Object yang lifecycle-nya milik domain, bukan container.

Contoh:

```java
public record CaseDecisionCommand(
        String caseId,
        String action,
        String reason
) { }
```

Ini sebaiknya bukan bean. Ia adalah data per request/per use case.

### Rule of thumb

```text
Jika object adalah capability, dependency, policy, adapter, atau runtime component,
kemungkinan cocok menjadi bean.

Jika object adalah data, event instance, command instance, value, atau state domain individual,
kemungkinan tidak perlu menjadi bean.
```

Spring container bagus untuk mengelola **component graph**, bukan semua object graph di memori.

---

## 5. `BeanDefinition`: Blueprint Bean

`BeanDefinition` adalah metadata yang menjelaskan bagaimana sebuah bean harus dibuat dan dikelola.

Secara konseptual, `BeanDefinition` berisi informasi seperti:

```text
bean name
bean class
scope
constructor arguments
property values
factory method
factory bean
init method
destroy method
lazy/eager flag
primary flag
qualifier metadata
dependency metadata
autowire candidate flag
role
source metadata
```

Contoh class:

```java
@Service
public final class NotificationService {
    private final EmailClient emailClient;

    public NotificationService(EmailClient emailClient) {
        this.emailClient = emailClient;
    }
}
```

Spring tidak langsung hanya menyimpan `NotificationService.class`. Ia membuat metadata kira-kira seperti:

```text
BeanDefinition
  name: notificationService
  class: com.example.NotificationService
  scope: singleton
  lazyInit: false
  autowireCandidate: true
  constructor: resolve automatically
  dependencies: EmailClient
  initMethod: none
  destroyMethod: inferred/none
```

Dalam XML, hal ini lebih terlihat:

```xml
<bean id="notificationService" class="com.example.NotificationService">
    <constructor-arg ref="emailClient" />
</bean>
```

Annotation style menyembunyikan XML, tetapi tidak menghilangkan konsep metadata.

### Kenapa `BeanDefinition` penting?

Karena banyak extension point Spring bekerja di level ini.

Misalnya:

```java
public final class CustomBeanFactoryPostProcessor implements BeanFactoryPostProcessor {
    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        BeanDefinition definition = beanFactory.getBeanDefinition("caseService");
        definition.setLazyInit(true);
    }
}
```

Kode tersebut mengubah metadata bean sebelum object `caseService` dibuat.

Ini membuktikan:

```text
Spring punya fase metadata sebelum fase object.
```

---

## 6. Bean Name: Identitas di Dalam Container

Setiap bean memiliki nama.

Contoh:

```java
@Service
public class CaseService { }
```

Nama default-nya biasanya:

```text
caseService
```

Untuk class:

```java
@Service
public class URLParser { }
```

Nama default bisa memiliki aturan khusus karena acronym. Maka, untuk komponen penting, lebih aman eksplisit:

```java
@Service("urlParser")
public class URLParser { }
```

Untuk `@Bean`:

```java
@Bean
public ObjectMapper objectMapper() {
    return new ObjectMapper();
}
```

Nama bean default:

```text
objectMapper
```

Bisa dibuat eksplisit:

```java
@Bean("externalApiObjectMapper")
public ObjectMapper externalApiObjectMapper() {
    return new ObjectMapper();
}
```

### Bean name bukan hanya kosmetik

Bean name dipakai untuk:

1. lookup manual;
2. qualifier by name;
3. bean overriding;
4. actuator inspection;
5. diagnostics;
6. condition matching;
7. infrastructure bean reference;
8. parent-child context resolution.

Contoh injection by qualifier:

```java
@Service
public class ReportExporter {
    private final ObjectMapper objectMapper;

    public ReportExporter(@Qualifier("externalApiObjectMapper") ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }
}
```

Jika naming tidak disiplin, aplikasi besar akan sulit dipahami.

---

## 7. Bean Scope

Scope menentukan hubungan antara bean definition dan bean instance.

Scope umum:

```text
singleton
prototype
request
session
application
websocket
custom scope
```

### 7.1 Singleton

Default Spring scope adalah singleton.

Artinya:

```text
satu bean instance per ApplicationContext per bean name.
```

Bukan singleton JVM global.

Jika ada dua `ApplicationContext`, masing-masing bisa punya instance singleton sendiri.

```text
ApplicationContext A
  caseService -> instance #1

ApplicationContext B
  caseService -> instance #2
```

Ini penting di test, parent-child context, dan aplikasi modular.

### 7.2 Prototype

Prototype berarti:

```text
setiap request ke container menghasilkan instance baru.
```

```java
@Component
@Scope("prototype")
public class ImportCursor { }
```

Namun ada jebakan besar:

Jika prototype di-inject ke singleton:

```java
@Service
public class ImportService {
    private final ImportCursor cursor;

    public ImportService(ImportCursor cursor) {
        this.cursor = cursor;
    }
}
```

Maka `ImportCursor` hanya dibuat saat `ImportService` dibuat. Setelah itu instance-nya tetap sama di dalam singleton.

Untuk mendapatkan prototype baru setiap kali, gunakan `ObjectProvider`:

```java
@Service
public class ImportService {
    private final ObjectProvider<ImportCursor> cursorProvider;

    public ImportService(ObjectProvider<ImportCursor> cursorProvider) {
        this.cursorProvider = cursorProvider;
    }

    public void runImport() {
        ImportCursor cursor = cursorProvider.getObject();
        // use new cursor
    }
}
```

### 7.3 Request scope

Request scope berarti bean hidup selama satu HTTP request.

```java
@Component
@RequestScope
public class RequestCorrelationContext {
    private String correlationId;
}
```

Jebakan:

Request-scoped bean sering di-inject ke singleton service. Agar ini bisa bekerja, Spring memakai scoped proxy.

```java
@Component
@RequestScope
public class CurrentUserContext { }

@Service
public class CaseService {
    private final CurrentUserContext currentUserContext;

    public CaseService(CurrentUserContext currentUserContext) {
        this.currentUserContext = currentUserContext;
    }
}
```

Secara runtime, yang masuk ke `CaseService` bukan object request asli, tetapi proxy. Saat method dipanggil, proxy mengambil object yang sesuai request aktif.

Risikonya:

```text
Jika dipanggil di luar request thread, bisa gagal karena tidak ada request context.
```

### 7.4 Custom scope

Custom scope berguna untuk platform tertentu, misalnya:

```text
tenant scope
workflow scope
job scope
conversation scope
case-processing scope
```

Namun custom scope harus sangat hati-hati karena berhubungan dengan:

1. lifecycle cleanup;
2. concurrency;
3. context propagation;
4. memory leak;
5. testing complexity.

---

## 8. `BeanFactory`: Core Container

`BeanFactory` adalah interface paling dasar untuk mengakses container.

Secara mental:

```text
BeanFactory = registry + factory + dependency resolver + lifecycle coordinator
```

Fungsi dasarnya:

1. menyimpan bean definition;
2. membuat bean instance;
3. resolve dependency;
4. mengelola scope;
5. menjalankan lifecycle;
6. menyediakan lookup bean;
7. menjadi basis integrasi internal Spring.

Contoh sederhana:

```java
BeanFactory factory = ...;
CaseService caseService = factory.getBean(CaseService.class);
```

Namun di aplikasi modern, kita jarang memakai `BeanFactory` langsung. Biasanya memakai `ApplicationContext`.

### Kenapa tetap perlu memahami BeanFactory?

Karena banyak error dan mekanisme internal terjadi di sini.

Misalnya:

```text
NoSuchBeanDefinitionException
NoUniqueBeanDefinitionException
BeanCreationException
BeanCurrentlyInCreationException
UnsatisfiedDependencyException
```

Semua ini berhubungan dengan cara `BeanFactory` membuat dan mencari bean.

---

## 9. `DefaultListableBeanFactory`: Mesin Utama Spring Container

Implementasi yang sangat penting adalah:

```java
DefaultListableBeanFactory
```

Secara konseptual, ia melakukan banyak peran:

```text
BeanDefinitionRegistry
AliasRegistry
SingletonBeanRegistry
AutowireCapableBeanFactory
ConfigurableListableBeanFactory
```

Artinya ia bisa:

1. mendaftarkan bean definition;
2. menyimpan alias;
3. menyimpan singleton instance;
4. melakukan autowiring;
5. expose metadata bean;
6. pre-instantiate singleton;
7. resolve dependency by type/name/qualifier;
8. mengelola dependency graph.

Mental model:

```text
ApplicationContext adalah wajah enterprise container.
DefaultListableBeanFactory adalah mesin object graph di bawahnya.
```

Jika Anda memahami `DefaultListableBeanFactory`, banyak “magic” Spring menjadi mekanis.

---

## 10. `ApplicationContext`: BeanFactory Plus Enterprise Runtime

`ApplicationContext` adalah container yang biasanya Anda pakai di aplikasi nyata.

Ia memperluas `BeanFactory` dengan kemampuan:

1. Environment access.
2. Property resolution.
3. Resource loading.
4. Application event publishing.
5. Internationalization/message resolution.
6. Lifecycle management lebih lengkap.
7. Integration dengan AOP.
8. Annotation processing.
9. Web context integration.
10. Boot integration.

Secara sederhana:

```text
BeanFactory        = core object factory
ApplicationContext = application runtime context
```

### Contoh manual

```java
AnnotationConfigApplicationContext context =
        new AnnotationConfigApplicationContext(AppConfig.class);

CaseService caseService = context.getBean(CaseService.class);
context.close();
```

### Di Spring Boot

```java
@SpringBootApplication
public class CaseApplication {
    public static void main(String[] args) {
        SpringApplication.run(CaseApplication.class, args);
    }
}
```

`SpringApplication.run(...)` membuat `ApplicationContext`, menyiapkan environment, menjalankan auto-configuration, melakukan refresh, dan akhirnya menjalankan aplikasi.

---

## 11. Jenis-jenis `ApplicationContext`

Beberapa context penting:

### 11.1 `AnnotationConfigApplicationContext`

Dipakai untuk aplikasi non-web berbasis Java config/annotation.

```java
AnnotationConfigApplicationContext context =
        new AnnotationConfigApplicationContext(AppConfig.class);
```

Cocok untuk:

1. CLI app;
2. test manual;
3. batch sederhana;
4. library exploration;
5. framework experimentation.

### 11.2 `GenericApplicationContext`

Context fleksibel untuk programmatic registration.

```java
GenericApplicationContext context = new GenericApplicationContext();
context.registerBean(CaseService.class);
context.refresh();
```

Cocok untuk:

1. framework internal;
2. dynamic registration;
3. test container;
4. infrastructure library.

### 11.3 Web Application Context

Untuk aplikasi servlet/MVC, Spring memakai web-aware context.

Secara tradisional ada parent-child context:

```text
Root WebApplicationContext
  service beans
  repository beans
  infrastructure beans

DispatcherServlet WebApplicationContext
  controller beans
  handler mappings
  view resolvers
  MVC infrastructure
```

Di Spring Boot modern, struktur ini lebih disederhanakan, tetapi konsep parent-child tetap penting untuk memahami aplikasi legacy dan servlet environment.

### 11.4 Reactive Web Server Application Context

Untuk WebFlux/reactive stack, context berbeda karena runtime web server-nya bisa Netty/Undertow/Servlet reactive support.

Yang penting:

```text
Context tetap ApplicationContext,
tetapi web runtime dan request dispatching model berbeda.
```

---

## 12. `refresh()`: Momen Container Menjadi Hidup

`ApplicationContext` biasanya memiliki fase penting bernama `refresh()`.

Secara konseptual, `refresh()` melakukan:

```text
1. prepare context
2. prepare bean factory
3. load/register bean definitions
4. invoke BeanFactoryPostProcessor
5. register BeanPostProcessor
6. initialize message source
7. initialize event multicaster
8. initialize special beans
9. register listeners
10. instantiate non-lazy singleton beans
11. finish refresh
```

Meskipun detail implementasi bisa berubah antar versi, mental modelnya stabil:

```text
refresh() = build and activate application runtime
```

Sebelum `refresh()`:

```text
metadata bisa didaftarkan dan dimodifikasi
```

Setelah `refresh()`:

```text
container aktif, singleton non-lazy sudah dibuat, event bisa dipublish, lifecycle berjalan
```

Contoh programmatic registration:

```java
GenericApplicationContext context = new GenericApplicationContext();

context.registerBean(CaseRepository.class);
context.registerBean(CaseService.class);

// bean belum siap dipakai sebelum refresh
context.refresh();

CaseService service = context.getBean(CaseService.class);
context.close();
```

Jika lupa `refresh()`, context belum aktif.

---

## 13. Bean Registration: Dari Mana BeanDefinition Datang?

Bean definition bisa datang dari banyak sumber.

### 13.1 Component scanning

```java
@Component
public class CaseService { }
```

Scanner membaca classpath dan menemukan class dengan stereotype annotation.

### 13.2 `@Bean` method

```java
@Configuration
public class AppConfig {
    @Bean
    public CaseService caseService(CaseRepository repository) {
        return new CaseService(repository);
    }
}
```

### 13.3 XML

```xml
<bean id="caseService" class="com.example.CaseService" />
```

Masih penting di banyak sistem lama berbasis Java 8/Spring 4/5.

### 13.4 Programmatic registration

```java
context.registerBean(CaseService.class);
```

### 13.5 Import mechanism

```java
@Import(CaseModuleConfiguration.class)
@Configuration
public class AppConfig { }
```

### 13.6 Auto-configuration

Spring Boot mendaftarkan banyak bean definition berdasarkan:

```text
classpath
properties
existing beans
web application type
resource availability
```

Misalnya, jika `DataSource` library ada di classpath dan property database tersedia, Boot bisa mendaftarkan `DataSource` bean.

### 13.7 Registrar/selector

Library tingkat lanjut bisa mendaftarkan bean dengan:

```text
ImportBeanDefinitionRegistrar
ImportSelector
DeferredImportSelector
BeanDefinitionRegistryPostProcessor
```

Inilah mekanisme yang sering dipakai framework internal, Spring Data, Spring Security, Spring Boot, dan berbagai starter.

---

## 14. Bean Creation: Dari Definition ke Instance

Sekarang kita lihat proses pembuatan bean.

Misalnya:

```java
@Service
public class CaseService {
    private final CaseRepository repository;
    private final AuditService auditService;

    public CaseService(CaseRepository repository, AuditService auditService) {
        this.repository = repository;
        this.auditService = auditService;
    }
}
```

Secara konseptual Spring melakukan:

```text
getBean("caseService")
  -> cari BeanDefinition caseService
  -> cek scope
  -> jika singleton dan sudah ada, return dari cache
  -> jika belum ada, tandai sedang dibuat
  -> resolve constructor
  -> resolve CaseRepository
  -> resolve AuditService
  -> instantiate CaseService
  -> populate properties jika ada
  -> invoke aware callbacks
  -> apply BeanPostProcessor before init
  -> invoke init callback
  -> apply BeanPostProcessor after init
  -> simpan singleton final
  -> return bean
```

Pseudo-code mental:

```java
Object getBean(String name) {
    if (singletonCache.contains(name)) {
        return singletonCache.get(name);
    }

    BeanDefinition bd = beanDefinitionMap.get(name);

    markBeanAsCurrentlyInCreation(name);

    Constructor<?> constructor = resolveConstructor(bd);
    Object[] args = resolveConstructorArguments(constructor);
    Object rawBean = instantiate(constructor, args);

    populateProperties(rawBean, bd);
    invokeAwareCallbacks(rawBean);

    Object beforeInit = applyBeanPostProcessorsBeforeInitialization(rawBean);
    invokeInitMethods(beforeInit);
    Object finalBean = applyBeanPostProcessorsAfterInitialization(beforeInit);

    singletonCache.put(name, finalBean);
    unmarkBeanAsCurrentlyInCreation(name);

    return finalBean;
}
```

Ini bukan kode asli, tetapi mental model yang cukup kuat untuk memahami sebagian besar error.

---

## 15. Singleton Cache dan Early Reference

Spring singleton bukan hanya “map bean name ke object”. Karena circular dependency dan proxy, Spring punya beberapa lapisan internal cache.

Secara mental:

```text
fully initialized singletons
early singleton references
singleton factories
```

Kenapa perlu early reference?

Misalnya dependency cycle setter-based:

```java
@Component
public class A {
    @Autowired
    private B b;
}

@Component
public class B {
    @Autowired
    private A a;
}
```

Untuk membuat `A`, Spring perlu `B`. Untuk membuat `B`, Spring perlu `A`. Pada beberapa kasus, Spring bisa mengekspos reference awal `A` sebelum lifecycle selesai.

Namun ini berbahaya secara desain.

Constructor cycle lebih parah:

```java
@Component
public class A {
    public A(B b) { }
}

@Component
public class B {
    public B(A a) { }
}
```

Ini tidak bisa diselesaikan tanpa mengubah desain, karena tidak ada object `A` yang bisa diekspos sebelum constructor selesai.

### Kenapa circular dependency buruk?

Karena menunjukkan dua komponen saling tahu terlalu banyak.

Biasanya solusinya adalah memecah boundary:

```text
A -> Policy/Port <- B
```

atau:

```text
A publishes event
B listens to event
```

atau:

```text
A and B depend on shared lower-level service C
```

Jangan langsung memakai `@Lazy` untuk “memperbaiki” cycle tanpa memahami desainnya.

---

## 16. Lazy vs Eager Initialization

Default singleton bean biasanya dibuat saat startup context.

```text
non-lazy singleton -> dibuat saat refresh
lazy singleton     -> dibuat saat pertama diminta
```

Contoh:

```java
@Component
@Lazy
public class LargeReportGenerator { }
```

### Keuntungan lazy

1. Startup lebih cepat.
2. Bean mahal hanya dibuat jika dipakai.
3. Useful untuk optional path.
4. Bisa mengurangi resource awal.

### Risiko lazy

1. Error baru muncul saat runtime request pertama.
2. Production traffic bisa terkena cold path failure.
3. Dependency missing tidak terdeteksi di startup.
4. Latency request pertama naik.
5. Operational readiness bisa menipu.

Untuk sistem enterprise, default eager sering lebih aman karena:

```text
fail fast at startup > fail late during user transaction
```

Namun lazy masuk akal untuk:

```text
rarely used admin/report path
expensive optional integration
large cache warmup object
plugin-like component
```

---

## 17. Parent-Child Context

Spring context bisa memiliki parent.

```text
Parent ApplicationContext
  common infrastructure
  shared services
  repositories

Child ApplicationContext
  web controllers
  request mappings
  servlet-specific beans
```

Lookup rule secara mental:

```text
child mencari bean di dirinya sendiri terlebih dahulu
jika tidak ditemukan, cari ke parent
parent tidak otomatis melihat child
```

Contoh:

```text
child.getBean("caseService")
  -> check child
  -> not found
  -> check parent
  -> found
```

Tapi:

```text
parent.getBean("caseController")
  -> check parent
  -> not found
  -> tidak mencari child
```

### Kenapa ini penting?

1. Legacy Spring MVC sering memakai root context + servlet context.
2. Test context bisa memiliki hierarchy.
3. Multi-module app bisa membuat child context.
4. Bean name shadowing bisa terjadi.
5. Security/web infrastructure bisa ada di context berbeda.

Masalah umum:

```text
Bean ada, tetapi tidak terlihat karena berada di sibling/child context yang salah.
```

---

## 18. Bean Overriding dan Shadowing

Bean overriding terjadi saat bean definition dengan nama sama didaftarkan lebih dari sekali.

Contoh:

```java
@Configuration
class ConfigA {
    @Bean
    DataSource dataSource() { ... }
}

@Configuration
class ConfigB {
    @Bean
    DataSource dataSource() { ... }
}
```

Ini menciptakan konflik nama `dataSource`.

Dalam aplikasi kecil, overriding kadang nyaman. Dalam aplikasi besar, overriding bisa sangat berbahaya karena:

1. bean yang aktif tidak jelas;
2. auto-configuration bisa tertimpa diam-diam;
3. test berbeda dengan production;
4. module saling menginjak;
5. debugging sulit.

Spring Boot modern cenderung mendorong eksplisit, bukan silent overriding.

### Rule

```text
Untuk production app, hindari overriding diam-diam.
Gunakan nama eksplisit, condition eksplisit, dan test auto-configuration.
```

---

## 19. Alias

Spring mendukung alias bean name.

Konsep:

```text
primary name: externalApiClient
alias       : paymentGatewayClient
```

Alias berguna untuk:

1. compatibility;
2. module migration;
3. XML legacy;
4. integration config;
5. semantic naming.

Namun terlalu banyak alias membuat graph sulit dilacak.

Guideline:

```text
Alias boleh untuk backward compatibility.
Jangan pakai alias sebagai mekanisme utama desain dependency.
```

---

## 20. FactoryBean vs Bean Factory

Ini sering membingungkan.

```text
BeanFactory  = container/factory yang membuat banyak bean.
FactoryBean  = satu bean khusus yang memproduksi object lain.
```

`FactoryBean<T>` adalah extension point.

Contoh konseptual:

```java
public class ClientFactoryBean implements FactoryBean<ExternalClient> {
    @Override
    public ExternalClient getObject() {
        return new ExternalClient(...);
    }

    @Override
    public Class<?> getObjectType() {
        return ExternalClient.class;
    }
}
```

Jika bean bernama `externalClient` adalah `FactoryBean`, maka:

```java
context.getBean("externalClient")
```

mengembalikan object hasil `getObject()`, bukan factory-nya.

Untuk mendapatkan factory itu sendiri:

```java
context.getBean("&externalClient")
```

### Kapan FactoryBean dipakai?

1. Object creation kompleks.
2. Proxy generation.
3. Client stub generation.
4. Mapper/repository proxy.
5. Integration dengan framework lain.

Spring Data repository, MyBatis mapper, dan banyak proxy integration punya pola mirip ini.

---

## 21. `@Bean` Factory Method

Selain `FactoryBean`, ada factory method biasa melalui `@Bean`.

```java
@Configuration
public class ClientConfig {
    @Bean
    public ExternalClient externalClient(ClientProperties properties) {
        return ExternalClient.builder()
                .baseUrl(properties.baseUrl())
                .timeout(properties.timeout())
                .build();
    }
}
```

Perbedaan penting:

```text
@Bean method = method konfigurasi yang menghasilkan bean
FactoryBean = bean yang ketika di-lookup menghasilkan object lain
```

Kebanyakan kebutuhan aplikasi cukup dengan `@Bean` method.

Gunakan `FactoryBean` jika Anda membangun framework/library yang butuh object creation lebih dinamis.

---

## 22. Infrastructure Bean vs Application Bean

Tidak semua bean punya derajat yang sama.

Spring membedakan role bean definition secara konseptual:

```text
application bean
support bean
infrastructure bean
```

Application bean:

```text
CaseService
CaseRepository
CaseController
```

Infrastructure bean:

```text
AutowiredAnnotationBeanPostProcessor
ConfigurationClassPostProcessor
TransactionInterceptor
BeanNameAutoProxyCreator
RequestMappingHandlerMapping
```

Kenapa ini penting?

Karena error pada infrastructure bean berdampak ke seluruh container.

Contoh:

```text
Jika BeanPostProcessor untuk @Autowired tidak terdaftar,
injection annotation tidak berjalan.
```

Jika transaction infrastructure tidak terdaftar:

```text
@Transactional tidak punya efek.
```

Jika MVC infrastructure tidak terdaftar:

```text
@Controller tidak dipetakan menjadi endpoint.
```

Annotation tidak bekerja sendirian. Annotation perlu infrastructure bean yang membacanya.

---

## 23. BeanPostProcessor: Membentuk Bean Setelah Dibuat

`BeanPostProcessor` adalah extension point yang bisa memodifikasi/membungkus bean setelah instansiasi.

Secara konseptual:

```text
raw object -> BeanPostProcessor -> final exposed bean
```

Contoh sederhana:

```java
public final class LoggingBeanPostProcessor implements BeanPostProcessor {
    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        System.out.println("Bean ready: " + beanName);
        return bean;
    }
}
```

Banyak fitur Spring bergantung pada post processor:

1. `@Autowired` processing.
2. `@PostConstruct` processing.
3. AOP proxy creation.
4. `@Transactional` proxy.
5. `@Async` proxy.
6. `@Cacheable` proxy.
7. event listener detection.

Artinya bean yang Anda inject mungkin bukan raw object asli.

Contoh:

```java
@Service
public class PaymentService {
    @Transactional
    public void pay() { }
}
```

Object final yang di-expose bisa berupa proxy:

```text
paymentService bean -> Transaction proxy -> PaymentService target
```

Ini sebabnya self-invocation menjadi masalah:

```java
@Service
public class PaymentService {
    public void outer() {
        inner(); // tidak lewat proxy
    }

    @Transactional
    public void inner() { }
}
```

Karena `inner()` dipanggil langsung dari object yang sama, bukan melalui proxy Spring.

---

## 24. BeanFactoryPostProcessor: Mengubah Metadata Sebelum Object Dibuat

Berbeda dengan `BeanPostProcessor`, `BeanFactoryPostProcessor` bekerja sebelum bean dibuat.

```text
BeanFactoryPostProcessor -> BeanDefinition metadata
BeanPostProcessor        -> bean instance
```

Contoh:

```java
public final class LazyAllServicesPostProcessor implements BeanFactoryPostProcessor {
    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        for (String name : beanFactory.getBeanDefinitionNames()) {
            BeanDefinition bd = beanFactory.getBeanDefinition(name);
            if (name.endsWith("Service")) {
                bd.setLazyInit(true);
            }
        }
    }
}
```

Ini mengubah definisi, bukan object.

Spring sendiri memakai konsep ini untuk:

1. property placeholder resolution;
2. configuration class parsing;
3. component scanning registration;
4. auto-configuration processing;
5. infrastructure setup.

---

## 25. BeanDefinitionRegistryPostProcessor: Bahkan Lebih Awal

`BeanDefinitionRegistryPostProcessor` bisa menambah/mengubah bean definition sebelum `BeanFactoryPostProcessor` biasa berjalan.

Ini sangat powerful.

Digunakan untuk:

1. scanning custom annotation;
2. mendaftarkan repository proxy;
3. mendaftarkan mapper proxy;
4. membuat framework internal;
5. dynamic module registration.

Contoh konseptual:

```java
public final class CustomRepositoryRegistrar
        implements BeanDefinitionRegistryPostProcessor {

    @Override
    public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) {
        RootBeanDefinition definition = new RootBeanDefinition(MyRepositoryFactoryBean.class);
        registry.registerBeanDefinition("caseRepository", definition);
    }

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
    }
}
```

Jika Anda membangun internal platform starter, level extension point ini sangat penting.

---

## 26. Dependency Lookup vs Dependency Injection

Spring mendukung dua cara menggunakan dependency:

### Dependency lookup

```java
CaseService service = context.getBean(CaseService.class);
```

### Dependency injection

```java
@Service
public class CaseController {
    private final CaseService caseService;

    public CaseController(CaseService caseService) {
        this.caseService = caseService;
    }
}
```

Di application code, injection lebih baik karena:

1. dependency eksplisit;
2. lebih mudah test;
3. tidak tergantung container API;
4. coupling lebih rendah;
5. object graph bisa dianalisis.

Dependency lookup masih berguna untuk:

1. bootstrap code;
2. plugin system;
3. dynamic selection;
4. framework internal;
5. integration boundary tertentu.

Hindari pola ini di business service:

```java
@Service
public class CaseService {
    @Autowired
    private ApplicationContext context;

    public void process(String type) {
        Handler handler = context.getBean(type + "Handler", Handler.class);
        handler.handle();
    }
}
```

Lebih baik:

```java
@Service
public class CaseService {
    private final Map<String, Handler> handlers;

    public CaseService(Map<String, Handler> handlers) {
        this.handlers = handlers;
    }

    public void process(String type) {
        Handler handler = handlers.get(type);
        if (handler == null) {
            throw new UnsupportedCaseTypeException(type);
        }
        handler.handle();
    }
}
```

Ini membuat dependency terlihat dan testable.

---

## 27. `ApplicationContextAware` dan Aware Interfaces

Spring punya beberapa `Aware` interface:

```text
BeanNameAware
BeanFactoryAware
ApplicationContextAware
EnvironmentAware
ResourceLoaderAware
ApplicationEventPublisherAware
MessageSourceAware
```

Contoh:

```java
@Component
public class ContextUsingComponent implements ApplicationContextAware {
    private ApplicationContext applicationContext;

    @Override
    public void setApplicationContext(ApplicationContext applicationContext) {
        this.applicationContext = applicationContext;
    }
}
```

Ini kadang diperlukan untuk infrastructure code, tapi jarang ideal untuk business code.

### Risiko

Jika business service memakai `ApplicationContextAware`, ia menjadi tahu terlalu banyak tentang container.

```text
Business logic -> Spring container API
```

Ini memperburuk:

1. unit testing;
2. portability;
3. dependency clarity;
4. architecture boundary;
5. reasoning about graph.

Guideline:

```text
Aware interface boleh untuk framework/infrastructure component.
Untuk application/domain service, gunakan constructor injection.
```

---

## 28. Resource Loading di ApplicationContext

`ApplicationContext` juga merupakan `ResourceLoader`.

Spring bisa membaca resource dari:

```text
classpath:
file:
http:
servlet context:
```

Contoh:

```java
Resource resource = applicationContext.getResource("classpath:templates/email.html");
```

Ini berguna untuk:

1. template;
2. schema;
3. migration script;
4. static metadata;
5. certificate/key material;
6. integration test resource.

Namun hindari menyebarkan resource loading manual di semua service. Biasanya lebih baik bungkus dalam component khusus:

```java
@Component
public class EmailTemplateRepository {
    private final ResourceLoader resourceLoader;

    public EmailTemplateRepository(ResourceLoader resourceLoader) {
        this.resourceLoader = resourceLoader;
    }

    public String loadTemplate(String name) {
        Resource resource = resourceLoader.getResource("classpath:email/" + name + ".html");
        // read resource
        return "...";
    }
}
```

---

## 29. Event Publishing di ApplicationContext

`ApplicationContext` juga bisa publish event.

Contoh:

```java
public record CaseApprovedEvent(String caseId) { }
```

```java
@Service
public class CaseApprovalService {
    private final ApplicationEventPublisher eventPublisher;

    public CaseApprovalService(ApplicationEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
    }

    public void approve(String caseId) {
        // update state
        eventPublisher.publishEvent(new CaseApprovedEvent(caseId));
    }
}
```

Listener:

```java
@Component
public class CaseApprovedListener {
    @EventListener
    public void on(CaseApprovedEvent event) {
        // send notification, audit, etc.
    }
}
```

Penting:

```text
Spring application event default-nya synchronous.
```

Artinya listener berjalan di thread yang sama kecuali Anda mengkonfigurasi async event multicaster.

Jangan anggap event Spring otomatis seperti Kafka/RabbitMQ. Ia adalah in-process event mechanism.

---

## 30. Internationalization: MessageSource

`ApplicationContext` juga mendukung message resolution.

Contoh:

```properties
case.not-found=Case {0} was not found.
```

```java
String message = messageSource.getMessage(
        "case.not-found",
        new Object[] { caseId },
        locale
);
```

Ini dipakai oleh:

1. validation messages;
2. error messages;
3. UI server-side rendering;
4. email templates;
5. localized API messages jika diperlukan.

Untuk API enterprise, hati-hati:

```text
machine-readable error code harus stabil,
human-readable message boleh localized.
```

---

## 31. Environment dan Property Access

`ApplicationContext` menyediakan akses ke `Environment`.

```java
String profile = context.getEnvironment().getProperty("spring.profiles.active");
```

Namun jangan terlalu sering memakai environment lookup manual di business code.

Buruk:

```java
@Service
public class PaymentService {
    private final Environment environment;

    public PaymentService(Environment environment) {
        this.environment = environment;
    }

    public void pay() {
        String mode = environment.getProperty("payment.mode");
        // branch logic
    }
}
```

Lebih baik:

```java
@ConfigurationProperties(prefix = "payment")
public record PaymentProperties(String mode) { }
```

```java
@Service
public class PaymentService {
    private final PaymentProperties properties;

    public PaymentService(PaymentProperties properties) {
        this.properties = properties;
    }
}
```

Kenapa?

1. Type-safe.
2. Testable.
3. Validatable.
4. Config contract jelas.
5. Tidak stringly-typed di business logic.

---

## 32. Object Graph sebagai Directed Graph

Secara arsitektural, Spring app adalah graph:

```text
Controller -> Service -> Repository -> DataSource
           -> AuditService -> AuditRepository -> DataSource
           -> EmailClient -> HTTP client
```

Graph ini harus punya arah yang sehat.

Contoh sehat:

```text
web adapter
  -> application service
      -> domain policy
      -> repository port
      -> integration port
```

Contoh buruk:

```text
service A -> service B -> service C -> service A
```

atau:

```text
repository -> service
```

atau:

```text
entity -> Spring bean
```

Spring bisa membuat banyak graph yang secara teknis valid tetapi arsitektural buruk.

Container tidak otomatis menjaga architecture boundary Anda.

Tugas engineer:

```text
Gunakan Spring untuk merangkai graph,
tetapi desain arah dependency tetap harus eksplisit dan sehat.
```

---

## 33. Startup sebagai Graph Validation

Salah satu keuntungan Spring adalah startup dapat menjadi validasi object graph.

Jika dependency hilang:

```text
UnsatisfiedDependencyException
```

Jika ada lebih dari satu candidate:

```text
NoUniqueBeanDefinitionException
```

Jika bean gagal dibuat:

```text
BeanCreationException
```

Jika circular dependency:

```text
BeanCurrentlyInCreationException
```

Ini bagus karena error muncul saat startup, bukan setelah user menekan tombol.

Namun validasi ini hanya kuat jika:

1. bean eager;
2. semua profile penting diuji;
3. test context representatif;
4. conditional config tidak menyembunyikan path;
5. lazy tidak dipakai berlebihan;
6. reflection/dynamic lookup tidak berlebihan.

---

## 34. Error Model: Cara Membaca Error Container

### 34.1 `NoSuchBeanDefinitionException`

Makna:

```text
Container tidak menemukan bean yang diminta.
```

Penyebab umum:

1. class tidak kena component scan;
2. package salah;
3. profile tidak aktif;
4. condition tidak match;
5. bean belum didaftarkan;
6. type yang diminta salah;
7. parent-child context salah;
8. dependency optional tidak dideklarasikan optional.

Cara berpikir:

```text
Apakah bean definition-nya ada?
Jika tidak, kenapa tidak terdaftar?
Jika ada, apakah terlihat dari context ini?
Jika terlihat, apakah type/name/qualifier cocok?
```

### 34.2 `NoUniqueBeanDefinitionException`

Makna:

```text
Ada lebih dari satu candidate untuk dependency yang sama.
```

Contoh:

```java
interface NotificationSender { }

@Component
class EmailNotificationSender implements NotificationSender { }

@Component
class SmsNotificationSender implements NotificationSender { }
```

Lalu:

```java
@Service
class NotificationService {
    NotificationService(NotificationSender sender) { }
}
```

Spring bingung memilih.

Solusi:

1. `@Qualifier`;
2. `@Primary`;
3. inject collection/map;
4. desain strategy resolver;
5. pisahkan interface semantik.

### 34.3 `UnsatisfiedDependencyException`

Makna:

```text
Spring gagal memenuhi dependency saat membuat bean.
```

Biasanya wrapper dari error lebih spesifik.

Baca stack trace dari bawah:

```text
Root cause sering ada paling bawah.
```

### 34.4 `BeanCreationException`

Makna:

```text
Bean definition ada, tetapi bean gagal dibuat.
```

Penyebab:

1. constructor throw exception;
2. init method gagal;
3. property invalid;
4. external resource unavailable;
5. configuration missing;
6. proxy creation gagal;
7. classloading error.

### 34.5 `BeanCurrentlyInCreationException`

Makna:

```text
Bean sedang dibuat, tetapi dibutuhkan lagi sebelum siap.
```

Biasanya circular dependency.

Solusi terbaik hampir selalu desain ulang dependency direction.

---

## 35. Component Scan Boundary

Component scan terlihat simpel:

```java
@SpringBootApplication
public class App { }
```

`@SpringBootApplication` secara default scan package tempat class `App` berada dan subpackage-nya.

Jika struktur package:

```text
com.company.caseapp.App
com.company.caseapp.case.CaseService
com.company.shared.audit.AuditService
```

Maka `AuditService` tidak otomatis ter-scan jika berada di luar root package.

Solusi:

```java
@SpringBootApplication(scanBasePackages = {
        "com.company.caseapp",
        "com.company.shared.audit"
})
public class App { }
```

Namun untuk aplikasi besar, terlalu banyak `scanBasePackages` bisa menjadi sinyal desain module yang kurang rapi.

Lebih baik shared module menyediakan explicit configuration:

```java
@Configuration
@ComponentScan("com.company.shared.audit")
public class AuditModuleConfiguration { }
```

Lalu import:

```java
@Import(AuditModuleConfiguration.class)
@SpringBootApplication
public class App { }
```

Atau lebih modern sebagai starter/auto-configuration internal.

---

## 36. Constructor Injection sebagai Default

Spring mendukung:

1. constructor injection;
2. setter injection;
3. field injection;
4. method injection;
5. lookup method injection.

Untuk application code, constructor injection paling baik.

```java
@Service
public class CaseService {
    private final CaseRepository caseRepository;
    private final AuditService auditService;

    public CaseService(CaseRepository caseRepository, AuditService auditService) {
        this.caseRepository = caseRepository;
        this.auditService = auditService;
    }
}
```

Keuntungan:

1. dependency wajib menjadi eksplisit;
2. object tidak bisa dibuat dalam state invalid;
3. field bisa `final`;
4. mudah unit test tanpa Spring;
5. circular dependency terlihat lebih cepat;
6. lebih cocok untuk immutability;
7. lebih jelas untuk code review.

Field injection:

```java
@Autowired
private CaseRepository caseRepository;
```

Masalah:

1. dependency tersembunyi;
2. sulit unit test tanpa reflection;
3. object bisa dibuat dalam state null;
4. final field tidak bisa dipakai;
5. cycle lebih mudah tersembunyi;
6. service tampak punya constructor kosong padahal butuh dependency.

Field injection masih sering ditemui di legacy code, tetapi bukan default yang baik untuk engineering serius.

---

## 37. Optional Dependency

Tidak semua dependency wajib.

Contoh:

```java
@Service
public class AuditPublisher {
    private final Optional<ExternalAuditGateway> gateway;

    public AuditPublisher(Optional<ExternalAuditGateway> gateway) {
        this.gateway = gateway;
    }
}
```

Atau:

```java
@Service
public class AuditPublisher {
    private final ObjectProvider<ExternalAuditGateway> gatewayProvider;

    public AuditPublisher(ObjectProvider<ExternalAuditGateway> gatewayProvider) {
        this.gatewayProvider = gatewayProvider;
    }

    public void publish(AuditEvent event) {
        ExternalAuditGateway gateway = gatewayProvider.getIfAvailable();
        if (gateway != null) {
            gateway.publish(event);
        }
    }
}
```

`ObjectProvider` lebih fleksibel untuk:

1. lazy lookup;
2. optional bean;
3. multiple candidates;
4. prototype retrieval;
5. avoiding early initialization.

Namun jangan gunakan optional dependency untuk menyembunyikan desain yang tidak jelas.

Jika sebuah service butuh dependency untuk correctness, dependency itu harus mandatory.

---

## 38. Collection Injection dan Strategy Pattern

Spring bisa inject semua bean dari suatu type.

```java
public interface CaseActionHandler {
    String action();
    void handle(CaseActionCommand command);
}
```

```java
@Component
public class ApproveCaseHandler implements CaseActionHandler {
    public String action() { return "APPROVE"; }
    public void handle(CaseActionCommand command) { }
}
```

```java
@Component
public class RejectCaseHandler implements CaseActionHandler {
    public String action() { return "REJECT"; }
    public void handle(CaseActionCommand command) { }
}
```

Resolver:

```java
@Service
public class CaseActionDispatcher {
    private final Map<String, CaseActionHandler> handlersByAction;

    public CaseActionDispatcher(List<CaseActionHandler> handlers) {
        this.handlersByAction = handlers.stream()
                .collect(Collectors.toUnmodifiableMap(
                        CaseActionHandler::action,
                        Function.identity()
                ));
    }

    public void dispatch(CaseActionCommand command) {
        CaseActionHandler handler = handlersByAction.get(command.action());
        if (handler == null) {
            throw new UnsupportedOperationException("Unsupported action: " + command.action());
        }
        handler.handle(command);
    }
}
```

Ini lebih baik daripada:

```java
if (action.equals("APPROVE")) { ... }
else if (action.equals("REJECT")) { ... }
```

Namun tetap jaga:

1. handler tidak saling bergantung secara siklik;
2. action key unik;
3. failure saat duplicate key terdeteksi di startup;
4. ordering eksplisit jika diperlukan.

---

## 39. Bean Ordering

Spring punya beberapa mekanisme ordering:

```text
@Order
Ordered
PriorityOrdered
@Priority
```

Ordering penting untuk:

1. filter chain;
2. interceptor;
3. post processor;
4. event listener;
5. strategy chain;
6. validation chain;
7. custom plugin chain.

Contoh:

```java
@Component
@Order(10)
public class AuthenticationEnricher implements RequestEnricher { }

@Component
@Order(20)
public class TenantEnricher implements RequestEnricher { }
```

Injection:

```java
@Service
public class RequestEnrichmentPipeline {
    private final List<RequestEnricher> enrichers;

    public RequestEnrichmentPipeline(List<RequestEnricher> enrichers) {
        this.enrichers = enrichers;
    }
}
```

Spring akan mengurutkan list sesuai order.

Guideline:

```text
Ordering harus dipakai untuk pipeline/chain.
Jangan pakai ordering untuk menyembunyikan dependency semantic.
Jika B harus berjalan setelah A karena butuh output A, jadikan itu eksplisit dalam desain pipeline.
```

---

## 40. Bean Roles dalam Layered Architecture

Dalam aplikasi enterprise, bean biasanya jatuh ke kategori:

```text
web adapter
application service
domain policy/service
repository adapter
external gateway adapter
configuration
infrastructure support
cross-cutting component
```

Contoh struktur package:

```text
com.example.caseapp
  CaseApplication.java

com.example.caseapp.caseflow.api
  CaseController.java
  CaseRequest.java
  CaseResponse.java

com.example.caseapp.caseflow.application
  SubmitCaseService.java
  ApproveCaseService.java
  CaseActionDispatcher.java

com.example.caseapp.caseflow.domain
  CaseStateMachine.java
  EscalationPolicy.java
  CaseDecision.java

com.example.caseapp.caseflow.persistence
  JpaCaseRepository.java
  CaseEntity.java

com.example.caseapp.caseflow.integration
  NotificationGateway.java
  HttpNotificationGateway.java

com.example.caseapp.caseflow.config
  CaseFlowConfiguration.java
```

Spring tidak memaksa struktur ini. Tapi jika semua bean ditaruh sembarang, container tetap bisa jalan namun sistem sulit berkembang.

Top-tier engineer memakai Spring container untuk memperkuat architecture boundary, bukan menggantikannya.

---

## 41. Java 8 sampai Java 25: Apa yang Berubah untuk IoC Container?

Spring container mental model tetap relatif stabil, tetapi ekosistem Java berubah banyak.

### Java 8 era

Ciri umum:

1. Spring 4/5.
2. Boot 1/2.
3. `javax.*` namespace.
4. Reflection-heavy style normal.
5. Field injection masih banyak di codebase.
6. XML legacy masih sering.
7. Lambdas mulai membuat functional registration lebih nyaman.

### Java 11 era

Ciri umum:

1. Module system sudah ada, tapi banyak Spring app tetap classpath-based.
2. Boot 2 dominan.
3. Containerization makin umum.
4. Stronger pressure untuk explicit dependencies.

### Java 17 era

Ciri umum:

1. Spring Framework 6 / Boot 3 baseline.
2. `jakarta.*` migration.
3. Records mulai banyak untuk config/DTO.
4. Sealed classes bisa membantu domain modeling.
5. AOT/native image lebih serius.

### Java 21 era

Ciri umum:

1. Virtual threads production-ready.
2. Spring Boot mulai mendukung virtual thread mode.
3. Blocking MVC menjadi menarik lagi untuk high concurrency tertentu.
4. ThreadLocal/context propagation perlu dipahami ulang.

### Java 25 era

Ciri umum:

1. LTS modern setelah Java 21.
2. Spring Boot 4 menyatakan dukungan Java 25.
3. Modern Spring codebase makin nyaman memakai records, pattern matching, virtual threads, dan API modern.
4. Legacy Java 8 compatibility bukan lagi baseline untuk Spring modern, tetapi masih penting untuk migrasi.

### Implikasi ke IoC

1. Constructor injection makin natural dengan records/immutability.
2. Reflection masih ada, tetapi AOT/native menekan penggunaan reflection dinamis.
3. Proxy tetap penting, tetapi final/sealed design perlu dipikirkan.
4. Virtual threads tidak menghapus kebutuhan bean scope/context correctness.
5. Legacy XML/`javax.*` tetap harus dipahami untuk migrasi enterprise.

---

## 42. Java Config vs Annotation Scanning vs XML

### XML

Kelebihan:

1. eksplisit;
2. mudah diubah tanpa compile pada masa lalu;
3. umum di legacy;
4. dependency graph terlihat di file config.

Kekurangan:

1. verbose;
2. refactor kurang aman;
3. type-safety terbatas;
4. jauh dari kode;
5. mudah drift.

### Component scanning

Kelebihan:

1. simpel;
2. dekat dengan class;
3. cocok untuk application components;
4. minim boilerplate.

Kekurangan:

1. terlalu implicit untuk library/platform;
2. scan boundary bisa tidak jelas;
3. accidental bean registration;
4. sulit untuk conditional complex setup.

### Java config

Kelebihan:

1. type-safe;
2. explicit;
3. cocok untuk infrastructure;
4. mudah conditional;
5. baik untuk external library object.

Kekurangan:

1. bisa jadi terlalu banyak boilerplate;
2. full mode/lite mode perlu dipahami;
3. inter-bean method call bisa menjebak.

### Rule praktis

```text
Application service      -> component scanning
External/infrastructure  -> @Bean Java config
Legacy compatibility     -> XML jika masih diperlukan
Library/starter          -> auto-configuration/programmatic registration
```

---

## 43. Manual Mini Container untuk Memahami Spring

Untuk memahami IoC, bayangkan container kecil:

```java
public final class MiniContainer {
    private final Map<Class<?>, Object> singletons = new HashMap<>();

    public <T> T getBean(Class<T> type) {
        Object existing = singletons.get(type);
        if (existing != null) {
            return type.cast(existing);
        }

        Constructor<?> constructor = type.getConstructors()[0];
        Object[] args = Arrays.stream(constructor.getParameterTypes())
                .map(this::getBean)
                .toArray();

        try {
            Object instance = constructor.newInstance(args);
            singletons.put(type, instance);
            return type.cast(instance);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }
}
```

Ini hanya ilustrasi. Spring jauh lebih kompleks karena mendukung:

1. multiple constructors;
2. qualifier;
3. generics;
4. factory methods;
5. scopes;
6. lifecycle;
7. circular reference;
8. post-processors;
9. proxies;
10. conditions;
11. environment;
12. resource loading;
13. parent context;
14. type conversion;
15. AOT/native support.

Namun mental model dasarnya tetap:

```text
resolve dependency graph -> instantiate -> initialize -> expose
```

---

## 44. Container dan Proxies: Object yang Anda Dapat Mungkin Bukan Class Asli

Misalnya:

```java
@Service
public class CaseService {
    @Transactional
    public void submit() { }
}
```

Saat Anda inject:

```java
private final CaseService caseService;
```

Yang Anda dapat bisa berupa proxy.

Proxy tersebut melakukan:

```text
before method -> open transaction
invoke target
success -> commit
failure -> rollback
```

Ini penting untuk:

1. `@Transactional`;
2. `@Async`;
3. `@Cacheable`;
4. method security;
5. custom AOP;
6. scoped proxy.

Konsekuensi:

1. final method tidak bisa di-override oleh class proxy;
2. self-invocation melewati proxy;
3. annotation di private method tidak efektif;
4. injection by concrete class bisa bermasalah jika JDK proxy;
5. equality/identity bisa tricky;
6. debugging stack trace punya layer tambahan.

Part proxy/AOP akan dibahas lebih dalam di Part 9, tapi container-level awareness-nya harus dimulai dari sini.

---

## 45. Container Tidak Sama dengan Service Locator

Spring bisa dipakai sebagai service locator:

```java
context.getBean("x")
```

Tapi desain aplikasi sebaiknya tidak begitu.

Service locator membuat dependency tersembunyi:

```java
public class CaseService {
    public void process() {
        AuditService audit = ApplicationContextHolder.getBean(AuditService.class);
        audit.record(...);
    }
}
```

Masalah:

1. dependency tidak terlihat di constructor;
2. unit test sulit;
3. runtime failure lebih lambat;
4. architecture graph tidak jelas;
5. coupling ke Spring meningkat.

Container harus menjadi composition root, bukan global registry yang dipakai sembarang.

Rule:

```text
ApplicationContext boleh ada di edge/bootstrap/infrastructure.
Business logic sebaiknya tidak melakukan getBean manual.
```

---

## 46. Composition Root dalam Spring

Dalam aplikasi manual, composition root adalah tempat object graph dirangkai.

Dalam Spring, composition root tersebar di:

```text
@Configuration classes
component scanning
auto-configuration
import registrar
Boot application class
```

Walaupun tersebar, Anda tetap harus punya mental composition root:

```text
Di mana dependency graph aplikasi didefinisikan?
Siapa yang boleh mendaftarkan bean?
Apa boundary scan?
Apa boundary module?
Apa starter yang aktif?
Apa bean override yang diizinkan?
```

Untuk aplikasi besar, dokumentasikan:

1. root package;
2. module configuration;
3. internal starter;
4. required beans;
5. optional beans;
6. auto-config custom;
7. profile matrix;
8. test context strategy.

---

## 47. Container dan Domain Model

Spring sangat baik untuk application/infrastructure services. Tapi hati-hati memasukkan Spring ke domain model.

Buruk:

```java
@Entity
public class CaseEntity {
    @Autowired
    private EscalationPolicy escalationPolicy;
}
```

Entity biasanya dibuat oleh JPA, bukan Spring. Bahkan jika injection bisa dipaksa, desainnya bocor.

Lebih baik:

```java
@Service
public class EscalationService {
    private final EscalationPolicy escalationPolicy;
    private final CaseRepository caseRepository;

    public void evaluate(String caseId) {
        CaseEntity entity = caseRepository.get(caseId);
        EscalationDecision decision = escalationPolicy.evaluate(entity);
        entity.apply(decision);
    }
}
```

Domain object boleh pure Java. Spring mengorkestrasi use case di application boundary.

Guideline:

```text
Spring should wire the application.
Spring should not invade every domain object.
```

---

## 48. Container dan Testing

Jika desain Anda benar, banyak service bisa diuji tanpa Spring.

Contoh:

```java
@Test
void approveCase() {
    CaseRepository repository = new InMemoryCaseRepository();
    AuditService auditService = new FakeAuditService();
    CaseService service = new CaseService(repository, auditService);

    service.approve("CASE-001");

    assertThat(repository.get("CASE-001").status()).isEqualTo(APPROVED);
}
```

Tidak perlu `@SpringBootTest` untuk semua hal.

Gunakan Spring test jika yang diuji adalah:

1. container wiring;
2. configuration binding;
3. auto-configuration;
4. MVC mapping;
5. transaction integration;
6. security filter chain;
7. repository integration;
8. actuator/observability integration.

Container awareness membantu memilih test level yang tepat.

---

## 49. Common Anti-Patterns di Level Container

### 49.1 Semua dibuat bean

Gejala:

```text
DTO jadi @Component
Command object jadi @Component
Entity jadi @Component
Utility stateless sederhana jadi bean tanpa alasan
```

Masalah:

1. container penuh noise;
2. dependency graph membengkak;
3. startup lambat;
4. ownership lifecycle kabur.

### 49.2 Field injection everywhere

Masalah:

1. dependency tersembunyi;
2. test sulit;
3. immutability hilang;
4. cycle tersembunyi.

### 49.3 `ApplicationContext` dipakai di business code

Masalah:

1. service locator;
2. graph tidak eksplisit;
3. coupling ke framework.

### 49.4 Component scan terlalu luas

```java
@ComponentScan("com.company")
```

Masalah:

1. accidental bean;
2. konflik nama;
3. starter internal ikut ter-scan tanpa sengaja;
4. startup lambat;
5. debugging sulit.

### 49.5 Conditional bean tidak dites

Bean aktif di DEV tapi tidak di PROD karena property berbeda.

Solusi:

```text
test profile matrix
condition report
ApplicationContextRunner untuk auto-config
```

### 49.6 Bean lifecycle melakukan remote call saat startup tanpa kontrol

Contoh buruk:

```java
@PostConstruct
void init() {
    externalSystem.login();
}
```

Risiko:

1. startup gagal karena external dependency sementara down;
2. readiness tidak jelas;
3. retry tidak terkontrol;
4. deployment lambat.

Lebih baik desain eksplisit:

1. lazy client;
2. health indicator;
3. startup validation optional;
4. controlled warmup;
5. retry/backoff.

---

## 50. Production Failure Model

Container failure di production biasanya bukan karena “Spring error”, tetapi karena desain graph/config/lifecycle.

### 50.1 Missing bean only in production

Penyebab:

```text
profile berbeda
condition property berbeda
classpath berbeda
secret/config missing
module tidak ikut packaged
```

Mitigasi:

```text
profile parity test
startup smoke test
condition report capture
configuration validation
explicit required properties
```

### 50.2 Bean creation hangs

Penyebab:

```text
remote call during init
DNS hang
database connection wait
thread pool starvation
blocking call in lifecycle
```

Mitigasi:

```text
no uncontrolled remote call in constructor/@PostConstruct
timeout everything
separate readiness from startup
profile startup with JFR/logging
```

### 50.3 Wrong bean selected

Penyebab:

```text
multiple beans
@Primary accidental
qualifier missing
test configuration leaking
bean override
```

Mitigasi:

```text
explicit qualifier
module-specific config
avoid silent override
context inspection
integration test
```

### 50.4 Circular dependency appears after feature addition

Penyebab:

```text
service layer saling memanggil
shared service jadi dumping ground
event/listener disalahgunakan
application service campur domain orchestration
```

Mitigasi:

```text
refactor boundary
introduce port/policy
split orchestration
publish event after transaction if needed
```

### 50.5 Lazy bean fails on first traffic

Penyebab:

```text
lazy hides broken dependency
rare endpoint untested
optional integration invalid
```

Mitigasi:

```text
startup validation for critical path
smoke test all endpoints
fail fast for required integration
```

---

## 51. Design Heuristics untuk Object Graph Spring

Gunakan aturan berikut saat review desain Spring:

### 51.1 Constructor menunjukkan dependency sebenarnya

Jika constructor terlalu panjang, jangan buru-buru sembunyikan dengan field injection. Itu sinyal service terlalu banyak tanggung jawab.

```text
Long constructor is architectural feedback.
```

### 51.2 Dependency harus mengarah ke bawah/ke dalam

Baik:

```text
Controller -> Application Service -> Domain Policy -> Port Interface
```

Buruk:

```text
Repository -> Service
Domain -> Spring Context
Entity -> Bean
```

### 51.3 Bean lifecycle tidak boleh menyembunyikan business action

Constructor/init method untuk setup object, bukan menjalankan use case.

Buruk:

```java
@PostConstruct
void runMonthlyBilling() { }
```

Lebih baik scheduler/job eksplisit.

### 51.4 Optional dependency harus benar-benar optional

Jika absence merusak correctness, jangan optional.

### 51.5 Context lookup manual harus dianggap code smell

Kecuali infrastructure/dynamic plugin.

### 51.6 Lazy harus punya alasan

Lazy bukan solusi default untuk startup lambat. Startup lambat harus diprofiling.

### 51.7 Auto-configuration harus back off

Jika membangun starter internal:

```text
sediakan default jika user belum punya bean
jangan override keputusan aplikasi
```

---

## 52. Studi Kasus: Regulatory Case Management Service

Bayangkan sistem case management.

Komponen:

```text
CaseController
SubmitCaseService
ApproveCaseService
CaseRepository
AuditTrailRepository
NotificationGateway
EscalationPolicy
CaseStateMachine
CurrentUserProvider
Clock
```

Graph sehat:

```text
CaseController
  -> SubmitCaseService
      -> CaseRepository
      -> CaseStateMachine
      -> AuditTrailWriter
      -> NotificationGateway
      -> Clock

ApproveCaseService
  -> CaseRepository
  -> CaseStateMachine
  -> AuthorizationPolicy
  -> AuditTrailWriter
  -> DomainEventPublisher
```

Bean yang cocok:

```text
SubmitCaseService
ApproveCaseService
CaseRepository implementation
AuditTrailWriter
NotificationGateway implementation
EscalationPolicy
AuthorizationPolicy
Clock bean
```

Bukan bean:

```text
CaseEntity
CaseDecision
SubmitCaseCommand
ApproveCaseRequest
AuditTrailRecord instance
```

### Kenapa `Clock` bagus menjadi bean?

Karena waktu adalah dependency eksternal yang perlu dikontrol di test.

```java
@Configuration
public class TimeConfiguration {
    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
```

Test:

```java
@TestConfiguration
class FixedClockTestConfiguration {
    @Bean
    Clock clock() {
        return Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC);
    }
}
```

Ini contoh bean yang bukan service, tetapi capability runtime.

---

## 53. Studi Kasus: Handler Registry Tanpa Service Locator

Requirement:

```text
Case action bisa APPROVE, REJECT, RETURN_FOR_INFO, ESCALATE.
Setiap action punya handler sendiri.
```

Desain buruk:

```java
@Service
public class CaseActionService {
    @Autowired
    private ApplicationContext context;

    public void handle(String action) {
        CaseActionHandler handler = context.getBean(action + "Handler", CaseActionHandler.class);
        handler.handle();
    }
}
```

Desain lebih baik:

```java
public interface CaseActionHandler {
    CaseAction action();
    void handle(CaseActionCommand command);
}
```

```java
@Component
public class ApproveCaseActionHandler implements CaseActionHandler {
    @Override
    public CaseAction action() {
        return CaseAction.APPROVE;
    }

    @Override
    public void handle(CaseActionCommand command) {
        // approve
    }
}
```

```java
@Service
public class CaseActionRegistry {
    private final Map<CaseAction, CaseActionHandler> handlers;

    public CaseActionRegistry(List<CaseActionHandler> handlers) {
        this.handlers = handlers.stream()
                .collect(Collectors.toUnmodifiableMap(
                        CaseActionHandler::action,
                        Function.identity()
                ));
    }

    public CaseActionHandler get(CaseAction action) {
        CaseActionHandler handler = handlers.get(action);
        if (handler == null) {
            throw new IllegalArgumentException("Unsupported case action: " + action);
        }
        return handler;
    }
}
```

Keuntungan:

1. semua handler terlihat sebagai dependency;
2. duplicate action gagal saat startup;
3. unit test mudah;
4. tidak bergantung ke `ApplicationContext`;
5. handler baru cukup tambah bean baru.

---

## 54. Studi Kasus: Menghindari Circular Dependency

Buruk:

```java
@Service
public class CaseService {
    private final AuditService auditService;

    public CaseService(AuditService auditService) {
        this.auditService = auditService;
    }
}
```

```java
@Service
public class AuditService {
    private final CaseService caseService;

    public AuditService(CaseService caseService) {
        this.caseService = caseService;
    }
}
```

Pertanyaan desain:

```text
Kenapa audit perlu memanggil case service?
Apakah audit hanya butuh snapshot data?
Apakah case service seharusnya mengirim audit event?
Apakah ada port/query service yang lebih kecil?
```

Refactor 1: audit menerima data eksplisit.

```java
@Service
public class CaseService {
    private final AuditService auditService;

    public void approve(String caseId) {
        CaseSnapshot snapshot = ...;
        auditService.recordCaseApproved(snapshot);
    }
}
```

Refactor 2: gunakan event.

```java
public record CaseApprovedEvent(String caseId, String actorId) { }
```

```java
@Service
public class CaseService {
    private final ApplicationEventPublisher publisher;

    public void approve(String caseId) {
        // update case
        publisher.publishEvent(new CaseApprovedEvent(caseId, actorId));
    }
}
```

```java
@Component
public class AuditCaseEventListener {
    private final AuditService auditService;

    @EventListener
    public void on(CaseApprovedEvent event) {
        auditService.record(event);
    }
}
```

Refactor 3: shared query dependency.

```text
CaseService -> CaseRepository
AuditService -> CaseRepository
```

Bukan:

```text
AuditService -> CaseService
```

---

## 55. Checklist: Apakah Anda Benar-benar Memahami IoC Container?

Anda sudah berada di level kuat jika bisa menjawab:

1. Apa beda bean definition dan bean instance?
2. Kapan bean definition dibuat?
3. Kapan singleton bean dibuat?
4. Apa yang terjadi saat `ApplicationContext.refresh()`?
5. Apa beda `BeanFactory` dan `ApplicationContext`?
6. Kenapa `DefaultListableBeanFactory` penting?
7. Apa efek `@Lazy`?
8. Apa beda singleton Spring dan singleton JVM?
9. Apa yang terjadi jika prototype bean di-inject ke singleton?
10. Kenapa circular constructor dependency gagal?
11. Apa beda `BeanFactoryPostProcessor` dan `BeanPostProcessor`?
12. Kenapa `@Transactional` butuh proxy?
13. Kenapa self-invocation membuat annotation tertentu tidak bekerja?
14. Kapan memakai `ApplicationContext.getBean()` boleh?
15. Kenapa field injection buruk untuk desain besar?
16. Apa risiko component scan terlalu luas?
17. Bagaimana parent-child context memengaruhi bean lookup?
18. Bagaimana membaca `NoUniqueBeanDefinitionException`?
19. Kenapa semua object tidak perlu menjadi bean?
20. Bagaimana mendesain handler registry tanpa service locator?

---

## 56. Ringkasan Mental Model

Spring IoC Container dapat diringkas seperti ini:

```text
Spring does not just instantiate classes.
Spring builds, validates, enhances, and manages an application object graph.
```

Urutan mental:

```text
1. Discover configuration/classes
2. Register BeanDefinitions
3. Modify BeanDefinitions through post processors
4. Prepare BeanFactory
5. Register BeanPostProcessors
6. Instantiate non-lazy singleton beans
7. Resolve dependencies
8. Run lifecycle callbacks
9. Apply proxies/wrappers
10. Expose final beans from the context
11. Publish events and manage runtime lifecycle
12. Destroy beans on shutdown
```

Konsep inti:

```text
BeanDefinition  = blueprint
BeanFactory     = core factory and graph engine
ApplicationContext = enterprise runtime context
BeanPostProcessor = instance-level extension
BeanFactoryPostProcessor = metadata-level extension
Scope = relationship between definition and instance
Proxy = object wrapper often exposed as final bean
```

Kesimpulan utama:

```text
Jika Anda memahami container, Anda tidak lagi melihat Spring sebagai magic.
Anda melihatnya sebagai runtime object graph engine dengan extension points yang sangat kuat.
```

---

## 57. Latihan Praktis

### Latihan 1 — Manual context

Buat aplikasi kecil dengan:

```java
AnnotationConfigApplicationContext
```

Daftarkan tiga bean:

```text
CaseRepository
AuditService
CaseService
```

Ambil `CaseService` dengan `getBean()` dan panggil method sederhana.

Tujuan:

```text
memahami bahwa Spring bisa jalan tanpa Boot.
```

### Latihan 2 — Programmatic registration

Gunakan:

```java
GenericApplicationContext
registerBean
refresh
```

Tujuan:

```text
melihat bean registration tanpa annotation scanning.
```

### Latihan 3 — Prototype inside singleton

Buat prototype bean dan inject ke singleton. Cetak identity hash code beberapa kali.

Lalu ubah menjadi `ObjectProvider`.

Tujuan:

```text
memahami scope injection.
```

### Latihan 4 — Circular dependency

Buat constructor cycle:

```text
A -> B -> A
```

Lihat error-nya.

Refactor dengan service ketiga atau event.

Tujuan:

```text
membedakan problem container dan problem desain.
```

### Latihan 5 — BeanPostProcessor

Buat `BeanPostProcessor` yang log semua bean application-level.

Tujuan:

```text
melihat bahwa bean bisa diproses setelah dibuat.
```

### Latihan 6 — BeanFactoryPostProcessor

Buat `BeanFactoryPostProcessor` yang mencetak semua bean definition name sebelum singleton dibuat.

Tujuan:

```text
melihat fase metadata sebelum object.
```

---

## 58. Referensi Resmi yang Relevan

Untuk part ini, rujukan utama adalah dokumentasi resmi Spring Framework bagian Core Container:

1. Spring Framework Reference — Introduction to the Spring IoC Container and Beans.
2. Spring Framework Reference — The BeanFactory API.
3. Spring Framework Reference — Dependencies and Configuration in Detail.
4. Spring Framework Reference — Bean Scopes.
5. Spring Framework Reference — Customizing the Nature of a Bean.
6. Spring Framework Reference — Container Extension Points.
7. Spring Boot Reference — SpringApplication and ApplicationContext startup model.

---

## 59. Status Seri

```text
Part saat ini : 1 dari 35
Status        : belum selesai
Part berikut  : 02-dependency-injection-resolution-algorithm.md
```

Part berikutnya akan membahas lebih dalam algoritma dependency injection:

```text
type matching
constructor resolution
generic resolution
qualifier
primary/fallback
optional dependency
collection injection
circular dependency
lazy resolution
ObjectProvider
```

Di Part 1 ini kita membangun fondasi container. Di Part 2 kita akan masuk ke pertanyaan yang lebih spesifik:

```text
Ketika sebuah constructor meminta dependency X,
bagaimana tepatnya Spring menentukan bean mana yang diberikan?
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./00-spring-as-runtime-scope-roadmap.md">⬅️ Part 0 — Spring as a Runtime: Peta Mental, Scope, dan Batas Seri</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./02-dependency-injection-resolution-algorithm.md">Part 2 — Dependency Injection Resolution Algorithm ➡️</a>
</div>

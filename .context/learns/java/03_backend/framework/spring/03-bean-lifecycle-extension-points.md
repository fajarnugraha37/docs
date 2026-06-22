# 03 — Bean Lifecycle and Extension Points

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> Part: `03-bean-lifecycle-extension-points.md`  
> Topik: Spring Bean Lifecycle, Container Hook, Post Processor, Lifecycle Callback, Startup/Shutdown, dan Extension Architecture  
> Target: Advanced / top 1% Spring engineering mindset  
> Cakupan Java: 8 sampai 25  
> Cakupan Spring: Spring Framework 5.x legacy sampai 7.x modern, Spring Boot 2.x sampai 4.x

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas dua fondasi utama:

1. `BeanDefinition`, `BeanFactory`, dan `ApplicationContext` sebagai struktur dasar container.
2. Dependency injection resolution: bagaimana Spring memilih bean yang akan disuntikkan.

Part ini masuk ke lapisan berikutnya: **kapan dan bagaimana bean hidup**.

Di banyak aplikasi Spring, developer hanya melihat tiga hal:

```java
@Component
public class PaymentService {
    public void pay() {}
}
```

Lalu menganggap Spring bekerja seperti ini:

```text
Spring menemukan class → membuat object → inject dependency → selesai
```

Mental model tersebut terlalu dangkal.

Spring sebenarnya memiliki pipeline lifecycle yang panjang dan sangat extensible:

```text
load configuration metadata
        ↓
register BeanDefinition
        ↓
modify BeanDefinition
        ↓
instantiate infrastructure post-processors
        ↓
instantiate application beans
        ↓
populate dependencies
        ↓
invoke aware callbacks
        ↓
apply BeanPostProcessor before initialization
        ↓
invoke initialization callbacks
        ↓
apply BeanPostProcessor after initialization
        ↓
possibly return proxy, not original object
        ↓
finish singleton initialization
        ↓
publish context events
        ↓
start lifecycle beans
        ↓
serve application traffic
        ↓
stop lifecycle beans
        ↓
destroy singleton beans
```

Jika Anda ingin menjadi engineer Spring level tinggi, Anda harus paham bahwa annotation seperti `@Autowired`, `@Transactional`, `@Async`, `@Cacheable`, `@EventListener`, `@ConfigurationProperties`, `@Scheduled`, `@ControllerAdvice`, dan banyak fitur Spring Boot bukanlah magic. Sebagian besar bekerja melalui **extension points** container.

Part ini membangun mental model agar Anda bisa menjawab pertanyaan seperti:

- Kapan `BeanFactoryPostProcessor` dijalankan?
- Apa bedanya `BeanFactoryPostProcessor` dan `BeanPostProcessor`?
- Kenapa `@Transactional` tidak aktif saat dipanggil dari `@PostConstruct`?
- Kenapa `@Async` tidak bekerja pada method internal call?
- Kenapa beberapa bean dibuat terlalu awal dan kehilangan auto-proxying?
- Kapan `SmartInitializingSingleton` lebih tepat daripada `@PostConstruct`?
- Kapan memakai `ApplicationRunner`, `CommandLineRunner`, `SmartLifecycle`, atau `ApplicationReadyEvent`?
- Bagaimana membuat internal Spring starter yang aman dan predictable?
- Bagaimana shutdown Spring service dengan benar?

---

## 1. Core Mental Model: Bean Lifecycle Bukan Satu Lifecycle

Istilah “bean lifecycle” sering menipu karena seolah-olah hanya ada satu lifecycle.

Dalam Spring, minimal ada beberapa lifecycle yang saling tumpang tindih:

| Lifecycle | Yang Berubah | Contoh Hook |
|---|---|---|
| Metadata lifecycle | `BeanDefinition` | `BeanFactoryPostProcessor`, `BeanDefinitionRegistryPostProcessor` |
| Object lifecycle | instance bean | constructor, dependency injection, aware callback |
| Initialization lifecycle | bean siap dipakai | `@PostConstruct`, `InitializingBean`, init method |
| Post-processing lifecycle | bean dimodifikasi/dibungkus | `BeanPostProcessor`, auto-proxy creator |
| Singleton completion lifecycle | semua singleton non-lazy selesai | `SmartInitializingSingleton` |
| Application lifecycle | context refresh/start/ready/close | `ApplicationListener`, events, runner |
| Runtime lifecycle | component start/stop | `Lifecycle`, `SmartLifecycle` |
| Destruction lifecycle | cleanup resource | `@PreDestroy`, `DisposableBean`, destroy method |

Ini penting karena banyak bug terjadi ketika engineer memakai hook yang salah untuk lifecycle yang salah.

Contoh:

```java
@PostConstruct
void init() {
    orderService.recalculate();
}
```

Kelihatannya aman. Tetapi bisa gagal secara desain jika:

1. `orderService.recalculate()` butuh transaction.
2. Transaction proxy belum siap untuk self method tertentu.
3. Database belum siap.
4. Migration belum selesai.
5. Application belum menerima semua singleton.
6. Bean lain masih sedang dibuat.
7. Context sedang dalam fase refresh, bukan ready.

Top 1% Spring engineer tidak bertanya “annotation apa yang bisa dipakai?” tetapi:

```text
Saya butuh hook pada fase apa?
Apakah saya sedang memodifikasi metadata, object, proxy, runtime, atau external resource?
Apakah semua dependency yang saya perlukan sudah aman digunakan?
Apakah hook ini berjalan sebelum atau sesudah proxy?
Apakah hook ini berjalan sebelum atau sesudah transaction infrastructure siap?
Apakah hook ini berjalan saat startup, refresh, ready, start, stop, atau destroy?
```

---

## 2. Lifecycle Besar `ApplicationContext.refresh()`

Sebagian besar aplikasi Spring modern akhirnya memanggil `ApplicationContext.refresh()`.

Spring Boot memang membungkus proses ini lewat `SpringApplication.run()`, tetapi core container tetap melakukan refresh context.

Secara konseptual, proses refresh terlihat seperti ini:

```text
prepareRefresh()
        ↓
obtainFreshBeanFactory()
        ↓
prepareBeanFactory(beanFactory)
        ↓
postProcessBeanFactory(beanFactory)
        ↓
invokeBeanFactoryPostProcessors(beanFactory)
        ↓
registerBeanPostProcessors(beanFactory)
        ↓
initMessageSource()
        ↓
initApplicationEventMulticaster()
        ↓
onRefresh()
        ↓
registerListeners()
        ↓
finishBeanFactoryInitialization(beanFactory)
        ↓
finishRefresh()
```

Mari ubah ini menjadi mental model engineering:

| Fase | Makna Engineering |
|---|---|
| Prepare refresh | Context mulai di-refresh, environment dan state disiapkan |
| Obtain bean factory | Container internal dibuat/disegarkan |
| Prepare bean factory | Infrastructure dasar didaftarkan |
| Invoke factory post processors | Metadata bean masih bisa diubah |
| Register bean post processors | Hook object-level mulai didaftarkan |
| Initialize event infrastructure | Event system disiapkan |
| Register listeners | Listener siap menerima event |
| Finish bean factory initialization | Singleton application beans dibuat |
| Finish refresh | Context dianggap selesai refresh dan event dipublikasikan |

Dari sini kita dapat membuat rule penting:

```text
BeanFactoryPostProcessor berjalan sebelum kebanyakan bean aplikasi dibuat.
BeanPostProcessor harus sudah terdaftar sebelum bean aplikasi dibuat.
Singleton bean non-lazy dibuat pada finishBeanFactoryInitialization.
Context baru benar-benar siap setelah finishRefresh.
```

Jika Anda membuat custom framework di atas Spring, posisi hook Anda di dalam pipeline ini menentukan correctness.

---

## 3. Metadata Lifecycle: `BeanDefinition` Belum Menjadi Object

Sebelum Spring membuat object, Spring bekerja dengan metadata.

Metadata tersebut bernama `BeanDefinition`.

`BeanDefinition` menyimpan informasi seperti:

- bean class
- bean name
- scope
- constructor arguments
- property values
- init method
- destroy method
- lazy flag
- primary flag
- role
- source metadata
- factory method
- autowire mode
- dependency hints

Pada fase ini, belum ada object aplikasi biasa.

Artinya, jika Anda ingin mengubah definisi bean sebelum object dibuat, gunakan extension point metadata-level:

1. `BeanFactoryPostProcessor`
2. `BeanDefinitionRegistryPostProcessor`

Jangan gunakan `BeanPostProcessor` untuk mengubah metadata fundamental, karena saat `BeanPostProcessor` bekerja, instance bean sudah mulai dibuat.

---

## 4. `BeanFactoryPostProcessor`

`BeanFactoryPostProcessor` adalah hook untuk mengubah metadata bean setelah `BeanDefinition` dimuat tetapi sebelum bean aplikasi dibuat.

Signature konseptual:

```java
public interface BeanFactoryPostProcessor {
    void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory);
}
```

Contoh sederhana:

```java
@Component
public class AuditBeanDefinitionChecker implements BeanFactoryPostProcessor {

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        String[] names = beanFactory.getBeanDefinitionNames();

        for (String name : names) {
            BeanDefinition definition = beanFactory.getBeanDefinition(name);

            if (definition.getBeanClassName() != null
                    && definition.getBeanClassName().contains("Legacy")) {
                definition.setLazyInit(true);
            }
        }
    }
}
```

Namun ini contoh pedagogis, bukan rekomendasi desain untuk production.

Dalam production, `BeanFactoryPostProcessor` biasa dipakai untuk:

1. Membaca dan memvalidasi bean metadata.
2. Menambahkan property value ke bean definition tertentu.
3. Mengubah scope/lazy/init metadata secara sistematis.
4. Menegakkan convention internal.
5. Mengintegrasikan framework custom.
6. Menyiapkan placeholder/config infrastructure.

### 4.1 Yang Harus Dihindari

Jangan memanggil `beanFactory.getBean(...)` sembarangan di dalam `BeanFactoryPostProcessor`.

Contoh buruk:

```java
@Component
public class BadPostProcessor implements BeanFactoryPostProcessor {

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        PaymentService service = beanFactory.getBean(PaymentService.class);
        service.warmup();
    }
}
```

Kenapa buruk?

Karena Anda memaksa bean aplikasi dibuat terlalu awal.

Dampaknya:

1. Bean bisa dibuat sebelum semua `BeanPostProcessor` terdaftar.
2. Bean bisa tidak mendapatkan proxy AOP.
3. `@Transactional`, `@Async`, `@Cacheable`, atau instrumentation bisa tidak aktif.
4. Dependency graph bisa terbentuk dalam fase yang belum stabil.
5. Startup order menjadi sulit diprediksi.

Rule:

```text
BeanFactoryPostProcessor seharusnya bekerja pada metadata, bukan memakai bean aplikasi.
```

---

## 5. `BeanDefinitionRegistryPostProcessor`

`BeanDefinitionRegistryPostProcessor` adalah versi lebih awal dan lebih kuat daripada `BeanFactoryPostProcessor`.

Ia bisa menambah atau menghapus `BeanDefinition` sebelum post processor biasa berjalan.

Signature konseptual:

```java
public interface BeanDefinitionRegistryPostProcessor
        extends BeanFactoryPostProcessor {

    void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry);
}
```

Gunakan ini ketika Anda perlu **mendaftarkan bean definition baru secara programmatic**.

Contoh:

```java
public class TenantClientRegistrar implements BeanDefinitionRegistryPostProcessor {

    @Override
    public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) {
        RootBeanDefinition definition = new RootBeanDefinition(TenantClient.class);
        definition.setScope(BeanDefinition.SCOPE_SINGLETON);
        definition.setLazyInit(false);

        registry.registerBeanDefinition("tenantClient", definition);
    }

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        // optional metadata-level processing after registry phase
    }
}
```

Use case nyata:

1. Framework yang membuat bean berdasarkan annotation custom.
2. Multi-tenant client factory.
3. Internal starter yang generate typed client beans.
4. Repository-like abstraction.
5. Mapper/adapter registration.
6. Dynamic integration endpoint registration.

### 5.1 Registry Post Processor Lebih Berbahaya

Karena ia bekerja sangat awal, kesalahan kecil bisa berdampak luas.

Risiko:

1. Bean definition name collision.
2. Bean role salah.
3. Scope salah.
4. Class tidak tersedia dalam semua runtime profile.
5. Conditional logic salah.
6. Auto-configuration back-off tidak bekerja.
7. Test context berbeda dari production context.

Guideline:

```text
Gunakan BeanDefinitionRegistryPostProcessor hanya jika Anda benar-benar perlu membuat/mengubah daftar BeanDefinition.
Jika hanya ingin mengubah metadata yang sudah ada, BeanFactoryPostProcessor cukup.
Jika hanya ingin memodifikasi object setelah dibuat, BeanPostProcessor lebih tepat.
```

---

## 6. Ordering Pada Factory Post Processor

Karena factory post processor dapat mengubah metadata, urutan eksekusi sangat penting.

Spring mengenal beberapa mekanisme ordering:

1. `PriorityOrdered`
2. `Ordered`
3. `@Order`
4. unordered default

Urutan konseptual:

```text
PriorityOrdered
    ↓
Ordered
    ↓
non-ordered
```

Contoh:

```java
@Component
public class PlatformConventionPostProcessor
        implements BeanFactoryPostProcessor, PriorityOrdered {

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 100;
    }

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        // enforce platform metadata conventions
    }
}
```

Namun jangan terlalu cepat memakai `HIGHEST_PRECEDENCE`.

Jika semua infrastructure ingin menjadi paling awal, ordering menjadi perang prioritas.

Rule praktis:

```text
Gunakan ordering hanya ketika ada dependency ordering yang eksplisit.
Jangan gunakan ordering sebagai cara menutupi desain yang tidak jelas.
```

---

## 7. Object Lifecycle: Dari Instantiation Sampai Ready Bean

Setelah metadata final, Spring mulai membuat bean instance.

Lifecycle object-level untuk singleton normal kira-kira:

```text
resolve bean class
        ↓
choose constructor / factory method
        ↓
instantiate object
        ↓
early singleton exposure if needed
        ↓
populate dependencies
        ↓
invoke aware callbacks
        ↓
BeanPostProcessor before initialization
        ↓
invoke init callbacks
        ↓
BeanPostProcessor after initialization
        ↓
store singleton / expose final bean
```

Mari bedah satu per satu.

---

## 8. Constructor / Factory Method Selection

Spring perlu menentukan bagaimana object dibuat.

Kemungkinan:

1. Constructor default.
2. Constructor tunggal.
3. Constructor dengan `@Autowired`.
4. Constructor dengan resolvable arguments.
5. Static factory method.
6. Instance factory method.
7. Supplier-based registration.
8. FactoryBean.

Contoh constructor:

```java
@Service
public class InvoiceService {

    private final InvoiceRepository repository;
    private final Clock clock;

    public InvoiceService(InvoiceRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }
}
```

Contoh factory method:

```java
@Configuration(proxyBeanMethods = false)
class ClientConfiguration {

    @Bean
    PaymentClient paymentClient(PaymentClientProperties properties) {
        return new PaymentClient(properties.baseUrl(), properties.timeout());
    }
}
```

Mental model:

```text
Constructor/factory method adalah fase pembuatan object mentah.
Dependency injection constructor terjadi sebelum object instance selesai dibuat.
Setter/field/property injection terjadi setelah instance ada.
```

---

## 9. Early Singleton Exposure dan Circular Dependency

Spring memiliki mekanisme internal untuk mengekspos singleton lebih awal dalam skenario circular dependency tertentu.

Contoh setter cycle:

```java
@Component
class A {
    @Autowired B b;
}

@Component
class B {
    @Autowired A a;
}
```

Untuk kasus seperti ini, Spring dapat membuat `A` mentah, mengekspos referensi awal, lalu menyelesaikan `B`, lalu kembali menyelesaikan `A`.

Tetapi ini hanya bekerja untuk pola tertentu dan sangat berbahaya secara desain.

Constructor cycle tidak dapat diselesaikan:

```java
@Component
class A {
    A(B b) {}
}

@Component
class B {
    B(A a) {}
}
```

Mental model:

```text
Early exposure adalah emergency mechanism, bukan desain arsitektur.
```

Risiko early reference:

1. Bean belum fully initialized.
2. Proxy mungkin belum final.
3. State belum lengkap.
4. Method dipanggil terlalu awal.
5. Lifecycle callback belum selesai.

Guideline:

```text
Jika circular dependency muncul, anggap itu sinyal desain boundary yang buruk.
Pecahkan dengan event, mediator, port abstraction, command handler, atau memisahkan stateful coordination dari service dependency.
```

---

## 10. Dependency Population

Setelah instance dibuat, Spring mengisi dependency non-constructor:

1. Field injection.
2. Setter injection.
3. Property value dari XML/BeanDefinition.
4. Autowired method.
5. Resource injection.

Contoh method injection:

```java
@Component
class ReportService {

    private ReportFormatter formatter;

    @Autowired
    void configure(ReportFormatter formatter) {
        this.formatter = formatter;
    }
}
```

Field injection tampak ringkas:

```java
@Autowired
private ReportFormatter formatter;
```

Namun untuk service core, constructor injection lebih baik karena:

1. Dependency eksplisit.
2. Object dapat dibuat tanpa container.
3. Required dependency menjadi immutable.
4. Test lebih sederhana.
5. Circular dependency lebih cepat terdeteksi.

Part 2 sudah membahas resolution algorithm. Di Part 3 yang penting adalah fase-nya:

```text
Constructor injection terjadi saat instantiation.
Field/setter/method injection terjadi setelah object mentah dibuat.
Aware callbacks terjadi setelah dependency population.
Initialization callbacks terjadi setelah aware callbacks.
```

---

## 11. Aware Callback Interfaces

Spring menyediakan beberapa interface `Aware` agar bean dapat menerima object infrastructure dari container.

Contoh umum:

| Interface | Memberikan Akses Ke |
|---|---|
| `BeanNameAware` | nama bean |
| `BeanClassLoaderAware` | class loader |
| `BeanFactoryAware` | bean factory |
| `ApplicationContextAware` | application context |
| `EnvironmentAware` | environment |
| `ResourceLoaderAware` | resource loader |
| `ApplicationEventPublisherAware` | event publisher |
| `MessageSourceAware` | message source |

Contoh:

```java
@Component
public class AuditPublisher implements ApplicationEventPublisherAware {

    private ApplicationEventPublisher publisher;

    @Override
    public void setApplicationEventPublisher(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    public void publish(AuditEvent event) {
        publisher.publishEvent(event);
    }
}
```

Namun di modern Spring, constructor injection sering lebih jelas:

```java
@Component
public class AuditPublisher {

    private final ApplicationEventPublisher publisher;

    public AuditPublisher(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }
}
```

### 11.1 Kapan `Aware` Masih Masuk Akal?

`Aware` masuk akal untuk infrastructure-level bean, misalnya:

1. Custom framework integration.
2. Bean yang benar-benar perlu tahu nama bean-nya.
3. Resource loading abstraction.
4. Low-level adapter ke container.
5. Library internal yang tidak ingin expose dependency melalui public constructor API.

Untuk application service biasa, `Aware` sering menjadi smell.

### 11.2 `ApplicationContextAware` Abuse

Contoh buruk:

```java
@Component
public class PaymentService implements ApplicationContextAware {

    private ApplicationContext context;

    @Override
    public void setApplicationContext(ApplicationContext context) {
        this.context = context;
    }

    public void pay(String type) {
        PaymentProcessor processor = context.getBean(type, PaymentProcessor.class);
        processor.process();
    }
}
```

Ini service locator disguised as DI.

Lebih baik:

```java
@Component
public class PaymentService {

    private final Map<String, PaymentProcessor> processors;

    public PaymentService(Map<String, PaymentProcessor> processors) {
        this.processors = Map.copyOf(processors);
    }

    public void pay(String type) {
        PaymentProcessor processor = processors.get(type);
        if (processor == null) {
            throw new UnknownPaymentTypeException(type);
        }
        processor.process();
    }
}
```

Rule:

```text
ApplicationContextAware adalah infrastructure tool, bukan application design pattern.
```

---

## 12. `BeanPostProcessor`: Hook Object-Level

`BeanPostProcessor` adalah extension point paling penting untuk object-level customization.

Signature konseptual:

```java
public interface BeanPostProcessor {

    default Object postProcessBeforeInitialization(Object bean, String beanName) {
        return bean;
    }

    default Object postProcessAfterInitialization(Object bean, String beanName) {
        return bean;
    }
}
```

Ia berjalan untuk setiap bean yang dibuat container.

Dua fase utama:

```text
before initialization
        ↓
init callback
        ↓
after initialization
```

`BeanPostProcessor` bisa:

1. Memvalidasi bean.
2. Mengubah property object.
3. Membungkus object dengan proxy.
4. Membaca annotation custom.
5. Mendaftarkan metadata runtime.
6. Menyuntikkan dependency khusus.
7. Mengaktifkan framework feature.

Banyak fitur Spring dibangun melalui `BeanPostProcessor`.

Contoh konseptual:

```java
@Component
public class MonitoredBeanPostProcessor implements BeanPostProcessor {

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        Class<?> type = bean.getClass();

        if (type.isAnnotationPresent(MonitoredComponent.class)) {
            return createMonitoringProxy(bean);
        }

        return bean;
    }

    private Object createMonitoringProxy(Object bean) {
        // simplified example only
        return bean;
    }
}
```

### 12.1 Kenapa `BeanPostProcessor` Sangat Penting?

Karena ia menjelaskan banyak magic Spring:

| Fitur | Mekanisme Umum |
|---|---|
| `@Autowired` | post processor untuk dependency injection annotation |
| `@PostConstruct` | post processor untuk init annotation |
| `@PreDestroy` | destruction-aware processing |
| AOP auto-proxy | post processor yang membungkus bean |
| `@Transactional` | AOP proxy via auto-proxy infrastructure |
| `@Async` | AOP/proxy-based method interception |
| `@Cacheable` | AOP/proxy-based method interception |
| `@Scheduled` | post processor yang mendaftarkan scheduled method |
| `@EventListener` | post processor yang mendaftarkan event listener method |

Ketika Anda bertanya “kenapa annotation ini tidak bekerja?”, sering jawabannya ada di lifecycle `BeanPostProcessor`.

---

## 13. `postProcessBeforeInitialization` vs `postProcessAfterInitialization`

Perbedaan ini sangat penting.

### 13.1 Before Initialization

Dipanggil sebelum init callback:

```text
populate properties
        ↓
aware callbacks
        ↓
postProcessBeforeInitialization
        ↓
@PostConstruct / afterPropertiesSet / init method
```

Cocok untuk:

1. Inject helper sebelum init.
2. Validasi state sebelum init.
3. Memproses annotation yang mempengaruhi init.

### 13.2 After Initialization

Dipanggil setelah init callback:

```text
init callback
        ↓
postProcessAfterInitialization
        ↓
final bean exposed
```

Cocok untuk:

1. Membuat proxy.
2. Wrapping bean setelah fully initialized.
3. Register runtime endpoint.
4. Build adapter final.

Proxy biasanya dibuat di after initialization.

Konsekuensi penting:

```text
Di dalam @PostConstruct, bean tersebut biasanya belum berada dalam bentuk final proxy untuk self-invocation.
```

Contoh masalah:

```java
@Service
public class InvoiceService {

    @PostConstruct
    void init() {
        generateMonthlyInvoice();
    }

    @Transactional
    public void generateMonthlyInvoice() {
        // transaction may not behave as expected for self-call
    }
}
```

`init()` memanggil method pada `this`, bukan melalui proxy.

Solusi lebih baik:

1. Pindahkan startup logic ke bean lain.
2. Gunakan `ApplicationRunner` jika logic harus setelah context siap.
3. Gunakan event listener `ApplicationReadyEvent` jika butuh app ready.
4. Jangan jalankan business transaction berat di `@PostConstruct`.

---

## 14. Initialization Callback

Spring mendukung beberapa cara init callback:

1. `@PostConstruct`
2. `InitializingBean.afterPropertiesSet()`
3. custom init method pada `@Bean(initMethod = "...")`
4. XML init-method di legacy app

Urutan umum:

```text
@PostConstruct
        ↓
InitializingBean.afterPropertiesSet()
        ↓
custom init method
```

Contoh `@PostConstruct`:

```java
@Component
class CurrencyTable {

    private Map<String, Integer> scaleByCurrency;

    @PostConstruct
    void initialize() {
        this.scaleByCurrency = Map.of(
                "IDR", 0,
                "USD", 2,
                "JPY", 0
        );
    }
}
```

Contoh `InitializingBean`:

```java
@Component
class ReportTemplateRegistry implements InitializingBean {

    @Override
    public void afterPropertiesSet() {
        validateTemplates();
    }
}
```

Contoh custom init method:

```java
@Configuration(proxyBeanMethods = false)
class ClientConfig {

    @Bean(initMethod = "connect")
    ExternalClient externalClient() {
        return new ExternalClient();
    }
}
```

### 14.1 Kapan Pakai Apa?

| Hook | Cocok Untuk | Catatan |
|---|---|---|
| `@PostConstruct` | init sederhana setelah dependency tersedia | Standard annotation style |
| `InitializingBean` | bean Spring-aware/infrastructure | Coupling ke Spring |
| custom init method | third-party object | Tidak perlu class implement Spring interface |
| `SmartInitializingSingleton` | logic setelah semua singleton siap | Lebih aman untuk cross-bean coordination |
| `ApplicationRunner` | startup application logic | Setelah context refresh |
| `ApplicationReadyEvent` | logic setelah app ready | Hati-hati blocking startup readiness |

### 14.2 Apa yang Tidak Boleh di Init Callback?

Hindari:

1. Remote call berat.
2. Query besar ke database.
3. Migration data.
4. Recalculation domain besar.
5. Publish event business yang butuh listener final.
6. Memanggil method sendiri yang bergantung pada AOP.
7. Start thread manual tanpa lifecycle management.
8. Membuka socket tanpa cleanup.
9. Mengubah global static state sembarangan.

Init callback idealnya:

```text
validasi state lokal
membangun immutable lookup lokal
mengecek konfigurasi cepat
mendaftarkan resource internal
```

Bukan:

```text
menjalankan proses bisnis besar
menginisialisasi dunia eksternal secara tidak terkendali
```

---

## 15. Destruction Callback

Saat context ditutup, Spring melakukan destroy lifecycle untuk singleton beans.

Cara umum:

1. `@PreDestroy`
2. `DisposableBean.destroy()`
3. custom destroy method pada `@Bean(destroyMethod = "...")`
4. inferred destroy method seperti `close()` atau `shutdown()` untuk beberapa bean

Contoh:

```java
@Component
class AuditBuffer {

    @PreDestroy
    void shutdown() {
        flushRemainingEvents();
    }
}
```

Contoh third-party resource:

```java
@Configuration(proxyBeanMethods = false)
class ClientConfig {

    @Bean(destroyMethod = "close")
    ExternalClient externalClient() {
        return new ExternalClient();
    }
}
```

### 15.1 Destruction Tidak Selalu Terjadi

Destroy callback berjalan saat context ditutup secara normal.

Namun jangan mengasumsikan selalu berjalan dalam semua kondisi:

1. Process crash.
2. `kill -9`.
3. Node mati.
4. Container runtime hard kill setelah grace period habis.
5. JVM fatal error.
6. OOM fatal tertentu.

Maka destruction callback tidak boleh menjadi satu-satunya mekanisme correctness.

Contoh buruk:

```text
Data dianggap committed hanya setelah @PreDestroy flush.
```

Itu salah.

Correctness harus dijaga saat runtime normal, bukan ditunda sampai shutdown.

### 15.2 Shutdown Engineering

Untuk production service:

1. Pastikan orchestrator memberi termination grace period cukup.
2. Pastikan server berhenti menerima request baru.
3. Pastikan in-flight request diberi waktu selesai.
4. Pastikan listener messaging berhenti menarik message baru.
5. Pastikan scheduler berhenti menjadwalkan task baru.
6. Pastikan executor shutdown terukur.
7. Pastikan resource close idempotent.
8. Pastikan shutdown log jelas.

Spring lifecycle callback hanya satu bagian dari shutdown architecture.

---

## 16. `SmartInitializingSingleton`

`SmartInitializingSingleton` dipanggil setelah semua singleton non-lazy selesai dibuat.

Signature konseptual:

```java
public interface SmartInitializingSingleton {
    void afterSingletonsInstantiated();
}
```

Ini sangat berguna untuk use case yang membutuhkan semua singleton sudah tersedia.

Contoh:

```java
@Component
public class HandlerRegistry implements SmartInitializingSingleton {

    private final List<CommandHandler<?>> handlers;
    private final Map<Class<?>, CommandHandler<?>> registry = new HashMap<>();

    public HandlerRegistry(List<CommandHandler<?>> handlers) {
        this.handlers = handlers;
    }

    @Override
    public void afterSingletonsInstantiated() {
        for (CommandHandler<?> handler : handlers) {
            Class<?> commandType = resolveCommandType(handler);
            registry.put(commandType, handler);
        }
    }
}
```

Kenapa tidak di constructor?

Karena di constructor, semua singleton lain belum tentu selesai lifecycle-nya.

Kenapa tidak di `@PostConstruct`?

Karena `@PostConstruct` pada registry bisa berjalan sebelum bean lain selesai dibuat.

`SmartInitializingSingleton` cocok untuk:

1. Build registry dari semua beans tipe tertentu.
2. Validate global uniqueness.
3. Cross-bean consistency check.
4. Fail-fast jika ada duplicate handler.
5. Build immutable dispatch table.

Namun tetap bukan tempat ideal untuk business process berat.

Rule:

```text
@PostConstruct cocok untuk local bean initialization.
SmartInitializingSingleton cocok untuk global singleton graph validation/registry.
```

---

## 17. `Lifecycle` dan `SmartLifecycle`

Spring memiliki interface untuk komponen yang bisa start dan stop.

Basic:

```java
public interface Lifecycle {
    void start();
    void stop();
    boolean isRunning();
}
```

Lebih advanced:

```java
public interface SmartLifecycle extends Lifecycle, Phased {
    boolean isAutoStartup();
    void stop(Runnable callback);
}
```

`SmartLifecycle` cocok untuk komponen runtime seperti:

1. Listener container.
2. Polling endpoint.
3. Background worker.
4. Message consumer.
5. Internal scheduler adapter.
6. Long-running integration flow.
7. Network server tambahan.

Contoh sederhana:

```java
@Component
public class CaseEscalationWorker implements SmartLifecycle {

    private final AtomicBoolean running = new AtomicBoolean(false);
    private ExecutorService executor;

    @Override
    public void start() {
        if (running.compareAndSet(false, true)) {
            executor = Executors.newSingleThreadExecutor();
            executor.submit(this::loop);
        }
    }

    private void loop() {
        while (running.get()) {
            // poll and process safely
        }
    }

    @Override
    public void stop() {
        running.set(false);
        if (executor != null) {
            executor.shutdown();
        }
    }

    @Override
    public void stop(Runnable callback) {
        stop();
        callback.run();
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }

    @Override
    public boolean isAutoStartup() {
        return true;
    }

    @Override
    public int getPhase() {
        return 100;
    }
}
```

Catatan: contoh di atas hanya ilustrasi. Untuk production, gunakan executor yang dikelola Spring, interruption handling, timeout, backoff, observability, dan graceful shutdown yang lebih matang.

### 17.1 Phase Semantics

`SmartLifecycle` punya phase.

Rule konseptual:

```text
Startup: phase kecil mulai lebih dulu.
Shutdown: phase besar berhenti lebih dulu.
```

Ini berguna jika ada dependency runtime.

Contoh:

```text
Database connection infrastructure: phase 0
Message consumer: phase 100
Outbound publisher: phase 200
```

Saat startup:

```text
infra → consumer → publisher
```

Saat shutdown:

```text
publisher → consumer → infra
```

### 17.2 Kapan Pakai `SmartLifecycle`?

Pakai ketika bean Anda adalah runtime component yang punya state running/stopped.

Jangan pakai untuk sekadar validasi config atau init ringan.

| Kebutuhan | Hook Lebih Tepat |
|---|---|
| Validasi config lokal | `@PostConstruct` |
| Validasi semua handler unik | `SmartInitializingSingleton` |
| Jalankan worker background | `SmartLifecycle` |
| Jalankan logic sekali saat app start | `ApplicationRunner` |
| Jalankan logic setelah app siap | `ApplicationReadyEvent` |
| Cleanup resource | `@PreDestroy`/destroy method |

---

## 18. Application Events Pada Lifecycle

`ApplicationContext` mempublikasikan event lifecycle.

Event penting:

| Event | Makna |
|---|---|
| `ContextRefreshedEvent` | context selesai refresh |
| `ContextStartedEvent` | context start dipanggil |
| `ContextStoppedEvent` | context stop dipanggil |
| `ContextClosedEvent` | context ditutup |

Spring Boot menambahkan event startup yang lebih kaya, misalnya:

| Event Boot | Makna Umum |
|---|---|
| `ApplicationStartingEvent` | sangat awal |
| `ApplicationEnvironmentPreparedEvent` | environment siap |
| `ApplicationContextInitializedEvent` | context dibuat dan initialized |
| `ApplicationPreparedEvent` | context prepared, bean definitions loaded |
| `ApplicationStartedEvent` | context refreshed, app started |
| `ApplicationReadyEvent` | app siap melayani request |
| `ApplicationFailedEvent` | startup gagal |

Contoh:

```java
@Component
public class StartupLogger {

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        log.info("Application is ready to serve traffic");
    }
}
```

### 18.1 Event Listener Juga Bean

`@EventListener` diproses oleh infrastructure Spring.

Artinya:

1. Listener method ditemukan oleh post processor.
2. Listener didaftarkan ke event multicaster.
3. Listener bisa dipengaruhi proxy.
4. Listener ordering perlu dipikirkan jika ada dependency urutan.
5. Listener exception bisa mempengaruhi publisher tergantung mode sync/async.

### 18.2 Jangan Memakai Event Untuk Menutupi Boundary Buruk

Event bagus untuk decoupling.

Tetapi event bisa menjadi invisible coupling jika:

1. Terlalu banyak side effect tersembunyi.
2. Tidak ada ownership jelas.
3. Tidak ada tracing.
4. Tidak ada failure handling.
5. Listener mengubah state kritikal tanpa transaction model jelas.

Guideline:

```text
Application event cocok untuk intra-process decoupling.
Untuk cross-service communication, gunakan integration event/outbox/messaging dengan delivery semantics jelas.
```

---

## 19. `ApplicationRunner` dan `CommandLineRunner`

Spring Boot menyediakan runner untuk menjalankan logic setelah application context siap.

```java
@Component
public class DataWarmupRunner implements ApplicationRunner {

    @Override
    public void run(ApplicationArguments args) {
        // startup logic
    }
}
```

```java
@Component
public class CliRunner implements CommandLineRunner {

    @Override
    public void run(String... args) {
        // startup logic using raw args
    }
}
```

Perbedaan utama:

| Runner | Input |
|---|---|
| `CommandLineRunner` | raw `String... args` |
| `ApplicationRunner` | parsed `ApplicationArguments` |

Use case:

1. CLI app.
2. One-shot job.
3. Startup validation yang butuh context siap.
4. Optional cache warmup.
5. Environment banner/report.

Hati-hati pada web service production:

```text
Runner yang blocking lama dapat menunda readiness.
Runner yang gagal dapat menggagalkan startup.
Runner yang melakukan side effect harus idempotent.
```

Jika service berjalan dalam Kubernetes, startup runner yang lama dapat berinteraksi dengan startup/readiness probe.

---

## 20. `@PostConstruct` vs `ApplicationReadyEvent` vs Runner

Ini sering membingungkan.

| Hook | Waktu | Cocok Untuk | Risiko |
|---|---|---|---|
| `@PostConstruct` | bean selesai dependency injection | init lokal | belum semua bean/context siap |
| `SmartInitializingSingleton` | semua singleton non-lazy selesai | registry/validation global | belum tentu app ready melayani traffic |
| `ApplicationRunner` | setelah context started | startup task | bisa delay/fail startup |
| `ApplicationReadyEvent` | aplikasi siap | post-start notification/warmup ringan | side effect setelah readiness bisa berbahaya |
| `SmartLifecycle.start()` | lifecycle start phase | runtime component | perlu stop/shutdown benar |

Rule praktis:

```text
Local object state → @PostConstruct
Global singleton registry → SmartInitializingSingleton
One-time startup command → ApplicationRunner
After app ready signal → ApplicationReadyEvent
Long-running component → SmartLifecycle
```

---

## 21. Proxy Creation Dalam Lifecycle

Proxy sering dibuat oleh `BeanPostProcessor`, terutama dalam fase after initialization.

Contoh fitur berbasis proxy:

1. Transaction.
2. Security method.
3. Async.
4. Cache.
5. Retry.
6. Custom AOP.

Lifecycle proxy secara konseptual:

```text
create original bean
        ↓
inject dependencies
        ↓
run init callbacks
        ↓
auto-proxy creator checks advisors
        ↓
if needed, create proxy wrapping target
        ↓
expose proxy as bean
```

Konsekuensi besar:

```text
Bean yang diterima oleh bean lain mungkin proxy, bukan object asli.
```

Contoh:

```java
@Service
public class BillingService {

    @Transactional
    public void charge() {}
}
```

Bean final yang diekspos bisa berupa proxy.

Jika bean lain inject `BillingService`, ia menerima proxy.

Tetapi method internal call tetap lewat `this`:

```java
@Service
public class BillingService {

    public void process() {
        charge(); // self-invocation, bypass proxy
    }

    @Transactional
    public void charge() {}
}
```

`charge()` tidak dipanggil melalui proxy.

Top-tier Spring design tidak bergantung pada harapan bahwa annotation selalu aktif. Ia memahami boundary proxy.

---

## 22. BeanPostProcessor dan Early Bean Creation Problem

Jika bean dibuat sebelum semua `BeanPostProcessor` terdaftar, Spring sering memberi warning seperti:

```text
Bean 'x' is not eligible for getting processed by all BeanPostProcessors
```

Maknanya:

```text
Bean ini dibuat terlalu awal sehingga mungkin tidak mendapatkan semua post-processing, termasuk proxy.
```

Penyebab umum:

1. `BeanFactoryPostProcessor` memanggil `getBean()`.
2. BeanPostProcessor punya dependency ke bean aplikasi biasa.
3. Infrastructure bean terlalu eager.
4. Static initialization memicu akses context.
5. FactoryBean membuat object terlalu awal.

Contoh buruk:

```java
@Component
public class MyBeanPostProcessor implements BeanPostProcessor {

    private final PaymentService paymentService;

    public MyBeanPostProcessor(PaymentService paymentService) {
        this.paymentService = paymentService;
    }
}
```

Masalahnya, `PaymentService` mungkin harus dibuat saat post processor dibuat. Akibatnya `PaymentService` bisa tidak diproses oleh semua post processor.

Solusi:

1. Jangan inject application bean ke `BeanPostProcessor`.
2. Inject `ObjectProvider<T>` jika benar-benar perlu lazy access.
3. Pisahkan metadata collector dari runtime service.
4. Gunakan bean name/type metadata, bukan instance.
5. Gunakan `ApplicationContext` dengan sangat hati-hati.

Lebih aman:

```java
@Component
public class MyBeanPostProcessor implements BeanPostProcessor {

    private final ObjectProvider<PaymentService> paymentServiceProvider;

    public MyBeanPostProcessor(ObjectProvider<PaymentService> paymentServiceProvider) {
        this.paymentServiceProvider = paymentServiceProvider;
    }
}
```

Namun bahkan ini pun harus digunakan hati-hati. Jangan memanggil provider saat fase post processor masih sensitif kecuali Anda benar-benar paham akibatnya.

---

## 23. `FactoryBean` Lifecycle

`FactoryBean<T>` adalah bean yang menghasilkan object lain.

Jangan bingung:

```text
FactoryBean object ≠ object yang dihasilkan FactoryBean
```

Interface konseptual:

```java
public interface FactoryBean<T> {
    T getObject();
    Class<?> getObjectType();
    boolean isSingleton();
}
```

Contoh:

```java
public class ClientFactoryBean implements FactoryBean<ExternalClient> {

    @Override
    public ExternalClient getObject() {
        return new ExternalClient();
    }

    @Override
    public Class<?> getObjectType() {
        return ExternalClient.class;
    }

    @Override
    public boolean isSingleton() {
        return true;
    }
}
```

Jika bean name adalah `externalClient`, maka:

```java
context.getBean("externalClient")
```

mengembalikan object hasil factory.

Untuk mendapatkan factory-nya sendiri:

```java
context.getBean("&externalClient")
```

### 23.1 Kapan FactoryBean Masuk Akal?

1. Membuat proxy object kompleks.
2. Membuat client dari metadata.
3. Membuat mapper/repository dynamic.
4. Integrasi framework lama.
5. Object creation perlu lifecycle Spring tetapi object target bukan bean biasa.

### 23.2 Risiko FactoryBean

1. `getObjectType()` tidak akurat membuat autowiring bermasalah.
2. `getObject()` terlalu berat saat startup.
3. Singleton caching salah.
4. Object target tidak mendapatkan lifecycle penuh yang Anda kira.
5. AOT/native image lebih sulit jika dynamic berlebihan.

Rule:

```text
FactoryBean adalah infrastructure tool. Untuk application code biasa, @Bean factory method biasanya lebih jelas.
```

---

## 24. Custom Scope

Spring punya scope bawaan:

1. singleton
2. prototype
3. request
4. session
5. application
6. websocket

Anda juga bisa membuat custom scope.

Interface konseptual:

```java
public interface Scope {
    Object get(String name, ObjectFactory<?> objectFactory);
    Object remove(String name);
    void registerDestructionCallback(String name, Runnable callback);
    Object resolveContextualObject(String key);
    String getConversationId();
}
```

Use case custom scope:

1. Tenant scope.
2. Job execution scope.
3. Workflow/case scope.
4. Batch step scope.
5. Request-like scope di non-web runtime.
6. Test scenario scope.

Contoh konseptual tenant scope:

```text
tenant A request → tenant-scoped bean A
tenant B request → tenant-scoped bean B
```

Tetapi custom scope sangat berbahaya jika context propagation tidak kuat.

Risiko:

1. Memory leak karena scoped object tidak dibersihkan.
2. Tenant bleed karena context salah.
3. ThreadLocal tidak dibersihkan.
4. Async task kehilangan scope.
5. Scheduler tidak punya scope.
6. Reactive flow tidak kompatibel dengan ThreadLocal scope biasa.

Guideline:

```text
Sebelum membuat custom scope, pastikan Anda punya lifecycle scope yang jelas: kapan scope mulai, kapan berakhir, siapa cleanup, bagaimana propagation, dan bagaimana failure handling.
```

---

## 25. Prototype Bean Lifecycle

Singleton bean dikelola penuh oleh Spring dari create sampai destroy.

Prototype bean berbeda.

Spring membuat prototype bean saat diminta, melakukan dependency injection dan initialization, tetapi **tidak mengelola destroy lifecycle secara otomatis** seperti singleton.

Mental model:

```text
singleton: Spring creates + initializes + stores + destroys
prototype: Spring creates + initializes + hands over; caller responsible after that
```

Contoh:

```java
@Component
@Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
class ReportBuilder {
    // stateful builder
}
```

Jika singleton butuh prototype, jangan inject langsung seperti ini:

```java
@Component
class ReportService {

    private final ReportBuilder builder;

    ReportService(ReportBuilder builder) {
        this.builder = builder;
    }
}
```

Kenapa?

Karena prototype hanya dibuat sekali saat singleton dibuat.

Gunakan provider:

```java
@Component
class ReportService {

    private final ObjectProvider<ReportBuilder> builders;

    ReportService(ObjectProvider<ReportBuilder> builders) {
        this.builders = builders;
    }

    Report generate() {
        ReportBuilder builder = builders.getObject();
        return builder.build();
    }
}
```

Atau lookup method injection, tetapi provider biasanya lebih eksplisit.

---

## 26. Lifecycle Dalam Web Application

Dalam Spring MVC app, ada lifecycle tambahan:

1. Servlet container lifecycle.
2. `ServletContext` lifecycle.
3. `DispatcherServlet` lifecycle.
4. root application context.
5. servlet-specific application context.
6. request/session scopes.
7. filters/listeners.
8. embedded server lifecycle in Spring Boot.

Pada Spring Boot modern, embedded Tomcat/Jetty/Undertow dibuat sebagai bagian dari application context.

Beberapa bean web hanya valid dalam request scope:

```java
@Component
@RequestScope
class CurrentRequestContext {
    // request-specific state
}
```

Jika singleton inject request-scoped bean, Spring memakai scoped proxy.

Mental model:

```text
Singleton tidak bisa menyimpan request object nyata.
Singleton menyimpan proxy yang resolve target sesuai request saat method dipanggil.
```

Risiko:

1. Mengakses request-scoped bean di luar request menghasilkan error.
2. Async thread tidak punya request context.
3. Scheduler tidak punya request context.
4. Request state bocor jika ThreadLocal tidak dibersihkan.

---

## 27. Lifecycle Dalam Reactive Application

Dalam WebFlux/reactive, ThreadLocal-based mental model sering gagal.

Request tidak selalu berjalan pada satu thread yang sama.

Maka lifecycle/context propagation berbeda:

```text
Servlet MVC: request context sering ThreadLocal-based
WebFlux: context harus mengikuti reactive chain
```

Implikasi:

1. Request scope tradisional tidak selalu cocok.
2. Security context reactive berbeda.
3. Transaction reactive berbeda.
4. MDC propagation butuh instrumentation/context bridging.
5. Blocking init/startup tetap blocking meski runtime reactive.

Part WebFlux akan membahas ini lebih dalam. Di Part 3 cukup pahami:

```text
Lifecycle bean tetap dikelola container, tetapi runtime context request berbeda antara imperative dan reactive stack.
```

---

## 28. Lifecycle dan Native Image/AOT

Spring modern mendukung AOT/native image.

AOT mengubah sebagian kerja runtime menjadi build-time processing.

Implikasi terhadap lifecycle:

1. Reflection dynamic harus diberi runtime hints.
2. Classpath scanning dynamic bisa dibatasi.
3. Proxy creation harus diketahui lebih eksplisit.
4. Conditional bean registration harus AOT-compatible.
5. Bean registration dynamic yang terlalu liar bisa bermasalah.
6. FactoryBean dan custom post processor perlu diuji di native mode.

Rule:

```text
Semakin dynamic extension point Anda, semakin besar tanggung jawab Anda terhadap AOT/native compatibility.
```

Desain yang lebih AOT-friendly:

1. Bean type eksplisit.
2. Reflection minimal.
3. Proxy interface/class diketahui.
4. Avoid runtime classpath scanning custom yang tidak memberi hint.
5. Gunakan Spring runtime hints untuk resource/reflection/proxy.
6. Test native image sejak awal jika target production.

---

## 29. Lifecycle dan Java 8 sampai 25

Spring lifecycle concept stabil lintas Java 8 sampai Java 25, tetapi lingkungan berubah:

| Java Era | Dampak Ke Spring Lifecycle |
|---|---|
| Java 8 | Legacy Spring 5.x, `javax.annotation.PostConstruct`, no module awareness mainstream |
| Java 11 | Transisi LTS modern awal, dependency javax perlu eksplisit |
| Java 17 | Baseline Spring 6/Boot 3+, Jakarta namespace, stronger encapsulation |
| Java 21 | Virtual threads, modern LTS, Boot virtual thread option |
| Java 25 | LTS modern berikutnya, Spring Boot 4 support, framework/library ecosystem makin Java 17+ |

Catatan penting:

1. Di Java 8/Spring 5, annotation `javax.annotation.PostConstruct` umum.
2. Di Spring 6+, ekosistem bergerak ke `jakarta.annotation.PostConstruct`.
3. Migrasi `javax.*` ke `jakarta.*` bisa mempengaruhi lifecycle annotation jika dependency tidak cocok.
4. Virtual threads tidak mengubah bean lifecycle, tetapi mengubah runtime execution model.
5. AOT/native image tidak mengubah konsep lifecycle, tetapi membatasi dynamic runtime behavior.

---

## 30. Extension Point Decision Matrix

Gunakan matrix ini saat membuat library/internal starter.

| Anda Ingin | Extension Point |
|---|---|
| Menambah bean definition sebelum bean dibuat | `BeanDefinitionRegistryPostProcessor` |
| Mengubah metadata bean sebelum object dibuat | `BeanFactoryPostProcessor` |
| Mengubah/membungkus object setelah dibuat | `BeanPostProcessor` |
| Membuat object target dari factory khusus | `FactoryBean` |
| Inisialisasi lokal setelah dependency masuk | `@PostConstruct` / `InitializingBean` |
| Inisialisasi third-party object | `@Bean(initMethod = "...")` |
| Validasi semua singleton setelah dibuat | `SmartInitializingSingleton` |
| Menjalankan komponen start/stop | `SmartLifecycle` |
| Menjalankan command setelah context siap | `ApplicationRunner` |
| Mendengar fase app ready/failed/closed | `ApplicationListener` / `@EventListener` |
| Cleanup resource saat shutdown normal | `@PreDestroy` / destroy method |
| Menyediakan object per scope khusus | custom `Scope` |
| Membuat proxy AOP custom | `BeanPostProcessor` / auto-proxy infrastructure |

---

## 31. Failure Model: Lifecycle Bugs Yang Sering Terjadi

### 31.1 Bean Dibuat Terlalu Awal

Gejala:

```text
Bean 'x' is not eligible for getting processed by all BeanPostProcessors
```

Dampak:

1. Proxy hilang.
2. Transaction tidak aktif.
3. Cache tidak aktif.
4. Observability instrumentation hilang.
5. Security method interceptor tidak aktif.

Penyebab:

1. `getBean()` dalam factory post processor.
2. BeanPostProcessor inject application service.
3. Static access ke context.
4. Eager FactoryBean.

Perbaikan:

1. Jangan create application bean dalam metadata phase.
2. Pisahkan infrastructure dependency.
3. Pakai provider/lazy dengan disiplin.
4. Periksa condition evaluation dan startup logs.

---

### 31.2 Initialization Melakukan Business Logic Berat

Gejala:

1. Startup lambat.
2. App gagal start karena external API down.
3. Kubernetes restart loop.
4. Readiness tidak pernah true.
5. Local test lambat.

Penyebab:

```java
@PostConstruct
void init() {
    externalSystem.syncEverything();
}
```

Perbaikan:

1. Pindahkan ke scheduled/background job.
2. Buat startup warmup optional dan timeout-bound.
3. Gunakan readiness indicator jika dependency eksternal critical.
4. Gunakan retry/backoff di runtime, bukan startup fatal tanpa alasan.
5. Buat side effect idempotent.

---

### 31.3 Self-Invocation Dengan AOP Annotation

Gejala:

1. `@Transactional` tidak aktif.
2. `@Async` berjalan sync.
3. `@Cacheable` tidak cache.
4. `@Retryable` tidak retry.

Penyebab:

```java
public void outer() {
    inner(); // bypass proxy
}

@Transactional
public void inner() {}
```

Perbaikan:

1. Pindahkan `inner` ke bean lain.
2. Jadikan boundary transaksi pada public entry point yang dipanggil dari luar bean.
3. Hindari desain yang membutuhkan self-proxy.
4. Gunakan programmatic transaction jika memang internal granular boundary diperlukan.

---

### 31.4 Shutdown Tidak Graceful

Gejala:

1. Message sedang diproses tapi container mati.
2. Duplicate processing.
3. Partial write.
4. Executor task hilang.
5. Resource tidak close.

Penyebab:

1. Thread manual tidak dikelola Spring.
2. No shutdown hook.
3. Long task tidak respond interrupt.
4. Listener tidak berhenti menarik message.
5. Grace period terlalu pendek.

Perbaikan:

1. Gunakan `TaskExecutor`/`TaskScheduler` managed bean.
2. Implement `SmartLifecycle` untuk runtime component.
3. Desain idempotency.
4. Configure graceful shutdown.
5. Monitor shutdown duration.

---

### 31.5 Custom Scope Bocor

Gejala:

1. Memory naik terus.
2. Tenant data bercampur.
3. Request context error di async.
4. Test flaky.

Penyebab:

1. Scope context disimpan di ThreadLocal tanpa cleanup.
2. Async propagation tidak ada.
3. Destruction callback tidak dipanggil.
4. Conversation id tidak jelas.

Perbaikan:

1. Definisikan begin/end scope eksplisit.
2. Pastikan cleanup di finally.
3. Jangan mengandalkan ThreadLocal pada reactive flow.
4. Test concurrency dan leak.

---

## 32. Design Heuristics Untuk Internal Spring Framework/Starter

Jika Anda membangun internal platform di atas Spring, gunakan prinsip ini.

### 32.1 Pisahkan Metadata Phase dan Runtime Phase

Jangan campur:

```text
scan/validate/register metadata
```

dengan:

```text
call external service / execute business logic
```

Metadata phase harus cepat, deterministic, dan side-effect minimal.

### 32.2 Jangan Paksa Bean Aplikasi Dibuat Terlalu Awal

Infrastructure extension point harus sebisa mungkin bekerja dengan:

1. `BeanDefinition`
2. bean name
3. type metadata
4. annotation metadata
5. `ObjectProvider`
6. lazy access

Bukan langsung memanggil service bisnis.

### 32.3 Buat Failure Message Yang Bagus

Jika post processor Anda menegakkan convention, error-nya harus actionable.

Buruk:

```text
Invalid handler
```

Baik:

```text
Invalid CommandHandler registration.
Bean: createCaseHandler
Class: com.example.case.CreateCaseHandler
Problem: duplicate command type com.example.case.CreateCaseCommand.
Existing handler: legacyCreateCaseHandler
Fix: ensure each Command type has exactly one CommandHandler bean, or mark one as @PrimaryCommandHandler.
```

### 32.4 Sediakan Escape Hatch

Internal starter yang baik punya default kuat, tetapi bisa dioverride.

Contoh:

1. `@ConditionalOnMissingBean`
2. property toggle
3. customizer callback
4. ordered strategy list
5. explicit bean override point

### 32.5 Test Dengan `ApplicationContextRunner`

Untuk auto-config/starter, test full `@SpringBootTest` terlalu berat.

Gunakan context runner untuk menguji:

1. Bean hadir saat condition cocok.
2. Bean tidak hadir saat property off.
3. Custom user bean membuat auto-config back off.
4. Error muncul saat config invalid.
5. Ordering sesuai.

---

## 33. Worked Example: Handler Registry Dengan Lifecycle Yang Benar

Misal kita ingin membuat command handling mini-framework internal.

Goal:

1. Setiap command punya tepat satu handler.
2. Duplicate handler harus fail-fast saat startup.
3. Registry immutable setelah startup.
4. Handler boleh proxied oleh Spring.
5. Tidak boleh membuat bean terlalu awal.

### 33.1 Contract

```java
public interface Command {}
```

```java
public interface CommandHandler<C extends Command> {
    void handle(C command);
}
```

Handler:

```java
@Component
public class ApproveCaseHandler implements CommandHandler<ApproveCaseCommand> {

    @Transactional
    @Override
    public void handle(ApproveCaseCommand command) {
        // business logic
    }
}
```

### 33.2 Registry Menggunakan `SmartInitializingSingleton`

```java
@Component
public class CommandHandlerRegistry implements SmartInitializingSingleton {

    private final List<CommandHandler<?>> handlers;
    private Map<Class<?>, CommandHandler<?>> registry;

    public CommandHandlerRegistry(List<CommandHandler<?>> handlers) {
        this.handlers = handlers;
    }

    @Override
    public void afterSingletonsInstantiated() {
        Map<Class<?>, CommandHandler<?>> discovered = new HashMap<>();

        for (CommandHandler<?> handler : handlers) {
            Class<?> commandType = resolveCommandType(handler);

            CommandHandler<?> existing = discovered.putIfAbsent(commandType, handler);
            if (existing != null) {
                throw new IllegalStateException(
                        "Duplicate CommandHandler for command type: " + commandType.getName()
                );
            }
        }

        this.registry = Map.copyOf(discovered);
    }

    @SuppressWarnings("unchecked")
    public <C extends Command> CommandHandler<C> getHandler(Class<C> commandType) {
        CommandHandler<?> handler = registry.get(commandType);
        if (handler == null) {
            throw new IllegalArgumentException("No handler for command type: " + commandType.getName());
        }
        return (CommandHandler<C>) handler;
    }

    private Class<?> resolveCommandType(CommandHandler<?> handler) {
        // Implementation must handle proxies carefully.
        // For real production code, inspect target class through Spring AopUtils/ResolvableType.
        return Object.class;
    }
}
```

Kenapa lifecycle ini benar?

1. Registry menerima handler via normal DI.
2. Handler yang diterima sudah final bean reference, bisa proxy.
3. Validasi duplicate terjadi setelah semua singleton dibuat.
4. Tidak ada `getBean()` terlalu awal.
5. Registry immutable setelah startup.

### 33.3 Dispatcher

```java
@Component
public class CommandDispatcher {

    private final CommandHandlerRegistry registry;

    public CommandDispatcher(CommandHandlerRegistry registry) {
        this.registry = registry;
    }

    public <C extends Command> void dispatch(C command) {
        CommandHandler<C> handler = registry.getHandler(command.getClass());
        handler.handle(command);
    }
}
```

Jika handler proxied untuk transaction, dispatcher memanggil proxy, sehingga `@Transactional` aktif.

---

## 34. Worked Example: Startup Validation Tanpa Side Effect Berat

Misal platform Anda ingin memastikan semua `@ExternalClient` punya timeout.

Annotation:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ExternalClient {
}
```

Buruk:

```java
@PostConstruct
void init() {
    clients.forEach(Client::ping);
}
```

Ini melakukan remote call saat startup.

Lebih baik pisahkan:

1. Validasi config secara lokal saat startup.
2. Health indicator untuk mengecek konektivitas runtime.
3. Optional warmup dengan timeout jika benar-benar perlu.

Contoh post processor metadata:

```java
@Component
public class ExternalClientDefinitionValidator implements BeanFactoryPostProcessor {

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        for (String name : beanFactory.getBeanDefinitionNames()) {
            BeanDefinition bd = beanFactory.getBeanDefinition(name);
            String className = bd.getBeanClassName();

            if (className == null) {
                continue;
            }

            // In production, avoid naive Class.forName if possible; prefer metadata when available.
            // This is simplified for explanation.
        }
    }
}
```

Atau lebih sederhana untuk application-level validation:

```java
@Component
public class ExternalClientPropertiesValidator implements SmartInitializingSingleton {

    private final List<ExternalClientProperties> properties;

    public ExternalClientPropertiesValidator(List<ExternalClientProperties> properties) {
        this.properties = properties;
    }

    @Override
    public void afterSingletonsInstantiated() {
        for (ExternalClientProperties property : properties) {
            if (property.timeout() == null) {
                throw new IllegalStateException("External client timeout must be configured");
            }
        }
    }
}
```

---

## 35. Worked Example: Runtime Worker Dengan `SmartLifecycle`

Misal ada worker yang memproses escalation case.

Requirement:

1. Start otomatis setelah context siap.
2. Stop gracefully.
3. Tidak menarik work baru saat shutdown.
4. Task yang sedang berjalan diberi kesempatan selesai.
5. Bisa diobservasi.

Desain:

```java
@Component
public class EscalationWorker implements SmartLifecycle {

    private final TaskExecutor taskExecutor;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public EscalationWorker(TaskExecutor taskExecutor) {
        this.taskExecutor = taskExecutor;
    }

    @Override
    public void start() {
        if (running.compareAndSet(false, true)) {
            taskExecutor.execute(this::runLoop);
        }
    }

    private void runLoop() {
        while (running.get()) {
            try {
                processOneBatch();
            } catch (Exception ex) {
                // log, metric, backoff
            }
        }
    }

    private void processOneBatch() {
        // poll with timeout; process idempotently
    }

    @Override
    public void stop() {
        running.set(false);
    }

    @Override
    public void stop(Runnable callback) {
        try {
            stop();
        } finally {
            callback.run();
        }
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }

    @Override
    public boolean isAutoStartup() {
        return true;
    }

    @Override
    public int getPhase() {
        return 1000;
    }
}
```

Production improvements:

1. Use `ThreadPoolTaskExecutor` managed bean.
2. Add backoff.
3. Add metrics.
4. Add tracing/correlation.
5. Use distributed lock if multiple replicas.
6. Make processing idempotent.
7. Respond to interruption.
8. Bound batch size.
9. Bound transaction duration.
10. Surface health/readiness if backlog critical.

---

## 36. Anti-Patterns

### 36.1 “Put Everything In `@PostConstruct`”

Buruk karena init callback menjadi tempat segala hal:

1. Load config.
2. Call API.
3. Query DB.
4. Start thread.
5. Publish event.
6. Warm cache.
7. Validate domain.

Akibatnya startup tidak predictable.

Lebih baik pisahkan berdasarkan lifecycle.

---

### 36.2 “Static ApplicationContext Holder”

Contoh:

```java
public class SpringContext {
    static ApplicationContext context;

    public static <T> T getBean(Class<T> type) {
        return context.getBean(type);
    }
}
```

Risiko:

1. Service locator global.
2. Test sulit.
3. Lifecycle tidak jelas.
4. Memory leak pada reload/devtools.
5. Hidden dependency.
6. Mengakses context sebelum ready.

Hindari kecuali untuk bridging legacy dengan containment ketat.

---

### 36.3 Manual Thread Tanpa Lifecycle

```java
@PostConstruct
void start() {
    new Thread(this::loop).start();
}
```

Risiko:

1. Tidak stop saat shutdown.
2. Tidak terobservasi.
3. Tidak ikut executor policy.
4. Tidak propagate context.
5. Bisa membuat process tidak berhenti.

Gunakan `TaskExecutor`, scheduler, listener container, atau `SmartLifecycle`.

---

### 36.4 Post Processor Terlalu Pintar

Post processor yang melakukan terlalu banyak hal membuat sistem implicit.

Gejala:

1. Bean berubah diam-diam.
2. Debug sulit.
3. Test sulit.
4. Startup order rapuh.
5. AOT/native sulit.
6. Developer tidak tahu kenapa bean ada.

Guideline:

```text
Extension point harus punya contract jelas, dokumentasi jelas, error jelas, dan escape hatch.
```

---

### 36.5 Lifecycle Bergantung Pada Urutan Kebetulan

Contoh:

```java
@PostConstruct
void init() {
    SomeGlobalRegistry.register(this);
}
```

Lalu bean lain mengasumsikan registry sudah lengkap di `@PostConstruct` juga.

Ini rapuh karena urutan init antar bean tidak selalu sesuai asumsi.

Gunakan:

1. `dependsOn` jika benar-benar perlu order eksplisit.
2. `SmartInitializingSingleton` untuk semua singleton siap.
3. Event dengan ordering jika cocok.
4. Registry constructor injection dari list beans.

---

## 37. Practical Debugging Checklist

Saat menghadapi lifecycle bug, tanyakan:

### 37.1 Bean Tidak Terbuat

1. Apakah `BeanDefinition` terdaftar?
2. Apakah condition auto-config match?
3. Apakah profile aktif?
4. Apakah package scanning mencakup class?
5. Apakah bean lazy?
6. Apakah ada error sebelum bean dibuat?

### 37.2 Bean Ada Tapi Annotation Tidak Bekerja

1. Apakah bean proxied?
2. Apakah method dipanggil dari luar proxy atau self-invocation?
3. Apakah method public?
4. Apakah class/method final?
5. Apakah bean dibuat terlalu awal?
6. Apakah advisor terdaftar?
7. Apakah annotation berada di interface atau implementation yang benar?

### 37.3 Startup Lambat

1. Berapa jumlah bean?
2. Auto-config apa yang aktif?
3. Ada remote call di init?
4. Ada heavy DB query di startup?
5. Ada scanning custom berat?
6. Ada runner blocking?
7. Lazy initialization membantu atau menyembunyikan masalah?

### 37.4 Shutdown Bermasalah

1. Apakah context closed normal?
2. Apakah graceful shutdown aktif?
3. Apakah executor managed?
4. Apakah listener berhenti consume?
5. Apakah task respond interrupt?
6. Apakah transaction terlalu panjang?
7. Apakah destroy callback idempotent?

---

## 38. Production Checklist

Gunakan checklist ini saat review Spring app/starter.

### 38.1 Init

- [ ] Tidak ada remote call berat di `@PostConstruct`.
- [ ] Tidak ada business process besar di bean init.
- [ ] Init callback hanya local validation/setup ringan.
- [ ] Cross-bean registry memakai lifecycle yang tepat.
- [ ] Startup failure message actionable.

### 38.2 Post Processor

- [ ] `BeanFactoryPostProcessor` tidak memanggil application bean secara eager.
- [ ] `BeanPostProcessor` tidak bergantung langsung pada service bisnis.
- [ ] Ordering hanya dipakai jika diperlukan.
- [ ] Post processor punya scope tanggung jawab jelas.
- [ ] Post processor compatible dengan test context.

### 38.3 Proxy

- [ ] Boundary AOP dipanggil melalui proxy.
- [ ] Tidak mengandalkan annotation pada self-invocation.
- [ ] Tidak ada final method/class yang menghalangi class proxy.
- [ ] Tidak ada early bean creation warning.

### 38.4 Runtime Lifecycle

- [ ] Background worker dikelola Spring.
- [ ] `SmartLifecycle` phase dipahami.
- [ ] Shutdown graceful diuji.
- [ ] In-flight processing idempotent.
- [ ] Executor punya queue/rejection policy jelas.

### 38.5 Scope

- [ ] Prototype dependency pada singleton memakai provider.
- [ ] Request/session scope tidak diakses di luar context.
- [ ] Custom scope punya cleanup eksplisit.
- [ ] ThreadLocal dibersihkan.
- [ ] Async/reactive propagation dipikirkan.

---

## 39. Mental Model Ringkas

Jika harus diringkas, lifecycle Spring adalah ini:

```text
BeanDefinition adalah rencana.
BeanFactory adalah mesin pembuat.
BeanPostProcessor adalah mekanisme modifikasi object.
Proxy adalah object final yang sering diterima user.
@PostConstruct bukan tanda aplikasi siap.
SmartInitializingSingleton berarti singleton graph selesai.
ApplicationReadyEvent berarti Boot menganggap app ready.
SmartLifecycle untuk komponen yang start/stop.
Destroy callback hanya best-effort pada shutdown normal.
```

Dan rule paling penting:

```text
Pilih hook berdasarkan fase lifecycle yang Anda butuhkan, bukan berdasarkan annotation yang paling familiar.
```

---

## 40. Hubungan Dengan Part Berikutnya

Part berikutnya akan membahas:

```text
04-annotation-metadata-component-scanning-internals.md
```

Kenapa setelah lifecycle kita masuk ke annotation metadata?

Karena banyak extension point Spring bekerja dengan membaca annotation:

1. `@Component`
2. `@Configuration`
3. `@Bean`
4. `@Autowired`
5. `@Transactional`
6. `@EventListener`
7. `@Scheduled`
8. annotation custom internal platform

Untuk membuat framework Spring yang matang, Anda harus paham bahwa annotation bukan magic. Annotation adalah metadata, dan Spring punya pipeline untuk membaca, menggabungkan, mewariskan, dan menafsirkan metadata tersebut.

---

## 41. Referensi Resmi Yang Relevan

Bacaan resmi yang relevan untuk topik ini:

1. Spring Framework Reference — Customizing the Nature of a Bean.
2. Spring Framework Reference — Container Extension Points.
3. Spring Framework Reference — Bean Scopes.
4. Spring Framework Reference — IoC Container and Beans.
5. Spring Boot Reference — Application Events and Listeners.
6. Spring Boot Reference — Graceful Shutdown.
7. Spring Framework Javadoc — `BeanPostProcessor`.
8. Spring Framework Javadoc — `BeanFactoryPostProcessor`.
9. Spring Framework Javadoc — `BeanDefinitionRegistryPostProcessor`.
10. Spring Framework Javadoc — `SmartInitializingSingleton`.
11. Spring Framework Javadoc — `SmartLifecycle`.

---

## 42. Latihan Mandiri

### Latihan 1 — Lifecycle Trace

Buat aplikasi kecil dengan bean berikut:

1. `BeanFactoryPostProcessor`
2. `BeanPostProcessor`
3. bean dengan constructor log
4. bean dengan `@PostConstruct`
5. bean dengan `InitializingBean`
6. bean dengan custom init method
7. bean dengan `SmartInitializingSingleton`
8. `ApplicationRunner`
9. `ApplicationReadyEvent` listener
10. bean dengan `@PreDestroy`

Log semua fase.

Tujuan:

```text
Melihat lifecycle bukan sebagai teori, tetapi sebagai urutan nyata.
```

### Latihan 2 — Early Bean Creation

Buat `BeanPostProcessor` yang inject application service langsung.

Amati apakah muncul warning dan apakah service tersebut mendapatkan proxy.

Lalu ubah menggunakan `ObjectProvider` dan desain ulang agar tidak eager.

### Latihan 3 — Self Invocation

Buat service:

```java
@Service
class DemoService {

    public void outer() {
        inner();
    }

    @Transactional
    public void inner() {}
}
```

Panggil `outer()` dari controller/test.

Buktikan bahwa transaction boundary tidak seperti yang banyak developer kira.

Lalu pindahkan `inner()` ke bean lain dan bandingkan.

### Latihan 4 — SmartLifecycle Worker

Buat worker sederhana yang start/stop dengan `SmartLifecycle`.

Tambahkan:

1. phase
2. graceful stop
3. metric counter
4. shutdown log
5. idempotency guard

### Latihan 5 — Custom Registry

Buat registry untuk strategy beans:

```java
interface CaseActionHandler<A extends CaseAction> {
    void handle(A action);
}
```

Gunakan `SmartInitializingSingleton` untuk memastikan satu action type hanya punya satu handler.

---

## 43. Ringkasan Akhir

Part ini membangun pemahaman bahwa Spring adalah runtime lifecycle engine.

Menguasai lifecycle berarti Anda bisa:

1. Membaca startup failure dengan lebih akurat.
2. Mendesain library internal Spring dengan aman.
3. Menghindari early bean creation.
4. Memahami kapan proxy aktif dan kapan tidak.
5. Memilih hook yang tepat untuk init, validation, startup, runtime, dan shutdown.
6. Menghindari lifecycle side effect yang membuat production tidak predictable.
7. Mendesain background worker dan registry dengan benar.
8. Mempersiapkan aplikasi untuk migration, AOT/native, dan runtime modern Java 21–25.

Spring bukan hanya DI container.

Spring adalah lifecycle orchestration runtime.

Engineer yang menguasai lifecycle akan jauh lebih mudah menguasai transaction, AOP, security, cache, event, scheduling, Boot auto-configuration, testing, dan platform starter design.

---

## 44. Status Seri

```text
Part saat ini : 3 dari 35
Status        : belum selesai
Berikutnya    : 04-annotation-metadata-component-scanning-internals.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./02-dependency-injection-resolution-algorithm.md">⬅️ Part 2 — Dependency Injection Resolution Algorithm</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./04-annotation-metadata-component-scanning-internals.md">Part 4 — Annotation Metadata and Component Scanning Internals ➡️</a>
</div>

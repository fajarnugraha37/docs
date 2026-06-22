# Part 8 — Application Startup, Bootstrap, Failure Analysis, and Diagnostics

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `08-application-startup-bootstrap-failure-diagnostics.md`  
> Level: Advanced / framework-runtime engineering  
> Target: Java 8 sampai Java 25, Spring Framework 5.x/6.x/7.x, Spring Boot 2.x/3.x/4.x

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

1. Spring sebagai runtime dan container.
2. `BeanDefinition`, `BeanFactory`, dan `ApplicationContext`.
3. Dependency injection resolution.
4. Bean lifecycle dan extension points.
5. Annotation metadata dan component scanning.
6. Configuration model.
7. Spring Boot auto-configuration.

Part ini menyambungkan semua itu ke satu pertanyaan operasional:

> Ketika `SpringApplication.run(...)` dipanggil, apa sebenarnya yang terjadi sampai aplikasi dianggap hidup, siap menerima traffic, atau gagal startup?

Bagi engineer biasa, startup Spring terlihat seperti ini:

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

Bagi engineer senior, terutama yang harus menangani production incident, startup Spring adalah pipeline deterministik:

```text
main()
  -> SpringApplication construction
  -> listener + initializer discovery
  -> environment preparation
  -> application context selection
  -> context initialization
  -> bean definition loading
  -> auto-configuration import
  -> context refresh
  -> web server startup
  -> lifecycle callbacks
  -> runners
  -> readiness transition
  -> steady state
```

Setiap fase punya failure mode yang berbeda. Error pada fase environment berbeda dengan error pada fase bean instantiation. Error pada fase web server berbeda dengan error pada phase runner. Error readiness berbeda dengan liveness. Error startup native image berbeda dengan startup JVM biasa.

Tujuan part ini bukan menghafal event Spring Boot. Tujuannya adalah membentuk kemampuan:

1. Membaca startup log sebagai timeline.
2. Menghubungkan error ke fase yang tepat.
3. Menentukan extension point yang aman.
4. Membuat startup application lebih predictable.
5. Menghindari hidden work terlalu awal.
6. Mengukur startup dengan `ApplicationStartup`.
7. Menulis failure analyzer untuk platform/internal starter.
8. Mendesain readiness/liveness yang benar.
9. Memahami perbedaan startup Java 8 legacy, Java 17+ modern, Java 21/25 virtual-thread era, dan native-image/AOT era.

---

## 1. Mental Model: Startup Bukan Satu Langkah

`SpringApplication.run(...)` bukan hanya membuat object lalu menjalankan server. Ia adalah orchestrator.

Secara konseptual:

```text
SpringApplication.run()
  = build runtime environment
  + choose context type
  + load configuration
  + register bean definitions
  + evaluate conditions
  + refresh context
  + instantiate singleton beans
  + start infrastructure
  + publish lifecycle events
  + execute startup tasks
  + expose availability state
```

Startup Spring Boot harus dipahami sebagai empat lapis:

| Lapis | Pertanyaan | Contoh Failure |
|---|---|---|
| Process bootstrap | JVM bisa masuk main class? | class not found, wrong Java version, bad classpath |
| SpringApplication bootstrap | environment/context bisa disiapkan? | invalid property, listener error, config import failure |
| ApplicationContext refresh | bean graph bisa dibuat? | missing bean, circular dependency, invalid config |
| Runtime activation | app bisa melayani traffic? | port conflict, failed runner, unavailable dependency |

Kesalahan umum adalah semua error startup dianggap sama. Padahal solusi berbeda:

```text
Property binding error   -> periksa config source, binding, profile, validation
Bean creation error      -> periksa dependency graph, lifecycle, condition
Port already used        -> periksa web server/runtime environment
Runner failure           -> periksa startup task, migration, warmup, external dependency
Readiness failure        -> periksa health indicator, runner, warmup, dependency state
Native image failure     -> periksa reflection/resource/proxy hint
```

---

## 2. `SpringApplication` sebagai Bootstrap Orchestrator

`SpringApplication` adalah entry point Boot untuk membuat dan menjalankan Spring application dari `main()`.

Bentuk paling umum:

```java
@SpringBootApplication
public class MyApplication {
    public static void main(String[] args) {
        SpringApplication.run(MyApplication.class, args);
    }
}
```

Tetapi bentuk ini menyembunyikan banyak keputusan.

Contoh eksplisit:

```java
@SpringBootApplication(proxyBeanMethods = false)
public class MyApplication {
    public static void main(String[] args) {
        SpringApplication application = new SpringApplication(MyApplication.class);
        application.setAdditionalProfiles("local");
        application.setLazyInitialization(false);
        application.run(args);
    }
}
```

Atau builder style:

```java
new SpringApplicationBuilder(MyApplication.class)
        .profiles("local")
        .logStartupInfo(true)
        .run(args);
```

Secara konseptual, `SpringApplication` mengatur:

1. Source utama aplikasi.
2. Listener awal.
3. Initializer context.
4. Jenis web application.
5. Banner.
6. Environment.
7. Conversion service awal.
8. Application context factory.
9. Startup tracking.
10. Shutdown hook.
11. Runner execution.
12. Failure handling.

Yang penting: sebagian keputusan dibuat **sebelum** `ApplicationContext` ada. Karena itu tidak semua hal bisa dijadikan `@Bean`.

Contoh:

```text
ApplicationStartingEvent
ApplicationEnvironmentPreparedEvent
ApplicationContextInitializedEvent
```

terjadi sangat awal. Listener untuk event tersebut tidak bisa hanya didaftarkan sebagai bean biasa karena bean belum ada.

---

## 3. High-Level Startup Timeline

Gambaran besar:

```text
1. main() invoked
2. SpringApplication object created
3. listeners and initializers discovered
4. ApplicationStartingEvent published
5. Environment prepared
6. ApplicationEnvironmentPreparedEvent published
7. ApplicationContext created
8. ApplicationContextInitializers invoked
9. ApplicationContextInitializedEvent published
10. Bean definitions loaded
11. ApplicationPreparedEvent published
12. context.refresh()
13. BeanFactoryPostProcessor invoked
14. BeanPostProcessor registered
15. singleton beans instantiated
16. embedded web server initialized, if web app
17. ContextRefreshedEvent published
18. ApplicationStartedEvent published
19. Liveness state becomes correct
20. ApplicationRunner/CommandLineRunner invoked
21. ApplicationReadyEvent published
22. Readiness state becomes accepting traffic
23. run() returns
24. app enters steady state
```

Jika terjadi exception:

```text
failure at any critical phase
  -> ApplicationFailedEvent
  -> FailureAnalyzer, if matched
  -> failure report printed
  -> context closed if partially created
  -> process exits or exception propagates
```

---

## 4. Fase 1 — Process-Level Bootstrap

Sebelum Spring melakukan apa pun, JVM harus bisa menjalankan aplikasi.

Failure umum:

| Failure | Gejala | Root Cause |
|---|---|---|
| Unsupported class file major version | app tidak mulai | runtime Java lebih tua dari compile target |
| NoClassDefFoundError | class hilang saat runtime | dependency tidak ikut package / version conflict |
| ClassNotFoundException | class tidak ditemukan | classpath/module path salah |
| NoSuchMethodError | method tidak ada | binary incompatibility dependency |
| IllegalAccessError | akses class/method gagal | module/security/binary mismatch |
| ExceptionInInitializerError | static init gagal | side effect di static initializer |

Contoh:

```text
java.lang.UnsupportedClassVersionError:
  class file version 65.0, this runtime only recognizes up to 61.0
```

Artinya biasanya:

```text
compiled with Java 21
running on Java 17
```

Untuk seri Java 8–25, ini penting karena Spring version punya baseline berbeda:

| Era | Spring Boot | Minimum Java Umum | Catatan |
|---|---|---:|---|
| Boot 2.x | Java 8/11 | 8 | `javax.*`, Spring Framework 5.x |
| Boot 3.x | Java 17 | 17 | `jakarta.*`, Spring Framework 6.x |
| Boot 4.x | Java 17+ | 17 | Spring Framework 7.x, generasi modern |

Startup failure pada layer ini bukan masalah Spring. Ini masalah build/runtime compatibility.

Checklist:

```bash
java -version
jar --describe-module --file app.jar
jdeps --multi-release 25 app.jar
```

Untuk Spring Boot executable jar:

```bash
java -jar app.jar --debug
```

Jika gagal sebelum banner muncul, masalahnya hampir pasti sebelum Spring Boot benar-benar berjalan.

---

## 5. Fase 2 — ApplicationStartingEvent

Ini event paling awal dari lifecycle Boot.

Pada fase ini:

```text
SpringApplication.run() sudah dimulai
listener dan initializer dasar sudah diketahui
Environment belum siap penuh
ApplicationContext belum dibuat
bean belum ada
logging mungkin belum terkonfigurasi penuh
```

Use case yang cocok:

1. Very early diagnostics.
2. External bootstrap hook.
3. Library/platform listener yang harus aktif sebelum environment.
4. Minimal logging/bootstrap tracing.

Use case yang tidak cocok:

1. Membaca bean.
2. Mengakses datasource.
3. Menggunakan `@Autowired`.
4. Menjalankan logic bisnis.
5. Memanggil external service.

Contoh listener awal:

```java
public final class EarlyStartupListener
        implements ApplicationListener<ApplicationStartingEvent> {

    @Override
    public void onApplicationEvent(ApplicationStartingEvent event) {
        System.err.println("Application is starting: " + event.getSpringApplication());
    }
}
```

Registrasi manual:

```java
SpringApplication app = new SpringApplication(MyApplication.class);
app.addListeners(new EarlyStartupListener());
app.run(args);
```

Di library/starter lama, listener bisa diregistrasikan lewat `spring.factories`. Di generasi Boot modern, mekanisme registrasi bootstrap mengalami evolusi; selalu cek mekanisme yang sesuai versi Boot target.

Engineering rule:

> Early listener harus sangat ringan, deterministic, dan tidak bergantung pada object graph Spring.

---

## 6. Fase 3 — Environment Preparation

Pada fase ini Boot membangun `Environment`.

Yang terjadi:

1. Membaca command-line args.
2. Membaca system properties.
3. Membaca environment variables.
4. Memproses config data.
5. Menentukan active profiles.
6. Menyusun `PropertySource` chain.
7. Menyiapkan conversion service awal.
8. Mem-publish `ApplicationEnvironmentPreparedEvent`.

Failure umum:

| Failure | Contoh |
|---|---|
| Config file tidak ditemukan | `spring.config.import` menunjuk lokasi tidak ada |
| Secret/config server unavailable | config import eksternal gagal |
| Invalid YAML | syntax YAML salah |
| Profile salah | prod memakai profile default |
| Placeholder tidak resolve | `${DB_PASSWORD}` tidak ada |
| Type binding gagal | property string tidak bisa dikonversi ke duration/int |
| Circular placeholder | property saling referensi |

Contoh:

```yaml
server:
  port: ${APP_PORT}
```

Jika `APP_PORT` tidak ada, tergantung konteks resolution, startup bisa gagal saat property dipakai.

Lebih aman:

```yaml
server:
  port: ${APP_PORT:8080}
```

Tetapi default juga bisa berbahaya di production. Untuk property kritikal, lebih baik fail-fast:

```java
@ConfigurationProperties(prefix = "app.datasource")
@Validated
public record DataSourceProperties(
        @NotBlank String url,
        @NotBlank String username,
        @NotBlank String password
) {}
```

Mental model:

```text
Environment is not configuration object.
Environment is ordered property lookup infrastructure.
ConfigurationProperties is typed application contract.
```

Pada fase ini, jangan berharap bean sudah tersedia. Jika butuh memodifikasi environment sangat awal, gunakan environment post-processing mechanism yang sesuai versi Boot, bukan bean biasa.

---

## 7. Fase 4 — ApplicationContext Selection

Spring Boot memilih jenis `ApplicationContext` berdasarkan aplikasi.

Simplifikasi:

```text
Spring MVC present     -> servlet web context
WebFlux only present   -> reactive web context
neither present        -> non-web context
```

Contoh jenis context:

| Context | Kapan |
|---|---|
| `AnnotationConfigApplicationContext` | non-web app |
| `AnnotationConfigServletWebServerApplicationContext` | servlet web app |
| `AnnotationConfigReactiveWebServerApplicationContext` | reactive web app |

Pitfall besar:

```text
Menambahkan dependency web yang tidak sengaja bisa mengubah jenis aplikasi.
```

Contoh:

```text
Aplikasi batch tiba-tiba start embedded server
karena dependency spring-boot-starter-web ikut tertarik transitif.
```

Solusi eksplisit:

```java
SpringApplication app = new SpringApplication(MyBatchApplication.class);
app.setWebApplicationType(WebApplicationType.NONE);
app.run(args);
```

Untuk test tertentu:

```java
new SpringApplicationBuilder(TestApplication.class)
        .web(WebApplicationType.NONE)
        .run(args);
```

Engineering rule:

> Application type adalah architectural decision, bukan side effect classpath.

---

## 8. Fase 5 — Context Initialization

Setelah context dibuat, Spring Boot menjalankan `ApplicationContextInitializer`.

Initializer berjalan:

```text
setelah context object dibuat
sebelum bean definition dimuat penuh
sebelum refresh
```

Use case:

1. Register property source tambahan.
2. Set context id.
3. Register bean factory setting.
4. Add custom context behavior.
5. Test infrastructure setup.

Contoh:

```java
public final class ContextIdInitializer
        implements ApplicationContextInitializer<ConfigurableApplicationContext> {

    @Override
    public void initialize(ConfigurableApplicationContext context) {
        context.setId("case-management-service");
    }
}
```

Registrasi:

```java
SpringApplication app = new SpringApplication(MyApplication.class);
app.addInitializers(new ContextIdInitializer());
app.run(args);
```

Pitfall:

```text
Initializer bukan tempat untuk mengambil bean.
```

Karena object graph belum dibuat.

---

## 9. Fase 6 — Bean Definition Loading

Pada fase ini Spring mulai memuat bean definitions dari source aplikasi.

Yang terjadi:

1. Membaca `@SpringBootApplication`.
2. Membaca `@Configuration`.
3. Component scanning.
4. Import processing.
5. Auto-configuration import.
6. Conditional evaluation.
7. Bean definition registration.

Dari part sebelumnya:

```text
BeanDefinition = metadata object creation plan
Bean instance  = actual object
```

Pada fase ini yang dominan adalah metadata, bukan object.

Failure umum:

| Failure | Penyebab |
|---|---|
| Duplicate bean definition | bean name tabrakan |
| Conditional salah aktif | classpath/property/profile salah |
| Auto-config unwanted | dependency transitif memicu auto-config |
| Component tidak discan | base package salah |
| Bean definition override disabled | duplicate registration |
| Configuration class parse failure | annotation/config invalid |

Gunakan debug report:

```bash
java -jar app.jar --debug
```

Atau property:

```properties
debug=true
```

Ini menampilkan condition evaluation report, membantu menjawab:

```text
Kenapa auto-configuration A aktif?
Kenapa auto-configuration B tidak aktif?
Condition mana yang match?
Condition mana yang miss?
```

---

## 10. Fase 7 — `ApplicationPreparedEvent`

`ApplicationPreparedEvent` terjadi:

```text
context sudah dibuat
bean definitions sudah dimuat
refresh belum dimulai
bean singleton belum dibuat penuh
```

Ini adalah salah satu titik terakhir sebelum container benar-benar membangun object graph.

Use case:

1. Diagnostics bean definition.
2. Validasi registry.
3. Platform governance check.
4. Logging summary awal.

Namun untuk manipulasi bean definition, extension point yang lebih tepat biasanya:

```text
BeanDefinitionRegistryPostProcessor
BeanFactoryPostProcessor
ImportBeanDefinitionRegistrar
DeferredImportSelector
```

Event listener di fase ini sebaiknya tidak dijadikan mekanisme utama untuk mengubah object graph, kecuali benar-benar paham konsekuensinya.

---

## 11. Fase 8 — `context.refresh()` sebagai Titik Berat Startup

`refresh()` adalah jantung startup Spring.

Secara ringkas:

```text
prepareRefresh
obtainFreshBeanFactory
prepareBeanFactory
postProcessBeanFactory
invokeBeanFactoryPostProcessors
registerBeanPostProcessors
initMessageSource
initApplicationEventMulticaster
onRefresh
registerListeners
finishBeanFactoryInitialization
finishRefresh
```

Di Boot app, ini berarti:

1. Bean factory disiapkan.
2. Post processor dijalankan.
3. BeanPostProcessor diregistrasikan.
4. Message source dibuat.
5. Event multicaster dibuat.
6. Embedded web server dapat dibuat pada `onRefresh` untuk web context.
7. Non-lazy singleton di-instantiate.
8. Lifecycle processor berjalan.
9. Context refreshed event dipublish.

Banyak error startup terjadi di sini.

---

## 12. Failure Mode saat `refresh()`

### 12.1 Missing Bean

```text
Parameter 0 of constructor in X required a bean of type Y that could not be found.
```

Kemungkinan root cause:

1. Bean belum didaftarkan.
2. Component scan tidak mencakup package.
3. Conditional auto-config tidak match.
4. Profile salah.
5. Bean type berbeda karena generic/proxy.
6. Dependency opsional seharusnya memakai `ObjectProvider`.

Cara debug:

```text
1. Cari type Y.
2. Cari siapa yang seharusnya membuat Y.
3. Cek condition report.
4. Cek profile.
5. Cek base package scanning.
6. Cek dependency jar.
```

### 12.2 Ambiguous Bean

```text
No qualifying bean of type X available: expected single matching bean but found 2
```

Root cause:

1. Ada beberapa implementation.
2. Tidak ada `@Primary`.
3. Qualifier tidak dipakai.
4. Generic type hilang.
5. Auto-config membuat bean default dan app membuat bean lain.

Solusi desain:

```java
public interface PaymentClient {}

@Service
@Qualifier("primaryPaymentClient")
final class PrimaryPaymentClient implements PaymentClient {}

@Service
@Qualifier("fallbackPaymentClient")
final class FallbackPaymentClient implements PaymentClient {}
```

Atau:

```java
public PaymentService(@Qualifier("primaryPaymentClient") PaymentClient paymentClient) {
    this.paymentClient = paymentClient;
}
```

### 12.3 Circular Dependency

```text
The dependencies of some of the beans in the application context form a cycle
```

Root cause umum:

```text
ServiceA -> ServiceB -> ServiceA
```

Spring versi lama kadang bisa menyelesaikan setter/field cycle lewat early singleton exposure. Constructor cycle tetap masalah fundamental.

Solusi yang benar biasanya bukan `@Lazy`, tetapi memecah tanggung jawab:

```text
A <-> B
```

menjadi:

```text
A -> Policy
B -> Policy
```

atau:

```text
A publishes event
B handles event
```

### 12.4 BeanCreationException karena `@PostConstruct`

Contoh buruk:

```java
@PostConstruct
void init() {
    externalApiClient.call();
}
```

Masalah:

1. Startup bergantung pada external API.
2. Retry/timeout sering belum jelas.
3. Context gagal total jika API lambat/down.
4. Readiness tidak punya kesempatan membedakan warming up vs broken.

Lebih baik:

```java
@Component
final class CacheWarmupRunner implements ApplicationRunner {
    @Override
    public void run(ApplicationArguments args) {
        // controlled warmup, with timeout, metric, and readiness semantics
    }
}
```

Atau warmup async setelah readiness ditahan eksplisit.

### 12.5 Web Server Failure

Contoh:

```text
Web server failed to start. Port 8080 was already in use.
```

Root cause:

1. Port conflict.
2. Privileged port.
3. Connector config invalid.
4. SSL config invalid.
5. Keystore unreadable.
6. Servlet initializer error.

Debug:

```bash
lsof -i :8080
netstat -ano | findstr :8080
```

Untuk Windows:

```powershell
netstat -ano | findstr :8080
Get-Process -Id <PID>
```

### 12.6 Native/AOT Failure

Gejala:

```text
NoSuchMethodException
ClassNotFoundException
Proxy class not available
Resource not found
```

Root cause:

1. Reflection tidak diberi hint.
2. Resource tidak dimasukkan native image.
3. Dynamic proxy tidak terdaftar.
4. Library memakai dynamic class loading.
5. Condition berbeda antara build-time dan run-time.

Solusi:

```text
RuntimeHintsRegistrar
@RegisterReflectionForBinding
native test
AOT processing diagnostics
```

Akan dibahas lebih dalam di Part 29.

---

## 13. Embedded Web Server Startup

Untuk aplikasi web, embedded server ikut lifecycle context.

Servlet stack:

```text
SpringApplication
  -> AnnotationConfigServletWebServerApplicationContext
  -> onRefresh()
  -> createWebServer()
  -> ServletWebServerFactory
  -> Tomcat/Jetty/Undertow server
  -> DispatcherServlet registration
  -> filter/servlet/listener registration
```

Reactive stack:

```text
SpringApplication
  -> AnnotationConfigReactiveWebServerApplicationContext
  -> ReactiveWebServerFactory
  -> Reactor Netty/Jetty/etc
  -> HttpHandler
  -> WebFlux runtime
```

Pitfall:

```text
WebServerInitializedEvent tidak berarti application ready.
```

Server bisa sudah bind port, tetapi runner belum selesai, cache belum warm, migration belum selesai, readiness belum accepting traffic.

Itulah kenapa readiness harus dibedakan dari sekadar “port terbuka”.

---

## 14. `ApplicationStartedEvent`, Liveness, Runner, dan Readiness

Setelah context refresh sukses:

```text
ApplicationStartedEvent
```

dipublish.

Maknanya:

```text
ApplicationContext sudah refreshed.
Bean singleton utama sudah dibuat.
Web server mungkin sudah start.
ApplicationRunner/CommandLineRunner belum dipanggil.
```

Setelah itu Boot menandai liveness correct.

Lalu runner dipanggil:

```java
@Component
final class StartupVerifier implements ApplicationRunner {
    @Override
    public void run(ApplicationArguments args) {
        // startup task
    }
}
```

Setelah runner selesai:

```text
ApplicationReadyEvent
ReadinessState.ACCEPTING_TRAFFIC
```

Makna penting:

```text
ApplicationStartedEvent != ready for traffic
ApplicationReadyEvent   ~= ready for traffic
```

Jika runner gagal, aplikasi dapat gagal startup meskipun context sudah refreshed.

---

## 15. `ApplicationRunner` vs `CommandLineRunner`

Keduanya dipanggil sebelum `SpringApplication.run(...)` selesai.

| Runner | Input | Kapan Dipakai |
|---|---|---|
| `CommandLineRunner` | `String... args` | sederhana, raw args cukup |
| `ApplicationRunner` | `ApplicationArguments` | butuh parsed option/non-option args |

Contoh:

```java
@Component
@Order(10)
final class DatabaseMigrationVerifier implements ApplicationRunner {

    @Override
    public void run(ApplicationArguments args) {
        if (args.containsOption("skip-startup-verification")) {
            return;
        }
        // verify migration state
    }
}
```

Guideline:

1. Runner cocok untuk startup task yang memang harus terjadi setelah context siap.
2. Runner harus punya timeout jika memanggil resource eksternal.
3. Runner harus observable.
4. Runner harus idempotent.
5. Runner tidak boleh diam-diam melakukan pekerjaan besar tanpa metric/log.
6. Runner yang gagal harus memberikan error yang jelas.

Anti-pattern:

```java
@Component
final class BadRunner implements CommandLineRunner {
    @Override
    public void run(String... args) {
        while (true) {
            // start background loop manually
        }
    }
}
```

Lebih baik gunakan scheduler, lifecycle bean, listener container, atau managed executor.

---

## 16. Availability State: Liveness vs Readiness

Spring Boot menyediakan application availability state.

Konsep:

```text
Liveness  = apakah process masih dalam state internal yang valid?
Readiness = apakah process siap menerima traffic sekarang?
```

Contoh:

| Kondisi | Liveness | Readiness |
|---|---|---|
| Startup masih warmup | correct | refusing traffic |
| DB sementara down tapi app bisa recover | correct | refusing traffic / degraded |
| Cache internal corrupt tidak bisa recover | broken | refusing traffic |
| App overload | correct | refusing traffic |
| Deadlock fatal | broken | refusing traffic |

Kesalahan umum:

```text
Memasukkan semua dependency eksternal ke liveness.
```

Jika DB down sementara lalu liveness gagal, Kubernetes bisa restart pod terus-menerus. Itu sering memperburuk incident.

Lebih baik:

```text
liveness: health of application internals
readiness: ability to serve traffic safely
```

Contoh update readiness manual:

```java
@Component
final class MaintenanceGate {

    private final ApplicationEventPublisher events;

    MaintenanceGate(ApplicationEventPublisher events) {
        this.events = events;
    }

    void stopAcceptingTraffic() {
        AvailabilityChangeEvent.publish(
                events,
                this,
                ReadinessState.REFUSING_TRAFFIC
        );
    }

    void startAcceptingTraffic() {
        AvailabilityChangeEvent.publish(
                events,
                this,
                ReadinessState.ACCEPTING_TRAFFIC
        );
    }
}
```

---

## 17. FailureAnalyzer

Spring Boot dapat mengubah exception startup menjadi pesan yang lebih actionable melalui `FailureAnalyzer`.

Tanpa analyzer:

```text
BeanCreationException: Error creating bean with name 'x' ...
```

Dengan analyzer:

```text
Description:

The configured policy file '/etc/app/policy.yml' does not exist.

Action:

Create the file, mount the config volume, or set app.policy.enabled=false.
```

Custom analyzer berguna untuk internal starter/platform.

Contoh custom exception:

```java
public final class PolicyConfigurationException extends RuntimeException {
    private final String location;

    public PolicyConfigurationException(String location) {
        super("Policy configuration not found: " + location);
        this.location = location;
    }

    public String location() {
        return location;
    }
}
```

Analyzer:

```java
public final class PolicyConfigurationFailureAnalyzer
        extends AbstractFailureAnalyzer<PolicyConfigurationException> {

    @Override
    protected FailureAnalysis analyze(
            Throwable rootFailure,
            PolicyConfigurationException cause
    ) {
        return new FailureAnalysis(
                "The configured policy file does not exist: " + cause.location(),
                "Mount the file, correct app.policy.location, " +
                        "or disable the policy module with app.policy.enabled=false.",
                cause
        );
    }
}
```

Registrasi untuk Boot 2/3 style biasanya melalui metadata factory mechanism. Untuk Boot modern, cek mekanisme registrasi yang sesuai versi target karena beberapa metadata loading di ekosistem Spring berubah lintas generasi.

Engineering rule:

> FailureAnalyzer adalah bagian dari developer experience dan operability. Internal starter yang production-grade harus gagal dengan pesan yang jelas.

---

## 18. Condition Evaluation Report sebagai Diagnostic Tool

Ketika auto-configuration tidak sesuai ekspektasi, condition report lebih berguna daripada menebak.

Aktifkan:

```bash
java -jar app.jar --debug
```

Atau:

```properties
debug=true
```

Report akan menunjukkan:

```text
Positive matches
Negative matches
Unconditional classes
Exclusions
```

Contoh pertanyaan yang bisa dijawab:

```text
Kenapa DataSourceAutoConfiguration aktif?
Kenapa RedisAutoConfiguration tidak aktif?
Kenapa WebMvcAutoConfiguration aktif walau saya pikir ini batch app?
Kenapa SecurityAutoConfiguration membuat default filter chain?
Kenapa custom bean saya membuat auto-config back off?
```

Pattern diagnosis:

```text
Symptom: bean default Boot tidak muncul
  -> cari auto-config terkait
  -> lihat negative matches
  -> lihat missing class/property/bean
  -> cek @ConditionalOnMissingBean
  -> cek custom bean yang membuat back-off
```

---

## 19. ApplicationStartup: Mengukur Startup Step

Spring menyediakan `ApplicationStartup` untuk tracking startup step.

Tujuan:

1. Melihat langkah startup yang mahal.
2. Menemukan bean lambat dibuat.
3. Melihat auto-configuration/lifecycle bottleneck.
4. Menganalisis regression startup.
5. Membantu profiling dengan data yang lebih struktural daripada log biasa.

Contoh Boot:

```java
@SpringBootApplication(proxyBeanMethods = false)
public class MyApplication {
    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(MyApplication.class);
        app.setApplicationStartup(new BufferingApplicationStartup(2048));
        app.run(args);
    }
}
```

Dengan actuator startup endpoint, startup steps dapat dibaca dari endpoint jika exposure dikonfigurasi.

Konfigurasi contoh:

```properties
management.endpoints.web.exposure.include=health,info,startup
```

Request:

```bash
curl http://localhost:8080/actuator/startup
```

Output berisi timeline events seperti:

```json
{
  "startupStep": {
    "name": "spring.beans.instantiate",
    "tags": [
      { "key": "beanName", "value": "homeController" }
    ]
  }
}
```

Interpretasi:

```text
spring.beans.instantiate     -> bean creation cost
spring.context.config-classes -> configuration class processing
spring.boot.application.*    -> boot phase marker
```

Jangan aktifkan exposure endpoint sembarangan di production. Startup endpoint bisa mengandung informasi internal bean/config.

---

## 20. Startup Performance: Apa yang Biasanya Lambat?

Startup lambat biasanya bukan karena “Spring lambat” secara abstrak. Biasanya karena kombinasi hal konkret:

| Penyebab | Gejala |
|---|---|
| Classpath besar | startup scanning/config processing lambat |
| Terlalu banyak auto-config | condition evaluation banyak |
| Banyak singleton eager | refresh lama |
| Bean init melakukan I/O | startup menunggu network/database/file |
| Entity scanning besar | JPA startup lama |
| Migration tool berat | Flyway/Liquibase lama |
| External call di init | startup bergantung sistem lain |
| Logging sync berat | startup I/O log lambat |
| Security key loading lambat | resource/keystore/network issue |
| Native image missing hint | failure/slow fallback tidak jelas |

Langkah diagnosis:

```text
1. Aktifkan ApplicationStartup.
2. Aktifkan condition debug jika auto-config dicurigai.
3. Lihat bean instantiation lambat.
4. Cari @PostConstruct / InitializingBean yang melakukan I/O.
5. Pisahkan refresh time, web server time, runner time.
6. Bandingkan cold start vs warm start.
7. Jalankan JFR jika perlu.
```

---

## 21. Lazy Initialization: Obat atau Menunda Masalah?

Spring Boot dapat mengaktifkan lazy initialization:

```properties
spring.main.lazy-initialization=true
```

Efek:

```text
Non-lazy singleton tidak semuanya dibuat saat startup.
Bean dibuat saat pertama kali dibutuhkan.
```

Kelebihan:

1. Startup lebih cepat.
2. Useful untuk dev/test tertentu.
3. Mengurangi cold start awal.

Risiko:

1. Error bean muncul saat request pertama.
2. Latency request pertama naik.
3. Production readiness bisa misleading.
4. Dependency graph invalid tidak ketahuan saat deploy.
5. Warmup perlu eksplisit.

Guideline:

| Context | Lazy Init |
|---|---|
| Local dev | boleh berguna |
| Test tertentu | boleh untuk speed |
| Production critical service | hati-hati |
| Function/serverless cold start | bisa dipertimbangkan dengan warmup |
| Regulatory/enterprise app | default eager lebih defensible |

Rule:

> Lazy initialization adalah trade-off antara startup speed dan fail-fast certainty.

---

## 22. Startup Work Placement: Di Mana Logic Harus Ditaruh?

Salah satu skill penting adalah menaruh startup logic di hook yang tepat.

| Kebutuhan | Tempat yang Lebih Tepat |
|---|---|
| Set environment property awal | Environment post processor / initializer |
| Register bean definition | Registrar / BeanDefinitionRegistryPostProcessor |
| Modify bean factory metadata | BeanFactoryPostProcessor |
| Wrap/alter bean instance | BeanPostProcessor |
| Validate config object | `@ConfigurationProperties` + validation |
| Warmup after context ready | ApplicationRunner |
| Start managed background component | SmartLifecycle |
| React after ready | ApplicationReadyEvent listener |
| Graceful stop | SmartLifecycle / destroy callback |
| Human-readable startup failure | FailureAnalyzer |

Anti-pattern mapping:

| Anti-pattern | Kenapa Buruk | Alternatif |
|---|---|---|
| external API call in constructor | bean creation jadi I/O | runner/lifecycle with timeout |
| DB query in `@PostConstruct` | startup tied to DB readiness | health/readiness/runner |
| Thread manual in constructor | unmanaged thread | TaskExecutor/SmartLifecycle |
| register bean inside listener late | ordering fragile | registrar/post processor |
| huge migration in web app startup | readiness lama/tidak jelas | controlled migration job |

---

## 23. DevTools Restart Model

Spring Boot DevTools mempercepat development dengan restart mechanism.

Mental model:

```text
base classloader    -> stable dependencies
restart classloader -> application classes
```

Saat source berubah, restart classloader dibuat ulang.

Pitfall:

1. Event startup bisa terlihat lebih dari sekali.
2. Static state bisa membingungkan.
3. Classloader leak bisa muncul.
4. Caching reflection/class metadata bisa salah jika tidak restart-safe.
5. Dev behavior tidak identik dengan production.

Rule:

> Jangan menyimpulkan production startup behavior hanya dari DevTools restart.

Untuk debugging startup production, jalankan tanpa DevTools.

---

## 24. Java 8–25 Perspective

### 24.1 Java 8 + Spring Boot 2.x

Karakteristik:

1. `javax.*` namespace.
2. Spring Framework 5.x.
3. Reflection/proxy model klasik.
4. Tidak ada virtual thread.
5. Tidak ada record sebagai config model native style.
6. Boot startup diagnostics sudah ada tetapi lebih terbatas daripada generasi modern.

Design implication:

```text
Gunakan class config biasa.
Hati-hati dengan library version drift.
Upgrade path harus direncanakan karena Boot 2.x ke 3.x adalah breaking migration.
```

### 24.2 Java 17 + Spring Boot 3.x

Karakteristik:

1. Minimum Java 17.
2. `jakarta.*` namespace.
3. AOT/native support matang.
4. Observability modern.
5. Config record lebih natural.
6. Stronger baseline untuk sealed/record/pattern matching di app code.

Design implication:

```text
Gunakan immutable config.
Mulai bersihkan reflection/dynamic behavior.
Perhatikan native readiness jika target container/serverless.
```

### 24.3 Java 21–25 + Spring Boot 3.x/4.x

Karakteristik:

1. Virtual threads available.
2. Java 25 sebagai LTS modern.
3. Boot 4 dan Framework 7 generasi modern.
4. Jakarta EE 11 alignment di Framework 7.
5. API modern seperti RestClient/HTTP interface semakin penting.

Design implication:

```text
Startup tetap harus fail-fast.
Virtual thread tidak menghapus kebutuhan readiness, timeout, connection pool, dan backpressure.
AOT/native tetap punya constraint terpisah dari Java version.
```

---

## 25. Common Startup Failure Catalogue

### 25.1 Wrong Java Runtime

Gejala:

```text
UnsupportedClassVersionError
```

Diagnosis:

```bash
java -version
./mvnw -version
./gradlew --version
```

Fix:

```text
Samakan toolchain compile dan runtime.
Gunakan Maven/Gradle toolchain.
Pastikan Docker base image benar.
```

### 25.2 Missing Configuration

Gejala:

```text
Could not resolve placeholder
BindException
ConfigurationPropertiesBindException
```

Fix:

```text
Gunakan @ConfigurationProperties + validation.
Dokumentasikan required properties.
Jangan mengandalkan default untuk secret production.
```

### 25.3 Auto-Configuration Unexpected

Gejala:

```text
Bean X muncul padahal tidak dibuat manual
Security default login muncul
DataSource auto-config gagal
```

Fix:

```text
Baca condition report.
Cek dependency transitif.
Cek @ConditionalOnClass/@ConditionalOnMissingBean.
Exclude auto-config jika benar-benar perlu.
```

### 25.4 Port Conflict

Gejala:

```text
Port 8080 was already in use
```

Fix:

```text
Ubah server.port.
Matikan process lain.
Gunakan random port untuk test.
```

### 25.5 Runner Failure

Gejala:

```text
Started context lalu gagal sebelum ready
```

Fix:

```text
Cek ApplicationRunner/CommandLineRunner.
Pastikan startup task timeout/idempotent.
Pisahkan migration/warmup yang berat.
```

### 25.6 Shutdown during Startup

Gejala:

```text
Context initialization failed; cancelling refresh attempt
```

Makna:

```text
Spring sedang cleanup partial context.
Cari root cause pertama, bukan error cleanup terakhir.
```

Rule penting:

> Dalam startup stack trace, root cause pertama yang meaningful sering lebih penting daripada exception paling bawah yang noisy akibat cleanup.

---

## 26. Reading Startup Logs Like an Engineer

Contoh log:

```text
Starting CaseService using Java 25.0.3 with PID 54551
No active profile set, falling back to default
Tomcat initialized with port 8080
Root WebApplicationContext: initialization completed in 3421 ms
Tomcat started on port 8080
Started CaseService in 6.318 seconds
```

Cara membaca:

```text
Starting ... Java ... PID
  -> process/JVM ok

No active profile set
  -> profile risk; default profile active

Tomcat initialized
  -> servlet web context selected

Root WebApplicationContext initialized
  -> context refresh mostly complete

Tomcat started
  -> port bound

Started ...
  -> ApplicationStarted/Ready sequence likely completed, depending log position
```

Jika ada runner lambat, log bisa terlihat:

```text
Tomcat started on port 8080
Running startup verification...
Started App in 45 seconds
```

Artinya web server sudah bind lebih awal, tetapi readiness belum tentu accepting traffic sampai runner selesai.

---

## 27. Designing Startup for Production Systems

Startup production harus memenuhi beberapa invariant:

```text
1. Required config must be validated before serving traffic.
2. Bean graph must fail fast if structurally invalid.
3. External dependency unavailability must be classified: fatal vs temporarily not ready.
4. Startup work must be bounded by timeout.
5. Startup must emit enough diagnostics.
6. Readiness must represent traffic safety, not merely process existence.
7. Liveness must not restart process because of recoverable external outage.
8. Shutdown must clean partially initialized resources.
```

Praktik yang baik:

1. Gunakan `@ConfigurationProperties` untuk config contract.
2. Validasi config critical.
3. Hindari I/O di constructor.
4. Hindari long task di `@PostConstruct`.
5. Gunakan `ApplicationRunner` untuk startup verification.
6. Gunakan `SmartLifecycle` untuk managed long-running component.
7. Gunakan health/readiness untuk external dependency.
8. Gunakan metric untuk startup duration.
9. Gunakan failure analyzer untuk internal starter.
10. Gunakan condition report saat debugging auto-config.

---

## 28. Startup in Kubernetes / Container Runtime

Di container, startup bukan hanya urusan Spring.

Ada beberapa lapis:

```text
container process starts
  -> JVM starts
  -> Spring starts
  -> web server binds port
  -> readiness becomes accepting traffic
  -> service routes traffic
```

Probe design:

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
```

Startup probe dapat dipakai jika cold start lama:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  failureThreshold: 30
  periodSeconds: 10
```

Kesalahan umum:

1. Readiness probe diarahkan ke `/actuator/health` yang terlalu luas.
2. Liveness bergantung DB.
3. Initial delay ditebak tanpa data startup.
4. Probe timeout terlalu kecil.
5. App menerima traffic sebelum runner selesai.
6. Graceful shutdown tidak diberi cukup waktu.

---

## 29. Startup and Graceful Shutdown Coupling

Startup dan shutdown harus dipikirkan bersama.

Jika startup membuka resource:

```text
datasource
message listener
scheduler
web server
thread pool
file watcher
cache connection
```

shutdown harus menutupnya dalam urutan aman.

Spring Boot mendaftarkan shutdown hook untuk menutup `ApplicationContext` secara graceful. Lifecycle callback seperti `@PreDestroy`, `DisposableBean`, dan `SmartLifecycle.stop()` dapat dipakai.

Rule:

```text
Resource yang start di lifecycle Spring harus stop di lifecycle Spring.
```

Jangan membuat thread manual tanpa ownership.

Buruk:

```java
@PostConstruct
void start() {
    new Thread(this::loop).start();
}
```

Lebih baik:

```java
@Component
final class ManagedWorker implements SmartLifecycle {
    private volatile boolean running;

    @Override
    public void start() {
        this.running = true;
        // submit to managed executor
    }

    @Override
    public void stop() {
        this.running = false;
    }

    @Override
    public boolean isRunning() {
        return running;
    }
}
```

---

## 30. Diagnostic Playbook

### Case 1 — Aplikasi Gagal karena Bean Missing

```text
1. Ambil error root cause.
2. Identifikasi required type.
3. Cari apakah class implementation ada.
4. Cek component scan package.
5. Cek profile/condition.
6. Cek auto-config report.
7. Cek custom bean membuat back-off tidak sengaja.
8. Tambahkan explicit bean atau perbaiki condition.
```

### Case 2 — Aplikasi Lambat Start

```text
1. Catat total startup time.
2. Aktifkan ApplicationStartup.
3. Lihat step terbesar.
4. Pisahkan context refresh vs runner vs web server.
5. Cari I/O di constructor/PostConstruct.
6. Cek JPA/entity scanning/migration.
7. Cek external calls.
8. Tambahkan metric startup.
9. Optimalkan berdasarkan evidence.
```

### Case 3 — App Start Lokal, Gagal di Container

```text
1. Bandingkan Java version.
2. Bandingkan active profile.
3. Bandingkan env var.
4. Bandingkan working directory.
5. Cek mounted config/secret.
6. Cek file permission.
7. Cek port binding.
8. Cek timezone/locale jika relevan.
9. Cek memory limit.
```

### Case 4 — App Start, Tapi Tidak Bisa Serve Traffic

```text
1. Cek readiness state.
2. Cek runner belum selesai/gagal.
3. Cek health indicator.
4. Cek dependency eksternal.
5. Cek security filter blocking health/API.
6. Cek web server bind address.
7. Cek reverse proxy/service routing.
```

### Case 5 — App Restart Loop di Kubernetes

```text
1. Cek apakah liveness terlalu agresif.
2. Cek apakah liveness bergantung external dependency.
3. Cek startupProbe.
4. Cek memory OOMKilled.
5. Cek port/probe path.
6. Cek context failure.
7. Cek graceful shutdown timeout.
```

---

## 31. Design Heuristics untuk Top-Tier Spring Engineer

### 31.1 Jangan Menaruh Work Berat Terlalu Awal

Constructor harus murah.

```java
public MyService(Dependency dependency) {
    this.dependency = dependency;
}
```

Bukan:

```java
public MyService(Dependency dependency) {
    this.dependency = dependency;
    dependency.callRemoteSystem();
}
```

### 31.2 Fail Fast untuk Struktur, Degrade untuk Dependency Eksternal

Struktur invalid:

```text
missing config
invalid bean graph
wrong required property
incompatible version
```

harus fail fast.

Dependency eksternal sementara:

```text
remote API slow
DB temporarily unavailable
cache warming
message broker reconnecting
```

harus diputuskan:

```text
fatal startup failure
atau readiness refusing traffic
atau degraded mode
```

Jangan semua disamaratakan.

### 31.3 Startup Harus Terukur

Tambahkan:

1. Startup duration metric.
2. Runner duration metric.
3. Warmup duration metric.
4. Failure reason log.
5. Version/build info.
6. Active profile log.
7. Critical config summary tanpa secret.

### 31.4 Startup Harus Deterministik

Hindari:

1. Random ordering.
2. Race antar listener.
3. Background thread unmanaged.
4. External call tanpa timeout.
5. Silent fallback config.
6. Hidden dependency ke current working directory.

### 31.5 Extension Point Harus Dipilih Berdasarkan Fase

Jangan memakai `@PostConstruct` untuk semua hal.

Pilih berdasarkan kebutuhan:

```text
metadata change       -> registry/post processor
object wrapping       -> bean post processor
startup verification  -> runner
managed component     -> SmartLifecycle
traffic readiness     -> availability state
human diagnostics     -> failure analyzer
```

---

## 32. Minimal Reference Application untuk Eksperimen

```java
@SpringBootApplication(proxyBeanMethods = false)
public class StartupLabApplication {

    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(StartupLabApplication.class);
        app.setApplicationStartup(new BufferingApplicationStartup(2048));
        app.addListeners(new VeryEarlyListener());
        app.run(args);
    }
}
```

Early listener:

```java
final class VeryEarlyListener implements ApplicationListener<ApplicationStartingEvent> {
    @Override
    public void onApplicationEvent(ApplicationStartingEvent event) {
        System.err.println("[early] starting");
    }
}
```

Runner:

```java
@Component
@Order(10)
final class StartupCheckRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(StartupCheckRunner.class);

    @Override
    public void run(ApplicationArguments args) {
        long start = System.nanoTime();
        try {
            log.info("Running startup checks");
            // verify required local invariant
        } finally {
            long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
            log.info("Startup checks completed in {} ms", elapsedMs);
        }
    }
}
```

Readiness listener:

```java
@Component
final class AvailabilityLogger {

    private static final Logger log = LoggerFactory.getLogger(AvailabilityLogger.class);

    @EventListener
    void onReadiness(AvailabilityChangeEvent<ReadinessState> event) {
        log.info("Readiness changed to {}", event.getState());
    }

    @EventListener
    void onLiveness(AvailabilityChangeEvent<LivenessState> event) {
        log.info("Liveness changed to {}", event.getState());
    }
}
```

Actuator config:

```properties
management.endpoints.web.exposure.include=health,info,startup
management.endpoint.health.probes.enabled=true
```

---

## 33. Checklist Startup Production Readiness

Gunakan checklist ini sebelum production release:

```text
[ ] Java runtime version sesuai compile target.
[ ] Spring Boot/Spring Framework version sesuai baseline.
[ ] Active profile eksplisit.
[ ] Required config divalidasi dengan @ConfigurationProperties.
[ ] Tidak ada secret tercetak di startup log.
[ ] Tidak ada external call di constructor.
[ ] Tidak ada long-running task di @PostConstruct.
[ ] ApplicationRunner punya timeout/idempotency jika melakukan I/O.
[ ] Condition report dipahami untuk auto-config penting.
[ ] Health liveness/readiness dipisahkan.
[ ] Kubernetes probes diarahkan ke endpoint yang tepat.
[ ] Startup time diukur.
[ ] Startup endpoint tidak diekspos publik.
[ ] FailureAnalyzer tersedia untuk starter internal yang kompleks.
[ ] Graceful shutdown diuji.
[ ] DevTools tidak ada di production artifact.
[ ] Native image hints diuji jika target native.
```

---

## 34. Ringkasan Mental Model

Spring Boot startup dapat diringkas sebagai:

```text
SpringApplication is the bootstrap orchestrator.
Environment is prepared before context.
Context is selected from classpath/application type.
Bean definitions are loaded before refresh.
refresh() builds the real runtime object graph.
Web server start does not automatically mean application readiness.
Runners execute after context started but before run() completes.
Availability state separates process health from traffic readiness.
FailureAnalyzer turns known startup failures into actionable diagnostics.
ApplicationStartup turns startup from guesswork into timeline data.
```

Jika Anda ingin membaca startup seperti top-tier engineer, jangan mulai dari stack trace paling panjang. Mulai dari fase:

```text
Apakah JVM sudah masuk main?
Apakah environment berhasil disiapkan?
Apakah context berhasil dibuat?
Apakah bean definitions berhasil dimuat?
Apakah refresh gagal?
Apakah web server gagal?
Apakah runner gagal?
Apakah readiness belum accepting traffic?
```

Setelah fase diketahui, root cause biasanya jauh lebih sempit.

---

## 35. Latihan Praktis

### Latihan 1 — Mapping Event Timeline

Buat listener untuk event berikut:

```text
ApplicationStartingEvent
ApplicationEnvironmentPreparedEvent
ApplicationContextInitializedEvent
ApplicationPreparedEvent
ApplicationStartedEvent
ApplicationReadyEvent
ApplicationFailedEvent
```

Cetak timestamp dan nama event. Jalankan app dan amati urutan.

### Latihan 2 — Simulasi Missing Config

Buat `@ConfigurationProperties` dengan field wajib. Jalankan tanpa property. Pastikan startup gagal dengan pesan yang jelas.

### Latihan 3 — Simulasi Runner Failure

Buat `ApplicationRunner` yang throw exception. Amati perbedaan log dibanding bean creation failure.

### Latihan 4 — ApplicationStartup

Aktifkan `BufferingApplicationStartup`, expose `/actuator/startup`, lalu identifikasi step paling mahal.

### Latihan 5 — Liveness vs Readiness

Buat endpoint internal yang mengubah `ReadinessState` dari `ACCEPTING_TRAFFIC` ke `REFUSING_TRAFFIC`. Amati actuator health readiness.

### Latihan 6 — Port Conflict

Jalankan dua instance di port sama. Baca failure analyzer output dan identifikasi fase failure.

---

## 36. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

```text
09-spring-aop-proxy-method-interception.md
```

Kenapa setelah startup kita masuk ke AOP/proxy?

Karena setelah object graph terbentuk, banyak fitur Spring bukan bekerja melalui inheritance atau compiler magic, tetapi melalui proxy dan interceptor:

```text
@Transactional
@Async
@Cacheable
@PreAuthorize
@Repository exception translation
custom aspects
```

Jika tidak memahami proxy, kita tidak akan bisa memahami kenapa annotation Spring kadang bekerja dan kadang tidak. Proxy adalah fondasi runtime behavior setelah startup selesai.

---

## 37. Status Seri

```text
Part saat ini : 8 dari 35
Status        : belum selesai
Berikutnya    : 09-spring-aop-proxy-method-interception.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./07-spring-boot-auto-configuration-internals.md">⬅️ Part 7 — Spring Boot Auto-Configuration Internals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./09-spring-aop-proxy-method-interception.md">Spring AOP, Proxy Model, and Method Interception ➡️</a>
</div>

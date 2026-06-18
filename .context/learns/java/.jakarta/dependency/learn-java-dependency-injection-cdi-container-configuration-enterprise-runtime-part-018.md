# learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime — Part 018
# Lifecycle Callbacks: Construction, Initialization, Destruction

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Part: `018`  
> Topik: Lifecycle callbacks pada Java/Jakarta managed runtime: constructor, injection, `@PostConstruct`, service readiness, `@PreDestroy`, destruction, dan failure model.  
> Target: Java 8–25, Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI, Enterprise Beans, servlet/container runtime, MicroProfile/modern enterprise runtime.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 017, kita sudah membangun fondasi:

1. dependency graph dan reproducible build;
2. API/SPI/implementation/provider;
3. migrasi `javax.*` ke `jakarta.*`;
4. container model;
5. classloader dan deployment isolation;
6. DI/IoC fundamental;
7. Jakarta Inject;
8. CDI bean/type/qualifier/scope/context;
9. bean discovery;
10. scope lifecycle;
11. proxy dan method dispatch;
12. qualifier/alternative/specialization/priority;
13. producer/disposer;
14. CDI events;
15. interceptors;
16. decorators;
17. stereotypes dan annotation composition.

Part ini membahas pertanyaan yang terlihat sederhana, tetapi sangat penting dalam sistem enterprise:

> **Kapan sebuah object benar-benar siap dipakai?**

Di Java biasa, object terlihat “siap” setelah constructor selesai.

Di CDI/Jakarta runtime, itu tidak selalu benar.

Dalam managed runtime, object bisa melewati beberapa fase:

```text
class loaded
  ↓
constructor invoked
  ↓
dependency/resource injection
  ↓
initializer/lifecycle callback
  ↓
interceptor/decorator/proxy wiring effective
  ↓
bean enters service
  ↓
used by application requests/tasks/events
  ↓
context ends / application shutdown / bean removed
  ↓
pre-destroy callback
  ↓
resources released
```

Karena itu, topik lifecycle bukan sekadar hafalan `@PostConstruct` dan `@PreDestroy`. Lifecycle adalah kontrak runtime yang menentukan:

- kapan dependency sudah tersedia;
- kapan config boleh dibaca;
- kapan resource eksternal boleh dibuka;
- kapan task background boleh dimulai;
- kapan cache boleh dipanaskan;
- kapan object boleh menerima request;
- kapan resource harus ditutup;
- apa yang terjadi jika initialization gagal;
- apa yang tidak dijamin saat shutdown.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. membedakan constructor, injection phase, initialization phase, service phase, dan destruction phase;
2. menjelaskan kenapa constructor bukan tempat ideal untuk logic runtime berat pada managed bean;
3. memakai `@PostConstruct` dan `@PreDestroy` secara benar;
4. memahami perbedaan lifecycle unmanaged object, CDI bean, producer-created object, EJB/session bean, servlet, dan application-scoped service;
5. mendesain startup initialization yang fail-fast tetapi tidak membuat aplikasi fragile;
6. mendesain shutdown cleanup yang aman, idempotent, dan tidak menggantung;
7. mendiagnosis error lifecycle seperti dependency null, context not active, self-invocation, resource leak, thread leak, dan failed deployment;
8. membangun mental model production-grade tentang readiness, liveness, warmup, draining, dan graceful shutdown.

---

## 2. Baseline Versi dan Namespace

Lifecycle annotations historisnya berada di Java EE / `javax.annotation`:

```java
import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
```

Dalam Jakarta EE modern, namespace berubah menjadi:

```java
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
```

Secara konsep, lifecycle-nya sama: method `@PostConstruct` dipanggil setelah dependency injection selesai dan sebelum instance dipakai untuk melayani request; method `@PreDestroy` dipanggil saat container akan membuang instance agar resource bisa dilepas.

Java 8 masih banyak berada di dunia Java EE / `javax.*`. Java 11+ perlu perhatian khusus karena beberapa Java EE annotation yang dulu tersedia di JDK tidak lagi diasumsikan otomatis tersedia dari JDK. Dalam Jakarta EE 9+, namespace standard menjadi `jakarta.*`.

Prinsip penting:

```text
Java version menentukan bahasa/runtime JVM.
Jakarta EE version menentukan API enterprise/container.
Container version menentukan implementasi lifecycle sebenarnya.
```

Jangan berpikir:

```text
Saya pakai Java 17, berarti otomatis punya semua annotation Jakarta.
```

Yang benar:

```text
Saya pakai Java 17 sebagai JVM.
Untuk Jakarta annotations/CDI/EJB, saya perlu API dan runtime/container yang sesuai.
```

---

## 3. Mental Model Utama: Object Is Not Always Ready After Constructor

Dalam Java SE biasa:

```java
public class ReportService {
    private final ReportRepository repository;

    public ReportService(ReportRepository repository) {
        this.repository = repository;
    }

    public Report generate(String id) {
        return repository.find(id);
    }
}
```

Jika constructor sukses, object biasanya dianggap siap.

Dalam CDI:

```java
@ApplicationScoped
public class ReportService {
    @Inject
    ReportRepository repository;

    public ReportService() {
        // repository belum diinjeksi di sini jika memakai field injection
    }

    @PostConstruct
    void init() {
        // repository sudah tersedia di sini
    }
}
```

Constructor hanya membuat instance dasar. Setelah itu container masih perlu:

- menyelesaikan dependency;
- menginjeksi field/method;
- memanggil initializer;
- menyiapkan interceptor/decorator/proxy;
- mendaftarkan contextual instance ke context;
- memastikan instance valid untuk digunakan.

Jadi model yang lebih benar:

```text
constructor success ≠ managed bean ready
@PostConstruct success ≈ instance ready to enter service
```

Tetapi bahkan `@PostConstruct` pun bukan selalu “seluruh aplikasi sudah ready”. Untuk `@ApplicationScoped` bean, `@PostConstruct` berarti bean tersebut selesai diinisialisasi. Aplikasi secara keseluruhan bisa saja masih mem-bootstrap bean lain, resource lain, deployment lain, atau readiness probe lain.

---

## 4. Lifecycle Timeline Detail

Mari pecah timeline managed bean:

```text
T0  Class loading / metadata discovery
T1  Bean metadata validated
T2  Instance construction
T3  Dependency/resource injection
T4  Initializer methods / lifecycle callbacks
T5  Proxy/contextual reference ready
T6  Bean enters service
T7  Business method invocations
T8  Context ends / bean removed / app shutdown
T9  Pre-destroy callback
T10 Resource cleanup complete
```

### 4.1 T0 — Class Loading / Metadata Discovery

Container membaca class dan metadata:

- annotation scope;
- qualifier;
- interceptor binding;
- stereotype;
- producer;
- observer;
- lifecycle callback;
- injection point.

Pada fase ini, container belum tentu membuat object.

Kesalahan di fase ini biasanya berupa:

- class tidak bisa diload;
- annotation tidak cocok namespace;
- duplicate class;
- missing dependency;
- classloader conflict;
- invalid bean definition.

Contoh:

```text
ClassNotFoundException
NoClassDefFoundError
DeploymentException
DefinitionException
```

### 4.2 T1 — Bean Metadata Validated

Container memvalidasi definisi bean:

- apakah injection point bisa diselesaikan;
- apakah ada ambiguous dependency;
- apakah scope valid;
- apakah bean proxyable;
- apakah callback method valid;
- apakah producer/disposer matching;
- apakah interceptor/decorator valid.

Bean bisa gagal sebelum satu request pun masuk.

Ini baik. Failure saat deployment lebih mudah ditangani daripada failure diam-diam saat runtime.

### 4.3 T2 — Instance Construction

Container membuat instance.

Untuk CDI managed bean, sering kali container butuh constructor yang dapat dipakai:

- no-arg constructor;
- atau constructor `@Inject`;
- atau aturan spesifik provider/runtime.

Contoh constructor injection:

```java
@ApplicationScoped
public class CaseAssignmentService {
    private final AssignmentPolicy policy;
    private final AuditSink auditSink;

    @Inject
    public CaseAssignmentService(AssignmentPolicy policy, AuditSink auditSink) {
        this.policy = policy;
        this.auditSink = auditSink;
    }
}
```

Di sini dependency constructor tersedia saat constructor dipanggil. Namun tetap jangan menganggap semua runtime concern sudah aktif.

### 4.4 T3 — Dependency / Resource Injection

Container melakukan injection:

```java
@Inject
PolicyRepository repository;

@Resource
DataSource dataSource;
```

Setelah fase ini, field/method injection sudah tersedia.

### 4.5 T4 — Initialization Callback

`@PostConstruct` dipanggil setelah injection selesai.

Contoh:

```java
@ApplicationScoped
public class PolicyCache {
    @Inject
    PolicyRepository repository;

    private Map<String, Policy> cache;

    @PostConstruct
    void init() {
        this.cache = repository.loadActivePolicies()
                .stream()
                .collect(Collectors.toUnmodifiableMap(Policy::code, Function.identity()));
    }
}
```

Ini tempat yang lebih benar untuk initialization yang butuh injected dependency.

### 4.6 T5 — Proxy / Contextual Reference Ready

Bean dengan normal scope biasanya dipakai melalui proxy:

```text
consumer → client proxy → contextual instance
```

`@PostConstruct` dipanggil pada actual instance, bukan pada consumer-level mental object.

Interceptors dapat terlibat pada lifecycle callback, tergantung spesifikasi dan container. Namun business method interceptor semantics berbeda dari lifecycle callback semantics.

### 4.7 T6 — Bean Enters Service

Setelah initialization sukses, bean bisa digunakan.

Untuk web request, ini berarti bean dapat menerima method call dari resource/controller/service lain.

Untuk application startup bean, ini berarti bean bisa menjadi bagian dari runtime graph aktif.

### 4.8 T7 — Business Method Invocations

Pada fase ini:

- interceptor business method berlaku;
- decorator chain berlaku;
- transaction boundary berlaku jika ada;
- security check berlaku jika ada;
- context-specific instance dipilih.

### 4.9 T8–T10 — Destruction

Saat context selesai atau app shutdown, container memanggil `@PreDestroy` bila applicable.

Contoh:

```java
@PreDestroy
void destroy() {
    client.close();
}
```

Destruction harus idempotent, cepat, dan tidak bergantung pada terlalu banyak service lain yang mungkin sudah ikut shutdown.

---

## 5. `@PostConstruct`: Apa Sebenarnya Kontraknya?

`@PostConstruct` adalah lifecycle callback untuk initialization setelah dependency injection.

Makna praktisnya:

```text
Dependency sudah diinjeksi.
Instance belum dipakai untuk melayani business call.
Initialization boleh dilakukan.
Jika initialization gagal, instance tidak boleh dianggap siap.
```

Contoh benar:

```java
@ApplicationScoped
public class ExternalCaseClientHolder {
    @Inject
    ExternalCaseClientConfig config;

    private ExternalCaseClient client;

    @PostConstruct
    void init() {
        this.client = ExternalCaseClient.builder()
                .baseUrl(config.baseUrl())
                .connectTimeout(config.connectTimeout())
                .readTimeout(config.readTimeout())
                .build();
    }

    public ExternalCaseClient client() {
        return client;
    }
}
```

### 5.1 Apa yang Cocok Dilakukan di `@PostConstruct`?

Cocok:

- validasi config wajib;
- membangun immutable in-memory structure;
- membuat client object yang thread-safe;
- membuka resource yang memang lifecycle-nya seumur bean;
- mendaftarkan listener lokal jika container-managed;
- warmup ringan;
- precompute data kecil;
- fail-fast untuk invariant yang benar-benar wajib.

Contoh validasi config:

```java
@PostConstruct
void validate() {
    if (baseUrl == null || baseUrl.isBlank()) {
        throw new IllegalStateException("case.client.base-url is required");
    }
}
```

### 5.2 Apa yang Tidak Cocok Dilakukan di `@PostConstruct`?

Hindari:

- operasi I/O berat tanpa timeout;
- network call ke dependency yang belum tentu ready;
- query database besar;
- migrasi schema;
- memulai unmanaged thread;
- block indefinitely;
- memanggil business method diri sendiri yang mengandalkan interceptor;
- publish event eksternal sebelum aplikasi fully ready;
- load seluruh table besar ke memory tanpa limit;
- swallow exception lalu lanjut dengan state rusak.

Contoh buruk:

```java
@PostConstruct
void init() {
    // Buruk: bisa menggantung startup jika dependency lambat.
    List<AuditRecord> all = auditRepository.findAllHistorySinceSystemCreated();
    cache = buildHugeCache(all);
}
```

Lebih baik:

```java
@PostConstruct
void init() {
    this.cache = new ConcurrentHashMap<>();
    this.ready = true;
}

public AuditRecord get(String id) {
    return cache.computeIfAbsent(id, auditRepository::findByIdRequired);
}
```

Atau jika warmup memang wajib:

```java
@PostConstruct
void init() {
    try {
        this.cache = warmupWithBoundedTimeout();
    } catch (TimeoutException e) {
        throw new IllegalStateException("Mandatory warmup failed within timeout", e);
    }
}
```

---

## 6. `@PreDestroy`: Apa Sebenarnya Kontraknya?

`@PreDestroy` adalah callback sebelum container menghancurkan/removing instance.

Makna praktisnya:

```text
Container akan membuang instance.
Ini kesempatan terakhir instance untuk melepas resource yang dimilikinya.
Jangan menjalankan workflow bisnis besar di sini.
```

Contoh:

```java
@ApplicationScoped
public class FeatureFlagClientHolder {
    private FeatureFlagClient client;

    @PostConstruct
    void init() {
        this.client = FeatureFlagClient.create();
    }

    @PreDestroy
    void destroy() {
        if (client != null) {
            client.close();
        }
    }
}
```

### 6.1 Apa yang Cocok Dilakukan di `@PreDestroy`?

Cocok:

- close HTTP client;
- close SDK client;
- stop scheduler yang container-managed wrapper-nya kamu miliki;
- flush buffer kecil;
- unregister listener;
- release lock lokal;
- log shutdown summary;
- stop polling loop dengan timeout.

### 6.2 Apa yang Tidak Cocok Dilakukan di `@PreDestroy`?

Hindari:

- membuka transaksi bisnis baru yang kompleks;
- mengirim banyak request jaringan tanpa timeout;
- menunggu queue kosong tanpa batas;
- memanggil service lain yang mungkin sudah shutdown;
- melakukan database migration;
- melakukan “last-minute important business processing”;
- bergantung pada urutan shutdown bean lain jika tidak dijamin.

Buruk:

```java
@PreDestroy
void destroy() {
    // Buruk: bisa membuat shutdown menggantung dan tidak reliable.
    while (!outboxQueue.isEmpty()) {
        externalSystem.send(outboxQueue.poll());
    }
}
```

Lebih baik:

```java
@PreDestroy
void destroy() {
    try {
        outboxSender.stopAcceptingNewWork();
        outboxSender.drainFor(Duration.ofSeconds(10));
    } catch (Exception e) {
        log.warn("Outbox sender did not drain cleanly during shutdown", e);
    }
}
```

Prinsip:

```text
Shutdown cleanup harus best-effort, bounded, dan idempotent.
```

---

## 7. Constructor vs `@PostConstruct`

### 7.1 Constructor Cocok Untuk Apa?

Constructor cocok untuk:

- menetapkan final fields;
- validasi invariant lokal;
- menerima dependency constructor injection;
- membuat object berada dalam minimal valid state;
- tidak melakukan I/O berat;
- tidak memanggil method overridable/proxied;
- tidak mengakses field injection.

Contoh baik:

```java
@ApplicationScoped
public class ComplianceDecisionService {
    private final RuleRepository ruleRepository;
    private final Clock clock;

    @Inject
    public ComplianceDecisionService(RuleRepository ruleRepository, Clock clock) {
        this.ruleRepository = Objects.requireNonNull(ruleRepository);
        this.clock = Objects.requireNonNull(clock);
    }
}
```

### 7.2 `@PostConstruct` Cocok Untuk Apa?

`@PostConstruct` cocok untuk initialization yang butuh:

- field injection;
- method injection;
- resource injection;
- config provider;
- producer-created dependency;
- container context.

Contoh:

```java
@ApplicationScoped
public class PostalCodeNormalizer {
    @Inject
    NormalizationConfig config;

    private Pattern validPostalCode;

    @PostConstruct
    void init() {
        this.validPostalCode = Pattern.compile(config.postalCodeRegex());
    }
}
```

### 7.3 Jangan Campur Constructor dan Lifecycle Secara Serampangan

Buruk:

```java
@ApplicationScoped
public class BadService {
    @Inject
    Repository repository;

    public BadService() {
        // repository masih null untuk field injection
        repository.loadSomething();
    }
}
```

Benar:

```java
@ApplicationScoped
public class GoodService {
    @Inject
    Repository repository;

    private Data data;

    @PostConstruct
    void init() {
        this.data = repository.loadSomething();
    }
}
```

Atau pakai constructor injection:

```java
@ApplicationScoped
public class BetterService {
    private final Repository repository;
    private Data data;

    @Inject
    public BetterService(Repository repository) {
        this.repository = repository;
    }

    @PostConstruct
    void init() {
        this.data = repository.loadSomething();
    }
}
```

---

## 8. Field Injection, Constructor Injection, dan Lifecycle Clarity

Constructor injection membuat dependency eksplisit:

```java
@Inject
public Service(A a, B b, C c) {
    this.a = a;
    this.b = b;
    this.c = c;
}
```

Field injection membuat dependency lebih tersembunyi:

```java
@Inject A a;
@Inject B b;
@Inject C c;
```

Namun lifecycle callback tetap penting, karena ada initialization yang tidak boleh dilakukan di constructor.

Rule praktis:

```text
Gunakan constructor untuk dependency wajib dan invariant object.
Gunakan @PostConstruct untuk initialization yang butuh container selesai melakukan injection.
Gunakan @PreDestroy untuk cleanup resource yang lifecycle-nya dimiliki bean.
```

---

## 9. Lifecycle dan CDI Scope

Lifecycle callback sangat bergantung scope.

### 9.1 `@ApplicationScoped`

Biasanya:

- dibuat sekali per aplikasi/context;
- `@PostConstruct` satu kali per contextual instance;
- `@PreDestroy` saat aplikasi shutdown/context destroyed.

Cocok untuk:

- shared service stateless;
- cache global;
- client holder thread-safe;
- registry;
- config-derived immutable object.

Risiko:

- memory leak lama;
- state mutable tidak thread-safe;
- startup berat;
- shutdown lambat.

Contoh:

```java
@ApplicationScoped
public class CasePolicyRegistry {
    private Map<String, CasePolicy> policies;

    @Inject
    PolicyLoader loader;

    @PostConstruct
    void init() {
        this.policies = Map.copyOf(loader.loadEnabledPolicies());
    }

    public CasePolicy get(String code) {
        return Optional.ofNullable(policies.get(code))
                .orElseThrow(() -> new UnknownPolicyException(code));
    }
}
```

### 9.2 `@RequestScoped`

Biasanya:

- dibuat per request;
- `@PostConstruct` per request instance;
- `@PreDestroy` ketika request selesai.

Cocok untuk:

- request context holder;
- correlation id;
- request-local cache kecil;
- authenticated subject context.

Risiko:

- initialization terlalu berat per request;
- menyimpan object besar;
- dipakai di async thread tanpa active request context.

Contoh:

```java
@RequestScoped
public class RequestAuditContext {
    private String correlationId;

    @PostConstruct
    void init() {
        this.correlationId = MDC.get("correlationId");
    }

    public String correlationId() {
        return correlationId;
    }
}
```

### 9.3 `@SessionScoped`

Biasanya:

- hidup sepanjang session;
- perlu serializable/passivation aware di banyak runtime;
- callback mengikuti lifecycle session/context.

Risiko:

- memory retention per user;
- stale state;
- serialization issue;
- cluster replication overhead.

### 9.4 `@Dependent`

`@Dependent` mengikuti lifecycle owner/injection target.

Ini scope paling tricky untuk destruction.

Contoh:

```java
@Dependent
public class CsvParser {
    @PostConstruct
    void init() {
        // called when dependent instance created
    }

    @PreDestroy
    void destroy() {
        // called when dependent instance destroyed by owner/container
    }
}
```

Risiko:

- dependent object yang diproduksi manual via `Instance.get()` bisa perlu destroy manual;
- resource leak jika lifecycle ownership tidak jelas.

---

## 10. Lifecycle dan Producer/Disposer

Part 013 sudah membahas producer/disposer. Di sini kita hubungkan dengan lifecycle.

Producer membuat object menjadi bagian dari CDI resolution:

```java
@ApplicationScoped
public class HttpClientProducer {
    @Produces
    @ApplicationScoped
    ExternalHttpClient produce(ClientConfig config) {
        return ExternalHttpClient.builder()
                .baseUrl(config.baseUrl())
                .build();
    }

    void dispose(@Disposes ExternalHttpClient client) {
        client.close();
    }
}
```

Perhatikan:

```text
@PostConstruct/@PreDestroy berlaku pada bean class.
Disposer berlaku pada produced object.
```

Jika produced object bukan CDI bean class, ia tidak otomatis punya `@PreDestroy` sendiri kecuali container/provider mendukung cara tertentu. Disposer adalah tempat eksplisit untuk cleanup produced object.

### 10.1 Producer Bean Lifecycle vs Produced Object Lifecycle

```java
@ApplicationScoped
public class ClientProducer {
    @PostConstruct
    void initProducerBean() {
        // lifecycle producer bean
    }

    @Produces
    @ApplicationScoped
    Client client() {
        // lifecycle produced Client
        return new Client();
    }

    void dispose(@Disposes Client client) {
        // cleanup produced Client
        client.close();
    }

    @PreDestroy
    void destroyProducerBean() {
        // cleanup producer bean itself
    }
}
```

Jangan salah tempat:

- cleanup object yang dihasilkan producer → disposer;
- cleanup state milik producer bean → `@PreDestroy` producer bean.

---

## 11. Lifecycle dan Interceptors

Lifecycle callback bisa berinteraksi dengan interceptor.

Ada dua kategori besar:

1. business method interception;
2. lifecycle callback interception.

Contoh business method interceptor:

```java
@Audited
public void approveCase(String caseId) {
    // business method
}
```

Contoh lifecycle callback:

```java
@PostConstruct
void init() {
    // lifecycle callback
}
```

Jangan menganggap semua interceptor business method otomatis berlaku pada self-call atau constructor. Constructor bukan business method. `@PostConstruct` adalah lifecycle callback, bukan business API normal.

### 11.1 Self-Invocation Problem Saat Initialization

Buruk:

```java
@ApplicationScoped
public class ReportService {
    @PostConstruct
    void init() {
        refreshCache(); // self-call
    }

    @Transactional
    public void refreshCache() {
        // berharap transaction interceptor aktif
    }
}
```

Masalah:

- `refreshCache()` dipanggil dari instance yang sama;
- proxy/interceptor business method bisa tidak aktif;
- transaction/security/audit bisa tidak terjadi sesuai harapan.

Lebih aman:

```java
@ApplicationScoped
public class ReportCacheInitializer {
    @Inject
    ReportCacheService reportCacheService;

    @PostConstruct
    void init() {
        reportCacheService.refreshCache();
    }
}

@ApplicationScoped
public class ReportCacheService {
    @Transactional
    public void refreshCache() {
        // dipanggil melalui injected proxy
    }
}
```

Namun tetap hati-hati: memulai transaksi saat startup bisa punya implikasi container-specific dan dependency readiness.

---

## 12. Lifecycle dan Decorators

Decorator membungkus business interface. Lifecycle callback terjadi pada decorator bean juga jika decorator adalah managed bean.

Misal:

```java
public interface CaseSubmissionService {
    SubmissionResult submit(SubmissionCommand command);
}

@Decorator
public class ComplianceDecoratingSubmissionService implements CaseSubmissionService {
    @Inject
    @Delegate
    CaseSubmissionService delegate;

    @PostConstruct
    void init() {
        // init decorator state
    }

    @Override
    public SubmissionResult submit(SubmissionCommand command) {
        validateCompliance(command);
        return delegate.submit(command);
    }
}
```

Mental model:

```text
Decorator juga punya lifecycle sebagai bean.
Delegate chain juga punya lifecycle masing-masing.
Jangan melakukan business call ke delegate di @PostConstruct kecuali benar-benar memahami readiness graph.
```

---

## 13. Lifecycle dan Events

Apakah boleh fire CDI event di `@PostConstruct`?

Secara teknis sering bisa. Secara arsitektural, perlu hati-hati.

Contoh:

```java
@PostConstruct
void init() {
    event.fire(new CacheInitializedEvent("policy"));
}
```

Risiko:

- observer lain belum tentu dalam state yang kamu asumsikan;
- event bisa memicu dependency chain besar saat startup;
- failure observer bisa menggagalkan initialization;
- startup sequence menjadi tidak jelas.

Lebih baik bedakan:

```text
Bean-level initialization event ≠ application-ready event
```

Untuk application readiness, lebih baik gunakan mekanisme startup/application lifecycle yang jelas dari runtime/framework, atau design explicit boot coordinator.

---

## 14. Lifecycle dan Enterprise Beans

Enterprise Beans punya lifecycle yang lebih kaya, terutama:

- stateless session bean pooling;
- stateful session bean passivation/activation;
- singleton session bean startup;
- timer lifecycle;
- MDB lifecycle.

Contoh EJB singleton startup:

```java
@Singleton
@Startup
public class StartupPolicyLoader {
    @PostConstruct
    void init() {
        // called during application startup
    }
}
```

Perbedaan penting:

```text
CDI @ApplicationScoped bean laziness/eagerness bergantung runtime/usage/extension.
EJB @Singleton @Startup secara eksplisit meminta startup initialization.
```

Tetapi menggunakan startup eager initialization harus bijak. Jika semua service eager dan semua melakukan I/O berat, startup menjadi lambat dan fragile.

### 14.1 Stateless Bean Pool

Untuk stateless EJB, container bisa membuat beberapa instance dalam pool. `@PostConstruct` bisa dipanggil per pooled instance, bukan hanya sekali secara global.

Jadi jangan asumsikan:

```text
@PostConstruct pada stateless bean = satu kali per aplikasi
```

Yang lebih benar:

```text
@PostConstruct pada stateless bean = satu kali per instance yang dibuat container
```

### 14.2 Stateful Bean

Stateful bean punya lifecycle per client/conversation. Cleanup penting karena state bisa menahan memory/resource.

### 14.3 Singleton Bean

Singleton bean bisa menjadi tempat shared state, tetapi harus memperhatikan concurrency dan lock semantics.

---

## 15. Lifecycle dan Servlet/JAX-RS Boundary

Walaupun part ini tidak mengulang JAX-RS, penting memahami boundary.

JAX-RS resource bisa managed oleh CDI/runtime. Lifecycle-nya bisa:

- per request;
- singleton;
- CDI scoped;
- runtime-specific.

Jika resource memakai injection dan `@PostConstruct`, pahami scope aktualnya.

Contoh:

```java
@Path("/cases")
@RequestScoped
public class CaseResource {
    @Inject
    CaseService caseService;

    @PostConstruct
    void init() {
        // per request jika resource CDI @RequestScoped
    }
}
```

Buruk jika initialization berat:

```java
@PostConstruct
void init() {
    expensiveWarmup(); // terjadi per request jika request scoped
}
```

---

## 16. Initialization Strategy: Lazy vs Eager

### 16.1 Lazy Initialization

Lazy berarti resource dibuat saat pertama kali dibutuhkan.

```java
@ApplicationScoped
public class LazyRuleCache {
    @Inject
    RuleRepository repository;

    private volatile Map<String, Rule> cache;

    public Rule get(String code) {
        Map<String, Rule> current = cache;
        if (current == null) {
            synchronized (this) {
                current = cache;
                if (current == null) {
                    current = loadRules();
                    cache = current;
                }
            }
        }
        return current.get(code);
    }

    private Map<String, Rule> loadRules() {
        return Map.copyOf(repository.loadRules());
    }
}
```

Kelebihan:

- startup cepat;
- hanya load jika dipakai;
- dependency eksternal tidak menghambat deployment awal.

Kekurangan:

- request pertama bisa lambat;
- failure muncul saat traffic;
- concurrency perlu aman.

### 16.2 Eager Initialization

Eager berarti resource dibuat saat startup/bean creation.

```java
@PostConstruct
void init() {
    this.rules = Map.copyOf(repository.loadRules());
}
```

Kelebihan:

- fail-fast;
- request pertama stabil;
- readiness lebih jujur jika dependency wajib.

Kekurangan:

- startup lambat;
- dependency external outage bisa mencegah app start;
- semua instance replica bisa stampede ke dependency saat rollout.

### 16.3 Hybrid Initialization

Hybrid sering paling production-grade:

```text
Startup:
- validate mandatory config
- construct lightweight clients
- initialize empty cache
- optionally warm critical small data with timeout

Runtime:
- lazy load non-critical data
- refresh async with backoff
- expose readiness based on critical dependency only
```

Contoh:

```java
@ApplicationScoped
public class PolicyRuntime {
    private final AtomicBoolean warm = new AtomicBoolean(false);
    private volatile Map<String, Policy> policies = Map.of();

    @Inject
    PolicyRepository repository;

    @PostConstruct
    void init() {
        validateRepositoryReachabilityWithSmallTimeout();
        tryWarmupCriticalPolicies();
    }

    public Policy get(String code) {
        Policy policy = policies.get(code);
        if (policy != null) return policy;
        return repository.loadPolicy(code);
    }

    private void tryWarmupCriticalPolicies() {
        try {
            policies = Map.copyOf(repository.loadCriticalPolicies());
            warm.set(true);
        } catch (Exception e) {
            // only if non-critical. If critical, throw.
            log.warn("Policy warmup failed; runtime fallback will be used", e);
        }
    }
}
```

---

## 17. Fail-Fast vs Degraded Startup

Top engineer tidak selalu memilih fail-fast. Mereka memilih berdasarkan contract.

### 17.1 Fail-Fast Cocok Jika

- config wajib hilang;
- secret wajib tidak tersedia;
- database utama tidak dapat dikoneksi padahal aplikasi tidak berguna tanpanya;
- schema incompatible;
- cryptographic key invalid;
- mandatory compliance policy tidak bisa dimuat;
- feature flag default tidak aman;
- service bisa menghasilkan keputusan salah jika lanjut.

Contoh:

```java
@PostConstruct
void init() {
    if (!config.hasSigningKey()) {
        throw new IllegalStateException("Signing key is mandatory");
    }
}
```

### 17.2 Degraded Startup Cocok Jika

- dependency opsional;
- cache bisa lazy reload;
- fallback aman tersedia;
- fitur bisa dimatikan;
- aplikasi masih bisa melayani sebagian request dengan benar.

Contoh:

```java
@PostConstruct
void init() {
    try {
        recommendationClient.ping(Duration.ofSeconds(2));
        recommendationEnabled = true;
    } catch (Exception e) {
        recommendationEnabled = false;
        log.warn("Recommendation integration unavailable; feature disabled", e);
    }
}
```

### 17.3 Decision Table

| Kondisi | Strategy |
|---|---|
| Config wajib invalid | fail-fast |
| Secret signing invalid | fail-fast |
| DB utama unavailable | biasanya fail-fast atau readiness false |
| Cache warmup gagal | degraded jika backing store masih bisa dipakai |
| Optional external enrichment down | degraded |
| Compliance rule mandatory gagal load | fail-fast |
| Metrics exporter down | degraded |
| Audit sink down | tergantung legal/compliance contract |

---

## 18. Readiness, Liveness, Startup, dan Lifecycle

Di container/cloud runtime, lifecycle bean harus dikaitkan dengan probe.

### 18.1 Liveness

Liveness menjawab:

```text
Apakah process masih hidup dan tidak stuck fatal?
```

Jangan masukkan semua dependency eksternal ke liveness. Jika dependency eksternal down lalu liveness fail, orchestrator bisa restart pod terus-menerus tanpa menyelesaikan masalah.

### 18.2 Readiness

Readiness menjawab:

```text
Apakah instance ini siap menerima traffic?
```

Readiness boleh mempertimbangkan:

- mandatory config loaded;
- DB reachable;
- critical cache ready;
- migration compatible;
- app not draining;
- startup warmup complete.

### 18.3 Startup Probe

Startup probe menjawab:

```text
Apakah aplikasi masih dalam proses startup yang valid?
```

Cocok untuk aplikasi enterprise yang startup-nya lebih lama karena deployment scanning, metadata validation, atau warmup.

### 18.4 Jangan Samakan `@PostConstruct` dengan Readiness Global

`@PostConstruct` adalah lifecycle bean. Readiness adalah lifecycle application instance.

Model yang benar:

```text
Bean A initialized
Bean B initialized
Datasource bound
Cache warmup done
Migration check done
HTTP listener ready
Readiness = true
```

---

## 19. Resource Ownership: Siapa yang Harus Menutup Resource?

Salah satu pertanyaan lifecycle paling penting:

> Siapa pemilik resource?

Jika container yang menyediakan resource, jangan sembarang close.

Contoh datasource container-managed:

```java
@Resource
DataSource dataSource;
```

Biasanya kamu tidak menutup `DataSource` itu di `@PreDestroy`, karena lifecycle-nya dimiliki container.

Tetapi jika kamu membuat sendiri client:

```java
private ExternalClient client;

@PostConstruct
void init() {
    client = ExternalClient.create(...);
}

@PreDestroy
void destroy() {
    client.close();
}
```

Maka kamu pemilik resource dan harus cleanup.

### 19.1 Ownership Table

| Resource | Dibuat oleh | Ditutup oleh |
|---|---|---|
| `new HttpClientWrapper()` di bean | bean | bean `@PreDestroy` |
| CDI produced client | producer/disposer | disposer |
| container datasource via JNDI/resource | container | container |
| injected repository bean | container/context | container/context |
| file stream dibuka di method | method | method try-with-resources |
| managed executor dari container | container | container |
| custom executor dibuat di bean | bean | bean `@PreDestroy` |

Rule:

```text
Yang membuat biasanya bertanggung jawab menutup, kecuali ownership diserahkan secara eksplisit.
```

---

## 20. Background Threads: Bahaya Besar di Managed Runtime

Buruk:

```java
@PostConstruct
void init() {
    new Thread(() -> {
        while (true) {
            sync();
        }
    }).start();
}
```

Masalah:

- thread tidak dikelola container;
- shutdown sulit;
- context/security/transaction tidak propagated;
- classloader leak saat redeploy;
- tidak ada backpressure;
- bisa terus hidup setelah aplikasi undeployed.

Lebih baik gunakan managed executor/container scheduler/timer sesuai runtime.

Jika terpaksa membuat executor sendiri:

```java
@ApplicationScoped
public class LocalWorker {
    private ExecutorService executor;
    private final AtomicBoolean running = new AtomicBoolean(true);

    @PostConstruct
    void init() {
        executor = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "local-worker");
            t.setDaemon(false);
            return t;
        });
        executor.submit(this::runLoop);
    }

    private void runLoop() {
        while (running.get()) {
            try {
                doWorkOnce();
            } catch (Exception e) {
                log.warn("Worker iteration failed", e);
            }
        }
    }

    @PreDestroy
    void destroy() {
        running.set(false);
        executor.shutdown();
        try {
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        }
    }
}
```

Tetapi dalam Jakarta runtime, gunakan managed concurrency jika tersedia. Part 030 akan membahas ini lebih dalam.

---

## 21. Lifecycle Callback Method Rules

Aturan detail bisa berbeda sedikit antara spec/context, tetapi prinsip portable-nya:

- satu method lifecycle callback per class untuk annotation tersebut;
- method tidak boleh static;
- method biasanya `void`;
- method tidak menerima parameter untuk callback biasa;
- method bisa private/protected/package/public tergantung spec/provider, tetapi pilih package-private atau protected untuk clarity;
- jangan overload membingungkan;
- jangan lempar checked exception dari signature;
- exception runtime biasanya menggagalkan initialization/destruction flow sesuai konteks.

Contoh sederhana:

```java
@PostConstruct
void init() {
    // good
}

@PreDestroy
void destroy() {
    // good
}
```

Hindari:

```java
@PostConstruct
public String init() {
    return "ready"; // buruk: lifecycle callback bukan business method
}
```

Hindari:

```java
@PostConstruct
static void init() {
    // buruk: lifecycle milik instance, bukan class static
}
```

---

## 22. Callback Ordering dengan Inheritance

Jika class hierarchy punya callback di superclass dan subclass, ordering mengikuti aturan spec/container. Secara mental:

```text
Superclass initialization before subclass initialization.
Subclass destruction before superclass destruction.
```

Contoh:

```java
public abstract class BaseClientHolder {
    @PostConstruct
    void baseInit() {
        // base init
    }

    @PreDestroy
    void baseDestroy() {
        // base cleanup
    }
}

@ApplicationScoped
public class CaseClientHolder extends BaseClientHolder {
    @PostConstruct
    void childInit() {
        // child init
    }

    @PreDestroy
    void childDestroy() {
        // child cleanup
    }
}
```

Namun untuk portability dan readability, jangan menyebar lifecycle logic terlalu banyak di inheritance hierarchy.

Lebih baik:

```text
Base class: minimal reusable mechanics.
Subclass: explicit lifecycle coordination.
```

---

## 23. Exception Handling dalam `@PostConstruct`

Jika `@PostConstruct` gagal, bean tidak siap.

Prinsip:

```text
Jangan swallow exception yang membuat state invalid.
```

Buruk:

```java
@PostConstruct
void init() {
    try {
        cache = loadMandatoryRules();
    } catch (Exception e) {
        log.error("Failed", e);
        cache = Map.of(); // mungkin membuat keputusan regulatory salah
    }
}
```

Benar jika mandatory:

```java
@PostConstruct
void init() {
    try {
        cache = loadMandatoryRules();
    } catch (Exception e) {
        throw new IllegalStateException("Mandatory rules could not be loaded", e);
    }
}
```

Benar jika optional:

```java
@PostConstruct
void init() {
    try {
        cache = loadOptionalRules();
    } catch (Exception e) {
        log.warn("Optional rules unavailable; fallback will be used", e);
        cache = Map.of();
        fallbackMode = true;
    }
}
```

Kuncinya bukan “selalu throw” atau “selalu catch”. Kuncinya adalah contract.

---

## 24. Exception Handling dalam `@PreDestroy`

Di `@PreDestroy`, exception sebaiknya tidak membuat shutdown menggantung atau menutupi cleanup lain.

Buruk:

```java
@PreDestroy
void destroy() {
    clientA.close();
    clientB.close(); // tidak dipanggil jika clientA.close() throw
}
```

Lebih baik:

```java
@PreDestroy
void destroy() {
    closeQuietly("clientA", clientA);
    closeQuietly("clientB", clientB);
}

private void closeQuietly(String name, AutoCloseable closeable) {
    if (closeable == null) return;
    try {
        closeable.close();
    } catch (Exception e) {
        log.warn("Failed to close {}", name, e);
    }
}
```

Prinsip:

```text
Initialization failure often should be loud.
Cleanup failure should be logged and bounded.
```

---

## 25. Idempotency dalam Lifecycle

Lifecycle callback idealnya idempotent secara praktis, walaupun spec biasanya memanggilnya sesuai lifecycle.

Mengapa?

- testing bisa memanggil init manual;
- container restart/redeploy bisa menghasilkan edge case;
- partial initialization bisa gagal;
- shutdown bisa dipanggil setelah init gagal sebagian;
- close method kadang dipanggil lebih dari sekali.

Contoh idempotent init/destroy:

```java
@ApplicationScoped
public class SearchClientHolder {
    private final AtomicBoolean initialized = new AtomicBoolean(false);
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private SearchClient client;

    @PostConstruct
    void init() {
        if (!initialized.compareAndSet(false, true)) {
            return;
        }
        client = SearchClient.create();
    }

    @PreDestroy
    void destroy() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        if (client != null) {
            client.close();
        }
    }
}
```

Jangan over-engineer semua bean. Tapi untuk resource holder penting, idempotency membuat lifecycle lebih robust.

---

## 26. Thread Safety Setelah `@PostConstruct`

Untuk `@ApplicationScoped`, state yang disiapkan di `@PostConstruct` akan dibaca banyak thread.

Aman:

```java
private Map<String, Policy> policies;

@PostConstruct
void init() {
    this.policies = Map.copyOf(loader.load());
}

public Policy get(String code) {
    return policies.get(code);
}
```

Kenapa aman?

- setelah `@PostConstruct`, reference dipublish oleh container;
- map immutable;
- tidak dimutasi concurrent.

Lebih rawan:

```java
private HashMap<String, Policy> policies = new HashMap<>();

@PostConstruct
void init() {
    policies.putAll(loader.load());
}

public void reload() {
    policies.clear();
    policies.putAll(loader.load());
}
```

Masalah:

- concurrent read saat clear/put;
- inconsistent state;
- race condition.

Lebih baik:

```java
private volatile Map<String, Policy> policies = Map.of();

@PostConstruct
void init() {
    reload();
}

public void reload() {
    Map<String, Policy> loaded = Map.copyOf(loader.load());
    policies = loaded;
}

public Policy get(String code) {
    return policies.get(code);
}
```

Atomic reference replacement lebih aman daripada mutate shared map.

---

## 27. Lifecycle dan Config

Configuration sering dibaca saat initialization.

Contoh:

```java
@ApplicationScoped
public class RetryPolicyHolder {
    @Inject
    AppConfig config;

    private RetryPolicy retryPolicy;

    @PostConstruct
    void init() {
        this.retryPolicy = RetryPolicy.builder()
                .maxAttempts(config.retryMaxAttempts())
                .initialBackoff(config.retryInitialBackoff())
                .maxBackoff(config.retryMaxBackoff())
                .build();
    }
}
```

Pertanyaan penting:

```text
Apakah config ini startup-time immutable atau runtime mutable?
```

Jika startup-time immutable:

- baca di `@PostConstruct`;
- validasi;
- simpan sebagai immutable object.

Jika runtime mutable:

- jangan hanya snapshot sekali;
- gunakan provider/dynamic lookup/config service;
- pikirkan consistency dan observability.

Contoh runtime lookup:

```java
@ApplicationScoped
public class DynamicFeatureGate {
    @Inject
    FeatureFlagService flags;

    public boolean isEnabled(String flagName, EvaluationContext context) {
        return flags.evaluate(flagName, context);
    }
}
```

---

## 28. Lifecycle dan Secrets

Secrets sering dibutuhkan saat startup:

- DB password;
- API key;
- signing key;
- encryption key;
- OAuth client secret;
- mTLS material.

Prinsip:

1. jangan log secret;
2. fail-fast jika secret mandatory tidak ada;
3. jangan simpan secret lebih banyak dari perlu;
4. pertimbangkan rotation;
5. bedakan secret static startup vs dynamic rotated secret.

Buruk:

```java
@PostConstruct
void init() {
    log.info("Loaded API key {}", apiKey);
}
```

Benar:

```java
@PostConstruct
void init() {
    if (apiKey == null || apiKey.isBlank()) {
        throw new IllegalStateException("External API key is required");
    }
    log.info("External API key is configured");
}
```

---

## 29. Lifecycle dan Cache Warmup

Cache warmup adalah area rawan.

Pertanyaan sebelum warmup:

- Apakah data wajib untuk correctness?
- Seberapa besar data?
- Berapa lama query?
- Apakah semua pod akan warmup bersamaan?
- Apakah warmup menyebabkan DB spike?
- Apakah cache bisa lazy?
- Bagaimana jika warmup gagal?
- Bagaimana invalidation/reload?

### 29.1 Anti-Pattern: Startup Stampede

```text
20 pods rollout bersamaan
  ↓
semua @PostConstruct query table besar
  ↓
DB spike
  ↓
startup timeout
  ↓
pods restart
  ↓
spike ulang
```

Mitigasi:

- bounded warmup;
- stagger rollout;
- readiness gate;
- lazy load;
- shared cache;
- background refresh dengan backoff;
- limit query;
- circuit breaker.

---

## 30. Lifecycle dan Observability

Lifecycle event harus observable.

Minimal log:

```java
@PostConstruct
void init() {
    long start = System.nanoTime();
    try {
        initialize();
        log.info("{} initialized in {} ms", getClass().getSimpleName(), elapsedMs(start));
    } catch (Exception e) {
        log.error("{} failed to initialize", getClass().getSimpleName(), e);
        throw e;
    }
}
```

Tetapi jangan spam untuk setiap request-scoped bean.

### 30.1 Apa yang Perlu Diobservasi?

Untuk application-level lifecycle:

- startup duration;
- initialization duration per critical component;
- config validation failure;
- dependency reachability;
- cache warmup size/time;
- shutdown duration;
- cleanup failure;
- background worker start/stop;
- readiness state transitions.

### 30.2 Lifecycle Metrics

Contoh metric konseptual:

```text
app_startup_duration_seconds
component_initialization_duration_seconds{name="policy-cache"}
component_initialization_failures_total{name="policy-cache"}
component_shutdown_duration_seconds{name="external-client"}
cache_warmup_entries_total{name="policy-cache"}
readiness_state{state="ready"}
```

---

## 31. Testing Lifecycle Callback

### 31.1 Unit Test Pure Init Logic

Pisahkan logic dari callback:

```java
@ApplicationScoped
public class PolicyCache {
    @Inject
    PolicyRepository repository;

    private Map<String, Policy> policies;

    @PostConstruct
    void init() {
        this.policies = loadPolicies(repository);
    }

    static Map<String, Policy> loadPolicies(PolicyRepository repository) {
        return Map.copyOf(repository.loadEnabledPolicies());
    }
}
```

Test:

```java
@Test
void loadsEnabledPolicies() {
    PolicyRepository repo = mock(PolicyRepository.class);
    when(repo.loadEnabledPolicies()).thenReturn(List.of(new Policy("A")));

    Map<String, Policy> result = PolicyCache.loadPolicies(repo);

    assertTrue(result.containsKey("A"));
}
```

### 31.2 Container Test Lifecycle

Untuk memastikan `@PostConstruct` benar-benar dipanggil oleh CDI, gunakan container test sesuai runtime:

- Weld JUnit untuk CDI behavior;
- Arquillian-style untuk app server;
- Quarkus test untuk Quarkus;
- Open Liberty test/container integration;
- Payara/WildFly integration test.

Conceptual test:

```java
@ApplicationScoped
public class InitTrackedBean {
    boolean initialized;

    @PostConstruct
    void init() {
        initialized = true;
    }
}
```

Test container:

```java
@Inject
InitTrackedBean bean;

@Test
void postConstructWasCalled() {
    assertTrue(bean.initialized);
}
```

### 31.3 Testing `@PreDestroy`

`@PreDestroy` sering sulit dites tanpa container lifecycle.

Buat cleanup logic terpisah:

```java
@PreDestroy
void destroy() {
    closeResources();
}

void closeResources() {
    closeQuietly(client);
}
```

Unit test `closeResources()`. Integration test lifecycle jika perlu.

---

## 32. Common Failure Patterns

### 32.1 Dependency Null di Constructor

Penyebab:

- field injection belum terjadi.

Solusi:

- gunakan constructor injection untuk dependency wajib;
- pindahkan logic ke `@PostConstruct`.

### 32.2 `ContextNotActiveException` saat Startup

Penyebab:

- `@PostConstruct` application bean mengakses request-scoped bean;
- tidak ada request context aktif.

Buruk:

```java
@ApplicationScoped
public class StartupBean {
    @Inject
    RequestContextInfo requestContextInfo;

    @PostConstruct
    void init() {
        requestContextInfo.userId(); // request context belum aktif
    }
}
```

Solusi:

- jangan inject request-scoped state ke startup singleton/application init;
- gunakan provider dan akses hanya saat request;
- pisahkan context-specific logic.

### 32.3 Unintended Heavy Startup

Penyebab:

- banyak `@ApplicationScoped` bean eager;
- startup observer/warmup memicu graph besar;
- `@PostConstruct` query berat.

Solusi:

- ukur startup;
- lazy/hybrid strategy;
- batasi warmup;
- readiness gate.

### 32.4 Resource Leak saat Redeploy

Penyebab:

- custom thread/executor tidak dihentikan;
- client tidak ditutup;
- static registry menahan classloader;
- listener tidak di-unregister.

Solusi:

- `@PreDestroy` cleanup;
- gunakan managed resources;
- hindari static mutable global;
- disposer untuk produced resources.

### 32.5 Self-Invocation Interceptor Tidak Aktif

Penyebab:

- method dipanggil dari object yang sama, bukan via proxy.

Solusi:

- pindahkan method ke bean lain;
- inject self proxy jika runtime mendukung dan benar-benar perlu;
- jangan desain lifecycle yang bergantung pada self-intercepted call.

### 32.6 Shutdown Menggantung

Penyebab:

- `@PreDestroy` menunggu network tanpa timeout;
- drain queue tanpa batas;
- executor tidak shutdown correctly.

Solusi:

- bounded timeout;
- best-effort cleanup;
- graceful shutdown protocol;
- observability.

---

## 33. Lifecycle Design Checklist

Untuk setiap managed bean penting, tanyakan:

### 33.1 Construction

- Apakah dependency wajib dinyatakan via constructor?
- Apakah constructor bebas dari I/O berat?
- Apakah constructor tidak mengakses field injection?
- Apakah object minimal valid setelah constructor?

### 33.2 Initialization

- Apakah `@PostConstruct` benar-benar diperlukan?
- Apakah initialization butuh injected dependency?
- Apakah initialization bounded timeout?
- Apakah failure mandatory dilempar?
- Apakah optional failure punya fallback jelas?
- Apakah startup stampede dihindari?
- Apakah cache immutable/thread-safe?
- Apakah log tidak membocorkan secret?

### 33.3 Runtime

- Apakah state mutable aman untuk concurrency?
- Apakah request-scoped dependency tidak dipakai di luar request?
- Apakah method yang butuh interceptor dipanggil via proxy?
- Apakah lazy initialization thread-safe?

### 33.4 Destruction

- Apakah bean memang owner resource yang ditutup?
- Apakah cleanup idempotent?
- Apakah cleanup punya timeout?
- Apakah exception cleanup tidak menghentikan cleanup lain?
- Apakah background worker dihentikan?
- Apakah static registry/listener dilepas?

### 33.5 Operational

- Apakah readiness tidak true sebelum critical init selesai?
- Apakah liveness tidak tergantung dependency eksternal secara salah?
- Apakah startup/shutdown duration terukur?
- Apakah failure lifecycle mudah didiagnosis?

---

## 34. Production-Grade Pattern: Resource Holder

Pattern:

```java
@ApplicationScoped
public class ExternalSystemClientHolder {
    private volatile ExternalSystemClient client;

    @Inject
    ExternalSystemConfig config;

    @PostConstruct
    void init() {
        validate(config);
        this.client = ExternalSystemClient.builder()
                .baseUrl(config.baseUrl())
                .connectTimeout(config.connectTimeout())
                .readTimeout(config.readTimeout())
                .build();
    }

    public ExternalSystemClient get() {
        ExternalSystemClient current = client;
        if (current == null) {
            throw new IllegalStateException("ExternalSystemClient is not initialized");
        }
        return current;
    }

    @PreDestroy
    void destroy() {
        ExternalSystemClient current = client;
        client = null;
        if (current != null) {
            try {
                current.close();
            } catch (Exception e) {
                log.warn("Failed to close ExternalSystemClient", e);
            }
        }
    }

    private static void validate(ExternalSystemConfig config) {
        if (config.baseUrl() == null || config.baseUrl().isBlank()) {
            throw new IllegalStateException("external.base-url is required");
        }
    }
}
```

Kenapa pattern ini baik?

- config divalidasi saat startup;
- client dibuat setelah injection;
- `get()` punya guard;
- cleanup tidak melempar fatal saat shutdown;
- ownership jelas.

---

## 35. Production-Grade Pattern: Immutable Snapshot Cache

```java
@ApplicationScoped
public class ActivePolicyCache {
    private volatile Map<String, Policy> policies = Map.of();

    @Inject
    PolicyRepository repository;

    @PostConstruct
    void init() {
        reloadMandatory();
    }

    public Policy getRequired(String code) {
        Policy policy = policies.get(code);
        if (policy == null) {
            throw new UnknownPolicyException(code);
        }
        return policy;
    }

    public void reloadMandatory() {
        List<Policy> loaded = repository.loadActivePolicies();
        if (loaded.isEmpty()) {
            throw new IllegalStateException("No active policies loaded");
        }
        this.policies = loaded.stream()
                .collect(Collectors.toUnmodifiableMap(Policy::code, Function.identity()));
    }
}
```

Properties:

- readers never see half-mutated map;
- reload atomic by reference replacement;
- mandatory data failure explicit;
- no synchronized read path;
- safe for application-scoped concurrent access.

---

## 36. Production-Grade Pattern: Bounded Graceful Shutdown Worker

```java
@ApplicationScoped
public class CaseSyncWorker {
    private ManagedExecutorService executor; // preferably container-managed
    private final AtomicBoolean accepting = new AtomicBoolean(true);

    @Inject
    SyncQueue queue;

    @PostConstruct
    void init() {
        // In real Jakarta runtime, prefer injected ManagedExecutorService if available.
        startWorker();
    }

    public void submit(SyncTask task) {
        if (!accepting.get()) {
            throw new IllegalStateException("Worker is shutting down");
        }
        queue.offer(task);
    }

    @PreDestroy
    void destroy() {
        accepting.set(false);
        drainWithTimeout(Duration.ofSeconds(10));
        stopWorkerWithTimeout(Duration.ofSeconds(5));
    }
}
```

Mental model:

```text
Stop accepting new work.
Drain bounded existing work.
Stop worker bounded.
Do not wait forever.
```

---

## 37. Regulatory / Case Management Example

Misal sistem enforcement lifecycle punya service:

- assignment policy;
- escalation rule;
- audit sink;
- notification client;
- case state transition guard;
- feature flag service.

Lifecycle design:

```text
Startup mandatory:
- validate DB connectivity
- load active case transition matrix
- validate escalation rules
- initialize audit sink client
- initialize feature flag defaults

Startup optional/degraded:
- warm notification templates
- prefetch non-critical reference data
- ping external enrichment service

Runtime dynamic:
- evaluate feature flags
- refresh rule snapshot safely
- observe config change if supported

Shutdown:
- stop accepting async notification jobs
- flush bounded audit buffer
- close external clients
- unregister listeners
```

Case transition matrix example:

```java
@ApplicationScoped
public class CaseTransitionMatrixHolder {
    private volatile CaseTransitionMatrix matrix;

    @Inject
    CaseTransitionRepository repository;

    @PostConstruct
    void init() {
        CaseTransitionMatrix loaded = repository.loadActiveMatrix();
        loaded.validateNoDeadEndStates();
        loaded.validateNoUnauthorizedEscalationPath();
        this.matrix = loaded;
    }

    public boolean canTransition(CaseState from, CaseState to, ActorRole role) {
        return matrix.canTransition(from, to, role);
    }
}
```

Untuk domain regulatory, lebih baik fail-fast jika rule mandatory tidak valid. Membiarkan aplikasi berjalan dengan matrix kosong bisa menyebabkan keputusan case salah.

---

## 38. Anti-Pattern Catalog

### 38.1 Constructor Does Everything

```java
public Service() {
    connectToDatabase();
    callExternalApi();
    startThread();
}
```

Masalah:

- dependency belum diinjeksi;
- failure sulit didiagnosis;
- test sulit;
- startup fragile.

### 38.2 `@PostConstruct` as Mini Application

```java
@PostConstruct
void init() {
    runAllMigrations();
    rebuildAllIndexes();
    syncAllExternalSystems();
    sendStartupEmails();
}
```

Masalah:

- startup terlalu berat;
- hidden operational workflow;
- failure blast radius besar.

### 38.3 Swallowed Mandatory Initialization Failure

```java
@PostConstruct
void init() {
    try {
        rules = loadRules();
    } catch (Exception e) {
        rules = Map.of();
    }
}
```

Masalah:

- aplikasi terlihat healthy;
- business correctness rusak.

### 38.4 `@PreDestroy` Business Workflow

```java
@PreDestroy
void destroy() {
    approvePendingCasesBeforeShutdown();
}
```

Masalah:

- shutdown bukan tempat workflow bisnis;
- bisa partial dan tidak terobservasi.

### 38.5 Static Global Registry

```java
@PostConstruct
void init() {
    GlobalRegistry.register(this);
}
```

Tanpa unregister:

```java
@PreDestroy
void destroy() {
    GlobalRegistry.unregister(this);
}
```

Risiko:

- classloader leak;
- stale object setelah redeploy;
- memory leak.

---

## 39. Lifecycle Decision Matrix

| Kebutuhan | Constructor | `@PostConstruct` | Runtime Lazy | `@PreDestroy` | Disposer |
|---|---:|---:|---:|---:|---:|
| Set final dependency | Yes | No | No | No | No |
| Validate non-null dependency | Yes | Yes | No | No | No |
| Access field injection | No | Yes | Yes | Yes | No |
| Build immutable config object | Possible | Yes | Possible | No | No |
| Open custom client | Avoid | Yes | Possible | Close | Possible |
| Use container datasource | No | Yes | Yes | Do not close datasource | No |
| Heavy DB warmup | No | Maybe bounded | Often better | No | No |
| Start unmanaged thread | No | Avoid | Avoid | Must stop | No |
| Cleanup produced object | No | No | No | No | Yes |
| Business transaction | No | Be careful | Yes | Avoid | No |

---

## 40. Practical Rules of Thumb

1. Constructor should create a valid object, not run the application.
2. `@PostConstruct` is for initialization after injection, not for unbounded workflows.
3. `@PreDestroy` is for cleanup, not for business processing.
4. Heavy startup must be justified by correctness or readiness contract.
5. Optional dependency failure should degrade explicitly, not silently.
6. Mandatory dependency failure should fail loudly.
7. Cache warmup must be bounded and concurrency-aware.
8. Application-scoped mutable state must be thread-safe.
9. Never start unmanaged infinite threads without shutdown protocol.
10. Do not close resources owned by the container.
11. Close resources you create yourself.
12. Use disposer for producer-created resources.
13. Do not rely on self-invocation to trigger interceptors.
14. Do not confuse bean initialization with whole-application readiness.
15. Lifecycle behavior must be observable in production.

---

## 41. Part Summary

Lifecycle callback adalah salah satu titik paling penting dalam enterprise Java karena ia menentukan kapan object masuk dan keluar dari managed runtime.

Model utama:

```text
Constructor:
  create minimal object state

Injection:
  container supplies dependencies/resources

@PostConstruct:
  initialize using injected dependencies before service use

Service phase:
  business method invocation through proxy/interceptor/decorator/context

@PreDestroy:
  cleanup owned resources before destruction
```

Pemahaman top-level:

```text
Lifecycle bukan urutan annotation.
Lifecycle adalah kontrak ownership, readiness, failure, concurrency, dan cleanup.
```

Jika lifecycle salah, efeknya sering muncul sebagai:

- startup lambat;
- startup gagal random;
- dependency null;
- request pertama lambat;
- memory leak;
- thread leak;
- redeploy leak;
- shutdown menggantung;
- readiness palsu;
- business correctness rusak karena fallback diam-diam.

Jika lifecycle benar, aplikasi menjadi:

- lebih mudah dipahami;
- lebih aman saat deployment;
- lebih bisa dites;
- lebih mudah diobservasi;
- lebih aman saat shutdown;
- lebih siap untuk cloud/container orchestration;
- lebih defensible untuk enterprise/regulatory system.

---

## 42. Checklist Penguasaan

Kamu dianggap menguasai Part 018 jika bisa menjawab:

1. Mengapa field injection tidak boleh dipakai di constructor?
2. Kapan `@PostConstruct` dipanggil?
3. Apa beda bean-level initialized dan application-level ready?
4. Resource apa yang boleh dan tidak boleh ditutup di `@PreDestroy`?
5. Mengapa startup warmup bisa menjadi production incident?
6. Bagaimana mendesain cache application-scoped yang thread-safe?
7. Kenapa self-invocation dari `@PostConstruct` bisa melewati interceptor?
8. Apa perbedaan cleanup `@PreDestroy` dan disposer method?
9. Kapan initialization harus fail-fast?
10. Kapan initialization boleh degraded?
11. Apa risiko unmanaged thread di managed runtime?
12. Bagaimana membuat shutdown cleanup bounded dan idempotent?

---

## 43. Next Part

Part berikutnya:

```text
Part 019 — CDI Extensions and Portable Runtime Customization
```

Di part berikutnya kita akan masuk ke level lebih dalam: bagaimana CDI container dapat diperluas melalui extension, bagaimana framework menambahkan bean secara synthetic, bagaimana metadata discovery bisa dimodifikasi, dan kapan custom extension menjadi arsitektur yang powerful atau justru menjadi sumber “magic” yang sulit didebug.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-017.md">⬅️ Part 017 — Stereotypes and Annotation Composition</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-019.md">Part 019 — CDI Extensions and Portable Runtime Customization ➡️</a>
</div>

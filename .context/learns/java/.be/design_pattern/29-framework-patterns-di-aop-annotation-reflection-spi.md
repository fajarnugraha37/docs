# 29 — Framework Patterns: Dependency Injection, AOP, Annotation, Reflection, SPI

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 29 dari 35  
> Target: Java 8 sampai Java 25  
> Fokus: memahami pola desain yang muncul saat kode Java hidup di dalam framework/container, bukan sekadar memakai anotasi.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami framework sebagai bentuk **Inversion of Control**, bukan sekadar library dengan banyak anotasi.
2. Membedakan secara tegas:
   - Dependency Injection
   - Service Locator
   - Provider
   - Factory
   - SPI
   - Plugin architecture
   - AOP
   - Interceptor
   - Annotation-driven programming
   - Reflection-driven extension
3. Mendesain class Java yang **framework-friendly** tetapi tidak **framework-dependent**.
4. Memahami failure mode dari DI container:
   - hidden dependency
   - ambiguous bean
   - circular dependency
   - lifecycle mismatch
   - proxy invisibility
   - self-invocation problem
   - annotation magic
5. Menentukan kapan memakai anotasi, reflection, proxy, AOP, atau explicit composition.
6. Mendesain extension point yang stabil untuk codebase enterprise besar.
7. Menghindari anti-pattern umum seperti:
   - field injection everywhere
   - annotation as business logic
   - reflection as architecture
   - container-dependent domain
   - god configuration class
   - AOP side-effect trap
8. Mampu melakukan design review pada sistem Spring/CDI/Quarkus/Jakarta yang kompleks.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Banyak Java engineer bisa memakai framework:

```java
@Service
@Transactional
@RequiredArgsConstructor
public class ApprovalService {
    private final ApplicationRepository repository;
    private final NotificationService notificationService;

    public void approve(String id) {
        // logic
    }
}
```

Tetapi tidak semua memahami pertanyaan desain di baliknya:

1. Siapa yang membuat object ini?
2. Siapa yang mengatur lifecycle-nya?
3. Siapa yang memanggil constructor-nya?
4. Kapan dependency tersedia?
5. Apakah object ini singleton, request-scoped, prototype, atau contextual?
6. Apakah method yang dipanggil adalah object asli atau proxy?
7. Apakah `@Transactional` benar-benar aktif?
8. Apakah annotation ini hanya metadata atau mengubah behavior runtime?
9. Apakah domain logic bisa dites tanpa framework?
10. Apakah dependency graph bisa dipahami manusia?

Framework pattern penting karena framework memberi produktivitas besar, tetapi juga bisa menyembunyikan desain buruk.

Framework yang sehat membuat kode lebih sederhana. Framework yang disalahgunakan membuat kode menjadi seperti ini:

```java
@Service
@Transactional
@Cacheable
@Retryable
@PreAuthorize("hasRole('ADMIN')")
@Async
@Timed
@Audit
public class CaseService {
    @Autowired private Repository repository;
    @Autowired private Mapper mapper;
    @Autowired private Validator validator;
    @Autowired private RestTemplate restTemplate;
    @Autowired private EventPublisher eventPublisher;
    @Autowired private ApplicationContext context;

    public void doEverything(...) {
        // 700 lines
    }
}
```

Secara visual terlihat enterprise. Secara desain mungkin rapuh.

---

## 3. Mental Model: Framework sebagai Runtime yang Mengambil Alih Control Flow

Library dipanggil oleh aplikasi.

Framework memanggil aplikasi.

```text
Library style:

Your Code  --->  Library

Framework style:

Framework  --->  Your Code
```

Contoh library:

```java
var json = objectMapper.writeValueAsString(object);
```

Kamu mengontrol kapan `objectMapper` dipanggil.

Contoh framework:

```java
@RestController
class CaseController {
    @GetMapping("/cases/{id}")
    CaseResponse get(@PathVariable String id) {
        return ...;
    }
}
```

Framework mengontrol:

1. kapan object dibuat,
2. kapan method dipanggil,
3. bagaimana parameter diisi,
4. bagaimana return value diterjemahkan,
5. bagaimana exception dipetakan,
6. bagaimana security/transaction/interceptor diterapkan.

Itulah **Inversion of Control**.

---

## 4. Framework Pattern Map

Framework pattern dapat dipetakan seperti ini:

```text
Framework Runtime
│
├── Object Creation
│   ├── Dependency Injection
│   ├── Provider
│   ├── Factory Bean
│   └── Lifecycle Callback
│
├── Object Discovery
│   ├── Annotation Scanning
│   ├── Reflection
│   ├── Classpath Scanning
│   ├── JPMS Module Metadata
│   └── ServiceLoader / SPI
│
├── Behavior Interception
│   ├── AOP
│   ├── Proxy
│   ├── Interceptor
│   ├── Filter
│   └── Middleware Chain
│
├── Extension
│   ├── SPI
│   ├── Plugin
│   ├── Event Listener
│   ├── Strategy Registry
│   └── Auto-Configuration
│
└── Runtime Context
    ├── Request Scope
    ├── Session Scope
    ├── Transaction Context
    ├── Security Context
    ├── MDC / Diagnostic Context
    └── ScopedValue / ThreadLocal
```

Pattern ini sering saling bertumpuk.

Contoh Spring/Jakarta runtime:

```text
HTTP Request
  -> Filter
  -> Security Context
  -> Dispatcher / Resource Invoker
  -> Controller / Resource Proxy
  -> Interceptor
  -> Service Proxy
  -> Transaction Advice
  -> Domain/Application Logic
  -> Repository Proxy
  -> Persistence Context
```

Kesalahan umum engineer adalah mengira semua layer itu “hilang” karena code tampak sederhana.

Padahal runtime path-nya panjang.

---

## 5. Dependency Injection Pattern

### 5.1 Definisi

Dependency Injection adalah pattern di mana object tidak membuat dependency-nya sendiri, melainkan dependency diberikan dari luar.

Tanpa DI:

```java
final class ApprovalService {
    private final ApplicationRepository repository = new JdbcApplicationRepository();
}
```

Dengan DI:

```java
final class ApprovalService {
    private final ApplicationRepository repository;

    ApprovalService(ApplicationRepository repository) {
        this.repository = repository;
    }
}
```

Perubahan kecil ini sangat besar secara desain.

Tanpa DI, `ApprovalService` mengontrol policy dan detail creation.

Dengan DI, `ApprovalService` hanya menyatakan kebutuhan.

---

### 5.2 Design Force DI

DI muncul saat ada force berikut:

| Force | Tanpa DI | Dengan DI |
|---|---|---|
| Testability | Sulit mock/fake | Mudah inject fake |
| Dependency direction | High-level tahu low-level | High-level bergantung pada abstraction |
| Configuration | Hardcoded | Externalized |
| Lifecycle | Manual | Container/composition root |
| Variant | Sulit ganti implementation | Bisa pilih implementation |
| Observability | Tersebar | Bisa decorate/instrument |

DI bukan soal framework. DI adalah soal dependency direction.

---

### 5.3 Constructor Injection

Constructor injection adalah default terbaik untuk mandatory dependency.

```java
public final class SubmitApplicationUseCase {
    private final ApplicationRepository repository;
    private final EligibilityPolicy eligibilityPolicy;
    private final DomainEventPublisher eventPublisher;

    public SubmitApplicationUseCase(
            ApplicationRepository repository,
            EligibilityPolicy eligibilityPolicy,
            DomainEventPublisher eventPublisher
    ) {
        this.repository = Objects.requireNonNull(repository);
        this.eligibilityPolicy = Objects.requireNonNull(eligibilityPolicy);
        this.eventPublisher = Objects.requireNonNull(eventPublisher);
    }
}
```

Kelebihan:

1. dependency eksplisit,
2. object selalu valid setelah dibuat,
3. cocok dengan `final` field,
4. mudah dites tanpa container,
5. circular dependency lebih cepat terlihat,
6. tidak perlu reflection untuk field private.

Constructor injection memaksa desain jujur. Jika constructor punya 12 parameter, itu bukan masalah DI. Itu tanda class terlalu banyak responsibility.

---

### 5.4 Field Injection

Field injection:

```java
@Service
class ApprovalService {
    @Autowired
    private ApplicationRepository repository;
}
```

Masalah:

1. dependency tersembunyi dari constructor,
2. object bisa dibuat dalam keadaan invalid,
3. field tidak bisa `final`,
4. sulit dites tanpa container,
5. mendorong god service karena menambah dependency terlalu mudah,
6. lifecycle object menjadi tidak jelas.

Field injection bukan selalu fatal, tetapi untuk production domain/application code sebaiknya dihindari.

Field injection kadang masih muncul di:

1. legacy framework code,
2. test class integration,
3. framework-managed artifacts lama,
4. generated code.

Namun untuk code yang kamu desain sendiri, constructor injection jauh lebih defensible.

---

### 5.5 Setter Injection

Setter injection berguna untuk optional dependency atau reconfigurable component.

```java
public final class ReportRenderer {
    private Clock clock = Clock.systemUTC();

    public void setClock(Clock clock) {
        this.clock = Objects.requireNonNull(clock);
    }
}
```

Tapi setter injection berisiko jika dipakai untuk mandatory dependency.

```java
class BadService {
    private Repository repository;

    public void setRepository(Repository repository) {
        this.repository = repository;
    }

    public void execute() {
        repository.save(...); // possible NullPointerException
    }
}
```

Rule praktis:

```text
Mandatory dependency  -> constructor injection
Optional dependency   -> constructor dengan default, atau setter jelas
Runtime lookup        -> Provider/Supplier, bukan field injection
```

---

## 6. Composition Root

DI paling sehat jika ada tempat eksplisit yang merakit object graph.

Tanpa framework:

```java
public final class ApplicationComposition {
    public SubmitApplicationUseCase submitApplicationUseCase() {
        var dataSource = dataSource();
        var repository = new JdbcApplicationRepository(dataSource);
        var policy = new DefaultEligibilityPolicy();
        var publisher = new OutboxDomainEventPublisher(dataSource);

        return new SubmitApplicationUseCase(repository, policy, publisher);
    }
}
```

Dengan framework:

```java
@Configuration
class ApplicationConfig {
    @Bean
    SubmitApplicationUseCase submitApplicationUseCase(
            ApplicationRepository repository,
            EligibilityPolicy policy,
            DomainEventPublisher publisher
    ) {
        return new SubmitApplicationUseCase(repository, policy, publisher);
    }
}
```

Mental model penting:

```text
DI Container = automated composition root + lifecycle manager + metadata processor
```

Container bukan tempat menyimpan business logic.

---

## 7. Provider Pattern

Provider dipakai ketika dependency tidak ingin langsung dibuat atau instance-nya bergantung pada scope/context.

```java
public interface Provider<T> {
    T get();
}
```

Contoh:

```java
final class ReportJob {
    private final Provider<ReportWriter> writerProvider;

    ReportJob(Provider<ReportWriter> writerProvider) {
        this.writerProvider = writerProvider;
    }

    void run(List<Report> reports) {
        for (Report report : reports) {
            ReportWriter writer = writerProvider.get();
            writer.write(report);
        }
    }
}
```

Provider berguna untuk:

1. lazy dependency,
2. prototype dependency dari singleton,
3. request-scoped dependency,
4. expensive creation,
5. optional extension,
6. breaking non-domain lifecycle mismatch.

Tetapi Provider juga bisa menjadi Service Locator kecil jika disalahgunakan.

Buruk:

```java
final class ApprovalService {
    private final Provider<Object> provider;

    void approve(String type) {
        Object dependency = provider.get();
        // decide at runtime with casts
    }
}
```

Lebih baik:

```java
final class ApprovalService {
    private final Map<ApplicationType, ApprovalPolicy> policies;
}
```

Provider harus menjawab lifecycle problem, bukan menyembunyikan dependency design.

---

## 8. Dependency Injection vs Service Locator

Service Locator:

```java
class ApprovalService {
    void approve(String id) {
        var repository = ServiceLocator.get(ApplicationRepository.class);
        var policy = ServiceLocator.get(EligibilityPolicy.class);
        // logic
    }
}
```

DI:

```java
class ApprovalService {
    private final ApplicationRepository repository;
    private final EligibilityPolicy policy;

    ApprovalService(ApplicationRepository repository, EligibilityPolicy policy) {
        this.repository = repository;
        this.policy = policy;
    }
}
```

Perbedaan utamanya bukan teknis, tetapi visibility.

| Aspek | DI | Service Locator |
|---|---|---|
| Dependency terlihat | Ya | Tidak jelas |
| Testability | Tinggi | Rendah/sedang |
| Compile-time signal | Kuat | Lemah |
| Runtime failure | Lebih awal | Bisa terlambat |
| Coupling | Ke abstraction | Ke locator |
| Discovery | Constructor | Runtime lookup |

Service Locator kadang berguna di boundary plugin/framework, tetapi buruk untuk domain/application service.

Safe-ish use case:

```text
Framework internals, plugin loading, dynamic extension registry.
```

Bad use case:

```text
Business service mengambil semua dependency dari global locator.
```

---

## 9. Scope Pattern

Framework container biasanya mengenal scope:

1. singleton,
2. prototype/dependent,
3. request,
4. session,
5. application,
6. transaction,
7. custom scope.

Scope adalah lifecycle contract.

Masalah muncul ketika scope dicampur sembarangan.

Contoh bug:

```java
@Singleton
class BatchProcessor {
    private final RequestContext requestContext;
}
```

Jika `RequestContext` request-scoped tetapi diinjeksi ke singleton, container mungkin membuat proxy.

```text
Singleton BatchProcessor
  -> Proxy<RequestContext>
      -> actual RequestContext resolved per request/thread/context
```

Ini bisa valid, tetapi perlu dipahami.

Risiko:

1. request context tidak aktif,
2. proxy dipakai di thread lain,
3. async execution kehilangan context,
4. background job tidak punya request scope,
5. test gagal karena context tidak tersedia.

Rule:

```text
Jangan inject narrower scope langsung ke wider scope kecuali paham proxy/context resolution-nya.
```

---

## 10. Lifecycle Callback Pattern

Framework sering menyediakan lifecycle callback:

```java
@PostConstruct
void init() {
    // called by container after injection
}

@PreDestroy
void shutdown() {
    // called before bean destroyed
}
```

Lifecycle callback berguna untuk:

1. warm-up cache,
2. validate configuration,
3. open managed resource,
4. register listener,
5. clean shutdown.

Namun berbahaya jika dipakai untuk business logic.

Buruk:

```java
@PostConstruct
void init() {
    migrateProductionData();
    sendStartupEmail();
    callExternalSystem();
}
```

Risiko:

1. startup lambat,
2. partial startup state,
3. retry tidak jelas,
4. failure semantics tidak jelas,
5. deployment menjadi side-effectful,
6. sulit dites.

Lifecycle callback harus kecil, deterministic, dan observable.

---

## 11. Bean Discovery and Annotation Scanning

Annotation-driven framework menemukan class melalui metadata.

```java
@Service
class ApprovalService {}

@Repository
class JpaApplicationRepository {}

@RestController
class CaseController {}
```

Annotation discovery memberi produktivitas tinggi, tetapi menyembunyikan composition root.

Keuntungan:

1. less boilerplate,
2. auto-registration,
3. standard convention,
4. easier integration.

Kerugian:

1. object graph tidak eksplisit,
2. accidental bean discovery,
3. package scanning menjadi architecture boundary palsu,
4. sulit tahu siapa memakai siapa,
5. startup failure karena ambiguous bean,
6. refactoring package bisa mengubah runtime behavior.

Rule:

```text
Annotation scanning cocok untuk wiring stabil.
Explicit @Bean/config cocok untuk object graph yang butuh keputusan desain eksplisit.
```

---

## 12. Annotation as Metadata vs Annotation as Behavior

Tidak semua anotasi sama.

### 12.1 Metadata Annotation

```java
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface ModuleOwner {
    String value();
}
```

Anotasi ini menjelaskan metadata.

### 12.2 Behavior Annotation

```java
@Transactional
@Cacheable
@Retryable
@PreAuthorize(...)
```

Anotasi ini mengubah runtime behavior, biasanya via proxy/interceptor/AOP.

Perbedaan penting:

```text
Metadata annotation -> describes
Behavior annotation -> changes execution
```

Behavior annotation harus diperlakukan seperti code.

Jika kamu menambahkan:

```java
@Transactional
```

kamu menambahkan:

1. transaction boundary,
2. commit/rollback semantics,
3. exception mapping impact,
4. locking duration,
5. connection usage,
6. nested call behavior,
7. proxy requirement.

Annotation bukan dekorasi visual.

---

## 13. Reflection Pattern

Reflection memungkinkan program membaca dan memanggil metadata runtime:

```java
Class<?> type = Class.forName("com.example.MyClass");
Method method = type.getDeclaredMethod("execute");
Object result = method.invoke(instance);
```

Reflection dipakai framework untuk:

1. dependency injection,
2. annotation scanning,
3. serialization/deserialization,
4. proxy creation,
5. test frameworks,
6. ORM mapping,
7. validation,
8. plugin discovery,
9. runtime adaptation.

Java menyediakan `java.lang.reflect` untuk mengakses field, method, constructor, dan metadata class dalam batasan encapsulation/security.

---

## 14. Reflection Cost Model

Reflection memiliki biaya desain, bukan hanya biaya CPU.

| Cost | Penjelasan |
|---|---|
| Type safety | Banyak error pindah ke runtime |
| Discoverability | Call graph sulit dibaca |
| Static analysis | Tools lebih sulit memahami behavior |
| Refactoring safety | Rename method/field bisa rusak runtime |
| Security | Bisa membuka akses internal jika salah |
| Performance | Invocation reflective lebih mahal dibanding direct call, meski JVM modern membaik |
| Native image | Reflection perlu metadata/config eksplisit di banyak runtime native |
| Encapsulation | Bisa melanggar boundary object/module |

Reflection sah digunakan, tetapi harus terkonsentrasi di framework/boundary layer.

Buruk:

```java
class ApprovalService {
    void approve(Object command) {
        for (Field field : command.getClass().getDeclaredFields()) {
            field.setAccessible(true);
            // business logic by field name
        }
    }
}
```

Lebih baik:

```java
record ApproveApplicationCommand(ApplicationId id, OfficerId officerId) {}
```

Domain/application code sebaiknya explicit. Reflection cocok untuk infrastructure.

---

## 15. Annotation Processor vs Runtime Reflection

Ada dua cara besar memakai metadata:

```text
Compile-time processing  -> generate/validate code saat build
Runtime reflection       -> discover/invoke saat aplikasi berjalan
```

Annotation processor:

1. MapStruct,
2. Lombok,
3. Dagger,
4. Immutables,
5. AutoService,
6. custom processor.

Runtime reflection:

1. Spring component scan,
2. Jackson serialization,
3. Hibernate entity mapping,
4. Jakarta Bean Validation,
5. JUnit discovery.

Trade-off:

| Aspek | Compile-time | Runtime Reflection |
|---|---|---|
| Startup | Cepat | Bisa lebih lambat |
| Error detection | Build-time | Runtime/startup |
| Flexibility | Lebih rendah | Tinggi |
| Debugging | Generated code bisa dilihat | Runtime behavior tersembunyi |
| Native image | Lebih ramah | Butuh config |
| Dynamic extension | Terbatas | Kuat |

Rule:

```text
Jika dependency/metadata stabil dan bisa diketahui saat build, compile-time generation sering lebih kuat.
Jika extension benar-benar dinamis, runtime reflection/SPI masuk akal.
```

---

## 16. AOP Pattern

AOP, atau Aspect-Oriented Programming, memisahkan cross-cutting concerns dari core logic.

Core logic:

```java
public Decision approve(ApplicationId id) {
    Application app = repository.get(id);
    Decision decision = policy.evaluate(app);
    repository.save(app.approve(decision));
    return decision;
}
```

Cross-cutting concerns:

1. transaction,
2. logging,
3. metrics,
4. tracing,
5. authorization,
6. caching,
7. retry,
8. audit,
9. rate limiting.

AOP mencoba menghindari ini:

```java
public Decision approve(ApplicationId id) {
    log.info("start");
    long start = System.nanoTime();
    transaction.begin();
    try {
        authorize(...);
        Decision decision = retry(() -> {
            Application app = repository.get(id);
            Decision d = policy.evaluate(app);
            repository.save(app.approve(d));
            return d;
        });
        transaction.commit();
        metrics.record(...);
        return decision;
    } catch (Exception e) {
        transaction.rollback();
        throw e;
    }
}
```

AOP membuat core logic lebih bersih, tetapi behavior menjadi lebih tersembunyi.

---

## 17. AOP Join Point, Pointcut, Advice

Konsep dasar:

```text
Join point -> titik eksekusi yang bisa diintercept
Pointcut   -> rule memilih join point
Advice     -> behavior yang dijalankan
Aspect     -> modul cross-cutting behavior
```

Contoh konseptual:

```java
@Around("@annotation(Audited)")
public Object audit(ProceedingJoinPoint pjp) throws Throwable {
    long start = System.nanoTime();
    try {
        Object result = pjp.proceed();
        auditSuccess(pjp, result, start);
        return result;
    } catch (Throwable ex) {
        auditFailure(pjp, ex, start);
        throw ex;
    }
}
```

AOP bagus jika advice:

1. generic,
2. orthogonal,
3. tidak mengubah domain semantics secara tersembunyi,
4. observable,
5. order-nya jelas.

AOP buruk jika advice menjadi tempat business rule.

---

## 18. Proxy Pattern dalam Framework

Banyak framework menerapkan DI/AOP melalui proxy.

```text
Caller -> Proxy -> Advice Chain -> Target Object
```

Contoh:

```java
interface ApprovalUseCase {
    Decision approve(ApplicationId id);
}
```

Runtime:

```text
ApprovalUseCase proxy
  -> TransactionInterceptor
  -> SecurityInterceptor
  -> MetricsInterceptor
  -> ApprovalService target
```

Spring AOP umum memakai JDK dynamic proxy atau CGLIB/class-based proxy. JDK dynamic proxy bekerja melalui interface, sedangkan CGLIB membuat subclass proxy.

---

## 19. Self-Invocation Problem

Masalah terkenal pada proxy-based AOP:

```java
@Service
class CaseService {

    public void submit(String id) {
        validate(id);
        approve(id); // self-invocation
    }

    @Transactional
    public void approve(String id) {
        // expected transactional
    }
}
```

Jika `submit()` memanggil `approve()` langsung melalui `this.approve()`, call tidak melewati proxy.

Akibat:

```text
@Transactional mungkin tidak aktif.
@Cacheable mungkin tidak aktif.
@Retryable mungkin tidak aktif.
@Async mungkin tidak aktif.
```

Mental model:

```text
External caller -> proxy -> advice -> target method  ✅
Target method -> this.otherMethod()                 ❌ bypass proxy
```

Solusi sehat biasanya bukan self-injection, tetapi desain ulang boundary.

Buruk:

```java
@Autowired
@Lazy
private CaseService self;
```

Lebih baik:

```java
@Service
class SubmitCaseUseCase {
    private final ApproveCaseUseCase approveCaseUseCase;

    void submit(String id) {
        approveCaseUseCase.approve(id);
    }
}
```

Atau pisahkan transactional boundary secara eksplisit:

```java
@Service
class ApprovalTransactionScript {
    @Transactional
    public void approveInTransaction(ApplicationId id) {
        ...
    }
}
```

Self-invocation problem adalah sinyal bahwa kamu harus memahami runtime call path.

---

## 20. Interceptor vs AOP vs Filter vs Decorator

Keempatnya mirip tetapi berbeda.

| Pattern | Level | Cocok untuk |
|---|---|---|
| Filter | protocol/request pipeline | HTTP request/response |
| Interceptor | framework invocation | controller/resource/method lifecycle |
| AOP advice | method join point | transaction, metrics, security, caching |
| Decorator | explicit object composition | explicit wrapping per interface |

Filter:

```text
HTTP request -> Filter -> Filter -> Controller
```

Interceptor:

```text
Framework invokes handler -> preHandle -> handler -> postHandle
```

AOP:

```text
Method call -> advice -> target method
```

Decorator:

```java
new MetricsRepository(new RetryingRepository(new JdbcRepository(...)))
```

Rule:

```text
Gunakan explicit decorator jika behavior penting untuk memahami desain domain/application.
Gunakan AOP/interceptor untuk concern yang benar-benar cross-cutting dan seragam.
```

---

## 21. Annotation Magic Anti-Pattern

Annotation magic terjadi ketika perilaku penting tersembunyi di anotasi yang tersebar.

```java
@Secure
@Audited
@Retryable
@Async
@Transactional
@CacheEvict
public void approve(...) {}
```

Masalah:

1. sulit tahu urutan eksekusi,
2. sulit tahu failure semantics,
3. sulit tahu thread tempat eksekusi,
4. sulit tahu transaction aktif atau tidak,
5. sulit tahu exception mana yang di-retry,
6. sulit tahu data mana yang diaudit,
7. sulit dites dengan unit test biasa.

Annotation magic lebih parah ketika annotation custom berisi rule bisnis tersembunyi.

```java
@RegulatoryApprovalCheck
public void approve(...) {}
```

Jika annotation itu menjalankan logic eligibility, authorization, audit, notification, dan state transition sekaligus, maka desain menjadi opaque.

Rule:

```text
Annotation boleh menandai boundary.
Annotation tidak boleh menjadi tempat utama business decision yang tidak terlihat.
```

---

## 22. Reflection as Architecture Anti-Pattern

Reflection as architecture terjadi ketika sistem bergantung pada nama class/method/field string sebagai mekanisme utama desain.

```java
String className = config.get("handlerClass");
Object handler = Class.forName(className).getConstructor().newInstance();
Method method = handler.getClass().getMethod("handle", Object.class);
method.invoke(handler, command);
```

Ini mungkin terlihat fleksibel, tetapi rapuh:

1. tidak type-safe,
2. error muncul runtime,
3. rename merusak behavior,
4. security risk,
5. sulit dicari,
6. sulit dites,
7. sulit dianalisis static tools.

Alternatif lebih baik:

```java
public interface CommandHandler<C extends Command> {
    CommandType type();
    void handle(C command);
}
```

Registry:

```java
final class CommandHandlerRegistry {
    private final Map<CommandType, CommandHandler<?>> handlers;

    CommandHandlerRegistry(List<CommandHandler<?>> handlers) {
        this.handlers = handlers.stream()
                .collect(Collectors.toUnmodifiableMap(
                        CommandHandler::type,
                        Function.identity()
                ));
    }
}
```

Framework boleh memakai reflection untuk wiring. Business architecture sebaiknya memakai type system.

---

## 23. SPI Pattern

SPI, atau Service Provider Interface, adalah pattern untuk memungkinkan implementasi eksternal dipasang tanpa mengubah core.

API biasa:

```java
public interface AddressValidator {
    ValidationResult validate(Address address);
}
```

SPI:

```java
public interface AddressValidatorProvider {
    String providerName();
    AddressValidator create(ProviderConfig config);
}
```

Core menyediakan contract. Provider menyediakan implementation.

Java menyediakan `ServiceLoader` untuk menemukan provider dari runtime environment.

Contoh:

```java
ServiceLoader<AddressValidatorProvider> loader =
        ServiceLoader.load(AddressValidatorProvider.class);

for (AddressValidatorProvider provider : loader) {
    System.out.println(provider.providerName());
}
```

Provider dapat dideklarasikan melalui `META-INF/services/...` atau module declaration.

Dengan JPMS:

```java
module address.onemap.provider {
    requires address.core;

    provides com.example.AddressValidatorProvider
        with com.example.onemap.OneMapAddressValidatorProvider;
}
```

Consumer module:

```java
module address.runtime {
    uses com.example.AddressValidatorProvider;
}
```

SPI cocok untuk:

1. plugin architecture,
2. vendor integration,
3. database driver model,
4. authentication provider,
5. serialization provider,
6. rule provider,
7. runtime extension.

---

## 24. API vs SPI

API adalah contract untuk user memanggil sistem.

SPI adalah contract untuk provider memperluas sistem.

```text
API direction:
Application code -> Framework/Core

SPI direction:
Framework/Core -> Provider implementation
```

Contoh API:

```java
public interface CaseService {
    CaseDetail getCase(CaseId id);
}
```

Contoh SPI:

```java
public interface CaseNumberGeneratorProvider {
    boolean supports(AgencyCode agency);
    CaseNumberGenerator create(AgencyCode agency);
}
```

API harus nyaman dipakai.

SPI harus stabil, minimal, versionable, dan backward-compatible.

SPI design lebih sulit karena provider eksternal mungkin tidak kamu kontrol.

---

## 25. Plugin Architecture Pattern

Plugin architecture terdiri dari:

```text
Core Runtime
  -> Extension Point Interface
  -> Provider Discovery
  -> Provider Validation
  -> Provider Lifecycle
  -> Provider Isolation
  -> Provider Invocation
```

Contoh:

```java
public interface EnforcementRulePlugin {
    PluginId id();
    PluginVersion version();
    Set<RuleType> supportedRules();
    RuleEvaluation evaluate(RuleInput input);
}
```

Registry:

```java
public final class RulePluginRegistry {
    private final Map<RuleType, EnforcementRulePlugin> plugins;

    public RulePluginRegistry(List<EnforcementRulePlugin> plugins) {
        Map<RuleType, EnforcementRulePlugin> result = new HashMap<>();

        for (EnforcementRulePlugin plugin : plugins) {
            for (RuleType type : plugin.supportedRules()) {
                EnforcementRulePlugin previous = result.putIfAbsent(type, plugin);
                if (previous != null) {
                    throw new DuplicatePluginException(type, previous.id(), plugin.id());
                }
            }
        }

        this.plugins = Map.copyOf(result);
    }
}
```

Plugin design harus menjawab:

1. Bagaimana plugin ditemukan?
2. Bagaimana konflik provider diselesaikan?
3. Bagaimana versi plugin divalidasi?
4. Bagaimana lifecycle plugin?
5. Bagaimana error plugin diisolasi?
6. Bagaimana timeout plugin?
7. Bagaimana observability plugin?
8. Bagaimana security plugin?
9. Bagaimana compatibility policy?
10. Bagaimana plugin diuji?

Plugin bukan hanya `ServiceLoader.load()`.

---

## 26. Framework-Friendly But Framework-Independent Code

Tujuan senior engineer bukan menolak framework. Tujuannya memakai framework tanpa menyerahkan seluruh desain ke framework.

Buruk:

```java
@Entity
@RestController
@Service
@Transactional
public class Application {
    @Id
    private Long id;

    @Autowired
    private SomeService service;

    @PostMapping("/approve")
    public void approve() {
        service.approve(this);
    }
}
```

Ini mencampur:

1. persistence,
2. HTTP,
3. service layer,
4. domain model,
5. DI,
6. transaction.

Lebih baik:

```java
public final class Application {
    private final ApplicationId id;
    private ApplicationStatus status;

    public ApprovalResult approve(ApprovalPolicy policy) {
        if (!policy.canApprove(this)) {
            return ApprovalResult.rejected(...);
        }
        this.status = ApplicationStatus.APPROVED;
        return ApprovalResult.approved(id);
    }
}
```

Framework boundary:

```java
@RestController
final class ApplicationController {
    private final ApproveApplicationUseCase useCase;

    @PostMapping("/applications/{id}/approval")
    ApprovalResponse approve(@PathVariable String id) {
        return ApprovalResponse.from(useCase.approve(new ApplicationId(id)));
    }
}
```

Application service:

```java
@Service
final class ApproveApplicationUseCase {
    private final ApplicationRepository repository;
    private final ApprovalPolicy policy;

    @Transactional
    ApprovalResult approve(ApplicationId id) {
        Application app = repository.get(id);
        ApprovalResult result = app.approve(policy);
        repository.save(app);
        return result;
    }
}
```

Domain tetap testable tanpa Spring/CDI.

---

## 27. Configuration Class Pattern

Configuration class adalah composition root lokal.

```java
@Configuration
class ApprovalModuleConfig {
    @Bean
    ApprovalPolicy approvalPolicy(
            RuleRepository ruleRepository,
            Clock clock
    ) {
        return new DefaultApprovalPolicy(ruleRepository, clock);
    }

    @Bean
    ApproveApplicationUseCase approveApplicationUseCase(
            ApplicationRepository repository,
            ApprovalPolicy policy,
            DomainEventPublisher publisher
    ) {
        return new ApproveApplicationUseCase(repository, policy, publisher);
    }
}
```

Configuration class sehat jika:

1. berisi wiring,
2. tidak berisi business logic,
3. per module/bounded context,
4. dependency direction jelas,
5. mudah dibaca sebagai object graph.

Configuration class buruk jika menjadi god config:

```java
@Configuration
class AppConfig {
    // 800 lines, all modules, all beans, all conditions
}
```

Refactoring:

```text
AppConfig
  -> ApprovalModuleConfig
  -> CaseModuleConfig
  -> NotificationModuleConfig
  -> IntegrationModuleConfig
  -> PersistenceModuleConfig
```

---

## 28. Auto-Configuration Pattern

Auto-configuration mencoba membuat default wiring berdasarkan classpath, properties, dan condition.

Contoh konseptual:

```java
@Configuration
@ConditionalOnProperty(name = "audit.enabled", havingValue = "true")
class AuditAutoConfiguration {
    @Bean
    AuditPublisher auditPublisher(AuditRepository repository) {
        return new DatabaseAuditPublisher(repository);
    }
}
```

Auto-configuration cocok untuk reusable library/internal platform.

Risiko:

1. hidden bean creation,
2. surprising override,
3. configuration property typo,
4. order dependency,
5. startup ambiguity,
6. difficult debugging.

Rule:

```text
Auto-configuration bagus untuk infrastructure default.
Business module wiring sebaiknya eksplisit.
```

---

## 29. Qualifier, Primary, and Ambiguity

Jika ada beberapa implementation:

```java
interface NotificationSender {
    void send(Notification notification);
}

class EmailNotificationSender implements NotificationSender {}
class SmsNotificationSender implements NotificationSender {}
```

Container tidak selalu tahu mana yang dipilih.

Solusi buruk:

```java
@Primary
class EmailNotificationSender implements NotificationSender {}
```

`@Primary` bisa valid, tetapi sering menyembunyikan keputusan.

Lebih jelas:

```java
final class NotificationService {
    private final NotificationSender emailSender;
    private final NotificationSender smsSender;

    NotificationService(
            @EmailChannel NotificationSender emailSender,
            @SmsChannel NotificationSender smsSender
    ) {
        this.emailSender = emailSender;
        this.smsSender = smsSender;
    }
}
```

Atau gunakan registry:

```java
final class NotificationSenderRegistry {
    private final Map<Channel, NotificationSender> senders;
}
```

Rule:

```text
Qualifier harus merepresentasikan domain/infrastructure meaning, bukan sekadar nama class.
```

---

## 30. Circular Dependency Anti-Pattern

Circular dependency:

```text
A -> B -> C -> A
```

Contoh:

```java
@Service
class CaseService {
    CaseService(NotificationService notificationService) {}
}

@Service
class NotificationService {
    NotificationService(CaseService caseService) {}
}
```

Circular dependency menandakan boundary tidak jelas.

Penyebab umum:

1. service saling memanggil,
2. domain event tidak dipakai,
3. orchestration tersebar,
4. module boundary bocor,
5. helper/service campur responsibility,
6. bidirectional dependency karena convenience.

Solusi:

1. extract orchestration use case,
2. introduce domain event,
3. split interface,
4. invert dependency,
5. introduce port,
6. move shared logic ke domain service yang lebih kecil,
7. break read/write dependency.

Buruk:

```java
@Lazy
CaseService caseService;
```

`@Lazy` bisa menunda masalah, bukan menyelesaikan desain.

Lebih baik:

```text
SubmitCaseUseCase
  -> CaseRepository
  -> NotificationPort

NotificationService no longer calls CaseService directly.
```

---

## 31. DI Graph as Architecture Signal

Dependency graph dapat digunakan sebagai alat diagnosis desain.

Class sehat:

```text
ApproveApplicationUseCase
  -> ApplicationRepository
  -> ApprovalPolicy
  -> DomainEventPublisher
  -> Clock
```

Class mencurigakan:

```text
CaseService
  -> ApplicationRepository
  -> CaseRepository
  -> UserRepository
  -> RoleRepository
  -> NotificationService
  -> EmailService
  -> SmsService
  -> AuditService
  -> FileService
  -> ExternalApiClient
  -> ObjectMapper
  -> ApplicationContext
  -> TransactionTemplate
```

Constructor besar bukan masalah syntax. Itu architectural smell.

Diagnosis:

1. terlalu banyak responsibility,
2. orchestration terlalu luas,
3. service menjadi module boundary palsu,
4. dependency dari banyak subdomain,
5. tidak ada application use case spesifik,
6. missing policy/rule object,
7. missing gateway/facade.

---

## 32. Domain Depending on Framework Anti-Pattern

Buruk:

```java
@Entity
public class Application {
    @Autowired
    private ApprovalPolicy policy;

    @Transactional
    public void approve() {
        if (SecurityContextHolder.getContext().getAuthentication() == null) {
            throw new AccessDeniedException(...);
        }
        policy.validate(this);
        this.status = APPROVED;
    }
}
```

Domain sekarang bergantung pada:

1. ORM,
2. DI,
3. transaction,
4. security framework,
5. global context.

Lebih baik:

```java
public final class Application {
    public ApprovalDecision approve(ApprovalPolicy policy, Actor actor, Instant now) {
        ApprovalDecision decision = policy.evaluate(this, actor, now);
        if (decision.allowed()) {
            this.status = ApplicationStatus.APPROVED;
        }
        return decision;
    }
}
```

Application service/framework layer menyediakan context:

```java
@Transactional
public ApprovalResponse approve(ApplicationId id) {
    Actor actor = actorProvider.currentActor();
    Instant now = clock.instant();
    Application app = repository.get(id);
    ApprovalDecision decision = app.approve(policy, actor, now);
    repository.save(app);
    return mapper.toResponse(decision);
}
```

Domain menerima dependency sebagai explicit parameter atau constructor dependency yang framework-independent.

---

## 33. Context Propagation Pattern

Framework sering menyediakan context:

1. security context,
2. transaction context,
3. request context,
4. locale context,
5. tenant context,
6. correlation context,
7. MDC logging context.

Problem:

```text
Context often lives outside method signatures.
```

Contoh:

```java
String user = SecurityContextHolder.getContext().getAuthentication().getName();
```

Ini praktis, tetapi tersembunyi.

Alternatif explicit:

```java
record RequestContext(
        Actor actor,
        TenantId tenantId,
        CorrelationId correlationId,
        Locale locale
) {}
```

Use case:

```java
ApprovalResult approve(RequestContext context, ApplicationId id) {
    ...
}
```

Trade-off:

| Approach | Kelebihan | Kekurangan |
|---|---|---|
| Global/thread context | praktis | hidden dependency |
| Explicit context parameter | jelas/testable | signature lebih panjang |
| ScopedValue | structured context | butuh Java modern dan discipline |
| Framework context wrapper | seimbang | tetap perlu boundary |

Java modern dengan `ScopedValue` memberi model context yang lebih aman dibanding `ThreadLocal` untuk structured execution, terutama saat virtual threads/structured concurrency digunakan.

---

## 34. Transaction Annotation as Design Boundary

`@Transactional` bukan sekadar anotasi persistence.

Ia adalah boundary untuk:

1. atomicity,
2. rollback policy,
3. connection lifecycle,
4. persistence context,
5. locking duration,
6. lazy loading window,
7. outbox writing,
8. event publication timing.

Buruk:

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = repository.get(id);
    externalClient.call(app);       // remote call inside transaction
    app.approve();
    repository.save(app);
}
```

Masalah:

1. transaction terbuka terlalu lama,
2. connection held during remote call,
3. lock duration panjang,
4. retry semantics kacau,
5. external side effect tidak rollback.

Lebih baik:

```java
@Transactional
public ApprovalPrepared prepareApproval(ApplicationId id) {
    Application app = repository.get(id);
    ApprovalPrepared prepared = app.prepareApproval(policy);
    repository.save(app);
    outbox.write(prepared.event());
    return prepared;
}
```

External call dilakukan oleh async processor/outbox consumer.

Rule:

```text
Transactional boundary harus mengelilingi state mutation yang perlu atomic.
Jangan otomatis membungkus semua method service besar dengan transaction.
```

---

## 35. Caching Annotation as Hidden State

Caching annotation:

```java
@Cacheable("applications")
public ApplicationDetail getApplication(String id) {
    return repository.getDetail(id);
}
```

Tampak sederhana, tetapi menambah distributed state.

Pertanyaan desain:

1. Apa cache key-nya?
2. Apakah key tenant-aware?
3. Apakah key actor/permission-aware?
4. Berapa TTL?
5. Bagaimana invalidation?
6. Apakah data boleh stale?
7. Apakah field sensitif bisa bocor?
8. Apakah result berbeda berdasarkan role?
9. Bagaimana cache stampede dicegah?
10. Bagaimana observability hit/miss?

Anti-pattern:

```java
@Cacheable("caseDetail")
public CaseDetail getCaseDetail(String caseId) {
    // returns different fields depending on current user role
}
```

Jika response bergantung pada current user, cache key harus memasukkan security dimension atau caching dipindahkan ke data yang tidak sensitive.

---

## 36. Async Annotation and Thread Boundary

`@Async` atau async framework memindahkan execution ke thread lain.

```java
@Async
public void sendNotification(Notification notification) {
    sender.send(notification);
}
```

Pertanyaan desain:

1. Executor mana yang dipakai?
2. Queue bounded atau unbounded?
3. Apa rejection policy?
4. Bagaimana error ditangani?
5. Bagaimana retry?
6. Bagaimana context propagation?
7. Bagaimana shutdown?
8. Apakah caller butuh result?
9. Apakah order penting?
10. Apakah operation idempotent?

Async annotation sering menjadi fire-and-forget anti-pattern.

Lebih defensible:

```java
public interface NotificationQueue {
    void enqueue(NotificationCommand command);
}
```

Atau return future eksplisit:

```java
CompletableFuture<SendResult> sendAsync(Notification notification);
```

Rule:

```text
Thread boundary adalah failure boundary.
Jangan sembunyikan failure boundary hanya dengan annotation.
```

---

## 37. SPI and Java Module System

Java 9+ module system membuat SPI lebih eksplisit.

Provider module:

```java
module payment.stripe {
    requires payment.api;

    provides com.example.payment.PaymentProvider
        with com.example.payment.stripe.StripePaymentProvider;
}
```

Consumer module:

```java
module payment.runtime {
    requires payment.api;
    uses com.example.payment.PaymentProvider;
}
```

Keuntungan:

1. explicit module dependency,
2. stronger encapsulation,
3. service provider declaration jelas,
4. mengurangi classpath scanning liar,
5. cocok untuk plugin boundary yang dikontrol.

Namun banyak enterprise app masih classpath-based dengan Spring Boot/Jakarta runtime. Jadi module system tidak selalu dipakai penuh, tetapi mental model-nya tetap berguna:

```text
Declare what you require.
Declare what you export.
Declare what you provide.
Declare what you use.
```

Itu prinsip modular design yang kuat.

---

## 38. Designing Custom Annotation Safely

Custom annotation sering menggoda.

Contoh:

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface AuditedAction {
    String action();
    String resource();
}
```

Ini cukup baik jika annotation hanya metadata audit.

Aspect:

```java
@Around("@annotation(audited)")
public Object audit(ProceedingJoinPoint pjp, AuditedAction audited) throws Throwable {
    try {
        Object result = pjp.proceed();
        auditWriter.success(audited.action(), audited.resource(), result);
        return result;
    } catch (Throwable ex) {
        auditWriter.failure(audited.action(), audited.resource(), ex);
        throw ex;
    }
}
```

Desain annotation yang baik:

1. namanya jelas,
2. metadata minimal,
3. behavior-nya documented,
4. order dengan aspect lain jelas,
5. failure policy jelas,
6. test tersedia,
7. tidak menyembunyikan business decision utama,
8. tidak memakai string expression terlalu kompleks,
9. compatible saat field annotation berubah.

Buruk:

```java
@DoEverything(
    validate = true,
    authorize = true,
    audit = true,
    notify = true,
    retry = true,
    transaction = true,
    stateTransition = "APPROVE"
)
```

Itu bukan annotation. Itu hidden programming language.

---

## 39. Designing Framework Extension Point

Extension point harus stabil.

Buruk:

```java
public interface CaseExtension {
    void execute(Object input, Map<String, Object> context);
}
```

Masalah:

1. terlalu generic,
2. tidak type-safe,
3. context tidak jelas,
4. output tidak jelas,
5. error tidak jelas,
6. versioning sulit,
7. testing sulit.

Lebih baik:

```java
public interface CaseSubmissionExtension {
    ExtensionId id();
    ExtensionVersion version();

    ExtensionDecision beforeSubmit(CaseSubmissionContext context);

    default void afterSubmit(CaseSubmittedEvent event) {
        // optional extension hook
    }
}
```

Context eksplisit:

```java
public record CaseSubmissionContext(
        CaseId caseId,
        ApplicantId applicantId,
        Actor actor,
        Instant submittedAt,
        Map<String, String> attributes
) {}
```

Decision eksplisit:

```java
public sealed interface ExtensionDecision {
    record Continue() implements ExtensionDecision {}
    record Block(String reasonCode, String message) implements ExtensionDecision {}
}
```

Extension point yang baik menentukan:

1. lifecycle,
2. context,
3. allowed side effect,
4. timeout,
5. error semantics,
6. ordering,
7. idempotency,
8. compatibility,
9. observability,
10. security.

---

## 40. Framework Pattern in Testing

Framework-heavy code sering diuji dengan integration test penuh karena unit test sulit.

Gejala buruk:

```text
Untuk test satu rule approval, harus start Spring Boot, database, security context, mock server, migration, dan cache.
```

Ini tanda domain logic terlalu bergantung pada framework.

Desain testable:

```java
class DefaultApprovalPolicyTest {
    @Test
    void rejectsWhenApplicantHasActiveSanction() {
        var policy = new DefaultApprovalPolicy();
        var app = fixtures.applicationWithActiveSanction();

        ApprovalDecision decision = policy.evaluate(app);

        assertThat(decision.allowed()).isFalse();
    }
}
```

Framework integration test tetap penting untuk:

1. DI wiring,
2. transaction behavior,
3. proxy behavior,
4. serialization,
5. security filter,
6. persistence mapping,
7. application startup.

Piramida test:

```text
Many: pure domain/application unit tests
Some: slice tests / contract tests
Few: full framework integration tests
```

---

## 41. Observability for Framework Behavior

Framework behavior harus bisa didiagnosis.

Untuk DI:

1. bean graph dump,
2. startup condition report,
3. ambiguous bean error clarity,
4. circular dependency detection,
5. lifecycle logs.

Untuk AOP/proxy:

1. log advice order,
2. expose transaction active flag in debug logs,
3. trace span around advice,
4. metric per interceptor,
5. self-invocation tests.

Untuk SPI/plugin:

1. discovered provider list,
2. provider version,
3. provider load failure,
4. duplicate provider detection,
5. invocation latency,
6. provider error rate.

Contoh log yang berguna:

```json
{
  "event": "plugin_loaded",
  "pluginId": "onemap-address-validator",
  "version": "2.1.0",
  "providerClass": "com.example.onemap.OneMapAddressValidatorProvider",
  "extensionPoint": "AddressValidatorProvider"
}
```

Untuk AOP:

```json
{
  "event": "method_intercepted",
  "method": "ApproveApplicationUseCase.approve",
  "adviceOrder": ["security", "transaction", "metrics", "audit"],
  "transactionActive": true,
  "correlationId": "..."
}
```

Observability tidak hanya untuk request. Framework runtime juga perlu terlihat.

---

## 42. Security Implication of Framework Patterns

Framework magic punya security impact.

### 42.1 Reflection

Risiko:

1. membuka field private,
2. deserialization gadget,
3. classpath scanning berlebihan,
4. dynamic class loading dari input tidak trusted,
5. method invocation by string.

Rule:

```text
Jangan pernah memuat class dari input user tanpa allowlist yang ketat.
```

Buruk:

```java
Class<?> handlerClass = Class.forName(request.getHandlerClass());
```

Lebih baik:

```java
Map<HandlerType, Handler> allowlistedHandlers;
```

### 42.2 Annotation Security

Buruk:

```java
@PreAuthorize("hasRole('ADMIN')")
public void approve(...) {}
```

Ini bisa terlalu kasar.

Lebih baik object-level authorization:

```java
authorizationPolicy.check(actor, Action.APPROVE, application);
```

Annotation boleh menjadi boundary guard, tetapi domain-specific authorization sering perlu explicit policy object.

### 42.3 Plugin Security

Plugin harus dibatasi:

1. provider allowlist,
2. signature/checksum jika perlu,
3. permission boundary,
4. timeout,
5. resource limit,
6. exception isolation,
7. audit invocation.

---

## 43. Performance Implication

Framework pattern punya runtime cost:

1. startup scanning,
2. reflection metadata processing,
3. proxy invocation,
4. annotation parsing,
5. dynamic dispatch,
6. context lookup,
7. transaction open/close,
8. cache interception,
9. security expression evaluation.

Namun jangan premature optimize.

Pertanyaan senior:

```text
Apakah cost ini di startup path, request hot path, batch hot loop, atau jarang?
```

Reflection di startup biasanya acceptable.

Reflection di inner loop jutaan kali mungkin buruk.

AOP di service boundary biasanya acceptable.

AOP di tiny method yang dipanggil jutaan kali mungkin mahal.

Proxy around repository call biasanya acceptable.

Proxy chain 12 layer pada hot low-latency path perlu profiling.

Rule:

```text
Let framework handle coarse-grained boundaries.
Keep hot inner loops explicit and minimal.
```

---

## 44. Java 8–25 Perspective

### Java 8

Java 8 membuat DI lebih ringan melalui functional interface:

```java
final class RetryExecutor {
    <T> T execute(Supplier<T> supplier) {
        return supplier.get();
    }
}
```

Strategy kecil tidak selalu butuh class/framework bean.

### Java 9

JPMS memberi module boundary dan `uses/provides` untuk SPI.

### Java 10+

`var` membantu wiring lokal tetapi jangan mengaburkan type penting.

```java
var service = new ApprovalService(repository, policy);
```

Fine untuk local composition, kurang baik jika type inference menyembunyikan proxy/generated type di debugging.

### Java 14–17

Records bagus untuk context/config/result object:

```java
record PluginDescriptor(PluginId id, PluginVersion version, String className) {}
```

Sealed classes bagus untuk result/error/extension decision:

```java
sealed interface ExtensionDecision permits Continue, Block {}
```

### Java 21+

Virtual threads mengubah thread-per-request cost model. Tetapi framework context berbasis `ThreadLocal` harus dievaluasi hati-hati.

### Java 25

Scoped values dan structured concurrency memberi model context propagation dan child task lifecycle yang lebih structured. Ini penting untuk framework/runtime yang sebelumnya mengandalkan `ThreadLocal` atau executor unmanaged.

---

## 45. Refactoring Path: Dari Framework-Coupled Code ke Clean Boundary

Starting point:

```java
@Service
@Transactional
public class CaseService {
    @Autowired private CaseRepository caseRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private ApplicationContext context;

    @PreAuthorize("hasRole('OFFICER')")
    @CacheEvict(value = "case", key = "#caseId")
    public void approve(String caseId) {
        var user = SecurityContextHolder.getContext().getAuthentication().getName();
        var app = caseRepository.findById(caseId).orElseThrow();

        if (!app.getStatus().equals("PENDING")) {
            throw new RuntimeException("Invalid status");
        }

        app.setStatus("APPROVED");
        caseRepository.save(app);
    }
}
```

Step 1: Make dependencies explicit.

```java
@Service
public class CaseService {
    private final CaseRepository caseRepository;
    private final CurrentActorProvider actorProvider;

    public CaseService(CaseRepository caseRepository, CurrentActorProvider actorProvider) {
        this.caseRepository = caseRepository;
        this.actorProvider = actorProvider;
    }
}
```

Step 2: Extract application use case.

```java
final class ApproveCaseUseCase {
    private final CaseRepository repository;
    private final ApprovalPolicy policy;

    ApprovalResult approve(ApproveCaseCommand command) {
        CaseRecord record = repository.get(command.caseId());
        ApprovalDecision decision = policy.evaluate(record, command.actor());
        record.apply(decision);
        repository.save(record);
        return ApprovalResult.from(decision);
    }
}
```

Step 3: Move authorization into explicit policy.

```java
interface ApprovalPolicy {
    ApprovalDecision evaluate(CaseRecord record, Actor actor);
}
```

Step 4: Keep transaction at application boundary.

```java
@Service
final class TransactionalApproveCaseHandler {
    private final ApproveCaseUseCase useCase;

    @Transactional
    ApprovalResult approve(ApproveCaseCommand command) {
        return useCase.approve(command);
    }
}
```

Step 5: Keep web/framework context at adapter boundary.

```java
@RestController
final class CaseController {
    private final TransactionalApproveCaseHandler handler;
    private final CurrentActorProvider actorProvider;

    @PostMapping("/cases/{id}/approval")
    ApprovalResponse approve(@PathVariable String id) {
        var command = new ApproveCaseCommand(new CaseId(id), actorProvider.currentActor());
        return ApprovalResponse.from(handler.approve(command));
    }
}
```

Result:

1. domain logic testable without framework,
2. transaction remains framework-managed,
3. security context isolated,
4. no field injection,
5. no ApplicationContext lookup,
6. fewer hidden dependencies.

---

## 46. Anti-Pattern Catalog

### 46.1 Field Injection Everywhere

Symptom:

```java
@Autowired private X x;
@Autowired private Y y;
@Autowired private Z z;
```

Impact:

1. hidden dependency,
2. invalid object state,
3. hard unit testing,
4. dependency explosion.

Fix:

```text
Constructor injection + split responsibility.
```

---

### 46.2 ApplicationContext as Service Locator

Symptom:

```java
context.getBean(handlerName);
```

Impact:

1. runtime string dependency,
2. hidden coupling,
3. harder refactoring.

Fix:

```text
Inject registry/map of typed handlers.
```

---

### 46.3 Annotation Business Logic

Symptom:

```java
@ApproveCaseWorkflow
```

where annotation secretly validates, authorizes, transitions state, sends notification.

Impact:

1. invisible behavior,
2. hard debugging,
3. hard testing,
4. unclear failure semantics.

Fix:

```text
Explicit use case + explicit policy + explicit event.
```

---

### 46.4 AOP Side-Effect Trap

Symptom:

Aspect sends email, changes database, mutates domain state.

Impact:

1. core logic lies,
2. retry/transaction semantics unclear,
3. side effects happen unexpectedly.

Fix:

```text
AOP for observation/guarding; domain side effects explicit.
```

---

### 46.5 Self-Invocation Surprise

Symptom:

```java
this.transactionalMethod();
```

Impact:

1. transaction/cache/security advice bypassed.

Fix:

```text
Split boundary or use explicit orchestration.
```

---

### 46.6 Reflection-Driven Business Logic

Symptom:

Business rules inspect field names and annotations dynamically.

Impact:

1. runtime fragility,
2. no type safety,
3. hard static analysis.

Fix:

```text
Rule objects, specifications, typed metadata, generated code if needed.
```

---

### 46.7 God Configuration

Symptom:

One config class wires entire application.

Impact:

1. module boundary unclear,
2. merge conflicts,
3. condition chaos.

Fix:

```text
Module-level config classes.
```

---

### 46.8 Container-Dependent Domain

Symptom:

Domain object uses `@Autowired`, `@Transactional`, `SecurityContextHolder`.

Impact:

1. domain cannot run outside framework,
2. tests heavy,
3. business logic tied to infrastructure.

Fix:

```text
Move framework concerns to adapter/application layer.
```

---

### 46.9 Ambiguous Bean by Accident

Symptom:

Multiple implementations and random `@Primary`.

Impact:

1. wrong implementation selected,
2. environment-specific behavior,
3. difficult diagnosis.

Fix:

```text
Explicit qualifier, registry, or config selection.
```

---

### 46.10 Lifecycle Callback Doing Too Much

Symptom:

`@PostConstruct` calls external API or mutates production data.

Impact:

1. startup instability,
2. side effects during deployment,
3. unclear retry semantics.

Fix:

```text
Dedicated startup job with explicit lifecycle, idempotency, observability.
```

---

## 47. Design Review Checklist

Gunakan checklist ini saat review framework-heavy Java code.

### DI

```text
[ ] Apakah dependency mandatory masuk lewat constructor?
[ ] Apakah constructor terlalu besar?
[ ] Apakah ada field injection yang tidak perlu?
[ ] Apakah ada ApplicationContext/getBean di business code?
[ ] Apakah circular dependency diselesaikan desain, bukan @Lazy patch?
[ ] Apakah scope dependency cocok?
```

### AOP / Proxy

```text
[ ] Apakah annotation behavior dipahami?
[ ] Apakah method dipanggil melalui proxy?
[ ] Apakah ada self-invocation problem?
[ ] Apakah order advice jelas?
[ ] Apakah side effect utama tersembunyi di aspect?
[ ] Apakah transaction boundary tepat?
```

### Annotation

```text
[ ] Apakah annotation hanya metadata atau mengubah behavior?
[ ] Apakah behavior annotation terdokumentasi?
[ ] Apakah custom annotation terlalu powerful?
[ ] Apakah annotation menyembunyikan business rule?
```

### Reflection

```text
[ ] Apakah reflection terkonsentrasi di infrastructure?
[ ] Apakah class/method name dari input user dicegah?
[ ] Apakah rename/refactor aman?
[ ] Apakah native image/startup impact dipahami?
```

### SPI / Plugin

```text
[ ] Apakah extension point type-safe?
[ ] Apakah provider discovery jelas?
[ ] Apakah duplicate provider ditolak?
[ ] Apakah plugin timeout/error diisolasi?
[ ] Apakah provider version divalidasi?
[ ] Apakah invocation observable?
```

### Domain Boundary

```text
[ ] Apakah domain bebas dari framework annotation?
[ ] Apakah security context dibawa eksplisit ke use case/domain?
[ ] Apakah transaction hanya di application boundary?
[ ] Apakah domain bisa dites tanpa container?
```

---

## 48. Common Staff-Level Discussion

### Pertanyaan 1

> Apakah dependency injection selalu membutuhkan framework?

Tidak. DI adalah pattern. Framework hanya mengotomasi wiring dan lifecycle. Manual constructor injection tetap DI.

### Pertanyaan 2

> Kenapa field injection dianggap buruk?

Karena dependency menjadi tersembunyi, field tidak final, object bisa dibuat invalid, dan unit test tanpa container menjadi lebih sulit. Field injection juga membuat dependency explosion tidak terasa.

### Pertanyaan 3

> Apakah AOP buruk?

Tidak. AOP bagus untuk cross-cutting concern yang seragam. AOP buruk ketika menyembunyikan business decision, side effect penting, atau failure boundary.

### Pertanyaan 4

> Kapan memakai ServiceLoader?

Saat core perlu menemukan provider eksternal berdasarkan SPI yang stabil. Cocok untuk plugin/provider model. Tidak cocok untuk mengganti dependency injection biasa di application service.

### Pertanyaan 5

> Apa bahaya annotation-driven programming?

Behavior menjadi tidak terlihat di call graph biasa. Annotation yang mengubah runtime harus diperlakukan seperti code: diuji, didokumentasikan, dan direview.

### Pertanyaan 6

> Bagaimana membuat domain tetap framework-independent?

Domain object jangan mengambil dependency dari container, jangan membaca global framework context, jangan bergantung pada transaction/security annotation. Framework boundary menerjemahkan request/context menjadi explicit domain input.

### Pertanyaan 7

> Bagaimana memilih antara explicit decorator dan AOP?

Jika behavior penting untuk memahami use case atau berbeda per dependency, gunakan decorator eksplisit. Jika behavior benar-benar cross-cutting, seragam, dan bisa distandarkan, AOP/interceptor layak.

---

## 49. Case Study: Approval Module dengan Framework Boundary Sehat

### 49.1 Requirement

Sistem perlu approval aplikasi dengan:

1. authorization officer,
2. validation status,
3. transaction boundary,
4. audit trail,
5. event outbox,
6. notification async,
7. framework Spring/CDI/Jakarta friendly,
8. domain tetap testable.

---

### 49.2 Bad Design

```java
@Service
@Transactional
public class ApplicationService {
    @Autowired ApplicationRepository repository;
    @Autowired NotificationService notification;
    @Autowired AuditService audit;

    @PreAuthorize("hasRole('OFFICER')")
    public void approve(String id) {
        String actor = SecurityContextHolder.getContext().getAuthentication().getName();
        ApplicationEntity entity = repository.findById(id).orElseThrow();

        if (!entity.getStatus().equals("PENDING")) {
            throw new RuntimeException("Invalid status");
        }

        entity.setStatus("APPROVED");
        repository.save(entity);
        audit.log("APPROVED " + id + " by " + actor);
        notification.sendApprovalEmail(id);
    }
}
```

Problems:

1. field injection,
2. string status,
3. security context hidden,
4. domain rule inside service,
5. audit string not structured,
6. notification side effect inside transaction,
7. external effect cannot rollback,
8. transaction too broad,
9. hard unit test.

---

### 49.3 Better Design

Command:

```java
public record ApproveApplicationCommand(
        ApplicationId applicationId,
        Actor actor,
        CorrelationId correlationId
) {}
```

Domain policy:

```java
public interface ApprovalPolicy {
    ApprovalDecision evaluate(Application application, Actor actor);
}
```

Decision:

```java
public sealed interface ApprovalDecision {
    record Allowed() implements ApprovalDecision {}
    record Rejected(String reasonCode, String message) implements ApprovalDecision {}
}
```

Domain:

```java
public final class Application {
    private final ApplicationId id;
    private ApplicationStatus status;

    public DomainEvent approve(ApprovalPolicy policy, Actor actor, Instant now) {
        ApprovalDecision decision = policy.evaluate(this, actor);

        if (decision instanceof ApprovalDecision.Rejected rejected) {
            throw new ApprovalRejectedException(rejected.reasonCode(), rejected.message());
        }

        if (status != ApplicationStatus.PENDING_REVIEW) {
            throw new IllegalStateTransitionException(status, ApplicationStatus.APPROVED);
        }

        this.status = ApplicationStatus.APPROVED;
        return new ApplicationApproved(id, actor.id(), now);
    }
}
```

Use case:

```java
public final class ApproveApplicationUseCase {
    private final ApplicationRepository repository;
    private final ApprovalPolicy policy;
    private final OutboxWriter outboxWriter;
    private final Clock clock;

    public ApproveApplicationUseCase(
            ApplicationRepository repository,
            ApprovalPolicy policy,
            OutboxWriter outboxWriter,
            Clock clock
    ) {
        this.repository = repository;
        this.policy = policy;
        this.outboxWriter = outboxWriter;
        this.clock = clock;
    }

    public void approve(ApproveApplicationCommand command) {
        Application application = repository.get(command.applicationId());
        DomainEvent event = application.approve(policy, command.actor(), clock.instant());
        repository.save(application);
        outboxWriter.write(event, command.correlationId());
    }
}
```

Framework boundary:

```java
@Service
public final class TransactionalApproveApplicationHandler {
    private final ApproveApplicationUseCase useCase;

    public TransactionalApproveApplicationHandler(ApproveApplicationUseCase useCase) {
        this.useCase = useCase;
    }

    @Transactional
    public void handle(ApproveApplicationCommand command) {
        useCase.approve(command);
    }
}
```

Controller:

```java
@RestController
final class ApprovalController {
    private final TransactionalApproveApplicationHandler handler;
    private final CurrentActorProvider actorProvider;
    private final CorrelationIdProvider correlationIdProvider;

    @PostMapping("/applications/{id}/approval")
    ResponseEntity<Void> approve(@PathVariable String id) {
        var command = new ApproveApplicationCommand(
                new ApplicationId(id),
                actorProvider.currentActor(),
                correlationIdProvider.currentCorrelationId()
        );
        handler.handle(command);
        return ResponseEntity.noContent().build();
    }
}
```

Audit via outbox consumer:

```java
public final class AuditEventConsumer {
    public void on(ApplicationApproved event) {
        auditWriter.write(new AuditRecord(
                event.applicationId(),
                "APPLICATION_APPROVED",
                event.actorId(),
                event.occurredAt()
        ));
    }
}
```

Result:

1. domain independent,
2. transaction explicit,
3. framework context converted at edge,
4. audit structured,
5. notification can be async/idempotent,
6. approval rule testable,
7. DI graph clear,
8. no hidden ServiceLocator,
9. no annotation business logic.

---

## 50. Final Mental Model

Framework pattern mastery bukan berarti menulis banyak framework code.

Framework pattern mastery berarti tahu:

```text
What is explicit?
What is implicit?
Who creates the object?
Who owns lifecycle?
Who controls call flow?
Where is the boundary?
Where is the context stored?
Where is transaction started?
Where is security checked?
Where can proxy be bypassed?
Where can reflection break refactoring?
Where can annotation hide behavior?
Where should domain remain pure?
```

Top engineer tidak anti-framework. Top engineer juga tidak menyerahkan desain ke framework.

Framework adalah amplifier.

Jika desainmu sehat, framework mempercepat.

Jika desainmu kacau, framework membuat kekacauan terlihat seperti arsitektur.

---

## 51. Summary

Pada part ini kita membahas:

1. Framework sebagai Inversion of Control runtime.
2. Dependency Injection sebagai dependency direction pattern.
3. Constructor injection sebagai default terbaik.
4. Provider pattern untuk lazy/contextual dependency.
5. Service Locator sebagai hidden dependency risk.
6. Scope dan lifecycle sebagai design contract.
7. Annotation scanning sebagai productivity vs visibility trade-off.
8. Annotation metadata vs behavior.
9. Reflection sebagai infrastructure tool, bukan business architecture.
10. Compile-time annotation processing vs runtime reflection.
11. AOP, proxy, interceptor, filter, dan decorator.
12. Self-invocation problem.
13. SPI dan plugin architecture.
14. Framework-friendly but framework-independent domain.
15. Transaction/cache/async annotation sebagai hidden boundary.
16. Java 8–25 impact terhadap framework pattern.
17. Anti-pattern catalog.
18. Refactoring path.
19. Design review checklist.
20. Case study approval module.

---

## 52. Status Seri

```text
Part 29 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
30-architecture-layered-hexagonal-clean-modular-monolith.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./28-api-design-patterns-fluent-resource-operation-compatibility.md">⬅️ API Design Patterns: Fluent, Builder, Resource, Operation, Compatibility</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./30-architecture-layered-hexagonal-clean-modular-monolith.md">Part 30 — Architecture Pattern: Layered, Hexagonal, Clean, Modular Monolith ➡️</a>
</div>

# Part 6 — Singleton, Multiton, Registry, Service Locator: Global State Under Control

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> File: `06-singleton-multiton-registry-service-locator-global-state.md`  
> Target: Java 8–25  
> Level: Advanced / Staff Engineer Thinking

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membahas:

1. cara berpikir pattern sebagai respons terhadap *design forces*, bukan template,
2. evolusi Java 8–25 dan bagaimana fitur bahasa mengubah pattern,
3. object design fundamentals: coupling, cohesion, identity, boundary,
4. SOLID sebagai failure-control model,
5. creation pattern awal: constructor, static factory, factory method,
6. creation pattern lanjutan: abstract factory, builder, prototype, test data builder.

Sekarang kita masuk ke family pattern yang sering terlihat sederhana, tetapi sangat berbahaya bila salah dipakai:

- Singleton
- Multiton
- Registry
- Service Locator
- Global State

Pattern ini sering muncul di Java enterprise, Spring/Jakarta/CDI application, framework runtime, plugin architecture, configuration system, cache, metrics, logging, driver manager, security context, tenant registry, dan integration gateway.

Masalahnya: banyak engineer memahami Singleton hanya sebagai:

```java
public class MySingleton {
    private static final MySingleton INSTANCE = new MySingleton();
    private MySingleton() {}
    public static MySingleton getInstance() { return INSTANCE; }
}
```

Padahal pertanyaan seniornya bukan “bagaimana menulis Singleton?”, tetapi:

```text
Apa yang benar-benar harus tunggal?
Tunggal dalam scope apa?
JVM? ClassLoader? Application? Tenant? Request? Container? Cluster?
Apa lifecycle-nya?
Apa state-nya mutable?
Bagaimana test isolation?
Bagaimana reload/reconfiguration?
Bagaimana observability?
Bagaimana shutdown?
Bagaimana concurrency?
Bagaimana dependency-nya terlihat?
```

Part ini akan membahas Singleton bukan sebagai trik Java, melainkan sebagai desain untuk **mengontrol akses, lifecycle, dan shared state**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan Singleton sebagai pattern dengan singleton scope di dependency injection container.
2. Menentukan kapan satu instance memang valid dan kapan hanya kemalasan desain.
3. Mendesain Singleton yang aman terhadap concurrency, serialization, reflection, classloader, dan testing.
4. Memahami Enum Singleton, Lazy Holder, eager initialization, double-checked locking, dan trade-off-nya.
5. Memahami Multiton sebagai keyed singleton dan failure mode-nya.
6. Memahami Registry sebagai katalog objek/handler/provider yang eksplisit.
7. Memahami Service Locator sebagai dependency access pattern dan mengapa sering dianggap anti-pattern.
8. Membedakan Service Locator dengan Factory, Registry, DI, Provider, dan Plugin SPI.
9. Mengidentifikasi global state tersembunyi dalam Java codebase.
10. Membuat refactoring path dari static global dependency menuju dependency injection atau explicit context.
11. Mendesain singleton-like component yang tetap testable, observable, reloadable, dan safe.
12. Menilai pattern ini di Java 8–25, termasuk pengaruh classloader, module system, virtual threads, scoped values, dan container runtime.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Dalam sistem enterprise, sering ada objek yang secara alami ingin dibagi:

- configuration provider,
- metrics registry,
- logger factory,
- clock provider,
- feature flag service,
- database connection pool,
- HTTP client pool,
- object mapper,
- validator factory,
- event dispatcher,
- handler registry,
- tenant registry,
- plugin registry,
- security context accessor,
- correlation context,
- ID generator,
- cache manager,
- thread pool,
- scheduler,
- application lifecycle manager.

Masalah desainnya bukan sekadar “buat satu instance”. Masalah sebenarnya:

```text
Bagaimana membuat shared component mudah digunakan,
tetapi tidak membuat dependency menjadi tersembunyi,
tidak membuat test saling bocor,
tidak membuat state susah dikontrol,
tidak membuat lifecycle ambigu,
dan tidak membuat aplikasi sulit dipahami saat production issue terjadi.
```

Contoh buruk yang sering muncul:

```java
public class CaseApprovalService {
    public void approve(String caseId) {
        Config config = GlobalConfig.getInstance();
        AuditLogger audit = AuditLogger.getInstance();
        User user = SecurityContextHolder.getCurrentUser();
        Database db = DatabaseRegistry.get("main");

        // business logic mixed with hidden global dependencies
    }
}
```

Code seperti ini terlihat pendek. Tetapi dependency sebenarnya tidak terlihat dari constructor atau method signature.

Akibatnya:

- sulit dites,
- sulit diganti,
- sulit dimock,
- sulit diparalelkan,
- sulit dipahami,
- sulit diobservasi,
- sulit direload,
- rentan race condition,
- rentan state leakage antar request/test/tenant,
- dependency graph tidak bisa dianalisis jelas.

Senior engineer melihat pattern ini bukan sebagai “praktis”, tetapi sebagai **global coupling surface**.

---

## 3. Core Mental Model

### 3.1 Singleton Bukan “Satu Objek”, Tapi “Satu Objek dalam Scope Tertentu”

Kalimat “hanya satu instance” selalu tidak lengkap.

Harus ditanya:

```text
Satu dalam scope apa?
```

Kemungkinan scope:

| Scope | Arti |
|---|---|
| Per object graph | Satu instance dalam dependency graph tertentu |
| Per DI container | Satu bean singleton dalam container |
| Per application | Satu instance selama aplikasi hidup |
| Per JVM | Satu instance di satu proses JVM |
| Per ClassLoader | Satu instance per classloader |
| Per module | Satu instance per module/plugin |
| Per tenant | Satu instance per tenant |
| Per request | Satu instance per request context |
| Per thread | Satu instance per thread |
| Per virtual thread | Satu instance per virtual-thread task |
| Per cluster | Satu logical singleton di distributed system |

Java Singleton klasik biasanya hanya menjamin:

```text
satu instance per classloader, bukan satu instance global universal.
```

Dalam application server, OSGi, plugin runtime, servlet container, test runner, hot reload framework, dan modular runtime, classloader boundary sangat penting.

### 3.2 Singleton Menggabungkan Dua Hal yang Sebaiknya Dipisah

Singleton biasanya menggabungkan:

1. lifecycle control,
2. global access.

Padahal keduanya berbeda.

Lifecycle control:

```text
Siapa yang membuat instance?
Kapan dibuat?
Kapan dihancurkan?
Bagaimana reconfiguration?
Bagaimana dependency-nya?
```

Global access:

```text
Siapa pun dari mana pun bisa mengambil instance.
```

Masalah utama Singleton bukan selalu “satu instance”. Masalah utamanya adalah **global access point**.

Contoh:

```java
public final class ExchangeRateClient {
    private static final ExchangeRateClient INSTANCE = new ExchangeRateClient();

    public static ExchangeRateClient getInstance() {
        return INSTANCE;
    }
}
```

Kalau class ini stateless, mungkin tidak terlalu buruk. Tetapi kalau dia punya:

- HTTP client,
- credential,
- cache,
- retry policy,
- endpoint config,
- metrics,
- rate limit,
- refresh token,

maka global access mulai menjadi masalah besar.

### 3.3 Global Access Menghilangkan Dependency dari Desain

Dependency yang baik terlihat dari boundary:

```java
public final class CaseApprovalService {
    private final PolicyEvaluator policyEvaluator;
    private final AuditSink auditSink;

    public CaseApprovalService(PolicyEvaluator policyEvaluator, AuditSink auditSink) {
        this.policyEvaluator = policyEvaluator;
        this.auditSink = auditSink;
    }
}
```

Dependency buruk tersembunyi di dalam method:

```java
public final class CaseApprovalService {
    public void approve(CaseId id) {
        PolicyEvaluator evaluator = GlobalPolicyEvaluator.getInstance();
        AuditSink audit = GlobalAuditSink.getInstance();
    }
}
```

Hidden dependency mengganggu:

- code review,
- test design,
- architecture analysis,
- migration,
- dependency graph,
- security review,
- performance analysis,
- fault injection,
- observability.

### 3.4 Pattern Ini Berkaitan dengan Ownership

Pertanyaan ownership:

```text
Siapa pemilik instance?
Siapa yang boleh mengubah state?
Siapa yang bertanggung jawab melakukan close/shutdown?
Siapa yang mengamati health-nya?
Siapa yang boleh mengganti implementasi?
```

Jika jawabannya tidak jelas, Singleton/Registry/Service Locator menjadi sumber design debt.

---

## 4. Singleton Pattern

### 4.1 Intent

Singleton memastikan suatu class hanya memiliki satu instance dalam scope tertentu dan menyediakan access point ke instance tersebut.

Intent klasik:

```text
Ensure a class has only one instance and provide a global point of access to it.
```

Tetapi untuk Java enterprise modern, definisi lebih aman:

```text
Singleton adalah pattern untuk mengontrol lifecycle dan sharing dari resource atau service yang secara desain harus unik dalam suatu boundary yang eksplisit.
```

Kata kuncinya:

- mengontrol,
- lifecycle,
- sharing,
- resource/service,
- unik,
- boundary eksplisit.

### 4.2 Kapan Singleton Masuk Akal

Singleton bisa masuk akal bila:

1. Instance benar-benar tidak boleh lebih dari satu dalam scope tertentu.
2. State-nya immutable atau thread-safe.
3. Lifecycle-nya sederhana dan jelas.
4. Tidak membutuhkan variasi per test/request/tenant/user.
5. Tidak menyembunyikan dependency bisnis penting.
6. Tidak membuat konfigurasi sulit diganti.
7. Tidak memegang resource yang butuh shutdown kompleks, kecuali ada lifecycle manager eksplisit.
8. Tidak memerlukan distributed uniqueness.

Contoh relatif aman:

```java
public enum SystemClockProvider implements ClockProvider {
    INSTANCE;

    @Override
    public Clock clock() {
        return Clock.systemUTC();
    }
}
```

Tetapi bahkan `ClockProvider` untuk business logic sering lebih baik diinjeksi agar test bisa memakai fixed clock.

### 4.3 Kapan Singleton Tidak Masuk Akal

Singleton buruk bila dipakai untuk:

- service bisnis,
- repository,
- gateway eksternal,
- mutable cache tanpa policy jelas,
- request/user context,
- tenant-specific configuration,
- authorization service yang perlu mocking,
- transaction boundary,
- feature flag yang berubah dinamis,
- HTTP client dengan credential berbeda per tenant,
- logger audit yang butuh correlation context,
- object yang lifecycle-nya dikelola container.

Red flag:

```text
“Kita buat singleton saja supaya gampang dipanggil dari mana-mana.”
```

Itu biasanya bukan desain. Itu bypass terhadap dependency management.

---

## 5. Basic Singleton Implementations di Java

### 5.1 Eager Singleton

```java
public final class EagerConfig {
    private static final EagerConfig INSTANCE = new EagerConfig();

    private EagerConfig() {
    }

    public static EagerConfig getInstance() {
        return INSTANCE;
    }
}
```

Kelebihan:

- sederhana,
- thread-safe karena class initialization JVM,
- tidak butuh synchronization,
- mudah dipahami.

Kekurangan:

- instance dibuat saat class diinisialisasi,
- tidak cocok bila pembuatan mahal,
- sulit menangani failure initialization,
- tidak bisa menerima parameter runtime secara bersih,
- global access tetap bermasalah.

Gunakan bila:

- object ringan,
- stateless/immutable,
- tidak butuh konfigurasi runtime kompleks,
- tidak butuh reset.

Jangan gunakan bila:

- memulai network connection,
- membuka file,
- membaca secret,
- membuat thread pool,
- melakukan database call,
- perlu graceful shutdown.

### 5.2 Lazy Synchronized Singleton

```java
public final class SynchronizedSingleton {
    private static SynchronizedSingleton instance;

    private SynchronizedSingleton() {
    }

    public static synchronized SynchronizedSingleton getInstance() {
        if (instance == null) {
            instance = new SynchronizedSingleton();
        }
        return instance;
    }
}
```

Kelebihan:

- lazy,
- thread-safe,
- mudah dipahami.

Kekurangan:

- synchronization setiap access,
- tidak optimal bila access sangat sering,
- masih global,
- construction failure handling buruk.

Di banyak aplikasi modern, overhead synchronized mungkin tidak signifikan dibanding I/O. Tetapi jika ini dipanggil sangat sering di hot path, lebih baik gunakan eager atau lazy holder.

### 5.3 Double-Checked Locking

```java
public final class DoubleCheckedSingleton {
    private static volatile DoubleCheckedSingleton instance;

    private DoubleCheckedSingleton() {
    }

    public static DoubleCheckedSingleton getInstance() {
        DoubleCheckedSingleton local = instance;
        if (local == null) {
            synchronized (DoubleCheckedSingleton.class) {
                local = instance;
                if (local == null) {
                    local = new DoubleCheckedSingleton();
                    instance = local;
                }
            }
        }
        return local;
    }
}
```

`volatile` penting untuk safe publication dan mencegah visibility problem.

Kelebihan:

- lazy,
- synchronization hanya saat initialization,
- performant setelah initialized.

Kekurangan:

- lebih kompleks,
- mudah salah bila `volatile` hilang,
- tidak menyelesaikan global access problem,
- masih lemah untuk construction failure,
- sering overkill.

Gunakan hanya bila benar-benar butuh lazy + performant + tidak memakai DI container.

### 5.4 Initialization-on-Demand Holder Idiom

```java
public final class LazyHolderSingleton {
    private LazyHolderSingleton() {
    }

    private static final class Holder {
        private static final LazyHolderSingleton INSTANCE = new LazyHolderSingleton();
    }

    public static LazyHolderSingleton getInstance() {
        return Holder.INSTANCE;
    }
}
```

Kelebihan:

- lazy,
- thread-safe,
- tidak butuh synchronized di access path,
- memanfaatkan class initialization JVM.

Kekurangan:

- tidak bisa menerima parameter constructor runtime,
- failure saat initialization bisa membuat class initialization gagal,
- tetap global access,
- tidak cocok untuk resource lifecycle kompleks.

Idiom ini memanfaatkan aturan class initialization JVM yang memberikan thread-safety untuk static field initialization. Namun construction failure tetap harus dipikirkan. Jika instance gagal dibuat, sistem bisa masuk ke mode error yang sulit dipulihkan.

### 5.5 Enum Singleton

```java
public enum EnumSingleton {
    INSTANCE;

    public void execute() {
        // behavior
    }
}
```

Kelebihan:

- sederhana,
- aman terhadap serialization secara natural,
- enum constants tidak bisa di-clone,
- JVM menjamin enum constant uniqueness dalam classloader,
- sering dianggap bentuk paling aman untuk singleton murni.

Oracle Java API menjelaskan bahwa enum class mendapat special handling dalam serialization, dan `Enum.clone()` final untuk menjaga status singleton enum constants. Ini alasan enum sering direkomendasikan untuk singleton sederhana yang benar-benar global dalam satu classloader. [Oracle Enum API](https://docs.oracle.com/en/java/javase/23/docs/api/java.base/java/lang/Enum.html), [Oracle Java Tutorial Enum Types](https://docs.oracle.com/javase/tutorial/java/javaOO/enum.html)

Kekurangan:

- tidak cocok bila perlu inheritance class,
- tidak cocok untuk lazy initialization parameterized,
- tidak cocok untuk container-managed lifecycle,
- tidak cocok bila perlu reset test,
- tetap global access.

Contoh aman:

```java
public enum SlugNormalizer {
    INSTANCE;

    public String normalize(String input) {
        return input == null
                ? ""
                : input.trim().toLowerCase(Locale.ROOT).replace(' ', '-');
    }
}
```

Contoh berbahaya:

```java
public enum PaymentGatewayClient {
    INSTANCE;

    private final HttpClient client = HttpClient.newHttpClient();
    private String accessToken;

    public PaymentResponse pay(PaymentRequest request) {
        // mutable auth state, external call, hidden dependency
        return null;
    }
}
```

Enum singleton bukan solusi untuk semua. Ia hanya menyelesaikan beberapa masalah teknis Singleton, bukan masalah desain global dependency.

---

## 6. Singleton Scope vs DI Container Singleton Scope

Dalam Spring/Jakarta/CDI, “singleton” sering berarti:

```text
Satu bean instance per application context/container.
```

Ini berbeda dengan Singleton Pattern klasik.

### 6.1 Singleton Pattern

```java
public final class GlobalAuditSink {
    private static final GlobalAuditSink INSTANCE = new GlobalAuditSink();

    public static GlobalAuditSink getInstance() {
        return INSTANCE;
    }
}
```

Ciri:

- class mengontrol lifecycle sendiri,
- class menyediakan global access,
- dependency tersembunyi,
- sulit diganti.

### 6.2 DI Singleton Scope

```java
@Service
public class AuditSink {
    private final AuditRepository repository;

    public AuditSink(AuditRepository repository) {
        this.repository = repository;
    }
}
```

Ciri:

- container mengontrol lifecycle,
- dependency eksplisit di constructor,
- instance dapat diganti di test/profile,
- lifecycle hooks bisa dikelola,
- graph bisa dianalisis.

### 6.3 Mana yang Lebih Baik?

Untuk enterprise application, biasanya lebih baik:

```text
Gunakan DI singleton scope untuk service/resource yang shared,
bukan Singleton Pattern dengan static global access.
```

Alasannya:

- dependency terlihat,
- test lebih mudah,
- lifecycle jelas,
- configuration terpusat,
- observability lebih mudah,
- shutdown bisa dikontrol,
- profile/environment override lebih mudah.

Tetapi DI singleton pun bisa menjadi anti-pattern bila semua hal dibuat singleton mutable dan saling bergantung tanpa boundary jelas.

---

## 7. Global State: Masalah yang Lebih Besar daripada Singleton

Singleton sering dikritik karena global state.

Tetapi tidak semua Singleton punya state, dan tidak semua global state berbentuk Singleton.

Contoh global state tersembunyi:

```java
public final class CurrentUser {
    private static final ThreadLocal<User> USER = new ThreadLocal<>();

    public static User get() {
        return USER.get();
    }

    public static void set(User user) {
        USER.set(user);
    }
}
```

Contoh lain:

```java
public final class AppFlags {
    public static boolean ENABLE_NEW_APPROVAL_FLOW = false;
}
```

Atau:

```java
public final class Jsons {
    public static final ObjectMapper MAPPER = new ObjectMapper();
}
```

Bahkan `static final` bisa bermasalah bila object-nya mutable:

```java
public final class GlobalCache {
    public static final Map<String, Object> CACHE = new HashMap<>();
}
```

`final` hanya membuat reference tidak bisa diganti. Isi object tetap bisa berubah.

### 7.1 Jenis Global State

| Jenis | Contoh | Risiko |
|---|---|---|
| Immutable global constant | `static final int MAX = 10` | rendah |
| Stateless global utility | `Math.max()` | rendah |
| Mutable static field | `static Map cache` | tinggi |
| ThreadLocal global | security/user context | leakage |
| Container singleton mutable | service dengan mutable field | race condition |
| External singleton resource | connection pool | lifecycle/shutdown |
| Distributed singleton | leader election | split-brain |

### 7.2 Pertanyaan Design Review

Saat menemukan global state, tanya:

1. Apakah state immutable?
2. Apakah state thread-safe?
3. Apakah state request-specific?
4. Apakah state tenant-specific?
5. Apakah state bisa berubah saat runtime?
6. Apakah test bisa mengisolasi state ini?
7. Apakah ada cleanup?
8. Apakah lifecycle-nya jelas?
9. Apakah dependency-nya terlihat?
10. Apakah production issue bisa menelusuri perubahan state?

---

## 8. Singleton dan Thread Safety

### 8.1 Singleton Instance Thread-Safe Tidak Berarti Behavior Thread-Safe

Ini kesalahan umum.

Class bisa memiliki instance creation yang thread-safe, tetapi method-nya tidak thread-safe.

```java
public final class UnsafeCounter {
    private static final UnsafeCounter INSTANCE = new UnsafeCounter();

    private int count;

    private UnsafeCounter() {
    }

    public static UnsafeCounter getInstance() {
        return INSTANCE;
    }

    public void increment() {
        count++;
    }

    public int getCount() {
        return count;
    }
}
```

Instance-nya hanya satu dan aman dibuat. Tetapi `count++` tidak atomic.

Singleton thread-safety memiliki dua level:

1. safe initialization,
2. safe use.

Banyak diskusi Singleton hanya membahas level pertama.

Senior engineer selalu memeriksa level kedua.

### 8.2 Thread-Safe Singleton dengan Immutable State

```java
public final class CountryRules {
    private static final CountryRules INSTANCE = new CountryRules(
            Map.of(
                    "SG", new RuleSet("Singapore"),
                    "ID", new RuleSet("Indonesia")
            )
    );

    private final Map<String, RuleSet> rules;

    private CountryRules(Map<String, RuleSet> rules) {
        this.rules = Map.copyOf(rules);
    }

    public static CountryRules getInstance() {
        return INSTANCE;
    }

    public Optional<RuleSet> find(String countryCode) {
        return Optional.ofNullable(rules.get(countryCode));
    }
}
```

Lebih aman karena:

- state final,
- defensive copy,
- tidak ada mutation setelah construction,
- behavior read-only.

### 8.3 Thread-Safe Singleton dengan Mutable State

Jika harus mutable, gunakan ownership dan concurrency policy jelas.

```java
public final class FeatureFlagSnapshot {
    private final AtomicReference<Map<String, Boolean>> flags =
            new AtomicReference<>(Map.of());

    public boolean isEnabled(String key) {
        return flags.get().getOrDefault(key, false);
    }

    public void replaceAll(Map<String, Boolean> newFlags) {
        flags.set(Map.copyOf(newFlags));
    }
}
```

Ini bukan “mutate map”, tetapi replace snapshot.

Lebih mudah reasoning:

- read lock-free,
- writer mengganti snapshot,
- tidak ada partial update terlihat pembaca,
- state version bisa ditambahkan.

### 8.4 Anti-Pattern: Mutable Field di Singleton Service

```java
public class ApprovalService {
    private ApprovalRequest currentRequest;

    public ApprovalResult approve(ApprovalRequest request) {
        this.currentRequest = request;
        validate();
        decide();
        return buildResult();
    }
}
```

Jika service ini singleton bean di Spring/CDI, field `currentRequest` shared antar request.

Failure mode:

- request A menulis `currentRequest`,
- request B menimpa,
- request A lanjut memakai data request B,
- audit salah,
- decision salah,
- bug intermittent.

Rule penting:

```text
Singleton service tidak boleh menyimpan request-specific mutable state di instance field.
```

Gunakan local variable, immutable command object, atau request-scoped component.

---

## 9. Singleton dan ClassLoader

Java static field terikat ke class yang dimuat oleh classloader tertentu.

Artinya:

```text
Satu static singleton per classloader.
```

Dalam aplikasi biasa, ini jarang terlihat. Dalam enterprise runtime, ini penting.

Contoh context:

- servlet container,
- application server,
- OSGi,
- plugin architecture,
- IDE plugin,
- test runner,
- hot reload,
- multiple WAR deployment,
- custom classloader,
- Java module runtime.

### 9.1 Failure Mode: Duplicate Singleton

Jika class yang sama dimuat oleh dua classloader berbeda, static singleton-nya berbeda.

```text
ClassLoader A -> MyRegistry.INSTANCE
ClassLoader B -> MyRegistry.INSTANCE
```

Secara nama class sama, tetapi di JVM dianggap tipe berbeda bila classloader berbeda.

### 9.2 Failure Mode: ClassLoader Leak

Static singleton bisa menahan reference ke object dari application classloader.

Misal:

```java
public final class GlobalCallbacks {
    private static final List<Runnable> CALLBACKS = new ArrayList<>();

    public static void register(Runnable callback) {
        CALLBACKS.add(callback);
    }
}
```

Jika callback berasal dari application deployment lama dan static holder berada di parent classloader, redeploy bisa gagal melepas classloader lama.

Akibat:

- memory leak,
- class metadata leak,
- old version code masih tertahan,
- redeploy makin berat.

### 9.3 Rule untuk Runtime Modular

Jika menjalankan environment modular/plugin/app server:

1. Hindari static registry lintas plugin tanpa unregister.
2. Pastikan lifecycle unregister saat stop.
3. Hindari menyimpan application object di parent static singleton.
4. Gunakan weak reference hanya jika semantics-nya benar, bukan sebagai magic fix.
5. Prefer container/plugin lifecycle manager.
6. Audit classloader ownership.

---

## 10. Singleton dan Serialization / Reflection

### 10.1 Serialization Problem

Singleton berbasis class biasa bisa rusak oleh deserialization jika tidak hati-hati.

```java
public final class SerializableSingleton implements Serializable {
    private static final SerializableSingleton INSTANCE = new SerializableSingleton();

    private SerializableSingleton() {
    }

    public static SerializableSingleton getInstance() {
        return INSTANCE;
    }
}
```

Deserialization bisa membuat instance baru kecuali menggunakan `readResolve()`.

```java
private Object readResolve() {
    return INSTANCE;
}
```

Enum singleton punya special serialization handling, sehingga lebih aman untuk kasus singleton murni.

### 10.2 Reflection Problem

Private constructor bisa dipanggil dengan reflection jika access dibuka.

```java
Constructor<MySingleton> constructor = MySingleton.class.getDeclaredConstructor();
constructor.setAccessible(true);
MySingleton another = constructor.newInstance();
```

Mitigasi:

- enum singleton,
- module encapsulation,
- security policy/runtime restriction,
- constructor guard,
- jangan mengandalkan Singleton untuk security boundary.

Constructor guard:

```java
public final class GuardedSingleton {
    private static boolean created;

    private GuardedSingleton() {
        if (created) {
            throw new IllegalStateException("Already created");
        }
        created = true;
    }
}
```

Tetapi guard seperti ini sendiri punya concurrency/reflection caveat dan tidak sekuat enum.

Rule:

```text
Jangan memakai Singleton sebagai mekanisme keamanan.
```

---

## 11. Singleton dan Resource Lifecycle

Banyak Singleton memegang resource:

- thread pool,
- scheduler,
- HTTP client,
- database pool,
- file handle,
- socket,
- native memory,
- cache,
- metrics exporter,
- message producer.

Jika resource butuh close/shutdown, Singleton harus punya lifecycle model.

### 11.1 Bad Example

```java
public final class GlobalExecutor {
    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(20);

    public static ExecutorService get() {
        return EXECUTOR;
    }
}
```

Masalah:

- siapa shutdown?
- kapan shutdown?
- apa nama thread-nya?
- bagaimana metrics queue?
- bagaimana rejection policy?
- bagaimana test mengganti executor?
- bagaimana graceful shutdown saat deployment?

### 11.2 Better: Managed Resource

```java
public final class ApplicationExecutors implements AutoCloseable {
    private final ExecutorService backgroundExecutor;

    public ApplicationExecutors(ExecutorService backgroundExecutor) {
        this.backgroundExecutor = backgroundExecutor;
    }

    public ExecutorService backgroundExecutor() {
        return backgroundExecutor;
    }

    @Override
    public void close() {
        backgroundExecutor.shutdown();
    }
}
```

Dikelola oleh container:

```java
@Bean(destroyMethod = "close")
ApplicationExecutors applicationExecutors() {
    return new ApplicationExecutors(
            Executors.newFixedThreadPool(20)
    );
}
```

Atau di Jakarta/CDI dengan lifecycle hook.

### 11.3 Lifecycle Checklist

Untuk singleton resource, dokumentasikan:

1. Creation time.
2. Owner.
3. Dependency.
4. Health check.
5. Metrics.
6. Shutdown behavior.
7. Reconfiguration strategy.
8. Failure strategy.
9. Test override strategy.
10. Scope.

---

## 12. Multiton Pattern

### 12.1 Intent

Multiton adalah generalisasi Singleton: satu instance per key.

```text
Singleton: one instance.
Multiton: one instance per key.
```

Contoh:

- one client per tenant,
- one formatter per locale,
- one handler per module,
- one connection pool per datasource name,
- one policy engine per jurisdiction,
- one cache per cache name,
- one processor per event type,
- one strategy per channel.

### 12.2 Simple Multiton

```java
public final class TenantClientRegistry {
    private static final ConcurrentMap<TenantId, TenantClient> CLIENTS = new ConcurrentHashMap<>();

    private TenantClientRegistry() {
    }

    public static TenantClient get(TenantId tenantId) {
        return CLIENTS.computeIfAbsent(tenantId, TenantClient::new);
    }
}
```

Terlihat mudah, tetapi penuh risiko.

### 12.3 Failure Mode Multiton

#### 12.3.1 Unbounded Growth

Jika key tidak terbatas:

```java
CLIENTS.computeIfAbsent(userInput, this::create);
```

Map bisa tumbuh tanpa batas.

Risiko:

- memory leak,
- tenant offboarding tidak membersihkan instance,
- key typo membuat instance baru,
- attack vector jika key dari input publik.

#### 12.3.2 No Lifecycle per Key

Jika `TenantClient` memegang connection/resource, siapa close saat tenant disabled?

#### 12.3.3 Key Equality Bug

```java
record TenantId(String value) {}
```

Bagus. Tetapi kalau pakai raw string:

```java
get("TenantA")
get("tenanta")
get("TENANT_A")
```

Bisa menciptakan instance berbeda untuk tenant yang sama.

#### 12.3.4 computeIfAbsent Hazard

`computeIfAbsent` pada `ConcurrentHashMap` aman untuk atomic map update, tetapi function creation harus tidak memiliki side effect berbahaya bila terjadi retry/exception. Jangan melakukan operasi berat yang tidak idempotent tanpa desain.

#### 12.3.5 Mutable Shared Instance per Key

Satu client per tenant masih bisa punya mutable token/cache/rate limit. Harus thread-safe.

### 12.4 Better Multiton: Explicit Registry Object

Daripada static global multiton:

```java
public final class TenantClientRegistry implements AutoCloseable {
    private final ConcurrentMap<TenantId, TenantClient> clients = new ConcurrentHashMap<>();
    private final TenantClientFactory factory;

    public TenantClientRegistry(TenantClientFactory factory) {
        this.factory = factory;
    }

    public TenantClient get(TenantId tenantId) {
        return clients.computeIfAbsent(tenantId, factory::create);
    }

    public void remove(TenantId tenantId) {
        TenantClient client = clients.remove(tenantId);
        if (client != null) {
            client.close();
        }
    }

    @Override
    public void close() {
        clients.values().forEach(TenantClient::close);
        clients.clear();
    }
}
```

Lebih baik karena:

- registry bisa diinjeksi,
- lifecycle jelas,
- test bisa membuat registry baru,
- remove per key tersedia,
- close semua tersedia,
- factory dependency eksplisit.

### 12.5 Multiton vs Cache

Multiton sering disalahgunakan sebagai cache.

Bedanya:

| Aspek | Multiton | Cache |
|---|---|---|
| Tujuan | Identity per key | Performance reuse |
| Eviction | Biasanya tidak | Biasanya iya |
| Lifecycle | Penting | Penting tapi berbeda |
| Key cardinality | Harus terkendali | Bisa besar tapi dibatasi |
| Object meaning | instance canonical | computed value |

Jika butuh TTL, max size, eviction, stats, invalidation, itu lebih cocok disebut cache, bukan Multiton sederhana.

---

## 13. Registry Pattern

### 13.1 Intent

Registry adalah objek yang menyimpan dan menyediakan akses ke sekumpulan object/service/provider berdasarkan key, type, atau capability.

Registry menjawab pertanyaan:

```text
Untuk tipe/kondisi ini, handler/provider mana yang tersedia?
```

Contoh:

- `Map<EventType, EventHandler>`
- `Map<String, PaymentProvider>`
- `Map<ModuleName, ModuleDescriptor>`
- `List<PolicyRule>`
- `Map<DocumentType, DocumentRenderer>`
- `Map<Class<?>, Serializer<?>>`
- `ServiceLoader` provider list

### 13.2 Registry vs Singleton

Singleton fokus pada satu instance.

Registry fokus pada katalog.

Registry bisa singleton-scoped, tetapi tidak harus static Singleton.

```java
public final class HandlerRegistry {
    private final Map<EventType, EventHandler> handlers;

    public HandlerRegistry(List<EventHandler> handlers) {
        this.handlers = handlers.stream()
                .collect(Collectors.toUnmodifiableMap(
                        EventHandler::eventType,
                        Function.identity()
                ));
    }

    public EventHandler handlerFor(EventType eventType) {
        EventHandler handler = handlers.get(eventType);
        if (handler == null) {
            throw new NoSuchElementException("No handler for event type: " + eventType);
        }
        return handler;
    }
}
```

### 13.3 Registry sebagai Explicit Extension Point

Registry baik bila:

- jumlah handler bisa bertambah,
- selection berbasis key jelas,
- caller tidak perlu tahu semua implementasi,
- registration dilakukan saat startup,
- conflict detection jelas,
- missing handler error jelas.

Contoh:

```java
public interface CaseActionHandler {
    CaseAction action();
    CaseResult handle(CaseCommand command);
}

public final class CaseActionRegistry {
    private final Map<CaseAction, CaseActionHandler> handlers;

    public CaseActionRegistry(List<CaseActionHandler> handlers) {
        Map<CaseAction, CaseActionHandler> index = new EnumMap<>(CaseAction.class);
        for (CaseActionHandler handler : handlers) {
            CaseAction key = handler.action();
            if (index.put(key, handler) != null) {
                throw new IllegalStateException("Duplicate handler for " + key);
            }
        }
        this.handlers = Collections.unmodifiableMap(index);
    }

    public CaseActionHandler require(CaseAction action) {
        CaseActionHandler handler = handlers.get(action);
        if (handler == null) {
            throw new IllegalArgumentException("Unsupported action: " + action);
        }
        return handler;
    }
}
```

### 13.4 Registry Design Rules

Registry yang baik:

1. Immutable setelah startup, kecuali memang dynamic plugin system.
2. Key type kuat, bukan raw string jika bisa.
3. Mendeteksi duplicate registration.
4. Mendeteksi missing required handler.
5. Memberi error yang eksplisit.
6. Tidak membuat instance sendiri kecuali memang factory registry.
7. Tidak menyembunyikan dependency penting.
8. Memiliki observability: daftar handler aktif bisa dilihat.
9. Memiliki test untuk completeness.
10. Tidak menjadi tempat dumping semua object.

### 13.5 Registry Anti-Pattern

#### 13.5.1 Global Mutable Registry

```java
public final class GlobalRegistry {
    private static final Map<String, Object> SERVICES = new HashMap<>();

    public static void register(String name, Object service) {
        SERVICES.put(name, service);
    }

    public static Object get(String name) {
        return SERVICES.get(name);
    }
}
```

Masalah:

- tidak type-safe,
- mutable global state,
- test saling bocor,
- no lifecycle,
- no duplicate policy,
- no ownership,
- runtime order dependency,
- error terjadi jauh dari registration.

#### 13.5.2 Registry sebagai Service Locator Terselubung

```java
public final class ApplicationRegistry {
    public Object getBean(String name) {
        // returns anything
    }
}
```

Jika semua class mengambil dependency dari registry ini, Registry berubah menjadi Service Locator anti-pattern.

---

## 14. Service Locator Pattern

### 14.1 Intent

Service Locator menyediakan central object untuk mendapatkan service/dependency.

```java
public final class ServiceLocator {
    private static final Map<Class<?>, Object> services = new ConcurrentHashMap<>();

    public static <T> void register(Class<T> type, T service) {
        services.put(type, service);
    }

    public static <T> T get(Class<T> type) {
        Object service = services.get(type);
        if (service == null) {
            throw new NoSuchElementException("No service registered: " + type.getName());
        }
        return type.cast(service);
    }
}
```

Usage:

```java
public final class CaseService {
    public void approve(CaseId id) {
        AuditSink auditSink = ServiceLocator.get(AuditSink.class);
        PolicyEvaluator evaluator = ServiceLocator.get(PolicyEvaluator.class);
    }
}
```

### 14.2 Kenapa Service Locator Menarik

Service Locator terasa menarik karena:

- caller tidak perlu constructor panjang,
- dependency bisa diambil kapan saja,
- gampang diintegrasikan dengan legacy code,
- terasa fleksibel,
- menghindari passing object ke banyak layer,
- bisa dipakai di framework/plugin runtime.

Tetapi kemudahan ini dibayar dengan hidden dependency.

Martin Fowler membahas Dependency Injection dan Service Locator sebagai dua cara composition/configuration service, dan menekankan isu lifecycle dan configuration sebagai bagian penting dari konteks ini. [Martin Fowler — Inversion of Control Containers and the Dependency Injection pattern](https://martinfowler.com/articles/injection.html)

### 14.3 Masalah Service Locator

#### 14.3.1 Hidden Dependency

Constructor tidak menunjukkan dependency.

```java
public CaseService() {
}
```

Tetapi method diam-diam butuh:

```java
ServiceLocator.get(AuditSink.class);
ServiceLocator.get(Clock.class);
ServiceLocator.get(PolicyEvaluator.class);
```

Akibatnya:

- sulit tahu apa yang dibutuhkan class,
- sulit membuat object valid,
- error runtime bukan compile-time,
- dependency graph tidak eksplisit.

#### 14.3.2 Runtime Failure

DI constructor gagal saat startup bila dependency tidak ada.

Service Locator sering gagal saat runtime path tertentu dijalankan.

```text
No service registered: PaymentGateway
```

Bug muncul saat user melakukan action tertentu, bukan saat aplikasi start.

#### 14.3.3 Test Isolation Problem

Test harus register global service.

```java
@BeforeEach
void setUp() {
    ServiceLocator.register(AuditSink.class, fakeAuditSink);
}

@AfterEach
void tearDown() {
    ServiceLocator.clear();
}
```

Jika lupa clear, test lain terkontaminasi.

#### 14.3.4 Dependency Direction Kabur

Service kelas domain bisa diam-diam mengambil infrastructure service.

```java
public final class SanctionDecision {
    public void calculate() {
        EmailSender sender = ServiceLocator.get(EmailSender.class);
    }
}
```

Ini melanggar boundary domain/infrastructure.

#### 14.3.5 Type Safety Terbatas

`Class<T>` membantu, tetapi tidak cukup untuk qualifier/named services/generic type.

```java
Repository<User> userRepository = ServiceLocator.get(Repository.class); // raw-ish ambiguity
```

Perlu key kompleks, qualifier, atau token type.

#### 14.3.6 Lifecycle Ambiguity

Siapa membuat service? Siapa close? Siapa reload? Siapa health check?

Service Locator sering menjadi mini-container yang buruk.

### 14.4 Service Locator vs Dependency Injection

| Aspek | Service Locator | Dependency Injection |
|---|---|---|
| Dependency visibility | tersembunyi | eksplisit |
| Failure time | runtime saat dipakai | startup/construction |
| Testability | perlu global setup | inject fake/mock |
| Dependency graph | sulit dilihat | bisa dianalisis |
| Boundary enforcement | lemah | lebih kuat |
| Legacy integration | mudah | perlu refactor |
| Framework internal | kadang valid | umum |

DI lebih baik untuk application code karena dependency menjadi bagian dari contract.

### 14.5 Kapan Service Locator Masih Bisa Diterima

Service Locator tidak selalu buruk. Ia bisa diterima dalam konteks sempit:

1. Framework internal.
2. Plugin runtime.
3. Legacy bridge sementara.
4. Dynamic service discovery di boundary tertentu.
5. Scripting/extension layer.
6. Test harness khusus.
7. Composition root yang tidak menyebar ke business logic.

Rule:

```text
Service Locator boleh berada di composition/infrastructure boundary,
tetapi jangan biarkan bocor ke domain/application logic.
```

### 14.6 Safer Service Locator: Narrow Interface

Buruk:

```java
Object get(String name);
<T> T get(Class<T> type);
```

Lebih baik:

```java
public interface PluginContext {
    Logger logger();
    Configuration configuration();
    MeterRegistry meters();
}
```

Atau:

```java
public interface HandlerLookup {
    CaseActionHandler handlerFor(CaseAction action);
}
```

Narrow locator lebih aman karena:

- capability terbatas,
- dependency lebih jelas,
- tidak menjadi god registry,
- bisa dimock mudah,
- tidak memberi akses ke semua service.

---

## 15. Service Locator vs Factory vs Registry vs Provider

Pattern ini sering tertukar.

### 15.1 Factory

Factory membuat object.

```java
PaymentClient create(TenantId tenantId);
```

Fokus:

- construction,
- parameter,
- selection,
- invariant.

### 15.2 Registry

Registry menyimpan/mencari object yang sudah tersedia.

```java
PaymentProvider providerFor(Channel channel);
```

Fokus:

- lookup,
- indexing,
- registration,
- extension.

### 15.3 Provider

Provider menunda/menyediakan instance.

```java
public interface Provider<T> {
    T get();
}
```

Fokus:

- lazy access,
- scope boundary,
- optional/dynamic dependency.

### 15.4 Service Locator

Service Locator menyediakan arbitrary dependency dari central place.

```java
<T> T get(Class<T> type);
```

Fokus:

- global/central access,
- dependency resolution.

### 15.5 Decision Table

| Kebutuhan | Pattern yang lebih cocok |
|---|---|
| Membuat object baru dengan parameter | Factory |
| Memilih handler dari key | Registry |
| Menunda akses dependency | Provider |
| Mencari service secara dynamic di framework/plugin | Service Locator terbatas |
| Sharing one instance app-wide | DI singleton scope |
| Sharing one instance per key | Multiton/registry/cache dengan lifecycle |
| Menghindari constructor panjang | Bukan Service Locator dulu; periksa responsibility split |

---

## 16. Global Context, ThreadLocal, Scoped Values

Banyak Java framework memakai context global:

- security context,
- transaction context,
- request context,
- MDC/logging context,
- locale context,
- tenant context,
- correlation context.

Biasanya implementasi lama memakai `ThreadLocal`.

### 16.1 ThreadLocal Context

```java
public final class TenantContext {
    private static final ThreadLocal<TenantId> CURRENT = new ThreadLocal<>();

    public static void set(TenantId tenantId) {
        CURRENT.set(tenantId);
    }

    public static TenantId getRequired() {
        TenantId tenantId = CURRENT.get();
        if (tenantId == null) {
            throw new IllegalStateException("No tenant in context");
        }
        return tenantId;
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Masalah:

- wajib clear,
- bisa leak antar request pada thread pool,
- context propagation async sulit,
- dengan virtual threads, asumsi lama tentang thread reuse berubah,
- debugging sulit.

### 16.2 Safe ThreadLocal Usage

Gunakan try/finally:

```java
public void handle(Request request) {
    TenantContext.set(request.tenantId());
    try {
        process(request);
    } finally {
        TenantContext.clear();
    }
}
```

Jangan:

```java
TenantContext.set(request.tenantId());
process(request); // if exception, leak
TenantContext.clear();
```

### 16.3 Scoped Values Java Modern

Java modern memperkenalkan `ScopedValue` sebagai mekanisme context sharing yang lebih terstruktur untuk beberapa kasus. Scoped values membuat value tersedia selama dynamic scope tertentu, dan membantu menghindari sebagian risiko mutable thread-local style context. Java 25 memasukkan Scoped Values sebagai bagian penting dari evolusi platform. [Oracle JDK 25 significant changes](https://docs.oracle.com/en/java/javase/25/migrate/significant-changes-jdk-25.html)

Mental model:

```text
ThreadLocal = mutable slot attached to thread.
ScopedValue = value bound for lexical/dynamic scope.
```

Dalam desain pattern, ini mengubah cara kita berpikir tentang “global request context”.

Tetapi rule tetap:

```text
Context implicit harus dibatasi untuk technical context,
bukan menggantikan explicit business dependency.
```

Technical context yang mungkin valid:

- correlation id,
- trace id,
- security principal read-only,
- locale,
- request deadline,
- tenant id di infrastructure boundary.

Business data yang sebaiknya eksplisit:

- case id,
- approval command,
- sanction decision,
- document payload,
- payment amount,
- workflow transition.

---

## 17. Static Utility Class vs Singleton

Static utility class bukan Singleton, tetapi sering punya masalah serupa.

### 17.1 Valid Static Utility

```java
public final class CaseNumbers {
    private CaseNumbers() {
    }

    public static boolean isValid(String value) {
        return value != null && value.matches("CASE-[0-9]{8}");
    }
}
```

Cocok bila:

- pure function,
- stateless,
- deterministic,
- no external dependency,
- no hidden I/O,
- no configuration.

### 17.2 Bad Static Utility

```java
public final class CaseUtils {
    public static boolean canApprove(Case c) {
        RoleService roleService = ServiceLocator.get(RoleService.class);
        Config config = GlobalConfig.getInstance();
        return roleService.hasRole("APPROVER") && config.isEnabled("approval");
    }
}
```

Ini bukan utility. Ini business service tersembunyi.

Rule:

```text
Static utility boleh untuk pure deterministic operation.
Jangan pakai static utility untuk business rule yang butuh dependency, state, I/O, atau policy.
```

---

## 18. Singleton in Spring/Jakarta/CDI-heavy Codebase

### 18.1 Common Bug: Mutable Singleton Bean

```java
@Service
public class ReportGenerationService {
    private ReportRequest current;

    public Report generate(ReportRequest request) {
        this.current = request;
        validateCurrent();
        return renderCurrent();
    }
}
```

Karena service singleton by default, ini race condition.

Better:

```java
@Service
public class ReportGenerationService {
    public Report generate(ReportRequest request) {
        validate(request);
        return render(request);
    }
}
```

State request harus local variable atau immutable helper object.

### 18.2 Constructor Injection Better Than Static Access

```java
@Service
public class CaseApprovalService {
    private final Clock clock;
    private final PolicyEvaluator policyEvaluator;
    private final AuditSink auditSink;

    public CaseApprovalService(
            Clock clock,
            PolicyEvaluator policyEvaluator,
            AuditSink auditSink
    ) {
        this.clock = clock;
        this.policyEvaluator = policyEvaluator;
        this.auditSink = auditSink;
    }
}
```

Keuntungan:

- dependency jelas,
- test mudah,
- startup validation,
- container lifecycle,
- no hidden global lookup.

### 18.3 Constructor Terlalu Panjang?

Jangan otomatis pindah ke Service Locator.

Constructor panjang bisa berarti:

1. class punya terlalu banyak responsibility,
2. dependency perlu dikelompokkan ke domain component,
3. ada missing abstraction,
4. service melakukan orchestration terlalu banyak,
5. use case perlu dipisah.

Bad response:

```java
public CaseService() {
    this.deps = ServiceLocator.get(Everything.class);
}
```

Better response:

- split service,
- group cohesive dependencies,
- introduce policy object,
- introduce command handler,
- introduce gateway/facade,
- introduce application service boundary.

---

## 19. Hidden Singleton in Libraries and Frameworks

Beberapa library memakai global/static access untuk convenience:

- logging factory,
- driver manager,
- system properties,
- default charset/timezone,
- security manager legacy,
- global object mapper helper,
- default locale,
- random generator.

### 19.1 System Properties as Global State

```java
String env = System.getProperty("app.env");
```

Risiko:

- global mutable,
- test interference,
- runtime mutation unexpected,
- dependency tersembunyi.

Better:

```java
public record AppConfig(String environment) {}
```

Read once at boundary, pass/inject config.

### 19.2 Default TimeZone/Locale

```java
LocalDate.now();
String.format("%,d", value);
```

Bisa tergantung default timezone/locale.

Better:

```java
LocalDate.now(clock);
String.format(Locale.ROOT, "%,d", value);
```

### 19.3 ObjectMapper Singleton

`ObjectMapper` biasanya reusable dan thread-safe setelah configuration selesai. Tetapi global mutable configuration berbahaya.

Bad:

```java
public final class Json {
    public static final ObjectMapper MAPPER = new ObjectMapper();
}
```

Siapa pun bisa mengubah config:

```java
Json.MAPPER.registerModule(new DangerousModule());
```

Better:

```java
public final class JsonCodec {
    private final ObjectMapper mapper;

    public JsonCodec(ObjectMapper mapper) {
        this.mapper = mapper.copy();
    }
}
```

Atau expose only behavior:

```java
public interface JsonSerializer {
    String serialize(Object value);
    <T> T deserialize(String json, Class<T> type);
}
```

---

## 20. Anti-Pattern Catalog

### 20.1 Singleton Everything

Gejala:

- hampir semua service punya `getInstance()`.
- object dibuat global agar mudah dipanggil.
- tidak ada DI.
- test banyak setup static.

Konsekuensi:

- dependency graph invisible,
- hard testing,
- hidden coupling,
- race condition,
- lifecycle chaos.

Refactoring:

1. Pilih satu singleton paling bermasalah.
2. Buat interface dependency.
3. Tambahkan constructor injection ke consumer baru.
4. Buat adapter sementara yang masih mengambil singleton.
5. Pindahkan caller bertahap.
6. Deprecate `getInstance()`.
7. Hapus static setelah usage hilang.

### 20.2 Hidden Global Dependency

```java
public void approve(CaseId id) {
    AuditSink.getInstance().write(...);
}
```

Masalah:

- method terlihat hanya butuh `CaseId`, tetapi sebenarnya butuh audit infrastructure.

Refactoring:

```java
public final class ApprovalService {
    private final AuditSink auditSink;

    public ApprovalService(AuditSink auditSink) {
        this.auditSink = auditSink;
    }
}
```

### 20.3 Static Utility God Object

```java
CaseUtils.validate();
CaseUtils.approve();
CaseUtils.sendEmail();
CaseUtils.audit();
CaseUtils.calculateFee();
```

Masalah:

- utility menjadi dumping ground,
- business logic tidak punya owner,
- dependency tersembunyi,
- tidak polymorphic.

Refactoring:

- pure function tetap utility,
- business policy menjadi policy object,
- external call menjadi gateway,
- orchestration menjadi application service.

### 20.4 Mutable Singleton Bean

```java
@Service
class MyService {
    private String currentUser;
}
```

Masalah:

- shared mutable request state.

Refactoring:

- local variable,
- request object,
- request-scoped bean bila perlu,
- explicit context parameter.

### 20.5 Registry as Garbage Bin

```java
registry.put("anything", object);
```

Masalah:

- no type safety,
- no ownership,
- no boundary.

Refactoring:

- typed registry,
- explicit key type,
- narrow interface,
- immutable startup registration.

### 20.6 Service Locator Disguised as DI

```java
@Component
class MyService {
    @Autowired ApplicationContext context;

    void run() {
        PaymentGateway gateway = context.getBean(PaymentGateway.class);
    }
}
```

Masalah:

- container menjadi Service Locator,
- hidden dependency,
- runtime lookup,
- poor testability.

Refactoring:

```java
@Component
class MyService {
    private final PaymentGateway gateway;

    MyService(PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

### 20.7 ThreadLocal Context Abuse

```java
CaseContext.getCurrentCaseId();
```

Masalah:

- business data implicit,
- async propagation problem,
- leak risk.

Refactoring:

```java
process(caseId, command, actor);
```

Use context only for technical metadata.

### 20.8 Multiton Without Eviction

```java
static Map<String, Client> clients = new ConcurrentHashMap<>();
```

Masalah:

- unbounded growth,
- no close,
- no tenant offboarding.

Refactoring:

- managed registry,
- remove/close per key,
- bounded cache if appropriate,
- metrics per key cardinality.

### 20.9 Static Config That Changes Runtime

```java
public static boolean NEW_FLOW_ENABLED;
```

Masalah:

- race visibility,
- no audit of changes,
- no version,
- test interference.

Refactoring:

- immutable config snapshot,
- atomic reference,
- feature flag service,
- evented config reload.

---

## 21. Refactoring Path: From Global Singleton to Explicit Dependency

### 21.1 Starting Point

```java
public final class AuditManager {
    private static final AuditManager INSTANCE = new AuditManager();

    private AuditManager() {
    }

    public static AuditManager getInstance() {
        return INSTANCE;
    }

    public void record(String action, String entityId) {
        // write audit
    }
}

public final class CaseApprovalService {
    public void approve(String caseId) {
        // business logic
        AuditManager.getInstance().record("APPROVE", caseId);
    }
}
```

### 21.2 Step 1: Introduce Interface

```java
public interface AuditSink {
    void record(AuditEvent event);
}
```

### 21.3 Step 2: Adapter Around Existing Singleton

```java
public final class SingletonAuditSink implements AuditSink {
    @Override
    public void record(AuditEvent event) {
        AuditManager.getInstance().record(event.action(), event.entityId());
    }
}
```

### 21.4 Step 3: Inject Dependency

```java
public final class CaseApprovalService {
    private final AuditSink auditSink;

    public CaseApprovalService(AuditSink auditSink) {
        this.auditSink = auditSink;
    }

    public void approve(String caseId) {
        auditSink.record(new AuditEvent("APPROVE", caseId));
    }
}
```

### 21.5 Step 4: Update Composition Root

```java
AuditSink auditSink = new SingletonAuditSink();
CaseApprovalService service = new CaseApprovalService(auditSink);
```

Dalam DI container:

```java
@Bean
AuditSink auditSink() {
    return new DatabaseAuditSink(...);
}
```

### 21.6 Step 5: Remove Singleton Usage from Business Code

Cari usage:

```text
AuditManager.getInstance()
```

Ganti bertahap dengan `AuditSink`.

### 21.7 Step 6: Deprecate Singleton Access

```java
@Deprecated(forRemoval = true)
public static AuditManager getInstance() {
    return INSTANCE;
}
```

### 21.8 Step 7: Delete Singleton

Setelah tidak ada usage, lifecycle pindah ke container/composition root.

---

## 22. Testing Strategy

### 22.1 Testing Singleton Itself

Test aspek:

1. Same instance returned.
2. Thread-safe initialization.
3. State immutable/thread-safe.
4. Serialization behavior jika relevant.
5. Lifecycle close jika ada.
6. Construction failure behavior.

Contoh simple:

```java
@Test
void returnsSameInstance() {
    assertSame(MySingleton.getInstance(), MySingleton.getInstance());
}
```

Tetapi test ini kurang bernilai jika tidak menguji behavior nyata.

### 22.2 Testing Consumer of Singleton

Consumer yang mengambil singleton langsung sulit dites.

Bad:

```java
@Test
void approveWritesAudit() {
    CaseApprovalService service = new CaseApprovalService();
    service.approve("C-1");
    // how to observe AuditManager?
}
```

Better:

```java
@Test
void approveWritesAudit() {
    FakeAuditSink audit = new FakeAuditSink();
    CaseApprovalService service = new CaseApprovalService(audit);

    service.approve("C-1");

    assertEquals(List.of(new AuditEvent("APPROVE", "C-1")), audit.events());
}
```

### 22.3 Testing Registry Completeness

```java
@Test
void allCaseActionsHaveHandlers() {
    CaseActionRegistry registry = new CaseActionRegistry(List.of(
            new ApproveHandler(),
            new RejectHandler(),
            new EscalateHandler()
    ));

    for (CaseAction action : CaseAction.values()) {
        assertNotNull(registry.require(action));
    }
}
```

### 22.4 Testing Duplicate Registration

```java
@Test
void duplicateHandlerFailsFast() {
    assertThrows(IllegalStateException.class, () ->
            new CaseActionRegistry(List.of(
                    new ApproveHandler(),
                    new AnotherApproveHandler()
            ))
    );
}
```

### 22.5 Testing ThreadLocal Cleanup

```java
@Test
void tenantContextIsClearedAfterRequest() {
    RequestHandler handler = new RequestHandler();

    handler.handle(new Request(new TenantId("A")));

    assertThrows(IllegalStateException.class, TenantContext::getRequired);
}
```

### 22.6 Parallel Test Warning

Global state breaks parallel tests.

Jika test memakai:

- static config,
- static registry,
- singleton mutable object,
- system properties,
- default timezone,
- default locale,

maka parallel test bisa flakey.

Mitigasi:

- avoid global state,
- isolate via dependency injection,
- reset in `@AfterEach`,
- disable parallel for affected tests,
- use per-test object graph,
- avoid static mutation.

---

## 23. Observability and Debugging Angle

Singleton/global state sering sulit didebug karena perubahan state tidak lewat boundary eksplisit.

### 23.1 What to Expose

Untuk singleton/registry/resource manager, expose:

1. lifecycle status,
2. initialization timestamp,
3. config version,
4. current key count,
5. known handlers/providers,
6. last refresh time,
7. failure count,
8. active resources,
9. shutdown status,
10. owner/component name.

### 23.2 Registry Diagnostics

```java
public final class HandlerRegistryDiagnostics {
    private final Set<String> registeredHandlers;

    public HandlerRegistryDiagnostics(HandlerRegistry registry) {
        this.registeredHandlers = registry.keys().stream()
                .map(Object::toString)
                .collect(Collectors.toUnmodifiableSet());
    }

    public Set<String> registeredHandlers() {
        return registeredHandlers;
    }
}
```

### 23.3 Metrics

Useful metrics:

```text
registry.handlers.count
registry.lookup.missing.count
registry.lookup.duplicate.count
multiton.instances.count
multiton.instance.created.count
multiton.instance.removed.count
singleton.initialization.failure.count
context.threadlocal.leak.detected.count
```

### 23.4 Logs

Log at startup:

```text
CaseActionRegistry initialized: handlers=[APPROVE, REJECT, ESCALATE]
TenantClientRegistry initialized: mode=lazy, maxTenants=100
FeatureFlagSnapshot loaded: version=2026-06-18T09:15:00Z, count=42
```

Do not log sensitive config values.

### 23.5 Debugging Questions

Saat production issue diduga akibat global state:

1. Apakah state berubah sebelum issue?
2. Siapa yang bisa menulis state?
3. Apakah state shared antar request/tenant?
4. Apakah ada race condition?
5. Apakah ada reload partial?
6. Apakah ada test/prod difference?
7. Apakah context bocor antar thread?
8. Apakah ada duplicate singleton karena classloader?
9. Apakah ada resource yang tidak shutdown?
10. Apakah key multiton bertambah terus?

---

## 24. Java 8–25 Perspective

### 24.1 Java 8

Relevant features:

- lambda,
- functional interface,
- `ConcurrentHashMap.computeIfAbsent`,
- `Optional`,
- `CompletableFuture`,
- default methods.

Impact:

- Strategy/Provider sering lebih ringan.
- Registry bisa menyimpan function.
- Multiton sering memakai `computeIfAbsent`.
- Async membuat ThreadLocal context propagation lebih sulit.

Example registry with functions:

```java
public final class FormatterRegistry {
    private final Map<DocumentType, Function<Document, String>> formatters;

    public FormatterRegistry(Map<DocumentType, Function<Document, String>> formatters) {
        this.formatters = Map.copyOf(formatters);
    }

    public String format(DocumentType type, Document document) {
        Function<Document, String> formatter = formatters.get(type);
        if (formatter == null) {
            throw new IllegalArgumentException("Unsupported document type: " + type);
        }
        return formatter.apply(document);
    }
}
```

### 24.2 Java 9 Modules

JPMS memperkuat encapsulation.

Impact:

- reflection access ke private constructor lebih dibatasi jika module tidak membuka package,
- internal singleton bisa disembunyikan,
- service provider interface lebih formal dengan `uses`/`provides`,
- module boundary membantu menghindari global registry liar.

### 24.3 Java 10 `var`

`var` bisa memperjelas atau menyembunyikan type.

Bad with Service Locator:

```java
var service = ServiceLocator.get(SomeType.class);
```

Masih jelas jika method typed. Tetapi jika locator generic/stringly:

```java
var service = registry.get("payment");
```

Type ambiguity meningkat.

### 24.4 Java 14–17 Records

Records membantu key type:

```java
public record TenantId(String value) {
    public TenantId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("tenant id is required");
        }
        value = value.trim().toLowerCase(Locale.ROOT);
    }
}
```

Ini bagus untuk Multiton/Registry karena menghindari raw string key.

### 24.5 Java 17 Sealed Classes

Sealed hierarchy bisa mengurangi registry berbasis runtime string bila set tipe tertutup.

```java
public sealed interface NotificationChannel permits EmailChannel, SmsChannel, InboxChannel {
}
```

Jika semua channel diketahui compile-time, registry dynamic mungkin tidak perlu.

### 24.6 Java 21 Virtual Threads

Virtual threads mengubah cost model thread, tetapi tidak menghapus global state problem.

Perhatian:

- ThreadLocal per virtual thread mungkin membuat banyak value jika digunakan berlebihan.
- Long-lived ThreadLocal assumptions berubah.
- Jangan memakai ThreadLocal sebagai business state.
- Executor singleton lama mungkin tidak lagi ideal; task-per-request virtual thread bisa lebih sederhana.

### 24.7 Java 25 Structured Concurrency and Scoped Values

Structured concurrency membantu lifecycle task menjadi eksplisit: parent task mengelola child tasks, cancellation, dan failure propagation. Scoped values membantu context passing yang lebih terstruktur daripada mutable ThreadLocal untuk banyak kasus modern. Ini memengaruhi pattern global context dan executor singleton. [Oracle JDK 25 significant changes](https://docs.oracle.com/en/java/javase/25/migrate/significant-changes-jdk-25.html)

Design implication:

```text
Daripada global executor + hidden threadlocal context,
prefer structured task scope + explicit/scoped context.
```

---

## 25. Design Decision Framework

Gunakan pertanyaan ini sebelum membuat Singleton/Multiton/Registry/Service Locator.

### 25.1 Singleton Decision

```text
1. Apa yang harus unik?
2. Dalam scope apa uniknya?
3. Apakah uniqueness ini domain invariant atau implementation convenience?
4. Apakah object stateless/immutable?
5. Apakah object thread-safe saat digunakan?
6. Apakah object memegang resource?
7. Siapa shutdown?
8. Apakah test perlu mengganti instance?
9. Apakah dependency consumer harus eksplisit?
10. Apakah DI singleton scope cukup?
```

Jika jawaban “hanya supaya gampang dipanggil”, jangan pakai Singleton.

### 25.2 Multiton Decision

```text
1. Key-nya apa?
2. Apakah key type kuat?
3. Apakah cardinality key terbatas?
4. Apakah instance perlu close?
5. Apakah perlu eviction?
6. Apakah creation idempotent?
7. Apakah duplicate key normalized?
8. Apakah ada metrics instance count?
9. Apakah tenant/user input bisa membuat key baru liar?
10. Apakah ini sebenarnya cache?
```

### 25.3 Registry Decision

```text
1. Apa extension point-nya?
2. Siapa yang register?
3. Kapan registration terjadi?
4. Apakah registry immutable setelah startup?
5. Bagaimana duplicate handler ditangani?
6. Bagaimana missing handler ditangani?
7. Apakah key type-safe?
8. Apakah registry terlalu generic?
9. Apakah registry bocor ke domain logic?
10. Apakah registry observable?
```

### 25.4 Service Locator Decision

```text
1. Kenapa dependency tidak bisa diinjeksi?
2. Apakah ini framework/plugin boundary?
3. Apakah interface locator narrow?
4. Apakah business logic akan memanggil locator?
5. Apakah failure bisa dideteksi saat startup?
6. Apakah test bisa isolate?
7. Apakah lifecycle jelas?
8. Apakah dependency graph masih bisa dipahami?
9. Apakah ini solusi sementara untuk legacy?
10. Apa rencana keluar dari locator?
```

---

## 26. Real Enterprise Case Study: Case Workflow Handler Registry

### 26.1 Problem

Sistem case management punya banyak action:

- submit,
- assign,
- approve,
- reject,
- escalate,
- request information,
- close,
- reopen.

Versi awal:

```java
public class CaseActionService {
    public void execute(CaseAction action, CaseCommand command) {
        if (action == CaseAction.SUBMIT) {
            submit(command);
        } else if (action == CaseAction.ASSIGN) {
            assign(command);
        } else if (action == CaseAction.APPROVE) {
            approve(command);
        } else if (action == CaseAction.REJECT) {
            reject(command);
        } else {
            throw new IllegalArgumentException("Unsupported action");
        }
    }
}
```

Masalah:

- class tumbuh terus,
- test sulit,
- action baru rawan conflict,
- audit/authorization/validation bercampur,
- no explicit extension point.

### 26.2 Bad Refactor: Global Service Locator

```java
public class CaseActionService {
    public void execute(CaseAction action, CaseCommand command) {
        CaseActionHandler handler = ServiceLocator.get(action.name());
        handler.handle(command);
    }
}
```

Lebih pendek, tetapi:

- no type safety,
- hidden global dependency,
- runtime missing handler,
- no duplicate detection,
- no startup validation.

### 26.3 Better Refactor: Typed Registry

```java
public interface CaseActionHandler {
    CaseAction action();
    CaseResult handle(CaseCommand command);
}
```

```java
public final class CaseActionRegistry {
    private final Map<CaseAction, CaseActionHandler> handlers;

    public CaseActionRegistry(Collection<CaseActionHandler> handlers) {
        EnumMap<CaseAction, CaseActionHandler> index = new EnumMap<>(CaseAction.class);
        for (CaseActionHandler handler : handlers) {
            CaseAction action = handler.action();
            CaseActionHandler previous = index.put(action, handler);
            if (previous != null) {
                throw new IllegalStateException("Duplicate handler for action: " + action);
            }
        }
        this.handlers = Collections.unmodifiableMap(index);
    }

    public CaseActionHandler require(CaseAction action) {
        CaseActionHandler handler = handlers.get(action);
        if (handler == null) {
            throw new IllegalArgumentException("No handler registered for action: " + action);
        }
        return handler;
    }

    public Set<CaseAction> supportedActions() {
        return handlers.keySet();
    }
}
```

```java
public final class CaseActionApplicationService {
    private final CaseActionRegistry registry;
    private final AuditSink auditSink;

    public CaseActionApplicationService(CaseActionRegistry registry, AuditSink auditSink) {
        this.registry = registry;
        this.auditSink = auditSink;
    }

    public CaseResult execute(CaseAction action, CaseCommand command) {
        CaseActionHandler handler = registry.require(action);
        CaseResult result = handler.handle(command);
        auditSink.record(AuditEvent.caseAction(action, command.caseId(), result.status()));
        return result;
    }
}
```

Keuntungan:

- dependency eksplisit,
- handler lookup terpusat,
- key typed,
- duplicate detected saat startup,
- missing handler jelas,
- registry bisa diobservasi,
- test mudah.

### 26.4 Staff-Level Improvement

Tambahkan startup completeness test:

```java
public void validateCompleteness(Set<CaseAction> requiredActions) {
    Set<CaseAction> missing = EnumSet.copyOf(requiredActions);
    missing.removeAll(handlers.keySet());
    if (!missing.isEmpty()) {
        throw new IllegalStateException("Missing handlers: " + missing);
    }
}
```

Tambahkan diagnostics endpoint:

```json
{
  "registry": "caseActionRegistry",
  "handlers": ["SUBMIT", "ASSIGN", "APPROVE", "REJECT"],
  "count": 4
}
```

---

## 27. Real Enterprise Case Study: Tenant Client Multiton

### 27.1 Problem

Sistem multi-tenant perlu client eksternal per tenant karena credential berbeda.

Bad:

```java
public final class ExternalClientHolder {
    private static final Map<String, ExternalClient> CLIENTS = new ConcurrentHashMap<>();

    public static ExternalClient get(String tenant) {
        return CLIENTS.computeIfAbsent(tenant, t -> new ExternalClient(loadSecret(t)));
    }
}
```

Masalah:

- raw string tenant,
- unbounded map,
- secret loading hidden,
- no close,
- no metrics,
- no tenant removal,
- no test isolation,
- no validation.

### 27.2 Better

```java
public record TenantId(String value) {
    public TenantId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("tenant id is required");
        }
        value = value.trim().toLowerCase(Locale.ROOT);
    }
}
```

```java
public interface TenantSecretProvider {
    TenantSecret load(TenantId tenantId);
}
```

```java
public final class TenantExternalClientRegistry implements AutoCloseable {
    private final ConcurrentMap<TenantId, ExternalClient> clients = new ConcurrentHashMap<>();
    private final TenantSecretProvider secretProvider;
    private final ExternalClientFactory clientFactory;

    public TenantExternalClientRegistry(
            TenantSecretProvider secretProvider,
            ExternalClientFactory clientFactory
    ) {
        this.secretProvider = secretProvider;
        this.clientFactory = clientFactory;
    }

    public ExternalClient require(TenantId tenantId) {
        return clients.computeIfAbsent(tenantId, this::createClient);
    }

    private ExternalClient createClient(TenantId tenantId) {
        TenantSecret secret = secretProvider.load(tenantId);
        return clientFactory.create(tenantId, secret);
    }

    public void remove(TenantId tenantId) {
        ExternalClient client = clients.remove(tenantId);
        if (client != null) {
            client.close();
        }
    }

    public int size() {
        return clients.size();
    }

    @Override
    public void close() {
        clients.values().forEach(ExternalClient::close);
        clients.clear();
    }
}
```

Design improvement:

- tenant id normalized,
- dependency explicit,
- lifecycle explicit,
- no static global,
- registry injectable,
- testable,
- observable.

---

## 28. Common Interview / Staff-Level Discussion

### Q1: Is Singleton an anti-pattern?

Jawaban senior:

```text
Singleton as controlled single instance is not inherently bad.
The problematic part is usually global access and mutable global state.
In modern Java enterprise applications, DI singleton scope is usually preferable to static Singleton pattern because it keeps dependencies explicit and lifecycle container-managed.
```

### Q2: Enum singleton or lazy holder?

Use enum singleton when:

- singleton is simple,
- no parameterized lazy init,
- no container lifecycle,
- serialization safety matters,
- no inheritance needed.

Use lazy holder when:

- need lazy initialization,
- class-based singleton,
- no constructor parameters,
- construction failure understood.

Use DI when:

- service has dependencies,
- lifecycle matters,
- test override matters,
- configuration matters.

### Q3: Why is Service Locator worse than DI?

Because Service Locator hides dependencies inside implementation. DI exposes dependencies in constructor, making object validity, tests, dependency graph, and startup failure clearer.

### Q4: When is Service Locator acceptable?

In narrow infrastructure/framework/plugin boundary where dynamic lookup is core to the runtime, and where the locator interface is constrained, observable, and does not leak into domain/application logic.

### Q5: What is the biggest risk of static Singleton in app server?

Classloader leaks, duplicate singleton per classloader, lifecycle ambiguity, and stale references after redeployment.

### Q6: Is Spring singleton bean thread-safe?

No. Spring singleton scope means one bean instance per container. It does not make the object’s mutable state thread-safe.

### Q7: What is better than global ThreadLocal context?

Prefer explicit parameters for business data. For technical request context, use framework-managed context carefully, always clean up, and consider structured/scoped context mechanisms in modern Java where appropriate.

---

## 29. Design Review Checklist

### Singleton Checklist

- [ ] Is single instance truly required?
- [ ] Is scope explicitly defined?
- [ ] Is state immutable or thread-safe?
- [ ] Is dependency visible?
- [ ] Is lifecycle owner clear?
- [ ] Is shutdown/close handled?
- [ ] Is configuration reload handled?
- [ ] Is test override possible?
- [ ] Is classloader behavior acceptable?
- [ ] Is serialization/reflection relevant?
- [ ] Is DI singleton scope better?

### Multiton Checklist

- [ ] Is key type-safe?
- [ ] Is key normalized?
- [ ] Is cardinality bounded?
- [ ] Is instance creation idempotent?
- [ ] Is removal supported?
- [ ] Is close supported?
- [ ] Is metrics exposed?
- [ ] Is eviction needed?
- [ ] Is this actually a cache?
- [ ] Is static global avoided?

### Registry Checklist

- [ ] Is registry typed?
- [ ] Is registration lifecycle clear?
- [ ] Are duplicate registrations rejected?
- [ ] Are missing handlers detected early?
- [ ] Is registry immutable after startup?
- [ ] Is key not stringly typed unless necessary?
- [ ] Is diagnostics available?
- [ ] Is registry not a garbage bin?
- [ ] Is Service Locator behavior avoided?

### Service Locator Checklist

- [ ] Why not constructor injection?
- [ ] Is this infrastructure/framework boundary?
- [ ] Is interface narrow?
- [ ] Is business logic protected from locator?
- [ ] Is dependency graph still understandable?
- [ ] Are failures detected early?
- [ ] Is test isolation possible?
- [ ] Is lifecycle clear?
- [ ] Is there an exit plan if this is legacy bridge?

### Global State Checklist

- [ ] Is state mutable?
- [ ] Is mutation synchronized or atomic?
- [ ] Is state request/tenant/user-specific?
- [ ] Is cleanup required?
- [ ] Can tests run in parallel?
- [ ] Are changes auditable?
- [ ] Is default timezone/locale/system property involved?
- [ ] Is context propagation safe across async boundaries?

---

## 30. Summary

Singleton, Multiton, Registry, dan Service Locator adalah pattern yang berkaitan dengan sharing, lifecycle, lookup, dan global access.

Pelajaran terpenting:

```text
Singleton bukan sekadar satu instance.
Singleton adalah keputusan ownership dan lifecycle.
```

```text
Masalah terbesar Singleton bukan instance tunggal,
tetapi dependency tersembunyi dan mutable global state.
```

```text
DI singleton scope biasanya lebih aman daripada static Singleton pattern
untuk enterprise Java application.
```

```text
Registry bagus jika typed, bounded, observable, dan immutable setelah startup.
Registry buruk jika menjadi global garbage bin.
```

```text
Service Locator bisa berguna di framework/plugin boundary,
tetapi berbahaya jika masuk ke business logic.
```

```text
Multiton harus punya key discipline, lifecycle, removal, observability,
dan batas cardinality.
```

```text
Global state harus diperlakukan sebagai shared mutable resource,
bukan convenience shortcut.
```

Top engineer tidak bertanya:

```text
Bagaimana cara membuat singleton?
```

Mereka bertanya:

```text
Apa scope uniqueness-nya?
Apa lifecycle-nya?
Apa state-nya?
Apa dependency yang disembunyikan?
Apa failure mode-nya?
Apa cara test dan observability-nya?
Apa rencana keluar jika global state menjadi design debt?
```

---

## 31. Kapan Memakai Apa?

Ringkasan praktis:

| Situasi | Pilihan |
|---|---|
| Pure stateless helper | static utility |
| Simple singleton constant-like behavior | enum singleton |
| Lazy singleton tanpa dependency | lazy holder |
| Shared app service dengan dependency | DI singleton scope |
| One instance per key dengan lifecycle | managed multiton registry |
| Handler lookup by type/action | typed registry |
| Plugin/framework dynamic lookup | narrow service locator |
| Request technical context | managed context / scoped value / careful ThreadLocal |
| Business data context | explicit parameter/object |
| Mutable shared state | avoid, or design concurrency/ownership explicitly |

---

## 32. Latihan Praktis

### Latihan 1: Audit Singleton Usage

Cari di codebase:

```text
getInstance()
static final .* INSTANCE
ApplicationContext.getBean
ServiceLocator.get
ThreadLocal
static Map
static List
static ObjectMapper
System.getProperty
TimeZone.setDefault
Locale.setDefault
```

Untuk setiap temuan, jawab:

1. Apa scope-nya?
2. Apakah state mutable?
3. Siapa owner lifecycle?
4. Apakah dependency tersembunyi?
5. Apakah test bisa isolate?
6. Apakah bisa diganti dengan DI/registry/context eksplisit?

### Latihan 2: Refactor Static Singleton

Ambil satu Singleton service bisnis dan ubah menjadi:

1. interface,
2. implementation,
3. constructor injection,
4. adapter sementara,
5. test dengan fake dependency.

### Latihan 3: Build Typed Registry

Buat registry untuk:

```text
CaseAction -> CaseActionHandler
```

Syarat:

- duplicate handler fail fast,
- missing handler jelas,
- immutable setelah construction,
- diagnostics list handler,
- test completeness.

### Latihan 4: Multiton with Lifecycle

Buat `TenantClientRegistry`:

- key pakai record `TenantId`,
- normalize key,
- lazy create,
- remove per tenant,
- close all,
- expose size metric,
- no static global.

### Latihan 5: ThreadLocal Cleanup

Buat request context dengan `try/finally`, lalu tulis test yang memastikan context clear setelah exception.

---

## 33. Mini Pattern Decision Record Template

Gunakan template ini bila tim ingin membuat shared/global component.

```markdown
# Pattern Decision Record: <Component Name>

## Context
Komponen apa yang ingin dibuat shared/global?

## Scope
Satu instance dalam scope apa?
- JVM?
- Application context?
- Tenant?
- Request?
- ClassLoader?

## Forces
- Performance?
- Lifecycle?
- Testability?
- Configuration?
- Thread safety?
- Observability?
- Runtime reload?

## Decision
Pattern yang dipilih:
- DI singleton scope
- enum singleton
- lazy holder
- typed registry
- managed multiton
- narrow service locator
- other

## Why
Kenapa pattern ini lebih cocok daripada alternatif?

## Consequences
Positive:
- ...

Negative:
- ...

## Failure Modes
- ...

## Lifecycle
- Created by:
- Closed by:
- Reloaded by:

## Testing Strategy
- ...

## Observability
- Metrics:
- Logs:
- Diagnostics:

## Exit Strategy
Jika desain ini menjadi masalah, bagaimana refactoring path-nya?
```

---

## 34. Penutup Part 6

Part ini menutup kelompok creational/global-lifecycle pattern.

Kita sudah membahas bahwa object creation bukan hanya tentang membuat object, tetapi tentang:

- identity,
- scope,
- ownership,
- lifecycle,
- dependency visibility,
- thread safety,
- testability,
- observability,
- failure recovery.

Selanjutnya kita masuk ke structural pattern yang sangat sering dipakai dalam enterprise integration dan legacy modernization:

```text
07-structural-adapter-facade-gateway-anti-corruption-layer.md
```

Status:

```text
Part 6 dari 35 selesai.
Seri belum selesai.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./05-creational-abstract-factory-builder-prototype-object-mother.md">⬅️ Part 5 — Creational Pattern II: Abstract Factory, Builder, Prototype, Object Mother</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./07-structural-adapter-facade-gateway-anti-corruption-layer.md">Structural Pattern I: Adapter, Facade, Gateway, Anti-Corruption Layer ➡️</a>
</div>

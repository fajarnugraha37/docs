# Part 8 — Structural Pattern II: Decorator, Proxy, Interceptor, Middleware Chain

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> File: `08-structural-decorator-proxy-interceptor-middleware-chain.md`  
> Target: Java 8 hingga Java 25  
> Level: Advanced / Staff-level engineering judgment

---

## 0. Posisi Materi Ini dalam Seri

Pada Part 7, kita membahas **Adapter, Facade, Gateway, dan Anti-Corruption Layer** sebagai pola untuk melindungi boundary antara sistem internal dan dunia eksternal.

Pada Part 8 ini, kita masuk ke keluarga structural pattern yang sangat sering muncul di Java enterprise:

1. **Decorator** — menambah perilaku tanpa mengubah object asli.
2. **Proxy** — mengontrol akses ke object asli.
3. **Interceptor** — menyisipkan logic sebelum/sesudah eksekusi.
4. **Middleware Chain** — menyusun beberapa behavior menjadi pipeline.

Keempatnya sering terlihat mirip karena sama-sama “membungkus” operasi. Perbedaannya ada pada **intent**:

```text
Decorator    -> memperkaya behavior object.
Proxy        -> mengontrol akses ke object.
Interceptor  -> menyisipkan cross-cutting behavior di join point.
Middleware   -> menyusun request/operation melalui chain berurutan.
```

Materi ini penting karena banyak framework Java modern memakai pattern ini secara masif:

- Java IO/NIO wrappers
- Servlet filters
- JAX-RS filters/interceptors
- Spring AOP proxy
- CDI interceptors
- Jakarta Interceptors
- Hibernate lazy proxy
- HTTP client interceptors
- gRPC interceptors
- security filters
- retry/resilience decorators
- metrics/tracing instrumentation
- transaction proxy
- cache proxy

Namun pola ini juga sangat mudah berubah menjadi anti-pattern:

- terlalu banyak layer tidak terlihat
- stack trace sulit dipahami
- urutan interceptor tidak jelas
- annotation magic
- side effect tersembunyi
- behavior runtime berbeda dari source code yang terlihat
- debugging production menjadi lambat
- test menjadi rapuh karena logic berada di proxy/framework

Tujuan bagian ini adalah membangun kemampuan untuk membaca dan mendesain layer pembungkus secara sadar.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan Decorator, Proxy, Interceptor, dan Middleware Chain berdasarkan intent, bukan bentuk kode.
2. Mendesain wrapper behavior yang eksplisit, testable, dan tidak menyembunyikan invariant penting.
3. Memahami kenapa Java IO adalah contoh klasik Decorator.
4. Memahami kapan memakai composition, kapan memakai proxy, dan kapan memakai framework interceptor.
5. Mendesain cross-cutting concern seperti logging, metrics, retry, auth, rate limiting, transaction, dan cache dengan urutan yang benar.
6. Menghindari proxy invisibility dan annotation magic abuse.
7. Membaca stack trace dan behavior runtime pada sistem Java berbasis Spring/CDI/Jakarta.
8. Menentukan boundary observability untuk layer-layer yang tidak terlihat langsung.
9. Membuat desain middleware chain yang deterministic, debuggable, dan aman dari hidden side effect.
10. Melakukan refactoring dari service method penuh boilerplate menuju decorator/interceptor yang lebih bersih.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan sebuah service operation seperti ini:

```java
public DecisionResult approveApplication(ApproveApplicationCommand command) {
    long start = System.nanoTime();
    log.info("approveApplication started commandId={}", command.commandId());

    try {
        if (!securityService.canApprove(currentUser(), command.applicationId())) {
            audit.warn("Unauthorized approval attempt");
            throw new ForbiddenException();
        }

        rateLimiter.check("approveApplication");

        return retry.execute(() -> transactionTemplate.execute(status -> {
            Application application = repository.findById(command.applicationId())
                .orElseThrow(ApplicationNotFoundException::new);

            application.approve(command.reason());
            repository.save(application);
            eventPublisher.publish(new ApplicationApproved(application.id()));
            return DecisionResult.approved(application.id());
        }));
    } catch (Exception ex) {
        metrics.increment("approveApplication.failure");
        log.error("approveApplication failed", ex);
        throw ex;
    } finally {
        metrics.timing("approveApplication.latency", System.nanoTime() - start);
    }
}
```

Masalahnya bukan hanya panjang. Masalah desainnya:

1. Business logic bercampur dengan logging.
2. Authorization bercampur dengan transaction.
3. Retry wrapping transaction atau transaction wrapping retry tidak jelas.
4. Metrics tersebar di banyak method.
5. Audit bisa lupa ditambahkan di operation lain.
6. Error handling tidak konsisten.
7. Method sulit dites karena terlalu banyak concern.
8. Jika urutan berubah, semantic bisa berubah drastis.

Kita butuh cara untuk memisahkan concern tanpa kehilangan kendali.

Decorator, Proxy, Interceptor, dan Middleware Chain adalah beberapa mekanisme untuk itu.

---

## 3. Mental Model Utama

### 3.1 Object Asli vs Behavior Tambahan

Mulai dari konsep paling sederhana:

```text
Client -> Target
```

Lalu kita ingin menambah behavior:

```text
Client -> Wrapper -> Target
```

Jika behavior tambahan banyak:

```text
Client -> Wrapper A -> Wrapper B -> Wrapper C -> Target
```

Contoh:

```text
Client
  -> MetricsDecorator
  -> LoggingDecorator
  -> RetryDecorator
  -> AuthorizationDecorator
  -> RealApplicationService
```

Pertanyaan engineering-nya:

1. Apakah client sadar sedang memakai wrapper?
2. Apakah wrapper memiliki interface yang sama dengan target?
3. Apakah wrapper hanya menambah behavior atau mengontrol akses?
4. Apakah wrapper dibuat manual atau otomatis oleh framework?
5. Apakah urutannya deterministic?
6. Apakah side effect-nya terlihat?
7. Apakah test dapat memverifikasi behavior wrapper?
8. Apakah failure di wrapper dapat diobservasi?

Pattern ini bukan tentang “membungkus object”. Pattern ini tentang **mengelola behavior tambahan tanpa merusak core behavior**.

---

### 3.2 Structural Pattern yang Paling Sering Salah Dipahami

Banyak engineer menyamakan semua ini sebagai “wrapper”. Secara bentuk memang mirip, tetapi secara intent berbeda.

| Pattern | Pertanyaan Utama | Intent |
|---|---|---|
| Decorator | “Bagaimana menambah kemampuan?” | Enrich behavior |
| Proxy | “Bagaimana mengontrol akses?” | Access control / indirection |
| Interceptor | “Bagaimana menyisipkan logic pada join point?” | Around behavior |
| Middleware Chain | “Bagaimana request melewati pipeline?” | Ordered processing |

Contoh:

```text
CompressionDecorator
```

menambah kemampuan compression.

```text
AuthorizationProxy
```

mengontrol apakah target boleh diakses.

```text
TransactionInterceptor
```

menyisipkan begin/commit/rollback di sekitar method invocation.

```text
Servlet Filter Chain
```

menjalankan request melalui urutan filter.

---

### 3.3 Prinsip Staff-Level

Semakin banyak layer pembungkus, semakin penting tiga hal:

```text
ordering + visibility + ownership
```

1. **Ordering**  
   Apakah urutan layer jelas dan deterministic?

2. **Visibility**  
   Apakah developer bisa tahu behavior apa saja yang terjadi sebelum/sesudah target dipanggil?

3. **Ownership**  
   Siapa pemilik concern tersebut? Business service, infrastructure, framework, atau platform?

Jika tiga hal ini tidak jelas, pattern berubah menjadi magic.

---

## 4. Core Vocabulary

Sebelum masuk detail pattern, kita perlu menyamakan istilah.

### 4.1 Target

Object asli yang memiliki behavior utama.

```java
public interface PaymentService {
    PaymentResult pay(PaymentCommand command);
}
```

Target real:

```java
public final class RealPaymentService implements PaymentService {
    @Override
    public PaymentResult pay(PaymentCommand command) {
        // core business operation
        return PaymentResult.success(command.paymentId());
    }
}
```

---

### 4.2 Wrapper

Object yang membungkus target.

```java
public final class LoggingPaymentService implements PaymentService {
    private final PaymentService delegate;

    public LoggingPaymentService(PaymentService delegate) {
        this.delegate = delegate;
    }

    @Override
    public PaymentResult pay(PaymentCommand command) {
        System.out.println("Payment started: " + command.paymentId());
        try {
            return delegate.pay(command);
        } finally {
            System.out.println("Payment finished: " + command.paymentId());
        }
    }
}
```

---

### 4.3 Delegate

Object yang dipanggil oleh wrapper.

```text
LoggingPaymentService -> delegate -> RealPaymentService
```

---

### 4.4 Around Behavior

Logic yang berjalan sebelum dan sesudah target.

```java
before();
try {
    return target.call();
} finally {
    after();
}
```

---

### 4.5 Join Point

Titik eksekusi tempat interceptor/proxy bisa menyisipkan behavior.

Contoh join point:

- method call
- HTTP request
- message handling
- transaction boundary
- repository query
- controller invocation
- resource method invocation

---

### 4.6 Chain

Urutan wrapper/interceptor/filter yang saling meneruskan eksekusi.

```text
Filter A -> Filter B -> Filter C -> Handler
```

Dalam chain, setiap layer dapat:

1. lanjut ke layer berikutnya,
2. menghentikan proses,
3. mengubah request,
4. mengubah response,
5. menangani exception,
6. menambah side effect.

Inilah yang membuat chain powerful sekaligus berbahaya.

---

## 5. Decorator Pattern

### 5.1 Definisi

**Decorator** adalah pattern untuk menambah behavior ke object secara dinamis dengan membungkus object tersebut menggunakan object lain yang memiliki interface sama.

Bentuk dasar:

```text
Client -> Decorator -> Component
```

Decorator biasanya:

1. mengimplementasikan interface yang sama dengan target,
2. menyimpan reference ke target/delegate,
3. melakukan behavior tambahan sebelum/sesudah delegate dipanggil,
4. tetap mempertahankan contract interface.

---

### 5.2 Kapan Decorator Muncul Secara Natural

Decorator muncul ketika kita punya kebutuhan:

1. Menambah logging ke service tanpa mengubah service asli.
2. Menambah metrics ke repository tanpa mencampur query logic.
3. Menambah retry ke HTTP client.
4. Menambah cache ke expensive operation.
5. Menambah compression/encryption ke stream.
6. Menambah validation di boundary.
7. Menambah auditing di operation tertentu.

Pattern ini cocok ketika behavior tambahan bersifat:

```text
orthogonal + composable + optional
```

Artinya:

- bukan core responsibility target,
- bisa disusun dengan behavior lain,
- bisa aktif/nonaktif tergantung konfigurasi.

---

### 5.3 Contoh Paling Klasik: Java IO

Java IO sering dipakai sebagai contoh Decorator.

```java
InputStream input = new BufferedInputStream(
    new FileInputStream("data.txt")
);
```

Layer-nya:

```text
Client
  -> BufferedInputStream
  -> FileInputStream
```

`FileInputStream` membaca byte dari file.

`BufferedInputStream` menambah behavior buffering.

Keduanya adalah `InputStream`, sehingga client tetap melihat interface yang sama.

Contoh lain:

```java
try (InputStream input = new GZIPInputStream(
        new BufferedInputStream(
            new FileInputStream("data.gz")
        ))) {
    byte[] bytes = input.readAllBytes();
}
```

Layer:

```text
GZIPInputStream
  -> BufferedInputStream
  -> FileInputStream
```

Ini menunjukkan kekuatan Decorator:

```text
behavior tambahan bisa disusun tanpa subclass explosion
```

Tanpa Decorator, kita mungkin perlu class seperti:

```text
BufferedFileInputStream
GzipFileInputStream
BufferedGzipFileInputStream
EncryptedBufferedGzipFileInputStream
```

Itu combinatorial explosion.

---

### 5.4 Decorator Manual untuk Service

Misalnya kita punya service:

```java
public interface ApplicationApprovalService {
    ApprovalResult approve(ApproveApplicationCommand command);
}
```

Core implementation:

```java
public final class DefaultApplicationApprovalService implements ApplicationApprovalService {
    private final ApplicationRepository repository;
    private final ApprovalPolicy approvalPolicy;

    public DefaultApplicationApprovalService(
            ApplicationRepository repository,
            ApprovalPolicy approvalPolicy
    ) {
        this.repository = repository;
        this.approvalPolicy = approvalPolicy;
    }

    @Override
    public ApprovalResult approve(ApproveApplicationCommand command) {
        Application application = repository.findRequired(command.applicationId());
        approvalPolicy.ensureCanApprove(application, command.approverId());
        application.approve(command.reason());
        repository.save(application);
        return ApprovalResult.approved(application.id());
    }
}
```

Logging decorator:

```java
public final class LoggingApprovalService implements ApplicationApprovalService {
    private final ApplicationApprovalService delegate;
    private final Logger log;

    public LoggingApprovalService(ApplicationApprovalService delegate, Logger log) {
        this.delegate = delegate;
        this.log = log;
    }

    @Override
    public ApprovalResult approve(ApproveApplicationCommand command) {
        log.info("approval.start applicationId={} approverId={}",
            command.applicationId(), command.approverId());

        try {
            ApprovalResult result = delegate.approve(command);
            log.info("approval.success applicationId={} result={}",
                command.applicationId(), result.status());
            return result;
        } catch (RuntimeException ex) {
            log.warn("approval.failed applicationId={} errorType={}",
                command.applicationId(), ex.getClass().getSimpleName());
            throw ex;
        }
    }
}
```

Metrics decorator:

```java
public final class MetricsApprovalService implements ApplicationApprovalService {
    private final ApplicationApprovalService delegate;
    private final MetricsRecorder metrics;

    public MetricsApprovalService(ApplicationApprovalService delegate, MetricsRecorder metrics) {
        this.delegate = delegate;
        this.metrics = metrics;
    }

    @Override
    public ApprovalResult approve(ApproveApplicationCommand command) {
        long start = System.nanoTime();
        try {
            ApprovalResult result = delegate.approve(command);
            metrics.increment("approval.success");
            return result;
        } catch (RuntimeException ex) {
            metrics.increment("approval.failure", "exception", ex.getClass().getSimpleName());
            throw ex;
        } finally {
            metrics.timing("approval.latency", System.nanoTime() - start);
        }
    }
}
```

Composition:

```java
ApplicationApprovalService service =
    new MetricsApprovalService(
        new LoggingApprovalService(
            new DefaultApplicationApprovalService(repository, approvalPolicy),
            log
        ),
        metrics
    );
```

Layer:

```text
Client
  -> MetricsApprovalService
  -> LoggingApprovalService
  -> DefaultApplicationApprovalService
```

---

### 5.5 Apa yang Membuat Decorator Baik

Decorator yang baik:

1. menjaga contract interface,
2. tidak mengubah semantic utama secara mengejutkan,
3. memiliki satu concern jelas,
4. urutannya dapat dipahami,
5. error handling-nya eksplisit,
6. tidak menyembunyikan dependency kritikal,
7. bisa dites sendiri,
8. tidak membuat stack trace tak terbaca,
9. tidak menyimpan state mutable yang tidak aman,
10. tidak membuat lifecycle delegate ambigu.

---

### 5.6 Decorator vs Inheritance

Inheritance:

```java
class AuditedApprovalService extends DefaultApplicationApprovalService { }
```

Masalah:

1. subclass terikat pada implementation detail parent,
2. kombinasi behavior menyebabkan subclass explosion,
3. runtime composition sulit,
4. ordering behavior sulit diatur,
5. fragile base class risk.

Decorator:

```java
new AuditedApprovalService(new DefaultApplicationApprovalService(...))
```

Kelebihan:

1. composition over inheritance,
2. behavior bisa disusun,
3. lebih testable,
4. bisa diaktifkan lewat konfigurasi,
5. target tidak perlu tahu decorator.

---

### 5.7 Functional Decorator dengan Java 8+

Java 8 membuat decorator lebih ringan untuk functional interface.

Misalnya:

```java
@FunctionalInterface
public interface Operation<T, R> {
    R execute(T input);
}
```

Decorator function:

```java
public static <T, R> Operation<T, R> withLogging(
        Operation<T, R> operation,
        Logger log
) {
    return input -> {
        log.info("operation.start input={}", input);
        try {
            R result = operation.execute(input);
            log.info("operation.success");
            return result;
        } catch (RuntimeException ex) {
            log.warn("operation.failure errorType={}", ex.getClass().getSimpleName());
            throw ex;
        }
    };
}
```

Usage:

```java
Operation<ApproveApplicationCommand, ApprovalResult> approve = command -> {
    Application application = repository.findRequired(command.applicationId());
    application.approve(command.reason());
    repository.save(application);
    return ApprovalResult.approved(application.id());
};

Operation<ApproveApplicationCommand, ApprovalResult> decorated =
    withLogging(approve, log);
```

Dengan composition:

```java
Operation<ApproveApplicationCommand, ApprovalResult> decorated =
    withMetrics(
        withLogging(
            withRetry(approve, retryPolicy),
            log
        ),
        metrics
    );
```

Ini powerful, tetapi bisa menjadi sulit dibaca jika terlalu banyak nested function.

Alternatif lebih readable:

```java
Operation<ApproveApplicationCommand, ApprovalResult> decorated = approve;
decorated = withRetry(decorated, retryPolicy);
decorated = withLogging(decorated, log);
decorated = withMetrics(decorated, metrics);
```

---

### 5.8 Decorator Ordering Problem

Urutan decorator bukan detail kecil. Urutan mengubah semantic.

Contoh:

```text
Metrics -> Retry -> RealService
```

Metrics mengukur seluruh retry cycle.

```text
Retry -> Metrics -> RealService
```

Metrics mengukur setiap attempt.

Keduanya valid, tetapi menjawab pertanyaan berbeda.

Contoh lain:

```text
Authorization -> Cache -> RealService
```

Authorization dilakukan sebelum membaca cache.

```text
Cache -> Authorization -> RealService
```

Cache bisa membocorkan data jika key tidak memasukkan user/permission context.

Ini contoh failure serius.

Rule:

```text
Decorator order is part of the design contract.
```

Jangan biarkan order menjadi kebetulan.

---

### 5.9 Decorator dan State

Decorator idealnya stateless atau hanya menyimpan immutable configuration.

Aman:

```java
public final class TimeoutDecorator implements ExternalClient {
    private final ExternalClient delegate;
    private final Duration timeout;
}
```

Berisiko:

```java
public final class CountingDecorator implements ExternalClient {
    private int count;

    @Override
    public Response call(Request request) {
        count++;
        return delegate.call(request);
    }
}
```

Jika singleton dan dipakai banyak thread, `count++` tidak thread-safe.

Lebih aman:

```java
private final AtomicLong count = new AtomicLong();
```

Namun tetap perlu tanya:

```text
Apakah decorator seharusnya menyimpan state per request, per instance, atau per system?
```

Banyak bug muncul karena state scope tidak jelas.

---

## 6. Proxy Pattern

### 6.1 Definisi

**Proxy** adalah object yang mewakili object lain dan mengontrol akses kepadanya.

Proxy biasanya memiliki interface yang sama dengan target, tetapi intent-nya bukan sekadar menambah behavior. Intent-nya adalah **indirection/control**.

Bentuk:

```text
Client -> Proxy -> RealSubject
```

Proxy bisa dipakai untuk:

1. access control,
2. lazy loading,
3. remote invocation,
4. caching,
5. transaction boundary,
6. security check,
7. rate limiting,
8. object lifecycle control,
9. instrumentation,
10. virtual object.

---

### 6.2 Decorator vs Proxy

Secara struktur mirip:

```text
Wrapper -> Delegate
```

Namun intent berbeda.

| Aspek | Decorator | Proxy |
|---|---|---|
| Intent | Menambah behavior | Mengontrol akses |
| Target awareness | Biasanya target real | Bisa lazy/remote/virtual |
| Semantic | Memperkaya operation | Bisa menolak, menunda, mengganti akses |
| Contoh | BufferedInputStream | Hibernate lazy proxy |
| Concern | Enhancement | Indirection/control |

Contoh perbedaan:

```java
new LoggingPaymentService(realPaymentService)
```

lebih cocok disebut Decorator.

```java
new AuthorizationPaymentProxy(realPaymentService, permissionChecker)
```

lebih cocok disebut Proxy karena bisa menolak akses.

---

### 6.3 Protection Proxy

Protection Proxy mengontrol akses.

```java
public final class AuthorizationApprovalProxy implements ApplicationApprovalService {
    private final ApplicationApprovalService delegate;
    private final PermissionChecker permissionChecker;
    private final CurrentUserProvider currentUserProvider;

    public AuthorizationApprovalProxy(
            ApplicationApprovalService delegate,
            PermissionChecker permissionChecker,
            CurrentUserProvider currentUserProvider
    ) {
        this.delegate = delegate;
        this.permissionChecker = permissionChecker;
        this.currentUserProvider = currentUserProvider;
    }

    @Override
    public ApprovalResult approve(ApproveApplicationCommand command) {
        UserId userId = currentUserProvider.currentUserId();

        if (!permissionChecker.canApprove(userId, command.applicationId())) {
            throw new ForbiddenOperationException(
                "User is not allowed to approve application " + command.applicationId()
            );
        }

        return delegate.approve(command);
    }
}
```

Kelebihan:

1. authorization tidak tersebar di core service,
2. policy bisa diuji secara terpisah,
3. akses selalu melewati proxy jika wiring benar.

Risiko:

1. jika ada path bypass ke delegate, security bisa terlewat,
2. permission check bisa tersembunyi dari pembaca code,
3. ordering dengan cache/transaction harus benar.

---

### 6.4 Virtual Proxy / Lazy Proxy

Proxy dapat menunda pembuatan object mahal.

```java
public final class LazyReportClientProxy implements ReportClient {
    private final Supplier<ReportClient> supplier;
    private volatile ReportClient delegate;

    public LazyReportClientProxy(Supplier<ReportClient> supplier) {
        this.supplier = supplier;
    }

    @Override
    public ReportResult generate(ReportRequest request) {
        return getDelegate().generate(request);
    }

    private ReportClient getDelegate() {
        ReportClient current = delegate;
        if (current == null) {
            synchronized (this) {
                current = delegate;
                if (current == null) {
                    current = supplier.get();
                    delegate = current;
                }
            }
        }
        return current;
    }
}
```

Ini memakai double-checked locking dengan `volatile`.

Namun di Java enterprise modern, lazy initialization sering lebih baik diserahkan ke DI container kecuali kamu benar-benar butuh kontrol khusus.

---

### 6.5 Remote Proxy

Remote Proxy mewakili object/service yang berada di proses lain.

```java
public final class HttpPaymentGatewayProxy implements PaymentGateway {
    private final HttpClient httpClient;
    private final URI endpoint;

    @Override
    public PaymentResult pay(PaymentRequest request) {
        HttpRequest httpRequest = HttpRequest.newBuilder(endpoint)
            .POST(HttpRequest.BodyPublishers.ofString(toJson(request)))
            .header("Content-Type", "application/json")
            .build();

        HttpResponse<String> response = httpClient.send(httpRequest,
            HttpResponse.BodyHandlers.ofString());

        return parsePaymentResult(response.body());
    }
}
```

Penting: remote proxy tidak boleh membuat remote call terasa seperti local call tanpa memperlihatkan failure semantics.

Anti-pattern:

```text
Remote call pretending to be local method call.
```

Remote operation punya:

1. latency,
2. timeout,
3. partial failure,
4. retry risk,
5. idempotency concern,
6. serialization concern,
7. compatibility concern,
8. observability concern.

Jika proxy menyembunyikan semua itu, sistem menjadi rapuh.

---

### 6.6 Dynamic Proxy di Java

Java menyediakan `java.lang.reflect.Proxy` untuk membuat proxy runtime untuk interface.

Contoh sederhana:

```java
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

public final class LoggingProxy {
    @SuppressWarnings("unchecked")
    public static <T> T create(Class<T> type, T target) {
        InvocationHandler handler = new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
                System.out.println("calling " + method.getName());
                try {
                    return method.invoke(target, args);
                } finally {
                    System.out.println("finished " + method.getName());
                }
            }
        };

        return (T) Proxy.newProxyInstance(
            type.getClassLoader(),
            new Class<?>[] { type },
            handler
        );
    }
}
```

Usage:

```java
ApplicationApprovalService service = LoggingProxy.create(
    ApplicationApprovalService.class,
    new DefaultApplicationApprovalService(repository, approvalPolicy)
);
```

Masalah penting:

1. JDK dynamic proxy hanya bekerja untuk interface.
2. Reflection invocation membungkus exception dalam `InvocationTargetException`.
3. Stack trace menjadi lebih panjang.
4. Method `equals`, `hashCode`, `toString` harus dipikirkan.
5. Proxy behavior tidak terlihat langsung di source class.

---

### 6.7 InvocationTargetException Handling

Dynamic proxy harus hati-hati dengan exception.

Naif:

```java
return method.invoke(target, args);
```

Jika target melempar exception, reflection membungkusnya.

Lebih benar:

```java
try {
    return method.invoke(target, args);
} catch (InvocationTargetException ex) {
    throw ex.getCause();
}
```

Lengkap:

```java
public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
    long start = System.nanoTime();
    try {
        return method.invoke(target, args);
    } catch (InvocationTargetException ex) {
        throw ex.getCause();
    } finally {
        long elapsed = System.nanoTime() - start;
        System.out.println(method.getName() + " took " + elapsed + "ns");
    }
}
```

---

### 6.8 Proxy Framework di Java Enterprise

Banyak framework memakai proxy:

1. Spring AOP untuk `@Transactional`, `@Cacheable`, `@Async`, security.
2. CDI untuk interceptor dan contextual proxy.
3. Hibernate untuk lazy entity association.
4. JAX-RS client proxy.
5. Jakarta REST resource proxy internal.
6. Mockito test doubles.
7. MicroProfile Rest Client.

Ini membuat behavior source code tidak selalu eksplisit.

Contoh:

```java
@Transactional
public void approve(ApplicationId id) {
    // transaction behavior not visible as method call
}
```

Real runtime:

```text
Client
  -> TransactionProxy
  -> TargetService.approve()
```

---

### 6.9 Self-Invocation Problem

Masalah umum pada proxy-based AOP:

```java
public class ApprovalService {

    @Transactional
    public void approve(ApplicationId id) {
        // transactional if called from outside through proxy
    }

    public void approveAll(List<ApplicationId> ids) {
        for (ApplicationId id : ids) {
            approve(id); // self-invocation, may bypass proxy
        }
    }
}
```

Jika `approveAll()` memanggil `approve()` dalam object yang sama, proxy tidak terlibat.

Mental model:

```text
External call:
Client -> Proxy -> Target.approve()

Self call:
Target.approveAll() -> this.approve()
```

`this.approve()` tidak melewati proxy.

Solusi desain:

1. pindahkan method transactional ke service lain,
2. buat transaction boundary di outer method,
3. gunakan programmatic transaction jika memang perlu,
4. hindari desain yang bergantung pada self-proxy.

Jangan menjadikan `AopContext.currentProxy()` sebagai default solution. Itu menambah coupling ke framework dan membuat desain lebih rapuh.

---

### 6.10 Proxy Invisibility

Proxy invisibility terjadi ketika behavior penting tidak terlihat dari kode yang dibaca.

Contoh:

```java
applicationService.approve(command);
```

Yang sebenarnya terjadi:

```text
SecurityProxy
  -> MetricsProxy
  -> TransactionProxy
  -> RetryProxy
  -> CacheProxy
  -> ApplicationService
```

Developer baru melihat method biasa, tetapi runtime melakukan banyak hal.

Ini bukan selalu buruk. Namun harus ada visibility melalui:

1. configuration yang jelas,
2. naming convention,
3. module documentation,
4. tests,
5. logs/traces,
6. design decision record,
7. actuator/diagnostic endpoint jika perlu,
8. framework-specific debug logging di non-prod.

---

## 7. Interceptor Pattern

### 7.1 Definisi

**Interceptor** menyisipkan behavior sebelum/sesudah invocation pada suatu join point.

Bentuk umum:

```text
before invocation
proceed
success/failure handling
after invocation
```

Interceptor biasanya tidak selalu memiliki interface yang sama dengan target. Ia bekerja pada abstraction seperti:

- invocation context,
- request context,
- method metadata,
- HTTP exchange,
- message envelope,
- database operation.

---

### 7.2 Generic Interceptor Model

Kita bisa modelkan interceptor sederhana:

```java
public interface Invocation<T> {
    T proceed();
}

public interface Interceptor<T> {
    T intercept(Invocation<T> invocation);
}
```

Logging interceptor:

```java
public final class LoggingInterceptor<T> implements Interceptor<T> {
    private final Logger log;
    private final String operationName;

    public LoggingInterceptor(Logger log, String operationName) {
        this.log = log;
        this.operationName = operationName;
    }

    @Override
    public T intercept(Invocation<T> invocation) {
        log.info("operation.start name={}", operationName);
        try {
            T result = invocation.proceed();
            log.info("operation.success name={}", operationName);
            return result;
        } catch (RuntimeException ex) {
            log.warn("operation.failure name={} errorType={}",
                operationName, ex.getClass().getSimpleName());
            throw ex;
        }
    }
}
```

Usage:

```java
Interceptor<ApprovalResult> logging = new LoggingInterceptor<>(log, "approve");

ApprovalResult result = logging.intercept(() -> service.approve(command));
```

---

### 7.3 Around Invocation dengan Context

Interceptor sering butuh metadata.

```java
public final class InvocationContext<T> {
    private final String operationName;
    private final Map<String, Object> attributes;
    private final Supplier<T> action;

    public InvocationContext(
            String operationName,
            Map<String, Object> attributes,
            Supplier<T> action
    ) {
        this.operationName = operationName;
        this.attributes = Map.copyOf(attributes);
        this.action = action;
    }

    public String operationName() {
        return operationName;
    }

    public Object attribute(String name) {
        return attributes.get(name);
    }

    public T proceed() {
        return action.get();
    }
}
```

Interceptor:

```java
public interface ContextInterceptor<T> {
    T intercept(InvocationContext<T> context);
}
```

Ini mendekati model framework interceptor.

---

### 7.4 Interceptor vs Decorator

| Aspek | Decorator | Interceptor |
|---|---|---|
| Binding | Object/interface specific | Join point/context specific |
| Interface | Sama dengan target | Biasanya generic invocation context |
| Usage | Manual composition | Framework/pipeline driven |
| Visibility | Lebih eksplisit | Bisa tersembunyi |
| Scope | Object behavior | Cross-cutting behavior |

Decorator cocok jika kamu ingin membungkus satu abstraction tertentu.

Interceptor cocok jika kamu ingin menerapkan behavior yang sama ke banyak join point.

Contoh:

- Logging untuk satu `PaymentGateway` → Decorator.
- Logging untuk semua endpoint REST → Interceptor/filter.

---

### 7.5 Jakarta/CDI/Spring Style Interceptor

Secara konsep:

```java
@AroundInvoke
public Object audit(InvocationContext context) throws Exception {
    before(context);
    try {
        Object result = context.proceed();
        afterSuccess(context, result);
        return result;
    } catch (Exception ex) {
        afterFailure(context, ex);
        throw ex;
    }
}
```

Yang penting bukan anotasinya, tetapi contract-nya:

```text
Interceptor receives invocation context and decides whether/how to proceed.
```

Jika interceptor tidak memanggil `proceed()`, target tidak berjalan.

Ini bisa berguna untuk authorization atau caching, tetapi juga berbahaya jika tidak eksplisit.

---

### 7.6 Interceptor untuk Authorization

```java
public final class AuthorizationInterceptor<T> implements ContextInterceptor<T> {
    private final PermissionChecker permissionChecker;
    private final CurrentUserProvider currentUserProvider;

    public AuthorizationInterceptor(
            PermissionChecker permissionChecker,
            CurrentUserProvider currentUserProvider
    ) {
        this.permissionChecker = permissionChecker;
        this.currentUserProvider = currentUserProvider;
    }

    @Override
    public T intercept(InvocationContext<T> context) {
        UserId userId = currentUserProvider.currentUserId();
        String operation = context.operationName();

        if (!permissionChecker.allowed(userId, operation)) {
            throw new ForbiddenOperationException(operation);
        }

        return context.proceed();
    }
}
```

Pertanyaan desain:

1. Apakah authorization berbasis operation cukup?
2. Apakah perlu resource-level permission?
3. Dari mana resource id didapat?
4. Apakah parameter invocation aman dibaca?
5. Apakah authorization terjadi sebelum side effect?
6. Apakah denial diaudit?

Interceptor authorization sering tampak rapi, tetapi bisa terlalu generic sehingga tidak cukup domain-aware.

---

### 7.7 Interceptor untuk Transaction

Transaction interceptor umum:

```java
public final class TransactionInterceptor<T> implements ContextInterceptor<T> {
    private final TransactionManager transactionManager;

    public TransactionInterceptor(TransactionManager transactionManager) {
        this.transactionManager = transactionManager;
    }

    @Override
    public T intercept(InvocationContext<T> context) {
        Transaction transaction = transactionManager.begin();
        try {
            T result = context.proceed();
            transaction.commit();
            return result;
        } catch (RuntimeException ex) {
            transaction.rollback();
            throw ex;
        }
    }
}
```

Pertanyaan penting:

1. Exception apa yang menyebabkan rollback?
2. Checked exception bagaimana?
3. Apakah nested transaction didukung?
4. Propagation behavior apa?
5. Isolation level apa?
6. Timeout berapa?
7. Apakah external call terjadi di dalam transaction?

Transaction interceptor adalah contoh pattern yang powerful tetapi sering membuat developer lupa bahwa transaction boundary adalah keputusan domain/application-level.

---

### 7.8 Interceptor untuk Metrics

```java
public final class MetricsInterceptor<T> implements ContextInterceptor<T> {
    private final MetricsRecorder metrics;

    public MetricsInterceptor(MetricsRecorder metrics) {
        this.metrics = metrics;
    }

    @Override
    public T intercept(InvocationContext<T> context) {
        long start = System.nanoTime();
        try {
            T result = context.proceed();
            metrics.increment(context.operationName() + ".success");
            return result;
        } catch (RuntimeException ex) {
            metrics.increment(context.operationName() + ".failure",
                "exception", ex.getClass().getSimpleName());
            throw ex;
        } finally {
            metrics.timing(context.operationName() + ".latency", System.nanoTime() - start);
        }
    }
}
```

Metric naming harus hati-hati. Jangan menggunakan value high-cardinality sebagai metric label.

Buruk:

```text
applicationId=APP-2026-000000123
userId=U-882991
```

Lebih aman:

```text
operation=approve
result=success/failure
exception=ForbiddenOperationException
```

---

## 8. Middleware Chain

### 8.1 Definisi

Middleware Chain adalah pipeline berurutan di mana setiap middleware menerima context dan dapat meneruskan ke middleware berikutnya.

Bentuk:

```text
Request
  -> Middleware A
  -> Middleware B
  -> Middleware C
  -> Handler
  -> Middleware C
  -> Middleware B
  -> Middleware A
Response
```

Ini umum di:

1. Servlet Filter Chain,
2. Spring Security Filter Chain,
3. HTTP client interceptors,
4. gRPC interceptors,
5. messaging pipelines,
6. API gateway,
7. web frameworks,
8. command bus pipelines.

---

### 8.2 Chain Interface Sederhana

```java
public interface Middleware<C, R> {
    R handle(C context, Chain<C, R> chain);
}

public interface Chain<C, R> {
    R proceed(C context);
}
```

Handler akhir:

```java
public interface Handler<C, R> {
    R handle(C context);
}
```

Chain implementation:

```java
public final class MiddlewareChain<C, R> implements Chain<C, R> {
    private final List<Middleware<C, R>> middlewares;
    private final Handler<C, R> handler;
    private final int index;

    public MiddlewareChain(
            List<Middleware<C, R>> middlewares,
            Handler<C, R> handler
    ) {
        this(middlewares, handler, 0);
    }

    private MiddlewareChain(
            List<Middleware<C, R>> middlewares,
            Handler<C, R> handler,
            int index
    ) {
        this.middlewares = List.copyOf(middlewares);
        this.handler = handler;
        this.index = index;
    }

    @Override
    public R proceed(C context) {
        if (index < middlewares.size()) {
            Middleware<C, R> middleware = middlewares.get(index);
            Chain<C, R> next = new MiddlewareChain<>(middlewares, handler, index + 1);
            return middleware.handle(context, next);
        }
        return handler.handle(context);
    }
}
```

Usage:

```java
List<Middleware<RequestContext, Response>> middlewares = List.of(
    new CorrelationIdMiddleware(),
    new LoggingMiddleware(),
    new AuthenticationMiddleware(),
    new AuthorizationMiddleware(),
    new MetricsMiddleware()
);

Handler<RequestContext, Response> handler = context -> applicationService.handle(context.command());

Response response = new MiddlewareChain<>(middlewares, handler).proceed(context);
```

---

### 8.3 Middleware Bisa Short-Circuit

Authorization middleware bisa menghentikan chain.

```java
public final class AuthorizationMiddleware implements Middleware<RequestContext, Response> {
    private final PermissionChecker permissionChecker;

    public AuthorizationMiddleware(PermissionChecker permissionChecker) {
        this.permissionChecker = permissionChecker;
    }

    @Override
    public Response handle(RequestContext context, Chain<RequestContext, Response> chain) {
        if (!permissionChecker.allowed(context.user(), context.operation())) {
            return Response.forbidden("Not allowed");
        }
        return chain.proceed(context);
    }
}
```

Short-circuit valid jika explicit.

Berbahaya jika middleware diam-diam tidak memanggil next tanpa alasan yang jelas.

---

### 8.4 Middleware Bisa Mengubah Context

```java
public final class CorrelationIdMiddleware implements Middleware<RequestContext, Response> {
    @Override
    public Response handle(RequestContext context, Chain<RequestContext, Response> chain) {
        RequestContext enriched = context.withCorrelationId(
            context.correlationId().orElseGet(CorrelationId::new)
        );
        return chain.proceed(enriched);
    }
}
```

Context mutation perlu hati-hati.

Lebih aman memakai immutable context:

```java
public record RequestContext(
    Optional<CorrelationId> correlationId,
    User user,
    String operation,
    Object command
) {
    public RequestContext withCorrelationId(CorrelationId id) {
        return new RequestContext(Optional.of(id), user, operation, command);
    }
}
```

Dengan records, Java modern memudahkan immutable context.

---

### 8.5 Middleware Ordering

Contoh order HTTP request:

```text
1. Correlation ID
2. Request logging start
3. Authentication
4. Authorization
5. Rate limiting
6. Input validation
7. Transaction boundary
8. Handler
9. Response mapping
10. Metrics/logging finish
```

Namun order tergantung konteks.

Misalnya rate limiting sebelum authentication?

```text
Anonymous IP-based rate limiting -> before authentication
User-based rate limiting         -> after authentication
```

Transaction sebelum authorization?

Biasanya tidak.

```text
Authorization should happen before mutation and before expensive transactional work.
```

Retry sebelum transaction atau transaction sebelum retry?

Biasanya:

```text
Retry -> Transaction -> Operation
```

Artinya setiap retry attempt memiliki transaction baru.

Jika:

```text
Transaction -> Retry -> Operation
```

semua retry terjadi dalam transaction yang sama. Ini sering salah karena transaction bisa sudah rollback-only atau menyimpan state inconsistent.

---

## 9. Cross-Cutting Concerns sebagai Layer

### 9.1 Logging

Logging decorator/interceptor berguna untuk:

1. operation start/end,
2. outcome,
3. duration,
4. error type,
5. correlation id,
6. business key yang aman,
7. decision point.

Buruk:

```java
log.info("request={}", request);
```

Risiko:

1. PII leakage,
2. log terlalu besar,
3. serialization expensive,
4. cyclic object graph,
5. noisy log.

Lebih baik:

```java
log.info("approval.start correlationId={} applicationId={} actorId={}",
    context.correlationId(), command.applicationId(), command.actorId());
```

Tetap pastikan `actorId` dan `applicationId` boleh dicatat sesuai kebijakan.

---

### 9.2 Metrics

Metrics wrapper harus menjawab pertanyaan operasional:

1. Berapa latency operation?
2. Berapa success/failure rate?
3. Failure type apa yang dominan?
4. Apakah retry meningkat?
5. Apakah downstream lambat?

Anti-pattern:

```text
metric everywhere without decision.
```

Metric yang tidak dipakai untuk alerting, diagnosis, atau capacity planning hanya menjadi noise.

---

### 9.3 Tracing

Tracing interceptor biasanya:

1. membuat span,
2. menambahkan attributes low-cardinality,
3. menyambungkan parent-child span,
4. mencatat error,
5. menutup span di finally.

Pseudo-code:

```java
public final class TracingMiddleware implements Middleware<RequestContext, Response> {
    private final Tracer tracer;

    @Override
    public Response handle(RequestContext context, Chain<RequestContext, Response> chain) {
        Span span = tracer.startSpan(context.operation());
        try (Scope ignored = span.makeCurrent()) {
            Response response = chain.proceed(context);
            span.setAttribute("result", response.status());
            return response;
        } catch (RuntimeException ex) {
            span.recordException(ex);
            throw ex;
        } finally {
            span.end();
        }
    }
}
```

Dengan virtual threads, context propagation via ThreadLocal perlu dipahami dengan baik. Java modern memperkenalkan Scoped Values sebagai alternatif untuk beberapa kasus context sharing yang lebih terstruktur.

---

### 9.4 Retry

Retry decorator:

```java
public final class RetryExternalClient implements ExternalClient {
    private final ExternalClient delegate;
    private final RetryPolicy policy;

    @Override
    public ExternalResponse call(ExternalRequest request) {
        int attempt = 0;
        while (true) {
            attempt++;
            try {
                return delegate.call(request);
            } catch (TransientExternalException ex) {
                if (!policy.shouldRetry(attempt, ex)) {
                    throw ex;
                }
                sleep(policy.delayFor(attempt));
            }
        }
    }
}
```

Pertanyaan desain:

1. Operation idempotent atau tidak?
2. Exception mana retryable?
3. Status code mana retryable?
4. Timeout per attempt atau total timeout?
5. Apakah ada jitter?
6. Apakah retry budget ada?
7. Apakah retry dilakukan sebelum/di dalam transaction?
8. Apakah downstream bisa overload?

Retry adalah salah satu decorator yang paling sering menjadi anti-pattern.

---

### 9.5 Timeout

Timeout harus biasanya lebih luar daripada call yang bisa menggantung.

```text
Timeout -> Retry -> ExternalCall
```

Namun perlu bedakan:

```text
per-attempt timeout
total operation timeout
```

Contoh:

```text
Total timeout: 3s
Retry attempts: 3
Per attempt timeout: 800ms
Backoff: 100ms, 200ms
```

Tanpa total timeout, retry bisa membuat request terlalu lama.

---

### 9.6 Cache

Cache decorator:

```java
public final class CachingPostalCodeLookup implements PostalCodeLookup {
    private final PostalCodeLookup delegate;
    private final Cache<PostalCode, Address> cache;

    @Override
    public Address lookup(PostalCode postalCode) {
        Address cached = cache.get(postalCode);
        if (cached != null) {
            return cached;
        }

        Address address = delegate.lookup(postalCode);
        cache.put(postalCode, address);
        return address;
    }
}
```

Pertanyaan desain:

1. Apa key-nya?
2. Apakah response user-specific?
3. TTL berapa?
4. Negative result dicache atau tidak?
5. Error dicache atau tidak?
6. Cache invalidation bagaimana?
7. Apakah stampede dicegah?
8. Apakah cache hit/miss diukur?

Cache di posisi salah bisa menjadi security bug.

```text
Cache before Authorization = dangerous unless key includes security context.
```

---

### 9.7 Transaction

Transaction sebagai interceptor powerful, tetapi jangan menjadi selimut untuk semua operation.

Buruk:

```java
@Transactional
public void process() {
    repository.updateA();
    externalClient.call();
    repository.updateB();
    emailClient.send();
}
```

Masalah:

1. transaction terbuka saat external call,
2. lock bisa tertahan lama,
3. rollback tidak membatalkan external side effect,
4. timeout tidak jelas,
5. retry berbahaya.

Lebih baik:

```text
small transaction boundary
external side effect via outbox/event
explicit consistency model
```

---

### 9.8 Authorization

Authorization dapat berupa proxy/interceptor/middleware, tetapi policy domain tidak boleh hilang.

Generic authorization:

```text
Can user perform OPERATION?
```

Domain authorization:

```text
Can this officer approve this application at this state for this agency and delegation level?
```

Pattern yang baik:

```text
Interceptor extracts context -> Policy object makes domain decision.
```

Bukan:

```text
Interceptor contains giant if-else permission logic.
```

---

## 10. Pattern Interaction: Layer Composition Matrix

### 10.1 Contoh Safe Order untuk Use Case Command

Untuk command yang mengubah state:

```text
1. Correlation/trace context
2. Request logging
3. Authentication context resolution
4. Authorization
5. Idempotency check
6. Rate limit / quota
7. Validation
8. Retry boundary if operation is safe to retry
9. Transaction boundary
10. Core handler
11. Outbox write inside transaction
12. Commit
13. Post-commit async publishing
14. Metrics/tracing/log completion
```

Namun tidak semua operation butuh semua layer.

Senior engineer tidak menambahkan semua pattern. Senior engineer memilih layer sesuai risk.

---

### 10.2 Query Operation Order

Untuk query read-only:

```text
1. Correlation
2. Logging
3. Authentication
4. Authorization
5. Cache lookup
6. Timeout
7. Repository/external query
8. Response mapping
9. Metrics
```

Cache setelah authorization untuk menghindari data leak.

Jika cache public dan tidak user-specific, cache bisa lebih awal.

---

### 10.3 External API Call Order

```text
1. Correlation/tracing
2. Rate limiter
3. Bulkhead
4. Circuit breaker
5. Retry
6. Timeout per attempt
7. Actual HTTP call
8. Error translation
9. Metrics
```

Ada perdebatan urutan circuit breaker dan retry tergantung library dan tujuan metric:

- Circuit breaker outside retry: breaker melihat satu logical call.
- Circuit breaker inside retry: breaker melihat setiap attempt.

Keduanya bisa valid, tetapi harus dipilih sadar.

---

### 10.4 Transaction dan Retry

Umumnya:

```text
Retry
  -> Transaction
      -> DB operation
```

Karena setiap retry perlu transaction baru.

Berbahaya:

```text
Transaction
  -> Retry
      -> DB operation
```

Jika attempt pertama gagal dan transaction rollback-only, retry berikutnya berada dalam transaction yang sudah rusak.

---

### 10.5 Logging dan Exception Mapping

Jika logging terlalu dalam, exception bisa belum diterjemahkan.

Jika logging terlalu luar, detail teknis bisa hilang.

Solusi:

1. log technical failure di infrastructure boundary,
2. log business outcome di application boundary,
3. map error di API boundary,
4. jangan log exception yang sama berkali-kali di semua layer.

Anti-pattern:

```text
Every layer logs and rethrows.
```

Hasilnya satu failure menghasilkan 8 log error.

---

## 11. Java 8–25 Perspective

### 11.1 Java 8 Lambda Mengurangi Boilerplate

Sebelum Java 8, decorator kecil sering butuh class penuh.

Setelah Java 8, behavior wrapper bisa memakai lambda.

```java
Supplier<Result> operation = () -> service.execute(command);
Supplier<Result> withLogging = () -> {
    log.info("start");
    try {
        return operation.get();
    } finally {
        log.info("end");
    }
};
```

Namun lambda juga bisa membuat stack trace kurang deskriptif jika terlalu banyak anonymous wrapper.

Untuk concern penting, class eksplisit sering lebih baik.

---

### 11.2 Default Method untuk Lightweight Decorator

Interface default method bisa membantu membuat combinator.

```java
@FunctionalInterface
public interface CheckedOperation<T> {
    T execute() throws Exception;

    default CheckedOperation<T> withLogging(Logger log, String name) {
        return () -> {
            log.info("{}.start", name);
            try {
                return execute();
            } finally {
                log.info("{}.end", name);
            }
        };
    }
}
```

Namun jangan berlebihan memasukkan infrastructure concern ke domain-facing interface.

---

### 11.3 Records untuk Context

Records cocok untuk immutable request/context dalam chain.

```java
public record OperationContext(
    CorrelationId correlationId,
    UserId userId,
    String operation,
    Instant receivedAt
) {}
```

Jika context perlu enrichment:

```java
public OperationContext withOperation(String operation) {
    return new OperationContext(correlationId, userId, operation, receivedAt);
}
```

Karena record immutable by convention, chain lebih mudah dipahami.

---

### 11.4 Sealed Interfaces untuk Middleware Outcome

```java
public sealed interface MiddlewareResult<T>
    permits MiddlewareResult.Continue, MiddlewareResult.Stop {

    record Continue<T>(T context) implements MiddlewareResult<T> {}
    record Stop<T>(Response response) implements MiddlewareResult<T> {}
}
```

Ini membuat short-circuit eksplisit.

Namun implementasi chain bisa menjadi lebih kompleks. Gunakan jika short-circuit semantics penting dan sering disalahpahami.

---

### 11.5 Pattern Matching untuk Error Translation

```java
public ApiError map(Throwable ex) {
    return switch (ex) {
        case ForbiddenOperationException forbidden -> ApiError.forbidden(forbidden.getMessage());
        case ValidationException validation -> ApiError.badRequest(validation.errors());
        case ExternalServiceUnavailableException unavailable -> ApiError.serviceUnavailable();
        default -> ApiError.internal();
    };
}
```

Pattern matching membantu membuat exception mapping lebih jelas daripada if-else panjang.

---

### 11.6 Virtual Threads dan Wrapper Design

Virtual threads membuat blocking operation lebih murah, tetapi tidak menghapus kebutuhan:

1. timeout,
2. cancellation,
3. rate limiting,
4. bulkhead,
5. connection pool limit,
6. downstream capacity limit.

Decorator retry/timeout masih relevan.

Yang berubah:

```text
Thread-per-request becomes cheaper, but resource-per-request is still not free.
```

Jangan menganggap virtual threads membuat semua proxy/concurrency/resilience concern hilang.

---

### 11.7 ThreadLocal, Scoped Values, dan Context Propagation

Banyak interceptor memakai `ThreadLocal` untuk:

1. current user,
2. correlation id,
3. tenant id,
4. transaction context,
5. request context.

Dengan async execution dan virtual threads, context propagation harus didesain sadar.

Alternative modern Java untuk beberapa kasus adalah scoped context yang lebih eksplisit dan terstruktur.

Prinsip desain:

```text
Context should have clear lifetime, owner, and propagation semantics.
```

Anti-pattern:

```text
Put everything in ThreadLocal and hope it works.
```

---

## 12. Anti-Pattern Catalog

### 12.1 Decorator Onion Hell

Gejala:

```text
Client
  -> A
  -> B
  -> C
  -> D
  -> E
  -> F
  -> RealService
```

Masalah:

1. sulit tahu urutan,
2. sulit debug,
3. stack trace panjang,
4. performance overhead,
5. setiap layer menangkap exception,
6. responsibility kabur.

Solusi:

1. dokumentasikan chain,
2. gabungkan layer yang selalu bersama jika masuk akal,
3. pindahkan generic concern ke framework-level interceptor,
4. hapus decorator yang tidak memberikan value,
5. buat tests untuk order.

---

### 12.2 Proxy Invisibility

Gejala:

```java
service.approve(command);
```

terlihat sederhana, tetapi runtime menjalankan security, transaction, retry, cache, metrics, tracing, validation.

Masalah:

1. developer salah memahami cost,
2. side effect tidak terlihat,
3. self-invocation bug,
4. test berbeda dari production wiring,
5. debugging sulit.

Solusi:

1. gunakan naming/config convention,
2. buat integration test dengan real proxy,
3. dokumentasikan key annotations,
4. expose diagnostics untuk chain jika perlu,
5. hindari annotation berlebihan.

---

### 12.3 Annotation Magic Abuse

Gejala:

```java
@Audited
@Validated
@Authorized("APPROVE")
@Transactional
@Retryable
@Timed
@Cached
public ApprovalResult approve(Command command) { ... }
```

Masalah:

1. order tidak jelas,
2. semantic tersembunyi,
3. annotation menjadi mini-language,
4. parameter binding rapuh,
5. behavior sulit dites tanpa framework,
6. perubahan annotation mengubah runtime besar-besaran.

Solusi:

1. batasi annotation untuk concern stabil,
2. hindari domain logic kompleks di annotation,
3. gunakan explicit policy object,
4. buat annotation composition jika framework mendukung dan jelas,
5. dokumentasikan ordering.

---

### 12.4 Logging Decorator That Changes Behavior

Logging seharusnya observasi, bukan mengubah semantic.

Buruk:

```java
try {
    return delegate.call(request);
} catch (Exception ex) {
    log.warn("failed", ex);
    return Response.empty();
}
```

Ini bukan logging decorator. Ini fallback behavior tersembunyi.

Solusi:

1. pisahkan fallback decorator,
2. beri nama jelas,
3. test failure semantic,
4. jangan swallow exception di logging layer.

---

### 12.5 Retry Decorator Without Idempotency

Gejala:

```java
retry(() -> paymentGateway.charge(card, amount));
```

Jika `charge` tidak idempotent, retry bisa men-charge dua kali.

Solusi:

1. gunakan idempotency key,
2. retry hanya untuk failure yang aman,
3. pahami apakah failure terjadi sebelum/ setelah side effect,
4. desain deduplication.

---

### 12.6 Cache Proxy Before Authorization

Gejala:

```text
Cache -> Authorization -> DataService
```

Jika cache key hanya `documentId`, user lain bisa mendapat cached data.

Solusi:

1. Authorization sebelum cache, atau
2. cache key memasukkan permission/security context, atau
3. hanya cache data public/non-sensitive.

---

### 12.7 Transaction Proxy Around External Calls

Gejala:

```java
@Transactional
public void approve() {
    repository.save(...);
    externalApi.call(...);
    repository.save(...);
}
```

Masalah:

1. DB lock tertahan selama network call,
2. rollback tidak membatalkan external call,
3. timeout transaction meningkat,
4. pool connection habis.

Solusi:

1. kecilkan transaction,
2. gunakan outbox,
3. pisahkan side effect,
4. gunakan saga/compensation jika perlu.

---

### 12.8 Middleware with Hidden Mutation

Gejala:

```java
context.getAttributes().put("user", user);
context.getAttributes().put("role", role);
context.getAttributes().put("approved", true);
```

Masalah:

1. context menjadi global mutable bag,
2. dependency antar middleware tersembunyi,
3. key typo runtime bug,
4. urutan sulit dipahami.

Solusi:

1. immutable typed context,
2. explicit fields,
3. typed attribute key jika benar-benar perlu,
4. minimalkan mutation.

---

### 12.9 Interceptor That Contains Business Logic

Gejala:

```text
Approval rule, eligibility rule, escalation rule, SLA rule semua di interceptor.
```

Masalah:

1. domain logic tersembunyi,
2. test domain harus menjalankan framework,
3. rule reuse sulit,
4. auditability buruk.

Solusi:

```text
Interceptor handles plumbing.
Policy/Specification handles business decision.
```

---

### 12.10 Chain Without Ownership

Gejala:

Tidak ada yang tahu siapa pemilik middleware order.

Masalah:

1. satu tim menambah filter baru dan merusak auth,
2. metrics berubah tanpa sadar,
3. behavior production berbeda antar module,
4. onboarding lambat.

Solusi:

1. centralize chain configuration,
2. define ordering policy,
3. automated tests for critical order,
4. architecture decision record.

---

## 13. Refactoring Path

### 13.1 Starting Point: Service Method Terlalu Banyak Concern

```java
public ApprovalResult approve(Command command) {
    log.info("start");
    long start = System.nanoTime();

    if (!permissionChecker.allowed(currentUser(), command.applicationId())) {
        metrics.increment("forbidden");
        throw new ForbiddenException();
    }

    try {
        return transactionTemplate.execute(() -> {
            Application application = repository.find(command.applicationId());
            validate(application);
            application.approve(command.reason());
            repository.save(application);
            audit.record("approved");
            return ApprovalResult.approved(application.id());
        });
    } catch (Exception ex) {
        log.error("failed", ex);
        throw ex;
    } finally {
        metrics.timing("approve", System.nanoTime() - start);
    }
}
```

---

### 13.2 Step 1: Identify Core Operation

Core operation:

```java
public ApprovalResult approve(Command command) {
    Application application = repository.findRequired(command.applicationId());
    approvalPolicy.ensureCanApprove(application, command.actorId());
    application.approve(command.reason());
    repository.save(application);
    return ApprovalResult.approved(application.id());
}
```

---

### 13.3 Step 2: Extract Authorization Proxy or Policy

Jika authorization domain-specific, policy tetap eksplisit.

```java
approvalPolicy.ensureCanApprove(application, command.actorId());
```

Jika authorization generic operation-level, bisa ke proxy/interceptor.

---

### 13.4 Step 3: Extract Metrics Decorator

```java
ApplicationApprovalService service =
    new MetricsApprovalService(coreService, metrics);
```

---

### 13.5 Step 4: Extract Logging Decorator

```java
ApplicationApprovalService service =
    new LoggingApprovalService(
        new MetricsApprovalService(coreService, metrics),
        log
    );
```

---

### 13.6 Step 5: Decide Transaction Boundary

Jika transaction harus membungkus core mutation:

```java
ApplicationApprovalService service =
    new TransactionalApprovalService(coreService, transactionManager);
```

Composition:

```java
ApplicationApprovalService service =
    new LoggingApprovalService(
        new MetricsApprovalService(
            new TransactionalApprovalService(coreService, txManager),
            metrics
        ),
        log
    );
```

Pastikan order disadari.

---

### 13.7 Step 6: Replace Manual Decorator with Framework Only If Worth It

Manual decorator cocok jika:

1. concern domain/application-specific,
2. order sangat penting,
3. behavior perlu eksplisit,
4. testing tanpa framework penting.

Framework interceptor cocok jika:

1. concern seragam di banyak method,
2. framework sudah menyediakan mekanisme robust,
3. team memahami semantic framework,
4. observability cukup.

Jangan otomatis memindahkan semua decorator ke annotation.

---

## 14. Testing Strategy

### 14.1 Test Decorator Contract

Decorator harus menjaga contract target.

```java
class LoggingApprovalServiceTest {

    @Test
    void delegatesToUnderlyingService() {
        FakeApprovalService fake = new FakeApprovalService();
        LoggingApprovalService service = new LoggingApprovalService(fake, testLogger);

        ApprovalResult result = service.approve(command);

        assertEquals(1, fake.callCount());
        assertEquals(ApprovalStatus.APPROVED, result.status());
    }
}
```

---

### 14.2 Test Failure Propagation

```java
@Test
void rethrowsDelegateException() {
    ApplicationApprovalService failing = command -> {
        throw new ForbiddenOperationException("not allowed");
    };

    LoggingApprovalService service = new LoggingApprovalService(failing, testLogger);

    assertThrows(ForbiddenOperationException.class, () -> service.approve(command));
}
```

Logging decorator tidak boleh menelan exception.

---

### 14.3 Test Ordering

Gunakan recording decorator.

```java
public final class RecordingService implements ApplicationApprovalService {
    private final List<String> events;

    public RecordingService(List<String> events) {
        this.events = events;
    }

    @Override
    public ApprovalResult approve(ApproveApplicationCommand command) {
        events.add("core");
        return ApprovalResult.approved(command.applicationId());
    }
}
```

Decorator:

```java
public final class RecordingDecorator implements ApplicationApprovalService {
    private final String name;
    private final ApplicationApprovalService delegate;
    private final List<String> events;

    @Override
    public ApprovalResult approve(ApproveApplicationCommand command) {
        events.add(name + ".before");
        try {
            return delegate.approve(command);
        } finally {
            events.add(name + ".after");
        }
    }
}
```

Test:

```java
assertEquals(List.of(
    "metrics.before",
    "logging.before",
    "core",
    "logging.after",
    "metrics.after"
), events);
```

---

### 14.4 Test Middleware Short-Circuit

```java
@Test
void authorizationMiddlewareStopsChainWhenForbidden() {
    AuthorizationMiddleware middleware = new AuthorizationMiddleware(denyAllChecker);
    AtomicBoolean handlerCalled = new AtomicBoolean(false);

    Response response = middleware.handle(context, ctx -> {
        handlerCalled.set(true);
        return Response.ok();
    });

    assertEquals(403, response.status());
    assertFalse(handlerCalled.get());
}
```

---

### 14.5 Integration Test with Real Proxy

Untuk framework proxy seperti transaction/security/cache, unit test saja tidak cukup.

Butuh integration test yang memastikan:

1. proxy benar-benar aktif,
2. self-invocation tidak menjadi bug,
3. annotation terbaca,
4. order benar,
5. exception semantic sesuai.

Contoh test intention:

```text
When approve() fails after DB mutation, transaction is rolled back.
```

Ini harus diuji dengan real transaction manager, bukan mock.

---

## 15. Observability and Debugging Angle

### 15.1 Log Layer Entry Secukupnya

Jangan semua layer menulis log start/end default. Itu noise.

Gunakan strategy:

1. satu entry log di boundary operation,
2. satu completion log dengan outcome,
3. technical detail di layer infrastructure jika failure,
4. trace/span untuk detail call graph.

---

### 15.2 Expose Active Chain in Diagnostics

Untuk sistem kompleks, berguna punya diagnostic output:

```text
ApplicationApprovalService chain:
1. MetricsApprovalService
2. LoggingApprovalService
3. AuthorizationApprovalProxy
4. TransactionalApprovalService
5. DefaultApplicationApprovalService
```

Ini bisa berupa dokumentasi, actuator endpoint, startup log, atau test snapshot.

---

### 15.3 Startup Log untuk Middleware Order

Contoh:

```text
Approval command middleware chain initialized:
[CorrelationId, Authentication, Authorization, Validation, Transaction, Handler, Metrics]
```

Startup log seperti ini membantu debugging production.

---

### 15.4 Stack Trace Awareness

Dengan proxy/interceptor, stack trace bisa berisi:

```text
com.sun.proxy.$Proxy...
org.springframework.aop...
java.lang.reflect.Method.invoke
...
```

Engineer perlu tahu bahwa stack trace runtime tidak sama dengan source-level call graph.

Praktik baik:

1. beri nama class decorator jelas,
2. hindari terlalu banyak anonymous lambda untuk critical path,
3. unwrap reflection exception dengan benar,
4. record operation name/correlation id.

---

### 15.5 Metrics untuk Layer

Untuk external call, metrics per layer berguna:

```text
external.lookup.attempt.count
external.lookup.retry.count
external.lookup.timeout.count
external.lookup.circuit.open.count
external.lookup.latency
```

Untuk internal service, jangan terlalu granular kecuali ada kebutuhan diagnosis.

---

## 16. Design Review Checklist

Gunakan checklist ini saat melihat Decorator/Proxy/Interceptor/Middleware Chain.

### 16.1 Intent

```text
[ ] Apakah ini benar Decorator, Proxy, Interceptor, atau Middleware?
[ ] Apakah intent-nya jelas dari nama class/config?
[ ] Apakah behavior tambahan memang orthogonal dari core logic?
```

### 16.2 Contract

```text
[ ] Apakah wrapper menjaga contract interface?
[ ] Apakah exception semantic tetap konsisten?
[ ] Apakah return value dimodifikasi secara eksplisit?
[ ] Apakah nullability tetap sama?
```

### 16.3 Ordering

```text
[ ] Apakah urutan layer deterministic?
[ ] Apakah order didokumentasikan?
[ ] Apakah ada test untuk order kritikal?
[ ] Apakah authorization terjadi sebelum side effect?
[ ] Apakah transaction boundary tidak membungkus external call tidak perlu?
[ ] Apakah retry berada di luar transaction jika diperlukan?
```

### 16.4 Visibility

```text
[ ] Apakah developer bisa mengetahui layer apa yang aktif?
[ ] Apakah annotation magic terlalu banyak?
[ ] Apakah proxy behavior muncul di integration test?
[ ] Apakah startup diagnostics/logging membantu?
```

### 16.5 State and Thread Safety

```text
[ ] Apakah wrapper stateless atau thread-safe?
[ ] Apakah context immutable?
[ ] Apakah ThreadLocal dibersihkan?
[ ] Apakah virtual thread/async execution memengaruhi context propagation?
```

### 16.6 Failure

```text
[ ] Apakah wrapper menelan exception?
[ ] Apakah fallback eksplisit?
[ ] Apakah retry hanya untuk operation idempotent/retryable?
[ ] Apakah timeout ada untuk external call?
[ ] Apakah failure tercatat dengan correlation id?
```

### 16.7 Security

```text
[ ] Apakah cache tidak membocorkan data lintas user/tenant?
[ ] Apakah authorization tidak bisa dibypass?
[ ] Apakah sensitive data tidak masuk log?
[ ] Apakah audit dilakukan pada decision penting?
```

### 16.8 Testability

```text
[ ] Apakah decorator bisa dites sendiri?
[ ] Apakah proxy/framework behavior dites via integration test?
[ ] Apakah middleware short-circuit dites?
[ ] Apakah failure path dites?
```

---

## 17. Case Study: Approval Operation di Sistem Regulatory

### 17.1 Problem

Operation `approveCase()` harus melakukan:

1. correlation id,
2. authentication context,
3. authorization,
4. validation,
5. transaction,
6. domain state transition,
7. audit trail,
8. event publication,
9. metrics,
10. logging.

Naive implementation menaruh semuanya dalam satu service method.

---

### 17.2 Better Responsibility Split

Core domain service:

```java
public final class DefaultCaseApprovalService implements CaseApprovalService {
    private final CaseRepository caseRepository;
    private final CaseApprovalPolicy approvalPolicy;
    private final Outbox outbox;

    @Override
    public ApprovalResult approve(ApproveCaseCommand command) {
        RegulatoryCase regulatoryCase = caseRepository.findRequired(command.caseId());

        approvalPolicy.ensureCanApprove(
            regulatoryCase,
            command.actorId(),
            command.now()
        );

        regulatoryCase.approve(command.reason(), command.now());
        caseRepository.save(regulatoryCase);

        outbox.add(CaseApprovedEvent.from(regulatoryCase));

        return ApprovalResult.approved(regulatoryCase.id());
    }
}
```

Decorator chain:

```text
Metrics
  -> Logging
  -> Authorization
  -> Transaction
  -> DefaultCaseApprovalService
```

Possible implementation:

```java
CaseApprovalService service =
    new MetricsCaseApprovalService(
        new LoggingCaseApprovalService(
            new AuthorizationCaseApprovalProxy(
                new TransactionalCaseApprovalService(
                    new DefaultCaseApprovalService(repository, policy, outbox),
                    transactionManager
                ),
                permissionChecker,
                currentUserProvider
            ),
            log
        ),
        metrics
    );
```

But review the order.

This order means:

```text
Metrics measures everything.
Logging logs authorization failure too.
Authorization happens before transaction.
Transaction wraps only core mutation and outbox insert.
```

That is usually good.

If transaction was outside authorization:

```text
Transaction -> Authorization -> Core
```

then forbidden request opens transaction unnecessarily.

If authorization was inside core only, generic permission bypass risk depends on entrypoint discipline.

---

### 17.3 Audit Placement

Audit has two types:

1. **Security audit** — unauthorized attempt, login, permission denial.
2. **Domain audit** — case approved, case rejected, sanction issued.

Security audit can be in authorization proxy/interceptor.

Domain audit should often be part of domain/application operation or outbox event, because it must align with transaction state.

Wrong:

```text
Logging decorator writes domain audit before transaction commits.
```

If transaction rolls back, audit says approved even though data not approved.

Better:

```text
Domain audit record written inside transaction or emitted post-commit from committed outbox.
```

---

### 17.4 Final Shape

```text
Request boundary
  -> Correlation middleware
  -> Authentication middleware
  -> API validation
  -> Application service proxy chain
       -> Metrics
       -> Logging
       -> Authorization
       -> Transaction
       -> Core application service
            -> load aggregate
            -> domain policy
            -> state transition
            -> repository save
            -> outbox insert
  -> Response mapper
```

This design separates:

```text
transport concern
security concern
application orchestration
domain decision
persistence boundary
integration side effect
observability
```

---

## 18. Practical Heuristics

### 18.1 Use Decorator When

```text
Use Decorator when you need explicit, composable behavior around one abstraction.
```

Good for:

1. client-specific metrics,
2. cache around lookup,
3. retry around external client,
4. logging around gateway,
5. validation around command handler,
6. encryption/compression stream.

---

### 18.2 Use Proxy When

```text
Use Proxy when access/control/indirection is the main concern.
```

Good for:

1. authorization,
2. lazy loading,
3. remote service access,
4. transaction control,
5. resource lifecycle,
6. security boundary.

---

### 18.3 Use Interceptor When

```text
Use Interceptor when the same cross-cutting behavior applies to many join points.
```

Good for:

1. tracing all endpoints,
2. metrics all handlers,
3. transaction around annotated methods,
4. request validation,
5. authentication extraction.

---

### 18.4 Use Middleware Chain When

```text
Use Middleware Chain when request/command processing has ordered stages and possible short-circuit.
```

Good for:

1. HTTP request pipeline,
2. command bus,
3. message consumer pipeline,
4. API gateway processing,
5. security filter chain.

---

### 18.5 Prefer Explicit Class for Critical Behavior

For critical behavior like:

1. authorization,
2. transaction,
3. retry,
4. payment idempotency,
5. audit,
6. external side effect,

prefer explicit classes/tests over clever anonymous wrappers.

Lambda is concise, but not always clearer.

---

### 18.6 Make Order a First-Class Design Artifact

Document chains like this:

```text
ApprovalService chain:
1. MetricsApprovalService
2. LoggingApprovalService
3. AuthorizationApprovalProxy
4. TransactionalApprovalService
5. DefaultApprovalService
```

Also document why:

```text
Authorization is outside transaction to avoid opening transaction for forbidden request.
Transaction wraps core mutation and outbox insert to keep state/event atomic.
Metrics is outermost to measure total logical operation latency.
```

This is senior-level design clarity.

---

## 19. Common Interview / Staff-Level Discussion

### 19.1 “What is the difference between Decorator and Proxy?”

Strong answer:

```text
They are structurally similar because both wrap another object behind the same interface. The difference is intent. Decorator adds behavior while preserving the same conceptual object. Proxy controls access or adds indirection to the object: lazy loading, remote access, security, transaction, or lifecycle. In real systems the boundary can blur, so I look at whether the wrapper enriches behavior or governs access.
```

---

### 19.2 “Why can @Transactional fail when called from the same class?”

Strong answer:

```text
In proxy-based AOP, the transactional behavior is applied when the call goes through the proxy. A self-invocation like this.someTransactionalMethod() bypasses the proxy because it is a direct call on the target instance. Therefore the interceptor is not invoked. The design fix is usually to move the transactional boundary to the external entry method or split the method into another bean/service, not to rely on self-proxy hacks.
```

---

### 19.3 “Where should retry be placed relative to transaction?”

Strong answer:

```text
Usually retry should be outside the transaction so each attempt gets a fresh transaction. If retry is inside a transaction, the transaction may already be rollback-only or contain inconsistent persistence context state after the first failure. But the correct answer depends on the operation semantics, idempotency, and failure type.
```

---

### 19.4 “Why is cache before authorization dangerous?”

Strong answer:

```text
If the cache key does not include security context, a response computed for one user can be served to another user before permission is checked. For sensitive resources, authorization should happen before cache lookup, or the cache key must include all relevant permission dimensions, or the cached data must be public/non-sensitive.
```

---

### 19.5 “When is annotation-based interceptor bad?”

Strong answer:

```text
Annotation-based interceptors become problematic when they hide domain semantics, have unclear order, depend on fragile parameter binding, or make behavior impossible to understand without framework internals. They are good for stable cross-cutting infrastructure concerns, but poor for complex business rules that need explicit policy objects and domain tests.
```

---

## 20. Final Summary

Decorator, Proxy, Interceptor, dan Middleware Chain adalah pattern yang sangat kuat karena mereka memungkinkan behavior tambahan dipisahkan dari core logic.

Namun kekuatan itu datang dengan risiko:

```text
The more invisible the behavior, the more disciplined the design must be.
```

Ringkasan per pattern:

```text
Decorator:
  Menambah behavior secara eksplisit melalui composition.

Proxy:
  Mengontrol akses, lifecycle, indirection, atau remote/lazy behavior.

Interceptor:
  Menyisipkan behavior pada join point menggunakan invocation context.

Middleware Chain:
  Menyusun request/command melalui ordered pipeline yang bisa melanjutkan atau menghentikan proses.
```

Rule penting:

1. Jangan menilai pattern dari bentuk kode saja; lihat intent.
2. Order adalah bagian dari contract.
3. Logging tidak boleh mengubah semantic.
4. Retry tanpa idempotency berbahaya.
5. Cache sebelum authorization bisa menjadi security bug.
6. Transaction tidak boleh sembarangan membungkus external call.
7. Annotation magic harus dibatasi.
8. Proxy behavior harus diuji dengan integration test.
9. Middleware context sebaiknya typed dan immutable.
10. Critical behavior harus visible, testable, dan documented.

Pattern mastery pada area ini berarti kamu bukan hanya bisa menulis wrapper, tetapi bisa menjawab:

```text
Apa behavior tambahan yang sedang dimasukkan?
Di layer mana ia seharusnya berada?
Apakah order-nya benar?
Apakah failure semantic-nya benar?
Apakah security-nya aman?
Apakah observability-nya cukup?
Apakah developer lain bisa memahami runtime behavior-nya?
```

Itulah perbedaan antara sekadar memakai framework dan benar-benar menguasai desain sistem Java enterprise.

---

## 21. Status Seri

```text
Part 8 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
09-structural-composite-bridge-flyweight-module-boundary.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./07-structural-adapter-facade-gateway-anti-corruption-layer.md">⬅️ Structural Pattern I: Adapter, Facade, Gateway, Anti-Corruption Layer</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./09-structural-composite-bridge-flyweight-module-boundary.md">Structural Pattern III: Composite, Bridge, Flyweight, Module Boundary ➡️</a>
</div>

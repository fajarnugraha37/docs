# Part 10 — CompletableFuture in Jakarta EE Without Breaking the Container

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `10-completablefuture-in-jakarta-ee.md`  
**Target:** Java 8–25, Java EE/Jakarta EE, `javax.enterprise.concurrent` sampai `jakarta.enterprise.concurrent`  
**Baseline modern:** Jakarta EE 11, Jakarta Concurrency 3.1, Java 21+ aware  
**Topik utama:** memakai `CompletableFuture` di aplikasi Jakarta EE tanpa keluar dari kontrak container.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan bisa:

1. Memahami kenapa `CompletableFuture` yang aman di Java SE bisa menjadi bermasalah di Jakarta EE bila executor tidak dikontrol.
2. Membedakan stage synchronous dan asynchronous dalam chain `CompletableFuture`.
3. Menjelaskan kenapa `ForkJoinPool.commonPool()` sering salah untuk application server.
4. Mendesain fan-out/fan-in di REST/service layer menggunakan `ManagedExecutorService`.
5. Menjaga container context, security context, MDC/correlation ID, classloader, naming context, dan lifecycle tetap valid.
6. Mendesain timeout, cancellation, retry, dan error aggregation pada async chain.
7. Menghindari starvation, deadlock, queue explosion, dan accidental blocking.
8. Menggunakan `CompletionStage` sebagai boundary API tanpa membocorkan detail implementation.
9. Menilai kapan `CompletableFuture` cukup, kapan perlu Jakarta Batch, messaging, workflow engine, atau external orchestrator.
10. Membuat pola production-grade untuk async orchestration di Jakarta EE.

---

## 2. Problem yang Diselesaikan

`CompletableFuture` membuat asynchronous composition terlihat mudah:

```java
CompletableFuture
    .supplyAsync(() -> callServiceA())
    .thenCombine(
        CompletableFuture.supplyAsync(() -> callServiceB()),
        this::merge
    )
    .thenApply(this::transform);
```

Di Java SE biasa, kode seperti ini bisa berjalan. Di Jakarta EE, kode ini memiliki beberapa pertanyaan serius:

1. Thread mana yang menjalankan task?
2. Apakah thread itu dikelola container?
3. Apakah security context tersedia?
4. Apakah CDI context valid?
5. Apakah classloader aplikasi benar?
6. Apakah logging correlation ID ikut terbawa?
7. Apakah transaction context sengaja dipisah?
8. Apakah task akan berhenti saat aplikasi undeploy?
9. Apakah executor bisa diobservasi dan dikonfigurasi operator?
10. Apakah fan-out task bisa membanjiri DB/API downstream?

Masalahnya bukan pada `CompletableFuture` sebagai API. Masalahnya adalah **default execution model**-nya tidak otomatis sesuai dengan contract Jakarta EE.

Dalam enterprise container, async composition harus selalu menjawab:

> “Siapa yang memiliki thread, context apa yang valid, kapan task boleh hidup, dan bagaimana task gagal dengan aman?”

---

## 3. Mental Model Inti

### 3.1 `CompletableFuture` adalah composition abstraction, bukan execution governance

`CompletableFuture` membantu menyusun dependency antar operasi asynchronous:

- operasi A lalu B
- operasi A dan B paralel lalu digabung
- operasi A atau B mana yang selesai dulu
- fallback jika gagal
- transform result
- compose future lain
- tunggu semua selesai
- batalkan chain

Namun `CompletableFuture` **tidak secara otomatis** menjawab:

- pool mana yang dipakai
- berapa concurrency limit
- apakah context propagated
- apakah task durable
- apakah task restartable
- apakah task cluster-aware
- apakah ada audit trail
- apakah aman saat redeploy

Maka mental model yang benar:

```text
CompletableFuture = graph komposisi asynchronous
Executor          = kapasitas eksekusi
ContextService    = context bridge
Container         = lifecycle + resource governance
Application       = business invariant + error semantics
```

Kesalahan umum adalah menganggap `CompletableFuture` sebagai “solusi async lengkap”. Sebenarnya ia hanya salah satu layer.

---

### 3.2 Async boundary adalah boundary semantik

Saat kode melewati async boundary, kamu tidak hanya pindah thread. Kamu juga berpotensi pindah:

- transaction lifetime
- request lifetime
- CDI context lifetime
- security identity lifetime
- logging context lifetime
- error propagation path
- cancellation path
- resource ownership
- observability boundary

Contoh synchronous call:

```text
HTTP request thread
  -> service method
     -> repository
     -> external API
  -> response
```

Error, transaction, security, dan logging berada dalam satu flow yang relatif linear.

Contoh async fan-out:

```text
HTTP request thread
  -> submit task A
  -> submit task B
  -> return CompletionStage/response later

managed worker thread A
  -> call API A

managed worker thread B
  -> call API B

completion thread
  -> merge result
```

Sekarang kamu harus bertanya:

- request sudah selesai atau belum saat A/B berjalan?
- apakah user identity masih valid?
- apakah transaction masih sama?
- jika task B gagal, apakah A dibatalkan?
- jika client disconnect, apakah task masih perlu berjalan?
- jika pod shutdown, apa yang terjadi?

---

### 3.3 Synchronous stage vs asynchronous stage

`CompletableFuture` punya dua keluarga method besar:

1. **Non-Async methods**
   - `thenApply`
   - `thenCompose`
   - `thenAccept`
   - `thenRun`
   - `thenCombine`
   - `handle`
   - `whenComplete`

2. **Async methods**
   - `thenApplyAsync`
   - `thenComposeAsync`
   - `thenAcceptAsync`
   - `thenRunAsync`
   - `thenCombineAsync`
   - `handleAsync`
   - `whenCompleteAsync`

Perbedaannya penting.

Non-async stage biasanya dijalankan oleh thread yang menyelesaikan stage sebelumnya. Artinya, jika stage sebelumnya selesai di managed worker thread, lanjutan non-async bisa berjalan di thread itu. Jika stage sebelumnya sudah selesai saat stage didaftarkan, stage bisa berjalan di caller thread.

Async stage tanpa executor eksplisit memakai default executor `CompletableFuture`. Pada Java SE, ini biasanya `ForkJoinPool.commonPool()` bila parallelism memadai.

Dalam Jakarta EE, penggunaan async method tanpa executor eksplisit adalah sumber bug besar.

```java
// Bermasalah di Jakarta EE jika tidak sengaja memakai commonPool
future.thenApplyAsync(this::transform);
```

Lebih aman:

```java
future.thenApplyAsync(this::transform, managedExecutor);
```

Rule praktis:

> Di Jakarta EE, setiap method `*Async` harus membuat kamu bertanya: “executor mana yang akan menjalankan ini?”

---

## 4. Kenapa `ForkJoinPool.commonPool()` Sering Salah di Jakarta EE

### 4.1 Common pool bukan milik application server

`ForkJoinPool.commonPool()` adalah pool global JVM. Ia bukan resource aplikasi Jakarta EE. Ia tidak dibuat, dikonfigurasi, dimonitor, atau dihentikan sebagai resource container aplikasi.

Dampaknya:

- container tidak tahu workload aplikasi memakai thread global itu
- task bisa hidup melewati lifecycle aplikasi
- context container tidak otomatis valid
- classloader leak lebih mungkin terjadi
- observability runtime menjadi kabur
- kapasitas pool dipakai bersama oleh kode lain dalam JVM
- tuning per aplikasi sulit

Pada application server multi-application, ini sangat berbahaya. Satu aplikasi bisa mengganggu aplikasi lain.

---

### 4.2 Common pool dioptimalkan untuk CPU-ish fork/join, bukan semua enterprise I/O

`ForkJoinPool` ideal untuk task kecil yang bisa dipecah dan digabung. Banyak workload enterprise bukan seperti itu:

- blocking JDBC call
- blocking HTTP client call
- file I/O
- remote service call
- waiting on lock
- waiting on database connection

Jika kamu menaruh blocking workload berat ke common pool, kamu bisa membuat pool starvation.

Contoh buruk:

```java
CompletableFuture<UserProfile> profile = CompletableFuture.supplyAsync(() -> {
    // Blocking DB + blocking external API
    User user = userRepository.findById(userId);
    RiskScore score = riskApi.getRiskScore(user.getIdentityNo());
    return mapper.toProfile(user, score);
});
```

Masalah:

- executor tidak eksplisit
- blocking I/O di common pool
- transaction/security/CDI context tidak jelas
- sulit dibatalkan
- sulit diobservasi

---

### 4.3 Common pool tidak tahu business bulkhead

Enterprise workload biasanya perlu isolasi:

```text
Executor A: request fan-out to downstream read API
Executor B: document generation
Executor C: notification sending
Executor D: low-priority report calculation
Executor E: admin maintenance task
```

Jika semuanya memakai common pool:

```text
commonPool
  ├── read API fan-out
  ├── document generation
  ├── report calculation
  ├── notifications
  └── random library async task
```

maka tidak ada fairness. Workload lambat bisa menghabiskan kapasitas workload penting.

Top-tier engineer tidak hanya bertanya “bisa async?” tetapi:

> “Async capacity ini milik workload mana, limit-nya berapa, siapa yang boleh memakainya, dan apa yang dikorbankan saat overload?”

---

## 5. Jakarta EE Rule: Pakai Managed Executor

### 5.1 Baseline pattern

Di Jakarta EE, gunakan `ManagedExecutorService` untuk menjalankan stage asynchronous.

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.concurrent.ManagedExecutorService;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;

@ApplicationScoped
public class CustomerAsyncService {

    @Resource
    private ManagedExecutorService executor;

    public CompletionStage<CustomerView> loadCustomerView(String customerId) {
        CompletableFuture<Customer> customerFuture = CompletableFuture.supplyAsync(
            () -> loadCustomer(customerId),
            executor
        );

        CompletableFuture<List<Order>> ordersFuture = CompletableFuture.supplyAsync(
            () -> loadOrders(customerId),
            executor
        );

        return customerFuture.thenCombineAsync(
            ordersFuture,
            this::toView,
            executor
        );
    }

    private Customer loadCustomer(String customerId) {
        // repository / external API call
        return null;
    }

    private List<Order> loadOrders(String customerId) {
        // repository / external API call
        return List.of();
    }

    private CustomerView toView(Customer customer, List<Order> orders) {
        return new CustomerView(customer, orders);
    }
}
```

Hal penting:

- `supplyAsync(..., executor)` eksplisit
- `thenCombineAsync(..., executor)` eksplisit
- return type memakai `CompletionStage`, bukan harus `CompletableFuture`
- caller tidak diberi kuasa menyelesaikan future secara manual

---

### 5.2 Return `CompletionStage`, bukan selalu `CompletableFuture`

`CompletableFuture` adalah concrete mutable implementation. `CompletionStage` adalah abstraction untuk composition.

Lebih baik expose:

```java
public CompletionStage<CustomerView> loadCustomerView(String customerId)
```

daripada:

```java
public CompletableFuture<CustomerView> loadCustomerView(String customerId)
```

Kenapa?

Karena `CompletableFuture` punya method mutasi:

```java
future.complete(value);
future.completeExceptionally(error);
future.cancel(true);
```

Jika API service mengembalikan `CompletableFuture`, caller bisa tergoda mengubah completion state. `CompletionStage` memperkecil surface area.

Rule:

> Gunakan `CompletionStage` sebagai API contract, gunakan `CompletableFuture` sebagai implementation detail.

---

### 5.3 Jangan mencampur executor sembarangan

Contoh yang tampak benar tapi diam-diam salah:

```java
CompletableFuture<Result> f = CompletableFuture
    .supplyAsync(this::loadA, managedExecutor)
    .thenApplyAsync(this::transform) // lupa executor
    .thenApply(this::finalizeResult);
```

`thenApplyAsync(this::transform)` tanpa executor eksplisit dapat memakai default executor. Chain sekarang berpindah keluar dari managed executor.

Versi benar:

```java
CompletableFuture<Result> f = CompletableFuture
    .supplyAsync(this::loadA, managedExecutor)
    .thenApplyAsync(this::transform, managedExecutor)
    .thenApply(this::finalizeResult);
```

Atau jika transform kecil, non-blocking, dan aman dijalankan di completion thread:

```java
CompletableFuture<Result> f = CompletableFuture
    .supplyAsync(this::loadA, managedExecutor)
    .thenApply(this::transform)
    .thenApply(this::finalizeResult);
```

---

## 6. Method Semantics yang Harus Dikuasai

### 6.1 `supplyAsync`

Dipakai untuk memulai async computation yang menghasilkan nilai.

```java
CompletableFuture<User> userFuture = CompletableFuture.supplyAsync(
    () -> userRepository.findById(userId),
    executor
);
```

Gunakan untuk:

- DB read yang memang ingin dioffload
- external API call
- file read
- CPU computation kecil/medium jika executor sesuai

Hindari untuk:

- long-running durable job
- operation yang harus restartable
- side effect besar tanpa idempotency
- task yang durasinya tidak jelas

---

### 6.2 `runAsync`

Dipakai untuk task tanpa result.

```java
CompletableFuture<Void> auditFuture = CompletableFuture.runAsync(
    () -> auditService.writeAsyncAudit(event),
    executor
);
```

Hati-hati: “tanpa result” bukan berarti “tanpa error”. Error tetap harus ditangani.

```java
auditFuture.exceptionally(error -> {
    log.error("Failed to write audit event", error);
    return null;
});
```

Untuk side effect penting, jangan hanya fire-and-forget. Gunakan outbox atau durable job request.

---

### 6.3 `thenApply`

Transformasi synchronous terhadap result.

```java
CompletionStage<CustomerDto> dto = customerFuture
    .thenApply(customerMapper::toDto);
```

Cocok untuk:

- mapping ringan
- validation ringan
- filtering ringan
- object assembly kecil

Tidak cocok untuk:

- blocking I/O
- call external API
- DB query
- computation berat

Karena `thenApply` berjalan di thread yang menyelesaikan stage sebelumnya. Jika kamu menaruh blocking operation di sana, kamu menahan completion thread.

---

### 6.4 `thenApplyAsync`

Transformasi yang dijadwalkan ke executor.

```java
CompletionStage<CustomerDto> dto = customerFuture
    .thenApplyAsync(customerMapper::toDto, executor);
```

Gunakan jika:

- transform cukup berat
- kamu ingin memisahkan stage execution
- kamu perlu memastikan stage berjalan dalam managed executor

Namun jangan otomatis memakai `Async` untuk semua stage. Setiap hop executor punya overhead dan bisa memperpanjang latency.

---

### 6.5 `thenCompose`

Flatten dependent asynchronous operation.

Contoh salah:

```java
CompletionStage<CompletionStage<RiskScore>> nested = userFuture
    .thenApply(user -> riskService.loadRisk(user.id()));
```

Contoh benar:

```java
CompletionStage<RiskScore> risk = userFuture
    .thenCompose(user -> riskService.loadRisk(user.id()));
```

`thenCompose` dipakai ketika stage berikutnya sendiri menghasilkan `CompletionStage`.

Mental model:

```text
thenApply   : T -> U
thenCompose : T -> CompletionStage<U>, lalu flatten menjadi CompletionStage<U>
```

---

### 6.6 `thenCombine`

Gabungkan dua independent futures.

```java
CompletionStage<CustomerView> view = customerFuture
    .thenCombine(ordersFuture, CustomerView::new);
```

Cocok untuk fan-out/fan-in:

```text
        ┌── load customer ──┐
request │                   ├── combine -> response
        └── load orders ────┘
```

Hati-hati:

- jika salah satu gagal, combined future gagal
- future lain tidak otomatis dibatalkan
- timeout harus dipikirkan per branch dan total

---

### 6.7 `allOf`

Menunggu semua future selesai.

```java
CompletableFuture<Void> all = CompletableFuture.allOf(
    customerFuture,
    ordersFuture,
    riskFuture
);
```

Masalah `allOf`: result-nya `Void`. Kamu harus mengambil result masing-masing future.

Pattern:

```java
CompletionStage<CustomerAggregate> aggregate = CompletableFuture
    .allOf(customerFuture, ordersFuture, riskFuture)
    .thenApply(ignored -> new CustomerAggregate(
        customerFuture.join(),
        ordersFuture.join(),
        riskFuture.join()
    ));
```

`join()` di atas aman hanya karena `allOf` sudah memastikan semua selesai. Namun exception handling tetap perlu rapi.

---

### 6.8 `anyOf`

Menunggu salah satu future selesai.

```java
CompletableFuture<Object> first = CompletableFuture.anyOf(cacheFuture, dbFuture);
```

Cocok untuk:

- hedged request
- fastest source wins
- fallback race

Tapi hati-hati:

- future yang kalah tidak otomatis dibatalkan
- side effect bisa tetap berjalan
- resource tetap dipakai
- result type menjadi `Object`

Pattern safer:

```java
CompletableFuture<Response> primary = callPrimary();
CompletableFuture<Response> secondary = callSecondary();

CompletableFuture<Response> first = primary.applyToEither(secondary, Function.identity());

first.whenComplete((result, error) -> {
    if (!primary.isDone()) {
        primary.cancel(true);
    }
    if (!secondary.isDone()) {
        secondary.cancel(true);
    }
});
```

Tetap ingat: cancellation di Java cooperative. Jika task sedang blocking di HTTP call tanpa timeout, cancel mungkin tidak langsung menghentikan I/O.

---

### 6.9 `exceptionally`

Fallback jika stage gagal.

```java
CompletionStage<RiskScore> risk = riskFuture
    .exceptionally(error -> RiskScore.unknown());
```

Cocok untuk fallback lokal.

Namun jangan sembunyikan error penting:

```java
.exceptionally(error -> null)
```

Ini anti-pattern karena mengubah failure menjadi null tanpa audit.

Lebih baik:

```java
.exceptionally(error -> {
    log.warn("Risk service failed. Falling back to UNKNOWN", error);
    return RiskScore.unknown();
});
```

---

### 6.10 `handle`

Mengubah success atau failure menjadi result baru.

```java
CompletionStage<RiskResult> result = riskFuture.handle((score, error) -> {
    if (error != null) {
        return RiskResult.unavailable(error);
    }
    return RiskResult.available(score);
});
```

`handle` cocok saat failure adalah bagian dari domain result.

Contoh regulatory system:

```text
External registry unavailable
!= application crash always
= eligibility decision may be PENDING_EXTERNAL_VERIFICATION
```

Dengan `handle`, kamu bisa menjaga domain state eksplisit.

---

### 6.11 `whenComplete`

Side effect saat selesai, tanpa mengubah result normal.

```java
CompletionStage<CustomerView> view = aggregateFuture
    .whenComplete((result, error) -> {
        metrics.recordCompletion(error == null);
    });
```

Cocok untuk:

- logging
- metrics
- cleanup ringan

Jangan taruh business mutation penting di `whenComplete` kecuali kamu sangat paham semantics-nya.

Jika `whenComplete` melempar exception, ia bisa memengaruhi chain.

---

### 6.12 `orTimeout` dan `completeOnTimeout`

Mulai Java 9, `CompletableFuture` memiliki timeout helper:

```java
future.orTimeout(2, TimeUnit.SECONDS);
```

atau fallback value:

```java
future.completeOnTimeout(defaultValue, 2, TimeUnit.SECONDS);
```

Hati-hati:

- timeout pada future tidak selalu menghentikan underlying task
- I/O client tetap harus punya timeout sendiri
- DB query timeout tetap harus dikonfigurasi
- transaction timeout tetap harus dikonfigurasi

Timeout harus berlapis:

```text
HTTP client timeout
  <= branch future timeout
     <= aggregate timeout
        <= request timeout
           <= load balancer timeout
```

---

## 7. Enterprise Fan-Out/Fan-In Pattern

### 7.1 Problem

Satu endpoint perlu mengambil data dari beberapa sumber:

```text
GET /cases/{caseId}/overview

Needs:
- case core data
- parties
- open tasks
- enforcement history
- external registry status
- risk indicator
```

Jika semua synchronous sequential:

```text
case -> parties -> tasks -> history -> registry -> risk
```

Latency total = jumlah semua latency.

Jika independent, bisa fan-out:

```text
             ┌─ case data
             ├─ parties
request ─────┼─ tasks
             ├─ history
             ├─ registry
             └─ risk
                  ↓
              aggregate
```

Namun fan-out tidak boleh liar.

---

### 7.2 Implementation pattern

```java
@ApplicationScoped
public class CaseOverviewService {

    @Resource(lookup = "java:comp/DefaultManagedExecutorService")
    ManagedExecutorService executor;

    public CompletionStage<CaseOverview> loadOverview(String caseId) {
        CompletableFuture<CaseCore> caseFuture = supplyManaged(() -> loadCase(caseId));
        CompletableFuture<List<Party>> partiesFuture = supplyManaged(() -> loadParties(caseId));
        CompletableFuture<List<Task>> tasksFuture = supplyManaged(() -> loadOpenTasks(caseId));
        CompletableFuture<List<EnforcementEvent>> historyFuture = supplyManaged(() -> loadHistory(caseId));
        CompletableFuture<RegistryStatus> registryFuture = supplyManaged(() -> loadRegistry(caseId))
            .completeOnTimeout(RegistryStatus.timeout(), 1500, TimeUnit.MILLISECONDS)
            .exceptionally(this::registryFallback);

        return CompletableFuture
            .allOf(caseFuture, partiesFuture, tasksFuture, historyFuture, registryFuture)
            .thenApplyAsync(ignored -> new CaseOverview(
                caseFuture.join(),
                partiesFuture.join(),
                tasksFuture.join(),
                historyFuture.join(),
                registryFuture.join()
            ), executor);
    }

    private <T> CompletableFuture<T> supplyManaged(Supplier<T> supplier) {
        return CompletableFuture.supplyAsync(supplier, executor);
    }

    private RegistryStatus registryFallback(Throwable error) {
        return RegistryStatus.unavailable(rootMessage(error));
    }
}
```

Catatan:

- helper `supplyManaged` mencegah lupa executor
- semua branch independent berjalan di managed executor
- branch registry punya fallback domain
- aggregate stage juga eksplisit pakai executor

---

### 7.3 Problem tersembunyi dari fan-out

Fan-out mengurangi latency per request, tetapi meningkatkan concurrency pressure.

Jika satu request membuat 6 parallel calls:

```text
100 concurrent requests x 6 branches = 600 concurrent branch executions
```

Jika setiap branch memakai DB connection:

```text
600 potential DB operations
```

Padahal connection pool mungkin hanya 80.

Maka fan-out harus didesain dengan limit:

```text
max request concurrency
x branch count
x downstream latency
<= downstream safe capacity
```

Top-tier engineer tidak hanya melihat satu request lebih cepat. Ia menghitung efek sistemik.

---

## 8. Context Propagation dalam CompletableFuture Chain

### 8.1 Managed executor memberi baseline context propagation

`ManagedExecutorService` menjalankan task dengan thread yang dikelola container. Container dapat melakukan propagation context tertentu sesuai spesifikasi dan konfigurasi resource.

Context yang relevan:

- application component context
- classloader
- naming context
- security context
- possibly configured context types depending runtime

Namun jangan mengasumsikan semua context aplikasi otomatis ikut.

Contoh context aplikasi:

- correlation ID
- tenant ID
- request ID
- user display name
- audit actor snapshot
- feature flag snapshot
- locale
- client channel

Biasanya ini hidup di MDC, ThreadLocal, request attribute, atau custom context holder. Itu perlu desain eksplisit.

---

### 8.2 Snapshot, jangan referensi mutable request object

Buruk:

```java
public CompletionStage<Void> process(HttpServletRequest request) {
    return CompletableFuture.runAsync(() -> {
        String userAgent = request.getHeader("User-Agent");
        // request object mungkin sudah invalid
    }, executor);
}
```

Lebih benar:

```java
public CompletionStage<Void> process(HttpServletRequest request) {
    RequestSnapshot snapshot = RequestSnapshot.from(request);

    return CompletableFuture.runAsync(() -> {
        processWith(snapshot);
    }, executor);
}
```

Snapshot harus immutable:

```java
public record RequestSnapshot(
    String correlationId,
    String userId,
    String ipAddress,
    String userAgent,
    Instant requestedAt
) {
    public static RequestSnapshot from(HttpServletRequest request) {
        return new RequestSnapshot(
            request.getHeader("X-Correlation-ID"),
            request.getUserPrincipal() == null ? null : request.getUserPrincipal().getName(),
            request.getRemoteAddr(),
            request.getHeader("User-Agent"),
            Instant.now()
        );
    }
}
```

Rule:

> Async task jangan membawa object yang lifecycle-nya milik request thread. Bawa snapshot value, bukan live handle.

---

### 8.3 MDC propagation helper

Jika runtime tidak otomatis propagate MDC, buat wrapper.

```java
public final class MdcAwareSupplier<T> implements Supplier<T> {

    private final Map<String, String> capturedContext;
    private final Supplier<T> delegate;

    public MdcAwareSupplier(Supplier<T> delegate) {
        this.capturedContext = MDC.getCopyOfContextMap();
        this.delegate = delegate;
    }

    @Override
    public T get() {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            if (capturedContext == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(capturedContext);
            }
            return delegate.get();
        } finally {
            if (previous == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(previous);
            }
        }
    }
}
```

Usage:

```java
CompletableFuture.supplyAsync(
    new MdcAwareSupplier<>(() -> service.call(input)),
    executor
);
```

Namun hati-hati: custom ThreadLocal propagation harus dibatasi. Jangan propagate semua hal membabi buta. Beberapa context memang seharusnya tidak melewati async boundary.

---

### 8.4 ContextService untuk contextual function

Jakarta Concurrency menyediakan `ContextService` untuk membuat contextual proxy/function. Ini berguna ketika kamu perlu menjaga context saat callback dieksekusi oleh API yang menerima functional interface.

Sketsa:

```java
@Resource
ContextService contextService;

Function<Response, Dto> mapper = response -> toDto(response);

Function<Response, Dto> contextualMapper = contextService.contextualFunction(mapper);

CompletionStage<Dto> dto = responseFuture.thenApplyAsync(
    contextualMapper,
    executor
);
```

Gunakan ini saat kamu ingin callback membawa context container tertentu dengan lebih eksplisit.

Tetap pisahkan:

- container context
- application context
- domain audit snapshot

Jangan menyamakan semuanya.

---

## 9. Error Propagation and Failure Semantics

### 9.1 Exception dibungkus

`CompletableFuture` sering membungkus exception dalam:

- `CompletionException`
- `ExecutionException`

Helper unwrap:

```java
public static Throwable unwrapCompletion(Throwable error) {
    Throwable current = error;
    while (current instanceof CompletionException || current instanceof ExecutionException) {
        if (current.getCause() == null) {
            return current;
        }
        current = current.getCause();
    }
    return current;
}
```

Gunakan saat mapping error ke domain response.

---

### 9.2 Jangan fallback semua error

Buruk:

```java
return future.exceptionally(error -> defaultValue);
```

Ini menyamakan:

- timeout
- authorization failure
- validation bug
- database corruption
- coding bug
- network blip

Lebih baik klasifikasikan:

```java
return future.exceptionally(error -> {
    Throwable root = unwrapCompletion(error);

    if (root instanceof TimeoutException) {
        return fallbackForTimeout();
    }

    if (root instanceof ExternalServiceUnavailableException) {
        return fallbackForUnavailableService();
    }

    if (root instanceof AccessDeniedException) {
        throw new CompletionException(root);
    }

    throw new CompletionException(root);
});
```

Domain serius membutuhkan failure semantics eksplisit.

---

### 9.3 Partial failure model

Dalam fan-out, tidak semua branch punya criticality yang sama.

Contoh case overview:

| Branch | Critical? | Failure Behavior |
|---|---:|---|
| Case core | Yes | fail whole response |
| Parties | Yes | fail whole response |
| Open tasks | Medium | return partial with warning |
| External registry | No/Medium | return unavailable status |
| Risk score | Depends | pending risk evaluation |

Maka jangan pakai satu blanket `allOf` tanpa domain model.

Lebih baik bungkus branch menjadi `BranchResult<T>`:

```java
public sealed interface BranchResult<T> permits BranchResult.Success, BranchResult.Failure {

    record Success<T>(T value) implements BranchResult<T> {}

    record Failure<T>(String code, String message, Throwable cause) implements BranchResult<T> {}

    static <T> BranchResult<T> success(T value) {
        return new Success<>(value);
    }

    static <T> BranchResult<T> failure(String code, String message, Throwable cause) {
        return new Failure<>(code, message, cause);
    }
}
```

Helper:

```java
private <T> CompletableFuture<BranchResult<T>> safeBranch(Supplier<T> supplier, String code) {
    return CompletableFuture
        .supplyAsync(supplier, executor)
        .<BranchResult<T>>thenApply(BranchResult::success)
        .exceptionally(error -> BranchResult.failure(
            code,
            unwrapCompletion(error).getMessage(),
            unwrapCompletion(error)
        ));
}
```

Dengan ini, aggregate bisa mengambil keputusan domain.

---

## 10. Timeout Design

### 10.1 Timeout bukan satu angka

Untuk endpoint async fan-out, timeout perlu disusun seperti budget.

Contoh:

```text
Client timeout             : 10s
Load balancer idle timeout : 60s
Server request timeout     : 8s
Aggregate future timeout   : 7s
Branch API timeout         : 2s
DB query timeout           : 3s
Connection acquisition     : 500ms
```

Kalau branch API timeout 30s tapi request timeout 8s, maka task bisa terus berjalan setelah request gagal. Ini membuang resource.

---

### 10.2 Branch timeout vs aggregate timeout

Branch timeout:

```java
CompletableFuture<RegistryStatus> registry = CompletableFuture
    .supplyAsync(() -> registryClient.lookup(caseId), executor)
    .orTimeout(2, TimeUnit.SECONDS)
    .exceptionally(this::registryFallback);
```

Aggregate timeout:

```java
CompletionStage<Overview> overview = CompletableFuture
    .allOf(a, b, c)
    .orTimeout(5, TimeUnit.SECONDS)
    .thenApply(ignored -> assemble(a, b, c));
```

Keduanya berbeda:

- branch timeout mencegah satu dependency lambat mengganggu keseluruhan
- aggregate timeout membatasi total user-visible latency

---

### 10.3 Timeout tidak otomatis menghentikan I/O

`orTimeout` menyelesaikan future dengan timeout exception. Underlying task bisa masih berjalan.

Maka HTTP client harus punya timeout sendiri:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofMillis(500))
    .build();

HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(Duration.ofSeconds(2))
    .GET()
    .build();
```

JDBC juga butuh query timeout:

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setQueryTimeout(3);
    // execute
}
```

JPA provider biasanya punya query hint timeout vendor-specific atau Jakarta Persistence hint, tergantung provider dan versi.

---

## 11. Cancellation Semantics

### 11.1 `cancel(true)` bukan kill switch

```java
future.cancel(true);
```

Ini mencoba membatalkan future. Jika task sudah berjalan, cancellation bergantung pada cooperation:

- apakah thread interruption diperhatikan?
- apakah blocking call interruptible?
- apakah HTTP/DB client bisa dibatalkan?
- apakah kode mengecek cancellation flag?

Jangan desain sistem penting dengan asumsi cancel selalu menghentikan work.

---

### 11.2 Cooperative cancellation

Contoh task yang memproses banyak item:

```java
public BatchPreview calculatePreview(List<Item> items) {
    List<Result> results = new ArrayList<>();

    for (Item item : items) {
        if (Thread.currentThread().isInterrupted()) {
            throw new CancellationException("Preview calculation cancelled");
        }

        results.add(process(item));
    }

    return new BatchPreview(results);
}
```

Untuk work yang lebih formal, gunakan cancellation token:

```java
public final class CancellationToken {
    private final AtomicBoolean cancelled = new AtomicBoolean(false);

    public void cancel() {
        cancelled.set(true);
    }

    public boolean isCancelled() {
        return cancelled.get();
    }

    public void throwIfCancelled() {
        if (cancelled.get()) {
            throw new CancellationException("Operation cancelled");
        }
    }
}
```

---

### 11.3 Cancel sibling branch saat aggregate gagal

Jika salah satu critical branch gagal, mungkin branch lain tidak perlu lanjut.

```java
CompletableFuture<CaseCore> core = supplyManaged(() -> loadCore(caseId));
CompletableFuture<List<Party>> parties = supplyManaged(() -> loadParties(caseId));
CompletableFuture<RiskScore> risk = supplyManaged(() -> loadRisk(caseId));

CompletableFuture<CaseOverview> overview = core
    .thenCombine(parties, PartialOverview::new)
    .thenCombine(risk, CaseOverview::new);

overview.whenComplete((result, error) -> {
    if (error != null) {
        core.cancel(true);
        parties.cancel(true);
        risk.cancel(true);
    }
});
```

Ini tidak sempurna, tetapi lebih baik daripada membiarkan sibling branch berjalan tanpa tujuan.

---

## 12. Blocking vs Non-Blocking dalam CompletableFuture

### 12.1 Jangan `get()`/`join()` sembarangan

Buruk:

```java
CompletableFuture<A> a = supplyManaged(this::loadA);
CompletableFuture<B> b = supplyManaged(this::loadB);

A resultA = a.join();
B resultB = b.join();
return merge(resultA, resultB);
```

Ini memblokir caller thread. Jika caller thread adalah request thread, kamu kehilangan manfaat async composition.

Lebih baik:

```java
return a.thenCombine(b, this::merge);
```

---

### 12.2 Deadlock karena executor kecil

Contoh buruk:

```java
// executor hanya punya 1 thread
CompletableFuture<A> a = CompletableFuture.supplyAsync(() -> {
    CompletableFuture<B> b = CompletableFuture.supplyAsync(this::loadB, executor);
    return combine(loadA(), b.join());
}, executor);
```

Jika executor hanya punya satu worker:

```text
worker-1 menjalankan task A
  -> submit task B ke executor yang sama
  -> join menunggu B
B tidak pernah jalan karena worker-1 sedang menunggu
```

Deadlock/starvation.

Rule:

> Jangan blocking wait terhadap task yang dijadwalkan ke executor yang sama, kecuali kamu benar-benar memahami kapasitas dan dependency graph.

---

### 12.3 Composition over blocking wait

Ubah:

```java
CompletableFuture<Result> result = CompletableFuture.supplyAsync(() -> {
    A a = loadA();
    B b = loadBAsync().join();
    return merge(a, b);
}, executor);
```

Menjadi:

```java
CompletableFuture<A> a = CompletableFuture.supplyAsync(this::loadA, executor);
CompletableFuture<B> b = CompletableFuture.supplyAsync(this::loadB, executor);

CompletionStage<Result> result = a.thenCombine(b, this::merge);
```

---

## 13. Thread Pool and Capacity Design

### 13.1 Managed executor tetap butuh sizing

Managed bukan berarti infinite. Managed executor tetap punya:

- max async workers
- queue capacity
- rejection policy
- hung task detection
- context propagation cost
- deployment-specific tuning

Jika semua `CompletableFuture` memakai default managed executor, kamu bisa tetap membuat bottleneck.

---

### 13.2 Pisahkan pool berdasarkan workload

Contoh workload:

| Workload | Characteristic | Executor |
|---|---|---|
| REST aggregation | short I/O | `overviewExecutor` |
| external registry calls | rate-limited I/O | `registryExecutor` |
| document generation | CPU + I/O | `documentExecutor` |
| notification sending | slow external I/O | `notificationExecutor` |
| admin maintenance | low priority | `maintenanceExecutor` |

Jangan semua disatukan.

---

### 13.3 Bulkhead mental model

```text
Bad:
one executor for everything

Good:
request-critical executor       max 40
external-api executor           max 20 + rate limit
document-generation executor    max 8
maintenance executor            max 2
```

Dengan bulkhead, document generation tidak membunuh request-critical endpoint.

---

### 13.4 Queue is latency debt

Queue panjang terlihat seperti kapasitas, padahal sering hanya latency yang ditunda.

Jika task rata-rata 500 ms dan queue berisi 1000 task dengan 20 worker:

```text
queue wait approx = 1000 / 20 * 500ms = 25s
```

Untuk request fan-out, queue besar sering buruk. Lebih baik reject/degrade cepat daripada membuat request menggantung.

---

## 14. Java 8–25 Compatibility Notes

### 14.1 Java 8

`CompletableFuture` pertama hadir di Java 8. Tidak ada:

- `orTimeout`
- `completeOnTimeout`
- `delayedExecutor`
- `copy`
- `minimalCompletionStage`

Timeout perlu dibuat manual, biasanya dengan scheduled executor. Di Jakarta EE, gunakan `ManagedScheduledExecutorService`.

Pattern Java 8 timeout:

```java
public <T> CompletableFuture<T> timeoutAfter(
    long timeout,
    TimeUnit unit,
    ManagedScheduledExecutorService scheduler
) {
    CompletableFuture<T> promise = new CompletableFuture<>();
    scheduler.schedule(
        () -> promise.completeExceptionally(new TimeoutException("Timed out")),
        timeout,
        unit
    );
    return promise;
}

public <T> CompletableFuture<T> withTimeout(
    CompletableFuture<T> original,
    long timeout,
    TimeUnit unit,
    ManagedScheduledExecutorService scheduler
) {
    CompletableFuture<T> timeoutFuture = timeoutAfter(timeout, unit, scheduler);
    return original.applyToEither(timeoutFuture, Function.identity());
}
```

---

### 14.2 Java 9+

Java 9 menambahkan beberapa helper penting:

- `orTimeout`
- `completeOnTimeout`
- `delayedExecutor`
- `defaultExecutor`
- `copy`
- `minimalCompletionStage`

`minimalCompletionStage()` berguna untuk expose view yang lebih terbatas:

```java
return internalFuture.minimalCompletionStage();
```

Namun di banyak codebase, return `CompletionStage` sudah cukup.

---

### 14.3 Java 21+

Virtual Threads final di Java 21. Ini mengubah biaya blocking, tetapi tidak menghapus kebutuhan managed context.

Jakarta Concurrency 3.1 membawa dukungan virtual thread pada managed resources, misalnya via `@ManagedExecutorDefinition` di Jakarta EE 11.

Tetap pahami:

- virtual thread bukan durable job
- virtual thread bukan transaction propagation magic
- virtual thread bukan rate limiter
- virtual thread bukan audit framework
- virtual thread bukan replacement untuk Jakarta Batch

Ia membuat model blocking I/O lebih scalable jika runtime dan resource mendukung.

---

### 14.4 Java 25

Java 25 masih membawa beberapa fitur concurrency modern yang relevan, seperti structured concurrency dan scoped values dalam status preview/incubator sesuai JDK release. Konsepnya penting untuk masa depan:

- task tree
- cancellation propagation
- failure aggregation
- scoped contextual value

Namun untuk portable Jakarta EE today, `CompletableFuture + ManagedExecutorService + ContextService` masih pola utama.

---

## 15. CompletableFuture vs Jakarta Concurrency `@Asynchronous`

Jakarta Concurrency modern menyediakan annotation async method, tergantung versi dan server support.

Konsepnya:

```java
@Asynchronous
public CompletionStage<Result> compute(Input input) {
    // executed asynchronously by container-managed executor
}
```

Kelebihan:

- lebih declarative
- container memilih executor sesuai konfigurasi
- context propagation lebih terpadu
- method-level async lebih jelas

Kekurangan:

- composition kompleks tetap sering membutuhkan `CompletionStage`
- portability tergantung versi server
- debugging bisa lebih abstrak
- perlu paham proxy/interceptor behavior

Gunakan annotation untuk async service method yang jelas. Gunakan `CompletableFuture` untuk graph composition yang eksplisit.

---

## 16. CompletableFuture vs Jakarta Batch

Jangan gunakan `CompletableFuture` untuk semua hal.

| Kebutuhan | CompletableFuture | Jakarta Batch |
|---|---:|---:|
| Request fan-out/fan-in | Good | Not ideal |
| Short async computation | Good | Too heavy |
| Long-running job | Weak | Good |
| Restartability | Manual | Built-in model |
| Checkpointing | Manual | Built-in model |
| Large item processing | Manual | Good |
| Operator start/stop/restart | Manual | Built-in `JobOperator` |
| Job repository | Manual | Built-in concept |
| Durable state | Manual | Built-in concept |
| Per-item skip/retry | Manual | Built-in model |

Rule:

> Jika work harus survive request lifecycle dan perlu restart/checkpoint, pikirkan Jakarta Batch atau durable job architecture, bukan hanya `CompletableFuture`.

---

## 17. CompletableFuture vs Messaging

Gunakan messaging jika:

- work tidak harus selesai sebelum response
- perlu durable queue
- perlu decoupling producer-consumer
- perlu retry/dlq
- perlu rate smoothing
- perlu event-driven architecture

Gunakan `CompletableFuture` jika:

- caller masih menunggu result
- work relatif pendek
- graph dependency jelas
- durability bukan requirement utama
- failure bisa dikembalikan ke caller

Anti-pattern:

```text
HTTP request -> CompletableFuture.runAsync(sendEmail) -> return success
```

Jika email penting, lebih baik:

```text
HTTP request -> persist notification request/outbox -> commit -> async sender consumes -> retry/DLQ
```

---

## 18. Production Pattern: Async Aggregator with Domain-Aware Partial Failure

### 18.1 Domain result

```java
public record OverviewResponse(
    CaseCore core,
    List<Party> parties,
    Optional<RegistryStatus> registryStatus,
    List<String> warnings
) {}
```

### 18.2 Branch wrapper

```java
public record AsyncBranch<T>(
    String name,
    boolean critical,
    CompletableFuture<BranchResult<T>> future
) {}
```

### 18.3 Service

```java
@ApplicationScoped
public class OverviewAggregator {

    @Resource
    ManagedExecutorService executor;

    public CompletionStage<OverviewResponse> load(String caseId) {
        AsyncBranch<CaseCore> core = critical("core", () -> loadCore(caseId));
        AsyncBranch<List<Party>> parties = critical("parties", () -> loadParties(caseId));
        AsyncBranch<RegistryStatus> registry = optional("registry", () -> loadRegistry(caseId));

        CompletableFuture<Void> all = CompletableFuture.allOf(
            core.future(),
            parties.future(),
            registry.future()
        );

        return all.thenApplyAsync(ignored -> assemble(core, parties, registry), executor);
    }

    private <T> AsyncBranch<T> critical(String name, Supplier<T> supplier) {
        return new AsyncBranch<>(name, true, branch(name, supplier));
    }

    private <T> AsyncBranch<T> optional(String name, Supplier<T> supplier) {
        return new AsyncBranch<>(name, false, branch(name, supplier));
    }

    private <T> CompletableFuture<BranchResult<T>> branch(String name, Supplier<T> supplier) {
        return CompletableFuture
            .supplyAsync(supplier, executor)
            .orTimeout(2, TimeUnit.SECONDS)
            .<BranchResult<T>>thenApply(BranchResult::success)
            .exceptionally(error -> BranchResult.failure(
                name,
                unwrapCompletion(error).getMessage(),
                unwrapCompletion(error)
            ));
    }

    private OverviewResponse assemble(
        AsyncBranch<CaseCore> core,
        AsyncBranch<List<Party>> parties,
        AsyncBranch<RegistryStatus> registry
    ) {
        BranchResult<CaseCore> coreResult = core.future().join();
        BranchResult<List<Party>> partiesResult = parties.future().join();
        BranchResult<RegistryStatus> registryResult = registry.future().join();

        CaseCore coreValue = requireCritical(core.name(), coreResult);
        List<Party> partyValues = requireCritical(parties.name(), partiesResult);

        List<String> warnings = new ArrayList<>();
        Optional<RegistryStatus> registryValue = optionalValue(registryResult, warnings);

        return new OverviewResponse(coreValue, partyValues, registryValue, warnings);
    }
}
```

Ini lebih defensible daripada `allOf(...).join()` mentah karena domain criticality eksplisit.

---

## 19. Production Pattern: Avoid Fire-and-Forget Loss

### 19.1 Buruk

```java
public void approveCase(String caseId) {
    caseService.approve(caseId);

    CompletableFuture.runAsync(() -> {
        emailService.sendApprovalEmail(caseId);
    }, executor);
}
```

Jika email gagal, approval tetap terjadi dan failure bisa hilang.

### 19.2 Lebih baik dengan outbox

```java
@Transactional
public void approveCase(String caseId, Actor actor) {
    caseService.approve(caseId, actor);

    outboxRepository.insert(new OutboxEvent(
        UUID.randomUUID().toString(),
        "CASE_APPROVED",
        caseId,
        actor.userId(),
        Instant.now()
    ));
}
```

Sender async:

```java
public CompletionStage<Void> flushOutbox() {
    return CompletableFuture.runAsync(() -> {
        List<OutboxEvent> events = outboxRepository.claimPending(100);
        for (OutboxEvent event : events) {
            sendWithRetry(event);
        }
    }, executor);
}
```

Untuk production penuh, sender ini mungkin lebih cocok scheduler, messaging consumer, atau batch job.

---

## 20. Testing CompletableFuture in Jakarta EE

### 20.1 Unit test pure composition

Pisahkan composition logic dari container resource.

```java
class DirectExecutor implements Executor {
    @Override
    public void execute(Runnable command) {
        command.run();
    }
}
```

Dengan direct executor, test deterministic:

```java
@Test
void shouldAggregateResults() {
    OverviewAggregator aggregator = new OverviewAggregator(new DirectExecutor());

    CompletionStage<Overview> stage = aggregator.load("CASE-1");

    Overview result = stage.toCompletableFuture().join();

    assertEquals("CASE-1", result.caseId());
}
```

Namun direct executor tidak mendeteksi race condition. Gunakan juga integration/concurrency test.

---

### 20.2 Test timeout

Gunakan fake supplier:

```java
Supplier<String> slow = () -> {
    LockSupport.parkNanos(TimeUnit.SECONDS.toNanos(10));
    return "late";
};
```

Test:

```java
CompletableFuture<String> future = CompletableFuture
    .supplyAsync(slow, executor)
    .orTimeout(100, TimeUnit.MILLISECONDS);

CompletionException ex = assertThrows(
    CompletionException.class,
    () -> future.join()
);

assertTrue(unwrapCompletion(ex) instanceof TimeoutException);
```

---

### 20.3 Test partial failure

```java
@Test
void shouldReturnWarningWhenOptionalRegistryFails() {
    service.stubRegistryFailure(new SocketTimeoutException("timeout"));

    OverviewResponse response = service.load("CASE-1")
        .toCompletableFuture()
        .join();

    assertTrue(response.registryStatus().isEmpty());
    assertTrue(response.warnings().contains("registry unavailable"));
}
```

---

### 20.4 Integration test container context

Unit test tidak cukup untuk membuktikan:

- managed executor injection
- context propagation
- security identity
- CDI interceptor behavior
- transaction boundary

Butuh integration test dengan server/container yang sama atau mendekati production.

---

## 21. Observability

### 21.1 Metrics per async graph

Minimal metrics:

```text
async.graph.started
async.graph.completed
async.graph.failed
async.graph.timed_out
async.branch.duration
async.branch.failed
async.branch.timeout
async.executor.active
async.executor.queue.depth
async.executor.rejected
```

Tag penting:

```text
graph=case-overview
branch=registry
critical=false
module=case-management
downstream=external-registry
```

Jangan tag dengan high-cardinality data seperti `caseId`.

---

### 21.2 Logging

Log async boundary:

```text
correlationId=abc caseId=CASE-123 graph=case-overview event=branch-start branch=registry
correlationId=abc caseId=CASE-123 graph=case-overview event=branch-timeout branch=registry durationMs=2000
correlationId=abc caseId=CASE-123 graph=case-overview event=aggregate-complete status=PARTIAL warnings=1
```

Pisahkan:

- technical logs untuk diagnosis
- audit logs untuk evidence

Jangan bergantung pada technical logs sebagai audit trail regulatory.

---

### 21.3 Trace async boundary

Tracing async chain lebih sulit karena execution berpindah thread.

Pastikan:

- trace/span context captured sebelum submit
- restored dalam worker
- branch span dibuat per downstream call
- aggregate span menandai partial failure

Jika memakai OpenTelemetry, gunakan instrumentation executor/context propagation yang sesuai dengan runtime.

---

## 22. Common Anti-Patterns

### 22.1 `supplyAsync` tanpa executor

```java
CompletableFuture.supplyAsync(this::loadData);
```

Masalah: default executor, biasanya common pool.

---

### 22.2 Async stage lupa executor

```java
future.thenApplyAsync(this::transform);
```

Masalah: chain keluar dari managed executor.

---

### 22.3 Fire-and-forget untuk side effect penting

```java
CompletableFuture.runAsync(this::sendImportantNotification, executor);
```

Masalah: failure hilang, tidak durable, tidak auditable.

---

### 22.4 Blocking join di request thread

```java
return service.loadAsync(id).toCompletableFuture().join();
```

Kadang boleh jika sengaja bridge sync API, tetapi sering menghilangkan manfaat async dan bisa menambah starvation.

---

### 22.5 Nested future tidak di-compose

```java
CompletionStage<CompletionStage<Result>> nested = future.thenApply(this::nextAsync);
```

Harusnya:

```java
CompletionStage<Result> flat = future.thenCompose(this::nextAsync);
```

---

### 22.6 Menyembunyikan semua error dengan default

```java
.exceptionally(error -> defaultValue)
```

Masalah: operational failure tidak terlihat.

---

### 22.7 Fan-out tanpa capacity math

```text
200 concurrent requests x 10 branches = 2000 async tasks
```

Masalah: DB/API collapse.

---

### 22.8 Membawa request object ke async task

```java
runAsync(() -> use(request), executor);
```

Masalah: request lifecycle invalid.

---

### 22.9 Memakai `CompletableFuture` untuk batch job restartable

Masalah: tidak ada checkpoint, job repository, restart semantics, skip/retry model.

---

## 23. Decision Framework

Gunakan `CompletableFuture + ManagedExecutorService` jika:

- pekerjaan pendek
- caller masih butuh result
- graph dependency jelas
- failure bisa dikembalikan ke caller
- tidak perlu durable restart
- tidak perlu checkpoint
- concurrency bisa dibatasi

Gunakan Jakarta Batch jika:

- data besar
- long-running
- perlu restart/checkpoint
- perlu item skip/retry
- perlu operator control
- perlu job repository

Gunakan messaging jika:

- decoupling lebih penting daripada immediate result
- work harus durable
- producer dan consumer punya lifecycle berbeda
- perlu DLQ/retry

Gunakan workflow engine jika:

- proses bisnis multi-step long-running
- human task
- SLA/escalation
- compensation
- visibility bisnis

Gunakan virtual threads jika:

- workload banyak blocking I/O pendek
- runtime mendukung managed virtual thread
- bottleneck bukan DB/API rate limit
- context/lifecycle tetap managed

---

## 24. Checklist Production Readiness

Sebelum memakai `CompletableFuture` di Jakarta EE, cek:

### Executor

- [ ] Semua `supplyAsync/runAsync/*Async` memakai executor eksplisit.
- [ ] Executor adalah managed executor.
- [ ] Workload penting punya executor/bulkhead sendiri.
- [ ] Queue size dan rejection behavior jelas.
- [ ] Sizing dihitung berdasarkan downstream capacity.

### Context

- [ ] Context container dipahami.
- [ ] MDC/correlation ID propagated atau disnapshot.
- [ ] Request object tidak dibawa ke async task.
- [ ] Security actor disnapshot untuk audit.
- [ ] Transaction tidak diasumsikan melewati async boundary.

### Failure

- [ ] Branch criticality jelas.
- [ ] Timeout per branch dan aggregate jelas.
- [ ] Fallback tidak menyembunyikan error penting.
- [ ] Exception diunwrap dan diklasifikasi.
- [ ] Cancellation strategy ada.

### Resource

- [ ] HTTP client timeout dikonfigurasi.
- [ ] DB query timeout dikonfigurasi.
- [ ] Connection pool pressure dihitung.
- [ ] Fan-out multiplier dihitung.

### Observability

- [ ] Metrics branch dan graph tersedia.
- [ ] Rejection count dimonitor.
- [ ] Timeout/failure count dimonitor.
- [ ] Trace context across async boundary dipastikan.
- [ ] Audit trail tidak bergantung pada technical log.

### Architecture

- [ ] Tidak memakai `CompletableFuture` untuk durable long-running job.
- [ ] Side effect penting memakai outbox/durable mechanism.
- [ ] Ada boundary jelas antara request async dan batch/job async.

---

## 25. Latihan Mental Model

### Latihan 1 — Endpoint fan-out

Endpoint `/applications/{id}/summary` memanggil:

- application DB
- applicant DB
- payment API
- compliance API
- document API

Pertanyaan:

1. Branch mana critical?
2. Mana boleh fallback?
3. Berapa total timeout?
4. Berapa branch timeout?
5. Berapa max concurrent request?
6. Berapa max DB connection aman?
7. Apakah semua branch boleh pakai executor yang sama?
8. Apa yang terjadi jika compliance API 429?
9. Apa yang ditulis ke audit?
10. Apa response jika document API timeout?

---

### Latihan 2 — Fire-and-forget

Setelah user submit appeal, sistem harus:

- save appeal
- send acknowledgement email
- generate PDF receipt
- notify officer
- update dashboard counter

Tentukan mana yang:

- harus satu transaksi
- boleh async request-bound
- harus durable outbox
- cocok batch
- cocok messaging

---

### Latihan 3 — Debug production issue

Symptom:

```text
During high traffic, API latency jumps from 300ms to 20s.
Thread dump shows many ForkJoinPool.commonPool-worker threads blocked on JDBC.
Application server managed executor looks idle.
Correlation ID missing in async logs.
```

Analisis:

1. Apa kemungkinan root cause?
2. Kode seperti apa yang menyebabkan ini?
3. Apa fix immediate?
4. Apa fix structural?
5. Metrics apa yang harus ditambahkan?

---

## 26. Ringkasan

`CompletableFuture` sangat powerful untuk menyusun asynchronous computation, tetapi di Jakarta EE ia harus dipakai dengan disiplin container-aware.

Prinsip paling penting:

1. Jangan biarkan `CompletableFuture` memilih executor sendiri.
2. Gunakan `ManagedExecutorService` untuk execution capacity.
3. Gunakan `ContextService` atau wrapper eksplisit untuk context propagation ketika diperlukan.
4. Bedakan composition abstraction dari execution governance.
5. Jangan memakai common pool untuk enterprise workload.
6. Jangan membawa request-scoped object ke async task.
7. Jangan menganggap transaction melewati async boundary.
8. Jangan memakai fire-and-forget untuk side effect penting.
9. Hitung fan-out multiplier terhadap DB/API capacity.
10. Gunakan Jakarta Batch atau durable architecture untuk long-running/restartable work.

Mental model akhir:

```text
CompletableFuture tells you how tasks depend on each other.
ManagedExecutorService tells you where tasks are allowed to run.
ContextService helps decide what context crosses the boundary.
Your architecture decides what failure means.
```

Engineer senior tidak hanya bisa membuat kode async berjalan. Engineer top-tier bisa menjelaskan:

- thread mana yang menjalankan stage
- context apa yang valid
- siapa pemilik resource
- bagaimana failure diklasifikasi
- bagaimana overload dikendalikan
- bagaimana audit tetap defensible
- kapan harus berhenti memakai `CompletableFuture` dan pindah ke batch/messaging/workflow

---

## 27. Rujukan Resmi dan Bacaan Lanjutan

- Jakarta Concurrency 3.1 Specification: https://jakarta.ee/specifications/concurrency/3.1/
- Jakarta Concurrency `ManagedExecutorService` API: https://jakarta.ee/specifications/concurrency/3.1/apidocs/jakarta.concurrency/jakarta/enterprise/concurrent/managedexecutorservice
- Jakarta Concurrency Explained: https://jakarta.ee/learn/specification-guides/concurrency-explained/
- Jakarta EE Tutorial — Concurrency Utilities: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/concurrency-utilities/concurrency-utilities.html
- Jakarta EE 11 Release: https://jakarta.ee/release/11/
- Java SE 25 `CompletableFuture` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html
- Java SE `Executor` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executor.html
- JEP 444 — Virtual Threads: https://openjdk.org/jeps/444
- JEP 453/462/480/499/505 — Structured Concurrency evolution: https://openjdk.org/jeps/505
- JEP 429/446/464/481/487/506 — Scoped Values evolution: https://openjdk.org/jeps/506

---

## 28. Status Seri

Seri **belum selesai**.

Bagian ini adalah:

```text
Part 10 — CompletableFuture in Jakarta EE Without Breaking the Container
```

Bagian berikutnya:

```text
Part 11 — Virtual Threads, Jakarta EE, and Managed Concurrency
File: 11-virtual-threads-and-jakarta-ee-managed-concurrency.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 9 — CDI, Interceptors, Events, and Async Boundaries](./09-cdi-interceptors-events-and-async-boundaries.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 11 — Virtual Threads, Jakarta EE, and Managed Concurrency](./11-virtual-threads-and-jakarta-ee-managed-concurrency.md)

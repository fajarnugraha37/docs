# 23 — Concurrency Pattern II: Executor, Future, CompletableFuture, Structured Concurrency

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 23 dari 35  
> Topik: Executor, Future, CompletableFuture, Virtual Threads, Cancellation, Timeout, Fan-out/Fan-in, Structured Concurrency  
> Target: Java 8–25  

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami concurrency bukan sebagai “cara membuat banyak thread”, tetapi sebagai desain alur kerja paralel yang punya ownership, lifecycle, cancellation, timeout, observability, dan failure semantics.
2. Membedakan `Thread`, `Executor`, `ExecutorService`, `Future`, `CompletableFuture`, virtual threads, dan structured concurrency.
3. Mendesain fan-out/fan-in dengan benar: siapa memulai task, siapa menunggu, siapa membatalkan, siapa mengumpulkan error, dan siapa membersihkan resource.
4. Menentukan kapan memakai thread pool klasik, kapan memakai `CompletableFuture`, kapan memakai virtual thread, dan kapan memakai structured concurrency.
5. Menghindari anti-pattern umum seperti unbounded executor, lost cancellation, timeout lokal yang tidak membatalkan task, `CompletableFuture` spaghetti, blocking pada common pool, dan thread-local leak.
6. Mendesain concurrency yang dapat di-debug: punya correlation ID, task name, timeout reason, cancellation reason, metric, dan log yang menjelaskan hubungan parent-child antar task.
7. Membaca concurrency code dari sudut pandang engineer senior: bukan hanya “jalan”, tetapi apakah invariant sistem masih aman ketika latency, exception, retry, cancel, overload, dan partial failure terjadi.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Dalam sistem enterprise Java, banyak operasi bukan hanya satu query atau satu call. Contoh:

- mengambil case detail dari beberapa module,
- mengambil profile user, role, permission, case metadata, document summary, payment summary, dan audit trail,
- memanggil beberapa external API,
- melakukan batch validation terhadap banyak record,
- mengirim banyak email,
- memproses message dari queue,
- melakukan report generation,
- melakukan enrichment data sebelum decision,
- melakukan background sync ke sistem lain.

Cara paling naif:

```java
CaseDetail detail = caseService.getCase(id);
Profile profile = profileService.getProfile(detail.applicantId());
List<Document> documents = documentService.getDocuments(id);
PaymentSummary payment = paymentService.getPayment(id);
AuditSummary audit = auditService.getAudit(id);
return assemble(detail, profile, documents, payment, audit);
```

Ini mudah dibaca, tetapi semua berjalan sequential. Jika masing-masing call membutuhkan 300 ms, total latency bisa menjadi 1.5 detik atau lebih.

Solusi cepat yang sering muncul:

```java
new Thread(() -> profileService.getProfile(applicantId)).start();
new Thread(() -> documentService.getDocuments(caseId)).start();
new Thread(() -> paymentService.getPayment(caseId)).start();
```

Ini terlihat paralel, tetapi desainnya rusak:

- siapa menunggu hasilnya?
- siapa menangkap exception?
- siapa membatalkan kalau request client sudah timeout?
- siapa membatasi jumlah thread?
- siapa memberi correlation ID ke child task?
- bagaimana tracing-nya?
- apa yang terjadi kalau salah satu call gagal?
- apakah task orphan masih berjalan setelah parent gagal?

Concurrency modern bukan tentang “membuat thread sebanyak mungkin”. Concurrency modern adalah **membuat task tree yang lifecycle-nya jelas**.

---

## 3. Mental Model Utama

### 3.1 Thread adalah worker, task adalah pekerjaan

Kesalahan umum: menyamakan thread dengan task.

- **Task**: unit pekerjaan konseptual.
- **Thread**: mekanisme eksekusi.
- **Executor**: scheduler yang memutuskan task dijalankan oleh thread mana.
- **Future**: handle untuk hasil task yang belum selesai.
- **CompletableFuture**: future dengan composition graph.
- **Structured concurrency**: parent scope yang memiliki child task dan mengatur join/cancel/failure secara eksplisit.

Mental model:

```text
Request
  ├── Task A: load profile
  ├── Task B: load documents
  ├── Task C: load payment
  └── Task D: load audit

Parent request owns child tasks.
If parent fails/timeouts/cancels, child tasks must not become orphan.
```

Concurrency yang baik memiliki **ownership tree**.

Concurrency yang buruk memiliki **task graph liar**.

---

### 3.2 Concurrency harus punya lifecycle

Untuk setiap task async, tanyakan:

1. Siapa yang membuat task?
2. Siapa yang menunggu task?
3. Siapa yang membatalkan task?
4. Siapa yang menerima exception?
5. Siapa yang menentukan timeout?
6. Siapa yang membersihkan resource?
7. Siapa yang mencatat observability?
8. Apakah task boleh hidup lebih lama dari request?

Jika jawaban pertanyaan ini tidak jelas, concurrency design-nya rapuh.

---

### 3.3 Parallelism bukan selalu throughput improvement

Concurrency membantu ketika:

- task I/O bound,
- task independent,
- latency dapat di-overlap,
- downstream punya capacity,
- cancellation/timeout jelas,
- overhead scheduling lebih kecil dari benefit.

Concurrency bisa memperburuk sistem ketika:

- task CPU bound tetapi thread terlalu banyak,
- database connection pool kecil,
- downstream rate limit ketat,
- semua task memperebutkan lock yang sama,
- error handling tidak jelas,
- retry memperbanyak beban,
- task yang timeout tetap berjalan di background.

Concurrency bukan tujuan. Tujuannya adalah **responsiveness, throughput, resource utilization, dan isolation**.

---

## 4. Evolusi Model Concurrency Java

### 4.1 Java awal: manual `Thread`

```java
Thread t = new Thread(() -> doWork());
t.start();
t.join();
```

Manual thread cocok untuk pembelajaran, tetapi kurang cocok untuk sistem enterprise besar karena:

- lifecycle manual,
- sulit membatasi jumlah thread,
- sulit reuse worker,
- exception tidak otomatis dikembalikan ke caller,
- naming/observability sering lemah,
- cancellation rawan diabaikan.

---

### 4.2 Java 5+: Executor dan Future

Java 5 memperkenalkan `java.util.concurrent`.

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
Future<Result> future = executor.submit(() -> service.load());
Result result = future.get();
```

Improvement:

- task dipisah dari thread,
- thread pool bisa dikontrol,
- hasil task bisa diambil,
- exception task bisa dipropagasikan lewat `ExecutionException`,
- shutdown executor bisa diatur.

Tetapi `Future` klasik punya keterbatasan:

- composition sulit,
- callback tidak natural,
- cancellation sering tidak dipropagasikan,
- timeout pada `get(timeout)` tidak otomatis menghentikan task,
- fan-out/fan-in manual verbose.

---

### 4.3 Java 8+: CompletableFuture

`CompletableFuture` membawa composition model.

```java
CompletableFuture<Profile> profileFuture =
    CompletableFuture.supplyAsync(() -> profileService.load(userId), executor);

CompletableFuture<DocumentSummary> documentFuture =
    CompletableFuture.supplyAsync(() -> documentService.summary(caseId), executor);

CaseView view = profileFuture
    .thenCombine(documentFuture, (profile, documents) -> assemble(profile, documents))
    .join();
```

Keunggulan:

- composition lebih ekspresif,
- bisa chaining,
- bisa combine beberapa async result,
- bisa handle error dalam graph.

Risiko:

- chaining panjang sulit dibaca,
- default executor bisa salah,
- exception semantics membingungkan,
- cancellation propagation tidak otomatis sesuai ekspektasi,
- context propagation sulit,
- debugging stack trace sering tidak linear.

---

### 4.4 Java 21+: Virtual Threads

Virtual threads membuat model blocking kembali menjadi viable untuk banyak use case I/O bound.

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Profile> profile = executor.submit(() -> profileService.load(userId));
    Future<DocumentSummary> documents = executor.submit(() -> documentService.summary(caseId));

    return assemble(profile.get(), documents.get());
}
```

Virtual threads membuat task-per-request/task-per-operation lebih murah dibanding platform thread klasik, tetapi tidak menghapus kebutuhan desain:

- database connection pool tetap bottleneck,
- downstream rate limit tetap ada,
- CPU tetap terbatas,
- lock contention tetap berbahaya,
- cancellation tetap harus dipikirkan,
- ThreadLocal usage harus dievaluasi.

Virtual thread mengurangi biaya thread, bukan menghapus hukum resource.

---

### 4.5 Java 21–25: Structured Concurrency dan Scoped Values

Structured concurrency mengubah mental model dari “menembakkan async task” menjadi “membuka scope kerja yang memiliki child task”.

Conceptual shape:

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<Profile> profile = scope.fork(() -> profileService.load(userId));
    Subtask<DocumentSummary> documents = scope.fork(() -> documentService.summary(caseId));

    scope.join();
    scope.throwIfFailed();

    return assemble(profile.get(), documents.get());
}
```

Prinsipnya:

- child task hidup di dalam parent scope,
- parent join child task,
- failure bisa membatalkan sibling,
- cancellation lebih eksplisit,
- task tree lebih mudah diamati,
- concurrency mengikuti struktur kode.

Scoped values membantu propagation context yang immutable dan scoped, sebagai alternatif lebih aman untuk banyak penggunaan `ThreadLocal`.

---

## 5. Core Pattern: Executor Pattern

### 5.1 Intent

Executor Pattern memisahkan:

```text
What to run    -> task
How to run     -> executor
Where to run   -> thread/pool/scheduler
When to run    -> scheduling policy
```

Tanpa executor:

```java
new Thread(task).start();
```

Dengan executor:

```java
executor.execute(task);
```

Perbedaan desainnya besar. Caller tidak lagi mengontrol thread secara langsung. Caller menyerahkan task ke execution policy.

---

### 5.2 Executor sebagai policy boundary

Executor bukan sekadar utility. Executor adalah policy boundary untuk:

- jumlah concurrency,
- queue size,
- thread naming,
- rejection policy,
- priority,
- scheduling,
- isolation antar workload,
- shutdown behavior,
- observability.

Contoh pemisahan executor:

```java
public final class ApplicationExecutors {
    private final ExecutorService reportExecutor;
    private final ExecutorService emailExecutor;
    private final ExecutorService externalApiExecutor;

    public ApplicationExecutors(
            ExecutorService reportExecutor,
            ExecutorService emailExecutor,
            ExecutorService externalApiExecutor) {
        this.reportExecutor = reportExecutor;
        this.emailExecutor = emailExecutor;
        this.externalApiExecutor = externalApiExecutor;
    }

    public ExecutorService reportExecutor() {
        return reportExecutor;
    }

    public ExecutorService emailExecutor() {
        return emailExecutor;
    }

    public ExecutorService externalApiExecutor() {
        return externalApiExecutor;
    }
}
```

Ini lebih baik daripada semua workload memakai satu global executor.

---

### 5.3 Anti-pattern: satu executor untuk semua workload

```java
private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(20);
```

Terlihat sederhana, tetapi semua workload tercampur:

- email lambat bisa menghambat approval,
- report besar bisa menghambat audit logging,
- external API timeout bisa menghabiskan worker,
- queue penuh tetapi tidak tahu workload mana penyebabnya.

Lebih baik:

```text
approval-executor      -> latency-sensitive business operation
report-executor        -> long-running CPU/IO mixed operation
email-executor         -> best-effort background delivery
external-api-executor  -> bounded calls to external dependency
```

Executor adalah bulkhead kecil.

---

## 6. Thread Pool Design

### 6.1 Fixed thread pool

```java
ExecutorService executor = Executors.newFixedThreadPool(16);
```

Cocok ketika:

- workload stabil,
- concurrency limit jelas,
- task relatif homogen,
- ingin membatasi resource.

Risiko: factory method `Executors.newFixedThreadPool` memakai unbounded queue. Jika producer lebih cepat dari consumer, queue bisa tumbuh besar dan menyebabkan memory pressure.

Lebih eksplisit:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    16,
    16,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(500),
    namedThreadFactory("external-api"),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Dengan konfigurasi eksplisit, kita mendefinisikan:

- pool size,
- queue capacity,
- thread naming,
- rejection behavior.

---

### 6.2 Cached thread pool

```java
ExecutorService executor = Executors.newCachedThreadPool();
```

Risiko besar:

- jumlah thread bisa tumbuh sangat banyak,
- bisa memperbesar overload,
- tidak cocok untuk call ke resource terbatas seperti database,
- sulit memberi backpressure.

Gunakan hanya jika kamu benar-benar paham workload dan batasannya.

---

### 6.3 Single thread executor

```java
ExecutorService executor = Executors.newSingleThreadExecutor();
```

Cocok untuk:

- serializing access,
- actor-like processing sederhana,
- ordering strict,
- event loop internal kecil.

Risiko:

- bottleneck tersembunyi,
- queue growth,
- satu task stuck menghambat semua task.

---

### 6.4 Scheduled executor

```java
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);

scheduler.scheduleAtFixedRate(
    () -> refreshCache(),
    0,
    5,
    TimeUnit.MINUTES
);
```

Perhatikan:

- fixed rate vs fixed delay,
- task overlap,
- exception yang menghentikan schedule,
- shutdown behavior,
- idempotency,
- clock drift,
- cluster coordination.

Untuk enterprise system, scheduled task perlu lock/lease jika berjalan di banyak node.

---

### 6.5 Virtual thread per task executor

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Result>> futures = ids.stream()
        .map(id -> executor.submit(() -> externalClient.fetch(id)))
        .toList();

    for (Future<Result> future : futures) {
        process(future.get());
    }
}
```

Cocok untuk:

- banyak blocking I/O,
- kode imperative yang ingin tetap sederhana,
- request fan-out ke beberapa dependency,
- migrasi dari blocking synchronous code.

Tetap butuh batas eksternal:

```java
Semaphore externalApiLimit = new Semaphore(50);

Result fetchWithLimit(String id) throws Exception {
    externalApiLimit.acquire();
    try {
        return externalClient.fetch(id);
    } finally {
        externalApiLimit.release();
    }
}
```

Virtual thread murah, tetapi downstream tidak otomatis menjadi murah.

---

## 7. Future Pattern

### 7.1 Intent

Future adalah placeholder untuk hasil yang akan tersedia nanti.

```java
Future<Decision> decisionFuture = executor.submit(() -> decisionService.evaluate(command));
```

Future memberikan handle untuk:

- menunggu hasil,
- mengambil exception,
- membatalkan task,
- mengecek status.

---

### 7.2 Future error semantics

```java
try {
    Decision decision = future.get();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("Interrupted while waiting decision", e);
} catch (ExecutionException e) {
    Throwable cause = e.getCause();
    throw translate(cause);
}
```

Kesalahan umum:

```java
catch (Exception e) {
    throw new RuntimeException(e);
}
```

Masalah:

- interrupt flag hilang,
- cause domain/technical tidak dibedakan,
- retryability hilang,
- observability buruk.

---

### 7.3 Timeout pada Future

```java
try {
    return future.get(500, TimeUnit.MILLISECONDS);
} catch (TimeoutException e) {
    future.cancel(true);
    throw new TimeoutFailure("Decision evaluation timed out", e);
}
```

Penting: `get(timeout)` hanya membuat caller berhenti menunggu. Task belum tentu berhenti. Karena itu biasanya perlu `cancel(true)`.

Namun `cancel(true)` hanya efektif jika task cooperatively responds to interruption.

---

### 7.4 Task harus interruption-aware

Buruk:

```java
while (true) {
    doWork();
}
```

Lebih baik:

```java
while (!Thread.currentThread().isInterrupted()) {
    doWorkChunk();
}
```

Atau:

```java
try {
    blockingQueue.take();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

Rule: kalau menangkap `InterruptedException`, jangan menelannya diam-diam.

---

## 8. CompletableFuture Pattern

### 8.1 Basic async composition

```java
CompletableFuture<Profile> profile = CompletableFuture.supplyAsync(
    () -> profileService.load(userId),
    executor
);

CompletableFuture<List<Document>> documents = CompletableFuture.supplyAsync(
    () -> documentService.findByCaseId(caseId),
    executor
);

CompletableFuture<CasePage> page = profile.thenCombine(
    documents,
    (p, d) -> new CasePage(p, d)
);

return page.join();
```

`thenCombine` cocok untuk dua hasil independent.

---

### 8.2 `thenApply` vs `thenCompose`

`thenApply` untuk transformasi synchronous:

```java
CompletableFuture<UserDto> dto = userFuture.thenApply(UserDto::from);
```

`thenCompose` untuk chaining async yang menghasilkan future baru:

```java
CompletableFuture<Account> account = userFuture.thenCompose(
    user -> accountClient.loadAsync(user.accountId())
);
```

Jika memakai `thenApply` pada function yang return future, hasilnya nested:

```java
CompletableFuture<CompletableFuture<Account>> bad =
    userFuture.thenApply(user -> accountClient.loadAsync(user.accountId()));
```

---

### 8.3 `allOf` problem

```java
CompletableFuture<Void> all = CompletableFuture.allOf(profile, documents, payment);
all.join();
```

Masalah: `allOf` hanya menghasilkan `Void`. Kita tetap perlu mengambil hasil satu per satu.

```java
Profile p = profile.join();
List<Document> d = documents.join();
PaymentSummary pay = payment.join();
```

Buat helper agar typed:

```java
public static <A, B, C, R> CompletableFuture<R> combine3(
        CompletableFuture<A> fa,
        CompletableFuture<B> fb,
        CompletableFuture<C> fc,
        TriFunction<A, B, C, R> fn) {

    return CompletableFuture.allOf(fa, fb, fc)
        .thenApply(ignored -> fn.apply(fa.join(), fb.join(), fc.join()));
}
```

---

### 8.4 Exception handling

`exceptionally` mengubah failure menjadi fallback value:

```java
CompletableFuture<AuditSummary> audit = CompletableFuture
    .supplyAsync(() -> auditService.summary(caseId), executor)
    .exceptionally(ex -> AuditSummary.unavailable());
```

Ini hanya benar jika audit summary memang optional.

Jangan menjadikan semua error fallback.

Buruk:

```java
.exceptionally(ex -> null)
```

Ini menyembunyikan failure dan menciptakan null ambiguity.

---

### 8.5 `handle` vs `whenComplete`

`handle` mengubah result:

```java
future.handle((value, error) -> {
    if (error != null) return fallback();
    return value;
});
```

`whenComplete` untuk side effect observability, bukan recovery utama:

```java
future.whenComplete((value, error) -> {
    if (error != null) log.warn("Task failed", error);
});
```

Jangan melakukan recovery tersembunyi di `whenComplete`.

---

### 8.6 Timeout di CompletableFuture

```java
CompletableFuture<Result> future = CompletableFuture
    .supplyAsync(() -> externalClient.fetch(id), executor)
    .orTimeout(500, TimeUnit.MILLISECONDS);
```

`orTimeout` membuat future complete exceptionally jika timeout. Tetapi task underlying yang sedang blocking belum tentu berhenti.

Untuk operasi blocking, timeout terbaik tetap harus ada di client I/O layer:

```text
HTTP connect timeout
HTTP read timeout
DB query timeout
Future timeout
Request timeout
```

Timeout harus konsisten dari luar ke dalam.

---

## 9. Fan-Out/Fan-In Pattern

### 9.1 Intent

Fan-out/fan-in digunakan ketika satu operation perlu menjalankan beberapa independent task paralel lalu menggabungkan hasilnya.

```text
Parent operation
  ├── child task A
  ├── child task B
  ├── child task C
  └── join result
```

---

### 9.2 Fan-out dengan Executor + Future

```java
public CaseDashboard loadDashboard(CaseId caseId) {
    Future<CaseSummary> caseFuture = executor.submit(() -> caseService.summary(caseId));
    Future<DocumentSummary> docFuture = executor.submit(() -> documentService.summary(caseId));
    Future<PaymentSummary> paymentFuture = executor.submit(() -> paymentService.summary(caseId));

    try {
        CaseSummary caseSummary = caseFuture.get(500, TimeUnit.MILLISECONDS);
        DocumentSummary documents = docFuture.get(500, TimeUnit.MILLISECONDS);
        PaymentSummary payment = paymentFuture.get(500, TimeUnit.MILLISECONDS);
        return new CaseDashboard(caseSummary, documents, payment);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        cancelAll(caseFuture, docFuture, paymentFuture);
        throw new OperationCancelledException("Dashboard loading interrupted", e);
    } catch (ExecutionException e) {
        cancelAll(caseFuture, docFuture, paymentFuture);
        throw translate(e.getCause());
    } catch (TimeoutException e) {
        cancelAll(caseFuture, docFuture, paymentFuture);
        throw new TimeoutFailure("Dashboard loading timed out", e);
    }
}

@SafeVarargs
private static void cancelAll(Future<?>... futures) {
    for (Future<?> future : futures) {
        future.cancel(true);
    }
}
```

Perhatikan: ketika satu gagal, sibling dibatalkan.

---

### 9.3 Fan-out dengan CompletableFuture

```java
public CompletableFuture<CaseDashboard> loadDashboardAsync(CaseId caseId) {
    CompletableFuture<CaseSummary> caseFuture = CompletableFuture.supplyAsync(
        () -> caseService.summary(caseId), executor);

    CompletableFuture<DocumentSummary> docFuture = CompletableFuture.supplyAsync(
        () -> documentService.summary(caseId), executor);

    CompletableFuture<PaymentSummary> paymentFuture = CompletableFuture.supplyAsync(
        () -> paymentService.summary(caseId), executor);

    return CompletableFuture.allOf(caseFuture, docFuture, paymentFuture)
        .thenApply(ignored -> new CaseDashboard(
            caseFuture.join(),
            docFuture.join(),
            paymentFuture.join()
        ));
}
```

Kelemahan: cancellation sibling tidak otomatis sejelas structured scope. Perlu helper jika ingin strict shutdown-on-failure.

---

### 9.4 Fan-out dengan Structured Concurrency

```java
public CaseDashboard loadDashboard(CaseId caseId) throws Exception {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        var caseTask = scope.fork(() -> caseService.summary(caseId));
        var docTask = scope.fork(() -> documentService.summary(caseId));
        var paymentTask = scope.fork(() -> paymentService.summary(caseId));

        scope.join();
        scope.throwIfFailed();

        return new CaseDashboard(
            caseTask.get(),
            docTask.get(),
            paymentTask.get()
        );
    }
}
```

Ini lebih sesuai dengan mental model:

```text
open scope
  fork child tasks
  join
  propagate failure
  close scope
```

Structured concurrency membuat task ownership eksplisit.

---

## 10. Timeout Propagation Pattern

### 10.1 Timeout harus berupa budget, bukan angka acak

Buruk:

```java
profileClient.get(3 seconds)
documentClient.get(3 seconds)
paymentClient.get(3 seconds)
controller timeout 5 seconds
```

Jika semua sequential, total bisa melebihi request timeout. Jika paralel, masih bisa ada task orphan setelah caller timeout.

Lebih baik pakai deadline:

```java
public record Deadline(Instant expiresAt) {
    public Duration remaining(Clock clock) {
        Duration remaining = Duration.between(clock.instant(), expiresAt);
        return remaining.isNegative() ? Duration.ZERO : remaining;
    }

    public boolean expired(Clock clock) {
        return !clock.instant().isBefore(expiresAt);
    }
}
```

Usage:

```java
Deadline deadline = new Deadline(clock.instant().plusMillis(800));
profileClient.fetch(userId, deadline.remaining(clock));
documentClient.fetch(caseId, deadline.remaining(clock));
```

Timeout yang benar adalah **propagated budget**.

---

### 10.2 Layered timeout

```text
Client request timeout:        1000 ms
Application operation budget:   850 ms
External API timeout:           500 ms
DB query timeout:               300 ms
Future join timeout:            850 ms
```

Rule:

- outer timeout harus lebih besar dari inner timeout,
- inner timeout harus benar-benar membatalkan I/O,
- cancellation harus dikirim ke child task,
- failure harus punya reason.

---

## 11. Cancellation Propagation Pattern

### 11.1 Cancellation bukan afterthought

Cancellation harus menjadi bagian desain.

Ketika parent operation gagal:

```text
Parent failed
  -> cancel child task A
  -> cancel child task B
  -> cancel child task C
  -> release resource
  -> report failure once
```

Tanpa cancellation, sistem mengalami resource leak secara halus.

---

### 11.2 Cancellation dengan Future

```java
try {
    return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
} catch (TimeoutException e) {
    future.cancel(true);
    throw new TimeoutFailure("Operation timed out", e);
}
```

Task harus memperhatikan interrupt.

---

### 11.3 Cancellation dengan CompletableFuture

`CompletableFuture.cancel(true)` tidak selalu menghentikan task underlying sesuai harapan, terutama jika task sudah berjalan dan tidak interrupt-aware. Karena itu jangan mengandalkan cancellation sebagai magic.

Lebih baik:

- timeout di I/O client,
- cooperative cancellation flag,
- bounded executor,
- structured concurrency jika cocok,
- task design yang interruption-aware.

---

### 11.4 Cancellation dengan Structured Concurrency

Structured scope membantu karena child task berada di dalam scope yang sama. Policy seperti shutdown-on-failure dapat membatalkan sibling ketika satu task gagal.

Mental model-nya lebih aman dibanding future graph yang tersebar.

---

## 12. Context Propagation Pattern

### 12.1 Problem

Dalam request synchronous biasa, context sering disimpan di `ThreadLocal`:

- correlation ID,
- user ID,
- tenant/agency,
- locale,
- security principal,
- MDC logging context.

Dalam async task, thread bisa berbeda. Context bisa hilang.

---

### 12.2 Manual context capture

```java
public final class ContextAwareExecutor implements Executor {
    private final Executor delegate;

    public ContextAwareExecutor(Executor delegate) {
        this.delegate = delegate;
    }

    @Override
    public void execute(Runnable command) {
        RequestContext captured = RequestContextHolder.current();
        delegate.execute(() -> {
            RequestContext previous = RequestContextHolder.currentOrNull();
            try {
                RequestContextHolder.set(captured);
                command.run();
            } finally {
                RequestContextHolder.set(previous);
            }
        });
    }
}
```

Ini sering diperlukan di sistem Java lama, tetapi rawan leak jika cleanup lupa.

---

### 12.3 Scoped Values

Scoped values menawarkan model context immutable dan scoped.

Conceptual shape:

```java
static final ScopedValue<RequestContext> REQUEST_CONTEXT = ScopedValue.newInstance();

ScopedValue.where(REQUEST_CONTEXT, context).run(() -> {
    service.handle(command);
});
```

Keunggulan mental model:

- context tidak mutable bebas,
- context hanya valid dalam lexical/dynamic scope,
- lebih cocok untuk structured concurrency,
- mengurangi risiko leak dibanding ThreadLocal yang tidak dibersihkan.

---

## 13. Backpressure and Rejection Pattern

### 13.1 Executor harus punya overload behavior

Jika task datang lebih cepat dari kemampuan proses, sistem harus memilih:

1. queue,
2. reject,
3. run in caller,
4. shed load,
5. degrade,
6. throttle producer.

Tidak memilih berarti memilih unbounded queue secara tidak sadar.

---

### 13.2 Bounded executor

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    20,
    20,
    0,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(1000),
    namedThreadFactory("case-worker"),
    new ThreadPoolExecutor.AbortPolicy()
);
```

`AbortPolicy` membuat overload eksplisit lewat `RejectedExecutionException`.

Application bisa translate:

```java
try {
    executor.execute(task);
} catch (RejectedExecutionException e) {
    throw new SystemBusyException("Case worker queue is full", e);
}
```

---

### 13.3 CallerRunsPolicy

```java
new ThreadPoolExecutor.CallerRunsPolicy()
```

Efeknya: ketika pool penuh, caller menjalankan task. Ini memberi backpressure karena caller melambat.

Cocok untuk beberapa workload internal, tetapi hati-hati di request thread karena bisa memperpanjang latency.

---

## 14. Virtual Threads: Pattern Shift

### 14.1 Apa yang berubah

Sebelum virtual thread, engineer sering menulis async non-blocking code untuk menghindari mahalnya platform thread.

Dengan virtual threads, blocking style bisa kembali sederhana:

```java
Result result = client.call();
```

Tetapi tiap request bisa punya virtual thread sendiri, dan setiap subtask bisa virtual thread sendiri.

---

### 14.2 Apa yang tidak berubah

Virtual threads tidak menghilangkan:

- database connection limit,
- external API limit,
- CPU limit,
- lock contention,
- memory object allocation,
- transaction duration risk,
- need for timeout,
- need for cancellation,
- need for observability.

Virtual thread membuat blocking lebih scalable, bukan membuat dependency tidak terbatas.

---

### 14.3 Virtual thread anti-pattern

Buruk:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (String id : ids) {
        executor.submit(() -> externalClient.call(id));
    }
}
```

Jika `ids` berjumlah 100.000 dan downstream hanya mampu 100 concurrent call, ini overload.

Lebih baik:

```java
Semaphore limit = new Semaphore(100);

try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Result>> futures = new ArrayList<>();
    for (String id : ids) {
        futures.add(executor.submit(() -> {
            limit.acquire();
            try {
                return externalClient.call(id);
            } finally {
                limit.release();
            }
        }));
    }
}
```

Atau gunakan producer-consumer/chunking.

---

## 15. Structured Concurrency Pattern

### 15.1 Intent

Structured concurrency membuat concurrent tasks mengikuti struktur blok kode seperti structured programming membuat control flow mengikuti blok kode.

Tanpa struktur:

```text
method starts task
method returns
child task may still run
failure may appear elsewhere
```

Dengan struktur:

```text
method opens scope
method forks child tasks
method joins child tasks
method handles failure
method closes scope
no child left behind
```

---

### 15.2 Shutdown on failure

Cocok ketika semua child task wajib berhasil.

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var profile = scope.fork(() -> profileService.load(userId));
    var permissions = scope.fork(() -> permissionService.load(userId));

    scope.join();
    scope.throwIfFailed();

    return new UserContext(profile.get(), permissions.get());
}
```

Jika permissions gagal, profile task yang masih berjalan bisa dibatalkan.

---

### 15.3 Shutdown on success

Cocok untuk race beberapa alternative source.

```java
try (var scope = new StructuredTaskScope.ShutdownOnSuccess<Address>()) {
    scope.fork(() -> primaryAddressService.lookup(postalCode));
    scope.fork(() -> fallbackAddressService.lookup(postalCode));

    scope.join();
    return scope.result();
}
```

Ketika satu berhasil, yang lain tidak perlu lanjut.

---

### 15.4 Partial result policy

Tidak semua fan-out butuh all-or-nothing.

Contoh dashboard:

- case summary wajib,
- document summary optional,
- audit summary optional,
- payment summary wajib.

Jangan memakai satu policy global. Modelkan requirement:

```java
public record DashboardParts(
    CaseSummary caseSummary,
    PaymentSummary paymentSummary,
    Optional<DocumentSummary> documentSummary,
    Optional<AuditSummary> auditSummary,
    List<PartialFailure> warnings
) {}
```

Top engineer tidak hanya memilih pattern. Mereka mendesain failure semantics.

---

## 16. Common Anti-Patterns

### 16.1 Unbounded executor

```java
Executors.newCachedThreadPool();
Executors.newFixedThreadPool(10); // unbounded queue
```

Masalah:

- memory pressure,
- latency tidak terkendali,
- overload tersembunyi,
- failure terlambat terlihat.

Better:

```java
new ThreadPoolExecutor(core, max, keepAlive, unit, boundedQueue, factory, rejectionPolicy);
```

---

### 16.2 Fire and forget tanpa owner

```java
executor.submit(() -> sendEmail(email));
return success();
```

Pertanyaan:

- kalau sendEmail gagal, siapa tahu?
- apakah perlu retry?
- apakah harus outbox?
- apakah request dianggap sukses jika email gagal?
- apakah email task survive restart?

Untuk side effect penting, gunakan outbox/job/message queue, bukan fire-and-forget volatile task.

---

### 16.3 CompletableFuture spaghetti

```java
return a.thenCompose(x -> b(x)
    .thenCompose(y -> c(x, y)
        .thenApply(z -> d(x, y, z))
        .exceptionally(e -> fallback())))
    .thenCompose(...)
    .handle(...);
```

Masalah:

- flow sulit dibaca,
- error semantics tersembunyi,
- debugging susah,
- cancellation tidak jelas,
- context propagation rawan hilang.

Refactor:

- pecah ke named method,
- gunakan typed intermediate object,
- gunakan imperative style dengan virtual threads jika lebih jelas,
- gunakan structured concurrency untuk fan-out/fan-in.

---

### 16.4 Blocking common pool

```java
CompletableFuture.supplyAsync(() -> blockingHttpCall());
```

Tanpa executor eksplisit, task berjalan di common pool. Jika blocking call banyak, common pool bisa terganggu.

Better:

```java
CompletableFuture.supplyAsync(() -> blockingHttpCall(), blockingIoExecutor);
```

Atau virtual threads.

---

### 16.5 Lost interrupt

```java
try {
    future.get();
} catch (InterruptedException e) {
    throw new RuntimeException(e);
}
```

Better:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("Interrupted", e);
}
```

---

### 16.6 Timeout tanpa cancellation

```java
future.get(1, TimeUnit.SECONDS);
```

Jika timeout terjadi tetapi task tidak dibatalkan, task tetap berjalan.

Better:

```java
catch (TimeoutException e) {
    future.cancel(true);
    throw ...;
}
```

Tetap pastikan task interruption-aware.

---

### 16.7 Parallelism against constrained resource

```java
ids.parallelStream()
   .map(id -> repository.findById(id))
   .toList();
```

Masalah:

- DB connection pool terbatas,
- common pool dipakai,
- transaction context tidak jelas,
- error handling buruk,
- ordering dan logging sulit.

Better:

- batch query,
- explicit executor,
- chunking,
- bounded concurrency,
- query optimization.

---

### 16.8 ThreadLocal leak

```java
REQUEST_CONTEXT.set(context);
executor.submit(() -> handle());
// no clear
```

Pada platform thread pool, thread dipakai ulang. Context bisa bocor ke task berikutnya.

Better:

```java
try {
    REQUEST_CONTEXT.set(context);
    handle();
} finally {
    REQUEST_CONTEXT.remove();
}
```

Untuk Java modern, pertimbangkan scoped values untuk context immutable.

---

## 17. Design Decision Matrix

| Situation | Preferred Model | Reason |
|---|---|---|
| Simple synchronous operation | Direct call | Paling jelas |
| Few independent blocking I/O calls | Structured concurrency / virtual threads | Clear fan-out/fan-in |
| Many independent blocking I/O calls | Virtual threads + semaphore/chunking | Cheap threads but bounded downstream |
| CPU-bound task | Fixed pool sized near CPU cores | Hindari oversubscription |
| Async pipeline with many transformations | CompletableFuture | Composition expressive |
| Long-running reliable background work | Queue/job/outbox | Survive restart, retryable |
| Scheduled periodic task | ScheduledExecutor + cluster lock | Lifecycle jelas |
| Optional dashboard enrichment | Partial result model | Failure semantics explicit |
| All-or-nothing child calls | Shutdown-on-failure scope | Cancel siblings on failure |
| Race alternative providers | Shutdown-on-success scope | Stop after first success |

---

## 18. Step-by-Step Refactoring: Dari Sequential ke Safe Concurrent Design

### 18.1 Starting point

```java
public CaseDashboard dashboard(CaseId caseId) {
    CaseSummary caseSummary = caseService.summary(caseId);
    DocumentSummary documents = documentService.summary(caseId);
    PaymentSummary payment = paymentService.summary(caseId);
    AuditSummary audit = auditService.summary(caseId);
    return new CaseDashboard(caseSummary, documents, payment, audit);
}
```

---

### 18.2 Step 1: klasifikasi dependency

| Dependency | Required? | Expected latency | Failure policy |
|---|---:|---:|---|
| Case summary | Yes | 100 ms | fail request |
| Payment summary | Yes | 150 ms | fail request |
| Document summary | No | 300 ms | show unavailable |
| Audit summary | No | 400 ms | show unavailable |

---

### 18.3 Step 2: buat result model eksplisit

```java
public record CaseDashboard(
    CaseSummary caseSummary,
    PaymentSummary paymentSummary,
    Optional<DocumentSummary> documents,
    Optional<AuditSummary> audit,
    List<DashboardWarning> warnings
) {}
```

---

### 18.4 Step 3: gunakan structured fan-out conceptually

```java
public CaseDashboard dashboard(CaseId caseId) throws Exception {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        var caseTask = scope.fork(() -> caseService.summary(caseId));
        var paymentTask = scope.fork(() -> paymentService.summary(caseId));

        scope.join();
        scope.throwIfFailed();

        Optional<DocumentSummary> documents = loadOptionalDocuments(caseId);
        Optional<AuditSummary> audit = loadOptionalAudit(caseId);

        return new CaseDashboard(
            caseTask.get(),
            paymentTask.get(),
            documents,
            audit,
            List.of()
        );
    }
}
```

Namun ini belum optimal karena optional part sequential. Bisa dibuat scope terpisah dengan partial policy.

---

### 18.5 Step 4: model partial failure

```java
public record OptionalPart<T>(
    Optional<T> value,
    Optional<DashboardWarning> warning
) {
    public static <T> OptionalPart<T> present(T value) {
        return new OptionalPart<>(Optional.of(value), Optional.empty());
    }

    public static <T> OptionalPart<T> unavailable(String part, Throwable cause) {
        return new OptionalPart<>(
            Optional.empty(),
            Optional.of(new DashboardWarning(part, cause.getClass().getSimpleName()))
        );
    }
}
```

---

### 18.6 Step 5: concurrent required + optional dengan policy eksplisit

```java
public CaseDashboard dashboard(CaseId caseId) throws Exception {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        var caseTask = scope.fork(() -> caseService.summary(caseId));
        var paymentTask = scope.fork(() -> paymentService.summary(caseId));
        var documentTask = scope.fork(() -> safeOptional("documents", () -> documentService.summary(caseId)));
        var auditTask = scope.fork(() -> safeOptional("audit", () -> auditService.summary(caseId)));

        scope.join();
        scope.throwIfFailed();

        OptionalPart<DocumentSummary> documents = documentTask.get();
        OptionalPart<AuditSummary> audit = auditTask.get();

        List<DashboardWarning> warnings = Stream.of(documents.warning(), audit.warning())
            .flatMap(Optional::stream)
            .toList();

        return new CaseDashboard(
            caseTask.get(),
            paymentTask.get(),
            documents.value(),
            audit.value(),
            warnings
        );
    }
}

private static <T> OptionalPart<T> safeOptional(String part, ThrowingSupplier<T> supplier) {
    try {
        return OptionalPart.present(supplier.get());
    } catch (Exception e) {
        return OptionalPart.unavailable(part, e);
    }
}
```

Catatan: contoh ini menunjukkan mental model. Dalam implementasi nyata, timeout, logging, metric, dan error taxonomy harus ditambahkan.

---

## 19. Testing Strategy

### 19.1 Test success fan-out

Pastikan hasil semua dependency digabung benar.

```java
@Test
void shouldAssembleDashboardFromAllParts() {
    // arrange stubs
    // act
    // assert all fields
}
```

---

### 19.2 Test required dependency failure

```java
@Test
void shouldFailWhenRequiredPaymentFails() {
    paymentService.failWith(new PaymentUnavailableException());

    assertThrows(OperationFailedException.class, () -> service.dashboard(caseId));
}
```

---

### 19.3 Test optional dependency failure

```java
@Test
void shouldReturnDashboardWithWarningWhenAuditFails() {
    auditService.failWith(new AuditUnavailableException());

    CaseDashboard dashboard = service.dashboard(caseId);

    assertTrue(dashboard.audit().isEmpty());
    assertThat(dashboard.warnings()).extracting(DashboardWarning::part).contains("audit");
}
```

---

### 19.4 Test timeout behavior

Gunakan fake dependency yang bisa dikontrol, bukan `Thread.sleep` sembarangan.

```java
class BlockingAuditService implements AuditService {
    private final CountDownLatch started = new CountDownLatch(1);
    private final CountDownLatch release = new CountDownLatch(1);

    @Override
    public AuditSummary summary(CaseId caseId) throws InterruptedException {
        started.countDown();
        release.await();
        return AuditSummary.empty();
    }
}
```

Test:

```java
@Test
void shouldTimeoutAndCancelSlowTask() {
    // arrange deadline short
    // act/assert timeout
    // assert task observed interruption if possible
}
```

---

### 19.5 Test interrupt handling

Jika service menangkap interrupt, pastikan interrupt flag dipulihkan.

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException(...);
}
```

---

## 20. Observability and Diagnostics

Concurrency tanpa observability sulit dioperasikan.

Minimal metadata per task:

```text
task.name
task.parent
task.operation
task.correlation_id
task.start_time
task.duration
task.status
task.timeout_budget
task.failure_type
task.cancelled
executor.name
executor.queue_size
executor.active_count
```

---

### 20.1 Thread naming

```java
private static ThreadFactory namedThreadFactory(String prefix) {
    AtomicInteger seq = new AtomicInteger();
    return runnable -> {
        Thread t = new Thread(runnable);
        t.setName(prefix + "-" + seq.incrementAndGet());
        return t;
    };
}
```

Untuk virtual threads:

```java
ThreadFactory factory = Thread.ofVirtual()
    .name("case-vt-", 0)
    .factory();
```

---

### 20.2 Metrics

Executor metrics:

- active threads,
- pool size,
- queue size,
- completed task count,
- rejected task count,
- task duration,
- wait time in queue,
- cancellation count,
- timeout count.

CompletableFuture/structured task metrics:

- fan-out width,
- child failure count,
- sibling cancellation count,
- slowest child,
- partial result count.

---

### 20.3 Logging

Good log:

```text
case.dashboard.child_task_failed correlationId=abc caseId=C-123 task=audit-summary failure=AuditTimeout durationMs=450 optional=true action=return_warning
```

Bad log:

```text
Error loading dashboard
```

---

## 21. Security and Compliance Considerations

Concurrency can break security assumptions.

### 21.1 Context loss

Async task might run without user context:

```text
request thread has user principal
child task missing principal
repository returns data without permission filter
```

Always make security context explicit or safely propagated.

---

### 21.2 Context leak

Thread pool reuse can leak previous user context if `ThreadLocal` is not cleared.

This is serious in multi-user enterprise apps.

---

### 21.3 Audit ordering

Parallel side effects can reorder audit events.

If audit order matters, do not rely on completion race. Include:

- event time,
- sequence number,
- causation ID,
- parent operation ID,
- transition ID.

---

### 21.4 Authorization before fan-out

Do not fan-out sensitive calls before checking permission.

Bad:

```text
start loading documents/profile/payment/audit in parallel
then check authorization
```

Good:

```text
authenticate
authorize operation
then fan-out allowed data retrieval
```

---

## 22. Performance Considerations

### 22.1 Little's Law intuition

Concurrency needed roughly relates to:

```text
concurrency ≈ throughput × latency
```

If external call latency is 200 ms and target throughput is 100 requests/sec, approximate in-flight calls can be 20.

But this is not a license to set thread count blindly. Check downstream limits.

---

### 22.2 CPU-bound vs I/O-bound

CPU-bound:

```text
thread count near available processors
avoid too much context switching
use work-stealing/fork-join carefully
```

I/O-bound:

```text
more concurrency can help
virtual threads are useful
still bound by connection pools/downstream limits
```

---

### 22.3 Queue is latency

A full queue means work is waiting. Waiting increases latency.

Executor queue size is not just capacity. It is delayed work.

---

### 22.4 Parallelizing DB calls can be worse

If one SQL query can retrieve data in one roundtrip, do not split into ten parallel queries.

Better:

```text
optimize query shape
batch load
use joins/materialized views/read model
avoid N+1
```

Concurrency is not a substitute for data access design.

---

## 23. Case Study: Regulatory Case Detail Aggregation

### 23.1 Scenario

Endpoint:

```text
GET /cases/{caseId}/detail
```

Needs:

- case core data,
- applicant profile,
- document summary,
- payment status,
- audit trail summary,
- available actions,
- risk indicators.

Constraints:

- user must be authorized,
- case core and available actions required,
- audit summary optional,
- document summary optional,
- response SLA 1 second,
- downstream profile service sometimes slow,
- audit DB query sometimes heavy,
- all logs need correlation ID.

---

### 23.2 Bad design

```java
public CaseDetail getDetail(String caseId) {
    CompletableFuture<CaseCore> core = CompletableFuture.supplyAsync(() -> caseRepo.get(caseId));
    CompletableFuture<Profile> profile = CompletableFuture.supplyAsync(() -> profileClient.get(caseId));
    CompletableFuture<Documents> docs = CompletableFuture.supplyAsync(() -> docService.get(caseId));
    CompletableFuture<Audit> audit = CompletableFuture.supplyAsync(() -> auditService.get(caseId));

    return CompletableFuture.allOf(core, profile, docs, audit)
        .thenApply(x -> assemble(core.join(), profile.join(), docs.join(), audit.join()))
        .join();
}
```

Problems:

- default common pool,
- no authorization first,
- no timeout,
- no cancellation,
- optional vs required not modeled,
- context propagation unknown,
- audit failure fails whole endpoint,
- no fallback warnings,
- hard to observe slow child.

---

### 23.3 Better design

Design policy:

```text
Authorization: before fan-out
Required: case core, profile, available actions
Optional: document summary, audit summary
Timeout budget: 850 ms application-level
External profile timeout: remaining budget max 400 ms
Audit timeout: max 250 ms
Failure response: required failure -> endpoint failure
Optional failure -> partial response warning
```

Model:

```java
public record CaseDetailResponse(
    CaseCore core,
    ProfileSummary profile,
    AvailableActions actions,
    Optional<DocumentSummary> documents,
    Optional<AuditSummary> audit,
    List<ResponseWarning> warnings
) {}
```

Service sketch:

```java
public CaseDetailResponse getDetail(CaseId caseId, UserId userId) throws Exception {
    authorizationService.assertCanView(userId, caseId);

    Deadline deadline = Deadline.after(Duration.ofMillis(850), clock);
    RequestContext context = RequestContext.current();

    return ScopedValue.where(REQUEST_CONTEXT, context).call(() -> {
        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
            var core = scope.fork(() -> caseService.loadCore(caseId, deadline));
            var profile = scope.fork(() -> profileService.loadSummary(caseId, deadline));
            var actions = scope.fork(() -> actionService.availableActions(userId, caseId, deadline));
            var documents = scope.fork(() -> optional("documents", () -> documentService.summary(caseId, deadline)));
            var audit = scope.fork(() -> optional("audit", () -> auditService.summary(caseId, deadline)));

            scope.join();
            scope.throwIfFailed();

            OptionalPart<DocumentSummary> docPart = documents.get();
            OptionalPart<AuditSummary> auditPart = audit.get();

            List<ResponseWarning> warnings = Stream.of(docPart.warning(), auditPart.warning())
                .flatMap(Optional::stream)
                .toList();

            return new CaseDetailResponse(
                core.get(),
                profile.get(),
                actions.get(),
                docPart.value(),
                auditPart.value(),
                warnings
            );
        }
    });
}
```

This design makes explicit:

- parent owns child tasks,
- authorization comes first,
- required/optional failure semantics,
- context propagation,
- timeout budget,
- result degradation,
- no orphan task after scope close.

---

## 24. Design Review Checklist

Gunakan checklist ini ketika review concurrency design:

```text
[ ] Apakah task benar-benar independent?
[ ] Apakah parallelism memberi benefit nyata?
[ ] Apakah resource downstream punya limit?
[ ] Apakah executor bounded?
[ ] Apakah executor dipisah berdasarkan workload?
[ ] Apakah rejection policy jelas?
[ ] Apakah timeout berupa propagated budget?
[ ] Apakah task dibatalkan ketika parent gagal?
[ ] Apakah task interruption-aware?
[ ] Apakah optional vs required failure dimodelkan?
[ ] Apakah context propagation aman?
[ ] Apakah ThreadLocal dibersihkan?
[ ] Apakah virtual thread dipakai tanpa membanjiri downstream?
[ ] Apakah CompletableFuture graph masih terbaca?
[ ] Apakah structured concurrency lebih cocok?
[ ] Apakah fire-and-forget seharusnya diganti outbox/queue?
[ ] Apakah metric executor tersedia?
[ ] Apakah log punya correlation ID dan task name?
[ ] Apakah security check dilakukan sebelum fan-out?
[ ] Apakah audit ordering dijamin jika dibutuhkan?
```

---

## 25. Common Staff-Level Discussion

### 25.1 “Apakah virtual threads menggantikan CompletableFuture?”

Tidak sepenuhnya. Virtual threads membuat blocking style lebih scalable dan sering lebih readable untuk I/O-bound task. `CompletableFuture` tetap berguna untuk async composition, API non-blocking, event-loop integration, dan pipeline transformasi. Tetapi banyak fan-out/fan-in blocking yang dulu ditulis rumit dengan `CompletableFuture` bisa menjadi lebih sederhana dengan virtual threads dan structured concurrency.

---

### 25.2 “Apakah kita masih perlu thread pool?”

Ya. Bahkan dengan virtual threads, kita masih perlu membatasi resource eksternal. Bedanya, limit mungkin tidak lagi terutama thread count, tetapi:

- DB connection pool,
- HTTP connection pool,
- rate limiter,
- semaphore,
- queue,
- bulkhead,
- CPU executor untuk CPU-bound work.

---

### 25.3 “Kenapa `parallelStream` sering buruk di service code?”

Karena ia menyembunyikan execution policy. Ia menggunakan common pool, sulit mengontrol context, timeout, cancellation, observability, dan downstream limit. Untuk data processing murni bisa berguna. Untuk service call, DB call, external API call, biasanya lebih baik explicit executor atau structured concurrency.

---

### 25.4 “Kapan fire-and-forget boleh?”

Boleh untuk side effect best-effort yang benar-benar tidak critical, misalnya local metric internal yang juga punya fallback. Untuk business side effect seperti email resmi, audit, notification, integration event, atau regulatory action, fire-and-forget volatile task biasanya salah. Gunakan outbox, queue, job table, atau durable scheduler.

---

### 25.5 “Apa indikator concurrency design sudah senior-level?”

Concurrency design senior-level memiliki:

- ownership jelas,
- bounded resource,
- cancellation jelas,
- timeout budget jelas,
- failure semantics eksplisit,
- context propagation aman,
- observability kuat,
- tidak ada orphan task,
- tidak menyembunyikan overload,
- tidak mengorbankan correctness demi latency semu.

---

## 26. Summary

Executor, Future, CompletableFuture, virtual threads, dan structured concurrency bukan sekadar API berbeda. Mereka mewakili evolusi cara Java mendesain kerja paralel.

Inti dari bagian ini:

```text
Concurrency is not thread creation.
Concurrency is task lifecycle design.
```

Executor memisahkan task dari execution policy. Future memberi handle hasil masa depan. CompletableFuture memberi composition graph. Virtual threads membuat blocking style lebih murah. Structured concurrency mengembalikan struktur ownership ke kode concurrent.

Pattern yang baik selalu menjawab:

```text
Who owns the task?
Who waits for it?
Who cancels it?
Who observes it?
Who handles failure?
Who limits resource usage?
```

Jika pertanyaan itu tidak terjawab, concurrency code mungkin berjalan di happy path, tetapi akan rapuh saat menghadapi timeout, overload, partial failure, cancellation, dan production debugging.

Top engineer tidak hanya bisa membuat operasi berjalan paralel. Mereka bisa memastikan concurrency tetap menjaga invariant sistem.

---

## 27. Status Seri

```text
Part 23 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
24-resilience-retry-timeout-circuit-breaker-bulkhead-fallback.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./22-concurrency-immutability-confinement-guarded-suspension.md">⬅️ Part 22 — Concurrency Pattern I: Immutability, Confinement, Guarded Suspension</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./24-resilience-retry-timeout-circuit-breaker-bulkhead-fallback.md">Resilience Pattern: Retry, Timeout, Circuit Breaker, Bulkhead, Fallback ➡️</a>
</div>

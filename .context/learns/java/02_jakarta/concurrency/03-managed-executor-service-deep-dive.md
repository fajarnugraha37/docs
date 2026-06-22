# Part 3 — ManagedExecutorService Deep Dive

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `03-managed-executor-service-deep-dive.md`  
> Scope: Java 8–25, Java EE/Jakarta EE, `javax.enterprise.concurrent.ManagedExecutorService`, `jakarta.enterprise.concurrent.ManagedExecutorService`  
> Baseline modern reference: Jakarta EE 11 / Jakarta Concurrency 3.1

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan bukan hanya tahu cara memanggil `ManagedExecutorService.submit(...)`, tetapi mampu berpikir seperti engineer yang mendesain **asynchronous execution boundary** di enterprise runtime.

Target pemahaman:

1. Memahami `ManagedExecutorService` sebagai **executor yang dimiliki container**, bukan sekadar thread pool biasa.
2. Membedakan kapan pekerjaan cocok di-offload ke executor dan kapan seharusnya memakai Batch, messaging, scheduler, workflow engine, atau tetap sinkron.
3. Memahami lifecycle task:
   - accepted
   - queued
   - running
   - completed
   - failed
   - cancelled
   - rejected
4. Memahami konsekuensi context propagation:
   - naming/JNDI
   - classloader
   - security
   - CDI
   - transaction
   - logging/correlation
5. Menggunakan `Future`, `Callable`, `Runnable`, dan `CompletableFuture` dengan executor yang managed.
6. Mendesain bounded async offload dari request tanpa merusak latency, auditability, transaction consistency, atau operational control.
7. Mengenali failure mode production:
   - executor starvation
   - queue explosion
   - lost task
   - duplicate side effect
   - unhandled exception
   - transaction leakage assumption
   - cancellation tidak efektif
   - redeploy/shutdown issue
8. Menyusun checklist desain untuk penggunaan `ManagedExecutorService` yang production-grade.

---

## 2. Problem yang Diselesaikan

Di aplikasi enterprise, sering muncul kebutuhan seperti:

- request HTTP perlu men-trigger pekerjaan tambahan setelah response
- user upload file lalu sistem memvalidasi sebagian data secara paralel
- sistem perlu memanggil beberapa downstream API
- proses generate dokumen butuh waktu, tetapi user tidak boleh menunggu terlalu lama
- setelah submit case, sistem perlu menghitung risk score, mengirim notification, dan menulis audit
- service ingin menjalankan CPU/I/O work secara paralel tanpa membuat thread sendiri

Di Java SE, jawaban naturalnya adalah:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
executor.submit(task);
```

Tetapi di Jakarta EE / Java EE container, ini tidak sesederhana itu.

Masalahnya bukan karena `ExecutorService` buruk. Masalahnya adalah thread pool yang dibuat aplikasi sendiri tidak selalu berada di bawah kendali container. Akibatnya container bisa kehilangan kemampuan untuk:

- mengelola lifecycle thread saat redeploy/shutdown
- mengatur resource fairness antar aplikasi
- menyediakan context yang benar saat task berjalan
- mendeteksi task yang stuck
- menerapkan policy keamanan
- mencegah classloader leak
- mengintegrasikan monitoring/runtime management

`ManagedExecutorService` hadir untuk menyelesaikan problem ini: aplikasi tetap bisa melakukan asynchronous execution, tetapi eksekusinya tetap berada dalam kontrak container.

Jakarta Concurrency mendefinisikan API untuk menggunakan concurrency dari komponen Jakarta EE tanpa mengorbankan container integrity. Pada Jakarta Concurrency 3.1, `ManagedExecutorService` adalah salah satu resource utama yang disediakan container untuk menjalankan task asynchronous di thread yang dikelola container.

---

## 3. Mental Model Utama

### 3.1 Executor Biasa vs Managed Executor

Secara API, `ManagedExecutorService` terlihat mirip dengan `ExecutorService` dari Java SE karena memang ia memperluas/mengikuti model executor standar.

Namun secara runtime, maknanya berbeda.

| Aspek | `ExecutorService` biasa | `ManagedExecutorService` |
|---|---|---|
| Pemilik thread | Aplikasi | Container |
| Lifecycle | Harus dikelola aplikasi | Dikelola container |
| Context Jakarta EE | Tidak otomatis/portable | Dapat dipropagasi sesuai spec/config |
| Shutdown/redeploy | Riskan jika lupa shutdown | Container-aware |
| Monitoring | Manual | Bisa terintegrasi dengan runtime/vendor |
| Resource policy | Aplikasi bebas membuat pool | Container/deployer dapat mengatur |
| Portability di Jakarta EE | Problematic | Standardized |

Mental model yang paling penting:

> `ManagedExecutorService` bukan hanya “thread pool”. Ia adalah **execution service yang container-aware**.

Artinya, saat kamu submit task, kamu bukan sekadar meminta Java menjalankan fungsi di thread lain. Kamu meminta container menyediakan execution slot yang aman untuk aplikasi enterprise.

---

### 3.2 Submitter Context vs Execution Context

Saat request thread memanggil:

```java
executor.submit(task);
```

ada dua momen berbeda:

1. **Submission time**  
   Saat task didaftarkan ke executor.

2. **Execution time**  
   Saat task benar-benar dijalankan oleh worker thread.

Pada executor biasa, banyak context submitter tidak otomatis relevan di execution time.

Pada managed executor, container dapat menyediakan contextual behavior supaya task berjalan dengan context aplikasi yang benar.

Tetapi ini bukan berarti semua context aman atau selalu dipropagasi.

Contoh:

- classloader context biasanya harus benar
- naming context harus benar
- security context bisa dipropagasi tergantung konfigurasi/spec/server
- transaction context harus dipahami sangat hati-hati
- request context tidak boleh diasumsikan masih valid setelah request selesai

Rule penting:

> Async boundary adalah boundary semantik. Jangan menganggap task async masih hidup di dunia request yang sama.

---

### 3.3 Async Work Bukan Cara Menghilangkan Work

Kesalahan umum:

> “Kalau request lambat, pindahkan saja ke async.”

Ini framing yang berbahaya.

Async tidak menghilangkan biaya. Async hanya memindahkan **kapan**, **di thread mana**, dan **di bawah lifecycle siapa** pekerjaan itu dilakukan.

Jika bottleneck-nya database, external API, lock, atau CPU, async bisa:

- memperbaiki perceived latency user
- memperbesar throughput tertentu
- tetapi juga bisa memperparah resource pressure
- membuat failure lebih sulit diamati
- membuat consistency lebih sulit dijaga

Mental model:

> Executor adalah alat untuk mengatur concurrency, bukan alat untuk menipu kapasitas sistem.

---

## 4. Posisi `ManagedExecutorService` dalam Peta Execution Model

Sebelum memakai `ManagedExecutorService`, tentukan dulu jenis pekerjaan.

| Kebutuhan | Kandidat yang Lebih Cocok |
|---|---|
| Pekerjaan sangat cepat dan hasil dibutuhkan response | Request thread biasa |
| Request butuh non-blocking I/O lifecycle | Servlet async / JAX-RS async |
| Short asynchronous offload dalam aplikasi yang sama | `ManagedExecutorService` |
| Pekerjaan berulang berdasarkan waktu | `ManagedScheduledExecutorService` / scheduler |
| Pekerjaan durable dan harus survive restart | Jakarta Batch / queue / database job table |
| Pekerjaan massal, restartable, chunked | Jakarta Batch |
| Event-driven integration | Messaging / outbox / Kafka/RabbitMQ/JMS |
| Orchestration multi-step long-running business process | Workflow engine / BPMN |
| Infrastructure-level one-off job | Kubernetes Job |
| Cron-like infra workload | Kubernetes CronJob / external scheduler |

`ManagedExecutorService` cocok jika:

- pekerjaan relatif pendek
- tidak harus survive JVM/container crash kecuali ada persistence sendiri
- hasil bisa direpresentasikan dengan `Future`, callback, DB status, atau audit
- task bisa dikontrol oleh container executor policy
- concurrency perlu dibatasi
- context Jakarta EE perlu tersedia secara benar

`ManagedExecutorService` kurang cocok jika:

- pekerjaan berjalan menit/jam tanpa checkpoint
- harus restart dari posisi terakhir
- harus ada job repository
- harus ada operator control plane yang kuat
- perlu chunk, skip, retry, partition, dan restartability
- eksekusinya harus durable meski node mati

Untuk kebutuhan tersebut, Jakarta Batch atau durable queue lebih tepat.

---

## 5. API dan Resource Model

### 5.1 Namespace

Di Java EE / Jakarta EE lama:

```java
javax.enterprise.concurrent.ManagedExecutorService
```

Di Jakarta EE modern:

```java
jakarta.enterprise.concurrent.ManagedExecutorService
```

Perubahan `javax` ke `jakarta` bukan sekadar import rename. Ia biasanya berdampak pada:

- server runtime
- dependency API
- bytecode compatibility
- library ecosystem
- deployment descriptor
- JNDI names
- integration testing

Untuk seri ini, contoh modern akan memakai `jakarta.*`, tetapi konsepnya berlaku juga untuk `javax.*` pada Java EE 7/8.

---

### 5.2 Cara Mendapatkan ManagedExecutorService

Ada beberapa pendekatan umum.

#### 5.2.1 Injection dengan `@Resource`

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class AsyncWorkService {

    @Resource
    private ManagedExecutorService executor;
}
```

Ini pendekatan klasik yang umum portable di banyak server.

#### 5.2.2 Lookup JNDI

```java
import jakarta.enterprise.concurrent.ManagedExecutorService;
import javax.naming.InitialContext;

public class ExecutorLookup {

    public ManagedExecutorService lookup() throws Exception {
        InitialContext ctx = new InitialContext();
        return (ManagedExecutorService) ctx.lookup("java:comp/DefaultManagedExecutorService");
    }
}
```

Nama JNDI default dan custom resource bisa berbeda tergantung server/config. Gunakan dokumentasi server dan deployment descriptor jika perlu.

#### 5.2.3 CDI Injection di Jakarta Concurrency 3.1+

Jakarta EE 11 / Concurrency 3.1 memperkuat dukungan modern untuk concurrency resources, termasuk pola definisi/injection yang lebih natural di CDI environment.

Contoh konseptual:

```java
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class ReportAsyncService {

    @Inject
    ManagedExecutorService executor;
}
```

Catatan penting: portability actual dapat bergantung pada server yang digunakan dan apakah server sudah fully compatible dengan Jakarta EE 11 / Concurrency 3.1.

---

### 5.3 Mendefinisikan Managed Executor

Pada runtime enterprise, executor bukan hanya object. Ia resource yang biasanya punya konfigurasi:

- max async threads
- queue capacity
- hung task threshold
- context propagation
- priority
- virtual thread usage pada Jakarta Concurrency 3.1 / server tertentu
- JNDI binding
- qualifier

Contoh modern konseptual dengan annotation definition:

```java
import jakarta.enterprise.concurrent.ManagedExecutorDefinition;
import jakarta.enterprise.context.ApplicationScoped;

@ManagedExecutorDefinition(
    name = "java:app/concurrent/CaseWorkExecutor",
    maxAsync = 16
)
@ApplicationScoped
public class ConcurrencyResources {
}
```

Lalu dipakai:

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class CaseWorkService {

    @Resource(lookup = "java:app/concurrent/CaseWorkExecutor")
    ManagedExecutorService executor;
}
```

Konsep penting:

> Executor harus diberi nama berdasarkan workload, bukan berdasarkan class teknis.

Nama buruk:

```text
java:app/concurrent/Executor1
java:app/concurrent/AsyncExecutor
```

Nama lebih baik:

```text
java:app/concurrent/CaseRiskEvaluationExecutor
java:app/concurrent/CorrespondenceGenerationExecutor
java:app/concurrent/ExternalRegistrySyncExecutor
```

Kenapa? Karena di production, operator dan engineer perlu tahu executor mana yang menyebabkan pressure.

---

## 6. Lifecycle Task

### 6.1 State Konseptual

Walaupun API `Future` tidak mengekspose semua state internal, secara desain kamu harus berpikir bahwa task melewati beberapa fase:

```text
SUBMITTED
   |
   v
ACCEPTED / REJECTED
   |
   v
QUEUED
   |
   v
RUNNING
   |
   +--> COMPLETED
   +--> FAILED
   +--> CANCELLED
```

Lebih rinci:

1. **Submitted**  
   Aplikasi memanggil `execute`, `submit`, atau mekanisme async lain.

2. **Accepted**  
   Executor menerima task.

3. **Rejected**  
   Executor menolak task karena policy, shutdown, capacity, atau konfigurasi.

4. **Queued**  
   Task belum berjalan karena menunggu worker tersedia.

5. **Running**  
   Worker thread container menjalankan task.

6. **Completed**  
   Task selesai normal.

7. **Failed**  
   Task melempar exception.

8. **Cancelled**  
   Task dibatalkan sebelum atau saat berjalan.

---

### 6.2 State yang Sering Dilupakan: Queued

Banyak engineer hanya memikirkan:

```text
submit -> run -> done
```

Padahal bottleneck sering ada di state `QUEUED`.

Jika queue terlalu panjang:

- request terlihat cepat karena hanya enqueue
- tetapi pekerjaan actual tertunda lama
- user mungkin mengira proses sudah selesai
- SLA background work bisa gagal
- memory naik karena queue menyimpan task object
- stale context bisa menjadi masalah

Rule:

> Async handoff harus punya observability atas queueing delay, bukan hanya execution duration.

Metric minimal:

- submitted count
- accepted count
- rejected count
- queue wait duration
- execution duration
- active task count
- completed count
- failed count

---

### 6.3 `execute` vs `submit`

#### `execute(Runnable)`

```java
executor.execute(() -> {
    doWork();
});
```

Karakter:

- fire-and-forget
- tidak mengembalikan `Future`
- exception handling harus dilakukan dalam task atau oleh container/logging
- caller tidak punya handle untuk cancel atau inspect result

Cocok untuk:

- task pendek
- failure sudah ditangani internal
- task outcome dicatat ke DB/audit/log

Tidak cocok untuk:

- caller perlu hasil
- caller perlu cancellation
- caller perlu exception propagation

#### `submit(Runnable)`

```java
Future<?> future = executor.submit(() -> {
    doWork();
});
```

Karakter:

- mengembalikan `Future<?>`
- exception disimpan dalam `Future`
- caller dapat `get`, `cancel`, `isDone`

#### `submit(Callable<T>)`

```java
Future<RiskScore> future = executor.submit(() -> {
    return calculateRiskScore(caseId);
});
```

Karakter:

- menghasilkan value
- exception tersedia via `ExecutionException`

Rule praktis:

- Pakai `execute` hanya jika outcome tidak perlu dikembalikan dan failure handling internal jelas.
- Pakai `submit` jika perlu handle lifecycle task.
- Jangan submit task lalu mengabaikan `Future` jika exception penting.

---

## 7. Contoh Dasar yang Benar

### 7.1 Fire-and-Forget yang Masih Bertanggung Jawab

Contoh buruk:

```java
executor.execute(() -> sendEmail(caseId));
```

Masalah:

- exception hilang/sekadar masuk log
- tidak ada audit
- tidak ada retry
- tidak ada status
- user tidak tahu hasil

Contoh lebih baik:

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;

@ApplicationScoped
public class CaseSubmissionService {

    @Resource
    ManagedExecutorService executor;

    @Transactional
    public void submitCase(String caseId, String userId) {
        markCaseSubmitted(caseId, userId);
        createAsyncTaskRecord(caseId, "POST_SUBMISSION_NOTIFICATION", userId);

        executor.execute(() -> runNotificationTask(caseId, userId));
    }

    void runNotificationTask(String caseId, String initiatedBy) {
        try {
            markTaskRunning(caseId, "POST_SUBMISSION_NOTIFICATION");
            sendNotification(caseId);
            markTaskCompleted(caseId, "POST_SUBMISSION_NOTIFICATION");
        } catch (Exception ex) {
            markTaskFailed(caseId, "POST_SUBMISSION_NOTIFICATION", ex);
        }
    }

    private void markCaseSubmitted(String caseId, String userId) {}
    private void createAsyncTaskRecord(String caseId, String taskType, String userId) {}
    private void markTaskRunning(String caseId, String taskType) {}
    private void sendNotification(String caseId) {}
    private void markTaskCompleted(String caseId, String taskType) {}
    private void markTaskFailed(String caseId, String taskType, Exception ex) {}
}
```

Namun contoh ini masih punya isu penting: task di-submit dalam method transactional. Jika transaction `submitCase` rollback setelah enqueue, task bisa tetap berjalan dan melihat state yang belum committed atau tidak jadi ada.

Solusi yang lebih aman dibahas di Part 7, tetapi ringkasnya:

- gunakan transactional event after commit
- gunakan outbox table
- enqueue setelah commit
- atau buat durable job request yang diproses worker terpisah

---

### 7.2 Async dengan Future

```java
public RiskScore calculateWithTimeout(String caseId) {
    Future<RiskScore> future = executor.submit(() -> riskService.calculate(caseId));

    try {
        return future.get(3, TimeUnit.SECONDS);
    } catch (TimeoutException e) {
        future.cancel(true);
        throw new RiskEvaluationTimeoutException(caseId, e);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new RiskEvaluationInterruptedException(caseId, e);
    } catch (ExecutionException e) {
        throw unwrapRiskException(e);
    }
}
```

Hal penting:

- selalu handle `TimeoutException`
- selalu restore interrupt flag saat menangkap `InterruptedException`
- `cancel(true)` hanya cooperative, bukan magic kill
- exception dari task dibungkus `ExecutionException`
- jangan blocking `get()` terlalu lama di request thread tanpa alasan kuat

---

## 8. Integrasi dengan `CompletableFuture`

### 8.1 Problem Default Executor

Di Java SE, banyak orang menulis:

```java
CompletableFuture.supplyAsync(() -> callExternalApi());
```

Tanpa executor eksplisit, ini biasanya memakai `ForkJoinPool.commonPool()`.

Di Jakarta EE, ini sering salah karena:

- common pool bukan managed by container
- context Jakarta EE tidak portable
- resource usage tidak terlihat sebagai application server executor
- task bisa bersaing dengan kode lain yang juga memakai common pool
- tuning menjadi tidak jelas

Gunakan managed executor eksplisit:

```java
CompletableFuture<ResponseA> futureA = CompletableFuture.supplyAsync(
    () -> clientA.fetch(caseId),
    executor
);
```

---

### 8.2 Fan-Out/Fan-In dengan Managed Executor

```java
public CombinedResult loadCombinedCaseView(String caseId) {
    CompletableFuture<Profile> profileFuture = CompletableFuture.supplyAsync(
        () -> profileClient.getProfile(caseId),
        executor
    );

    CompletableFuture<RiskScore> riskFuture = CompletableFuture.supplyAsync(
        () -> riskClient.getRisk(caseId),
        executor
    );

    CompletableFuture<DocumentSummary> documentFuture = CompletableFuture.supplyAsync(
        () -> documentClient.getSummary(caseId),
        executor
    );

    CompletableFuture<Void> all = CompletableFuture.allOf(
        profileFuture,
        riskFuture,
        documentFuture
    );

    try {
        all.get(2, TimeUnit.SECONDS);

        return new CombinedResult(
            profileFuture.join(),
            riskFuture.join(),
            documentFuture.join()
        );
    } catch (TimeoutException e) {
        profileFuture.cancel(true);
        riskFuture.cancel(true);
        documentFuture.cancel(true);
        throw new CombinedViewTimeoutException(caseId, e);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new CombinedViewInterruptedException(caseId, e);
    } catch (ExecutionException e) {
        throw new CombinedViewFailedException(caseId, e.getCause());
    }
}
```

Catatan:

- `join()` melempar `CompletionException`, bukan checked exception.
- `allOf` tidak otomatis membatalkan task lain saat satu gagal.
- Timeout pada `get` tidak otomatis menghentikan task.
- Cancellation harus dirancang cooperative.
- Jangan fan-out tanpa concurrency budget.

---

### 8.3 Async Chain: Non-Async vs Async Stage

Contoh:

```java
CompletableFuture.supplyAsync(() -> loadCase(caseId), executor)
    .thenApply(caseData -> enrich(caseData))
    .thenAccept(result -> save(result));
```

`thenApply` non-async bisa berjalan di thread yang menyelesaikan stage sebelumnya. Jika stage sebelumnya berjalan di managed executor, stage lanjutan kemungkinan berjalan di managed thread juga, tetapi model ini tetap harus dipahami.

Jika memakai `thenApplyAsync` tanpa executor:

```java
.thenApplyAsync(caseData -> enrich(caseData))
```

maka bisa jatuh ke default async executor/common pool.

Lebih aman:

```java
.thenApplyAsync(caseData -> enrich(caseData), executor)
```

Rule:

> Dalam Jakarta EE, setiap async stage harus eksplisit memakai managed executor kecuali kamu benar-benar memahami thread tempat stage itu berjalan.

---

## 9. Transaction Boundary

Ini salah satu area paling sering salah.

### 9.1 Kesalahan Mental Model

Engineer sering berpikir:

```java
@Transactional
public void submit() {
    updateDatabase();
    executor.execute(() -> doAsyncWork());
}
```

Lalu mengasumsikan:

1. async task berjalan setelah transaction commit
2. async task melihat data committed
3. jika transaction rollback, async task tidak berjalan
4. transaction caller ikut berpindah ke async task

Semua asumsi ini berbahaya.

Async task bisa mulai sebelum transaction caller commit, tergantung timing. Bahkan jika biasanya terlihat aman di dev, itu race condition.

### 9.2 Prinsip Desain

Rule utama:

> Jangan submit asynchronous side effect dari dalam transaction kecuali kamu punya mekanisme after-commit atau durable outbox.

Pola yang lebih aman:

1. Simpan business state.
2. Simpan outbox/job record dalam transaction yang sama.
3. Commit.
4. Worker membaca outbox/job record.
5. Worker menjalankan side effect secara idempotent.
6. Worker update status.

Contoh konseptual:

```text
REQUEST THREAD
  begin tx
    update CASE status = SUBMITTED
    insert OUTBOX(type=SEND_NOTIFICATION, case_id=123, status=PENDING)
  commit

WORKER
  read pending outbox
  send notification
  mark outbox SENT
```

Ini jauh lebih defensible daripada submit langsung dari dalam transaction.

---

## 10. Security Boundary

Async task harus jelas berjalan sebagai siapa.

Pertanyaan desain:

1. Apakah task berjalan sebagai user pemicu?
2. Apakah task berjalan sebagai system account?
3. Apakah authorization dicek saat enqueue atau saat execute?
4. Apa yang terjadi jika role user berubah sebelum task dijalankan?
5. Apa yang terjadi jika user sudah resign/disable?
6. Siapa yang dicatat di audit?

Untuk sistem regulasi/case management, audit minimal:

```text
initiatedBy: user yang men-trigger
executionMode: USER_INITIATED_ASYNC / SYSTEM_ASYNC / SCHEDULED
executedBy: technical/system identity
authorizedAt: timestamp authorization decision dibuat
reason: business reason
correlationId: request/job correlation
inputSnapshotHash: optional untuk evidence
```

Jangan hanya mengandalkan `Principal` yang kebetulan tersedia di worker thread.

Lebih defensible:

- capture user id eksplisit saat enqueue
- capture authorization decision jika diperlukan
- simpan task metadata
- worker memakai service identity yang jelas
- business method tetap validasi rule penting

---

## 11. Context Propagation

`ManagedExecutorService` memberikan dasar untuk menjalankan task dengan context container. Namun tidak semua context harus dianggap sama.

### 11.1 Context yang Relatif Aman/Perlu

- application classloader
- naming context
- environment entries
- resource references
- managed resource access

### 11.2 Context yang Harus Hati-Hati

- security identity
- CDI request context
- transaction context
- persistence context
- HTTP request/session object
- ThreadLocal application state
- MDC/correlation ID

### 11.3 Golden Rule

> Data yang dibutuhkan task harus dibawa sebagai immutable command data, bukan bergantung pada context request yang masih hidup.

Contoh buruk:

```java
executor.execute(() -> {
    String userId = currentUser.getId();
    Case c = requestScopedBean.getCurrentCase();
    process(c, userId);
});
```

Contoh lebih baik:

```java
AsyncCaseCommand command = new AsyncCaseCommand(
    caseId,
    initiatedBy,
    correlationId,
    Instant.now()
);

executor.execute(() -> process(command));
```

Command object sebaiknya:

- immutable
- kecil
- serializable jika mungkin
- tidak menyimpan entity managed JPA
- tidak menyimpan request/session object
- tidak menyimpan stream terbuka
- tidak menyimpan connection

---

## 12. EntityManager, Persistence Context, dan Lazy Loading

Async task tidak boleh menerima JPA entity managed dari request transaction lalu memakainya di worker thread.

Contoh buruk:

```java
@Transactional
public void submitCase(CaseEntity caseEntity) {
    executor.execute(() -> {
        caseEntity.setStatus("PROCESSED");
        caseEntity.getDocuments().size();
    });
}
```

Masalah:

- entity mungkin detached
- persistence context tidak thread-safe
- lazy loading bisa gagal
- transaction boundary tidak jelas
- data bisa stale

Contoh lebih baik:

```java
public void submitCase(String caseId) {
    executor.execute(() -> processCaseById(caseId));
}

@Transactional
public void processCaseById(String caseId) {
    CaseEntity entity = entityManager.find(CaseEntity.class, caseId);
    entity.setStatus("PROCESSED");
}
```

Namun perhatikan: `@Transactional` pada method yang dipanggil dari class yang sama bisa tidak aktif karena self-invocation. Di CDI/EJB/Spring-like interception model, panggilan harus melewati proxy/container.

Pola lebih aman:

```java
@ApplicationScoped
public class CaseAsyncWorker {

    @Transactional
    public void processCaseById(String caseId) {
        // load inside worker transaction
    }
}

@ApplicationScoped
public class CaseAsyncSubmitter {

    @Resource
    ManagedExecutorService executor;

    @Inject
    CaseAsyncWorker worker;

    public void submit(String caseId) {
        executor.execute(() -> worker.processCaseById(caseId));
    }
}
```

---

## 13. Exception Handling

### 13.1 Exception dalam `execute`

Jika task melempar exception:

```java
executor.execute(() -> {
    throw new RuntimeException("boom");
});
```

Caller tidak menerima exception. Container mungkin log exception, tetapi kamu tidak boleh bergantung pada itu sebagai business handling.

Better:

```java
executor.execute(() -> {
    try {
        doWork();
    } catch (Exception e) {
        recordFailure(e);
        notifyIfNeeded(e);
    }
});
```

### 13.2 Exception dalam `submit`

```java
Future<Result> future = executor.submit(() -> {
    return doWork();
});

try {
    Result result = future.get();
} catch (ExecutionException e) {
    Throwable cause = e.getCause();
}
```

Jika `Future` diabaikan, exception bisa menjadi invisible.

Anti-pattern:

```java
executor.submit(() -> doImportantWork()); // Future ignored
```

Better:

```java
Future<?> future = executor.submit(() -> doImportantWork());
trackFuture(taskId, future);
```

atau task mencatat status sendiri.

---

## 14. Cancellation dan Interruption

`Future.cancel(true)` berarti:

- jika task belum mulai, task mungkin tidak dijalankan
- jika task sedang berjalan, thread akan di-interrupt
- task harus cooperative membaca interrupt
- blocking call tertentu mungkin merespons interrupt, sebagian tidak
- JDBC/HTTP client timeout tetap perlu dikonfigurasi sendiri

Contoh task cancellation-aware:

```java
public void processManyRecords(List<String> ids) {
    for (String id : ids) {
        if (Thread.currentThread().isInterrupted()) {
            markCancelled();
            return;
        }

        processOne(id);
    }
}
```

Untuk I/O:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(Duration.ofSeconds(3))
    .build();
```

Jangan hanya mengandalkan interrupt untuk menghentikan I/O yang macet.

Cancellation design yang bagus punya:

- application cancellation flag
- task status table
- timeout per operation
- transaction timeout
- external client timeout
- cooperative check points
- cleanup handler

---

## 15. Rejection Handling

Executor bisa menolak task.

Penyebab:

- executor shutting down
- capacity penuh
- policy server
- queue limit
- max async limit
- invalid context
- resource unavailable

Contoh handling:

```java
try {
    executor.execute(command::run);
} catch (RejectedExecutionException e) {
    markTaskRejected(command.taskId(), e);
    throw new ServiceUnavailableException("Async capacity exhausted", e);
}
```

Jangan treat rejection sebagai error teknis biasa. Dalam sistem enterprise, rejection adalah signal kapasitas.

Response strategy:

| Kondisi | Strategi |
|---|---|
| User action bisa dicoba lagi | Return 503/429 + retry hint |
| Pekerjaan penting dan durable | Simpan job record, jangan hanya submit memory task |
| Background non-critical | Drop dengan audit/metric |
| Workload bursty | Queue durable / batch later |
| Downstream sedang lambat | Circuit breaker / backpressure |

Rule:

> Jika task tidak boleh hilang, jangan hanya taruh di memory executor queue.

---

## 16. Sizing Executor

### 16.1 Pertanyaan Sebelum Menentukan Size

Jangan mulai dari angka `10` atau `50`. Mulai dari karakter workload.

Pertanyaan:

1. Task CPU-bound atau I/O-bound?
2. Rata-rata durasi task berapa?
3. P95/P99 durasi task berapa?
4. Downstream limit berapa?
5. DB connection pool tersedia berapa?
6. Apakah task membuka transaction?
7. Apakah task memanggil external API?
8. Apakah task bisa retry?
9. Apakah task bisa paralel tanpa lock contention?
10. Apa SLA queue wait?

### 16.2 CPU-Bound

Untuk CPU-bound task:

```text
concurrency ≈ number of cores allocated to JVM/application
```

Menambah thread jauh di atas core sering membuat context switching lebih buruk.

### 16.3 I/O-Bound

Untuk I/O-bound task, concurrency bisa lebih tinggi karena banyak waktu menunggu I/O.

Tetapi limit sebenarnya sering berada di:

- DB connection pool
- external API rate limit
- remote server concurrency
- network bandwidth
- transaction log/redo pressure
- memory

### 16.4 Little's Law

Little's Law:

```text
L = λ × W
```

Dimana:

- `L` = jumlah work in progress
- `λ` = throughput rate
- `W` = average time in system

Jika target throughput 100 task/detik dan average duration 200 ms:

```text
L = 100 × 0.2 = 20 concurrent tasks
```

Jika P95 duration naik jadi 2 detik:

```text
L = 100 × 2 = 200 concurrent tasks
```

Artinya slow downstream bisa membuat concurrency requirement meledak. Jika executor/queue tidak dibatasi, sistem bisa collapse.

### 16.5 Hubungan dengan DB Connection Pool

Jika setiap task butuh DB connection, executor concurrency tidak boleh melebihi budget DB connection.

Contoh:

```text
Hikari maxPoolSize = 50
request threads potentially use = 30
background executor safe DB concurrency = 10-15
remaining reserve = 5-10
```

Jangan set async executor 100 jika DB pool hanya 50 dan request path juga memakai DB.

Rule:

> Executor sizing harus dihitung bersama connection pool, downstream limit, dan request concurrency.

---

## 17. Queueing Strategy

### 17.1 Unbounded Queue Problem

Unbounded queue terlihat aman karena tidak reject. Tapi sebenarnya ia menyembunyikan overload.

Dampak:

- memory growth
- stale task
- latency background tidak terkendali
- OOM risk
- failure muncul terlambat

Bounded queue lebih jujur:

```text
capacity penuh -> reject -> caller tahu sistem overload
```

### 17.2 Queue Delay sebagai SLA

Untuk async task, SLA bukan hanya execution time.

```text
total latency = queue wait + execution time + retry delay
```

Jika task execution 200 ms tetapi queue wait 5 menit, user tetap melihat sistem lambat.

### 17.3 Durable Queue vs Executor Queue

Memory executor queue:

- cepat
- sederhana
- hilang jika JVM crash
- tidak ideal untuk critical work

Durable queue/job table:

- lebih lambat
- lebih kompleks
- survive restart
- bisa diobservasi/dikontrol
- cocok untuk critical/regulatory work

Rule:

> Executor queue adalah scheduling buffer, bukan system of record.

---

## 18. Pattern: Bounded Async Offload dari Request

### 18.1 Problem

User submit request. Ada pekerjaan tambahan yang tidak perlu selesai sebelum response, tetapi harus tetap dilacak.

Contoh:

- send notification
- recalculate derived status
- generate lightweight document
- sync non-critical downstream

### 18.2 Design

```text
HTTP Request
  |
  |-- validate
  |-- write business state
  |-- create async task record
  |-- commit
  |-- submit async task after commit / via outbox poller
  |
  +--> return 202 Accepted or 200 with pending status

Async Worker
  |
  |-- mark RUNNING
  |-- execute task
  |-- mark COMPLETED / FAILED
  |-- emit metric/audit
```

### 18.3 Command Object

```java
public record AsyncCommand(
    String taskId,
    String caseId,
    String taskType,
    String initiatedBy,
    String correlationId,
    Instant submittedAt
) {}
```

### 18.4 Submitter

```java
@ApplicationScoped
public class AsyncCommandSubmitter {

    @Resource(lookup = "java:app/concurrent/CaseWorkExecutor")
    ManagedExecutorService executor;

    @Inject
    AsyncCommandWorker worker;

    public void submit(AsyncCommand command) {
        try {
            executor.execute(() -> worker.run(command));
        } catch (RejectedExecutionException e) {
            worker.markRejected(command, e);
            throw e;
        }
    }
}
```

### 18.5 Worker

```java
@ApplicationScoped
public class AsyncCommandWorker {

    @Transactional
    public void markRejected(AsyncCommand command, Exception e) {
        // update task status = REJECTED
    }

    public void run(AsyncCommand command) {
        try {
            markRunning(command);
            executeBusinessWork(command);
            markCompleted(command);
        } catch (Exception e) {
            markFailed(command, e);
        }
    }

    @Transactional
    void markRunning(AsyncCommand command) {}

    @Transactional
    void executeBusinessWork(AsyncCommand command) {}

    @Transactional
    void markCompleted(AsyncCommand command) {}

    @Transactional
    void markFailed(AsyncCommand command, Exception e) {}
}
```

Catatan: dalam CDI biasa, method internal `this.markRunning(...)` mungkin tidak melewati proxy sehingga interceptor transaction bisa tidak aktif. Di implementasi nyata, pisahkan transaction service atau gunakan mekanisme container yang benar.

Better structure:

```text
AsyncCommandWorker
  -> TaskStatusRepository (@Transactional)
  -> BusinessService (@Transactional)
```

---

## 19. Pattern: Request Fan-Out/Fan-In

### 19.1 Cocok Untuk

- load beberapa data independen
- call beberapa service independen
- response tetap butuh hasil gabungan
- total timeout ketat

### 19.2 Tidak Cocok Untuk

- side effect tidak idempotent
- semua call memakai DB pool yang sama dan bisa menghabiskan connection
- downstream punya rate limit rendah
- request volume tinggi tanpa concurrency budget

### 19.3 Design

```text
request thread
  |-- submit A
  |-- submit B
  |-- submit C
  |-- wait bounded timeout
  |-- aggregate
  |-- cancel unfinished
```

### 19.4 Timeout Budget

Jangan memberi timeout masing-masing 3 detik jika request SLA 3 detik.

Budget:

```text
request SLA = 2s
validation = 100ms
fanout budget = 1500ms
aggregation = 100ms
reserve = 300ms
```

### 19.5 Failure Strategy

Tentukan:

- fail fast jika satu gagal?
- partial response boleh?
- fallback boleh?
- stale cache boleh?
- apakah error downstream harus terlihat ke user?

---

## 20. Pattern: Async Side Effect dengan Outbox

Untuk side effect penting, gunakan outbox.

### 20.1 Schema Konseptual

```sql
CREATE TABLE OUTBOX_TASK (
    ID              VARCHAR(64) PRIMARY KEY,
    TYPE            VARCHAR(100) NOT NULL,
    AGGREGATE_ID    VARCHAR(64) NOT NULL,
    PAYLOAD_JSON    CLOB NOT NULL,
    STATUS          VARCHAR(30) NOT NULL,
    ATTEMPT_COUNT   NUMBER NOT NULL,
    NEXT_RUN_AT     TIMESTAMP NOT NULL,
    CREATED_AT      TIMESTAMP NOT NULL,
    UPDATED_AT      TIMESTAMP NOT NULL,
    LOCK_OWNER      VARCHAR(100),
    LOCKED_AT       TIMESTAMP
);
```

### 20.2 Flow

```text
Business transaction:
  update case
  insert outbox task
  commit

Poller/worker:
  claim pending task
  submit to ManagedExecutorService
  execute
  mark done/failed/retry
```

### 20.3 Kenapa Ini Lebih Kuat

- task tidak hilang jika JVM crash
- bisa retry
- bisa inspect status
- bisa operator control
- bisa audit
- bisa deduplicate
- bisa scale lebih aman

Managed executor tetap dipakai, tetapi bukan sebagai durable storage.

---

## 21. Pattern: Executor per Workload/Bulkhead

Anti-pattern:

```text
DefaultManagedExecutorService dipakai semua:
- email
- report
- risk calculation
- external sync
- file parsing
- notification
```

Masalah:

- satu workload lambat bisa menghabiskan thread semua workload
- tidak ada fairness
- sulit tuning
- sulit observability

Better:

```text
CaseRiskExecutor          maxAsync=8
NotificationExecutor      maxAsync=4
DocumentGenerationExecutor maxAsync=6
ExternalRegistryExecutor  maxAsync=3
```

Ini disebut bulkhead.

Tujuannya bukan hanya performance, tetapi blast radius control.

---

## 22. Virtual Threads dan ManagedExecutorService

Jakarta Concurrency 3.1 mulai memasukkan dukungan terhadap Java SE Virtual Threads pada managed resources. Namun mental model-nya harus hati-hati.

Virtual threads membantu jika:

- task banyak blocking I/O
- task short-lived
- tidak CPU-bound
- bottleneck bukan DB connection atau downstream limit
- framework/server mendukung dengan benar

Virtual threads tidak otomatis menyelesaikan:

- transaction design
- persistence context thread safety
- context propagation
- audit attribution
- rate limiting
- downstream capacity
- duplicate side effects
- cancellation semantics

Rule:

> Virtual thread mengubah biaya blocking, bukan menghapus kebutuhan managed execution boundary.

Jika server menyediakan managed executor berbasis virtual thread, tetap pikirkan:

- max concurrency logical
- downstream limit
- DB pool
- memory per task
- observability
- cancellation
- context propagation

---

## 23. Testing ManagedExecutorService

### 23.1 Unit Testing

Untuk unit test, jangan butuh container penuh. Abstraksikan executor jika perlu.

Interface:

```java
public interface AsyncExecutor {
    void execute(Runnable task);
}
```

Production:

```java
@ApplicationScoped
public class ManagedAsyncExecutor implements AsyncExecutor {

    @Resource
    ManagedExecutorService executor;

    @Override
    public void execute(Runnable task) {
        executor.execute(task);
    }
}
```

Test synchronous:

```java
public class DirectAsyncExecutor implements AsyncExecutor {
    @Override
    public void execute(Runnable task) {
        task.run();
    }
}
```

Ini membuat business logic mudah dites.

### 23.2 Integration Testing

Integration test perlu memvalidasi:

- injection resource berhasil
- task berjalan
- exception dicatat
- context penting tersedia
- transaction boundary benar
- rejection handling bekerja jika bisa disimulasikan
- timeout/cancellation behavior sesuai ekspektasi

### 23.3 Deterministic Testing

Masalah async test adalah nondeterminism.

Gunakan:

- latch
- fake clock
- Awaitility-like polling
- bounded timeout
- test-specific executor config
- DB status assertion

Contoh:

```java
await()
    .atMost(Duration.ofSeconds(5))
    .untilAsserted(() -> assertTaskCompleted(taskId));
```

Jangan test dengan `Thread.sleep(5000)` tanpa kondisi.

---

## 24. Observability

Minimal metric per executor:

```text
executor.submitted.count
executor.accepted.count
executor.rejected.count
executor.running.count
executor.completed.count
executor.failed.count
executor.cancelled.count
executor.queue.wait.duration
executor.execution.duration
executor.total.duration
```

Minimal log fields:

```text
taskId
correlationId
caseId / aggregateId
taskType
initiatedBy
executorName
status
attempt
queueWaitMs
executionMs
errorCode
errorClass
```

Minimal status model:

```text
PENDING
ACCEPTED
RUNNING
COMPLETED
FAILED
RETRY_SCHEDULED
CANCEL_REQUESTED
CANCELLED
REJECTED
EXPIRED
```

Untuk task penting, log saja tidak cukup. Simpan status di database.

---

## 25. Failure Modes dan Cara Berpikirnya

### 25.1 Lost Task

Task hanya ada di memory queue. JVM crash sebelum task berjalan.

Mitigasi:

- durable job/outbox table
- Jakarta Batch
- messaging

### 25.2 Duplicate Execution

Task di-retry setelah timeout padahal side effect pertama sebenarnya sukses.

Mitigasi:

- idempotency key
- unique constraint
- external request id
- dedup table
- status reconciliation

### 25.3 Queue Explosion

Submit lebih cepat daripada execute.

Mitigasi:

- bounded queue
- rejection handling
- backpressure
- durable deferred processing
- rate limit submission

### 25.4 Executor Starvation

Satu jenis task lambat menghabiskan semua thread.

Mitigasi:

- executor per workload
- timeout
- bulkhead
- circuit breaker

### 25.5 Deadlock via Self-Wait

Task di executor submit subtask ke executor yang sama lalu menunggu, sementara semua thread penuh.

Contoh:

```text
Executor size = 4
4 parent tasks running
each parent submits child task and waits
no free thread for child
deadlock/starvation
```

Mitigasi:

- jangan blocking wait pada executor yang sama
- gunakan different executor
- gunakan async composition
- naikkan concurrency hanya jika benar-benar aman
- redesign task graph

### 25.6 Context Leak

Task menyimpan request-scoped object, entity managed, atau ThreadLocal state.

Mitigasi:

- immutable command
- pass ID, not entity
- explicit correlation context
- cleanup MDC

### 25.7 Transaction Race

Task async membaca data sebelum transaction submitter commit.

Mitigasi:

- after-commit event
- outbox
- durable queue

### 25.8 Silent Exception

Task gagal tapi tidak ada yang tahu.

Mitigasi:

- wrap task dengan failure recorder
- inspect Future
- status table
- metric failure count

### 25.9 Cancellation Ignored

Task tidak berhenti walau di-cancel.

Mitigasi:

- cooperative interrupt checks
- operation-level timeout
- cancellation flag
- idempotent partial work

### 25.10 Shutdown/Redeploy Issue

Task masih berjalan saat aplikasi redeploy.

Mitigasi:

- managed executor
- graceful stop
- short task
- durable checkpoint
- readiness/preStop handling in Kubernetes

---

## 26. Anti-Patterns

### 26.1 Membuat Thread Pool Sendiri di Jakarta EE

```java
private final ExecutorService executor = Executors.newFixedThreadPool(20);
```

Problem:

- unmanaged lifecycle
- context tidak portable
- shutdown/redeploy leak
- monitoring sulit

### 26.2 Memakai `CompletableFuture.supplyAsync` Tanpa Executor

```java
CompletableFuture.supplyAsync(() -> work());
```

Problem:

- common pool
- tidak managed
- context hilang

### 26.3 Submit dari Dalam Transaction Tanpa After-Commit

```java
@Transactional
public void submit() {
    save();
    executor.execute(() -> sideEffect());
}
```

Problem:

- race dengan commit
- side effect bisa terjadi walau rollback

### 26.4 Mengirim JPA Entity ke Task

```java
executor.execute(() -> process(entity));
```

Problem:

- entity detached/stale
- lazy loading fail
- persistence context not thread-safe

### 26.5 Unbounded Fire-and-Forget

```java
for (Record r : records) {
    executor.execute(() -> process(r));
}
```

Problem:

- queue explosion
- DB/downstream overload
- no backpressure

### 26.6 Mengabaikan Future

```java
executor.submit(() -> importantWork());
```

Problem:

- exception tersembunyi
- no lifecycle tracking

### 26.7 Long-Running Infinite Worker dalam Web App

```java
executor.execute(() -> {
    while (true) {
        poll();
    }
});
```

Problem:

- shutdown sulit
- lifecycle tidak jelas
- lebih cocok scheduler, batch, messaging listener, atau managed service dengan stop control

---

## 27. Production Design Checklist

Sebelum memakai `ManagedExecutorService`, jawab checklist ini.

### 27.1 Workload Fit

- [ ] Apakah task short/medium-lived?
- [ ] Apakah task tidak perlu restartability kompleks?
- [ ] Apakah task boleh hilang jika JVM crash? Jika tidak, apakah ada outbox/job table?
- [ ] Apakah task lebih cocok Jakarta Batch?
- [ ] Apakah task lebih cocok messaging?

### 27.2 Transaction

- [ ] Apakah task di-submit setelah commit?
- [ ] Apakah side effect idempotent?
- [ ] Apakah task membuka transaction sendiri?
- [ ] Apakah tidak ada JPA entity managed yang dikirim ke thread lain?

### 27.3 Security/Audit

- [ ] Siapa `initiatedBy`?
- [ ] Siapa `executedBy`?
- [ ] Authorization dicek kapan?
- [ ] Apakah audit mencatat correlation ID?
- [ ] Apakah role/user snapshot perlu disimpan?

### 27.4 Capacity

- [ ] Executor punya limit jelas?
- [ ] Queue bounded?
- [ ] DB connection pool cukup?
- [ ] Downstream rate limit dihormati?
- [ ] Ada rejection strategy?
- [ ] Ada timeout per task dan per I/O operation?

### 27.5 Observability

- [ ] Ada metric submitted/running/completed/failed/rejected?
- [ ] Ada queue wait duration?
- [ ] Ada execution duration?
- [ ] Ada task status table untuk task penting?
- [ ] Ada log correlation?

### 27.6 Failure Handling

- [ ] Exception tidak silent?
- [ ] Retry diklasifikasi?
- [ ] Cancellation cooperative?
- [ ] Partial side effect aman?
- [ ] Duplicate execution aman?

### 27.7 Deployment/Runtime

- [ ] Executor resource dinamai sesuai workload?
- [ ] Server config terdokumentasi?
- [ ] Behavior shutdown/redeploy dipahami?
- [ ] Kubernetes graceful termination dipertimbangkan?

---

## 28. Decision Framework Cepat

Gunakan `ManagedExecutorService` jika:

```text
short async work
+ container context needed
+ bounded concurrency
+ not necessarily durable by itself
+ result/status can be tracked
```

Gunakan Jakarta Batch jika:

```text
large dataset
+ restartable
+ chunk/partition/checkpoint
+ operator control
+ execution history
```

Gunakan messaging/outbox jika:

```text
durable side effect
+ decoupling
+ retry
+ eventual consistency
```

Gunakan scheduler jika:

```text
time-based trigger
+ periodic work
+ overlap/misfire policy needed
```

Gunakan workflow engine jika:

```text
long-running business process
+ human tasks
+ state machine
+ compensation
+ audit-heavy orchestration
```

---

## 29. End-to-End Mini Example: Async Case Risk Evaluation

### 29.1 Requirement

Saat case disubmit:

- response user tidak boleh menunggu risk scoring selesai
- risk scoring perlu memanggil beberapa data source
- hasil harus tercatat
- jika gagal, user/admin bisa melihat status
- task tidak boleh membuat duplicate risk result
- sistem harus punya audit attribution

### 29.2 Data Model

```sql
CREATE TABLE CASE_ASYNC_TASK (
    TASK_ID        VARCHAR(64) PRIMARY KEY,
    CASE_ID        VARCHAR(64) NOT NULL,
    TASK_TYPE      VARCHAR(100) NOT NULL,
    STATUS         VARCHAR(30) NOT NULL,
    INITIATED_BY   VARCHAR(100) NOT NULL,
    CORRELATION_ID VARCHAR(100) NOT NULL,
    ATTEMPT_COUNT  NUMBER DEFAULT 0 NOT NULL,
    ERROR_CODE     VARCHAR(100),
    ERROR_MESSAGE  VARCHAR(1000),
    CREATED_AT     TIMESTAMP NOT NULL,
    UPDATED_AT     TIMESTAMP NOT NULL,
    UNIQUE (CASE_ID, TASK_TYPE)
);
```

### 29.3 Submitter

```java
@ApplicationScoped
public class CaseSubmissionService {

    @Inject
    CaseRepository caseRepository;

    @Inject
    CaseAsyncTaskRepository taskRepository;

    @Inject
    CaseRiskAsyncSubmitter riskSubmitter;

    @Transactional
    public SubmitCaseResult submit(String caseId, String userId, String correlationId) {
        caseRepository.markSubmitted(caseId, userId);

        String taskId = taskRepository.createPendingTask(
            caseId,
            "RISK_EVALUATION",
            userId,
            correlationId
        );

        // In production, prefer after-commit event/outbox poller.
        // This line is intentionally shown as a simplified version.
        riskSubmitter.submit(new RiskEvaluationCommand(
            taskId,
            caseId,
            userId,
            correlationId
        ));

        return new SubmitCaseResult(caseId, "SUBMITTED", taskId);
    }
}
```

### 29.4 Command

```java
public record RiskEvaluationCommand(
    String taskId,
    String caseId,
    String initiatedBy,
    String correlationId
) {}
```

### 29.5 Async Submitter

```java
@ApplicationScoped
public class CaseRiskAsyncSubmitter {

    @Resource(lookup = "java:app/concurrent/CaseRiskExecutor")
    ManagedExecutorService executor;

    @Inject
    CaseRiskWorker worker;

    @Inject
    CaseAsyncTaskRepository taskRepository;

    public void submit(RiskEvaluationCommand command) {
        try {
            executor.execute(() -> worker.evaluate(command));
        } catch (RejectedExecutionException e) {
            taskRepository.markRejected(command.taskId(), e);
            throw e;
        }
    }
}
```

### 29.6 Worker

```java
@ApplicationScoped
public class CaseRiskWorker {

    @Inject
    CaseAsyncTaskRepository taskRepository;

    @Inject
    RiskEvaluationService riskEvaluationService;

    public void evaluate(RiskEvaluationCommand command) {
        long startedNanos = System.nanoTime();

        try {
            taskRepository.markRunning(command.taskId());

            RiskScore score = riskEvaluationService.evaluate(command.caseId());

            taskRepository.markCompleted(command.taskId());
            recordMetric("risk_evaluation.completed", startedNanos);
        } catch (Exception e) {
            taskRepository.markFailed(command.taskId(), e);
            recordMetric("risk_evaluation.failed", startedNanos);
        }
    }

    private void recordMetric(String name, long startedNanos) {}
}
```

### 29.7 Risk Service

```java
@ApplicationScoped
public class RiskEvaluationService {

    @Transactional
    public RiskScore evaluate(String caseId) {
        // Load fresh data inside worker transaction.
        // Calculate score.
        // Upsert result using unique key CASE_ID.
        // Avoid duplicate side effect.
        return new RiskScore(caseId, 80);
    }
}
```

### 29.8 Improvement untuk Production

Versi production sebaiknya:

- tidak submit executor langsung dari transaction
- memakai outbox atau after-commit event
- task claim memakai optimistic lock/status transition
- result write idempotent
- retry terklasifikasi
- timeout external call eksplisit
- metric dan trace lengkap
- executor per workload

---

## 30. Latihan / Thought Experiment

### Latihan 1

Sebuah endpoint `POST /cases/{id}/submit` melakukan:

1. update status case
2. generate PDF
3. send email
4. call external registry
5. return response

Mana yang tetap sinkron, mana yang async, mana yang outbox, mana yang batch?

Pertimbangkan:

- apakah user butuh hasil langsung
- apakah side effect harus durable
- apakah external API punya rate limit
- apakah PDF bisa digenerate ulang
- apakah email duplicate berbahaya
- apakah audit perlu record-level evidence

### Latihan 2

Executor `DefaultManagedExecutorService` dipakai untuk:

- notification
- report generation
- risk scoring
- file import

Tiba-tiba report generation lambat dan semua notification tertunda.

Desain ulang executor topology-nya.

### Latihan 3

Task async gagal setelah external API berhasil tetapi sebelum database status diupdate.

Bagaimana mencegah retry mengirim request duplicate?

### Latihan 4

Kamu punya 50 DB connections. Request path bisa memakai sampai 35 connection saat peak. Berapa concurrency aman untuk executor yang setiap task butuh DB connection?

Jawaban tidak harus angka tunggal; jelaskan reserve, p95, dan backpressure.

---

## 31. Ringkasan

`ManagedExecutorService` adalah fondasi concurrency enterprise di Jakarta EE untuk menjalankan asynchronous task secara container-aware.

Inti yang harus diingat:

1. Ia bukan thread pool biasa; ia adalah managed execution boundary.
2. Async tidak menghapus work, hanya memindahkan waktu/tempat eksekusi.
3. Jangan memakai unmanaged `ExecutorService` atau common pool sembarangan di Jakarta EE.
4. Jangan mengirim JPA entity/request object ke task async.
5. Jangan submit side effect dari dalam transaction tanpa after-commit/outbox pattern.
6. Gunakan command object immutable.
7. Pikirkan queue wait, rejection, cancellation, timeout, retry, dan observability.
8. Jika task critical dan tidak boleh hilang, gunakan durable job/outbox/Batch/messaging.
9. Executor sizing harus selaras dengan DB pool, downstream limit, CPU, dan SLA.
10. Production-grade async bukan soal `submit()`, tetapi soal lifecycle, boundary, capacity, auditability, dan failure recovery.

---

## 32. Koneksi ke Part Berikutnya

Part ini membahas `ManagedExecutorService`, yaitu executor untuk task asynchronous umum.

Part berikutnya akan membahas:

```text
Part 4 — ManagedScheduledExecutorService and Time-Based Workloads
```

Fokus berikutnya:

- one-shot delay
- periodic task
- fixed-rate vs fixed-delay
- overlap
- misfire
- cluster duplicate scheduler
- DB lock/leader election
- kapan scheduler cukup dan kapan harus pindah ke Batch atau external scheduler

---

## 33. Referensi Resmi dan Lanjutan

- Jakarta Concurrency 3.1 Specification — `https://jakarta.ee/specifications/concurrency/3.1/`
- Jakarta Concurrency 3.1 API: `ManagedExecutorService` — `https://jakarta.ee/specifications/concurrency/3.1/apidocs/jakarta.concurrency/jakarta/enterprise/concurrent/managedexecutorservice`
- Jakarta EE 11 Release Page — `https://jakarta.ee/release/11/`
- Jakarta EE Tutorial: Concurrency Utilities — `https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/concurrency-utilities/concurrency-utilities.html`
- OpenJDK JEP 444: Virtual Threads — `https://openjdk.org/jeps/444`
- OpenJDK JEP 505: Structured Concurrency, fifth preview — `https://openjdk.org/jeps/505`

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./02-container-integrity-and-managed-concurrency.md">⬅️ Part 2 — Container Integrity: Why Managed Concurrency Exists</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./04-managed-scheduled-executor-service-time-based-workloads.md">Part 4 — ManagedScheduledExecutorService and Time-Based Workloads ➡️</a>
</div>

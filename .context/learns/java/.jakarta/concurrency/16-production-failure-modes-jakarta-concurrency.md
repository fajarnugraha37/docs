# Part 16 — Production Failure Modes in Jakarta Concurrency

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `16-production-failure-modes-jakarta-concurrency.md`  
> Scope: Java 8–25, Java EE/Jakarta EE managed concurrency, enterprise async workload failure analysis  
> Baseline: Jakarta EE 11, Jakarta Concurrency 3.1, Jakarta Batch 2.1

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Melihat kegagalan concurrency bukan sebagai “thread error”, tetapi sebagai pelanggaran invariant runtime.
2. Mengklasifikasikan failure mode pada workload asynchronous Jakarta EE secara sistematis.
3. Membedakan gejala, root cause, blast radius, dan mitigation.
4. Mendesain async workload yang tahan terhadap redeploy, shutdown, overload, context loss, duplicate execution, dan slow downstream.
5. Membuat diagnostic playbook untuk production incident.
6. Memahami kapan masalah diselesaikan dengan Jakarta Concurrency, kapan dengan Jakarta Batch, kapan dengan durable queue, dan kapan harus dinaikkan menjadi orchestration/control-plane problem.

Bagian ini bukan sekadar daftar “best practice”. Kita akan membangun cara berpikir seperti engineer production: setiap async workload harus punya **ownership, lifecycle, capacity, identity, cancellation, retry, idempotency, observability, dan recovery path**.

---

## 2. Posisi Part Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- container integrity
- `ManagedExecutorService`
- scheduled executor
- managed thread factory
- context propagation
- transaction boundary
- security identity
- CDI/interceptor/event boundary
- `CompletableFuture`
- virtual threads
- structured concurrency/scoped values
- capacity/backpressure/bulkhead/fairness
- cancellation/timeout/retry/interruption
- observability

Part ini menyatukan semuanya ke dalam satu pertanyaan besar:

> “Apa saja cara async workload enterprise bisa gagal di production, bagaimana mendeteksinya, dan bagaimana mendesain agar failure tidak berubah menjadi outage?”

Jakarta Concurrency dirancang agar aplikasi dapat memakai concurrency dari application component tanpa mengorbankan integritas container. Tetapi spesifikasi hanya menyediakan building block seperti managed executor, scheduled executor, thread factory, context service, managed task, dan listener. Ia tidak otomatis membuat workload-mu aman dari overload, duplicate execution, bad retry, missing audit, atau desain transaksi yang salah.

Dengan kata lain:

```text
Jakarta Concurrency gives safe execution primitives.
Production engineering gives safe workload behavior.
```

---

## 3. Mental Model Utama: Failure Mode = Invariant yang Dilanggar

Jangan mulai diagnosis dengan pertanyaan:

```text
Thread mana yang error?
```

Mulailah dengan:

```text
Invariant apa yang seharusnya selalu benar, tetapi sekarang tidak benar?
```

Contoh invariant untuk async workload:

| Area | Invariant |
|---|---|
| Lifecycle | Tidak ada task dari deployment lama yang masih berjalan setelah undeploy/redeploy selesai. |
| Capacity | Jumlah task aktif dan queued tidak boleh melebihi kapasitas downstream. |
| Identity | Setiap task punya initiator, executor identity, correlation id, dan audit attribution yang jelas. |
| Context | Task tidak boleh memakai request/CDI/security/transaction context yang sudah expired. |
| Transaction | Async task tidak bergantung pada transaksi request caller. |
| Retry | Retry tidak boleh memperbesar overload downstream. |
| Cancellation | Stop/cancel harus bisa diamati dan dihormati secara kooperatif. |
| Idempotency | Task boleh dieksekusi ulang tanpa menciptakan side effect ganda yang berbahaya. |
| Observability | Semua state penting task terlihat di metric/log/trace/audit/control plane. |
| Cluster | Di cluster, task scheduled tidak boleh berjalan ganda tanpa koordinasi. |

Jika incident terjadi, tugas utama bukan langsung menambah thread, menaikkan timeout, atau restart server. Tugas utama adalah menemukan invariant yang runtuh.

---

## 4. Taxonomy Failure Mode

Dalam Jakarta Concurrency, production failure biasanya jatuh ke beberapa kategori:

```text
1. Lifecycle failure
   - redeploy leak
   - zombie task
   - shutdown hang

2. Ownership failure
   - unmanaged thread
   - commonPool leakage
   - hidden scheduler

3. Capacity failure
   - executor exhaustion
   - unbounded queue
   - DB pool starvation
   - CPU saturation

4. Context failure
   - lost security context
   - stale request context
   - MDC/correlation missing
   - classloader leak

5. Transaction failure
   - long transaction
   - detached async side effect
   - retry after partial commit

6. Coordination failure
   - duplicate scheduled execution
   - duplicate job launch
   - race between nodes

7. Cancellation/retry failure
   - ignored interrupt
   - retry storm
   - poison task loop

8. Observability failure
   - task invisible
   - no business key
   - no audit trail
   - no queue metric

9. Downstream failure
   - slow DB
   - slow API
   - rate limit
   - backpressure missing

10. Deployment/runtime failure
   - rolling deployment while tasks still active
   - class version mismatch
   - dependency upgrade changes context behavior
```

Kita akan membahas masing-masing sebagai pola production.

---

## 5. Baseline API dan Spesifikasi yang Relevan

Jakarta Concurrency menyediakan standar untuk concurrency dari application component tanpa mengorbankan container integrity. Building block pentingnya:

- `ManagedExecutorService`
- `ManagedScheduledExecutorService`
- `ManagedThreadFactory`
- `ContextService`
- `ManagedTask`
- `ManagedTaskListener`
- `Trigger`

Container Jakarta EE compliant menyediakan executor service, context service, dan managed thread factory agar task dapat dijalankan asynchronous atau scheduled dengan container context yang sesuai.

Jakarta Batch menyediakan model berbeda: job/step/chunk/batchlet, repository, restart, stop, inspect, dan operation melalui `JobOperator`. Batch dipakai ketika workload harus durable, restartable, inspectable, dan berumur lebih panjang daripada request.

Pemisahan ini penting:

```text
ManagedExecutorService = execution primitive.
Jakarta Batch = durable batch workload model.
Messaging/queue = durable asynchronous communication.
Workflow engine = long-running business orchestration.
```

Kesalahan umum adalah memakai executor untuk kasus yang sebenarnya membutuhkan batch repository, queue, atau workflow engine.

---

## 6. Failure Mode 1 — Redeploy Leak

### 6.1 Definisi

Redeploy leak terjadi ketika task, thread, timer, future, scheduler, atau resource dari deployment lama tetap hidup setelah aplikasi di-redeploy.

Gejala:

- log lama masih muncul setelah redeploy
- task berjalan dua kali setelah redeploy
- memory meningkat setiap redeploy
- `ClassCastException` aneh antar class yang namanya sama
- `OutOfMemoryError: Metaspace`
- thread dump menunjukkan thread dengan classloader lama
- aplikasi baru memakai config lama
- scheduler berjalan ganda: deployment lama + deployment baru

### 6.2 Root Cause Umum

Penyebab paling sering:

```java
new Thread(() -> {
    while (true) {
        doWork();
    }
}).start();
```

atau:

```java
private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(10);
```

atau:

```java
CompletableFuture.runAsync(this::doWork); // commonPool
```

Masalahnya bukan hanya thread-nya. Masalahnya thread tersebut bisa mempertahankan reference ke:

- application classloader
- CDI bean instance
- datasource wrapper
- JPA provider class
- logger context
- configuration object
- security context
- static cache
- request object

Saat redeploy, container ingin melepas deployment lama. Tetapi jika unmanaged thread masih hidup dan memegang reference ke classloader lama, classloader tidak bisa di-GC.

### 6.3 Invariant yang Dilanggar

```text
Tidak boleh ada execution object milik deployment lama yang hidup di luar lifecycle deployment tersebut.
```

### 6.4 Dampak

Dampaknya bisa lebih parah dari memory leak:

- duplicate side effect
- data diproses oleh versi lama dan baru bersamaan
- audit tidak konsisten
- database lock dari task lama
- old code path memanggil API dengan contract lama
- incident sulit direproduksi karena hanya muncul setelah beberapa redeploy

### 6.5 Mitigasi

Gunakan managed concurrency resource:

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class ReportAsyncService {

    @Resource
    private ManagedExecutorService executor;

    public void generateAsync(String reportId) {
        executor.submit(() -> generateReport(reportId));
    }

    private void generateReport(String reportId) {
        // short-lived, bounded, observable work
    }
}
```

Tambahkan lifecycle hook untuk resource yang kamu miliki sendiri:

```java
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class LocalCacheHolder {

    @PreDestroy
    public void shutdown() {
        // close file handles, stop polling client, release custom resources
    }
}
```

Tetapi jangan memanggil `shutdown()` pada managed executor milik container. Lifecycle executor itu milik container.

### 6.6 Diagnostic Playbook

Saat menduga redeploy leak:

1. Ambil thread dump sebelum dan sesudah redeploy.
2. Cari thread name yang berasal dari aplikasi lama.
3. Cari stack trace yang menunjuk class aplikasi.
4. Cek apakah ada static executor/timer/scheduler.
5. Cek `CompletableFuture.runAsync` tanpa executor eksplisit.
6. Cek library yang membuat thread sendiri.
7. Cek scheduled task yang tidak dihentikan.
8. Cek metric jumlah task aktif setelah undeploy.
9. Cek memory/metaspace setelah beberapa redeploy.

### 6.7 Design Rule

```text
Aplikasi Jakarta EE boleh meminta eksekusi asynchronous kepada container.
Aplikasi tidak boleh diam-diam menjadi container kecil yang mengelola thread lifecycle sendiri.
```

---

## 7. Failure Mode 2 — Zombie Task After Shutdown

### 7.1 Definisi

Zombie task adalah task yang tetap berjalan atau terus mencoba side effect setelah aplikasi/node sedang shutdown.

Kondisi ini sering terjadi di Kubernetes/EKS saat pod menerima termination signal, tetapi task tidak merespons stop/cancel dengan baik.

### 7.2 Gejala

- pod lama masih menulis data saat pod baru sudah aktif
- task gagal di tengah karena connection ditutup saat shutdown
- duplicate processing setelah restart
- shutdown lambat atau force killed
- job terlihat `RUNNING` padahal node sudah mati
- external API menerima request dari instance yang seharusnya sudah berhenti

### 7.3 Root Cause

Root cause umum:

- task tidak pernah cek interruption
- loop tidak punya cancellation flag
- blocking call tidak punya timeout
- tidak ada checkpoint
- task memegang lock terlalu lama
- shutdown grace period lebih pendek dari durasi task
- aplikasi memakai in-memory queue tanpa durable handoff

Contoh buruk:

```java
public void processForever() {
    while (true) {
        Record r = queue.take();
        callExternalApi(r); // no timeout
    }
}
```

Task ini tidak tahu kapan harus berhenti. Jika `take()` atau `callExternalApi()` blocking terlalu lama, shutdown tidak bisa rapi.

### 7.4 Invariant yang Dilanggar

```text
Setiap task harus punya mekanisme berhenti yang kooperatif dan batas waktu untuk blocking operation.
```

### 7.5 Mitigasi

Gunakan deadline dan cancellation check:

```java
public final class CancellableWorker implements Runnable {

    private final WorkRepository repository;
    private final ExternalClient client;

    public CancellableWorker(WorkRepository repository, ExternalClient client) {
        this.repository = repository;
        this.client = client;
    }

    @Override
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            WorkItem item = repository.claimNext();

            if (item == null) {
                return;
            }

            try {
                client.callWithTimeout(item, Duration.ofSeconds(5));
                repository.markDone(item.id());
            } catch (TransientExternalException e) {
                repository.releaseForRetry(item.id(), e.getMessage());
            } catch (PermanentExternalException e) {
                repository.markFailed(item.id(), e.getMessage());
            }
        }
    }
}
```

Untuk workload panjang, gunakan durable job/request table:

```text
REQUESTED -> CLAIMED -> PROCESSING -> COMPLETED
                         |      |
                         |      -> FAILED_RETRYABLE
                         -> CANCEL_REQUESTED
```

### 7.6 Kubernetes/EKS Consideration

Di container orchestration, termination bukan teori:

1. pod menerima signal terminasi
2. readiness harus turun
3. traffic baru berhenti masuk
4. aplikasi punya grace period
5. task harus stop atau checkpoint
6. pod bisa dipaksa mati

Jika task tidak durable, in-flight work bisa hilang.

### 7.7 Design Rule

```text
Jika sebuah task tidak aman dihentikan kapan saja, task itu harus punya checkpoint dan recovery model.
```

---

## 8. Failure Mode 3 — Executor Exhaustion

### 8.1 Definisi

Executor exhaustion terjadi ketika semua worker thread sibuk, queue penuh atau terus bertambah, dan task baru tidak bisa diproses tepat waktu.

### 8.2 Gejala

- request latency naik
- async task makin lambat mulai
- timeout meningkat
- CPU mungkin tidak penuh, tetapi latency tinggi
- DB pool habis
- active thread stabil di batas maksimum
- queue depth naik terus
- rejection meningkat

### 8.3 Root Cause

Root cause utama:

- pool terlalu kecil untuk workload sah
- pool terlalu besar sehingga downstream collapse
- task blocking terlalu lama
- tidak ada timeout downstream
- queue unbounded
- retry memperbanyak task
- background task berbagi executor dengan request-critical task
- CPU-bound dan I/O-bound workload dicampur

### 8.4 Invariant yang Dilanggar

```text
Jumlah pekerjaan yang diterima harus sejalan dengan kapasitas eksekusi dan kapasitas downstream.
```

### 8.5 Formula Sederhana

Gunakan Little's Law sebagai mental model:

```text
L = λ × W
```

Keterangan:

- `L` = jumlah work in system
- `λ` = arrival rate
- `W` = waktu rata-rata di sistem

Jika task masuk 100/s dan durasi rata-rata menjadi 5s karena downstream lambat:

```text
L = 100 × 5 = 500 task concurrent/queued
```

Jika kapasitas aman hanya 80 task, sistem akan collapse.

### 8.6 Mitigasi

Pisahkan executor berdasarkan workload:

```text
Executor A: short user-facing async work
Executor B: external API fan-out
Executor C: report generation
Executor D: maintenance/background cleanup
```

Terapkan admission control:

```java
public CompletionStage<SubmitResult> submitWork(WorkCommand command) {
    if (capacityLimiter.isFull()) {
        return CompletableFuture.completedFuture(
            SubmitResult.rejected("System is busy. Please retry later.")
        );
    }

    capacityLimiter.acquire();

    return CompletableFuture
        .supplyAsync(() -> execute(command), managedExecutor)
        .whenComplete((result, error) -> capacityLimiter.release());
}
```

Untuk work yang tidak boleh hilang, jangan reject tanpa menyimpan. Gunakan durable queue/job request:

```text
1. validate request
2. persist job request
3. return job id
4. worker processes according to capacity
```

### 8.7 Diagnostic Playbook

Cek metric:

- active thread count
- queue depth
- task wait time
- task execution time
- rejection count
- timeout count
- downstream latency
- DB pool active/waiting
- CPU utilization
- GC pause

Pertanyaan penting:

```text
Apakah task lambat karena menunggu executor, atau executor lambat karena task menunggu downstream?
```

---

## 9. Failure Mode 4 — Queue Explosion

### 9.1 Definisi

Queue explosion terjadi ketika executor menerima task lebih cepat daripada kemampuan memproses, dan queue terus membesar.

Masalah ini sering lebih berbahaya daripada rejection cepat, karena queue memberi ilusi bahwa sistem masih menerima pekerjaan.

### 9.2 Gejala

- memory naik
- latency task makin panjang
- request caller sukses submit tetapi hasil terlambat jauh
- task kadaluarsa sebelum diproses
- OOM
- restart menyebabkan task in-memory hilang
- user melakukan submit ulang karena tidak melihat progress

### 9.3 Root Cause

- unbounded executor queue
- tidak ada deadline per task
- tidak ada max age
- tidak ada admission control
- retry enqueue task baru tanpa batas
- queue dipakai sebagai durable system padahal in-memory

### 9.4 Invariant yang Dilanggar

```text
Queue bukan tempat sampah tak terbatas. Queue adalah janji latency.
```

Saat menerima task ke queue, sistem seolah berkata:

```text
Saya mampu memproses task ini dalam batas waktu yang masih bernilai.
```

Jika itu tidak benar, menerima task adalah kebohongan operasional.

### 9.5 Mitigasi

Gunakan bounded queue atau durable queue dengan policy jelas:

```text
If work is optional      -> reject/degrade
If work is important     -> persist durable request
If work is urgent        -> prioritize with fairness
If work is stale-sensitive -> expire before processing
```

Tambahkan max age:

```java
public void execute(JobRequest request) {
    if (request.createdAt().plusMinutes(10).isBefore(Instant.now())) {
        repository.markExpired(request.id(), "Exceeded max queue age");
        return;
    }

    process(request);
}
```

### 9.6 Anti-Pattern

```java
ExecutorService executor = Executors.newFixedThreadPool(20);

// Default fixed thread pool uses an unbounded LinkedBlockingQueue.
```

Di Java SE biasa ini saja sudah riskan. Di Jakarta EE, lebih buruk lagi jika executor unmanaged.

### 9.7 Design Rule

```text
Setiap queue harus punya capacity, priority/fairness policy, max age, metric, dan owner.
```

---

## 10. Failure Mode 5 — CommonPool Leakage

### 10.1 Definisi

CommonPool leakage terjadi ketika async computation masuk ke `ForkJoinPool.commonPool()` secara tidak sengaja dari aplikasi Jakarta EE.

Contoh:

```java
CompletableFuture.supplyAsync(() -> loadData());
```

Tanpa executor eksplisit, method async `CompletableFuture` memakai default executor, umumnya common pool.

### 10.2 Gejala

- task tidak memakai managed context
- MDC/correlation hilang
- security identity hilang
- classloader leak risk
- tuning sulit karena pool global
- unrelated library/task saling mengganggu
- app server tidak bisa mengelola lifecycle task

### 10.3 Invariant yang Dilanggar

```text
Semua async execution di application component harus melewati execution resource yang diketahui dan dikelola.
```

### 10.4 Mitigasi

Selalu supply managed executor:

```java
@Inject
ManagedExecutorService executor;

public CompletionStage<CustomerProfile> loadProfile(String customerId) {
    return CompletableFuture
        .supplyAsync(() -> customerRepository.find(customerId), executor)
        .thenApplyAsync(this::enrichProfile, executor);
}
```

Perhatikan juga stage non-async:

```java
.thenApply(this::map)
```

Stage non-async dapat berjalan di thread yang menyelesaikan stage sebelumnya. Itu bisa benar untuk transformasi ringan, tetapi harus disengaja.

### 10.5 Code Review Rule

Cari pola ini:

```text
CompletableFuture.runAsync(
CompletableFuture.supplyAsync(
thenApplyAsync(
thenComposeAsync(
thenCombineAsync(
```

Jika tidak ada executor eksplisit, tanyakan:

```text
Thread mana yang menjalankan ini?
Context apa yang ikut?
Siapa yang mengatur lifecycle dan capacity-nya?
```

---

## 11. Failure Mode 6 — Lost Context

### 11.1 Definisi

Lost context terjadi ketika task asynchronous berjalan tanpa context yang diperlukan:

- correlation id
- MDC logging
- tenant id
- locale
- security principal
- application/module identifier
- request/job id
- audit actor

### 11.2 Gejala

- log tidak bisa ditelusuri
- audit record `createdBy = null`
- task berjalan sebagai anonymous/system tanpa alasan
- tenant salah
- authorization gagal sporadis
- error hanya muncul di async path
- trace terputus setelah submit async

### 11.3 Root Cause

- context disimpan di `ThreadLocal`
- task pindah thread
- tidak ada explicit context snapshot
- mengandalkan request context yang sudah selesai
- MDC tidak dipropagasikan
- security identity tidak didesain ulang untuk async

### 11.4 Invariant yang Dilanggar

```text
Task harus membawa identity operasional yang eksplisit, bukan bergantung pada kebetulan thread caller.
```

### 11.5 Mitigasi: Context Snapshot

Buat context eksplisit:

```java
public record TaskContext(
    String correlationId,
    String tenantId,
    String initiatedBy,
    String effectiveRole,
    Instant requestedAt
) {}
```

Gunakan saat submit:

```java
public void submit(CaseId caseId) {
    TaskContext context = TaskContextCapture.fromCurrentRequest();

    executor.submit(() -> {
        try (var ignored = LoggingContext.open(context)) {
            processCase(caseId, context);
        }
    });
}
```

Jangan hanya membawa seluruh request object:

```java
// Bad
executor.submit(() -> use(httpServletRequest));
```

Request object memiliki lifecycle sendiri dan tidak boleh diasumsikan valid di task async.

### 11.6 Mitigasi: ContextService

Untuk context container tertentu, gunakan `ContextService` atau managed executor sesuai kebutuhan. Tetapi tetap bedakan:

```text
Container context propagation != business/audit context design.
```

Container bisa membantu membawa sebagian context teknis. Namun audit attribution seperti `initiatedBy`, `reason`, `approvalId`, atau `caseId` tetap harus dimodelkan secara eksplisit.

---

## 12. Failure Mode 7 — Stale Context

### 12.1 Definisi

Stale context lebih berbahaya daripada lost context. Lost context terlihat kosong. Stale context terlihat valid, tetapi sudah tidak benar.

Contoh:

- user submit task saat punya role `Supervisor`
- task berjalan 2 jam kemudian
- role user sudah dicabut
- task tetap memakai role lama tanpa policy yang jelas

### 12.2 Gejala

- perubahan permission tidak tercermin pada async task
- task berjalan atas nama user yang sudah disabled
- tenant context berubah tetapi task lama masih memakai tenant lama
- audit terlihat sah tetapi secara bisnis salah

### 12.3 Invariant yang Dilanggar

```text
Context yang dipakai task harus punya validity model.
```

### 12.4 Dua Model yang Sah

#### Model A — Authorize at enqueue time

Sistem mengecek hak user saat request diterima. Jika sah, task boleh lanjut walau role user berubah kemudian.

Cocok untuk:

- approval yang sudah dicatat
- legally binding user action
- submission snapshot

Harus audit:

```text
initiatedBy=userA
authorizedAt=2026-06-17T10:00:00Z
authorizationModel=AT_ENQUEUE
roleSnapshot=Supervisor
approvalReference=APP-123
```

#### Model B — Authorize at execution time

Sistem mengecek hak saat task benar-benar berjalan.

Cocok untuk:

- delayed administrative action
- scheduled operation atas nama user
- sensitive operation yang harus mengikuti permission terbaru

Harus siap gagal:

```text
Task rejected because user no longer has required permission.
```

### 12.5 Design Rule

```text
Tidak ada jawaban universal. Yang salah adalah tidak memilih model sama sekali.
```

---

## 13. Failure Mode 8 — Transaction Ghost

### 13.1 Definisi

Transaction ghost terjadi ketika developer mengira async task masih berada dalam transaksi caller, padahal tidak; atau sebaliknya mengira side effect sudah aman, padahal caller transaction rollback.

### 13.2 Contoh Buruk

```java
@Transactional
public void approveCase(String caseId) {
    caseRepository.markApproved(caseId);

    executor.submit(() -> emailService.sendApprovalEmail(caseId));

    if (somethingBad()) {
        throw new RuntimeException("rollback");
    }
}
```

Jika email terkirim sebelum transaksi rollback, user menerima email approval untuk case yang tidak approved.

### 13.3 Invariant yang Dilanggar

```text
External side effect tidak boleh merepresentasikan state database yang belum committed.
```

### 13.4 Mitigasi: Transactional Outbox

```java
@Transactional
public void approveCase(String caseId) {
    caseRepository.markApproved(caseId);
    outboxRepository.insert(new OutboxMessage(
        "CASE_APPROVED",
        caseId,
        UUID.randomUUID().toString()
    ));
}
```

Worker terpisah:

```java
public void dispatchOutbox() {
    List<OutboxMessage> messages = outboxRepository.claimBatch(100);

    for (OutboxMessage message : messages) {
        try {
            externalPublisher.publish(message);
            outboxRepository.markPublished(message.id());
        } catch (TransientException e) {
            outboxRepository.releaseForRetry(message.id());
        }
    }
}
```

### 13.5 Diagnostic Question

Saat melihat async side effect:

```text
Apakah side effect ini terjadi setelah commit, sebelum commit, atau tidak terikat pada commit sama sekali?
```

Jika jawabannya tidak jelas, desainnya rawan.

---

## 14. Failure Mode 9 — Duplicate Execution

### 14.1 Definisi

Duplicate execution terjadi ketika logical work yang sama dieksekusi lebih dari sekali.

Di distributed system, duplicate execution bukan edge case. Itu kondisi normal yang harus didesain.

### 14.2 Penyebab

- user double submit
- browser retry
- HTTP client retry
- executor retry
- node crash setelah side effect tetapi sebelum mark done
- scheduler berjalan di banyak node
- batch restart
- message redelivery
- operator restart job
- rolling deployment overlap

### 14.3 Invariant yang Dilanggar

```text
Logical work identity harus stabil dan side effect harus idempotent.
```

### 14.4 Idempotency Key

Setiap logical work harus punya key:

```text
caseId + actionType + businessVersion
```

Contoh:

```java
public record WorkKey(
    String aggregateType,
    String aggregateId,
    String action,
    long version
) {}
```

Simpan di database:

```sql
create table async_work_request (
    id varchar2(64) primary key,
    aggregate_type varchar2(50) not null,
    aggregate_id varchar2(100) not null,
    action varchar2(100) not null,
    business_version number not null,
    status varchar2(30) not null,
    created_at timestamp not null,
    unique (aggregate_type, aggregate_id, action, business_version)
);
```

### 14.5 Idempotent Writer

```java
public void sendCorrespondence(CorrespondenceCommand command) {
    if (correspondenceRepository.existsByIdempotencyKey(command.idempotencyKey())) {
        return;
    }

    externalMailClient.send(command);

    correspondenceRepository.recordSent(
        command.idempotencyKey(),
        command.caseId(),
        Instant.now()
    );
}
```

Tetapi perhatikan race:

```text
send external -> crash before recordSent
```

Untuk external side effect, lebih aman jika external system mendukung idempotency key juga.

### 14.6 Design Rule

```text
Retry tanpa idempotency adalah bug yang menunggu traffic.
```

---

## 15. Failure Mode 10 — Cluster Duplicate Scheduled Execution

### 15.1 Definisi

Di cluster, scheduled task bisa berjalan di setiap node. Jika ada 4 pod, task bisa berjalan 4 kali.

### 15.2 Gejala

- nightly job berjalan beberapa kali
- external API rate limit tiba-tiba kena setelah scale-out
- data hasil batch terduplikasi
- report dikirim berkali-kali
- log menunjukkan trigger sama dari beberapa instance

### 15.3 Root Cause

`ManagedScheduledExecutorService` mengatur scheduling dalam satu runtime/container. Ia tidak otomatis menjadi cluster-wide singleton.

### 15.4 Invariant yang Dilanggar

```text
Jika logical schedule harus single execution per cluster, harus ada koordinasi cluster-level.
```

### 15.5 Mitigasi: DB Lock

Contoh konsep:

```sql
create table cluster_lock (
    lock_name varchar2(100) primary key,
    owner_id varchar2(100) not null,
    locked_until timestamp not null
);
```

Worker:

```java
public void runScheduledJob() {
    if (!lockService.tryAcquire("nightly-case-aging", Duration.ofMinutes(30))) {
        return;
    }

    try {
        caseAgingJob.run();
    } finally {
        lockService.release("nightly-case-aging");
    }
}
```

### 15.6 Alternative

Gunakan:

- Jakarta Batch dengan duplicate launch prevention
- Kubernetes CronJob untuk job eksternal container
- database scheduler
- enterprise scheduler
- workflow orchestrator
- queue with single logical consumer group

### 15.7 Rule

```text
Scheduled executor menjawab “kapan node ini menjalankan task”.
Cluster scheduler menjawab “siapa satu-satunya yang boleh menjalankan task ini untuk seluruh cluster”.
```

---

## 16. Failure Mode 11 — Retry Storm

### 16.1 Definisi

Retry storm terjadi ketika failure downstream menyebabkan banyak task retry bersamaan, sehingga downstream semakin overload dan failure makin parah.

### 16.2 Gejala

- external API 429/503 naik
- latency naik tajam
- retry count melonjak
- semua node retry pada waktu yang sama
- DB pool penuh karena retry
- error rate tetap tinggi meski traffic user turun

### 16.3 Root Cause

- retry tanpa backoff
- retry tanpa jitter
- retry tanpa global budget
- retry setiap layer sekaligus
- retry pada error permanen
- retry task besar dari awal tanpa checkpoint
- retry tidak mempertimbangkan rate limit downstream

### 16.4 Invariant yang Dilanggar

```text
Retry harus mengurangi probability of failure, bukan memperbesar load pada sistem yang sudah gagal.
```

### 16.5 Mitigasi

Gunakan classification:

| Error | Policy |
|---|---|
| Validation error | No retry |
| Authorization error | Usually no retry |
| 404 business missing | Depends on domain |
| 409 conflict | Retry with read/merge or mark conflict |
| 429 rate limit | Retry after delay, respect header |
| 500/502/503 | Retry with backoff+jitter, bounded |
| Timeout | Retry only if operation idempotent |
| Unknown after side effect | Reconcile before retry |

Pseudo policy:

```java
public RetryDecision classify(Throwable error, int attempt) {
    if (error instanceof PermanentBusinessException) {
        return RetryDecision.noRetry("permanent");
    }

    if (error instanceof RateLimitException e) {
        return RetryDecision.retryAfter(e.retryAfter().plus(jitter()), attempt < 5);
    }

    if (error instanceof TransientNetworkException) {
        return RetryDecision.retryAfter(exponentialBackoff(attempt).plus(jitter()), attempt < 3);
    }

    return RetryDecision.noRetry("unknown-unclassified");
}
```

### 16.6 Multi-Layer Retry Problem

Hati-hati jika retry ada di banyak layer:

```text
HTTP client retry 3x
Service retry 3x
Batch retry 3x
Scheduler retry 3x
```

Worst case:

```text
3 × 3 × 3 × 3 = 81 attempts
```

### 16.7 Design Rule

```text
Retry budget harus global terhadap logical operation, bukan tersebar diam-diam di setiap layer.
```

---

## 17. Failure Mode 12 — Poison Task Loop

### 17.1 Definisi

Poison task adalah task yang selalu gagal jika diproses, biasanya karena data buruk, state invalid, schema mismatch, atau business invariant dilanggar.

Jika poison task terus di-retry, worker bisa habis hanya untuk task yang tidak mungkin sukses.

### 17.2 Gejala

- task sama muncul di log berkali-kali
- retry count tinggi untuk record tertentu
- queue tidak maju
- CPU/DB dipakai untuk kegagalan berulang
- batch stuck di item tertentu

### 17.3 Invariant yang Dilanggar

```text
Sistem harus bisa membedakan transient failure dari permanent poison input.
```

### 17.4 Mitigasi

Tambahkan state:

```text
PENDING
PROCESSING
FAILED_RETRYABLE
FAILED_PERMANENT
DEAD_LETTERED
COMPLETED
```

Dead-letter setelah batas:

```java
if (attempt >= maxAttempts || classifier.isPermanent(error)) {
    repository.markDeadLetter(
        item.id(),
        error.getClass().getName(),
        safeMessage(error)
    );
} else {
    repository.scheduleRetry(item.id(), nextAttemptAt);
}
```

### 17.5 Regulatory Angle

Untuk sistem regulasi, poison record tidak boleh hilang. Ia harus:

- dicatat
- punya reason
- punya owner/queue for manual review
- bisa diperbaiki dan diproses ulang
- punya audit trail

### 17.6 Design Rule

```text
Permanent failure adalah outcome bisnis/operasional yang valid, bukan sekadar exception teknis.
```

---

## 18. Failure Mode 13 — Slow Downstream Collapse

### 18.1 Definisi

Slow downstream collapse terjadi ketika DB/API/file storage menjadi lambat, lalu async executor menumpuk task, connection pool habis, request latency naik, dan akhirnya sistem utama ikut jatuh.

### 18.2 Gejala

- external API latency naik
- active executor thread penuh
- DB connections penuh
- request yang tidak berhubungan ikut lambat
- health check gagal
- autoscaling menambah pod tetapi masalah makin buruk

### 18.3 Root Cause

- executor terlalu besar terhadap DB/API capacity
- tidak ada timeout
- tidak ada circuit breaker
- background dan foreground sharing downstream pool
- virtual threads dipakai tanpa concurrency limit
- retry storm

### 18.4 Invariant yang Dilanggar

```text
Concurrency ke downstream tidak boleh melebihi kapasitas downstream yang sehat.
```

### 18.5 Mitigasi: Bulkhead + Timeout + Circuit Breaker

```java
public Result callExternal(Command command) {
    if (!externalBulkhead.tryAcquire()) {
        throw new BusyException("External integration bulkhead is full");
    }

    try {
        return externalClient.call(command, Duration.ofSeconds(3));
    } finally {
        externalBulkhead.release();
    }
}
```

Jika downstream sakit:

```text
closed -> half-open -> open
```

Saat open:

- fail fast
- defer durable work
- stop retry burst
- protect core application

### 18.6 Virtual Threads Warning

Virtual threads membuat blocking lebih murah, tetapi tidak membuat downstream lebih cepat.

```text
More virtual threads can create more blocked calls.
More blocked calls can create more pressure on downstream.
```

Tetap butuh limiter.

---

## 19. Failure Mode 14 — DB Pool Starvation

### 19.1 Definisi

DB pool starvation terjadi ketika async/background work memakai terlalu banyak connection sehingga request utama tidak mendapat connection.

### 19.2 Gejala

- request endpoint lambat di `getConnection`
- Hikari/connection pool active=max
- DB CPU mungkin sedang tidak tinggi
- thread dump banyak thread waiting for connection
- background batch sedang berjalan

### 19.3 Root Cause

- batch partition terlalu banyak
- executor thread lebih banyak daripada DB pool
- setiap task membuka beberapa connection
- transaction terlalu lama
- query lambat
- connection leak
- background job memakai pool yang sama dengan online traffic

### 19.4 Invariant yang Dilanggar

```text
DB connection adalah scarce resource. Executor concurrency harus dikaitkan dengan pool capacity.
```

### 19.5 Mitigasi

Pisahkan pool jika perlu:

```text
onlinePool: request latency critical
batchPool: background/batch bounded
reportPool: heavy read/report bounded
```

Atau batasi concurrency batch:

```text
DB pool max = 50
online reserve = 30
batch safe max = 10-15
admin/report reserve = 5
```

### 19.6 Diagnostic Query

Cari:

- connection acquisition time
- active/idle/pending connection
- transaction duration
- query duration
- lock wait
- batch job active partition
- executor active count

### 19.7 Design Rule

```text
Thread count, partition count, and DB pool size must be designed together.
```

---

## 20. Failure Mode 15 — CPU Starvation and False Parallelism

### 20.1 Definisi

CPU starvation terjadi ketika terlalu banyak CPU-bound async task berjalan sehingga request thread, GC, JIT, logging, serialization, dan system threads tidak mendapat CPU cukup.

False parallelism terjadi ketika developer menambah thread untuk kerja CPU-bound dan mengira throughput akan selalu naik.

### 20.2 Gejala

- CPU 100%
- latency semua endpoint naik
- GC lebih sering
- run queue tinggi
- context switching tinggi
- throughput tidak naik setelah thread ditambah
- virtual threads tidak membantu

### 20.3 Invariant yang Dilanggar

```text
Untuk CPU-bound work, jumlah parallelism efektif dibatasi jumlah core, bukan jumlah thread.
```

### 20.4 Mitigasi

Untuk CPU-bound:

```text
parallelism ≈ available cores - reserve
```

Pisahkan CPU-bound executor dari I/O-bound executor.

Contoh workload CPU-bound:

- PDF rendering
- cryptographic hashing besar
- compression/decompression
- large JSON/XML transformation
- rule evaluation massal
- image processing
- report aggregation in-memory

### 20.5 Design Rule

```text
Thread adalah concurrency construct. Core CPU adalah execution capacity. Jangan samakan keduanya.
```

---

## 21. Failure Mode 16 — Deadlock and Lock Convoy

### 21.1 Definisi

Deadlock terjadi ketika dua atau lebih task saling menunggu resource yang tidak akan pernah dilepas. Lock convoy terjadi ketika banyak task menunggu lock yang sama sehingga throughput collapse.

### 21.2 Gejala

- task stuck tanpa CPU tinggi
- thread dump menunjukkan `BLOCKED` atau waiting lock
- DB lock wait tinggi
- semua task berhenti di aggregate yang sama
- timeout meningkat

### 21.3 Root Cause

- lock order tidak konsisten
- synchronized block terlalu besar
- DB row diproses paralel tanpa partition key yang aman
- distributed lock tidak punya timeout
- batch partition overlap
- task menunggu future lain dalam executor yang sama

### 21.4 Executor Deadlock Contoh

```java
Future<ResultA> a = executor.submit(this::loadA);
Future<ResultB> b = executor.submit(() -> {
    ResultA resultA = a.get();
    return loadB(resultA);
});

// Jika semua thread executor habis menunggu future yang juga butuh executor sama,
// sistem bisa starvation/deadlock.
```

### 21.5 Mitigasi

- jangan blocking wait di executor yang sama tanpa capacity analysis
- gunakan composition (`thenCompose`) daripada nested blocking
- buat lock ordering konsisten
- gunakan timeout pada lock
- partition berdasarkan key non-overlap
- hindari parallel update aggregate yang sama

### 21.6 Design Rule

```text
Parallelism aman hanya jika resource conflict model-nya jelas.
```

---

## 22. Failure Mode 17 — ClassLoader Leak

### 22.1 Definisi

ClassLoader leak adalah kondisi ketika application classloader lama tidak bisa di-GC karena masih direferensikan oleh thread, static field, ThreadLocal, driver, timer, logger, atau library.

### 22.2 Hubungan dengan Concurrency

Async thread sering menjadi akar leak karena thread hidup lebih lama daripada deployment.

Thread bisa memegang:

- context classloader
- runnable instance
- lambda capturing service bean
- ThreadLocal value
- MDC map
- library cache

### 22.3 Gejala

- metaspace naik setelah redeploy
- memory tidak turun
- class count naik
- old deployment class muncul di heap dump
- thread name dari versi lama masih ada

### 22.4 Mitigasi

- gunakan managed executor
- hindari static executor
- clear ThreadLocal di finally
- close resource di `@PreDestroy`
- pastikan library background thread dihentikan
- jangan menyimpan CDI/request object di static field

### 22.5 ThreadLocal Cleanup

```java
try {
    RequestContextHolder.set(context);
    doWork();
} finally {
    RequestContextHolder.clear();
    MDC.clear();
}
```

### 22.6 Design Rule

```text
Setiap context yang di-set pada thread harus punya cleanup path yang pasti.
```

---

## 23. Failure Mode 18 — Hidden Infinite Loop

### 23.1 Definisi

Hidden infinite loop adalah worker loop yang berjalan selamanya di dalam aplikasi, sering kali tanpa lifecycle, metric, atau stop semantics.

Contoh:

```java
@PostConstruct
void start() {
    new Thread(() -> {
        while (true) {
            poll();
        }
    }).start();
}
```

### 23.2 Gejala

- CPU tinggi setelah deploy
- shutdown sulit
- task tidak terlihat di executor metric
- polling tetap berjalan saat app unhealthy
- duplicate loop setelah redeploy

### 23.3 Root Cause

Developer mencoba membuat background service sendiri di dalam application server.

### 23.4 Mitigasi

Pilih model yang benar:

| Kebutuhan | Model Lebih Tepat |
|---|---|
| Poll berkala ringan | ManagedScheduledExecutorService |
| Durable polling outbox | Scheduled trigger + DB claim |
| Long-running worker | Messaging consumer / dedicated worker deployment |
| Batch durable | Jakarta Batch |
| External cron | Kubernetes CronJob / enterprise scheduler |

### 23.5 Design Rule

```text
Loop tanpa stop condition, timeout, metric, dan owner adalah production liability.
```

---

## 24. Failure Mode 19 — Fire-and-Forget Without Accountability

### 24.1 Definisi

Fire-and-forget terjadi ketika request submit async work lalu tidak menyimpan job id, tidak mengamati hasil, tidak menangani failure, dan tidak memberi operator cara melihat status.

### 24.2 Contoh Buruk

```java
public void approve(String caseId) {
    executor.submit(() -> notifyExternalSystem(caseId));
    return;
}
```

Jika task gagal, siapa tahu?

### 24.3 Gejala

- user merasa request sukses, tetapi downstream tidak update
- no retry
- no audit
- no dashboard
- error hanya muncul di log
- support team tidak bisa menjawab status

### 24.4 Invariant yang Dilanggar

```text
Setiap async side effect penting harus punya observable outcome.
```

### 24.5 Mitigasi

Buat work request:

```sql
create table async_operation (
    id varchar2(64) primary key,
    type varchar2(100) not null,
    business_key varchar2(200) not null,
    status varchar2(30) not null,
    requested_by varchar2(100) not null,
    requested_at timestamp not null,
    started_at timestamp,
    completed_at timestamp,
    failure_code varchar2(100),
    failure_message varchar2(1000),
    retry_count number default 0 not null
);
```

Return ke caller:

```json
{
  "operationId": "op-123",
  "status": "ACCEPTED"
}
```

### 24.6 Design Rule

```text
Fire-and-forget hanya boleh untuk work yang benar-benar disposable.
Jika business cares, persist and observe it.
```

---

## 25. Failure Mode 20 — Missing Audit Attribution

### 25.1 Definisi

Missing audit attribution terjadi ketika async task mengubah state penting tetapi audit tidak bisa menjawab:

- siapa yang meminta
- siapa yang mengeksekusi
- kapan diminta
- kapan dijalankan
- atas dasar authorization apa
- input apa yang digunakan
- output/side effect apa yang terjadi

### 25.2 Gejala

- `created_by = SYSTEM` terlalu banyak tanpa reason
- audit trail tidak punya correlation id
- perubahan state tidak bisa dikaitkan ke request user
- operator tidak bisa membuktikan kenapa job berjalan
- compliance review gagal

### 25.3 Invariant yang Dilanggar

```text
Async boundary tidak boleh memutus rantai akuntabilitas.
```

### 25.4 Audit Envelope

Gunakan envelope:

```java
public record AuditEnvelope(
    String operationId,
    String correlationId,
    String initiatedBy,
    String executedBy,
    String authorizationModel,
    String reasonCode,
    String businessKey,
    Instant requestedAt
) {}
```

### 25.5 Event Audit

Catat state transition:

```text
OPERATION_ACCEPTED
OPERATION_STARTED
OPERATION_RETRIED
OPERATION_SKIPPED
OPERATION_COMPLETED
OPERATION_FAILED_PERMANENT
OPERATION_CANCEL_REQUESTED
OPERATION_CANCELLED
```

### 25.6 Design Rule

```text
System identity boleh mengeksekusi, tetapi tidak boleh menghapus jejak human/business initiator.
```

---

## 26. Failure Mode 21 — Async Exception Disappears

### 26.1 Definisi

Exception disappears terjadi ketika exception di task async tidak diamati.

### 26.2 Contoh Buruk

```java
executor.submit(() -> {
    throw new RuntimeException("failed");
});
```

Jika `Future` tidak pernah diperiksa, failure bisa hanya masuk log container atau bahkan tidak menjadi business signal.

### 26.3 Invariant yang Dilanggar

```text
Setiap async failure harus punya consumer: log, metric, retry, status update, atau alert.
```

### 26.4 Mitigasi

Gunakan wrapper:

```java
public Runnable observed(String operationId, Runnable delegate) {
    return () -> {
        try {
            operationRepository.markStarted(operationId);
            delegate.run();
            operationRepository.markCompleted(operationId);
        } catch (Throwable t) {
            operationRepository.markFailed(operationId, classify(t), safeMessage(t));
            metrics.incrementFailure(classify(t));
            throw t;
        }
    };
}
```

Untuk `CompletableFuture`:

```java
CompletableFuture
    .supplyAsync(() -> execute(command), executor)
    .whenComplete((result, error) -> {
        if (error != null) {
            recordFailure(command.operationId(), error);
        } else {
            recordSuccess(command.operationId(), result);
        }
    });
```

### 26.5 Design Rule

```text
Tidak boleh ada async task penting tanpa failure sink.
```

---

## 27. Failure Mode 22 — Wrong Granularity of Async Work

### 27.1 Definisi

Granularity failure terjadi ketika unit task terlalu kecil atau terlalu besar.

### 27.2 Task Terlalu Kecil

Contoh:

```text
1 task per row untuk 5 juta row
```

Dampak:

- overhead scheduling besar
- queue besar
- DB thrash
- observability noisy
- retry terlalu granular

### 27.3 Task Terlalu Besar

Contoh:

```text
1 task memproses 5 juta row dalam satu transaksi
```

Dampak:

- susah cancel
- susah restart
- lock lama
- memory besar
- progress tidak terlihat
- failure mengulang dari awal

### 27.4 Invariant

```text
Unit of work harus cukup kecil untuk retry/restart/cancel, tetapi cukup besar untuk efisien.
```

### 27.5 Rule of Thumb

Untuk async executor:

```text
Task duration ideal: pendek sampai sedang, jelas timeout-nya, jelas side effect-nya.
```

Untuk Jakarta Batch:

```text
Chunk size harus menyeimbangkan commit overhead, memory, lock duration, dan restart granularity.
```

### 27.6 Design Rule

```text
Granularity adalah keputusan recovery, bukan hanya performa.
```

---

## 28. Failure Mode 23 — Misusing Executor for Durable Work

### 28.1 Definisi

Executor dipakai untuk work yang sebenarnya harus durable/restartable.

### 28.2 Contoh

```java
public void uploadAndProcess(File file) {
    executor.submit(() -> processFile(file));
    return;
}
```

Jika server restart, file processing hilang atau status tidak jelas.

### 28.3 Invariant yang Dilanggar

```text
Jika business requires eventual completion, work must survive process death.
```

### 28.4 Pilihan Model

| Requirement | Better Model |
|---|---|
| Must survive restart | DB job request / queue / Jakarta Batch |
| Must be restartable by checkpoint | Jakarta Batch |
| Must coordinate multi-step business process | Workflow engine |
| Must notify external systems reliably | Outbox + dispatcher |
| Best-effort noncritical | ManagedExecutorService may be enough |

### 28.5 Design Rule

```text
Executor memory bukan job repository.
```

---

## 29. Failure Mode 24 — Misusing Batch for Low-Latency Async

### 29.1 Definisi

Kebalikan dari sebelumnya: Jakarta Batch dipakai untuk semua async work meskipun work sebenarnya short-lived, latency-sensitive, dan tidak butuh repository/restart semantics.

### 29.2 Gejala

- overhead job launch besar
- job repository penuh oleh operasi kecil
- operator UI noisy
- latency tinggi
- desain XML terlalu kompleks untuk task sederhana

### 29.3 Rule

Gunakan Jakarta Batch jika kamu butuh sebagian besar dari ini:

- restartability
- checkpoint
- chunk processing
- skip/retry item
- job repository
- operator control
- long-running processing
- partitioning
- batch status

Jika hanya butuh offload ringan dari request, gunakan managed executor.

### 29.4 Design Rule

```text
Jangan memakai batch hanya karena pekerjaan berjalan di background.
```

---

## 30. Failure Mode 25 — Virtual Thread Overconfidence

### 30.1 Definisi

Virtual thread overconfidence terjadi ketika tim menganggap virtual thread menyelesaikan semua masalah concurrency.

### 30.2 Bentuk Kesalahan

- tidak ada concurrency limit karena thread murah
- tidak ada DB pool planning
- blocking external call tanpa timeout
- task tidak observable
- commonPool/unmanaged executor tetap dipakai
- context propagation diabaikan
- CPU-bound work dijalankan terlalu banyak

### 30.3 Invariant

```text
Virtual threads reduce thread cost, not workload cost.
```

### 30.4 Mitigasi

Tetap desain:

- managed lifecycle
- capacity limit
- timeout
- cancellation
- context propagation
- idempotency
- downstream bulkhead
- observability

### 30.5 Design Rule

```text
Virtual thread adalah execution optimization. Bukan governance model.
```

---

## 31. Failure Mode 26 — Misconfigured Context Propagation

### 31.1 Definisi

Context propagation terlalu sedikit atau terlalu banyak.

### 31.2 Terlalu Sedikit

- correlation hilang
- security gagal
- naming resource tidak tersedia

### 31.3 Terlalu Banyak

- request context terbawa keluar lifetime
- stale user identity
- tenant lama
- memory leak
- sensitive data ikut ke task yang tidak perlu

### 31.4 Rule

```text
Propagate only what is valid, necessary, and auditable.
```

### 31.5 Design Pattern

Pisahkan:

```text
Technical context:
- classloader
- naming
- managed security context if valid

Business context:
- operation id
- tenant id
- actor snapshot
- authorization model
- reason code
```

Jangan memindahkan semua `ThreadLocal` secara membabi buta.

---

## 32. Failure Mode 27 — Missing Shutdown Semantics for Scheduled Work

### 32.1 Definisi

Scheduled work terus trigger walau instance sedang draining/unhealthy.

### 32.2 Gejala

- job start saat pod mau terminate
- job overlap dengan deployment
- readiness false tetapi scheduler masih jalan
- startup langsung menjalankan heavy task sebelum app siap

### 32.3 Mitigasi

Tambahkan application state gate:

```java
public void scheduledTick() {
    if (!lifecycleState.isReadyForBackgroundWork()) {
        return;
    }

    if (!clusterLock.tryAcquire("job-x", Duration.ofMinutes(15))) {
        return;
    }

    try {
        runJob();
    } finally {
        clusterLock.release("job-x");
    }
}
```

### 32.4 Design Rule

```text
Readiness for serving traffic and readiness for background work are related but not identical.
```

---

## 33. Failure Mode 28 — Missing Versioning in Async Commands

### 33.1 Definisi

Async command disimpan, lalu dieksekusi kemudian setelah domain model, schema, atau business rule berubah.

### 33.2 Gejala

- old pending task gagal setelah deployment baru
- deserialization error
- enum value berubah
- processor tidak paham payload lama
- side effect memakai rule baru padahal request lama memakai rule lama

### 33.3 Mitigasi

Version command payload:

```json
{
  "schemaVersion": 2,
  "operationType": "CASE_ESCALATION_RECALCULATION",
  "caseId": "CASE-123",
  "requestedAt": "2026-06-17T10:00:00Z"
}
```

Handler:

```java
switch (command.schemaVersion()) {
    case 1 -> handleV1(command);
    case 2 -> handleV2(command);
    default -> markUnsupported(command);
}
```

### 33.4 Design Rule

```text
Durable async command adalah public contract terhadap future version dari aplikasimu sendiri.
```

---

## 34. Failure Mode 29 — Inconsistent Progress State

### 34.1 Definisi

Progress state tidak mencerminkan kondisi sebenarnya.

Contoh:

- status `COMPLETED` tetapi sebagian side effect gagal
- status `FAILED` tetapi external side effect berhasil
- progress 100% tetapi report belum tersedia
- task stuck `PROCESSING` setelah node crash

### 34.2 Mitigasi

Gunakan state machine yang eksplisit:

```text
ACCEPTED
VALIDATED
CLAIMED
RUNNING
WAITING_RETRY
COMPLETED
COMPLETED_WITH_WARNINGS
FAILED_PERMANENT
CANCEL_REQUESTED
CANCELLED
EXPIRED
```

Pisahkan progress internal dan business outcome:

```text
executionStatus = COMPLETED
businessOutcome = PARTIAL_SUCCESS
```

Tambahkan heartbeat/lease:

```text
claimed_by
claimed_until
last_heartbeat_at
```

Jika node crash, task `PROCESSING` dengan expired lease dapat di-reclaim.

### 34.3 Design Rule

```text
Status bukan label UI. Status adalah recovery protocol.
```

---

## 35. Failure Mode 30 — Operator Has No Control Plane

### 35.1 Definisi

Sistem punya async/batch workload, tetapi operator tidak bisa:

- melihat status
- stop
- restart
- retry
- abandon
- inspect error
- melihat owner
- melihat parameter
- melihat progress

### 35.2 Gejala

- incident harus diselesaikan dengan query manual
- restart server menjadi satu-satunya tombol
- duplicate job karena operator submit ulang
- support tidak tahu status real
- audit tidak lengkap

### 35.3 Mitigasi

Minimal control plane:

```text
GET /operations/{id}
GET /operations?status=FAILED_RETRYABLE
POST /operations/{id}/cancel
POST /operations/{id}/retry
POST /operations/{id}/abandon
GET /operations/{id}/events
```

Untuk Jakarta Batch, gunakan `JobOperator` sebagai runtime operation interface untuk start, stop, restart, dan inspect job.

### 35.4 Design Rule

```text
Workload yang long-running tanpa control plane adalah black box operational debt.
```

---

## 36. Diagnostic Framework: 7 Pertanyaan Saat Incident

Saat async incident terjadi, jangan langsung restart. Jawab 7 pertanyaan ini.

### 36.1 Apa Logical Work Identity-nya?

```text
operationId?
jobExecutionId?
caseId?
idempotencyKey?
batch partition id?
```

Jika tidak ada, observability sudah gagal.

### 36.2 Di State Apa Work Sekarang?

```text
ACCEPTED?
QUEUED?
RUNNING?
WAITING_RETRY?
FAILED?
COMPLETED?
UNKNOWN?
```

State `UNKNOWN` adalah tanda desain recovery belum matang.

### 36.3 Work Berjalan di Thread/Executor Mana?

```text
managed executor?
scheduled executor?
commonPool?
custom thread?
batch runtime?
message listener?
```

### 36.4 Context Apa yang Dipakai?

```text
correlation id?
tenant?
initiated by?
executed by?
security role?
transaction?
MDC?
```

### 36.5 Downstream Apa yang Ditunggu?

```text
DB?
external API?
file system?
lock?
queue?
CPU?
```

### 36.6 Apakah Aman Di-Retry?

```text
idempotent?
partial side effect?
external idempotency key?
checkpoint?
```

### 36.7 Apa Blast Radius-nya?

```text
single operation?
single tenant?
single module?
all background jobs?
all request traffic?
DB-wide?
external API-wide?
```

---

## 37. Incident Response Playbook

### 37.1 Step 1 — Stabilize

Tujuan awal bukan root cause sempurna, tetapi menghentikan kerusakan.

Aksi:

- stop accepting new background work
- disable schedule temporarily
- open circuit breaker
- reduce concurrency
- pause retry
- isolate tenant/module jika bisa
- protect online traffic

### 37.2 Step 2 — Preserve Evidence

Kumpulkan:

- thread dump
- heap summary jika leak
- executor metrics
- queue depth
- DB pool metrics
- slow query
- log correlation
- job/operation table snapshot
- deployment version
- pod/node info

### 37.3 Step 3 — Classify Failure

Gunakan taxonomy:

```text
lifecycle / capacity / context / transaction / retry / duplicate / downstream / observability / cluster / deployment
```

### 37.4 Step 4 — Decide Recovery

Untuk setiap affected operation:

```text
Can continue?
Can retry?
Must reconcile?
Must mark failed permanent?
Must compensate?
Must manually review?
```

### 37.5 Step 5 — Restore Gradually

- mulai dari concurrency kecil
- monitor queue wait time
- monitor downstream latency
- enable retry gradually
- verify no duplicate side effect

### 37.6 Step 6 — Fix Invariant

Postmortem harus berakhir dengan invariant:

```text
Invariant violated:
Background executor could consume all DB connections, starving online traffic.

Permanent fix:
Separate DB pool + concurrency limiter + dashboard alert.
```

---

## 38. Production Design Checklist

### 38.1 Lifecycle

- [ ] Tidak memakai `new Thread()` di application component.
- [ ] Tidak memakai static unmanaged executor.
- [ ] Tidak memakai `Timer`/custom scheduler tersembunyi.
- [ ] Semua async work memakai managed executor/scheduler atau runtime yang tepat.
- [ ] Ada shutdown/cancellation semantics.
- [ ] Tidak ada task deployment lama setelah redeploy.

### 38.2 Capacity

- [ ] Executor punya batas concurrency yang jelas.
- [ ] Queue bounded atau durable dengan policy jelas.
- [ ] Ada metric active/queued/wait/execution/rejection.
- [ ] Background work tidak bisa menghabiskan DB pool online.
- [ ] Ada bulkhead per downstream.
- [ ] Ada backpressure/admission control.

### 38.3 Context

- [ ] Correlation id dipropagasikan.
- [ ] Business context eksplisit.
- [ ] Audit actor eksplisit.
- [ ] Tidak membawa request object ke async task.
- [ ] ThreadLocal/MDC dibersihkan.
- [ ] Stale context punya policy.

### 38.4 Transaction

- [ ] Async boundary diperlakukan sebagai transaction boundary.
- [ ] External side effect tidak terjadi sebelum commit tanpa desain khusus.
- [ ] Outbox dipakai untuk side effect penting.
- [ ] Setiap task punya transaksi sendiri yang pendek.

### 38.5 Retry and Idempotency

- [ ] Retry diklasifikasikan.
- [ ] Ada max attempt.
- [ ] Ada backoff+jitter.
- [ ] Ada retry budget global.
- [ ] Idempotency key tersedia.
- [ ] Poison task bisa dead-letter/manual review.

### 38.6 Cluster

- [ ] Scheduled job single-cluster punya lock/coordination.
- [ ] Duplicate launch dicegah.
- [ ] Node crash punya recovery path.
- [ ] Rolling deployment aman terhadap in-flight work.

### 38.7 Observability

- [ ] Operation id/job id terlihat ke user/operator.
- [ ] Failure sink tersedia.
- [ ] Dashboard ada.
- [ ] Alert berdasarkan symptom penting, bukan hanya CPU.
- [ ] Audit trail defensible.

---

## 39. Code Review Checklist

Cari red flag berikut:

```text
new Thread(
Executors.newFixedThreadPool(
Executors.newCachedThreadPool(
new Timer(
CompletableFuture.runAsync( without executor
CompletableFuture.supplyAsync( without executor
while (true)
Thread.sleep(
Future.get() inside managed executor task
static ExecutorService
static ThreadLocal without cleanup
fire-and-forget submit without Future/status/failure sink
retry without idempotency
scheduled task without cluster lock
external API call without timeout
DB operation inside long-running transaction
```

Pertanyaan review:

1. Siapa owner lifecycle task ini?
2. Apa logical operation id-nya?
3. Bagaimana task ini berhenti?
4. Apa yang terjadi jika node crash?
5. Apa yang terjadi jika task dieksekusi dua kali?
6. Apa yang terjadi jika downstream lambat?
7. Apa yang terjadi jika user permission berubah?
8. Apa yang terjadi jika deployment terjadi saat task running?
9. Bagaimana operator melihat statusnya?
10. Bagaimana kita tahu task gagal?

---

## 40. Decision Matrix: Failure Mode vs Correct Tool

| Problem | Managed Executor | Scheduled Executor | Jakarta Batch | Queue/Outbox | Workflow Engine |
|---|---:|---:|---:|---:|---:|
| Short async offload | ✅ | ❌ | ⚠️ | ⚠️ | ❌ |
| Periodic lightweight task | ⚠️ | ✅ | ⚠️ | ⚠️ | ❌ |
| Durable side effect | ❌ | ❌ | ⚠️ | ✅ | ⚠️ |
| Restartable file processing | ❌ | ❌ | ✅ | ⚠️ | ⚠️ |
| Chunk processing millions rows | ❌ | ❌ | ✅ | ⚠️ | ❌ |
| Long-running human workflow | ❌ | ❌ | ❌ | ⚠️ | ✅ |
| Cluster singleton schedule | ❌ | ⚠️ needs lock | ⚠️ | ⚠️ | ✅ |
| Fan-out short I/O calls | ✅ with limiter | ❌ | ⚠️ | ⚠️ | ❌ |
| Audit-heavy regulatory operation | ⚠️ | ⚠️ | ✅ | ✅ | ✅ |
| Must survive process death | ❌ | ❌ | ✅ | ✅ | ✅ |

Legend:

```text
✅ good fit
⚠️ possible with design constraints
❌ wrong abstraction
```

---

## 41. A Concrete Example: Bad to Good

### 41.1 Bad Design

```java
public void submitMassNotification(String campaignId) {
    executor.submit(() -> {
        List<User> users = userRepository.findAllTargetUsers(campaignId);
        for (User user : users) {
            emailClient.send(user.email(), "Notice");
        }
    });
}
```

Problems:

- no operation id
- no status
- no retry classification
- no idempotency
- no checkpoint
- no rate limit
- no timeout shown
- no audit
- no cancellation
- no cluster/node recovery
- no partial success handling

### 41.2 Better Design

Request path:

```java
@Transactional
public OperationId requestMassNotification(String campaignId, UserActor actor) {
    OperationId operationId = OperationId.newId();

    operationRepository.insert(Operation.accepted(
        operationId,
        "MASS_NOTIFICATION",
        campaignId,
        actor.userId(),
        Instant.now()
    ));

    notificationRecipientRepository.materializeRecipients(operationId, campaignId);

    return operationId;
}
```

Worker:

```java
public void processNotificationOperation(OperationId operationId) {
    operationRepository.markRunning(operationId);

    while (!Thread.currentThread().isInterrupted()) {
        List<Recipient> recipients = recipientRepository.claimNextBatch(operationId, 100);

        if (recipients.isEmpty()) {
            operationRepository.markCompletedIfNoPendingRecipients(operationId);
            return;
        }

        for (Recipient recipient : recipients) {
            try {
                emailRateLimiter.acquire();
                emailClient.sendWithIdempotencyKey(
                    recipient.email(),
                    recipient.message(),
                    recipient.idempotencyKey(),
                    Duration.ofSeconds(5)
                );
                recipientRepository.markSent(recipient.id());
            } catch (RateLimitException e) {
                recipientRepository.releaseForRetry(recipient.id(), retryAfter(e));
            } catch (PermanentEmailException e) {
                recipientRepository.markFailedPermanent(recipient.id(), e.code());
            }
        }
    }

    operationRepository.markCancelObserved(operationId);
}
```

Now we have:

- durable operation
- status
- idempotency
- chunking
- retry
- rate limit
- cancellation
- audit
- partial failure
- restartability

For large-scale version, Jakarta Batch may become even more appropriate.

---

## 42. The Top 1% Mental Model

Engineer biasa bertanya:

```text
Bagaimana menjalankan ini async?
```

Engineer senior bertanya:

```text
Apa yang terjadi jika async work ini gagal, lambat, dobel, tertunda, kehilangan context, kehabisan capacity, atau berjalan saat deployment?
```

Engineer top-tier bertanya lebih jauh:

```text
Invariant apa yang harus tetap benar walau terjadi retry, timeout, crash, redeploy, scale-out, permission change, partial commit, external API failure, dan operator intervention?
```

Itulah perbedaan antara “bisa pakai executor” dan “bisa mendesain workload orchestration yang production-grade”.

---

## 43. Ringkasan

Production failure pada Jakarta Concurrency biasanya bukan karena API-nya sulit, tetapi karena desain workload tidak lengkap.

Pola kegagalan utama:

- redeploy leak
- zombie task
- executor exhaustion
- queue explosion
- commonPool leakage
- lost/stale context
- transaction ghost
- duplicate execution
- cluster duplicate schedule
- retry storm
- poison task loop
- slow downstream collapse
- DB pool starvation
- CPU starvation
- deadlock/lock convoy
- classloader leak
- fire-and-forget tanpa accountability
- missing audit attribution
- async exception hilang
- wrong granularity
- misuse executor/batch
- virtual thread overconfidence
- missing control plane

Prinsip final:

```text
Concurrency is not just execution.
Concurrency is lifecycle + capacity + context + transaction + identity + cancellation + idempotency + observability + recovery.
```

---

## 44. Latihan / Thought Experiment

### Latihan 1 — Audit Async Boundary

Ambil satu fitur aplikasi yang melakukan async work. Jawab:

1. Apa operation id-nya?
2. Siapa initiator-nya?
3. Apa executor/runtime-nya?
4. Apa timeout-nya?
5. Apa retry policy-nya?
6. Apa idempotency key-nya?
7. Apa status table/control plane-nya?
8. Apa yang terjadi jika node mati?
9. Apa yang terjadi jika request transaction rollback?
10. Apa yang terjadi jika task berjalan dua kali?

Jika lebih dari 3 jawaban tidak jelas, fitur itu belum production-grade.

### Latihan 2 — Cluster Scheduler

Kamu punya 4 pod Jakarta EE dan scheduled task berjalan tiap jam untuk sync external registry.

Desain:

- agar hanya satu pod menjalankan sync
- agar sync bisa retry tanpa duplicate side effect
- agar operator bisa melihat status
- agar sync tidak menghancurkan API downstream saat API lambat
- agar rolling deployment tidak membuat sync dobel

### Latihan 3 — Incident Simulation

Simulasikan external API melambat dari 200ms menjadi 10s.

Observasi:

- queue depth
- executor active thread
- DB pool usage
- retry count
- request latency
- circuit breaker state
- task max age

Tentukan:

- kapan reject
- kapan defer
- kapan retry
- kapan stop schedule
- kapan alert

---

## 45. Koneksi ke Part Berikutnya

Part ini menutup blok besar Jakarta Concurrency runtime/failure engineering. Bagian berikutnya akan masuk ke Jakarta Batch secara lebih formal:

```text
Part 17 — Jakarta Batch Mental Model: Jobs, Steps, Executions, and State
```

Di sana fokusnya berubah dari managed async execution menjadi durable batch workload model:

- job
- job instance
- job execution
- step
- batch status
- exit status
- repository
- restartability
- stop/restart/abandon
- kapan memilih batch dibanding executor/scheduler/messaging/workflow

---

## 46. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Part 0  selesai
Part 1  selesai
Part 2  selesai
Part 3  selesai
Part 4  selesai
Part 5  selesai
Part 6  selesai
Part 7  selesai
Part 8  selesai
Part 9  selesai
Part 10 selesai
Part 11 selesai
Part 12 selesai
Part 13 selesai
Part 14 selesai
Part 15 selesai
Part 16 selesai
```

Berikutnya:

```text
Part 17 — Jakarta Batch Mental Model: Jobs, Steps, Executions, and State
File: 17-jakarta-batch-mental-model-jobs-steps-executions-state.md
```

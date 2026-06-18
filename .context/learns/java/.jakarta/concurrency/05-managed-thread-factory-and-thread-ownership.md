# Part 5 — ManagedThreadFactory and Thread Creation Without Losing Container Semantics

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `05-managed-thread-factory-and-thread-ownership.md`  
**Scope:** Java 8–25, Java EE/Jakarta EE managed runtimes, `javax.enterprise.concurrent.ManagedThreadFactory`, `jakarta.enterprise.concurrent.ManagedThreadFactory`, Jakarta Concurrency 3.1 baseline  
**Prerequisite:** You already understand Java SE `Thread`, `ThreadFactory`, `ExecutorService`, interruption, lifecycle, and basic Jakarta EE container model.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu seharusnya mampu:

1. Menjelaskan kenapa `ManagedThreadFactory` ada, padahal Jakarta Concurrency sudah punya `ManagedExecutorService`.
2. Membedakan antara:
   - membuat thread secara manual dengan `new Thread()`;
   - membuat thread lewat Java SE `ThreadFactory`;
   - membuat thread lewat `ManagedThreadFactory`;
   - menyerahkan task sepenuhnya ke `ManagedExecutorService`.
3. Memahami bahwa `ManagedThreadFactory` bukan “izin bebas” untuk membangun runtime sendiri di dalam application server.
4. Mendesain thread yang tetap menghormati container lifecycle, context, shutdown, classloader, observability, dan operational control.
5. Mengenali kapan `ManagedThreadFactory` tepat, kapan lebih baik memakai managed executor, scheduler, messaging, batch, atau external orchestrator.
6. Membaca failure mode production yang muncul dari thread yang dibuat salah: redeploy leak, zombie thread, stuck shutdown, lost context, duplicate workers, dan invisible workload.

---

## 2. Problem yang Diselesaikan

Di Java SE biasa, membuat thread terlihat sederhana:

```java
Thread t = new Thread(() -> doWork());
t.start();
```

Tetapi di application server atau Jakarta EE container, baris sederhana ini membawa masalah besar.

Thread bukan hanya “jalur eksekusi”. Di dalam container, thread juga menjadi carrier untuk banyak konteks runtime:

- application classloader;
- naming/JNDI context;
- security identity;
- CDI context;
- transaction association;
- logging MDC;
- request/correlation metadata;
- resource access contract;
- shutdown/redeploy lifecycle;
- observability dan administration visibility.

Jika aplikasi membuat thread mentah sendiri, container tidak punya kontrol penuh atas thread itu. Akibatnya container bisa gagal:

- menghentikan thread saat undeploy;
- membersihkan classloader;
- menjaga security context;
- mengelola thread capacity;
- mendeteksi stuck task;
- mematikan aplikasi dengan graceful shutdown;
- memisahkan workload antar aplikasi;
- menegakkan policy server.

`ManagedThreadFactory` menyelesaikan sebagian masalah ini: aplikasi tetap dapat membuat `Thread`, tetapi thread tersebut dibuat oleh fasilitas container-aware. Jakarta Concurrency mendefinisikan cara memakai concurrency dari komponen Jakarta EE tanpa mengorbankan integritas container; Jakarta EE 11 memakai Jakarta Concurrency 3.1 dan mensyaratkan Java SE 17 atau lebih tinggi untuk platform tersebut. Lihat rujukan resmi Jakarta Concurrency 3.1 dan Jakarta EE 11 release notes di bagian referensi.

Namun ada jebakan besar: **managed thread creation masih lebih rendah levelnya daripada managed task submission**.

Artinya:

```text
ManagedExecutorService   = container manages task + execution + pool/lifecycle
ManagedThreadFactory     = container helps create threads, but you own much more lifecycle responsibility
new Thread()             = application bypasses container almost entirely
```

---

## 3. Mental Model Utama

### 3.1 Thread is a Runtime Asset, Not Just a Java Object

Di Java, `Thread` memang object. Tetapi di server, thread adalah resource operasional:

```text
Thread = execution capacity + lifecycle obligation + context boundary + failure surface
```

Membuat thread berarti kamu menciptakan beban baru untuk:

- CPU scheduling;
- memory stack;
- context retention;
- resource ownership;
- shutdown coordination;
- monitoring;
- failure containment.

Top-tier engineer tidak bertanya hanya:

> “Bisa jalan async?”

Ia bertanya:

> “Siapa yang memiliki thread ini, siapa yang menghentikannya, context apa yang dibawa, resource apa yang dapat dipakai, bagaimana thread ini terlihat di operasi, dan apa yang terjadi saat aplikasi di-redeploy?”

---

### 3.2 ManagedThreadFactory Is a Boundary Tool

`ManagedThreadFactory` adalah alat untuk membuat thread di boundary antara application code dan container runtime.

Mental model:

```text
Application says: “I need a Thread object.”
Container says: “I will create one in a way that preserves container rules as much as possible.”
```

Ia bukan model default untuk async workload. Model default tetap:

```text
submit task -> managed executor -> container runs it
```

`ManagedThreadFactory` dipakai ketika kamu benar-benar butuh object `Thread`, misalnya karena API/library tertentu membutuhkan `ThreadFactory`, atau kamu sedang membuat komponen rendah level yang tidak bisa diekspresikan sebagai task biasa.

---

### 3.3 Thread Factory Is Not a Pool

`ManagedThreadFactory` hanya membuat thread. Ia tidak otomatis menyediakan:

- queue;
- pool sizing;
- rejection policy;
- task accounting;
- backpressure;
- retry;
- scheduling;
- lifecycle task-level;
- work stealing;
- batch restartability;
- durable execution.

Jadi kalau kamu memakai `ManagedThreadFactory` lalu membuat banyak thread sendiri, kamu sedang membangun scheduler/pool sendiri.

Itu bisa benar untuk kasus sangat spesifik, tetapi sering kali salah.

---

## 4. API dan Namespace

### 4.1 Java EE / Jakarta EE Namespace

Di Java EE 7/8:

```java
javax.enterprise.concurrent.ManagedThreadFactory
```

Di Jakarta EE 9+:

```java
jakarta.enterprise.concurrent.ManagedThreadFactory
```

Konsepnya sama, tetapi package berubah dari `javax.*` ke `jakarta.*`.

---

### 4.2 Bentuk Dasar API

Secara konseptual, `ManagedThreadFactory` adalah versi managed dari Java SE `ThreadFactory`.

Pola pemakaian umum:

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedThreadFactory;

public class WorkerBootstrap {

    @Resource
    private ManagedThreadFactory managedThreadFactory;

    public void startWorker() {
        Thread thread = managedThreadFactory.newThread(() -> {
            runWorkerLoop();
        });

        thread.setName("case-sync-worker-1");
        thread.start();
    }

    private void runWorkerLoop() {
        // controlled worker logic
    }
}
```

Atau via JNDI lookup:

```java
import jakarta.enterprise.concurrent.ManagedThreadFactory;
import javax.naming.InitialContext;

public class WorkerBootstrap {

    public void startWorker() throws Exception {
        InitialContext ctx = new InitialContext();

        ManagedThreadFactory factory =
            (ManagedThreadFactory) ctx.lookup("java:comp/DefaultManagedThreadFactory");

        Thread thread = factory.newThread(this::runWorkerLoop);
        thread.setName("case-sync-worker-1");
        thread.start();
    }

    private void runWorkerLoop() {
        // controlled worker logic
    }
}
```

Catatan: nama JNDI default dan resource configuration bisa berbeda antar server. Portable code harus mengacu pada resource yang memang dideklarasikan dan disediakan oleh target runtime.

---

### 4.3 Jakarta EE 11 dan Virtual Thread Awareness

Jakarta EE 11 membawa Jakarta Concurrency 3.1, dan Concurrency 3.1 memasukkan integrasi dengan Java 21 Virtual Threads. Jakarta EE 11 release page juga mencatat bahwa Concurrency 3.1 mendukung virtual threads pada managed resources seperti `@ManagedExecutorDefinition`.

Implikasi penting:

- virtual thread bukan alasan untuk kembali memakai unmanaged `new Thread()`;
- virtual thread tetap perlu container semantics jika berjalan di dalam Jakarta EE;
- managed concurrency tetap relevan karena problem utamanya bukan hanya mahal/murahnya thread, tetapi ownership, context, lifecycle, dan observability.

Dalam seri ini, virtual thread akan dibahas lebih dalam di Part 11. Untuk Part 5, cukup pegang prinsip berikut:

```text
Virtual thread reduces thread cost.
It does not remove runtime ownership responsibility.
```

---

## 5. Kapan Memakai ManagedThreadFactory

### 5.1 Use Case 1 — Library Membutuhkan ThreadFactory

Beberapa library membutuhkan `ThreadFactory` untuk membuat thread internal.

Contoh umum:

- scheduler internal library;
- async client library;
- consumer loop library;
- embedded protocol handler;
- file watcher;
- low-level queue processor.

Jika library menerima `ThreadFactory`, jangan beri lambda yang membuat `new Thread()` mentah.

Buruk:

```java
SomeClient client = SomeClient.builder()
    .threadFactory(r -> new Thread(r, "client-worker"))
    .build();
```

Lebih baik:

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedThreadFactory;

public class ClientProducer {

    @Resource
    ManagedThreadFactory managedThreadFactory;

    public SomeClient createClient() {
        return SomeClient.builder()
            .threadFactory(runnable -> {
                Thread thread = managedThreadFactory.newThread(runnable);
                thread.setName("external-registry-client-worker");
                return thread;
            })
            .build();
    }
}
```

Tetapi ini tetap perlu review:

- Berapa banyak thread yang dibuat library?
- Apakah thread berhenti saat app shutdown?
- Apakah library punya `close()`?
- Apakah library membuat ulang thread setelah failure?
- Apakah thread akan berjalan di semua node cluster?
- Apakah resource usage terlihat di metric?

---

### 5.2 Use Case 2 — Controlled Long-Running Worker

Kadang aplikasi butuh worker jangka panjang:

```text
start worker once -> poll internal durable queue -> process item -> sleep/backoff -> repeat
```

Contoh:

- worker membaca table `JOB_REQUEST`;
- worker memindahkan file dari staging directory;
- worker mengirim batch kecil dari outbox;
- worker melakukan cleanup lokal;
- worker memonitor lightweight in-memory queue.

Tetapi hati-hati: ini sangat sering lebih tepat memakai:

- `ManagedScheduledExecutorService`;
- Jakarta Batch;
- messaging consumer;
- Kubernetes CronJob/Job;
- external scheduler;
- workflow engine.

Jika tetap memakai `ManagedThreadFactory`, worker harus memiliki lifecycle eksplisit:

```java
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.annotation.Resource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.concurrent.ManagedThreadFactory;

import java.util.concurrent.atomic.AtomicBoolean;

@ApplicationScoped
public class OutboxWorker {

    @Resource
    ManagedThreadFactory threadFactory;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile Thread workerThread;

    @PostConstruct
    public void start() {
        if (!running.compareAndSet(false, true)) {
            return;
        }

        workerThread = threadFactory.newThread(this::runLoop);
        workerThread.setName("outbox-worker-main");
        workerThread.start();
    }

    @PreDestroy
    public void stop() {
        running.set(false);

        Thread thread = workerThread;
        if (thread != null) {
            thread.interrupt();
            try {
                thread.join(10_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void runLoop() {
        while (running.get()) {
            try {
                processOneBatch();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                logFailure(e);
                sleepQuietly(1_000);
            }
        }
    }

    private void processOneBatch() throws InterruptedException {
        // 1. claim small batch from DB/outbox
        // 2. process safely
        // 3. commit progress
        // 4. backoff if no work
    }

    private void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void logFailure(Exception e) {
        // log with correlation/component identity
    }
}
```

Kode di atas lebih aman daripada loop liar, tetapi masih belum otomatis production-grade. Masih perlu:

- cluster singleton guard;
- DB-based claiming;
- idempotency;
- metrics;
- timeout;
- shutdown budget;
- backpressure;
- error classification;
- operator control.

---

### 5.3 Use Case 3 — Bridging Legacy Code

Kadang kamu punya legacy component yang API-nya seperti ini:

```java
public final class LegacyPoller {
    public LegacyPoller(ThreadFactory threadFactory) { ... }
    public void start() { ... }
    public void stop() { ... }
}
```

Jika rewrite belum memungkinkan, `ManagedThreadFactory` bisa menjadi adapter.

```java
@ApplicationScoped
public class LegacyPollerAdapter {

    @Resource
    ManagedThreadFactory managedThreadFactory;

    private LegacyPoller poller;

    @PostConstruct
    void init() {
        poller = new LegacyPoller(runnable -> {
            Thread thread = managedThreadFactory.newThread(runnable);
            thread.setName("legacy-poller-worker");
            return thread;
        });
        poller.start();
    }

    @PreDestroy
    void destroy() {
        if (poller != null) {
            poller.stop();
        }
    }
}
```

Ini bukan desain final ideal. Ini migration bridge.

Target jangka panjang biasanya:

```text
legacy internal threads -> managed executor / scheduler / batch / messaging
```

---

## 6. Kapan Jangan Memakai ManagedThreadFactory

### 6.1 Jangan untuk Fire-and-Forget Task Biasa

Buruk:

```java
public void submitReportGeneration(String reportId) {
    Thread t = managedThreadFactory.newThread(() -> generateReport(reportId));
    t.start();
}
```

Masalah:

- setiap request bisa membuat thread baru;
- tidak ada queue control;
- tidak ada concurrency limit;
- tidak ada rejection policy;
- tidak ada tracking task;
- cancellation sulit;
- error mudah hilang;
- tidak ada backpressure.

Lebih baik:

```java
@Resource
ManagedExecutorService executor;

public Future<ReportResult> submitReportGeneration(String reportId) {
    return executor.submit(() -> generateReport(reportId));
}
```

Atau jika perlu durable/restartable:

```text
insert JOB_REQUEST(reportId, status='PENDING')
-> batch/scheduler/worker claims job
-> process idempotently
-> update status/audit
```

---

### 6.2 Jangan untuk Membuat Thread Pool Sendiri Tanpa Alasan Kuat

Buruk:

```java
ExecutorService pool = Executors.newFixedThreadPool(
    20,
    runnable -> managedThreadFactory.newThread(runnable)
);
```

Ini memang memakai managed thread factory, tetapi kamu tetap membuat pool sendiri.

Masalah:

- siapa shutdown pool?
- apakah pool terlihat oleh container admin?
- apakah sizing dikontrol server admin?
- apakah queue policy benar?
- apakah redeploy aman?
- apakah metrics tersedia?
- apakah thread leak terdeteksi?

Lebih baik memakai `ManagedExecutorService` yang dikonfigurasi oleh container.

---

### 6.3 Jangan untuk Scheduling Berkala

Buruk:

```java
Thread t = managedThreadFactory.newThread(() -> {
    while (true) {
        runDailySyncIfNeeded();
        Thread.sleep(60_000);
    }
});
t.start();
```

Masalah:

- loop tidak punya kalender/schedule semantic yang jelas;
- shutdown sulit;
- error bisa membunuh worker diam-diam;
- cluster duplicate execution;
- drift tidak terlihat;
- no misfire policy;
- no operator control.

Lebih baik:

- `ManagedScheduledExecutorService` untuk simple periodic work;
- Jakarta Batch untuk restartable batch work;
- Kubernetes CronJob untuk container-native batch;
- Quartz/external scheduler untuk complex calendar schedule;
- workflow engine untuk business process orchestration.

---

### 6.4 Jangan untuk Job Besar yang Butuh Restartability

Jika workload memiliki karakteristik berikut:

- ribuan/jutaan record;
- butuh checkpoint;
- butuh restart dari posisi terakhir;
- ada skip/retry policy;
- ada execution history;
- perlu operator stop/restart;
- perlu audit hasil batch;

maka `ManagedThreadFactory` biasanya terlalu rendah level.

Gunakan Jakarta Batch.

```text
Thread = execution primitive
Batch = workload lifecycle model
```

---

## 7. Thread Ownership Model

### 7.1 Siapa Pemilik Thread?

Dengan `new Thread()`:

```text
Application creates thread
Application starts thread
Container may not know enough
Application must stop thread
Failure likely during undeploy/redeploy
```

Dengan `ManagedThreadFactory`:

```text
Container creates manageable thread
Application still starts and coordinates thread
Application still owns higher-level lifecycle
Container can apply some context/rules
Failure is reduced, not eliminated
```

Dengan `ManagedExecutorService`:

```text
Application submits task
Container owns execution resource
Container manages executor lifecycle
Task lifecycle is explicit via Future/listeners
Operational control is much better
```

---

### 7.2 Ownership Table

| Concern | `new Thread()` | `ManagedThreadFactory` | `ManagedExecutorService` |
|---|---:|---:|---:|
| Container-aware thread creation | No | Yes | Yes |
| Task queue management | No | No | Yes |
| Pool sizing by container/admin | No | No, unless wrapped carefully | Yes |
| Task lifecycle tracking | Manual | Manual | Built-in via `Future`/managed task concepts |
| Rejection policy | Manual | Manual | Executor-level |
| Shutdown coordination | Manual and risky | Manual but safer | Container-managed |
| Context propagation | Unreliable | Managed according to spec/container | Managed according to spec/container |
| Good default for async task | No | Usually no | Yes |
| Good for library requiring `ThreadFactory` | No | Yes | Sometimes not applicable |
| Good for durable/restartable batch | No | No | No; use Jakarta Batch |

---

## 8. Naming, Priority, Daemon, and Thread Attributes

### 8.1 Thread Naming

Always name threads.

Bad:

```text
Thread-42
Thread-43
Thread-44
```

Good:

```text
aceas-outbox-worker-1
case-escalation-sync-1
external-registry-poller-1
```

Thread name should encode:

```text
application/module + workload + instance/index
```

Examples:

```java
Thread thread = managedThreadFactory.newThread(runnable);
thread.setName("case-ageing-recalc-worker-1");
```

Why it matters:

- thread dump diagnosis;
- CPU profiling;
- JFR analysis;
- operations communication;
- incident timeline reconstruction.

---

### 8.2 Priority

Avoid changing thread priority unless you have a very strong reason.

```java
thread.setPriority(Thread.NORM_PRIORITY);
```

Thread priority is not a reliable workload management mechanism in enterprise Java. Use executor sizing, queueing, bulkheads, rate limits, and scheduling instead.

---

### 8.3 Daemon Threads

Be very careful with daemon threads.

Daemon thread means JVM is allowed to exit without waiting for the thread.

In application server, this can hide incomplete work.

Bad mental model:

```text
Set daemon=true so shutdown is easier.
```

Better mental model:

```text
Make shutdown explicit, bounded, observable, and safe.
```

If a worker owns important work, do not rely on daemon behavior. Use stop flag, interrupt, join timeout, persisted progress, and idempotency.

---

## 9. Lifecycle Pattern for Managed Threads

### 9.1 Required Lifecycle Stages

A safe managed thread component has explicit stages:

```text
constructed
  -> initialized
  -> thread created
  -> thread started
  -> running
  -> stop requested
  -> interrupted/woken
  -> cleanup
  -> stopped
```

Any design missing `stop requested`, `cleanup`, or `stopped` is suspect.

---

### 9.2 Minimal Lifecycle Skeleton

```java
@ApplicationScoped
public class ManagedWorkerLifecycle {

    @Resource
    ManagedThreadFactory threadFactory;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile Thread thread;

    @PostConstruct
    void start() {
        if (!running.compareAndSet(false, true)) {
            return;
        }

        thread = threadFactory.newThread(this::run);
        thread.setName("managed-worker-lifecycle-demo");
        thread.start();
    }

    @PreDestroy
    void stop() {
        running.set(false);
        Thread local = thread;

        if (local != null) {
            local.interrupt();
            joinWithTimeout(local, 10_000);
        }
    }

    private void run() {
        try {
            while (running.get() && !Thread.currentThread().isInterrupted()) {
                doOneCycle();
            }
        } finally {
            cleanup();
        }
    }

    private void doOneCycle() {
        // execute bounded, interrupt-aware unit of work
    }

    private void cleanup() {
        // close local resources, update health/metrics, release claims
    }

    private void joinWithTimeout(Thread thread, long timeoutMillis) {
        try {
            thread.join(timeoutMillis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

---

### 9.3 Hidden Bug in Many Worker Loops

Common bug:

```java
while (running) {
    try {
        doWork();
    } catch (Exception e) {
        log.error("Worker failed", e);
    }
}
```

Looks robust, but it swallows interruption if `InterruptedException` is wrapped or caught incorrectly.

Better:

```java
while (running.get()) {
    try {
        doWork();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        break;
    } catch (Exception e) {
        log.error("Worker failed", e);
        backoffInterruptibly();
    }
}
```

If you catch `Exception`, always consider whether you accidentally catch interruption through a wrapper.

---

## 10. Context Semantics

### 10.1 What Context Might Be Captured?

Depending on spec version and container implementation, managed concurrency resources may propagate container context such as:

- application component context;
- naming context;
- classloader context;
- security context;
- CDI context where applicable;
- transaction-related constraints;
- configured context service behavior.

The exact propagation rules matter and will be covered deeper in Part 6.

For now, use this rule:

```text
ManagedThreadFactory reduces context loss risk, but do not assume every context is valid forever.
```

A context captured at creation time can become invalid later.

Example:

- user request creates worker;
- worker keeps running after request ends;
- request-scoped data is no longer valid;
- user session expires;
- async action still uses stale identity.

That design is not defensible.

---

### 10.2 Never Rely on Request Context for Long-Running Thread

Bad:

```java
public void startLongWorkerFromRequest(UserContext userContext) {
    Thread t = managedThreadFactory.newThread(() -> {
        // uses request/user-scoped data for minutes/hours
        processAs(userContext.currentUser());
    });
    t.start();
}
```

Better:

```text
At enqueue time:
- validate authorization
- persist job request
- persist initiatedBy
- persist business parameters
- persist audit metadata

At execution time:
- load job request
- run as explicit system/service identity
- use initiatedBy only as audit attribution, not live security context
```

---

### 10.3 ThreadLocal and MDC

ThreadLocal values are dangerous in long-running managed threads.

Problems:

- stale values from previous cycle;
- leaked tenant/user/correlation;
- memory retention;
- misleading logs.

Pattern:

```java
private void processJob(Job job) {
    try {
        putMdc(job);
        execute(job);
    } finally {
        clearMdc();
    }
}
```

Never set MDC once at thread startup and assume it remains correct for all work.

---

## 11. Cluster Semantics

### 11.1 The “Every Node Starts a Worker” Problem

In a cluster, `@ApplicationScoped @PostConstruct` runs once per application instance, not once per cluster.

If you deploy 4 pods/nodes:

```text
pod-1 starts worker
pod-2 starts worker
pod-3 starts worker
pod-4 starts worker
```

If the worker sends reminders, imports files, recalculates escalation, or syncs external APIs, duplicate execution can happen.

---

### 11.2 Cluster-Safe Worker Requires Coordination

Options:

1. **DB row claiming**

```sql
UPDATE job_request
SET status = 'RUNNING', claimed_by = ?, claimed_at = CURRENT_TIMESTAMP
WHERE id = ?
  AND status = 'PENDING'
```

Only one node wins.

2. **DB lease lock**

```text
worker tries to acquire lease
lease has expiry
worker renews lease
if node dies, lease expires
another node can take over
```

3. **Message broker consumer group**

Let the broker distribute work.

4. **Kubernetes leader election**

Useful in Kubernetes-native workloads, but portability to plain Jakarta EE server may be lower.

5. **External scheduler/orchestrator**

Use when scheduling and HA semantics are critical.

---

### 11.3 Never Use In-Memory Flag for Cluster Singleton

Bad:

```java
private static boolean started = false;
```

This only works inside one JVM/classloader. It does not coordinate across nodes. It can also break across redeploys.

---

## 12. Failure Modes

### 12.1 Redeploy Leak

Scenario:

```text
Application v1 starts worker thread.
Application is redeployed to v2.
Worker from v1 keeps running.
Old classloader cannot be garbage-collected.
Both v1 and v2 workers process jobs.
```

Symptoms:

- duplicate processing;
- old code still producing logs;
- memory leak;
- PermGen/metaspace/classloader growth;
- weird ClassCastException between same class name from different classloaders;
- shutdown timeout.

Prevention:

- managed resources;
- explicit `@PreDestroy` stop;
- interrupt-aware loops;
- bounded join;
- avoid static thread references;
- operational check after redeploy.

---

### 12.2 Zombie Worker

A zombie worker is a thread that should be stopped but remains alive.

Causes:

- blocking I/O without timeout;
- sleep without interrupt handling;
- catch-all exception swallowing interruption;
- while(true) loop;
- non-daemon thread with no stop path;
- external library not closed.

Prevention:

- all blocking calls need timeout;
- all loops check stop flag;
- all waits are interrupt-aware;
- all clients have close/shutdown;
- `@PreDestroy` performs bounded stop.

---

### 12.3 Invisible Runtime

This happens when application builds its own thread pool or worker system under the container.

Symptoms:

- server admin sees normal executor metrics;
- CPU is high anyway;
- thread dump shows custom threads;
- no queue depth metric;
- no rejection counter;
- no job status;
- incident team cannot tell what work is running.

Prevention:

- prefer managed executor;
- expose metrics;
- name threads;
- register health checks;
- persist job state;
- avoid hidden infinite loops.

---

### 12.4 Duplicate Cluster Execution

Scenario:

```text
4 pods each start a file import worker.
All scan same directory/table.
Same record/file processed multiple times.
```

Prevention:

- atomic claim;
- idempotency key;
- unique constraints;
- external lock/lease;
- partition assignment;
- job repository;
- message broker semantics.

---

### 12.5 Lost Audit Attribution

Scenario:

```text
User clicks “bulk approve”.
Application starts background thread.
Thread later approves records.
Audit says executed by unknown/system.
No durable relation to initiating user.
```

Prevention:

Persist:

- initiatedBy;
- initiatedAt;
- approvedBy if separate;
- reason;
- source request id;
- job id;
- input parameters;
- execution identity;
- record-level outcome.

Do not rely on live request thread identity after the request ends.

---

## 13. Design Decision Framework

### 13.1 Decision Question 1 — Do You Need a Thread Object?

If no, do not use `ManagedThreadFactory`.

Use:

```text
ManagedExecutorService
ManagedScheduledExecutorService
Jakarta Batch
Messaging
External scheduler
```

If yes, ask why.

Valid reasons:

- API requires `ThreadFactory`;
- legacy bridge;
- low-level component needing explicit thread object;
- controlled single worker with explicit lifecycle.

Weak reasons:

- “I want async.”
- “Executor feels too much.”
- “This is only temporary.”
- “It works on my machine.”
- “Virtual threads are cheap.”

---

### 13.2 Decision Question 2 — Is Work Short-Lived or Long-Lived?

Short-lived independent task:

```text
ManagedExecutorService
```

Periodic task:

```text
ManagedScheduledExecutorService
```

Large restartable data processing:

```text
Jakarta Batch
```

Message-driven event processing:

```text
Jakarta Messaging / broker consumer
```

Long-running internal worker:

```text
ManagedThreadFactory only if lifecycle, cluster, and operation are explicitly handled
```

---

### 13.3 Decision Question 3 — Is Work Durable?

If work must survive process crash, redeploy, or node loss, `Thread` is not enough.

Need durable state:

```text
DB table
message broker
job repository
file manifest
external workflow state
```

Thread can execute durable work, but cannot be the durability mechanism.

---

## 14. Production-Grade Managed Thread Checklist

Before approving `ManagedThreadFactory` in code review, check:

### API Justification

- [ ] Is there a real need for `ThreadFactory` or `Thread` object?
- [ ] Why not `ManagedExecutorService`?
- [ ] Why not `ManagedScheduledExecutorService`?
- [ ] Why not Jakarta Batch?
- [ ] Why not messaging/external orchestration?

### Lifecycle

- [ ] Is thread started in controlled lifecycle method?
- [ ] Is there a stop flag?
- [ ] Is interruption handled correctly?
- [ ] Is there `@PreDestroy` cleanup?
- [ ] Is shutdown bounded with timeout?
- [ ] Are external clients closed?

### Resource Safety

- [ ] Are all blocking calls time-bounded?
- [ ] Is database access short-transaction and bounded?
- [ ] Is there backoff when no work exists?
- [ ] Is there no unbounded in-memory queue?
- [ ] Is memory retained across loop iterations cleaned?

### Context Safety

- [ ] No request-scoped object retained long-term?
- [ ] No stale security identity used?
- [ ] MDC cleared per unit of work?
- [ ] Correlation ID explicitly set per job/item?

### Cluster Safety

- [ ] Does this run on every node?
- [ ] Is duplicate execution safe?
- [ ] Is there claim/lease/lock/idempotency?
- [ ] Is there unique constraint or dedup mechanism?

### Observability

- [ ] Thread has meaningful name?
- [ ] Active/running status exposed?
- [ ] Last success/failure timestamp tracked?
- [ ] Error count metric exists?
- [ ] Processing duration metric exists?
- [ ] Stuck detection exists?

### Audit

- [ ] Initiator persisted?
- [ ] Execution identity clear?
- [ ] Input parameters recorded?
- [ ] Record-level outcome available if needed?
- [ ] Operator stop/restart action audited?

---

## 15. Example: Bad to Better

### 15.1 Bad: Fire-and-Forget Thread from REST Endpoint

```java
@Path("/reports")
public class ReportResource {

    @Resource
    ManagedThreadFactory threadFactory;

    @POST
    @Path("/{id}/generate")
    public Response generate(@PathParam("id") String id) {
        Thread thread = threadFactory.newThread(() -> generateReport(id));
        thread.start();
        return Response.accepted().build();
    }

    private void generateReport(String id) {
        // long work
    }
}
```

Problems:

- per-request thread creation;
- no tracking;
- no cancellation;
- no retry;
- no queue control;
- error disappears into logs;
- duplicate submission likely;
- not durable.

---

### 15.2 Better: Managed Executor for Short Async Task

```java
@Path("/reports")
public class ReportResource {

    @Resource
    ManagedExecutorService executor;

    @POST
    @Path("/{id}/generate")
    public Response generate(@PathParam("id") String id) {
        Future<?> future = executor.submit(() -> generateReport(id));

        return Response.accepted()
            .entity(Map.of("status", "submitted"))
            .build();
    }

    private void generateReport(String id) {
        // bounded async task
    }
}
```

Still missing durable tracking, but better for simple async offload.

---

### 15.3 Best for Durable Report Generation

```text
POST /reports/{id}/generate
  -> validate authorization
  -> insert REPORT_JOB(id, report_id, status, requested_by, requested_at)
  -> return 202 + job id

Worker/Batch:
  -> claim pending job atomically
  -> generate report idempotently
  -> persist artifact metadata
  -> update status SUCCESS/FAILED
  -> expose status endpoint
```

In this model, thread is not the job. Thread only executes part of the job lifecycle.

---

## 16. Example: Safe Adapter for ThreadFactory-Based Library

```java
@ApplicationScoped
public class ExternalRegistryClientManager {

    @Resource
    ManagedThreadFactory managedThreadFactory;

    private ExternalRegistryClient client;

    @PostConstruct
    void start() {
        client = ExternalRegistryClient.builder()
            .threadFactory(this::newClientThread)
            .connectTimeout(Duration.ofSeconds(5))
            .readTimeout(Duration.ofSeconds(20))
            .build();

        client.start();
    }

    @PreDestroy
    void stop() {
        if (client != null) {
            client.close(Duration.ofSeconds(10));
        }
    }

    private Thread newClientThread(Runnable runnable) {
        Thread thread = managedThreadFactory.newThread(() -> {
            try {
                runnable.run();
            } finally {
                clearThreadLocalsAndMdc();
            }
        });

        thread.setName("external-registry-client-worker");
        return thread;
    }

    private void clearThreadLocalsAndMdc() {
        // e.g. MDC.clear(); custom context cleanup
    }
}
```

Review points:

- library has explicit start/close;
- timeouts configured;
- thread named;
- cleanup in finally;
- lifecycle bound to CDI bean lifecycle.

Still ask:

- how many threads can it create?
- what happens in cluster?
- what metrics does it expose?
- does it retry safely?
- can it block shutdown?

---

## 17. Relationship With Java 8–25

### Java 8

- Java EE 7/8 era commonly ran on Java 8.
- `javax.enterprise.concurrent.ManagedThreadFactory` exists from Java EE Concurrency Utilities.
- No virtual threads.
- Thread cost is high enough that thread count discipline is critical.

### Java 11

- Many enterprises moved app servers to Java 11.
- Still platform threads only.
- Cleaner GC/runtime than Java 8, but no fundamental thread model change.

### Java 17

- Baseline for many modern Jakarta runtimes.
- Jakarta EE 11 requires Java SE 17 or higher.
- Stronger reason to modernize code away from legacy Java EE assumptions.

### Java 21

- Virtual threads are final.
- Jakarta EE 11 / Concurrency 3.1 integrates virtual thread support in managed resources.
- Virtual threads change cost model, not ownership model.

### Java 25

- Structured concurrency and Scoped Values are relevant to future mental models.
- In enterprise Jakarta runtime, portability depends on app server support and spec maturity.
- Do not assume preview APIs are portable enterprise baseline.

---

## 18. Top 1% Engineering Perspective

A weaker engineer sees this:

```text
I need background work -> create thread
```

A stronger engineer sees this:

```text
I need background work -> classify workload -> choose execution model -> define lifecycle -> define durability -> define context -> define failure model -> define operations model
```

For `ManagedThreadFactory`, the expert question is not:

> “Is this allowed?”

It is:

> “What responsibility did I just take away from the container, and have I replaced it with an explicit, testable, observable design?”

That is the essence.

---

## 19. Common Code Review Comments

Use these as review language.

### Comment 1 — Fire-and-Forget Thread

> This creates a thread per request. Even though it uses `ManagedThreadFactory`, there is no queue, concurrency limit, rejection policy, lifecycle tracking, cancellation, or durable status. This should be a `ManagedExecutorService` task if short-lived, or a persisted job plus Batch/worker if durable/restartable.

### Comment 2 — Hidden Scheduler Loop

> This loop is effectively a scheduler implemented inside the application. It needs explicit shutdown, interrupt handling, cluster duplication control, metrics, and stuck detection. If the intent is periodic execution, `ManagedScheduledExecutorService`, Jakarta Batch, or external scheduling should be considered.

### Comment 3 — Missing Cluster Coordination

> This component starts once per application instance. In a clustered deployment, every node will run it. The design needs a claim/lease/idempotency mechanism or it risks duplicate execution.

### Comment 4 — Context Retention Risk

> This thread appears to retain request/user-scoped data beyond the request lifetime. Persist the initiator and parameters, then execute under an explicit system/service identity with audit attribution.

### Comment 5 — Shutdown Risk

> The worker does not have a bounded stop path. Add a stop flag, interrupt handling, timeout on blocking calls, `@PreDestroy`, and metrics for stop success/failure.

---

## 20. Thought Experiment

Imagine a regulatory system has a button:

```text
Recalculate Escalation for 50,000 Cases
```

A developer proposes:

```java
Thread t = managedThreadFactory.newThread(() -> recalculateAllCases());
t.start();
return 202 Accepted;
```

Questions:

1. What happens if the server restarts after 20,000 cases?
2. Can the operator see progress?
3. Can the job be stopped?
4. Can the job be restarted without double-updating cases?
5. Which user initiated it?
6. What authorization was checked?
7. What if two users click the button?
8. What if four cluster nodes run the same worker?
9. What if one case fails validation?
10. What if DB locks build up?

If the design cannot answer these, `ManagedThreadFactory` is the wrong abstraction. Jakarta Batch or a durable job orchestration pattern is likely required.

---

## 21. Ringkasan

`ManagedThreadFactory` adalah fasilitas penting, tetapi rendah level.

Gunakan ketika:

- kamu benar-benar butuh `ThreadFactory`;
- kamu menjembatani library/legacy code;
- kamu membuat worker sangat terkontrol;
- kamu memahami lifecycle dan ownership yang kamu ambil.

Jangan gunakan untuk:

- fire-and-forget async biasa;
- scheduled loop liar;
- job besar restartable;
- thread pool custom tanpa alasan kuat;
- mengganti managed executor;
- mengganti batch engine.

Prinsip final:

```text
ManagedThreadFactory makes thread creation container-aware.
It does not make arbitrary thread-based architecture automatically safe.
```

---

## 22. Referensi

- Jakarta Concurrency 3.1 — official specification page. It states that Jakarta Concurrency provides APIs for using concurrency from application components without compromising container integrity and lists Java 21 virtual thread integration among Concurrency 3.1 features.
- Jakarta EE 11 — official release page. It lists Jakarta Batch 2.1 and Jakarta Concurrency 3.1 as part of Jakarta EE 11 and notes support for Java 21 virtual threads in the updated Concurrency specification.
- Jakarta Concurrency specification guide — describes compliant containers having executor services, context services, and managed thread factories configured for asynchronous or scheduled task execution with propagated container context.

---

## 23. Status Seri

Seri belum selesai.

Bagian ini adalah:

```text
Part 5 — ManagedThreadFactory and Thread Creation Without Losing Container Semantics
```

Berikutnya:

```text
Part 6 — ContextService and Context Propagation
File: 06-context-service-and-context-propagation.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 4 — ManagedScheduledExecutorService and Time-Based Workloads](./04-managed-scheduled-executor-service-time-based-workloads.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 6 — ContextService and Context Propagation](./06-context-service-and-context-propagation.md)

</div>
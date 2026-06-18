# Part 4 — ManagedScheduledExecutorService and Time-Based Workloads

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `04-managed-scheduled-executor-service-time-based-workloads.md`  
**Focus:** time-based workloads inside Jakarta EE containers  
**Baseline:** Java 8–25, Java EE/Jakarta EE, Jakarta Concurrency 3.1 / Jakarta EE 11  
**Status:** Part 4 of 35

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan bukan hanya tahu cara memakai `ManagedScheduledExecutorService`, tetapi mampu membedakan secara tajam antara:

1. **menjalankan task setelah delay**,
2. **menjalankan task secara periodik**,
3. **menjadwalkan business workload yang aman di production**,
4. **menjalankan scheduler di cluster tanpa duplikasi**, dan
5. **menentukan kapan scheduled executor bukan solusi yang tepat**.

Target pemahaman utamanya:

- memahami kenapa `ManagedScheduledExecutorService` ada di Jakarta EE;
- memahami perbedaan fixed-rate dan fixed-delay secara operasional;
- memahami failure mode dari scheduled task:
  - overlap,
  - drift,
  - delay cascade,
  - duplicate execution,
  - misfire,
  - stuck job,
  - memory leak,
  - redeploy leak,
  - cluster double-run;
- mampu mendesain workload berbasis waktu dengan:
  - context yang benar,
  - transaction boundary yang aman,
  - observability,
  - cancellation,
  - idempotency,
  - backpressure,
  - cluster coordination;
- mampu memilih antara:
  - `ManagedScheduledExecutorService`,
  - EJB Timer,
  - Jakarta Batch,
  - messaging,
  - database-backed job table,
  - Kubernetes CronJob,
  - external scheduler,
  - workflow engine.

---

## 2. Problem yang Diselesaikan

Di banyak sistem enterprise, kebutuhan seperti ini sangat umum:

- “jalankan cleanup setiap jam”;
- “retry pengiriman email setiap 5 menit”;
- “sinkronisasi data eksternal setiap malam”;
- “cek escalation rule setiap 10 menit”;
- “generate report pukul 01:00”;
- “refresh cache setelah delay tertentu”;
- “expire application yang idle selama N hari”;
- “polling external system sampai result tersedia”;
- “jalankan reconciliation setelah batch selesai”;
- “trigger reminder sebelum deadline”.

Secara teknis, engineer sering tergoda menulis:

```java
new Thread(() -> {
    while (true) {
        doWork();
        Thread.sleep(60_000);
    }
}).start();
```

atau:

```java
Executors.newScheduledThreadPool(4)
         .scheduleAtFixedRate(this::doWork, 0, 1, TimeUnit.MINUTES);
```

Di Java SE biasa, ini mungkin tampak masuk akal. Namun di Jakarta EE, ini sering menjadi sumber masalah besar.

Masalahnya bukan hanya “thread dibuat manual”. Masalahnya adalah scheduled workload biasanya hidup lebih lama daripada request, lebih sering menyentuh database, lebih sering punya side effect, dan lebih sering dilupakan oleh operator.

Akibatnya scheduled task bisa menjadi “mesin tersembunyi” di dalam aplikasi:

- tidak terlihat di monitoring;
- tidak punya audit trail;
- tetap berjalan setelah user request selesai;
- berjalan ganda di cluster;
- berjalan memakai context yang salah;
- tidak berhenti saat redeploy;
- menumpuk ketika downstream lambat;
- menyebabkan DB overload;
- menulis side effect dua kali;
- sulit direstart dengan aman;
- sulit dijelaskan ketika auditor bertanya: “siapa yang menjalankan perubahan ini?”

`ManagedScheduledExecutorService` menyelesaikan sebagian problem: ia menyediakan executor terjadwal yang thread-nya dikelola container. Tetapi ia tidak otomatis menyelesaikan semua problem desain workload berbasis waktu. Engineer top-tier harus memahami batasnya.

---

## 3. Mental Model Utama

### 3.1 Scheduled Executor Bukan “Cron Mini”

`ManagedScheduledExecutorService` bukan pengganti penuh cron enterprise. Ia adalah executor untuk menjalankan task dengan delay atau jadwal periodik di dalam container.

Mental model yang lebih tepat:

> `ManagedScheduledExecutorService` adalah “managed timer + executor” untuk pekerjaan asynchronous yang time-triggered, short-to-medium duration, dan masih cocok hidup sebagai bagian dari lifecycle aplikasi.

Ia cocok untuk:

- cleanup ringan;
- polling pendek;
- retry ringan;
- refresh cache;
- background maintenance kecil;
- trigger in-memory atau near-memory operation;
- scheduling task yang tidak memerlukan restartability kompleks;
- periodic health/reporting internal;
- offload task dengan delay.

Ia kurang cocok untuk:

- batch besar;
- long-running job berjam-jam;
- workload yang harus restart dari checkpoint;
- workload yang harus punya operator control plane;
- workload yang harus strict exactly-once;
- workload yang harus survive full cluster restart tanpa kehilangan state;
- jadwal bisnis kompleks;
- dependency graph antar step;
- record-level error handling;
- regulatory-grade reconciliation.

Untuk kasus tersebut, Jakarta Batch, durable job table, messaging, atau workflow engine biasanya lebih tepat.

---

### 3.2 Timer Trigger vs Work Execution

Scheduled workload punya dua bagian berbeda:

```text
+-------------------+       +---------------------+
| Time Trigger      | ----> | Work Execution      |
+-------------------+       +---------------------+
| every 5 minutes   |       | sync customer data  |
| delay 30 seconds  |       | expire sessions     |
| 01:00 daily       |       | generate report     |
+-------------------+       +---------------------+
```

Kesalahan umum: menganggap trigger dan work adalah satu hal.

Di production, keduanya harus dipisahkan secara mental:

- trigger menentukan **kapan mencoba memulai**;
- work menentukan **apa yang benar-benar dilakukan**;
- work bisa:
  - dilewati,
  - ditunda,
  - dikunci,
  - dibatalkan,
  - di-retry,
  - dijalankan oleh node lain,
  - dikonversi menjadi durable job.

Design yang matang tidak hanya bertanya:

> “Task ini jalan tiap berapa menit?”

Tetapi juga:

> “Apa yang terjadi jika waktu berikutnya datang saat eksekusi sebelumnya belum selesai?”

---

### 3.3 Scheduled Task Adalah Producer Workload

Task periodik secara diam-diam bisa menjadi producer beban.

Misalnya:

```text
every 1 minute:
    fetch 5000 pending rows
    call external API for each row
```

Jika downstream melambat, satu tick bisa selesai dalam 10 menit. Tetapi scheduler tetap memproduksi trigger setiap 1 menit.

Jika desainnya salah:

```text
Minute 00: run #1 still running
Minute 01: run #2 starts
Minute 02: run #3 starts
Minute 03: run #4 starts
...
```

Akibatnya:

- DB connection pool habis;
- external API kena rate limit;
- duplicate update;
- row lock meningkat;
- CPU naik;
- queue menumpuk;
- request user ikut lambat;
- aplikasi tampak “randomly unstable”.

Karena itu scheduled executor harus dilihat sebagai bagian dari capacity management, bukan hanya timer.

---

## 4. API Overview

### 4.1 Java SE: `ScheduledExecutorService`

Di Java SE, `ScheduledExecutorService` menyediakan method utama:

```java
ScheduledFuture<?> schedule(
    Runnable command,
    long delay,
    TimeUnit unit
);

<V> ScheduledFuture<V> schedule(
    Callable<V> callable,
    long delay,
    TimeUnit unit
);

ScheduledFuture<?> scheduleAtFixedRate(
    Runnable command,
    long initialDelay,
    long period,
    TimeUnit unit
);

ScheduledFuture<?> scheduleWithFixedDelay(
    Runnable command,
    long initialDelay,
    long delay,
    TimeUnit unit
);
```

Konsep dasarnya:

- `schedule`: jalan sekali setelah delay;
- `scheduleAtFixedRate`: jalan periodik berdasarkan target waktu tetap;
- `scheduleWithFixedDelay`: jalan periodik dengan jeda setelah eksekusi sebelumnya selesai;
- semua mengembalikan `ScheduledFuture`, yang bisa dipakai untuk cancel/check status.

### 4.2 Jakarta EE: `ManagedScheduledExecutorService`

Di Jakarta EE, `ManagedScheduledExecutorService` adalah managed variant dari scheduled executor.

Secara mental:

```text
ScheduledExecutorService
    = Java SE scheduled executor

ManagedScheduledExecutorService
    = Java SE scheduled executor semantics
      + Jakarta EE container-managed thread/context/lifecycle
```

Ia penting karena scheduled task berjalan pada thread yang dikelola container, sehingga lebih selaras dengan:

- lifecycle application server;
- classloader aplikasi;
- security context sesuai konfigurasi;
- naming/context yang dapat dikelola;
- shutdown/redeploy;
- resource management;
- platform observability.

Contoh injection modern:

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedScheduledExecutorService;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class CacheRefreshScheduler {

    @Resource
    private ManagedScheduledExecutorService scheduler;

    public void scheduleRefresh() {
        scheduler.schedule(
            this::refreshCacheSafely,
            30,
            TimeUnit.SECONDS
        );
    }

    private void refreshCacheSafely() {
        // managed task logic
    }
}
```

Pada Jakarta Concurrency 3.1/Jakarta EE 11, managed concurrency resource makin relevan karena platform mulai mendukung model yang lebih modern, termasuk dukungan virtual threads pada managed resources melalui definisi resource tertentu di Jakarta EE 11.

---

## 5. Fixed-Rate vs Fixed-Delay

Ini adalah konsep paling penting di time-based workload.

### 5.1 `scheduleAtFixedRate`

Fixed-rate mencoba menjaga jadwal berdasarkan interval absolut.

Contoh:

```java
scheduler.scheduleAtFixedRate(
    this::sync,
    0,
    5,
    TimeUnit.MINUTES
);
```

Target jadwal:

```text
T+00:00
T+05:00
T+10:00
T+15:00
...
```

Jika `sync()` selesai dalam 1 menit, tidak masalah.

```text
00:00 start run #1
00:01 end   run #1
05:00 start run #2
05:01 end   run #2
10:00 start run #3
```

Jika `sync()` memakan 7 menit, fixed-rate akan mencoba mengejar jadwal.

```text
00:00 start run #1
07:00 end   run #1
07:00 start run #2   <-- run #2 terlambat, langsung mulai
14:00 end   run #2
14:00 start run #3   <-- backlog waktu
```

Fixed-rate cocok jika:

- durasi kerja konsisten lebih pendek dari period;
- yang penting adalah frekuensi tetap;
- task ringan;
- task tidak boleh drift terlalu jauh;
- ada guard agar tidak overlap atau catch-up storm.

Contoh cocok:

- update metric internal setiap 10 detik;
- flush buffer kecil;
- sample lightweight state;
- heartbeat;
- refresh small cache.

Kurang cocok:

- sync external API berat;
- DB maintenance;
- file processing;
- batch besar;
- job yang durasinya fluktuatif;
- job yang tidak boleh overlap.

---

### 5.2 `scheduleWithFixedDelay`

Fixed-delay menunggu eksekusi sebelumnya selesai, lalu menunggu delay.

Contoh:

```java
scheduler.scheduleWithFixedDelay(
    this::pollPendingWork,
    0,
    5,
    TimeUnit.MINUTES
);
```

Timeline jika task butuh 2 menit:

```text
00:00 start run #1
02:00 end   run #1
07:00 start run #2
09:00 end   run #2
14:00 start run #3
```

Delay dihitung setelah task selesai.

Fixed-delay cocok jika:

- tidak boleh overlap;
- downstream harus diberi jeda;
- durasi task tidak stabil;
- ingin natural backpressure;
- polling worker;
- cleanup yang boleh drift;
- API sync yang harus hati-hati.

Untuk enterprise workload, fixed-delay sering lebih aman daripada fixed-rate karena mencegah scheduler mengejar backlog waktu secara agresif.

---

### 5.3 Perbandingan Ringkas

| Aspek | Fixed-Rate | Fixed-Delay |
|---|---:|---:|
| Basis jadwal | waktu absolut periodik | selesai kerja + delay |
| Drift | berusaha mengurangi drift | drift natural |
| Risiko catch-up | lebih tinggi | lebih rendah |
| Risiko overlap | tergantung executor/implementation dan desain task | lebih rendah untuk satu periodic chain |
| Cocok untuk | lightweight periodic action | polling/maintenance/sync |
| Bahaya utama | mengejar keterlambatan | interval aktual bisa makin jarang |
| Production default | hati-hati | sering lebih aman |

---

## 6. Overlap Problem

### 6.1 Apa Itu Overlap?

Overlap terjadi ketika eksekusi berikutnya berjalan sebelum eksekusi sebelumnya selesai.

```text
Run #1: 00:00 ---------------- 00:10
Run #2:       00:05 ---------------- 00:15
Run #3:             00:10 ---------------- 00:20
```

Bahaya overlap:

- duplicate update;
- lost update;
- race condition;
- lock contention;
- external side effect dobel;
- inconsistent audit;
- resource exhaustion;
- retry storm;
- deadlock antar run.

Tidak semua API/implementation akan menjalankan eksekusi periodic yang sama secara overlap pada chain yang sama. Namun di real system, overlap sering muncul dari sumber lain:

- scheduler dipanggil beberapa kali;
- aplikasi redeploy tetapi old task belum mati;
- setiap cluster node menjalankan scheduler;
- method schedule dipanggil di setiap request;
- multiple instances dari bean membuat schedule sendiri;
- task utama men-submit subtask tak terbatas;
- fixed-rate mencoba catch up;
- ada schedule lain dengan logic yang sama.

Jadi problem overlap tidak boleh hanya dipahami dari kontrak satu method. Ia harus dipahami sebagai system-level duplicate execution.

---

### 6.2 In-Memory Overlap Guard

Untuk single-node, guard sederhana:

```java
import java.util.concurrent.atomic.AtomicBoolean;

@ApplicationScoped
public class SafePoller {

    @Resource
    ManagedScheduledExecutorService scheduler;

    private final AtomicBoolean running = new AtomicBoolean(false);

    public void start() {
        scheduler.scheduleWithFixedDelay(
            this::runOnceIfNotRunning,
            0,
            1,
            TimeUnit.MINUTES
        );
    }

    private void runOnceIfNotRunning() {
        if (!running.compareAndSet(false, true)) {
            log("Previous run is still active. Skipping this tick.");
            return;
        }

        try {
            pollAndProcess();
        } catch (Exception ex) {
            logError("Poller failed", ex);
        } finally {
            running.set(false);
        }
    }

    private void pollAndProcess() {
        // real work
    }

    private void log(String message) {
        System.out.println(message);
    }

    private void logError(String message, Throwable throwable) {
        throwable.printStackTrace();
    }
}
```

Ini mencegah overlap dalam satu JVM.

Tetapi ini tidak cukup untuk cluster.

---

### 6.3 Cluster Overlap Guard

Jika ada 4 node:

```text
Node A: scheduler tick 01:00
Node B: scheduler tick 01:00
Node C: scheduler tick 01:00
Node D: scheduler tick 01:00
```

Maka `AtomicBoolean` hanya berlaku lokal.

Untuk cluster, perlu lock yang shared:

- database lock table;
- database advisory lock jika tersedia;
- row-level lock;
- distributed lock;
- leader election;
- single scheduler deployment;
- Kubernetes CronJob;
- queue with competing consumers;
- durable job table with unique key.

Contoh DB lock table sederhana:

```sql
CREATE TABLE scheduler_lock (
    lock_name        VARCHAR(100) PRIMARY KEY,
    locked_by        VARCHAR(100),
    locked_until     TIMESTAMP,
    updated_at       TIMESTAMP
);
```

Pseudo-flow:

```text
1. scheduler tick fires on every node
2. each node tries acquire lock('case-escalation', now + 5 minutes)
3. only one node succeeds
4. winner executes work
5. winner releases lock or lets TTL expire
6. losers skip
```

Contoh query konseptual:

```sql
UPDATE scheduler_lock
SET locked_by = ?,
    locked_until = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE lock_name = ?
  AND locked_until < CURRENT_TIMESTAMP;
```

Jika affected row = 1, lock didapat. Jika 0, node lain sedang menjalankan.

Catatan penting:

- pakai TTL agar lock tidak abadi jika node mati;
- job harus idempotent karena TTL bisa expire saat job masih berjalan;
- lock duration harus lebih besar dari expected runtime atau diperpanjang heartbeat;
- clock skew harus dipertimbangkan;
- isolation level harus dipahami;
- release lock di `finally`, tetapi jangan bergantung penuh pada `finally`.

---

## 7. Drift, Jitter, and Misfire

### 7.1 Drift

Drift adalah pergeseran waktu aktual dari jadwal ideal.

Contoh fixed-delay:

```text
Ideal expectation:
01:00
01:05
01:10

Actual:
01:00 start
01:04 end
01:09 next start
01:13 end
01:18 next start
```

Drift bukan selalu buruk. Untuk maintenance job, drift sering lebih baik daripada overload.

Yang penting adalah tahu:

- apakah jadwal bisnis butuh waktu presisi?
- apakah task boleh telat?
- apakah task boleh skip?
- apakah task harus mengejar semua missed run?
- apakah task harus memproses berdasarkan “window waktu” daripada “tick”?

---

### 7.2 Jitter

Jitter adalah variasi kecil yang sengaja atau tidak sengaja terjadi pada waktu start.

Tanpa jitter, banyak node/service bisa memulai job pada detik yang sama:

```text
01:00:00 all services refresh token
01:00:00 all services call external API
01:00:00 all services clean database
```

Ini menciptakan thundering herd.

Solusi:

```java
long baseDelaySeconds = 60;
long jitterSeconds = ThreadLocalRandom.current().nextLong(0, 30);

scheduler.schedule(
    this::refresh,
    baseDelaySeconds + jitterSeconds,
    TimeUnit.SECONDS
);
```

Jitter berguna untuk:

- cache refresh;
- token refresh;
- polling external API;
- background retry;
- scheduled sync di banyak node;
- mengurangi spike.

---

### 7.3 Misfire

Misfire adalah kondisi ketika jadwal seharusnya berjalan, tetapi tidak berjalan tepat waktu karena:

- aplikasi down;
- node restart;
- executor penuh;
- task sebelumnya terlalu lama;
- server paused;
- deployment;
- GC pause;
- database unavailable;
- lock tidak tersedia.

`ManagedScheduledExecutorService` bukan scheduler enterprise dengan persistent misfire policy seperti Quartz. Jika aplikasi down pada pukul 01:00, periodic in-memory scheduler biasanya tidak otomatis tahu “run 01:00 terlewat dan harus dikejar” setelah aplikasi naik lagi.

Untuk workload yang harus mengejar missed schedule, gunakan desain berbasis durable state:

```text
scheduled tick:
    find all business periods/windows that are due and not completed
    create/process durable job records
```

Bukan:

```text
scheduled tick:
    assume this tick is the business event
```

Perbedaan penting:

```text
Bad:
    "At 01:00 run reconciliation."

Better:
    "Periodically check reconciliation_window where status = DUE and process all due windows idempotently."
```

---

## 8. Time-Based Workload Design Patterns

### 8.1 Pattern: Lightweight Periodic Task

Cocok untuk task kecil dan tidak kritikal.

```java
@ApplicationScoped
public class MetricsSampler {

    @Resource
    ManagedScheduledExecutorService scheduler;

    public void start() {
        scheduler.scheduleAtFixedRate(
            this::sampleSafely,
            10,
            10,
            TimeUnit.SECONDS
        );
    }

    private void sampleSafely() {
        try {
            sample();
        } catch (Exception e) {
            logError("Sampling failed", e);
        }
    }

    private void sample() {
        // collect lightweight metrics
    }

    private void logError(String message, Exception e) {
        e.printStackTrace();
    }
}
```

Invariants:

- task cepat;
- error tidak membunuh periodic chain;
- tidak ada transaksi panjang;
- tidak ada external side effect besar;
- tidak perlu restartability.

---

### 8.2 Pattern: Poller with Bounded Work

Cocok untuk mengambil sejumlah kecil pending work.

```java
@ApplicationScoped
public class PendingEmailPoller {

    @Resource
    ManagedScheduledExecutorService scheduler;

    private final AtomicBoolean running = new AtomicBoolean(false);

    public void start() {
        scheduler.scheduleWithFixedDelay(
            this::pollSafely,
            30,
            60,
            TimeUnit.SECONDS
        );
    }

    private void pollSafely() {
        if (!running.compareAndSet(false, true)) {
            return;
        }

        try {
            List<Long> ids = findPendingEmailIds(100);
            for (Long id : ids) {
                processOneEmail(id);
            }
        } catch (Exception ex) {
            logError("Email poll failed", ex);
        } finally {
            running.set(false);
        }
    }

    private List<Long> findPendingEmailIds(int limit) {
        return List.of();
    }

    private void processOneEmail(Long id) {
        // each item should have own transaction/idempotency
    }

    private void logError(String message, Exception ex) {
        ex.printStackTrace();
    }
}
```

Invariants:

- bounded item count;
- no unbounded queue;
- setiap item idempotent;
- fixed-delay untuk natural backpressure;
- tidak assume semua pending work selesai dalam satu tick.

---

### 8.3 Pattern: Scheduler as Trigger, Durable Job Table as Source of Truth

Ini lebih mature untuk production.

```text
scheduler every 1 minute:
    create or find due job request
    mark one as RUNNING with DB lock
    process bounded slice
    update job status
```

Schema konseptual:

```sql
CREATE TABLE job_request (
    id              BIGINT PRIMARY KEY,
    job_type        VARCHAR(100) NOT NULL,
    business_key    VARCHAR(200) NOT NULL,
    status          VARCHAR(30) NOT NULL,
    requested_by    VARCHAR(100),
    scheduled_at    TIMESTAMP NOT NULL,
    started_at      TIMESTAMP,
    finished_at     TIMESTAMP,
    attempt_count   INTEGER NOT NULL,
    last_error      CLOB,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL,
    UNIQUE(job_type, business_key)
);
```

Keuntungan:

- durable;
- restartable;
- observable;
- bisa di-query operator;
- bisa punya audit trail;
- bisa deduplicate;
- bisa retry berdasarkan state;
- bisa dipindah ke Jakarta Batch nanti.

---

### 8.4 Pattern: Scheduled Trigger → Message Queue

```text
scheduler tick
    -> select due work
    -> publish message
        -> consumers process with backpressure
```

Cocok jika:

- work item banyak;
- processing paralel;
- ada retry queue/DLQ;
- consumer bisa diskalakan;
- scheduler hanya producer ringan.

Tapi perlu hati-hati:

- jangan publish duplicate message tanpa idempotency;
- jangan publish lebih cepat dari kapasitas consumer;
- pastikan message production juga bounded;
- observability end-to-end harus ada.

---

### 8.5 Pattern: Scheduled Trigger → Jakarta Batch

Untuk job besar:

```text
scheduler:
    if due and no active execution:
        JobOperator.start("nightly-reconciliation", params)
```

Scheduled executor hanya menjadi trigger. Jakarta Batch menangani:

- job execution;
- step;
- chunk;
- checkpoint;
- restart;
- listener;
- status;
- partitioning.

Ini cocok untuk:

- nightly processing;
- reconciliation;
- report generation;
- file import/export;
- large database sweep;
- multi-step process.

---

## 9. Startup and Lifecycle Concerns

### 9.1 Jangan Menjadwalkan Berkali-kali

Bug umum:

```java
public void someRequestHandler() {
    scheduler.scheduleAtFixedRate(...);
}
```

Setiap request membuat schedule baru.

Akibatnya:

```text
request #1 -> scheduler A
request #2 -> scheduler B
request #3 -> scheduler C
...
```

Gunakan startup lifecycle hook yang jelas, misalnya CDI observer atau singleton initialization sesuai platform.

Contoh konseptual CDI:

```java
@ApplicationScoped
public class SchedulerBootstrap {

    @Resource
    ManagedScheduledExecutorService scheduler;

    private volatile ScheduledFuture<?> future;

    public void start() {
        if (future != null) {
            return;
        }

        future = scheduler.scheduleWithFixedDelay(
            this::runSafely,
            1,
            5,
            TimeUnit.MINUTES
        );
    }

    public void stop() {
        ScheduledFuture<?> current = future;
        if (current != null) {
            current.cancel(true);
        }
    }

    private void runSafely() {
        // task
    }
}
```

Implementasi lifecycle startup/shutdown berbeda antar runtime dan framework. Yang penting secara desain:

- schedule dibuat sekali per application instance;
- reference ke `ScheduledFuture` disimpan;
- ada cancellation saat shutdown;
- task mendukung cooperative cancellation.

---

### 9.2 Redeploy Safety

Saat redeploy:

```text
old application classloader should die
old tasks should stop
new application starts new tasks
```

Jika task lama masih hidup, maka:

- classloader lama tidak bisa GC;
- koneksi/resource bisa bocor;
- old code dan new code berjalan bersamaan;
- double execution;
- bug sulit didiagnosis.

Managed scheduler membantu karena container punya kendali lifecycle. Tetapi aplikasi tetap harus:

- tidak menyimpan scheduler/future di static global;
- tidak membuat unmanaged executor;
- tidak menjalankan infinite loop tanpa interrupt check;
- tidak swallow interruption;
- tidak menahan reference ke old CDI/request object;
- menutup resource di finally.

---

### 9.3 Handling `InterruptedException`

Contoh buruk:

```java
try {
    Thread.sleep(10_000);
} catch (InterruptedException e) {
    // ignore
}
```

Ini buruk karena shutdown/cancellation kehilangan sinyal.

Contoh lebih baik:

```java
try {
    Thread.sleep(10_000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

Untuk long loop:

```java
while (!Thread.currentThread().isInterrupted()) {
    processSmallUnit();
}
```

Tetapi jangan hanya mengandalkan interrupt. DB call, HTTP call, atau external library bisa tidak responsif terhadap interrupt. Karena itu perlu:

- query timeout;
- socket timeout;
- transaction timeout;
- per-item timeout;
- cancellation flag;
- bounded work unit.

---

## 10. Exception Handling in Periodic Tasks

Scheduled task harus menangkap exception di boundary paling luar.

Contoh buruk:

```java
scheduler.scheduleWithFixedDelay(
    this::poll,
    0,
    1,
    TimeUnit.MINUTES
);
```

Jika `poll()` throw unchecked exception, periodic execution bisa berhenti tergantung executor semantics.

Contoh lebih aman:

```java
scheduler.scheduleWithFixedDelay(
    this::pollSafely,
    0,
    1,
    TimeUnit.MINUTES
);

private void pollSafely() {
    try {
        poll();
    } catch (Throwable t) {
        logError("Scheduled poll failed", t);

        if (t instanceof Error) {
            // hati-hati: tidak selalu aman untuk swallow Error.
            // Untuk Error fatal, bisa lebih baik fail fast / alert.
        }
    }
}
```

Prinsip:

- jangan biarkan exception biasa mematikan scheduler diam-diam;
- log dengan correlation/run id;
- increment failure metric;
- simpan last error jika operasional penting;
- alert jika consecutive failure melewati threshold;
- klasifikasikan error:
  - transient,
  - permanent,
  - configuration,
  - data poison,
  - dependency outage.

---

## 11. Transaction Design

### 11.1 Jangan Satu Transaksi Untuk Seluruh Periodic Run Besar

Contoh buruk:

```java
@Transactional
public void processAllPending() {
    List<Item> items = repository.findAllPending();

    for (Item item : items) {
        process(item);
    }
}
```

Masalah:

- transaksi lama;
- lock lama;
- rollback besar;
- undo/redo besar;
- connection held too long;
- sulit retry sebagian;
- timeout;
- deadlock.

Lebih baik:

```text
scheduler run:
    find IDs only, bounded
    for each ID:
        process one item in its own transaction
```

Atau:

```text
scheduler trigger:
    start Jakarta Batch
    chunk transaction per N records
```

---

### 11.2 Per-Item Transaction

Konsep:

```java
private void processBatchSlice() {
    List<Long> ids = findPendingIds(100);

    for (Long id : ids) {
        try {
            processOneInNewTransaction(id);
        } catch (Exception ex) {
            markFailedOrRetry(id, ex);
        }
    }
}
```

Prinsip:

- query pending IDs ringan;
- lock item secara eksplisit;
- update status atomik;
- commit cepat;
- idempotency key;
- retry count;
- poison handling.

---

### 11.3 Locking Pending Work

Contoh status model:

```text
PENDING -> RUNNING -> COMPLETED
                 \-> FAILED_RETRYABLE -> PENDING
                 \-> FAILED_FINAL
```

Saat mengambil work:

```sql
UPDATE work_item
SET status = 'RUNNING',
    locked_by = ?,
    locked_until = ?,
    attempt_count = attempt_count + 1
WHERE id = ?
  AND status IN ('PENDING', 'FAILED_RETRYABLE')
  AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP);
```

Atau gunakan `SELECT FOR UPDATE SKIP LOCKED` jika database mendukung.

Invariants:

- dua node tidak memproses item sama bersamaan;
- lock punya TTL;
- item bisa dipulihkan jika node mati;
- completion update harus idempotent.

---

## 12. Security and Audit Model

Scheduled task sering tidak punya user aktif.

Pertanyaan penting:

> “Task ini berjalan atas nama siapa?”

Pilihan model:

### 12.1 System-Initiated

Contoh:

```text
initiatedBy = SYSTEM
reason = SCHEDULED_CASE_ESCALATION
```

Cocok untuk:

- nightly cleanup;
- auto escalation;
- SLA calculation;
- cache refresh;
- expiry.

Audit harus menyimpan:

- scheduler name;
- node;
- run id;
- policy/rule version;
- business window;
- changed records;
- reason.

### 12.2 User-Requested, System-Executed

Contoh:

User klik “Generate report”. Report berjalan async 10 menit kemudian.

Audit:

```text
requestedBy = user123
executedBy = SYSTEM_WORKER
effectiveAuthority = REPORT_GENERATION_SERVICE
requestId = ...
```

Jangan hanya memakai “current user” dari thread, karena saat scheduled task berjalan user mungkin sudah logout.

### 12.3 Approval-Based

Untuk regulatory workload:

```text
requestedBy = officer
approvedBy = supervisor
executedBy = system
policyVersion = v17
inputManifest = hash(...)
```

Ini lebih defensible daripada sekadar log teknis.

---

## 13. Observability

### 13.1 Minimum Metrics

Setiap scheduled workload penting harus punya metric:

```text
scheduler_runs_total{name}
scheduler_run_duration_seconds{name}
scheduler_run_failures_total{name, error_type}
scheduler_run_skipped_total{name, reason}
scheduler_run_active{name}
scheduler_last_success_timestamp{name}
scheduler_last_failure_timestamp{name}
scheduler_consecutive_failures{name}
scheduler_lock_acquire_failed_total{name}
scheduler_items_processed_total{name}
scheduler_items_failed_total{name}
```

### 13.2 Minimum Logs

Setiap run harus punya run id:

```text
runId = schedulerName + timestamp + nodeId
```

Log:

```text
START scheduler=case-escalation runId=... window=...
LOCK_ACQUIRED scheduler=case-escalation runId=...
PROCESS_SUMMARY runId=... processed=100 success=97 failed=3 skipped=0 durationMs=...
END status=SUCCESS
```

Untuk failure:

```text
FAILED scheduler=case-escalation runId=... errorType=DATABASE_TIMEOUT consecutiveFailures=4
```

### 13.3 Dashboard Questions

Dashboard scheduler harus bisa menjawab:

- scheduler mana yang aktif?
- kapan terakhir sukses?
- kapan terakhir gagal?
- berapa lama durasi normal?
- apakah durasi meningkat?
- apakah run overlap/skipped?
- apakah lock sering gagal?
- apakah item pending menumpuk?
- apakah retry naik?
- node mana yang menjalankan?
- apakah scheduler mati diam-diam?

---

## 14. Backpressure and Capacity Control

### 14.1 Bounded Per Tick

Buruk:

```java
List<Item> all = findAllPending();
for (Item item : all) {
    process(item);
}
```

Baik:

```java
List<Item> slice = findPending(100);
for (Item item : slice) {
    process(item);
}
```

Jika backlog besar, scheduler akan memproses bertahap.

### 14.2 Deadline-Aware Run

```java
Instant deadline = Instant.now().plusSeconds(50);

while (Instant.now().isBefore(deadline)) {
    Optional<Long> id = claimOne();
    if (id.isEmpty()) {
        break;
    }

    process(id.get());
}
```

Ini mencegah run mengambil waktu tak terbatas.

### 14.3 Downstream-Aware Rate Limit

Untuk external API:

```text
max 250 requests/minute
scheduler tick every 1 minute
process at most 200 requests
jitter start by 0-15 seconds
retry 429 with exponential backoff
```

Scheduled task harus menghormati downstream limit, bukan hanya internal CPU.

---

## 15. Cluster Design Options

### 15.1 Option A: Run Scheduler on Every Node + DB Lock

```text
Node A scheduler tick -> tries lock -> wins
Node B scheduler tick -> tries lock -> skip
Node C scheduler tick -> tries lock -> skip
```

Pros:

- simple deployment;
- high availability;
- no special infrastructure.

Cons:

- lock correctness critical;
- clock/TTL issue;
- duplicate possible if lock expires early;
- requires idempotency.

### 15.2 Option B: Single Scheduler Node

Run scheduler only on one node/pod.

Pros:

- simple mental model;
- no duplicate trigger.

Cons:

- failover problem;
- deployment-specific;
- not always portable;
- if node down, schedule stops.

### 15.3 Option C: Kubernetes CronJob

```text
Kubernetes CronJob -> starts container/job -> calls internal API or runs worker
```

Pros:

- schedule externalized;
- lifecycle visible;
- good for operational jobs;
- no scheduler in app runtime.

Cons:

- needs Kubernetes dependency;
- authentication to app/internal services;
- concurrency policy must be configured;
- job code packaging/deployment complexity;
- less portable Jakarta EE.

### 15.4 Option D: External Scheduler

Examples:

- enterprise scheduler;
- cloud scheduler;
- Airflow;
- Control-M;
- Rundeck;
- Jenkins;
- custom ops scheduler.

Pros:

- operator friendly;
- centralized calendar;
- retry/misfire policies;
- approvals.

Cons:

- integration overhead;
- external dependency;
- security surface;
- less application-local context.

### 15.5 Option E: Jakarta Batch Control Plane

Scheduler just triggers durable batch execution.

Pros:

- restartability;
- job repository;
- chunk/partition;
- status model;
- operational controls.

Cons:

- heavier;
- more design upfront;
- not needed for tiny tasks.

---

## 16. Choosing the Right Scheduling Primitive

### 16.1 Decision Table

| Need | Recommended Primitive |
|---|---|
| Run small task after delay | `ManagedScheduledExecutorService.schedule` |
| Lightweight periodic task | `scheduleAtFixedRate` or `scheduleWithFixedDelay` |
| Poll pending rows safely | `scheduleWithFixedDelay` + bounded DB claim |
| Cluster-safe periodic work | scheduler + DB lock/job table |
| Large restartable job | Jakarta Batch |
| File import/export | Jakarta Batch |
| Multi-step business process | Jakarta Batch or workflow engine |
| Exact calendar/misfire policy | external scheduler/Quartz-like scheduler |
| Cloud-native isolated job | Kubernetes CronJob/Job |
| High-volume event processing | message queue/stream processor |
| Human approval and compensation | workflow engine/case management process |

---

## 17. Common Anti-Patterns

### 17.1 `while(true)` Worker

```java
while (true) {
    doWork();
    Thread.sleep(60000);
}
```

Masalah:

- lifecycle tidak jelas;
- shutdown buruk;
- redeploy leak;
- tidak ada Future;
- sulit cancel;
- tidak managed.

### 17.2 Unmanaged Scheduled Executor

```java
private final ScheduledExecutorService scheduler =
    Executors.newScheduledThreadPool(4);
```

Masalah di Jakarta EE:

- thread tidak dikelola container;
- context hilang;
- classloader leak;
- shutdown tidak otomatis;
- monitoring sulit;
- resource governance lemah.

### 17.3 Scheduling From Request

```java
@Path("/start")
public void start() {
    scheduler.scheduleAtFixedRate(...);
}
```

Masalah:

- duplicate schedule;
- user dapat membuat banyak background job;
- security/audit tidak jelas;
- lifecycle tidak jelas.

### 17.4 Unbounded Work Per Tick

```java
for (Item item : findAllPending()) {
    process(item);
}
```

Masalah:

- tick bisa berjalan berjam-jam;
- fixed-rate catch-up;
- DB pressure;
- tidak ada backpressure.

### 17.5 No Exception Boundary

```java
scheduler.scheduleWithFixedDelay(this::work, 0, 1, TimeUnit.MINUTES);
```

Jika exception mematikan chain, scheduler bisa berhenti diam-diam.

### 17.6 Cluster Blind Scheduler

```text
every node runs same cleanup job
```

Masalah:

- duplicate work;
- row conflict;
- external side effect dobel;
- audit ambiguity.

### 17.7 Business Time = Tick Time

Buruk:

```text
If tick runs at 01:00, process 01:00 job.
If app down at 01:00, job is lost.
```

Lebih baik:

```text
Find all due business windows not completed.
Process idempotently.
```

---

## 18. Production-Grade Design Example

### Scenario

Regulatory system perlu menjalankan escalation evaluation setiap 10 menit.

Rules:

- case yang melewati SLA harus dievaluasi;
- perubahan status harus audited;
- job tidak boleh berjalan ganda;
- jika node restart, proses harus lanjut;
- jika satu case gagal, case lain tetap diproses;
- operator harus tahu jumlah processed/failed;
- tidak boleh mengunci semua case terlalu lama.

### Design

```text
ManagedScheduledExecutorService
    every 10 minutes fixed-delay
        acquire cluster lock "case-escalation-evaluator"
        create run record
        while within 8-minute budget:
            claim up to 100 due cases
            for each case:
                process in new transaction
                write audit
                write outcome
        release lock
        write run summary
```

### Tables

```sql
CREATE TABLE scheduler_run (
    id                  BIGINT PRIMARY KEY,
    scheduler_name      VARCHAR(100) NOT NULL,
    run_id              VARCHAR(100) NOT NULL UNIQUE,
    node_id             VARCHAR(100),
    status              VARCHAR(30) NOT NULL,
    started_at          TIMESTAMP NOT NULL,
    finished_at         TIMESTAMP,
    processed_count     INTEGER DEFAULT 0,
    success_count       INTEGER DEFAULT 0,
    failed_count        INTEGER DEFAULT 0,
    skipped_count       INTEGER DEFAULT 0,
    error_summary       CLOB
);

CREATE TABLE case_escalation_work (
    id                  BIGINT PRIMARY KEY,
    case_id             BIGINT NOT NULL,
    business_key        VARCHAR(200) NOT NULL,
    status              VARCHAR(30) NOT NULL,
    locked_by           VARCHAR(100),
    locked_until        TIMESTAMP,
    attempt_count       INTEGER DEFAULT 0,
    last_error          CLOB,
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    UNIQUE(business_key)
);
```

### Pseudo-Code

```java
@ApplicationScoped
public class CaseEscalationScheduler {

    @Resource
    ManagedScheduledExecutorService scheduler;

    private ScheduledFuture<?> future;

    public void start() {
        if (future != null) {
            return;
        }

        future = scheduler.scheduleWithFixedDelay(
            this::runSafely,
            1,
            10,
            TimeUnit.MINUTES
        );
    }

    public void stop() {
        if (future != null) {
            future.cancel(true);
        }
    }

    private void runSafely() {
        String runId = newRunId("case-escalation");

        try {
            if (!tryAcquireClusterLock("case-escalation", Duration.ofMinutes(9))) {
                recordSkipped(runId, "LOCK_NOT_ACQUIRED");
                return;
            }

            recordStarted(runId);

            Instant deadline = Instant.now().plus(Duration.ofMinutes(8));

            while (Instant.now().isBefore(deadline)
                    && !Thread.currentThread().isInterrupted()) {

                List<Long> caseIds = claimDueCases(100, Duration.ofMinutes(10));

                if (caseIds.isEmpty()) {
                    break;
                }

                for (Long caseId : caseIds) {
                    if (Thread.currentThread().isInterrupted()) {
                        break;
                    }

                    processOneCaseSafely(runId, caseId);
                }
            }

            recordCompleted(runId);

        } catch (Exception ex) {
            recordFailed(runId, ex);
        } finally {
            releaseClusterLock("case-escalation");
        }
    }

    private void processOneCaseSafely(String runId, Long caseId) {
        try {
            processOneCaseInNewTransaction(runId, caseId);
        } catch (Exception ex) {
            markCaseFailedOrRetry(caseId, ex);
        }
    }

    // Implementation-specific details omitted intentionally.
    private boolean tryAcquireClusterLock(String name, Duration ttl) { return true; }
    private void releaseClusterLock(String name) {}
    private void recordSkipped(String runId, String reason) {}
    private void recordStarted(String runId) {}
    private void recordCompleted(String runId) {}
    private void recordFailed(String runId, Exception ex) {}
    private List<Long> claimDueCases(int limit, Duration lockTtl) { return List.of(); }
    private void processOneCaseInNewTransaction(String runId, Long caseId) {}
    private void markCaseFailedOrRetry(Long caseId, Exception ex) {}
    private String newRunId(String name) { return name + "-" + System.currentTimeMillis(); }
}
```

### Key Invariants

- scheduler tick is not the source of truth;
- DB state is the source of truth;
- no unbounded work per tick;
- one active cluster execution;
- per-case transaction;
- per-case audit;
- run summary;
- cancellation-aware;
- idempotent case transition;
- failure isolated per item.

---

## 19. Testing Strategy

### 19.1 Unit Tests

Test logic without real scheduler:

- `runSafely()` when lock unavailable;
- exception does not escape;
- per-item failure does not stop all;
- deadline stops loop;
- interruption stops loop;
- zero pending items exits cleanly;
- lock release always called.

### 19.2 Integration Tests

- schedule actually fires;
- context injection works;
- transaction works inside task;
- failure is logged/recorded;
- cancellation stops future;
- DB lock prevents duplicate work.

### 19.3 Cluster Simulation Tests

Even without full cluster, simulate:

- two scheduler instances call `runSafely()` concurrently;
- only one acquires DB lock;
- duplicate claim prevented;
- lock TTL recovery works;
- idempotency prevents double side effect.

### 19.4 Failure Injection

Inject:

- DB timeout;
- external API 429;
- transaction rollback;
- node killed mid-run;
- lock expiry while running;
- slow downstream;
- stuck item;
- invalid business data;
- duplicate schedule initialization.

---

## 20. Operational Runbook

For each scheduled workload, document:

```text
Name:
Purpose:
Frequency:
Fixed-rate or fixed-delay:
Owner:
Business criticality:
Expected duration:
Maximum duration:
Concurrency limit:
Cluster behavior:
Lock name:
Can overlap:
Can skip:
Can retry:
Can replay:
Idempotency key:
Downstream dependencies:
DB tables touched:
Metrics:
Logs:
Alerts:
Manual stop procedure:
Manual restart procedure:
Backfill procedure:
Failure escalation:
```

Example:

```text
Name: case-escalation-evaluator
Frequency: every 10 minutes fixed-delay
Can overlap: no
Cluster behavior: DB lock scheduler_lock.case-escalation
Expected duration: 1-3 minutes
Max duration: 8 minutes
Idempotency key: caseId + ruleVersion + escalationLevel
Failure handling: per-case retry up to 3, then FAILED_FINAL
Audit: scheduler_run + audit_trail
Alert: no success for 30 minutes or consecutive failures >= 3
```

---

## 21. Java 8–25 Perspective

### Java 8

- `ScheduledExecutorService` already available.
- Jakarta/Java EE managed concurrency relies on Java SE executor semantics.
- No virtual threads.
- More caution with platform thread pool sizing.

### Java 11/17

- Better runtime/container baseline.
- Jakarta EE 10/11 era increasingly standardizes modern APIs.
- Still platform-thread oriented in most deployments.

### Java 21

- Virtual threads finalized.
- New mental model for high-concurrency blocking workloads.
- But scheduled workload still needs:
  - managed lifecycle,
  - context propagation,
  - cluster coordination,
  - idempotency,
  - observability.

### Java 25

- Java continues evolving toward structured concurrency and scoped values.
- These features influence future design of request-scoped and task-scoped execution.
- But Jakarta EE scheduled workloads still require container semantics and production governance.

The key lesson:

> New Java concurrency primitives reduce cost of concurrency. They do not remove the need for workload correctness.

---

## 22. Checklist

Before using `ManagedScheduledExecutorService`, answer:

### Schedule Semantics

- [ ] Is this one-shot, fixed-rate, or fixed-delay?
- [ ] Can the run drift?
- [ ] Can a missed run be skipped?
- [ ] Must missed business periods be backfilled?
- [ ] Is tick time different from business window time?

### Workload Size

- [ ] Is each run bounded?
- [ ] Is there a maximum item count?
- [ ] Is there a maximum duration?
- [ ] Does the task stop on interrupt?
- [ ] Are DB/API timeouts configured?

### Overlap

- [ ] Can two runs overlap safely?
- [ ] Is there an in-memory guard?
- [ ] Is there a cluster guard?
- [ ] Is the work idempotent?

### Transactions

- [ ] Is transaction scope short?
- [ ] Is each item processed independently?
- [ ] Is rollback behavior understood?
- [ ] Are locks bounded?

### Cluster

- [ ] Does every node run scheduler?
- [ ] Is there leader election or DB lock?
- [ ] What happens when winner node dies?
- [ ] What happens during rolling deploy?

### Observability

- [ ] Is there a run id?
- [ ] Are duration/failure/skipped metrics emitted?
- [ ] Is last success visible?
- [ ] Is consecutive failure alerted?
- [ ] Is run summary stored?

### Security/Audit

- [ ] Is initiatedBy/executedBy clear?
- [ ] Are business changes audited?
- [ ] Are job parameters safe?
- [ ] Is operator action tracked?

### Suitability

- [ ] Is scheduled executor enough?
- [ ] Would Jakarta Batch be better?
- [ ] Would messaging be better?
- [ ] Would Kubernetes CronJob/external scheduler be better?
- [ ] Would workflow engine be better?

---

## 23. Ringkasan

`ManagedScheduledExecutorService` adalah alat penting untuk menjalankan workload berbasis waktu di Jakarta EE tanpa keluar dari kendali container.

Tetapi skill sebenarnya bukan hanya menulis:

```java
scheduler.scheduleWithFixedDelay(...)
```

Skill sebenarnya adalah memahami:

- apa arti schedule;
- apa arti work;
- apakah task boleh overlap;
- apa yang terjadi jika task telat;
- apa yang terjadi jika aplikasi down;
- apa yang terjadi jika ada 4 node;
- apakah work idempotent;
- apakah transaction boundary aman;
- apakah operator bisa melihat status;
- apakah auditor bisa memahami perubahan;
- apakah workload ini seharusnya Batch, Queue, CronJob, atau Workflow.

Untuk production-grade enterprise engineering, scheduler harus dilihat sebagai **trigger**, bukan sumber kebenaran. Sumber kebenaran harus berada pada durable state: database, job repository, message queue, atau workflow state.

---

## 24. Latihan / Thought Experiment

### Exercise 1

Kamu punya job:

```text
Every 5 minutes, find all submitted applications older than 7 days and send reminder email.
```

Pertanyaan:

1. Fixed-rate atau fixed-delay?
2. Apakah perlu DB lock?
3. Apa idempotency key email reminder?
4. Bagaimana mencegah reminder terkirim dua kali?
5. Apa yang terjadi jika aplikasi down selama 1 jam?
6. Apakah scheduled executor cukup atau perlu Jakarta Batch?

### Exercise 2

Kamu punya job:

```text
Every night 01:00, recalculate SLA ageing for 2 million cases.
```

Pertanyaan:

1. Apakah `ManagedScheduledExecutorService` cukup?
2. Bagaimana checkpoint?
3. Bagaimana restart jika node mati di tengah?
4. Apakah partitioning perlu?
5. Apakah sebaiknya Jakarta Batch?
6. Bagaimana audit summary?

### Exercise 3

Kamu punya cluster 6 node. Semua node menjalankan scheduler yang sama.

Pertanyaan:

1. Apa risiko utama?
2. Apakah `AtomicBoolean` cukup?
3. Bagaimana desain lock table?
4. Berapa TTL lock?
5. Apa yang terjadi jika job lebih lama dari TTL?
6. Bagaimana idempotency menyelamatkan sistem?

---

## 25. Referensi

- Jakarta Concurrency 3.1 Specification — https://jakarta.ee/specifications/concurrency/3.1/
- Jakarta Concurrency API — `ManagedScheduledExecutorService` — https://jakarta.ee/specifications/concurrency/
- Jakarta EE 11 Release — https://jakarta.ee/release/11/
- Java SE `ScheduledExecutorService` API — https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ScheduledExecutorService.html
- Java SE 25 `ScheduledExecutorService` API — https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ScheduledExecutorService.html
- OpenJDK JEP 444: Virtual Threads — https://openjdk.org/jeps/444
- OpenJDK JEP 505: Structured Concurrency — https://openjdk.org/jeps/505
- OpenJDK JEP 506: Scoped Values — https://openjdk.org/jeps/506

---

## 26. Status Seri

Part ini adalah **Part 4 dari 35**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 5 — ManagedThreadFactory and Thread Creation Without Losing Container Semantics
File: 05-managed-thread-factory-and-thread-ownership.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 3 — ManagedExecutorService Deep Dive](./03-managed-executor-service-deep-dive.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 5 — ManagedThreadFactory and Thread Creation Without Losing Container Semantics](./05-managed-thread-factory-and-thread-ownership.md)

</div>
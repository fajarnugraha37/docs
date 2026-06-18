# Part 0 — Orientation: Enterprise Concurrency & Batch Mental Model

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `00-orientation-enterprise-concurrency-and-batch-mental-model.md`  
**Scope:** Java 8–25, Java EE/Jakarta EE, `javax.*` to `jakarta.*`, Jakarta Concurrency, Jakarta Batch, enterprise workload orchestration  
**Baseline stable:** Jakarta EE 11, Jakarta Concurrency 3.1, Jakarta Batch 2.1  
**Goal:** membangun mental model sebelum masuk API detail, supaya concurrency dan batch tidak dipahami sebagai sekadar “jalanin task di background”, tetapi sebagai desain workload yang aman, observable, restartable, defensible, dan production-grade.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan bisa menjawab pertanyaan-pertanyaan berikut dengan mental model yang matang:

1. Apa bedanya concurrency Java SE biasa dengan concurrency di dalam Jakarta EE container?
2. Kenapa `new Thread()`, `Executors.newFixedThreadPool()`, `Timer`, atau `ForkJoinPool.commonPool()` sering menjadi keputusan buruk di application server?
3. Apa perbedaan antara:
   - request thread,
   - managed thread,
   - managed executor task,
   - scheduled task,
   - message-driven processing,
   - batch job,
   - external orchestrator,
   - virtual thread?
4. Kapan sebuah workload cukup memakai `ManagedExecutorService`, dan kapan harus naik menjadi Jakarta Batch?
5. Apa arti “unit of work” dibanding “unit of execution”?
6. Kenapa restartability, auditability, idempotency, dan operational control adalah bagian inti dari batch dan background workload?
7. Bagaimana Java 8–25 mengubah cara kita berpikir tentang concurrency, terutama dengan virtual threads, structured concurrency, dan scoped values?
8. Apa boundary utama yang harus dijaga ketika mengeksekusi pekerjaan secara asynchronous?
9. Bagaimana memilih execution model yang benar untuk sistem enterprise/regulatory/case-management?

Bagian ini belum fokus pada syntax API. Fokusnya adalah fondasi berpikir. API tanpa mental model mudah membuat sistem terlihat berjalan di DEV tetapi rusak di UAT/PROD ketika ada load, redeploy, timeout, failover, cluster duplicate execution, atau audit investigation.

---

## 2. Problem yang Sebenarnya Diselesaikan

Ketika developer mendengar “concurrency”, biasanya yang terbayang adalah:

```java
executor.submit(() -> doSomething());
```

Atau:

```java
CompletableFuture.supplyAsync(() -> callExternalApi());
```

Di aplikasi kecil, ini tampak cukup. Tetapi di enterprise runtime, terutama Jakarta EE/Jakarta-compatible application server, pertanyaan sebenarnya bukan hanya:

> “Bagaimana menjalankan task secara paralel?”

Pertanyaan yang lebih benar adalah:

> “Bagaimana menjalankan workload tambahan tanpa merusak kontrak container, transaction, security, lifecycle, observability, capacity, restartability, dan auditability?”

Itulah perbedaan fundamental.

Concurrency di enterprise bukan hanya soal membuat lebih banyak thread. Concurrency adalah **pengelolaan kapasitas eksekusi**. Batch bukan hanya loop besar. Batch adalah **model eksekusi pekerjaan jangka menengah/panjang yang bisa dikontrol, dipantau, dihentikan, dilanjutkan, dan dipertanggungjawabkan**.

---

## 3. Rujukan Versi dan Landscape

### 3.1 Jakarta EE baseline

Jakarta EE 11 adalah baseline modern yang relevan untuk seri ini. Jakarta EE 11 mencakup Jakarta Concurrency 3.1 dan Jakarta Batch 2.1 dalam daftar spesifikasinya. Jakarta Concurrency menyediakan API untuk menggunakan concurrency dari application component tanpa mengorbankan container integrity, sedangkan Jakarta Batch menyediakan API Java plus XML-based Job Specification Language untuk menyusun batch job dari reusable Java artifacts dan menjalankan job dengan parameterisasi.  

Rujukan resmi:

- Jakarta EE 11 release page: https://jakarta.ee/release/11/
- Jakarta EE Platform 11 specification page: https://jakarta.ee/specifications/platform/11/
- Jakarta Concurrency 3.1: https://jakarta.ee/specifications/concurrency/3.1/
- Jakarta Batch 2.1: https://jakarta.ee/specifications/batch/2.1/

### 3.2 Namespace: `javax.*` vs `jakarta.*`

Secara historis, banyak aplikasi enterprise Java masih memakai namespace lama:

```java
javax.enterprise.concurrent.ManagedExecutorService
javax.batch.runtime.JobExecution
```

Pada Jakarta EE modern, namespace berpindah menjadi:

```java
jakarta.enterprise.concurrent.ManagedExecutorService
jakarta.batch.runtime.JobExecution
```

Perubahan namespace ini bukan sekadar rename import. Ia memengaruhi dependency, server compatibility, library compatibility, migration plan, dan testing strategy. Dalam seri ini, konsep akan dijelaskan agar berlaku untuk Java EE 7/8 dan Jakarta EE modern, tetapi contoh utama akan cenderung memakai namespace `jakarta.*`.

### 3.3 Java 8–25

Seri ini mencakup Java 8 hingga Java 25.

Secara garis besar:

| Java Version | Dampak terhadap seri ini |
|---|---|
| Java 8 | Baseline lama enterprise; `CompletableFuture`, Stream, banyak aplikasi Java EE 7/8 masih di sini |
| Java 9–11 | Modular JDK, Flow API, HTTP Client mulai muncul, long-term modernization path |
| Java 17 | Baseline LTS modern untuk banyak Jakarta EE 10/11 runtime |
| Java 21 | Virtual threads final; sangat relevan untuk managed concurrency modern |
| Java 22–24 | Perbaikan lanjutan Loom dan runtime behavior; perlu hati-hati dengan preview/incubator APIs |
| Java 25 | Relevan untuk perkembangan structured concurrency/scoped values, tetapi beberapa fitur masih preview atau evolving |

Virtual threads diperkenalkan final melalui JEP 444 di JDK 21. Structured concurrency masih preview dalam beberapa rilis dan di JDK 25 masih perlu diperlakukan sebagai fitur yang belum se-stabil API final. Scoped values berkembang sebagai model berbagi data immutable yang lebih cocok untuk banyak virtual thread dibanding `ThreadLocal` tradisional.

Rujukan resmi:

- JEP 444 Virtual Threads: https://openjdk.org/jeps/444
- JEP 505 Structured Concurrency, Fifth Preview: https://openjdk.org/jeps/505
- JEP 506 Scoped Values: https://openjdk.org/jeps/506

---

## 4. Mental Model Utama: Jangan Mulai dari Thread, Mulai dari Workload

Kesalahan umum dalam desain concurrency adalah langsung bertanya:

> “Pakai berapa thread?”

Pertanyaan itu terlalu rendah levelnya. Pertanyaan pertama seharusnya:

> “Workload ini sifatnya apa?”

Sebuah workload bisa memiliki karakter berbeda:

1. **Latency-sensitive**  
   Contoh: user klik tombol dan menunggu respons.

2. **Throughput-oriented**  
   Contoh: memproses 1 juta record pada malam hari.

3. **Durable**  
   Contoh: task tidak boleh hilang meskipun node restart.

4. **Best-effort**  
   Contoh: fire-and-forget telemetry non-kritis.

5. **Auditable**  
   Contoh: regulator perlu tahu siapa memulai job, kapan, input apa, hasil apa.

6. **Restartable**  
   Contoh: file import gagal di record ke-780.000 dan harus lanjut dari checkpoint.

7. **Idempotent**  
   Contoh: retry tidak boleh menghasilkan duplicate invoice/email/case transition.

8. **Cluster-sensitive**  
   Contoh: dalam 4 pod, job tidak boleh berjalan 4 kali.

9. **External-limit-sensitive**  
   Contoh: API downstream hanya mengizinkan 300 request/minute.

10. **Database-pressure-sensitive**  
    Contoh: batch update besar bisa membuat undo/redo, lock, connection pool exhaustion, dan replication lag.

Thread hanyalah salah satu mekanisme eksekusi. Yang harus dirancang adalah keseluruhan **execution model**.

---

## 5. Vocabulary: Istilah yang Harus Dipegang

### 5.1 Unit of work

**Unit of work** adalah pekerjaan logis yang ingin diselesaikan.

Contoh:

- generate bulk correspondence untuk 10.000 case,
- recalculate case ageing,
- sync external registry,
- import CSV enforcement records,
- send notification setelah case transition,
- validate 50 document attachments,
- call 3 downstream APIs untuk satu request.

Unit of work menjawab:

> “Pekerjaan bisnis/logis apa yang harus selesai?”

### 5.2 Unit of execution

**Unit of execution** adalah cara runtime menjalankan sebagian pekerjaan tersebut.

Contoh:

- satu request thread,
- satu managed executor task,
- satu virtual thread,
- satu batch step,
- satu chunk transaction,
- satu partition worker,
- satu message consumer invocation,
- satu Kubernetes Job pod.

Unit of execution menjawab:

> “Pekerjaan ini dijalankan oleh apa, kapan, dalam konteks apa, dan dengan boundary apa?”

### 5.3 Kenapa pembedaan ini penting?

Satu unit of work bisa terdiri dari banyak unit of execution.

Contoh: “recalculate ageing untuk semua active cases” sebagai unit of work dapat dipecah menjadi:

- batch job execution,
- step 1: query eligible case IDs,
- step 2: partition by case ID range,
- partition A/B/C/D berjalan paralel,
- setiap partition memproses chunk 500 records,
- setiap chunk memakai transaction sendiri,
- setiap failed record diklasifikasi retry/skip/fail,
- hasil akhir disimpan ke audit summary.

Jika kita hanya berpikir “jalankan thread”, kita kehilangan struktur ini.

---

## 6. Execution Model Taxonomy

Bagian ini adalah peta awal untuk memilih execution model.

### 6.1 Synchronous request thread

Gunakan request thread ketika:

- pekerjaan pendek,
- user memang menunggu hasil,
- side effect selesai dalam satu request,
- timeout dapat dikendalikan,
- tidak perlu durable restart,
- tidak memblokir terlalu lama.

Contoh:

```text
User -> REST endpoint -> service -> DB query -> response
```

Kelebihan:

- sederhana,
- mudah dipahami,
- transaction dan security context jelas,
- error langsung dikembalikan.

Kelemahan:

- tidak cocok untuk pekerjaan panjang,
- terikat HTTP timeout,
- membebani request thread pool,
- sulit untuk retry panjang,
- jika downstream lambat, user latency naik.

### 6.2 Servlet/JAX-RS async request

Gunakan async request ketika:

- request perlu menunggu operasi I/O non-trivial,
- ingin membebaskan container request thread tertentu,
- response tetap harus kembali ke HTTP request yang sama.

Tetapi async request bukan batch. Ia masih request-response model.

Cocok untuk:

- fan-out beberapa API lalu aggregate,
- long polling terbatas,
- non-blocking I/O flow.

Tidak cocok untuk:

- job 30 menit,
- import file besar,
- retry yang perlu survive restart,
- pekerjaan yang harus tetap lanjut setelah user disconnect.

### 6.3 Managed executor task

Gunakan `ManagedExecutorService` ketika:

- ingin offload pekerjaan pendek/menengah,
- pekerjaan tidak harus didefinisikan sebagai batch job penuh,
- perlu container-managed thread/context,
- perlu concurrency terbatas,
- perlu integrasi dengan `Future`/`CompletableFuture`,
- task masih relatif simple.

Contoh:

```text
REST request
  -> validate input
  -> submit managed async task
  -> return 202 Accepted + taskId
```

Atau:

```text
REST request
  -> run 3 independent calls in parallel with managed executor
  -> combine result
  -> return response
```

Managed executor cocok untuk async task, tetapi tidak otomatis memberikan:

- durable job repository,
- checkpoint,
- restart after crash,
- batch step graph,
- skip/retry semantics per item,
- partition model,
- operational batch control plane.

Jika butuh hal tersebut, pikirkan Jakarta Batch.

### 6.4 Managed scheduled executor

Gunakan `ManagedScheduledExecutorService` ketika:

- task berbasis waktu,
- cukup ringan,
- tidak butuh kompleksitas batch penuh,
- tidak butuh job graph/checkpoint detail,
- kamu sadar masalah cluster duplicate schedule.

Contoh:

- refresh cache setiap 10 menit,
- cleanup temporary token,
- poll small queue/table,
- emit heartbeat metrics.

Bahaya utama:

```text
4 pods running -> 4 scheduled tasks triggered -> duplicate execution
```

Untuk cluster, scheduled executor perlu coordination: DB lock, leader election, singleton deployment, atau external scheduler.

### 6.5 Messaging-driven execution

Gunakan messaging ketika:

- pekerjaan harus durable,
- producer dan consumer perlu decoupled,
- workload event-driven,
- retry/dead-letter queue cocok,
- ordering/partitioning bisa dikelola lewat broker.

Contoh:

```text
Case approved -> publish event -> notification consumer -> send email
```

Messaging bagus untuk event/work item flow. Tetapi messaging bukan pengganti batch job graph. Jika perlu checkpoint item reader/writer, job execution history, restart batch, partition plan, dan step transition, Jakarta Batch lebih tepat.

### 6.6 Jakarta Batch

Gunakan Jakarta Batch ketika:

- workload besar,
- proses berjalan lama,
- perlu status runtime,
- perlu stop/restart,
- perlu checkpoint,
- perlu chunk transaction,
- perlu skip/retry classification,
- perlu partitioning,
- perlu audit eksekusi,
- perlu operational control plane.

Contoh:

- nightly case ageing recalculation,
- bulk enforcement transition evaluation,
- external registry sync,
- import/export file besar,
- mass correspondence generation,
- data archival,
- reconciliation job.

Jakarta Batch bukan sekadar “loop besar”. Ia adalah model runtime untuk pekerjaan yang perlu dikelola sebagai **job**.

### 6.7 External orchestrator

Gunakan external orchestrator ketika:

- job lintas sistem,
- dependency graph kompleks,
- ada approval/manual intervention,
- perlu workflow visual/operational UI kuat,
- eksekusi multi-language/multi-platform,
- perlu scheduling dan retries lintas service.

Contoh:

- Airflow,
- Kubernetes CronJob/Job,
- Argo Workflows,
- Temporal,
- Camunda/Zeebe,
- Control-M,
- enterprise scheduler.

Jakarta Batch bisa menjadi salah satu worker dalam orchestrator yang lebih besar.

---

## 7. Request Thread vs Background Thread vs Batch Thread

### 7.1 Request thread

Request thread biasanya berasal dari container HTTP connector/thread pool. Ia menjalankan request lifecycle:

```text
HTTP request accepted
  -> filter chain
  -> security/auth
  -> CDI/JAX-RS/Servlet resource
  -> service layer
  -> persistence/transaction
  -> response
  -> cleanup request context
```

Karakteristik:

- latency-sensitive,
- request context valid,
- security caller jelas,
- transaction bisa jelas,
- timeout relatif pendek,
- user menunggu.

### 7.2 Background managed task

Managed task berjalan di executor yang disediakan container.

```text
request/thread/event
  -> submit task to ManagedExecutorService
  -> task runs later/on another managed thread
```

Karakteristik:

- context propagation tergantung konfigurasi/spec/server,
- transaction harus dirancang eksplisit,
- caller identity harus jelas,
- cancellation harus cooperative,
- error harus disimpan/dilaporkan,
- tidak boleh diasumsikan request context masih hidup.

### 7.3 Batch execution thread

Batch runtime mengatur job/step/chunk/partition.

```text
JobOperator.start(jobName, params)
  -> job execution created
  -> step execution
  -> chunk loop
  -> checkpoint
  -> status update
```

Karakteristik:

- runtime stateful,
- punya job repository,
- punya execution status,
- punya restart model,
- cocok untuk long-running workload,
- biasanya butuh operator visibility.

### 7.4 Virtual thread

Virtual thread adalah thread ringan yang dijadwalkan oleh JVM di atas platform/carrier threads. Virtual thread membantu model blocking code menjadi scalable untuk I/O-bound workloads.

Tetapi virtual thread tidak otomatis menyelesaikan:

- container lifecycle,
- security context,
- transaction context,
- CDI context,
- audit,
- durable restart,
- cluster coordination,
- rate limiting,
- idempotency,
- database capacity.

Mental model penting:

> Virtual thread mengubah biaya unit eksekusi; ia tidak menghapus kebutuhan desain workload.

---

## 8. Boundary yang Harus Dijaga

Dalam enterprise concurrency, boundary lebih penting daripada thread count.

### 8.1 Lifecycle boundary

Pertanyaan:

- Siapa yang membuat thread/task?
- Siapa yang menghentikan thread/task?
- Apa yang terjadi saat redeploy?
- Apa yang terjadi saat node shutdown?
- Apakah task bisa berjalan setelah application undeployed?

Unmanaged thread sering melanggar lifecycle boundary:

```java
new Thread(() -> while (true) poll()).start();
```

Masalah:

- thread tetap hidup setelah redeploy,
- classloader lama tidak bisa GC,
- koneksi/resource leak,
- shutdown lambat,
- task tidak terlihat oleh container.

### 8.2 Transaction boundary

Pertanyaan:

- Apakah task butuh transaction?
- Transaction dimulai di mana?
- Commit/rollback terjadi kapan?
- Apakah transaction boleh menyeberang async boundary?
- Apakah task idempotent jika retry setelah rollback?

Anti-pattern:

```text
Start transaction in request
  -> submit async task
  -> async task assumes same transaction still valid
```

Desain yang lebih aman:

```text
Request transaction:
  - validate request
  - persist job/task request
  - commit

Async task transaction:
  - load task by id
  - process one safe unit
  - commit/rollback independently
```

### 8.3 Security boundary

Pertanyaan:

- Task berjalan sebagai user atau system?
- Authorization dicek saat enqueue atau saat execution?
- Jika user logout, task masih boleh lanjut?
- Audit menampilkan siapa yang meminta, siapa yang menjalankan, dan atas dasar hak apa?

Model yang matang memisahkan:

```text
initiatedBy = user who requested
executedBy  = system/service identity actually running the job
authorizedBy = rule/approval/policy enabling execution
```

Ini sangat penting untuk sistem regulatory.

### 8.4 CDI/request context boundary

Request-scoped object tidak boleh dianggap valid setelah request selesai.

Anti-pattern:

```java
@RequestScoped
public class RequestData {
    String userInput;
}

executor.submit(() -> service.process(requestData));
```

Masalah:

- object contextual mungkin invalid,
- lazy proxy bisa gagal,
- stale state,
- memory leak,
- behavior berbeda antar server.

Pattern yang lebih aman:

```text
Extract immutable command DTO during request
  -> persist or submit command
  -> async task loads fresh dependencies/context
```

### 8.5 Classloader boundary

Application server menggunakan classloader per application/module. Jika unmanaged thread menyimpan reference ke class dari deployment lama, redeploy bisa bocor.

Gejala:

- memory naik setelah setiap redeploy,
- old classloader tidak ter-GC,
- thread dump menunjukkan thread lama masih berjalan,
- random `ClassCastException` setelah redeploy.

### 8.6 Observability boundary

Ketika pekerjaan pindah thread, informasi observability bisa hilang:

- correlation ID,
- request ID,
- user ID,
- tenant/module,
- trace/span,
- MDC logging context,
- job execution ID.

Jika tidak didesain, log akan terlihat seperti:

```text
ERROR NullPointerException at Worker.run
```

Tanpa tahu request/job/case/user mana yang terkait.

### 8.7 Capacity boundary

Concurrency tanpa limit adalah cara cepat membuat sistem tumbang.

Pertanyaan:

- Berapa task aktif maksimal?
- Berapa queue maksimal?
- Apa yang terjadi saat queue penuh?
- Workload mana yang mendapat prioritas?
- Apakah background task bisa menghabiskan DB connection pool?
- Apakah batch bisa membuat request latency naik?

Boundary kapasitas harus eksplisit.

### 8.8 Durability boundary

Pertanyaan:

- Jika JVM mati setelah task diterima tetapi sebelum selesai, apakah task hilang?
- Apakah task perlu persisted state?
- Apakah job bisa di-restart?
- Apakah setiap item punya checkpoint?

`ManagedExecutorService` saja tidak otomatis durable. Jika durability penting, biasanya perlu:

- database task table,
- message broker,
- Jakarta Batch repository,
- external durable orchestrator.

### 8.9 Cluster boundary

Di Kubernetes/EKS/application server cluster, pertanyaan berubah:

- Apakah setiap pod menjalankan scheduler?
- Apakah job boleh dijalankan lebih dari satu node?
- Jika node mati, node lain boleh mengambil alih?
- Bagaimana mencegah duplicate start?
- Bagaimana partition work dibagi?

Cluster membuat “background job sederhana” menjadi masalah distributed systems.

---

## 9. Mental Model: Execution Is a Contract

Setiap execution model memiliki kontrak.

### 9.1 Request-response contract

```text
Client expects response within timeout.
Server must complete or fail fast.
```

Cocok untuk pekerjaan kecil dan user-facing.

### 9.2 Async task contract

```text
Caller delegates work.
Task may complete later.
System must expose result/error somehow.
```

Cocok untuk offload, fan-out, atau background work terbatas.

### 9.3 Batch contract

```text
Job has identity, parameters, status, restart semantics, and operational lifecycle.
```

Cocok untuk pekerjaan besar/berulang/auditable.

### 9.4 Message contract

```text
Producer emits durable intent/event.
Consumer processes independently with broker-level delivery semantics.
```

Cocok untuk decoupled event/work queue.

### 9.5 Orchestrator contract

```text
Workflow coordinates multiple steps/systems with operational visibility.
```

Cocok untuk multi-system workflows.

Top engineer tidak memilih teknologi dari familiaritas. Ia memilih berdasarkan kontrak workload.

---

## 10. Decision Map Awal

Gunakan map berikut sebagai orientasi awal.

### 10.1 Jika user menunggu hasil langsung

Pilih:

```text
Synchronous request
```

atau jika perlu fan-out I/O:

```text
Request + ManagedExecutorService/structured fan-out
```

Pertanyaan validasi:

- Apakah semua operasi bisa selesai dalam timeout HTTP?
- Apakah resource downstream cukup?
- Apakah parallelism benar-benar mengurangi latency, atau hanya memindahkan bottleneck?

### 10.2 Jika user tidak perlu menunggu hasil tetapi task harus selesai

Pilih salah satu:

```text
Persist task request + ManagedExecutorService worker
```

atau:

```text
Message queue
```

atau:

```text
Jakarta Batch
```

Pertanyaan validasi:

- Haruskah task survive JVM restart?
- Apakah task butuh progress/status?
- Apakah ada banyak item?
- Apakah restart dari checkpoint dibutuhkan?

### 10.3 Jika workload besar, berulang, dan butuh restart

Pilih:

```text
Jakarta Batch
```

Pertanyaan validasi:

- Apa job parameters?
- Apa checkpoint boundary?
- Apa commit interval?
- Apa item identity?
- Apa idempotency key?
- Bagaimana operator stop/restart?

### 10.4 Jika workload berbasis event kecil-kecil

Pilih:

```text
Messaging
```

Pertanyaan validasi:

- Delivery semantics apa yang tersedia?
- Apakah consumer idempotent?
- Apakah ordering penting?
- Bagaimana DLQ ditangani?

### 10.5 Jika workload lintas sistem dengan workflow kompleks

Pilih:

```text
External workflow/orchestrator
```

Pertanyaan validasi:

- Apakah ada manual approval?
- Apakah step berjalan di banyak service?
- Apakah perlu compensation?
- Apakah job graph dinamis?

---

## 11. Jakarta Concurrency: Posisi dalam Arsitektur

Jakarta Concurrency menyediakan standar untuk menjalankan concurrent task dari application component tanpa mengorbankan integritas container.

Komponen utama yang akan kita bahas di part berikutnya:

1. `ManagedExecutorService`
2. `ManagedScheduledExecutorService`
3. `ManagedThreadFactory`
4. `ContextService`

### 11.1 Apa yang diberi Jakarta Concurrency?

Secara mental model, Jakarta Concurrency memberi:

```text
Application code
  -> asks container for managed execution capability
  -> container controls thread/context/lifecycle
  -> application submits work within container contract
```

Bukan:

```text
Application code
  -> creates arbitrary thread pool
  -> hides work from container
  -> hopes everything works
```

### 11.2 Kenapa “managed” penting?

Karena container perlu mengontrol:

- thread lifecycle,
- application classloader,
- naming context,
- security context,
- CDI integration,
- shutdown/redeploy,
- resource accounting,
- thread context propagation,
- observability integration,
- vendor-specific tuning.

Tanpa itu, aplikasi bisa berjalan “normal” sampai ada:

- redeploy,
- high load,
- node drain,
- failover,
- memory pressure,
- thread leak,
- audit incident.

### 11.3 Jakarta Concurrency bukan batch engine

Managed executor tidak otomatis memberikan job repository, checkpoint, step transition, skip/retry per item, atau restartability.

Ia adalah tool untuk managed async/concurrent execution.

Untuk pekerjaan seperti:

```text
Process 5 million records, checkpoint every 1000, restart after failure
```

lebih tepat memakai Jakarta Batch.

---

## 12. Jakarta Batch: Posisi dalam Arsitektur

Jakarta Batch adalah model untuk batch processing. Ia menyediakan:

- Java programming model,
- XML-based Job Specification Language/JSL,
- job/step/chunk abstraction,
- job parameters,
- job execution status,
- stop/restart semantics,
- checkpointing,
- skip/retry/rollback semantics,
- partitioning model.

### 12.1 Batch job sebagai stateful execution

Batch job bukan hanya method call:

```java
runNightlyJob();
```

Batch job adalah execution entity:

```text
Job name: nightly-case-ageing
Parameters: businessDate=2026-06-17, agency=CEA
Job instance: logical instance for parameter set
Job execution: concrete run attempt
Steps: load cases, process partitions, write summary
Status: STARTED/COMPLETED/FAILED/STOPPED
Exit status: business outcome
Repository: persisted runtime metadata
```

### 12.2 Chunk mental model

Chunk-oriented processing bukan sekadar loop.

```text
read item
read item
read item
process items
write chunk
commit
checkpoint
```

Jika crash setelah checkpoint, job bisa restart dari posisi yang diketahui.

### 12.3 Batch cocok untuk regulatory systems

Dalam sistem regulatory/case management, batch sering dipakai untuk:

- SLA ageing calculation,
- escalation rule evaluation,
- bulk correspondence,
- enforcement status transition,
- external registry sync,
- reconciliation,
- archival,
- audit report generation.

Kebutuhan utamanya bukan hanya “cepat”, tetapi:

- benar,
- dapat dilacak,
- dapat dihentikan,
- dapat dilanjutkan,
- dapat dijelaskan,
- tidak menggandakan side effect,
- tidak merusak online traffic.

---

## 13. Java 8–25: Bagaimana Evolusi Java Mengubah Desain

### 13.1 Java 8: CompletableFuture dan common pool caveat

Java 8 membawa `CompletableFuture`, yang membuat composition async lebih mudah.

Masalahnya:

```java
CompletableFuture.supplyAsync(() -> callApi());
```

Tanpa executor eksplisit, ini memakai default async execution facility, umumnya `ForkJoinPool.commonPool()` untuk banyak operation. Di Jakarta EE container, ini sering tidak ideal karena:

- bukan managed executor,
- context propagation tidak sesuai container,
- lifecycle tidak dikontrol application server,
- CPU pool bisa tercampur dengan workload lain,
- observability lemah.

Pattern lebih baik:

```java
CompletableFuture.supplyAsync(() -> callApi(), managedExecutor);
```

### 13.2 Java 21: virtual threads

Virtual threads mengubah economics of blocking.

Sebelum virtual threads:

```text
Blocking call = platform thread blocked = expensive at large scale
```

Dengan virtual threads:

```text
Blocking call = virtual thread parked = carrier platform thread can run other virtual threads
```

Tetapi:

```text
More concurrency != unlimited downstream capacity
```

Jika database hanya mampu 100 active queries, menjalankan 10.000 virtual threads tidak membuat database lebih kuat. Ia bisa justru membuat DB collapse.

### 13.3 Java 25: structured concurrency and scoped values direction

Structured concurrency mendorong model:

```text
A parent task owns child tasks.
If parent fails/cancels, child tasks are cancelled.
Failures are aggregated structurally.
```

Ini relevan untuk request fan-out/fan-in:

```text
Request
  -> fetch profile
  -> fetch permissions
  -> fetch outstanding cases
  -> combine response
```

Scoped values membantu menggantikan beberapa penggunaan `ThreadLocal`, terutama ketika banyak virtual threads. Tetapi di Jakarta EE, penggunaannya harus tetap menghormati container context dan status API yang tersedia di JDK target.

### 13.4 Kesimpulan evolusi Java

Java modern membuat concurrency lebih mudah ditulis, tetapi tidak otomatis membuatnya aman secara enterprise.

Urutannya harus tetap:

```text
Workload contract
  -> boundary design
  -> capacity model
  -> execution mechanism
  -> API implementation
```

Bukan:

```text
New Java feature
  -> use everywhere
```

---

## 14. Top-Level Architecture Patterns

### 14.1 Request fan-out/fan-in

Kondisi:

- user menunggu response,
- beberapa call independen,
- latency total bisa dikurangi dengan parallelism,
- semua call harus selesai dalam timeout.

Model:

```text
HTTP request
  -> validate
  -> start child tasks using managed executor
  -> wait with timeout
  -> combine result
  -> return
```

Risiko:

- timeout salah,
- cancellation tidak jalan,
- downstream overload,
- common pool dipakai tanpa sadar,
- context/correlation hilang.

### 14.2 Async command with task table

Kondisi:

- user tidak perlu menunggu hasil final,
- task harus survive restart,
- perlu status sederhana.

Model:

```text
POST /tasks
  -> validate authorization
  -> insert TASK_REQUEST(status=PENDING)
  -> commit
  -> return 202 + taskId

Worker
  -> claim PENDING task
  -> process
  -> update status/result/error
```

Risiko:

- duplicate claim,
- stuck RUNNING task,
- retry storm,
- no idempotency,
- queue table jadi bottleneck.

### 14.3 Batch job with checkpoint

Kondisi:

- banyak item,
- perlu restart,
- perlu progress,
- perlu chunk transaction.

Model:

```text
JobOperator.start("import-case-file", params)
  -> reader reads records
  -> processor validates/transforms
  -> writer persists chunk
  -> checkpoint after commit
```

Risiko:

- checkpoint state tidak cukup,
- writer tidak idempotent,
- commit interval terlalu besar/kecil,
- skip/retry salah klasifikasi,
- partition skew.

### 14.4 Outbox-driven side effect

Kondisi:

- DB change harus diikuti side effect external,
- side effect tidak boleh hilang,
- retry harus aman.

Model:

```text
Business transaction:
  - update case
  - insert OUTBOX event
  - commit

Worker/batch:
  - read unsent outbox
  - call external system
  - mark sent with idempotency key
```

Risiko:

- duplicate delivery,
- external API non-idempotent,
- poison event,
- ordering conflict.

### 14.5 Cluster singleton scheduled launcher

Kondisi:

- scheduled job harus start sekali per cluster.

Model:

```text
Every node wakes up
  -> attempt DB lock/leader claim
  -> only winner starts job
```

Risiko:

- lock not released,
- clock skew,
- split brain,
- duplicate schedule during rolling deploy.

---

## 15. Common Misleading Premises

### 15.1 “Kita butuh concurrency supaya cepat”

Belum tentu.

Concurrency membantu jika bottleneck-nya adalah waiting/I/O dan downstream punya kapasitas. Jika bottleneck-nya DB CPU, lock contention, atau external rate limit, menambah concurrency bisa memperburuk.

Rumus mental:

```text
Throughput = min(application capacity, DB capacity, downstream capacity, network capacity, lock capacity)
```

### 15.2 “Background task cukup pakai executor biasa”

Di Java SE standalone, mungkin. Di Jakarta EE container, ini berbahaya jika executor tidak managed.

Pertanyaan yang harus dijawab:

- siapa shutdown executor?
- siapa propagate context?
- siapa mencegah classloader leak?
- siapa expose metrics?
- siapa mengontrol resource use?

### 15.3 “Virtual threads berarti pool sizing tidak penting”

Salah.

Virtual threads mengurangi biaya thread, bukan menghapus kapasitas downstream.

Masih perlu:

- DB connection pool limit,
- HTTP client connection limit,
- rate limiter,
- semaphore/bulkhead,
- queue bound,
- timeout.

### 15.4 “Batch cuma cron + loop”

Salah.

Batch yang matang memiliki:

- job identity,
- job parameters,
- execution status,
- checkpoint,
- restart,
- skip/retry semantics,
- audit,
- operational control.

Cron + loop hanya trigger + code. Ia belum memberikan execution model.

### 15.5 “Retry akan memperbaiki failure”

Retry hanya membantu transient failure. Retry terhadap permanent/poison data akan membuat sistem sibuk gagal.

Retry harus punya:

- max attempts,
- backoff,
- jitter,
- classification,
- DLQ/quarantine,
- operator visibility,
- idempotency.

---

## 16. Workload Classification Framework

Sebelum implementasi, klasifikasikan workload dengan tabel berikut.

| Dimension | Pertanyaan | Pilihan umum |
|---|---|---|
| Trigger | Apa yang memulai pekerjaan? | HTTP request, schedule, message, operator, file arrival |
| Duration | Berapa lama? | ms, seconds, minutes, hours |
| User waiting? | Apakah user menunggu hasil? | yes/no |
| Durability | Boleh hilang saat crash? | yes/no |
| Restartability | Perlu lanjut dari checkpoint? | yes/no |
| Idempotency | Aman dijalankan ulang? | yes/no/partial |
| Side effect | Ada external side effect? | DB, email, API, file, report |
| Transaction | Boundary commit di mana? | per request, per item, per chunk, per step |
| Volume | Berapa item? | single, hundreds, millions |
| Parallelism | Bisa diparalelkan? | no, by id range, by tenant, by file, by partition |
| Ordering | Urutan penting? | none, per key, global |
| Capacity | Bottleneck utama? | app CPU, DB, API, disk, network |
| Audit | Perlu evidence? | low, medium, high |
| Operation | Perlu start/stop/restart UI? | yes/no |
| Cluster | Multi-node? | single, active-active, leader-only |

Contoh klasifikasi:

```text
Workload: nightly case ageing recalculation
Trigger: schedule/operator
Duration: 20-60 minutes
User waiting: no
Durability: yes
Restartability: yes
Idempotency: required
Side effect: DB update + audit summary
Transaction: per chunk
Volume: hundreds thousands/millions cases
Parallelism: by agency/case id range
Ordering: not global
Capacity: DB + CPU
Audit: high
Operation: start/stop/restart required
Cluster: duplicate prevention required
Recommended model: Jakarta Batch + cluster-safe launcher
```

---

## 17. Enterprise Concurrency Design Invariants

Invariants adalah aturan yang harus tetap benar walaupun ada failure.

### 17.1 No hidden unmanaged execution

Tidak ada thread/task yang tidak diketahui container/operator.

### 17.2 No unbounded queue without rejection policy

Queue tak terbatas adalah latency dan memory bomb.

### 17.3 No async side effect without idempotency strategy

Jika task bisa retry, side effect harus aman terhadap duplicate.

### 17.4 No long transaction for large batch

Batch besar harus dipotong menjadi unit commit yang masuk akal.

### 17.5 No cluster schedule without duplicate prevention

Di cluster, scheduler harus dianggap berjalan di setiap node kecuali dibuktikan tidak.

### 17.6 No context assumption across async boundary

Context harus dipropagasikan, disalin, atau dibuat ulang secara eksplisit.

### 17.7 No background work without observability

Setiap task/job harus punya minimal:

- identity,
- start time,
- end time,
- status,
- correlation,
- error summary,
- metrics.

### 17.8 No retry without classification

Retry harus tahu apa yang retryable, skippable, fatal, poison, atau conflict.

### 17.9 No batch without restart story

Kalau batch gagal di tengah, operator harus tahu:

- bisa restart atau tidak,
- dari mana restart,
- apa yang sudah committed,
- apa yang belum,
- apakah side effect aman.

### 17.10 No production async without shutdown behavior

Saat shutdown/redeploy/node drain:

- task baru berhenti diterima,
- running task diberi waktu selesai,
- task yang belum selesai ditandai resumable,
- resource ditutup bersih.

---

## 18. Step-by-Step Reasoning: Memilih Model untuk Sebuah Kebutuhan

Misal kebutuhan:

> “Ketika user menekan tombol Generate Letters untuk 20.000 case, sistem harus membuat dokumen, menyimpan metadata, dan mengirim notifikasi setelah selesai.”

### Step 1 — Apakah user harus menunggu?

20.000 case terlalu besar untuk request-response biasa.

Keputusan:

```text
Return 202 Accepted + jobId/taskId
```

### Step 2 — Apakah pekerjaan harus survive restart?

Ya. Generate letter tidak boleh hilang.

Keputusan:

```text
Persist job request or use Jakarta Batch job repository
```

### Step 3 — Apakah ada banyak item dan perlu progress?

Ya, 20.000 case.

Keputusan:

```text
Jakarta Batch chunk-oriented step
```

### Step 4 — Apa checkpoint boundary?

Misal setiap 100 case.

```text
Chunk size = 100
Commit after 100 metadata writes
Checkpoint after successful commit
```

### Step 5 — Apakah writer idempotent?

Generate document bisa duplicate. Harus ada idempotency key:

```text
document_generation_key = jobId + caseId + templateVersion
```

### Step 6 — Apa external side effect?

Notifikasi setelah semua selesai.

Opsi aman:

```text
Batch writes notification outbox
Separate worker sends notification idempotently
```

### Step 7 — Bagaimana operator memantau?

Expose:

- jobId,
- submittedBy,
- total items,
- processed count,
- failed count,
- skipped count,
- status,
- downloadable error report.

### Step 8 — Bagaimana jika node mati?

Restart job dari checkpoint terakhir. Writer harus tidak menggandakan dokumen yang sudah dibuat.

### Step 9 — Bagaimana jika API document service rate-limited?

Tambahkan:

- rate limit,
- retry with backoff/jitter,
- classify 429 as retryable,
- classify 400 invalid template as fatal/skip depending business rule.

### Step 10 — Final design

```text
POST /letter-generation-jobs
  -> authorize user
  -> validate case selection
  -> start Jakarta Batch job or persist request for launcher
  -> return jobId

Batch job:
  Step 1: resolve eligible case IDs
  Step 2: chunk process generate metadata/document command
  Step 3: write notification outbox
  Step 4: summarize result

Operator UI:
  - view status
  - stop job
  - restart failed/stopped job
  - download error report
```

Ini jauh lebih aman daripada:

```java
executor.submit(() -> generate20000Letters());
```

---

## 19. Production Failure Model

Top-tier engineer mendesain dari failure, bukan dari happy path.

### 19.1 JVM crash

Pertanyaan:

- Apakah task hilang?
- Apakah partial result committed?
- Apakah restart duplicate side effect?

Mitigasi:

- durable job/task state,
- checkpoint,
- idempotency key,
- outbox,
- restart test.

### 19.2 DB timeout

Pertanyaan:

- Apakah transaction rollback?
- Apakah chunk diulang?
- Apakah writer aman?

Mitigasi:

- smaller chunk,
- query tuning,
- retry classification,
- deadlock retry,
- lock strategy.

### 19.3 External API 429

Pertanyaan:

- Apakah retry langsung memperparah?
- Apakah global rate limit terkoordinasi antar partition/node?

Mitigasi:

- token bucket/rate limiter,
- backoff+jitter,
- reduce partition concurrency,
- pause job or fail gracefully.

### 19.4 Redeploy during running task

Pertanyaan:

- Apakah task dihentikan?
- Apakah thread leak?
- Apakah job bisa restart di versi baru?

Mitigasi:

- managed lifecycle,
- graceful shutdown,
- persistent checkpoint,
- versioned job parameters/schema compatibility.

### 19.5 Cluster duplicate execution

Pertanyaan:

- Apakah dua node start job yang sama?
- Apakah job parameters punya uniqueness constraint?

Mitigasi:

- job launch lock,
- unique business key,
- idempotency,
- cluster-aware scheduler.

### 19.6 Poison data

Pertanyaan:

- Apakah satu record buruk menghentikan 1 juta record?
- Apakah skip dapat dipertanggungjawabkan?

Mitigasi:

- exception classification,
- skip limit,
- quarantine report,
- operator review.

### 19.7 Observability loss

Pertanyaan:

- Apakah error bisa dikaitkan ke job/case/user?

Mitigasi:

- job execution ID,
- correlation ID,
- MDC propagation,
- structured logs,
- metrics.

---

## 20. Observability Minimum Standard

Untuk setiap async/batch workload, minimal punya:

### 20.1 Identity

- taskId/jobExecutionId,
- jobName/taskType,
- correlationId,
- initiatedBy,
- businessKey.

### 20.2 Lifecycle timestamps

- submittedAt,
- startedAt,
- lastProgressAt,
- completedAt/failedAt.

### 20.3 Status

- PENDING,
- RUNNING,
- COMPLETED,
- FAILED,
- STOPPING,
- STOPPED,
- RESTARTING,
- ABANDONED.

### 20.4 Metrics

- active task count,
- queue depth,
- execution duration,
- item processed count,
- success/failure/skip count,
- retry count,
- timeout count,
- rejection count,
- external API latency,
- DB time.

### 20.5 Logs

Setiap log penting harus membawa:

```text
correlationId
jobExecutionId/taskId
stepName
partitionId
caseId/businessKey if applicable
initiatedBy
```

### 20.6 Operator action audit

Operator actions harus diaudit:

- start,
- stop,
- restart,
- abandon,
- parameter override,
- manual retry,
- skip approval.

---

## 21. Testing Strategy dari Awal

Concurrency dan batch tidak cukup diuji dengan unit test happy path.

### 21.1 Unit tests

Cocok untuk:

- processor logic,
- exception classification,
- idempotency key generation,
- parameter validation,
- decision logic.

### 21.2 Integration tests

Cocok untuk:

- transaction boundary,
- DB writer,
- reader restart position,
- batch step execution,
- CDI injection,
- managed executor behavior.

### 21.3 Failure injection tests

Harus mencakup:

- crash after write before checkpoint,
- crash after checkpoint,
- DB deadlock,
- API timeout,
- API 429,
- duplicate job start,
- stop request during processing,
- redeploy during running job.

### 21.4 Load tests

Harus mengukur:

- throughput,
- p95/p99 latency,
- queue growth,
- DB pool usage,
- CPU,
- memory,
- GC,
- downstream saturation.

### 21.5 Restart tests

Pertanyaan utama:

- Setelah failure, apakah restart melanjutkan dari posisi benar?
- Apakah duplicate side effect muncul?
- Apakah status akhir benar?
- Apakah audit trail konsisten?

---

## 22. Anti-Pattern Awal yang Harus Dihindari

### 22.1 `new Thread()` di service/container component

```java
public void process() {
    new Thread(() -> doWork()).start();
}
```

Masalah:

- unmanaged lifecycle,
- context loss,
- classloader leak,
- no capacity governance,
- no shutdown semantics.

### 22.2 `Executors.newFixedThreadPool()` tanpa lifecycle

```java
private final ExecutorService executor = Executors.newFixedThreadPool(20);
```

Masalah:

- app server tidak mengelola thread,
- shutdown sering lupa,
- redeploy leak,
- context hilang.

### 22.3 `CompletableFuture.supplyAsync()` tanpa executor

```java
CompletableFuture.supplyAsync(() -> service.call());
```

Masalah:

- common pool,
- bukan managed executor,
- context/lifecycle tidak sesuai container.

### 22.4 Unbounded queue

```text
Queue capacity = unlimited
```

Masalah:

- memory growth,
- latency tidak terlihat,
- failure tertunda,
- OOM.

### 22.5 Batch long transaction

```text
Begin transaction
Process 1,000,000 records
Commit
```

Masalah:

- lock lama,
- undo/redo pressure,
- rollback mahal,
- restart buruk.

### 22.6 Fire-and-forget critical work

```java
executor.submit(() -> sendRegulatoryNotice());
return ok();
```

Tanpa persisted state, error handling, idempotency, audit, dan retry, ini berbahaya.

### 22.7 Scheduler di setiap pod tanpa lock

```text
@Schedule every night 1 AM
```

Dalam cluster 4 pods, bisa terjadi 4 job start.

---

## 23. Recommended Baseline Architecture untuk Seri Ini

Untuk memahami part selanjutnya, bayangkan aplikasi enterprise dengan modul:

```text
REST/API Layer
  -> Application Service
  -> Domain Service
  -> Persistence Layer
  -> External Connector
  -> Audit Trail
  -> Job/Task Control Plane
```

Workload model:

```text
Online path:
  - request-response
  - low latency
  - bounded synchronous work

Async path:
  - managed executor
  - short/medium background work
  - durable task table if needed

Batch path:
  - Jakarta Batch job
  - step/chunk/checkpoint/restart
  - operator control

Integration path:
  - outbox/message
  - idempotent external side effect
```

Deployment model:

```text
Multiple pods/nodes
  -> app server runtime
  -> managed executor resources
  -> DB connection pool
  -> job repository/task tables
  -> external API rate limits
  -> monitoring/logging/tracing
```

---

## 24. Mental Model Diagram

```text
                          +----------------------+
                          |      User/API        |
                          +----------+-----------+
                                     |
                                     v
                         +-----------+------------+
                         |   Request Thread       |
                         |   short-lived context  |
                         +-----+-------------+----+
                               |             |
                 synchronous   |             | async handoff
                 response      |             v
                               |   +---------+----------------+
                               |   | ManagedExecutorService   |
                               |   | bounded async execution  |
                               |   +---------+----------------+
                               |             |
                               |             v
                               |   +---------+----------------+
                               |   | Task State / Outbox      |
                               |   | durability/idempotency   |
                               |   +--------------------------+
                               |
                               v
                       +-------+-------------------+
                       | Jakarta Batch Runtime     |
                       | job/step/chunk/checkpoint |
                       +-------+-------------------+
                               |
               +---------------+---------------+
               |                               |
               v                               v
       +-------+---------+             +-------+---------+
       | Database        |             | External System |
       | transaction     |             | API/rate limit  |
       +-----------------+             +-----------------+
```

Kunci diagram:

- Request thread bukan tempat kerja panjang.
- Managed executor memberi execution capability, bukan durability otomatis.
- Task state/outbox memberi durability/idempotency.
- Jakarta Batch memberi job semantics dan restartability.
- Database/external system tetap menjadi capacity boundary.

---

## 25. Practical Heuristics

### 25.1 Jika pekerjaan < 200 ms dan user butuh hasil

Tetap synchronous.

### 25.2 Jika pekerjaan 200 ms–5 detik dan terdiri dari beberapa I/O independen

Pertimbangkan fan-out dengan managed executor atau structured concurrency pattern, tetap dengan timeout dan cancellation.

### 25.3 Jika pekerjaan > timeout nyaman user

Return `202 Accepted`, simpan state, proses async.

### 25.4 Jika pekerjaan melibatkan ratusan/ribuan/jutaan item

Pertimbangkan Jakarta Batch.

### 25.5 Jika pekerjaan harus survive crash

Jangan hanya executor memory. Persist state/message/job execution.

### 25.6 Jika side effect external bisa terulang

Desain idempotency sebelum desain retry.

### 25.7 Jika berjalan di cluster

Asumsikan duplicate execution akan terjadi kecuali dicegah eksplisit.

### 25.8 Jika memakai virtual threads

Tetap batasi akses ke DB/API. Virtual thread bukan izin untuk unlimited concurrency.

### 25.9 Jika ada audit/regulatory implication

Simpan who/when/what/why/result, bukan hanya log teknis.

### 25.10 Jika operator tidak bisa menghentikan/mengetahui status

Untuk workload panjang, desain belum production-grade.

---

## 26. Mini Case Study: Enforcement Escalation Evaluation

### 26.1 Problem

Setiap malam, sistem harus mengevaluasi semua case aktif untuk menentukan apakah perlu escalation berdasarkan:

- case age,
- SLA threshold,
- outstanding action,
- agency-specific rule,
- enforcement priority,
- previous escalation history.

### 26.2 Poor design

```java
@Schedule(hour = "1")
public void run() {
    List<Case> cases = caseRepository.findAllActive();
    for (Case c : cases) {
        evaluateAndEscalate(c);
    }
}
```

Masalah:

- semua case dimuat sekaligus,
- transaction boundary tidak jelas,
- jika gagal di tengah tidak tahu progress,
- restart bisa duplicate escalation,
- cluster bisa menjalankan job berkali-kali,
- tidak ada skip/retry classification,
- operator tidak punya control plane.

### 26.3 Better design

```text
Cluster-safe launcher
  -> starts Jakarta Batch job with businessDate

Batch job:
  Step 1: resolve eligible cases using keyset paging
  Step 2: chunk process cases
      - read case IDs
      - load latest case state
      - evaluate rule
      - write escalation decision idempotently
      - write audit event
  Step 3: summarize counts and exceptions

Controls:
  - stop/restart
  - skip poison case with report
  - prevent duplicate job for same businessDate
```

### 26.4 Key invariants

```text
One escalation decision per case per ruleVersion per businessDate.
Restart must not create duplicate escalation.
Operator can explain why a case was escalated or not escalated.
Batch failure preserves committed decisions and resumes safely.
```

Itulah perbedaan antara code yang “jalan” dan sistem yang defensible.

---

## 27. What Top 1% Engineers Internalize

### 27.1 Mereka melihat concurrency sebagai resource governance

Bukan:

```text
More threads = faster
```

Tetapi:

```text
Concurrency must match capacity and preserve correctness.
```

### 27.2 Mereka melihat async boundary sebagai consistency boundary

Setiap kali berpindah thread/waktu/node, tanyakan:

- state apa yang dibawa?
- context apa yang valid?
- transaction apa yang sudah selesai?
- side effect apa yang bisa duplicate?
- observability apa yang harus ikut?

### 27.3 Mereka tidak percaya happy path

Mereka selalu bertanya:

- crash di tengah bagaimana?
- retry duplicate bagaimana?
- node restart bagaimana?
- external API lambat bagaimana?
- DB lock bagaimana?
- user logout bagaimana?
- operator stop bagaimana?

### 27.4 Mereka memilih tool berdasarkan semantics

Bukan karena “lebih modern”, tetapi karena sesuai kebutuhan:

| Need | Better tool |
|---|---|
| Low-latency request | synchronous/request async |
| Short bounded background task | managed executor |
| Periodic lightweight task | managed scheduled executor with cluster safety |
| Durable decoupled event | messaging/outbox |
| Large restartable item processing | Jakarta Batch |
| Multi-system workflow | workflow/orchestrator |

### 27.5 Mereka membuat pekerjaan bisa dioperasikan

Production-grade berarti operator bisa:

- melihat status,
- melihat progress,
- melihat error,
- menghentikan,
- melanjutkan,
- memahami impact,
- mengambil keputusan.

---

## 28. Checklist Bagian 0

Sebelum lanjut ke Part 1, pastikan kamu bisa menjelaskan:

- [ ] Perbedaan unit of work dan unit of execution.
- [ ] Kenapa unmanaged thread berbahaya di container.
- [ ] Kapan request thread cukup.
- [ ] Kapan managed executor cocok.
- [ ] Kapan Jakarta Batch lebih tepat.
- [ ] Kenapa virtual thread tidak menghapus capacity planning.
- [ ] Apa saja boundary async: lifecycle, transaction, security, CDI, classloader, observability, capacity, durability, cluster.
- [ ] Kenapa retry tanpa idempotency berbahaya.
- [ ] Kenapa batch harus punya restart story.
- [ ] Bagaimana memilih execution model dari karakter workload.

---

## 29. Latihan / Thought Experiment

### Latihan 1 — Classify Workload

Klasifikasikan workload berikut menggunakan framework di bagian 16:

1. User request untuk melihat dashboard case summary.
2. Export 2 juta audit trail records ke file CSV.
3. Kirim reminder email untuk 50.000 license renewal.
4. Refresh reference data dari external API setiap 15 menit.
5. Generate PDF untuk satu case saat user klik tombol.
6. Reconcile payment records setiap malam.
7. Call 3 downstream APIs untuk membangun satu response profile.
8. Cleanup expired temporary files setiap jam.

Untuk setiap workload, tentukan:

- execution model,
- durability need,
- restartability need,
- idempotency risk,
- capacity bottleneck,
- observability requirement.

### Latihan 2 — Find the Boundary

Diberikan desain:

```text
REST endpoint receives request
  -> starts transaction
  -> updates database
  -> submits async task to send external notification
  -> commits transaction
  -> returns success
```

Pertanyaan:

1. Apa yang terjadi jika async task jalan sebelum transaction commit?
2. Apa yang terjadi jika transaction rollback tetapi notification sudah terkirim?
3. Apa yang terjadi jika JVM crash setelah commit tetapi sebelum async task jalan?
4. Bagaimana outbox pattern memperbaiki desain ini?

### Latihan 3 — Virtual Thread Reality Check

Sebuah tim ingin mengganti executor 50 thread menjadi virtual-thread-per-task executor untuk job yang melakukan 100.000 query DB.

Pertanyaan:

1. Apakah throughput pasti naik?
2. Apa bottleneck yang harus dicek?
3. Bagaimana connection pool memengaruhi hasil?
4. Apa risiko jika tidak ada concurrency limit?
5. Metric apa yang harus dipantau?

---

## 30. Ringkasan

Bagian ini membangun fondasi bahwa enterprise concurrency dan batch bukan sekadar membuat task berjalan paralel.

Inti pemahamannya:

1. Mulai dari workload, bukan dari thread.
2. Bedakan unit of work dan unit of execution.
3. Jakarta Concurrency memberikan managed execution agar tidak merusak container integrity.
4. Jakarta Batch memberikan job semantics untuk pekerjaan besar, restartable, auditable, dan operationally controllable.
5. Async boundary adalah boundary untuk lifecycle, transaction, security, context, observability, capacity, durability, dan cluster behavior.
6. Virtual threads mengubah biaya thread, tetapi tidak menghapus kebutuhan capacity control, idempotency, transaction design, dan operational governance.
7. Production-grade design harus menjawab failure: crash, retry, timeout, duplicate execution, poison data, redeploy, dan observability loss.
8. Untuk sistem regulatory/case management, correctness, auditability, restartability, dan defensibility sering lebih penting daripada sekadar throughput.

---

## 31. Posisi Seri

Kita baru menyelesaikan **Part 0** dari seri:

```text
learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration
```

Seri **belum selesai**. Ini adalah bagian orientasi. Bagian berikutnya:

```text
Part 1 — Historical Map: Java EE Concurrency Utilities to Jakarta Concurrency
File: 01-history-java-ee-concurrency-to-jakarta-concurrency.md
```

Di Part 1 kita akan membahas evolusi dari Java EE Concurrency Utilities ke Jakarta Concurrency, pergeseran `javax.*` ke `jakarta.*`, compatibility Java 8–25, dan bagaimana berbagai application server mengimplementasikan spesifikasi ini.

---

## 32. References

1. Jakarta EE 11 Release Page — https://jakarta.ee/release/11/
2. Jakarta EE Platform 11 Specification — https://jakarta.ee/specifications/platform/11/
3. Jakarta Concurrency 3.1 — https://jakarta.ee/specifications/concurrency/3.1/
4. Jakarta Batch 2.1 — https://jakarta.ee/specifications/batch/2.1/
5. Jakarta Batch Project — https://jakarta.ee/specifications/batch/
6. JEP 444: Virtual Threads — https://openjdk.org/jeps/444
7. JEP 505: Structured Concurrency — https://openjdk.org/jeps/505
8. JEP 506: Scoped Values — https://openjdk.org/jeps/506

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./01-history-java-ee-concurrency-to-jakarta-concurrency.md">Part 1 — Historical Map: Java EE Concurrency Utilities to Jakarta Concurrency ➡️</a>
</div>

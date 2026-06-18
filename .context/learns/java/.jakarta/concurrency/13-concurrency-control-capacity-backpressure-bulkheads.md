# Part 13 — Concurrency Control: Capacity, Backpressure, Bulkheads, and Fairness

File: `13-concurrency-control-capacity-backpressure-bulkheads.md`  
Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
Scope: Java 8–25, Java EE/Jakarta EE managed concurrency, Jakarta/Javax enterprise workloads

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan **parallelism**, **concurrency**, **throughput**, **latency**, dan **capacity** secara presisi.
2. Memahami kenapa menambah thread sering memperburuk sistem, bukan mempercepatnya.
3. Mendesain batas concurrency untuk workload Jakarta EE tanpa merusak container, database, external API, atau user-facing latency.
4. Memakai mental model **queue + worker + downstream capacity** untuk menganalisis executor, batch, scheduler, API fan-out, dan background work.
5. Menerapkan **bulkhead**, **backpressure**, **rate limit**, **concurrency limit**, dan **fairness** secara benar.
6. Menentukan kapan request harus ditolak, ditunda, diubah menjadi durable job, atau didegradasi.
7. Menghindari failure mode seperti queue explosion, retry storm, thread starvation, connection pool exhaustion, dan noisy neighbor.
8. Membangun worksheet sizing dan checklist production untuk managed async workload.

Bagian ini bukan tentang API syntax semata. Ini tentang **governance of execution**: bagaimana sistem memutuskan berapa banyak pekerjaan yang boleh berjalan, kapan pekerjaan harus menunggu, kapan harus ditolak, dan bagaimana memastikan satu jenis workload tidak merusak workload lain.

---

## 2. Problem yang Diselesaikan

Pada seri sebelumnya kita sudah membahas `ManagedExecutorService`, `ManagedScheduledExecutorService`, `ManagedThreadFactory`, `ContextService`, transaksi async, security identity, CDI boundary, `CompletableFuture`, virtual threads, structured concurrency, dan scoped context.

Semua itu menjawab pertanyaan:

> Bagaimana menjalankan pekerjaan asynchronous secara benar di lingkungan enterprise/container?

Bagian ini menjawab pertanyaan yang lebih berbahaya:

> Berapa banyak pekerjaan yang boleh berjalan secara bersamaan agar sistem tetap stabil?

Ini problem yang sering terlihat sederhana tetapi menjadi akar banyak incident production:

- endpoint async terasa cepat karena langsung return `202 Accepted`, tetapi queue internal diam-diam membesar;
- background task mengambil semua DB connection sehingga request biasa timeout;
- scheduler di setiap pod menjalankan job yang sama dan membanjiri external API;
- `CompletableFuture.allOf()` melakukan fan-out ratusan call tanpa limit;
- virtual thread membuat 50.000 blocking task tampak murah, tetapi database hanya punya 80 connection;
- retry logic memperbanyak traffic ketika downstream sedang gagal;
- batch partitioning terlalu agresif dan menyebabkan lock contention;
- satu tenant/user/module membuat task besar dan menahan kapasitas tenant lain;
- queue tidak bounded sehingga memory naik perlahan sampai OOM;
- executor tidak punya metrik sehingga bottleneck baru terlihat saat incident.

Top-tier engineer tidak hanya bertanya “bisa parallel tidak?”, tetapi:

1. Apa downstream paling sempit?
2. Berapa concurrency aman per workload?
3. Apa yang terjadi ketika traffic melebihi kapasitas?
4. Siapa yang harus diprioritaskan?
5. Bagaimana sistem memberi sinyal overload?
6. Apa bukti operasional bahwa kontrol ini bekerja?

---

## 3. Mental Model Utama

### 3.1 Concurrency adalah jumlah pekerjaan yang sedang hidup, bukan throughput

Sering terjadi kesalahan berpikir:

> “Kalau thread lebih banyak, throughput pasti naik.”

Padahal concurrency hanya berarti banyak pekerjaan sedang berada dalam sistem pada saat yang sama.

Throughput naik hanya jika pekerjaan tersebut memang bisa diselesaikan lebih banyak per unit waktu tanpa menabrak bottleneck lain.

Contoh:

- Jika bottleneck adalah CPU 4 core, membuat 400 CPU-bound thread tidak membuat CPU menjadi 400 core.
- Jika bottleneck adalah DB connection pool 50, membuat 5.000 virtual thread yang semuanya menunggu JDBC tidak membuat DB mampu melayani 5.000 query concurrent.
- Jika external API limit 300 request/minute, 10.000 async task hanya membuat 429 dan retry storm.

Concurrency adalah **inventory of in-flight work**. Terlalu sedikit concurrency membuat resource idle. Terlalu banyak concurrency membuat latency, queue, memory, timeout, retry, dan lock contention meningkat.

---

### 3.2 Little's Law sebagai alat berpikir

Dalam sistem stabil:

```text
L = λ × W
```

Di mana:

- `L` = jumlah rata-rata work item dalam sistem / concurrency / in-flight work
- `λ` = throughput / arrival rate / completion rate
- `W` = waktu rata-rata sebuah work item berada dalam sistem

Contoh:

```text
Jika sistem memproses 100 request/detik
Dan rata-rata latency 200 ms = 0.2 detik
Maka rata-rata in-flight request ≈ 100 × 0.2 = 20
```

Jika latency naik menjadi 2 detik dengan arrival rate sama:

```text
L = 100 × 2 = 200 in-flight request
```

Artinya ketika downstream melambat, concurrency otomatis naik, lalu menekan resource lebih keras. Ini salah satu mekanisme collapse paling umum.

Mental modelnya:

```text
Downstream slow
  -> each task lives longer
  -> in-flight count increases
  -> queue grows
  -> memory/threads/connections consumed
  -> latency increases further
  -> timeout/retry starts
  -> load multiplies
  -> collapse
```

Karena itu sistem butuh limit. Limit bukan sekadar pembatas performa; limit adalah **stability invariant**.

---

### 3.3 Queue bukan solusi kapasitas, queue adalah penunda kenyataan

Queue berguna untuk smoothing burst pendek. Tetapi queue tidak menciptakan kapasitas baru.

Jika arrival rate lebih besar daripada completion rate dalam waktu lama:

```text
arrival > service capacity
```

maka queue akan tumbuh terus.

Dua pilihan nyata:

1. Tambah kapasitas service yang benar-benar menyelesaikan bottleneck.
2. Kurangi arrival/acceptance rate melalui backpressure, rejection, shedding, atau durable deferral.

Queue yang tidak dibatasi adalah janji palsu:

> “Saya belum gagal, saya hanya menyimpan kegagalan untuk nanti.”

Dalam production, unbounded queue biasanya berubah menjadi:

- latency tidak terkendali;
- request timeout;
- memory pressure;
- GC pressure;
- OOM;
- delayed failure;
- pekerjaan basi tetap diproses;
- user melakukan retry manual;
- sistem memproses pekerjaan yang sudah tidak relevan.

---

### 3.4 Batas concurrency harus mengikuti resource paling sempit

Sistem enterprise biasanya punya beberapa resource:

```text
HTTP request threads
Managed executor threads
Virtual threads
DB connection pool
JPA persistence context
External API quota
Message broker consumer capacity
CPU cores
Memory
Disk I/O
Lock/table/index contention
Transaction log / redo / undo capacity
```

Concurrency limit yang benar tidak boleh hanya melihat executor.

Contoh buruk:

```text
Executor max threads = 200
DB connection pool = 40
Each task needs 1 DB connection
```

Hasil:

- 40 task running with DB connection;
- 160 task blocked waiting for connection;
- executor terlihat penuh;
- request thread mungkin ikut menunggu;
- transaction timeout meningkat;
- DB pool menjadi bottleneck;
- latency naik tanpa throughput signifikan.

Limit yang lebih masuk akal:

```text
DB pool = 40
Reserve 25 for user-facing request
Reserve 5 for admin/health/system
Allow background async max 10 concurrent DB-using tasks
```

Artinya background executor tidak boleh memakai 200 concurrency jika downstream DB hanya memberikan 10 slot aman untuk workload tersebut.

---

### 3.5 Setiap async boundary adalah admission-control point

Ketika request masuk dan ingin membuat async work, sistem punya kesempatan untuk memutuskan:

- diterima sekarang;
- diterima tapi ditunda secara durable;
- ditolak cepat;
- diminta coba lagi;
- diproses sinkron karena murah;
- diproses sebagai batch;
- dikirim ke broker;
- diabaikan karena duplikat;
- digabung dengan pekerjaan lain.

Top-tier design memperlakukan enqueue/submission bukan sebagai operasi netral, tetapi sebagai **admission control**.

```text
Request arrives
  -> validate input
  -> authorize action
  -> check idempotency / duplicate
  -> check capacity / quota / priority
  -> decide execution path
  -> persist intent if needed
  -> return honest response
```

---

## 4. Vocabulary yang Harus Presisi

### 4.1 Parallelism

Parallelism adalah pekerjaan benar-benar berjalan pada saat yang sama secara fisik/logis, biasanya memanfaatkan banyak CPU core atau banyak I/O channel.

Contoh:

- 8 CPU core menjalankan 8 CPU-bound task bersamaan.
- 100 HTTP calls sedang menunggu remote server secara bersamaan.

---

### 4.2 Concurrency

Concurrency adalah kemampuan menangani banyak pekerjaan yang lifecycle-nya overlap.

Satu core pun bisa concurrent melalui time slicing. Virtual thread membuat concurrency murah, tetapi tidak menghapus bottleneck downstream.

---

### 4.3 Throughput

Throughput adalah jumlah pekerjaan selesai per unit waktu.

```text
requests/second
records/minute
files/hour
jobs/day
```

Throughput adalah hasil, bukan setting executor.

---

### 4.4 Latency

Latency adalah waktu yang dialami satu pekerjaan dari awal sampai selesai.

Latency bisa terdiri dari:

```text
queue wait time
+ execution time
+ downstream wait time
+ retry/backoff time
+ commit time
+ response serialization time
```

Banyak tim hanya mengukur execution time, padahal user merasakan total latency.

---

### 4.5 Capacity

Capacity adalah kemampuan sistem menyelesaikan workload dengan SLO tertentu.

Contoh:

```text
Sistem mampu memproses 200 request/s dengan p95 latency < 300 ms dan error rate < 0.1%.
```

Capacity bukan hanya maksimum throughput. Capacity selalu terkait latency, error rate, dan resource budget.

---

### 4.6 Backpressure

Backpressure adalah mekanisme memberi sinyal ke upstream bahwa sistem tidak bisa menerima pekerjaan dengan laju saat ini.

Bentuknya bisa:

- HTTP `429 Too Many Requests`;
- HTTP `503 Service Unavailable` + `Retry-After`;
- blocking bounded queue offer dengan timeout;
- message broker consumer prefetch rendah;
- batch job tidak boleh start karena window penuh;
- UI disable action sementara;
- durable queue menerima tetapi statusnya `QUEUED`, bukan pura-pura selesai.

---

### 4.7 Bulkhead

Bulkhead adalah pemisahan kapasitas antar workload agar satu failure domain tidak menenggelamkan semua sistem.

Analogi kapal: kompartemen terpisah mencegah air masuk ke seluruh kapal.

Dalam software:

```text
Executor A untuk request fan-out ringan
Executor B untuk report generation
Executor C untuk external registry sync
DB pool partition atau logical semaphore per workload
Rate limiter per downstream
Queue per module/tenant/priority
```

---

### 4.8 Fairness

Fairness adalah aturan agar kapasitas dibagi secara adil sesuai prioritas, bukan siapa yang paling banyak mengirim task.

Fairness bisa berbasis:

- user;
- tenant;
- agency;
- module;
- job type;
- priority;
- regulatory deadline;
- SLA class.

Tanpa fairness, workload besar dari satu sumber bisa menjadi noisy neighbor.

---

## 5. Execution Model di Jakarta EE: Di Mana Capacity Harus Dikontrol

Dalam aplikasi Jakarta EE/Spring/Jakarta hybrid, pekerjaan bisa masuk dari banyak jalur:

```text
HTTP request
JAX-RS endpoint
Servlet async endpoint
ManagedExecutorService task
ManagedScheduledExecutorService trigger
Jakarta Batch job
JMS/message consumer
CDI event
External callback/webhook
Admin operation
Startup lifecycle hook
```

Setiap jalur punya admission-control point sendiri.

---

### 5.1 Request thread

Request thread cocok untuk pekerjaan pendek, bounded, dan hasilnya langsung dibutuhkan user.

Risiko:

- request thread tertahan oleh downstream lambat;
- user menunggu terlalu lama;
- load balancer timeout;
- container thread pool habis;
- request baru tidak bisa dilayani.

Kontrol:

- request timeout;
- servlet/JAX-RS thread pool sizing;
- per-endpoint concurrency limit;
- downstream timeout;
- circuit breaker;
- fail fast;
- offload hanya jika memang memberi value.

---

### 5.2 Managed executor

`ManagedExecutorService` cocok untuk pekerjaan async pendek-menengah yang masih berada dalam lifecycle aplikasi dan tidak perlu durability kompleks.

Risiko:

- task hilang jika server restart;
- queue membesar;
- executor mengambil resource request;
- context propagation tidak jelas;
- cancellation diabaikan.

Kontrol:

- bounded executor configuration jika vendor mendukung;
- semaphore di application layer;
- timeout saat submit;
- rejection handling;
- metrics;
- durable handoff untuk pekerjaan penting.

---

### 5.3 Managed scheduled executor

`ManagedScheduledExecutorService` cocok untuk periodic trigger ringan.

Risiko:

- overlap schedule;
- semua node menjalankan job yang sama;
- slow execution menyebabkan drift;
- retry storm periodik;
- job berat berjalan tanpa checkpoint.

Kontrol:

- distributed lock;
- single active scheduler;
- no-overlap guard;
- schedule jitter;
- move heavy work ke Jakarta Batch/job queue;
- metrik last success/last failure.

---

### 5.4 Jakarta Batch

Jakarta Batch cocok untuk pekerjaan besar, restartable, checkpointed, dan operasional.

Risiko:

- partition terlalu banyak;
- chunk terlalu besar/kecil;
- DB lock contention;
- restart tidak idempotent;
- job duplicate;
- batch window bentrok dengan online traffic.

Kontrol:

- max running jobs per type;
- max partitions;
- commit interval;
- job repository control;
- job parameter uniqueness;
- throttling writer/API call;
- batch window policy.

---

### 5.5 Messaging

Message-driven execution cocok untuk durable asynchronous work dan decoupling.

Risiko:

- consumer terlalu banyak;
- broker backlog tak terlihat user;
- poison message;
- redelivery storm;
- ordering problem;
- duplicate processing.

Kontrol:

- consumer concurrency;
- prefetch;
- DLQ;
- idempotent consumer;
- retry topic/delay queue;
- per-message TTL;
- partition key.

---

## 6. Concurrency Limit vs Rate Limit

Keduanya sering dicampur, padahal berbeda.

---

### 6.1 Concurrency limit

Concurrency limit membatasi jumlah pekerjaan yang sedang berjalan.

Contoh:

```text
Maksimal 20 external API calls in-flight pada satu waktu.
```

Cocok ketika risiko utama adalah resource yang terikat selama pekerjaan berlangsung:

- DB connection;
- memory buffer;
- external socket;
- lock;
- CPU slot;
- remote server concurrent request limit.

Implementasi umum:

```java
Semaphore semaphore = new Semaphore(20);

boolean acquired = semaphore.tryAcquire(200, TimeUnit.MILLISECONDS);
if (!acquired) {
    throw new TooBusyException("External API concurrency limit reached");
}

try {
    return callExternalApi();
} finally {
    semaphore.release();
}
```

---

### 6.2 Rate limit

Rate limit membatasi jumlah pekerjaan per waktu.

Contoh:

```text
Maksimal 300 request per menit.
```

Cocok ketika downstream punya quota/time window:

- external API limit;
- email provider limit;
- SMS provider limit;
- regulatory system SLA limit;
- batch notification quota.

Implementasi umum:

- token bucket;
- leaky bucket;
- fixed window;
- sliding window;
- distributed rate limiter via Redis;
- worker pace control.

---

### 6.3 Perbedaan praktis

Misalkan external API limit 300/minute dan average latency 1 second.

Rate limit:

```text
300/min = 5/sec
```

Concurrency yang kira-kira dibutuhkan:

```text
L = λ × W = 5/sec × 1 sec = 5 in-flight
```

Jika latency naik menjadi 5 detik:

```text
L = 5/sec × 5 sec = 25 in-flight
```

Maka desain aman sering membutuhkan keduanya:

```text
max rate       = 300/min
max in-flight  = 25
request timeout = 6s
retry budget    = limited
```

Tanpa concurrency limit, latency spike bisa membuat in-flight membengkak.

Tanpa rate limit, task cepat bisa melanggar quota walaupun concurrency rendah.

---

## 7. Bounded Queue dan Admission Control

### 7.1 Unbounded queue adalah anti-pattern untuk production critical executor

Banyak executor default memakai unbounded queue atau konfigurasi vendor yang tampak aman tetapi menyembunyikan backlog.

Masalah unbounded queue:

- tidak memberi sinyal overload;
- memory bisa habis;
- latency tidak terbatas;
- request diterima walau tidak realistis selesai;
- shutdown/redeploy lama;
- pekerjaan bisa basi;
- observability sering terlambat.

Bounded queue memaksa sistem mengambil keputusan.

---

### 7.2 Empat strategi saat queue penuh

#### Strategi 1 — Reject cepat

Cocok untuk pekerjaan yang user bisa retry.

```text
HTTP 429 / 503
Message: system busy, try again later
Retry-After: 30
```

Keuntungan:

- melindungi sistem;
- user mendapat sinyal jelas;
- tidak menambah backlog palsu.

Kekurangan:

- butuh UX/API contract yang siap menerima rejection.

---

#### Strategi 2 — Defer durable

Cocok untuk pekerjaan penting tetapi tidak harus segera selesai.

```text
Persist job request ke DB
Return 202 Accepted + jobId
Worker memproses sesuai kapasitas
```

Keuntungan:

- tidak hilang saat restart;
- bisa retry/restart;
- bisa diaudit;
- bisa dilihat statusnya.

Kekurangan:

- perlu job table/control plane;
- perlu idempotency;
- perlu worker polling/claiming.

---

#### Strategi 3 — Shed low-priority work

Cocok untuk telemetry, cache warming, non-critical enrichment.

```text
If overloaded:
  skip enrichment
  serve core response
```

Keuntungan:

- mempertahankan fungsi utama.

Kekurangan:

- hasil bisa kurang lengkap;
- harus jelas mana fitur yang boleh degrade.

---

#### Strategi 4 — Block briefly

Cocok untuk burst sangat pendek.

```java
boolean accepted = queue.offer(task, 100, TimeUnit.MILLISECONDS);
if (!accepted) reject();
```

Keuntungan:

- smoothing burst minor.

Kekurangan:

- jika dipakai di request thread terlalu lama, request pool bisa ikut habis.

---

### 7.3 Admission control tidak sama dengan error handling

Error handling bekerja setelah pekerjaan berjalan.
Admission control bekerja sebelum pekerjaan diterima.

```text
Admission control:
  “Bolehkah pekerjaan ini masuk sistem sekarang?”

Error handling:
  “Apa yang dilakukan jika pekerjaan yang sudah berjalan gagal?”
```

Sistem yang kuat punya keduanya.

---

## 8. Bulkhead Design

### 8.1 Kenapa satu shared executor sering salah

Contoh konfigurasi buruk:

```text
ManagedExecutorService: max 100 threads
Dipakai untuk:
  - email notification
  - report generation
  - external registry sync
  - audit enrichment
  - case escalation recalculation
  - user request fan-out
```

Jika report generation tiba-tiba memakai 100 thread, semua workload lain ikut tertahan.

Ini bukan hanya masalah performa. Ini masalah isolation.

---

### 8.2 Bulkhead berdasarkan workload type

Desain lebih baik:

```text
Executor: request-fanout-executor
  max concurrency: 20
  queue: small
  timeout: strict

Executor: notification-executor
  max concurrency: 10
  queue: medium
  retry: yes

Executor: report-executor
  max concurrency: 3
  queue: durable
  retry: controlled

Executor: external-registry-sync-executor
  max concurrency: 5
  rate limit: 300/min
  queue: durable
```

Dengan bulkhead, report berat tidak membunuh request fan-out.

---

### 8.3 Bulkhead tidak selalu berarti executor terpisah fisik

Kadang container hanya menyediakan satu managed executor atau konfigurasi executor sulit diubah.

Bulkhead bisa dibuat di application layer:

```java
public final class WorkloadBulkheads {
    private final Semaphore reportSlots = new Semaphore(3);
    private final Semaphore registrySlots = new Semaphore(5);
    private final Semaphore notificationSlots = new Semaphore(10);

    public <T> T withReportSlot(Callable<T> work) throws Exception {
        if (!reportSlots.tryAcquire(1, TimeUnit.SECONDS)) {
            throw new TooBusyException("Report workload is busy");
        }
        try {
            return work.call();
        } finally {
            reportSlots.release();
        }
    }
}
```

Namun executor-level isolation tetap lebih kuat jika tersedia, karena queue, thread, metrics, dan rejection bisa dipisah.

---

### 8.4 Bulkhead berdasarkan downstream

Kadang pemisahan terbaik bukan berdasarkan modul, tetapi downstream.

Contoh:

```text
All tasks calling Oracle DB heavy query -> DB-heavy bulkhead
All tasks calling OneMap/API registry -> external-api bulkhead
All tasks generating PDFs -> CPU/memory bulkhead
All tasks sending emails -> provider quota bulkhead
```

Kenapa? Karena failure domain mengikuti resource yang dipakai.

Jika 5 modul memanggil external API yang sama, mereka harus berbagi limit downstream yang sama.

---

## 9. Fairness: Mencegah Noisy Neighbor

### 9.1 Masalah FIFO global queue

FIFO global queue tampak adil, tetapi bisa tidak adil.

Misal:

```text
Tenant A submit 10.000 report tasks
Tenant B submit 5 urgent compliance tasks
```

Jika queue FIFO global, tenant B menunggu ribuan task tenant A.

Ini buruk jika tenant B punya SLA/regulatory deadline.

---

### 9.2 Fairness model

Beberapa model fairness:

#### Per-user limit

```text
Max 3 running jobs per user
Max 50 queued jobs per user
```

#### Per-tenant limit

```text
Max 10 running jobs per agency
Max 1 heavy report per agency
```

#### Per-workload class limit

```text
Interactive async: high priority
Compliance deadline: high priority
Reports: medium
Cache warming: low
```

#### Weighted fair scheduling

```text
Agency A weight 5
Agency B weight 2
Agency C weight 1
```

#### Aging priority

Task yang menunggu lama perlahan naik prioritas agar tidak starvation.

---

### 9.3 Fairness untuk regulatory systems

Dalam sistem case management/regulatory enforcement, fairness tidak selalu berarti semua request sama.

Contoh prioritas yang masuk akal:

1. user-facing case action yang sedang menunggu response;
2. statutory deadline computation;
3. enforcement escalation job;
4. external registry sync yang memblokir keputusan;
5. bulk report;
6. cache warming;
7. analytics non-critical.

Fairness harus mengikuti business criticality, bukan hanya technical FIFO.

---

## 10. Backpressure Strategies

### 10.1 Reject

Gunakan reject jika:

- pekerjaan tidak wajib diterima;
- client bisa retry;
- sistem sedang overload;
- menerima pekerjaan akan memperburuk semua request.

HTTP mapping:

```text
429 Too Many Requests
  -> client terlalu banyak request atau quota habis

503 Service Unavailable
  -> sistem/downstream sementara tidak mampu menerima pekerjaan
```

Tambahkan:

```text
Retry-After: <seconds>
```

Namun jangan memberi `Retry-After` palsu jika sistem tidak tahu kapan pulih.

---

### 10.2 Defer

Gunakan defer jika:

- pekerjaan penting;
- bisa diproses nanti;
- butuh audit/restart;
- user bisa melihat status.

Pattern:

```text
POST /bulk-actions
  -> validate
  -> authorize
  -> create job request
  -> return 202 Accepted + jobId

GET /jobs/{jobId}
  -> status QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED
```

---

### 10.3 Shed

Gunakan shed untuk pekerjaan opsional.

Contoh:

```text
Jika enrichment service overload:
  return core case data tanpa enrichment
  mark enrichmentStatus = UNAVAILABLE_TEMPORARILY
```

Penting: Jangan silently shed sesuatu yang business-critical.

---

### 10.4 Degrade

Degrade berbeda dari shed. Degrade tetap memberikan fungsi, tetapi dengan kualitas lebih rendah.

Contoh:

- gunakan cached result lama;
- tampilkan summary bukan detail;
- generate report async bukan sync;
- kurangi halaman/limit data;
- disable expensive filter sementara.

---

### 10.5 Durable enqueue

Jika request user memicu pekerjaan panjang:

```text
User action
  -> job request row
  -> status QUEUED
  -> worker claims job
  -> execute with concurrency control
  -> write status/progress
```

Ini backpressure yang paling jujur untuk pekerjaan penting.

Sistem tidak berkata “sudah selesai”, tetapi “sudah diterima dan akan diproses sesuai kapasitas”.

---

## 11. Designing a Capacity Policy

### 11.1 Langkah 1 — Klasifikasi workload

Buat inventory:

| Workload | Source | Sync/Async | Criticality | Downstream | Durability Needed | Latency Target |
|---|---|---:|---:|---|---:|---:|
| Case submit | HTTP | Sync | High | DB, validation | Yes | < 1s |
| Email notification | Event | Async | Medium | SMTP/API | Yes | < 5m |
| Report generation | HTTP/Admin | Async | Medium | DB, PDF | Yes | < 30m |
| Registry sync | Scheduler | Async | High | External API, DB | Yes | < 1h |
| Cache warming | Scheduler | Async | Low | DB/cache | No/Low | Best effort |

---

### 11.2 Langkah 2 — Identifikasi bottleneck

Untuk setiap workload, tanyakan:

- Butuh DB connection berapa lama?
- CPU-heavy atau I/O-heavy?
- Memory per task berapa?
- Ada external quota?
- Ada lock/table hotspot?
- Ada transaction panjang?
- Ada file/socket yang terbatas?
- Bisa dipartisi?
- Bisa di-retry?
- Bisa di-cancel?

---

### 11.3 Langkah 3 — Tentukan resource budget

Contoh DB pool:

```text
Total DB pool per pod: 50
Reserve for online request: 30
Reserve for system/admin: 5
Reserve for batch/report: 10
Reserve safety headroom: 5
```

Maka jangan biarkan batch/report menjalankan 50 concurrent DB tasks.

---

### 11.4 Langkah 4 — Tentukan queue policy

Untuk setiap workload:

```text
queue type: memory / database / broker
queue max size: N
queue ordering: FIFO / priority / per tenant
queue TTL: duration
on full: reject / shed / durable defer / block short
```

---

### 11.5 Langkah 5 — Tentukan overload response

Contoh:

| Condition | Response |
|---|---|
| interactive executor full | 503 fast fail |
| per-user report quota reached | 429 with message |
| registry sync backlog high | stop accepting manual sync |
| email provider 429 | backoff and pause worker |
| DB pool saturation | reduce background concurrency |
| low-priority cache job overloaded | skip cycle |

---

### 11.6 Langkah 6 — Observability wajib

Tanpa metrics, capacity policy hanya asumsi.

Minimal:

```text
executor.active
executor.queue.size
executor.queue.remaining
executor.completed
executor.failed
executor.rejected
executor.task.duration
executor.queue.wait
workload.inflight
workload.backlog
workload.oldestQueuedAge
workload.retry.count
workload.timeout.count
workload.cancellation.count
downstream.latency
downstream.errorRate
downstream.rateLimited
```

---

## 12. Concrete Pattern: Async Request with Admission Control

### 12.1 Problem

Endpoint menerima permintaan generate report. Report berat, butuh DB query dan PDF generation. Tidak boleh dijalankan sync di request thread.

Naive implementation:

```java
@POST
@Path("/reports")
public Response generate(ReportRequest request) {
    executor.submit(() -> reportService.generate(request));
    return Response.accepted().build();
}
```

Masalah:

- tidak ada job ID;
- tidak ada duplicate control;
- tidak ada capacity check;
- tidak ada durability;
- jika submit gagal tidak jelas;
- jika server restart task hilang;
- tidak ada status/progress;
- user bisa spam request.

---

### 12.2 Better design

```text
POST /reports
  -> validate request
  -> authorize user
  -> compute idempotency key
  -> check per-user quota
  -> check global report backlog
  -> persist report_job(status=QUEUED)
  -> return 202 + jobId

Report worker
  -> claim queued job using DB lock/atomic update
  -> acquire report bulkhead slot
  -> execute with timeout
  -> update progress
  -> write output manifest
  -> mark succeeded/failed
```

---

### 12.3 Example code: API admission layer

```java
@RequestScoped
@Path("/reports")
public class ReportResource {

    @Inject
    ReportJobService reportJobService;

    @POST
    public Response requestReport(ReportRequest request, @Context SecurityContext securityContext) {
        String userId = securityContext.getUserPrincipal().getName();

        ReportJobCreated created = reportJobService.createJobIfAllowed(userId, request);

        return Response.accepted(new ReportJobResponse(created.jobId(), created.status()))
                .header("Location", "/reports/jobs/" + created.jobId())
                .build();
    }
}
```

---

### 12.4 Example code: capacity check before durable enqueue

```java
@ApplicationScoped
public class ReportJobService {

    @Inject
    ReportJobRepository repository;

    @Transactional
    public ReportJobCreated createJobIfAllowed(String userId, ReportRequest request) {
        String idempotencyKey = computeIdempotencyKey(userId, request);

        Optional<ReportJob> existing = repository.findByIdempotencyKey(idempotencyKey);
        if (existing.isPresent()) {
            ReportJob job = existing.get();
            return new ReportJobCreated(job.id(), job.status());
        }

        long userQueued = repository.countActiveJobsByUser(userId);
        if (userQueued >= 3) {
            throw new TooManyRequestsException("You already have too many active report jobs");
        }

        long globalQueued = repository.countActiveJobsByType("REPORT");
        if (globalQueued >= 1_000) {
            throw new ServiceBusyException("Report queue is full. Try again later.");
        }

        ReportJob job = ReportJob.queued(userId, request, idempotencyKey);
        repository.insert(job);

        return new ReportJobCreated(job.id(), job.status());
    }
}
```

---

### 12.5 Example code: worker with bulkhead

```java
@ApplicationScoped
public class ReportWorker {

    private final Semaphore reportSlots = new Semaphore(3);

    @Resource
    ManagedExecutorService executor;

    @Inject
    ReportJobRepository repository;

    @Inject
    ReportGenerator generator;

    public void triggerPoll() {
        List<ReportJob> jobs = repository.claimNextQueuedJobs(10);

        for (ReportJob job : jobs) {
            executor.submit(() -> runOne(job.id()));
        }
    }

    private void runOne(String jobId) {
        boolean acquired = false;
        try {
            acquired = reportSlots.tryAcquire(5, TimeUnit.SECONDS);
            if (!acquired) {
                repository.releaseClaim(jobId, "No report capacity available");
                return;
            }

            repository.markRunning(jobId);
            generator.generate(jobId);
            repository.markSucceeded(jobId);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            repository.markStopped(jobId, "Interrupted");
        } catch (Exception e) {
            repository.markFailed(jobId, e.getMessage());
        } finally {
            if (acquired) {
                reportSlots.release();
            }
        }
    }
}
```

Catatan penting:

- semaphore bukan pengganti durable queue;
- semaphore hanya membatasi running concurrency;
- job repository menjaga durability, status, restartability;
- `ManagedExecutorService` menjaga container semantics;
- kapasitas report dipisah dari request path.

---

## 13. Concrete Pattern: Fan-Out/Fan-In with Limit

### 13.1 Problem

Endpoint perlu mengambil data dari 50 external registry records.

Naive implementation:

```java
List<CompletableFuture<Result>> futures = ids.stream()
    .map(id -> CompletableFuture.supplyAsync(() -> registryClient.fetch(id)))
    .toList();

CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
```

Masalah:

- memakai common pool jika executor tidak disuplai;
- tidak ada concurrency limit;
- semua call ditembak bersamaan;
- tidak ada rate limit;
- tidak ada timeout per call;
- failure/cancellation tidak jelas;
- bisa melanggar quota external API.

---

### 13.2 Better design with managed executor and semaphore

```java
@ApplicationScoped
public class RegistryFanoutService {

    @Resource
    ManagedExecutorService executor;

    private final Semaphore registryInFlight = new Semaphore(10);

    @Inject
    RegistryClient registryClient;

    public List<RegistryResult> fetchAll(List<String> ids) {
        List<CompletableFuture<RegistryResult>> futures = ids.stream()
                .map(this::fetchOneLimited)
                .toList();

        CompletableFuture<Void> all = CompletableFuture.allOf(
                futures.toArray(new CompletableFuture[0])
        );

        all.orTimeout(15, TimeUnit.SECONDS).join();

        return futures.stream()
                .map(CompletableFuture::join)
                .toList();
    }

    private CompletableFuture<RegistryResult> fetchOneLimited(String id) {
        return CompletableFuture.supplyAsync(() -> {
            boolean acquired = false;
            try {
                acquired = registryInFlight.tryAcquire(500, TimeUnit.MILLISECONDS);
                if (!acquired) {
                    throw new ServiceBusyException("Registry fan-out capacity exceeded");
                }
                return registryClient.fetchWithTimeout(id);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new CancellationException("Interrupted while waiting for registry slot");
            } finally {
                if (acquired) {
                    registryInFlight.release();
                }
            }
        }, executor);
    }
}
```

Ini belum menyelesaikan rate limit per menit, tetapi sudah membatasi in-flight calls.

Untuk quota external API, tambahkan rate limiter.

---

## 14. Adaptive Concurrency: Berguna, Tapi Jangan Terlalu Cepat Dipakai

Adaptive concurrency berarti limit berubah berdasarkan kondisi runtime:

```text
If downstream latency increases -> reduce concurrency
If downstream healthy -> slowly increase concurrency
If error/429 spikes -> aggressively reduce concurrency
```

Ini powerful tetapi kompleks.

Sebelum adaptive concurrency, pastikan sudah punya:

- fixed sane limits;
- timeout;
- retry budget;
- metrics;
- dashboard;
- manual override;
- clear owner;
- test overload.

Tanpa observability, adaptive algorithm hanya membuat failure lebih sulit dipahami.

---

## 15. Virtual Threads dan Capacity Control

Virtual threads membuat blocking murah, tetapi tidak membuat downstream tak terbatas.

Naive thinking:

> “Sekarang kita bisa pakai virtual thread, jadi tidak perlu limit.”

Correct thinking:

> “Sekarang kita bisa merepresentasikan banyak blocking work dengan lebih murah, tetapi tetap harus membatasi resource yang dipakai work tersebut.”

Contoh:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (String id : ids) {
        executor.submit(() -> registryClient.fetch(id));
    }
}
```

Ini bisa membuat ribuan concurrent calls jika `ids` besar.

Lebih aman:

```java
Semaphore apiSlots = new Semaphore(20);

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (String id : ids) {
        executor.submit(() -> {
            apiSlots.acquire();
            try {
                return registryClient.fetch(id);
            } finally {
                apiSlots.release();
            }
        });
    }
}
```

Di Jakarta EE, penggunaan virtual thread executor sendiri harus mengikuti dukungan container/vendor. Jika available melalui managed concurrency resource, tetap gunakan managed resource agar context/lifecycle/container semantics tidak hilang.

Rule of thumb:

```text
Virtual thread changes cost of waiting.
It does not change capacity of DB/API/CPU/business process.
```

---

## 16. Jakarta Batch dan Capacity Control

Jakarta Batch membawa problem concurrency dalam bentuk lain:

- berapa job boleh running bersamaan;
- berapa partition per job;
- berapa item per chunk;
- berapa writer call per second;
- berapa DB cursor/connection;
- kapan job boleh berjalan;
- apakah batch boleh bersaing dengan online traffic.

---

### 16.1 Job-level limit

Contoh policy:

```text
Max running jobs globally: 10
Max running jobs per job type: 2
Max heavy DB jobs: 1
Max report jobs per agency: 1
Max external sync jobs: 1
```

---

### 16.2 Partition-level limit

Partitioning bukan “semakin banyak semakin cepat”.

Jika 1 partition butuh 1 DB connection:

```text
20 partitions = up to 20 DB connections
```

Jika batch jalan di 4 pod:

```text
4 pods × 20 partitions = 80 possible DB connections
```

Jika DB pool dan DB server tidak disiapkan untuk itu, sistem online bisa terganggu.

---

### 16.3 Chunk size sebagai capacity lever

Commit interval terlalu kecil:

- terlalu banyak transaction;
- overhead commit tinggi;
- throughput rendah.

Commit interval terlalu besar:

- transaction panjang;
- undo/redo pressure;
- lock lebih lama;
- restart mengulang lebih banyak work;
- memory pressure.

Tidak ada angka universal. Chunk size harus diuji berdasarkan:

- item cost;
- DB write pattern;
- error handling;
- restart tolerance;
- memory footprint;
- batch window.

---

## 17. Interaction with Database Connection Pool

### 17.1 DB pool adalah limit nyata yang sering dilupakan

Contoh:

```text
HTTP request pool: 200
Managed executor: 100
Batch partitions: 40
DB pool: 60
```

Total potential DB demand jauh lebih besar dari 60.

Jika semua workload bisa memakai DB pool yang sama tanpa policy, maka fairness ditentukan oleh siapa yang lebih dulu mengambil connection.

Ini berbahaya.

---

### 17.2 Reserve capacity for online traffic

Untuk aplikasi case management, online traffic sering harus diprioritaskan dibanding batch non-urgent.

Contoh:

```text
DB pool total: 80
Online request target max: 50
Background async max: 10
Batch max: 15
Operational/admin reserve: 5
```

Jika tidak bisa membuat physical pool terpisah, gunakan logical semaphore.

---

### 17.3 Connection timeout sebagai backpressure

Connection pool acquisition timeout jangan terlalu panjang.

Jika task menunggu connection 60 detik:

- thread/virtual thread tetap hidup;
- user menunggu;
- queue bertambah;
- transaction mungkin timeout;
- retry manual terjadi.

Lebih baik fail fast untuk workload yang tidak critical, atau durable defer untuk workload penting.

---

## 18. Retry Storm dan Load Multiplication

Retry memperbaiki transient failure hanya jika dikontrol.

Tanpa kontrol, retry memperbesar load saat downstream sedang lemah.

Contoh:

```text
Original traffic: 100 req/s
Each failure retried 3 times immediately
Effective traffic: up to 400 req/s
```

Jika semua instance retry bersamaan, terjadi synchronized retry storm.

---

### 18.1 Retry budget

Retry budget membatasi retry sebagai persentase atau jumlah tertentu.

Contoh:

```text
Max retries: 2
Only retry transient error
Use exponential backoff + jitter
Global retry rate max: 20/sec
Stop retry if circuit open
```

---

### 18.2 Retry harus menghormati backpressure

Jika downstream mengembalikan 429 atau 503 dengan sinyal overload, jangan retry agresif.

```text
429 -> respect Retry-After if present
503 -> backoff
timeout -> retry only if operation idempotent
connection refused -> circuit breaker may open
```

---

## 19. Failure Modes

### 19.1 Queue explosion

Gejala:

- queue depth naik terus;
- oldest queued age naik;
- memory naik;
- latency naik;
- completed rate lebih rendah dari incoming rate.

Root cause:

- arrival > capacity;
- downstream slow;
- no rejection;
- unbounded queue;
- retry storm.

Mitigation:

- bounded queue;
- reject/defer;
- reduce intake;
- scale bottleneck;
- pause low-priority producers;
- add metrics/alerts.

---

### 19.2 Thread starvation

Gejala:

- request tidak dilayani;
- health check lambat;
- thread dump penuh waiting/blocking;
- executor active=max;
- queue tinggi.

Root cause:

- blocking call tanpa timeout;
- executor shared;
- common pool misuse;
- DB connection wait;
- lock contention.

Mitigation:

- timeout everywhere;
- separate executor/bulkhead;
- semaphore per downstream;
- fail fast;
- reduce blocking in request path.

---

### 19.3 Connection pool exhaustion

Gejala:

- DB connection acquisition timeout;
- active connections max;
- online latency spike;
- batch/report running;
- DB CPU may or may not be high.

Root cause:

- background workload consumes pool;
- long transaction;
- connection leak;
- too many partitions;
- slow queries.

Mitigation:

- reserve pool/bulkhead;
- tune partition/chunk;
- shorten transaction;
- leak detection;
- query optimization;
- separate pool where appropriate.

---

### 19.4 Downstream collapse due to fan-out

Gejala:

- external API 429/503;
- retries increase;
- timeout increase;
- local queue grows;
- user-facing endpoint slow.

Root cause:

- unlimited fan-out;
- no rate limit;
- no circuit breaker;
- retry without jitter;
- all nodes schedule same job.

Mitigation:

- rate limiter;
- concurrency limiter;
- circuit breaker;
- distributed scheduling guard;
- jitter;
- cache/dedup.

---

### 19.5 Fairness violation

Gejala:

- one tenant/user dominates queue;
- urgent small jobs wait behind huge batch;
- support tickets from unaffected users;
- global metrics look okay but individual experience bad.

Root cause:

- FIFO global queue;
- no per-user/per-tenant quota;
- no priority aging;
- no workload class isolation.

Mitigation:

- per-tenant quota;
- priority queue;
- weighted fair scheduling;
- separate queues;
- SLA-aware admission.

---

## 20. Observability and Alerting

### 20.1 Metrics that matter

Executor metrics:

```text
active_count
pool_size
largest_pool_size
queue_size
queue_remaining_capacity
completed_task_count
rejected_task_count
submitted_task_count
```

Workload metrics:

```text
inflight_by_workload
queued_by_workload
oldest_queued_age_by_workload
started_per_minute
completed_per_minute
failed_per_minute
cancelled_per_minute
retry_per_minute
timeout_per_minute
```

Latency metrics:

```text
queue_wait_duration
execution_duration
downstream_duration
transaction_duration
total_job_duration
```

Downstream metrics:

```text
db_pool_active
db_pool_pending
db_connection_acquire_time
db_query_latency
external_api_latency
external_api_429_count
external_api_5xx_count
```

---

### 20.2 Queue wait time is more important than most teams think

Task execution duration can look stable while queue wait explodes.

Example:

```text
Execution time: 200 ms
Queue wait: 30 seconds
Total latency: 30.2 seconds
```

If you only measure execution time, system looks healthy.

Measure:

```text
submittedAt
startedAt
completedAt
queueWait = startedAt - submittedAt
runTime = completedAt - startedAt
totalTime = completedAt - submittedAt
```

---

### 20.3 Alert examples

```text
Alert: executor queue > 80% for 5 minutes
Alert: oldest queued job age > SLA/2
Alert: rejection rate > baseline
Alert: DB pool pending > 0 for 3 minutes
Alert: external API 429 > threshold
Alert: retry rate > 20% of original calls
Alert: batch job running outside batch window
Alert: per-tenant active jobs exceed policy
```

---

## 21. Testing Capacity Controls

### 21.1 Unit test admission rules

Test:

- per-user quota;
- global backlog limit;
- duplicate idempotency key;
- full queue behavior;
- unauthorized workload;
- priority ordering.

---

### 21.2 Integration test overload

Simulate:

- slow DB;
- slow external API;
- 429 response;
- executor saturation;
- connection pool exhaustion;
- batch partition spike;
- scheduler overlap.

Expected result:

- system rejects/degrades/defers predictably;
- no unbounded memory growth;
- online traffic remains within SLO;
- low-priority tasks are shed first;
- metrics reveal condition clearly.

---

### 21.3 Chaos-like scenario for async workloads

Scenarios:

```text
Kill pod while jobs running
Slow external API by 10x
Return 429 for 10 minutes
Make DB connection acquisition slow
Submit 10x normal report workload
Run batch while online traffic spikes
Trigger scheduler on all nodes
```

Pass criteria:

- no duplicate harmful side effect;
- backlog bounded or durable;
- restart works;
- online critical path protected;
- operator can see and control state.

---

## 22. Sizing Worksheet

Use this worksheet before setting executor/thread/partition numbers.

### 22.1 Workload description

```text
Workload name:
Source:
Criticality:
Sync/async:
Durability required:
Expected arrival rate:
Burst arrival rate:
Latency target:
Max acceptable queue age:
```

### 22.2 Resource usage

```text
CPU-bound or I/O-bound:
Average execution time:
p95 execution time:
Memory per task:
DB connection needed: yes/no
Average DB time:
External API used:
External API quota:
File/socket/resource needed:
Lock/contention risk:
```

### 22.3 Capacity calculation

```text
Target throughput λ:
Average service time W:
Estimated concurrency L = λ × W:
Safety factor:
Max concurrency:
Queue capacity:
Queue TTL:
Rejection strategy:
Retry strategy:
Timeout strategy:
```

### 22.4 Isolation

```text
Dedicated executor: yes/no
Dedicated queue: yes/no
Dedicated DB pool: yes/no
Semaphore/bulkhead: yes/no
Per-tenant quota:
Per-user quota:
Priority class:
```

### 22.5 Observability

```text
Metrics exposed:
Dashboard:
Alerts:
Runbook:
Manual pause/resume:
Manual concurrency override:
```

---

## 23. Design Heuristics

### 23.1 Keep queues small for interactive workloads

Interactive workload should fail/degrade fast rather than hide behind long queue.

If user is waiting, queue wait is user latency.

---

### 23.2 Use durable queues for important long work

If work matters after restart, do not rely only on in-memory executor queue.

Use:

- DB job table;
- message broker;
- Jakarta Batch job repository;
- workflow engine;
- external orchestrator.

---

### 23.3 Limit by bottleneck, not by CPU fantasy

Executor size should follow downstream capacity.

Ask:

```text
What resource does each task hold?
How many of that resource can safely be used?
Who else needs it?
```

---

### 23.4 Prefer explicit rejection over silent death

A clear `429/503` is often better than accepting work that will timeout later.

---

### 23.5 Retry only with idempotency

If operation is not idempotent, retry can corrupt business state.

---

### 23.6 Capacity policy is business policy too

Deciding who gets execution capacity first is not purely technical.

It must reflect:

- SLA;
- regulatory deadlines;
- user impact;
- tenant fairness;
- operational risk;
- auditability.

---

## 24. Anti-Patterns

### 24.1 One executor for everything

```text
All async tasks share one executor.
```

Result:

- no isolation;
- noisy neighbor;
- poor metrics;
- difficult tuning.

---

### 24.2 Unbounded queue

```text
Queue grows until memory dies.
```

Result:

- delayed failure;
- OOM;
- stale work;
- impossible SLO.

---

### 24.3 Async without admission control

```java
executor.submit(task);
return 202;
```

without checking capacity/durability/idempotency.

Result:

- fake success;
- lost work;
- invisible overload.

---

### 24.4 Unlimited fan-out

```text
For each item, start async call.
```

Result:

- downstream overload;
- 429;
- retry storm;
- self-DOS.

---

### 24.5 Treating virtual threads as infinite capacity

Virtual threads reduce thread cost, not database/API/CPU constraints.

---

### 24.6 Batch partition count copied from CPU core count

Partition count must consider DB/API/lock/chunk behavior, not only CPU.

---

### 24.7 No fairness policy

Global FIFO queue lets high-volume users dominate.

---

### 24.8 Retry without budget

Retry can multiply failure traffic and delay recovery.

---

## 25. Production Checklist

Before deploying managed async/batch workload, verify:

### Admission

- [ ] There is a clear policy for accepting/rejecting/defering work.
- [ ] Per-user/per-tenant/global limits exist where needed.
- [ ] Duplicate/idempotency keys are handled.
- [ ] Long-running important work is durable.

### Capacity

- [ ] Max concurrency is defined per workload.
- [ ] Downstream capacity is known.
- [ ] DB pool impact is calculated.
- [ ] External API quota is respected.
- [ ] Batch partition count is bounded.

### Isolation

- [ ] Critical and non-critical workloads are separated.
- [ ] Background jobs cannot consume all request capacity.
- [ ] Bulkheads exist for shared downstreams.
- [ ] Scheduler does not run duplicate heavy jobs on all nodes.

### Backpressure

- [ ] Queue is bounded or durable.
- [ ] Queue full behavior is defined.
- [ ] Rejection responses are meaningful.
- [ ] Low-priority work can be shed/degraded.

### Timeout and Retry

- [ ] Every downstream call has timeout.
- [ ] Retry uses backoff and jitter.
- [ ] Retry budget exists.
- [ ] Retry only happens for idempotent operations.

### Observability

- [ ] Active/queued/rejected/completed metrics exist.
- [ ] Queue wait time is measured.
- [ ] Oldest queued age is visible.
- [ ] Downstream latency/error/rate-limit metrics exist.
- [ ] Alerts and runbooks exist.

### Operations

- [ ] Operators can pause/resume workload.
- [ ] Operators can inspect backlog.
- [ ] Operators can reduce concurrency if needed.
- [ ] Shutdown/redeploy behavior is tested.
- [ ] Overload scenarios are tested.

---

## 26. Ringkasan

Concurrency control adalah inti dari production-grade async engineering.

Managed concurrency membuat eksekusi aman terhadap container, tetapi tidak otomatis membuat sistem aman terhadap overload. Kamu tetap harus mendesain:

- berapa banyak pekerjaan boleh running;
- berapa banyak boleh queued;
- siapa yang mendapat prioritas;
- kapan pekerjaan harus ditolak;
- kapan pekerjaan harus durable;
- bagaimana downstream dilindungi;
- bagaimana retry tidak memperburuk failure;
- bagaimana operator melihat dan mengontrol sistem.

Mental model utama:

```text
Concurrency is in-flight work.
Queue is delayed pressure.
Throughput is completion rate.
Capacity is throughput under latency/error/resource constraints.
Backpressure is honesty under overload.
Bulkhead is isolation under failure.
Fairness is governance of shared capacity.
```

Untuk engineer level tinggi, pertanyaan paling penting bukan:

```text
Can we run this asynchronously?
```

Tetapi:

```text
What is the safe execution envelope for this workload?
```

Jika safe envelope jelas, async execution menjadi alat. Jika tidak, async execution menjadi incident generator.

---

## 27. Latihan / Thought Experiment

### Latihan 1 — Report workload

Sebuah endpoint report menerima 1.000 request dalam 10 menit. Setiap report membutuhkan:

- 20 detik DB query;
- 5 detik PDF generation;
- 1 DB connection selama query;
- memory 100 MB selama PDF generation.

DB pool total 80. Online request butuh minimal 50 connection agar stabil.

Pertanyaan:

1. Berapa concurrency report yang aman?
2. Apakah report boleh pakai in-memory executor queue?
3. Bagaimana per-user quota sebaiknya?
4. Apa response API yang benar?
5. Metrik apa yang wajib ada?

---

### Latihan 2 — External API limit

External API memberi limit 300 request/minute. Average latency 800 ms, p95 latency 3 detik.

Pertanyaan:

1. Berapa rate limit lokal?
2. Berapa concurrency limit aman?
3. Apa yang dilakukan jika API mengembalikan 429?
4. Bagaimana mencegah semua pod melanggar quota global?
5. Apakah virtual threads mengubah quota ini?

---

### Latihan 3 — Batch partitioning

Batch job memproses 10 juta record. Setiap partition membuka reader DB dan writer DB. Tim ingin membuat 100 partition karena node Kubernetes ada banyak.

Pertanyaan:

1. Apa resource yang harus dicek sebelum menyetujui 100 partition?
2. Bagaimana menguji apakah partition count mempercepat atau memperburuk?
3. Bagaimana membatasi dampak ke online traffic?
4. Bagaimana mengukur skew antar partition?
5. Apa restart behavior jika satu partition gagal?

---

## 28. Koneksi ke Part Berikutnya

Part ini membahas batas kapasitas dan backpressure pada level sistem.

Part berikutnya akan masuk ke detail yang lebih spesifik:

```text
Part 14 — Cancellation, Timeout, Retry, and Interruption Semantics
```

Di sana kita akan membahas bagaimana task yang sudah berjalan dihentikan, dibatasi waktunya, di-retry secara aman, dan bagaimana `Thread.interrupt`, `Future.cancel`, timeout DB/HTTP/transaction, serta cancellation-safe cleanup harus dipahami dalam workload Jakarta EE.

---

## 29. Status Seri

Seri belum selesai.

Selesai sampai part ini:

- Part 0 — Orientation
- Part 1 — Historical Map
- Part 2 — Container Integrity
- Part 3 — ManagedExecutorService
- Part 4 — ManagedScheduledExecutorService
- Part 5 — ManagedThreadFactory
- Part 6 — ContextService
- Part 7 — Transactions Across Async Boundaries
- Part 8 — Security, Identity, and Authorization
- Part 9 — CDI, Interceptors, Events, and Async Boundaries
- Part 10 — CompletableFuture in Jakarta EE
- Part 11 — Virtual Threads, Jakarta EE, and Managed Concurrency
- Part 12 — Structured Concurrency and Scoped Values
- Part 13 — Concurrency Control, Capacity, Backpressure, Bulkheads, and Fairness

Berikutnya:

```text
Part 14 — Cancellation, Timeout, Retry, and Interruption Semantics
File: 14-cancellation-timeout-retry-interruption-semantics.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 12 — Structured Concurrency and Scoped Values for Enterprise Java](./12-structured-concurrency-scoped-values-enterprise-java.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 14 — Cancellation, Timeout, Retry, and Interruption Semantics](./14-cancellation-timeout-retry-interruption-semantics.md)

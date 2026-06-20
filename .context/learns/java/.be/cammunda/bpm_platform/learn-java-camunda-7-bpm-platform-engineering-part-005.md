# learn-java-camunda-7-bpm-platform-engineering-part-005.md

# Part 005 — Job Executor Internals: Acquisition, Locking, Backoff, Deployment Awareness, dan Cluster Behavior

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `005`  
> Topik: Job Executor Internals  
> Target: engineer yang ingin memahami Camunda 7 bukan hanya sebagai API workflow, tetapi sebagai runtime durable execution yang berjalan di atas database, thread pool, locking, retry, dan cluster coordination.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya, kita sudah membangun fondasi penting:

- `part-000`: orientasi, scope, dan mental model Camunda 7 sebagai durable process engine.
- `part-001`: arsitektur engine, public service API, command pattern, command context, flush, dan transaction lifecycle.
- `part-002`: execution tree, token semantics, scope, activity instance, dan event scope.
- `part-003`: transaction boundary, wait state, atomic operation, dan consistency model.
- `part-004`: async continuation, job creation, retry semantics, dan idempotency design.

Part ini melanjutkan langsung dari `part-004`. Kalau `part-004` menjawab:

> “Kapan dan kenapa engine membuat job?”

maka part ini menjawab:

> “Setelah job ada di database, siapa yang mengambilnya, bagaimana lock bekerja, bagaimana cluster menghindari double execution, kenapa job bisa telat, kenapa job bisa starving, dan bagaimana men-tune job executor tanpa merusak correctness?”

Camunda 7 Job Executor adalah salah satu bagian paling penting untuk production engineering. Banyak masalah produksi yang terlihat seperti “BPMN error” sebenarnya adalah masalah job executor:

- async service task tidak jalan,
- timer terlambat,
- retry tidak terjadi sesuai ekspektasi,
- process instance tampak stuck,
- node tertentu mengambil job yang tidak punya class delegate,
- job duplicate karena lock expired,
- thread pool penuh karena remote API lambat,
- optimistic locking storm di parallel join,
- history cleanup mengganggu job bisnis,
- job executor aktif di node yang salah,
- cluster semua node polling table yang sama secara agresif.

Top 1% engineer tidak hanya tahu properti konfigurasi. Mereka memahami bahwa Job Executor adalah **scheduler terdistribusi berbasis database** dengan batasan realistik: polling, row locking, optimistic locking, queue lokal, thread pool, retry, dan non-deterministic acquisition order.

---

## 1. Core Mental Model: Job Executor Itu Bukan Message Broker

Kesalahan awal yang sering terjadi adalah memperlakukan Camunda Job Executor seperti Kafka consumer, RabbitMQ worker, atau distributed task queue modern.

Itu framing yang kurang tepat.

Camunda 7 Job Executor lebih akurat dipahami sebagai:

> Background scheduler internal engine yang mem-poll tabel job di database, mengunci job yang eligible, memasukkannya ke queue lokal, lalu menjalankannya di thread pool lokal untuk melanjutkan process execution.

Artinya:

```text
BPMN async/timer/event job
        |
        v
ACT_RU_JOB row
        |
        v
Job acquisition thread polls DB
        |
        v
Lock job row with LOCK_OWNER_ and LOCK_EXP_TIME_
        |
        v
Put acquired job into local in-memory queue
        |
        v
Worker thread executes job through engine command
        |
        v
Commit success / decrement retry / incident / unlock behavior
```

Konsekuensi desainnya besar:

1. **Database adalah coordination mechanism.**  
   Job executor tidak memakai broker eksternal. Semua node melihat tabel `ACT_RU_JOB` yang sama.

2. **Acquisition adalah polling.**  
   Job tidak “push” ke worker. Worker mencari job yang eligible.

3. **Lock adalah time-based reservation.**  
   Node yang mengambil job menulis `LOCK_OWNER_` dan `LOCK_EXP_TIME_`. Kalau lock expired sebelum job selesai, job bisa eligible lagi.

4. **Execution bukan exactly-once dari sudut side-effect eksternal.**  
   Engine berusaha agar satu job tidak dijalankan paralel oleh dua executor pada saat normal, tetapi crash, timeout, rollback, atau lock expiry tetap memaksa kita mendesain delegate idempotent.

5. **Cluster scaling menambah polling concurrency.**  
   Menambah node tidak otomatis menaikkan throughput linear. Bisa menaikkan contention di DB, lock conflict, connection pool pressure, dan duplicate acquisition attempts.

6. **Thread pool adalah resource finite.**  
   Kalau job melakukan blocking remote call lama, semua worker thread bisa habis walaupun CPU idle.

7. **Timer bukan real-time scheduler.**  
   `DUEDATE_` adalah earliest eligible time, bukan guaranteed execution time.

---

## 2. Apa Itu Job dalam Camunda 7?

Camunda 7 membuat job untuk beberapa tujuan utama:

- asynchronous continuation,
- timer event,
- asynchronous event handling,
- batch operation,
- history cleanup,
- beberapa internal maintenance operation.

Dokumentasi Camunda mendefinisikan job sebagai representasi eksplisit dari task untuk memicu process execution. Job dibuat saat timer event atau task dengan asynchronous execution dicapai, lalu job processing dipisah menjadi job creation, job acquisition, dan job execution.

Secara runtime, job disimpan terutama di tabel:

```text
ACT_RU_JOB
```

Kolom penting yang perlu dipahami:

```text
ID_              identifier job
REV_             optimistic locking revision
TYPE_            jenis job, misalnya timer atau async continuation
LOCK_OWNER_      executor/node yang sedang memegang lock
LOCK_EXP_TIME_   kapan lock dianggap expired
RETRIES_         sisa retry
EXCEPTION_MSG_   ringkasan exception terakhir
EXCEPTION_STACK_ID_ referensi stacktrace di ACT_GE_BYTEARRAY
DUEDATE_         waktu job eligible dieksekusi
PRIORITY_        priority job jika priority dipakai
PROCESS_INSTANCE_ID_
EXECUTION_ID_
PROCESS_DEF_ID_
DEPLOYMENT_ID_
HANDLER_TYPE_
HANDLER_CFG_
SUSPENSION_STATE_
```

Tidak semua kolom selalu relevan untuk semua job type, tetapi beberapa kolom di atas cukup untuk 80% troubleshooting.

Mental model row job:

```text
Job row = durable promise bahwa process engine harus melanjutkan sesuatu nanti.
```

Contoh:

```text
User completes task
  -> process reaches service task asyncBefore
  -> engine creates ACT_RU_JOB row
  -> transaction commits
  -> user request returns success
  -> later job executor acquires row
  -> delegate executes in background
```

---

## 3. Job Creation vs Acquisition vs Execution

Job lifecycle minimal:

```text
[Creation] -> [Acquisition] -> [Execution] -> [Success/Delete]
                                      |
                                      v
                                 [Failure/Retry]
                                      |
                                      v
                                  [Incident]
```

### 3.1 Job Creation

Job creation terjadi di dalam transaction process execution.

Contoh untuk `asyncBefore`:

```text
caller thread enters process execution
process reaches activity with asyncBefore
engine creates job row
engine stops synchronous continuation
commit transaction
```

Pada titik ini delegate belum jalan. Yang durable baru instruksi: “lanjutkan dari titik ini nanti”.

### 3.2 Job Acquisition

Acquisition dilakukan oleh acquisition thread milik job executor.

Pseudocode konseptual:

```java
while (jobExecutorActive) {
  List<Job> jobs = queryAcquirableJobs(maxJobsPerAcquisition);

  for (Job job : jobs) {
    tryLock(job, lockOwner, now + lockTime);
  }

  submitLockedJobsToLocalQueue(jobs);

  waitAccordingToBackoffStrategy();
}
```

Dalam cluster, semua node bisa menjalankan loop serupa terhadap tabel yang sama.

### 3.3 Job Execution

Execution dilakukan oleh thread pool.

Pseudocode konseptual:

```java
workerThread.run(() -> {
  try {
    executeJobCommand(jobId);
    // engine continues execution
    // may create more jobs
    // may reach wait state
    // may end process
    commit();
  } catch (Throwable t) {
    decrementRetriesOrCreateIncident();
    storeExceptionDetails();
    commitFailureState();
  }
});
```

Job execution sendiri adalah engine command baru, dengan command context baru dan transaction baru.

---

## 4. Acquirable Job: Syarat Job Bisa Diambil

Job tidak otomatis bisa diambil hanya karena row-nya ada.

Secara praktis job harus memenuhi kondisi seperti:

1. `DUEDATE_ <= now`,
2. lock tidak aktif atau sudah expired,
3. `RETRIES_ > 0`,
4. tidak suspended,
5. cocok dengan deployment awareness jika mode itu aktif,
6. cocok dengan priority range jika priority range digunakan,
7. cocok dengan engine/process definition visibility.

Dokumentasi Camunda menyebut job acquirable jika due date sudah lewat, tidak terkunci, dan retry belum habis. Locking dilakukan dengan meng-update `LOCK_EXP_TIME_` dan `LOCK_OWNER_`, sementara optimistic locking melalui `REV_` menangani beberapa executor yang mencoba mengunci job yang sama secara bersamaan.

### 4.1 Due Date Bukan Deadline

`DUEDATE_` berarti:

```text
earliest time job may be acquired
```

Bukan:

```text
time job is guaranteed to execute
```

Kalau job executor sedang penuh, DB lambat, acquisition backoff tinggi, atau node mati, job bisa dieksekusi jauh setelah due date.

Untuk regulatory SLA, jangan menganggap timer sebagai guarantee real-time. Timer adalah trigger eventual.

Model yang lebih benar:

```text
SLA due date = business state
Timer job = mechanism to detect/act after due date
```

Jadi SLA harus tetap tersimpan sebagai data bisnis, bukan hanya tersirat di timer.

---

## 5. Locking Semantics: LOCK_OWNER_ dan LOCK_EXP_TIME_

Saat node berhasil mengakuisisi job, ia mengisi:

```text
LOCK_OWNER_    = unique id executor/node
LOCK_EXP_TIME_ = now + lockTimeInMillis
```

Ini bukan lock database yang dipegang selama job berjalan. Ini adalah **time-based lease**.

Visual:

```text
T0: job exists
    LOCK_OWNER_ = null
    LOCK_EXP_TIME_ = null or past

T1: node-A acquires job
    LOCK_OWNER_ = node-A
    LOCK_EXP_TIME_ = T1 + 5 minutes

T2: node-A executes job

T3: node-A commits success
    job row deleted
```

Failure case:

```text
T1: node-A acquires job, lock until T1 + 5m
T2: node-A starts remote API call
T6: remote API still hanging, lock expired
T7: node-B sees job acquirable again
T8: node-B locks and executes same job
T9: node-A eventually returns and tries commit
```

Implikasi:

- Long-running delegate yang melebihi lock time berbahaya.
- Blocking remote call harus punya timeout lebih kecil dari lock time.
- Delegate harus idempotent.
- Lebih aman memindahkan long-running work ke external task atau queue eksternal.

### 5.1 Lock Time Bukan Timeout Eksekusi

`lockTimeInMillis` tidak membunuh thread yang lama jalan.

Ia hanya menentukan kapan job boleh terlihat lagi oleh acquisition.

Jadi menaikkan lock time menyelesaikan sebagian duplicate-acquisition risk, tetapi tidak menyelesaikan root cause long blocking work.

---

## 6. Optimistic Locking dalam Acquisition

Di cluster, dua node bisa membaca job yang sama sebagai acquirable.

```text
node-A reads job J
node-B reads job J
node-A updates J where REV_ = 1 -> success, REV_ becomes 2
node-B updates J where REV_ = 1 -> fails optimistic locking
```

Ini normal.

Optimistic locking pada acquisition bukan selalu incident. Itu adalah bagian dari mekanisme koordinasi.

Yang perlu diwaspadai:

- terlalu banyak lock conflict,
- acquisition terlalu agresif,
- banyak node polling tabel kecil,
- DB CPU tinggi,
- wait/backoff tidak sesuai,
- index buruk,
- job executor cluster terlalu banyak dibanding workload.

Heuristik:

```text
Sedikit optimistic locking conflict = normal cluster behavior.
Banyak optimistic locking conflict + throughput rendah = acquisition contention.
```

---

## 7. Acquisition Query dan Non-Determinism

Secara default, job executor tidak harus mengambil job dalam urutan tertentu. Order bisa tergantung database dan execution plan.

Ini mengejutkan bagi banyak engineer.

Contoh kesalahan asumsi:

```text
“Timer yang due duluan pasti jalan duluan.”
```

Tidak selalu.

```text
“Async job process instance A dibuat sebelum process instance B, jadi A pasti dieksekusi duluan.”
```

Tidak selalu.

```text
“Kalau ada 1000 job, Camunda akan FIFO.”
```

Tidak default.

Untuk order tertentu, Camunda menyediakan opsi seperti:

- acquire by priority,
- prefer timer jobs,
- acquire by due date.

Tetapi setiap ordering menambah biaya query dan perlu index yang sesuai.

Dokumentasi Camunda menyebut default acquisition order non-deterministic untuk menjaga query acquisition sederhana dan cepat. Opsi acquisition seperti `jobExecutorAcquireByPriority`, `jobExecutorPreferTimerJobs`, dan `jobExecutorAcquireByDueDate` dapat mengubah order, tetapi dapat mempengaruhi performa query dan disarankan dengan index yang tepat.

---

## 8. Backoff Strategy

Job executor tidak selalu polling dengan interval konstan.

Ia menggunakan backoff strategy untuk:

1. mengurangi konflik acquisition antar node,
2. mengurangi beban DB saat tidak ada job due,
3. menghindari busy polling.

Konsekuensi: job baru bisa mengalami delay sebelum diambil.

Dokumentasi Camunda menjelaskan bahwa backoff bisa membuat delay antara job creation dan execution karena delay acquisition berikutnya dapat digandakan, dengan default maximum wait time 60 detik yang bisa dikurangi melalui konfigurasi `maxWait`.

### 8.1 Backoff Mental Model

```text
No jobs found
  -> wait longer
  -> poll again
  -> still no jobs
  -> wait even longer up to maxWait

Jobs found
  -> acquire
  -> execute
  -> reduce/reset wait depending strategy
```

### 8.2 Production Symptom

Symptom:

```text
User completes task
async job baru dibuat
job baru jalan 30-60 detik kemudian
```

Kemungkinan:

- job executor sedang dalam backoff,
- `maxWait` default terlalu tinggi untuk latency requirement,
- acquisition thread jarang bangun,
- job created after executor concluded no jobs,
- cluster low load but latency-sensitive.

### 8.3 Tuning Trade-off

Menurunkan `maxWait`:

- plus: latency lebih rendah saat job baru muncul,
- minus: DB lebih sering dipoll saat idle.

Menaikkan acquisition aggressiveness:

- plus: throughput mungkin naik,
- minus: DB pressure dan lock conflict naik.

Untuk sistem enterprise, tuning tidak boleh hanya berdasarkan “ingin cepat”. Harus berdasarkan:

- target latency,
- job volume,
- DB capacity,
- number of nodes,
- connection pool,
- average job duration,
- remote dependency latency.

---

## 9. Thread Pool dan Acquired Jobs Queue

Job executor punya dua dunia berbeda:

```text
Acquisition thread
  -> mencari dan lock job di DB

Execution thread pool
  -> menjalankan job yang sudah acquired
```

Acquired job dimasukkan ke queue lokal in-memory.

```text
ACT_RU_JOB
    |
    v
acquisition thread
    |
    v
local acquired jobs queue
    |
    v
worker thread pool
```

Konsekuensi:

- Job yang sudah dilock belum tentu langsung dieksekusi kalau queue/thread penuh.
- Lock time harus mempertimbangkan waktu tunggu di queue + waktu eksekusi.
- Kalau thread pool kecil dan `maxJobsPerAcquisition` besar, job bisa menunggu di queue sambil lock time berjalan.
- Kalau queue besar, lock bisa expired sebelum job benar-benar mulai.

### 9.1 Sizing Intuition

Misal:

```text
corePoolSize = 10
maxJobsPerAcquisition = 50
avg job duration = 30s
lockTime = 5m
```

Worst-case kasar:

```text
50 jobs acquired
10 running immediately
40 queued
last batch starts after ~120s
then runs 30s
total before commit ~150s
```

Masih aman dengan lock 5m.

Tapi jika avg job duration 90s:

```text
last batch starts after ~360s
lock already expired before some jobs start/finish
```

Maka duplicate acquisition risk naik.

Rule of thumb:

```text
lockTime > worst-case local queue wait + worst-case execution time + safety margin
```

Namun jangan gunakan rule ini untuk membenarkan delegate yang melakukan remote call sangat lama. Itu smell.

---

## 10. Failed Jobs, Retries, dan Incident

Saat job execution gagal dengan exception teknis:

1. engine menangkap exception,
2. job retries dikurangi,
3. exception message/stacktrace disimpan,
4. job tidak langsung hilang,
5. job eligible lagi sesuai retry delay,
6. jika retries habis, incident dibuat.

Pseudocode:

```text
execute job
  success -> delete job
  failure -> retries = retries - 1
             store exception
             set next due date if retry delay exists
             if retries == 0 -> create incident
```

### 10.1 Retry Bukan Recovery Strategy yang Cukup

Retry hanya berguna jika failure transient.

Baik untuk:

- temporary network issue,
- remote service 503,
- database deadlock transient,
- optimistic locking retry,
- short outage.

Buruk untuk:

- invalid business data,
- null pointer karena bug deterministic,
- unauthorized credential,
- missing class delegate,
- incompatible serialized object,
- process model salah.

Jika failure deterministic, retry hanya mengulang kegagalan dan memperlambat incident visibility.

### 10.2 Exception Taxonomy

Untuk delegate production-grade, bedakan:

```text
Business rejection
  -> BPMN Error or explicit process path

Transient technical failure
  -> throw exception, allow retry

Permanent technical/configuration failure
  -> fail fast, low retry count, incident

External side-effect uncertain
  -> verify outcome through idempotency key before retry
```

---

## 11. Exclusive Jobs

Exclusive job adalah mekanisme untuk menghindari beberapa job dari process instance yang sama dijalankan paralel secara berbahaya.

Problem klasik:

```text
parallel gateway splits into 3 async service tasks
all 3 complete around same time
all 3 try to join parallel gateway
concurrent DB updates collide
optimistic locking exception
```

Dengan exclusive job, job executor berusaha agar job exclusive dari process instance yang sama dieksekusi sequential oleh thread yang sama.

Mental model:

```text
Non-exclusive:
  instance-1 job-A -> thread-1
  instance-1 job-B -> thread-2
  instance-1 job-C -> thread-3

Exclusive:
  instance-1 job-A -> thread-1
  instance-1 job-B -> thread-1
  instance-1 job-C -> thread-1
```

Dokumentasi Camunda menjelaskan bahwa exclusive job tidak dapat dijalankan bersamaan dengan exclusive job lain dari process instance yang sama. Job executor mencoba memperoleh job exclusive lain dari process instance yang sama dan mengirimnya ke worker thread yang sama, namun perilaku ini bersifat heuristic karena hanya bisa berlaku untuk job yang tersedia saat lookup.

### 11.1 Exclusive Job Bukan Global Lock

Exclusive job tidak berarti:

```text
hanya satu job di seluruh engine berjalan
```

Exclusive job berarti:

```text
sequential execution untuk job exclusive dalam process instance yang sama, sejauh job executor dapat mengatur saat acquisition
```

Process instance lain tetap bisa berjalan paralel.

### 11.2 Kapan Mematikan Exclusive?

Default exclusive sering membantu correctness.

Mematikan exclusive bisa dipertimbangkan jika:

- activity benar-benar independent,
- tidak join ke shared execution state yang sama secara cepat,
- tidak update variable global yang sama,
- throughput dalam satu process instance sangat penting,
- engineer memahami optimistic locking risk,
- ada idempotency dan retry yang aman.

Jika ragu, jangan matikan.

---

## 12. Job Prioritization

Job prioritization membantu ketika job executor overload dan beberapa job lebih penting daripada yang lain.

Contoh:

```text
High priority:
- SLA breach escalation
- payment authorization completion
- urgent enforcement action
- citizen-facing response path

Low priority:
- archival
- cleanup
- report generation
- notification digest
```

Camunda mendukung priority pada job dan acquisition berdasarkan priority jika konfigurasi diaktifkan.

Namun priority punya risiko starvation.

Jika high-priority job terus-menerus masuk, low-priority job bisa tidak pernah dieksekusi.

Solusi:

- priority range per job executor group,
- dedicated node untuk critical jobs,
- jangan mencampur history cleanup dengan urgent business jobs di resource yang sama jika load tinggi,
- monitoring backlog per priority.

Dokumentasi Camunda menyebut job prioritization berguna saat job executor overloaded dan job perlu diproses berdasarkan order of importance. Namun starvation bisa terjadi jika high-priority jobs terus dibuat, dan priority range dapat digunakan untuk memisahkan tipe job.

---

## 13. Timer Jobs dan Prefer Timer Jobs

Timer job sering dianggap “alarm”. Tetapi di Camunda 7, timer tetap job row yang harus diacquire.

Masalah umum:

```text
10.000 async continuation job memenuhi ACT_RU_JOB
100 timer escalation due
job executor sibuk mengambil async jobs
escalation timer terlambat
```

Opsi:

```text
jobExecutorPreferTimerJobs = true
jobExecutorAcquireByDueDate = true
```

Trade-off:

- timer lebih cepat diambil,
- query lebih kompleks,
- perlu index sesuai,
- tidak menyelesaikan resource starvation jika thread pool tetap penuh oleh job lama.

Top 1% modelling insight:

> Timer laten bukan selalu masalah timer. Bisa jadi masalah job executor capacity, acquisition order, job duration, DB pressure, atau thread pool starvation.

---

## 14. Deployment-Aware Job Executor

Deployment awareness penting pada cluster heterogen.

Cluster homogen:

```text
node-A deploys same BPMN + same delegate classes
node-B deploys same BPMN + same delegate classes
node-C deploys same BPMN + same delegate classes
```

Cluster heterogen:

```text
node-A has process application A classes
node-B has process application B classes
both share same engine DB
```

Jika job executor tidak deployment-aware, node-B bisa mengambil job milik process A dan gagal karena class delegate/bean/resource tidak tersedia.

Deployment-aware job executor membatasi acquisition agar engine mengambil job dari deployment yang terdaftar pada engine tersebut.

Dokumentasi Camunda menjelaskan bahwa pada heterogeneous cluster, default job acquisition bisa membuat node mengambil executable jobs dari table yang sama walaupun job itu milik node lain. Untuk mencegahnya, process engine dapat dikonfigurasi `jobExecutorDeploymentAware=true`.

### 14.1 Hidden Trap: Registration Tidak Selalu Persisted Seperti yang Anda Bayangkan

Deployment awareness bergantung pada deployment yang terdaftar ke process engine. Dalam environment tertentu, restart dan redeployment harus dipahami dengan benar.

Risiko:

- job tidak diambil karena deployment tidak registered,
- node baru tidak tahu deployment lama,
- rolling deployment membuat sebagian node tidak eligible,
- process application lifecycle tidak sinkron dengan engine lifecycle.

Diagnostic question:

```text
Apakah node yang job executor-nya aktif punya semua class/bean/resource yang dibutuhkan untuk job ini?
Apakah deployment id job ini registered di engine node tersebut?
```

---

## 15. Cluster Behavior: Semua Node Melihat Database yang Sama

Camunda 7 cluster dengan embedded engines biasanya berarti:

```text
node-A process engine -> same DB
node-B process engine -> same DB
node-C process engine -> same DB
```

Mereka tidak saling koordinasi melalui gossip protocol atau leader election khusus untuk job executor. Koordinasi utamanya melalui database.

### 15.1 Scaling Pattern

Menambah node:

- menambah acquisition threads,
- menambah worker thread pools,
- menambah DB connections,
- menambah command execution concurrency,
- menambah lock contention potential.

Throughput naik jika bottleneck sebelumnya adalah worker CPU/thread capacity.

Throughput tidak naik atau malah turun jika bottleneck adalah:

- DB CPU,
- DB I/O,
- connection pool,
- hot rows,
- optimistic locking,
- remote dependencies,
- serialized process instance due to exclusive jobs,
- job acquisition contention.

### 15.2 Homogeneous vs Heterogeneous Cluster

Homogeneous cluster ideal untuk Camunda 7 job executor:

```text
semua node punya deployment sama
semua node bisa execute job apa pun
job executor bebas acquire job mana pun
```

Heterogeneous cluster butuh disiplin:

```text
node group A only handles process A
node group B only handles process B
deployment-aware acquisition active
possibly priority range or engine partitioning
```

---

## 16. Job Executor Activation

Embedded engine dan shared engine punya default activation berbeda.

Dalam embedded process engine, job executor tidak selalu aktif by default dan perlu diaktifkan lewat konfigurasi. Dalam shared process engine, default-nya dapat berbeda dan sering aktif kecuali dimatikan secara eksplisit.

Production smell:

```text
Aplikasi membuat async job tetapi tidak ada yang mengeksekusi karena jobExecutorActivate=false.
```

Test smell:

```text
Unit test flaky karena background job executor aktif dan mengeksekusi job di waktu tidak terkontrol.
```

Untuk test, lebih deterministik menggunakan:

```java
Job job = managementService.createJobQuery()
    .processInstanceId(processInstance.getId())
    .singleResult();

managementService.executeJob(job.getId());
```

Dengan ini, test mengontrol kapan job berjalan.

---

## 17. Configuration Surface yang Perlu Dipahami

Nama properti bisa berbeda tergantung deployment style, Spring Boot starter, XML config, atau container integration. Yang penting adalah konsepnya.

### 17.1 Activation

```properties
jobExecutorActivate=true|false
```

Gunakan untuk menentukan apakah engine node ini boleh menjalankan job executor.

Pola:

```text
API-only node:
  jobExecutorActivate=false

Worker node:
  jobExecutorActivate=true
```

### 17.2 Acquisition Batch Size

```properties
maxJobsPerAcquisition=N
```

Menentukan berapa banyak job dicoba acquire per cycle.

Terlalu kecil:

- throughput rendah,
- banyak cycle untuk backlog besar.

Terlalu besar:

- lock banyak job sekaligus,
- local queue menumpuk,
- lock expiry risk,
- DB update besar,
- unfairness antar node.

### 17.3 Wait / Backoff

Konsep properti:

```text
waitTimeInMillis
maxWait
backoffTimeInMillis
maxBackoff
backoffDecreaseThreshold
```

Tergantung integrasi, nama dan availability bisa berbeda.

Tuning goal:

```text
latency rendah tanpa menghancurkan DB dengan polling
```

### 17.4 Lock Time

```properties
lockTimeInMillis=...
```

Menentukan durasi lease job.

Harus lebih besar dari:

```text
queue wait + execution time + transaction commit margin
```

Tetapi jika harus diset sangat besar, itu sinyal bahwa job terlalu lama/blocking.

### 17.5 Thread Pool

Konsep umum:

```text
corePoolSize
maxPoolSize
queueSize
```

Sizing harus mempertimbangkan:

- DB connection pool,
- remote API concurrency,
- CPU availability,
- job duration,
- transaction duration,
- memory footprint,
- history writes.

### 17.6 Ordering Options

```properties
jobExecutorAcquireByPriority=true|false
jobExecutorPreferTimerJobs=true|false
jobExecutorAcquireByDueDate=true|false
```

Aktifkan hanya jika ada kebutuhan nyata dan index mendukung.

### 17.7 Priority Range

```properties
jobExecutorPriorityRangeMin=...
jobExecutorPriorityRangeMax=...
```

Berguna untuk dedicated worker group.

Contoh:

```text
node group urgent:
  priority 1000..Long.MAX_VALUE

node group normal:
  priority 0..999
```

Pastikan tidak ada gap yang membuat job tidak pernah dieksekusi.

### 17.8 Deployment Awareness

```properties
jobExecutorDeploymentAware=true
```

Gunakan pada heterogeneous cluster.

---

## 18. Spring Boot Configuration Example

Contoh konseptual `application.yml`:

```yaml
camunda:
  bpm:
    job-execution:
      enabled: true
      max-jobs-per-acquisition: 8
      wait-time-in-millis: 5000
      max-wait: 30000
      lock-time-in-millis: 300000
```

Catatan:

- Properti aktual bergantung versi Camunda Spring Boot starter.
- Selalu verifikasi dengan dokumentasi versi yang dipakai.
- Jangan copy paste tuning tanpa load test.

Pola node API-only:

```yaml
camunda:
  bpm:
    job-execution:
      enabled: false
```

Pola worker-only node:

```yaml
server:
  port: 8081

camunda:
  bpm:
    webapp:
      enabled: false
    job-execution:
      enabled: true
```

---

## 19. XML Configuration Example

Contoh konseptual process engine config:

```xml
<process-engine name="default">
  <job-acquisition>default</job-acquisition>
  <configuration>org.camunda.bpm.engine.impl.cfg.StandaloneProcessEngineConfiguration</configuration>
  <datasource>java:jdbc/ProcessEngine</datasource>
  <properties>
    <property name="jobExecutorActivate">true</property>
    <property name="jobExecutorDeploymentAware">true</property>
    <property name="jobExecutorAcquireByPriority">true</property>
    <property name="jobExecutorPreferTimerJobs">false</property>
    <property name="jobExecutorAcquireByDueDate">false</property>
  </properties>
</process-engine>
```

Contoh `job-executor` pada `bpm-platform.xml` secara konseptual:

```xml
<job-executor>
  <job-acquisition name="default">
    <properties>
      <property name="maxJobsPerAcquisition">8</property>
      <property name="waitTimeInMillis">5000</property>
      <property name="lockTimeInMillis">300000</property>
    </properties>
  </job-acquisition>
</job-executor>
```

Jangan menghafal XML-nya. Hafalkan konsepnya:

```text
who acquires?
how many?
how often?
for how long locked?
in what order?
which deployments?
which priority range?
```

---

## 20. Database Connection Pool Interaction

Job executor membutuhkan DB connection untuk:

- acquisition query,
- lock update,
- job execution command,
- variable reads/writes,
- history writes,
- retries/incident writes.

Jika thread pool 30 tetapi DB pool 10, maka sebagian thread akan menunggu connection.

Jika API request juga memakai pool yang sama, job executor bisa mengganggu user-facing request.

Mental model:

```text
HTTP requests + job executor workers + history cleanup + batch jobs
  all compete for DB connections
```

Sizing example:

```text
HTTP max concurrent DB usage: 20
Job executor max threads: 15
History cleanup/batch reserve: 5
Operational margin: 10
Suggested DB pool upper bound: around 50
```

Tetapi DB pool lebih besar tidak selalu lebih baik. Jika DB CPU/I/O tidak kuat, connection lebih banyak hanya mempercepat overload.

---

## 21. Remote Call Problem: Thread Pool Starvation

Salah satu anti-pattern paling sering:

```java
public class SendToExternalSystemDelegate implements JavaDelegate {
  @Override
  public void execute(DelegateExecution execution) throws Exception {
    externalClient.callWithoutTimeout(...); // dangerous
  }
}
```

Jika remote system lambat:

```text
all job executor threads blocked
new jobs not executed
timers delayed
retries delayed
incidents delayed
system appears stuck
```

Fix minimal:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(3))
    .build();

HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(Duration.ofSeconds(10))
    .POST(bodyPublisher)
    .build();
```

Better architecture:

```text
Camunda delegate writes command to outbox
transaction commits
separate worker sends command with backpressure
external response correlates message back
```

Or:

```text
Use External Task pattern for remote work
Camunda job executor stays focused on process progression
worker fleet handles external dependency behavior
```

---

## 22. Tuning by Workload Type

### 22.1 Low-Volume Human Workflow

Characteristics:

- user tasks dominate,
- timers for SLA,
- few async service tasks,
- latency target seconds to minutes.

Suggested posture:

```text
small job executor pool
moderate maxWait
prefer timer jobs if SLA timers critical
strong observability on overdue timers
```

### 22.2 High-Volume Straight-Through Processing

Characteristics:

- many async service tasks,
- high job creation rate,
- low human involvement,
- external API calls.

Suggested posture:

```text
avoid heavy in-engine remote calls
use external task or outbox
measure DB write rate
tune maxJobsPerAcquisition carefully
partition by process/job priority if needed
```

### 22.3 Batch / Cleanup Heavy System

Characteristics:

- history cleanup,
- batch migration,
- bulk process instance modification,
- large historic tables.

Suggested posture:

```text
dedicated maintenance window
separate priority range
monitor batch jobs separately
avoid competing with critical business timers
```

### 22.4 Regulatory Case Management

Characteristics:

- long-running processes,
- human task routing,
- SLA timers,
- audit critical,
- intermittent integration.

Suggested posture:

```text
conservative job executor tuning
explicit SLA data model
idempotent integration
manual recovery playbook
clear incident taxonomy
avoid over-aggressive polling
```

---

## 23. Diagnostics: Job Tidak Jalan

Symptom:

```text
Process stuck after asyncBefore.
Job exists in ACT_RU_JOB.
No delegate execution log.
```

Checklist:

### 23.1 Is Job Executor Active?

Check:

```text
jobExecutorActivate / job execution enabled
application logs during startup
management/actuator if available
```

### 23.2 Is Job Acquirable?

SQL concept:

```sql
select ID_, TYPE_, DUEDATE_, LOCK_OWNER_, LOCK_EXP_TIME_, RETRIES_, SUSPENSION_STATE_
from ACT_RU_JOB
where PROCESS_INSTANCE_ID_ = ?;
```

Interpretation:

```text
RETRIES_ = 0
  -> incident/failed job, not acquirable automatically

DUEDATE_ in future
  -> not due yet

LOCK_EXP_TIME_ in future
  -> locked by some executor

SUSPENSION_STATE_ suspended
  -> won't execute until activated
```

### 23.3 Is It Deployment-Aware But Deployment Not Registered?

Check:

```text
job has DEPLOYMENT_ID_
node job executor deployment aware
node registered deployment?
node has process application?
```

### 23.4 Is Thread Pool Full?

Check:

```text
job executor active threads
queue depth
thread dump
blocked remote calls
DB connection wait
```

### 23.5 Is DB Acquisition Slow?

Check:

```text
ACT_RU_JOB query plan
indexes
DB CPU
row locks
connection pool
slow query logs
```

---

## 24. Diagnostics: Job Terlambat

Symptom:

```text
Timer due at 09:00, executed 09:20.
```

Possible causes:

1. job executor not running,
2. job executor backoff,
3. thread pool saturated,
4. DB overloaded,
5. acquisition order not preferring timers,
6. too many async jobs ahead,
7. lock conflict,
8. job priority too low,
9. deployment awareness preventing acquisition,
10. cluster node clock skew.

Investigation SQL concept:

```sql
select TYPE_, count(*)
from ACT_RU_JOB
where DUEDATE_ <= current_timestamp
  and RETRIES_ > 0
  and (LOCK_EXP_TIME_ is null or LOCK_EXP_TIME_ < current_timestamp)
group by TYPE_;
```

Look for:

```text
many due timer jobs
many due async jobs
many locked jobs with old owners
many retries=0 jobs
```

---

## 25. Diagnostics: Duplicate Side Effect

Symptom:

```text
Customer receives two emails.
External system receives duplicate request.
Payment command sent twice.
```

Possible causes:

- job retried after exception,
- delegate succeeded externally but failed before commit,
- lock expired and another node executed same job,
- user manually retried incident,
- process instance migration/modification retriggered path,
- non-idempotent external call.

Correct response is not:

```text
Set retries to 1 and hope.
```

Correct response:

```text
Introduce idempotency key.
Record external command state.
Make duplicate external command safe.
Use outbox or external task when side effect is expensive.
```

Example idempotency key:

```text
processDefinitionKey + processInstanceId + activityId + businessActionType
```

Or business-specific:

```text
caseId + enforcementActionId + noticeType + version
```

---

## 26. Diagnostics: Optimistic Locking Storm

Symptom:

```text
Many OptimisticLockingException logs.
Parallel process instances retry repeatedly.
Throughput drops.
```

Distinguish two cases:

### 26.1 Normal Optimistic Locking

Normal around:

- parallel gateway join,
- concurrent job completion,
- acquisition conflict,
- process variable update races.

If retry resolves quickly, acceptable.

### 26.2 Storm

Problematic if:

- same process repeatedly collides,
- job retries depleted,
- incident created,
- DB CPU high,
- many jobs update same process variable/global state,
- exclusive disabled incorrectly,
- process model has high parallelism joining frequently.

Mitigations:

- keep jobs exclusive where appropriate,
- avoid writing same global variable from parallel branches,
- use local variables,
- async before join gateway to allow retry,
- reduce parallelism,
- split process,
- externalize heavy parallel work.

---

## 27. SQL Cheat Sheet for Job Operations

> Warning: query is generally safe; manual mutation of Camunda runtime tables is dangerous unless directed by vendor support or controlled maintenance procedure.

### 27.1 Count Jobs by Type

```sql
select TYPE_, count(*) as CNT
from ACT_RU_JOB
group by TYPE_
order by CNT desc;
```

### 27.2 Due and Acquirable-Looking Jobs

```sql
select TYPE_, count(*) as CNT
from ACT_RU_JOB
where RETRIES_ > 0
  and DUEDATE_ <= current_timestamp
  and (LOCK_EXP_TIME_ is null or LOCK_EXP_TIME_ < current_timestamp)
group by TYPE_;
```

### 27.3 Failed Jobs

```sql
select ID_, TYPE_, PROCESS_INSTANCE_ID_, EXECUTION_ID_, RETRIES_, EXCEPTION_MSG_, DUEDATE_
from ACT_RU_JOB
where RETRIES_ = 0
order by DUEDATE_ asc;
```

### 27.4 Locked Jobs by Owner

```sql
select LOCK_OWNER_, count(*) as CNT
from ACT_RU_JOB
where LOCK_EXP_TIME_ > current_timestamp
group by LOCK_OWNER_
order by CNT desc;
```

### 27.5 Jobs with Expired Locks

```sql
select ID_, TYPE_, LOCK_OWNER_, LOCK_EXP_TIME_, RETRIES_, DUEDATE_
from ACT_RU_JOB
where LOCK_EXP_TIME_ is not null
  and LOCK_EXP_TIME_ < current_timestamp
order by LOCK_EXP_TIME_ asc;
```

### 27.6 Old Due Timers

```sql
select ID_, DUEDATE_, PROCESS_INSTANCE_ID_, EXECUTION_ID_, RETRIES_, LOCK_OWNER_, LOCK_EXP_TIME_
from ACT_RU_JOB
where TYPE_ = 'timer'
  and DUEDATE_ < current_timestamp
order by DUEDATE_ asc;
```

Vendor-specific date functions may differ. For Oracle, PostgreSQL, SQL Server, and MySQL, adapt `current_timestamp` syntax and interval expressions.

---

## 28. Operational Metrics to Track

Minimum dashboard:

```text
ACT_RU_JOB total count
acquirable jobs count
locked jobs count
failed jobs count
jobs by type
jobs by priority
oldest due date by type
job executor active threads
job executor queue depth
job execution duration percentile
job failure rate
incident count
DB connection pool active/idle/waiting
DB slow acquisition query
optimistic locking exception rate
external dependency latency
```

Better dashboard:

```text
Timer lateness = now - DUEDATE_ for due timer jobs
Async continuation lateness = now - DUEDATE_ for async jobs
Retry backlog by exception category
Jobs locked longer than expected
Job age distribution
Node-level acquisition count
Node-level execution count
Priority starvation indicators
```

For regulatory systems, also track:

```text
SLA breach timers due but not executed
case escalation jobs pending
notice generation jobs failed
approval routing jobs failed
manual recovery queue
```

---

## 29. Design Pattern: API Nodes and Worker Nodes

For higher scale, separate responsibilities:

```text
API nodes:
  - serve REST/UI traffic
  - start/complete/correlate process
  - jobExecutorActivate=false

Worker nodes:
  - run job executor
  - no public UI exposure if possible
  - tuned thread pool
  - scaled based on backlog
```

Benefits:

- user-facing request latency isolated,
- worker scaling independent,
- maintenance easier,
- thread dumps easier to interpret,
- security exposure reduced.

Trade-offs:

- more deployment complexity,
- need shared deployment/class availability,
- rolling update planning,
- deployment-aware consideration,
- monitoring per node role.

---

## 30. Design Pattern: Dedicated Timer Workers

If timers are critical:

```text
worker group A:
  prefer timer jobs
  acquire by due date
  enough small fast threads

worker group B:
  normal async jobs
```

But pure timer-only acquisition is not always straightforward in Camunda 7 without deeper customization. Priority strategy is usually easier:

```text
critical timers get high priority
worker group high-priority handles high range
normal workers handle normal range
```

Be careful:

- history cleanup/batch jobs also have priorities,
- priority gaps can starve jobs forever,
- timer priority must be assigned consistently.

---

## 31. Design Pattern: Externalize Slow Work

Use in-process async delegate for:

- short CPU work,
- short DB update,
- quick local transformation,
- reliable internal service with strict timeout,
- process state transition.

Avoid in-process async delegate for:

- remote call that may take minutes,
- file upload/download,
- large report generation,
- third-party unstable API,
- human-dependent external system,
- work requiring independent scaling.

Better:

```text
Camunda process creates external task
external worker fetches work
worker handles remote dependency
worker completes/fails task
```

Or:

```text
Camunda delegate writes outbox command
separate worker sends command
callback/message correlates result
```

---

## 32. Failure Scenario Walkthroughs

### 32.1 Node Crash After Lock Before Execution

```text
T1 node-A locks job until T1+5m
T2 node-A crashes
T3 job remains locked
T1+5m lock expires
T4 node-B acquires job
T5 job executes
```

Outcome:

- temporary delay until lock expiry,
- no manual action usually needed,
- lock time controls recovery latency.

### 32.2 Node Crash After External Side Effect Before Commit

```text
T1 node-A executes delegate
T2 delegate sends email
T3 node-A crashes before commit
T4 transaction rolled back or incomplete
T5 lock expires
T6 node-B retries job
T7 delegate sends email again
```

Outcome:

- duplicate side-effect unless idempotency exists.

### 32.3 Long Job Exceeds Lock Time

```text
T1 lock until T1+5m
T2 job starts
T6 still running
T7 node-B acquires same job
T8 both attempt external side effect
```

Outcome:

- duplicate execution risk,
- possible optimistic locking at commit,
- external duplicate already happened.

Mitigation:

- timeout less than lock,
- increase lock if justified,
- externalize long work,
- idempotency mandatory.

### 32.4 Job Executor Disabled on All Nodes

```text
async jobs created
no node acquires jobs
process instances stuck at async boundary
```

Outcome:

- activate job executor on at least one worker node,
- verify startup logs.

### 32.5 Heterogeneous Node Acquires Wrong Job

```text
node-B acquires job created by process app A
node-B lacks delegate class
job fails with ClassNotFoundException or bean resolution error
retries deplete
incident
```

Mitigation:

- homogeneous deployment,
- deployment-aware job executor,
- separate engines/databases,
- external task pattern.

---

## 33. Production Tuning Methodology

Do not tune blindly.

Use this sequence:

### Step 1: Classify Workload

```text
How many jobs per minute?
What job types?
Average duration?
P95/P99 duration?
Remote dependencies?
Timer criticality?
History level?
```

### Step 2: Measure Baseline

```text
job backlog
oldest due job
execution duration
failure rate
DB CPU
DB connections
thread pool usage
```

### Step 3: Identify Bottleneck

```text
DB bound?
Thread bound?
Remote dependency bound?
Acquisition bound?
Lock conflict bound?
Process model bound?
```

### Step 4: Change One Variable

Examples:

```text
increase worker nodes
increase thread pool
reduce maxWait
increase maxJobsPerAcquisition
enable acquire by due date
add index
separate slow jobs
externalize remote calls
```

Change one at a time.

### Step 5: Validate Correctness

Every performance tuning must preserve:

- no duplicate unsafe side-effect,
- retry behavior understood,
- timer lateness acceptable,
- incident visibility acceptable,
- DB stable,
- user-facing latency stable.

---

## 34. Common Anti-Patterns

### 34.1 “Make Everything Async”

Async everywhere creates many jobs, more DB writes, more acquisition overhead, more retry points, and more operational complexity.

Correct question:

```text
Where do I need a durable boundary?
```

Not:

```text
Where can I add async to make it faster?
```

### 34.2 Blocking Remote Calls Without Timeout

This kills worker threads.

Always define:

- connect timeout,
- read timeout,
- total request timeout,
- retry policy,
- circuit breaker if needed,
- idempotency key.

### 34.3 Huge `maxJobsPerAcquisition`

Large acquisition batch can lock many jobs that sit in local queue.

Symptom:

```text
jobs locked by node-A but not executing quickly
other nodes idle
lock expiry duplicates
```

### 34.4 Too Many Worker Nodes

More nodes can mean more DB contention.

If DB is bottleneck, adding nodes makes it worse.

### 34.5 Ignoring Deployment Awareness

In heterogeneous cluster, this leads to missing class/bean failures.

### 34.6 Relying on Job Order

Default acquisition order is not business ordering.

If ordering matters, model it explicitly.

### 34.7 Using Job Executor as General Batch Engine

Camunda can run batch operations, but using process engine job executor for arbitrary massive compute/report workloads may starve process-critical work.

---

## 35. Practical Design Heuristics

### 35.1 When to Use Async Continuation

Use async boundary when:

- you need rollback isolation,
- operation is retryable,
- side effect is idempotent,
- user request should not wait,
- wait state before/after activity improves recovery,
- parallel join needs retryable boundary.

Do not use async just because:

- “performance”,
- “microservices best practice”,
- “background sounds better”.

### 35.2 When to Increase Lock Time

Increase lock time only if:

- job duration is predictably longer,
- work is still appropriate inside engine,
- queue wait is understood,
- duplicate risk must be reduced,
- monitoring exists.

Do not increase lock time to hide:

- stuck remote call,
- missing timeout,
- overloaded thread pool,
- unbounded computation.

### 35.3 When to Add Worker Node

Add worker node if:

- DB has headroom,
- thread pool saturation is bottleneck,
- jobs are independent enough,
- remote dependencies can handle concurrency,
- deployment/classes are homogeneous or deployment-aware.

Do not add worker node if:

- DB CPU already high,
- optimistic locking storm ongoing,
- remote dependency rate-limited,
- process model serializes work per instance.

### 35.4 When to Prefer External Task

Prefer external task if:

- work is remote-system-heavy,
- worker must scale independently,
- language/runtime independent worker desired,
- long polling/backpressure useful,
- job duration unpredictable,
- deployment classpath coupling undesirable.

---

## 36. Regulatory Workflow Example

Imagine enforcement case process:

```text
Receive Complaint
  -> Assess Complaint
  -> asyncBefore Generate Case Number
  -> User Task: Officer Review
  -> Timer Boundary: SLA Reminder after 5 days
  -> asyncBefore Send Notice
  -> Wait for Agency Response
  -> Timer: Escalate after 14 days
  -> Decision: Close / Investigate / Appeal
```

Job executor responsibilities:

```text
Generate Case Number async job
SLA Reminder timer job
Send Notice async job
Escalation timer job
```

Failure analysis:

### Generate Case Number

- Should be short.
- Can be in-process delegate.
- Must be idempotent by case draft id.

### SLA Reminder

- Timer can be delayed.
- SLA due date must exist in case table.
- Reminder must check whether reminder still relevant before sending.

### Send Notice

- External side effect.
- Must use idempotency key.
- If notice generation is expensive or remote-heavy, use outbox/external task.

### Escalation Timer

- Must re-check case state.
- Timer firing late should not incorrectly escalate closed case.
- Escalation action must be idempotent.

This pattern matters:

```java
public void execute(DelegateExecution execution) {
  String caseId = (String) execution.getVariable("caseId");
  CaseRecord current = caseRepository.find(caseId);

  if (!current.isStillAwaitingResponse()) {
    return; // timer/delegate is stale; do nothing safely
  }

  escalationService.escalateOnce(caseId, "NO_RESPONSE_14_DAYS");
}
```

Timers and async jobs should be **state-aware**, not blindly action-oriented.

---

## 37. Java 8–25 Considerations

Camunda 7 estates span many Java generations. Job executor principles stay similar, but runtime choices differ.

### 37.1 Java 8

Typical legacy environment:

- app server deployment,
- Java EE / Spring Framework,
- older Camunda 7 versions,
- limited modern observability,
- thread pool tuning mostly container-specific.

Risks:

- old HTTP clients without good timeout defaults,
- weak TLS defaults if unpatched,
- older JDBC drivers,
- old app server thread behavior.

### 37.2 Java 11/17

Common modernization target:

- Spring Boot 2.x/3.x depending Camunda support line,
- better GC behavior,
- better TLS/runtime defaults,
- container-awareness improvements,
- JFR availability useful for thread/lock/latency diagnosis.

### 37.3 Java 21

Useful runtime features for surrounding application:

- improved GC options,
- better JFR/JDK tooling,
- virtual threads exist but do not automatically change Camunda Job Executor internals,
- structured concurrency can help external workers but not magically fix engine thread pool semantics.

Important:

```text
Do not assume Java virtual threads make Camunda 7 job executor safe for unbounded blocking delegates.
```

Camunda 7 job executor has its own execution model. Even if surrounding app uses modern Java, job executor tuning still matters.

### 37.4 Java 25 Planning

For Java 25-era planning:

- verify Camunda 7 support matrix for exact version,
- verify Spring Boot / container support,
- verify JDBC driver support,
- verify bytecode target,
- verify application server support,
- run migration tests with real process instances.

Do not upgrade JVM under a workflow engine casually. Long-running process instances preserve serialized state, delegate names, expression bindings, and classpath assumptions.

---

## 38. Mental Model Summary

Job Executor is not magic background processing. It is:

```text
DB-backed job scheduler + time-based row locking + acquisition loop + local queue + worker thread pool + retry/incident mechanism
```

The essential invariants:

1. Job exists because process execution reached an async/timer/internal boundary.
2. Job must be due, unlocked, not depleted, and visible to executor.
3. Acquisition locks job with owner and expiration time.
4. Execution happens later in separate command/transaction.
5. Success deletes or progresses job.
6. Failure decrements retries and can create incident.
7. Lock expiry enables recovery but can also create duplicate side-effect risk.
8. Cluster coordination is DB-centric.
9. Backoff reduces DB pressure but can add latency.
10. Thread pool starvation delays all job types.
11. Deployment awareness matters in heterogeneous clusters.
12. Priority helps under overload but can starve lower priority jobs.

---

## 39. Checklist for Production Design Review

Before approving Camunda 7 job executor design, answer:

```text
[ ] Which nodes run job executor?
[ ] Are nodes homogeneous or heterogeneous?
[ ] Is deployment-aware mode needed?
[ ] What is maxJobsPerAcquisition and why?
[ ] What is lockTime and why?
[ ] What is expected P95/P99 job duration?
[ ] Can any job exceed lock time?
[ ] Do all remote calls have timeout?
[ ] Are side effects idempotent?
[ ] Are retries configured by failure semantics?
[ ] Are timers business-critical?
[ ] Is timer lateness monitored?
[ ] Are priority/order options enabled only with proper index?
[ ] Can high-priority jobs starve low-priority jobs?
[ ] Is DB pool sized for job executor + API traffic?
[ ] Is history cleanup isolated or scheduled safely?
[ ] Can operators see failed jobs and incidents?
[ ] Is there a manual recovery playbook?
[ ] Are job executor metrics visible per node?
```

---

## 40. What You Should Be Able to Explain After This Part

You should now be able to explain:

1. Why a Camunda job is a durable DB row, not a broker message.
2. How job creation differs from acquisition and execution.
3. Why `DUEDATE_` is not a real-time guarantee.
4. How `LOCK_OWNER_` and `LOCK_EXP_TIME_` work.
5. Why lock time is a lease, not an execution timeout.
6. Why duplicate side effects can happen even with job locking.
7. How backoff reduces DB load but increases possible latency.
8. Why acquisition order is non-deterministic by default.
9. How priority and due-date acquisition change performance characteristics.
10. Why exclusive jobs reduce optimistic locking in process-instance-local parallelism.
11. Why deployment-aware job executor matters in heterogeneous clusters.
12. How thread pool saturation delays timers, async continuations, and retries together.
13. Why adding nodes is not always the right scaling answer.
14. How to diagnose stuck, delayed, failed, or duplicate jobs.

---

## 41. Bridge to Part 006

Part ini melihat job executor dari sisi runtime scheduling.

Part berikutnya akan turun ke struktur database secara lebih luas:

```text
ACT_RU_*
ACT_HI_*
ACT_RE_*
ACT_GE_*
ACT_ID_*
```

Kita akan membangun mental model schema Camunda 7:

- runtime tables,
- history tables,
- repository tables,
- identity tables,
- byte arrays,
- variables,
- deployments,
- query diagnostics,
- batas aman membaca DB,
- hal-hal yang tidak boleh dimutasi manual.

Nama file berikutnya:

```text
learn-java-camunda-7-bpm-platform-engineering-part-006.md
```

---

## References

- Camunda 7.24 Manual — The Job Executor: job creation, acquisition, execution, persistence, locking, ordering, backoff, thread pool, exclusive jobs, priority, and cluster behavior.
- Camunda 7.24 Manual — Process Engine Concepts: execution and job semantics around asynchronous continuations and exclusive jobs.
- Camunda 7.24 Manual — Deployment descriptors and job executor configuration.
- Camunda 7.24 Manual — Transactions in Processes: transaction boundaries and async continuation behavior.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-004.md">⬅️ Part 004 — Async Continuations, Job Creation, Retry Semantics, dan Idempotency Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-006.md">Part 006 — Database Schema Mastery: ACT_RU, ACT_HI, ACT_RE, ACT_GE, ACT_ID ➡️</a>
</div>

# Part 30 — Clustered Jakarta Batch and Distributed Execution Concerns

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `30-clustered-jakarta-batch-distributed-execution.md`  
> Scope: Java 8–25, Java EE/Jakarta EE Batch, Jakarta Batch 2.1 baseline, Jakarta EE 11 platform context

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu memahami dan merancang **Jakarta Batch di lingkungan clustered/distributed** secara production-grade.

Kita tidak lagi membahas batch sebagai satu JVM yang menjalankan satu job secara lokal. Di production modern, terutama di application server cluster, Kubernetes/EKS, rolling deployment, multi-pod runtime, dan database shared, batch harus dipikirkan sebagai **distributed execution problem**.

Tujuan utama bagian ini:

1. Memahami perbedaan **single-node batch** dan **clustered batch**.
2. Memahami peran **job repository** sebagai state store dan koordinasi minimal.
3. Mencegah **duplicate job start** di beberapa node.
4. Mendesain **node failure recovery**.
5. Memahami konsekuensi partitioned batch di cluster.
6. Mendesain batch yang aman terhadap:
   - pod eviction,
   - rolling deployment,
   - node crash,
   - DB failover,
   - duplicate trigger,
   - scheduler berjalan di semua node,
   - partial side effect.
7. Menentukan kapan sebaiknya memakai:
   - Jakarta Batch di application server,
   - Kubernetes Job/CronJob,
   - external scheduler,
   - message queue,
   - workflow engine.

Target pemahaman: kamu bisa melihat batch bukan sebagai “kode Java yang berjalan lama”, tetapi sebagai **stateful distributed workload** yang membutuhkan ownership, lease, lock, idempotency, observability, dan recovery model.

---

## 2. Problem yang Diselesaikan

Di single-node development environment, batch terlihat sederhana:

```text
User/Admin/Scheduler
        |
        v
JobOperator.start("nightlyJob", params)
        |
        v
JVM menjalankan job sampai selesai
```

Tetapi di production cluster:

```text
             +-------------------+
Scheduler -->| App Node A         |
             | JobOperator.start  |
             +-------------------+

             +-------------------+
Scheduler -->| App Node B         |
             | JobOperator.start  |
             +-------------------+

             +-------------------+
Scheduler -->| App Node C         |
             | JobOperator.start  |
             +-------------------+

                    |
                    v
             Shared Database / Job Repository
```

Pertanyaan yang langsung muncul:

1. Siapa yang boleh menjalankan job?
2. Bagaimana jika semua node menerima trigger yang sama?
3. Bagaimana jika node mati saat job berjalan?
4. Apakah node lain otomatis melanjutkan?
5. Apakah batch job portable mendukung distributed execution?
6. Bagaimana partitioned step dibagi antar node?
7. Bagaimana mencegah side effect ganda?
8. Bagaimana operator tahu job benar-benar berhenti atau hanya kehilangan heartbeat?
9. Bagaimana deployment baru tidak memutus job lama?
10. Bagaimana memastikan restart tidak melompati atau mengulang data secara berbahaya?

Masalah intinya:

> Jakarta Batch menyediakan model job, step, execution, checkpoint, dan control API. Tetapi **cluster behavior tidak boleh diasumsikan otomatis seragam antar vendor/runtime**. Production engineer harus mendesain koordinasi, duplicate prevention, shutdown behavior, dan recovery secara eksplisit.

---

## 3. Baseline Spesifikasi dan Realitas Portability

Jakarta Batch mendefinisikan API Java dan Job Specification Language/JSL untuk menyusun batch job reusable dan parameterized. API utama untuk operasi runtime adalah `JobOperator`, yang dapat start, stop, restart, dan inspect job execution.

Namun perlu dibedakan:

| Area | Umumnya Distandardisasi | Perlu Hati-Hati / Vendor-Specific |
|---|---:|---:|
| JSL job definition | Ya | Detail loading/packaging bisa berbeda |
| Job/Step/Execution metadata | Ya | Skema repository fisik bisa vendor-specific |
| `JobOperator.start/stop/restart` | Ya | Security, remoting, cluster control berbeda |
| Checkpointing | Ya | Storage/serialization details bisa berbeda |
| Partitioning API | Ya | Cara runtime mendistribusikan partition bisa berbeda |
| Cluster failover | Tidak sepenuhnya portable | Sangat bergantung implementation |
| Scheduler singleton | Tidak otomatis | Harus didesain |
| Kubernetes pod lifecycle | Di luar spesifikasi | Harus didesain operasional |

Mental model penting:

> Spesifikasi memberi **semantic contract** untuk batch execution. Cluster memberi **failure domain** yang lebih luas. Jangan menganggap semantic contract otomatis menyelesaikan semua distributed systems problem.

---

## 4. Single-Node vs Clustered Batch

### 4.1 Single-Node Batch

Pada single-node batch:

```text
+---------------------+
| JVM A               |
|                     |
| JobOperator         |
| Job Repository      |
| Batch Runtime       |
| Job Thread(s)       |
+---------------------+
```

Karakteristik:

- job hanya berjalan di satu runtime,
- tidak ada duplicate node trigger,
- shutdown lebih mudah dikendalikan,
- thread dump cukup di satu JVM,
- repository bisa embedded/file/DB tergantung runtime,
- restart biasanya terjadi di runtime yang sama atau instance baru dengan repository yang sama.

Masalahnya relatif lokal:

- task stuck,
- memory leak,
- checkpoint salah,
- writer tidak idempotent,
- DB timeout,
- file corrupt.

### 4.2 Clustered Batch

Pada clustered batch:

```text
+---------+      +---------+      +---------+
| Node A  |      | Node B  |      | Node C  |
| Batch   |      | Batch   |      | Batch   |
+----+----+      +----+----+      +----+----+
     |                |                |
     +----------------+----------------+
                      |
                      v
              +---------------+
              | Shared DB /   |
              | Job Repository|
              +---------------+
```

Karakteristik:

- banyak JVM/pod punya batch runtime,
- semua node bisa punya akses ke `JobOperator`,
- scheduler bisa accidentally berjalan di semua node,
- node bisa mati di tengah execution,
- rolling deployment bisa mematikan node yang masih menjalankan job,
- partitioned job bisa membuat parallel side effect,
- job repository menjadi shared state yang kritikal.

Clustered batch menambah failure mode:

| Failure | Contoh |
|---|---|
| Duplicate start | Scheduler di 3 node menjalankan job yang sama |
| Split-brain ownership | Dua node mengira mereka pemilik job |
| Lost heartbeat | Node sebenarnya hidup tapi tidak update progress |
| Zombie execution | Runtime mati, repository masih `STARTED` |
| Non-idempotent replay | Restart mengirim email/payment/API call ulang |
| Version skew | Job lama berjalan saat deployment versi baru naik |
| Partition skew | Satu partition sangat besar, lainnya selesai cepat |
| DB pool starvation | Partition paralel menghabiskan semua koneksi |
| Pod eviction | Kubernetes kill pod sebelum checkpoint aman |

---

## 5. Mental Model: Batch Execution as Distributed Ownership

Di cluster, job execution harus punya **owner**.

Owner bisa berarti:

- node/pod yang menjalankan job,
- process id,
- hostname,
- instance id,
- Kubernetes pod UID,
- application version,
- logical worker id.

Tanpa ownership, kamu tidak bisa menjawab:

- siapa yang sedang menjalankan job ini?
- apakah job masih hidup?
- apakah aman direstart?
- apakah boleh node lain mengambil alih?
- apakah eksekusi ini stale?

### 5.1 Execution Ownership State

Model sederhana:

```text
REQUESTED
   |
   v
CLAIMED(owner=node-a, lease_until=T1)
   |
   v
RUNNING(owner=node-a, heartbeat=T2)
   |
   +----> COMPLETED
   +----> FAILED
   +----> STOPPING
   +----> STOPPED
   +----> ORPHANED
```

Jakarta Batch punya status execution, tetapi untuk clustered production system kamu sering perlu metadata tambahan di control plane sendiri:

```sql
CREATE TABLE batch_job_request (
    request_id          VARCHAR(64) PRIMARY KEY,
    logical_job_name    VARCHAR(128) NOT NULL,
    business_key        VARCHAR(256) NOT NULL,
    job_parameters_hash VARCHAR(128) NOT NULL,
    requested_by        VARCHAR(128) NOT NULL,
    requested_at        TIMESTAMP NOT NULL,

    status              VARCHAR(32) NOT NULL,
    owner_node          VARCHAR(128),
    owner_instance_id   VARCHAR(128),
    owner_version       VARCHAR(64),
    lease_until         TIMESTAMP,
    heartbeat_at        TIMESTAMP,

    batch_execution_id  BIGINT,
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,

    CONSTRAINT uq_batch_business_once
        UNIQUE (logical_job_name, business_key, job_parameters_hash)
);
```

Ini bukan pengganti Jakarta Batch repository. Ini adalah **control-plane request table** untuk governance, deduplication, authorization, approval, dan ownership.

---

## 6. Job Repository as Coordination Point

Jakarta Batch runtime menyimpan state execution di job repository. Secara konsep repository menyimpan:

- job instance,
- job execution,
- step execution,
- batch status,
- exit status,
- job parameters,
- checkpoint data,
- restart metadata.

Di cluster, repository sering menjadi shared database.

```text
Node A ----+
           |
Node B ----+----> Batch Repository DB
           |
Node C ----+
```

Tetapi repository tidak boleh dianggap sebagai magic distributed scheduler.

### 6.1 Apa yang Bisa Dibantu Repository

Repository membantu:

- menyimpan job execution history,
- menentukan execution yang pernah berjalan,
- menyimpan checkpoint,
- mendukung restart,
- query status job,
- inspect job/step execution.

### 6.2 Apa yang Tidak Otomatis Dijamin

Repository belum tentu otomatis menyelesaikan:

- duplicate scheduler trigger,
- cluster-wide singleton execution,
- leader election,
- node heartbeat,
- lease expiration,
- safe takeover,
- rolling deployment drain,
- API side effect deduplication,
- version compatibility antara checkpoint lama dan code baru.

### 6.3 Practical Rule

> Gunakan Jakarta Batch repository untuk **batch runtime state**. Gunakan application-level control plane untuk **business-level execution governance**.

---

## 7. Duplicate Job Launch Prevention

Duplicate launch adalah salah satu failure paling umum.

Contoh:

- Kubernetes menjalankan 3 replica aplikasi.
- Masing-masing punya scheduler `@Schedule` atau managed scheduled executor.
- Jam 01:00 semua node menjalankan job `dailyAgeingRecalc`.
- Semua memakai parameter tanggal yang sama.
- Tiga job berjalan paralel pada dataset yang sama.

### 7.1 Bad Pattern: Local In-Memory Guard

```java
private final AtomicBoolean running = new AtomicBoolean(false);

public void runDailyJob() {
    if (!running.compareAndSet(false, true)) {
        return;
    }

    try {
        jobOperator.start("dailyJob", props);
    } finally {
        running.set(false);
    }
}
```

Ini hanya mencegah duplicate di satu JVM. Di cluster, setiap node punya `AtomicBoolean` sendiri.

### 7.2 Better Pattern: Database Unique Business Key

```sql
CREATE TABLE batch_launch_guard (
    job_name      VARCHAR(128) NOT NULL,
    business_date DATE NOT NULL,
    parameter_hash VARCHAR(128) NOT NULL,
    status        VARCHAR(32) NOT NULL,
    created_at    TIMESTAMP NOT NULL,
    PRIMARY KEY (job_name, business_date, parameter_hash)
);
```

Pseudo-code:

```java
public Optional<Long> startOnce(String jobName, LocalDate businessDate, Properties params) {
    String hash = hashParameters(params);

    boolean inserted = tryInsertLaunchGuard(jobName, businessDate, hash);
    if (!inserted) {
        return Optional.empty();
    }

    long executionId = jobOperator.start(jobName, params);
    updateGuardWithExecutionId(jobName, businessDate, hash, executionId);
    return Optional.of(executionId);
}
```

### 7.3 Better Pattern: Request Table with State Machine

Lebih production-grade:

```text
SUBMITTED -> APPROVED -> CLAIMED -> STARTED -> COMPLETED
                         |           |
                         |           +-> FAILED
                         |           +-> STOPPED
                         +-> EXPIRED
```

Kelebihan:

- bisa audit siapa request,
- bisa approval,
- bisa dedup business key,
- bisa retry/restart dengan aturan jelas,
- bisa expose ke admin UI,
- bisa detect orphaned claim.

### 7.4 What Is the Idempotency Key?

Idempotency key untuk batch launch biasanya kombinasi:

```text
logicalJobName + businessScope + parameterHash
```

Contoh:

```text
case-ageing-recalc + agency=CEA,date=2026-06-17 + sha256(params)
external-registry-sync + registry=XYZ,window=2026-06-16T00:00/23:59 + sha256(params)
bulk-correspondence + campaignId=CAM-2026-001 + sha256(params)
```

Jangan hanya memakai timestamp trigger, karena timestamp selalu unik dan tidak mencegah duplicate logical job.

---

## 8. Scheduler in Cluster

### 8.1 The Scheduler Multiplication Problem

Jika scheduler berada di dalam aplikasi dan aplikasi punya 4 replica:

```text
01:00:00 Node A fires
01:00:00 Node B fires
01:00:00 Node C fires
01:00:00 Node D fires
```

Ini normal secara teknis. Setiap node memang punya scheduler lokal.

### 8.2 Design Options

| Option | Cara Kerja | Kapan Cocok | Risiko |
|---|---|---|---|
| DB lock | Semua node fire, hanya satu dapat lock | Sederhana, portable | Lock stale jika tidak pakai lease |
| Unique request table | Semua insert, hanya satu menang | Bagus untuk idempotent launch | Butuh state machine |
| Leader election | Satu node jadi leader | Banyak scheduled task | Complexity lebih tinggi |
| External scheduler | Cron/K8s/EventBridge memanggil satu endpoint | Governance terpusat | Endpoint harus idempotent |
| Kubernetes CronJob | Scheduler di K8s menjalankan job container | Batch isolated dari app | Integrasi Jakarta Batch container berbeda |

### 8.3 DB Lease Lock Pattern

```sql
CREATE TABLE cluster_lock (
    lock_name      VARCHAR(128) PRIMARY KEY,
    owner_id       VARCHAR(128) NOT NULL,
    lease_until    TIMESTAMP NOT NULL,
    updated_at     TIMESTAMP NOT NULL
);
```

Acquire logic:

```sql
UPDATE cluster_lock
SET owner_id = ?, lease_until = ?, updated_at = CURRENT_TIMESTAMP
WHERE lock_name = ?
  AND lease_until < CURRENT_TIMESTAMP;
```

Jika update count = 1, node menang lock.

Masalah yang harus dipikirkan:

- clock skew,
- lease terlalu pendek,
- job lebih lama dari lease,
- heartbeat gagal,
- DB latency,
- owner mati sebelum update status.

### 8.4 Prefer Launch Dedup Over Long Lock

Untuk batch, sering lebih baik:

1. scheduler boleh fire di semua node,
2. semua mencoba membuat `job_request` dengan unique business key,
3. hanya satu insert berhasil,
4. node yang berhasil menjalankan job,
5. status job dikelola dari request/execution state.

Ini lebih aman daripada lock panjang yang menahan selama seluruh job berjalan.

---

## 9. Node Failure and Orphaned Executions

### 9.1 Failure Scenario

```text
01:00 Node A starts job execution 1001
01:05 Step 1 completed
01:10 Step 2 running, checkpoint at item 50,000
01:12 Node A crashes
01:13 Repository still says execution 1001 STARTED
01:20 Operator sees job not progressing
```

Pertanyaan:

- Apakah job masih berjalan?
- Apakah node A benar-benar mati?
- Apakah aman menjalankan `restart(1001)`?
- Apakah Step 2 writer melakukan side effect sebelum crash?
- Apakah checkpoint terakhir cukup akurat?

### 9.2 Heartbeat Model

Tambahkan heartbeat di control plane:

```text
RUNNING(owner=node-a, heartbeat_at=01:10)
RUNNING(owner=node-a, heartbeat_at=01:11)
RUNNING(owner=node-a, heartbeat_at=01:12)
-- no heartbeat --
STALE? after threshold
ORPHANED? after operator/system decision
```

Heartbeat bisa dilakukan:

- per chunk listener,
- per step listener,
- scheduled heartbeat dalam worker,
- control plane sidecar/poller,
- DB update dari batch artifact.

Hati-hati: heartbeat sendiri jangan terlalu sering sampai membebani DB.

### 9.3 Orphan Detection

Pseudo-code:

```java
public void detectOrphans() {
    List<JobRequest> stale = repository.findRunningWithHeartbeatOlderThan(Duration.ofMinutes(15));

    for (JobRequest request : stale) {
        boolean ownerStillAlive = runtimeRegistry.isAlive(request.ownerInstanceId());

        if (!ownerStillAlive) {
            request.markOrphaned("Owner heartbeat expired and runtime not alive");
        }
    }
}
```

### 9.4 Restart After Orphan

Restart policy harus eksplisit:

```text
ORPHANED -> RESTART_PENDING -> RESTARTING -> RUNNING -> COMPLETED/FAILED
```

Syarat restart:

- execution lama tidak mungkin masih running,
- checkpoint valid,
- writer idempotent,
- side effect reconciliation selesai,
- parameter compatible,
- application version compatible,
- operator/system punya authorization.

---

## 10. Does Another Node Automatically Continue the Job?

Jawaban aman:

> Jangan mengasumsikan portable automatic failover antar node untuk semua Jakarta Batch implementation.

Beberapa runtime/vendor mungkin punya cluster integration lebih kuat, tetapi sebagai architect kamu harus membedakan:

1. **Restartable job**: job bisa direstart setelah gagal.
2. **Automatic failover**: runtime otomatis memindahkan eksekusi ke node lain.
3. **Partition distribution**: partition bisa dijalankan parallel, mungkin di thread/node berbeda tergantung implementation.
4. **Durable orchestration**: ada sistem yang menjamin handoff dan ownership.

Jakarta Batch memberikan restart model, tetapi distributed failover adalah concern implementation/deployment.

Production stance:

```text
Assume restartable, not magically failover-safe.
Design explicit detection, decision, and restart.
```

---

## 11. Partitioned Batch in Cluster

Partitioning menambah parallelism dan juga menambah distributed risk.

```text
Job: recalc-all-cases

Partition 0: case_id 000000 - 099999
Partition 1: case_id 100000 - 199999
Partition 2: case_id 200000 - 299999
Partition 3: case_id 300000 - 399999
```

Di single node, partitions mungkin berjalan di beberapa thread. Di cluster, implementation bisa menjalankan partition dengan strategi berbeda tergantung runtime.

### 11.1 Partition Ownership

Setiap partition sebaiknya punya identity:

```text
job_execution_id=1001
step=processCases
partition_id=2
partition_range=200000-299999
owner=node-b
status=RUNNING
checkpoint=case_id=245901
```

Jika tidak ada partition-level visibility, operator akan sulit memahami:

- partition mana yang lambat,
- partition mana yang gagal,
- apakah skew terjadi,
- apakah satu partition aman direstart,
- apakah side effect partition tertentu sudah terkirim.

### 11.2 Skew Problem

Partition count 8 tidak berarti durasi semua partition sama.

```text
P0: 10k records, simple
P1: 10k records, simple
P2: 10k records, includes old complex cases
P3: 10k records, heavy external API calls
```

Gejala:

```text
P0 completed in 3 min
P1 completed in 3 min
P2 completed in 45 min
P3 completed in 90 min
```

Penyebab:

- range key tidak berkorelasi dengan workload,
- tenant tertentu lebih berat,
- data quality buruk di partition tertentu,
- API throttling per business category,
- lock contention.

### 11.3 Avoid Over-Partitioning

Over-partitioning bisa menyebabkan:

- DB connection pool habis,
- too many concurrent transactions,
- external API rate limit pecah,
- checkpoint metadata terlalu banyak,
- log/tracing noise,
- retry storm paralel,
- writer contention.

Rule:

> Partition count harus dikontrol oleh bottleneck tersulit, bukan oleh jumlah CPU saja.

Jika bottleneck adalah DB dengan pool 30 koneksi dan aplikasi juga melayani request online, batch tidak boleh mengambil 30 koneksi.

Contoh budget:

```text
DB pool total: 50
Reserved for online traffic: 35
Reserved for admin/API: 5
Available for batch: 10
Max concurrent partitions doing DB write: <= 8
```

---

## 12. Rolling Deployment During Batch

### 12.1 Problem

Kubernetes rolling deployment:

```text
10:00 batch job running on pod aceas-7d9f-node-a
10:05 new deployment starts
10:06 Kubernetes sends SIGTERM to old pod
10:06 app has terminationGracePeriodSeconds = 30
10:06 batch chunk needs 5 minutes to finish safely
10:06:30 pod killed
```

Akibat:

- transaction rollback,
- checkpoint tidak update,
- repository status stuck,
- external side effect partial,
- job perlu restart,
- operator melihat status membingungkan.

### 12.2 Required Shutdown Semantics

Aplikasi harus punya graceful shutdown policy:

1. Stop accepting new batch launches.
2. Mark node as draining.
3. Let running chunk reach checkpoint boundary, if possible.
4. Call `JobOperator.stop()` or equivalent controlled stop if job must stop.
5. Update control plane status.
6. Release ownership/lease carefully.
7. Exit only after safe boundary or grace timeout.

### 12.3 Kubernetes Controls

Relevant concepts:

- `terminationGracePeriodSeconds`
- `preStop` hook
- readiness probe
- liveness probe
- PodDisruptionBudget
- node drain behavior
- deployment strategy
- resource requests/limits

Example conceptual lifecycle:

```text
preStop:
  1. mark instance DRAINING
  2. disable scheduler
  3. reject new job starts
  4. request stop for interruptible jobs
  5. wait until safe checkpoint or timeout
```

### 12.4 Readiness vs Liveness

Do not confuse:

| Probe | Meaning | Batch Implication |
|---|---|---|
| Readiness | Can receive traffic? | Set false during drain |
| Liveness | Should this pod be killed? | Do not kill just because batch is long-running |
| Startup | Has app started? | Prevent premature liveness killing |

Anti-pattern:

```text
Liveness probe fails because batch makes app slow -> Kubernetes kills pod -> batch restarts -> load increases -> liveness fails again.
```

---

## 13. Version Skew and Checkpoint Compatibility

Rolling deployment means old and new code can coexist.

```text
Node A: version 1.4 running batch execution 1001
Node B: version 1.5 starts after deployment
Operator restarts execution 1001 on Node B
```

Potential issue:

- checkpoint class changed,
- serialized checkpoint incompatible,
- item schema changed,
- writer behavior changed,
- JSL changed,
- partition range calculation changed,
- idempotency key format changed.

### 13.1 Checkpoint Evolution Rule

Checkpoint data should be:

- small,
- stable,
- versioned,
- based on primitive/string values,
- not raw entity objects,
- not dependent on class internals.

Bad checkpoint:

```java
public class ReaderCheckpoint implements Serializable {
    private CaseEntity lastCase; // BAD: entity shape changes, lazy proxies, class evolution
}
```

Better checkpoint:

```java
public class ReaderCheckpoint implements Serializable {
    private int version = 1;
    private String lastProcessedCaseId;
    private Instant highWatermark;
}
```

Even better for long-term compatibility: store checkpoint as JSON with explicit version if runtime allows custom serialization strategy, or store minimal stable values in application table.

### 13.2 Deployment Policy for Long-Running Batch

Options:

| Policy | Description | Kapan Cocok |
|---|---|---|
| Drain before deploy | Tunggu batch selesai/stop sebelum deploy | Critical batch, low frequency |
| No restart across version | Restart hanya pada version yang sama | Checkpoint fragile |
| Compatible checkpoint only | Versioned checkpoint supports migration | Mature batch platform |
| Dedicated worker deployment | Batch pod dipisah dari online app | Long-running production jobs |

---

## 14. Kubernetes/EKS Concerns

### 14.1 App Server Pod vs Dedicated Batch Pod

Ada dua model besar.

#### Model A — Batch inside normal application pod

```text
Deployment aceas-app replicas=4
  - serves HTTP
  - runs admin APIs
  - has Batch runtime
  - may run scheduled jobs
```

Kelebihan:

- deployment sederhana,
- reuse application server/CDI/JPA/security,
- JobOperator dekat dengan aplikasi,
- cocok untuk small/medium jobs.

Risiko:

- batch mengganggu online traffic,
- rolling deploy membunuh batch,
- autoscaling online traffic tidak sama dengan kebutuhan batch,
- scheduler duplicate,
- resource isolation buruk.

#### Model B — Dedicated batch worker deployment

```text
Deployment aceas-web replicas=4
  - serves HTTP only

Deployment aceas-batch-worker replicas=1..N
  - runs Batch runtime
  - no public traffic
  - consumes job requests
```

Kelebihan:

- resource isolation lebih baik,
- autoscaling bisa dipisah,
- deployment policy berbeda,
- scheduler/control plane lebih jelas,
- online latency lebih aman.

Risiko:

- deployment lebih kompleks,
- perlu routing/control API,
- perlu shared code packaging,
- perlu operational ownership.

### 14.2 Resource Requests and Limits

Batch sering CPU/memory/IO heavy. Jangan hanya copy setting web pod.

Pertimbangkan:

- memory for chunk buffers,
- JDBC fetch size,
- file buffer,
- XML/JSON streaming parser,
- external API concurrency,
- retry queue,
- logging volume,
- JFR/diagnostic overhead.

### 14.3 Pod Eviction

Eviction bisa terjadi karena:

- node memory pressure,
- disk pressure,
- node drain,
- spot interruption,
- autoscaler consolidation,
- deployment rollout,
- preemption.

Batch harus menganggap pod bisa mati kapan pun.

Implication:

- checkpoint harus sering cukup untuk acceptable replay,
- writer harus idempotent,
- job status reconciliation harus ada,
- shutdown hook harus cooperative,
- input/output file harus durable di shared/object storage jika diperlukan.

### 14.4 Persistent Volumes vs Object Storage

Untuk file batch:

| Storage | Kelebihan | Risiko |
|---|---|---|
| Pod local disk | Cepat, sederhana | Hilang saat pod mati |
| PersistentVolume | Survive pod restart | Mount semantics, locking, performance |
| Object storage | Durable, scalable | Eventual/list consistency concern, API retry |
| Database BLOB/CLOB | Transactional metadata | DB bloat, performance |

Rule:

> Jangan menaruh input/output penting hanya di ephemeral pod filesystem.

---

## 15. Kubernetes Job/CronJob vs Jakarta Batch

### 15.1 Kubernetes Job

Kubernetes Job cocok untuk menjalankan workload sebagai process/container yang selesai.

```text
CronJob -> Job -> Pod -> Java main/application -> exit code
```

Kelebihan:

- lifecycle process jelas,
- retry/backoff di level Kubernetes,
- resource isolation kuat,
- tidak mengganggu web app,
- cocok untuk batch yang heavy atau jarang.

Kekurangan:

- integrasi CDI/JTA/Jakarta Batch lebih rumit jika tidak menjalankan app server penuh,
- control plane `JobOperator` tidak natural,
- job repository dan restartability harus tetap didesain,
- observability perlu disatukan.

### 15.2 Jakarta Batch in App Server

Cocok jika:

- job butuh CDI/JPA/JTA/security yang sama,
- job operator/admin UI berada di aplikasi,
- batch adalah bagian dari domain application lifecycle,
- restart/checkpoint Jakarta Batch dipakai intensif,
- job perlu dipicu dari user/admin API.

### 15.3 Decision Table

| Scenario | Better Fit |
|---|---|
| Nightly domain recalculation with JPA/JTA | Jakarta Batch worker |
| Heavy file conversion independent from app | Kubernetes Job |
| External registry sync with restartable checkpoint | Jakarta Batch |
| One-off data migration | Kubernetes Job / migration tool |
| Long human approval workflow | Workflow engine |
| Continuous event stream | Message/stream processor |
| Simple hourly cleanup | Managed scheduler + idempotent guard |
| Massive distributed ETL | Dedicated data platform, not Jakarta Batch alone |

---

## 16. Graceful Stop vs Kill

### 16.1 Stop is Cooperative

`JobOperator.stop(executionId)` requests a stop. Runtime and batch artifacts must cooperate.

For chunk steps:

- runtime can stop at checkpoint/transaction boundary,
- reader/processor/writer should not ignore interruption/stop signals,
- long external API calls still need timeout.

For batchlets:

- `stop()` may be invoked on a separate thread,
- `process()` must observe stop flag,
- long loops must check stop frequently.

### 16.2 Kill is Abrupt

Pod kill/process kill means:

- no clean listener guarantee,
- no final heartbeat,
- transaction may rollback,
- external side effects may already have happened,
- repository may still show running,
- restart/reconciliation needed.

Design principle:

> Stop should produce known state. Kill produces uncertain state. Batch design must survive uncertain state.

---

## 17. Distributed Side Effects

Clustered execution makes side effects more dangerous.

Examples:

- send email,
- generate PDF,
- submit to external registry,
- create payment/refund,
- publish message,
- write file,
- update case status,
- create audit event.

If node fails after side effect but before checkpoint:

```text
1. Writer sends email for case C123
2. Node crashes before checkpoint commit
3. Restart reads C123 again
4. Writer sends email again
```

Solution categories:

### 17.1 Idempotency Key

```text
operation = SEND_NOTICE
business_key = caseId + noticeTemplate + noticeVersion + batchBusinessDate
```

Store:

```sql
CREATE TABLE side_effect_log (
    idempotency_key VARCHAR(256) PRIMARY KEY,
    operation       VARCHAR(64) NOT NULL,
    status          VARCHAR(32) NOT NULL,
    external_ref    VARCHAR(256),
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL
);
```

### 17.2 Outbox Pattern

Batch writes intent into DB transaction:

```text
Batch Step -> write correspondence_outbox row -> commit
Outbox Dispatcher -> sends email/API -> marks SENT
```

Benefit:

- batch checkpoint and side-effect intent align,
- external sending can be retried separately,
- deduplication easier,
- audit clearer.

### 17.3 Reconciliation

For uncertain cases:

```text
Local status: SUBMITTED_UNKNOWN
External system: maybe received
Action: query external by idempotency key/correlation id
Then mark CONFIRMED or RETRY_REQUIRED
```

---

## 18. Cluster-Aware Batch Control Plane

A production batch control plane should expose more than `start` and `stop`.

### 18.1 Core Capabilities

| Capability | Purpose |
|---|---|
| Submit job request | Create durable business request |
| Validate parameters | Prevent invalid execution |
| Deduplicate request | Prevent duplicate logical job |
| Approve request | Governance for risky jobs |
| Claim request | Assign execution owner |
| Start Jakarta Batch execution | Bridge to `JobOperator` |
| Stop execution | Controlled shutdown |
| Restart execution | Recovery |
| Abandon execution | Mark unrecoverable execution |
| Reconcile stale execution | Detect orphan/zombie jobs |
| View execution graph | Operator visibility |
| View partition state | Parallel diagnosis |
| View side effect state | Business correctness |
| Audit operator action | Regulatory evidence |

### 18.2 Example API Design

```http
POST /admin/batch/job-requests
GET  /admin/batch/job-requests/{id}
POST /admin/batch/job-requests/{id}/approve
POST /admin/batch/job-requests/{id}/start
POST /admin/batch/executions/{executionId}/stop
POST /admin/batch/executions/{executionId}/restart
POST /admin/batch/executions/{executionId}/abandon
POST /admin/batch/executions/{executionId}/reconcile
GET  /admin/batch/executions/{executionId}/steps
GET  /admin/batch/executions/{executionId}/partitions
GET  /admin/batch/executions/{executionId}/side-effects
```

### 18.3 Audit Fields

```text
requestedBy
approvedBy
startedBy
stoppedBy
restartedBy
abandonedBy
reason
changeTicket
businessDate
parameterHash
executionId
ownerNode
ownerVersion
correlationId
```

---

## 19. Readiness for Clustered Batch: Invariants

A clustered batch system should preserve these invariants:

### Invariant 1 — One Logical Job Request

For a given logical business key, only one active request exists unless explicitly allowed.

```text
(jobName, businessScope, parameterHash) unique while active
```

### Invariant 2 — One Active Owner

A running execution has at most one active owner.

```text
executionId -> ownerInstanceId
```

### Invariant 3 — Bounded Resource Use

Batch cannot consume unbounded DB/API/CPU/memory capacity.

```text
maxBatchDbConnections <= configuredBudget
maxApiCallsPerMinute <= downstreamLimit
maxPartitions <= safeParallelism
```

### Invariant 4 — Restart Is Safe

Anything that can be replayed is idempotent or reconciled.

```text
replay(item) does not corrupt state
```

### Invariant 5 — Stop Has Known Semantics

Stop means either:

- stop at checkpoint boundary,
- stop after current batchlet safe point,
- or mark as uncertain requiring reconciliation.

### Invariant 6 — Deployment Does Not Silently Corrupt Execution

Code/version/checkpoint compatibility must be governed.

### Invariant 7 — Operator Can Explain State

For every execution, operator can answer:

- what is running,
- where it is running,
- why it is running,
- who initiated it,
- what input it uses,
- how far it progressed,
- what failed,
- what can be safely retried.

---

## 20. Common Anti-Patterns

### 20.1 Scheduler on Every Node Without Dedup

```text
@Schedule(hour="1")
public void run() {
    jobOperator.start("dailyJob", params);
}
```

Bad because every node may start the same job.

### 20.2 Assuming In-Memory State Is Cluster State

```java
static boolean running;
```

Bad because it is JVM-local.

### 20.3 Long Lock for Whole Job

Holding DB lock for hours is fragile.

Better:

- use request dedup,
- lease ownership with heartbeat,
- checkpoint/restart.

### 20.4 Non-Versioned Checkpoint

Checkpoint object evolves and restart fails after deployment.

### 20.5 No Shutdown Drain

Rolling deployment kills running batch abruptly.

### 20.6 Batch Shares All Resources With Online Traffic

Batch consumes DB pool and online request latency spikes.

### 20.7 Assuming Stop Is Immediate

Stop is cooperative. Long blocking calls need timeout.

### 20.8 Restart Without Reconciliation

Restarting after uncertain side effects can duplicate external actions.

### 20.9 No Operator Evidence

A job “failed somewhere” with no partition/chunk/item evidence is operationally weak.

---

## 21. Design Blueprint: Cluster-Safe Jakarta Batch

### 21.1 Architecture

```text
                   +----------------------+
Admin/API/Schedule | Batch Control Plane  |
        +--------->| - validate params    |
        |          | - dedup request      |
        |          | - audit actions      |
        |          +----------+-----------+
        |                     |
        |                     v
        |          +----------------------+
        |          | Job Request Table    |
        |          | Ownership / Lease    |
        |          +----------+-----------+
        |                     |
        |                     v
+-------+--------+   +--------+-------+   +--------+-------+
| Batch Worker A |   | Batch Worker B |   | Batch Worker C |
| Jakarta Batch  |   | Jakarta Batch  |   | Jakarta Batch  |
+-------+--------+   +--------+-------+   +--------+-------+
        |                     |                    |
        +---------------------+--------------------+
                              |
                              v
                     +----------------+
                     | Batch Repo DB  |
                     +----------------+
                              |
                              v
                     +----------------+
                     | Domain DB /    |
                     | Outbox / Audit |
                     +----------------+
```

### 21.2 Flow

```text
1. Scheduler/API submits logical job request.
2. Control plane validates and deduplicates.
3. Worker claims request using lease.
4. Worker calls JobOperator.start.
5. Batch job updates progress/heartbeat.
6. Side effects use outbox/idempotency.
7. Completion updates request state.
8. Reconciler detects stale/orphaned executions.
9. Operator can stop/restart/abandon with audit reason.
```

---

## 22. Example: Safe Scheduled Launch

```java
@ApplicationScoped
public class DailyBatchScheduler {

    @Inject
    BatchRequestService requestService;

    public void onSchedule() {
        LocalDate businessDate = LocalDate.now(ZoneId.of("Asia/Jakarta")).minusDays(1);

        BatchRequestCommand command = new BatchRequestCommand(
            "case-ageing-recalculation",
            "agency=CEA;businessDate=" + businessDate,
            Map.of(
                "businessDate", businessDate.toString(),
                "mode", "DAILY"
            ),
            "SYSTEM_SCHEDULER"
        );

        requestService.submitIfAbsent(command);
    }
}
```

Key point: scheduler does not directly call `JobOperator.start`. It creates an idempotent request.

---

## 23. Example: Claim and Start

```java
@ApplicationScoped
public class BatchWorker {

    @Inject
    JobOperator jobOperator;

    @Inject
    BatchRequestRepository requestRepository;

    public void pollAndStart() {
        String ownerId = RuntimeIdentity.currentInstanceId();

        Optional<BatchJobRequest> maybeRequest =
            requestRepository.claimNextPending(ownerId, Duration.ofMinutes(10));

        if (maybeRequest.isEmpty()) {
            return;
        }

        BatchJobRequest request = maybeRequest.get();

        try {
            Properties params = toJobParameters(request);
            long executionId = jobOperator.start(request.logicalJobName(), params);

            requestRepository.markStarted(request.id(), executionId, ownerId);
        } catch (Exception e) {
            requestRepository.markStartFailed(request.id(), e.getMessage());
            throw e;
        }
    }
}
```

Production notes:

- `claimNextPending` harus atomic.
- Pakai DB transaction.
- Jangan claim banyak job sekaligus jika worker capacity terbatas.
- Simpan `executionId` segera setelah start.
- Jika crash setelah `start` sebelum `markStarted`, perlu reconciliation.

---

## 24. Example: Atomic Claim SQL Pattern

Generic idea:

```sql
UPDATE batch_job_request
SET status = 'CLAIMED',
    owner_instance_id = ?,
    lease_until = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE request_id = (
    SELECT request_id
    FROM batch_job_request
    WHERE status = 'APPROVED'
    ORDER BY requested_at
    FETCH FIRST 1 ROW ONLY
)
AND status = 'APPROVED';
```

DB-specific syntax varies. For Oracle, PostgreSQL, SQL Server, and MySQL you may use different locking/read patterns.

Important properties:

- only one worker wins,
- no in-memory coordination,
- transaction commits claim,
- stale claims can expire,
- audit stores owner.

---

## 25. Reconciliation Loop

You need a reconciler because distributed systems produce uncertain states.

```java
@ApplicationScoped
public class BatchReconciler {

    @Inject
    BatchRequestRepository requestRepository;

    @Inject
    JobOperator jobOperator;

    public void reconcile() {
        List<BatchJobRequest> active = requestRepository.findActiveRequests();

        for (BatchJobRequest request : active) {
            reconcileOne(request);
        }
    }

    private void reconcileOne(BatchJobRequest request) {
        if (request.batchExecutionId() == null && request.claimExpired()) {
            requestRepository.releaseExpiredClaim(request.id());
            return;
        }

        if (request.batchExecutionId() != null) {
            BatchStatus status = jobOperator.getJobExecution(request.batchExecutionId()).getBatchStatus();

            switch (status) {
                case COMPLETED -> requestRepository.markCompleted(request.id());
                case FAILED -> requestRepository.markFailed(request.id());
                case STOPPED -> requestRepository.markStopped(request.id());
                case STARTED, STARTING -> {
                    if (request.heartbeatExpired()) {
                        requestRepository.markPossiblyOrphaned(request.id());
                    }
                }
                default -> requestRepository.recordObservedStatus(request.id(), status.name());
            }
        }
    }
}
```

Caveat: method names/statuses depend on API and implementation details. The point is the state reconciliation pattern.

---

## 26. Testing Clustered Batch

### 26.1 Local Unit Tests Are Not Enough

You need tests for:

- duplicate launch,
- two workers claiming same request,
- crash after claim before start,
- crash after start before recording execution id,
- crash mid-chunk,
- restart after checkpoint,
- partition failure,
- stop during API call,
- rolling deployment drain,
- stale heartbeat,
- external side effect replay.

### 26.2 Failure Injection Matrix

| Test | Expected Result |
|---|---|
| Two nodes submit same job | One request created |
| Two workers claim same request | One claim wins |
| Node killed mid-step | Execution becomes stale/orphaned |
| Restart after kill | Continues from checkpoint or safe replay |
| External API succeeds then node dies | No duplicate side effect or reconciliation occurs |
| Deployment during job | Job drains/stops safely or is recoverable |
| Partition 3 fails | Other partition state visible; restart safe |
| DB temporarily unavailable | Job fails/retries according to policy, no infinite storm |
| Stop requested | Job reaches STOPPED at safe boundary |

### 26.3 Chaos Testing Scenarios

- kill pod randomly during writer,
- restart DB connection pool,
- inject API 429/500,
- slow down one partition,
- simulate clock skew if using lease,
- deploy new version while job is running,
- exhaust DB pool intentionally in staging,
- corrupt one input record,
- duplicate scheduler event.

---

## 27. Observability for Clustered Batch

Metrics:

```text
batch_job_requests_total{job,status}
batch_job_active{job,owner}
batch_job_duplicate_launch_total{job}
batch_job_orphaned_total{job}
batch_job_restarts_total{job}
batch_job_stop_requests_total{job}
batch_partition_active{job,step,partition}
batch_partition_duration_seconds{job,step,partition}
batch_heartbeat_age_seconds{job,execution}
batch_claim_failures_total{job}
batch_side_effect_duplicates_prevented_total{operation}
```

Logs should include:

```text
correlationId
jobRequestId
jobName
executionId
stepName
partitionId
ownerInstanceId
ownerVersion
businessKey
parameterHash
```

Dashboard panels:

- active jobs by owner,
- stale jobs,
- duplicate request attempts,
- partition skew,
- failed side effects,
- restart count,
- queue/request backlog,
- DB/API resource usage,
- deployment overlap with active jobs.

---

## 28. Regulatory/Case Management Example

Scenario:

- nightly recalculation of case ageing,
- case escalation evaluation,
- correspondence generation,
- external agency sync,
- audit evidence required.

### 28.1 Logical Job Key

```text
jobName = enforcement-nightly-evaluation
businessScope = agency=CEA;businessDate=2026-06-16
parameterHash = sha256(all normalized params)
```

### 28.2 Partitioning

Partition by stable case range or agency/module:

```text
P0: case_id range 000000-099999
P1: case_id range 100000-199999
P2: case_id range 200000-299999
P3: case_id range 300000-399999
```

Or by module if fairness matters:

```text
P0: Application Management
P1: Compliance
P2: Enforcement
P3: Appeal
```

### 28.3 Side Effects

Do not send correspondence directly in the same writer if restart duplicate is risky.

Better:

```text
Batch writer creates correspondence_outbox row with idempotency key.
Dispatcher sends correspondence.
Dispatcher records external reference.
Audit links batch execution -> outbox -> correspondence -> case timeline.
```

### 28.4 Operator Evidence

For every job:

```text
Who requested? SYSTEM_SCHEDULER
What window? 2026-06-16
What cases? 421,932 candidates
How many updated? 31,204
How many skipped? 182 business-invalid
How many failed? 7 technical pending retry
What changed? escalation_due_date, ageing_bucket, next_action
Can restart? yes, from checkpoint case_id=...
Any duplicate prevented? yes, 3 duplicate schedule triggers ignored
```

---

## 29. Decision Framework

Before deploying clustered Jakarta Batch, answer these questions:

### 29.1 Ownership

- What identifies a runtime instance?
- Where is owner stored?
- How is ownership claimed?
- How does lease expire?
- Who can take over?

### 29.2 Deduplication

- What is the logical job idempotency key?
- Is duplicate launch allowed?
- What happens if the same scheduler fires from multiple nodes?

### 29.3 Recovery

- What happens if node dies after claim?
- What happens if node dies after `JobOperator.start`?
- What happens if node dies after external side effect?
- How is orphan detected?
- How is restart authorized?

### 29.4 Deployment

- Can deployment happen while jobs run?
- Are checkpoints versioned?
- Does pod drain stop jobs safely?
- Are batch workers separate from web pods?

### 29.5 Resource Isolation

- How much DB pool can batch use?
- How many partitions are allowed?
- What external API rate limit applies?
- Can batch starve online traffic?

### 29.6 Observability

- Can operator identify owner node?
- Can operator see partition progress?
- Can operator distinguish failed/stopped/orphaned?
- Are duplicate prevented attempts measured?
- Are side effects traceable?

---

## 30. Checklist

### Cluster Launch Safety

- [ ] Job launch uses business idempotency key.
- [ ] Duplicate trigger is harmless.
- [ ] In-memory guards are not used as cluster guards.
- [ ] Scheduler either singleton or deduplicated.
- [ ] Job request table records requestedBy/reason/params hash.

### Ownership and Lease

- [ ] Each running job has owner instance id.
- [ ] Lease/heartbeat exists for long-running jobs.
- [ ] Orphan detection exists.
- [ ] Restart after orphan requires safe policy.

### Repository and Restart

- [ ] Job repository is durable and shared if cluster restart is expected.
- [ ] Checkpoint data is stable/versioned.
- [ ] Restart was tested after process kill.
- [ ] Side effects are idempotent/reconciled.

### Kubernetes/Deployment

- [ ] Readiness turns false during drain.
- [ ] Liveness does not kill healthy long-running batch.
- [ ] `terminationGracePeriodSeconds` matches safe stop needs.
- [ ] Deployment policy considers active jobs.
- [ ] Batch worker resource budgets are separated or controlled.

### Partitioning

- [ ] Partition count is capacity-based.
- [ ] Partition ownership/progress visible.
- [ ] Skew detection exists.
- [ ] External API/DB bottlenecks considered.

### Observability and Audit

- [ ] Logs include jobRequestId/executionId/owner/partition.
- [ ] Metrics include active/stale/failed/restarted/duplicate.
- [ ] Operator can explain current state.
- [ ] Audit records start/stop/restart/abandon reason.

---

## 31. Ringkasan

Clustered Jakarta Batch adalah distributed workload problem.

Hal yang harus diingat:

1. Jakarta Batch menyediakan job, step, checkpoint, restart, dan `JobOperator` semantics.
2. Cluster menambahkan problem ownership, duplicate launch, failover, lease, deployment, and distributed side effect.
3. Jangan mengandalkan in-memory guard untuk cluster coordination.
4. Gunakan business idempotency key untuk launch deduplication.
5. Gunakan control plane table untuk request, ownership, heartbeat, dan audit.
6. Node failure harus menghasilkan state yang bisa direconcile.
7. Restart aman hanya jika checkpoint stabil dan writer/side effect idempotent.
8. Rolling deployment harus tahu apakah job sedang berjalan.
9. Kubernetes pod bisa mati kapan saja; batch harus survive melalui checkpoint/restart/reconciliation.
10. Partitioning adalah kapasitas terkontrol, bukan sekadar parallelism.
11. Operator harus bisa menjelaskan state job secara defensible.

Mental model final:

> Single-node batch adalah execution problem. Clustered batch adalah ownership, coordination, and recovery problem.

---

## 32. Latihan / Thought Experiment

### Latihan 1 — Duplicate Scheduler

Aplikasi punya 5 pod. Semua pod menjalankan scheduler jam 02:00 untuk `dailyCaseAgeingJob`.

Rancang:

- idempotency key,
- request table,
- duplicate prevention,
- log/metric untuk duplicate attempt,
- operator message yang ditampilkan jika duplicate terjadi.

### Latihan 2 — Pod Killed Mid-Chunk

Batch sedang memproses 1 juta case. Commit interval 500. Pod mati setelah writer menulis 300 item dari chunk tetapi sebelum commit.

Jawab:

- Apa yang terjadi pada transaksi?
- Apa yang terjadi pada checkpoint?
- Apa risiko external side effect?
- Bagaimana writer harus didesain?

### Latihan 3 — Rolling Deployment

Job berjalan 2 jam. Deployment otomatis terjadi setiap malam jam 01:30. Job juga dimulai jam 01:00.

Rancang policy:

- drain,
- stop,
- restart,
- version compatibility,
- operator warning.

### Latihan 4 — Clustered External API Batch

Batch memanggil API eksternal limit 300 request/min. Ada 4 worker pod dan 12 partition.

Rancang:

- global rate limit,
- partition concurrency,
- retry budget,
- 429 handling,
- deduplication key,
- metric dashboard.

### Latihan 5 — Regulatory Evidence

Untuk sebuah job enforcement escalation, auditor bertanya: “Kenapa case C-123 berubah status jam 02:13?”

Rancang evidence chain:

```text
job request -> job execution -> step -> partition -> item -> rule version -> status change -> audit trail
```

---

## 33. Penutup Part 30

Bagian ini menutup isu **distributed execution** untuk Jakarta Batch. Setelah memahami ini, kamu seharusnya tidak lagi melihat batch sebagai “loop panjang di background”, tetapi sebagai sistem eksekusi yang membutuhkan:

- ownership,
- deduplication,
- durable state,
- heartbeat,
- restartability,
- idempotency,
- deployment awareness,
- resource governance,
- operator control,
- audit evidence.

Bagian berikutnya akan masuk ke **performance engineering for Jakarta Batch**: throughput model, commit interval tuning, partition count tuning, bottleneck isolation, JDBC fetch/batch size, GC, DB connection pressure, dan capacity planning.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./29-external-api-batch-rate-limits-retries-idempotent-integration.md">⬅️ Part 29 — External API Batch: Rate Limits, Retries, and Idempotent Integration</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./31-performance-engineering-jakarta-batch.md">Part 31 — Performance Engineering for Jakarta Batch ➡️</a>
</div>

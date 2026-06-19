# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-020
# Scheduler, Jobs, Batch, and Workload Orchestration

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `020`  
> Topik: Scheduler, Jobs, Batch, and Workload Orchestration  
> Status: Materi lanjutan advance — tidak mengulang dasar Java/Jakarta  
> Target: Software engineer yang mampu mendesain workload background yang aman, idempotent, observable, scalable, dan defensible untuk production

---

## 0. Ringkasan Besar

Banyak engineer menganggap scheduler sebagai fitur kecil:

```java
@Scheduled(cron = "0 0 2 * * ?")
void runNightlyJob() {
    // do something
}
```

Namun di sistem production, scheduler bukan hanya “menjalankan method pada waktu tertentu”.

Scheduler adalah **mekanisme orkestrasi workload**.

Begitu sebuah task berjalan otomatis, sistem harus menjawab banyak pertanyaan:

1. Apakah task boleh berjalan lebih dari sekali?
2. Apa yang terjadi jika pod restart saat job sedang berjalan?
3. Apa yang terjadi jika ada 3 replica aplikasi?
4. Apakah job berjalan di semua node atau hanya satu node?
5. Apakah job boleh overlap dengan run sebelumnya?
6. Apakah job idempotent?
7. Bagaimana jika downstream lambat?
8. Bagaimana jika job gagal di tengah?
9. Apakah retry aman?
10. Apakah ada audit trail?
11. Apakah operator bisa mem-pause job?
12. Apakah job bisa dilanjutkan dari checkpoint?
13. Apakah job menyebabkan spike database?
14. Bagaimana job diamati di metrics/log/tracing?
15. Apakah job cocok sebagai in-app scheduler, Quartz clustered scheduler, Kubernetes CronJob, queue worker, atau external orchestrator?

Part ini membahas scheduler di Quarkus bukan sebagai syntax, tetapi sebagai desain workload production.

---

## 1. Mental Model: Scheduler Bukan Timer, Scheduler Adalah Workload Owner

Scheduler sering disalahpahami sebagai “alarm clock”.

Mental model yang lebih tepat:

```text
Scheduler = policy yang menentukan kapan workload dimulai
Job       = unit kerja yang punya state, idempotency, retry, dan observability
Worker    = executor yang mengerjakan beban
Checkpoint= bukti progress
Lock      = mekanisme ownership
Run record= bukti historis bahwa job pernah dijalankan
```

Dalam sistem kecil, semua itu bisa digabung menjadi satu method.

Dalam sistem besar, kelimanya harus dipisahkan.

Contoh desain buruk:

```java
@Scheduled(cron = "0 0 1 * * ?")
void exportReport() {
    reportService.exportAll();
}
```

Masalah:

- tidak ada run id,
- tidak ada checkpoint,
- tidak ada lock,
- tidak ada audit,
- tidak tahu progress,
- tidak bisa resume,
- tidak tahu partial failure,
- tidak tahu apakah safe retry,
- jika app punya 3 replica, bisa berisiko jalan 3 kali jika scheduler tidak clustered,
- jika job lambat, bisa overlap dengan run berikutnya.

Desain lebih baik:

```text
Scheduled trigger
      |
      v
Create job_run record
      |
      v
Acquire lock / ownership
      |
      v
Process partitions with checkpoint
      |
      v
Write per-item result
      |
      v
Publish metrics + audit
      |
      v
Mark completed / failed / partial
```

Inilah perubahan mental model utama.

---

## 2. Quarkus Scheduling Landscape

Quarkus menyediakan dua keluarga utama untuk scheduling:

1. **Quarkus Scheduler**
2. **Quarkus Quartz**

### 2.1 Quarkus Scheduler

Quarkus Scheduler adalah scheduler ringan berbasis in-memory.

Karakteristik:

- mudah dipakai,
- cocok untuk periodic task sederhana,
- berbasis annotation `@Scheduled`,
- tidak butuh database,
- lifecycle mengikuti aplikasi,
- tidak menyimpan job trigger secara persistent,
- cocok untuk single-node/simple workload.

Contoh:

```java
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class CleanupJob {

    @Scheduled(every = "1h")
    void cleanup() {
        // cleanup lightweight temporary data
    }
}
```

Cocok untuk:

- local cleanup,
- cache refresh sederhana,
- heartbeat internal,
- polling ringan,
- development utility,
- metrics aggregation kecil,
- periodic health self-check.

Tidak cocok untuk:

- job harus exactly once dalam cluster,
- job harus survive restart,
- job butuh persistent trigger,
- job long-running,
- job critical financial/regulatory,
- job yang harus punya audit/retry/checkpoint serius.

### 2.2 Quarkus Quartz

Quartz dipakai ketika scheduling membutuhkan fitur enterprise:

- persistent jobs,
- clustering,
- misfire handling,
- distributed execution,
- more advanced schedule model,
- database-backed job store.

Contoh high-level:

```java
@Scheduled(cron = "0 0 2 * * ?")
void runNightlyBatch() {
    // executed through Quartz when quarkus-quartz is used
}
```

Jika extension Quartz aktif, Quarkus dapat memakai Quartz sebagai implementation scheduler.

Cocok untuk:

- clustered scheduled job,
- persistent scheduled job,
- production batch yang harus recover,
- job dengan cron kompleks,
- job yang tidak boleh hilang saat restart,
- job yang harus dikoordinasikan antar node.

Namun Quartz bukan silver bullet. Ia menyelesaikan trigger/ownership scheduling, tetapi tidak otomatis membuat business logic idempotent.

---

## 3. Pemilihan Tool: In-App Scheduler vs Quartz vs Kubernetes CronJob vs Queue Worker

Kesalahan umum adalah langsung memakai `@Scheduled` untuk semua background work.

Pertanyaan yang benar:

> “Siapa yang harus memiliki lifecycle workload ini?”

### 3.1 Decision Table

| Kebutuhan | Pilihan Lebih Cocok |
|---|---|
| Task sangat ringan, tidak critical | Quarkus Scheduler |
| Single instance service | Quarkus Scheduler cukup |
| Multi-replica tapi task boleh jalan di semua node | Quarkus Scheduler |
| Multi-replica tapi task hanya boleh jalan satu kali | Quartz clustered / distributed lock / Kubernetes CronJob |
| Task harus survive app restart | Quartz persistent / job table / queue |
| Task long-running | Queue worker / batch orchestrator / Kubernetes Job |
| Task butuh retry per item | Queue worker / batch table |
| Task butuh audit lengkap | Job-run table + checkpoint |
| Task butuh manual rerun | Job-run table + admin endpoint |
| Task membutuhkan scaling horizontal worker | Queue-based worker |
| Task cron sederhana tapi isolated dari app | Kubernetes CronJob |
| Task butuh orchestration multi-step | Workflow/process orchestrator |
| Task perlu distributed transaction | Jangan mulai dari scheduler; desain consistency boundary dulu |

### 3.2 Rule of Thumb

Gunakan **Quarkus Scheduler** jika:

```text
Jika job hilang saat restart tidak masalah,
jika job berjalan ulang tidak berbahaya,
jika job berjalan di setiap node tidak berbahaya,
dan jika job selesai cepat.
```

Gunakan **Quartz** jika:

```text
Jika trigger scheduling harus persistent,
jika clustered execution dibutuhkan,
dan jika schedule ownership harus dikelola antar node.
```

Gunakan **Kubernetes CronJob** jika:

```text
Jika workload lebih cocok dipisah sebagai process/container terpisah
dan lifecycle-nya tidak perlu ikut REST service.
```

Gunakan **queue worker** jika:

```text
Jika workload besar, bisa dipartisi, perlu retry per item,
dan perlu backpressure natural.
```

Gunakan **workflow engine** jika:

```text
Jika workload adalah proses bisnis multi-step, long-running,
punya human wait state, SLA, compensation, escalation, dan audit workflow.
```

---

## 4. Quarkus Scheduler Basic API

### 4.1 Menambahkan Extension

Maven:

```bash
./mvnw quarkus:add-extension -Dextensions="scheduler"
```

Gradle:

```bash
./gradlew addExtension --extensions="scheduler"
```

Dependency konseptual:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-scheduler</artifactId>
</dependency>
```

### 4.2 `@Scheduled(every = ...)`

```java
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class TokenRefreshScheduler {

    @Scheduled(every = "10m")
    void refresh() {
        // refresh token cache
    }
}
```

Makna desain:

- trigger setiap 10 menit,
- method dipanggil oleh scheduler,
- jika app tidak berjalan, tidak ada trigger,
- jika ada banyak replica tanpa coordination, pahami apakah masing-masing punya scheduler sendiri.

### 4.3 `@Scheduled(cron = ...)`

```java
@Scheduled(cron = "0 0 2 * * ?")
void nightlyCleanup() {
    // run every day at 02:00
}
```

Cron cocok untuk jadwal kalender.

Namun cron tidak menjawab:

- timezone,
- missed execution,
- overlap,
- cluster ownership,
- restart behavior,
- retry behavior,
- auditability.

Semua harus didesain.

### 4.4 Configurable Schedule

Jangan hardcode semua schedule.

```java
@Scheduled(cron = "{jobs.cleanup.cron}")
void cleanup() {
    cleanupService.run();
}
```

`application.properties`:

```properties
jobs.cleanup.cron=0 0 2 * * ?
```

Keuntungan:

- jadwal bisa berbeda antar environment,
- schedule bisa dinonaktifkan lewat config,
- operasi lebih fleksibel.

Namun jangan membiarkan semua orang mengubah cron production tanpa change control.

---

## 5. Scheduler Method Design: Thin Trigger, Thick Service

Anti-pattern:

```java
@Scheduled(cron = "{jobs.expiry.cron}")
void expireApplications() {
    List<Application> apps = repository.findExpired();

    for (Application app : apps) {
        app.expire();
        repository.persist(app);
        emailService.sendExpiredNotification(app);
    }
}
```

Masalah:

- scheduler method mengandung business logic,
- sulit dites,
- sulit dipanggil manual,
- sulit membuat rerun,
- sulit observability,
- sulit idempotency.

Desain lebih baik:

```java
@ApplicationScoped
public class ExpiryScheduler {

    private final ExpiryJobService expiryJobService;

    public ExpiryScheduler(ExpiryJobService expiryJobService) {
        this.expiryJobService = expiryJobService;
    }

    @Scheduled(cron = "{jobs.expiry.cron}")
    void trigger() {
        expiryJobService.triggerScheduledRun("scheduled-expiry");
    }
}
```

Service:

```java
@ApplicationScoped
public class ExpiryJobService {

    public JobRunId triggerScheduledRun(String triggerSource) {
        JobRunId runId = createRun(triggerSource);
        run(runId);
        return runId;
    }

    void run(JobRunId runId) {
        // ownership, partitioning, checkpoint, processing, metrics
    }
}
```

Invariants:

```text
Scheduler method hanya trigger.
Business job ada di service.
Job service bisa dipanggil oleh scheduler, admin endpoint, test, atau recovery tool.
```

Ini penting untuk production.

---

## 6. Job Run Table: Fondasi Audit dan Recovery

Untuk job critical, selalu pertimbangkan table `job_run`.

Contoh schema konseptual:

```sql
create table job_run (
    id                 varchar(64) primary key,
    job_name           varchar(128) not null,
    trigger_source     varchar(64) not null,
    status             varchar(32) not null,
    requested_by       varchar(128),
    started_at         timestamp,
    finished_at        timestamp,
    last_heartbeat_at  timestamp,
    attempt_no         integer not null,
    config_snapshot    clob,
    error_code         varchar(128),
    error_message      varchar(4000),
    created_at         timestamp not null,
    updated_at         timestamp not null
);
```

Status state machine:

```text
REQUESTED
  -> RUNNING
  -> COMPLETED

REQUESTED
  -> RUNNING
  -> FAILED

REQUESTED
  -> CANCELLED

RUNNING
  -> CANCELLING
  -> CANCELLED

RUNNING
  -> STALE
  -> RECOVERING
  -> RUNNING

FAILED
  -> RETRY_REQUESTED
  -> RUNNING
```

Kenapa perlu table ini?

Karena production perlu menjawab:

- job apa yang berjalan?
- kapan mulai?
- kapan selesai?
- siapa/apa trigger-nya?
- versi konfigurasi apa yang dipakai?
- berapa banyak item diproses?
- gagal di mana?
- bisa rerun tidak?
- apakah ada partial completion?
- apakah operator bisa audit?

Tanpa job-run table, scheduled job menjadi invisible work.

---

## 7. Idempotency: Properti Terpenting Background Job

Background job hampir selalu harus idempotent.

Definisi sederhana:

```text
Menjalankan job yang sama lebih dari sekali tidak menyebabkan efek bisnis ganda yang salah.
```

Contoh buruk:

```java
void sendReminder(Application app) {
    emailClient.send(app.email(), "Reminder");
}
```

Jika job retry, email bisa terkirim berkali-kali.

Lebih baik:

```java
void sendReminder(Application app, JobRunId runId) {
    if (notificationRepository.exists(app.id(), "REMINDER_7_DAYS")) {
        return;
    }

    emailClient.send(app.email(), "Reminder");

    notificationRepository.markSent(app.id(), "REMINDER_7_DAYS", runId);
}
```

Namun ini masih punya race condition jika `send` berhasil tapi `markSent` gagal.

Lebih robust:

```text
1. Insert notification_outbox with unique business key.
2. Separate publisher sends email.
3. Publisher marks sent.
4. Unique key prevents duplicate intent.
```

Unique key:

```sql
alter table notification_outbox
add constraint uq_notification_intent
unique (aggregate_id, notification_type);
```

Idempotency harus dibangun di level:

- input selection,
- state transition,
- side effect,
- outbox publishing,
- per-item result,
- retry,
- external API call,
- final status update.

---

## 8. Overlap Control: Jangan Biarkan Run Bertabrakan Tanpa Sengaja

Pertanyaan penting:

> Apakah run berikutnya boleh dimulai sebelum run sebelumnya selesai?

Contoh:

```text
Job dijadwalkan tiap 5 menit.
Satu run kadang butuh 12 menit.
```

Jika overlap dibiarkan:

```text
00:00 run A mulai
00:05 run B mulai
00:10 run C mulai
```

Dampak:

- double processing,
- DB lock contention,
- duplicate notification,
- external API rate limit,
- inconsistent status,
- operator bingung.

### 8.1 Non-overlap via Lock Table

Schema:

```sql
create table job_lock (
    job_name       varchar(128) primary key,
    owner_id       varchar(128) not null,
    locked_until   timestamp not null,
    locked_at      timestamp not null
);
```

Acquire lock pseudo-SQL:

```sql
update job_lock
set owner_id = :ownerId,
    locked_until = :lockedUntil,
    locked_at = current_timestamp
where job_name = :jobName
  and locked_until < current_timestamp;
```

Jika update count 1, lock berhasil.

Jika update count 0, job sedang dimiliki instance lain.

### 8.2 Lock Timeout Harus Ada

Lock tanpa expiry bisa menyebabkan deadlock operasional.

```text
Pod mati saat memegang lock.
Lock tidak pernah dilepas.
Job berhenti selamanya.
```

Karena itu lock harus punya:

- `locked_until`,
- heartbeat,
- stale detection,
- safe takeover rule.

### 8.3 Jangan Mengandalkan In-Memory Flag untuk Cluster

Buruk:

```java
private boolean running = false;

@Scheduled(every = "5m")
void run() {
    if (running) {
        return;
    }

    running = true;
    try {
        doWork();
    } finally {
        running = false;
    }
}
```

Ini hanya mencegah overlap di satu JVM.

Jika ada 3 pod:

```text
pod-a running=false
pod-b running=false
pod-c running=false
```

Ketiganya bisa jalan.

---

## 9. Clustered Scheduling: Kenapa Banyak Pod Mengubah Semuanya

Di Kubernetes, aplikasi biasanya punya beberapa replica:

```yaml
replicas: 3
```

Jika setiap pod menjalankan scheduler in-memory, maka schedule bisa dieksekusi oleh setiap pod.

Untuk sebagian task ini benar:

- refresh local cache,
- emit node-local metric,
- cleanup temp file lokal.

Untuk task global ini salah:

- generate monthly report,
- expire application,
- send reminder,
- sync external data,
- archive records,
- create billing invoice.

Pertanyaan desain:

```text
Apakah job ini node-local atau cluster-global?
```

### 9.1 Node-Local Job

Contoh:

```text
Membersihkan cache memory lokal setiap 30 menit.
```

Boleh berjalan di semua pod.

### 9.2 Cluster-Global Job

Contoh:

```text
Mengirim reminder untuk semua application yang due.
```

Harus ada coordination.

Pilihan:

1. Quartz clustered scheduler.
2. Distributed lock.
3. Kubernetes CronJob dengan concurrency policy.
4. Queue-based ownership.
5. External orchestrator.

---

## 10. Quartz di Quarkus: Kapan dan Bagaimana Dipakai

Quartz memberikan scheduling yang lebih kuat dibanding scheduler in-memory.

### 10.1 Menambahkan Extension

```bash
./mvnw quarkus:add-extension -Dextensions="quartz"
```

Konseptual dependency:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-quartz</artifactId>
</dependency>
```

### 10.2 Persistent Store

Untuk clustered/persistent scheduling, Quartz membutuhkan job store yang persistent.

Contoh konfigurasi konseptual:

```properties
quarkus.quartz.store-type=jdbc-cmt
quarkus.quartz.clustered=true
quarkus.quartz.table-prefix=QRTZ_
```

Datasource:

```properties
quarkus.datasource.db-kind=postgresql
quarkus.datasource.username=${DB_USERNAME}
quarkus.datasource.password=${DB_PASSWORD}
quarkus.datasource.jdbc.url=${DB_URL}
```

Catatan:

- table Quartz harus tersedia,
- migration harus dikontrol,
- datasource pool harus sizing dengan benar,
- Quartz DB bukan tempat menyimpan business checkpoint,
- Quartz trigger state bukan pengganti job_run table.

### 10.3 Misfire

Misfire terjadi saat trigger seharusnya berjalan tetapi scheduler tidak sempat menjalankan tepat waktu.

Penyebab:

- aplikasi down,
- scheduler paused,
- DB unavailable,
- worker busy,
- node restart,
- thread pool exhausted.

Pertanyaan misfire:

```text
Jika job pukul 02:00 terlewat, apakah harus dijalankan saat app hidup lagi?
Atau skip?
Atau hanya run latest?
Atau run semua missed schedules?
```

Tidak ada jawaban universal.

Contoh:

| Job | Misfire Policy |
|---|---|
| Hourly cache refresh | skip old run |
| Daily billing | run missed |
| Reminder email | run latest selection |
| Data archival | run missed but checkpointed |
| External reconciliation | run manually/controlled |

### 10.4 Quartz Bukan Pengganti Idempotency

Walaupun Quartz clustered bisa membantu hanya satu node mengeksekusi trigger, tetap mungkin terjadi:

- job mulai lalu gagal,
- DB commit sebagian,
- external call berhasil tapi app crash,
- operator rerun,
- misfire recovery,
- failover node mengambil alih.

Karena itu business operation tetap harus idempotent.

---

## 11. Kubernetes CronJob vs In-App Scheduler

Kubernetes CronJob membuat pod/job baru sesuai jadwal.

Contoh karakteristik:

```text
Schedule -> Kubernetes creates Job -> Pod runs -> Pod exits
```

Kelebihan:

- workload terisolasi dari REST service,
- resource request/limit bisa berbeda,
- restart policy terpisah,
- logs terpisah,
- deployment lifecycle lebih eksplisit,
- cocok untuk batch command-style.

Kekurangan:

- butuh container command yang jelas,
- startup overhead,
- shared code packaging harus rapi,
- credential/config harus tersedia,
- observability harus dibuat,
- concurrency policy harus dipikirkan,
- tidak cocok untuk high-frequency sub-minute task.

### 11.1 Kapan Kubernetes CronJob Lebih Baik

Gunakan Kubernetes CronJob jika:

- job berat,
- job jarang,
- resource profile berbeda dari API service,
- ingin menghindari scheduler berjalan di semua app replica,
- ingin failure terisolasi,
- ingin menjalankan command khusus,
- job tidak perlu in-memory state aplikasi.

Contoh:

```text
Nightly data export
Monthly archival
Database reconciliation
Bulk report generation
```

### 11.2 Kapan In-App Scheduler Lebih Baik

Gunakan in-app scheduler jika:

- task ringan,
- task sangat terkait runtime aplikasi,
- butuh akses CDI service langsung,
- butuh high frequency,
- tidak ingin pod terpisah,
- failure impact kecil.

Contoh:

```text
Refresh internal token
Clear local cache
Emit periodic heartbeat
Poll lightweight external status
```

---

## 12. Job as State Machine

Production job harus dipikirkan sebagai state machine.

Contoh job archival:

```text
CREATED
  -> LOCK_ACQUIRED
  -> SCANNING
  -> PARTITIONING
  -> PROCESSING
  -> VERIFYING
  -> COMPLETED

PROCESSING
  -> PARTIALLY_FAILED
  -> RETRYING
  -> PROCESSING

PROCESSING
  -> CANCELLING
  -> CANCELLED

PROCESSING
  -> FAILED
```

Kenapa state machine penting?

Karena job bisa:

- gagal di tengah,
- timeout,
- di-cancel operator,
- dilanjutkan,
- di-rerun,
- diambil alih instance lain,
- menghasilkan partial output,
- memerlukan compensating action.

Jika hanya ada boolean `success`, sistem kehilangan informasi.

### 12.1 State Transition Harus Legal

Contoh illegal transition:

```text
COMPLETED -> RUNNING
```

Jika ingin rerun, buat run baru:

```text
COMPLETED job_run_001
RETRY_REQUESTED job_run_002
RUNNING job_run_002
```

Jangan menimpa history.

---

## 13. Partitioning: Cara Memecah Workload Besar

Job besar harus dipartisi.

Anti-pattern:

```java
List<Record> records = repository.findAllPending();
for (Record record : records) {
    process(record);
}
```

Masalah:

- memory besar,
- transaction terlalu panjang,
- checkpoint sulit,
- retry semua dari awal,
- DB lock lama,
- timeout,
- tidak scalable.

Lebih baik:

```text
Process in pages/partitions.
Commit per partition or per item group.
Store checkpoint.
```

Contoh partition key:

- ID range,
- created date range,
- tenant,
- agency,
- module,
- shard number,
- business status,
- pagination cursor.

### 13.1 Cursor-Based Processing

```java
public void run(JobRunId runId) {
    Cursor cursor = checkpointRepository.load(runId);

    while (true) {
        List<ApplicationId> batch = repository.findNextBatch(cursor, 500);

        if (batch.isEmpty()) {
            break;
        }

        processBatch(runId, batch);

        cursor = Cursor.after(batch.get(batch.size() - 1));
        checkpointRepository.save(runId, cursor);
    }
}
```

### 13.2 Keyset Pagination

Untuk batch besar, hindari offset pagination.

Buruk:

```sql
select *
from application
where status = 'PENDING'
order by id
offset 1000000 rows fetch next 500 rows only;
```

Lebih baik:

```sql
select *
from application
where status = 'PENDING'
  and id > :lastSeenId
order by id
fetch next 500 rows only;
```

Keyset pagination lebih stabil dan efisien.

---

## 14. Checkpointing: Recovery Tanpa Mulai dari Nol

Checkpoint menyimpan progress.

Schema:

```sql
create table job_checkpoint (
    job_run_id      varchar(64) not null,
    partition_key   varchar(256) not null,
    checkpoint_data clob,
    status          varchar(32) not null,
    updated_at      timestamp not null,
    primary key (job_run_id, partition_key)
);
```

Checkpoint bisa berupa:

- last processed ID,
- page cursor,
- date range,
- file offset,
- Kafka offset-like marker,
- external cursor,
- partition status.

### 14.1 Checkpoint Harus Commit Setelah Work Aman

Urutan salah:

```text
1. Save checkpoint
2. Process item
```

Jika crash setelah checkpoint tapi sebelum process, item hilang.

Urutan lebih aman:

```text
1. Process item idempotently
2. Commit side-effect intent/outbox
3. Save checkpoint
```

Namun untuk side effect eksternal, gunakan outbox atau per-item result agar bisa reconcile.

---

## 15. Per-Item Result: Jangan Hanya Job-Level Success

Untuk job besar, job-level status tidak cukup.

Schema:

```sql
create table job_item_result (
    job_run_id     varchar(64) not null,
    item_key       varchar(256) not null,
    status         varchar(32) not null,
    attempt_no     integer not null,
    error_code     varchar(128),
    error_message  varchar(4000),
    processed_at   timestamp,
    primary key (job_run_id, item_key)
);
```

Manfaat:

- tahu item mana yang gagal,
- bisa retry hanya item gagal,
- bisa audit partial processing,
- bisa generate report,
- bisa membuat SLA job,
- bisa membedakan systemic failure vs data-specific failure.

Contoh status:

```text
PENDING
PROCESSING
SUCCESS
FAILED_RETRYABLE
FAILED_FINAL
SKIPPED
```

---

## 16. Retry Budget: Retry Bukan Harapan, Retry Adalah Kebijakan

Retry harus punya batas.

Pertanyaan:

1. Berapa kali retry?
2. Retry untuk error apa?
3. Delay berapa?
4. Exponential backoff?
5. Jitter?
6. Apakah retry per job atau per item?
7. Apakah retry aman secara bisnis?
8. Apa yang terjadi setelah retry habis?

Anti-pattern:

```java
while (true) {
    try {
        callExternal();
        break;
    } catch (Exception e) {
        // try again forever
    }
}
```

Dampak:

- infinite loop,
- downstream storm,
- thread stuck,
- job tidak selesai,
- tidak ada observability.

Lebih baik:

```text
Retry only transient failures.
Limit attempts.
Use backoff.
Record attempts.
Escalate final failure.
```

Pseudo-code:

```java
for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
        processItem(item);
        markSuccess(item);
        return;
    } catch (TransientExternalException e) {
        markRetryableFailure(item, attempt, e);
        sleep(backoff(attempt));
    } catch (BusinessValidationException e) {
        markFinalFailure(item, e);
        return;
    }
}

markFinalFailure(item, "RETRY_EXHAUSTED");
```

### 16.1 Retry Classification

| Error | Retry? |
|---|---|
| Network timeout | Usually yes |
| HTTP 503 | yes with backoff |
| HTTP 429 | yes with rate-limit aware delay |
| HTTP 401 | maybe refresh token once |
| HTTP 403 | no |
| Validation error | no |
| Duplicate business key | idempotent handling |
| DB deadlock | yes, bounded |
| DB syntax/config error | no |
| Serialization bug | no |
| Null pointer bug | no |

---

## 17. Timeout Budget: Job Harus Punya Batas Waktu

Setiap job harus punya timeout.

Timeout level:

1. Overall job timeout.
2. Per partition timeout.
3. Per item timeout.
4. Per external call timeout.
5. DB query timeout.
6. Lock lease timeout.

Contoh policy:

```properties
jobs.expiry.max-duration=PT30M
jobs.expiry.batch-size=500
jobs.expiry.item-timeout=PT5S
jobs.expiry.external-call-timeout=PT2S
```

Jika job tidak punya timeout, ia bisa menggantung selamanya.

### 17.1 Deadline Propagation

Job harus tahu deadline global.

```java
Instant deadline = clock.instant().plus(maxDuration);

for (Item item : items) {
    if (clock.instant().isAfter(deadline)) {
        markTimedOut(runId);
        return;
    }

    processItem(item, deadline);
}
```

External call timeout harus lebih kecil dari remaining deadline.

---

## 18. Backpressure: Job Jangan Menyerang Sistem Sendiri

Scheduled job sering menyebabkan incident karena berjalan pada jam tertentu dan menghantam DB/API secara massal.

Contoh:

```text
02:00 nightly job mulai
02:00 semua pod/API/report juga mulai
02:01 DB CPU naik
02:02 connection pool habis
02:03 API user ikut lambat
```

Job harus punya backpressure.

Strategi:

- batch size,
- sleep between batches,
- rate limiter,
- worker pool bounded,
- queue length limit,
- per-tenant throttling,
- external API rate limit,
- DB connection budget,
- priority lower than user-facing traffic,
- pause on high system load.

### 18.1 Worker Pool Bounded

Jangan:

```java
items.parallelStream().forEach(this::process);
```

Lebih eksplisit:

```java
ExecutorService executor = Executors.newFixedThreadPool(8);
```

Namun di Quarkus, hati-hati membuat executor sendiri. Lebih baik gunakan ManagedExecutor / Vert.x worker / reactive pipeline sesuai model aplikasi.

Ingat invariant:

```text
Parallelism harus menjadi keputusan kapasitas, bukan efek samping API.
```

---

## 19. Database Connection Pool Governance

Job dapat menghabiskan DB connection.

Contoh:

```text
API service pool size = 50
Job parallelism = 50
User traffic = 40 active requests
Total needed = 90
Pool = exhausted
```

Akibat:

- request timeout,
- transaction pending,
- deadlock risk,
- cascading failure.

Solusi:

- batasi job concurrency,
- gunakan datasource/pool terpisah jika perlu,
- jalankan job di service terpisah,
- schedule di off-peak,
- gunakan backpressure,
- monitor pool active/idle/pending,
- set query timeout.

### 19.1 Job Tidak Boleh Menguasai Pool

Rule:

```text
Background job harus memakai budget resource yang eksplisit.
```

Jika user-facing API lebih penting, job harus mengalah.

---

## 20. Transaction Boundary untuk Batch

Anti-pattern:

```java
@Transactional
void runAll() {
    for (Item item : repository.findAllPending()) {
        process(item);
    }
}
```

Masalah:

- transaction terlalu panjang,
- lock lama,
- memory persistence context membesar,
- rollback semua,
- checkpoint tidak mungkin,
- database undo/redo besar,
- failure satu item membatalkan semua.

Lebih baik:

```text
Transaction per batch
atau
Transaction per item group
```

Contoh:

```java
public void run(JobRunId runId) {
    while (true) {
        List<ItemId> batch = selectNextBatch();

        if (batch.isEmpty()) {
            break;
        }

        processBatchInTransaction(runId, batch);
        checkpoint(runId, batch);
    }
}

@Transactional
void processBatchInTransaction(JobRunId runId, List<ItemId> batch) {
    for (ItemId id : batch) {
        processOne(id);
    }
}
```

Namun jika `processOne` melakukan external call, jangan letakkan external call panjang di dalam transaction.

---

## 21. External Side Effects: Email, API Call, File, S3, Report

Scheduled jobs sering melakukan side effect:

- kirim email,
- panggil API eksternal,
- upload file,
- generate report,
- publish event,
- archive ke object storage.

Side effect sulit karena tidak selalu transactional dengan database.

### 21.1 Gunakan Outbox untuk Side Effect

Alih-alih langsung kirim email di job:

```java
emailClient.send(...)
```

Lebih aman:

```text
Job writes notification_outbox
Publisher sends email
Publisher marks sent
```

Keuntungan:

- retry terpisah,
- deduplication,
- audit,
- failure tidak merusak main transaction,
- bisa replay,
- bisa inspect pending side effect.

### 21.2 External API Idempotency Key

Jika external API mendukung idempotency key, gunakan.

```text
Idempotency-Key: job-run-id + item-id + operation-type
```

Contoh:

```java
String key = runId.value() + ":" + itemId.value() + ":SYNC_ADDRESS";
externalClient.syncAddress(request, key);
```

Jika retry terjadi, external system bisa mengenali duplicate request.

---

## 22. Cancellation and Kill Switch

Production job harus bisa dihentikan.

Jenis stop:

1. **Disable schedule**: mencegah run baru.
2. **Pause job**: run sedang berjalan berhenti di checkpoint aman.
3. **Cancel run**: run ditandai cancel.
4. **Kill process**: pod dimatikan paksa.
5. **Emergency circuit breaker**: job berhenti karena downstream rusak.

### 22.1 Cooperative Cancellation

Job harus memeriksa cancel flag.

```java
for (Batch batch : batches) {
    if (jobControlService.isCancellationRequested(runId)) {
        markCancelled(runId);
        return;
    }

    processBatch(batch);
}
```

Ini lebih aman daripada mematikan thread.

### 22.2 Operational Kill Switch

Config:

```properties
jobs.expiry.enabled=true
```

Scheduler:

```java
@Scheduled(cron = "{jobs.expiry.cron}")
void trigger() {
    if (!jobProperties.expiry().enabled()) {
        return;
    }

    expiryJobService.triggerScheduledRun();
}
```

Untuk production, kill switch bisa berasal dari:

- config,
- database control table,
- feature flag,
- admin endpoint,
- ops console.

Control table:

```sql
create table job_control (
    job_name      varchar(128) primary key,
    enabled       boolean not null,
    paused        boolean not null,
    max_parallel  integer not null,
    updated_by    varchar(128),
    updated_at    timestamp not null
);
```

---

## 23. Timezone and Calendar Semantics

Cron tanpa timezone bisa membingungkan.

Pertanyaan:

1. Job berjalan berdasarkan timezone server, UTC, atau business timezone?
2. Apa yang terjadi saat daylight saving time?
3. Apakah “daily” berarti setiap 24 jam atau setiap tanggal lokal?
4. Apakah month-end job mengikuti kalender bisnis?
5. Apakah holiday/weekend harus skip?
6. Apakah tenant berbeda punya timezone berbeda?

Untuk sistem enterprise, gunakan eksplisit:

```text
Store schedule timezone.
Store business date.
Store run window.
Store evaluated calendar rule.
```

Contoh:

```sql
create table job_run (
    id              varchar(64) primary key,
    job_name        varchar(128),
    business_date   date,
    window_start    timestamp,
    window_end      timestamp,
    timezone_id     varchar(64),
    ...
);
```

Dengan begitu audit jelas.

---

## 24. Designing a Job Window

Untuk job yang memproses data berdasarkan waktu, jangan pakai `now()` sembarangan.

Buruk:

```java
List<Item> items = repository.findCreatedBefore(Instant.now());
```

Jika job retry, `now()` berubah.

Lebih baik:

```java
Instant windowEnd = jobRun.windowEnd();

List<Item> items = repository.findCreatedBefore(windowEnd);
```

Job run menyimpan window:

```text
window_start = 2026-06-20T00:00:00Z
window_end   = 2026-06-21T00:00:00Z
```

Dengan begitu rerun deterministic.

Invariant:

```text
Job harus memproses window yang eksplisit, bukan waktu berjalan yang berubah-ubah.
```

---

## 25. Observability for Jobs

Job harus observable.

Minimal metrics:

```text
job_runs_total{job_name,status}
job_run_duration_seconds{job_name}
job_items_total{job_name,status}
job_batch_duration_seconds{job_name}
job_retry_total{job_name,error_code}
job_lag_seconds{job_name}
job_current_running{job_name}
job_last_success_timestamp{job_name}
```

Minimal logs:

```json
{
  "event": "job_run_started",
  "job_name": "expiry-job",
  "job_run_id": "job-20260620-020000",
  "trigger_source": "scheduler",
  "window_start": "2026-06-19T00:00:00Z",
  "window_end": "2026-06-20T00:00:00Z"
}
```

```json
{
  "event": "job_item_failed",
  "job_name": "expiry-job",
  "job_run_id": "job-20260620-020000",
  "item_key": "APP-12345",
  "attempt": 3,
  "error_code": "EXTERNAL_TIMEOUT",
  "retryable": true
}
```

Minimal tracing:

```text
job.run
  -> job.partition
      -> db.select
      -> external.call
      -> db.update
```

Namun tracing untuk jutaan item bisa mahal. Gunakan sampling dan structured metrics.

### 25.1 Alert yang Masuk Akal

Alert buruk:

```text
Ada satu item gagal.
```

Itu bisa noisy.

Alert lebih baik:

```text
No successful run for 24h.
Job failure rate > 5%.
Job running longer than p95 baseline x 3.
Job lag > SLA.
Retry exhausted count > threshold.
Job stuck in RUNNING without heartbeat.
```

---

## 26. Health Checks untuk Scheduler dan Jobs

Jangan membuat liveness probe gagal hanya karena satu job gagal.

Liveness harus menjawab:

```text
Apakah process masih hidup?
```

Readiness harus menjawab:

```text
Apakah aplikasi siap menerima traffic?
```

Job health sebaiknya exposed sebagai:

- management endpoint,
- metrics,
- dashboard,
- readiness hanya jika job sangat critical untuk service readiness.

Contoh job status endpoint:

```text
GET /internal/jobs
GET /internal/jobs/{jobName}/last-run
GET /internal/jobs/runs/{runId}
```

Response:

```json
{
  "jobName": "expiry-job",
  "lastSuccessAt": "2026-06-20T02:04:12Z",
  "lastRunStatus": "COMPLETED",
  "lastRunDurationSeconds": 252,
  "lagSeconds": 0
}
```

---

## 27. Testing Strategy

Scheduled job harus dites di beberapa level.

### 27.1 Unit Test

Test business logic:

```text
Given pending items
When job runs
Then expected state transitions happen
```

Tanpa scheduler.

### 27.2 Component Test

Test job service dengan repository fake/test DB.

Validasi:

- idempotency,
- checkpoint,
- partial failure,
- retry classification,
- cancellation.

### 27.3 Integration Test

Test dengan Quarkus:

- real CDI,
- real config,
- test database,
- REST admin endpoint,
- outbox,
- transaction boundary.

### 27.4 Cluster Simulation Test

Untuk job cluster-global:

- jalankan dua instance logical,
- pastikan lock hanya dimiliki satu,
- test stale lock takeover,
- test duplicate trigger.

### 27.5 Failure Injection

Test:

- crash after external call before DB update,
- crash after DB commit before checkpoint,
- DB deadlock,
- external API 429,
- timeout,
- partial item failure,
- invalid data,
- lock expired mid-run,
- cancellation requested.

---

## 28. Native Image Implications

Scheduler di native image punya beberapa perhatian:

1. Reflection-heavy job dependency harus native-compatible.
2. Dynamic classloading tidak cocok.
3. Timezone/resource data harus tersedia jika diperlukan.
4. Serialization untuk job config harus jelas.
5. External client TLS/crypto harus diuji native.
6. Startup cepat native membantu CronJob/container-per-run.
7. Build-time initialization bisa mempengaruhi scheduler dependency.
8. Jangan membaca runtime secret di static initializer.
9. Test native mode untuk job yang critical.
10. Pastikan observability/logging bekerja di native.

Native image tidak menghilangkan kebutuhan idempotency.

Ia hanya mengubah runtime profile:

```text
startup lebih cepat,
RSS lebih kecil,
tetapi dynamic behavior lebih terbatas.
```

---

## 29. Implementation Blueprint: Production-Grade Scheduled Job di Quarkus

### 29.1 Config Mapping

```java
import io.smallrye.config.ConfigMapping;
import java.time.Duration;

@ConfigMapping(prefix = "jobs.expiry")
public interface ExpiryJobConfig {
    boolean enabled();
    String cron();
    int batchSize();
    Duration maxDuration();
    Duration lockLease();
}
```

`application.properties`:

```properties
jobs.expiry.enabled=true
jobs.expiry.cron=0 0 2 * * ?
jobs.expiry.batch-size=500
jobs.expiry.max-duration=PT30M
jobs.expiry.lock-lease=PT10M
```

### 29.2 Scheduler as Thin Trigger

```java
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class ExpiryScheduler {

    private final ExpiryJobConfig config;
    private final ExpiryJobService service;

    public ExpiryScheduler(ExpiryJobConfig config, ExpiryJobService service) {
        this.config = config;
        this.service = service;
    }

    @Scheduled(cron = "{jobs.expiry.cron}")
    void trigger() {
        if (!config.enabled()) {
            return;
        }

        service.trigger("scheduler");
    }
}
```

### 29.3 Job Service

```java
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Clock;
import java.time.Instant;

@ApplicationScoped
public class ExpiryJobService {

    private final Clock clock;
    private final ExpiryJobConfig config;
    private final JobRunRepository jobRuns;
    private final JobLockRepository locks;
    private final ExpiryProcessor processor;

    public ExpiryJobService(
            Clock clock,
            ExpiryJobConfig config,
            JobRunRepository jobRuns,
            JobLockRepository locks,
            ExpiryProcessor processor
    ) {
        this.clock = clock;
        this.config = config;
        this.jobRuns = jobRuns;
        this.locks = locks;
        this.processor = processor;
    }

    public void trigger(String source) {
        String runId = jobRuns.createRequestedRun("expiry-job", source);

        String ownerId = OwnerId.current();
        boolean locked = locks.tryAcquire(
                "expiry-job",
                ownerId,
                clock.instant().plus(config.lockLease())
        );

        if (!locked) {
            jobRuns.markSkipped(runId, "LOCK_NOT_ACQUIRED");
            return;
        }

        try {
            jobRuns.markRunning(runId);
            Instant deadline = clock.instant().plus(config.maxDuration());

            processor.process(runId, deadline, config.batchSize());

            jobRuns.markCompleted(runId);
        } catch (Exception e) {
            jobRuns.markFailed(runId, e);
            throw e;
        } finally {
            locks.releaseIfOwner("expiry-job", ownerId);
        }
    }
}
```

### 29.4 Processor with Batch Boundary

```java
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Clock;
import java.time.Instant;
import java.util.List;

@ApplicationScoped
public class ExpiryProcessor {

    private final Clock clock;
    private final ApplicationRepository applications;
    private final ExpiryBatchService batchService;
    private final JobCheckpointRepository checkpoints;
    private final JobControlService controls;

    public ExpiryProcessor(
            Clock clock,
            ApplicationRepository applications,
            ExpiryBatchService batchService,
            JobCheckpointRepository checkpoints,
            JobControlService controls
    ) {
        this.clock = clock;
        this.applications = applications;
        this.batchService = batchService;
        this.checkpoints = checkpoints;
        this.controls = controls;
    }

    public void process(String runId, Instant deadline, int batchSize) {
        Cursor cursor = checkpoints.loadCursor(runId).orElse(Cursor.start());

        while (clock.instant().isBefore(deadline)) {
            if (controls.isCancellationRequested(runId)) {
                checkpoints.saveCursor(runId, cursor);
                return;
            }

            List<ApplicationId> ids = applications.findNextExpired(cursor, batchSize);

            if (ids.isEmpty()) {
                return;
            }

            batchService.processBatch(runId, ids);

            cursor = Cursor.after(ids.get(ids.size() - 1));
            checkpoints.saveCursor(runId, cursor);
        }

        throw new JobTimeoutException("Expiry job exceeded deadline");
    }
}
```

### 29.5 Transaction Per Batch

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.util.List;

@ApplicationScoped
public class ExpiryBatchService {

    private final ApplicationRepository applications;
    private final NotificationOutboxRepository outbox;
    private final JobItemResultRepository itemResults;

    public ExpiryBatchService(
            ApplicationRepository applications,
            NotificationOutboxRepository outbox,
            JobItemResultRepository itemResults
    ) {
        this.applications = applications;
        this.outbox = outbox;
        this.itemResults = itemResults;
    }

    @Transactional
    public void processBatch(String runId, List<ApplicationId> ids) {
        for (ApplicationId id : ids) {
            try {
                Application app = applications.getForUpdate(id);

                if (!app.canExpire()) {
                    itemResults.skipped(runId, id, "NOT_EXPIRABLE");
                    continue;
                }

                app.expire();

                outbox.insertOnce(
                        app.id(),
                        "APPLICATION_EXPIRED_NOTIFICATION",
                        buildPayload(app)
                );

                itemResults.success(runId, id);
            } catch (Exception e) {
                itemResults.failed(runId, id, classify(e), e);
            }
        }
    }
}
```

Catatan:

- contoh ini konseptual,
- production code perlu memperhatikan exception policy,
- jangan swallow exception sistemik tanpa menghentikan job,
- bedakan data-specific failure dan systemic failure.

---

## 30. Anti-Pattern Umum

### 30.1 Scheduled Method Berisi Semua Logic

Buruk karena sulit dites, sulit diaudit, sulit dikontrol.

### 30.2 Tidak Ada Idempotency

Retry menjadi berbahaya.

### 30.3 Tidak Ada Lock di Multi-Replica

Job global bisa berjalan berkali-kali.

### 30.4 Transaction Terlalu Besar

Satu job besar dalam satu transaction adalah resep timeout dan lock contention.

### 30.5 External Call di Dalam Transaction Panjang

Membuat DB lock menunggu jaringan.

### 30.6 Tidak Ada Checkpoint

Failure kecil memaksa ulang semua dari awal.

### 30.7 Tidak Ada Per-Item Result

Operator tidak tahu apa yang gagal.

### 30.8 Infinite Retry

Retry tanpa batas memperparah incident.

### 30.9 Job Menggunakan Semua DB Connection

Background workload mengalahkan user-facing traffic.

### 30.10 Cron Menggunakan Timezone Implisit

Audit dan business calendar menjadi ambigu.

### 30.11 Tidak Ada Kill Switch

Saat job merusak sistem, operator tidak punya cara aman menghentikan.

### 30.12 Scheduler Dipakai untuk Workflow Bisnis Panjang

Jika ada wait state, human approval, SLA, escalation, compensation, gunakan workflow/process model.

---

## 31. Production Checklist

Sebelum job dianggap production-ready, cek:

### 31.1 Ownership

- [ ] Job node-local atau cluster-global sudah jelas.
- [ ] Jika cluster-global, ada lock/Quartz/CronJob ownership.
- [ ] Overlap policy jelas.
- [ ] Misfire policy jelas.

### 31.2 Idempotency

- [ ] Job aman diulang.
- [ ] Side effect punya idempotency key/outbox.
- [ ] State transition punya guard.
- [ ] Duplicate run tidak menghasilkan efek ganda salah.

### 31.3 Recovery

- [ ] Ada job_run table untuk job critical.
- [ ] Ada checkpoint untuk job besar.
- [ ] Ada per-item result untuk batch besar.
- [ ] Ada retry policy.
- [ ] Ada stale run detection.

### 31.4 Resource

- [ ] Batch size dikontrol.
- [ ] Parallelism bounded.
- [ ] DB connection budget jelas.
- [ ] External API rate limit dihormati.
- [ ] Timeout ada di semua level.

### 31.5 Operability

- [ ] Ada structured log.
- [ ] Ada metrics.
- [ ] Ada dashboard.
- [ ] Ada alert relevan.
- [ ] Ada kill switch/pause.
- [ ] Ada admin status endpoint.
- [ ] Ada runbook.

### 31.6 Testing

- [ ] Unit test business logic.
- [ ] Integration test transaction/checkpoint.
- [ ] Failure injection.
- [ ] Duplicate trigger test.
- [ ] Retry exhaustion test.
- [ ] Cancellation test.
- [ ] Native image test jika deployment native.

---

## 32. Case Study: Expire Regulatory Applications

Bayangkan domain regulatory:

```text
Application yang tidak dilengkapi dalam 30 hari harus otomatis expired.
Setelah expired, sistem harus:
1. mengubah status application,
2. membuat audit trail,
3. mengirim email,
4. publish event ke reporting/read model,
5. tidak boleh duplicate,
6. bisa diaudit oleh agency,
7. bisa di-rerun jika gagal.
```

Desain naif:

```java
@Scheduled(cron = "0 0 2 * * ?")
@Transactional
void expire() {
    for (Application app : repo.findExpired()) {
        app.status = EXPIRED;
        email.send(app.email);
    }
}
```

Failure mode:

- email duplicate,
- audit missing,
- transaction terlalu besar,
- no checkpoint,
- no per-item failure,
- crash menyebabkan status/email tidak konsisten,
- multi-pod duplicate,
- operator tidak tahu progress.

Desain production:

```text
1. Scheduler trigger creates job_run with window_end.
2. Acquire global lock.
3. Select expired applications by deterministic window.
4. Process in keyset batches.
5. For each application:
   - validate state transition
   - update status
   - insert audit event
   - insert notification_outbox with unique key
   - insert integration_outbox with unique key
   - mark item result
6. Save checkpoint.
7. Publisher sends email/event asynchronously.
8. Metrics/logs emitted.
9. Job completes or partial-fails with report.
```

Invariants:

```text
Application transition is idempotent.
Notification intent is unique.
Audit event is tied to state transition.
Job run is auditable.
External side effects are eventually delivered.
Retry is safe.
```

Ini contoh cara berpikir top-tier engineer: bukan hanya “fitur auto-expire”, tetapi lifecycle, auditability, side effect, consistency, dan operations.

---

## 33. Latihan

### Latihan 1 — Classify Workloads

Untuk setiap job berikut, tentukan tool yang paling cocok:

1. Refresh local in-memory cache setiap 5 menit.
2. Generate monthly compliance report.
3. Sync 500 ribu records dari external registry.
4. Kirim reminder email harian.
5. Cleanup temporary uploaded files lokal.
6. Recalculate risk score untuk semua active cases.
7. Poll status external payment setiap 1 menit.
8. Archive audit records older than 5 years.

Untuk masing-masing, jawab:

- node-local atau cluster-global?
- idempotency key apa?
- checkpoint apa?
- side effect apa?
- retry policy apa?
- apakah butuh job_run table?
- apakah butuh per-item result?
- apakah cocok in-app scheduler, Quartz, CronJob, queue, atau workflow?

### Latihan 2 — Design Job State Machine

Buat state machine untuk job:

```text
Nightly Case Escalation Job
```

Syarat:

- hanya case overdue yang diproses,
- escalation harus audit,
- notification tidak boleh duplicate,
- job bisa di-cancel,
- job bisa partial failed,
- job bisa retry item gagal,
- job harus bisa resume dari checkpoint.

### Latihan 3 — Failure Mode Analysis

Untuk job email reminder, analisis failure berikut:

1. DB commit sukses, email send gagal.
2. Email send sukses, DB mark sent gagal.
3. Pod crash setelah 1000 item.
4. Lock expired karena job terlalu lama.
5. Scheduler trigger duplicate.
6. External email API rate limit.
7. User mengubah email address saat job berjalan.
8. Job berjalan saat deployment rolling update.

Untuk tiap failure, tulis mitigasi.

---

## 34. Ringkasan Invariants

Ingat invariants berikut:

```text
Scheduler trigger bukan business logic.
Job critical harus punya run identity.
Job besar harus punya checkpoint.
Job yang punya side effect harus idempotent.
Job di cluster harus punya ownership policy.
Job tidak boleh menghabiskan resource user-facing path.
Retry harus bounded.
Timeout harus eksplisit.
Cron harus punya timezone/business window yang jelas.
Operator harus bisa melihat, menghentikan, dan mengulang job dengan aman.
Quartz menyelesaikan scheduling ownership, bukan business idempotency.
Kubernetes CronJob menyelesaikan process lifecycle, bukan business recovery.
Workflow engine cocok untuk proses long-running, bukan sekadar loop batch.
```

---

## 35. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan fondasi scheduling dan workload orchestration di Quarkus.

Bagian berikutnya:

```text
Part 021 — Caching and State: Redis, Caffeine, Infinispan, Cache Invalidation
```

Di part berikutnya, fokus bergeser dari workload background ke state/cache layer:

- local cache,
- distributed cache,
- Redis,
- Infinispan,
- cache invalidation,
- cache stampede,
- stale data,
- negative caching,
- read-through/write-through,
- multi-node consistency,
- cache observability,
- cache sebagai bagian dari architecture decision, bukan sekadar performance hack.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-019.md">⬅️ Part 019 — Messaging II: Event-Driven Architecture, Outbox, CDC, Saga, and Process Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-021.md">Caching and State: Redis, Caffeine, Infinispan, Cache Invalidation ➡️</a>
</div>

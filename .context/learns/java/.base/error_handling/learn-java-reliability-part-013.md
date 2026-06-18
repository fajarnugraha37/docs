# learn-java-reliability-part-013.md

# Part 013 — Background Workers, Schedulers, Queues, and Message Consumers

> Seri: **Graceful Shutdown, Error Handling, Exceptions, dan Reliability untuk Java Engineer**  
> Posisi: **Part 013 / 030**  
> Status seri: **Belum selesai**  
> Fokus: reliability untuk pekerjaan non-HTTP: async executor, scheduler, queue consumer, Kafka/RabbitMQ listener, ack/nack, checkpoint, distributed lock, poison message, dan shutdown-safe worker design.

---

## 0. Kenapa Bagian Ini Penting?

Pada part sebelumnya kita membahas request draining untuk HTTP. Tetapi banyak production incident justru bukan berasal dari request HTTP langsung, melainkan dari pekerjaan belakang layar:

- scheduled job berjalan dua kali;
- batch berhenti di tengah proses;
- message sudah diproses tetapi belum di-ack;
- message di-ack terlalu cepat sebelum side effect aman;
- consumer shutdown saat transaksi belum selesai;
- pod rolling update menyebabkan duplicate processing;
- distributed lock tidak dilepas atau expiry-nya salah;
- poison message terus-menerus membuat consumer crash;
- retry queue berubah menjadi retry storm;
- background task masih jalan saat dependency sudah ditutup;
- thread pool menerima task baru padahal aplikasi sedang shutting down.

HTTP request biasanya punya client yang menunggu response. Background work sering tidak punya manusia yang melihat langsung. Ketika gagal, efeknya bisa muncul belakangan sebagai data corrupt, double notification, missing audit, stale report, stuck workflow, atau backlog yang tiba-tiba meledak.

Mental model utama bagian ini:

> Worker reliability bukan tentang “jangan crash”. Worker reliability adalah kemampuan sistem untuk mengetahui pekerjaan mana yang belum mulai, sedang berjalan, sudah aman selesai, perlu diulang, perlu dikompensasi, atau harus dikarantina.

---

## 1. Core Problem

Background work memiliki masalah reliability yang berbeda dari HTTP.

Pada HTTP, failure boundary sering terlihat seperti ini:

```text
client -> request -> service -> response/error
```

Pada worker, boundary-nya lebih panjang:

```text
trigger/scheduler/message
    -> acquire work
    -> claim ownership
    -> perform side effects
    -> persist progress
    -> acknowledge/checkpoint
    -> release ownership
```

Di antara langkah-langkah itu, proses bisa mati kapan saja.

Contoh failure window:

```text
1. Consumer menerima message.
2. Consumer menulis data ke DB.
3. Consumer memanggil external API.
4. Consumer mengirim email.
5. Consumer crash sebelum ACK.
6. Broker mengirim ulang message.
7. Data ditulis lagi, external API terpanggil lagi, email terkirim lagi.
```

Pertanyaan reliability-nya bukan “bagaimana catch exception?”, tetapi:

- Apakah message boleh diproses ulang?
- Apakah side effect idempotent?
- Apakah DB write dan ACK punya atomicity?
- Kalau tidak atomic, apa strategi recovery-nya?
- Apakah duplicate lebih aman daripada lost message?
- Apakah batch punya checkpoint?
- Apakah job bisa resume?
- Apakah ada poison message isolation?
- Apakah shutdown menunggu current unit selesai?
- Apakah shutdown deadline cukup untuk menyelesaikan current unit?
- Kalau deadline tidak cukup, apa yang dilakukan?

---

## 2. Mental Model: Worker adalah State Machine

Background worker sebaiknya tidak dipikirkan sebagai loop sederhana:

```java
while (true) {
    doWork();
}
```

Itu terlalu miskin untuk production. Worker lebih tepat dipikirkan sebagai state machine.

```text
IDLE
  -> POLLING
  -> CLAIMED
  -> PROCESSING
  -> COMMITTING
  -> ACKING / CHECKPOINTING
  -> COMPLETED
```

Saat shutdown:

```text
RUNNING
  -> DRAINING
  -> STOP_ACCEPTING_NEW_WORK
  -> FINISH_CURRENT_WORK
  -> PERSIST_PROGRESS
  -> RELEASE_OWNERSHIP
  -> STOPPED
```

Saat error:

```text
PROCESSING
  -> RETRYABLE_FAILURE
  -> RETRY_DELAYED
  -> REDELIVERED

PROCESSING
  -> NON_RETRYABLE_FAILURE
  -> DEAD_LETTERED

PROCESSING
  -> UNKNOWN_COMMIT_STATE
  -> RECONCILIATION_REQUIRED
```

State machine ini penting karena reliability decision bergantung pada state, bukan hanya exception type.

Contoh:

```text
Timeout before DB write      -> safe retry mungkin bisa.
Timeout after DB commit      -> retry tanpa idempotency berbahaya.
Crash before ACK             -> message mungkin redelivered.
ACK before side effect       -> side effect bisa hilang permanen.
NACK with requeue forever    -> poison loop.
```

---

## 3. Jenis Background Work

Tidak semua background work sama. Setiap jenis memiliki failure semantics sendiri.

| Jenis Work | Trigger | Ownership | Progress | Risiko Utama |
|---|---|---|---|---|
| Async task in-memory | Method call / event lokal | Thread pool lokal | Biasanya tidak durable | Hilang saat crash |
| Scheduled task | Waktu/cron | Instance aplikasi | Kadang tidak durable | Double run / missed run |
| Queue consumer | Broker message | Broker delivery | Ack/nack | Duplicate/lost message |
| Kafka consumer | Topic partition | Consumer group assignment | Offset commit | Reprocessing / skipped records |
| Batch job | Dataset besar | Job execution | Checkpoint | Partial completion |
| Polling worker | Periodic query | DB row claim / lock | Status row | Race/double claim |
| Outbox publisher | DB outbox table | Row claim | Published flag | Duplicate publish |
| Reconciliation job | Scheduled/manual | Dataset scan | Cursor/checkpoint | Expensive repeat / missed repair |

Top-tier engineer tidak menerapkan satu pattern generik untuk semua. Mereka mulai dari pertanyaan:

> Apa unit of work-nya, siapa pemiliknya, kapan dianggap selesai, dan bagaimana membuktikannya setelah crash?

---

## 4. Async Executor: Task Lokal yang Mudah Hilang

### 4.1 Apa itu async task lokal?

Contoh:

```java
@Async
public void sendEmailAsync(EmailCommand command) {
    emailClient.send(command);
}
```

Atau:

```java
executor.submit(() -> generateReport(reportId));
```

Masalahnya: task lokal biasanya berada di memory. Jika JVM mati, task hilang kecuali sudah dipersist.

### 4.2 Anti-pattern: async untuk side effect penting

Buruk:

```java
@Transactional
public void approveApplication(UUID applicationId) {
    application.approve();
    repository.save(application);

    // Dangerous if this notification is business-critical.
    notificationService.sendAsync(applicationId);
}
```

Kalau aplikasi crash setelah commit DB tetapi sebelum async task berjalan, approval tersimpan tetapi notification hilang.

Lebih baik:

```java
@Transactional
public void approveApplication(UUID applicationId) {
    application.approve();
    repository.save(application);

    outboxRepository.insert(new OutboxEvent(
        UUID.randomUUID(),
        "ApplicationApproved",
        applicationId,
        OffsetDateTime.now()
    ));
}
```

Lalu worker outbox memproses event secara durable.

### 4.3 Executor shutdown checklist

Untuk executor:

- berhenti menerima task baru;
- tunggu task berjalan selesai dalam batas waktu;
- batalkan task yang belum mulai bila aman;
- pastikan task tahu cara merespons interruption;
- jangan close dependency sebelum task selesai;
- expose metrics queue depth, active count, completed count;
- jangan gunakan unbounded queue untuk work penting;
- jangan diam-diam drop `RejectedExecutionException`.

Contoh wrapper sederhana:

```java
public final class ManagedExecutor implements AutoCloseable {
    private final ThreadPoolExecutor executor;
    private final AtomicBoolean accepting = new AtomicBoolean(true);

    public ManagedExecutor(ThreadPoolExecutor executor) {
        this.executor = Objects.requireNonNull(executor);
    }

    public Future<?> submit(Runnable task) {
        if (!accepting.get()) {
            throw new RejectedExecutionException("Executor is draining");
        }
        return executor.submit(task);
    }

    public void drain(Duration timeout) throws InterruptedException {
        accepting.set(false);
        executor.shutdown();
        boolean terminated = executor.awaitTermination(timeout.toMillis(), TimeUnit.MILLISECONDS);
        if (!terminated) {
            List<Runnable> dropped = executor.shutdownNow();
            // Log number of tasks not started. Do not pretend success.
            System.err.println("Forced executor shutdown. droppedTasks=" + dropped.size());
        }
    }

    @Override
    public void close() throws Exception {
        drain(Duration.ofSeconds(30));
    }
}
```

### 4.4 Important nuance: interruption is cooperative

`shutdownNow()` tidak membunuh thread secara magic. Ia mengirim interruption. Task harus memeriksa interrupt status atau memakai API yang interruptible.

Buruk:

```java
while (true) {
    doCpuWorkWithoutCheckingInterrupt();
}
```

Lebih baik:

```java
while (!Thread.currentThread().isInterrupted()) {
    doOneSmallUnit();
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

Rule:

> Jangan swallow `InterruptedException`. Restore interrupt flag atau hentikan task.

---

## 5. Scheduled Tasks: Cron Bukan Reliability Contract

### 5.1 Problem scheduler

Scheduled task sering terlihat sederhana:

```java
@Scheduled(cron = "0 */5 * * * *")
public void syncData() {
    syncService.sync();
}
```

Tetapi production questions-nya kompleks:

- Apakah job boleh overlap jika run sebelumnya belum selesai?
- Apakah job boleh berjalan di banyak pod sekaligus?
- Apakah missed run harus dikejar?
- Apakah job idempotent?
- Bagaimana jika shutdown saat job berjalan?
- Bagaimana jika job berjalan lebih lama dari periodenya?
- Bagaimana jika clock skew?
- Bagaimana jika dependency down selama 30 menit?

### 5.2 Scheduler local vs distributed scheduler

Local scheduler berarti setiap instance aplikasi punya trigger sendiri.

```text
pod-a: cron triggers sync
pod-b: cron triggers sync
pod-c: cron triggers sync
```

Kalau job tidak aman dijalankan paralel, ini berbahaya.

Solusi:

- gunakan distributed lock;
- gunakan database job table;
- gunakan dedicated scheduler platform;
- gunakan queue-based trigger;
- gunakan leader election;
- gunakan Kubernetes CronJob untuk beberapa jenis pekerjaan;
- pastikan job idempotent meskipun lock gagal.

### 5.3 Distributed lock bukan pengganti idempotency

Distributed lock membantu mengurangi double-run, tetapi tidak boleh menjadi satu-satunya safety mechanism.

Kenapa?

- lock bisa expired saat job masih berjalan;
- process bisa pause lama;
- network partition;
- clock skew;
- database failover;
- Redis failover;
- lock dilepas oleh instance yang salah jika token tidak dicek;
- job bisa retry manual bersamaan.

Pattern lebih aman:

```text
scheduler trigger
  -> acquire lock with owner token and TTL
  -> create job execution row
  -> process idempotent units
  -> checkpoint progress
  -> release lock only if owner token matches
```

### 5.4 Job execution table

Untuk job penting, buat state durable:

```sql
create table job_execution (
    id uuid primary key,
    job_name varchar(100) not null,
    status varchar(30) not null,
    started_at timestamp not null,
    completed_at timestamp null,
    heartbeat_at timestamp null,
    owner_id varchar(100) not null,
    checkpoint_value varchar(500) null,
    failure_reason text null,
    attempt int not null default 1
);
```

State:

```text
CREATED -> RUNNING -> SUCCEEDED
                  -> FAILED_RETRYABLE
                  -> FAILED_PERMANENT
                  -> ABANDONED
                  -> CANCELED
```

Dengan ini, setelah crash sistem bisa menjawab:

- job mana yang sedang berjalan saat pod mati;
- apakah job stuck;
- checkpoint terakhir di mana;
- apakah aman dilanjutkan;
- siapa owner terakhir;
- berapa attempt;
- kenapa gagal.

### 5.5 Shutdown-aware scheduler

Contoh gate sederhana:

```java
@Component
public class ShutdownState {
    private final AtomicBoolean draining = new AtomicBoolean(false);

    public boolean isDraining() {
        return draining.get();
    }

    public void beginDrain() {
        draining.set(true);
    }
}
```

```java
@Component
public class ReportScheduler {
    private final ShutdownState shutdownState;
    private final ReportJob reportJob;

    public ReportScheduler(ShutdownState shutdownState, ReportJob reportJob) {
        this.shutdownState = shutdownState;
        this.reportJob = reportJob;
    }

    @Scheduled(cron = "0 */5 * * * *")
    public void run() {
        if (shutdownState.isDraining()) {
            return;
        }
        reportJob.runOnce();
    }
}
```

Ini tidak cukup sendiri, tetapi mencegah trigger baru saat aplikasi masuk drain mode.

---

## 6. Queue Consumer: ACK adalah Reliability Boundary

Message consumer punya prinsip utama:

> Jangan ACK sebelum side effect yang harus dilindungi sudah aman.

Tetapi “aman” harus didefinisikan.

### 6.1 Message lifecycle umum

```text
broker queue
  -> deliver message
  -> consumer receives
  -> process
  -> commit local transaction / persist progress
  -> ack
  -> broker removes message
```

Failure window:

| Window | Risiko |
|---|---|
| Before processing | Message bisa redelivered; biasanya aman |
| During processing before side effect | Retry biasanya aman |
| After DB commit before ACK | Duplicate processing mungkin terjadi |
| After ACK before side effect | Lost work |
| During external side effect | Unknown outcome |
| During batch processing | Partial completion |

### 6.2 ACK too early

Buruk:

```java
public void handle(Message message) {
    channel.basicAck(message.getDeliveryTag(), false);
    process(message); // if crash here, message lost
}
```

Ini menghapus message dari broker sebelum work selesai.

### 6.3 ACK after durable commit

Lebih aman:

```java
public void handle(Message message) {
    try {
        processInTransaction(message);
        channel.basicAck(message.getDeliveryTag(), false);
    } catch (RetryableException e) {
        channel.basicNack(message.getDeliveryTag(), false, true);
    } catch (NonRetryableException e) {
        publishToDeadLetter(message, e);
        channel.basicAck(message.getDeliveryTag(), false);
    }
}
```

Namun tetap ada window:

```text
DB commit succeeded -> process crashes before ACK -> message redelivered
```

Karena itu consumer processing harus idempotent.

---

## 7. RabbitMQ / AMQP Consumer Semantics

Dalam AMQP-style queue, reliability biasanya berpusat pada:

- manual acknowledgement;
- automatic acknowledgement;
- reject/nack;
- requeue;
- dead-letter exchange;
- prefetch;
- consumer cancellation;
- connection/channel lifecycle.

### 7.1 Manual ACK vs automatic ACK

Untuk work penting, manual ACK sering lebih aman karena aplikasi menentukan kapan message dianggap selesai.

Spring AMQP memiliki mode acknowledgement. Pada mode `AUTO`, container melakukan ack/nack berdasarkan apakah listener selesai normal atau melempar exception. Pada mode `MANUAL`, listener bertanggung jawab melakukan ack/nack sendiri.

### 7.2 Requeue decision

Jangan selalu requeue.

```text
Retryable transient error -> requeue/delayed retry
Validation/schema error    -> dead letter
Missing required entity    -> depends: retry if eventual, DLQ if invalid
External 429              -> delayed retry with backoff
External 400              -> DLQ/non-retryable
Database deadlock          -> retryable with limit
Invariant violation        -> DLQ + alert
```

### 7.3 Poison message

Poison message adalah message yang selalu gagal diproses.

Gejala:

```text
message delivered -> consumer fails -> requeue -> delivered again -> fails again -> infinite loop
```

Dampak:

- CPU wasted;
- queue stuck;
- log flood;
- retry storm;
- consumer starvation;
- alert noise;
- message lain terlambat.

Pattern:

```text
message
  -> attempt 1 fail
  -> retry after delay
  -> attempt 2 fail
  -> retry after longer delay
  -> attempt N fail
  -> dead-letter queue
  -> operator/reconciliation/manual repair
```

### 7.4 Prefetch and shutdown

Prefetch menentukan berapa message yang boleh dikirim broker ke consumer sebelum di-ack.

Kalau prefetch terlalu besar:

```text
consumer receives 100 messages
pod receives SIGTERM
only 2 messages finish
98 messages are unacked/requeued after consumer dies
latency spikes and duplicate processing grows
```

Shutdown-safe approach:

- gunakan prefetch sesuai processing capacity;
- saat draining, stop container/consumer dari menerima message baru;
- selesaikan message yang sedang aktif;
- ack/nack secara eksplisit;
- jangan mulai batch besar baru menjelang shutdown;
- pastikan termination grace period cukup untuk max processing time satu unit.

---

## 8. Kafka Consumer Semantics

Kafka berbeda dari queue tradisional. Unit reliability utamanya adalah offset.

Mental model:

```text
topic partition contains ordered records
consumer reads records
consumer processes records
consumer commits offset
committed offset means: next consumer can resume after this point
```

### 8.1 Commit offset too early

Buruk:

```java
ConsumerRecords<String, Event> records = consumer.poll(Duration.ofSeconds(1));
consumer.commitSync();
for (ConsumerRecord<String, Event> record : records) {
    process(record); // if crash, records skipped
}
```

Jika offset committed sebelum processing selesai, crash menyebabkan data skip.

### 8.2 Commit after processing

Lebih baik:

```java
ConsumerRecords<String, Event> records = consumer.poll(Duration.ofSeconds(1));
for (ConsumerRecord<String, Event> record : records) {
    processIdempotently(record);
}
consumer.commitSync();
```

Tetapi jika crash setelah process sebelum commit, record akan diproses ulang. Karena itu `processIdempotently` wajib.

### 8.3 Per-record vs per-batch commit

Batch commit lebih efisien, tetapi memperbesar replay window.

```text
Batch size 500
processed 499 records
crash before commit
499 records replay
```

Per-record commit lebih kecil replay window, tetapi lebih mahal.

Trade-off:

| Strategy | Pros | Cons |
|---|---|---|
| Commit per record | Replay kecil | Throughput rendah |
| Commit per batch | Throughput tinggi | Replay besar |
| Commit per partition checkpoint | Lebih presisi | Implementasi lebih kompleks |
| External offset store | Bisa atomik dengan DB write | Kompleksitas tinggi |

### 8.4 Kafka consumer shutdown

Kafka consumer tidak thread-safe. Pola umum:

- polling loop berjalan di satu thread;
- shutdown signal memanggil `consumer.wakeup()` dari thread lain;
- poll melempar `WakeupException`;
- loop keluar;
- commit final jika aman;
- `consumer.close()` dipanggil.

Contoh:

```java
public final class KafkaWorker implements Runnable, AutoCloseable {
    private final KafkaConsumer<String, Event> consumer;
    private final AtomicBoolean running = new AtomicBoolean(true);

    public KafkaWorker(KafkaConsumer<String, Event> consumer) {
        this.consumer = consumer;
    }

    @Override
    public void run() {
        try {
            while (running.get()) {
                ConsumerRecords<String, Event> records = consumer.poll(Duration.ofSeconds(1));
                for (ConsumerRecord<String, Event> record : records) {
                    processIdempotently(record);
                }
                if (!records.isEmpty()) {
                    consumer.commitSync();
                }
            }
        } catch (WakeupException e) {
            if (running.get()) {
                throw e;
            }
        } finally {
            try {
                consumer.commitSync();
            } catch (Exception commitFailure) {
                // Log explicitly; records may replay.
                System.err.println("Final commit failed: " + commitFailure.getMessage());
            } finally {
                consumer.close(Duration.ofSeconds(10));
            }
        }
    }

    @Override
    public void close() {
        running.set(false);
        consumer.wakeup();
    }

    private void processIdempotently(ConsumerRecord<String, Event> record) {
        // Use event ID, aggregate version, idempotency table, or natural key.
    }
}
```

### 8.5 Rebalance and in-flight processing

Consumer group rebalance can revoke partitions. If your consumer still processes records from revoked partitions while another consumer starts processing the same partitions, duplicate/concurrency issues can happen.

Production pattern:

- implement rebalance listener;
- pause polling or stop accepting partition work before revoke;
- commit processed offsets on revoke;
- avoid async processing that outlives partition ownership unless carefully tracked;
- ensure idempotency per record.

---

## 9. Batch Processing: Checkpoint or Repeat Everything

Batch jobs often fail after processing a large number of records.

Bad batch design:

```java
public void runBatch() {
    List<Item> items = repository.findAllPending();
    for (Item item : items) {
        process(item);
    }
}
```

Problems:

- huge memory;
- no checkpoint;
- unclear partial progress;
- restart repeats everything;
- one bad item can block all;
- no per-item status;
- no observability.

Better:

```java
public void runBatch(UUID jobId) {
    while (true) {
        List<Item> items = repository.claimNextPage(jobId, 100);
        if (items.isEmpty()) {
            return;
        }

        for (Item item : items) {
            processOneItem(jobId, item);
        }

        repository.updateCheckpoint(jobId, lastProcessedKey(items));
    }
}
```

### 9.1 Per-item state

```sql
create table batch_item_status (
    job_id uuid not null,
    item_id uuid not null,
    status varchar(30) not null,
    attempt int not null default 0,
    last_error_code varchar(100) null,
    last_error_message text null,
    updated_at timestamp not null,
    primary key (job_id, item_id)
);
```

State:

```text
PENDING -> PROCESSING -> SUCCEEDED
                    -> FAILED_RETRYABLE
                    -> FAILED_PERMANENT
                    -> SKIPPED
```

### 9.2 Batch shutdown

Shutdown-safe batch design:

- do not claim new page when draining;
- finish current item if within budget;
- persist item status after each item or small chunk;
- release claims for unprocessed items;
- heartbeat active execution;
- mark execution as interrupted, not success;
- allow resume from checkpoint;
- tolerate duplicate processing for last chunk.

---

## 10. Polling Workers and Claiming Work

Polling worker biasanya mengambil pekerjaan dari DB:

```sql
select * from task where status = 'PENDING' order by created_at fetch first 100 rows only;
```

Problem: banyak pod bisa mengambil row yang sama.

### 10.1 Claim pattern

Gunakan claim atomik.

Contoh konseptual:

```sql
update task
set status = 'PROCESSING',
    owner_id = :ownerId,
    claimed_at = current_timestamp,
    claim_expires_at = current_timestamp + interval '5 minutes'
where id in (
    select id
    from task
    where status = 'PENDING'
    order by created_at
    fetch first 100 rows only
)
and status = 'PENDING';
```

Lalu worker hanya memproses row yang berhasil di-claim oleh owner-nya.

### 10.2 Lease expiry

Jika worker mati, task jangan stuck selamanya.

```text
PROCESSING with expired lease -> PENDING again / RECOVERABLE
```

Tapi hati-hati: lease expiry bisa menyebabkan double processing jika worker lambat tetapi masih hidup.

Mitigasi:

- heartbeat;
- sufficiently long lease TTL;
- fencing token;
- idempotency;
- ownership check before final update;
- optimistic version.

### 10.3 Fencing token

Fencing token mencegah owner lama menulis hasil setelah lease diambil owner baru.

```sql
update task
set status = 'SUCCEEDED'
where id = :taskId
  and owner_id = :ownerId
  and claim_token = :claimToken
  and status = 'PROCESSING';
```

Jika update count 0, worker tidak lagi punya ownership valid.

---

## 11. ACK, Commit, Checkpoint: Jangan Campur Makna

Tiga konsep ini sering dicampur padahal berbeda.

| Konsep | Artinya | Contoh |
|---|---|---|
| ACK | Broker boleh menghapus message / menganggap delivery selesai | RabbitMQ ack |
| Offset commit | Consumer group boleh resume setelah offset tertentu | Kafka commit |
| Checkpoint | Aplikasi mencatat progress internal | Batch cursor |
| DB commit | Perubahan data lokal durable | SQL transaction commit |
| External side effect completion | Dependency menerima efek | Email/API/payment |

Reliability bug sering muncul ketika engineer menganggap semuanya sama.

Contoh:

```text
DB commit done != message ack done
message ack done != external API success
Kafka offset commit done != business transaction safe
checkpoint updated != all side effects completed
```

Rule:

> Tentukan urutan commit/ack/checkpoint berdasarkan kerugian yang lebih bisa diterima: duplicate atau loss.

Biasanya:

- duplicate lebih bisa diterima jika idempotency kuat;
- loss lebih sulit diperbaiki karena evidence hilang;
- false success paling berbahaya untuk sistem regulasi/keuangan/audit.

---

## 12. Failure Classification untuk Worker

Worker harus mengklasifikasikan failure lebih presisi daripada “exception”.

| Failure | Classification | Action |
|---|---|---|
| DB deadlock | retryable | retry with backoff |
| DB unique violation from duplicate message | idempotent duplicate | treat as success or fetch existing result |
| Validation error in message schema | non-retryable | DLQ |
| External 429 | retryable but delayed | backoff / rate limit |
| External 401 token expired | recoverable auth | refresh token once, then retry |
| External 403 | non-retryable | DLQ / alert |
| External timeout before known side effect | retryable with idempotency | retry |
| External timeout after possible side effect | unknown outcome | reconcile before retry |
| Invariant violation | bug/data corruption | stop or quarantine + alert |
| Shutdown signal | controlled interruption | persist progress + stop |

Worker tidak boleh melakukan ini:

```java
catch (Exception e) {
    throw e; // broker will retry forever
}
```

Atau:

```java
catch (Exception e) {
    ack(); // message lost even for transient failures
}
```

Lebih baik:

```java
catch (WorkerException e) {
    switch (e.classification()) {
        case RETRYABLE -> retryLater(message, e);
        case NON_RETRYABLE -> deadLetter(message, e);
        case DUPLICATE_ALREADY_PROCESSED -> ack(message);
        case UNKNOWN_OUTCOME -> markForReconciliation(message, e);
        case INVARIANT_BREACH -> quarantineAndAlert(message, e);
    }
}
```

---

## 13. Poison Message Handling

### 13.1 Poison message taxonomy

Poison message bisa terjadi karena:

- schema invalid;
- required field missing;
- enum value tidak dikenal;
- referenced entity tidak ada;
- business invariant violated;
- payload terlalu besar;
- deserialization failure;
- permanent external rejection;
- bug di consumer;
- data corruption upstream.

### 13.2 DLQ bukan tempat sampah

Dead-letter queue bukan sekadar “buang error”. DLQ adalah quarantine mechanism.

DLQ message harus menyimpan:

- original payload;
- original headers;
- source topic/queue;
- consumer name/version;
- failure classification;
- exception class;
- stable error code;
- attempt count;
- first failure time;
- last failure time;
- trace/correlation id;
- whether replay is safe;
- suggested remediation.

Contoh DLQ envelope:

```json
{
  "deadLetterId": "1c037bb7-7af2-4e9f-85d1-b2dbb63d03cf",
  "source": {
    "system": "case-service",
    "queue": "case.approval.requested",
    "messageId": "msg-2026-0001"
  },
  "failure": {
    "classification": "NON_RETRYABLE",
    "errorCode": "CASE_APPROVAL_INVALID_STATE",
    "exceptionClass": "InvalidCaseStateException",
    "message": "Case must be in SUBMITTED state before approval",
    "attempt": 5,
    "replaySafe": false
  },
  "diagnostic": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "consumerVersion": "case-service:2026.06.15",
    "failedAt": "2026-06-15T10:15:30Z"
  },
  "payload": {
    "caseId": "CASE-123",
    "requestedAction": "APPROVE"
  }
}
```

### 13.3 Replay policy

Jangan semua DLQ otomatis direplay.

Replay harus punya policy:

| Failure | Replay Allowed? | Condition |
|---|---:|---|
| Temporary dependency outage | Yes | Dependency recovered |
| Schema compatibility fixed | Yes | Consumer upgraded |
| Missing reference data | Maybe | Reference restored |
| Business invalid state | Usually no | Manual correction first |
| Duplicate side effect unknown | Dangerous | Reconciliation first |
| Security/authz failure | Usually no | Investigation first |

---

## 14. Shutdown Semantics untuk Worker

Worker shutdown harus punya urutan eksplisit.

```text
1. Mark application as draining.
2. Stop accepting new triggers/messages/tasks.
3. Stop polling new work.
4. Let active unit finish within budget.
5. Persist progress/checkpoint.
6. Ack/nack/commit offset according to completed work.
7. Release lock/lease if still owner.
8. Close broker connections/DB pools/executors.
9. Exit with meaningful status.
```

### 14.1 Bad shutdown

```text
SIGTERM received
  -> close DB pool immediately
  -> active worker fails with connection closed
  -> message is requeued
  -> processing may duplicate
  -> logs show random SQL errors instead of controlled shutdown
```

### 14.2 Better shutdown

```text
SIGTERM received
  -> readiness false
  -> consumers stop receiving new messages
  -> active messages finish or checkpoint
  -> ack completed messages
  -> nack unfinished messages or leave unacked
  -> executors drain
  -> DB pool closes last
```

### 14.3 Shutdown budget math

If:

```text
terminationGracePeriodSeconds = 60s
preStop sleep = 10s
load balancer drain margin = 10s
framework shutdown overhead = 5s
```

Then app worker drain budget is not 60s. It is closer to:

```text
60 - 10 - 10 - 5 = 35s
```

If one message can take 2 minutes, graceful shutdown cannot guarantee finishing current message. You need:

- shorter unit of work;
- checkpointing;
- idempotency;
- resumability;
- or longer grace period.

---

## 15. Spring Lifecycle for Workers

Spring gives lifecycle hooks, but you must design ordering.

Important concepts:

- `SmartLifecycle` for start/stop phase ordering;
- `@PreDestroy` for cleanup;
- `DisposableBean` / destroy method;
- executor shutdown configuration;
- listener container lifecycle;
- readiness state transition.

### 15.1 SmartLifecycle worker

```java
@Component
public class QueueConsumerLifecycle implements SmartLifecycle {
    private final MessageConsumerContainer container;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public QueueConsumerLifecycle(MessageConsumerContainer container) {
        this.container = container;
    }

    @Override
    public void start() {
        container.start();
        running.set(true);
    }

    @Override
    public void stop(Runnable callback) {
        running.set(false);
        container.stopAcceptingNewMessages();
        container.drain(Duration.ofSeconds(30));
        callback.run();
    }

    @Override
    public void stop() {
        stop(() -> { });
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }

    @Override
    public int getPhase() {
        return 100;
    }
}
```

Key idea:

> Worker containers should stop before infrastructure dependencies such as database pool, HTTP clients, metrics exporters, and tracing components are closed.

### 15.2 Spring scheduler/executor shutdown

Spring Framework 6.1 documents lifecycle-managed graceful shutdown support for `ThreadPoolTaskScheduler`. Spring Boot also exposes task execution/scheduling shutdown properties in modern versions.

Typical configuration pattern:

```properties
spring.task.execution.shutdown.await-termination=true
spring.task.execution.shutdown.await-termination-period=30s
spring.task.scheduling.shutdown.await-termination=true
spring.task.scheduling.shutdown.await-termination-period=30s
```

Still, configuration alone is not enough. Your tasks must be:

- interrupt-aware;
- checkpointed;
- idempotent;
- bounded in duration;
- not starting new sub-work during drain.

---

## 16. Worker Idempotency Patterns

Idempotency is more important for workers than for many HTTP endpoints because redelivery is normal.

### 16.1 Idempotency table

```sql
create table processed_message (
    message_id varchar(200) primary key,
    processed_at timestamp not null,
    result_code varchar(100) not null
);
```

Processing:

```java
@Transactional
public void process(Message message) {
    boolean inserted = processedMessageRepository.tryInsert(message.id());
    if (!inserted) {
        return; // already processed
    }

    applyBusinessChange(message);
}
```

Caveat: make sure the idempotency marker and business change are in the same transaction if possible.

### 16.2 Natural idempotency

Example:

```sql
update application
set status = 'APPROVED'
where id = :id
  and status = 'SUBMITTED';
```

If update count is 0:

- already approved? treat duplicate as success;
- rejected/canceled? business conflict;
- missing? invalid or eventual consistency.

### 16.3 External API idempotency

If calling external API:

- send idempotency key if provider supports it;
- store request ID and provider response;
- reconcile unknown timeouts;
- do not blindly retry non-idempotent calls.

---

## 17. Outbox Publisher as Worker

Outbox pattern solves this problem:

```text
DB transaction succeeds but message publish fails
```

Instead:

```text
business transaction
  -> update aggregate
  -> insert outbox event in same DB transaction

outbox worker
  -> claim unpublished event
  -> publish to broker
  -> mark published
```

### 17.1 Outbox failure windows

| Window | Outcome | Required Design |
|---|---|---|
| Crash before publish | Event remains unpublished | Worker retries |
| Publish succeeds, crash before mark published | Event may publish twice | Consumer idempotency |
| Mark published before publish | Event lost | Do not do this |
| Broker timeout after publish attempt | Unknown outcome | Retry may duplicate |

### 17.2 Outbox row state

```sql
create table outbox_event (
    id uuid primary key,
    aggregate_type varchar(100) not null,
    aggregate_id varchar(100) not null,
    event_type varchar(100) not null,
    payload jsonb not null,
    status varchar(30) not null,
    attempt int not null default 0,
    next_attempt_at timestamp not null,
    locked_by varchar(100) null,
    locked_until timestamp null,
    created_at timestamp not null,
    published_at timestamp null,
    last_error text null
);
```

### 17.3 Publisher loop

```java
public void publishOutbox() {
    while (!shutdownState.isDraining()) {
        List<OutboxEvent> events = outboxRepository.claimNextBatch(workerId, 100);
        if (events.isEmpty()) {
            sleepBriefly();
            continue;
        }

        for (OutboxEvent event : events) {
            try {
                broker.publish(event.eventType(), event.payload(), event.id().toString());
                outboxRepository.markPublished(event.id(), workerId);
            } catch (TransientBrokerException e) {
                outboxRepository.scheduleRetry(event.id(), e);
            } catch (Exception e) {
                outboxRepository.markFailed(event.id(), e);
            }
        }
    }
}
```

---

## 18. Error Handling in Listener Code

### 18.1 Bad listener

```java
public void onMessage(OrderMessage message) {
    orderService.process(message);
}
```

This hides:

- classification;
- retry policy;
- logging boundary;
- idempotency;
- DLQ decision;
- metrics;
- correlation ID;
- shutdown behavior.

### 18.2 Better listener architecture

```text
Listener Adapter
  -> parse envelope
  -> attach correlation context
  -> classify message metadata
  -> call application use case
  -> map result to ACK/NACK/DLQ/RETRY
  -> emit metrics
```

```java
public final class WorkerResult {
    enum Decision {
        ACK,
        RETRY_LATER,
        DEAD_LETTER,
        RECONCILE,
        STOP_CONSUMER
    }

    private final Decision decision;
    private final String errorCode;
    private final Throwable cause;
}
```

```java
public WorkerResult handle(MessageEnvelope envelope) {
    try {
        messageContext.attach(envelope.correlationId());
        useCase.execute(envelope.payload());
        return WorkerResult.ack();
    } catch (DuplicateMessageException e) {
        return WorkerResult.ack();
    } catch (RetryableWorkerException e) {
        return WorkerResult.retryLater(e.code(), e);
    } catch (NonRetryableWorkerException e) {
        return WorkerResult.deadLetter(e.code(), e);
    } catch (InvariantBreachException e) {
        return WorkerResult.stopConsumer(e.code(), e);
    } catch (Exception e) {
        return WorkerResult.retryLater("UNCLASSIFIED_WORKER_FAILURE", e);
    } finally {
        messageContext.clear();
    }
}
```

---

## 19. Observability for Workers

Worker observability must answer:

- How many messages processed?
- How many succeeded?
- How many failed retryable?
- How many dead-lettered?
- How many duplicates detected?
- How many unknown outcomes?
- What is queue lag?
- What is Kafka consumer lag?
- What is processing latency?
- What is retry age?
- What is oldest pending item?
- Is the worker draining?
- How long did shutdown take?
- Did final commit/ack fail?

### 19.1 Metrics

Recommended metrics:

```text
worker_messages_received_total{worker,source}
worker_messages_succeeded_total{worker,source}
worker_messages_failed_total{worker,error_classification,error_code}
worker_messages_retried_total{worker,error_code}
worker_messages_dead_lettered_total{worker,error_code}
worker_duplicates_detected_total{worker}
worker_unknown_outcome_total{worker}
worker_processing_duration_seconds{worker}
worker_inflight{worker}
worker_shutdown_duration_seconds{worker}
worker_shutdown_forced_total{worker}
worker_oldest_pending_age_seconds{worker}
worker_queue_depth{worker,queue}
```

### 19.2 Logs

Log once per failed unit at the boundary where decision is made.

Good log fields:

```json
{
  "event": "worker.message.failed",
  "worker": "case-approval-consumer",
  "messageId": "msg-123",
  "correlationId": "corr-456",
  "classification": "RETRYABLE",
  "decision": "RETRY_LATER",
  "attempt": 3,
  "errorCode": "DEPENDENCY_TIMEOUT",
  "exceptionClass": "ExternalDependencyTimeoutException"
}
```

Do not log massive payloads or sensitive data.

### 19.3 Tracing

For message consumers, create or continue trace context from message headers.

```text
producer span -> broker -> consumer span -> DB span -> external API span
```

If trace context missing, create new trace but preserve message ID/correlation ID.

---

## 20. Testing Worker Reliability

### 20.1 Test categories

You need tests for:

- successful processing;
- retryable failure;
- non-retryable failure;
- duplicate message;
- poison message;
- shutdown while idle;
- shutdown while processing;
- crash after DB commit before ACK;
- crash after publish before outbox mark-published;
- lock expiry;
- claim conflict;
- batch checkpoint resume;
- Kafka rebalance behavior;
- DLQ envelope correctness.

### 20.2 Failure window testing

Example conceptual test:

```java
@Test
void duplicateMessageAfterCrashShouldNotDoubleApplyBusinessChange() {
    Message message = new Message("msg-1", payload);

    worker.processUntilAfterDbCommitThenCrash(message);

    // Broker redelivers because ACK did not happen.
    worker.process(message);

    assertThat(repository.countBusinessEffectsFor("msg-1")).isEqualTo(1);
}
```

### 20.3 Shutdown test

```java
@Test
void shutdownShouldStopPollingAndFinishCurrentMessage() {
    worker.start();
    broker.deliver(messageTakingTwoSeconds());

    worker.beginShutdown(Duration.ofSeconds(5));

    assertThat(worker.acceptsNewMessages()).isFalse();
    assertThat(broker.wasAcked(messageId)).isTrue();
    assertThat(worker.isStopped()).isTrue();
}
```

---

## 21. Production Checklist

### 21.1 Worker design checklist

- [ ] Unit of work is clearly defined.
- [ ] Ownership model is explicit.
- [ ] Completion semantics are explicit.
- [ ] ACK/commit/checkpoint order is documented.
- [ ] Duplicate processing is safe or detected.
- [ ] Retryable and non-retryable failures are separated.
- [ ] Poison messages go to DLQ/quarantine.
- [ ] Attempt count and backoff are bounded.
- [ ] Unknown outcomes trigger reconciliation, not blind retry.
- [ ] Shutdown stops new work before closing dependencies.
- [ ] Current work can finish or checkpoint within shutdown budget.
- [ ] Distributed locks use token/fencing/lease where needed.
- [ ] Batch work has checkpoint/resume.
- [ ] Metrics exist for success/failure/retry/DLQ/lag.
- [ ] Logs include correlation/message ID.
- [ ] Sensitive payload is not logged.
- [ ] Replay policy exists.
- [ ] DLQ operational process exists.

### 21.2 Scheduler checklist

- [ ] Job overlap is intentionally allowed or prevented.
- [ ] Multi-pod execution is handled.
- [ ] Job execution state is durable for important jobs.
- [ ] Missed runs have defined behavior.
- [ ] Shutdown does not start new run.
- [ ] Running job can checkpoint.
- [ ] Lock expiry cannot cause unsafe double write.

### 21.3 Queue checklist

- [ ] Manual ACK used where needed.
- [ ] ACK is after durable safe point.
- [ ] Requeue is bounded.
- [ ] DLQ preserves diagnostic context.
- [ ] Prefetch is bounded and matches processing capacity.
- [ ] Consumer stop drains active messages.
- [ ] Redelivery is expected and tested.

### 21.4 Kafka checklist

- [ ] Offset commit occurs after processing.
- [ ] Replay window is acceptable.
- [ ] Processing is idempotent.
- [ ] Rebalance listener handles revoke safely.
- [ ] Consumer is closed properly.
- [ ] `wakeup()` or equivalent shutdown mechanism exists.
- [ ] Consumer lag is monitored.

---

## 22. Common Anti-Patterns

### Anti-pattern 1: ACK before processing

```text
ACK -> process -> crash = lost work
```

### Anti-pattern 2: Infinite requeue

```text
fail -> requeue -> fail -> requeue forever
```

### Anti-pattern 3: Scheduler in every pod without lock

```text
3 pods -> 3 executions -> duplicate side effects
```

### Anti-pattern 4: Distributed lock without idempotency

Lock reduces probability of duplicate, not eliminates it.

### Anti-pattern 5: Offset commit before processing

Kafka records can be skipped permanently.

### Anti-pattern 6: Batch without checkpoint

Crash at 99% means repeat everything or manually guess progress.

### Anti-pattern 7: Swallowing interruption

Application cannot shutdown gracefully.

### Anti-pattern 8: Closing DB before workers drain

Shutdown creates artificial failures and dirty redelivery.

### Anti-pattern 9: DLQ without replay/remediation process

DLQ becomes silent data loss with extra steps.

### Anti-pattern 10: Treating all exceptions as retryable

Permanent data defect becomes infinite operational noise.

---

## 23. A Practical Worker Architecture Template

```text
┌─────────────────────────────┐
│ Trigger / Broker / Schedule │
└──────────────┬──────────────┘
               │
               v
┌─────────────────────────────┐
│ Listener / Poller Adapter   │
│ - stop when draining        │
│ - parse envelope            │
│ - attach correlation        │
└──────────────┬──────────────┘
               │
               v
┌─────────────────────────────┐
│ Idempotency / Claim Layer   │
│ - message ID                │
│ - lock / lease              │
│ - fencing token             │
└──────────────┬──────────────┘
               │
               v
┌─────────────────────────────┐
│ Application Use Case        │
│ - transaction boundary      │
│ - invariant enforcement     │
│ - side effect policy        │
└──────────────┬──────────────┘
               │
               v
┌─────────────────────────────┐
│ Result Classifier           │
│ - ACK                       │
│ - retry                     │
│ - DLQ                       │
│ - reconciliation            │
│ - stop/alert                │
└──────────────┬──────────────┘
               │
               v
┌─────────────────────────────┐
│ Observability               │
│ - metric                    │
│ - structured log            │
│ - trace                     │
└─────────────────────────────┘
```

---

## 24. Top 1% Heuristics

1. **Never design worker logic without defining the unit of work.**

2. **Assume every message can be delivered more than once.**

3. **Assume shutdown can happen between any two lines of code.**

4. **ACK/offset commit/checkpoint are not implementation details; they are correctness boundaries.**

5. **Prefer duplicate with idempotency over silent loss.**

6. **Do not use retry to solve permanent data defects.**

7. **DLQ is not failure handling unless there is remediation and replay policy.**

8. **Batch without checkpoint is operational debt.**

9. **Distributed lock without fencing and idempotency is a probabilistic guard, not correctness.**

10. **Worker shutdown should close dependencies last, not first.**

11. **A worker is not reliable until you can answer what happens if it dies after each side effect.**

---

## 25. Review Questions

Gunakan pertanyaan ini untuk mengevaluasi desain worker nyata.

1. Apa unit of work terkecil?
2. Kapan unit dianggap selesai?
3. Apa yang terjadi jika proses mati sebelum ACK?
4. Apa yang terjadi jika proses mati setelah DB commit tetapi sebelum ACK?
5. Apa yang terjadi jika external API timeout setelah menerima request?
6. Apakah retry aman?
7. Apakah message duplicate aman?
8. Bagaimana poison message dihentikan?
9. Apakah DLQ punya metadata cukup untuk remediation?
10. Apakah job boleh overlap?
11. Apakah job boleh berjalan di banyak pod?
12. Apakah shutdown menghentikan polling lebih dulu?
13. Apakah current work bisa selesai dalam grace period?
14. Apa yang terjadi jika tidak bisa selesai?
15. Apakah progress durable?
16. Apakah ada checkpoint?
17. Apakah lock bisa expired saat work masih berjalan?
18. Apakah ada fencing token?
19. Apakah worker metrics cukup untuk mendeteksi backlog?
20. Apakah replay manual aman?

---

## 26. Summary

Background worker reliability lebih sulit daripada HTTP reliability karena work sering asynchronous, durable state tersebar, dan failure tidak langsung terlihat oleh user.

Prinsip utama:

- worker adalah state machine;
- ACK/commit/checkpoint adalah correctness boundary;
- redelivery adalah normal, bukan anomali;
- idempotency adalah requirement inti;
- retry harus bounded dan classified;
- poison message harus dikarantina;
- scheduler harus sadar multi-instance;
- batch harus punya checkpoint;
- shutdown harus stop new work, drain active work, persist progress, lalu close dependencies;
- observability harus bisa membedakan success, retry, DLQ, duplicate, unknown outcome, dan forced shutdown.

Jika Part 012 mengajarkan bagaimana HTTP request di-drain, Part 013 ini mengajarkan bagaimana pekerjaan belakang layar diselesaikan, diulang, dikarantina, atau dihentikan secara aman.

---

## 27. Referensi

- Java Platform Documentation — `ExecutorService`, interruption, and shutdown behavior.
- Spring Framework Reference — Task Execution and Scheduling.
- Spring Framework Javadoc — `ThreadPoolTaskScheduler` and lifecycle-managed scheduler behavior.
- Spring AMQP Reference — listener container attributes and acknowledgement modes.
- Apache Kafka Documentation and KafkaConsumer Javadoc — consumer close, offset commit, wakeup, and group behavior.
- Confluent Kafka Consumer Documentation — consumer offset commit and consumer close semantics.
- Kubernetes Documentation — Pod lifecycle, termination, `preStop`, and `terminationGracePeriodSeconds`.
- Google SRE materials — overload, retry, cascading failure, and operational reliability principles.

---

## Status Seri

```text
Part 013 / 030 completed
Seri belum selesai.
```

## Berikutnya

```text
Part 014 — Transaction Safety During Failure and Shutdown
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-reliability-part-012.md">⬅️ Part 012 — Request Draining and In-Flight Work Management</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-reliability-part-014.md">Part 014 — Transaction Safety During Failure and Shutdown ➡️</a>
</div>

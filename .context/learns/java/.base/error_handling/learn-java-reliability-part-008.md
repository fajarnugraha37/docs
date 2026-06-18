# learn-java-reliability-part-008.md

# Part 008 — Graceful Shutdown Fundamentals

> Seri: **Graceful Shutdown, Error Handling, Exceptions, dan Reliability**  
> Status: **Part 008 / 030**  
> Bagian sebelumnya: `Part 007 — Validation, Preconditions, Invariants, and Illegal States`  
> Bagian berikutnya: `Part 009 — JVM Shutdown Mechanics`

---

## 0. Tujuan Bagian Ini

Bagian ini adalah fondasi konseptual untuk semua pembahasan shutdown berikutnya.

Di banyak sistem, graceful shutdown sering dipahami terlalu dangkal:

> “Kalau aplikasi menerima SIGTERM, tunggu request selesai, lalu exit.”

Itu hanya sebagian kecil.

Dalam sistem production, graceful shutdown adalah **proses transisi state terkontrol** dari:

```text
SERVING_TRAFFIC
  -> DRAINING
  -> QUIESCING
  -> STOPPING
  -> TERMINATED
```

Tujuannya bukan sekadar “aplikasi mati dengan sopan”, tetapi memastikan bahwa ketika aplikasi berhenti:

1. tidak ada request baru yang diterima secara salah;
2. pekerjaan yang sedang berjalan diselesaikan, dibatalkan, atau dikembalikan dengan status yang benar;
3. side effect tidak terjadi setengah jalan tanpa evidence;
4. lock, lease, connection, thread, buffer, dan resource lain dilepas dengan urutan yang benar;
5. sistem lain memahami bahwa instance ini sedang keluar dari rotasi;
6. data tidak corrupt;
7. observability tetap menangkap alasan dan hasil shutdown;
8. orchestrator seperti Kubernetes tidak perlu membunuh proses secara paksa.

Dengan kata lain:

> **Graceful shutdown adalah reliability protocol antara aplikasi, runtime, infrastructure, dependency, dan manusia operator.**

---

## 1. Core Problem

### 1.1 Shutdown Adalah Failure Scenario yang Normal

Shutdown sering dianggap sebagai kondisi administratif biasa:

- deploy baru;
- rolling update;
- pod reschedule;
- node drain;
- autoscaling scale down;
- maintenance;
- restart karena config change;
- restart karena memory leak;
- restart karena incident recovery.

Namun dari perspektif request yang sedang berjalan, shutdown terlihat seperti failure:

- koneksi tiba-tiba putus;
- response tidak dikirim;
- transaksi menggantung;
- message sudah diproses tapi belum di-ack;
- file sudah ditulis sebagian;
- lock belum dilepas;
- external API sudah dipanggil tapi DB belum update;
- job batch berhenti di tengah;
- client retry dan menghasilkan duplikasi.

Jadi shutdown adalah **planned failure**.

Kalau planned failure saja tidak bisa dikendalikan, maka unplanned failure hampir pasti lebih buruk.

---

### 1.2 Masalah Utama Graceful Shutdown

Masalah graceful shutdown bukan hanya “berapa lama timeout-nya”.

Masalah sebenarnya adalah:

> Ketika sistem diminta berhenti, pekerjaan apa saja yang mungkin sedang berada di tengah state transition, dan apa konsekuensi dari menghentikannya pada titik itu?

Contoh:

```text
HTTP request diterima
  -> validasi sukses
  -> DB transaction mulai
  -> external payment API dipanggil
  -> payment sukses
  -> aplikasi menerima SIGTERM
  -> proses mati sebelum update DB
```

Pertanyaannya:

- Apakah user akan retry?
- Apakah payment akan double charge?
- Apakah DB tahu payment sudah berhasil?
- Apakah ada outbox event?
- Apakah ada reconciliation?
- Apakah request dianggap sukses atau gagal?
- Apakah observability mencatat causal chain-nya?

Graceful shutdown bukan bisa diselesaikan hanya dengan:

```yaml
server:
  shutdown: graceful
```

Itu hanya membantu satu lapisan: web server request draining.

---

## 2. Mental Model: Shutdown sebagai State Machine

Engineer top-tier tidak memandang shutdown sebagai callback, tetapi sebagai **state machine**.

### 2.1 State Utama

```text
[RUNNING]
    |
    | shutdown signal received
    v
[DRAINING]
    |
    | no new work accepted
    | in-flight work finishing / rejected / cancelled
    v
[QUIESCING]
    |
    | background workers stopped
    | queues drained or checkpointed
    | async executors stopped
    v
[RELEASING]
    |
    | connections closed
    | locks/leases released
    | buffers flushed
    | metrics/logs emitted
    v
[TERMINATED]
```

### 2.2 Arti Setiap State

#### RUNNING

Aplikasi normal:

- menerima traffic;
- menerima message;
- menjalankan scheduler;
- melakukan outbound call;
- membuka connection pool;
- expose readiness sebagai healthy.

#### DRAINING

Aplikasi sudah diminta berhenti.

Di fase ini:

- readiness seharusnya berubah menjadi tidak siap;
- traffic baru seharusnya tidak lagi diarahkan;
- request baru sebaiknya ditolak dengan status yang benar;
- request lama diberi kesempatan selesai;
- worker tidak mengambil pekerjaan baru;
- consumer berhenti polling message baru;
- scheduler tidak memulai job baru.

#### QUIESCING

Aplikasi menunggu internal work benar-benar diam.

Di fase ini:

- task yang sedang berjalan selesai atau dibatalkan;
- batch menyimpan checkpoint;
- message consumer ack/nack/requeue sesuai status;
- async executor ditutup;
- scheduled task dihentikan;
- background loop keluar secara kooperatif.

#### RELEASING

Aplikasi melepaskan resource.

Di fase ini:

- DB pool ditutup;
- HTTP client connection pool ditutup;
- Redis/RabbitMQ/Kafka connection ditutup;
- lock/lease dilepas;
- telemetry flush;
- audit/log final ditulis;
- temporary file dibersihkan;
- local cache/buffer di-flush jika memang perlu.

#### TERMINATED

Proses berhenti.

Exit code harus bermakna:

- `0`: normal planned shutdown;
- non-zero: abnormal shutdown / fatal error / failed startup / failed termination.

---

## 3. Graceful vs Immediate vs Forced vs Crash

Shutdown tidak selalu sama.

### 3.1 Graceful Shutdown

Graceful shutdown berarti aplikasi diberi kesempatan untuk berhenti secara terkontrol.

Ciri-ciri:

- stop menerima pekerjaan baru;
- pekerjaan berjalan diselesaikan jika aman;
- pekerjaan yang tidak bisa selesai dibatalkan dengan status jelas;
- resource dilepas;
- telemetry dikirim;
- proses exit sebelum deadline.

Contoh:

```text
SIGTERM diterima
readiness -> false
HTTP server stop accept new request
in-flight request diberi 20s
message consumer stop polling
current message selesai lalu ack
executor shutdown
connection pool close
exit 0
```

### 3.2 Immediate Shutdown

Immediate shutdown berarti aplikasi berhenti secepat mungkin dengan cleanup minimal.

Ciri-ciri:

- tidak menunggu semua pekerjaan selesai;
- hanya resource penting yang dilepas;
- cocok untuk kondisi fatal atau operator emergency.

Contoh:

```text
fatal invariant breach detected
stop accepting traffic
cancel pending tasks
flush critical logs
exit non-zero
```

### 3.3 Forced Shutdown

Forced shutdown berarti proses dibunuh oleh sistem luar.

Contoh:

- `SIGKILL`;
- container runtime kill;
- Kubernetes grace period habis;
- OOM kill;
- node mati;
- VM terminated.

Ciri-ciri:

- tidak ada Java shutdown hook;
- tidak ada finally block yang terjamin;
- tidak ada cleanup application-level;
- resource OS akan dibersihkan, tetapi semantic resource seperti lock eksternal mungkin tidak.

### 3.4 Crash

Crash adalah terminasi tidak terencana.

Penyebab:

- JVM fatal error;
- `OutOfMemoryError` parah;
- segmentation fault native library;
- process killed;
- node failure;
- container runtime failure;
- disk full;
- corrupted runtime state.

Graceful shutdown tidak boleh menjadi satu-satunya reliability mechanism, karena crash bisa melewati semua graceful path.

Maka desain reliability harus memiliki:

- idempotency;
- transaction boundary jelas;
- outbox/inbox;
- checkpoint;
- lease expiry;
- reconciliation;
- replay safety.

---

## 4. Shutdown sebagai Budget Waktu

### 4.1 Shutdown Deadline

Setiap shutdown punya deadline.

Di Kubernetes, misalnya, pod biasanya diberi `terminationGracePeriodSeconds`. Jika proses belum selesai setelah grace period, kubelet dapat mengirim sinyal paksa sehingga proses berhenti tanpa cleanup aplikasi.

Dalam aplikasi Java/Spring, konfigurasi seperti `spring.lifecycle.timeout-per-shutdown-phase` juga adalah budget waktu per fase lifecycle.

Jadi pertanyaan yang benar bukan:

> “Berapa timeout graceful shutdown?”

Pertanyaan yang benar:

> “Apa saja pekerjaan yang harus selesai dalam shutdown budget, mana yang boleh dibatalkan, dan apa recovery plan jika budget habis?”

---

### 4.2 Budget Harus Dibagi

Misal Kubernetes memberi 60 detik.

Budget itu tidak boleh semuanya dipakai untuk request draining.

Contoh pembagian:

```text
Total terminationGracePeriodSeconds: 60s

0s  - 5s    readiness false + load balancer propagation
5s  - 30s   HTTP request draining
30s - 45s   worker / scheduler / async task quiescing
45s - 55s   telemetry flush + resource release
55s - 60s   safety margin before SIGKILL
```

Jika aplikasi memakai semua 60 detik untuk request lama, maka:

- worker belum berhenti;
- telemetry belum flush;
- connection belum close;
- lock belum release;
- proses bisa kena SIGKILL.

---

### 4.3 Budget Harus Lebih Kecil dari Orchestrator Deadline

Prinsip:

```text
Application graceful timeout < Container/Kubernetes termination timeout
```

Contoh:

```yaml
# Kubernetes
terminationGracePeriodSeconds: 60
```

```yaml
# Spring Boot
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Kemudian sisakan waktu untuk:

- load balancer deregistration;
- `preStop`;
- telemetry flush;
- final cleanup;
- JVM exit.

Anti-pattern:

```yaml
terminationGracePeriodSeconds: 30
spring.lifecycle.timeout-per-shutdown-phase: 30s
```

Ini terlihat sinkron, tetapi sebenarnya berbahaya karena tidak ada margin.

---

## 5. Apa yang Harus Terjadi Saat Shutdown

Graceful shutdown ideal memiliki urutan logis berikut.

---

### 5.1 Stop Advertising Readiness

Aplikasi harus memberi sinyal:

```text
Saya tidak siap menerima traffic baru.
```

Dalam Kubernetes, ini biasanya lewat readiness probe.

Namun perubahan readiness tidak berarti traffic langsung berhenti secara instan.

Ada delay pada:

- kubelet update;
- endpoint controller;
- kube-proxy/ipvs/iptables;
- ingress controller;
- service mesh;
- load balancer;
- client-side connection reuse;
- DNS/cache;
- keep-alive connection.

Maka aplikasi tetap harus siap menghadapi request baru selama fase draining.

---

### 5.2 Stop Accepting New Work

New work meliputi:

- HTTP request baru;
- message baru dari queue;
- scheduled job baru;
- async task baru;
- batch partition baru;
- external callback baru;
- websocket command baru;
- file polling baru;
- stream record baru.

Setiap entrypoint harus punya strategy.

Contoh policy:

| Entrypoint | Saat Draining |
|---|---|
| HTTP read-only fast endpoint | boleh diproses sebentar atau 503 |
| HTTP command mutating state | biasanya reject jika belum mulai |
| Long-running export | reject atau continue tergantung SLA |
| Queue consumer | stop polling new message |
| Scheduler | jangan mulai job baru |
| Batch worker | finish current chunk lalu checkpoint |
| WebSocket | close dengan reason draining |
| External webhook | return retriable status jika aman |

---

### 5.3 Drain In-Flight Work

In-flight work adalah pekerjaan yang sudah diterima sebelum shutdown.

Tidak semua in-flight work harus diselesaikan.

Ada tiga pilihan:

#### Complete

Dipakai jika:

- pekerjaan pendek;
- side effect sudah dimulai;
- completion lebih aman daripada cancellation;
- masih cukup waktu.

#### Cancel

Dipakai jika:

- pekerjaan masih belum menghasilkan side effect;
- pekerjaan panjang;
- client bisa retry;
- ada checkpoint;
- cancellation kooperatif tersedia.

#### Reject / Abort with Explicit Result

Dipakai jika:

- request baru masuk saat draining;
- pekerjaan belum dimulai;
- sistem ingin client retry ke instance lain;
- response bisa dikirim dengan aman.

Contoh HTTP:

```text
503 Service Unavailable
Retry-After: 5
```

Namun `Retry-After` harus dipakai hati-hati. Jika command tidak idempotent, retry bisa berbahaya.

---

### 5.4 Stop Background Work

Background work sering menjadi sumber shutdown bug.

Contoh:

- `@Scheduled` task;
- executor async;
- queue listener;
- Kafka consumer;
- RabbitMQ consumer;
- polling job;
- file watcher;
- cache warmer;
- email sender;
- report generator;
- reconciliation worker.

Rule dasar:

```text
Stop taking new work before closing dependencies.
```

Salah:

```text
close database pool
then stop worker
```

Benar:

```text
stop worker polling
wait current work complete/checkpoint
then close database pool
```

---

### 5.5 Flush and Release Resource

Resource yang perlu dipikirkan:

- DB connection pool;
- HTTP client pool;
- message broker connection;
- Redis connection;
- file handles;
- object storage multipart upload;
- distributed lock;
- lease;
- local temporary directory;
- metrics exporter;
- trace exporter;
- async logger;
- audit buffer.

Penting:

> Flush bukan berarti menunggu tanpa batas.

Flush juga harus punya timeout.

---

### 5.6 Emit Final Observability Signal

Minimal log:

```json
{
  "event": "application_shutdown_started",
  "reason": "SIGTERM",
  "state": "DRAINING",
  "activeHttpRequests": 12,
  "activeWorkers": 3,
  "shutdownBudgetMs": 60000
}
```

Saat selesai:

```json
{
  "event": "application_shutdown_completed",
  "durationMs": 18420,
  "completedRequests": 11,
  "rejectedRequests": 2,
  "cancelledTasks": 1,
  "forced": false
}
```

Jika timeout:

```json
{
  "event": "application_shutdown_timeout",
  "durationMs": 55000,
  "remainingActiveTasks": 2,
  "risk": "process_may_receive_sigkill"
}
```

Tanpa observability, graceful shutdown hanya asumsi.

---

## 6. Shutdown Entry Points

Aplikasi bisa diminta berhenti dari banyak jalur.

### 6.1 OS Signal

Umum:

- `SIGTERM`: request normal untuk terminate;
- `SIGINT`: biasanya Ctrl+C;
- `SIGKILL`: forced kill, tidak bisa ditangkap aplikasi.

Di container, orchestrator biasanya mengirim `SIGTERM` dulu, lalu `SIGKILL` jika grace period habis.

### 6.2 JVM Shutdown Hook

Java menyediakan shutdown hook melalui `Runtime.getRuntime().addShutdownHook(...)`.

Shutdown hook adalah thread yang belum berjalan dan akan dimulai ketika JVM mulai shutdown.

Namun shutdown hook punya keterbatasan:

- urutan antar-hook tidak boleh diasumsikan;
- hook berjalan concurrently;
- tidak berjalan pada forced kill;
- tidak cocok untuk orchestration kompleks;
- bisa deadlock;
- bisa menggantung proses;
- dependency mungkin sudah dalam proses shutdown.

Jadi shutdown hook sebaiknya dipakai untuk bridging kecil, bukan sebagai pusat lifecycle.

### 6.3 Spring ApplicationContext Close

Dalam Spring Boot, graceful shutdown biasanya dikaitkan dengan penutupan application context.

Spring lifecycle menyediakan mekanisme seperti:

- `SmartLifecycle`;
- bean destruction callback;
- embedded web server graceful shutdown;
- lifecycle phase ordering;
- timeout per shutdown phase.

Ini lebih terstruktur daripada shutdown hook mentah.

### 6.4 Kubernetes Pod Termination

Kubernetes termination melibatkan beberapa hal:

- pod masuk terminating;
- readiness berubah;
- `preStop` hook jika ada;
- signal dikirim ke container process;
- grace period berjalan;
- jika belum berhenti, proses dibunuh paksa.

Penting:

> `preStop`, readiness propagation, aplikasi graceful shutdown, dan load balancer deregistration semuanya berbagi deadline operasional yang sama.

### 6.5 Manual Admin Endpoint

Beberapa sistem menyediakan admin endpoint:

```text
POST /internal/drain
POST /internal/shutdown
```

Ini berguna untuk:

- memulai draining sebelum pod termination;
- blue-green deployment;
- controlled traffic drain;
- emergency maintenance;
- canary removal.

Tapi endpoint ini harus diamankan ketat:

- mTLS;
- internal network only;
- authorization;
- audit logging;
- rate limiting;
- no public exposure.

---

## 7. Graceful Shutdown untuk HTTP Service

### 7.1 Basic HTTP Shutdown Flow

```text
SIGTERM received
  -> readiness false
  -> stop accepting new connection/request
  -> allow in-flight request to complete
  -> reject late request with 503
  -> close server
  -> close dependencies
  -> exit
```

### 7.2 Keep-Alive Connection Problem

HTTP keep-alive membuat client dapat memakai koneksi lama.

Saat draining:

- load balancer mungkin sudah tidak mengirim koneksi baru;
- tapi existing connection masih bisa membawa request baru;
- client library bisa retry pada connection reset;
- reverse proxy bisa punya buffering sendiri.

Maka aplikasi perlu policy untuk late request.

Contoh:

```java
if (shutdownState.isDraining()) {
    throw new ServiceDrainingException("Instance is shutting down");
}
```

Kemudian mapping ke:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 5
Content-Type: application/problem+json
```

### 7.3 Mutating Request Lebih Berbahaya

Read-only request biasanya aman untuk ditolak atau dilayani cepat.

Mutating request lebih sulit:

```text
POST /payments
POST /applications/{id}/approve
POST /cases/{id}/escalate
POST /documents/upload
```

Jika request sudah masuk service layer dan mulai side effect, cancellation bisa menghasilkan ambiguity.

Maka desain command harus punya:

- idempotency key;
- transaction boundary;
- operation status tracking;
- deterministic response;
- reconciliation path.

---

## 8. Graceful Shutdown untuk Worker dan Queue Consumer

HTTP service sering lebih mudah daripada worker.

Worker punya failure window yang lebih kompleks.

### 8.1 Worker Basic Flow

```text
shutdown requested
  -> stop polling new messages
  -> finish current message if within budget
  -> ack if success
  -> nack/requeue if not completed
  -> persist checkpoint if batch
  -> close broker connection
```

### 8.2 Ack Timing Matters

#### Ack Before Processing

```text
receive message
ack message
process message
```

Jika proses mati setelah ack tetapi sebelum processing selesai, message hilang.

#### Ack After Processing

```text
receive message
process message
ack message
```

Jika proses mati setelah processing tetapi sebelum ack, message akan dikirim ulang.

Ini butuh idempotency.

### 8.3 Shutdown Saat Batch Processing

Batch tidak boleh hanya berhenti sembarangan.

Contoh buruk:

```text
process 10.000 records
shutdown at record 7.321
no checkpoint
restart from beginning
```

Risiko:

- duplicate side effect;
- long recovery;
- inconsistent output;
- partial report;
- repeated external calls.

Desain lebih baik:

```text
process by chunk
commit checkpoint per chunk
on shutdown finish current chunk or rollback chunk
restart from last checkpoint
```

---

## 9. Graceful Shutdown untuk Scheduled Job

Scheduled job sering dilupakan.

Pertanyaan penting:

- Apakah scheduler boleh memulai job baru saat draining?
- Jika job sedang berjalan, apakah harus selesai?
- Jika job dihentikan, apakah bisa resume?
- Apakah job punya distributed lock?
- Apakah lock akan release jika process mati?
- Apakah job idempotent?
- Apakah job bisa overlap setelah restart?

### 9.1 Rule Dasar

Saat shutdown:

```text
No new scheduled execution should start.
```

Untuk job yang sedang berjalan:

- short job: finish;
- long job: checkpoint lalu stop;
- non-idempotent job: careful completion or operator intervention;
- external side-effect job: operation log wajib.

---

## 10. Graceful Shutdown untuk Async Executor

Async executor umum dipakai untuk:

- email sending;
- notification;
- audit enrichment;
- cache refresh;
- file generation;
- outbound webhook;
- report build;
- event publication.

Masalah:

```text
HTTP request returns success
async task still queued
shutdown happens
queued task lost
```

Jika async task adalah side effect penting, jangan hanya taruh di in-memory executor.

Gunakan:

- durable queue;
- outbox table;
- retry worker;
- operation status;
- explicit delivery log.

### 10.1 Executor Shutdown Policy

Policy executor harus jelas:

| Work Type | Shutdown Policy |
|---|---|
| best-effort cache warm | cancel/drop |
| email notification | persist to queue/outbox before return success |
| audit event | durable write before response or critical queue |
| report generation | checkpoint/cancel with status |
| external webhook | outbox + retry |

---

## 11. Resource Release Ordering

Urutan cleanup sangat penting.

### 11.1 Salah

```text
1. Close DB pool
2. Stop HTTP server
3. Stop worker
4. Flush telemetry
```

Masalah:

- request masih berjalan tapi DB sudah tertutup;
- worker masih memproses message tapi dependency hilang;
- error palsu muncul saat shutdown;
- message bisa gagal tanpa ack/nack jelas.

### 11.2 Lebih Benar

```text
1. Mark draining / readiness false
2. Stop accepting new HTTP request
3. Stop polling new queue messages
4. Stop starting scheduled jobs
5. Wait in-flight work / checkpoint / cancel
6. Flush durable side effects
7. Close external clients and pools
8. Flush telemetry/logs
9. Exit
```

Prinsip:

```text
Stop producers before consumers.
Stop accepting before processing shutdown.
Stop processing before closing dependencies.
Close dependencies before process exit.
```

---

## 12. Designing a Shutdown Coordinator

Untuk aplikasi kompleks, sebaiknya ada konsep internal:

```text
ShutdownCoordinator
```

Tugasnya:

- menyimpan shutdown state;
- expose `isDraining()`;
- menolak work baru;
- menghitung active work;
- menjalankan ordered shutdown steps;
- enforce timeout;
- mencatat metrics/log;
- memberi API untuk worker/scheduler/filter.

### 12.1 Model Sederhana

```java
public enum ShutdownState {
    RUNNING,
    DRAINING,
    QUIESCING,
    RELEASING,
    TERMINATED
}
```

```java
public final class ShutdownCoordinator {
    private final AtomicReference<ShutdownState> state =
            new AtomicReference<>(ShutdownState.RUNNING);

    private final LongAdder activeWork = new LongAdder();

    public boolean isAcceptingNewWork() {
        return state.get() == ShutdownState.RUNNING;
    }

    public boolean isDraining() {
        return state.get() != ShutdownState.RUNNING;
    }

    public WorkPermit tryStartWork() {
        if (!isAcceptingNewWork()) {
            throw new ServiceDrainingException("Instance is shutting down");
        }
        activeWork.increment();
        return () -> activeWork.decrement();
    }

    public void beginShutdown() {
        state.compareAndSet(ShutdownState.RUNNING, ShutdownState.DRAINING);
    }

    public long activeWorkCount() {
        return activeWork.sum();
    }
}
```

```java
@FunctionalInterface
public interface WorkPermit extends AutoCloseable {
    @Override
    void close();
}
```

Penggunaan:

```java
try (WorkPermit ignored = shutdownCoordinator.tryStartWork()) {
    applicationService.process(command);
}
```

Catatan:

- Ini contoh mental model, bukan final framework.
- Implementasi production harus memperhatikan race condition, timeout, metrics, dan integration dengan Spring lifecycle.

---

## 13. Admission Control Saat Draining

Admission control menjawab:

> Apakah pekerjaan baru masih boleh masuk?

Saat draining, default yang aman:

```text
Reject new work.
```

Tapi realitanya bisa lebih nuanced.

### 13.1 Policy Berdasarkan Jenis Operasi

| Operasi | Policy Saat Draining | Alasan |
|---|---|---|
| Health/liveness internal | allow | orchestrator butuh sinyal |
| Readiness | return not ready | keluarkan dari traffic |
| Metrics scrape | allow best-effort | observability |
| Read-only fast query | optional allow/reject | tergantung SLA |
| Mutating command | reject before processing | hindari ambiguity |
| Idempotent command with short duration | maybe allow | jika aman dan budget cukup |
| Long-running command | reject | risiko timeout |
| File upload besar | reject | sulit selesai dalam budget |
| Webhook callback | return retriable | provider bisa retry |

---

## 14. Cancellation Model

Graceful shutdown bukan hanya menunggu.

Kadang sistem harus membatalkan pekerjaan.

### 14.1 Cooperative Cancellation

Java tidak aman menghentikan thread secara paksa.

Model yang lebih aman:

- task mengecek cancellation flag;
- operasi blocking punya timeout;
- loop memeriksa interrupt;
- worker menerima deadline;
- transaction dibatasi timeout;
- external call punya timeout;
- batch checkpoint.

Contoh:

```java
public void processBatch(ShutdownCoordinator shutdown) {
    for (Record record : records) {
        if (shutdown.isDraining()) {
            checkpointCurrentPosition();
            return;
        }
        process(record);
    }
}
```

### 14.2 Hard Cancellation Risk

Hard cancellation bisa meninggalkan:

- transaction ambiguity;
- corrupted temporary file;
- partially written object;
- unacked message;
- unflushed audit;
- lock leak;
- inconsistent cache;
- duplicated external call.

Karena itu cancellation harus menjadi bagian dari desain operasi, bukan dipaksa di akhir.

---

## 15. Common Anti-Patterns

### 15.1 Menganggap Graceful Shutdown Hanya Konfigurasi

```yaml
server:
  shutdown: graceful
```

Konfigurasi ini berguna, tetapi tidak menyelesaikan:

- async task;
- queue consumer;
- scheduler;
- transaction uncertainty;
- external side effect;
- idempotency;
- readiness propagation;
- load balancer delay.

### 15.2 Shutdown Timeout Terlalu Panjang

Timeout terlalu panjang bisa membuat rollout lambat dan pod menggantung.

Masalah:

- deployment stuck;
- autoscaling lambat;
- node drain lambat;
- operator tidak tahu apakah aplikasi sehat;
- SIGKILL tetap terjadi jika melebihi orchestrator budget.

### 15.3 Shutdown Timeout Terlalu Pendek

Timeout terlalu pendek membuat proses sering dipaksa mati.

Masalah:

- request terputus;
- worker gagal ack/nack;
- telemetry hilang;
- transaction ambiguity meningkat.

### 15.4 Menutup Dependency Sebelum Work Berhenti

Contoh:

```text
DB pool closed while request still running
```

Akibat:

- error palsu;
- stack trace menyesatkan;
- partial work;
- incident noise.

### 15.5 Tidak Memiliki Idempotency

Jika shutdown terjadi setelah side effect tapi sebelum response, client bisa retry.

Tanpa idempotency:

- duplicate payment;
- duplicate submission;
- duplicate email;
- duplicate workflow transition;
- duplicate event.

### 15.6 Mengandalkan Finally untuk Semua Cleanup

`finally` berguna, tetapi tidak menjamin berjalan pada:

- SIGKILL;
- process crash;
- OOM fatal;
- machine power loss;
- container runtime kill.

Cleanup critical harus punya recovery path eksternal:

- lease expiry;
- reconciliation;
- durable operation log;
- idempotency guard;
- timeout-based lock release.

### 15.7 Menganggap Request Lama Selalu Aman Diselesaikan

Tidak semua request harus ditunggu.

Long-running request bisa:

- menghabiskan shutdown budget;
- membuat pod kena SIGKILL;
- menahan rollout;
- membuat dependency close terlambat.

Harus ada max duration.

---

## 16. Production Checklist

Gunakan checklist ini untuk review sistem nyata.

### 16.1 Application State

- [ ] Apakah aplikasi punya state `RUNNING` vs `DRAINING`?
- [ ] Apakah semua entrypoint bisa membaca state tersebut?
- [ ] Apakah new work ditolak saat draining?
- [ ] Apakah rejection punya error contract yang benar?
- [ ] Apakah active work dihitung?
- [ ] Apakah shutdown duration dicatat?

### 16.2 HTTP

- [ ] Apakah graceful shutdown web server aktif?
- [ ] Apakah readiness berubah sebelum stop?
- [ ] Apakah late request ditangani?
- [ ] Apakah long-running request punya timeout?
- [ ] Apakah mutating endpoint idempotent?
- [ ] Apakah response 503 saat draining aman untuk client retry?

### 16.3 Worker / Queue

- [ ] Apakah consumer stop polling new message?
- [ ] Apakah current message diselesaikan atau requeue?
- [ ] Apakah ack dilakukan setelah side effect aman?
- [ ] Apakah duplicate message aman?
- [ ] Apakah poison message ada handling?
- [ ] Apakah batch punya checkpoint?

### 16.4 Scheduler

- [ ] Apakah scheduler berhenti memulai job baru?
- [ ] Apakah running job bisa checkpoint?
- [ ] Apakah job idempotent?
- [ ] Apakah distributed lock punya TTL?
- [ ] Apakah job bisa resume setelah restart?

### 16.5 Resource

- [ ] Apakah dependency ditutup setelah work selesai?
- [ ] Apakah DB pool close punya timeout?
- [ ] Apakah HTTP client pool ditutup?
- [ ] Apakah broker connection ditutup dengan benar?
- [ ] Apakah telemetry flush punya timeout?
- [ ] Apakah lock/lease dilepas atau expire otomatis?

### 16.6 Kubernetes / Container

- [ ] Apakah app menerima SIGTERM sebagai shutdown normal?
- [ ] Apakah process utama adalah JVM, bukan shell yang menelan signal?
- [ ] Apakah `terminationGracePeriodSeconds` cukup?
- [ ] Apakah app timeout lebih kecil dari Kubernetes grace period?
- [ ] Apakah readiness probe mengeluarkan pod dari traffic?
- [ ] Apakah load balancer deregistration delay diperhitungkan?
- [ ] Apakah `preStop` tidak menghabiskan seluruh budget?

### 16.7 Observability

- [ ] Apakah shutdown start log ada?
- [ ] Apakah shutdown completed log ada?
- [ ] Apakah timeout/forced shutdown terdeteksi?
- [ ] Apakah active request/worker count dicatat?
- [ ] Apakah metrics shutdown duration ada?
- [ ] Apakah rejected request saat draining dihitung?

---

## 17. Example: Minimal Spring Boot Shutdown Awareness

Ini bukan implementasi final, tetapi ilustrasi.

### 17.1 Configuration

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

### 17.2 Shutdown State

```java
@Component
public class ShutdownStateHolder {
    private final AtomicBoolean draining = new AtomicBoolean(false);

    public boolean isDraining() {
        return draining.get();
    }

    public void markDraining() {
        draining.set(true);
    }
}
```

### 17.3 Lifecycle Hook

```java
@Component
public class DrainLifecycle implements SmartLifecycle {
    private final ShutdownStateHolder shutdownState;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public DrainLifecycle(ShutdownStateHolder shutdownState) {
        this.shutdownState = shutdownState;
    }

    @Override
    public void start() {
        running.set(true);
    }

    @Override
    public void stop() {
        shutdownState.markDraining();
        running.set(false);
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }

    @Override
    public int getPhase() {
        return Integer.MIN_VALUE;
    }
}
```

Catatan penting:

- Phase ordering harus diuji, bukan diasumsikan.
- Untuk production, gunakan pendekatan yang konsisten dengan lifecycle Spring Boot yang sebenarnya.
- Jangan menutup dependency manual jika Spring sudah mengelolanya, kecuali kamu tahu ordering-nya.

### 17.4 Request Filter

```java
@Component
public class DrainingFilter extends OncePerRequestFilter {
    private final ShutdownStateHolder shutdownState;

    public DrainingFilter(ShutdownStateHolder shutdownState) {
        this.shutdownState = shutdownState;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        if (shutdownState.isDraining() && isMutatingRequest(request)) {
            response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
            response.setHeader(HttpHeaders.RETRY_AFTER, "5");
            response.setContentType("application/problem+json");
            response.getWriter().write("""
                {
                  "type": "https://example.com/problems/service-draining",
                  "title": "Service is draining",
                  "status": 503,
                  "code": "SERVICE_DRAINING",
                  "message": "This instance is shutting down. Retry the request safely if the operation is idempotent."
                }
                """);
            return;
        }

        filterChain.doFilter(request, response);
    }

    private boolean isMutatingRequest(HttpServletRequest request) {
        return switch (request.getMethod()) {
            case "POST", "PUT", "PATCH", "DELETE" -> true;
            default -> false;
        };
    }
}
```

Catatan:

- Jangan asal mengizinkan retry untuk semua mutating request.
- Error message harus disesuaikan dengan API error contract.
- Untuk endpoint idempotent, policy bisa berbeda.

---

## 18. Example: Worker Shutdown Awareness

```java
public class QueueWorker {
    private final ShutdownStateHolder shutdownState;
    private final MessageClient messageClient;
    private final MessageHandler handler;

    public void runLoop() {
        while (!shutdownState.isDraining()) {
            Message message = messageClient.poll(Duration.ofSeconds(2));

            if (message == null) {
                continue;
            }

            try {
                handler.handle(message);
                messageClient.ack(message);
            } catch (RetryableProcessingException e) {
                messageClient.nackRequeue(message);
            } catch (NonRetryableProcessingException e) {
                messageClient.deadLetter(message, e);
            } catch (Exception e) {
                messageClient.nackRequeue(message);
            }
        }
    }
}
```

Masalah yang harus ditambahkan di production:

- max processing time;
- idempotency;
- poison message threshold;
- retry count;
- shutdown deadline;
- metrics;
- tracing;
- partial side effect handling;
- ack/nack failure handling.

---

## 19. Failure Scenario Walkthrough

### Scenario: SIGTERM Saat Request Approval Berjalan

```text
T0  request POST /cases/123/approve masuk
T1  validation sukses
T2  transaction start
T3  case state APPROVED disimpan
T4  audit event disimpan
T5  external notification belum terkirim
T6  SIGTERM diterima
T7  aplikasi masuk DRAINING
T8  request diberi kesempatan selesai
T9  transaction commit
T10 outbox event tersimpan
T11 response sukses dikirim
T12 worker nanti mengirim notification dari outbox
T13 aplikasi exit
```

Ini relatif aman jika:

- audit ikut transaction;
- notification memakai outbox;
- command idempotent;
- response sukses hanya setelah commit;
- worker bisa resume.

### Scenario Buruk

```text
T0 request approve masuk
T1 external notification dikirim langsung
T2 SIGTERM
T3 DB belum commit
T4 process killed
T5 user retry
T6 notification terkirim lagi
```

Masalah:

- side effect eksternal terjadi sebelum durable state;
- tidak ada outbox;
- retry menghasilkan duplikasi;
- DB tidak merekam status sebenarnya.

Kesimpulan:

> Graceful shutdown tidak bisa memperbaiki desain side effect yang tidak reliable.

---

## 20. Design Heuristics

### 20.1 Selalu Tanyakan “New Work Masuk Dari Mana?”

Bukan hanya HTTP.

Daftar semua input:

- controller;
- message broker;
- scheduler;
- file polling;
- websocket;
- webhook;
- async executor;
- batch framework;
- database notification;
- stream subscription.

Setiap input harus punya shutdown policy.

### 20.2 Semua Long-Running Work Harus Punya Checkpoint

Jika tidak punya checkpoint, maka saat shutdown pilihannya buruk:

- tunggu terlalu lama;
- bunuh paksa;
- ulang dari awal;
- corrupt sebagian;
- operator manual cleanup.

### 20.3 Jangan Percaya “Finally Will Save Us”

`finally` membantu pada normal exception path.

Tapi reliability harus tahan terhadap:

- process kill;
- node failure;
- pod eviction;
- OOM;
- disk full;
- dependency timeout.

### 20.4 Graceful Shutdown Harus Diukur

Minimal metrics:

```text
shutdown_started_total
shutdown_completed_total
shutdown_timeout_total
shutdown_duration_seconds
shutdown_active_requests
shutdown_active_workers
shutdown_rejected_requests_total
shutdown_cancelled_tasks_total
```

### 20.5 Design for “At Least Once” Reality

Jika shutdown terjadi di tengah distributed operation, duplicate hampir selalu mungkin.

Maka:

- command harus idempotent;
- message handler harus idempotent;
- external side effect harus punya operation key;
- database constraint harus membantu dedup;
- outbox/inbox harus dipertimbangkan.

---

## 21. Relationship dengan Part Berikutnya

Bagian ini memberi fondasi konseptual.

Part berikutnya akan masuk lebih dalam ke:

```text
Part 009 — JVM Shutdown Mechanics
```

Yang akan membahas:

- JVM shutdown sequence;
- shutdown hook;
- daemon vs non-daemon thread;
- signal handling;
- `System.exit`;
- exit code;
- deadlock saat shutdown;
- hook ordering;
- kenapa shutdown hook bukan lifecycle architecture.

Setelah itu:

```text
Part 010 — Spring Boot Graceful Shutdown Deep Dive
Part 011 — Kubernetes, Containers, and Shutdown Reality
Part 012 — Request Draining and In-Flight Work Management
Part 013 — Background Workers, Schedulers, Queues, and Message Consumers
```

Jadi Part 008 ini adalah “peta besar”; part berikutnya akan membedah tiap lapisan.

---

## 22. Review Questions

Gunakan pertanyaan ini untuk menguji pemahaman.

1. Mengapa shutdown harus dianggap sebagai planned failure?
2. Apa beda graceful shutdown, immediate shutdown, forced shutdown, dan crash?
3. Mengapa graceful shutdown tidak cukup hanya dengan konfigurasi Spring Boot?
4. Apa arti state `DRAINING`?
5. Mengapa aplikasi harus stop accepting new work sebelum menutup dependency?
6. Apa risiko menutup DB pool saat request masih berjalan?
7. Mengapa `terminationGracePeriodSeconds` harus lebih besar dari application shutdown timeout?
8. Mengapa worker queue lebih sulit dishutdown daripada HTTP request?
9. Apa hubungan shutdown dengan idempotency?
10. Mengapa `finally` tidak cukup sebagai reliability mechanism?
11. Apa perbedaan complete, cancel, dan reject untuk in-flight work?
12. Mengapa scheduled job butuh checkpoint?
13. Apa yang harus dicatat di log saat shutdown dimulai dan selesai?
14. Mengapa graceful shutdown harus punya observability metrics?
15. Apa failure window paling berbahaya saat external side effect terjadi sebelum durable state?

---

## 23. Summary

Graceful shutdown adalah proses reliability yang mengatur transisi aplikasi dari state aktif menuju terminasi secara aman.

Mental model utamanya:

```text
RUNNING
  -> DRAINING
  -> QUIESCING
  -> RELEASING
  -> TERMINATED
```

Prinsip-prinsip terpenting:

1. Shutdown adalah planned failure.
2. Stop menerima pekerjaan baru sebelum menutup dependency.
3. Drain pekerjaan lama hanya jika aman dan masih dalam budget.
4. Worker, scheduler, async executor, dan queue consumer harus punya shutdown policy sendiri.
5. Shutdown timeout adalah budget, bukan angka dekoratif.
6. Application timeout harus lebih kecil dari orchestrator grace period.
7. Graceful shutdown tidak menggantikan idempotency, checkpoint, outbox, dan recovery design.
8. Forced kill dan crash tetap mungkin terjadi.
9. Observability shutdown wajib ada.
10. Sistem reliable bukan hanya bisa hidup dengan baik, tetapi juga bisa berhenti dengan benar.

> **Top-tier engineer tidak hanya mendesain startup path dan happy path. Mereka juga mendesain bagaimana sistem berhenti, gagal, pulih, dan meninggalkan evidence yang benar.**

---

## 24. Referensi

Referensi utama untuk bagian ini:

1. Oracle Java Runtime API — JVM shutdown hooks dan shutdown sequence.
2. Spring Boot Reference Documentation — Graceful Shutdown.
3. Kubernetes Documentation — Pod lifecycle dan termination behavior.
4. Kubernetes Documentation — Container lifecycle hooks, termasuk `preStop`.
5. Google Cloud Blog — Kubernetes best practices: terminating with grace.
6. Google SRE materials — overload, cascading failure, and graceful degradation principles.

---

## 25. Status Seri

```text
Part 008 / 030 completed
Seri belum selesai.
```

Bagian berikutnya:

```text
Part 009 — JVM Shutdown Mechanics
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-reliability-part-007.md">⬅️ Part 007 — Validation, Preconditions, Invariants, and Illegal States</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-reliability-part-009.md">Part 009 — JVM Shutdown Mechanics ➡️</a>
</div>

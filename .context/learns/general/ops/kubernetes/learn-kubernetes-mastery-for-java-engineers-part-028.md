# learn-kubernetes-mastery-for-java-engineers-part-028.md

# Part 028 — Batch, Scheduling, Workers, and Event-Driven Workloads

## 1. Tujuan Part Ini

Pada part sebelumnya kita membahas service mesh dan east-west traffic: bagaimana service berbicara dengan service lain, bagaimana traffic policy bekerja, dan bagaimana retry, timeout, serta mTLS dapat memengaruhi aplikasi Java. Part ini bergeser ke jenis workload yang sering jauh lebih sulit dari REST API biasa: **batch jobs, scheduled jobs, background workers, queue consumers, dan event-driven workloads**.

Workload jenis ini terlihat sederhana:

```text
ambil pesan → proses → commit/ack → ulangi
```

atau:

```text
jalan setiap malam → baca data → proses → tulis hasil
```

Tetapi di Kubernetes, realitasnya jauh lebih kompleks:

```text
Pod bisa mati kapan saja.
Job bisa retry.
CronJob bisa overlap.
Deployment bisa rollout.
Consumer group bisa rebalance.
Node bisa drain.
HPA bisa scale up/down.
Broker bisa lambat.
Downstream bisa overload.
Message bisa diproses lebih dari sekali.
```

Tujuan part ini adalah membuat kamu mampu mendesain dan mengoperasikan workload non-HTTP di Kubernetes dengan mental model yang benar, terutama untuk ekosistem Java seperti Spring Boot, Spring Batch, Quartz/ShedLock, Kafka consumer, RabbitMQ consumer, worker berbasis Redis queue, dan batch processing internal.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan kapan memakai `Job`, `CronJob`, `Deployment`, atau `StatefulSet` untuk workload background.
2. Mendesain worker yang aman terhadap restart, retry, duplicate execution, dan partial failure.
3. Memahami perbedaan semantics Kubernetes retry dengan broker retry.
4. Mendesain graceful shutdown untuk message consumer Java.
5. Menghindari rebalance storm pada Kafka consumer saat rollout/autoscaling.
6. Menghindari duplicate job execution pada CronJob dan batch process.
7. Mendesain idempotency, checkpointing, locking, dan lease secara realistis.
8. Menghubungkan backlog, autoscaling, resource sizing, dan downstream protection.
9. Debugging Job/CronJob/worker failure secara sistematis.
10. Membuat production checklist untuk event-driven workload di Kubernetes.

Part ini tidak akan mengulang internal Kafka/RabbitMQ/Redis yang sudah dibahas di seri sebelumnya. Kita akan fokus pada **bagaimana workload tersebut hidup di Kubernetes**.

---

## 2. Mental Model Utama

### 2.1 HTTP service vs background workload

HTTP service biasanya punya pola:

```text
client request → service handles request → response
```

Kubernetes membantu dengan:

```text
Deployment → ReplicaSet → Pod
Service → endpoint discovery
Ingress/Gateway → external routing
Readiness → traffic routing
HPA → scaling by request/resource metric
```

Background workload punya pola berbeda:

```text
trigger / schedule / message / backlog → processing loop → side effect → checkpoint/ack/commit
```

Kubernetes tidak tahu secara semantik apakah pekerjaan sudah aman, sudah commit, sudah ack, atau sudah idempotent. Kubernetes hanya melihat:

```text
Pod running?
Container exited code 0 atau non-zero?
Job complete?
Readiness/liveness pass?
Resource masih cukup?
```

Jadi, untuk background workload, correctness tidak bisa diserahkan ke Kubernetes saja. Correctness harus didesain di application layer.

---

### 2.2 Ada dua control loop yang bertemu

Untuk event-driven workload, biasanya ada minimal dua control loop:

```text
Kubernetes control loop:
  desired replicas / job completion / pod lifecycle

Application/broker control loop:
  messages / partitions / offsets / acknowledgements / retries / leases
```

Contoh Kafka consumer:

```text
Kubernetes Deployment ingin 6 replicas.
Kafka consumer group ingin membagi partition ownership ke members.
Saat Pod rollout, Kubernetes membunuh Pod lama dan membuat Pod baru.
Kafka melihat consumer pergi dan masuk → rebalance.
```

Contoh RabbitMQ worker:

```text
Kubernetes HPA scale up dari 5 ke 30 replicas.
RabbitMQ mengirim pesan lebih banyak ke worker.
Downstream database mendadak menerima concurrency 6x lipat.
```

Contoh CronJob:

```text
Kubernetes CronJob membuat Job baru setiap jam.
Job sebelumnya belum selesai.
concurrencyPolicy menentukan apakah job baru boleh overlap, skip, atau replace.
Application sendiri mungkin tetap perlu lock agar side effect tidak ganda.
```

Mental model yang benar:

```text
Kubernetes mengatur lifecycle compute.
Broker/scheduler mengatur unit work.
Application harus mengatur correctness boundary.
```

---

### 2.3 Unit of compute bukan sama dengan unit of work

Di Kubernetes:

```text
Pod = unit compute/runtime
Job = controller untuk menyelesaikan sejumlah Pod sampai completion
CronJob = scheduler untuk membuat Job berdasarkan waktu
Deployment = controller untuk menjaga sejumlah Pod tetap hidup
```

Di application domain:

```text
message = unit work
partition = unit ordering/ownership
batch window = unit processing interval
record range = unit checkpoint
file = unit input
transaction = unit consistency boundary
```

Kesalahan umum adalah menganggap keduanya sama.

Contoh buruk:

```text
1 Pod = 1 business job
```

Padahal:

```text
1 Pod bisa memproses banyak message.
1 Job bisa membuat banyak Pod.
1 CronJob bisa menciptakan Job berulang.
1 message bisa diproses ulang oleh Pod berbeda.
1 partition bisa pindah ownership saat Pod mati.
```

Invariant penting:

```text
Compute lifecycle boleh berubah.
Unit work harus tetap memiliki correctness invariant sendiri.
```

---

## 3. Taxonomy Workload Non-HTTP

### 3.1 One-off batch job

Ciri:

```text
- dijalankan sekali
- punya awal dan akhir jelas
- berhasil jika exit code 0
- gagal jika exit code non-zero atau timeout
```

Contoh:

```text
- database migration satu kali
- data backfill
- report generation manual
- cache warming task
- export file
```

Kubernetes object yang cocok:

```text
Job
```

---

### 3.2 Scheduled batch job

Ciri:

```text
- dijalankan berdasarkan jadwal
- misalnya tiap jam / tiap malam / tiap bulan
- setiap run menghasilkan Job baru
```

Contoh:

```text
- nightly reconciliation
- daily settlement
- monthly invoice generation
- periodic cleanup
- scheduled sync with external system
```

Kubernetes object yang cocok:

```text
CronJob
```

---

### 3.3 Long-running worker

Ciri:

```text
- berjalan terus-menerus
- mengambil work dari queue/broker
- tidak punya akhir normal
- jika mati, harus diganti
```

Contoh:

```text
- RabbitMQ consumer
- Kafka consumer
- Redis stream consumer
- background email sender
- notification worker
- document processing worker
```

Kubernetes object yang cocok:

```text
Deployment
```

Kadang:

```text
StatefulSet
```

jika worker membutuhkan identity stabil, partition pinning tertentu, atau state lokal yang harus mengikuti ordinal.

---

### 3.4 Sharded worker

Ciri:

```text
- processing dibagi berdasarkan shard/partition
- setiap replica punya ownership tertentu
- ordering atau exclusivity penting
```

Contoh:

```text
- Kafka partition consumer
- shard-based reconciliation worker
- tenant-partitioned processor
- distributed scheduler
```

Object yang mungkin cocok:

```text
Deployment + broker-level partition assignment
StatefulSet + deterministic shard assignment
Custom controller/operator
```

---

### 3.5 Singleton scheduler / leader worker

Ciri:

```text
- hanya satu instance boleh aktif melakukan scheduling/coordination
- instance lain boleh standby
```

Contoh:

```text
- Quartz scheduler
- internal periodic coordinator
- reconciliation leader
- report dispatcher
```

Pilihan:

```text
Deployment replicas=1
Deployment replicas>1 + leader election
Lease object
external distributed lock
```

`replicas=1` tidak selalu cukup karena:

```text
- Pod lama bisa belum benar-benar berhenti saat Pod baru mulai
- network partition bisa membuat lock ownership ambigu jika lock buruk
- scheduler/application bisa duplicate jika tidak idempotent
```

---

## 4. Kubernetes Job Deep Dive

### 4.1 Apa itu Job?

`Job` adalah controller untuk menjalankan satu atau lebih Pod sampai sejumlah completion terpenuhi.

Mental model:

```text
Job desired state:
  Saya ingin N successful completions.

Job controller:
  Membuat Pod.
  Mengamati Pod sukses/gagal.
  Membuat pengganti jika perlu.
  Menandai Job Complete atau Failed.
```

Job cocok untuk work yang punya akhir.

---

### 4.2 Minimal Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: sample-backfill
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: backfill
          image: registry.example.com/app/backfill:1.0.0
          args:
            - "--from=2026-01-01"
            - "--to=2026-01-31"
```

Hal penting:

```text
restartPolicy untuk Job biasanya Never atau OnFailure.
Job success/failure dilihat dari Pod/container exit status.
```

---

### 4.3 `restartPolicy: Never` vs `OnFailure`

`Never`:

```text
Container gagal → Pod gagal → Job controller dapat membuat Pod baru.
```

`OnFailure`:

```text
Container gagal → kubelet restart container dalam Pod yang sama.
```

Trade-off:

```text
Never:
  + setiap attempt terlihat sebagai Pod berbeda
  + lebih mudah audit attempt
  + cocok untuk batch yang ingin log per attempt
  - lebih banyak Pod object

OnFailure:
  + restart lokal lebih cepat
  + Pod identity tetap
  - attempt history bisa kurang jelas
  - local temp state bisa membuat hasil ambigu jika tidak hati-hati
```

Untuk batch yang menghasilkan side effect, `Never` sering lebih mudah diinvestigasi.

---

### 4.4 `backoffLimit`

`backoffLimit` membatasi berapa kali Kubernetes mencoba ulang Job sebelum dianggap Failed.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: invoice-export
spec:
  backoffLimit: 3
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: export
          image: registry.example.com/billing/export:2.4.1
```

Jangan menganggap retry Kubernetes otomatis aman.

Kalau proses:

```text
1. membaca invoice
2. membuat file
3. upload ke S3
4. menulis status exported
```

lalu gagal di antara langkah 3 dan 4, retry bisa membuat duplicate upload kecuali ada idempotency key.

Invariant:

```text
Retry hanya aman jika operation idempotent atau punya compensation/checkpoint.
```

---

### 4.5 `activeDeadlineSeconds`

`activeDeadlineSeconds` membatasi durasi Job.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: nightly-reconciliation
spec:
  activeDeadlineSeconds: 7200
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: reconcile
          image: registry.example.com/reconcile:1.3.0
```

Gunakan untuk mencegah Job menggantung tanpa batas.

Tetapi jangan pakai angka asal. Tanyakan:

```text
Berapa durasi normal?
Berapa p95/p99 durasi historis?
Berapa lama sebelum hasil job tidak lagi berguna?
Apa yang harus terjadi jika deadline tercapai?
```

---

### 4.6 `ttlSecondsAfterFinished`

Job dan Pod yang selesai bisa dibersihkan otomatis.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: report-generator
spec:
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: report
          image: registry.example.com/report:5.0.0
```

Trade-off:

```text
TTL pendek:
  + cluster tidak penuh object lama
  - forensic evidence cepat hilang

TTL panjang:
  + mudah audit/debug
  - API server/etcd bisa penuh object historis
```

Untuk production, log harus tetap dikirim ke centralized logging. Jangan bergantung pada Pod lama untuk audit.

---

### 4.7 Parallel Job

Job bisa menjalankan beberapa Pod paralel.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: image-processing-batch
spec:
  completions: 100
  parallelism: 10
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: worker
          image: registry.example.com/image-processor:1.0.0
```

Makna:

```text
completions: butuh 100 successful completions
parallelism: maksimal 10 Pod aktif sekaligus
```

Pertanyaan desain:

```text
Bagaimana tiap Pod tahu unit work mana yang harus dikerjakan?
Apakah work assignment deterministic?
Apakah ada duplicate jika Pod retry?
Apakah result write idempotent?
```

Kubernetes hanya mengatur jumlah Pod, bukan pembagian business work.

---

### 4.8 Indexed Job

Indexed Job memberi index stabil ke tiap completion.

Contoh konseptual:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: shard-backfill
spec:
  completions: 16
  parallelism: 4
  completionMode: Indexed
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: backfill
          image: registry.example.com/backfill:1.0.0
          env:
            - name: JOB_COMPLETION_INDEX
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
```

Mental model:

```text
completion index 0..15
setiap index bisa dipakai sebagai shard id
```

Cocok untuk:

```text
- shard by tenant range
- shard by hash modulo N
- process fixed partitions
```

Tetap perlu idempotency karena index yang sama bisa retry.

---

## 5. CronJob Deep Dive

### 5.1 Apa itu CronJob?

`CronJob` membuat `Job` berdasarkan schedule.

Mental model:

```text
CronJob = scheduler object
Job = execution object
Pod = runtime object
```

Object graph:

```text
CronJob
  └── Job run #1
        └── Pod attempt(s)
  └── Job run #2
        └── Pod attempt(s)
```

---

### 5.2 Minimal CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-reconciliation
spec:
  schedule: "0 2 * * *"
  timeZone: "Asia/Jakarta"
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: reconcile
              image: registry.example.com/reconcile:1.0.0
```

Gunakan `timeZone` eksplisit agar jadwal tidak ambigu.

Pertanyaan penting:

```text
Apakah 02:00 berarti waktu Jakarta, UTC, atau timezone cluster?
Apa yang terjadi saat daylight saving jika region terkait DST?
Apa yang terjadi jika controller down saat schedule terlewat?
```

---

### 5.3 `concurrencyPolicy`

`concurrencyPolicy` menentukan perilaku saat run sebelumnya belum selesai.

Pilihan:

```text
Allow    → run baru boleh overlap
Forbid   → run baru diskip jika run lama masih aktif
Replace  → run lama diganti oleh run baru
```

Contoh:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: hourly-sync
spec:
  schedule: "0 * * * *"
  timeZone: "Asia/Jakarta"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: sync
              image: registry.example.com/sync:2.0.0
```

Trade-off:

```text
Allow:
  + tidak melewatkan schedule
  - duplicate/overlap risk
  - downstream load spike

Forbid:
  + mencegah overlap
  - schedule bisa terlewat
  - jika job hang, semua run berikutnya tertahan

Replace:
  + hanya run terbaru berjalan
  - run lama bisa dihentikan di tengah side effect
  - butuh checkpoint/compensation kuat
```

Untuk financial reconciliation, settlement, enforcement lifecycle, atau job regulatory yang harus defensible, `Allow` biasanya berbahaya kecuali logic-nya benar-benar partitioned dan idempotent.

---

### 5.4 `startingDeadlineSeconds`

`startingDeadlineSeconds` membatasi seberapa terlambat CronJob masih boleh memulai run yang terlewat.

Contoh:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: external-sync
spec:
  schedule: "*/15 * * * *"
  timeZone: "Asia/Jakarta"
  startingDeadlineSeconds: 300
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: sync
              image: registry.example.com/sync:1.0.0
```

Makna:

```text
Jika lebih dari 5 menit terlambat, skip run tersebut.
```

Cocok untuk job yang kehilangan nilai jika terlambat, misalnya polling pendek.

Tidak cocok untuk job yang harus eventually run, misalnya monthly billing, kecuali ada catch-up mechanism.

---

### 5.5 History limit

```yaml
successfulJobsHistoryLimit: 3
failedJobsHistoryLimit: 5
```

Gunakan untuk membatasi jumlah Job historis yang disimpan.

Tetapi lagi-lagi:

```text
Kubernetes object history bukan audit log utama.
```

Audit penting harus berada di:

```text
- application audit table
- centralized logs
- metrics/traces
- object storage result manifest
- external audit/event store
```

---

## 6. Deployment as Worker Controller

### 6.1 Kenapa worker biasanya Deployment?

Long-running worker cocok dengan Deployment karena:

```text
- harus selalu hidup
- jumlah replica bisa dikontrol
- rollout image/config mudah
- HPA bisa menambah/mengurangi replica
- Pod yang mati diganti otomatis
```

Contoh RabbitMQ worker:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: email-worker
spec:
  replicas: 4
  selector:
    matchLabels:
      app: email-worker
  template:
    metadata:
      labels:
        app: email-worker
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: worker
          image: registry.example.com/email-worker:1.0.0
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              memory: "1Gi"
```

---

### 6.2 Worker readiness berbeda dari API readiness

Untuk HTTP service:

```text
ready = bisa menerima request
```

Untuk worker:

```text
ready = mampu mengambil work dengan aman
```

Tetapi banyak worker tidak menerima Service traffic. Readiness tetap berguna untuk:

```text
- rollout gating
- operational visibility
- custom controllers
- service discovery jika worker punya admin endpoint
- preventing rollout success before consumer initialized
```

Readiness worker bisa mencerminkan:

```text
- app context initialized
- broker connection established
- schema/config loaded
- downstream critical dependency available
- consumer assigned partition atau subscribed
```

Namun hati-hati:

```text
Jika readiness bergantung pada broker dan broker down, rollout bisa stuck.
Jika readiness terlalu longgar, Pod dianggap ready padahal belum consume.
```

---

### 6.3 Liveness untuk worker harus konservatif

Liveness bukan “semua dependency sehat”.

Liveness harus menjawab:

```text
Apakah process ini stuck secara internal sehingga restart mungkin memperbaiki?
```

Jangan membuat liveness gagal hanya karena:

```text
- Kafka sementara unavailable
- RabbitMQ overloaded
- database downstream timeout
- external API rate limited
```

Kalau semua replica direstart saat dependency down, outage bisa makin parah.

Pattern lebih aman:

```text
readiness false saat worker tidak boleh mengambil work
liveness true selama process loop masih sehat dan mampu recover
```

---

## 7. Kafka Consumer di Kubernetes

### 7.1 Mental model Kafka consumer group

Kafka consumer group membagi partition ke consumer members.

```text
Topic: orders
Partitions: 12
Consumer group: order-processor
Replicas: 6

Ideal:
  setiap Pod memegang sekitar 2 partitions
```

Jika replicas > partitions:

```text
sebagian consumer idle
```

Jika replicas < partitions:

```text
sebagian consumer memegang lebih dari satu partition
```

Kubernetes tidak tahu partition assignment. Kubernetes hanya tahu Pod.

---

### 7.2 Rollout menyebabkan rebalance

Saat Deployment rolling update:

```text
1. Pod baru dibuat
2. Pod lama dihentikan
3. consumer group membership berubah
4. Kafka rebalance
5. partition ownership berpindah
```

Jika rollout terlalu agresif:

```text
- banyak consumer keluar/masuk bersamaan
- rebalance berulang
- processing pause
- duplicate processing naik
- lag meningkat
```

Mitigasi:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 1
    maxSurge: 1
```

Tambahkan graceful shutdown:

```yaml
terminationGracePeriodSeconds: 90
```

Dan di aplikasi:

```text
- stop polling new records saat shutdown signal
- selesaikan in-flight records
- commit offset hanya setelah side effect sukses
- close consumer cleanly
```

---

### 7.3 Offset commit adalah correctness boundary

Pola buruk:

```text
poll message
commit offset
process business operation
```

Jika process gagal setelah commit:

```text
message hilang secara logical
```

Pola lebih aman:

```text
poll message
process business operation idempotently
commit offset setelah sukses
```

Jika process sukses tapi commit gagal:

```text
message bisa diproses ulang
```

Maka perlu:

```text
idempotency key
business deduplication
transactional outbox/inbox pattern jika relevan
```

Kubernetes restart memperbesar kemungkinan skenario ini.

---

### 7.4 Autoscaling Kafka consumer

Scaling by CPU sering tidak cukup.

Metrik lebih relevan:

```text
- consumer lag
- lag growth rate
- records per second
- processing latency
- partition count
- downstream saturation
```

Tetapi scaling consumer punya batas:

```text
max useful replicas <= partition count
```

Jika topic punya 12 partitions, scaling ke 50 replicas tidak meningkatkan throughput untuk satu consumer group.

Selain itu, scale up/down bisa menyebabkan rebalance storm.

Desain HPA/KEDA harus memperhatikan:

```text
- stabilization window
- cooldown period
- min replicas
- max replicas <= partition count atau sedikit di bawah
- rollout strategy
- rebalance protocol
- processing time per message
```

---

### 7.5 Kafka consumer shutdown checklist

Aplikasi Java harus menangani:

```text
SIGTERM diterima
consumer loop berhenti mengambil record baru
in-flight record selesai atau dicancel dengan aman
offset commit final dilakukan jika aman
consumer.close() dipanggil
app exit sebelum terminationGracePeriodSeconds habis
```

Jika tidak:

```text
kubelet mengirim SIGKILL
process mati mendadak
offset/side effect bisa berada di state ambigu
```

---

## 8. RabbitMQ Worker di Kubernetes

### 8.1 Mental model RabbitMQ consumer

RabbitMQ worker biasanya:

```text
connect ke queue
consume message
process
ack/nack/reject
```

Correctness boundary:

```text
ack setelah side effect aman
```

Jika ack terlalu awal:

```text
message bisa hilang saat process gagal
```

Jika ack setelah sukses:

```text
message bisa redelivered jika worker mati setelah side effect tapi sebelum ack
```

Maka tetap perlu idempotency.

---

### 8.2 Prefetch sebagai concurrency control

`prefetch` menentukan berapa message yang boleh dikirim broker ke consumer tanpa ack.

Jika prefetch terlalu tinggi:

```text
- satu Pod menahan banyak message
- shutdown lama
- redelivery besar saat Pod mati
- memory naik
- work distribution tidak merata
```

Jika prefetch terlalu rendah:

```text
- throughput rendah
- broker round-trip lebih sering
```

Di Kubernetes, prefetch harus disesuaikan dengan:

```text
- per-Pod thread pool
- processing latency
- termination grace period
- memory budget
- downstream capacity
```

Rule of thumb awal:

```text
prefetch ≈ concurrency per Pod
```

Bukan angka besar sembarangan.

---

### 8.3 HPA dan downstream overload

Jika HPA menaikkan replicas worker:

```text
replicas naik → total concurrent messages naik → DB/API downstream menerima load lebih besar
```

Jika downstream tidak mampu:

```text
worker timeout → nack/retry → queue churn → CPU naik → HPA scale up lagi → overload makin parah
```

Ini feedback loop buruk.

Harus ada:

```text
- max replicas realistis
- per-Pod concurrency limit
- backoff retry
- dead-letter queue
- circuit breaker
- downstream rate limit
- autoscaling metric yang tidak misleading
```

---

## 9. Redis Stream / Queue Worker di Kubernetes

Redis-based worker sering dipakai untuk job sederhana, tetapi punya risiko jika semantics tidak dipahami.

Pertanyaan desain:

```text
Apakah queue mendukung ack?
Apakah ada pending entries list?
Apakah message bisa diklaim ulang jika consumer mati?
Apakah ordering penting?
Apakah retry count disimpan?
Apakah poison message dipindahkan ke DLQ?
```

Kubernetes restart membuat consumer identity berubah, kecuali kamu mendesain identity eksplisit.

Untuk Redis Streams consumer group, pikirkan:

```text
- consumer name stabil atau ephemeral?
- pending message reclaim strategy
- idle timeout
- duplicate processing
- trimming policy
```

Jangan memperlakukan Redis list sederhana seperti durable broker enterprise kecuali risikonya diterima.

---

## 10. Idempotency: Fondasi Correctness Background Work

### 10.1 Definisi praktis

Idempotent berarti operasi bisa dijalankan lebih dari sekali tanpa menghasilkan efek berbeda dari sekali jalan.

Contoh idempotent:

```text
set status order_id=123 menjadi PROCESSED jika belum PROCESSED
insert dengan unique idempotency_key
PUT object ke path deterministik yang sama dengan content hash sama
upsert result berdasarkan business key
```

Contoh tidak idempotent:

```text
charge kartu kredit tanpa idempotency key
insert row baru tanpa unique constraint
append audit event tanpa deduplication ketika event merepresentasikan command yang sama
kirim email tanpa delivery deduplication
increment counter untuk message yang bisa retry
```

---

### 10.2 Idempotency key

Untuk message processing:

```text
idempotency_key = stable identifier untuk unit work
```

Bisa berasal dari:

```text
- message id
- business command id
- aggregate id + version
- external request id
- file name + row number
- tenant id + period
```

Simpan hasil processing:

```sql
CREATE TABLE processed_message (
    idempotency_key VARCHAR(200) PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL,
    result_status VARCHAR(50) NOT NULL
);
```

Pola:

```text
begin transaction
insert idempotency_key
if duplicate → skip atau return existing result
perform side effect/update
commit
ack/commit offset setelah commit
```

---

### 10.3 Idempotency bukan hanya anti-duplicate

Idempotency juga membantu:

```text
- retry Kubernetes Job
- Pod restart
- broker redelivery
- manual rerun
- disaster recovery replay
- backfill
- blue/green overlap
- CronJob accidental duplicate
```

Untuk regulated systems, idempotency juga bagian dari defensibility:

```text
Sistem bisa menjelaskan mengapa satu business action tidak dieksekusi dua kali walaupun infrastructure retry terjadi.
```

---

## 11. Checkpointing dan Partial Progress

Batch besar jarang aman jika diperlakukan sebagai satu transaksi raksasa.

Contoh batch:

```text
process 10 juta records
```

Jika gagal di record ke-8 juta, apakah restart dari awal?

Pilihan:

```text
1. Restart from beginning with idempotency
2. Checkpoint per chunk
3. Partition by shard/window
4. Write output as immutable intermediate files
5. Use workflow engine
```

Checkpoint harus menjawab:

```text
Apa posisi terakhir yang durable?
Apakah checkpoint ditulis sebelum atau setelah side effect?
Apakah replay dari checkpoint aman?
Apakah checkpoint corrupt bisa dideteksi?
```

Pattern:

```text
read chunk
process idempotently
write result
commit checkpoint
```

Tetapi jika commit checkpoint gagal setelah result write, chunk bisa diproses ulang. Maka result write harus idempotent.

---

## 12. Distributed Lock, Lease, and Singleton Workloads

### 12.1 `replicas: 1` bukan distributed lock

Deployment dengan `replicas: 1` mengurangi kemungkinan duplicate, tetapi tidak mendefinisikan business exclusivity yang kuat.

Skenario:

```text
Pod lama menerima SIGTERM tetapi masih berjalan selama grace period.
Pod baru sudah start.
Keduanya bisa menjalankan scheduler jika tidak ada lock.
```

Atau:

```text
Aplikasi lama freeze karena GC pause.
Liveness restart terjadi.
Pod baru muncul.
Pod lama mungkin sempat lanjut sebelum benar-benar mati.
```

Jika side effect harus singleton, gunakan lock/lease.

---

### 12.2 Kubernetes Lease

Kubernetes memiliki resource `Lease` yang bisa dipakai untuk leader election.

Mental model:

```text
candidate mencoba mengambil lease
leader memperbarui lease secara periodik
jika lease expired, candidate lain bisa mengambil
```

Cocok untuk:

```text
- controller leader election
- singleton coordinator
- scheduler leader
```

Tetapi tetap perlu mendesain:

```text
- lease duration
- renew deadline
- retry period
- clock assumptions
- what happens after leadership loss
```

Aplikasi yang kehilangan leadership harus berhenti melakukan side effect segera.

---

### 12.3 Database lock

Banyak Java system menggunakan DB lock:

```text
SELECT ... FOR UPDATE
advisory lock
lock table dengan expiry
ShedLock
```

Ini bisa valid jika DB adalah source of truth untuk job tersebut.

Tetapi hindari lock tanpa expiry. Jika Pod mati sambil memegang lock, job bisa stuck selamanya.

Lock harus punya:

```text
- owner identity
- acquired_at
- expires_at
- heartbeat/renewal
- fencing token jika side effect kritis
```

---

## 13. Graceful Shutdown untuk Worker

### 13.1 Lifecycle saat Pod dihentikan

Ketika Pod akan dihentikan:

```text
1. Pod mendapat deletion timestamp.
2. Endpoint readiness berubah / Pod mulai dihapus dari endpoint.
3. kubelet menjalankan preStop hook jika ada.
4. kubelet mengirim SIGTERM ke container.
5. aplikasi diberi waktu sampai terminationGracePeriodSeconds.
6. jika belum mati, SIGKILL dikirim.
```

Untuk worker, langkah penting ada di aplikasi:

```text
- stop accepting new work
- stop polling broker
- finish or safely abandon in-flight work
- ack/commit only if side effect complete
- release lease/lock
- close connections
- exit cleanly
```

---

### 13.2 Shutdown budget

Jangan set `terminationGracePeriodSeconds` asal.

Hitung:

```text
max message processing time
+ final ack/commit time
+ connection close time
+ safety buffer
```

Jika satu message bisa memakan 5 menit, tetapi grace period 30 detik, maka shutdown hampir pasti menghasilkan reprocessing atau partial work.

Jika grace period terlalu panjang, node drain dan rollout lambat.

Solusi:

```text
- batasi max processing time per unit work
- chunk long work
- checkpoint
- gunakan cancellation-aware processing
- jangan ambil work baru setelah SIGTERM
```

---

### 13.3 Spring Boot worker shutdown

Untuk Java/Spring Boot, pikirkan:

```text
- apakah JVM menerima SIGTERM dengan benar?
- apakah listener container stop gracefully?
- apakah executor menunggu task selesai?
- apakah task bisa di-cancel?
- apakah offset/ack dilakukan setelah commit business transaction?
- apakah shutdown timeout Spring < terminationGracePeriodSeconds?
```

Aplikasi harus punya shutdown ordering jelas:

```text
mark shuttingDown=true
stop polling/subscription
wait in-flight tasks
commit/ack completed work
close resources
exit
```

---

## 14. Autoscaling Event-Driven Workers

### 14.1 Scaling signal

Metrik scaling worker yang umum:

```text
- queue depth
- queue age
- consumer lag
- processing latency
- records/sec
- pending messages per consumer
- CPU
- memory
```

CPU sering sekunder. Queue depth bisa misleading jika downstream sedang rusak.

Contoh buruk:

```text
DB lambat → queue depth naik → HPA scale up worker → DB makin lambat
```

Metric yang lebih baik bisa menggabungkan:

```text
queue backlog
processing success rate
downstream error rate
downstream latency
max safe concurrency
```

Kubernetes HPA sendiri tidak memahami semua itu; kamu harus memilih metric dan batas dengan hati-hati.

---

### 14.2 KEDA-style event scaling

KEDA memungkinkan workload scale berdasarkan external/event metrics seperti queue length, Kafka lag, RabbitMQ queue depth, dan lain-lain.

Mental model:

```text
event source metric → scaler → desired replicas → HPA → Deployment scale
```

Tetapi KEDA bukan pengganti correctness.

KEDA bisa menjawab:

```text
Berapa banyak Pod sebaiknya aktif?
```

KEDA tidak menjawab:

```text
Apakah message processing idempotent?
Apakah downstream aman?
Apakah duplicate bisa diterima?
Apakah ordering tetap benar?
```

---

### 14.3 Scale-to-zero

Scale-to-zero menarik untuk cost.

Cocok untuk:

```text
- low-frequency queue
- non-latency-sensitive background job
- dev/test environments
```

Risiko:

```text
- cold start latency
- JVM warmup
- first message delay
- connection initialization spike
- readiness delay
```

Untuk Java worker, scale-to-zero harus mempertimbangkan:

```text
startup time
JIT warmup
classloading
connection pool initialization
broker session setup
```

---

## 15. Workload Pattern by Use Case

### 15.1 Email notification worker

Recommended shape:

```text
Deployment
RabbitMQ/queue consumer
idempotency by notification_id
retry with backoff
DLQ after max attempts
per-Pod concurrency limit
HPA by queue depth with max cap
```

Failure to handle:

```text
email provider timeout
duplicate send
poison message
provider rate limit
Pod shutdown mid-send
```

---

### 15.2 Kafka order processor

Recommended shape:

```text
Deployment
replicas <= partition count
rolling update maxUnavailable=1
idempotent processing by event_id or aggregate version
offset commit after DB transaction
consumer lag metric
terminationGracePeriodSeconds sufficient
```

Failure to handle:

```text
rebalance storm
duplicate event
poison event
schema incompatibility
slow downstream
```

---

### 15.3 Nightly reconciliation

Recommended shape:

```text
CronJob
concurrencyPolicy: Forbid
explicit timeZone
activeDeadlineSeconds
idempotent by reconciliation_period
checkpoint per chunk
business audit table
alert on missed/failed run
```

Failure to handle:

```text
previous run still active
run skipped
partial reconciliation
external system unavailable
manual rerun
```

---

### 15.4 One-time data backfill

Recommended shape:

```text
Job
completionMode: Indexed if sharded
parallelism capped by DB capacity
idempotent writes
checkpoint or shard result tracking
TTL after finished
centralized logs
```

Failure to handle:

```text
retry duplicate
partial result
DB overload
wrong input range
operator cancellation
```

---

### 15.5 Internal scheduler

Recommended shape:

```text
Deployment replicas=2 or 3
leader election via Lease or DB lock
only leader schedules work
followers standby
idempotent scheduled command creation
```

Failure to handle:

```text
leader crash
split leadership
clock skew
lock stuck
scheduler duplicate commands
```

---

## 16. Failure Mode Catalogue

### 16.1 Duplicate execution

Symptoms:

```text
- same invoice generated twice
- same email sent twice
- same event processed twice
- duplicate row inserted
```

Likely causes:

```text
- broker redelivery
- Job retry
- CronJob overlap
- manual rerun
- Pod killed after side effect before ack
```

Prevention:

```text
- idempotency key
- unique constraint
- upsert
- business state guard
- command/result table
```

---

### 16.2 Lost work

Symptoms:

```text
- message disappears but side effect absent
- offset advanced but DB not updated
- job marked success but output incomplete
```

Likely causes:

```text
- ack/commit before processing complete
- exit code 0 despite partial failure
- exception swallowed
- checkpoint advanced too early
```

Prevention:

```text
- commit offset/ack after durable side effect
- fail fast on partial failure
- validate output before success
- explicit result manifest
```

---

### 16.3 Retry storm

Symptoms:

```text
- CPU high
- broker queue churn
- downstream overloaded
- logs penuh error repeated
```

Likely causes:

```text
- immediate retry without backoff
- poison message
- dependency outage
- HPA scale up against failure metric
```

Prevention:

```text
- exponential backoff
- DLQ
- circuit breaker
- max retry
- rate limit
- HPA max cap
```

---

### 16.4 Rebalance storm

Symptoms:

```text
- Kafka lag naik saat rollout
- consumer repeatedly rejoin group
- processing pause
- duplicate processing meningkat
```

Likely causes:

```text
- rollout terlalu agresif
- HPA flapping
- liveness kills consumer
- long GC pause
- insufficient termination grace
```

Prevention:

```text
- maxUnavailable=1
- stabilization window
- conservative liveness
- tune JVM/resource
- graceful shutdown
```

---

### 16.5 CronJob missed schedule

Symptoms:

```text
- expected run tidak ada
- report tidak dibuat
- reconciliation period hilang
```

Likely causes:

```text
- startingDeadlineSeconds terlalu pendek
- controller unavailable
- concurrencyPolicy Forbid and previous job active
- schedule timezone salah
```

Prevention:

```text
- alert on missing run
- explicit timeZone
- activeDeadlineSeconds
- run ledger table
- catch-up logic if required
```

---

### 16.6 Job stuck forever

Symptoms:

```text
kubectl get job shows active for too long
Pod running but no progress
CronJob subsequent runs blocked
```

Likely causes:

```text
- no activeDeadlineSeconds
- application hang
- external dependency never times out
- infinite retry loop inside app
```

Prevention:

```text
- activeDeadlineSeconds
- application-level timeout
- watchdog metrics
- progress heartbeat
- liveness only if restart helps
```

---

## 17. Debugging Method

### 17.1 Debug Job

Commands:

```bash
kubectl get jobs -n <ns>
kubectl describe job <job-name> -n <ns>
kubectl get pods -n <ns> -l job-name=<job-name>
kubectl describe pod <pod-name> -n <ns>
kubectl logs <pod-name> -n <ns>
kubectl logs <pod-name> -n <ns> --previous
kubectl get events -n <ns> --sort-by=.lastTimestamp
```

Questions:

```text
Apakah Job active, succeeded, atau failed?
Berapa completions yang diharapkan?
Berapa Pod gagal?
Exit code apa?
Apakah gagal karena app, image, scheduling, resource, atau policy?
Apakah retry masih berjalan?
Apakah side effect partial sudah terjadi?
```

---

### 17.2 Debug CronJob

Commands:

```bash
kubectl get cronjobs -n <ns>
kubectl describe cronjob <cronjob-name> -n <ns>
kubectl get jobs -n <ns> --sort-by=.metadata.creationTimestamp
kubectl get events -n <ns> --sort-by=.lastTimestamp
```

Questions:

```text
Kapan lastScheduleTime?
Apakah suspend=true?
Apakah schedule benar?
Apakah timezone benar?
Apakah concurrencyPolicy menahan run baru?
Apakah previous Job masih active?
Apakah startingDeadlineSeconds menyebabkan missed run?
```

---

### 17.3 Debug worker Deployment

Commands:

```bash
kubectl get deploy <name> -n <ns>
kubectl rollout status deploy/<name> -n <ns>
kubectl describe deploy <name> -n <ns>
kubectl get pods -n <ns> -l app=<app>
kubectl logs deploy/<name> -n <ns>
kubectl top pods -n <ns>
```

Broker-side questions:

```text
Kafka:
  lag berapa?
  rebalance terjadi?
  partition count berapa?
  consumer group member berapa?

RabbitMQ:
  queue depth berapa?
  unacked messages berapa?
  redelivery rate berapa?
  DLQ naik?

Redis Stream:
  pending entries berapa?
  idle pending berapa lama?
  consumer count berapa?
```

Application questions:

```text
Apakah worker mengambil work?
Apakah processing berhasil?
Apakah ack/commit terjadi?
Apakah downstream error?
Apakah retry/backoff aktif?
Apakah shutdown terjadi cleanly?
```

---

## 18. Observability untuk Background Workload

Minimal metrics:

```text
work_processed_total
work_failed_total
work_retried_total
work_duplicate_total
work_processing_duration_seconds
work_inflight
worker_active_threads
worker_queue_lag_or_depth
worker_ack_latency
worker_shutdown_duration_seconds
job_last_success_timestamp
job_last_failure_timestamp
job_duration_seconds
```

Kafka-specific:

```text
consumer_lag
records_consumed_rate
commit_latency
rebalance_total
assigned_partitions
```

RabbitMQ-specific:

```text
queue_depth
unacked_messages
redelivered_total
dead_letter_total
consumer_count
```

CronJob-specific:

```text
last_scheduled_time
last_success_time
missed_run_total
run_duration
run_status
```

Logs harus memiliki:

```text
job_name
run_id
message_id
idempotency_key
partition/offset jika Kafka
queue/routing_key jika RabbitMQ
tenant_id jika multi-tenant
attempt_number
```

Tanpa identifier ini, debugging duplicate/lost processing hampir mustahil.

---

## 19. Production Manifest Patterns

### 19.1 Safe CronJob baseline

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-reconciliation
  labels:
    app.kubernetes.io/name: daily-reconciliation
    app.kubernetes.io/component: batch
spec:
  schedule: "0 2 * * *"
  timeZone: "Asia/Jakarta"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 1800
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 10
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 7200
      ttlSecondsAfterFinished: 604800
      template:
        spec:
          restartPolicy: Never
          terminationGracePeriodSeconds: 60
          containers:
            - name: reconciliation
              image: registry.example.com/reconciliation:1.4.2
              args:
                - "--period=yesterday"
              resources:
                requests:
                  cpu: "1"
                  memory: "1Gi"
                limits:
                  memory: "2Gi"
```

---

### 19.2 Kafka worker baseline

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-event-processor
  labels:
    app.kubernetes.io/name: order-event-processor
    app.kubernetes.io/component: worker
spec:
  replicas: 6
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: order-event-processor
  template:
    metadata:
      labels:
        app.kubernetes.io/name: order-event-processor
        app.kubernetes.io/component: worker
    spec:
      terminationGracePeriodSeconds: 90
      containers:
        - name: worker
          image: registry.example.com/order-event-processor:3.2.0
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: production
          ports:
            - name: management
              containerPort: 8081
          startupProbe:
            httpGet:
              path: /actuator/health/startup
              port: management
            failureThreshold: 30
            periodSeconds: 5
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: management
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: management
            periodSeconds: 20
            failureThreshold: 3
          resources:
            requests:
              cpu: "1"
              memory: "1Gi"
            limits:
              memory: "2Gi"
```

---

## 20. Design Review Checklist

Sebelum menjalankan background workload di Kubernetes, jawab pertanyaan ini.

### 20.1 Workload shape

```text
Apakah workload finite atau long-running?
Apakah harus scheduled?
Apakah harus singleton?
Apakah work bisa paralel?
Apakah ordering penting?
Apakah shard/partition ownership penting?
```

### 20.2 Correctness

```text
Apa unit work?
Apa idempotency key?
Apa yang terjadi jika work diproses dua kali?
Apa yang terjadi jika Pod mati setelah side effect tapi sebelum ack/commit?
Apa checkpoint durable?
Apakah manual rerun aman?
```

### 20.3 Lifecycle

```text
Bagaimana worker shutdown?
Berapa max in-flight work?
Apakah terminationGracePeriodSeconds cukup?
Apakah liveness terlalu agresif?
Apakah readiness merepresentasikan kemampuan mengambil work?
```

### 20.4 Retry

```text
Retry dilakukan oleh Kubernetes, broker, app, atau semuanya?
Apakah retry punya backoff?
Apakah ada max retry?
Apakah poison message masuk DLQ?
Apakah retry storm bisa terjadi?
```

### 20.5 Scaling

```text
Metric scaling apa?
Apakah max replicas realistis?
Apakah downstream mampu?
Apakah Kafka partition count membatasi scaling?
Apakah scale down aman?
Apakah HPA/KEDA cooldown cukup?
```

### 20.6 Observability

```text
Bisakah kita tahu job terakhir sukses kapan?
Bisakah kita tahu run mana yang gagal?
Bisakah kita tahu message mana duplicate?
Bisakah kita tahu lag/backlog?
Bisakah kita tahu shutdown clean atau SIGKILL?
```

---

## 21. Anti-Pattern

### Anti-pattern 1: CronJob tanpa idempotency

```text
Masalah:
  CronJob retry atau manual rerun membuat side effect ganda.

Solusi:
  Gunakan idempotency key berdasarkan period/run/business key.
```

---

### Anti-pattern 2: Worker ack sebelum processing selesai

```text
Masalah:
  Message hilang saat process gagal setelah ack.

Solusi:
  Ack/commit setelah durable side effect berhasil.
```

---

### Anti-pattern 3: HPA scale by queue depth tanpa downstream cap

```text
Masalah:
  Queue naik karena DB lambat, HPA menambah worker, DB makin overload.

Solusi:
  Max replicas, per-Pod concurrency, downstream-aware alerting, backoff.
```

---

### Anti-pattern 4: Kafka consumer replicas lebih besar dari partition count tanpa alasan

```text
Masalah:
  Pod idle, resource waste, rollout/rebalance complexity naik.

Solusi:
  Sesuaikan replicas dengan partition count dan throughput target.
```

---

### Anti-pattern 5: Liveness probe mengecek broker/downstream

```text
Masalah:
  Dependency down menyebabkan semua worker restart terus.

Solusi:
  Liveness cek internal process health; readiness/backpressure cek kemampuan mengambil work.
```

---

### Anti-pattern 6: Batch besar tanpa checkpoint

```text
Masalah:
  Gagal di akhir harus ulang dari awal atau menghasilkan partial inconsistent result.

Solusi:
  Chunking, checkpoint, idempotent write, result manifest.
```

---

### Anti-pattern 7: `replicas: 1` dianggap jaminan singleton

```text
Masalah:
  Duplicate scheduler bisa terjadi saat rollout/shutdown/partition.

Solusi:
  Leader election, Lease, DB lock dengan expiry, idempotent scheduling.
```

---

## 22. Latihan

### Latihan 1 — Design CronJob reconciliation

Desain CronJob untuk daily reconciliation dengan constraint:

```text
- harus jalan setiap pukul 02:00 Asia/Jakarta
- tidak boleh overlap
- jika gagal boleh retry maksimal 2 kali
- jika lebih dari 2 jam dianggap gagal
- manual rerun harus aman
- hasil harus audit-able
```

Tuliskan:

```text
- manifest CronJob
- idempotency key
- audit table
- alerting signal
- failure mode
```

---

### Latihan 2 — Kafka consumer rollout

Kamu punya topic dengan 24 partitions dan consumer Deployment 12 replicas.

Pertanyaan:

```text
- Berapa max replicas yang masuk akal?
- Bagaimana strategy rollout?
- Apa terminationGracePeriodSeconds awal yang kamu pilih?
- Apa metric HPA/KEDA?
- Bagaimana menghindari rebalance storm?
```

---

### Latihan 3 — RabbitMQ worker overload

Queue depth naik dari 1.000 ke 500.000. HPA menaikkan worker dari 5 ke 80. Database mulai timeout.

Analisis:

```text
- Apa feedback loop yang terjadi?
- Apa immediate mitigation?
- Apa design fix?
- Metric apa yang seharusnya dipakai?
```

---

### Latihan 4 — Duplicate email

User menerima email yang sama dua kali setelah rollout worker.

Investigasi:

```text
- Di mana kemungkinan duplicate terjadi?
- Apakah ack sebelum atau setelah send?
- Apakah email provider punya idempotency key?
- Apakah worker shutdown clean?
- Bagaimana mencegah ke depan?
```

---

## 23. Ringkasan

Background workload di Kubernetes bukan sekadar “jalankan container yang consume queue”. Ada tiga boundary yang harus dipahami:

```text
1. Kubernetes lifecycle boundary
   Pod, Job, CronJob, Deployment, restart, rollout, termination.

2. Broker/scheduler work boundary
   message, offset, ack, partition, queue, schedule, retry.

3. Business correctness boundary
   idempotency, transaction, checkpoint, audit, duplicate prevention.
```

Kubernetes sangat baik untuk menjaga compute tetap hidup, menjadwalkan job, melakukan retry, dan mengatur scaling. Tetapi Kubernetes tidak tahu apakah:

```text
- invoice sudah pernah dibuat
- email sudah pernah dikirim
- offset aman untuk commit
- settlement boleh diulang
- external API call idempotent
- batch partial result valid
```

Itu tanggung jawab desain aplikasi.

Untuk Java engineer, kemampuan top-tier bukan hanya bisa membuat `Deployment` atau `CronJob`, tetapi mampu menjawab:

```text
Apa yang terjadi jika Pod mati di titik terburuk?
Apa yang terjadi jika Job retry setelah side effect sukses sebagian?
Apa yang terjadi jika CronJob overlap?
Apa yang terjadi jika HPA scale up saat downstream rusak?
Apa yang terjadi jika Kafka rebalance saat rollout?
Apa bukti bahwa processing tidak hilang atau tergandakan secara berbahaya?
```

Jika kamu bisa menjawab pertanyaan tersebut dengan invariant, manifest, application logic, observability, dan runbook yang jelas, kamu tidak hanya “menjalankan worker di Kubernetes”; kamu sedang mendesain sistem event-driven yang operasional dan defensible.

---

## 24. Status Seri

```text
Seri belum selesai.
Part saat ini: 028 dari 035.
Part berikutnya: 029 — Java Microservices on Kubernetes: Production Runtime Blueprint.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Service Mesh and East-West Traffic Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-029.md">Part 029 — Java Microservices on Kubernetes: Production Runtime Blueprint ➡️</a>
</div>

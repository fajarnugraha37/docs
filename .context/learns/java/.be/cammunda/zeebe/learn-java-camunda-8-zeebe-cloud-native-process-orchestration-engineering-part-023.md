# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-023.md

# Part 023 — Performance Engineering: Throughput, Backpressure, Worker Tuning, and Capacity Planning

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Part: `023`  
> Level: Advanced / Production Engineering  
> Fokus: Camunda 8 / Zeebe performance engineering dari sudut Java backend engineer, platform engineer, dan solution architect.

---

## 0. Tujuan Part Ini

Bagian ini membahas performance engineering untuk Camunda 8/Zeebe.

Tujuannya bukan sekadar:

- menambah jumlah worker,
- menaikkan CPU broker,
- memperbesar Elasticsearch/OpenSearch,
- atau mengubah `maxJobsActive` sampai angka terlihat besar.

Targetnya adalah memahami **mekanika throughput end-to-end**:

```text
client command
  -> gateway
  -> broker leader
  -> partition stream
  -> state transition
  -> job creation
  -> job activation
  -> worker execution
  -> job completion/failure
  -> exporter
  -> secondary storage
  -> Operate/Tasklist/Optimize/read model
```

Di sistem Camunda 8, bottleneck bisa muncul di banyak tempat. Engineer yang hanya melihat worker sering salah diagnosis. Engineer yang hanya melihat broker juga salah diagnosis. Engineer yang hanya melihat Elasticsearch/OpenSearch juga bisa salah diagnosis.

Performance engineering Camunda 8 adalah kemampuan membaca **satu sistem aliran kerja terdistribusi**, bukan satu JVM.

---

## 1. Mental Model Utama: Throughput Zeebe Bukan Throughput Satu Service

Camunda 8/Zeebe adalah workflow engine terdistribusi. Ia memproses command melalui broker dan partition, lalu worker menjalankan side effect bisnis di luar broker.

Artinya, performa end-to-end terdiri dari beberapa lapisan:

1. **Command ingestion**
   - deploy process,
   - create process instance,
   - publish message,
   - complete job,
   - fail job,
   - resolve incident.

2. **Engine processing**
   - command divalidasi,
   - event ditulis,
   - state diubah,
   - follow-up command dibuat,
   - job dibuat,
   - timer/message subscription dibuat,
   - incident dibuat bila perlu.

3. **Job dispatch**
   - worker mengaktifkan job,
   - broker memberikan lease,
   - timeout mulai dihitung,
   - payload variable dikirim ke worker.

4. **Worker execution**
   - Java code memproses job,
   - melakukan DB/API/file/cache call,
   - validasi contract,
   - menulis idempotency/outbox,
   - menyelesaikan job.

5. **Read projection**
   - exporter mengirim record,
   - Operate/Tasklist/Optimize mengimpor projection,
   - UI/read API memperlihatkan state yang sudah diproyeksikan.

Sehingga throughput sistem bukan hanya:

```text
berapa job per second yang bisa diambil worker?
```

Tetapi:

```text
berapa process transition per second yang bisa diproses stabil
tanpa backlog, incident storm, projection lag, retry amplification,
dan downstream saturation?
```

---

## 2. Apa Itu “Performance” dalam Camunda 8?

Performance harus diukur sebagai beberapa metrik berbeda.

### 2.1 Command Throughput

Contoh:

- process instances created per second,
- messages published per second,
- jobs completed per second,
- jobs failed per second,
- incidents resolved per second.

Ini mengukur beban masuk ke engine.

### 2.2 Workflow Progress Throughput

Contoh:

- process instances completed per minute,
- tasks completed per minute,
- approvals completed per hour,
- cases moved to next state per day.

Ini lebih dekat ke business throughput.

### 2.3 Worker Throughput

Contoh:

- job activations per second,
- job completions per second,
- worker handler latency,
- worker queue depth,
- active jobs per worker.

Ini mengukur kemampuan Java worker menyerap pekerjaan.

### 2.4 Engine Latency

Contoh:

- create process instance command latency,
- complete job command latency,
- publish message command latency,
- job activation latency,
- stream processor latency.

Ini mengukur seberapa cepat command diproses engine.

### 2.5 End-to-End Latency

Contoh:

```text
application submitted
  -> review task created
  -> officer completes task
  -> external verification done
  -> final decision issued
```

Ini menggabungkan engine, worker, human task, external dependency, dan business rules.

### 2.6 Projection Latency

Contoh:

- event sudah terjadi di Zeebe, tetapi belum terlihat di Operate,
- user task sudah dibuat, tetapi belum muncul di Tasklist,
- Optimize report belum mencerminkan state terbaru,
- custom audit read model tertinggal.

Projection latency tidak selalu berarti engine lambat. Bisa jadi exporter, secondary storage, importer, atau query layer yang tertinggal.

### 2.7 Stability Under Load

Performance yang sehat bukan hanya tinggi saat benchmark pendek. Sistem harus stabil ketika:

- traffic naik perlahan,
- traffic spike,
- downstream lambat,
- worker restart,
- broker leader election,
- exporter lag,
- long-running process menumpuk,
- incident massal terjadi.

---

## 3. Performance Equation: Throughput Terendah Menentukan Sistem

Secara kasar:

```text
effective_workflow_throughput =
  min(
    client_command_capacity,
    gateway_capacity,
    broker_partition_capacity,
    exporter_capacity_if_export_required_for_visibility,
    worker_activation_capacity,
    worker_business_execution_capacity,
    downstream_system_capacity,
    secondary_storage_capacity_for_read_side
  )
```

Ini bukan rumus matematis presisi, tetapi mental model.

Jika external API hanya mampu 50 request/sec, maka menambah worker sampai 500 job/sec hanya membuat:

- timeout meningkat,
- retry meningkat,
- incident meningkat,
- external API makin overload,
- broker menerima lebih banyak fail/complete command,
- Operate penuh incident,
- business SLA memburuk.

Top 1% engineer tidak bertanya:

```text
Bagaimana menaikkan maxJobsActive?
```

Mereka bertanya:

```text
Bottleneck aktual di mana?
Apa resource yang saturasi?
Apakah bottleneck itu sehat sebagai flow control?
Apakah menaikkan throughput akan merusak downstream?
Apa efeknya ke retry, timeout, incident, dan projection lag?
```

---

## 4. Bottleneck Surface di Camunda 8

### 4.1 Client-Side Bottleneck

Client bisa menjadi bottleneck jika:

- koneksi tidak reusable,
- client dibuat per request,
- thread pool kecil,
- timeout terlalu pendek,
- retry client terlalu agresif,
- command dikirim sinkron berlebihan,
- serialization payload berat,
- network ke gateway lambat.

Anti-pattern:

```java
public void startProcess(Order order) {
    try (ZeebeClient client = newClient()) {
        client.newCreateInstanceCommand()
              .bpmnProcessId("order-process")
              .latestVersion()
              .variables(order)
              .send()
              .join();
    }
}
```

Masalah:

- membuat client berulang,
- connection pool tidak efektif,
- TLS/auth handshake berulang,
- sulit mengatur backpressure,
- shutdown tidak rapi.

Better:

```java
@Component
public final class ProcessStarter {

    private final CamundaClient camundaClient;

    public ProcessStarter(CamundaClient camundaClient) {
        this.camundaClient = camundaClient;
    }

    public void startOrderProcess(StartOrderCommand command) {
        camundaClient
            .newCreateInstanceCommand()
            .bpmnProcessId("order-process")
            .latestVersion()
            .variables(command.toVariables())
            .send()
            .join();
    }
}
```

Client harus dianggap expensive shared infrastructure object, bukan disposable helper.

---

### 4.2 Gateway Bottleneck

Gateway adalah entry point stateless yang meneruskan request ke broker.

Gejala gateway bottleneck:

- command latency naik,
- client timeout meningkat,
- job activation lambat,
- CPU gateway tinggi,
- network gateway tinggi,
- error meningkat saat client traffic tinggi,
- broker relatif sehat tetapi gateway penuh.

Penyebab umum:

- terlalu sedikit gateway replica,
- gateway dan broker colocated padahal traffic besar,
- TLS termination berat,
- network latency,
- ingress/proxy bottleneck,
- client connection storm,
- bad load balancing.

Strategi:

- tambah gateway replica,
- pisahkan gateway dari broker untuk cluster besar,
- pakai connection reuse,
- audit ingress/proxy timeout,
- gunakan autoscaling dengan hati-hati,
- jangan menjadikan gateway sebagai tempat business logic.

---

### 4.3 Broker/Partition Bottleneck

Broker memproses stream state. Partition adalah unit ordered processing.

Gejala partition/broker bottleneck:

- command rejected karena backpressure,
- process instance progress lambat,
- job creation lambat,
- incidents muncul terlambat,
- CPU broker tinggi,
- disk I/O tinggi,
- RocksDB pressure,
- exporter backlog,
- partition leader tertentu lebih panas.

Penyebab umum:

- partition count kurang untuk workload,
- satu process/job type menghasilkan hot partition,
- payload variable terlalu besar,
- process model terlalu chatty,
- terlalu banyak intermediate state,
- retry storm,
- batch create instance tanpa throttling,
- exporter lambat menahan progress tertentu.

Penting:

- menambah worker tidak menyelesaikan broker bottleneck jika broker tidak mampu memproses job completion command.
- menambah broker belum tentu menaikkan throughput jika partition count tidak mendukung distribusi workload.
- menambah partition harus dipahami sebagai keputusan arsitektural, bukan toggle ringan.

---

### 4.4 Exporter Bottleneck

Exporter mengirim record keluar dari broker ke secondary storage atau read model.

Gejala exporter bottleneck:

- Operate/Tasklist/Optimize tertinggal,
- visibility delay,
- index write latency tinggi,
- broker disk/log pressure,
- exporter metrics menunjukkan backlog,
- process actually progresses tetapi UI/read side tertinggal.

Penyebab umum:

- Elasticsearch/OpenSearch lambat,
- terlalu banyak variable diexport,
- payload besar,
- retention/ILM buruk,
- index shard/replica tidak sesuai,
- storage IOPS rendah,
- network latency ke storage,
- custom exporter lambat.

Kritikal:

```text
Operate/Tasklist lag tidak selalu berarti process stuck.
Engine state dan read projection adalah dua hal berbeda.
```

---

### 4.5 Secondary Storage Bottleneck

Operate, Tasklist, Optimize, dan API pencarian bergantung pada secondary storage.

Gejala:

- Operate lambat,
- Tasklist search lambat,
- dashboard Optimize lambat,
- import lag,
- index growth tinggi,
- memory pressure storage,
- high GC di Elasticsearch/OpenSearch,
- disk watermark.

Penyebab:

- retention tidak dikonfigurasi,
- variable object besar,
- terlalu banyak indexed field,
- query berat,
- shard terlalu banyak/kecil,
- storage disk lambat,
- multi-component sharing tidak direncanakan.

Prinsip:

```text
Secondary storage adalah read-side performance domain.
Jangan campur aduk diagnosis read-side lag dengan engine progress tanpa bukti.
```

---

### 4.6 Worker Bottleneck

Worker bottleneck terjadi jika engine sudah membuat job, tetapi worker tidak menyelesaikannya cukup cepat.

Gejala:

- banyak activated job lama,
- job timeout,
- job retry meningkat,
- external call latency tinggi,
- worker CPU tinggi,
- worker memory tinggi,
- worker thread pool penuh,
- downstream queue penuh,
- job activation rate rendah padahal banyak job available.

Penyebab:

- worker terlalu sedikit,
- handler lambat,
- blocking I/O tidak dikontrol,
- connection pool DB/API kecil,
- maxJobsActive terlalu kecil/besar,
- timeout tidak realistis,
- payload terlalu besar,
- serialization lambat,
- lock contention,
- GC pressure,
- downstream throttling.

---

### 4.7 Downstream Bottleneck

Ini bottleneck paling sering disamarkan sebagai “Camunda lambat”.

Contoh downstream:

- database service,
- Oracle/PostgreSQL/MySQL,
- REST API,
- SOAP service,
- object storage,
- payment gateway,
- document service,
- identity service,
- email/SMS gateway,
- rules engine,
- OCR service.

Gejala:

- worker latency naik,
- job failure meningkat,
- timeout meningkat,
- retries menyebabkan avalanche,
- external system rate limit,
- DB connection pool exhausted,
- HTTP 429/503 meningkat.

Solusi bukan langsung menambah worker. Solusi bisa berupa:

- bulkhead,
- rate limiter,
- circuit breaker,
- queue,
- worker concurrency cap,
- outbox,
- scheduled drain,
- backoff,
- BPMN timer retry,
- downstream capacity increase,
- contract redesign.

---

## 5. Backpressure: Sinyal Sehat, Bukan Sekadar Error

Backpressure adalah mekanisme agar sistem tidak menerima lebih banyak request daripada yang dapat diproses dengan latency yang dapat diterima.

Jika broker menerima command lebih cepat daripada bisa memprosesnya, sistem perlu menolak sebagian request daripada:

- memory habis,
- disk backlog tidak terkendali,
- latency makin buruk,
- recovery makin lama,
- cluster jatuh total.

Jadi backpressure adalah **protection mechanism**.

### 5.1 Salah Paham Umum

Salah:

```text
Backpressure berarti Camunda rusak.
```

Lebih tepat:

```text
Backpressure berarti sistem memberi tahu bahwa input rate lebih besar
daripada processing capacity saat itu.
```

Salah:

```text
Kalau ada backpressure, retry lebih cepat.
```

Lebih tepat:

```text
Kalau ada backpressure, retry harus lebih hati-hati, jittered,
dan menghormati capacity.
```

Salah:

```text
Naikkan semua limit agar backpressure hilang.
```

Lebih tepat:

```text
Cari bottleneck dan kurangi amplification.
```

---

## 6. Retry Amplification: Pembunuh Performance yang Diam-Diam

Retry terlihat aman dalam skala kecil. Dalam sistem workflow, retry bisa menjadi multiplier.

Misal:

```text
1000 job gagal karena external API down
retries = 5
setiap retry memanggil API lagi
```

Total potential calls:

```text
1000 original + 5000 retries = 6000 attempts
```

Jika external API sedang down, ini memperburuk incident.

### 6.1 Retry Storm Pattern

```text
external system slows down
  -> worker calls timeout
  -> job failed with retry
  -> Zeebe reschedules job
  -> more workers pick jobs
  -> more calls hit external system
  -> external system slower
  -> timeout more
  -> retries explode
```

### 6.2 Mitigation

Gunakan:

- retry budget,
- exponential backoff,
- jitter,
- circuit breaker,
- BPMN timer for long wait,
- non-retryable BPMN error untuk business failure,
- incident untuk poison job,
- downstream rate limiter,
- operational kill switch,
- worker-level concurrency cap.

Contoh fail job dengan retry backoff:

```java
client.newFailCommand(job.getKey())
    .retries(job.getRetries() - 1)
    .retryBackoff(Duration.ofMinutes(5))
    .errorMessage("External verification service unavailable")
    .send()
    .join();
```

Tetapi jangan menjadikan retry backoff sebagai pengganti desain SLA. Untuk outage panjang, BPMN timer + escalation sering lebih jelas secara operasional.

---

## 7. Worker Tuning: Parameter yang Sering Disalahgunakan

### 7.1 `maxJobsActive`

`maxJobsActive` adalah jumlah maksimum job aktif yang dapat dipegang worker.

Jika terlalu kecil:

- worker idle,
- throughput rendah,
- network round-trip lebih dominan.

Jika terlalu besar:

- worker mengambil terlalu banyak job,
- memory pressure,
- job timeout,
- unfair distribution,
- downstream overload,
- shutdown sulit drain,
- duplicate execution risk meningkat saat crash.

Mental model:

```text
maxJobsActive = in-flight lease capacity, bukan thread count.
```

Jika handler lambat dan `maxJobsActive` terlalu besar, worker dapat memegang banyak job tetapi tidak memprosesnya cukup cepat. Job timeout lalu job bisa diambil worker lain.

---

### 7.2 Worker Thread/Concurrency

Thread count mengatur berapa banyak job yang diproses bersamaan di worker application.

Untuk I/O-bound:

```text
concurrency bisa lebih tinggi daripada CPU core,
tetapi dibatasi connection pool dan downstream rate limit.
```

Untuk CPU-bound:

```text
concurrency biasanya mendekati jumlah core efektif.
```

Untuk blocking DB:

```text
concurrency tidak boleh melebihi kapasitas DB pool secara brutal.
```

Rule awal:

```text
worker_concurrency <= min(
  DB_pool_available_for_worker,
  HTTP_pool_available_for_worker,
  downstream_rate_limit_window,
  memory_capacity_for_payload,
  CPU_capacity_for_handler
)
```

---

### 7.3 Job Timeout

Job timeout adalah lease duration.

Salah:

```text
timeout = berapa lama saya mau retry
```

Benar:

```text
timeout = berapa lama broker menganggap worker masih berhak menyelesaikan job ini
```

Jika timeout terlalu pendek:

- job bisa dieksekusi ulang,
- duplicate side effect meningkat,
- worker pertama masih jalan tetapi lease expired,
- complete command bisa gagal atau tidak berlaku.

Jika timeout terlalu panjang:

- job lama tertahan jika worker crash,
- recovery lambat,
- SLA repair tertunda.

Design:

```text
job timeout > p99 handler latency + network margin + downstream margin
```

Tetapi jangan terlalu panjang. Untuk long-running external operation, lebih baik:

1. start operation,
2. persist external reference,
3. complete job,
4. wait for callback/message,
5. handle timeout via BPMN timer.

---

### 7.4 Poll Interval / Streaming

Worker activation bisa polling atau streaming tergantung client/config.

Streaming mengurangi latency job dispatch, tetapi tetap harus dikontrol dengan active job limit dan memory discipline.

Untuk workload bursty:

- streaming dapat memberi respons lebih cepat,
- `maxJobsActive` harus realistis,
- shutdown/drain harus disiapkan.

Untuk workload yang low-volume:

- polling interval tidak masalah,
- jangan over-optimize.

---

### 7.5 Variable Fetch Strategy

Worker tidak selalu butuh semua variable.

Bad:

```java
@JobWorker(type = "verify-applicant")
public void handle(ActivatedJob job) {
    Map<String, Object> all = job.getVariablesAsMap();
}
```

Better:

```java
@JobWorker(
    type = "verify-applicant",
    fetchVariables = {"applicationId", "applicantId", "verificationRequestId"}
)
public void handle(ActivatedJob job) {
    VerificationInput input = job.getVariablesAsType(VerificationInput.class);
}
```

Manfaat:

- payload lebih kecil,
- serialization lebih cepat,
- memory lebih rendah,
- network lebih ringan,
- log lebih aman,
- PII exposure lebih rendah.

---

## 8. Estimasi Worker Capacity

Gunakan Little's Law sebagai mental model:

```text
concurrency ≈ throughput * latency
```

Jika target:

```text
throughput = 100 jobs/sec
average handler latency = 200 ms = 0.2 sec
```

Maka concurrency minimal:

```text
100 * 0.2 = 20 concurrent executions
```

Tetapi gunakan p95/p99, bukan average, untuk production sizing.

Jika p95 = 1.2 sec:

```text
100 * 1.2 = 120 concurrent executions
```

Ini angka besar. Pertanyaan berikutnya:

- DB pool cukup?
- HTTP pool cukup?
- downstream rate limit cukup?
- memory cukup?
- broker mampu menerima completion rate?
- exporter mampu mengejar?
- apakah business SLA benar-benar butuh 100/sec?

---

## 9. Worker Sizing by Workload Type

### 9.1 CPU-Bound Worker

Contoh:

- document transformation,
- local rules evaluation berat,
- cryptographic signing,
- image/PDF processing,
- large JSON diff.

Strategy:

- concurrency mendekati CPU core,
- hindari terlalu banyak blocking,
- isolate worker deployment,
- gunakan dedicated node pool jika perlu,
- ukur CPU throttling di Kubernetes,
- pertimbangkan offloading ke dedicated processing service.

### 9.2 I/O-Bound Worker

Contoh:

- REST call,
- DB query,
- S3/object storage,
- email gateway.

Strategy:

- concurrency lebih tinggi,
- connection pool harus cukup,
- rate limit downstream,
- timeout pendek tapi realistis,
- circuit breaker,
- idempotency wajib.

### 9.3 Human-Adjacent Worker

Contoh:

- create task metadata,
- assign reviewer,
- send notification,
- check SLA.

Strategy:

- jangan over-parallelize tanpa business need,
- auditability lebih penting daripada raw throughput,
- variable discipline,
- event log clarity.

### 9.4 Batch/Fan-Out Worker

Contoh:

- create 10,000 verification requests,
- process many records,
- generate per-item tasks.

Strategy:

- chunking,
- multi-instance caution,
- rate limiter,
- external queue when needed,
- avoid single process instance with massive local variables.

---

## 10. Process Model Performance

Performance tidak hanya di infra. BPMN model bisa membuat sistem cepat atau lambat.

### 10.1 Chatty BPMN

Bad:

```text
Service Task: load application
Service Task: load applicant
Service Task: load documents
Service Task: validate age
Service Task: validate address
Service Task: validate license
Service Task: save validation result
```

Jika semua itu internal domain logic dalam satu bounded context, model terlalu chatty.

Better:

```text
Service Task: perform application eligibility assessment
```

Dengan sub-result disimpan di domain DB/audit log, bukan semua dijadikan flow node.

### 10.2 Over-Large Service Task

Sebaliknya, terlalu besar juga buruk:

```text
Service Task: process entire application lifecycle
```

Ini menyembunyikan:

- wait state,
- retries,
- human boundary,
- escalation,
- audit milestone,
- external dependency.

Good granularity adalah milestone yang:

- operationally meaningful,
- independently retryable,
- auditable,
- has clear business ownership,
- has clear side-effect boundary.

---

## 11. Payload Size dan Serialization Cost

Variable payload mempengaruhi:

- client serialization,
- gateway network,
- broker processing,
- state storage,
- exporter throughput,
- secondary storage indexing,
- Operate/Tasklist variable viewing,
- Optimize import,
- worker memory.

Bad pattern:

```json
{
  "application": {
    "id": "APP-001",
    "documents": [
      {
        "fileName": "passport.pdf",
        "base64": "...."
      }
    ],
    "fullHistory": [...],
    "largeFormSnapshot": {...}
  }
}
```

Better:

```json
{
  "applicationId": "APP-001",
  "documentBundleId": "DOCB-991",
  "assessmentVersion": 3,
  "riskBand": "MEDIUM"
}
```

Principle:

```text
Camunda variables should carry orchestration context,
not become your application database.
```

---

## 12. Partition Scaling and Throughput

Partition adalah lane ordered processing. Lebih banyak partition dapat meningkatkan parallelism engine, tetapi tidak gratis.

### 12.1 Kapan Partition Membantu?

Partition membantu jika:

- workload command tinggi,
- broker memiliki cukup CPU,
- process instances banyak dan bisa tersebar,
- bottleneck ada di stream processing,
- exporter/storage bisa ikut mengejar,
- workers dan downstream juga cukup.

### 12.2 Kapan Partition Tidak Membantu?

Partition tidak membantu jika bottleneck adalah:

- worker lambat,
- external API lambat,
- DB pool habis,
- payload terlalu besar,
- Elasticsearch/OpenSearch lambat,
- gateway bottleneck,
- process model terlalu chatty,
- incident storm.

### 12.3 Partition Count sebagai Keputusan Arsitektural

Pertanyaan sebelum menaikkan partition count:

1. Apakah CPU broker belum termanfaatkan?
2. Apakah partition leader merata?
3. Apakah exporter mampu menangani record lebih banyak?
4. Apakah secondary storage siap?
5. Apakah worker throughput cukup?
6. Apakah workload process instance akan tersebar?
7. Apakah operational complexity diterima?
8. Apakah restore/recovery time masih masuk RTO?

---

## 13. Broker Resource Planning

Broker memerlukan:

- CPU untuk stream processing,
- memory untuk state/cache,
- disk untuk log/RocksDB/snapshot,
- network untuk replication/gateway/exporter,
- stable storage latency.

### 13.1 CPU

CPU tinggi bisa berarti:

- command rate tinggi,
- serialization/deserialization,
- stream processing,
- exporter work,
- Raft replication,
- RocksDB compaction,
- incident/retry storm.

CPU rendah tidak selalu sehat jika:

- system blocked on disk I/O,
- backpressure dari exporter,
- network stuck,
- worker/downstream bottleneck.

### 13.2 Memory

Memory digunakan untuk:

- JVM heap,
- off-heap/native,
- RocksDB,
- buffers,
- caches,
- export queues.

Jika memory pressure:

- GC pause naik,
- RocksDB performance turun,
- latency naik,
- broker instability.

### 13.3 Disk

Disk sangat penting. Workflow engine durable butuh write path stabil.

Disk bottleneck menyebabkan:

- command latency,
- snapshot slow,
- compaction issue,
- recovery slow,
- exporter backlog.

Di Kubernetes, jangan asal memakai storage class murah untuk broker. Storage latency buruk bisa lebih merusak daripada CPU kurang.

---

## 14. Exporter dan Secondary Storage Capacity

Jika engine memproses 10,000 records/sec tetapi storage hanya menerima 3,000 records/sec, read side akan tertinggal.

### 14.1 Export Volume

Export volume dipengaruhi:

- jumlah process instances,
- jumlah flow nodes,
- jumlah job events,
- jumlah variable updates,
- retry/failure events,
- incidents,
- message/timer records,
- user task records.

Process model yang chatty menghasilkan lebih banyak records.

### 14.2 Variable Export

Variables besar memperbesar:

- exporter payload,
- index storage,
- import time,
- query time,
- dashboard cost.

Untuk Optimize/read model, jangan export semua variable jika tidak perlu. Gunakan governance variable.

### 14.3 Retention

Tanpa retention:

- index tumbuh terus,
- query melambat,
- storage mahal,
- maintenance sulit,
- backup/restore berat.

Retention harus disesuaikan dengan:

- audit requirement,
- regulatory retention,
- operational troubleshooting window,
- reporting needs,
- cost.

---

## 15. Capacity Planning Framework

### Step 1 — Definisikan Workload

Contoh:

```text
Daily volume:
- 200,000 applications/day
- 3 service tasks per application
- 2 user tasks per application
- 1 external verification callback
- 5% retry rate
- 1% incidents
```

Hitung rough events:

```text
process instance creation        200,000
service task jobs                600,000
job completions                  600,000
user tasks                       400,000
messages                         200,000
retry additional jobs             30,000
incidents                          6,000
```

Ini masih business-level. Zeebe internal records lebih banyak daripada angka ini.

### Step 2 — Tentukan Peak Factor

Daily average menipu.

Jika 200,000/day:

```text
average = 2.31/sec
```

Tetapi jika traffic terkonsentrasi 4 jam:

```text
200,000 / (4 * 3600) = 13.9/sec
```

Jika peak factor 5x:

```text
~70/sec
```

### Step 3 — Hitung Worker Capacity

Untuk setiap job type:

| Job Type | Volume Peak | p95 Latency | Needed Concurrency |
|---|---:|---:|---:|
| verify-applicant | 50/sec | 800ms | 40 |
| create-document | 20/sec | 2s | 40 |
| send-notification | 100/sec | 100ms | 10 |
| risk-score | 30/sec | 500ms | 15 |

Tambahkan buffer, tetapi jangan melampaui downstream.

### Step 4 — Cek Downstream Capacity

| Downstream | Capacity | Required | Status |
|---|---:|---:|---|
| Verification API | 60/sec | 50/sec | OK, little headroom |
| Document service | 15/sec | 20/sec | Bottleneck |
| Notification gateway | 200/sec | 100/sec | OK |
| Risk engine | 25/sec | 30/sec | Bottleneck |

Jika downstream bottleneck, worker tuning tidak menyelesaikan masalah.

### Step 5 — Cek Engine/Partition/Exporter

Pertanyaan:

- Berapa process instance/sec?
- Berapa job completion/sec?
- Berapa message/sec?
- Berapa variable update/sec?
- Berapa exported record/sec?
- Berapa projection lag yang diterima?
- Berapa retention?

### Step 6 — Load Test Bertahap

Jangan langsung test full peak. Gunakan:

1. baseline single process,
2. dummy worker,
3. real worker without downstream,
4. real worker with mocked latency,
5. real downstream staging,
6. failure injection,
7. soak test,
8. recovery test.

---

## 16. Load Testing Methodology

### 16.1 Isolate Engine First

Gunakan BPMN yang sama tetapi worker dummy.

Tujuan:

- mengukur engine/gateway/broker/partition/exporter capacity,
- menghilangkan noise downstream,
- menentukan apakah bottleneck di engine atau worker.

Dummy worker:

```java
@JobWorker(type = "verify-applicant")
public Map<String, Object> verify(ActivatedJob job) throws InterruptedException {
    Thread.sleep(200); // simulate expected latency
    return Map.of("verificationStatus", "PASSED");
}
```

### 16.2 Test Worker Separately

Benchmark handler worker tanpa Zeebe:

- DB call latency,
- HTTP call latency,
- serialization,
- validation,
- mapper,
- idempotency check,
- transaction time.

### 16.3 Test End-to-End

Setelah engine dan worker baseline diketahui, gabungkan.

Metrik:

- process completion/sec,
- job activation/sec,
- job completion/sec,
- p50/p95/p99 command latency,
- incidents,
- retries,
- worker active jobs,
- queue/backlog,
- exporter lag,
- Operate visibility lag,
- CPU/memory/disk/network each component.

### 16.4 Soak Test

Jalankan lama:

- 2 jam,
- 8 jam,
- 24 jam,
- sesuai criticality.

Soak test menemukan:

- memory leak,
- index growth,
- GC degradation,
- connection leak,
- retry accumulation,
- exporter lag accumulation,
- DB pool exhaustion,
- slow compaction.

---

## 17. Metrics yang Harus Dipantau

### 17.1 Engine Metrics

Pantau:

- command rate,
- command latency,
- rejected command/backpressure,
- stream processor latency,
- partition health,
- broker CPU/memory,
- disk usage,
- disk I/O latency,
- snapshot metrics,
- replication health.

### 17.2 Worker Metrics

Pantau per job type:

- activated jobs,
- completed jobs,
- failed jobs,
- BPMN errors,
- handler latency p50/p95/p99,
- active jobs,
- timeout count,
- retry count,
- incident creation count,
- downstream latency,
- idempotency duplicate hit,
- DB pool usage,
- HTTP pool usage,
- thread pool queue.

### 17.3 Exporter/Projection Metrics

Pantau:

- exported records/sec,
- exporter lag,
- exporter failure,
- secondary storage write latency,
- Operate import lag,
- Tasklist import lag,
- Optimize import lag,
- index size,
- shard health.

### 17.4 Business Metrics

Pantau:

- case started,
- case completed,
- SLA breached,
- review pending,
- escalation created,
- retry rate per external dependency,
- stuck at flow node,
- pending human task count.

---

## 18. Worker Tuning Recipe

### 18.1 Initial Safe Configuration

Misal untuk I/O-bound worker:

```yaml
camunda:
  client:
    worker:
      defaults:
        max-jobs-active: 32
        timeout: PT2M
        poll-interval: PT1S
```

Per worker:

```java
@JobWorker(
    type = "external-verification",
    maxJobsActive = 32,
    timeout = 120000,
    fetchVariables = {"applicationId", "verificationRequestId"}
)
public void handle(ActivatedJob job) {
    // ...
}
```

Catatan:

- angka ini bukan universal,
- mulai konservatif,
- ukur,
- naikkan bertahap.

### 18.2 Tuning Loop

```text
increase maxJobsActive/concurrency
  -> observe worker p95/p99 latency
  -> observe timeout/retry
  -> observe downstream saturation
  -> observe broker completion latency
  -> observe exporter lag
  -> repeat
```

Jangan hanya melihat throughput naik. Lihat apakah tail latency dan retry juga naik.

### 18.3 Stop Condition

Berhenti menaikkan concurrency jika:

- p95/p99 latency memburuk tajam,
- retry meningkat,
- downstream 429/503 meningkat,
- DB pool penuh,
- job timeout muncul,
- CPU throttling tinggi,
- GC pause naik,
- completion command latency naik,
- exporter lag tumbuh terus.

---

## 19. Kubernetes Performance Concerns

### 19.1 CPU Requests and Limits

Jika worker CPU-bound tetapi CPU limit rendah:

- throttling,
- latency naik,
- job timeout,
- false retry.

Untuk broker, CPU throttling bisa sangat merusak latency.

### 19.2 Memory Limits

Jika memory terlalu kecil:

- worker OOM,
- broker instability,
- Elasticsearch/OpenSearch pressure,
- JVM GC aggressive.

### 19.3 Pod Placement

Pertimbangkan:

- broker spread across nodes/zones,
- storage locality,
- gateway replica distribution,
- worker deployment separation,
- anti-affinity,
- noisy neighbor risk.

### 19.4 HPA untuk Worker

HPA worker bisa membantu, tetapi jangan autoscale hanya berdasarkan CPU.

Lebih baik gunakan kombinasi:

- CPU,
- active jobs,
- job backlog,
- handler latency,
- downstream availability,
- queue depth,
- business backlog.

Autoscale berbahaya jika downstream sedang down. Ia bisa memperbesar retry storm.

---

## 20. Performance Anti-Patterns

### 20.1 “Tambah Worker Pasti Lebih Cepat”

Tidak jika bottleneck downstream, broker, exporter, atau DB.

### 20.2 `maxJobsActive` Besar Tanpa Memory Calculation

Jika job payload besar:

```text
maxJobsActive * payload_size
```

bisa sangat besar.

### 20.3 Timeout Terlalu Pendek

Menyebabkan duplicate execution.

### 20.4 Infinite Retry

Menyebabkan retry storm.

### 20.5 Semua Variable Diexport

Membebani exporter dan secondary storage.

### 20.6 BPMN Terlalu Chatty

Meningkatkan command/record volume tanpa business value.

### 20.7 Operate Digunakan sebagai Real-Time Source of Truth

Operate adalah projection. Ada lag.

### 20.8 Load Test Hanya Happy Path

Tidak menguji:

- downstream slow,
- worker crash,
- broker restart,
- exporter lag,
- incident repair,
- message duplicate,
- timeout.

---

## 21. Production Diagnostic Playbooks

### 21.1 Symptom: Job Lambat Selesai

Check:

1. Apakah job sudah dibuat?
2. Apakah worker aktif?
3. Apakah worker mengambil job?
4. Apakah active job menumpuk?
5. Apakah handler latency naik?
6. Apakah downstream lambat?
7. Apakah timeout terjadi?
8. Apakah retries meningkat?
9. Apakah broker completion latency tinggi?
10. Apakah Operate hanya lag?

Diagnosis:

```text
Jika worker tidak mengambil job -> worker/gateway/auth/network issue.
Jika worker mengambil tapi tidak complete -> worker/downstream issue.
Jika complete command lambat -> gateway/broker/backpressure issue.
Jika complete sudah terjadi tapi UI belum update -> projection/exporter issue.
```

### 21.2 Symptom: Operate Lambat Update

Check:

1. Apakah process sebenarnya jalan?
2. Apakah exporter lag?
3. Apakah secondary storage healthy?
4. Apakah index write latency tinggi?
5. Apakah import lag tinggi?
6. Apakah query lambat?

Jangan langsung retry process.

### 21.3 Symptom: Backpressure Meningkat

Check:

1. command rate,
2. broker CPU,
3. disk I/O,
4. partition hotspot,
5. exporter lag,
6. worker retry storm,
7. batch client traffic,
8. message publish rate.

Mitigation:

- throttle clients,
- reduce retry,
- pause batch,
- scale bottleneck,
- reduce payload,
- fix exporter/storage,
- add capacity only after evidence.

### 21.4 Symptom: Incident Storm

Check:

1. same job type?
2. same BPMN process?
3. same worker version?
4. same variable schema?
5. same downstream?
6. deployment just happened?
7. process version mismatch?
8. error retryable or poison?

Mitigation:

- stop bad worker version,
- pause deployment,
- create hotfix,
- avoid bulk retry before root cause,
- repair variables if needed,
- resume gradually.

---

## 22. Reference Worker Tuning Example

Scenario:

```text
Job type: verify-entity
External API p95: 700ms
External API limit: 100 req/sec
Worker pod CPU: 2 vCPU
Worker memory: 1Gi
DB pool: 20
Payload per job: 50KB
Target: 80 jobs/sec
```

Little's Law:

```text
80/sec * 0.7 sec = 56 concurrent executions
```

But downstream limit is 100/sec and DB pool 20. If each job needs DB connection briefly, concurrency 56 may work only if DB connection duration is short.

Start:

```text
pods: 4
concurrency per pod: 16
maxJobsActive per pod: 32
global theoretical concurrency: 64
global max active jobs: 128
rate limiter: 80/sec global
timeout: 5s or 10s depending p99
```

Observe:

- external API p99,
- timeout,
- active jobs,
- retry,
- DB pool,
- CPU throttling,
- broker command latency.

If stable:

- increase gradually,
- never exceed external API budget,
- keep headroom.

---

## 23. Capacity Planning Template

Gunakan template ini saat design review.

```text
Process:
Owner:
Business SLA:
Peak volume:
Peak factor:
Process instances/sec:
Average tasks per instance:
Service jobs per instance:
User tasks per instance:
Messages per instance:
Timers per instance:
Expected retries:
Expected incident rate:

Largest variable payload:
Variables exported for analytics:
PII variables:
Retention requirement:

Worker job types:
- job type:
  - p50/p95/p99 latency:
  - CPU-bound or I/O-bound:
  - downstream dependency:
  - downstream rate limit:
  - idempotency strategy:
  - maxJobsActive:
  - concurrency:
  - timeout:
  - retry policy:

Engine:
- broker count:
- partition count:
- replication factor:
- gateway count:
- storage class:
- expected command rate:
- expected exported record rate:

Read side:
- secondary storage:
- retention:
- expected query load:
- Optimize/dashboard needs:
- projection lag tolerance:

Failure:
- downstream outage behavior:
- retry budget:
- incident ownership:
- recovery procedure:
- batch retry plan:
```

---

## 24. Performance Review Checklist

Sebelum production:

- [ ] Process model tidak chatty tanpa alasan.
- [ ] Service task granularity punya business/operational meaning.
- [ ] Worker idempotent.
- [ ] Timeout berdasarkan p95/p99, bukan guess.
- [ ] Retry policy punya limit dan backoff.
- [ ] Downstream rate limit diketahui.
- [ ] Worker concurrency tidak melebihi downstream/DB capacity.
- [ ] `maxJobsActive` tidak menyebabkan memory pressure.
- [ ] Variable fetch dibatasi.
- [ ] Payload besar diganti reference.
- [ ] PII tidak diexport sembarangan.
- [ ] Engine load test dilakukan dengan dummy worker.
- [ ] Worker benchmark dilakukan terpisah.
- [ ] End-to-end load test dilakukan.
- [ ] Failure mode diuji.
- [ ] Exporter/projection lag dipantau.
- [ ] Secondary storage retention disiapkan.
- [ ] Dashboards memisahkan engine, worker, read side, business.
- [ ] Runbook backpressure tersedia.
- [ ] Runbook incident storm tersedia.
- [ ] Batch retry procedure tersedia.

---

## 25. Kesimpulan

Performance engineering Camunda 8 bukan soal satu knob.

Bukan hanya:

```text
tambah worker
```

Bukan hanya:

```text
tambah broker
```

Bukan hanya:

```text
naikkan maxJobsActive
```

Camunda 8 performance adalah hasil interaksi antara:

- command rate,
- gateway,
- broker,
- partition,
- replication,
- stream processing,
- worker activation,
- worker execution,
- downstream dependency,
- retry behavior,
- exporter,
- secondary storage,
- read projection,
- business SLA.

Mental model paling penting:

```text
Optimize the flow, not the component.
```

Jika engineer memahami aliran dari command sampai projection, ia bisa:

- menemukan bottleneck dengan benar,
- mencegah retry storm,
- men-tune worker secara aman,
- melindungi downstream,
- merancang BPMN yang efisien,
- menyusun capacity plan,
- membuat load test bermakna,
- dan menjaga sistem tetap stabil saat production load naik.

---

## 26. Apa yang Tidak Dibahas Mendalam di Part Ini

Part ini tidak mengulang:

- Java concurrency dasar,
- HTTP client pooling dasar,
- Kubernetes resource dasar,
- Elasticsearch/OpenSearch administration detail,
- BPMN basic notation,
- generic observability concepts.

Semua itu sudah atau akan dibahas dalam seri terkait. Fokus part ini adalah **Camunda 8/Zeebe-specific performance reasoning**.

---

## 27. Next Part

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-024.md
```

Judul:

```text
Part 024 — Reliability Engineering: Failure Modes, Recovery, Backups, Snapshots, and DR
```

Fokus berikutnya adalah reliability, bukan throughput. Kita akan membahas bagaimana sistem Camunda 8 tetap benar dan recoverable ketika broker, gateway, worker, exporter, secondary storage, network, dan downstream mengalami kegagalan.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-022.md">⬅️ Part 022 — Deployment Models: SaaS, Self-Managed, Kubernetes, Helm, and Enterprise Runtime Topology</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-024.md">Part 024 — Reliability Engineering: Failure Modes, Recovery, Backups, Snapshots, and DR ➡️</a>
</div>

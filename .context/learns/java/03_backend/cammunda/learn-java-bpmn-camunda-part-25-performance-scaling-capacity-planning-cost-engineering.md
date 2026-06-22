# Learn Java BPMN Camunda Process Orchestration Engineering

## Part 25 — Performance, Scaling, Capacity Planning, and Cost Engineering

> Seri: `learn-java-bpmn-camunda-process-orchestration-engineering`  
> Level: Advanced / Production Engineering  
> Fokus: Java 8–25, BPMN, Camunda 7/8, process orchestration, worker throughput, Zeebe scaling, capacity model, cost engineering

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- BPMN execution semantics.
- Camunda 7 vs Camunda 8.
- Zeebe runtime internals.
- Java Client dan worker production-grade.
- Reliability: idempotency, retry, incident, compensation.
- Process variable governance.
- Human workflow, DMN, message correlation, timers, parallelism, subprocess, saga.
- Testing, observability, operations, security, dan integration patterns.

Part ini masuk ke pertanyaan yang sangat menentukan di production:

```text
Bisakah workflow system ini menahan volume nyata?
Apa bottleneck sebenarnya?
Berapa worker yang dibutuhkan?
Berapa partition/broker yang masuk akal?
Apa yang terjadi saat external system lambat?
Berapa biaya yang akan naik kalau process volume bertambah 10x?
```

Di sistem workflow, performance tidak bisa dianalisis seperti REST API biasa. REST API biasanya dilihat dari:

```text
RPS -> latency -> CPU/memory -> DB query time
```

Workflow system perlu dimodelkan sebagai gabungan dari:

```text
process starts
+ job creation rate
+ job activation rate
+ worker completion rate
+ wait-state population
+ user task backlog
+ timer cardinality
+ message correlation volume
+ variable payload size
+ exporter/search-store lag
+ external dependency capacity
+ repair/incident rate
```

Top 1% engineer tidak bertanya “Camunda kuat berapa TPS?” secara abstrak. Mereka bertanya:

```text
TPS untuk process yang seperti apa?
Berapa service task per instance?
Berapa parallel branch?
Berapa timer?
Berapa payload variable?
Berapa lama user task menunggu?
Berapa banyak event correlation?
Apakah bottleneck-nya engine, worker, DB, external API, search store, atau manusia?
```

---

## 1. Mental Model: Workflow Performance Bukan Satu Angka

Sistem workflow adalah pipeline stateful. Satu process instance bukan satu request. Satu process instance bisa hidup menit, hari, bulan, atau tahun. Di dalamnya ada banyak unit kerja.

Contoh proses regulatory application:

```text
Start application
  -> Validate application
  -> Calculate risk score
  -> Request missing document
  -> Wait for applicant upload
  -> Parallel agency review
  -> Officer assessment
  -> Manager approval
  -> Generate license
  -> Notify applicant
  -> End
```

Dari satu process instance ini, performance load-nya bisa terdiri dari:

```text
1 process start command
+ 5 service jobs
+ 3 user tasks
+ 2 message subscriptions
+ 4 timers
+ 2 DMN evaluations
+ N variable writes
+ N exporter records
+ M search index updates
+ external API calls
+ human waiting time
```

Jadi metrik `process started per second` saja tidak cukup. Dua process dengan start rate sama bisa punya cost yang sangat berbeda.

### 1.1 Lightweight Process

```text
Start -> service task -> end
```

Load:

- sedikit state transition
- sedikit variable
- sedikit wait state
- worker cepat
- rendah timer/message load

### 1.2 Heavy Human Workflow

```text
Start -> validation -> user task -> timer reminder -> user task -> approval -> external API -> end
```

Load:

- banyak wait state
- banyak task backlog
- banyak variable read/write
- timer lifecycle
- human dashboard query
- audit requirement tinggi

### 1.3 Parallel Integration Workflow

```text
Start -> parallel agency calls -> wait all responses -> aggregate -> decide -> end
```

Load:

- high fan-out
- high message correlation
- aggregation state
- duplicate event handling
- race condition risk
- external dependency bottleneck

### 1.4 High-volume Straight-through Processing

```text
Start -> enrich -> score -> decide -> notify -> end
```

Load:

- high job rate
- high worker concurrency
- backpressure risk
- external API rate-limit risk
- exporter/search-store lag risk

---

## 2. The Throughput Equation

Untuk capacity planning awal, gunakan persamaan kasar:

```text
job_rate = process_start_rate * average_automated_tasks_per_process
```

Contoh:

```text
100 process starts/minute
x 8 service tasks/process
= 800 jobs/minute
= 13.3 jobs/second
```

Tapi ini baru base rate. Harus dikalikan faktor retry dan parallelism.

```text
effective_job_rate = base_job_rate * retry_factor * parallelism_factor
```

Jika 10% job retry sekali:

```text
retry_factor = 1.1
```

Jika sebagian process membuat fan-out rata-rata 3 branch:

```text
parallelism_factor = depends on model; often reflected in automated_tasks_per_process
```

Maka:

```text
13.3 jobs/sec * 1.1 = 14.63 job executions/sec
```

Tetapi worker capacity bukan hanya job/sec. Harus dilihat:

```text
worker_capacity = worker_instances * concurrency_per_instance / average_job_duration_seconds
```

Contoh:

```text
5 worker pods
x 20 concurrent jobs/pod
/ 2 seconds average duration
= 50 jobs/sec theoretical capacity
```

Jika job rata-rata 500 ms:

```text
5 * 20 / 0.5 = 200 jobs/sec
```

Jika external API p95 8 detik:

```text
5 * 20 / 8 = 12.5 jobs/sec
```

Artinya bottleneck sering bukan Camunda, tetapi external API latency.

---

## 3. Capacity Planning Harus Dimulai dari Process Inventory

Sebelum tuning Zeebe/worker, buat inventory proses.

Template:

```text
Process Name:
Expected starts/day:
Peak starts/hour:
Peak starts/min:
Average service tasks per instance:
Average user tasks per instance:
Average timers per instance:
Average message waits per instance:
Average process duration:
Average variable payload size:
External dependencies:
Retry-prone steps:
Parallel branches:
Business SLA:
Incident tolerance:
```

Contoh:

```text
Process: License Application Review
Expected starts/day: 20,000
Peak starts/hour: 5,000
Peak starts/min: 150
Service tasks/instance: 9
User tasks/instance: 3
Timers/instance: 5
Message waits/instance: 2
Average duration: 14 days
Variable payload: 8 KB
External dependencies: Identity, Document, Payment, Notification, Agency API
Retry-prone steps: Payment confirmation, agency API
Parallel branches: 3 agency reviews
SLA: 10 working days
Incident tolerance: very low for payment/license issuance
```

Dari sini kita turunkan:

```text
Peak service job rate = 150/min * 9 = 1,350/min = 22.5/sec
Peak timer creation rate = 150/min * 5 = 750/min
Peak message subscription creation = 150/min * 2 = 300/min
User task creation peak = 150/min * 3 = 450/min
```

Jika user task rata-rata menunggu 5 hari, backlog aktif bisa jauh lebih besar dari start rate.

```text
active_user_task_population
≈ daily_user_task_created * average_wait_days
```

Jika:

```text
20,000 process/day * 3 tasks = 60,000 tasks/day
average wait = 5 days
active task population ≈ 300,000 tasks
```

Ini memengaruhi Tasklist/search/query performance, bukan hanya Zeebe command throughput.

---

## 4. Pisahkan Runtime Load dan Query Load

Di Camunda 8, kita harus memisahkan dua jenis load:

```text
Runtime command load:
- start process
- activate job
- complete job
- fail job
- publish message
- update variable
- resolve incident

Read/query/operations load:
- Operate search
- Tasklist query
- dashboard query
- audit export
- Optimize/reporting
- custom tracking query
```

Runtime engine bisa sehat, tetapi dashboard lambat. Atau search store lag, sementara process execution masih jalan. Ini harus dibaca sebagai dua lapisan berbeda:

```text
Command path: application -> gateway -> broker/partition -> stream processor
Read path: broker/exporter -> search/analytics store -> Operate/Tasklist/Optimize/custom query
```

### 4.1 Kesalahan Diagnosis Umum

Salah:

```text
Operate lambat berarti engine lambat.
```

Lebih tepat:

```text
Operate lambat bisa berarti search/indexing/read model lambat.
Runtime command processing harus dicek terpisah dari exporter/search lag.
```

Salah:

```text
Worker backlog berarti Zeebe kurang kuat.
```

Lebih tepat:

```text
Worker backlog bisa karena worker concurrency kurang, external API lambat, maxJobsActive terlalu rendah, job timeout terlalu pendek, atau backpressure dari broker.
```

---

## 5. Zeebe Scaling Mental Model

Camunda 8/Zeebe menggunakan konsep:

```text
Gateway -> Broker -> Partition -> Stream Processor -> Exporter
```

Secara sederhana:

- Gateway menerima request dari client/worker.
- Broker menyimpan dan memproses partition.
- Partition adalah unit distribusi state/workload.
- Stream processor memproses command/event di partition.
- Exporter mengalirkan data ke read/search/analytics systems.

Dokumentasi Camunda menjelaskan bahwa cluster scaling dapat dilakukan dengan menambah/mengurangi broker dan menambah partition; partition kemudian didistribusikan ulang ke brokers untuk menyebarkan load.

### 5.1 Partition Bukan Magic Multiplier

Partition menambah potensi paralelisme engine, tetapi tidak otomatis membuat seluruh sistem lebih cepat.

Jika bottleneck adalah external API:

```text
Tambah partition tidak menyelesaikan latency external API.
```

Jika bottleneck adalah worker CPU:

```text
Tambah partition tidak cukup; scale worker.
```

Jika bottleneck adalah search store/exporter:

```text
Tambah partition bisa menambah event volume dan memperparah indexing lag.
```

Jika bottleneck adalah gateway/network:

```text
Tambah broker partition belum tentu membantu command ingress.
```

### 5.2 Broker CPU dan Partition Leadership

Broker yang menjadi leader untuk partition melakukan lebih banyak processing. Replica partition juga membutuhkan resource untuk replication/snapshot/log, tetapi leader biasanya lebih aktif.

Mental model:

```text
Total partition leaders should be reasonably distributed across brokers.
CPU thread count should be aligned with active processing partitions.
Replica partitions still consume CPU/disk/network.
```

Camunda performance tuning guidance menekankan bahwa CPU type dan jumlah processing partition/leader per broker memengaruhi performance, sehingga benchmark sebaiknya memakai CPU type yang sama dengan production.

### 5.3 Replication Factor

Replication factor meningkatkan fault tolerance, tetapi menaikkan resource cost:

```text
higher replication factor
= more disk usage
+ more network replication
+ more CPU overhead
+ better fault tolerance
```

Jangan menilai cost hanya dari broker count. Perhatikan:

```text
brokers * partitions * replication factor * log volume * snapshot size
```

---

## 6. Worker Scaling Mental Model

Worker adalah tempat business logic berjalan. Untuk banyak sistem, worker adalah bottleneck utama.

Worker throughput dipengaruhi oleh:

```text
number of worker pods
x max active jobs
x internal executor capacity
x job duration
x external dependency latency
x retry rate
x idempotency overhead
x DB transaction time
```

### 6.1 Worker Capacity Formula

```text
worker_capacity_jobs_per_sec
≈ total_concurrent_jobs / average_job_duration_sec
```

Jika:

```text
worker pods = 4
max concurrent jobs per pod = 25
average job duration = 2 sec
```

Maka:

```text
total concurrency = 100
capacity ≈ 100 / 2 = 50 jobs/sec
```

Namun ini theoretical. Gunakan safety factor:

```text
safe_capacity = theoretical_capacity * 0.5 to 0.7
```

Karena ada:

- GC pause.
- DB latency spike.
- network jitter.
- external API p95/p99.
- retry burst.
- deployment rolling restart.
- CPU throttling.
- backpressure.

### 6.2 IO-bound vs CPU-bound Worker

#### IO-bound Worker

Contoh:

- call REST API
- send email
- read object storage
- write DB

Bisa memakai concurrency lebih tinggi karena banyak waktu menunggu IO.

```text
maxJobsActive: medium/high
thread pool: medium/high
DB pool: carefully bounded
external rate limit: mandatory
```

#### CPU-bound Worker

Contoh:

- generate PDF besar
- image processing
- cryptographic batch
- heavy transformation
- large XML parsing

Concurrency harus dibatasi sesuai CPU.

```text
maxJobsActive: low/medium
thread pool: near CPU cores
queue size: bounded
horizontal scaling: by CPU
```

#### Mixed Worker

Pisahkan job type atau deployment.

Jangan gabungkan:

```text
fast notification worker
+ slow PDF generation worker
+ external agency sync worker
```

di satu worker pool tanpa isolation. Worker lambat bisa menahan job cepat.

### 6.3 `maxJobsActive` Bukan Target Throughput

`maxJobsActive` adalah batas berapa job yang boleh aktif/di-handle worker secara bersamaan. Nilai terlalu rendah menyebabkan worker underutilized. Nilai terlalu tinggi menyebabkan:

- memory pressure
- DB pool exhaustion
- external API overload
- long queue di aplikasi
- job timeout sebelum selesai
- duplicate execution risk

Rule awal:

```text
maxJobsActive <= actual safe concurrency of the worker
```

Bukan:

```text
maxJobsActive = sebanyak mungkin supaya cepat
```

### 6.4 Job Timeout

Job timeout bukan “SLA job harus selesai dalam X”. Job timeout adalah periode lock/lease: jika worker tidak complete/fail dalam waktu itu, job bisa tersedia lagi untuk worker lain.

Jika timeout terlalu pendek:

```text
long job still running
+ timeout expires
+ another worker activates same job
+ duplicate side effect risk
```

Jika timeout terlalu panjang:

```text
worker crash
+ job locked too long
+ recovery slow
```

Prinsip:

```text
job_timeout > p99 expected execution time + safety margin
```

Untuk job sangat panjang, desain ulang:

- pecah menjadi beberapa task
- gunakan async external operation + message correlation
- jangan tahan worker thread berjam-jam

---

## 7. Backpressure: Sinyal Sistem Menolak Beban

Backpressure adalah mekanisme agar sistem tidak menerima lebih banyak pekerjaan daripada yang bisa diproses secara sehat.

Camunda documentation menjelaskan tujuan backpressure adalah menjaga processing latency tetap rendah; metrik seperti stream processor latency, dropped request count, received request count, dan backpressure request limit relevan untuk observasi.

Mental model:

```text
Backpressure bukan bug.
Backpressure adalah safety valve.
```

Jika backpressure muncul, jangan langsung menaikkan limit. Cari penyebab:

1. Apakah broker CPU tinggi?
2. Apakah disk lambat?
3. Apakah exporter lambat?
4. Apakah command volume burst terlalu tinggi?
5. Apakah process model menghasilkan terlalu banyak jobs/timers/messages?
6. Apakah worker completion lambat sehingga backlog meningkat?
7. Apakah retry storm terjadi?
8. Apakah external system outage menyebabkan fail/retry massal?

### 7.1 Backpressure di Worker Side

Worker metrics bisa menunjukkan:

```text
activated jobs rate > handled jobs rate
```

Jika selisih ini terus mendekati `maxJobsActive`, worker mulai menumpuk pekerjaan aktif.

Kemungkinan penyebab:

- job handler lambat
- external API lambat
- DB lambat
- thread pool penuh
- maxJobsActive terlalu tinggi
- CPU throttling
- GC pressure

### 7.2 Retry Storm

External API down selama 10 menit. Ribuan jobs fail dan dijadwalkan retry hampir bersamaan. Ketika API pulih, semua retry meledak.

Mitigasi:

- exponential backoff
- jitter
- circuit breaker
- bulkhead per dependency
- rate limiter
- bounded worker concurrency
- incident after meaningful retry limit
- manual resume jika outage besar

---

## 8. Payload Size dan Variable Cost

Variable besar adalah performance killer yang sering tidak terlihat saat development.

Masalah dari variable besar:

- command payload besar
- serialization/deserialization mahal
- memory pressure di worker
- network cost meningkat
- exporter/search-store load meningkat
- Operate/Tasklist query lambat
- audit/search storage membengkak
- incident repair makin sulit

Anti-pattern:

```json
{
  "application": { "entire domain aggregate": "..." },
  "documents": [ { "base64": "very large..." } ],
  "fullExternalResponse": { "huge": "payload" }
}
```

Lebih baik:

```json
{
  "applicationId": "APP-2026-000001",
  "caseId": "CASE-2026-00981",
  "riskLevel": "HIGH",
  "paymentStatus": "PAID",
  "documentBundleRef": "s3://bucket/key or dms-id",
  "decisionSnapshotId": "DEC-99881"
}
```

Prinsip:

```text
Process variable should carry process-relevant facts,
not become the domain database or document store.
```

### 8.1 Variable Update Frequency

Jangan update variable terlalu sering untuk progress minor.

Salah:

```text
for each item in 10,000 records:
  update process variable progressCount
```

Lebih baik:

- simpan progress detail di domain table
- update process variable hanya pada milestone
- gunakan batch worker state table
- publish final result ke process

### 8.2 Searchable vs Non-searchable Data

Tidak semua data yang dibutuhkan worker harus berada di process variable.

Gunakan klasifikasi:

| Data | Simpan di Variable? | Alasan |
|---|---:|---|
| business key | ya | correlation/observability |
| current process decision | ya | routing process |
| large document content | tidak | storage/search cost tinggi |
| sensitive PII detail | minimal | data protection |
| external raw response besar | tidak langsung | simpan reference/snapshot |
| retry/internal debug blob | tidak | observability system lebih tepat |

---

## 9. Timer and Message Scale

Timer dan message subscription terlihat murah di diagram, tetapi pada volume besar menjadi state aktif.

### 9.1 Timer Cardinality

Jika setiap process membuat 8 timer dan ada 1 juta process aktif:

```text
8 juta timer-related states/records/events over lifecycle
```

Tidak semua timer aktif bersamaan, tetapi cardinality tetap penting.

Gunakan timer ketika:

- process benar-benar perlu menunggu waktu tertentu
- SLA/expiry/reminder adalah bagian kontrak bisnis
- state harus terlihat dalam process

Hindari timer untuk:

- polling teknis cepat
- retry external API kecil
- progress check per menit untuk jutaan instance

Untuk polling skala besar, pertimbangkan:

- scheduled batch outside process
- external scheduler
- event-driven callback
- aggregate reminder service

### 9.2 Message Subscription Volume

Message catch event membuat process menunggu external signal. Pada volume besar, pastikan:

- correlation key unik/stabil
- message TTL sesuai
- duplicate event safe
- inbound event table tersedia
- stale event policy jelas
- monitoring unmatched messages ada

Message correlation load tinggi dapat menjadi bottleneck jika:

- correlation key buruk
- duplicate event banyak
- external system retry agresif
- message TTL terlalu panjang untuk event noisy

---

## 10. Human Workflow Capacity: Bottleneck Manusia

Performance workflow bukan hanya machine throughput. Untuk user task, bottleneck utama sering manusia/organisasi.

Metrik penting:

```text
new tasks/day
completed tasks/day
active tasks
aging buckets
SLA breach count
assignee workload
candidate group queue depth
reassignment rate
escalation rate
```

Little's Law sangat berguna:

```text
Work In Progress = Throughput * Cycle Time
```

Jika tim menyelesaikan:

```text
2,000 tasks/day
```

Dan average cycle time:

```text
5 days
```

Maka WIP normal:

```text
10,000 active tasks
```

Jika active tasks menjadi 30,000, maka:

- volume naik
- kapasitas manusia turun
- task complexity naik
- assignment routing salah
- SLA stuck
- dashboard/filter lambat

### 10.1 Jangan Menyelesaikan Human Bottleneck dengan Menambah Engine Resource

Jika officer queue overload, menambah Zeebe broker tidak menyelesaikan SLA. Yang dibutuhkan:

- workload routing
- priority model
- task triage
- delegation
- escalation
- staffing/capacity planning
- simplifikasi form/decision
- automation pre-check

---

## 11. External Dependency as Capacity Ceiling

Camunda bisa mengorkestrasi cepat, tetapi external dependency bisa menjadi batas mutlak.

Contoh:

```text
Payment API rate limit: 100 requests/minute
Process peak requires: 500 payment checks/minute
```

Maka capacity efektif payment step adalah:

```text
100/minute
```

Bukan kemampuan worker atau engine.

### 11.1 Rate Limit Budgeting

Untuk setiap dependency:

```text
Dependency:
Allowed rate:
Allowed burst:
Timeout:
p50/p95/p99 latency:
Error rate:
Retry policy:
Daily quota:
Operational contact:
Fallback behavior:
```

Worker harus punya:

- rate limiter per dependency
- circuit breaker
- retry with backoff+jitter
- bulkhead
- timeout
- idempotency key
- dead-letter/incident path

### 11.2 External Latency Mengikat Worker Concurrency

Jika external API p95 = 10 detik dan target 50 jobs/sec:

```text
required concurrency ≈ throughput * latency
required concurrency ≈ 50 * 10 = 500 concurrent calls
```

Apakah worker, DB pool, external API, network, and JVM sanggup 500 concurrent calls? Belum tentu.

Mungkin solusi yang lebih baik:

- asynchronous request/response
- submit request then wait message callback
- batch API
- pre-cache
- rate-limited queue
- separate process for high-volume integration

---

## 12. Scaling Strategy: Apa yang Harus Diskalakan?

Jangan scale semua komponen sekaligus. Identifikasi bottleneck.

| Symptom | Kemungkinan Bottleneck | Scale/Tune |
|---|---|---|
| activated jobs naik, handled jobs lambat | worker/external API | scale worker, tune concurrency, rate limit |
| broker CPU tinggi, command latency naik | Zeebe processing | broker resource, partitions, model simplification |
| Operate lambat, exporter lag | search/read store/exporter | scale search store, tune exporter/index |
| user tasks menumpuk | human capacity/routing | staffing, assignment, SLA, automation |
| message unmatched banyak | correlation design | key, TTL, inbound table, dedup |
| retry burst | dependency instability | backoff+jitter, circuit breaker |
| memory pressure worker | payload/concurrency | reduce variables, lower maxJobsActive |
| DB pool exhausted | worker DB access | pool sizing, query tuning, bulkhead |
| timer count huge | modeling issue | aggregate timers, redesign reminders |

---

## 13. Camunda 7 Performance Mental Model

Camunda 7 berbeda dari Camunda 8. Camunda 7 lebih database-centric dan sering embedded di aplikasi Java.

Performance dipengaruhi oleh:

- application JVM
- process engine configuration
- database throughput
- job executor acquisition
- history level
- async continuation usage
- transaction boundary
- process variable serialization
- delegate latency
- task query patterns
- Cockpit/history query load

### 13.1 Camunda 7 Bottleneck Umum

1. Database hot tables.
2. History table growth.
3. Job executor contention.
4. Long transaction di JavaDelegate.
5. Variable serialization besar.
6. Overuse synchronous service task.
7. Bad task query/filter.
8. Missing cleanup/archive.
9. Lock contention in job acquisition.
10. Too many process instances in same transactional pattern.

### 13.2 Async Before/After sebagai Performance and Reliability Boundary

Di Camunda 7, async continuation menentukan transaction boundary. Ini memengaruhi:

- latency response
- retry behavior
- incident boundary
- database transaction size
- failure isolation

Salah:

```text
Start process synchronously menjalankan banyak service task berat dalam satu transaction.
```

Lebih baik:

```text
Start -> async before validate -> async before external call -> wait state
```

Dengan begitu:

- request start process cepat
- job executor mengambil kerja berat
- retry bisa dilakukan per step
- failure terisolasi

### 13.3 History Level Cost

History penting untuk audit, tetapi mahal.

Pertanyaan:

```text
History apa yang wajib?
Berapa lama retention?
Apakah semua variable perlu tersimpan?
Apakah audit domain bisa dipisahkan dari engine history?
Apakah ada history cleanup?
```

Untuk regulatory system, jangan asal menurunkan history demi performance tanpa audit design alternatif.

---

## 14. Cost Engineering

Cost workflow system berasal dari banyak sumber:

```text
engine cluster
+ worker compute
+ database/search storage
+ logs/metrics/traces
+ network egress
+ external API cost
+ audit retention
+ backup storage
+ operational human cost
```

### 14.1 Cost per Process Instance

Coba hitung kasar:

```text
cost_per_instance
= engine compute share
+ worker compute share
+ storage per event/variable/history
+ search indexing cost
+ external API cost
+ notification cost
+ document storage cost
+ observability cost
```

Walaupun tidak presisi, model ini membantu membandingkan desain.

Contoh dua desain:

#### Design A: Store full external response in process variable

```text
variable payload = 200 KB
instances/day = 100,000
raw variable write/day = 20 GB before overhead/export/history
```

#### Design B: Store response snapshot in object storage, variable only reference

```text
variable payload = 2 KB
instances/day = 100,000
raw variable write/day = 200 MB before overhead/export/history
```

Perbedaan cost bisa 100x pada storage/index/network.

### 14.2 Observability Cost

Structured logs, traces, metrics, and audit are necessary. Tetapi volume bisa meledak.

Jangan log:

- full variables
- full external payload
- PII
- document content
- repeated polling noise

Log yang lebih berguna:

```json
{
  "event": "job.completed",
  "processInstanceKey": "...",
  "bpmnProcessId": "license_application",
  "jobType": "payment.confirm",
  "businessKey": "APP-2026-00001",
  "durationMs": 842,
  "attempt": 1,
  "externalSystem": "PAYMENT_GATEWAY"
}
```

### 14.3 Cost of Bad Modeling

Bad modeling menyebabkan cost tinggi:

| Modeling Issue | Cost Impact |
|---|---|
| too many timers | state/load meningkat |
| huge variables | storage/index/network mahal |
| excessive parallelism | worker/external load spike |
| retry tanpa backoff | retry storm |
| no idempotency | duplicate side effect repair cost |
| no correlation strategy | manual investigation cost |
| user task too granular | human workload/dashboard cost |
| no archive/retention | storage terus naik |

---

## 15. Load Testing Workflow Systems

Load test workflow tidak cukup dengan HTTP load test ke endpoint start process.

Harus menguji:

1. Process start burst.
2. Job activation/completion volume.
3. Worker concurrency.
4. External dependency latency simulation.
5. Retry storm.
6. Message correlation burst.
7. Timer due burst.
8. User task query load.
9. Operate/Tasklist query load.
10. Exporter/search lag.
11. Variable payload distribution.
12. Rolling deployment while jobs active.
13. Broker/gateway restart scenario.
14. Worker crash scenario.

### 15.1 Test Scenario Template

```text
Scenario: Peak Application Submission
Process: license_application
Duration: 2 hours
Ramp-up: 15 minutes
Peak starts/min: 1,000
Average service tasks: 7
External API latency profile: p50=300ms, p95=2s, p99=8s
Retry error rate: 2%
Variable payload: p50=5KB, p95=20KB
User task creation: enabled
Message callback: 70% within 5 min, 30% delayed
Timers: SLA reminders enabled
Success criteria:
  - p95 job completion < 5s for internal jobs
  - no sustained backpressure > 5 min
  - worker queue below 70% maxJobsActive
  - exporter lag recovers within 10 min after peak
  - no duplicate side effects
  - no unexpected incident
```

### 15.2 Synthetic External Dependency

Jangan load test production dependency sembarangan. Buat simulator:

- configurable latency
- configurable error rate
- configurable timeout
- configurable rate limit
- duplicate response simulation
- delayed callback simulation

### 15.3 Measure p95/p99, Bukan Average Saja

Average menipu.

```text
average job duration = 500 ms
p99 job duration = 30 seconds
```

Jika job timeout 20 detik, p99 akan duplicate.

---

## 16. JVM and Java 8–25 Worker Considerations

### 16.1 Java 8

Legacy environment:

- limited modern concurrency features
- thread-per-task lebih mahal
- perlu disiplin thread pool
- careful with CompletableFuture complexity
- GC tuning lebih manual

Pattern:

```text
bounded ExecutorService
+ bounded DB pool
+ explicit timeout
+ retry library
+ idempotency table
```

### 16.2 Java 11/17

Lebih stabil untuk modern Spring Boot versions, better GC options, better TLS/libs.

Pattern:

- use structured configuration
- Micrometer metrics
- OpenTelemetry agent
- resilient HTTP client
- bounded concurrency

### 16.3 Java 21/25

Virtual threads bisa membantu IO-bound worker, tetapi bukan solusi otomatis.

Virtual threads cocok untuk:

- banyak blocking IO
- REST calls
- DB calls dengan driver compatible
- simpler imperative code

Tetap perlu:

- rate limiter
- DB pool bound
- external API bound
- `maxJobsActive` bound
- memory/payload discipline

Virtual threads tidak menyelesaikan:

- external API quota
- CPU-bound work
- huge payload memory
- bad retry storm
- non-idempotent side effect

Prinsip:

```text
Virtual threads increase concurrency ergonomics,
not external system capacity.
```

---

## 17. Practical Sizing Walkthrough

Misal:

```text
Peak starts/minute: 600
Service tasks/process: 8
Average service job duration: 1.2 sec
p95 duration: 4 sec
Retry factor: 1.15
Target headroom: 40%
```

Base job rate:

```text
600 * 8 = 4,800 jobs/min = 80 jobs/sec
```

Effective with retry:

```text
80 * 1.15 = 92 jobs/sec
```

With 40% headroom:

```text
92 / 0.6 = 153 jobs/sec capacity target
```

Required concurrency using average:

```text
153 * 1.2 = 184 concurrent jobs
```

But using p95:

```text
153 * 4 = 612 concurrent job capacity for p95-heavy moments
```

Do not blindly set concurrency 612. Instead classify tasks:

| Job Type | Rate/sec | Avg | p95 | Strategy |
|---|---:|---:|---:|---|
| validate.application | 80 | 100ms | 300ms | CPU/DB light, moderate concurrency |
| risk.score | 80 | 500ms | 2s | isolate, cache/reference data |
| payment.check | 20 | 1s | 8s | rate limited, async preferred |
| notify.email | 80 | 300ms | 3s | queue/bulkhead provider |
| generate.document | 10 | 5s | 30s | separate CPU/memory worker |

Kemudian deploy worker per class:

```text
validation-worker
risk-worker
payment-worker
notification-worker
document-worker
```

Bukan satu worker universal.

---

## 18. Production Metrics Checklist

### 18.1 Engine / Zeebe Metrics

Pantau:

- command rate
- command latency
- stream processor latency
- backpressure count/rate
- partition health
- broker CPU/memory/disk
- gateway request latency
- exporter lag
- incident count
- process instance creation rate
- active process instances

### 18.2 Worker Metrics

Pantau per job type:

- activated jobs/sec
- handled jobs/sec
- failed jobs/sec
- BPMN errors/sec
- average/p95/p99 duration
- active jobs
- queue depth
- timeout count
- retry count
- incident creation
- external dependency latency
- DB latency
- idempotency duplicate hits

### 18.3 Business Metrics

Pantau:

- applications started
- applications completed
- average process duration
- SLA breach
- task aging
- escalation count
- approval/rejection rate
- document resubmission count
- external agency pending count
- manual repair count

### 18.4 Cost Metrics

Pantau:

- compute usage per component
- storage growth/day
- log ingestion/day
- trace ingestion/day
- search index growth
- backup size
- external API billable calls
- notification cost
- object storage growth

---

## 19. Performance Design Review Checklist

Sebelum go-live, jawab:

### Process Model

- Berapa service task per process?
- Berapa timer/message subscription per process?
- Apakah ada fan-out besar?
- Apakah ada multi-instance parallel?
- Apakah ada loop yang bisa tidak terbatas?
- Apakah retry modeled dengan benar?
- Apakah timer digunakan untuk business wait, bukan technical polling?

### Variables

- Berapa p50/p95 payload variable?
- Apakah ada base64/document/raw response?
- Apakah variable minimized?
- Apakah variable schema versioned?

### Worker

- Berapa job type?
- Apakah worker dipisah berdasarkan workload?
- Berapa `maxJobsActive` per worker?
- Berapa p95/p99 duration?
- Apakah timeout aman?
- Apakah idempotency table ada?
- Apakah DB pool cukup tapi bounded?
- Apakah external API rate limiter ada?

### Engine

- Berapa expected start rate?
- Berapa expected job rate?
- Berapa active instances?
- Berapa timer/message states?
- Apakah cluster sizing sudah diuji dengan benchmark?
- Apakah backpressure metrics dipantau?

### Read Model

- Apakah Operate/Tasklist query load diuji?
- Apakah dashboard memakai custom projection jika perlu?
- Apakah exporter/search lag dipantau?

### Operations

- Apakah retry storm diuji?
- Apakah worker crash diuji?
- Apakah external outage diuji?
- Apakah rolling deployment diuji?
- Apakah incident runbook ada?

### Cost

- Berapa storage growth/day?
- Berapa log ingestion/day?
- Berapa trace ingestion/day?
- Berapa external billable calls/day?
- Apakah retention policy jelas?

---

## 20. Anti-patterns

### 20.1 “Scale Engine First”

Menambah broker/partition ketika bottleneck adalah worker/external API.

### 20.2 “maxJobsActive Setinggi Mungkin”

Ini sering menyebabkan overload downstream dan duplicate job karena timeout.

### 20.3 “Semua Worker Jadi Satu Service”

Slow job menahan fast job. CPU-heavy job mengganggu IO-heavy job.

### 20.4 “Store Everything in Variables”

Awalnya memudahkan debug, lalu menghancurkan storage/search/performance.

### 20.5 “Timer untuk Polling”

Jutaan timer untuk polling status external system lebih buruk daripada event callback atau external scheduler.

### 20.6 “Benchmark Tanpa External Latency”

Benchmark internal cepat tetapi production lambat karena payment/agency/document API.

### 20.7 “Average-based Sizing”

p95/p99 menentukan timeout, concurrency, dan incident risk.

### 20.8 “No Cost Model”

Arsitektur terlihat benar, tetapi log/index/storage cost naik tidak terkendali.

---

## 21. Top 1% Mental Model

Performance workflow bukan mengejar angka throughput tertinggi. Performance workflow adalah kemampuan sistem untuk:

```text
menjalankan proses bisnis dengan volume nyata,
menjaga latency yang sesuai SLA,
menahan failure dependency,
menghindari overload downstream,
mempertahankan auditability,
dan tetap bisa dioperasikan dengan biaya masuk akal.
```

Top 1% engineer melihat capacity sebagai sistem antrian multi-layer:

```text
user/API ingress
-> process engine command path
-> partition stream processing
-> job activation
-> worker execution
-> external dependency
-> message/timer continuation
-> read model/exporter/search
-> human task queue
-> audit/observability/storage
```

Setiap layer punya kapasitas, latency, queue, dan failure mode sendiri.

---

## 22. Ringkasan

Part ini membahas bahwa performance dan scaling BPMN/Camunda tidak bisa direduksi menjadi “berapa TPS Camunda”. Yang perlu dihitung adalah:

- process start rate
- job rate
- worker throughput
- active wait-state population
- timer/message cardinality
- human task backlog
- variable payload size
- external dependency limit
- exporter/search/query load
- retry storm behavior
- cost per process instance

Prinsip paling penting:

```text
Scale the actual bottleneck, not the component you understand best.
```

Untuk Camunda 8, pahami broker, partition, gateway, worker, exporter, dan read model sebagai lapisan berbeda. Untuk Camunda 7, pahami database-centric runtime, transaction boundary, job executor, dan history cost. Untuk Java 8–25, pilih concurrency model sesuai beban, tetapi tetap batasi concurrency berdasarkan downstream capacity.

Performance engineering workflow yang matang bukan hanya membuat proses cepat. Ia membuat proses **stabil, predictable, recoverable, observable, auditable, dan cost-aware**.

---

## 23. Latihan

1. Ambil satu process nyata yang pernah kamu desain. Hitung:
   - starts/day
   - peak starts/min
   - service tasks/process
   - user tasks/process
   - timers/process
   - message waits/process
   - average variable payload

2. Hitung effective job rate:

```text
job_rate = peak_starts_per_sec * service_tasks_per_process * retry_factor
```

3. Untuk setiap job type, estimasi:
   - avg duration
   - p95 duration
   - p99 duration
   - external dependency
   - retry rate
   - idempotency key
   - safe concurrency

4. Buat worker deployment plan:
   - job type per worker service
   - maxJobsActive
   - pod count
   - DB pool
   - rate limiter
   - timeout

5. Buat dashboard minimum:
   - job activated vs handled
   - p95 job duration
   - incident count
   - external latency
   - active user task aging
   - exporter/search lag
   - storage growth/day

6. Simulasikan external API down 10 menit. Jelaskan:
   - retry behavior
   - backoff
   - circuit breaker
   - incident policy
   - recovery plan
   - audit trail

---

## 24. Referensi

- Camunda 8 Docs — Job Workers, worker configuration, metrics, streaming, and multi-tenancy.
- Camunda 8 Docs — Zeebe cluster scaling, broker, partition, and operations.
- Camunda 8 Docs — Backpressure and metrics.
- Camunda 8 Docs — Monitoring with Prometheus/OpenTelemetry/Micrometer.
- Camunda Blog — Performance tuning Camunda 8.
- Camunda 7 Docs — Job executor, process engine, history, runtime, async continuation.
- Brendan Gregg — Systems Performance mental models.
- Martin Kleppmann — Designing Data-Intensive Applications, especially distributed systems, logs, replication, and stream processing.
- Little's Law for queue/capacity reasoning.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-bpmn-camunda-part-24-integration-patterns-external-systems-connectors.md">⬅️ Learn Java BPMN Camunda Process Orchestration Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-bpmn-camunda-part-26-process-versioning-deployment-strategy-change-management.md">Part 26 — Process Versioning, Deployment Strategy, and Change Management ➡️</a>
</div>

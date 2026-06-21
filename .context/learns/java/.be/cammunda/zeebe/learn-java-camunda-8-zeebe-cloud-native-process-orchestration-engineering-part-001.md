# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-001.md

# Part 001 — Camunda 8 Platform Architecture: Zeebe, Gateway, Broker, Operate, Tasklist, Optimize, Identity

> Seri: **learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering**  
> Level: **Advanced / Staff+ Engineering**  
> Fokus: **arsitektur platform Camunda 8 sebagai distributed orchestration platform**  
> Target pembaca: engineer Java yang sudah memahami Java enterprise, microservices, BPMN, Camunda 7, reliability, observability, dan ingin memahami Camunda 8/Zeebe secara production-grade.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya, `part-000`, membentuk orientasi utama: Camunda 8 bukan sekadar Camunda 7 versi baru, melainkan platform orchestration dengan model eksekusi distributed, remote, asynchronous, dan log-oriented.

Part ini memperdalam pertanyaan pertama yang harus dikuasai sebelum masuk ke Java client, worker, modelling, retry, dan deployment:

> **Sebenarnya apa saja komponen Camunda 8, bagaimana mereka saling berhubungan, siapa source of truth, dan dari mana failure bisa muncul?**

Tanpa pemahaman ini, engineer biasanya melakukan kesalahan berikut:

1. Mengira Operate adalah database engine.
2. Mengira Tasklist adalah process runtime.
3. Mengira Zeebe Gateway menyimpan state.
4. Mengira semua query ke platform selalu real-time terhadap broker.
5. Mengira worker Java berjalan “di dalam engine”.
6. Mengira Camunda 8 sama seperti Camunda 7 yang tinggal di-embed ke aplikasi Spring Boot.
7. Mengira Elasticsearch/OpenSearch hanya optional monitoring store, padahal banyak fitur read-side bergantung padanya.
8. Mengira problem process selalu problem BPMN, padahal bisa muncul dari exporter lag, worker starvation, gateway routing, auth, broker leader election, atau projection delay.

Part ini akan membangun arsitektur mental yang stabil supaya part-part berikutnya bisa masuk lebih dalam tanpa miskonsepsi.

---

## 1. Prinsip Besar Camunda 8 Platform

Camunda 8 dapat dipahami sebagai platform dengan dua sisi besar:

1. **Command / execution side**  
   Sisi ini menerima perintah dan mengeksekusi workflow secara durable. Komponen utamanya adalah **Zeebe Gateway** dan **Zeebe Broker**.

2. **Read / projection / experience side**  
   Sisi ini menyediakan UI, pencarian, task inbox, analytics, dan management view berdasarkan data yang diekspor dari engine atau disimpan di secondary storage. Komponennya mencakup **Operate**, **Tasklist**, **Optimize**, **Identity/Admin**, dan storage seperti **Elasticsearch/OpenSearch/RDBMS tergantung versi dan deployment**.

Mental model sederhana:

```text
Command Path
============
Java Client / REST / gRPC
        |
        v
Zeebe Gateway
        |
        v
Zeebe Broker / Partition Leader
        |
        v
Durable Engine State + Log

Read / Projection Path
======================
Zeebe Broker Records
        |
        v
Exporter
        |
        v
Secondary Storage / Search Index / Projection Store
        |
        +--> Operate
        +--> Tasklist
        +--> Optimize
        +--> Search APIs / Admin Views
```

Hal yang harus dipegang:

> **Broker adalah execution truth. Projection adalah read truth. Worker adalah external execution participant. UI adalah operational experience, bukan engine.**

---

## 2. Komponen Utama Camunda 8

Dalam deployment Camunda 8, terutama self-managed, komponen yang sering ditemui adalah:

| Komponen | Fungsi Utama | Source of Truth? | Stateful? | Critical Path? |
|---|---|---:|---:|---:|
| Zeebe Broker | Menyimpan dan mengeksekusi state workflow | Ya, untuk execution | Ya | Ya |
| Zeebe Gateway | Entry point, routing, load balancing ke broker | Tidak | Umumnya stateless | Ya |
| Java/Camunda Client | Mengirim command, worker activation, job completion | Tidak | Tidak | Ya, dari sisi aplikasi |
| Operate | UI/API untuk observasi process instance dan incident | Tidak, projection | Bergantung storage | Support/ops path |
| Tasklist | UI/API untuk human task | Tidak, projection + task state API | Bergantung storage | Human workflow path |
| Optimize | Analytics dan process intelligence | Tidak, analytics projection | Ya, read-side | Improvement path |
| Identity/Admin | AuthN/AuthZ, users, roles, permissions | Ya, untuk access model | Ya | Security path |
| Connectors | Integration runtime/template untuk external systems | Tidak | Tergantung connector runtime | Bisa critical |
| Web Modeler | Modelling BPMN/DMN/forms | Tidak untuk runtime execution | Ya | Design-time |
| Console | Deployment/management experience | Tidak untuk engine execution | Ya | Platform ops |
| Elasticsearch/OpenSearch/RDBMS secondary storage | Projection/read/search storage | Read-side truth | Ya | Read/UI path |

Catatan penting:

- Pada Camunda 8 versi baru, terjadi penyatuan konsep **Orchestration Cluster** untuk core orchestration components.
- Dokumentasi terbaru memperlihatkan bahwa komponen seperti Zeebe, Operate, Tasklist, dan Identity berada dalam cakupan orchestration cluster pada self-managed architecture modern.
- Pada versi dan topologi tertentu, komponen bisa di-package atau di-deploy berbeda.
- Karena Camunda 8 bergerak cepat, engineer harus membaca dokumentasi sesuai minor version yang dipakai: 8.6, 8.7, 8.8, 8.9, dan seterusnya.

Prinsipnya bukan menghafal packaging, tetapi memahami boundary:

```text
Execution truth  -> Zeebe Broker
Command ingress  -> Zeebe Gateway / Orchestration API
Read projection  -> Exporter + secondary storage
Ops UI           -> Operate
Human task UI    -> Tasklist
Analytics        -> Optimize
Access control   -> Identity/Admin
Integration      -> Java workers / Connectors
```

---

## 3. Zeebe sebagai Jantung Runtime

Zeebe adalah workflow engine Camunda 8. Namun kata “engine” di sini tidak sama dengan Camunda 7 engine.

Pada Camunda 7:

```text
Java Application
   |
   +-- embedded/shared Camunda engine
   |
   +-- relational database
```

Pada Camunda 8:

```text
Java Application / Worker
   |
   +-- network call
   |
Zeebe Gateway
   |
Zeebe Broker Cluster
   |
Partitioned durable log/state
```

Perbedaan penting:

| Aspek | Camunda 7 | Camunda 8 / Zeebe |
|---|---|---|
| Engine location | Bisa embedded di Java app | Remote distributed cluster |
| State store | Relational DB | Broker-managed distributed state/log |
| Java business logic | JavaDelegate/listener dapat berjalan dekat engine | External job worker |
| Transaction boundary | Sering satu DB transaction dengan engine | Distributed async command boundary |
| Scaling | DB/engine centric | Partition/broker/worker/exporter centric |
| Read history | ACT_HI_* tables | Exported records/projections |
| Operational UI | Cockpit | Operate |
| Task UI | Tasklist/Camunda webapp | Tasklist |

Zeebe harus dipahami sebagai:

> **distributed durable state machine executor for BPMN-defined process instances.**

BPMN model adalah definisi state machine. Process instance adalah instance berjalan dari state machine itu. Zeebe broker menjaga progress-nya secara durable.

---

## 4. Zeebe Gateway

### 4.1 Fungsi Gateway

Zeebe Gateway adalah entry point untuk client. Client tidak idealnya berbicara langsung ke broker. Gateway menerima request dari client lalu meneruskan ke broker/partition yang tepat.

Gateway berperan sebagai:

1. **Single logical access point** ke cluster.
2. **Router** ke partition leader yang relevan.
3. **Load balancer** untuk routing internal.
4. **Protection layer** agar broker tidak langsung diekspos ke semua client eksternal.
5. **Protocol boundary** antara aplikasi dan cluster.
6. **Auth/security enforcement point** tergantung konfigurasi.

Diagram sederhana:

```text
+--------------------+
| Java Worker App    |
| REST/gRPC Client   |
+---------+----------+
          |
          v
+--------------------+
| Zeebe Gateway      |
| - route command    |
| - find partition   |
| - protect broker   |
+---------+----------+
          |
          v
+--------------------+     +--------------------+
| Broker A           |     | Broker B           |
| Partition leaders  |     | Partition leaders  |
+--------------------+     +--------------------+
```

### 4.2 Gateway Tidak Menyimpan Process State

Miskonsepsi umum:

> “Kalau gateway restart, process instance hilang?”

Tidak. Gateway bukan source of truth process execution. Gateway umumnya stateless/sessionless. Process state berada di broker partition.

Dampaknya:

- Gateway dapat direplikasi untuk high availability.
- Client dapat diarahkan ke gateway lain bila satu gateway gagal.
- Gateway failure dapat mengganggu command ingress sementara, tetapi tidak berarti process state hilang.
- Worker yang sedang melakukan polling/streaming mungkin perlu reconnect.

### 4.3 Failure Mode Gateway

| Failure | Dampak | Mitigasi |
|---|---|---|
| Gateway pod down | Client command gagal sementara | Multiple replicas, service load balancing |
| Gateway overloaded | Latency tinggi, timeout | Scale gateway, tune client, check broker pressure |
| Gateway cannot reach broker | Command rejected/timeout | Network policy, service discovery, broker health |
| Auth config salah | Client unauthorized | Identity config validation, smoke test |
| Ingress/TLS salah | External client gagal connect | TLS/ingress runbook |

### 4.4 Gateway dalam Production Review

Pertanyaan design review:

1. Berapa replica gateway?
2. Apakah gateway tersebar di node/AZ berbeda?
3. Apakah worker connect via internal service, bukan public ingress?
4. Apakah timeout client realistis?
5. Apakah gRPC/REST traffic observable?
6. Apakah ada retry policy di client layer?
7. Apakah auth token refresh ditangani?
8. Apakah gateway metrics masuk dashboard?

---

## 5. Zeebe Broker

### 5.1 Fungsi Broker

Broker adalah komponen yang memproses workflow execution. Broker memegang partition, log, state, dan memproses command menjadi event/state transition.

Broker bertanggung jawab untuk:

1. Deployment BPMN/DMN/form metadata terkait runtime.
2. Process instance creation.
3. Token movement dalam BPMN.
4. Job creation.
5. Job activation bookkeeping.
6. Job completion/failure handling.
7. Timer scheduling.
8. Message correlation.
9. Incident creation/resolution.
10. Exporting records.
11. Snapshotting state.
12. Replication antar broker.

Mental model:

```text
Incoming Command
      |
      v
Partition Leader Broker
      |
      +-- validate command
      +-- append record
      +-- mutate state
      +-- produce follow-up records
      +-- export records asynchronously
```

### 5.2 Broker Bukan Aplikasi Bisnis

Broker tidak seharusnya menjalankan business code Java Anda. Ini perbedaan besar dari Camunda 7 JavaDelegate.

Dalam Camunda 8:

```text
Broker creates job
      |
      v
Worker activates job
      |
      v
Worker executes business logic externally
      |
      v
Worker sends complete/fail/error command
      |
      v
Broker advances process
```

Konsekuensi:

- Broker harus dijaga ringan dari business execution.
- Worker scaling tidak sama dengan broker scaling.
- Worker failure harus dianggap normal.
- External side effect harus idempotent.
- Engine hanya tahu job selesai/gagal/error, bukan detail internal semua call bisnis kecuali Anda mencatatnya sebagai variable/log/audit.

### 5.3 Broker State

Broker mengelola durable state seperti:

- deployed process definitions
- running process instances
- active element instances
- jobs
- timers
- messages
- incidents
- variables
- subscriptions
- exported position

Namun engineer harus berhati-hati:

> Durable engine state bukan berarti Anda boleh memasukkan semua business data ke variable engine.

Process variables adalah orchestration state, bukan data warehouse, document store, atau audit database lengkap.

---

## 6. Partitions

### 6.1 Apa Itu Partition?

Partition adalah shard log/state di Zeebe. Workload process dibagi ke beberapa partition agar processing dapat diskalakan.

Mental model:

```text
Zeebe Cluster
  |
  +-- Partition 1 -> ordered stream + state
  +-- Partition 2 -> ordered stream + state
  +-- Partition 3 -> ordered stream + state
```

Satu process instance dieksekusi dalam konteks partition tertentu. Dalam partition yang sama, ordering record dapat dipahami secara lebih kuat. Namun tidak ada asumsi global ordering sempurna antar semua partition.

### 6.2 Partition Leader

Untuk setiap partition, ada broker yang menjadi leader. Leader menerima command dan melakukan event processing untuk partition tersebut. Follower mereplikasi data untuk high availability.

```text
Partition 1
  Leader   -> Broker A
  Follower -> Broker B
  Follower -> Broker C

Partition 2
  Leader   -> Broker B
  Follower -> Broker A
  Follower -> Broker C
```

Hal ini berarti:

- Broker bisa menjadi leader untuk beberapa partition.
- Broker bisa menjadi follower untuk partition lain.
- Load tidak hanya ditentukan jumlah broker, tetapi juga distribusi partition leader.
- Leader election dapat terjadi ketika broker gagal.

### 6.3 Mengapa Partition Penting untuk Java Engineer?

Karena partition memengaruhi:

1. Throughput process instance.
2. Message correlation routing.
3. Hotspot process type.
4. Latency command.
5. Failure recovery time.
6. Exporter throughput.
7. Operate/Tasklist visibility delay.
8. Incident distribution.
9. Capacity planning.

Jika satu job type sangat berat dan semua process instance masuk pattern yang sama, problem bisa muncul bukan karena worker Java lambat saja, tetapi karena partition tertentu menjadi hot.

### 6.4 Kesalahan Mental Model

Salah:

```text
Tambah worker Java = pasti throughput engine naik linear.
```

Benar:

```text
Throughput = min(
  broker partition processing capacity,
  gateway capacity,
  exporter capacity,
  worker activation/completion capacity,
  external dependency capacity,
  secondary storage capacity,
  network/disk capacity
)
```

---

## 7. Exporters dan Projection Path

### 7.1 Apa Itu Exporter?

Exporter membaca records dari broker dan menulisnya ke storage/projection. Projection ini kemudian digunakan oleh UI/API read-side seperti Operate, Tasklist, Optimize, dan search-based APIs.

Command path dan projection path berbeda:

```text
Command accepted by broker
        |
        v
Engine state updated
        |
        v
Record exported asynchronously
        |
        v
Projection updated
        |
        v
Operate/Tasklist/Optimize sees it
```

Artinya:

> Sesuatu bisa sudah terjadi di engine, tetapi belum terlihat di Operate karena exporter/projection lag.

### 7.2 Exporter Lag

Exporter lag terjadi ketika broker memproses records lebih cepat daripada exporter/storage dapat menulis atau mengindeks.

Gejala:

- Operate terlambat menampilkan process instance baru.
- Incident terlihat terlambat.
- Tasklist terlambat menampilkan task.
- Analytics tidak update cepat.
- Storage CPU/IO tinggi.
- Exporter position tertinggal.

Penyebab:

1. Elasticsearch/OpenSearch lambat.
2. Index shard/replica salah sizing.
3. Disk IO bottleneck.
4. Large variable payload.
5. Terlalu banyak records karena model terlalu chatty.
6. Broker throughput lebih tinggi dari read-side ingestion capacity.
7. Network latency antara broker dan secondary storage.
8. Custom exporter buruk.

### 7.3 Source of Truth Discipline

Harus dibedakan:

| Pertanyaan | Source yang Lebih Tepat |
|---|---|
| Apakah process command diterima? | Client response / broker command result |
| Apakah process instance sedang berjalan? | Engine state, terlihat via projection setelah export |
| Apakah incident perlu support? | Operate/projection |
| Apakah task human perlu dikerjakan? | Tasklist/projection/task API |
| Apakah KPI bulanan memburuk? | Optimize/analytics projection |
| Apakah broker sehat? | Zeebe metrics/health |
| Apakah worker lambat? | Worker metrics/log/traces |

Anti-pattern:

```text
Aplikasi bisnis mengambil keputusan command-critical berdasarkan Operate projection yang bisa lag.
```

Lebih aman:

```text
Aplikasi bisnis menggunakan domain database / command response / idempotency store untuk keputusan transactional, dan projection untuk observability/search/ops.
```

---

## 8. Operate

### 8.1 Peran Operate

Operate adalah operational UI untuk melihat process instances, incidents, variables, flow node state, dan membantu troubleshooting production.

Operate bukan engine. Operate adalah jendela observasi.

Fungsi umum:

1. Search process instances.
2. Inspect running/completed/canceled instances.
3. Inspect variables.
4. View incidents.
5. Resolve/retry incidents.
6. Observe BPMN token position.
7. Cancel process instance.
8. Support process modification features tergantung versi.

### 8.2 Operate dalam Incident Response

Operate membantu menjawab:

- Process instance berhenti di mana?
- Service task mana yang incident?
- Job type apa yang gagal?
- Error message apa yang tercatat?
- Variable terakhir apa?
- Versi BPMN mana yang dipakai?
- Apakah timer/message/user task sedang menunggu?

Namun Operate tidak otomatis menjawab:

- Kenapa external API lambat?
- Apakah worker thread pool penuh?
- Apakah database worker deadlock?
- Apakah idempotency store menolak duplicate?
- Apakah projection lag?
- Apakah broker leader election baru terjadi?

Untuk top 1% engineering, Operate harus digabung dengan:

1. Worker logs.
2. Worker metrics.
3. Broker metrics.
4. Gateway metrics.
5. Secondary storage metrics.
6. Traces.
7. Domain database audit.
8. Deployment history.

### 8.3 Operate Anti-Pattern

Anti-pattern umum:

```text
Support hanya membuka Operate lalu menyimpulkan worker bug.
```

Better approach:

```text
Incident triage path:
1. Check process instance in Operate.
2. Identify BPMN element/job type.
3. Check incident error and retries.
4. Check worker logs by processInstanceKey/jobKey/correlationId.
5. Check external dependency metrics.
6. Check broker/exporter lag if UI looks stale.
7. Check deployment version compatibility.
8. Decide retry, repair variable, cancel, compensate, or deploy fix.
```

---

## 9. Tasklist

### 9.1 Peran Tasklist

Tasklist adalah UI/API untuk human tasks. Ia memfasilitasi user untuk melihat, claim, assign, dan complete tasks.

Human task bukan hanya “UI form”. Dalam proses enterprise, human task adalah boundary untuk:

1. Authorization.
2. Accountability.
3. Maker-checker control.
4. SLA deadline.
5. Evidence capture.
6. Decision audit.
7. Assignment workload.
8. Escalation.

### 9.2 Tasklist Bukan Domain Case Management Lengkap

Untuk workflow sederhana, Tasklist bisa cukup. Untuk regulatory/case-heavy system, Tasklist sering hanya salah satu komponen.

Contoh kebutuhan yang sering melampaui Tasklist default:

- Complex case dashboard.
- Multi-entity relationship view.
- Document/evidence management.
- Role-specific queues.
- Field-level authorization.
- Case state timeline.
- Advanced search across business data.
- Integration dengan correspondence, appeal, enforcement, inspection, legal review.
- Custom audit explanations.

Dalam arsitektur seperti itu:

```text
Camunda Tasklist / Task APIs
        |
        +-- human task lifecycle

Custom Case UI
        |
        +-- domain data
        +-- task summary
        +-- document/evidence
        +-- business permissions
        +-- audit timeline
```

### 9.3 Human Task Failure Modes

| Failure | Penyebab | Dampak |
|---|---|---|
| Task tidak muncul | Projection lag, auth mapping salah, BPMN belum sampai user task | User tidak bisa kerja |
| Task muncul ke role salah | Candidate group salah, tenant/identity issue | Compliance breach |
| User complete task dengan variable invalid | Form validation lemah | Incident downstream |
| Task duplicate secara business | Process modelling/correlation salah | Double handling |
| Overdue tidak terdeteksi | Timer/SLA modelling lemah | SLA breach |

---

## 10. Optimize

### 10.1 Peran Optimize

Optimize adalah analytics/process intelligence layer. Ia membantu melihat bottleneck, cycle time, SLA, throughput, dan process improvement.

Optimize menjawab pertanyaan seperti:

- Berapa rata-rata waktu dari submission ke approval?
- Task mana yang paling sering menjadi bottleneck?
- Berapa banyak instance yang melewati SLA?
- Variant process mana yang paling mahal?
- Di mana retry/incident paling banyak muncul?

### 10.2 Optimize Bukan Monitoring Real-Time Murni

Optimize lebih cocok untuk:

- process analytics
- business performance review
- trend analysis
- continuous improvement
- executive/process owner reporting

Untuk alert real-time production, tetap butuh:

- broker metrics
- worker metrics
- logs
- traces
- infra monitoring
- custom business SLA monitors

### 10.3 Analytics Bias

Optimize/projection bisa misleading bila:

1. BPMN terlalu teknis dan tidak mencerminkan milestone bisnis.
2. Variable data quality buruk.
3. Process version berubah tanpa governance.
4. Incident recovery manual tidak terdokumentasi dengan baik.
5. Exporter lag/retention mengubah visibility.
6. Human task completion tidak merekam reason/decision secara eksplisit.

Top engineer tidak hanya melihat dashboard, tetapi bertanya:

> “Apakah process model kita cukup representatif untuk menghasilkan analytics yang benar?”

---

## 11. Identity, Admin, dan Security Boundary

### 11.1 Peran Identity/Admin

Identity/Admin mengelola access dan permission untuk komponen platform. Dalam Camunda 8 modern, ada pemisahan/penataan antara access orchestration cluster dan broader platform/management components tergantung versi/topologi.

Yang penting untuk engineer:

1. Client/worker butuh credential/token untuk akses API.
2. Operate/Tasklist/Optimize user butuh login dan permission.
3. Candidate group/task authorization harus sesuai dengan identity mapping.
4. Tenant boundary harus jelas bila multi-tenant aktif.
5. Secret worker tidak boleh disebar sembarangan.
6. OAuth client credentials harus lifecycle-managed.

### 11.2 Worker Security

Worker adalah aplikasi bisnis. Ia biasanya memiliki akses ke:

- Camunda API
- domain database
- external APIs
- secret manager
- message broker
- object storage
- internal services

Karena itu worker sering lebih berbahaya daripada UI.

Security checklist worker:

1. Gunakan credential khusus per worker/app.
2. Jangan gunakan admin token untuk worker runtime.
3. Batasi network access.
4. Simpan secret di secret manager/Kubernetes Secret/SSM/Vault.
5. Rotate credential.
6. Log tanpa PII/token.
7. Correlate tanpa membocorkan sensitive payload.
8. Pastikan tenant-aware bila multi-tenant.
9. Fail closed pada unauthorized response.
10. Monitor auth failure spike.

### 11.3 Human Task Security

Untuk Tasklist/custom task UI:

- Candidate group harus sesuai role bisnis.
- Claim/complete harus authorization-checked.
- Variable yang ditampilkan harus dimasking bila sensitif.
- Assignment change harus diaudit.
- Maker-checker tidak boleh bisa dilakukan user yang sama bila policy melarang.
- Delegation harus memiliki reason.
- Bulk actions harus punya guardrail.

---

## 12. Connectors

### 12.1 Peran Connectors

Connectors menyediakan cara integrasi dengan external system melalui template/configuration, sehingga tidak semua service task harus dibuat sebagai custom Java worker.

Connector cocok untuk:

- HTTP call sederhana.
- SaaS integration standar.
- Low-code integration.
- Reusable integration template.
- Process automation yang tidak butuh custom transaction/idempotency kompleks.

Java worker lebih cocok untuk:

- Complex business rule.
- Idempotency ketat.
- External side effect berisiko.
- Multi-step integration.
- Legacy protocol.
- Transactional outbox.
- Custom retry/fallback.
- High-throughput optimization.
- Deep domain validation.

### 12.2 Connector Runtime Failure

Connector juga runtime. Ia bisa gagal karena:

- credential salah
- endpoint down
- timeout
- bad payload mapping
- rate limit
- network policy
- connector version mismatch
- secret unavailable

Jadi connector bukan “magic integration”. Ia tetap butuh observability, retry design, dan security review.

---

## 13. Web Modeler dan Desktop Modeler

### 13.1 Design-Time vs Runtime

Modeler digunakan untuk membuat BPMN, DMN, dan forms. Namun modeler bukan runtime source of truth untuk process instance.

Lifecycle umum:

```text
Model BPMN
   |
Review model
   |
Validate contracts
   |
Deploy to Camunda
   |
Run process instances
   |
Observe via Operate/Tasklist/Optimize
```

### 13.2 Model Governance

Dalam enterprise, model deployment harus dianggap seperti code deployment.

Harus ada:

1. Version control.
2. Review process.
3. Naming convention.
4. Job type compatibility check.
5. Variable contract check.
6. BPMN linting/model validation.
7. Environment promotion.
8. Rollback plan.
9. Release notes.
10. Impact analysis for running instances.

BPMN bukan gambar dokumentasi. BPMN adalah executable artifact.

---

## 14. Console

Console biasanya digunakan untuk management/deployment experience, terutama SaaS atau self-managed management layer tertentu.

Engineer harus membedakan:

- Console untuk management/deployment/administration.
- Operate untuk runtime process operation.
- Tasklist untuk human work.
- Optimize untuk analytics.
- Identity/Admin untuk access control.
- Zeebe API untuk execution commands.

Jangan campur mental model UI. Setiap UI menjawab pertanyaan berbeda.

---

## 15. Command Path Detail

Mari lihat contoh command: Java app ingin membuat process instance.

```text
Java Application
  |
  | createProcessInstance(processId, variables)
  v
Camunda Java Client
  |
  v
Zeebe Gateway / Orchestration API
  |
  v
Find target partition / broker leader
  |
  v
Broker validates command
  |
  v
Broker appends record
  |
  v
Broker mutates process state
  |
  v
Response returned to client
```

Hal penting:

1. Response command bukan berarti Operate langsung update.
2. Process may advance until wait state/job/timer/user task.
3. If service task reached, broker creates job.
4. Worker later activates that job.
5. Completion is another command.

Contoh lifecycle:

```text
create instance
   |
   v
start event entered
   |
   v
service task entered
   |
   v
job created
   |
   v
worker activates job
   |
   v
worker calls external system
   |
   v
worker completes job
   |
   v
next BPMN element
```

---

## 16. Read Path Detail

Setelah broker memproses state, records perlu diekspor agar UI/read APIs melihatnya.

```text
Broker internal records
   |
   v
Exporter reads records
   |
   v
Writes to secondary storage
   |
   v
Operate/Tasklist/Optimize reads projection
```

Ini berarti read path punya latency dan failure sendiri.

### 16.1 Command Succeeded, UI Belum Kelihatan

Skenario:

1. Java client create process instance berhasil.
2. Broker sudah punya state.
3. Exporter belum selesai menulis ke secondary storage.
4. User membuka Operate dan belum menemukan instance.
5. Engineer junior mengira process tidak jalan.

Staff-level diagnosis:

- Check client command response.
- Check broker metrics/logs.
- Check exporter lag.
- Check secondary storage health.
- Check Operate query/index refresh.

### 16.2 UI Shows Incident, But Worker Already Fixed It

Skenario lain:

1. Incident muncul di Operate.
2. Worker problem sudah diperbaiki dan retry command dikirim.
3. Broker state sudah maju.
4. Operate masih menampilkan stale incident sebentar karena projection delay.

Kesimpulan:

> Jangan langsung mengambil keputusan destructive hanya berdasarkan satu read-side view tanpa memahami freshness-nya.

---

## 17. Job Worker dalam Arsitektur Platform

Worker adalah client yang mengambil jobs dari broker melalui gateway/API. Worker berada di luar Zeebe cluster.

```text
Zeebe Broker
   |
   | creates job(type = "verify-customer")
   v
Zeebe Gateway
   |
   | worker activates job
   v
Java Worker App
   |
   | execute business logic
   v
External API / DB / Service
   |
   | complete/fail/throw error
   v
Zeebe Gateway -> Broker
```

### 17.1 Worker Scaling Terpisah

Camunda 8 memberi separation of concerns:

- Broker scaling untuk orchestration processing.
- Worker scaling untuk business execution.
- Storage scaling untuk projections.
- UI scaling untuk human/ops access.

Ini bagus, tetapi membuat capacity planning lebih kompleks.

### 17.2 Worker Tidak Boleh Dianggap Reliable by Default

Worker bisa:

- crash setelah external API sukses tapi sebelum complete job
- timeout karena GC pause
- mengambil job lalu pod terminate
- menerima duplicate activation setelah timeout
- gagal parse variable karena schema berubah
- mengirim completion command tapi network timeout
- salah tenant credential
- overload thread pool

Karena itu Part 006 dan Part 007 nanti akan sangat fokus pada worker correctness.

Untuk sekarang, cukup pegang prinsip:

> **Zeebe makes work durable. Worker makes business effects. Durable work does not automatically make business effects exactly-once.**

---

## 18. Deployment Shape: SaaS vs Self-Managed

### 18.1 SaaS

Dalam Camunda 8 SaaS, banyak komponen platform dikelola oleh Camunda. Engineer aplikasi fokus pada:

- client connectivity
- credentials
- worker design
- BPMN deployment
- task/user integration
- observability di aplikasi sendiri
- network egress/security
- tenant/cluster/org setup

Anda tidak mengelola broker disk, gateway pods, Elasticsearch, Helm chart, atau internal platform scaling secara langsung.

Kelebihan:

- operational burden lebih rendah
- faster setup
- managed upgrades
- managed reliability baseline

Trade-off:

- less infrastructure control
- network/compliance constraints
- dependency on SaaS availability
- data residency/regulatory consideration
- limited direct broker internals access

### 18.2 Self-Managed

Dalam self-managed, Anda bertanggung jawab atas platform runtime.

Anda perlu memikirkan:

- Kubernetes topology
- broker replicas
- partition count
- replication factor
- persistent volume
- gateway scaling
- secondary storage
- Identity/Admin
- TLS/ingress
- backup/restore
- upgrade
- monitoring
- retention
- security patching
- disaster recovery

Self-managed cocok bila:

- data residency ketat
- network isolation wajib
- enterprise platform standard mengharuskan internal hosting
- compliance membutuhkan kontrol lebih besar
- high customization diperlukan

Namun self-managed membutuhkan team yang paham distributed systems.

### 18.3 Anti-Pattern Self-Managed

Anti-pattern:

```text
Install Helm chart default lalu dianggap production-ready.
```

Production-ready membutuhkan:

1. Sizing.
2. Storage design.
3. AZ placement.
4. Security hardening.
5. Backup/restore drill.
6. Upgrade rehearsal.
7. Observability.
8. Runbook.
9. Load test.
10. Incident ownership.

---

## 19. Network Topology Mental Model

Dalam enterprise Kubernetes, topology bisa seperti:

```text
External Users
   |
   v
Ingress / WAF / ALB
   |
   +--> Operate UI
   +--> Tasklist UI
   +--> Optimize UI
   +--> Identity/Auth

Internal Services / Workers
   |
   v
Internal Service / Gateway Endpoint
   |
   v
Zeebe Gateway
   |
   v
Zeebe Brokers
   |
   v
Secondary Storage / Exporter
```

Prinsip desain:

1. Jangan expose broker langsung.
2. Worker internal sebaiknya memakai internal endpoint.
3. UI endpoint berbeda dari worker/API endpoint.
4. TLS termination jelas.
5. Auth boundary jelas.
6. Network policy membatasi akses.
7. Secondary storage tidak dibuka ke aplikasi umum.
8. Admin endpoint tidak sama dengan public endpoint.

---

## 20. Storage Architecture

### 20.1 Broker Storage

Broker butuh persistent storage untuk log/state/snapshot. Storage ini critical untuk execution durability.

Karakteristik penting:

- low latency disk
- stable persistent volume
- sufficient IOPS
- reliable fsync behavior
- backup/restore compatibility
- avoid noisy neighbor

Disk pressure pada broker bisa menjadi fatal untuk processing.

### 20.2 Secondary Storage

Secondary storage digunakan untuk projection/read/search. Dalam banyak deployment, ini Elasticsearch/OpenSearch, meskipun konsep terbaru menggunakan istilah lebih umum **secondary storage** karena backend bisa bergantung pada fitur/versi/deployment.

Read-side storage dipakai untuk:

- Operate search/view
- Tasklist visibility
- Optimize analytics
- search APIs
- historical/projection use cases

Storage ini bukan primary engine state, tetapi sangat penting untuk usability.

### 20.3 Storage Failure Distinction

| Storage | Jika Bermasalah | Dampak |
|---|---|---|
| Broker storage | Engine execution terancam | Critical runtime failure |
| Secondary storage | UI/read/projection terganggu | Ops/human/analytics impaired |
| Worker domain DB | Business execution gagal | Job failure/incident |
| Audit DB | Compliance visibility terganggu | Audit/reporting risk |

Top engineer membedakan storage mana yang gagal sebelum menentukan response.

---

## 21. Failure Surface Map

Camunda 8 platform failure tidak tunggal. Berikut peta mentalnya:

```text
Client Layer
  - bad credentials
  - timeout config
  - connection pool exhaustion
  - wrong endpoint

Gateway Layer
  - unavailable
  - overloaded
  - cannot route
  - auth/TLS issue

Broker Layer
  - leader election
  - partition unavailable
  - disk pressure
  - backpressure
  - replication lag

Exporter Layer
  - exporter lag
  - export failure
  - bad secondary storage

Read/UI Layer
  - Operate stale
  - Tasklist stale
  - Optimize delayed
  - index/search issue

Worker Layer
  - crash
  - slow external dependency
  - bad variable schema
  - duplicate side effect
  - thread starvation

Identity Layer
  - token failure
  - wrong role/group mapping
  - tenant mismatch

Infrastructure Layer
  - DNS
  - ingress
  - network policy
  - Kubernetes scheduling
  - node pressure
  - storage class issue
```

Dalam incident nyata, beberapa layer bisa gagal bersamaan.

Contoh:

```text
External API slow
   -> worker processing latency naik
   -> jobs time out
   -> retries naik
   -> incidents naik
   -> broker records naik
   -> exporter lag naik
   -> Operate terlihat lambat
   -> support mengira Operate problem
```

Root cause sebenarnya external API/worker timeout design, bukan Operate.

---

## 22. Command Path vs Query Path: Rule of Thumb

Gunakan rule berikut:

```text
For decisions that change the world, use command-side truth or domain truth.
For humans and analysis, use projection-side truth with freshness awareness.
```

Contoh:

| Use Case | Jangan | Lebih Baik |
|---|---|---|
| Cegah duplicate submission | Query Operate dulu | Domain idempotency table/business key constraint |
| Cek apakah payment sudah dikirim | Search process variable di Operate | Payment domain DB/idempotency key |
| Tampilkan support timeline | Broker internal access | Operate/custom projection |
| Hitung SLA monthly | Worker logs manual | Optimize/custom analytics projection |
| Retry failed task | Restart app sembarang | Operate incident + worker fix + controlled retry |

---

## 23. Camunda 8 Architecture Through Java Engineer Lens

Untuk Java engineer, Camunda 8 architecture harus diterjemahkan ke application design.

### 23.1 Java Client App Types

Ada beberapa tipe aplikasi Java:

1. **Process starter service**  
   Membuat process instance berdasarkan event/request bisnis.

2. **Job worker service**  
   Mengambil dan mengeksekusi jobs.

3. **Message publisher service**  
   Mengirim message correlation ke process.

4. **Task API facade**  
   Mengintegrasikan custom UI dengan task APIs.

5. **Audit/projection consumer**  
   Membaca exported data atau membuat read model bisnis.

6. **Admin/support tool**  
   Membantu retry, cancel, repair, atau investigate.

Satu service bisa memegang lebih dari satu peran, tetapi boundary harus jelas.

### 23.2 Typical Java Worker Runtime

```text
Spring Boot Worker App
  |
  +-- Camunda Java Client
  +-- Worker handlers
  +-- Domain services
  +-- DB repositories
  +-- External API clients
  +-- Idempotency service
  +-- Observability/logging
  +-- Configuration/secrets
```

Worker handler harus tipis:

```text
Job Handler
  -> parse variables
  -> validate contract
  -> call domain service
  -> map result to process variables
  -> complete/fail/throw BPMN error
```

Jangan taruh seluruh business logic di method handler. Handler adalah adapter antara Zeebe job contract dan domain logic.

---

## 24. Architecture-Level Naming Discipline

Naming menentukan operability.

### 24.1 BPMN Process ID

Gunakan nama stabil dan domain-oriented:

```text
regulatory-application-review
license-renewal-processing
case-enforcement-lifecycle
appeal-review-process
```

Hindari:

```text
process1
new-flow
application-v2-final-final
```

### 24.2 Job Type

Job type adalah contract antara BPMN dan worker.

Bagus:

```text
verify-applicant-identity.v1
calculate-renewal-fee.v1
send-approval-notification.v1
sync-case-status-to-crm.v1
```

Buruk:

```text
serviceTask
javaDelegate
callApi
worker1
```

### 24.3 Variable Names

Bagus:

```json
{
  "applicationId": "APP-2026-00001",
  "applicantId": "P-123",
  "reviewOutcome": "APPROVED",
  "decisionReasonCode": "ALL_REQUIREMENTS_MET"
}
```

Buruk:

```json
{
  "data": "... huge blob ...",
  "flag": true,
  "x": "OK",
  "obj": {}
}
```

### 24.4 Correlation Key

Correlation key harus:

- stable
- unique enough
- not sensitive when possible
- deterministic
- tenant-aware if needed
- indexed/traceable in domain systems

Contoh:

```text
tenantId + ':' + applicationId
```

atau

```text
caseReferenceNo
```

---

## 25. Platform Architecture Diagrams

### 25.1 Minimal Logical Architecture

```text
+--------------------+        +--------------------+
| Java Services      |        | Human Users        |
| - starters         |        | - operators        |
| - workers          |        | - reviewers        |
| - message pubs     |        | - admins           |
+---------+----------+        +---------+----------+
          |                             |
          v                             v
+--------------------+        +--------------------+
| Zeebe Gateway/API  |        | Operate/Tasklist   |
+---------+----------+        +---------+----------+
          |                             |
          v                             v
+--------------------+        +--------------------+
| Zeebe Brokers      |------->| Secondary Storage  |
| partitions/log     | export | projections/search |
+--------------------+        +--------------------+
```

### 25.2 Production-Oriented Architecture

```text
                            +-----------------------+
                            | Identity / Admin      |
                            | AuthN/AuthZ/Roles     |
                            +-----------+-----------+
                                        |
+-------------------+                   |
| External Users    |                   |
+---------+---------+                   |
          |                             |
          v                             v
+-------------------+        +-----------------------+
| Ingress/WAF/TLS   |------->| Operate / Tasklist    |
+-------------------+        | Optimize / Console    |
                             +-----------+-----------+
                                         |
                                         v
                             +-----------------------+
                             | Secondary Storage     |
                             | Search/Projection     |
                             +-----------+-----------+
                                         ^
                                         |
                               exported records
                                         |
+-------------------+        +-----------+-----------+
| Java Worker Apps  |------->| Zeebe Gateway/API     |
| Java 17/21/25     |        +-----------+-----------+
+---------+---------+                    |
          |                              v
          |                  +-----------------------+
          |                  | Zeebe Broker Cluster  |
          |                  | Partitioned Runtime   |
          |                  +-----------------------+
          v
+-------------------+
| Domain Systems    |
| DB/APIs/Queues    |
+-------------------+
```

### 25.3 Failure-Oriented View

```text
Request/API Failure?
  -> client/gateway/auth/network

Process Not Moving?
  -> broker/partition/job/worker/timer/message

Job Failing?
  -> worker/domain/external dependency/variable contract

UI Stale?
  -> exporter/secondary storage/Operate/Tasklist

Human Cannot See Task?
  -> Tasklist projection/Identity/group/tenant/BPMN state

Analytics Wrong?
  -> Optimize/projection/data quality/model semantics
```

---

## 26. Camunda 7 vs Camunda 8 Architecture Review

Karena Anda sudah mempelajari Camunda 7, bagian ini penting untuk mencegah transfer mental model yang salah.

### 26.1 JavaDelegate vs Job Worker

Camunda 7:

```java
public class VerifyApplicantDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        // business code near engine transaction
    }
}
```

Camunda 8:

```text
BPMN service task -> job type -> external Java worker -> complete/fail/error command
```

Konsekuensi:

- Tidak ada shared engine DB transaction dengan worker.
- Worker harus idempotent.
- Variables dikirim lewat API.
- Worker bisa scale independent.
- Failure after side effect is normal scenario.

### 26.2 Cockpit vs Operate

Camunda 7 Cockpit membaca dari engine database/history. Camunda 8 Operate membaca projection/exported data.

Jadi troubleshooting harus mempertimbangkan exporter lag.

### 26.3 ACT_RU/ACT_HI Tables vs Zeebe Records

Camunda 7 engineer sering ingin query database engine langsung.

Camunda 8 mindset:

- Jangan query broker storage langsung untuk business logic.
- Gunakan APIs, Operate, Tasklist, Optimize, exported records/projections.
- Buat custom read model bila perlu.

### 26.4 Embedded Engine vs Remote Engine

Camunda 7 embedded style:

```text
Service method
  -> process engine API
  -> same JVM/DB transaction possibilities
```

Camunda 8 style:

```text
Service method
  -> remote command
  -> asynchronous distributed runtime
  -> worker executes later
```

Ini mengubah desain transaction, error handling, testing, dan monitoring.

---

## 27. Architectural Invariants

Invariants adalah aturan yang harus tetap benar walaupun implementasi berubah.

### Invariant 1 — Process Instance State Lives in Zeebe Broker

Operate, Tasklist, Optimize bukan primary execution state.

### Invariant 2 — Java Worker Execution Is External

Business effect terjadi di luar broker.

### Invariant 3 — Job Execution Is At-Least-Once from Business Perspective

Worker harus tahan duplicate execution.

### Invariant 4 — Projection Is Eventually Consistent

UI/read-side bisa tertinggal dari broker.

### Invariant 5 — Variables Are Contracts

Variable bukan random map. Ia adalah API contract antara BPMN dan worker.

### Invariant 6 — Job Type Is a Versioned Interface

Mengubah job type/variable tanpa kompatibilitas sama seperti breaking API.

### Invariant 7 — Engine Scaling, Worker Scaling, and Storage Scaling Are Separate

Menambah worker tidak selalu menyelesaikan broker/exporter/storage bottleneck.

### Invariant 8 — Operational Debugging Must Be Cross-Layer

Process incident bisa berakar dari worker, auth, external API, broker, exporter, atau BPMN modelling.

### Invariant 9 — BPMN Is Executable Architecture

BPMN bukan diagram tempelan dokumentasi.

### Invariant 10 — Production Camunda 8 Is a Distributed System

Harus dirancang dengan failure, latency, partial visibility, retry, and recovery sejak awal.

---

## 28. Practical Scenario: Application Review Workflow

Misalkan proses regulatory application review:

```text
Application Submitted
  -> Validate Application
  -> Verify Applicant Identity
  -> Check Eligibility
  -> Human Review
  -> Approve / Reject
  -> Send Notification
  -> Archive Case
```

### 28.1 Platform Execution

```text
1. Application service creates process instance.
2. Zeebe broker starts instance.
3. Broker creates job: validate-application.v1.
4. Java validation worker activates job.
5. Worker reads application data from domain DB.
6. Worker completes job with validation result.
7. Broker moves to identity verification task.
8. Worker calls external identity service.
9. External call succeeds but worker crashes before completion.
10. Job times out.
11. Another worker reactivates job.
12. Idempotency key prevents duplicate identity verification side effect.
13. Worker completes job.
14. Process moves to human review.
15. Tasklist displays task after projection update.
16. Reviewer completes task.
17. Broker moves to notification job.
18. Notification worker sends email and records notification id.
19. Process completes.
20. Optimize later reports cycle time.
```

### 28.2 Where Each Component Appears

| Step | Component |
|---|---|
| Start process | Java client + Gateway + Broker |
| Create job | Broker |
| Execute validation | Java worker |
| Show human task | Exporter + Tasklist projection |
| Troubleshoot stuck review | Operate |
| Authenticate reviewer | Identity/Admin |
| Analyze SLA | Optimize |
| Store business application | Domain DB, not Zeebe variable blob |
| Audit decision | Domain audit + exported process records |

### 28.3 Architecture Lesson

The process is not just BPMN. It is a coordinated distributed architecture.

---

## 29. Production Readiness Questions

Sebelum sebuah Camunda 8 architecture diterima, ajukan pertanyaan berikut.

### 29.1 Platform

1. SaaS atau self-managed?
2. Jika self-managed, siapa owner cluster?
3. Berapa broker?
4. Berapa partition?
5. Berapa replication factor?
6. Bagaimana storage class broker?
7. Bagaimana backup/restore?
8. Bagaimana upgrade minor version?
9. Bagaimana monitor broker health?
10. Bagaimana monitor exporter lag?

### 29.2 Gateway/API

1. Endpoint mana untuk worker?
2. Endpoint mana untuk UI?
3. Auth mode apa?
4. Token rotation bagaimana?
5. Timeout/retry client bagaimana?
6. gRPC/REST dipilih karena apa?
7. Apakah network policy membatasi akses?

### 29.3 Worker

1. Job type apa saja?
2. Variable contract apa?
3. Idempotency key apa?
4. Retry taxonomy apa?
5. Worker concurrency berapa?
6. Timeout job berapa?
7. Apa external dependency bottleneck?
8. Apa graceful shutdown strategy?
9. Apa logging correlation fields?
10. Apa metric critical?

### 29.4 BPMN

1. Apakah model terlalu teknis?
2. Apakah service task granularity tepat?
3. Apakah business error vs technical retry jelas?
4. Apakah timers mencerminkan SLA nyata?
5. Apakah human tasks punya candidate group benar?
6. Apakah correlation key aman?
7. Apakah versioning strategy jelas?
8. Apakah running instances terdampak deployment baru?

### 29.5 Read/Projection

1. Operate dipakai untuk apa?
2. Tasklist cukup atau butuh custom UI?
3. Optimize butuh data apa?
4. Retention projection berapa lama?
5. Apakah exporter lag dimonitor?
6. Apakah secondary storage sizing cukup?
7. Apakah audit perlu custom projection?

---

## 30. Common Architecture Smells

### Smell 1 — Semua Data Dimasukkan ke Variable

Gejala:

- Variable payload besar.
- Operate lambat.
- Exporter lag.
- Sensitive data tersebar.
- Worker parse object raksasa.

Solusi:

- Store business data in domain DB.
- Store references and orchestration facts in variables.

### Smell 2 — BPMN Menjadi Microservice Call Graph

Gejala:

- Puluhan service task kecil untuk detail teknis.
- Model sulit dibaca business user.
- Exported records sangat banyak.
- Change kecil di API mengubah BPMN.

Solusi:

- BPMN untuk business milestones dan orchestration boundaries.
- Technical composition tetap di worker/domain service.

### Smell 3 — Worker Tidak Idempotent

Gejala:

- Duplicate email.
- Duplicate payment.
- Duplicate external ticket.
- Retry menyebabkan kerusakan data.

Solusi:

- Idempotency table.
- External reference key.
- Outbox/fencing.
- Completion-safe design.

### Smell 4 — Operate Dijadikan Business Query API

Gejala:

- Aplikasi bergantung pada Operate search untuk validasi transaksi.
- Race condition saat projection lag.
- Incident ketika index delay.

Solusi:

- Gunakan domain DB/idempotency store untuk command decision.
- Gunakan projection untuk observability/search.

### Smell 5 — Tidak Ada Version Contract

Gejala:

- BPMN baru deploy, worker lama gagal parse variable.
- Job type berubah tanpa worker release.
- Running instances incident massal.

Solusi:

- Versioned job type.
- Backward compatible variable schema.
- Release coordination.

### Smell 6 — Self-Managed Tanpa Distributed Systems Ownership

Gejala:

- Tidak ada broker metrics.
- Tidak tahu partition leader.
- Tidak ada restore drill.
- Secondary storage penuh baru ketahuan.

Solusi:

- Treat platform as critical distributed system.
- Assign ownership.
- Build runbook.
- Load test and DR test.

---

## 31. What Top 1% Engineers See Differently

Engineer biasa melihat Camunda 8 sebagai:

```text
BPMN + worker code + UI
```

Engineer yang lebih matang melihat:

```text
Durable distributed orchestration system
  + remote command API
  + partitioned execution log
  + external side-effect workers
  + eventually consistent projections
  + human task access model
  + analytics pipeline
  + security boundary
  + operational failure surface
```

Perbedaan cara pikir:

| Surface Thinking | Deep Engineering Thinking |
|---|---|
| “Service task manggil API” | “Job creates at-least-once external side-effect obligation” |
| “Operate belum update” | “Projection path may be lagging behind broker state” |
| “Worker gagal, retry saja” | “Is this transient, business, deterministic, or poison data?” |
| “Tambah replica worker” | “Which layer is bottleneck: broker, partition, worker, dependency, exporter, storage?” |
| “BPMN deploy baru” | “What happens to running old instances and worker contract compatibility?” |
| “Task assigned to group” | “Does identity mapping, tenant, role, and audit satisfy compliance?” |
| “Camunda stores process data” | “Camunda stores orchestration state; domain owns business truth.” |

---

## 32. Minimal Vocabulary You Must Master

| Term | Meaning |
|---|---|
| Broker | Runtime node that processes workflow state |
| Gateway | Client entry point/router to broker cluster |
| Partition | Shard of ordered process event stream/state |
| Leader | Broker responsible for processing a partition |
| Follower | Broker replicating partition for HA |
| Record | Log entry representing command/event/state-related fact |
| Exporter | Component writing records to external/projection storage |
| Projection | Read model derived from engine records |
| Operate | Operational UI/read model for process instances/incidents |
| Tasklist | Human task UI/API |
| Optimize | Analytics/process intelligence component |
| Identity/Admin | Access control management |
| Job | Unit of work created by service task/external task-like execution |
| Worker | External application that activates and completes/fails jobs |
| Job type | Contract key between BPMN service task and worker |
| Variable | Process orchestration data available to BPMN/workers |
| Incident | Engine-visible unresolved failure requiring action |
| Correlation key | Key used to match messages to waiting process instances |
| Tenant | Isolation/security dimension in multi-tenant deployments |
| Secondary storage | Read/search/projection backend used by UI/search components |

---

## 33. Hands-On Mental Exercise

Sebelum lanjut ke part berikutnya, coba jawab tanpa melihat dokumentasi:

1. Jika worker Java mati, apakah process instance hilang?
2. Jika gateway restart, apakah job yang sudah dibuat hilang?
3. Jika Operate belum menampilkan instance baru, apakah create process pasti gagal?
4. Jika Tasklist tidak menampilkan task, layer mana saja yang mungkin bermasalah?
5. Jika duplicate email terkirim, apakah itu bug Zeebe atau desain worker?
6. Jika self-managed cluster lambat, apakah cukup menambah pod worker?
7. Jika process variable berisi dokumen 5 MB, layer mana yang terdampak?
8. Jika process stuck di service task, data apa yang perlu dicek di Operate dan worker logs?
9. Jika migration dari Camunda 7 punya banyak JavaDelegate, apa perubahan arsitektur paling besar?
10. Jika Optimize menunjukkan bottleneck, apa yang perlu divalidasi sebelum mengambil keputusan bisnis?

Jawaban ringkas:

1. Tidak. Job bisa timeout/retry, process state di broker.
2. Tidak. Gateway stateless, state di broker.
3. Tidak. Bisa projection/exporter lag.
4. BPMN state, exporter, secondary storage, Tasklist, Identity/group/tenant, user permission.
5. Biasanya worker idempotency/side-effect design.
6. Tidak selalu; bottleneck bisa broker/exporter/storage/external API.
7. Broker, exporter, secondary storage, Operate, network, worker serialization.
8. BPMN element, job type, retries, incident error, variables, worker correlation logs, external dependency status.
9. JavaDelegate embedded logic menjadi external job worker dengan async/distributed boundary.
10. Data quality, model semantics, version changes, projection completeness, business context.

---

## 34. References

Referensi utama yang relevan untuk part ini:

1. Camunda 8 Docs — Zeebe Architecture  
   `https://docs.camunda.io/docs/components/zeebe/technical-concepts/architecture/`

2. Camunda 8 Docs — Zeebe Gateway  
   `https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/zeebe/zeebe-gateway/overview/`

3. Camunda 8 Docs — Partitions  
   `https://docs.camunda.io/docs/components/zeebe/technical-concepts/partitions/`

4. Camunda 8 Docs — Health  
   `https://docs.camunda.io/docs/components/zeebe/technical-concepts/health/`

5. Camunda 8 Docs — Self-Managed Overview  
   `https://docs.camunda.io/docs/self-managed/about-self-managed/`

6. Camunda 8 Docs — Reference Architecture  
   `https://docs.camunda.io/docs/self-managed/reference-architecture/`

7. Camunda 8 Docs — Secondary Storage  
   `https://docs.camunda.io/docs/self-managed/concepts/secondary-storage/configuring-secondary-storage/`

8. Camunda 8 Docs — Java Client Job Worker  
   `https://docs.camunda.io/docs/apis-tools/java-client/job-worker/`

9. Camunda Blog — Performance Tuning in Camunda 8  
   `https://camunda.com/blog/2025/01/performance-tuning-camunda-8/`

10. Camunda Blog — One Exporter to Rule Them All: Exploring Camunda Exporter  
    `https://camunda.com/blog/2025/02/one-exporter-to-rule-them-all-exploring-camunda-exporter/`

---

## 35. Ringkasan Part 001

Part ini membangun fondasi arsitektur Camunda 8:

1. Camunda 8 punya command/execution side dan read/projection side.
2. Zeebe Broker adalah source of truth untuk execution state.
3. Zeebe Gateway adalah stateless entry point/router, bukan storage state.
4. Partitions adalah shard ordered stream/state untuk scalability.
5. Exporters membawa broker records ke projection storage.
6. Operate, Tasklist, dan Optimize adalah read/experience layers dengan eventual consistency.
7. Java workers berada di luar engine dan harus dirancang sebagai external, retryable, idempotent executors.
8. SaaS dan self-managed memiliki operational responsibility yang sangat berbeda.
9. Production incident harus dianalisis lintas layer: client, gateway, broker, exporter, storage, UI, worker, identity, network.
10. Top-level engineering skill adalah memahami boundary: **engine truth, domain truth, projection truth, and human/analytics experience**.

---

## 36. Status Seri

Seri **belum selesai**.

Part yang sudah dibuat:

1. `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-000.md`
2. `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-001.md`

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-002.md
```

Judul:

```text
Zeebe Engine Internals: Event Stream, Commands, Records, State, and Deterministic Progress
```

Fokus berikutnya adalah masuk ke internal engine: command, event, rejection, record stream, state transition, job lifecycle, incident lifecycle, deterministic progress, dan bagaimana semua itu memengaruhi desain Java worker production-grade.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-000.md">⬅️ Part 000 — Orientation, Scope, Mental Model, and What Changes from Camunda 7</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-002.md">Part 002 — Zeebe Engine Internals: Event Stream, Commands, Records, State, and Deterministic Progress ➡️</a>
</div>

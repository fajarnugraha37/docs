# Learn Java BPMN + Camunda Process Orchestration Engineering

## Part 18 — Camunda 8 Deep Dive: Zeebe, Workers, Operate, Tasklist, Optimize, Identity

> Seri: `learn-java-bpmn-camunda-process-orchestration-engineering`  
> Level: Advanced / Production Engineering  
> Fokus: Java 8–25, BPMN, Camunda 8, Zeebe, distributed workflow runtime, operability, security, observability, and platform architecture

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membahas:

- BPMN sebagai execution contract.
- Perbedaan Camunda 7 dan Camunda 8.
- Zeebe mental model.
- Java Client dan worker engineering.
- Reliability worker.
- Process variables.
- Error, incident, escalation, compensation.
- Human workflow.
- DMN.
- Message correlation.
- Timers.
- Parallelism.
- Process composition.
- Saga.
- Camunda 7 internals.

Part ini memperbesar gambar Camunda 8 sebagai **platform orchestration**, bukan hanya engine.

Camunda 8 terdiri dari beberapa komponen. Beberapa komponen berada di jalur eksekusi proses, beberapa untuk operasi, beberapa untuk human task, beberapa untuk analytics, beberapa untuk identity/security, dan beberapa untuk developer modeling experience.

Top 1% engineer perlu bisa membedakan:

```text
Komponen yang mengeksekusi process
vs
Komponen yang membaca state process
vs
Komponen yang dipakai manusia/operator
vs
Komponen yang dipakai developer
vs
Komponen yang dipakai untuk integration convenience
vs
Komponen yang wajib untuk production
vs
Komponen yang optional tergantung kebutuhan
```

Kesalahan fatal dalam banyak implementasi Camunda 8 adalah memperlakukan semua komponen seolah-olah setara. Padahal tidak.

Zeebe adalah runtime execution core. Operate adalah operational read model. Tasklist adalah human task workbench. Optimize adalah analytics layer. Identity/authorization adalah access control plane. Connectors adalah integration abstraction. Modeler adalah design-time tool.

---

## 1. Camunda 8 sebagai Orchestration Platform

Camunda 8 bukan hanya BPMN engine. Ia adalah platform untuk:

1. Mendefinisikan proses.
2. Menjalankan proses.
3. Mengorkestrasi worker/service eksternal.
4. Mengelola human task.
5. Mengamati process instance.
6. Mengelola incident.
7. Mengukur performa proses.
8. Mengatur identity dan authorization.
9. Mengintegrasikan sistem eksternal.
10. Mendukung collaborative modeling.

Mental model besar:

```text
                 +------------------+
                 |     Modeler      |
                 | BPMN / DMN/Form  |
                 +---------+--------+
                           |
                           v
+--------------------------------------------------+
|              Camunda 8 Orchestration Cluster     |
|                                                  |
|  +--------+      +---------+      +-----------+  |
|  |Gateway | ---> | Brokers | ---> | Exporters |  |
|  +--------+      +---------+      +-----------+  |
|       ^              ^                 |         |
|       |              |                 v         |
|  Java Client     Runtime State     Search Store  |
|  REST/gRPC       Partitions        ES/OpenSearch |
+--------------------------------------------------+
       ^                                    ^
       |                                    |
       v                                    v
+-------------+                     +--------------+
| Job Workers |                     | Operate      |
| Java Apps   |                     | Tasklist     |
| Connectors  |                     | Optimize     |
+-------------+                     +--------------+
```

Jangan bayangkan Camunda 8 seperti library Java yang ditempel di aplikasi. Camunda 8 lebih mirip **distributed control plane** untuk long-running business process.

Aplikasi Java tidak menjalankan engine di dalam JVM-nya. Aplikasi Java berinteraksi dengan orchestration cluster melalui client API.

---

## 2. Komponen Utama Camunda 8

Komponen utama yang perlu dipahami:

| Komponen | Fungsi utama | Jalur kritikal eksekusi? |
|---|---|---|
| Zeebe Broker | Menyimpan dan memproses state workflow | Ya |
| Zeebe Gateway | Entry point client ke broker cluster | Ya |
| Java Client / API Client | Deploy/start/correlate/activate/complete/fail | Ya untuk aplikasi |
| Job Workers | Mengeksekusi work item eksternal | Ya |
| Operate | Observasi dan operasi process instance/incident | Tidak untuk execution, tapi kritikal untuk support |
| Tasklist | Human task inbox/workbench | Kritikal jika memakai user task |
| Optimize | Analytics, reporting, process improvement | Tidak untuk execution |
| Identity / Authorization | User, client, permission, access control | Kritikal untuk secure production |
| Connectors | Integrasi external system berbasis connector | Tergantung desain |
| Modeler | BPMN/DMN/forms design-time | Tidak runtime execution |
| Search store | Read model untuk Operate/Tasklist/Optimize | Kritikal untuk observability/UI |

Prinsip penting:

```text
Runtime truth lives in Zeebe.
Operational read model lives in exporter/search storage.
Human task experience lives in Tasklist.
Process analytics lives in Optimize.
Access control lives in Identity/authorization.
Integration behavior lives in workers/connectors.
```

---

## 3. Zeebe Broker: Execution Core

Zeebe Broker adalah komponen yang benar-benar menjalankan workflow.

Tugas broker:

1. Menyimpan deployed process definition.
2. Membuat process instance.
3. Menjalankan token flow BPMN.
4. Membuat jobs untuk service task.
5. Membuat subscriptions untuk message/timer.
6. Menyimpan process state.
7. Mengatur retries/incidents.
8. Menangani commands dari client.
9. Menghasilkan records untuk exporters.

Mental model:

```text
Client command
   -> Gateway
      -> Broker partition
         -> Stream processor
            -> Update process state
            -> Append event record
            -> Maybe create job/timer/subscription/incident
```

Broker bukan sekadar REST server. Broker adalah deterministic state machine yang memproses command/event stream.

### 3.1 Broker sebagai Stream Processor

Zeebe bekerja dengan log stream.

Setiap perubahan penting direpresentasikan sebagai record:

```text
PROCESS_INSTANCE_CREATED
ELEMENT_ACTIVATED
JOB_CREATED
JOB_ACTIVATED
JOB_COMPLETED
VARIABLE_CREATED
TIMER_CREATED
MESSAGE_SUBSCRIPTION_CREATED
INCIDENT_CREATED
```

Konsekuensinya:

- Execution adalah urutan record.
- Debugging bisa dilihat sebagai sequence of events.
- Exporter bisa membaca records dan membangun read model.
- State runtime dan state observability tidak selalu identik secara real-time.
- Eventual consistency antara broker dan UI/read model adalah normal.

### 3.2 Broker Bukan Database Domain

Broker menyimpan state proses, bukan domain ownership.

Contoh salah:

```text
Process variable:
{
  "application": {
    "allApplicantData": ...,
    "allDocuments": ...,
    "allAuditTrail": ...,
    "allOfficerNotes": ...
  }
}
```

Contoh benar:

```text
Process variable:
{
  "applicationId": "APP-2026-000123",
  "caseId": "CASE-2026-0042",
  "riskBand": "HIGH",
  "requiredReviewGroups": ["LEGAL", "FINANCE", "COMPLIANCE"],
  "slaDueAt": "2026-07-01T17:00:00+08:00"
}
```

Domain detail tetap di domain database.

Zeebe menyimpan execution context minimum yang dibutuhkan untuk routing dan decision flow.

---

## 4. Zeebe Gateway: Entry Point dan Routing Layer

Gateway adalah entry point client ke cluster.

Client tidak perlu tahu broker mana yang memegang partition tertentu. Gateway menerima request lalu meneruskan ke broker/partition yang tepat.

Tugas gateway:

1. Menerima command dari client.
2. Melakukan routing ke broker/partition.
3. Menyediakan endpoint API.
4. Menjadi load-balancing entry point.
5. Menyembunyikan internal broker topology dari client.

Mental model:

```text
Java Worker / Backend
        |
        v
  Zeebe Gateway
        |
        +--> Broker partition 1
        +--> Broker partition 2
        +--> Broker partition 3
```

Gateway idealnya stateless dari perspektif aplikasi. Scaling gateway membantu traffic ingress, tetapi tidak otomatis menaikkan kapasitas processing jika bottleneck ada pada broker partition atau external worker.

### 4.1 Gateway Failure Mode

Jika gateway bermasalah:

- Worker gagal activate jobs.
- Backend gagal start process.
- Message correlation gagal.
- Deployment gagal.

Namun process instance yang sudah berada di broker tidak otomatis hilang.

Worker harus memiliki:

- retry client-level,
- timeout wajar,
- observability,
- graceful degradation,
- startup readiness check.

### 4.2 Gateway Bukan API Gateway Bisnis

Jangan mengekspos Zeebe Gateway langsung ke browser atau public client.

Pattern yang lebih aman:

```text
Browser/UI
   -> Business Backend API
      -> Authorization + validation + audit
         -> Camunda Client
            -> Gateway
```

Business backend tetap menjadi enforcement point untuk authorization, validation, audit, and domain policy.

---

## 5. Partitions: Scalability Boundary

Zeebe memakai partition untuk scalability.

Partition adalah unit pemrosesan stream/state. Process instance ditempatkan pada partition tertentu. Job stream, timer, variables, dan process state diproses dalam konteks partition.

Mental model:

```text
Cluster
  Partition 1 -> subset of process instances
  Partition 2 -> subset of process instances
  Partition 3 -> subset of process instances
```

Keuntungan partitioning:

- horizontal scalability,
- isolation of processing load,
- distributed storage/processing,
- parallel processing antar partition.

Namun ada konsekuensi:

- process instance tertentu tetap diproses pada partition tertentu,
- hot process type bisa membebani partition tertentu jika distribusi tidak sehat,
- search/read model harus menggabungkan records dari banyak partition,
- exporter lag per partition perlu diamati.

### 5.1 Partition dan Process Instance

Jangan berpikir satu process instance bisa diproses bebas oleh semua broker pada saat yang sama.

Untuk consistency, state process instance perlu deterministik.

Jika semua step process instance yang sama bisa diproses bebas oleh banyak node tanpa koordinasi, race condition akan sulit dikendalikan.

### 5.2 Scaling Bukan Hanya Menambah Worker

Throughput workflow ditentukan oleh beberapa bottleneck:

```text
process start rate
+ broker processing capacity
+ partition distribution
+ job worker activation/completion rate
+ external dependency latency
+ search/export lag
+ human task backlog
```

Menambah worker tidak membantu jika:

- external API rate-limited,
- broker partition saturated,
- variable payload terlalu besar,
- Elasticsearch/OpenSearch lambat,
- business process menunggu user task,
- gateway/network bottleneck.

---

## 6. Replication and Fault Tolerance Mental Model

Dalam production, broker state perlu fault tolerant.

Replication membantu menjaga availability ketika node gagal. Namun replication bukan sihir yang membuat semua failure hilang.

Engineer perlu memahami trade-off:

| Area | Pertanyaan penting |
|---|---|
| replication factor | Berapa copy data yang tersedia? |
| leader/follower | Node mana yang aktif memproses partition? |
| failover | Apa yang terjadi saat leader mati? |
| quorum | Berapa node minimum agar cluster tetap menerima write? |
| disk | Apakah storage cukup dan reliable? |
| network | Apakah latency antar node stabil? |
| backup | Apakah state bisa dipulihkan? |

Failure mode yang harus dipikirkan:

1. Broker pod crash.
2. Broker node lost.
3. Disk pressure.
4. Network partition.
5. Gateway cannot reach broker.
6. Exporter lag.
7. Search store outage.
8. Worker overload.
9. Misconfigured retries causing incident storm.

Top 1% mindset:

```text
High availability workflow bukan hanya cluster up.
High availability workflow berarti command, state transition, worker side effect,
read model, human task, and incident repair tetap punya jalur pemulihan yang jelas.
```

---

## 7. Job Workers: External Execution Model

Di Camunda 8, service task umumnya dieksekusi oleh external worker.

Worker melakukan:

1. Activate job.
2. Read variables.
3. Execute business/service logic.
4. Complete job dengan variable output, atau fail job, atau throw BPMN error.

Mental model:

```text
BPMN Service Task: "Validate Application"
        |
        v
Zeebe creates job type: validate-application
        |
        v
Java worker activates job
        |
        v
Worker calls domain service / DB / external API
        |
        +--> complete job
        +--> fail job with retries/backoff
        +--> throw BPMN error
```

### 7.1 Worker is a Business Adapter

Worker bukan tempat untuk sembarang logic proses.

Worker seharusnya menjadi adapter yang menghubungkan process step dengan domain capability.

Contoh:

```text
Bad worker:
- baca semua application data
- tentukan semua routing BPMN sendiri
- update semua status process
- decide next approver
- send email
- update document
- complete job
```

Contoh lebih baik:

```text
Worker: assess-application-risk
- validate input contract
- call RiskAssessmentService
- persist assessment result in domain DB
- publish audit/outbox if needed
- return minimal variable: riskBand, requiredReviewGroups
```

### 7.2 Worker Horizontal Scaling

Multiple worker instance bisa subscribe job type yang sama.

```text
validate-application worker x 5 pods
        |
        v
all compete to activate jobs of type validate-application
```

Konsekuensi:

- Worker handler harus stateless atau state-safe.
- Side effect harus idempotent.
- Concurrency harus dikontrol.
- External dependency perlu rate limit/bulkhead.
- Job timeout harus sesuai worst-case execution time.

### 7.3 Worker Type Design

Job type adalah contract.

Buruk:

```text
job type: service-task
job type: process-step
job type: execute
```

Baik:

```text
job type: application.validate-eligibility.v1
job type: document.generate-approval-letter.v1
job type: notification.send-decision-email.v1
job type: payment.verify-receipt.v1
```

Job type harus cukup spesifik untuk observability, ownership, and operational routing.

---

## 8. Operate: Operational Control Plane

Operate adalah UI/operational tool untuk melihat dan menangani process instances.

Operate biasanya dipakai untuk:

1. Melihat running process instance.
2. Melihat completed/cancelled instance.
3. Melihat current active element.
4. Melihat incident.
5. Melihat variable.
6. Melakukan retry/resolution pada incident.
7. Melakukan cancellation/migration tertentu.
8. Debugging operational process.

Mental model:

```text
Zeebe runtime records
     -> exporter
        -> search/read model
           -> Operate UI
```

Operate membaca read model, bukan langsung menjadi runtime state machine.

### 8.1 Operate Bukan Source of Truth Domain

Operate membantu melihat process execution, tetapi bukan pengganti:

- domain audit trail,
- case management timeline,
- user activity audit,
- regulatory decision record,
- document lifecycle record.

Dalam regulated systems, Operate adalah engineering/ops tool. Business-facing audit harus tetap disediakan oleh aplikasi/domain.

### 8.2 Incident Triage di Operate

Incident umum:

- job retries exhausted,
- BPMN error not caught,
- message correlation issue,
- expression evaluation failure,
- variable missing/wrong type,
- called process not found,
- connector failure,
- worker unavailable causing backlog.

Triage flow:

```text
1. Identify incident type.
2. Identify process instance / element / job type.
3. Inspect error message.
4. Check variable contract.
5. Check worker logs by correlation id.
6. Check external dependency state.
7. Decide repair path:
   - fix worker then retry
   - correct variable then retry
   - throw business error path if supported
   - cancel instance if invalid
   - migrate instance if model issue
8. Record audit/support note outside Operate if business impact exists.
```

Top engineer tidak hanya klik retry. Top engineer memahami apakah retry aman.

---

## 9. Tasklist: Human Task Workbench

Tasklist adalah UI/API layer untuk human tasks.

Tasklist dipakai ketika process memiliki user task.

Fitur utama:

1. Task inbox.
2. Task search/filter.
3. Task claim/assign.
4. Task completion.
5. Task forms.
6. Due date/follow-up date handling.
7. Candidate group/user based work distribution.
8. Integration dengan identity/authorization.

Mental model:

```text
BPMN User Task created in Zeebe
        |
        v
Export/read model
        |
        v
Tasklist displays task to user
        |
        v
User completes task
        |
        v
Task completion command sent to orchestration cluster
        |
        v
Process continues
```

### 9.1 Tasklist vs Custom Task UI

Pilihan desain:

| Option | Cocok untuk | Trade-off |
|---|---|---|
| Built-in Tasklist | internal operation, quick rollout, generic task UX | limited domain UX |
| Custom UI + Tasklist/API | domain-specific case management | more engineering effort |
| Custom task table + Camunda sync | heavy business task lifecycle | risk of duplicate state |

Untuk case management/regulatory system, sering kali custom UI dibutuhkan karena task tidak berdiri sendiri. User perlu melihat case context, documents, history, parties, risk, SLA, and authorization rules.

Namun custom UI harus hati-hati agar tidak membuat task lifecycle ganda yang conflicting dengan Camunda.

### 9.2 User Task Completion Must Be Domain-Safe

Jangan langsung complete task dari browser ke Camunda tanpa domain validation.

Lebih aman:

```text
Browser
  -> Case Backend: POST /cases/{id}/review-decision
      - authenticate
      - authorize action
      - validate case state
      - validate form fields
      - write domain decision/audit
      - complete Camunda user task
```

Masalah atomicity:

- domain write sukses tapi complete task gagal,
- complete task sukses tapi domain write gagal,
- user double click,
- stale task completed,
- task already reassigned.

Pattern yang matang memakai:

- idempotency key,
- optimistic locking,
- outbox/process command table,
- task completion reconciliation,
- audit trail.

---

## 10. Optimize: Analytics and Process Intelligence

Optimize adalah komponen analytics/reporting untuk memahami proses secara agregat.

Pertanyaan yang dijawab Optimize:

1. Berapa rata-rata durasi application approval?
2. Step mana yang paling lama?
3. Berapa banyak SLA breach?
4. Berapa backlog per officer/group?
5. Berapa incident rate per process version?
6. Berapa conversion/drop-off di process tertentu?
7. Apakah perubahan process mempercepat cycle time?

Operate menjawab:

```text
Apa yang terjadi pada instance ini sekarang?
```

Optimize menjawab:

```text
Apa pola performa proses secara agregat?
```

### 10.1 Optimize Bukan Data Warehouse Utama

Optimize membantu process analytics, tetapi enterprise/regulatory reporting sering tetap membutuhkan:

- domain data warehouse,
- audit data mart,
- official KPI definitions,
- reporting governance,
- retention policy,
- data lineage.

Process analytics harus direkonsiliasi dengan domain truth.

Contoh:

```text
Camunda says process completed at T1.
Domain says license issued at T2.
Email system says notification sent at T3.
```

Semua benar, tetapi menjawab pertanyaan yang berbeda.

---

## 11. Identity and Authorization

Production Camunda 8 harus mengatur siapa boleh melakukan apa.

Area akses:

1. Siapa boleh melihat process instance?
2. Siapa boleh melihat variable?
3. Siapa boleh retry incident?
4. Siapa boleh cancel instance?
5. Siapa boleh deploy process?
6. Siapa boleh complete task?
7. Worker client mana boleh activate job type tertentu?
8. Backend service mana boleh start process tertentu?

### 11.1 Human Identity vs Machine Identity

Ada dua identity besar:

```text
Human identity:
- officer
- supervisor
- admin
- operator
- auditor

Machine identity:
- Java worker app
- backend service
- connector runtime
- CI/CD deployment client
- monitoring client
```

Jangan mencampur keduanya.

Worker tidak seharusnya memakai credential admin manusia. Backend tidak seharusnya memakai credential shared tanpa ownership.

### 11.2 Authorization at Multiple Layers

Authorization perlu diterapkan di beberapa tempat:

```text
UI authorization
  -> apa yang user lihat
Backend authorization
  -> apa yang user boleh lakukan
Camunda authorization
  -> apa yang client/principal boleh akses di orchestration cluster
Domain authorization
  -> apa yang sah menurut business state/policy
Audit authorization
  -> siapa boleh melihat sensitive history
```

Camunda authorization penting, tetapi tidak menggantikan authorization domain.

Contoh:

Officer punya akses Tasklist untuk claim task. Namun apakah officer boleh approve case tertentu tergantung:

- agency,
- role,
- conflict of interest,
- maker-checker rule,
- task assignment,
- case status,
- delegation,
- effective appointment.

Itu domain authorization.

---

## 12. Connectors: Integration Abstraction

Connectors memungkinkan BPMN mengintegrasikan external systems dengan konfigurasi connector.

Contoh connector use case:

- HTTP call.
- Send email.
- Invoke SaaS API.
- Publish event.
- Retrieve data.

Connectors dapat mempercepat integrasi, tetapi bukan pengganti engineering judgment.

### 12.1 Connector vs Worker Decision

Gunakan connector ketika:

- integration sederhana,
- low business complexity,
- transformation ringan,
- security model jelas,
- idempotency mudah,
- tidak perlu domain transaction rumit.

Gunakan Java worker ketika:

- logic kompleks,
- butuh domain DB transaction,
- butuh idempotency table,
- butuh outbox/inbox,
- butuh rate limit custom,
- butuh circuit breaker,
- butuh reusable domain service,
- butuh complex error classification,
- butuh audit kuat.

Decision matrix:

| Concern | Connector | Java Worker |
|---|---:|---:|
| Simple HTTP call | Baik | Bisa |
| Complex domain transaction | Lemah | Baik |
| Idempotency repository | Terbatas | Baik |
| Versioned Java DTO | Lemah | Baik |
| Domain audit | Terbatas | Baik |
| Fast prototyping | Baik | Sedang |
| Regulated critical process | Hati-hati | Lebih cocok |

Top 1% engineer tidak anti-connector. Tapi ia tahu kapan connector mengurangi boilerplate dan kapan connector menyembunyikan failure mode penting.

---

## 13. Modeler: Design-time Process Engineering

Modeler adalah tempat membuat:

- BPMN diagrams,
- DMN decision tables,
- forms,
- connector templates/configuration.

Ada Web Modeler dan Desktop Modeler, tergantung setup.

Modeler bukan hanya drawing tool. Ia adalah tempat membuat executable artifact.

### 13.1 Modeling Governance

Untuk production, perlu governance:

1. Naming standard.
2. Versioning strategy.
3. Review checklist.
4. BPMN linting/validation.
5. DMN test case.
6. Process owner approval.
7. Developer review.
8. Security review.
9. Deployment promotion path.

BPMN artifact sebaiknya diperlakukan seperti source code:

```text
model.bpmn
decision.dmn
form.form
connector-template.json
```

Disimpan di Git, direview, diuji, dan dipromosikan lewat CI/CD.

---

## 14. Search Store / Exporter / Read Model

Zeebe runtime menghasilkan records. Records diekspor ke storage yang dipakai Operate/Tasklist/Optimize.

Mental model:

```text
Zeebe partition records
       |
       v
Exporter
       |
       v
Elasticsearch/OpenSearch/read indices
       |
       +--> Operate
       +--> Tasklist
       +--> Optimize
```

Konsekuensi penting:

1. UI bisa tertinggal beberapa detik dari runtime.
2. Search result bergantung pada exporter/importer health.
3. Runtime bisa berjalan tetapi Operate/Tasklist terlihat stale jika exporter/search store bermasalah.
4. Troubleshooting harus membedakan runtime failure vs read model lag.

### 14.1 Runtime Healthy, UI Stale

Contoh:

- Worker complete job sukses.
- Process lanjut di Zeebe.
- Exporter lag.
- Operate masih menampilkan task lama.

Jangan langsung menyimpulkan process stuck.

Cek:

- exporter lag,
- search store health,
- Operate import status,
- broker metrics,
- worker logs.

### 14.2 Search Store as Operational Dependency

Search store bukan source of truth runtime, tetapi kritikal untuk operations.

Jika search store down:

- Operate terganggu,
- Tasklist terganggu,
- Optimize terganggu,
- support sulit triage,
- human task experience mungkin terkena dampak.

Untuk system dengan human workflow, Tasklist/search store outage bisa menjadi business-impacting walaupun Zeebe masih hidup.

---

## 15. Self-managed vs SaaS

Camunda 8 bisa dijalankan sebagai SaaS atau self-managed.

### 15.1 SaaS

Kelebihan:

- platform operations lebih ringan,
- managed upgrades,
- managed infrastructure,
- faster adoption,
- less Kubernetes burden.

Tantangan:

- data residency,
- network connectivity,
- regulatory/compliance constraints,
- private system integration,
- latency,
- enterprise identity integration,
- cost model.

### 15.2 Self-managed

Kelebihan:

- kontrol penuh environment,
- cocok untuk private network/on-prem/VPC,
- data residency lebih terkendali,
- integrasi enterprise lebih fleksibel,
- ops customization.

Tantangan:

- Kubernetes/platform maturity,
- sizing,
- monitoring,
- backup/restore,
- upgrades,
- Elasticsearch/OpenSearch operations,
- security hardening,
- incident response.

Decision point:

```text
SaaS optimizes for speed and managed ops.
Self-managed optimizes for control and integration constraints.
```

Dalam regulated government-style systems, self-managed sering dipilih karena network/data/control constraints, tetapi beban platform engineering jauh lebih tinggi.

---

## 16. Camunda 8 Deployment Topology Mental Model

Topology sederhana:

```text
Namespace: camunda

- zeebe-gateway
- zeebe-broker-0
- zeebe-broker-1
- zeebe-broker-2
- operate
- tasklist
- optimize
- identity
- connectors
- elasticsearch/opensearch
- web-modeler
```

Application namespace:

```text
Namespace: case-management

- application-api
- application-worker
- document-worker
- notification-worker
- payment-worker
- risk-worker
- frontend
- domain-db
- redis/outbox/etc
```

Network path:

```text
Frontend -> Backend API -> Camunda Gateway/API
Worker   -> Camunda Gateway/API
Operate  -> Search store + orchestration APIs
Tasklist -> Search store + orchestration APIs
```

Jangan mencampur Camunda platform components dan domain app components tanpa ownership jelas.

---

## 17. Java Application Architecture with Camunda 8

Ada beberapa jenis Java apps:

1. Backend API yang start process/complete task/publish message.
2. Worker app yang activate jobs.
3. Admin/support app yang melakukan repair terbatas.
4. Batch/reconciliation app yang publish messages atau check external state.
5. CI/CD deployer yang deploy BPMN/DMN/forms.

### 17.1 Backend API

Contoh responsibilities:

- validate request,
- authenticate/authorize user,
- write domain state,
- start process,
- publish message,
- complete task,
- expose case timeline.

### 17.2 Worker App

Contoh responsibilities:

- execute service task,
- call external API,
- update domain DB,
- generate documents,
- send notifications,
- classify errors,
- complete/fail/throw BPMN error.

### 17.3 Reconciliation App

Contoh responsibilities:

- find pending external transaction,
- poll external system,
- publish message to process,
- repair missing callback,
- detect stuck side effects.

Top 1% architecture tidak memaksa semua Camunda interaction berada di satu app monolith. Ia memisahkan berdasarkan ownership, scaling, blast radius, and security.

---

## 18. API Surface: Command vs Query

Camunda interaction dapat dibagi menjadi:

```text
Command path:
- deploy process
- start instance
- publish message
- activate job
- complete job
- fail job
- throw error
- complete user task
- cancel instance

Query/operation path:
- search task
- inspect process instance
- list incidents
- analytics/reporting
```

Dalam distributed architecture, command path dan query path bisa punya consistency berbeda.

Contoh:

```text
startProcessInstance returns success
but Operate search may not show instance immediately
```

Itu bukan bug otomatis. Itu bisa read model lag.

---

## 19. Failure Modes by Component

### 19.1 Zeebe Broker Failure

Symptoms:

- process not progressing,
- command rejected/timeout,
- partition unavailable,
- high processing latency,
- incident spike,
- exporter lag.

Possible causes:

- CPU saturation,
- disk pressure,
- network issue,
- partition leadership instability,
- high payload size,
- incident storm,
- too many timers/messages,
- bad process model causing loops.

### 19.2 Gateway Failure

Symptoms:

- client cannot connect,
- worker activation fails,
- start process fails,
- publish message fails.

Possible causes:

- gateway pod down,
- load balancer issue,
- TLS/auth issue,
- network policy,
- broker unreachable.

### 19.3 Worker Failure

Symptoms:

- job backlog grows,
- incident after retries exhausted,
- external API side effects partial,
- process stuck at service task.

Possible causes:

- deployment bug,
- external API down,
- wrong credentials,
- variable contract mismatch,
- timeout too short,
- lock timeout too short,
- non-idempotent handler.

### 19.4 Operate Failure

Symptoms:

- cannot inspect process,
- stale process state,
- incident not visible,
- support blind.

Possible causes:

- search store down,
- importer/exporter lag,
- Operate app down,
- auth issue.

### 19.5 Tasklist Failure

Symptoms:

- users cannot see/complete tasks,
- inbox stale,
- completion fails.

Possible causes:

- Tasklist app down,
- search store lag,
- auth issue,
- orchestration API issue,
- form/config issue.

### 19.6 Optimize Failure

Symptoms:

- dashboards unavailable,
- KPI stale,
- analytics lag.

Business process can still run, but management visibility is impacted.

### 19.7 Identity/Auth Failure

Symptoms:

- login fails,
- API token invalid,
- worker unauthorized,
- task user cannot access,
- operator cannot retry incident.

This can be business critical because it blocks humans and services.

### 19.8 Search Store Failure

Symptoms:

- Operate/Tasklist/Optimize affected,
- stale read model,
- high query latency,
- import/export backlog.

Runtime may continue but operational visibility degrades.

---

## 20. Observability Blueprint

A production Camunda 8 system needs observability per layer.

### 20.1 Engine Metrics

Track:

- process instances created/completed/terminated,
- job created/activated/completed/failed,
- incident count,
- command latency,
- partition processing latency,
- exporter lag,
- broker CPU/memory/disk,
- gateway request latency,
- backpressure/rejection.

### 20.2 Worker Metrics

Track per job type:

- activation count,
- completion count,
- failure count,
- BPMN error count,
- duration p50/p95/p99,
- retries remaining distribution,
- timeout count,
- external API latency,
- idempotency duplicate count,
- circuit breaker open count.

### 20.3 Human Workflow Metrics

Track:

- open task count,
- task age,
- SLA due soon,
- SLA breached,
- assignee backlog,
- candidate group backlog,
- claim-to-complete duration,
- reassignment count.

### 20.4 Business Metrics

Track:

- application approval duration,
- case closure duration,
- appeal rate,
- rejection reasons,
- agency response delay,
- document resubmission count,
- escalation count.

### 20.5 Correlation Fields

Every log/metric/event should include when possible:

```text
processDefinitionId
processInstanceKey
elementId
elementInstanceKey
jobKey
jobType
businessKey
caseId
applicationId
correlationId
externalRequestId
workerName
processVersion
```

Without correlation, workflow debugging becomes guesswork.

---

## 21. Security Architecture

Camunda 8 security needs layered thinking.

### 21.1 Network Segmentation

Recommended posture:

```text
Public internet should not reach Zeebe Gateway directly.
Internal backend/worker subnet can reach Camunda APIs.
Operate/Tasklist restricted to authorized users/network.
Search store not directly exposed.
Admin endpoints restricted.
```

### 21.2 Credential Separation

Use separate machine credentials for:

- deployer,
- backend starter,
- task completion backend,
- each worker app or worker group,
- support/repair tool,
- monitoring.

Avoid:

- one global admin token,
- token in frontend,
- shared credentials across teams,
- long-lived unmanaged secrets.

### 21.3 Sensitive Variables

Do not store unnecessary PII/secrets in process variables.

Bad:

```json
{
  "nric": "S1234567A",
  "passportScanBase64": "...",
  "bankAccount": "...",
  "apiToken": "..."
}
```

Better:

```json
{
  "applicantRef": "PERSON-REF-8821",
  "documentRef": "DOC-2026-771",
  "riskBand": "MEDIUM"
}
```

Process variables may be visible to operators depending on permission model. Treat them as operational data with security implications.

---

## 22. Production Readiness Checklist

### 22.1 Platform Readiness

- [ ] Zeebe brokers sized and monitored.
- [ ] Gateway high availability configured.
- [ ] Search store sized and monitored.
- [ ] Exporter/import lag monitored.
- [ ] Operate available to support team.
- [ ] Tasklist available if human tasks are used.
- [ ] Backup/restore strategy documented.
- [ ] Upgrade path documented.
- [ ] Network policy defined.
- [ ] TLS/auth configured.

### 22.2 Application Readiness

- [ ] Worker idempotency implemented.
- [ ] Job retries classified.
- [ ] BPMN error vs technical failure policy defined.
- [ ] Job timeout tuned.
- [ ] Worker graceful shutdown implemented.
- [ ] Correlation IDs logged.
- [ ] Domain audit trail implemented.
- [ ] Outbox/inbox used where needed.
- [ ] External API rate limit handled.
- [ ] Manual repair path documented.

### 22.3 Process Readiness

- [ ] BPMN model reviewed.
- [ ] DMN decisions tested.
- [ ] Variable contract versioned.
- [ ] Message correlation key defined.
- [ ] SLA timers validated.
- [ ] Compensation path defined where needed.
- [ ] Incident path defined.
- [ ] Task authorization validated.
- [ ] Process migration strategy documented.

### 22.4 Operations Readiness

- [ ] Runbook per incident type.
- [ ] Dashboard for broker/gateway/worker/search store.
- [ ] Alert thresholds defined.
- [ ] Support roles defined.
- [ ] Retry safety rules defined.
- [ ] Business impact classification defined.
- [ ] Audit-safe repair process defined.

---

## 23. Worked Architecture Example: Regulatory Application Process

### 23.1 Process Landscape

```text
Application Submission Process
  -> Validate Submission Worker
  -> Risk Assessment Worker
  -> Determine Review Route DMN
  -> Multi-agency Review User Tasks
  -> Request Clarification Subprocess
  -> Final Decision User Task
  -> Generate Letter Worker
  -> Notify Applicant Worker
  -> Close Application
```

### 23.2 Camunda Components Used

| Concern | Component |
|---|---|
| Process execution | Zeebe broker |
| Java service integration | Java workers |
| Officer tasks | Tasklist or custom UI + Task API |
| Incident support | Operate |
| SLA analytics | Optimize/domain BI |
| Access control | Identity + backend authorization |
| Modeling | Modeler |
| External calls | Java worker / connector |

### 23.3 Runtime Flow

```text
Applicant submits application
  -> Backend validates and writes domain application
  -> Backend starts Camunda process with applicationId/caseId
  -> Zeebe creates first service task job
  -> validation-worker activates job
  -> validation-worker updates domain validation result
  -> complete job with validationOutcome
  -> DMN decides review route
  -> user tasks created for officer groups
  -> Tasklist/custom UI shows tasks
  -> officer completes review via backend
  -> backend writes domain decision and completes task
  -> final decision worker generates letter
  -> notification worker sends email
  -> process completes
```

### 23.4 Failure Scenario: Notification API Down

```text
notification.send-decision-email.v1 job activated
  -> external email provider timeout
  -> worker failJob retries=2 backoff=5m
  -> retry again
  -> provider still down
  -> failJob retries=1 backoff=15m
  -> retry again
  -> still down
  -> failJob retries=0
  -> incident created
  -> Operate shows incident
  -> support checks provider outage
  -> provider recovers
  -> support increases retry/resolves incident
  -> worker sends email idempotently
  -> process completes
```

Idempotency record prevents duplicate email if provider actually sent email but response was lost.

### 23.5 Failure Scenario: Officer Completes Stale Task

```text
Officer opens task page
Task is reassigned/escalated in another session
Officer clicks approve
Backend checks current task ownership and case version
Backend rejects stale completion
No Camunda completion command sent
Audit records attempted stale action if required
```

Do not rely only on UI state.

---

## 24. Camunda 8 Design Smells

### 24.1 All Logic in BPMN

Symptom:

- BPMN huge,
- many gateways,
- hard to test,
- process changes require business + developer confusion.

Fix:

- Move decision tables to DMN.
- Move computation to domain services.
- Keep BPMN as flow/orchestration.

### 24.2 All Integration via Generic HTTP Connector

Symptom:

- no idempotency,
- weak error classification,
- secrets scattered,
- no domain transaction,
- poor observability.

Fix:

- Use Java workers for critical integrations.
- Use connectors only for simple bounded calls.

### 24.3 Operate as Business Case UI

Symptom:

- officers/operators use Operate for business decisions,
- variables become business screen data,
- audit weak.

Fix:

- Build domain case UI.
- Use Operate for technical/ops support.

### 24.4 Process Variables as Domain Database

Symptom:

- huge payload,
- sensitive data leakage,
- slow process execution,
- schema evolution pain.

Fix:

- Store IDs/references/process routing data only.

### 24.5 No Read Model Lag Awareness

Symptom:

- team thinks process stuck because UI stale,
- duplicate manual repair,
- unnecessary retries.

Fix:

- Monitor exporter/search lag.
- Use runtime command result and worker logs.

### 24.6 No Ownership by Job Type

Symptom:

- incident occurs but nobody knows owning team,
- worker logs scattered,
- retry unsafe.

Fix:

- Define job type ownership matrix.

---

## 25. Job Type Ownership Matrix Example

| Job Type | Owning Service | Owning Team | Retry Policy | BPMN Error Codes | Support Action |
|---|---|---|---|---|---|
| `application.validate-submission.v1` | application-worker | Case Backend | 3 technical retries | `INVALID_SUBMISSION` | fix data / route clarification |
| `risk.assess-application.v1` | risk-worker | Risk Team | 2 retries | `RISK_SERVICE_UNAVAILABLE`? no, technical | retry after service recovery |
| `document.generate-letter.v1` | document-worker | Document Team | 3 retries | `TEMPLATE_NOT_FOUND` | deploy template / retry |
| `notification.send-email.v1` | notification-worker | Platform Team | 5 retries | `EMAIL_BLOCKED` | check provider / idempotency |
| `payment.verify-receipt.v1` | payment-worker | Payment Team | 10 retries/poll | `PAYMENT_EXPIRED` | reconcile payment |

This matrix is more valuable in production than a beautiful architecture diagram.

---

## 26. Java 8–25 Considerations

### 26.1 Java 8

If legacy system still runs Java 8:

- isolate Camunda 8 client compatibility carefully,
- consider sidecar worker on newer Java,
- avoid forcing old monolith to own new orchestration stack,
- use REST boundary if client dependency mismatch exists.

### 26.2 Java 11/17

Good stable enterprise baseline.

- Spring Boot 2/3 transition considerations.
- Strong enough for worker apps.
- Better TLS/runtime defaults than Java 8.

### 26.3 Java 21/25

Modern worker design can consider:

- virtual threads for blocking IO workers,
- structured concurrency for grouped external calls,
- improved GC/runtime behavior,
- better container ergonomics,
- modern observability libraries.

But virtual threads do not remove:

- idempotency requirements,
- external rate limit,
- job timeout,
- retry classification,
- domain transaction safety.

A bad worker with virtual threads is still a bad worker, just able to fail faster at larger scale.

---

## 27. Mental Models to Keep

### 27.1 Camunda 8 is Not Embedded Java BPMN Engine

```text
Java app calls orchestration cluster.
It does not host the engine.
```

### 27.2 Zeebe Runtime State and Operate View Are Different Layers

```text
Runtime truth: broker.
Operational visibility: exporter/search/Operate.
```

### 27.3 Worker is a Distributed System Participant

```text
Worker can crash.
Network can fail.
External API can partially succeed.
Job can be retried.
Side effect can duplicate.
```

### 27.4 Human Task is Not Just UI Form

```text
User task = authorization + assignment + decision + audit + SLA + domain state.
```

### 27.5 Identity is Not Optional in Production

```text
Unsecured orchestration is process manipulation risk.
```

### 27.6 Search Store is Not Source of Truth, But Still Critical

```text
If operators cannot see incidents, operational recovery is impaired.
```

---

## 28. Practical Review Questions

Before approving a Camunda 8 design, ask:

1. Which component owns runtime execution?
2. Which component owns human task UX?
3. Which component owns process analytics?
4. Which component owns domain audit?
5. Which service owns each job type?
6. What happens if worker completes side effect but job completion fails?
7. What happens if Operate is stale?
8. What happens if Tasklist is down?
9. What happens if search store is down?
10. What happens if Identity/token service is down?
11. How do we repair incidents safely?
12. How do we prevent unauthorized task completion?
13. How do we avoid storing PII in process variables?
14. How do we know exporter is lagging?
15. How do we migrate process definitions safely?
16. How do we know a retry is safe?
17. Which metrics indicate process health vs platform health?
18. Which alerts wake someone up?
19. Which incidents are business-impacting?
20. Can we explain this process instance to an auditor two years later?

---

## 29. Summary

Camunda 8 harus dipahami sebagai orchestration platform, bukan library workflow biasa.

Core insights:

1. Zeebe broker menjalankan process state.
2. Gateway adalah entry point client ke cluster.
3. Partitions adalah scalability boundary.
4. Workers mengeksekusi business capability secara eksternal.
5. Operate adalah operational control plane.
6. Tasklist adalah human task workbench.
7. Optimize adalah analytics/process intelligence layer.
8. Identity/authorization adalah security control plane.
9. Connectors adalah integration abstraction, bukan pengganti domain engineering.
10. Modeler adalah design-time artifact creation tool.
11. Exporter/search store membangun read model untuk UI/analytics.
12. Runtime state, read model, domain state, dan audit state harus dibedakan.
13. Production readiness ditentukan oleh reliability, observability, security, repairability, and governance.

Top 1% engineer tidak hanya bisa deploy Camunda. Ia bisa menjawab:

```text
Apa yang terjadi saat process stuck?
Apa yang terjadi saat worker duplicate?
Apa yang terjadi saat UI stale?
Apa yang terjadi saat external system partial success?
Apa yang terjadi saat officer menyelesaikan stale task?
Apa yang terjadi saat search store down?
Apa yang terjadi saat incident perlu repair?
Apa yang bisa dibuktikan ke auditor?
```

Itulah perbedaan antara “menggunakan Camunda” dan “mendesain process orchestration platform yang layak production”.

---

## 30. Referensi Resmi yang Perlu Dibaca

- Camunda 8 Docs — Self-managed components.
- Camunda 8 Docs — Zeebe architecture.
- Camunda 8 Docs — Java Client.
- Camunda 8 Docs — Job workers.
- Camunda 8 Docs — Operate.
- Camunda 8 Docs — Tasklist.
- Camunda 8 Docs — Optimize.
- Camunda 8 Docs — Identity and authorizations.
- Camunda 8 Docs — Connectors.
- Camunda 8 Release Notes 8.8 and 8.9.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 17 — Camunda 7 Deep Dive: Embedded Engine, Job Executor, Transactions, and Spring Boot](./learn-java-bpmn-camunda-part-17-camunda-7-embedded-engine-job-executor-transactions-spring-boot.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 19 — Spring Boot + Camunda 8 Process Application Architecture](./learn-java-bpmn-camunda-part-19-spring-boot-camunda-8-process-application-architecture.md)

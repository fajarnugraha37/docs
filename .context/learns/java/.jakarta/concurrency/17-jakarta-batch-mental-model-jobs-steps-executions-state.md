# Part 17 — Jakarta Batch Mental Model: Jobs, Steps, Executions, and State

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `17-jakarta-batch-mental-model-jobs-steps-executions-state.md`  
**Scope:** Java 8–25, Java EE/Jakarta EE Batch, `javax.batch` → `jakarta.batch`, Jakarta Batch 2.1 baseline  
**Prerequisite:** Part 0–16, terutama boundary async, context, transaction, cancellation, observability, dan failure mode production.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus bisa menjelaskan dan merancang Jakarta Batch bukan sebagai “loop besar yang dijalankan malam hari”, tetapi sebagai **runtime model untuk durable, restartable, observable, operator-controlled workload execution**.

Target pemahaman:

1. Memahami perbedaan batch processing dengan request processing, scheduler, executor, messaging, workflow engine, dan Kubernetes Job.
2. Memahami model inti Jakarta Batch:
   - job
   - step
   - job instance
   - job execution
   - step execution
   - job repository
   - job parameter
   - batch status
   - exit status
3. Memahami kenapa state adalah pusat desain batch.
4. Memahami kenapa restartability bukan fitur tambahan, tetapi invariant utama batch.
5. Mampu memetakan workload enterprise menjadi job/step/execution secara benar.
6. Mampu menghindari kesalahan desain seperti job non-idempotent, parameter tidak stabil, restart tidak aman, dan status tidak bisa diinterpretasi operator.
7. Mampu membedakan kapan Jakarta Batch cocok dan kapan harus memakai model lain.

---

## 2. Posisi Jakarta Batch dalam Ekosistem Jakarta EE

Jakarta Batch menyediakan dua hal besar:

1. **API Java** untuk membuat artifact batch seperti batchlet, item reader, item processor, item writer, listener, decider, partition mapper, dan operator.
2. **Job Specification Language (JSL)** berbasis XML untuk mendefinisikan struktur job, step, flow, split, decision, dan transisi eksekusi.

Rujukan resmi Jakarta menyebut Jakarta Batch sebagai spesifikasi yang menyediakan API Java plus XML-based job specification language untuk menyusun batch job dari artifact Java yang reusable dan parameterizable. Jakarta Batch 2.1 adalah rilis yang digunakan dalam Jakarta EE 11, sementara Jakarta Batch 2.2 masih berada pada jalur Jakarta EE 12/under development. Karena itu, seri ini memakai Jakarta Batch 2.1 sebagai baseline stabil.

Secara historis, teknologi ini berawal dari JSR 352 Batch Applications for the Java Platform, lalu masuk ke Java EE, kemudian berpindah namespace ke Jakarta EE.

Namespace utama:

```java
// Java EE / Jakarta EE 8 style
javax.batch.api.*
javax.batch.operations.*
javax.batch.runtime.*

// Jakarta EE 9+ style
jakarta.batch.api.*
jakarta.batch.operations.*
jakarta.batch.runtime.*
```

Perpindahan dari `javax` ke `jakarta` bukan sekadar rename import dalam konteks production. Ia mempengaruhi:

- dependency coordinate
- server compatibility
- TCK compliance
- classloader behavior
- migration strategy
- integration dengan CDI/JTA/JPA modern
- packaging aplikasi
- library yang masih memakai namespace lama

Namun secara mental model, konsep inti batch tetap stabil: **job didefinisikan, job dijalankan, execution direkam, step mengeksekusi unit kerja, repository menyimpan state, dan operator mengontrol lifecycle.**

---

## 3. Problem yang Diselesaikan oleh Batch

Banyak engineer keliru menganggap batch sebagai “background task yang lama”. Itu terlalu dangkal.

Batch menyelesaikan problem yang lebih spesifik:

> Bagaimana menjalankan workload besar, berdurasi lama, berbasis data/record/file/API, dengan state yang bisa dilacak, bisa dihentikan, bisa dilanjutkan, bisa diulang secara aman, dan bisa diaudit secara operasional.

Contoh workload batch:

- nightly ageing recalculation untuk case management
- mass generation correspondence
- bulk sync data external registry
- archival data lama ke storage lain
- import CSV/XML/JSON besar
- settlement/reconciliation
- regulatory compliance screening
- recalculation SLA
- remediation data pasca bug production
- scheduled data enrichment
- report precomputation
- indexing/reindexing
- bulk notification

Yang membuat workload tersebut “batch” bukan hanya durasinya. Ciri utamanya:

1. **Dataset-oriented**  
   Pekerjaan biasanya melibatkan banyak record, file, item, atau partition.

2. **Stateful execution**  
   Sistem perlu tahu pekerjaan berada di mana, sudah sampai mana, gagal di mana, dan bisa lanjut dari titik mana.

3. **Restartable**  
   Setelah crash, timeout, deployment, atau stop manual, pekerjaan tidak boleh selalu mulai dari nol.

4. **Operator-controlled**  
   Ada kebutuhan start, stop, restart, abandon, inspect, dan audit.

5. **Long-running**  
   Waktu eksekusi bisa lebih lama dari HTTP request, session user, bahkan pod/container lifetime.

6. **Failure-tolerant**  
   Sebagian record mungkin gagal, sebagian bisa skip, sebagian bisa retry, sebagian harus menghentikan job.

7. **Observable and auditable**  
   Tidak cukup “log ada error”. Harus ada execution status, record count, error count, input/output manifest, dan decision trail.

---

## 4. Batch vs Model Eksekusi Lain

Sebelum memahami konsep internal Jakarta Batch, penting untuk menempatkannya di antara pilihan eksekusi lain.

### 4.1 Synchronous Request

Cocok untuk:

- operasi pendek
- user menunggu hasil langsung
- transaction kecil
- latency penting

Tidak cocok untuk:

- proses ribuan/jutaan record
- retry lama
- external API fan-out besar
- operasi yang harus bisa restart

Contoh salah:

```text
User klik "Generate All Reports" → HTTP request menunggu 20 menit.
```

Masalah:

- reverse proxy timeout
- servlet/request timeout
- user refresh menyebabkan duplikasi
- tidak ada checkpoint
- tidak ada operational restart
- sulit diaudit

### 4.2 ManagedExecutorService

Cocok untuk:

- async offload pendek-menengah
- fan-out terbatas
- non-durable background execution
- task yang boleh gagal dan dilaporkan cepat

Tidak cukup untuk:

- job berdurasi lama yang harus survive restart
- operator stop/restart
- checkpoint per chunk
- job repository
- record-level status

`ManagedExecutorService` memberi container-aware execution, tetapi tidak otomatis memberi durable job state.

### 4.3 Scheduler

Cocok untuk:

- memicu sesuatu berdasarkan waktu
- periodic polling
- lightweight maintenance task

Tidak cukup untuk:

- stateful multi-step job
- restart dari checkpoint
- skip/retry semantics per record
- partitioning dan job repository

Scheduler menjawab pertanyaan: **kapan mulai?**  
Batch menjawab: **apa yang dijalankan, sampai mana, gagal di mana, dan bagaimana lanjut?**

### 4.4 Messaging

Cocok untuk:

- event-driven processing
- decoupling producer-consumer
- durable async command
- item-level processing

Tidak selalu cocok untuk:

- job graph besar
- step sequencing
- operator restart berdasarkan job instance
- batch-level summary
- chunk transaction semantics

Messaging bagus untuk work queue. Batch bagus untuk **bounded workload with execution state**.

### 4.5 Workflow Engine

Cocok untuk:

- long-running business process
- human task
- approval
- timers business-level
- compensation flow kompleks
- BPMN state machine

Jakarta Batch cocok untuk:

- data processing workload
- chunk/partition execution
- restartable technical processing

Batas sederhananya:

```text
Workflow engine mengatur perjalanan bisnis.
Batch engine mengolah workload data.
```

Kadang keduanya dipakai bersama:

```text
Workflow step "Run nightly compliance screening"
    ↓
Jakarta Batch job "screen all active cases"
    ↓
Batch result mengembalikan summary ke workflow.
```

### 4.6 Kubernetes Job/CronJob

Cocok untuk:

- process-level isolation
- containerized command batch
- platform-native scheduling
- workload yang tidak perlu Jakarta EE integration mendalam

Jakarta Batch lebih cocok ketika:

- workload butuh CDI/JTA/JPA/security Jakarta EE
- ingin job repository di dalam aplikasi
- butuh JobOperator API
- logic batch dekat dengan domain service existing

Namun di Kubernetes, kamu tetap harus mempertimbangkan:

- pod eviction
- rolling deployment
- liveness/readiness
- graceful shutdown
- single active job
- persistent job repository

---

## 5. Mental Model Utama: Definition, Instance, Execution, State

Jakarta Batch harus dipahami sebagai pemisahan empat hal:

```text
Definition  → apa job-nya
Instance    → job logis dengan parameter tertentu
Execution   → attempt teknis menjalankan instance
State       → jejak runtime yang memungkinkan inspect/restart
```

Contoh:

```text
Job Definition:
  nightly-case-ageing-recalculation

Job Parameters:
  businessDate=2026-06-17
  agency=CEA

Job Instance:
  nightly-case-ageing-recalculation + businessDate=2026-06-17 + agency=CEA

Job Execution #1:
  start 01:00, failed 01:34 at step recalculate-ageing

Job Execution #2:
  restart 02:00, resumed, completed 02:21
```

Kesalahan mental model paling umum:

```text
Salah:
  Job = setiap kali tombol run ditekan.

Lebih benar:
  Job = definisi.
  JobInstance = job definisi + identitas parameter.
  JobExecution = attempt menjalankan instance tersebut.
```

Kenapa ini penting?

Karena restartability, audit, dan deduplication bergantung pada pemisahan ini.

---

## 6. Konsep Inti Jakarta Batch

### 6.1 Job

**Job** adalah definisi batch process.

Ia menjawab:

- pekerjaan apa yang akan dilakukan?
- step apa saja yang menyusun pekerjaan?
- bagaimana urutan step?
- kapan job dianggap complete, failed, stopped?
- parameter apa yang dibutuhkan?

Contoh konseptual:

```xml
<job id="nightlyCaseAgeing" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    <step id="loadCandidateCases" next="recalculateAgeing">
        ...
    </step>

    <step id="recalculateAgeing" next="writeSummary">
        ...
    </step>

    <step id="writeSummary">
        ...
    </step>
</job>
```

Job bukan object runtime tunggal. Job adalah **definition**.

Analogi:

```text
Job definition seperti blueprint.
Job instance seperti rumah tertentu yang dibangun dari blueprint itu dengan alamat tertentu.
Job execution seperti percobaan membangun/memperbaiki rumah tersebut pada waktu tertentu.
```

### 6.2 Step

**Step** adalah unit kerja di dalam job.

Step bisa berupa:

1. **Batchlet step**  
   Cocok untuk task-oriented work.

2. **Chunk step**  
   Cocok untuk item-oriented processing: read → process → write.

Contoh step:

```text
Job: import-license-renewal-file

Step 1: validate-file-manifest
Step 2: read-and-transform-records
Step 3: persist-valid-records
Step 4: generate-error-report
Step 5: publish-completion-event
```

Step harus punya boundary yang jelas:

- input apa?
- output apa?
- transaksi di mana?
- checkpoint di mana?
- jika gagal, bisa diulang dari mana?
- jika di-skip, dampaknya apa?

### 6.3 JobInstance

**JobInstance** adalah instans logis dari job berdasarkan parameter tertentu.

Misalnya:

```text
jobName=nightlyCaseAgeing
businessDate=2026-06-17
agency=CEA
```

Ini berbeda dari:

```text
jobName=nightlyCaseAgeing
businessDate=2026-06-18
agency=CEA
```

Keduanya adalah dua job instance berbeda.

Parameter job harus dipikirkan sebagai **identity key** untuk logical batch run.

Pertanyaan desain:

- Apakah job untuk tanggal yang sama boleh dijalankan dua kali?
- Jika user klik start dua kali dengan parameter sama, apakah itu duplicate atau rerun sah?
- Parameter mana yang menentukan identitas instance?
- Parameter mana yang hanya konfigurasi execution?

Jakarta Batch menggunakan job parameters dalam start/restart operation. Secara production, kamu harus mendesain parameter sebagai kontrak, bukan sekadar Map string acak.

### 6.4 JobExecution

**JobExecution** adalah attempt teknis menjalankan JobInstance.

Satu JobInstance bisa punya banyak JobExecution.

Contoh:

```text
JobInstance: nightlyCaseAgeing, businessDate=2026-06-17

Execution 101:
  started: 01:00
  ended:   01:31
  status:  FAILED
  failed at: step=recalculateAgeing

Execution 102:
  started: 02:00
  ended:   02:15
  status:  COMPLETED
  restart of: Execution 101
```

JobExecution menjawab:

- kapan attempt dimulai?
- kapan selesai?
- status teknis apa?
- exit status apa?
- error apa?
- step mana yang sudah selesai?
- apakah bisa restart?

### 6.5 StepExecution

**StepExecution** adalah attempt teknis menjalankan satu step dalam sebuah JobExecution.

Ia menyimpan informasi seperti:

- step name
- batch status
- exit status
- start/end time
- metrics tergantung implementasi/API
- persistent user data/checkpoint terkait step

StepExecution penting karena restart batch hampir selalu terjadi di level step/chunk, bukan hanya level job.

Contoh:

```text
JobExecution 102
  StepExecution: loadCandidateCases       COMPLETED
  StepExecution: recalculateAgeing        STARTED/RUNNING/FAILED/COMPLETED
  StepExecution: writeSummary             not started yet
```

### 6.6 Job Repository

**Job repository** adalah persistence layer yang menyimpan state batch.

Ia menyimpan informasi seperti:

- job instance
- job execution
- step execution
- status
- parameters
- checkpoint data
- execution metadata

Tanpa job repository yang benar, batch kehilangan fitur utama:

- inspect current execution
- restart failed/stopped execution
- audit execution history
- prevent duplicate execution
- correlate technical failure with business operation

Repository ini adalah salah satu pembeda utama antara:

```text
Executor task biasa
```

dan:

```text
Batch job production-grade
```

### 6.7 JobOperator

`JobOperator` adalah API control plane untuk batch.

Ia menyediakan operasi seperti:

- start job
- stop job
- restart job
- abandon job
- inspect execution
- list job names
- get parameters
- get executions

Secara mental model:

```text
Job artifact = plane eksekusi
Job repository = memory/state
JobOperator = control plane
```

Penting: `JobOperator` bukan sekadar util class. Ia adalah boundary antara aplikasi/operator/admin UI dengan runtime batch.

Dalam desain production, JobOperator sebaiknya tidak diekspos sembarangan. Ia harus dibungkus oleh service/API yang punya:

- authorization
- parameter validation
- duplicate prevention
- audit trail
- rate limit
- operator reason/comment
- environment guardrail

---

## 7. Batch Status vs Exit Status

Jakarta Batch membedakan dua jenis status yang sering dicampuradukkan:

1. **BatchStatus**  
   Status teknis/lifecycle standar.

2. **ExitStatus**  
   Status hasil/logika yang bisa digunakan untuk transisi dan interpretasi bisnis.

### 7.1 BatchStatus

BatchStatus biasanya mencakup status seperti:

```text
STARTING
STARTED
STOPPING
STOPPED
FAILED
COMPLETED
ABANDONED
```

Maknanya teknis:

- job sedang mulai
- job sedang berjalan
- job sedang diminta berhenti
- job berhenti
- job gagal
- job selesai
- job ditandai abandoned

BatchStatus cocok untuk lifecycle runtime.

### 7.2 ExitStatus

ExitStatus bisa lebih domain-specific.

Contoh:

```text
COMPLETED
COMPLETED_WITH_WARNINGS
COMPLETED_WITH_SKIPS
FAILED_VALIDATION
FAILED_DOWNSTREAM_UNAVAILABLE
NO_DATA
PARTIAL_SUCCESS
REQUIRES_MANUAL_REVIEW
```

ExitStatus dapat dipakai untuk transisi JSL:

```xml
<step id="validateInput" next="processRecords">
    ...
</step>
```

Atau lebih kompleks:

```xml
<step id="validateInput">
    <next on="VALID" to="processRecords" />
    <fail on="INVALID" />
    <end on="NO_DATA" />
</step>
```

### 7.3 Analogi

```text
BatchStatus = apa yang terjadi pada mesin eksekusi.
ExitStatus  = apa arti hasil eksekusi bagi job graph/operator/bisnis.
```

Contoh:

```text
BatchStatus: COMPLETED
ExitStatus: COMPLETED_WITH_137_SKIPS
```

Artinya runtime selesai sukses, tetapi hasil bisnis punya catatan.

Atau:

```text
BatchStatus: FAILED
ExitStatus: DOWNSTREAM_RATE_LIMIT_EXHAUSTED
```

Artinya runtime gagal karena alasan yang bisa dipakai operator untuk tindakan selanjutnya.

---

## 8. Job Parameters: Kontrak, Identitas, dan Risiko

Job parameters tampak sederhana: key-value string.

Namun di production, parameter adalah salah satu titik paling penting.

### 8.1 Parameter sebagai Identity

Contoh:

```properties
businessDate=2026-06-17
agency=CEA
jobPurpose=NIGHTLY_RECALCULATION
```

Parameter ini menentukan “run logis” apa yang sedang dilakukan.

Jika parameter berubah sedikit:

```properties
businessDate=2026-06-17
agency=CEA
jobPurpose=MANUAL_RERUN
```

Apakah itu instance berbeda? Apakah boleh memproses data yang sama? Apakah akan duplicate side effects?

Itu harus dirancang.

### 8.2 Parameter sebagai Configuration

Contoh:

```properties
chunkSize=500
partitionCount=8
dryRun=false
maxSkips=100
```

Parameter ini lebih seperti konfigurasi execution.

Risikonya: jika configuration dicampur dengan identity, restart bisa membingungkan.

Misalnya:

```text
Execution #1 gagal dengan chunkSize=100.
Restart memakai chunkSize=1000.
```

Apakah aman? Mungkin ya, mungkin tidak. Jika checkpoint bergantung pada chunking, partitioning, atau ordering, perubahan parameter bisa membuat restart tidak valid.

### 8.3 Parameter sebagai Security Boundary

Parameter tidak boleh dipercaya begitu saja.

Contoh parameter berbahaya:

```properties
schema=PROD_CUSTOMER
whereClause=1=1
outputPath=/mnt/shared/all-users.csv
notifyEmail=external@example.com
```

Risiko:

- data leakage
- SQL injection melalui parameter
- path traversal
- privilege escalation
- job dijalankan untuk agency/tenant yang tidak boleh diakses user
- audit tidak defensible

Prinsip:

```text
Job parameter adalah input eksternal. Validasi seperti API input.
```

### 8.4 Parameter Governance

Untuk job production, buat kontrak parameter:

| Parameter | Required | Type | Allowed Values | Identity Key | Mutable on Restart | Sensitive | Example |
|---|---:|---|---|---:|---:|---:|---|
| `businessDate` | yes | date | yyyy-MM-dd | yes | no | no | `2026-06-17` |
| `agency` | yes | enum | CEA/CPDS/etc | yes | no | no | `CEA` |
| `dryRun` | no | boolean | true/false | maybe | no | no | `false` |
| `chunkSize` | no | integer | 100–5000 | no | risky | no | `500` |
| `requestedBy` | yes | username/id | existing user/system | no | no | maybe | `fajar` |
| `reason` | yes | text | max length, sanitized | no | no | no | `monthly ops` |

---

## 9. Job Repository as Source of Operational Truth

A mature batch system does not rely on logs as the primary source of truth.

Logs are useful for forensics. Repository is useful for control.

### 9.1 What Repository Must Tell You

At minimum, operator should be able to answer:

- job apa yang sedang running?
- siapa yang memulai?
- parameter apa yang dipakai?
- execution mana yang gagal?
- step mana yang gagal?
- gagal kapan?
- error category apa?
- bisa di-restart atau tidak?
- berapa item sudah dibaca/diproses/ditulis?
- berapa item skip/retry?
- output apa yang dihasilkan?
- apakah job ini duplicate dari run sebelumnya?

### 9.2 Repository vs Domain Audit

Job repository bukan pengganti domain audit.

Repository menjawab:

```text
Apa yang terjadi pada batch runtime?
```

Domain audit menjawab:

```text
Apa dampak batch terhadap domain/business object?
```

Contoh:

```text
JobRepository:
  JobExecution 9001 completed.
  Step writeEscalationRecommendations wrote 12,482 records.

DomainAudit:
  Case A-100 escalated from REVIEW to ENFORCEMENT.
  initiatedBy=batch:nightly-escalation
  approvedPolicy=POL-2026-01
  reason=SLA breached > 30 days
```

Keduanya penting.

Untuk regulatory system, jangan hanya menyimpan batch status. Simpan juga domain effect trail.

---

## 10. Lifecycle Jakarta Batch

Secara sederhana:

```text
1. Application deploys batch artifacts and JSL
2. Caller obtains JobOperator
3. Caller starts job with parameters
4. Runtime creates JobInstance/JobExecution
5. Runtime executes first step
6. Each step creates StepExecution
7. Runtime updates repository state
8. Runtime follows transition rules
9. Job completes, fails, stops, or is abandoned
10. Operator can inspect/restart/stop based on state
```

### 10.1 Start

Start artinya membuat execution baru dari job definition dengan parameter tertentu.

Pseudo-code:

```java
@Inject
JobOperator jobOperator;

public long startNightlyAgeing(LocalDate businessDate) {
    Properties params = new Properties();
    params.setProperty("businessDate", businessDate.toString());
    params.setProperty("agency", "CEA");
    params.setProperty("requestedBy", "system:scheduler");

    return jobOperator.start("nightlyCaseAgeing", params);
}
```

Namun production service tidak boleh hanya begini.

Harus ada:

- validation
- duplicate guard
- authorization
- audit
- idempotency key
- execution window check
- environment check

Lebih realistis:

```java
public long requestStartNightlyAgeing(StartBatchRequest request, Actor actor) {
    authorize(actor, "BATCH_START", "nightlyCaseAgeing");
    validateBusinessDate(request.businessDate());
    validateExecutionWindow("nightlyCaseAgeing", request.businessDate());

    String idempotencyKey = "nightlyCaseAgeing:" + request.businessDate() + ":" + request.agency();

    if (batchRequestRepository.existsActive(idempotencyKey)) {
        throw new DuplicateBatchRequestException(idempotencyKey);
    }

    BatchRequest saved = batchRequestRepository.createRequested(
        idempotencyKey,
        "nightlyCaseAgeing",
        request,
        actor
    );

    Properties params = new Properties();
    params.setProperty("businessDate", request.businessDate().toString());
    params.setProperty("agency", request.agency());
    params.setProperty("requestedBy", actor.id());
    params.setProperty("requestId", saved.id().toString());
    params.setProperty("reason", request.reason());

    long executionId = jobOperator.start("nightlyCaseAgeing", params);

    batchRequestRepository.markStarted(saved.id(), executionId);
    return executionId;
}
```

### 10.2 Stop

Stop adalah request agar job berhenti secara terkontrol.

Stop bukan kill.

Batch runtime biasanya akan:

- menandai execution sebagai stopping
- memberi sinyal ke running step
- menunggu boundary aman
- menulis state
- mengakhiri dengan STOPPED jika berhasil

Untuk batchlet, implementasi `stop()` penting.

Untuk chunk, stop biasanya lebih aman pada checkpoint/chunk boundary.

Prinsip:

```text
Stop harus cooperative.
```

Jika step tidak pernah mengecek stop signal, job mungkin tidak berhenti tepat waktu.

### 10.3 Restart

Restart menjalankan ulang failed/stopped execution dari state yang tersimpan.

Restart bukan selalu start dari nol.

Untuk chunk-oriented step, restart bisa melanjutkan dari checkpoint.

Untuk batchlet, restart safety bergantung pada implementasi artifact.

Pertanyaan penting:

- step mana yang sudah complete?
- step mana yang harus diulang?
- item terakhir yang committed apa?
- side effect mana yang sudah terjadi?
- writer idempotent atau tidak?
- parameter restart sama atau berubah?

### 10.4 Abandon

Abandon biasanya menandai execution agar tidak lagi dianggap restartable.

Ini operasi governance, bukan sekadar delete.

Gunakan abandon ketika:

- execution lama tidak valid lagi
- checkpoint corrupt
- input dataset sudah berubah dan restart tidak aman
- operator memutuskan job harus ditutup manual
- ada remediation lain yang menggantikan execution tersebut

Abandon harus diaudit.

---

## 11. Step Model: Batchlet vs Chunk

Jakarta Batch punya dua model step utama.

### 11.1 Batchlet

Batchlet cocok untuk task-oriented work.

Contoh:

- validate manifest file
- move file antar direktori
- call stored procedure
- generate summary report
- send completion notification
- cleanup temp table
- acquire/release lock

Mental model:

```text
One step = one procedural task.
```

Contoh skeleton:

```java
@Named
public class ValidateManifestBatchlet extends AbstractBatchlet {

    @Inject
    JobContext jobContext;

    @Override
    public String process() throws Exception {
        String fileId = jobContext.getProperties().getProperty("fileId");

        // validate manifest existence, checksum, schema, etc.
        boolean valid = validate(fileId);

        return valid ? "VALID" : "INVALID";
    }
}
```

Kelebihan:

- sederhana
- cocok untuk task yang tidak naturally item-based
- mudah membaca alur procedural

Risiko:

- mudah menjadi “god step”
- restartability harus didesain manual
- progress sulit diukur jika task besar
- cancellation sering diabaikan

### 11.2 Chunk

Chunk cocok untuk item-oriented processing.

Mental model:

```text
Read N items → process each item → write N outputs → commit/checkpoint → repeat
```

Komponen:

- `ItemReader`
- `ItemProcessor`
- `ItemWriter`
- checkpoint
- commit interval

Contoh workload:

```text
Read 1,000,000 cases
For each case, calculate ageing and escalation status
Write updates in chunks of 500
Checkpoint after each committed chunk
```

Kelebihan:

- restartability lebih natural
- transaksi per chunk
- memory lebih terkontrol
- metrics item-level lebih jelas
- skip/retry bisa granular

Risiko:

- reader state harus benar
- writer harus idempotent
- commit interval salah bisa membebani DB
- ordering harus stabil
- external side effect dalam writer bisa berbahaya

---

## 12. Execution State Machine

Untuk berpikir top-tier, jangan melihat batch sebagai method call. Lihat sebagai state machine.

### 12.1 JobExecution State Machine Sederhana

```text
NEW/STARTING
    ↓
STARTED
    ↓
+-----------------------------+
|                             |
| all steps completed          ↓
|                         COMPLETED
|
| step fails                   ↓
|                         FAILED
|
| stop requested               ↓
|                         STOPPING
|                              ↓
|                         STOPPED
|
| operator abandon             ↓
+------------------------ ABANDONED
```

### 12.2 StepExecution State Machine

```text
NOT_STARTED
    ↓
STARTING
    ↓
STARTED
    ↓
+-----------------------------+
| chunk/checkpoint loop        |
|                              |
| success                      ↓
|                         COMPLETED
|
| exception not handled        ↓
|                         FAILED
|
| stop signal                  ↓
|                         STOPPED
+-----------------------------+
```

### 12.3 Invariant Penting

Beberapa invariant yang harus dijaga:

1. Execution yang `COMPLETED` tidak boleh di-restart seolah-olah gagal.
2. Execution yang `ABANDONED` tidak boleh otomatis dilanjutkan.
3. Step yang sudah complete tidak boleh diulang jika side effect-nya tidak idempotent, kecuali desain eksplisit mengizinkan.
4. Checkpoint harus merepresentasikan posisi aman, bukan posisi sementara.
5. ExitStatus harus bisa dijelaskan oleh operator dan developer.
6. Stop harus meninggalkan state yang bisa diinspeksi.
7. Failed execution harus punya failure reason yang cukup untuk tindakan.

---

## 13. Restartability sebagai First-Class Design Concern

Batch tanpa restartability hanya background script dengan XML.

Restartability menjawab:

```text
Jika proses mati di tengah, bagaimana lanjut tanpa merusak data?
```

### 13.1 Restartability Membutuhkan 4 Hal

1. **Stable input identity**

   Dataset yang diproses harus bisa didefinisikan ulang saat restart.

   Contoh buruk:

   ```sql
   SELECT * FROM cases WHERE status = 'ACTIVE'
   ```

   Jika status berubah selama job, restart mungkin memproses dataset berbeda.

   Lebih baik:

   ```text
   Step 1: snapshot candidate case IDs ke work table.
   Step 2: process berdasarkan work table.
   ```

2. **Persistent progress**

   Runtime harus tahu sudah sampai mana.

   Contoh:

   ```text
   lastProcessedCaseId=CASE-2026-000123
   page=42
   fileOffset=987654
   partition=agency:CEA:range:100000-199999
   ```

3. **Idempotent side effect**

   Jika item/chunk diulang, hasil tidak boleh double effect.

   Contoh idempotency key:

   ```text
   jobInstanceId + stepName + businessKey + operationType
   ```

4. **Deterministic restart behavior**

   Restart harus mengikuti aturan yang jelas:

   - step mana di-skip karena complete
   - step mana diulang
   - item mana lanjut
   - parameter mana tidak boleh berubah

### 13.2 Restartability Anti-Pattern

```java
public class BadWriter implements ItemWriter {
    @Override
    public void writeItems(List<Object> items) {
        for (Object item : items) {
            externalPaymentApi.charge(item); // non-idempotent
        }
    }
}
```

Jika job gagal setelah sebagian charge sukses tetapi sebelum checkpoint commit, restart bisa charge ulang.

Lebih baik:

```text
1. Write intent/outbox record with idempotency key.
2. Commit DB chunk.
3. Separate dispatcher sends external call idempotently.
4. External response stored and deduplicated.
```

### 13.3 Restartability Checklist

Untuk setiap step, jawab:

- Apa input step?
- Apakah input stabil saat restart?
- Apa progress state?
- Kapan progress dianggap committed?
- Apa side effect step?
- Apakah side effect idempotent?
- Jika crash setelah side effect tapi sebelum checkpoint, apa yang terjadi?
- Jika restart dengan parameter berbeda, apakah aman?
- Jika dataset berubah di tengah jalan, apa policy?
- Bagaimana operator tahu restart aman?

---

## 14. Designing Job/Step Boundaries

Step boundary adalah keputusan arsitektural, bukan sekadar pecah method.

### 14.1 Boundary yang Baik

Step yang baik biasanya punya:

- tujuan tunggal
- input/output jelas
- status meaningful
- transaction/checkpoint boundary jelas
- retry/skip policy jelas
- observability jelas
- restart semantics jelas

Contoh baik:

```text
Job: monthly-license-expiry-notification

Step 1: createCandidateSnapshot
  Output: work table license_expiry_candidates

Step 2: enrichCandidateContacts
  Input: work table
  Output: contact fields updated / missing contact marked

Step 3: generateNotificationOutbox
  Input: enriched candidates
  Output: notification outbox records

Step 4: publishNotificationDispatchRequest
  Input: outbox summary
  Output: dispatch event

Step 5: generateBatchSummary
  Output: summary report
```

Kenapa bagus?

- Snapshot memisahkan dataset dari live table.
- Enrichment bisa retry/skip.
- External dispatch tidak langsung dicampur dengan DB update utama.
- Summary bisa dibuat meskipun sebagian record skipped.

### 14.2 Boundary yang Buruk

```text
Step 1: doEverything
```

Di dalamnya:

- query data
- validate
- call external API
- update DB
- send email
- write report
- cleanup

Masalah:

- status tidak informatif
- restart tidak jelas
- checkpoint sulit
- side effect tercampur
- operator tidak tahu progress
- sulit tuning
- sulit test

### 14.3 Heuristik Step Boundary

Buat step baru ketika:

- ada perubahan jenis resource utama, misalnya DB → file → API
- ada transaction semantics berbeda
- ada retry/skip policy berbeda
- ada output intermediate yang penting
- ada keputusan flow berbeda
- ada kebutuhan audit/approval/operator visibility
- ada potensi restart dari titik itu
- ada capacity profile berbeda

Jangan buat step baru hanya karena:

- class terlalu panjang
- ingin “rapi” secara kosmetik
- semua method dijadikan step
- setiap query kecil dijadikan step

---

## 15. Durable Workload Identity

Batch production butuh identitas workload yang stabil.

Minimal identity:

```text
jobName
businessKey / businessDate / fileId / agency / tenant
requestId
jobInstanceId
jobExecutionId
correlationId
```

Contoh untuk file ingestion:

```text
jobName=importRenewalApplications
fileId=renewal_20260617_001.csv
fileChecksum=sha256:abc123...
uploadBatchId=UPL-2026-00091
agency=CEA
requestedBy=fajar
requestId=BR-2026-00022
```

Kenapa `fileChecksum` penting?

Karena nama file bisa sama tetapi isi berbeda. Jika restart memakai file berbeda, hasil bisa tidak defensible.

Untuk regulatory/audit-heavy system, identity harus mampu menjawab:

```text
Data input apa yang dipakai?
Versi aturan apa yang dipakai?
Siapa yang meminta?
Kapan dijalankan?
Apa output-nya?
Jika diulang, apakah input dan rule sama?
```

---

## 16. Batch as Control Plane + Data Plane

Pisahkan dua area:

```text
Control Plane:
  start, stop, restart, abandon, inspect, authorize, audit, validate parameters

Data Plane:
  actual processing: read, process, write, call API, update DB, generate files
```

### 16.1 Control Plane

Control plane biasanya berupa:

- admin REST API
- internal scheduler
- operator UI
- command handler
- audit service
- job request table
- JobOperator wrapper

Contoh flow:

```text
Admin UI
  ↓
BatchControlResource
  ↓
BatchGovernanceService
  ↓
JobOperator.start/restart/stop
  ↓
Job Repository
```

### 16.2 Data Plane

Data plane adalah artifact batch:

```text
JSL
Batchlet
ItemReader
ItemProcessor
ItemWriter
Listener
Partition components
```

### 16.3 Kenapa Dipisah?

Karena security dan audit berbeda.

Control plane menjawab:

```text
Siapa boleh menjalankan job apa dengan parameter apa?
```

Data plane menjawab:

```text
Bagaimana record diproses secara benar dan restartable?
```

Jika dicampur, biasanya akan muncul:

- artifact batch memvalidasi authorization secara parsial
- admin API langsung expose JobOperator tanpa guardrail
- parameter liar masuk ke JSL/artifact
- audit tidak lengkap
- duplicate job sulit dicegah

---

## 17. Example: Regulatory Case Ageing Batch

Mari gunakan skenario realistis.

### 17.1 Problem

Setiap malam, sistem harus menghitung ulang ageing case dan menentukan apakah case perlu masuk escalation queue.

Constraint:

- case bisa berubah selama hari berjalan
- beberapa case sedang dalam manual review
- aturan ageing bisa berubah per effective date
- audit harus jelas
- job bisa gagal karena DB timeout
- restart tidak boleh membuat escalation duplicate
- operator harus bisa melihat progress

### 17.2 Naive Design

```java
public void run() {
    List<Case> cases = caseRepository.findAllActiveCases();
    for (Case c : cases) {
        AgeingResult result = ageingService.calculate(c);
        caseRepository.updateAgeing(c.id(), result);
        if (result.shouldEscalate()) {
            escalationService.createEscalation(c.id());
        }
    }
}
```

Masalah:

- loading banyak data ke memory
- tidak ada checkpoint
- dataset tidak stabil
- jika crash, mulai dari nol
- escalation bisa duplicate
- tidak ada job execution state
- operator tidak tahu sudah sampai mana
- tidak ada skip/retry policy

### 17.3 Batch-Oriented Design

```text
Job: nightlyCaseAgeing

Parameters:
  businessDate
  agency
  ruleVersion
  requestedBy
  requestId

Step 1: createCandidateSnapshot      batchlet
  - select active cases eligible for ageing
  - insert case IDs into BATCH_CASE_AGEING_WORK
  - store snapshot timestamp and ruleVersion

Step 2: recalculateAgeing            chunk
  - read work table by stable keyset
  - calculate ageing
  - write ageing result idempotently
  - checkpoint by work item ID

Step 3: createEscalationOutbox        chunk
  - read cases requiring escalation
  - insert outbox with unique key
  - duplicate key means already requested

Step 4: generateSummary               batchlet
  - count processed/skipped/failed
  - write summary report

Step 5: markBatchRequestCompleted     batchlet
  - update custom batch request table
```

### 17.4 State Tables

Custom work table:

```sql
CREATE TABLE BATCH_CASE_AGEING_WORK (
    REQUEST_ID          VARCHAR2(64)  NOT NULL,
    CASE_ID             VARCHAR2(64)  NOT NULL,
    BUSINESS_DATE       DATE          NOT NULL,
    RULE_VERSION        VARCHAR2(64)  NOT NULL,
    STATUS              VARCHAR2(32)  NOT NULL,
    ERROR_CODE          VARCHAR2(128),
    ERROR_MESSAGE       VARCHAR2(1000),
    CREATED_AT          TIMESTAMP     NOT NULL,
    UPDATED_AT          TIMESTAMP,
    CONSTRAINT PK_BATCH_CASE_AGEING_WORK PRIMARY KEY (REQUEST_ID, CASE_ID)
);
```

Outbox table:

```sql
CREATE TABLE ESCALATION_OUTBOX (
    OUTBOX_ID           VARCHAR2(64)  PRIMARY KEY,
    IDEMPOTENCY_KEY     VARCHAR2(256) NOT NULL UNIQUE,
    CASE_ID             VARCHAR2(64)  NOT NULL,
    REQUEST_ID          VARCHAR2(64)  NOT NULL,
    EVENT_TYPE          VARCHAR2(64)  NOT NULL,
    PAYLOAD             CLOB          NOT NULL,
    STATUS              VARCHAR2(32)  NOT NULL,
    CREATED_AT          TIMESTAMP     NOT NULL
);
```

Idempotency key:

```text
nightlyCaseAgeing:{businessDate}:{agency}:{caseId}:createEscalation
```

### 17.5 Restart Story

Jika job gagal di Step 2 setelah 80,000 dari 120,000 case:

```text
JobExecution #1 FAILED
  Step 1 COMPLETED
  Step 2 FAILED at checkpoint workItemId=80000
```

Restart:

```text
JobExecution #2 STARTED
  Step 1 skipped because completed
  Step 2 resumes from checkpoint/work table state
  Step 3 starts only after Step 2 completes
  Step 4 generates summary
```

Jika Step 3 mengulang outbox insert, unique idempotency key mencegah duplicate escalation.

---

## 18. Relationship with Transactions

Batch transaction harus dipahami berbeda dari request transaction.

Request transaction biasanya:

```text
HTTP request begins
  service operation
  DB update
commit
HTTP response
```

Batch chunk transaction:

```text
read item 1..500
process item 1..500
write item 1..500
commit chunk
checkpoint
repeat
```

### 18.1 Why Not One Big Transaction?

Satu transaksi besar untuk 1 juta record buruk karena:

- lock terlalu lama
- undo/redo pressure tinggi
- rollback mahal
- blocking user transaction
- memory persistence context membesar
- failure di akhir membatalkan semua
- tidak restart-friendly

### 18.2 Transaction Boundary as Restart Boundary

Dalam chunk processing, commit boundary sering menjadi restart boundary.

Artinya:

```text
Apa yang sudah committed dianggap selesai.
Apa yang belum committed bisa diulang.
```

Karena itu writer harus aman jika item terakhir dalam chunk diulang akibat crash sebelum checkpoint final.

### 18.3 Transaction and External API

Jangan menganggap DB transaction bisa mencakup external API.

```text
DB commit tidak bisa atomic dengan HTTP call.
```

Gunakan:

- outbox
- idempotency key
- reconciliation
- compensation
- retry with deduplication

---

## 19. Relationship with Concurrency

Jakarta Batch tidak berarti semua step berjalan paralel.

Default mental model:

```text
Job executes steps according to graph.
Each step may be sequential or parallel depending on split/partition.
Chunk processing can process many items but not automatically parallel unless partitioned.
```

### 19.1 Parallelism Sources

Batch dapat memiliki parallelism dari:

1. Multiple jobs running at the same time
2. Split flow
3. Partitioned step
4. Internal implementation thread pool
5. External concurrent resources
6. Multiple cluster nodes, depending on implementation and deployment

### 19.2 Capacity Danger

Jika kamu menjalankan:

```text
5 jobs × 8 partitions × chunk size 1000 × writer JDBC batch 500
```

Maka pressure ke DB bisa sangat besar.

Batch design harus mempertimbangkan:

- DB connection pool
- lock contention
- external API rate limits
- CPU cores
- memory
- GC
- file I/O
- network bandwidth
- tenant fairness

### 19.3 Virtual Threads and Batch

Virtual threads tidak otomatis membuat batch lebih cepat.

Mereka membantu jika bottleneck adalah blocking I/O dengan banyak concurrent waits.

Mereka tidak membantu jika bottleneck adalah:

- CPU-heavy calculation
- DB write throughput
- lock contention
- external API rate limit
- non-idempotent side effect
- large heap object graph

Untuk batch, pertanyaan utama tetap:

```text
Apa bottleneck sebenarnya dan capacity guardrail-nya apa?
```

---

## 20. Observability Model for Batch

Batch observability minimal harus mencakup tiga lapisan.

### 20.1 Runtime Observability

Dari job repository/runtime:

- job execution status
- step execution status
- start/end time
- duration
- failed step
- exit status
- batch status

### 20.2 Workload Observability

Dari artifact/listener/custom metrics:

- read count
- process count
- write count
- skip count
- retry count
- commit count
- rollback count
- chunk duration
- partition duration
- external API latency
- DB write latency

### 20.3 Domain Observability

Dari domain audit/report:

- jumlah case diproses
- jumlah escalation dibuat
- jumlah case skipped karena locked/manual review
- jumlah invalid record
- jumlah API failure
- business impact summary

### 20.4 Operator View

Operator seharusnya melihat:

```text
Job: nightlyCaseAgeing
Execution: 9001
Business Date: 2026-06-17
Requested By: system:scheduler
Status: RUNNING
Current Step: recalculateAgeing
Progress: 80,000 / 120,000
Skip: 12
Retry: 47
Started: 01:00
ETA: 01:45
Last Error: API timeout to registry, retrying
Can Stop: yes
Can Restart: not applicable while running
```

Tanpa view seperti ini, batch akan menjadi black box.

---

## 21. Error Taxonomy in Batch

Batch error harus diklasifikasikan.

### 21.1 Transient Error

Contoh:

- DB connection timeout
- HTTP 503
- temporary DNS failure
- lock timeout yang bisa retry

Policy:

- retry dengan backoff
- limit retry
- fail jika threshold habis

### 21.2 Permanent Data Error

Contoh:

- invalid date format
- missing mandatory field
- unknown reference code

Policy:

- skip jika allowed
- record-level error report
- fail jika melebihi threshold

### 21.3 Poison Record

Record selalu menyebabkan failure karena bug/data unexpected.

Policy:

- quarantine
- skip with audit
- manual review
- do not infinite retry

### 21.4 Business Rule Stop

Contoh:

- no data
- invalid input manifest
- approval missing
- rule version not active

Policy:

- end gracefully dengan exit status meaningful
- atau fail dengan reason jelas

### 21.5 Systemic Failure

Contoh:

- DB unavailable
- downstream API outage
- schema mismatch
- deployment incompatibility

Policy:

- fail fast
- avoid processing partial huge workload
- alert operator
- restart after fix

---

## 22. Jakarta Batch and CDI

Batch artifacts di Jakarta EE dapat berinteraksi dengan CDI tergantung versi/implementasi dan cara artifact didefinisikan.

Prinsip desain:

- gunakan dependency injection untuk service stateless/domain service
- hindari menyimpan mutable execution state di singleton/application scoped bean tanpa key execution
- simpan state restartable di checkpoint/repository/work table
- jangan mengandalkan request scope
- hati-hati dengan transaction interceptor di artifact batch
- pisahkan domain service dari batch artifact agar reusable/testable

Contoh pattern:

```java
@Named
public class CaseAgeingProcessor implements ItemProcessor {

    @Inject
    AgeingPolicyService ageingPolicyService;

    @Override
    public Object processItem(Object item) throws Exception {
        CaseWorkItem workItem = (CaseWorkItem) item;
        return ageingPolicyService.calculate(workItem.caseId(), workItem.businessDate());
    }
}
```

Artifact batch tipis, domain logic berada di service.

---

## 23. Jakarta Batch and Security

Job bisa dipicu oleh:

- scheduler/system
- admin user
- support operator
- integration event
- migration script

Security model harus membedakan:

```text
requestedBy: siapa/apa yang meminta job
approvedBy: siapa yang menyetujui jika perlu
executedBy: identity runtime yang menjalankan job
effectiveAuthority: privilege yang dipakai untuk operasi
```

Jangan mengandalkan user session untuk pekerjaan panjang.

Jika user memulai job jam 10:00 dan session berakhir jam 10:15, job mungkin berjalan sampai jam 11:00. Audit harus tetap benar.

Simpan attribution eksplisit:

```properties
requestedBy=user:fajar
requestedAt=2026-06-17T10:00:00+07:00
requestChannel=admin-ui
reason=manual rerun after data fix
approvalId=APR-2026-00031
```

Batch runtime dapat berjalan sebagai system identity, tetapi domain effect tetap harus mencatat original requester.

---

## 24. Common Design Smells

### 24.1 “We Have a Batch Job” but No Restart Story

Gejala:

- kalau gagal, operator diminta “run ulang saja”
- tidak tahu record mana yang sudah diproses
- duplicate side effects sering terjadi
- manual SQL cleanup diperlukan

Fix:

- define checkpoint
- define idempotency key
- define work table/snapshot
- define restart test

### 24.2 One Huge Batchlet

Gejala:

- satu batchlet 2000 baris
- semua logic dalam satu `process()`
- progress hanya “running”
- stop tidak responsif
- restart mulai dari nol

Fix:

- pecah menjadi step/chunk
- gunakan work table
- tambahkan summary metrics
- define step output

### 24.3 Job Parameter Tidak Terkontrol

Gejala:

- parameter bebas dari UI
- SQL condition dikirim sebagai parameter
- restart dengan parameter berbeda
- tidak ada validation/audit

Fix:

- parameter contract
- allowlist value
- immutable identity parameters
- governance wrapper around JobOperator

### 24.4 Batch Menggunakan Live Query Tanpa Snapshot

Gejala:

- jumlah record berubah saat job berjalan
- restart memproses data baru
- hasil tidak bisa direkonsiliasi

Fix:

- snapshot candidate IDs
- manifest input
- stable keyset pagination
- processing status per item

### 24.5 External API Call Langsung dalam Writer Non-Idempotent

Gejala:

- duplicate notification/payment/escalation
- retry menghasilkan side effect ganda
- sulit membedakan sukses sebelum crash

Fix:

- outbox
- idempotency key
- response ledger
- reconciliation job

### 24.6 Tidak Ada Operator Control Plane

Gejala:

- start via hidden endpoint/script
- stop pakai restart pod
- status dari log grep
- audit tidak lengkap

Fix:

- BatchControlService
- JobOperator wrapper
- admin UI/API
- audit every control action

---

## 25. Implementation Skeleton

### 25.1 JSL Minimal

```xml
<?xml version="1.0" encoding="UTF-8"?>
<job id="nightlyCaseAgeing"
     xmlns="https://jakarta.ee/xml/ns/jakartaee"
     version="2.1">

    <properties>
        <property name="jobType" value="REGULATORY_CASE_BATCH" />
    </properties>

    <step id="createCandidateSnapshot" next="recalculateAgeing">
        <batchlet ref="createCandidateSnapshotBatchlet" />
    </step>

    <step id="recalculateAgeing" next="generateSummary">
        <chunk item-count="500">
            <reader ref="caseAgeingReader" />
            <processor ref="caseAgeingProcessor" />
            <writer ref="caseAgeingWriter" />
        </chunk>
    </step>

    <step id="generateSummary">
        <batchlet ref="generateAgeingSummaryBatchlet" />
    </step>

</job>
```

Catatan:

- Detail schema/version bisa bervariasi antar contoh dan server, ikuti XSD/spec server yang digunakan.
- Nama artifact `ref` biasanya mengarah ke named batch artifact/CDI bean.
- Part 18 akan membahas JSL jauh lebih detail.

### 25.2 Control Service

```java
import jakarta.batch.operations.JobOperator;
import jakarta.batch.runtime.BatchRuntime;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.time.LocalDate;
import java.util.Properties;

@ApplicationScoped
public class BatchControlService {

    @Inject
    BatchRequestRepository batchRequestRepository;

    public long startNightlyCaseAgeing(LocalDate businessDate, String agency, Actor actor, String reason) {
        authorize(actor, "nightlyCaseAgeing:start", agency);

        String requestId = batchRequestRepository.createRequest(
            "nightlyCaseAgeing",
            businessDate,
            agency,
            actor.id(),
            reason
        );

        Properties params = new Properties();
        params.setProperty("businessDate", businessDate.toString());
        params.setProperty("agency", agency);
        params.setProperty("requestedBy", actor.id());
        params.setProperty("reason", reason);
        params.setProperty("requestId", requestId);

        JobOperator operator = BatchRuntime.getJobOperator();
        long executionId = operator.start("nightlyCaseAgeing", params);

        batchRequestRepository.markStarted(requestId, executionId);
        return executionId;
    }

    private void authorize(Actor actor, String action, String agency) {
        // enforce RBAC/ABAC here
    }
}
```

Jika platform menyediakan CDI bean `JobOperator`, kamu dapat inject sesuai dukungan versi/implementasi. Jakarta Batch 2.1 memperjelas aspek penyediaan `JobOperator` sebagai CDI bean ketika aplikasi tidak menyediakannya, tetapi tetap perhatikan ambiguitas jika aplikasi legacy pernah membuat bean sendiri.

### 25.3 Batchlet

```java
import jakarta.batch.api.AbstractBatchlet;
import jakarta.batch.runtime.context.JobContext;
import jakarta.inject.Inject;
import jakarta.inject.Named;

@Named
public class CreateCandidateSnapshotBatchlet extends AbstractBatchlet {

    @Inject
    JobContext jobContext;

    @Inject
    CandidateSnapshotService snapshotService;

    private volatile boolean stopRequested;

    @Override
    public String process() throws Exception {
        String requestId = jobContext.getProperties().getProperty("requestId");
        String businessDate = jobContext.getProperties().getProperty("businessDate");
        String agency = jobContext.getProperties().getProperty("agency");

        if (stopRequested) {
            return "STOPPED_BEFORE_START";
        }

        int count = snapshotService.createSnapshot(requestId, businessDate, agency);

        return count == 0 ? "NO_DATA" : "SNAPSHOT_CREATED";
    }

    @Override
    public void stop() throws Exception {
        stopRequested = true;
    }
}
```

### 25.4 Reader/Processor/Writer Skeleton

```java
import jakarta.batch.api.chunk.ItemReader;
import jakarta.batch.runtime.context.JobContext;
import jakarta.inject.Inject;
import jakarta.inject.Named;

import java.io.Serializable;

@Named
public class CaseAgeingReader implements ItemReader {

    @Inject
    JobContext jobContext;

    @Inject
    CaseAgeingWorkRepository repository;

    private String requestId;
    private String lastCaseId;

    @Override
    public void open(Serializable checkpoint) throws Exception {
        requestId = jobContext.getProperties().getProperty("requestId");
        if (checkpoint != null) {
            lastCaseId = (String) checkpoint;
        }
    }

    @Override
    public Object readItem() throws Exception {
        CaseWorkItem next = repository.findNext(requestId, lastCaseId);
        if (next == null) {
            return null;
        }
        lastCaseId = next.caseId();
        return next;
    }

    @Override
    public Serializable checkpointInfo() throws Exception {
        return lastCaseId;
    }

    @Override
    public void close() throws Exception {
        // close resources if any
    }
}
```

Processor:

```java
import jakarta.batch.api.chunk.ItemProcessor;
import jakarta.inject.Inject;
import jakarta.inject.Named;

@Named
public class CaseAgeingProcessor implements ItemProcessor {

    @Inject
    AgeingPolicyService ageingPolicyService;

    @Override
    public Object processItem(Object item) throws Exception {
        CaseWorkItem workItem = (CaseWorkItem) item;
        return ageingPolicyService.calculate(workItem);
    }
}
```

Writer:

```java
import jakarta.batch.api.chunk.ItemWriter;
import jakarta.inject.Inject;
import jakarta.inject.Named;

import java.io.Serializable;
import java.util.List;

@Named
public class CaseAgeingWriter implements ItemWriter {

    @Inject
    CaseAgeingResultRepository repository;

    @Override
    public void open(Serializable checkpoint) throws Exception {
    }

    @Override
    public void writeItems(List<Object> items) throws Exception {
        for (Object item : items) {
            AgeingResult result = (AgeingResult) item;
            repository.upsertResultIdempotently(result);
        }
    }

    @Override
    public Serializable checkpointInfo() throws Exception {
        return null;
    }

    @Override
    public void close() throws Exception {
    }
}
```

Catatan penting:

- Skeleton ini untuk mental model, bukan final production code.
- Detail transaction, exception classification, skip/retry, partitioning, dan JSL akan dibahas di part berikutnya.

---

## 26. Testing Mental Model

Batch testing harus lebih luas dari unit test artifact.

### 26.1 Test Definition

- JSL valid
- artifact names resolve
- required parameters exist
- transition path benar

### 26.2 Test Execution

- job bisa start
- step urutan benar
- status akhir sesuai
- exit status sesuai

### 26.3 Test Restart

Simulasikan:

- failure di tengah chunk
- crash setelah write sebelum checkpoint
- stop manual
- restart dengan parameter sama
- restart dengan parameter berbeda ditolak

### 26.4 Test Idempotency

- writer dipanggil dua kali untuk item sama
- outbox insert duplicate
- external API response replay
- summary tidak double count

### 26.5 Test Observability

- metrics muncul
- audit control action muncul
- job execution linked ke requestId
- skipped records masuk error report

### 26.6 Test Operator Scenario

- start duplicate ditolak
- stop running job
- restart failed job
- abandon invalid job
- unauthorized user ditolak

---

## 27. Decision Framework: Is This a Batch Job?

Gunakan pertanyaan berikut.

### 27.1 Cocok untuk Jakarta Batch jika:

- workload memproses banyak item/record/file
- durasi lebih lama dari request normal
- perlu restart dari state
- perlu operator start/stop/restart
- perlu job history
- perlu checkpoint
- perlu skip/retry per item
- perlu step graph
- dekat dengan Jakarta EE service/JPA/JTA/CDI

### 27.2 Lebih cocok ManagedExecutorService jika:

- task pendek
- tidak perlu durable restart
- tidak perlu job repository
- hanya async offload
- failure bisa dilaporkan langsung/cepat

### 27.3 Lebih cocok Messaging jika:

- event-driven
- item independent
- producer-consumer decoupling penting
- job-level orchestration tidak dominan
- throughput streaming lebih penting dari batch execution graph

### 27.4 Lebih cocok Workflow Engine jika:

- ada human approval
- ada business process long-running
- state transition domain kompleks
- compensation flow bisnis penting
- visibility process lebih penting dari item chunking

### 27.5 Lebih cocok Kubernetes Job jika:

- workload lebih cocok sebagai process/container terpisah
- tidak butuh Jakarta EE runtime integration
- isolation lebih penting
- scheduling platform-native cukup
- job logic bisa dikemas CLI/stateless worker

---

## 28. Production Checklist

Sebelum menyebut workload sebagai “batch siap production”, pastikan:

### 28.1 Job Identity

- [ ] job name stabil
- [ ] identity parameters jelas
- [ ] requestId/correlationId ada
- [ ] duplicate policy jelas
- [ ] rerun policy jelas

### 28.2 Parameters

- [ ] required parameters divalidasi
- [ ] allowed values dibatasi
- [ ] sensitive parameter tidak masuk log
- [ ] restart mutability policy jelas
- [ ] parameter contract terdokumentasi

### 28.3 Steps

- [ ] setiap step punya tujuan jelas
- [ ] step boundary sesuai transaction/retry/observability
- [ ] batchlet tidak menjadi god object
- [ ] chunk step punya reader/processor/writer yang jelas

### 28.4 Restartability

- [ ] input dataset stabil
- [ ] checkpoint benar
- [ ] writer idempotent
- [ ] external side effect aman
- [ ] restart test ada

### 28.5 Failure Handling

- [ ] error taxonomy jelas
- [ ] transient retry policy ada
- [ ] permanent data error policy ada
- [ ] poison record policy ada
- [ ] systemic failure fail-fast jika perlu

### 28.6 Control Plane

- [ ] JobOperator tidak diekspos mentah
- [ ] authorization ada
- [ ] audit start/stop/restart/abandon ada
- [ ] operator reason/comment disimpan
- [ ] stop/restart/abandon policy jelas

### 28.7 Observability

- [ ] job/step status terlihat
- [ ] progress terlihat
- [ ] metrics item/chunk ada
- [ ] error report ada
- [ ] domain effect audit ada
- [ ] dashboard/alert tersedia

### 28.8 Capacity

- [ ] concurrency limit ada
- [ ] DB connection impact dihitung
- [ ] chunk size dituning
- [ ] external API rate limit dihormati
- [ ] partitioning tidak liar

---

## 29. Thought Experiments

### Exercise 1 — Job Identity

Kamu punya job `importApplicantCsv`.

Parameter:

```properties
fileName=applicants.csv
uploadedBy=fajar
chunkSize=1000
```

Pertanyaan:

1. Apakah `fileName` cukup sebagai identity?
2. Apakah `chunkSize` bagian dari identity?
3. Apa yang terjadi jika file dengan nama sama di-upload ulang dengan isi berbeda?
4. Parameter apa yang harus ditambahkan?

Jawaban yang diharapkan:

- `fileName` tidak cukup.
- Tambahkan `fileId`, `checksum`, `uploadBatchId`, `tenant/agency`, `requestedBy`, `requestId`.
- `chunkSize` biasanya execution configuration, bukan identity, tetapi perubahan saat restart perlu policy.

### Exercise 2 — Restart Risk

Step writer mengirim email langsung setelah update DB.

Crash terjadi setelah email terkirim tetapi sebelum checkpoint tersimpan.

Pertanyaan:

1. Apa risiko saat restart?
2. Bagaimana memperbaiki desain?

Jawaban yang diharapkan:

- Email bisa terkirim dua kali.
- Gunakan notification outbox dengan idempotency key.
- Dispatcher mengirim email berdasarkan outbox dan menyimpan send result.

### Exercise 3 — Step Boundary

Job punya step tunggal `processAll()` yang:

- membaca file
- validasi
- insert DB
- call API
- generate report

Pertanyaan:

1. Boundary step apa yang lebih baik?
2. Di mana checkpoint diletakkan?
3. Apa output intermediate yang perlu disimpan?

Jawaban yang diharapkan:

- pecah menjadi validate manifest, snapshot/stage records, process chunk, create outbox/API request, generate report.
- checkpoint di chunk processing.
- simpan staged records, error records, output manifest, outbox.

---

## 30. Ringkasan

Jakarta Batch adalah model eksekusi untuk workload yang:

- berdurasi panjang
- berbasis dataset/item/file
- membutuhkan state durable
- bisa diinspeksi operator
- bisa stop/restart
- punya checkpoint
- punya status teknis dan status domain
- butuh audit dan governance

Konsep paling penting:

```text
Job Definition  = blueprint pekerjaan
JobInstance     = pekerjaan logis dengan parameter tertentu
JobExecution    = attempt teknis menjalankan instance
Step            = unit kerja dalam job
StepExecution   = attempt teknis menjalankan step
JobRepository   = state durable batch runtime
JobOperator     = API control plane untuk operasi batch
BatchStatus     = lifecycle teknis
ExitStatus      = hasil/logika yang meaningful
```

Mental model top-tier:

```text
Batch bukan loop.
Batch adalah stateful execution system.

Batch bukan scheduler.
Batch adalah runtime untuk menjalankan dan mengelola workload.

Batch bukan sekadar async.
Batch adalah durable, restartable, observable, governed execution.
```

Jika kamu mendesain batch hanya sebagai “method yang dipanggil malam hari”, kamu akan gagal di restart, audit, idempotency, observability, dan operasi production.

Jika kamu mendesain batch sebagai **control plane + data plane + repository-backed state machine**, kamu mulai berada di level engineering yang jauh lebih matang.

---

## 31. Apa yang Akan Dibahas Selanjutnya

Part berikutnya akan masuk ke JSL:

```text
Part 18 — JSL Deep Dive: Job XML as Execution Graph
```

Kita akan membahas:

- struktur XML job
- properties
- step
- batchlet
- chunk
- flow
- split
- decision
- transition
- parameterization
- cara mendesain JSL agar tidak menjadi spaghetti XML

---

## 32. Status Seri

Seri **belum selesai**.

Progress saat ini:

- Part 0 selesai
- Part 1 selesai
- Part 2 selesai
- Part 3 selesai
- Part 4 selesai
- Part 5 selesai
- Part 6 selesai
- Part 7 selesai
- Part 8 selesai
- Part 9 selesai
- Part 10 selesai
- Part 11 selesai
- Part 12 selesai
- Part 13 selesai
- Part 14 selesai
- Part 15 selesai
- Part 16 selesai
- **Part 17 selesai**
- Part 18 berikutnya

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./16-production-failure-modes-jakarta-concurrency.md">⬅️ Part 16 — Production Failure Modes in Jakarta Concurrency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./18-jsl-job-specification-language-execution-graph.md">Part 18 — JSL Deep Dive: Job XML as Execution Graph ➡️</a>
</div>

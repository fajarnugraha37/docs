# Part 26 — JobOperator, Job Repository, and Runtime Control Plane

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `26-joboperator-job-repository-runtime-control-plane.md`  
> Scope: Java 8–25, Java EE/Jakarta EE Batch, `javax.batch` → `jakarta.batch`, Jakarta Batch 2.1 baseline  
> Goal: memahami Jakarta Batch bukan hanya sebagai API untuk menjalankan job, tetapi sebagai **runtime system** yang perlu punya control plane, state model, audit, governance, dan operational safety.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami peran `JobOperator` sebagai API kontrol runtime Jakarta Batch.
2. Membedakan konsep:
   - job name
   - job instance
   - job execution
   - step execution
   - job parameters
   - batch status
   - exit status
3. Mendesain endpoint/API internal untuk:
   - start job
   - stop job
   - restart job
   - abandon job
   - query job status
   - inspect execution history
4. Mencegah duplicate job launch di sistem clustered.
5. Mendesain audit trail untuk operasi batch.
6. Memahami batas portable Jakarta Batch vs detail implementasi vendor/server.
7. Membuat mental model job repository sebagai **source of truth runtime state**, bukan sekadar tabel teknis.
8. Mendesain batch control plane yang defensible untuk workload enterprise/regulatory.

---

## 2. Problem yang Diselesaikan

Pada bagian sebelumnya, kita sudah membahas:

- JSL sebagai execution graph.
- Batchlet sebagai task-oriented work.
- Chunk processing sebagai item transaction loop.
- Checkpoint, restartability, idempotency.
- Skip, retry, rollback.
- Transaction/database integration.
- Partitioning.
- Split, flow, decision.

Namun semua itu menjawab pertanyaan:

> “Bagaimana job dijalankan?”

Part ini menjawab pertanyaan yang berbeda:

> “Bagaimana job dikendalikan secara aman di production?”

Di production, batch bukan hanya kode. Batch adalah operasi.

Kamu butuh menjawab:

- Siapa yang boleh menjalankan job?
- Dengan parameter apa?
- Apakah job yang sama boleh berjalan dua kali?
- Bagaimana tahu job sedang running?
- Bagaimana menghentikan job dengan aman?
- Bagaimana restart dari failure?
- Bagaimana membedakan failure teknis, failure bisnis, dan stop manual?
- Apa yang diaudit?
- Bagaimana operator melihat progress?
- Apa yang terjadi jika pod mati saat job running?
- Apa yang terjadi jika user klik “Run” dua kali?
- Apa yang terjadi jika deployment dilakukan saat batch belum selesai?

Tanpa control plane, batch system biasanya berubah menjadi kumpulan tombol/script yang berbahaya.

---

## 3. Mental Model: JobOperator sebagai Control API, Repository sebagai Runtime Ledger

Jakarta Batch punya dua konsep besar:

```text
JSL + batch artifact
  = definisi pekerjaan

JobOperator + job repository
  = runtime control dan runtime state
```

JSL menjelaskan bentuk job.

`JobOperator` memberi cara untuk mengontrol job.

Job repository menyimpan fakta runtime.

```text
Operator / Admin / Scheduler / Application
                |
                v
          JobOperator API
                |
                v
        Batch Runtime Engine
                |
                v
          Job Repository
                |
                v
 JobExecution / StepExecution / Status / Checkpoint
```

Analogi yang kuat:

- JSL seperti **blueprint proses**.
- Batch artifact seperti **worker logic**.
- `JobOperator` seperti **control panel**.
- Job repository seperti **black box recorder / operational ledger**.

Kalau job gagal, kamu tidak menebak dari log saja. Kamu membaca repository state.

Kalau job restart, runtime tidak mulai dari nol. Runtime memakai repository/checkpoint.

Kalau operator melakukan stop, stop itu harus menjadi state transition yang bisa dilacak.

---

## 4. API Utama: `JobOperator`

Dalam Jakarta Batch, `JobOperator` adalah interface utama untuk mengontrol batch job runtime.

Namespace historis:

```java
// Java EE / JSR 352
javax.batch.operations.JobOperator
javax.batch.runtime.BatchRuntime

// Jakarta EE
jakarta.batch.operations.JobOperator
jakarta.batch.runtime.BatchRuntime
```

Akses umumnya:

```java
JobOperator jobOperator = BatchRuntime.getJobOperator();
```

Operasi penting:

```java
long start(String jobXMLName, Properties jobParameters);
void stop(long executionId);
long restart(long executionId, Properties restartParameters);
void abandon(long executionId);
JobExecution getJobExecution(long executionId);
List<StepExecution> getStepExecutions(long executionId);
Set<String> getJobNames();
int getJobInstanceCount(String jobName);
List<JobInstance> getJobInstances(String jobName, int start, int count);
List<Long> getRunningExecutions(String jobName);
Properties getParameters(long executionId);
```

Di beberapa versi/spesifikasi, detail signature bisa berbeda sedikit, tetapi mental modelnya stabil:

- start membuat execution baru.
- stop meminta runtime menghentikan execution.
- restart membuat execution baru berdasarkan execution lama yang restartable.
- abandon menandai execution tidak akan direstart.
- query membaca state runtime.

---

## 5. Runtime Entity Model

Untuk memahami `JobOperator`, kamu harus menguasai entity model Jakarta Batch.

### 5.1 Job Name

Job name adalah identitas definisi job.

Contoh JSL:

```xml
<job id="nightlyCaseAgeingJob" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    ...
</job>
```

`nightlyCaseAgeingJob` adalah nama job.

Job name menjawab:

> “Jenis pekerjaan apa ini?”

Contoh:

- `nightlyCaseAgeingJob`
- `externalRegistrySyncJob`
- `bulkCorrespondenceGenerationJob`
- `auditTrailArchivalJob`

---

### 5.2 Job Instance

Job instance merepresentasikan logical run untuk kombinasi job dan identifying parameters.

Secara mental:

```text
job instance = satu logical pekerjaan batch
```

Contoh:

```text
Job: nightlyCaseAgeingJob
Business date: 2026-06-17
Agency: CEA
```

Itu bisa dianggap satu logical instance.

Kalau gagal dan direstart, restart itu masih terkait logical instance yang sama, tetapi execution-nya berbeda.

---

### 5.3 Job Execution

Job execution adalah satu attempt eksekusi.

```text
job execution = satu percobaan menjalankan job instance
```

Contoh:

```text
JobInstance #1001
  Execution #2001: FAILED at step externalRegistrySync
  Execution #2002: STARTED by restart, COMPLETED
```

Pembedaan ini sangat penting.

Kalau engineer tidak membedakan instance dan execution, mereka biasanya salah desain restart.

---

### 5.4 Step Execution

Step execution adalah runtime state untuk satu step dalam satu job execution.

```text
JobExecution #2002
  StepExecution #3001 validateInputManifest COMPLETED
  StepExecution #3002 processRecords STARTED
  StepExecution #3003 generateSummary NOT_STARTED
```

Step execution menyimpan:

- step name
- batch status
- exit status
- start time
- end time
- metrics
- persistent user data/checkpoint-related state

---

### 5.5 Batch Status

`BatchStatus` adalah status runtime standar.

Umumnya meliputi:

- `STARTING`
- `STARTED`
- `STOPPING`
- `STOPPED`
- `FAILED`
- `COMPLETED`
- `ABANDONED`

Mental model:

```text
BatchStatus = apa yang runtime tahu tentang kondisi teknis eksekusi
```

Contoh:

```text
STARTED   -> sedang berjalan
FAILED    -> execution gagal
STOPPED   -> diminta berhenti dan berhasil berhenti
COMPLETED -> selesai menurut runtime
```

---

### 5.6 Exit Status

Exit status adalah string yang lebih fleksibel untuk business/flow routing.

Contoh:

```text
COMPLETED_WITH_SKIPS
COMPLETED_NO_DATA
COMPLETED_WITH_WARNINGS
FAILED_VALIDATION
FAILED_EXTERNAL_API
STOPPED_BY_OPERATOR
```

Mental model:

```text
ExitStatus = interpretasi domain/flow terhadap hasil execution
```

Batch status menjawab:

> “Execution technically selesai/gagal/berhenti?”

Exit status menjawab:

> “Makna hasilnya apa untuk proses bisnis atau routing berikutnya?”

---

## 6. State Transition Mental Model

Sebuah execution biasanya bergerak seperti ini:

```text
STARTING
   |
   v
STARTED
   |
   +--> COMPLETED
   |
   +--> FAILED
   |
   +--> STOPPING --> STOPPED
```

Setelah failed/stopped, bisa terjadi restart:

```text
Execution #1 FAILED
      |
      v
restart(Execution #1)
      |
      v
Execution #2 STARTING -> STARTED -> COMPLETED
```

Setelah abandoned:

```text
FAILED/STOPPED execution
      |
      v
ABANDONED
      |
      x cannot be restarted meaningfully
```

Secara governance, `abandon` tidak boleh dipakai sembarangan karena ia adalah keputusan operasional:

> “Execution ini tidak akan dipakai lagi sebagai basis restart.”

Untuk regulatory/compliance workload, abandon sebaiknya butuh reason, actor, dan approval.

---

## 7. Start Job

### 7.1 Basic Start

```java
import jakarta.batch.runtime.BatchRuntime;
import jakarta.batch.operations.JobOperator;

import java.util.Properties;

public class BatchLauncher {

    public long startNightlyCaseAgeing(String businessDate) {
        JobOperator operator = BatchRuntime.getJobOperator();

        Properties params = new Properties();
        params.setProperty("businessDate", businessDate);
        params.setProperty("requestedBy", "SYSTEM_SCHEDULER");

        return operator.start("nightlyCaseAgeingJob", params);
    }
}
```

`start()` mengembalikan `executionId`.

`executionId` ini harus disimpan jika aplikasi punya control plane sendiri.

---

### 7.2 Start Job Bukan Sekadar Memanggil API

Sebelum start, production control plane harus memvalidasi:

1. Apakah user/scheduler berhak menjalankan job ini?
2. Apakah parameter valid?
3. Apakah job yang sama sudah running?
4. Apakah business window mengizinkan?
5. Apakah dependency tersedia?
6. Apakah downstream capacity cukup?
7. Apakah job ini idempotent untuk parameter yang sama?
8. Apakah ada previous failed execution yang seharusnya direstart, bukan start baru?

Tanpa validasi ini, tombol start adalah footgun.

---

### 7.3 Bad Example: Direct Start from REST

```java
@Path("/batch")
public class UnsafeBatchResource {

    @POST
    @Path("/nightly-ageing/start")
    public Response start(@QueryParam("date") String date) {
        Properties props = new Properties();
        props.setProperty("businessDate", date);

        long id = BatchRuntime.getJobOperator()
                .start("nightlyCaseAgeingJob", props);

        return Response.ok(Map.of("executionId", id)).build();
    }
}
```

Masalah:

- Tidak ada authorization detail.
- Tidak ada duplicate prevention.
- Tidak ada parameter normalization.
- Tidak ada audit reason.
- Tidak ada request id.
- Tidak ada business calendar check.
- Tidak ada execution registry di aplikasi.
- Tidak membedakan manual run vs scheduler run.

---

### 7.4 Safer Start Flow

```text
POST /batch/jobs/nightly-case-ageing/runs
        |
        v
Authenticate user
        |
        v
Authorize action: BATCH_START_NIGHTLY_AGEING
        |
        v
Validate and normalize parameters
        |
        v
Check duplicate running execution
        |
        v
Create durable JobRequest row
        |
        v
Call JobOperator.start(...)
        |
        v
Persist executionId into JobRequest
        |
        v
Return runId + executionId
```

Control plane tidak boleh hanya menjadi thin wrapper. Ia harus menjadi policy enforcement layer.

---

## 8. Job Parameters

Job parameters adalah input runtime job.

Contoh:

```java
Properties params = new Properties();
params.setProperty("businessDate", "2026-06-17");
params.setProperty("agency", "CEA");
params.setProperty("triggerType", "SCHEDULED");
params.setProperty("correlationId", correlationId);
```

### 8.1 Parameter Harus Stabil

Parameter yang menentukan logical work harus stable dan normalized.

Buruk:

```text
businessDate=17/06/2026
```

Lebih baik:

```text
businessDate=2026-06-17
```

Buruk:

```text
agency=cea
agency=CEA
agency= CEA
```

Lebih baik:

```text
agency=CEA
```

Jika parameter tidak stabil, duplicate prevention dan audit menjadi kacau.

---

### 8.2 Jangan Simpan Sensitive Data di Parameters

Hindari:

```text
password=...
accessToken=...
secretKey=...
fullNRIC=...
rawPayload=...
```

Gunakan reference:

```text
credentialRef=onemap/prod/client
inputManifestId=MANIFEST-20260617-001
```

Job parameters sering muncul di:

- repository
- log
- admin UI
- exception message
- support dump

Parameter harus dianggap semi-visible.

---

### 8.3 Parameter sebagai Contract

Definisikan parameter contract per job.

Contoh:

```text
Job: nightlyCaseAgeingJob

Required:
- businessDate: ISO date yyyy-MM-dd
- agency: enum agency code

Optional:
- dryRun: boolean, default false
- maxRecords: integer, default unlimited
- requestedBy: actor id
- correlationId: UUID

Forbidden:
- accessToken
- password
- raw PII payload
```

Untuk sistem besar, parameter contract sebaiknya ada di dokumentasi dan divalidasi programmatically.

---

## 9. Query Runtime State

### 9.1 Get Job Execution

```java
JobExecution execution = operator.getJobExecution(executionId);

BatchStatus status = execution.getBatchStatus();
String exitStatus = execution.getExitStatus();
Date startTime = execution.getStartTime();
Date endTime = execution.getEndTime();
```

Ini memberi status level job execution.

---

### 9.2 Get Step Executions

```java
List<StepExecution> steps = operator.getStepExecutions(executionId);

for (StepExecution step : steps) {
    System.out.println(step.getStepName());
    System.out.println(step.getBatchStatus());
    System.out.println(step.getExitStatus());
    System.out.println(step.getMetrics());
}
```

Step execution penting untuk progress UI.

Contoh tampilan operator:

```text
Execution #94021 — externalRegistrySyncJob
Status: STARTED

Step                         Status      Read   Write  Skip  Retry
validateManifest             COMPLETED   1      1      0     0
loadPendingRecords           COMPLETED   5000   5000   0     0
syncWithExternalRegistry     STARTED     3200   3150   12    18
generateSummary              NOT_STARTED -      -      -     -
```

---

### 9.3 Get Running Executions

```java
List<Long> running = operator.getRunningExecutions("nightlyCaseAgeingJob");
```

Ini berguna untuk duplicate prevention.

Namun hati-hati: di cluster, race condition tetap mungkin terjadi jika dua node melakukan check lalu start bersamaan.

```text
Node A checks running -> none
Node B checks running -> none
Node A starts
Node B starts
```

Maka check runtime saja tidak cukup. Butuh durable lock / unique constraint / job request table.

---

## 10. Stop Job

### 10.1 Basic Stop

```java
operator.stop(executionId);
```

Stop adalah request kepada runtime.

Stop bukan instant kill.

Mental model:

```text
operator.stop(id)
    means
"runtime, please transition this execution toward STOPPING/STOPPED cooperatively"
```

Untuk chunk step, runtime biasanya berhenti pada boundary yang aman.

Untuk batchlet, `stop()` dipanggil dan batchlet harus cooperative.

---

### 10.2 Stop Flow

```text
Operator clicks stop
        |
        v
Authorize BATCH_STOP
        |
        v
Record stop request: actor, reason, time
        |
        v
operator.stop(executionId)
        |
        v
Poll execution status
        |
        v
STOPPING -> STOPPED or FAILED
```

---

### 10.3 Stop Harus Diaudit

Minimal audit:

```json
{
  "eventType": "BATCH_STOP_REQUESTED",
  "jobName": "externalRegistrySyncJob",
  "executionId": 94021,
  "requestedBy": "fajar",
  "reason": "External registry maintenance window started",
  "requestedAt": "2026-06-17T22:10:05+07:00",
  "correlationId": "..."
}
```

Kemudian ketika benar-benar stopped:

```json
{
  "eventType": "BATCH_STOPPED",
  "jobName": "externalRegistrySyncJob",
  "executionId": 94021,
  "batchStatus": "STOPPED",
  "exitStatus": "STOPPED_BY_OPERATOR",
  "stoppedAt": "2026-06-17T22:10:42+07:00"
}
```

---

### 10.4 Stop Failure Mode

Stop bisa gagal secara operasional jika:

- task tidak cooperative
- batchlet tidak mengecek stop flag
- external HTTP call tidak punya timeout
- DB query long-running tidak bisa dibatalkan
- writer stuck pada downstream
- thread blocked pada lock
- pod mati sebelum repository update

Karena itu stop harus didukung oleh:

- timeout di semua I/O
- cooperative cancellation
- short transaction boundary
- checkpoint
- idempotency
- heartbeat/progress tracking

---

## 11. Restart Job

### 11.1 Basic Restart

```java
Properties restartParams = new Properties();
restartParams.setProperty("requestedBy", "fajar");
restartParams.setProperty("restartReason", "Recovered from API outage");

long newExecutionId = operator.restart(failedExecutionId, restartParams);
```

Restart menghasilkan execution baru.

```text
Execution #94021 FAILED
Execution #94035 STARTED as restart of #94021
```

---

### 11.2 Restart Bukan Start Ulang

Start baru:

```text
Mulai logical work baru
```

Restart:

```text
Lanjutkan logical work lama dari known recoverable state
```

Jika job gagal setelah 8 juta record dari 10 juta record, restart yang benar tidak memproses semuanya dari nol kecuali desainnya memang idempotent dan mengizinkan full replay.

---

### 11.3 Restart Decision

Sebelum restart, control plane harus mengecek:

1. Execution status eligible?
   - `FAILED` atau `STOPPED` biasanya kandidat.
2. Execution belum `ABANDONED`?
3. JSL job restartable?
4. Step yang gagal punya checkpoint valid?
5. Parameter restart valid?
6. Side effect sebelumnya idempotent?
7. Downstream dependency sudah pulih?
8. Apakah ada running execution untuk logical job yang sama?
9. Apakah user berhak restart?
10. Apakah restart butuh approval?

---

### 11.4 Restart Audit

```json
{
  "eventType": "BATCH_RESTART_REQUESTED",
  "jobName": "externalRegistrySyncJob",
  "previousExecutionId": 94021,
  "newExecutionId": 94035,
  "requestedBy": "fajar",
  "reason": "External API recovered after maintenance",
  "restartParameters": {
    "businessDate": "2026-06-17",
    "agency": "CEA"
  }
}
```

Restart adalah sensitive operation karena dapat menimbulkan duplicate side effects jika job tidak idempotent.

---

## 12. Abandon Job

### 12.1 Apa Itu Abandon?

`abandon(executionId)` menandai execution sebagai abandoned.

Secara governance:

```text
Execution ini dianggap tidak akan dilanjutkan/restart.
```

Ini biasanya digunakan ketika:

- execution state rusak
- checkpoint tidak lagi valid
- data input sudah diganti
- business memutuskan run tersebut tidak relevan
- job akan dijalankan ulang sebagai logical run baru

---

### 12.2 Abandon Bukan Delete

Abandon tidak berarti menghapus sejarah.

Justru abandon harus mempertahankan evidence:

```text
Execution #94021 ABANDONED
Reason: Input manifest replaced by MANIFEST-20260617-002
Approved by: Operations Lead
```

Untuk regulated system, jangan membuat tombol “delete execution history”.

History adalah evidence.

---

### 12.3 Abandon Flow

```text
Operator requests abandon
        |
        v
Authorize BATCH_ABANDON
        |
        v
Require reason
        |
        v
Check execution is FAILED/STOPPED
        |
        v
Maybe require approval
        |
        v
operator.abandon(executionId)
        |
        v
Audit BATCH_ABANDONED
```

---

## 13. Job Repository

### 13.1 Apa Itu Job Repository?

Job repository adalah storage runtime untuk batch metadata.

Secara konseptual menyimpan:

- job instance
- job execution
- step execution
- parameters
- status
- timestamps
- checkpoint data
- metrics
- persistent user data

Repository ini adalah basis untuk:

- restart
- status query
- execution history
- operational audit
- runtime coordination

---

### 13.2 Jangan Menganggap Repository sebagai Tabel Biasa

Walau secara fisik bisa berupa tabel database, secara konseptual repository adalah ledger runtime.

Jangan sembarangan:

- update manual status
- delete row execution
- edit checkpoint blob
- truncate repository untuk “cleanup” tanpa retention policy
- copy repository antar environment tanpa paham consequence

Manual tampering bisa merusak restartability.

---

### 13.3 Repository vs Application Audit Table

Job repository bukan pengganti audit aplikasi.

Repository menjawab:

```text
Apa yang batch runtime lakukan?
```

Audit aplikasi menjawab:

```text
Siapa meminta apa, kenapa, dengan approval apa, terhadap business object apa, dan dampaknya apa?
```

Keduanya saling melengkapi.

Contoh:

```text
Batch Repository:
- Execution #94021 FAILED at 2026-06-17T21:55
- Step externalSync FAILED
- Read 5000, Write 4320, Skip 12

Application Audit:
- Run requested by SYSTEM_SCHEDULER
- Business date 2026-06-17
- Affected agency CEA
- Failure caused by external API outage
- Restart approved by ops lead
```

---

## 14. Designing a Batch Control Plane

Control plane adalah lapisan aplikasi untuk mengelola batch runtime.

Minimal capabilities:

1. List jobs.
2. Start job with validated parameters.
3. Stop running execution.
4. Restart failed/stopped execution.
5. Abandon execution.
6. Show execution details.
7. Show step-level progress.
8. Show logs/trace correlation.
9. Show skipped/retried records.
10. Enforce authorization.
11. Record audit event.
12. Prevent duplicate run.
13. Support operational notes.

---

## 15. Control Plane Data Model

Walaupun Jakarta Batch punya repository, banyak enterprise system tetap butuh application-level table.

Contoh:

```sql
CREATE TABLE BATCH_JOB_REQUEST (
    ID                  VARCHAR2(36) PRIMARY KEY,
    JOB_NAME             VARCHAR2(200) NOT NULL,
    LOGICAL_KEY          VARCHAR2(500) NOT NULL,
    EXECUTION_ID         NUMBER,
    STATUS               VARCHAR2(50) NOT NULL,
    TRIGGER_TYPE         VARCHAR2(50) NOT NULL,
    REQUESTED_BY         VARCHAR2(200) NOT NULL,
    REQUESTED_AT         TIMESTAMP NOT NULL,
    APPROVED_BY          VARCHAR2(200),
    APPROVED_AT          TIMESTAMP,
    REQUEST_REASON       VARCHAR2(1000),
    PARAMETER_JSON       CLOB NOT NULL,
    CORRELATION_ID       VARCHAR2(100),
    CREATED_AT           TIMESTAMP NOT NULL,
    UPDATED_AT           TIMESTAMP NOT NULL
);
```

Unique constraint untuk duplicate prevention:

```sql
CREATE UNIQUE INDEX UK_BATCH_JOB_REQUEST_ACTIVE
ON BATCH_JOB_REQUEST (
    JOB_NAME,
    LOGICAL_KEY,
    CASE
        WHEN STATUS IN ('REQUESTED', 'STARTING', 'RUNNING', 'STOPPING') THEN STATUS
        ELSE NULL
    END
);
```

Catatan: syntax function-based/partial index berbeda per database. Di PostgreSQL bisa memakai partial unique index. Di Oracle, bisa memakai function-based index atau desain lock table terpisah.

---

## 16. Logical Key

Logical key adalah identitas business-level run.

Contoh:

```text
nightlyCaseAgeingJob|businessDate=2026-06-17|agency=CEA
externalRegistrySyncJob|source=REGISTRY_A|window=2026-06-17T00:00/23:59
bulkCorrespondenceJob|campaignId=CMP-2026-0617-001
```

Logical key digunakan untuk:

- mencegah duplicate logical run
- mencari previous execution
- audit
- idempotency
- operator UI

Jangan memakai executionId sebagai logical key.

ExecutionId adalah attempt id, bukan business identity.

---

## 17. Duplicate Launch Prevention

### 17.1 Problem

Di cluster:

```text
User double-clicks Run
Scheduler fires twice
Two pods receive same API request due to retry
Two nodes process same queue message
```

Tanpa lock/unique constraint:

```text
Same logical batch runs twice
```

Dampak:

- duplicate email
- duplicate external API update
- duplicate case escalation
- inconsistent report
- audit confusion
- DB contention

---

### 17.2 Weak Duplicate Prevention

Hanya memakai memory flag:

```java
private static boolean running = false;
```

Masalah:

- tidak bekerja di cluster
- hilang saat restart
- race condition
- tidak auditable

---

### 17.3 Better: Durable Job Request with Unique Logical Key

```text
BEGIN TRANSACTION

INSERT INTO BATCH_JOB_REQUEST (
  id,
  job_name,
  logical_key,
  status,
  parameter_json,
  requested_by,
  requested_at
)
VALUES (...)

-- unique constraint prevents duplicate active logical run

COMMIT

operator.start(jobName, params)

UPDATE BATCH_JOB_REQUEST
SET execution_id = ?, status = 'RUNNING'
WHERE id = ?
```

Jika insert gagal karena unique constraint, return:

```text
409 Conflict: job already running for logical key
```

---

### 17.4 Race Between Request Insert and Job Start

Ada edge case:

```text
JobRequest inserted as STARTING
App crashes before operator.start()
```

Solusi:

- status `STARTING` punya timeout/recovery policy
- background reconciler mengecek stale `STARTING`
- operator bisa retry start jika safe
- atau pakai transactional outbox untuk launch command

Contoh recovery:

```text
STARTING older than 10 minutes and no executionId
    -> mark LAUNCH_FAILED
    -> allow operator to retry
```

---

## 18. Launch Architecture Patterns

### 18.1 Direct Launch

```text
REST API -> validate -> JobOperator.start()
```

Cocok untuk:

- admin manual run
- low frequency jobs
- simple workloads

Risiko:

- request lifecycle tied to launch
- crash between audit and start
- duplicate handling harus eksplisit

---

### 18.2 Durable Launch Request

```text
REST API -> insert JobRequest -> launcher worker -> JobOperator.start()
```

Cocok untuk:

- regulated operation
- approval flow
- scheduled/manual unification
- retryable launch
- audit-heavy systems

Flow:

```text
REQUESTED -> APPROVED -> LAUNCHING -> RUNNING -> COMPLETED/FAILED/STOPPED
```

---

### 18.3 Scheduler-Driven Launch

```text
Scheduler -> create JobRequest -> launcher -> JobOperator.start()
```

Scheduler tidak langsung menjalankan business logic. Scheduler membuat request.

Keuntungan:

- manual dan scheduled run memakai jalur sama
- audit sama
- duplicate prevention sama
- parameter validation sama

---

### 18.4 Message-Driven Launch

```text
Event/Message -> JobRequest -> launcher -> JobOperator.start()
```

Cocok ketika batch dipicu oleh upstream event.

Tetap butuh idempotency karena message bisa redelivered.

---

## 19. Status Synchronization

Jika aplikasi punya `BATCH_JOB_REQUEST`, statusnya harus disinkronkan dengan batch repository.

Jangan mengandalkan status aplikasi tanpa membaca runtime.

Reconciliation loop:

```text
For each JobRequest where status in RUNNING/STOPPING:
    if executionId exists:
        execution = JobOperator.getJobExecution(executionId)
        update request status based on execution.batchStatus
```

Mapping contoh:

```text
BatchStatus.STARTING  -> STARTING
BatchStatus.STARTED   -> RUNNING
BatchStatus.STOPPING  -> STOPPING
BatchStatus.STOPPED   -> STOPPED
BatchStatus.FAILED    -> FAILED
BatchStatus.COMPLETED -> COMPLETED
BatchStatus.ABANDONED -> ABANDONED
```

Namun jangan hanya mapping mekanis. Exit status bisa memperkaya status aplikasi.

Contoh:

```text
BatchStatus.COMPLETED + exitStatus=COMPLETED_WITH_WARNINGS
    -> application status COMPLETED_WITH_WARNINGS
```

---

## 20. Progress Model

Operator tidak cukup melihat `RUNNING`.

Butuh progress.

Sumber progress:

- step execution metrics
- custom progress table
- reader position
- partition progress
- external side effect count
- skipped/retried records
- heartbeat timestamp

Contoh response API:

```json
{
  "jobName": "externalRegistrySyncJob",
  "executionId": 94021,
  "status": "RUNNING",
  "exitStatus": null,
  "startedAt": "2026-06-17T21:00:00+07:00",
  "lastHeartbeatAt": "2026-06-17T21:18:22+07:00",
  "steps": [
    {
      "name": "validateManifest",
      "status": "COMPLETED",
      "read": 1,
      "write": 1,
      "skip": 0,
      "retry": 0
    },
    {
      "name": "syncRecords",
      "status": "STARTED",
      "read": 5000,
      "write": 4820,
      "skip": 12,
      "retry": 31
    }
  ]
}
```

Progress bukan hanya untuk UI. Progress membantu incident response.

---

## 21. Authorization Model

Batch operations harus diperlakukan sebagai privileged operations.

Actions:

```text
BATCH_VIEW
BATCH_START
BATCH_STOP
BATCH_RESTART
BATCH_ABANDON
BATCH_APPROVE
BATCH_VIEW_PARAMETERS
BATCH_VIEW_ERROR_DETAILS
BATCH_DOWNLOAD_REPORT
```

Authorization bisa lebih granular:

```text
BATCH_START:nightlyCaseAgeingJob
BATCH_RESTART:externalRegistrySyncJob
BATCH_ABANDON:auditTrailArchivalJob
```

Untuk regulated system, start/restart/abandon mungkin butuh role berbeda.

---

## 22. Approval Model

Tidak semua job perlu approval.

Tapi beberapa job high-risk sebaiknya punya approval:

- bulk data correction
- external notification generation
- archival/purge
- enforcement escalation recalculation
- retry external side effects
- abandon execution

Flow:

```text
REQUESTED
   |
   v
PENDING_APPROVAL
   |
   +--> REJECTED
   |
   v
APPROVED
   |
   v
LAUNCHING -> RUNNING -> COMPLETED/FAILED
```

Audit harus menyimpan:

- requestedBy
- approvedBy
- approval time
- reason
- parameter diff
- risk classification

---

## 23. Runtime Governance Invariants

Control plane harus menjaga invariant berikut.

### Invariant 1: No Unauthorized Control

```text
No user/system can start, stop, restart, or abandon job without explicit authorization.
```

### Invariant 2: No Duplicate Active Logical Run

```text
For the same jobName + logicalKey, at most one active execution/request exists.
```

### Invariant 3: Parameters Are Validated Before Launch

```text
Invalid, ambiguous, or sensitive parameters cannot be submitted to runtime.
```

### Invariant 4: Every Control Action Is Audited

```text
Start/stop/restart/abandon actions must have actor, time, reason, parameters, and correlation.
```

### Invariant 5: Restart Must Be Based on Recoverable State

```text
A failed/stopped execution can be restarted only if its state and side effects are restart-safe.
```

### Invariant 6: Runtime State Must Be Reconciled

```text
Application status must not permanently diverge from batch repository status.
```

### Invariant 7: Operator Must See Enough Context to Act Safely

```text
Control plane must expose status, step progress, error reason, skip/retry count, and last heartbeat.
```

---

## 24. REST Control Plane Example

### 24.1 Resource Shape

```text
GET    /batch/jobs
GET    /batch/jobs/{jobName}
POST   /batch/jobs/{jobName}/runs
GET    /batch/runs/{runId}
POST   /batch/runs/{runId}/stop
POST   /batch/runs/{runId}/restart
POST   /batch/runs/{runId}/abandon
GET    /batch/runs/{runId}/steps
GET    /batch/runs/{runId}/events
GET    /batch/runs/{runId}/errors
```

Use `runId` aplikasi, bukan hanya `executionId`, karena `runId` bisa menaungi metadata governance.

---

### 24.2 Start Request

```json
{
  "businessDate": "2026-06-17",
  "agency": "CEA",
  "dryRun": false,
  "reason": "Nightly scheduled run"
}
```

Response:

```json
{
  "runId": "RUN-20260617-0001",
  "jobName": "nightlyCaseAgeingJob",
  "logicalKey": "nightlyCaseAgeingJob|businessDate=2026-06-17|agency=CEA",
  "status": "RUNNING",
  "executionId": 94021
}
```

---

### 24.3 Stop Request

```json
{
  "reason": "External dependency outage detected"
}
```

Response:

```json
{
  "runId": "RUN-20260617-0001",
  "status": "STOPPING"
}
```

---

### 24.4 Restart Request

```json
{
  "reason": "External dependency recovered",
  "restartParameters": {
    "maxRetryPerRecord": "3"
  }
}
```

Response:

```json
{
  "runId": "RUN-20260617-0001",
  "previousExecutionId": 94021,
  "newExecutionId": 94035,
  "status": "RUNNING"
}
```

---

## 25. Service Layer Example

```java
import jakarta.batch.operations.JobOperator;
import jakarta.batch.runtime.BatchRuntime;
import jakarta.batch.runtime.BatchStatus;
import jakarta.batch.runtime.JobExecution;

import java.time.LocalDate;
import java.util.Properties;

public class BatchControlService {

    private final BatchJobRequestRepository requestRepository;
    private final BatchAuditService auditService;
    private final BatchAuthorizationService authorizationService;

    public BatchControlService(
            BatchJobRequestRepository requestRepository,
            BatchAuditService auditService,
            BatchAuthorizationService authorizationService
    ) {
        this.requestRepository = requestRepository;
        this.auditService = auditService;
        this.authorizationService = authorizationService;
    }

    public BatchRunDto startNightlyCaseAgeing(
            Actor actor,
            LocalDate businessDate,
            String agency,
            String reason
    ) {
        authorizationService.require(actor, "BATCH_START", "nightlyCaseAgeingJob");

        String normalizedAgency = normalizeAgency(agency);
        String logicalKey = "nightlyCaseAgeingJob|businessDate=" + businessDate + "|agency=" + normalizedAgency;

        BatchJobRequest request = requestRepository.createActiveRequestOrThrowConflict(
                "nightlyCaseAgeingJob",
                logicalKey,
                actor.id(),
                reason,
                parametersJson(businessDate, normalizedAgency)
        );

        auditService.recordStartRequested(request, actor, reason);

        Properties params = new Properties();
        params.setProperty("businessDate", businessDate.toString());
        params.setProperty("agency", normalizedAgency);
        params.setProperty("requestedBy", actor.id());
        params.setProperty("requestId", request.id());
        params.setProperty("correlationId", request.correlationId());

        try {
            JobOperator operator = BatchRuntime.getJobOperator();
            long executionId = operator.start("nightlyCaseAgeingJob", params);

            requestRepository.markRunning(request.id(), executionId);
            auditService.recordStarted(request, executionId);

            return BatchRunDto.running(request.id(), executionId);
        } catch (RuntimeException ex) {
            requestRepository.markLaunchFailed(request.id(), ex.getMessage());
            auditService.recordLaunchFailed(request, ex);
            throw ex;
        }
    }

    public void stopRun(Actor actor, String runId, String reason) {
        BatchJobRequest request = requestRepository.findByIdOrThrow(runId);

        authorizationService.require(actor, "BATCH_STOP", request.jobName());

        if (request.executionId() == null) {
            throw new IllegalStateException("Run has no executionId");
        }

        auditService.recordStopRequested(request, actor, reason);

        JobOperator operator = BatchRuntime.getJobOperator();
        operator.stop(request.executionId());

        requestRepository.markStopping(runId);
    }

    public BatchRunDto restartRun(Actor actor, String runId, String reason) {
        BatchJobRequest request = requestRepository.findByIdOrThrow(runId);

        authorizationService.require(actor, "BATCH_RESTART", request.jobName());

        if (request.executionId() == null) {
            throw new IllegalStateException("Run has no executionId");
        }

        JobOperator operator = BatchRuntime.getJobOperator();
        JobExecution previous = operator.getJobExecution(request.executionId());

        if (previous.getBatchStatus() != BatchStatus.FAILED
                && previous.getBatchStatus() != BatchStatus.STOPPED) {
            throw new IllegalStateException("Only FAILED or STOPPED execution can be restarted");
        }

        auditService.recordRestartRequested(request, actor, reason);

        Properties restartParams = new Properties();
        restartParams.setProperty("restartRequestedBy", actor.id());
        restartParams.setProperty("restartReason", reason);
        restartParams.setProperty("correlationId", request.correlationId());

        long newExecutionId = operator.restart(request.executionId(), restartParams);

        requestRepository.markRestarted(runId, newExecutionId);
        auditService.recordRestarted(request, previous.getExecutionId(), newExecutionId);

        return BatchRunDto.running(runId, newExecutionId);
    }

    private String normalizeAgency(String agency) {
        if (agency == null || agency.isBlank()) {
            throw new IllegalArgumentException("agency is required");
        }
        return agency.trim().toUpperCase();
    }

    private String parametersJson(LocalDate businessDate, String agency) {
        return "{\"businessDate\":\"" + businessDate + "\",\"agency\":\"" + agency + "\"}";
    }
}
```

Catatan production:

- Jangan membuat JSON manual seperti contoh sederhana di atas; gunakan serializer normal.
- Repository method harus transactional.
- Duplicate active request sebaiknya dilindungi unique constraint, bukan hanya check query.
- `JobOperator.start()` dan update request bisa gagal di tengah; butuh reconciler.

---

## 26. Reconciler Design

Reconciler adalah background job kecil yang menyelaraskan state aplikasi dengan batch repository.

```text
Every N seconds/minutes:
    find active job requests
    for each request:
        if executionId is null and status STARTING too long:
            mark LAUNCH_STALE or LAUNCH_FAILED
        else:
            read JobExecution
            update app status, timestamps, exit status
            emit audit event if terminal transition observed
```

Pseudo-code:

```java
public class BatchStatusReconciler {

    public void reconcileActiveRuns() {
        List<BatchJobRequest> active = requestRepository.findActive();
        JobOperator operator = BatchRuntime.getJobOperator();

        for (BatchJobRequest request : active) {
            if (request.executionId() == null) {
                handleNoExecutionId(request);
                continue;
            }

            JobExecution execution = operator.getJobExecution(request.executionId());
            BatchStatus batchStatus = execution.getBatchStatus();
            String exitStatus = execution.getExitStatus();

            requestRepository.updateFromRuntime(
                    request.id(),
                    batchStatus.name(),
                    exitStatus,
                    execution.getStartTime(),
                    execution.getEndTime()
            );

            if (isTerminal(batchStatus)) {
                auditService.recordTerminalStatusObserved(request, execution);
            }
        }
    }

    private boolean isTerminal(BatchStatus status) {
        return status == BatchStatus.COMPLETED
                || status == BatchStatus.FAILED
                || status == BatchStatus.STOPPED
                || status == BatchStatus.ABANDONED;
    }
}
```

Di cluster, reconciler juga harus dijalankan dengan singleton/lock agar tidak semua pod melakukan update yang sama secara agresif.

---

## 27. Error and Event Model

Control plane harus menampilkan error dengan struktur.

Jangan hanya:

```text
FAILED
```

Lebih baik:

```json
{
  "status": "FAILED",
  "failureCategory": "EXTERNAL_API_TRANSIENT_FAILURE",
  "failedStep": "syncRecords",
  "failedAt": "2026-06-17T21:55:10+07:00",
  "message": "External registry returned HTTP 503 after retries exhausted",
  "retryable": true,
  "restartRecommended": true,
  "affectedRecords": 680,
  "correlationId": "..."
}
```

Event timeline:

```text
21:00:00 START_REQUESTED by scheduler
21:00:01 STARTED execution #94021
21:00:03 STEP_STARTED validateManifest
21:00:04 STEP_COMPLETED validateManifest
21:00:05 STEP_STARTED syncRecords
21:10:32 RETRY_THRESHOLD_WARNING syncRecords retry=100
21:55:10 STEP_FAILED syncRecords
21:55:11 JOB_FAILED execution #94021
22:05:00 RESTART_REQUESTED by fajar
22:05:02 RESTARTED execution #94035
```

Timeline sangat membantu postmortem.

---

## 28. Terminal State Semantics

Jangan menyamakan semua terminal state.

```text
COMPLETED
```

Pekerjaan selesai. Tapi exit status mungkin menunjukkan warnings/skips.

```text
FAILED
```

Execution gagal. Bisa restart jika state valid.

```text
STOPPED
```

Execution berhenti karena request/runtime condition. Bisa restart jika checkpoint valid.

```text
ABANDONED
```

Execution tidak akan direstart. Butuh audit reason.

Control plane harus menampilkan action yang sesuai:

| Status | Available Actions |
|---|---|
| STARTING | View, maybe stop |
| STARTED | View, stop |
| STOPPING | View |
| STOPPED | View, restart, abandon |
| FAILED | View, restart, abandon |
| COMPLETED | View, maybe rerun new logical request |
| ABANDONED | View only |

---

## 29. Handling Rerun

Rerun berbeda dari restart.

Restart:

```text
Continue failed/stopped logical run.
```

Rerun:

```text
Create new logical run, usually with same/similar parameters.
```

Rerun harus jelas:

- Apakah menggantikan hasil sebelumnya?
- Apakah membuat output baru?
- Apakah external side effects akan dikirim ulang?
- Apakah previous run harus abandoned dulu?
- Apakah output lama harus invalidated?

Contoh status:

```text
RUN-001 COMPLETED_WITH_WARNINGS
RUN-002 RERUN_OF RUN-001 COMPLETED
```

Untuk audit, hubungan rerun harus disimpan.

---

## 30. Parameter Diff on Restart/Rerun

Jika restart/rerun mengubah parameter, tampilkan diff.

```json
{
  "previous": {
    "maxRetryPerRecord": "3",
    "dryRun": "false"
  },
  "new": {
    "maxRetryPerRecord": "5",
    "dryRun": "false"
  }
}
```

Parameter diff penting karena restart dengan parameter berbeda dapat mengubah hasil.

Beberapa parameter harus immutable setelah first start:

- businessDate
- agency
- inputManifestId
- source system
- target dataset

Beberapa parameter boleh berubah saat restart:

- retry limit
- throttle rate
- resume mode
- notification flag

Pisahkan:

```text
identity parameters
execution policy parameters
operator note parameters
```

---

## 31. Multi-Tenant / Multi-Module Governance

Dalam sistem besar, batch job bisa berdampak ke banyak module/tenant.

Control plane perlu mendukung:

- tenant/agency scoping
- module ownership
- authorization per module
- rate/concurrency cap per module
- maintenance window per tenant
- audit per affected entity

Contoh logical key:

```text
job=caseAgeing|agency=CEA|module=ENFORCEMENT|businessDate=2026-06-17
```

Jangan membuat satu global “batch admin” tanpa batas. Itu terlalu powerful.

---

## 32. Cluster Considerations

### 32.1 JobOperator in Cluster

`JobOperator` dipanggil dari satu node, tetapi job repository bisa shared.

Pertanyaan yang harus dijawab per runtime/vendor:

- Apakah job execution bisa berpindah node?
- Bagaimana runtime menangani node crash?
- Apakah repository shared?
- Apakah partition execution distributed atau local?
- Apakah stop bisa dipanggil dari node berbeda?
- Apakah running execution query melihat seluruh cluster?

Jakarta Batch memberi model portable, tetapi cluster behavior sering dipengaruhi implementation/application server.

---

### 32.2 Kubernetes/EKS Reality

Dalam Kubernetes:

- pod bisa di-restart
- pod bisa di-evict
- deployment bisa kill running job
- liveness probe bisa membunuh pod stuck
- HPA bisa scale down pod yang menjalankan batch
- rolling update bisa terjadi saat execution aktif

Control plane harus mempertimbangkan:

- graceful shutdown
- stop request sebelum termination
- `terminationGracePeriodSeconds`
- preStop hook
- pod disruption budget
- singleton launcher
- external scheduler duplication

---

### 32.3 Avoid In-Memory Runtime Assumptions

Jangan bergantung pada:

```text
Map<executionId, Progress> in memory
```

Karena pod bisa mati.

Gunakan durable state untuk:

- request
- execution id
- progress penting
- skipped record details
- output manifest
- heartbeat

Memory cache boleh untuk performance, bukan source of truth.

---

## 33. Security and Data Exposure

Batch control plane sering menjadi tempat bocornya data.

Perhatikan:

- parameters bisa mengandung sensitive references
- error messages bisa mengandung PII
- skipped record details bisa mengandung payload sensitif
- logs bisa mengandung token/API response
- downloadable report bisa berisi regulated data

Design:

- mask sensitive parameter
- role-based detail access
- separate technical error vs business-safe message
- redact PII in UI
- audit access to error detail/report
- never expose secret values

Contoh masked response:

```json
{
  "parameters": {
    "businessDate": "2026-06-17",
    "agency": "CEA",
    "credentialRef": "onemap/prod/client",
    "accessToken": "***"
  }
}
```

Lebih baik: jangan simpan `accessToken` sama sekali.

---

## 34. Observability Integration

Control plane harus mengikat:

- run id
- execution id
- correlation id
- trace id
- log search link
- metrics dashboard
- audit event timeline

Contoh correlation design:

```text
runId: RUN-20260617-0001
executionId: 94021
correlationId: c9b9e9f4-...
traceId: 9f3a...
```

Log format:

```text
timestamp=... level=INFO runId=RUN-20260617-0001 executionId=94021 step=syncRecords recordId=CASE-123 message="record synced"
```

Tanpa correlation, operator akan bolak-balik antara UI, database, log, dan dashboard secara manual.

---

## 35. Testing the Control Plane

Test bukan hanya artifact batch.

Test control plane behavior.

### 35.1 Start Tests

- valid start creates JobRequest
- invalid parameter rejected
- unauthorized user rejected
- duplicate active logical run returns conflict
- launch failure marks request as launch failed
- execution id persisted after start

### 35.2 Stop Tests

- running job can be stopped
- terminal job cannot be stopped
- stop requires reason
- unauthorized stop rejected
- stop request audited

### 35.3 Restart Tests

- failed execution can be restarted
- stopped execution can be restarted
- completed execution cannot be restarted
- abandoned execution cannot be restarted
- restart creates new execution id
- restart reason audited

### 35.4 Abandon Tests

- failed execution can be abandoned
- stopped execution can be abandoned
- running execution cannot be abandoned directly
- abandon requires elevated role
- abandon requires reason

### 35.5 Reconciler Tests

- running execution updates app status
- completed execution marks request completed
- failed execution marks request failed
- stale starting request detected
- missing execution handled safely

### 35.6 Race Tests

- double start same logical key
- concurrent restart requests
- stop while job completes
- restart while another execution starts
- app crash after request insert before start
- app crash after start before execution id update

---

## 36. Common Anti-Patterns

### Anti-Pattern 1: Exposing `JobOperator` Directly to REST

```text
HTTP request -> JobOperator.start()
```

Without governance, this bypasses validation, audit, duplicate prevention, and approval.

---

### Anti-Pattern 2: Treating ExecutionId as Business Identity

`executionId` changes on restart.

Business identity should be logical key/run id.

---

### Anti-Pattern 3: Manual Repository Update

Updating batch repository tables directly can corrupt runtime state.

Use `JobOperator` and official APIs.

---

### Anti-Pattern 4: No Duplicate Protection

Checking `getRunningExecutions()` is not enough in cluster.

Use durable unique constraint/lock.

---

### Anti-Pattern 5: No Stop Semantics

If stop button exists but task cannot stop cooperatively, operator trust collapses.

---

### Anti-Pattern 6: Restart Without Idempotency Review

Restarting a non-idempotent job can duplicate side effects.

---

### Anti-Pattern 7: Sensitive Parameters in Repository

Never store tokens/secrets/raw PII as job parameters.

---

### Anti-Pattern 8: Only Logs, No Runtime UI

Logs are not a control plane.

Operator needs structured runtime state.

---

### Anti-Pattern 9: No Reconciler

Application status eventually diverges from runtime status.

---

### Anti-Pattern 10: Abandon as Cleanup

Abandon is governance decision, not cleanup button.

---

## 37. Production Checklist

### Job Definition

- [ ] Job name stable.
- [ ] Required parameters documented.
- [ ] Identity parameters separated from policy parameters.
- [ ] Sensitive data not stored in parameters.
- [ ] Exit status contract defined.

### Start Control

- [ ] Authorization enforced.
- [ ] Parameter validation implemented.
- [ ] Duplicate active logical run prevented by durable mechanism.
- [ ] Start request audited.
- [ ] Execution id stored.
- [ ] Launch failure handled.

### Stop Control

- [ ] Stop allowed only for running execution.
- [ ] Stop requires reason.
- [ ] Batchlet/chunk supports cooperative stop.
- [ ] I/O timeouts configured.
- [ ] Stop result reconciled.

### Restart Control

- [ ] Restart allowed only for eligible status.
- [ ] Restartability validated.
- [ ] Idempotency reviewed.
- [ ] Restart reason audited.
- [ ] New execution id linked to previous execution.

### Abandon Control

- [ ] Abandon restricted.
- [ ] Abandon requires reason.
- [ ] Abandon audit retained.
- [ ] Abandoned execution not hidden/deleted.

### Repository and State

- [ ] Runtime repository not manually modified.
- [ ] Application request table has reconciliation.
- [ ] Status mapping defined.
- [ ] Terminal states handled.
- [ ] Retention policy defined.

### Observability

- [ ] Run id, execution id, correlation id linked.
- [ ] Step progress visible.
- [ ] Metrics visible.
- [ ] Error category visible.
- [ ] Audit timeline visible.
- [ ] Logs searchable by run id.

### Cluster/Kubernetes

- [ ] Duplicate launch safe across nodes.
- [ ] Scheduler singleton or duplicate-safe.
- [ ] Graceful shutdown considered.
- [ ] Pod eviction behavior considered.
- [ ] Reconciler cluster-safe.

---

## 38. Thought Experiment: Regulatory Escalation Recalculation

Bayangkan ada job:

```text
Job: enforcementEscalationRecalculationJob
Parameter:
- businessDate
- agency
- escalationPolicyVersion
```

Dampak:

- memperbarui status case
- membuat audit trail
- memicu correspondence
- menyiapkan enforcement action

Pertanyaan desain:

1. Apakah job boleh dijalankan manual?
2. Siapa yang boleh start?
3. Apakah perlu approval?
4. Apa logical key-nya?
5. Apakah boleh dua job untuk agency sama berjalan paralel?
6. Jika gagal setelah 70% case, apakah restart atau rerun?
7. Apakah correspondence dikirim langsung atau lewat outbox?
8. Apa exit status jika ada 12 case invalid?
9. Apakah invalid case di-skip atau job fail?
10. Apa yang ditampilkan ke operator?
11. Apa yang diaudit untuk regulator?
12. Bagaimana mencegah double escalation?

Jawaban mature biasanya:

- start lewat control plane
- logical key berdasarkan businessDate + agency + policyVersion
- durable duplicate prevention
- case update idempotent
- correspondence lewat outbox
- restart dari checkpoint
- skipped case dicatat sebagai exception report
- audit actor/reason/parameter/output manifest
- approval untuk rerun/abandon

---

## 39. Core Takeaways

1. `JobOperator` adalah API kontrol runtime Jakarta Batch.
2. Job repository adalah ledger runtime untuk execution state, bukan tabel biasa untuk dimanipulasi manual.
3. `start`, `stop`, `restart`, dan `abandon` adalah operasi governance, bukan sekadar method call.
4. `executionId` adalah attempt identity, bukan business identity.
5. Production system butuh application-level `runId` dan `logicalKey`.
6. Duplicate prevention harus durable dan cluster-safe.
7. Restart harus didesain berdasarkan checkpoint, idempotency, dan side effect safety.
8. Stop harus cooperative dan didukung timeout/cancellation design.
9. Abandon adalah keputusan operasional yang harus diaudit.
10. Control plane harus menampilkan progress, step state, error category, audit timeline, dan action yang aman.
11. Untuk regulatory system, batch control plane adalah bagian dari defensibility architecture.

---

## 40. Ringkasan

Jakarta Batch menyediakan `JobOperator` untuk mengontrol job runtime: start, stop, restart, abandon, dan query execution state. Namun di production, API ini tidak boleh dipakai mentah-mentah sebagai tombol langsung. Ia harus dibungkus oleh control plane yang menegakkan authorization, parameter validation, duplicate launch prevention, audit, approval, reconciliation, dan observability.

Mental model terpenting:

```text
JSL defines what the job is.
Batch artifacts implement how the work is done.
JobOperator controls runtime execution.
Job repository records runtime truth.
Application control plane enforces operational governance.
```

Engineer top-tier tidak hanya bisa membuat batch job berjalan. Mereka mampu membuat batch job **dikendalikan, dihentikan, direstart, diaudit, diamati, dan dipertanggungjawabkan**.

---

## 41. Referensi

- Jakarta Batch 2.1 Specification — job, step, execution, JSL, repository, and runtime operation model.
- Jakarta Batch API — `jakarta.batch.operations.JobOperator`, `jakarta.batch.runtime.JobExecution`, `jakarta.batch.runtime.StepExecution`, `jakarta.batch.runtime.BatchStatus`.
- Jakarta EE 11 Platform Specification — Jakarta Batch 2.1 as platform component.
- Jakarta EE Tutorial — Batch Processing chapters and operational model.
- Java SE 8–25 concurrency/runtime context for executor, cancellation, and virtual thread-era operational thinking.

---

## 42. Status Seri

Part 26 selesai.

Seri belum selesai. Bagian berikutnya:

```text
Part 27 — Batch Listeners and Cross-Cutting Behavior
File: 27-batch-listeners-cross-cutting-behavior.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./25-split-flow-decision-complex-job-graphs.md">⬅️ Part 25 — Split, Flow, Decision, and Complex Job Graphs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./27-batch-listeners-cross-cutting-behavior.md">Part 27 — Batch Listeners and Cross-Cutting Behavior ➡️</a>
</div>

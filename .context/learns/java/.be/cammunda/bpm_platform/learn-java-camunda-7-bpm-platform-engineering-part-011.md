# learn-java-camunda-7-bpm-platform-engineering-part-011

# External Task Pattern Advanced: Pull Workers, Locking, Long Polling, Backpressure, dan Worker Fleet Design

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Part: `011`  
> Topik: External Task Pattern Advanced  
> Target: Java 8 hingga Java 25, Camunda BPM Platform / Camunda 7.x  
> Status seri: belum selesai

---

## 0. Tujuan Part Ini

Pada bagian sebelumnya kita sudah membahas extension point internal seperti `JavaDelegate`, `ExecutionListener`, `TaskListener`, `BpmnParseListener`, dan `ProcessEnginePlugin`. Semua itu berada dekat dengan process engine: kode Java berjalan di dalam aplikasi/engine runtime yang sama, ikut transaction engine, dan ikut classpath/process application.

Part ini membahas pendekatan berbeda: **External Task Pattern**.

External task memindahkan eksekusi work dari engine ke worker eksternal. Engine tidak memanggil kode worker secara langsung. Engine hanya membuat unit of work, menyimpannya di database, lalu worker melakukan `fetch and lock`, mengeksekusi pekerjaan, dan memberi tahu engine apakah pekerjaan selesai, gagal teknis, atau menghasilkan BPMN business error.

Tujuan part ini:

1. Memahami external task sebagai **pull-based distributed work contract**.
2. Memahami perbedaan external task dengan `JavaDelegate`, async job, message event, dan queue/messaging.
3. Memahami locking, lock duration, lock extension, retries, incident, dan BPMN error.
4. Mendesain Java worker yang aman terhadap crash, timeout, duplicate execution, dan partial failure.
5. Mendesain topic, backpressure, rate limiting, worker fleet, observability, dan deployment topology.
6. Memahami kapan external task tepat dipakai dan kapan justru menjadi anti-pattern.

Part ini bukan tutorial “hello external task”. Kita akan melihat external task sebagai salah satu pola paling penting di Camunda 7 untuk membangun platform enterprise yang decoupled, observable, dan operable.

---

## 1. Mental Model Utama

### 1.1 External Task Bukan Job Executor

Camunda 7 punya dua mekanisme penting yang sering tertukar:

| Mekanisme | Siapa yang eksekusi? | Unit kerja tersimpan di | Cocok untuk |
|---|---:|---|---|
| Async continuation/job | Job Executor engine | `ACT_RU_JOB` | Lanjutkan execution internal engine |
| External task | Worker eksternal | `ACT_RU_EXT_TASK` | Delegasi work ke service/worker luar |

Job executor adalah thread pool engine yang menjalankan job internal seperti async continuation dan timer.

External task adalah daftar pekerjaan yang **ditarik oleh worker eksternal**. Worker bisa berupa Java service, Spring Boot app, Node.js worker, Go worker, Python worker, atau service apa pun yang bisa memanggil REST API Camunda.

Mental modelnya:

```text
BPMN service task
  camunda:type="external"
  camunda:topic="risk-screening"
        │
        ▼
Engine reaches external service task
        │
        ▼
Create row in ACT_RU_EXT_TASK
        │
        ▼
Process instance waits
        │
        ▼
External worker fetches + locks task
        │
        ▼
Worker executes business/technical work
        │
        ├─ complete        -> process continues
        ├─ handleFailure   -> task remains/retry/incident
        └─ handleBpmnError -> BPMN error path
```

Engine tidak push HTTP request ke worker. Worker yang pull dari engine.

Ini penting: external task adalah **pull-based**, bukan push-based.

---

### 1.2 External Task Adalah Durable Work Item

Ketika process instance sampai ke external service task, process instance berhenti pada activity tersebut. Engine membuat external task record. Work item ini durable karena tersimpan di database engine.

Berarti:

- kalau worker sedang down, task tetap ada;
- kalau engine restart, task tetap ada;
- kalau worker crash setelah fetch, lock akan expired;
- kalau lock expired, worker lain bisa fetch lagi;
- kalau worker complete, engine melanjutkan process execution;
- kalau worker report failure dengan retries `0`, incident dapat dibuat.

Ini berbeda dari synchronous JavaDelegate. Pada JavaDelegate, engine memanggil kode langsung di thread dan transaction yang sama. Pada external task, engine menunggu sinyal dari luar.

---

### 1.3 External Task Bukan Message Broker

External task sering terlihat seperti queue:

- ada topic,
- ada worker,
- ada fetch,
- ada lock,
- ada retry.

Tetapi external task bukan Kafka/RabbitMQ/JMS.

Perbedaannya:

| Aspek | External Task | Message Broker |
|---|---|---|
| Tujuan utama | Melanjutkan BPMN process execution | Messaging/event distribution |
| Storage | Camunda DB | Broker log/queue storage |
| Acknowledgement | `complete` ke engine | ack/commit ke broker |
| Routing | topic external task | exchange/topic/partition/queue |
| Replay | Tidak dirancang sebagai event log | Kafka misalnya dirancang untuk replay |
| Consumer groups | Tidak sama persis | Native concept di broker tertentu |
| Backpressure | Via worker polling/lock/rate limit | Broker-specific mechanism |
| Coupling | Tied to process instance/activity | Independent event stream |

External task adalah **workflow work queue**, bukan general-purpose messaging backbone.

Top 1% engineer harus tahu kapan cukup memakai external task dan kapan butuh broker sungguhan.

---

## 2. Kenapa External Task Pattern Ada?

### 2.1 Problem dengan Internal Delegate

Internal delegate enak untuk kasus sederhana:

```java
public class ValidateAddressDelegate implements JavaDelegate {
  @Override
  public void execute(DelegateExecution execution) {
    // call address service
  }
}
```

Tetapi pada sistem enterprise, internal delegate punya beberapa masalah:

1. **Classpath coupling**  
   BPMN deployment bergantung pada class Java tertentu.

2. **Runtime coupling**  
   Engine dan integration code hidup di process yang sama.

3. **Failure coupling**  
   HTTP timeout, slow downstream, memory leak, atau thread starvation worker bisa berdampak ke engine app.

4. **Scaling coupling**  
   Untuk menaikkan throughput integration task, kita mungkin harus scale engine app juga.

5. **Security boundary lemah**  
   Engine app harus punya credential untuk semua downstream systems.

6. **Technology lock-in**  
   Semua worker harus compatible dengan JVM/classpath engine.

External task memecah coupling ini.

---

### 2.2 External Task sebagai Remote Work Contract

Dengan external task:

- engine menyimpan state process;
- worker mengambil work berdasarkan topic;
- worker bisa deploy independen;
- worker bisa scale independen;
- worker bisa ditulis dalam bahasa berbeda;
- worker bisa punya credential dan network route sendiri;
- engine tidak perlu tahu detail implementasi downstream.

Modelnya:

```text
              ┌────────────────────┐
              │ Camunda 7 Engine    │
              │ BPMN + State + DB   │
              └─────────┬──────────┘
                        │ external task topic
                        ▼
       ┌──────────────────────────────────┐
       │ ACT_RU_EXT_TASK                  │
       │ topic=risk-screening             │
       │ lock_exp_time=null               │
       └──────────────────────────────────┘
                        ▲
                        │ fetchAndLock / complete / failure
                        │
        ┌───────────────┴────────────────┐
        │ Risk Screening Worker           │
        │ Java/Spring Boot/Go/Node/etc.   │
        └────────────────────────────────┘
```

The contract is not Java class. The contract is:

- topic name,
- variables requested,
- variable schema,
- lock duration,
- retry/error semantics,
- completion variables,
- BPMN error codes,
- idempotency key,
- observability metadata.

---

## 3. BPMN Model untuk External Task

External task service task biasanya ditulis seperti ini dalam BPMN XML:

```xml
<bpmn:serviceTask
    id="ValidateAddressTask"
    name="Validate Address"
    camunda:type="external"
    camunda:topic="address-validation">
</bpmn:serviceTask>
```

Mental model BPMN:

```text
[Before Task] ---> (External Service Task) ---> [After Task]
                       │
                       │ engine creates external task
                       ▼
                 process waits here
```

Worker tidak “melompati BPMN”. Worker hanya menyelesaikan activity yang sedang menunggu.

---

### 3.1 Topic adalah Contract, Bukan Nama Class

`camunda:topic="address-validation"` harus diperlakukan seperti public API.

Topic yang buruk:

```text
service-task-1
worker-a
call-api
validate
process-payment
```

Topic yang lebih baik:

```text
address.validation.v1
risk.screening.v2
notification.email.send.v1
document.render-pdf.v1
payment.authorize.v1
```

Kenapa version suffix berguna?

Karena external task adalah distributed contract. Begitu ada process instance lama yang menunggu topic lama, worker baru harus tetap tahu cara memprosesnya atau deployment harus dikontrol.

---

### 3.2 Topic Granularity

Topic terlalu kasar:

```text
integration
```

Masalah:

- worker harus inspect variable untuk tahu pekerjaan apa;
- routing tidak jelas;
- security sulit;
- metrics tidak bermakna;
- throttling per downstream sulit.

Topic terlalu detail:

```text
validate-address-step-1-normal-case-v3-agency-x
```

Masalah:

- topic explosion;
- worker subscription rumit;
- operational dashboard sulit;
- versioning chaos.

Topic yang sehat biasanya merepresentasikan **capability**:

```text
postal-code.resolve.v1
email.dispatch.v1
case-risk.score.v1
file-virus.scan.v1
license-registry.lookup.v1
```

---

## 4. Fetch and Lock Semantics

External worker melakukan fetch and lock.

Secara konsep:

```text
Worker asks engine:
  "Give me up to N unlocked external tasks for topic X.
   Lock them for workerId W for duration D."

Engine replies:
  "Here are task ids T1, T2, ...
   They are now locked by W until timestamp L."
```

Lock mencegah worker lain mengambil task yang sama selama lock masih valid.

---

### 4.1 Lock adalah Lease, Bukan Ownership Permanen

Lock external task adalah time-based lease.

Artinya:

- worker mendapatkan hak sementara;
- lock punya expiration timestamp;
- kalau worker selesai sebelum expired, worker complete;
- kalau worker crash, lock akan expired;
- setelah expired, worker lain bisa fetch task yang sama.

Ini mirip distributed lease.

Implication:

> External task execution is at-least-once, not exactly-once.

Worker harus diasumsikan bisa mengeksekusi task yang sama lebih dari sekali.

---

### 4.2 Lock Duration Harus Berdasarkan Worst-Case Runtime

Misalnya worker memanggil downstream API yang normalnya 2 detik, tetapi kadang 45 detik. Lock duration 10 detik akan menyebabkan duplicate execution.

```text
t=00 worker A fetch task, lock 10s
t=01 worker A calls slow downstream
t=10 lock expires
t=11 worker B fetches same task
t=12 worker B calls downstream too
```

Jika downstream operation tidak idempotent, efeknya berbahaya:

- email terkirim dua kali;
- payment authorized dua kali;
- file generated dua kali;
- approval notification duplicate;
- external registry update double;
- compliance escalation duplicate.

Rule praktis:

```text
lockDuration >= p99 execution time + network jitter + completion margin
```

Tetapi jangan terlalu panjang juga. Lock duration terlalu panjang membuat recovery dari crash lebih lambat.

---

### 4.3 Lock Extension

Untuk pekerjaan panjang, worker dapat memperpanjang lock.

Pattern:

```text
fetch lock 60s
start work
heartbeat/extend lock every 30s
if work done -> complete
if work failed -> handleFailure
if worker crash -> no extension -> lock eventually expires
```

Lock extension cocok untuk:

- PDF generation besar;
- virus scanning file besar;
- long-running external API;
- data sync batch kecil;
- remote operation yang durasinya sulit diprediksi.

Tetapi lock extension bukan alasan untuk membuat worker memegang task berjam-jam tanpa checkpoint. Untuk pekerjaan sangat panjang, lebih sehat pakai pattern asynchronous callback/message event atau split work menjadi beberapa state.

---

## 5. External Task Lifecycle

Lifecycle sederhana:

```text
Created
  │
  ├─ fetched + locked by worker
  │     │
  │     ├─ complete -> removed, process continues
  │     ├─ handleFailure(retries>0) -> unlock after retry timeout
  │     ├─ handleFailure(retries=0) -> incident
  │     ├─ handleBpmnError -> BPMN error path
  │     └─ lock expires -> fetchable again
  │
  └─ manually changed by operator/API
```

Tabel mental:

| State | Meaning | Operator View |
|---|---|---|
| unlocked | task bisa diambil worker | waiting work |
| locked | worker sedang mengerjakan | in progress |
| failed with retries > 0 | akan bisa diambil lagi setelah timeout | transient failure |
| retries = 0 | task tidak fetchable, incident | needs intervention |
| completed | task hilang, process lanjut | done |
| BPMN error | task selesai via business alternative | handled path |

---

## 6. Complete, Failure, dan BPMN Error

External worker punya tiga outcome utama.

---

### 6.1 `complete`: Work Sukses

Worker memanggil complete jika work benar-benar selesai.

```java
externalTaskService.complete(task.getId(), workerId, variables);
```

Dengan REST/client library, bentuknya setara: worker memberi task id, worker id, dan optional variables.

Important invariant:

> Complete berarti worker menyatakan external side effect sudah aman dianggap selesai.

Kalau worker complete sebelum downstream operation commit, process bisa maju padahal pekerjaan belum benar-benar selesai.

Anti-pattern:

```text
complete task first
then call downstream service
```

Ini salah karena kalau downstream gagal setelah complete, process sudah lanjut.

Pattern benar:

```text
call downstream idempotently
verify success
persist/check idempotency state if needed
complete external task
```

---

### 6.2 `handleFailure`: Technical Failure

Technical failure berarti pekerjaan tidak bisa selesai karena alasan teknis:

- timeout;
- service unavailable;
- rate limit;
- transient network error;
- database deadlock downstream;
- invalid temporary token;
- worker internal exception;
- payload temporarily unavailable.

Worker melaporkan failure dengan:

- `errorMessage`,
- `errorDetails`,
- `retries`,
- `retryTimeout`.

Contoh mental:

```java
externalTaskService.handleFailure(
    task.getId(),
    workerId,
    "Address service timeout",
    stackTraceOrDiagnostic,
    nextRetries,
    10 * 60 * 1000L
);
```

Critical detail:

> Worker menentukan retries berikutnya. Engine tidak otomatis decrement external task retries untuk kita.

Maka worker harus membaca retries saat ini lalu mengirim nilai baru.

Pseudo:

```java
Integer currentRetries = task.getRetries();
int nextRetries = currentRetries == null ? 2 : currentRetries - 1;

externalTaskService.handleFailure(
    task.getId(),
    workerId,
    "Downstream unavailable",
    details,
    Math.max(nextRetries, 0),
    Duration.ofMinutes(5).toMillis()
);
```

Jika retries menjadi `0`, task tidak fetchable lagi dan incident dapat dibuat.

---

### 6.3 `handleBpmnError`: Business Alternative

BPMN Error bukan technical retry.

BPMN Error dipakai jika hasil kerja valid secara teknis, tetapi secara bisnis harus mengambil jalur alternatif.

Contoh:

- applicant not found;
- license expired;
- payment declined;
- eligibility failed;
- document rejected;
- duplicate application detected;
- address invalid secara definitif.

Pseudo:

```java
externalTaskService.handleBpmnError(
    task.getId(),
    workerId,
    "ADDRESS_INVALID",
    "Address is not recognized by official registry",
    variables
);
```

BPMN model:

```text
(External Task: Validate Address)
       │
       ├── success -> continue
       │
       └── boundary error ADDRESS_INVALID -> manual review
```

BPMN Error harus dipakai untuk **expected business path**, bukan untuk HTTP timeout.

---

## 7. Failure Taxonomy untuk External Worker

Top 1% engineer tidak hanya menulis `catch(Exception e)`. Ia membuat taxonomy failure.

| Failure | Contoh | Worker Action | BPMN Meaning |
|---|---|---|---|
| transient technical | timeout, 503, connection reset | `handleFailure(retries>0)` | stay on same activity |
| permanent technical | invalid config, missing credential | `handleFailure(retries=0)` | incident/manual intervention |
| business rejection | not eligible, invalid document | `handleBpmnError` | alternative BPMN path |
| duplicate completion uncertainty | complete response lost | idempotency lookup/reconcile | avoid duplicate side effect |
| process obsolete | case cancelled externally | complete with no-op or BPMN error depending model | controlled branch |
| data contract violation | required variable missing | failure or incident | model/contract defect |

Failure taxonomy harus didesain sebelum worker production.

---

## 8. At-Least-Once Execution dan Idempotency

External task must be assumed at-least-once.

Duplicate execution bisa terjadi jika:

1. worker crash setelah side effect tetapi sebelum complete;
2. complete request berhasil di server tetapi response hilang ke worker;
3. lock duration terlalu pendek;
4. worker pause/GC/network hang sampai lock expired;
5. operator manually unlock/retry;
6. cluster/network issue membuat worker mengulang;
7. external service timeout ambigu: service mungkin berhasil tetapi client tidak tahu.

---

### 8.1 Idempotency Key Design

Setiap external task side effect harus punya idempotency key.

Candidate:

```text
<processDefinitionKey>:<processInstanceId>:<activityId>:<businessOperation>
```

Lebih stabil untuk business side effect:

```text
<businessKey>:<operationName>:<operationVersion>
```

Contoh:

```text
CASE-2026-000381:send-acknowledgement-email:v1
CASE-2026-000381:reserve-payment:v2
CASE-2026-000381:risk-screening:v1
```

Kenapa tidak selalu pakai external task id?

Karena external task id bisa berubah jika process dimodifikasi, migration tertentu dilakukan, atau model berubah. Untuk side effect bisnis, key berbasis business operation biasanya lebih stabil.

---

### 8.2 Idempotency Store

Pattern minimal:

```sql
CREATE TABLE worker_idempotency (
  idempotency_key VARCHAR(200) PRIMARY KEY,
  status VARCHAR(30) NOT NULL,
  response_payload CLOB,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

Flow:

```text
worker receives task
  │
  ├─ compute idempotency key
  │
  ├─ insert PROCESSING if absent
  │
  ├─ if COMPLETED exists -> complete Camunda task using stored result
  │
  ├─ execute downstream with same idempotency key if supported
  │
  ├─ store COMPLETED + result
  │
  └─ complete Camunda external task
```

This reduces duplicate side effect risk.

---

### 8.3 Idempotency with Downstream APIs

Jika downstream mendukung idempotency header:

```http
POST /payments/authorizations
Idempotency-Key: CASE-2026-000381:payment-authorize:v1
```

Gunakan.

Jika downstream tidak mendukung idempotency:

- simpan local idempotency result;
- cari existing transaction by natural key;
- gunakan unique constraint di downstream kalau bisa;
- desain operation sebagai upsert instead of create;
- lakukan reconciliation job;
- hindari side effect non-reversible tanpa confirmation.

---

## 9. Worker Architecture di Java

### 9.1 Minimal Worker Loop

Pseudo worker sederhana:

```java
while (running) {
  List<LockedExternalTask> tasks = externalTaskService
      .fetchAndLock(10, workerId)
      .topic("address-validation", 60_000L)
      .variables("caseId", "postalCode", "idempotencyKey")
      .execute();

  for (LockedExternalTask task : tasks) {
    handleTask(task);
  }
}
```

Ini cukup untuk memahami konsep, tetapi belum production-grade.

Production worker butuh:

- bounded concurrency;
- backoff ketika tidak ada task;
- timeout per downstream;
- lock duration sizing;
- lock extension;
- idempotency;
- structured logging;
- metrics;
- graceful shutdown;
- circuit breaker/rate limit;
- secure config;
- retry classification;
- dead letter/incident procedure.

---

### 9.2 Threading Model Worker

External task client sering membuat developer berpikir “fetch banyak task, parallel semua”. Ini bahaya jika tidak dibatasi.

Model aman:

```text
Polling Thread
   │
   ├─ fetch maxTasks <= available worker permits
   │
   ▼
Bounded Work Queue
   │
   ▼
Worker Executor Pool
   │
   ├─ execute task
   ├─ complete/failure/bpmnError
   └─ release permit
```

Invariants:

1. Jangan fetch lebih banyak dari kapasitas worker.
2. Jangan lock task lalu biarkan menunggu lama di internal queue.
3. Lock duration harus mencakup waktu antre + waktu eksekusi + completion margin.
4. Jika worker queue penuh, polling harus berhenti/backoff.

---

### 9.3 Bad Pattern: Over-Fetching

Misalnya:

```text
maxTasks = 100
worker thread pool = 5
lockDuration = 60s
average task time = 20s
```

Worker fetch 100 task, tetapi hanya 5 berjalan. Task ke-20 mungkin baru mulai setelah 80 detik. Lock sudah expired sebelum diproses.

Dampaknya:

- duplicate execution;
- external task “does not exist” saat complete;
- worker lain mengambil ulang;
- noisy logs;
- retry kacau;
- downstream double call.

Rule:

```text
maxTasks <= free worker capacity
```

Jika worker punya 20 thread dan 7 sedang busy, fetch maksimal 13, bukan fixed 100.

---

## 10. Long Polling

Polling biasa:

```text
worker calls fetch
engine returns empty immediately
worker sleeps 1s
worker calls fetch again
```

Ini boros jika banyak worker dan task jarang.

Long polling:

```text
worker calls fetch with asyncResponseTimeout
if no task, server holds request until task appears or timeout
```

Benefit:

- mengurangi request kosong;
- latency lebih rendah saat task baru muncul;
- lebih efisien untuk worker banyak;
- mengurangi polling noise.

Tetapi ada operational constraint:

- server punya blocking queue untuk long-poll requests;
- workerId uniqueness dapat dikonfigurasi;
- load balancer/proxy timeout harus lebih panjang dari long polling timeout;
- client timeout harus aligned;
- terlalu banyak worker idle bisa menekan server.

---

### 10.1 Timeout Alignment

Misalnya:

```text
asyncResponseTimeout = 30s
HTTP client read timeout = 10s
```

Maka client timeout duluan sebelum server menjawab. Worker akan melihat timeout padahal normal.

Better:

```text
asyncResponseTimeout = 30s
HTTP client read timeout = 35s or 40s
proxy idle timeout >= 40s
```

But avoid huge values without understanding infra. ALB/nginx/proxy timeouts can silently break long polling.

---

## 11. Backpressure dan Rate Limiting

External task memberi worker kontrol untuk mengambil pekerjaan. Ini natural backpressure point.

Backpressure strategy:

```text
availablePermits = maxConcurrency - activeTasks
if availablePermits <= 0:
    do not fetch
else:
    fetch maxTasks = min(availablePermits, configuredBatchSize)
```

Rate limit per topic:

```text
risk-screening: 50/min
email-dispatch: 500/min
document-rendering: 20/min
registry-lookup: 100/min
```

Kenapa per topic?

Karena bottleneck biasanya downstream-specific, bukan engine-specific.

---

### 11.1 Worker Backoff

Backoff dibutuhkan ketika:

- no task available;
- Camunda REST unavailable;
- authentication failure;
- DB/engine slow;
- downstream circuit open;
- repeated lock conflicts;
- rate limit reached.

Basic adaptive backoff:

```text
on tasks found: reset backoff to min
on no task: increase until max
on engine error: exponential backoff + jitter
on auth error: long backoff + alert
```

Jitter penting agar semua worker tidak retry bersamaan.

---

## 12. Variable Handling untuk External Task

External task worker sebaiknya hanya fetch variable yang dibutuhkan.

Bad:

```text
fetch all variables
```

Masalah:

- payload besar;
- serialized object deserialization risk;
- sensitive data leakage;
- network overhead;
- worker coupling ke process internals;
- lebih sulit versioning.

Better:

```text
fetch variables: caseId, applicantId, postalCode, idempotencyKey, requestVersion
```

Completion variables sebaiknya explicit:

```text
addressValidationStatus = VALID | INVALID | UNKNOWN
addressValidationProvider = ONEMAP
addressValidationCheckedAt = 2026-06-20T10:15:30+07:00
addressValidationResponseRef = document/storage reference, not huge blob
```

---

### 12.1 Do Not Store Huge External Responses as Variables

Anti-pattern:

```text
store full 2MB JSON response in process variable
```

Dampak:

- `ACT_GE_BYTEARRAY` tumbuh;
- history tumbuh;
- cockpit lambat;
- REST response berat;
- migration susah;
- DB backup membesar.

Better:

```text
store response in domain table/object storage
give process variable only reference + summary facts
```

Example:

```text
registryLookupRef = "s3://.../case-123/lookup-456.json"
registryLookupStatus = "MATCHED"
registryLookupScore = 0.92
```

---

## 13. Topic Design untuk Enterprise Platform

Topic harus punya governance.

### 13.1 Naming Convention

Format recommended:

```text
<domain>.<capability>.<operation>.v<major>
```

Examples:

```text
case.risk.score.v1
case.document.render-pdf.v1
notification.email.send.v1
registry.company.lookup.v1
payment.invoice.generate.v1
```

Major version naik jika breaking change:

- required variable berubah;
- output variable berubah;
- error code berubah;
- semantic operation berubah;
- idempotency contract berubah.

Minor/patch tidak perlu masuk topic name jika backward-compatible.

---

### 13.2 Topic Ownership

Setiap topic harus punya owner.

| Topic | Owner | SLA | Downstream | Error Codes |
|---|---|---:|---|---|
| `case.risk.score.v1` | Risk Platform Team | 2 min | Risk Engine | `RISK_UNAVAILABLE`, `RISK_REJECTED` |
| `notification.email.send.v1` | Notification Team | 30 sec | SMTP/Email API | `INVALID_RECIPIENT` |
| `registry.company.lookup.v1` | Registry Integration Team | 1 min | External Registry | `COMPANY_NOT_FOUND` |

Tanpa ownership, external task berubah menjadi “distributed cron chaos”.

---

## 14. Completion Contract

Worker harus tahu variable apa yang harus dikirim saat complete.

Contoh contract:

```yaml
topic: case.risk.score.v1
input:
  caseId: string required
  applicantId: string required
  riskProfileVersion: string required
output_on_success:
  riskScore: decimal required
  riskBand: LOW|MEDIUM|HIGH required
  riskDecisionRef: string required
bpmn_errors:
  RISK_PROFILE_NOT_FOUND:
    path: manual review
technical_failure:
  retry: exponential, max 5
idempotency_key:
  format: "{businessKey}:risk-score:v1"
```

A process model without an external task contract is incomplete.

---

## 15. Error Code Contract

BPMN error codes should be stable and explicit.

Bad:

```text
ERROR
FAIL
VALIDATION_FAILED
```

Better:

```text
ADDRESS_NOT_FOUND
APPLICANT_NOT_ELIGIBLE
DOCUMENT_REJECTED_BY_ANTIVIRUS
PAYMENT_DECLINED
COMPANY_REGISTRY_NO_MATCH
```

Error code is part of workflow API.

Do not rename casually; process definitions and workers depend on it.

---

## 16. External Task vs Message Event

External task and message event are both external interaction patterns, but semantics differ.

| Question | External Task | Message Event |
|---|---|---|
| Who initiates? | Worker pulls work | External system sends event/message |
| Engine state | Waiting at external service task | Waiting at message catch event/subscription |
| Best for | Engine assigns work to worker | Process waits for independent event |
| Example | “Please validate address” | “Payment received” |
| Coupling | Process asks worker to do work | External event completes wait |
| Retry | Worker-controlled failure/retry | Event delivery/correlation strategy |

Use external task when process owns the request for work.

Use message event when the outside world owns the event and process only waits for it.

---

### 16.1 Example: Payment Authorization

External task model:

```text
Process -> external task: authorize payment -> worker calls payment API -> complete
```

Good if payment API is request/response and worker can decide success/failure.

Message model:

```text
Process -> send payment request -> wait for PaymentAuthorized message
```

Good if payment is asynchronous and provider sends callback later.

Hybrid model:

```text
External task sends request idempotently
Process waits at message catch for provider callback
```

Best for long-running external operations.

---

## 17. External Task vs Async JavaDelegate

| Aspek | Async JavaDelegate | External Task |
|---|---|---|
| Worker location | inside engine/app | outside engine/app |
| Execution | Job Executor | External worker |
| Scaling | scale engine/app | scale worker independently |
| Language | JVM/classpath | any language over REST/client |
| Transaction | engine job transaction | separate worker transaction + engine API call |
| Isolation | lower | higher |
| Latency | lower overhead | network/API overhead |
| Operational boundary | engine logs | worker logs + engine state |
| Best for | local technical step | integration/service boundary |

Use async JavaDelegate for internal, quick, engine-local work.

Use external task for remote integration, independent scaling, technology separation, and isolation.

---

## 18. Worker Fleet Design

### 18.1 Single Worker Instance

Good for:

- dev/test;
- low volume;
- simple integrations;
- non-critical background tasks.

Risk:

- SPOF;
- no horizontal capacity;
- longer backlog recovery.

---

### 18.2 Multiple Worker Replicas

Recommended for production.

```text
Camunda Engine
    │
    ├─ Worker replica 1
    ├─ Worker replica 2
    ├─ Worker replica 3
    └─ Worker replica N
```

Locking prevents same task being fetched simultaneously while lock valid.

But duplicate execution still possible after lock expiry or failure uncertainty. Do not use worker replicas as excuse to skip idempotency.

---

### 18.3 Worker ID Strategy

Worker id should identify instance, not user.

Good:

```text
risk-worker-prod-pod-7f84c9d9d6-xp9mk
email-worker-az-a-03
```

Bad:

```text
worker
externalWorkerId
localhost
```

Worker id helps diagnose locks and failures.

For Kubernetes:

```text
<app-name>-<namespace>-<pod-name>
```

---

### 18.4 Scaling Signal

Scale workers based on:

- external task backlog by topic;
- task age;
- worker active task count;
- downstream latency;
- downstream rate limit headroom;
- error rate;
- CPU/memory/thread pool saturation.

Do not scale only by CPU. Many external workers are I/O bound.

---

## 19. Database and Query Awareness

External tasks live in Camunda runtime DB, commonly in `ACT_RU_EXT_TASK`.

Diagnostic queries may inspect:

```sql
SELECT TOPIC_NAME_, COUNT(*)
FROM ACT_RU_EXT_TASK
GROUP BY TOPIC_NAME_;
```

For DBs not supporting that syntax, adapt accordingly.

Useful columns conceptually include:

- task id;
- topic name;
- worker id;
- lock expiration time;
- retries;
- error message;
- process instance id;
- execution id;
- activity id;
- priority;
- create time.

Important:

> Read for diagnostics; mutate through engine API.

Manual DB updates can corrupt runtime invariants.

---

## 20. External Task Priorities

External tasks can have priority. Worker fetching can consider priority depending API/client configuration.

Use priority when:

- escalation tasks must be processed first;
- SLA-critical topics must jump backlog;
- regulatory deadline work should outrank bulk notifications;
- emergency reprocessing is needed.

But priority is not magic.

Potential problems:

- starvation of low priority tasks;
- priority inversion;
- more expensive acquisition query;
- wrong priority model hides capacity issue.

Priority should be governed, observable, and tested.

---

## 21. Security Model

External task worker needs access to Camunda REST/API and downstream systems.

Security concerns:

1. Camunda REST authentication.
2. Authorization to fetch/complete only intended topics.
3. Network segmentation.
4. Secrets handling.
5. TLS validation.
6. Avoiding sensitive variable over-fetch.
7. Logging without PII leakage.
8. Worker service account identity.
9. Auditable complete/failure actions.

Do not let every worker use a shared admin credential.

Better:

```text
worker-specific service account
least privilege
separate credentials per environment
secret rotation
mTLS or OAuth2 where available
```

---

## 22. Observability

Worker observability must connect business process, external task, and downstream call.

### 22.1 Required Log Fields

Every worker log should include:

```text
workerId
externalTaskId
topicName
processInstanceId
processDefinitionKey
businessKey
activityId
idempotencyKey
attempt/retries
correlationId/requestId
downstreamSystem
outcome
latencyMs
```

Example structured log:

```json
{
  "event": "external_task_completed",
  "topic": "case.risk.score.v1",
  "workerId": "risk-worker-prod-7f84",
  "externalTaskId": "abc123",
  "processInstanceId": "proc789",
  "businessKey": "CASE-2026-000381",
  "idempotencyKey": "CASE-2026-000381:risk-score:v1",
  "latencyMs": 842,
  "outcome": "success"
}
```

---

### 22.2 Required Metrics

Per topic:

- fetched tasks count;
- completed tasks count;
- failure count;
- BPMN error count;
- completion latency;
- task age at fetch;
- active tasks;
- retries remaining distribution;
- incident count;
- downstream latency;
- downstream error rate;
- lock extension count;
- complete API failure count.

Engine-side metrics alone are insufficient. Worker-side metrics are mandatory.

---

## 23. Graceful Shutdown

Worker shutdown must avoid losing locked tasks.

Bad shutdown:

```text
SIGTERM -> process exits immediately
```

Effects:

- locked tasks wait until lock expires;
- backlog delay;
- duplicate work if side effect partially done;
- noisy incidents.

Better:

```text
SIGTERM received
  │
  ├─ stop fetching new tasks
  ├─ let in-flight tasks finish within grace period
  ├─ complete/failure current tasks
  ├─ optionally unlock safe unstarted tasks
  └─ exit
```

Kubernetes settings:

- `terminationGracePeriodSeconds` must be long enough;
- readiness should go false before shutdown;
- liveness should not kill slow-but-healthy workers;
- preStop hook can help stop polling early.

---

## 24. Handling Ambiguous Completion Failure

One of the hardest external task problems:

```text
worker completes task
HTTP request reaches engine
engine commits completion
response lost due to network/proxy timeout
worker sees error
```

Worker does not know if task completed.

Naive retry complete may return “task not found” because task already completed.

How to handle:

1. Make external side effect idempotent.
2. Check process state/history if necessary.
3. If task no longer exists, determine if process moved past activity.
4. Do not re-execute side effect blindly.
5. Use business idempotency store to decide outcome.

For critical operations, use reconciliation:

```text
idempotency store says downstream success
Camunda task unknown
query engine/history
if process past activity -> mark reconciled
if still waiting -> complete again if lock valid or after refetch
```

---

## 25. Incident and Manual Recovery

When external task retries reach `0`, operator intervention is required.

Recovery options:

- inspect error message/details;
- fix downstream/config/data;
- set retries > 0;
- unlock task if needed;
- manually complete only if safe;
- modify process instance only when semantically justified.

Operator playbook should answer:

1. Is this transient or permanent?
2. Was side effect already executed?
3. Is it safe to retry?
4. Does the business case need alternate path?
5. Is variable data valid?
6. Which team owns the topic?
7. What evidence must be stored for audit?

---

## 26. Common Production Failure Scenarios

### 26.1 Task Stuck Locked

Symptoms:

- external task has `WORKER_ID_`;
- `LOCK_EXP_TIME_` is in future;
- no worker logs progressing.

Possible causes:

- worker still running slow;
- lock duration too long;
- worker hung;
- clock skew;
- stale worker lock after crash.

Action:

- check worker logs;
- verify lock expiry time;
- wait if acceptable;
- unlock via API only if worker definitely dead and side effect safe.

---

### 26.2 Task Repeatedly Retried

Symptoms:

- same error message;
- retries decreasing;
- no successful completion.

Possible causes:

- downstream unavailable;
- invalid variable contract;
- missing credential;
- worker bug;
- permanent business condition incorrectly handled as technical failure.

Action:

- classify failure;
- move business rejection to BPMN Error;
- fix config/credential;
- improve validation before remote call;
- adjust retry strategy.

---

### 26.3 Duplicate Downstream Calls

Symptoms:

- duplicate email/payment/API operation;
- multiple worker logs for same business key;
- lock expired before completion.

Possible causes:

- lock duration too short;
- worker over-fetching;
- complete response lost;
- no idempotency;
- task manually unlocked.

Action:

- implement idempotency;
- increase lock duration;
- reduce maxTasks;
- use lock extension;
- align timeouts;
- add downstream deduplication.

---

### 26.4 Worker Fetches Nothing but Tasks Exist

Possible causes:

- wrong topic name;
- tenant mismatch;
- tasks locked;
- retries = 0;
- task priority config mismatch;
- authorization issue;
- worker filtering variable/process incorrectly;
- clock/timezone mismatch affecting lock expiry perception.

Action:

- query by topic;
- inspect lock/retries;
- verify tenant and auth;
- verify worker subscription;
- check API response and client logs.

---

## 27. External Task in Regulatory Case Management

Consider enforcement case flow:

```text
[Case Created]
   │
   ▼
[External Task: Fetch Registry Profile]
   │
   ├─ BPMN Error: REGISTRY_NO_MATCH -> Manual Review
   │
   ▼
[External Task: Risk Screening]
   │
   ├─ BPMN Error: HIGH_RISK -> Senior Officer Review
   │
   ▼
[User Task: Officer Assessment]
   │
   ▼
[External Task: Generate Notice PDF]
   │
   ▼
[External Task: Dispatch Email]
   │
   ▼
[Wait for Acknowledgement]
```

External task contract examples:

| Task | Topic | Idempotency Key | Technical Failure | BPMN Error |
|---|---|---|---|---|
| Fetch Registry Profile | `registry.profile.lookup.v1` | `caseId:registry-profile:v1` | retry 5 times | `REGISTRY_NO_MATCH` |
| Risk Screening | `case.risk.score.v1` | `caseId:risk-score:v1` | retry 3 times | `HIGH_RISK`, `INSUFFICIENT_DATA` |
| Generate PDF | `document.notice.render.v1` | `caseId:notice-pdf:v1` | retry 3 times | `TEMPLATE_INVALID` maybe technical/config |
| Dispatch Email | `notification.email.send.v1` | `caseId:notice-email:v1` | retry with backoff | `INVALID_RECIPIENT` |

The platform must define which outcomes are operational incidents and which are business paths.

---

## 28. Java 8 hingga Java 25 Considerations

External task workers are decoupled from engine classpath, so they can often modernize faster than embedded delegate code.

### Java 8

- Compatible with older Camunda 7 ecosystems.
- Use classic thread pools, `CompletableFuture` carefully.
- No records, no virtual threads.
- TLS/cert/library support may be aging.

### Java 11/17

- Strong baseline for modern workers.
- Better HTTP client available since Java 11.
- Better GC/runtime ergonomics.
- Suitable for Spring Boot 2.x/3.x depending dependency line.

### Java 21

- Virtual threads can be useful for I/O-bound workers.
- Still need bounded concurrency and rate limits; virtual threads do not remove downstream capacity limits.
- Structured concurrency may help in newer code, but watch preview/API status depending Java version.

### Java 25

- Treat as future/modern runtime planning layer.
- External workers can often be upgraded independently if their dependencies support it.
- Camunda 7 engine compatibility must be checked separately from worker runtime compatibility.

Key point:

> External task pattern lets you keep Camunda 7 engine stable while evolving worker runtimes more independently.

This is a strategic advantage in legacy modernization.

---

## 29. Production Worker Design Blueprint

A production-grade worker should have these components:

```text
ExternalTaskWorkerApp
  ├─ WorkerConfig
  │    ├─ topic subscriptions
  │    ├─ lock duration
  │    ├─ max concurrency
  │    ├─ rate limits
  │    └─ retry policy
  │
  ├─ CamundaClient
  │    ├─ fetchAndLock
  │    ├─ complete
  │    ├─ handleFailure
  │    ├─ handleBpmnError
  │    └─ extendLock
  │
  ├─ PollingCoordinator
  │    ├─ long polling
  │    ├─ backoff
  │    ├─ permit accounting
  │    └─ shutdown handling
  │
  ├─ TaskDispatcher
  │    ├─ topic -> handler mapping
  │    ├─ validation
  │    └─ error taxonomy
  │
  ├─ IdempotencyService
  │    ├─ acquire key
  │    ├─ record success
  │    ├─ record failure
  │    └─ reconcile
  │
  ├─ DownstreamClients
  │    ├─ timeout
  │    ├─ circuit breaker
  │    ├─ retry if safe
  │    └─ idempotency header
  │
  ├─ Observability
  │    ├─ metrics
  │    ├─ structured logs
  │    ├─ traces
  │    └─ audit events
  │
  └─ Health
       ├─ readiness
       ├─ liveness
       └─ dependency status
```

---

## 30. Code Sketch: Safe Handler Shape

This is conceptual Java, not tied to one specific client library.

```java
public final class ExternalTaskHandler {

  private final IdempotencyService idempotency;
  private final DownstreamClient downstream;
  private final CamundaExternalTaskGateway camunda;

  public void handle(LockedTask task) {
    TaskContext ctx = TaskContext.from(task);
    String key = buildIdempotencyKey(ctx);

    try {
      IdempotencyResult existing = idempotency.find(key);
      if (existing.isCompleted()) {
        camunda.complete(task, existing.toProcessVariables());
        return;
      }

      idempotency.markProcessing(key, ctx);

      DownstreamResult result = downstream.call(
          DownstreamRequest.from(ctx).withIdempotencyKey(key));

      if (result.isBusinessRejected()) {
        idempotency.markCompleted(key, result);
        camunda.handleBpmnError(task, result.errorCode(), result.toVariables());
        return;
      }

      idempotency.markCompleted(key, result);
      camunda.complete(task, result.toVariables());

    } catch (TransientDownstreamException e) {
      camunda.handleFailure(task, "Transient downstream failure", e, nextRetries(task), retryTimeout(task));

    } catch (PermanentConfigurationException e) {
      camunda.handleFailure(task, "Permanent worker/config failure", e, 0, 0L);

    } catch (Exception e) {
      camunda.handleFailure(task, "Unexpected worker failure", e, nextRetries(task), retryTimeout(task));
    }
  }
}
```

Core principles:

- compute idempotency before side effect;
- do not complete before side effect is safe;
- classify failures;
- use BPMN error for business alternatives;
- never blindly retry non-idempotent operations;
- make completion variables explicit.

---

## 31. Anti-Patterns

### 31.1 External Task for Every Small Step

If every trivial transformation becomes external task, process becomes slow and operationally noisy.

Bad:

```text
normalize string -> external task
set flag -> external task
map field -> external task
```

Keep simple deterministic transformations inside model/input-output mapping/delegate where appropriate.

---

### 31.2 One Mega Topic

```text
topic = "worker"
```

This destroys routing, metrics, security, and ownership.

---

### 31.3 No Idempotency

Any worker performing external side effects without idempotency is a production incident waiting to happen.

---

### 31.4 Lock Duration Guesswork

Using arbitrary lock duration like 30 seconds for all tasks ignores actual execution distribution.

Measure p95/p99 and tune per topic.

---

### 31.5 Fetch All Variables

This leaks data, increases payload, and couples worker to process internals.

---

### 31.6 Treating BPMN Error as Exception

Business error should drive BPMN path, not be buried as technical incident.

---

### 31.7 Worker as God Service

One worker handling every topic becomes monolith-in-disguise.

Split by ownership/capability.

---

## 32. Checklist Desain External Task

Sebelum production, jawab ini:

### BPMN Contract

- Apa topic name?
- Apa input variables?
- Apa output variables?
- Apa BPMN error codes?
- Apa retry semantics?
- Apa SLA?
- Apa owner topic?

### Worker Runtime

- Berapa max concurrency?
- Berapa lock duration?
- Apakah perlu lock extension?
- Apakah long polling aktif?
- Apakah graceful shutdown ada?
- Apakah worker id unik?

### Reliability

- Apa idempotency key?
- Apakah downstream mendukung idempotency?
- Apa behavior kalau complete response lost?
- Apa retry policy transient/permanent?
- Apa incident recovery playbook?

### Security

- Credential worker apa?
- Apakah least privilege?
- Apakah variable sensitif difilter?
- Apakah logs bebas PII?

### Observability

- Metrics per topic ada?
- Logs punya business key/process instance id?
- Trace downstream call ada?
- Alert untuk backlog/incident/error rate ada?

---

## 33. Latihan Mental Model

### Latihan 1

Worker fetch task `payment.authorize.v1`, memanggil payment provider, provider sukses, tetapi `complete` ke Camunda timeout.

Pertanyaan:

1. Apakah worker boleh langsung authorize payment lagi?
2. Apa idempotency key yang seharusnya dipakai?
3. Apa yang harus dicek di Camunda?
4. Apa yang harus dicek di idempotency store?

Jawaban konseptual:

- Tidak boleh langsung authorize lagi.
- Gunakan business idempotency key seperti `caseId:payment-authorize:v1`.
- Cek apakah external task masih ada atau process sudah melewati activity.
- Jika idempotency store/downstream menyatakan payment sudah authorized, jangan ulang side effect; reconcile process completion.

---

### Latihan 2

Worker punya 5 thread, `maxTasks=100`, `lockDuration=30s`, rata-rata eksekusi 10s.

Apa bug desainnya?

Jawaban:

Worker over-fetch. Banyak task terkunci tetapi tidak dieksekusi sampai lock expired. Ini menyebabkan duplicate execution. `maxTasks` harus berbasis available permits, bukan angka besar statis.

---

### Latihan 3

External worker mendapat response `404 Applicant Not Found` dari registry resmi.

Apakah ini `handleFailure` atau `handleBpmnError`?

Jawaban:

Tergantung domain, tetapi biasanya business alternative. Jika “applicant not found” adalah hasil valid dari registry dan model punya jalur manual review/rejection, gunakan `handleBpmnError`, bukan technical retry.

---

## 34. Ringkasan

External Task Pattern adalah salah satu mekanisme paling kuat di Camunda 7 untuk membangun workflow enterprise yang decoupled.

Key takeaways:

1. External task adalah durable work item yang dipull worker.
2. Lock adalah time-based lease, bukan ownership permanen.
3. Execution semantics harus diasumsikan at-least-once.
4. Idempotency adalah requirement, bukan nice-to-have.
5. `complete`, `handleFailure`, dan `handleBpmnError` punya makna berbeda.
6. Topic adalah distributed contract dan harus digovern.
7. Worker harus punya bounded concurrency, backpressure, long polling, graceful shutdown, metrics, dan failure taxonomy.
8. External task bukan message broker dan bukan pengganti semua integration pattern.
9. External task sangat cocok untuk isolasi runtime, independent scaling, polyglot worker, dan modernization di estate Camunda 7.
10. External task yang buruk bisa menciptakan duplicate side effect, hidden queue, dan incident storm.

---

## 35. Referensi

- Camunda 7.24 Documentation — External Tasks: https://docs.camunda.org/manual/7.24/user-guide/process-engine/external-tasks/
- Camunda 7.24 Documentation — External Task Client: https://docs.camunda.org/manual/7.24/user-guide/ext-client/
- Camunda 7.24 REST API — External Task: https://docs.camunda.org/manual/7.24/reference/rest/external-task/
- Camunda 7.24 Javadocs — ExternalTaskService and ExternalTask: https://docs.camunda.org/javadoc/camunda-bpm-platform/7.24/

---

## 36. Status Seri

Part ini selesai.

Seri belum selesai. Lanjut ke:

`learn-java-camunda-7-bpm-platform-engineering-part-012.md` — **Service Invocation Patterns: JavaDelegate vs External Task vs Message vs Outbox**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-010.md">⬅️ Part 010 — JavaDelegate, ExecutionListener, TaskListener, ParseListener, dan Extension Point Discipline</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-012.md">Part 012 — Service Invocation Patterns: JavaDelegate vs External Task vs Message vs Outbox ➡️</a>
</div>

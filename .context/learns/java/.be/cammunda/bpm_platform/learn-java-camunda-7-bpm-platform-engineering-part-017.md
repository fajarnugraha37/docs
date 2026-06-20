# learn-java-camunda-7-bpm-platform-engineering-part-017.md

# Part 017 — Incidents, Error Taxonomy, BPMN Error, Escalation, Compensation, dan Recovery Semantics

> Seri: **learn-java-camunda-7-bpm-platform-engineering**  
> Bagian: **017 / 035**  
> Target: Java engineer / tech lead / platform engineer yang ingin memahami Camunda 7 sebagai runtime workflow produksi, bukan sekadar BPMN executor.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

- transaction boundary,
- async continuation,
- job executor,
- database schema,
- optimistic locking,
- variable system,
- delegation binding,
- external task,
- message correlation,
- timer,
- human task,
- history dan audit.

Bagian ini menyambungkan semua itu ke satu pertanyaan produksi yang sangat penting:

> Ketika sesuatu gagal, apa yang harus terjadi terhadap process instance?

Di sistem workflow enterprise, error handling bukan sekadar `try-catch`. Error handling adalah desain state machine.

Sebuah proses regulatory/case-management bisa gagal karena banyak alasan:

- service eksternal timeout,
- user mengirim input tidak valid,
- dokumen belum lengkap,
- approval ditolak,
- SLA hampir lewat,
- supervisor harus diberi tahu,
- sistem pembayaran sudah debit tetapi downstream gagal,
- task selesai tetapi delegate berikutnya exception,
- job retry habis,
- compensation harus dijalankan,
- operator harus memperbaiki data lalu retry.

Semua itu tidak boleh dimodelkan sebagai satu jenis “error”. Jika semua failure dipukul rata sebagai exception, proses menjadi sulit dioperasikan, sulit diaudit, dan sulit dipulihkan.

Tujuan bagian ini:

1. membedakan failure teknis, business error, escalation, compensation, dan incident;
2. memahami kapan memakai Java exception, `BpmnError`, escalation event, timer escalation, compensation, manual task, atau incident;
3. memahami efeknya terhadap transaction, retry, rollback, audit, dan recovery;
4. membangun recovery semantics yang eksplisit, bukan reaktif;
5. membuat proses yang bisa dipulihkan operator tanpa patch database manual.

---

## 1. Mental Model Utama: Failure Bukan Satu Hal

Dalam Camunda 7, error handling harus dilihat dari beberapa lapisan:

```text
Business reality
  |
  |-- expected business alternative
  |     contoh: application rejected, stock unavailable, document incomplete
  |
  |-- non-critical escalation
  |     contoh: SLA warning, supervisor notification, second-level review
  |
  |-- technical malfunction
  |     contoh: network timeout, DB unavailable, 500 from downstream
  |
  |-- already-performed side effect that must be undone/logically reversed
  |     contoh: reservation made, email sent, payment initiated
  |
  |-- operational stuck state
        contoh: job retries exhausted, external task retries 0, incident exists
```

Camunda menyediakan mekanisme berbeda untuk masing-masing:

| Situasi | Mekanisme utama | Efek utama |
|---|---|---|
| Technical failure transient | Exception + async retry/job retry | Rollback/retry sampai sukses atau incident |
| Business alternative expected | BPMN Error | Pindah ke alternative flow |
| Non-critical notification/raising concern | Escalation | Communicate upward tanpa selalu menghentikan flow |
| Long-running business rollback | Compensation | Jalankan aksi reversal/logical undo |
| Process stuck / butuh operator | Incident | Runtime marker untuk manual recovery |
| SLA breach / time based escalation | Timer + user task/escalation path | State transition karena waktu |
| External event failure | Message correlation + inbox/idempotency | Controlled event ingestion |

Prinsip penting:

> Jangan memilih mekanisme berdasarkan “mana yang bisa jalan”, tetapi berdasarkan makna failure-nya.

---

## 2. Taxonomy Failure untuk Camunda 7

Sebelum memilih BPMN construct, definisikan taxonomy.

### 2.1 Technical Error

Technical error adalah kegagalan yang tidak mengubah business decision, misalnya:

- HTTP timeout,
- database deadlock,
- downstream 503,
- S3 upload gagal,
- SMTP server unavailable,
- Kafka broker temporary unavailable,
- optimistic locking conflict,
- serialization error,
- transient credentials/network problem.

Ciri-ciri:

- biasanya tidak diinginkan oleh business process;
- biasanya tidak perlu branch BPMN eksplisit untuk setiap service task;
- biasanya bisa diretry;
- jika retry habis, operator perlu lihat incident;
- jangan diubah menjadi BPMN Error kecuali memang punya business meaning.

Mekanisme umum:

```text
Java exception
  -> transaction rollback
  -> if async job: retries decreased
  -> if retries exhausted: incident
```

### 2.2 Business Error

Business error adalah kondisi yang “gagal” dari sudut happy path, tetapi valid secara domain.

Contoh:

- applicant not eligible,
- document incomplete,
- duplicate registration,
- payment declined,
- stock unavailable,
- reviewer rejected,
- appeal not allowed,
- permit cannot be renewed due to rule violation.

Ciri-ciri:

- expected;
- bisa dijelaskan ke user;
- bukan malfunction;
- harus masuk alternative path;
- biasanya perlu audit business reason;
- tidak cocok menjadi incident.

Mekanisme umum:

```text
throw new BpmnError("DOCUMENT_INCOMPLETE")
  -> boundary error / event subprocess catches
  -> process moves to designed alternative path
```

### 2.3 Validation Error

Validation error bisa dua jenis:

1. **user input invalid sebelum process transition**;
2. **domain rule result yang menjadi business branch**.

Contoh pertama:

```text
User complete task with missing required form field
```

Sebaiknya ditangani di UI/API/domain validation sebelum memanggil `taskService.complete()`.

Contoh kedua:

```text
Task completed, rule engine says application is not eligible
```

Ini bisa menjadi BPMN path: rejected, request correction, or escalate.

Prinsip:

> Jangan gunakan BPMN Error untuk validasi form biasa yang seharusnya dicegah sebelum command Camunda dieksekusi.

### 2.4 Escalation

Escalation adalah sinyal bahwa sesuatu perlu perhatian di level lebih tinggi, tetapi tidak selalu failure fatal.

Contoh:

- SLA warning,
- supervisor review required,
- senior officer override needed,
- case amount above threshold,
- repeated correction attempts,
- unresolved complaint after 7 days.

Escalation bukan technical exception. Escalation adalah business communication upward.

### 2.5 Compensation Need

Compensation dibutuhkan ketika proses sudah melakukan aksi yang tidak bisa rollback secara ACID.

Contoh:

- reserve inventory,
- debit payment,
- issue temporary license,
- send notification,
- call external registry,
- create external case,
- reserve appointment slot.

Jika proses kemudian harus dibatalkan, database rollback Camunda tidak menghapus efek eksternal itu.

Maka perlu compensation:

```text
Performed action A
Performed action B
Later business cancellation happens
Run compensation for B
Run compensation for A
```

Namun compensation bukan magic undo. Compensation adalah aksi bisnis baru yang membuat dampak aksi sebelumnya “dinetralisir” secara domain.

### 2.6 Incident

Incident adalah tanda runtime bahwa process execution bermasalah dan membutuhkan perhatian.

Contoh:

- failed job retries habis,
- external task retries 0,
- custom incident dibuat oleh aplikasi,
- operator harus memperbaiki data/konfigurasi lalu retry.

Incident bukan business outcome. Incident adalah operational state.

---

## 3. Java Exception vs BPMN Error

Ini salah satu distinction paling penting di Camunda 7.

### 3.1 Java Exception

Java exception berarti execution gagal secara teknis.

Contoh:

```java
public class SendEmailDelegate implements JavaDelegate {
  @Override
  public void execute(DelegateExecution execution) {
    emailClient.send(...); // may throw RuntimeException
  }
}
```

Jika exception tidak ditangkap:

- command gagal,
- transaction rollback,
- state kembali ke last committed wait state,
- jika activity dijalankan oleh job executor, retry job dikurangi,
- jika retry habis, incident dibuat.

Ini cocok untuk:

- transient technical problem,
- infrastructure issue,
- programming error,
- downstream outage,
- unexpected exception.

Tidak cocok untuk:

- applicant rejected,
- business rule says no,
- document incomplete,
- expected alternative path.

### 3.2 BPMN Error

BPMN Error adalah event BPMN untuk alternative business flow.

Contoh:

```java
throw new BpmnError("DOCUMENT_INCOMPLETE", "Required evidence is missing");
```

Kemudian BPMN model punya boundary error:

```xml
<boundaryEvent id="catchDocumentIncomplete" attachedToRef="validateDocumentsTask">
  <errorEventDefinition errorRef="documentIncompleteError"
    camunda:errorCodeVariable="errorCode"
    camunda:errorMessageVariable="errorMessage" />
</boundaryEvent>
```

Jika cocok:

- current activity scope dihentikan;
- execution pindah ke outgoing flow dari boundary event;
- ini bukan incident;
- ini bukan job retry;
- ini process path yang valid.

### 3.3 Decision Rule

Gunakan rule berikut:

```text
Apakah failure ini expected dan punya business meaning?
  YA  -> BPMN Error / gateway / explicit business branch
  TIDAK -> Java exception / retry / incident
```

```text
Apakah caller/user bisa memperbaiki input sebelum command Camunda?
  YA  -> validate before Camunda API call
  TIDAK -> represent as process state/path
```

```text
Apakah downstream gagal karena network/system?
  YA -> exception + async retry
```

```text
Apakah downstream berhasil menolak request secara domain?
  YA -> BPMN Error / message result / gateway branch
```

---

## 4. Transaction Rollback Semantics

Camunda 7 menjalankan command dalam transaction. Jika exception keluar dari command, transaction rollback.

Contoh synchronous path:

```text
User Task: Review Application
  -> taskService.complete()
  -> Service Task: Generate Certificate
  -> Service Task: Send Email
  -> End
```

Jika `Send Email` throw exception dan semua masih synchronous:

```text
taskService.complete() rollback
user task tetap ada
certificate generation DB write rollback jika ikut transaction yang sama
email mungkin sudah terkirim jika side effect terjadi sebelum exception
```

Inilah side-effect trap.

### 4.1 Rollback Tidak Membatalkan Side Effect Eksternal

Transaction rollback hanya membatalkan perubahan yang ikut transaction resource yang sama.

Tidak otomatis rollback:

- HTTP request yang sudah diterima downstream,
- email yang sudah dikirim,
- file yang sudah di-upload,
- Kafka message yang sudah publish tanpa transactional coordination,
- payment yang sudah initiated,
- external task worker operation.

Maka untuk side effect, desain harus at-least-once-safe.

### 4.2 Async Boundary sebagai Failure Scope Boundary

Bandingkan:

```text
User Task complete
  -> synchronous Send Email
```

vs:

```text
User Task complete
  -> asyncBefore Send Email
```

Dengan `asyncBefore`:

```text
Transaction 1:
  complete user task
  create job for Send Email
  commit

Transaction 2:
  job executor executes Send Email
  if fail: retry job
  if exhausted: incident
```

Efeknya:

- user task tidak muncul kembali hanya karena email gagal;
- email failure menjadi operational job failure;
- operator bisa retry setelah memperbaiki SMTP/downstream;
- process berada di state yang lebih jelas.

Prinsip:

> Letakkan async boundary sebelum side-effect besar atau titik failure teknis yang tidak boleh membatalkan human decision sebelumnya.

---

## 5. BPMN Error Deep Dive

### 5.1 Error Definition

BPMN Error biasanya didefinisikan di root definitions:

```xml
<error id="documentIncompleteError" errorCode="DOCUMENT_INCOMPLETE" name="Document Incomplete" />
```

Error code adalah kontrak. Perlakukan seperti API code.

Jangan pakai string asal:

```text
bad:
  "error"
  "failed"
  "not ok"
  "Exception"

good:
  "DOCUMENT_INCOMPLETE"
  "APPLICANT_NOT_ELIGIBLE"
  "PAYMENT_DECLINED"
  "REVIEW_REQUIRES_SUPERVISOR"
```

### 5.2 Throwing BPMN Error dari JavaDelegate

```java
public final class EligibilityCheckDelegate implements JavaDelegate {
  private final EligibilityService eligibilityService;

  public EligibilityCheckDelegate(EligibilityService eligibilityService) {
    this.eligibilityService = eligibilityService;
  }

  @Override
  public void execute(DelegateExecution execution) {
    String applicationId = (String) execution.getVariable("applicationId");

    EligibilityResult result = eligibilityService.check(applicationId);

    if (!result.eligible()) {
      execution.setVariable("eligibilityDecisionId", result.decisionId());
      execution.setVariable("eligibilityReasonCode", result.reasonCode());
      throw new BpmnError("APPLICANT_NOT_ELIGIBLE", result.reasonMessage());
    }

    execution.setVariable("eligibilityDecisionId", result.decisionId());
    execution.setVariable("eligible", true);
  }
}
```

Catatan penting:

- business result disimpan sebelum throw `BpmnError`;
- error code stabil;
- message boleh untuk human-readable context, tetapi jangan menjadi primary logic;
- domain audit sebaiknya tetap ditulis di domain service/table, bukan hanya variable Camunda.

### 5.3 Boundary Error Event

Boundary error cocok ketika error berasal dari activity/subprocess tertentu.

```text
Subprocess: Validate Application
  - Validate Identity
  - Validate Documents
  - Validate Eligibility
Boundary Error: DOCUMENT_INCOMPLETE
  -> User Task: Request Correction
Boundary Error: APPLICANT_NOT_ELIGIBLE
  -> User Task: Notify Rejection
```

Keuntungan boundary di subprocess:

- error dari beberapa internal task bisa ditangkap di satu boundary;
- model lebih bersih;
- alternative path berada di level business capability, bukan di setiap service task.

### 5.4 Event Subprocess Error Start

Error event subprocess cocok untuk common handler di scope tertentu.

```text
Subprocess: Investigation
  Event Subprocess: Error Start ANY_INVESTIGATION_ERROR
    -> Create audit entry
    -> Notify supervisor
    -> End / rethrow
```

Gunakan jika:

- handler cross-cutting dalam scope;
- perlu cleanup internal;
- perlu catch-and-rethrow pattern;
- boundary event terlalu tersebar.

### 5.5 Unhandled BPMN Error

Jika BPMN Error tidak ditangkap, default behavior bisa mengejutkan: current execution bisa berakhir seperti none end semantics, tergantung konfigurasi. Untuk sistem enterprise, sebaiknya unhandled BPMN Error tidak dibiarkan diam-diam.

Policy yang lebih aman:

- semua `BpmnError` code harus punya catcher yang jelas;
- test semua error path;
- pertimbangkan konfigurasi yang membuat unhandled BPMN Error menjadi exception;
- gunakan lint/model validation untuk memastikan errorRef tertangkap.

### 5.6 Anti-Pattern BPMN Error

#### Anti-pattern 1: Mengubah semua exception menjadi BPMN Error

```java
try {
  remote.call();
} catch (Exception e) {
  throw new BpmnError("REMOTE_FAILED");
}
```

Masalah:

- technical failure tidak diretry sebagai job failure;
- incident tidak muncul;
- operator kehilangan signal operational;
- process masuk business alternative palsu.

#### Anti-pattern 2: BPMN Error sebagai validation exception UI

```text
User submits missing field
-> task complete called anyway
-> delegate throws BpmnError("MISSING_FIELD")
```

Lebih baik:

```text
UI/API validates command
if invalid -> 400 / validation response
if valid -> complete task
```

#### Anti-pattern 3: Error code berdasarkan Java exception class

Camunda mendukung konsep error code yang bisa mereferensikan exception class, tetapi untuk enterprise workflow, error code business-stable lebih aman daripada class-name-stable.

Class name berubah saat refactor. Business code seharusnya stabil.

---

## 6. Incident Deep Dive

Incident adalah operational marker bahwa execution bermasalah.

Contoh incident umum:

```text
failed job retries exhausted
external task retries exhausted
custom incident created by application/platform extension
```

Incident disimpan di runtime table:

```text
ACT_RU_INCIDENT
```

History juga bisa menyimpan incident tergantung configuration/history level.

### 6.1 Failed Job Incident

Flow:

```text
Job executor picks job
  -> delegate throws exception
  -> job retries decremented
  -> retry scheduled
  -> if retries > 0: job remains retryable later
  -> if retries == 0: incident created
```

Incident berarti:

- process tidak selesai;
- execution menunggu administrative action;
- operator perlu inspect error message/stacktrace/context;
- setelah root cause diperbaiki, retries bisa dinaikkan dan job dieksekusi ulang.

### 6.2 Incident Bukan Business Error

Jangan gunakan incident untuk:

- applicant rejected,
- document incomplete,
- supervisor needed,
- payment declined as valid provider result,
- user cancelled request.

Itu adalah business state/path.

Incident cocok untuk:

- bug,
- configuration missing,
- integration down,
- serialization failure,
- bad process deployment,
- missing delegate bean,
- class not found,
- exhausted retry.

### 6.3 Incident Recovery Lifecycle

Production recovery biasanya:

```text
1. Detect incident
2. Classify incident type
3. Identify failed activity/job/process/business key
4. Inspect exception and variables safely
5. Fix root cause
6. Decide recovery action
7. Retry job / modify instance / cancel / migrate / compensate
8. Record operator action in audit trail
9. Verify process progresses
10. Add prevention test/alert/runbook update
```

### 6.4 Retry Failed Job

Operator bisa retry failed job by setting retries:

```java
managementService.setJobRetries(jobId, 1);
```

Atau batch operation untuk banyak job.

Namun jangan asal retry massal.

Sebelum retry:

- apakah root cause sudah fixed?
- apakah delegate idempotent?
- apakah previous attempt punya side effect?
- apakah duplicate effect aman?
- apakah variable state masih valid?
- apakah process definition version kompatibel?

### 6.5 Manual Recovery vs Automatic Retry

Automatic retry cocok untuk transient failure.

Manual recovery cocok untuk:

- bad data,
- missing configuration,
- corrupted variable,
- classpath mismatch,
- downstream contract changed,
- business decision required.

Jangan memaksa semua recovery otomatis. Sistem enterprise yang baik memberi operator safe intervention points.

---

## 7. Escalation Events

Escalation event berbeda dari error.

Error berarti alternative failure path.

Escalation berarti memberi tahu level atas bahwa ada kondisi penting yang perlu ditangani.

### 7.1 Contoh Escalation

```text
Case Review Subprocess
  - Officer Review
  - Clarification Request
  - Applicant Response
  - Officer Reassessment

Escalation: REPEATED_CORRECTION
  -> Supervisor Review Task
```

Atau:

```text
Payment Subprocess
  - Try payment
  - Payment pending

Escalation: PAYMENT_PENDING_TOO_LONG
  -> Notify Finance Ops
  -> Continue waiting
```

### 7.2 Escalation Tidak Selalu Menghentikan Flow

Escalation bisa non-interrupting.

```text
Main work continues
  + escalation branch creates supervisor task
```

Ini sangat berguna untuk:

- SLA warning,
- parallel oversight,
- non-blocking notification,
- management visibility.

### 7.3 Escalation vs BPMN Error

| Pertanyaan | BPMN Error | Escalation |
|---|---|---|
| Apakah ini failure business path? | Ya | Tidak selalu |
| Apakah normal flow harus berhenti? | Biasanya ya pada boundary error | Bisa ya/tidak tergantung event |
| Apakah ini technical failure? | Tidak | Tidak |
| Apakah ini communication upward? | Tidak utama | Ya |
| Contoh | Not eligible | Supervisor attention needed |

### 7.4 Escalation Naming

Gunakan code yang jelas:

```text
SLA_WARNING_3_DAYS
CASE_REQUIRES_SUPERVISOR
REPEATED_CORRECTION_ATTEMPTS
HIGH_RISK_APPLICATION
```

Jangan pakai:

```text
ESCALATE
ALERT
PROBLEM
```

### 7.5 Escalation Anti-Pattern

#### Escalation sebagai exception teknis

```text
HTTP 500 -> throw escalation SERVICE_FAILED
```

Salah. Itu technical failure. Gunakan exception + retry/incident.

#### Escalation sebagai approval rejection

```text
Reviewer rejects -> escalation REJECTED
```

Biasanya rejection adalah business branch, bukan escalation.

---

## 8. Compensation Events

Compensation adalah salah satu bagian BPMN yang sering disalahpahami.

Compensation bukan rollback database.

Compensation adalah aksi bisnis untuk menetralkan efek aksi sebelumnya.

### 8.1 Contoh Compensation

Process:

```text
1. Reserve appointment slot
2. Issue temporary registration
3. Send payment request
4. Final approval rejected
5. Need to undo reservation and temporary registration
```

Compensation:

```text
Compensate issue temporary registration
Compensate reserve appointment slot
```

### 8.2 Compensation Handler

Activity yang sudah selesai bisa punya compensation boundary event:

```text
Service Task: Reserve Slot
  boundary compensation -> Service Task: Release Slot
```

Ketika compensation triggered, handler dijalankan.

### 8.3 Compensation Subscription

Mental model:

```text
When a compensatable activity completes,
Camunda remembers that compensation may be needed later.
```

Subscription biasanya bertahan sampai process instance selesai atau compensation dijalankan.

### 8.4 Compensation Ordering

Dalam business transaction, compensation sering berjalan dalam reverse order:

```text
A completed
B completed
C failed later
compensate B
compensate A
```

Namun jangan hanya mengandalkan urutan. Setiap compensation action harus idempotent.

### 8.5 Compensation Idempotency

Compensation juga at-least-once risk.

Contoh release reservation:

```java
public void releaseSlot(String reservationId) {
  Reservation reservation = repository.find(reservationId);
  if (reservation == null) {
    return; // idempotent
  }
  if (reservation.status() == RELEASED) {
    return; // idempotent
  }
  reservation.release();
}
```

### 8.6 Compensation vs Cancellation

Cancellation adalah keputusan untuk menghentikan flow.

Compensation adalah aksi untuk menetralkan side effects yang sudah terjadi.

Keduanya sering muncul bersama, tetapi bukan hal yang sama.

### 8.7 Compensation vs Saga

Saga adalah pola arsitektur untuk long-running transaction lintas service.

BPMN compensation dapat menjadi cara memodelkan saga, tetapi saga tetap membutuhkan:

- idempotency,
- command tracking,
- event tracking,
- retry,
- timeout,
- operator recovery,
- audit.

BPMN diagram saja tidak membuat saga robust.

---

## 9. Cancel Event dan Transaction Subprocess

Transaction subprocess di BPMN bukan ACID database transaction.

Ia adalah BPMN construct untuk mengelompokkan aktivitas yang secara bisnis dianggap transaction.

Contoh:

```text
Transaction Subprocess: Book Travel
  - Reserve Flight
  - Reserve Hotel
  - Reserve Car
Cancel boundary:
  - Compensate reservations
```

Dalam enterprise Java/Camunda:

- jangan mengira transaction subprocess membuat distributed XA transaction;
- treat sebagai business transaction boundary;
- side effects tetap butuh idempotency dan compensation;
- technical retry tetap melalui job/external task semantics.

---

## 10. Explicit Recovery Modelling

Recovery harus dimodelkan eksplisit jika operator/user/business harus mengambil keputusan.

### 10.1 User Task for Operations

Contoh:

```text
Service Task: Validate with External Registry
  asyncBefore=true
  retry 3 times
  if retries exhausted -> incident

Operator runbook:
  fix registry config
  retry job
```

Atau model eksplisit:

```text
Service Task: Validate with External Registry
  boundary error: REGISTRY_BUSINESS_REJECTED -> Rejection Path
  technical exception -> job retry/incident

Timer boundary: Registry Response Timeout
  -> User Task: Operations Review
  -> Retry / Manual Resolve / Cancel
```

### 10.2 Manual Repair Task

Untuk beberapa kasus, lebih baik tidak bergantung pada Cockpit saja.

Contoh regulatory process:

```text
External validation failed repeatedly
  -> Create internal ops task
  -> Ops reviews error
  -> Ops chooses:
       Retry
       Mark external validation unavailable
       Request manual evidence
       Cancel case
```

Keuntungan:

- business-visible;
- auditable;
- role-controlled;
- tidak butuh admin engine access untuk setiap recovery;
- bisa masuk dashboard case management.

### 10.3 Recovery Decision Matrix

| Failure | Automatic retry | Incident | Manual task | BPMN Error | Compensation |
|---|---:|---:|---:|---:|---:|
| Network timeout | Ya | Jika retry habis | Kadang | Tidak | Tidak langsung |
| Missing config | Tidak banyak gunanya | Ya | Ya | Tidak | Tidak |
| Business rejection | Tidak | Tidak | Bisa | Ya | Mungkin |
| SLA almost breached | Tidak | Tidak | Ya | Tidak | Tidak |
| External reservation succeeded then later cancel | Tidak | Jika compensation fail | Ya | Mungkin | Ya |
| Duplicate inbound event | Tidak | Tidak | Tidak | Tidak | Tidak, use inbox |
| Optimistic locking conflict in job | Ya | Jika terus gagal | Jarang | Tidak | Tidak |

---

## 11. Designing Retry Semantics

Retry tidak boleh asal.

### 11.1 Retryable vs Non-Retryable

Retryable:

- timeout,
- 502/503/504,
- temporary DB connection failure,
- lock conflict,
- rate limit with backoff,
- temporary file storage failure.

Non-retryable:

- invalid request payload due to bug,
- missing mandatory configuration,
- unknown enum from deployment mismatch,
- unauthorized due to wrong credentials until config fixed,
- business rejected,
- validation failed.

Semi-retryable:

- 401 token expired: refresh token then retry in same delegate/client;
- 429 rate limited: retry with controlled backoff, not job storm;
- 409 duplicate: interpret idempotently if request id matches.

### 11.2 Retry Owner

Setiap failure harus punya retry owner:

| Layer | Retry owner |
|---|---|
| HTTP client internal short retry | Integration client |
| Process async job retry | Camunda Job Executor |
| External task retry | Worker + Camunda external task retries |
| Business retry by user | User task/action |
| Operator retry | Cockpit/custom ops console |
| Event redelivery | Message broker/inbox processor |

Jangan membuat retry bertumpuk tanpa koordinasi:

```text
HTTP client retries 5x
inside delegate
inside job retry 5x
inside cluster 4 nodes
inside load balancer
```

Ini bisa menjadi retry amplification.

### 11.3 Retry Metadata

Setiap retryable operation sebaiknya punya:

- operation name,
- business key,
- process instance id,
- activity id,
- attempt number,
- idempotency key,
- downstream correlation id,
- error code/category,
- next retry time,
- final incident marker.

---

## 12. Idempotency and Recovery

Recovery tanpa idempotency adalah perjudian.

### 12.1 Idempotency Key Pattern

Untuk side-effect command:

```text
idempotencyKey = processDefinitionKey + ":" + processInstanceId + ":" + activityId + ":" + businessOperation
```

Contoh:

```text
case-approval:pi-123:send-approval-email:v1
```

Downstream atau local outbox menyimpan:

```text
idempotency_key
operation_type
request_hash
status
result_reference
created_at
completed_at
last_error
```

### 12.2 Idempotent Delegate Skeleton

```java
public final class IssueCertificateDelegate implements JavaDelegate {
  private final IdempotencyService idempotency;
  private final CertificateClient certificateClient;

  @Override
  public void execute(DelegateExecution execution) {
    String processInstanceId = execution.getProcessInstanceId();
    String activityId = execution.getCurrentActivityId();
    String applicationId = (String) execution.getVariable("applicationId");

    String key = "issue-certificate:" + processInstanceId + ":" + activityId;

    IdempotencyResult<CertificateResult> result = idempotency.executeOnce(
      key,
      () -> certificateClient.issue(applicationId, key)
    );

    execution.setVariable("certificateId", result.value().certificateId());
  }
}
```

### 12.3 Compensation Idempotency

Compensation handler juga butuh key:

```text
compensate:issue-certificate:<certificateId>
```

Jangan mengasumsikan compensation hanya sekali.

---

## 13. Error Handling in External Tasks

External task punya mekanisme berbeda.

Worker bisa:

1. `complete`,
2. `handleFailure`,
3. `handleBpmnError`,
4. extend lock,
5. unlock.

### 13.1 Technical Failure

```java
client.newCompleteCommand(task.getId())...
```

Jika gagal secara teknis:

```java
client.newFailureCommand(task.getId())
  .retries(task.getRetries() - 1)
  .retryTimeout(60_000L)
  .errorMessage("Registry timeout")
  .send();
```

Jika retries 0, external task dapat menjadi incident/stuck operational state.

### 13.2 Business Error

```java
client.newBpmnErrorCommand(task.getId())
  .errorCode("DOCUMENT_INCOMPLETE")
  .errorMessage("Required supporting file is missing")
  .send();
```

Gunakan untuk expected business alternative.

### 13.3 Worker Crash

Jika worker crash setelah downstream side effect tetapi sebelum `complete`, lock akan expire dan task bisa diambil ulang.

Maka external task worker wajib idempotent.

```text
fetch-and-lock
call downstream successfully
worker crash before complete
lock expires
another worker repeats
```

Tanpa idempotency, duplicate side effect terjadi.

---

## 14. Recovery and Auditability

Dalam regulatory system, recovery action sendiri adalah audit event.

Jangan hanya rely pada Cockpit operation log jika business/legal audit butuh detail lebih kaya.

Audit recovery sebaiknya mencatat:

- who performed recovery,
- when,
- process instance id,
- business key/case id,
- failed activity,
- original error category,
- recovery action,
- justification,
- before/after state,
- linked evidence/ticket/incident id.

Contoh recovery actions:

```text
RETRY_JOB
MANUAL_OVERRIDE
MARK_EXTERNAL_VALIDATION_UNAVAILABLE
CORRECT_VARIABLE
CANCEL_PROCESS
START_COMPENSATION
MIGRATE_INSTANCE
REOPEN_CASE
```

### 14.1 Business Audit vs Engine Audit

Engine audit menjawab:

```text
activity X failed at time T
job Y had exception Z
operator set retries
```

Business audit menjawab:

```text
why did officer manually override external registry failure?
what policy allowed it?
what evidence was reviewed?
who approved the override?
what was communicated to applicant?
```

Keduanya berbeda.

---

## 15. Pattern: Technical Failure with Retry and Incident

Model:

```text
User Task: Approve Case
  -> Service Task: Generate Certificate [asyncBefore]
  -> Service Task: Notify Applicant [asyncBefore]
  -> End
```

Delegate:

```java
public final class NotifyApplicantDelegate implements JavaDelegate {
  @Override
  public void execute(DelegateExecution execution) {
    String notificationId = buildNotificationId(execution);
    notificationService.sendApprovalNotice(notificationId, ...);
  }
}
```

BPMN config:

```xml
<serviceTask id="notifyApplicant"
             name="Notify Applicant"
             camunda:delegateExpression="${notifyApplicantDelegate}"
             camunda:asyncBefore="true">
  <extensionElements>
    <camunda:failedJobRetryTimeCycle>R5/PT5M</camunda:failedJobRetryTimeCycle>
  </extensionElements>
</serviceTask>
```

Behavior:

```text
If SMTP temporary down:
  job fails
  retry every 5 minutes
  if exhausted: incident
  operator fixes SMTP
  operator retries job
```

This is technical failure handling.

---

## 16. Pattern: Business Error to Correction Flow

Model:

```text
Subprocess: Validate Submission
  - Check Documents
  - Check Eligibility
Boundary Error: DOCUMENT_INCOMPLETE
  -> User Task: Request Correction
  -> Intermediate Message Catch: Applicant Submitted Correction
  -> Validate Submission again
Boundary Error: APPLICANT_NOT_ELIGIBLE
  -> User Task: Issue Rejection Notice
  -> End
```

Delegate:

```java
if (documents.incomplete()) {
  execution.setVariable("missingDocumentCodes", documents.missingCodes());
  throw new BpmnError("DOCUMENT_INCOMPLETE", "Required documents are missing");
}
```

This is business alternative handling.

---

## 17. Pattern: SLA Escalation Without Interrupting Work

Model:

```text
User Task: Officer Review
  boundary timer non-interrupting after P3D
    -> User Task: Supervisor Follow-up
  boundary timer interrupting after P10D
    -> User Task: Mandatory Escalation Decision
```

Meaning:

- after 3 days, supervisor gets visibility but officer review continues;
- after 10 days, process leaves normal review and enters mandatory escalation.

This separates warning from breach.

---

## 18. Pattern: Compensation for External Reservation

Model:

```text
Transaction/Subprocess: Schedule Inspection
  Service Task: Reserve Inspector Slot
    compensation boundary -> Release Inspector Slot
  Service Task: Reserve Facility
    compensation boundary -> Release Facility
  Service Task: Confirm Schedule

Cancel boundary / business cancellation:
  throw compensation
  notify applicant
```

Rules:

- reserve operations idempotent;
- release operations idempotent;
- compensation audit stored;
- if compensation fails, incident/manual ops task exists.

---

## 19. Anti-Patterns

### 19.1 Technical Failure as BPMN Error

Bad:

```java
catch (IOException e) {
  throw new BpmnError("SYSTEM_ERROR");
}
```

Why bad:

- hides operational issue;
- avoids retry semantics;
- makes model branch into fake business path;
- may complete process incorrectly.

Better:

```java
catch (IOException e) {
  throw new ExternalRegistryUnavailableException(e);
}
```

and let async job retry/incident handle it.

### 19.2 Business Rejection as Java Exception

Bad:

```java
if (!eligible) {
  throw new RuntimeException("Not eligible");
}
```

Why bad:

- creates incident/retry for valid business decision;
- operator sees false failure;
- process stuck instead of rejected.

Better:

```java
throw new BpmnError("APPLICANT_NOT_ELIGIBLE");
```

or explicit gateway based on variable.

### 19.3 Compensation as Delete

Bad:

```text
Compensation = delete row / remove trace
```

Compensation should not erase audit. It should create reversal state.

Better:

```text
RESERVED -> RELEASED
ISSUED_TEMPORARY -> REVOKED
PAYMENT_CAPTURED -> REFUND_REQUESTED -> REFUNDED
```

### 19.4 Incident as User-Facing State

Bad:

```text
Applicant status = INCIDENT
```

Incident is operational. User-facing state should be business meaningful:

```text
PROCESSING_DELAYED
UNDER_MANUAL_REVIEW
PENDING_EXTERNAL_VALIDATION
```

### 19.5 Infinite Retry Without Circuit Breaker

Bad:

```text
retry forever every 1 second
```

This can DDOS downstream and fill logs.

Better:

```text
short client retry for tiny transient issues
bounded job retry
incident/manual ops review
rate limit/circuit breaker at integration layer
```

---

## 20. SQL Diagnostics

Do not mutate Camunda tables manually. But safe read-only diagnostics are valuable.

### 20.1 Find Open Incidents

```sql
select
  ID_,
  INCIDENT_TYPE_,
  INCIDENT_MSG_,
  EXECUTION_ID_,
  PROC_INST_ID_,
  ACTIVITY_ID_,
  CAUSE_INCIDENT_ID_,
  ROOT_CAUSE_INCIDENT_ID_,
  CONFIGURATION_,
  CREATE_TIME_
from ACT_RU_INCIDENT
order by CREATE_TIME_ desc;
```

### 20.2 Join Incident to Process Instance

```sql
select
  i.ID_ as incident_id,
  i.INCIDENT_TYPE_,
  i.INCIDENT_MSG_,
  i.ACTIVITY_ID_,
  i.PROC_INST_ID_,
  e.BUSINESS_KEY_,
  e.PROC_DEF_ID_,
  i.CREATE_TIME_
from ACT_RU_INCIDENT i
left join ACT_RU_EXECUTION e on e.ID_ = i.PROC_INST_ID_
order by i.CREATE_TIME_ desc;
```

### 20.3 Failed Jobs

```sql
select
  ID_,
  TYPE_,
  HANDLER_TYPE_,
  HANDLER_CFG_,
  RETRIES_,
  DUEDATE_,
  LOCK_OWNER_,
  LOCK_EXP_TIME_,
  EXCEPTION_MSG_,
  PROCESS_INSTANCE_ID_,
  EXECUTION_ID_,
  PROCESS_DEF_ID_
from ACT_RU_JOB
where RETRIES_ = 0
order by DUEDATE_ desc;
```

### 20.4 External Tasks with No Retries

```sql
select
  ID_,
  TOPIC_NAME_,
  WORKER_ID_,
  LOCK_EXP_TIME_,
  RETRIES_,
  ERROR_MSG_,
  PROC_INST_ID_,
  EXECUTION_ID_,
  ACT_ID_
from ACT_RU_EXT_TASK
where RETRIES_ = 0
order by LOCK_EXP_TIME_ desc;
```

### 20.5 Compensation/Event Subscriptions

```sql
select
  ID_,
  EVENT_TYPE_,
  EVENT_NAME_,
  EXECUTION_ID_,
  PROC_INST_ID_,
  ACTIVITY_ID_,
  CREATED_
from ACT_RU_EVENT_SUBSCR
order by CREATED_ desc;
```

Use this to inspect message, signal, conditional, compensation-related subscriptions depending on process state.

---

## 21. Java API Diagnostics

### 21.1 Query Incidents

```java
List<Incident> incidents = runtimeService.createIncidentQuery()
    .processInstanceId(processInstanceId)
    .orderByIncidentTimestamp()
    .desc()
    .list();
```

### 21.2 Query Failed Jobs

```java
List<Job> failedJobs = managementService.createJobQuery()
    .processInstanceId(processInstanceId)
    .withException()
    .list();
```

### 21.3 Get Exception Stacktrace

```java
String stacktrace = managementService.getJobExceptionStacktrace(jobId);
```

### 21.4 Retry Job

```java
managementService.setJobRetries(jobId, 1);
```

### 21.5 Create Custom Incident

Custom incident should be rare, but possible for platform-specific diagnostics.

```java
runtimeService.createIncident(
    "external-system-unavailable",
    executionId,
    externalSystemName,
    "External registry unavailable beyond allowed window"
);
```

Use custom incidents carefully. Do not create custom incident for normal business state.

---

## 22. Error Design Checklist

For every service task / external task / subprocess, answer:

1. What are the expected business alternatives?
2. What are the technical failures?
3. Which failures are retryable?
4. Which failures should become incident?
5. Which failures need user/operator recovery?
6. Which side effects may already have happened before failure?
7. What idempotency key protects retries?
8. What compensation is required if later cancellation happens?
9. What variables are written before throwing BPMN Error?
10. What audit record proves the decision?
11. What is visible to business users?
12. What is visible to operators?
13. What alert should fire?
14. What runbook step should operator follow?
15. What test covers this path?

---

## 23. Regulatory Workflow Example

Consider an enforcement lifecycle:

```text
1. Case Created
2. Preliminary Assessment
3. Request Evidence
4. Evidence Submitted
5. External Registry Validation
6. Officer Review
7. Supervisor Approval
8. Enforcement Action Issued
9. Appeal Window
10. Case Closure
```

### 23.1 Business Errors

| Condition | Mechanism |
|---|---|
| Evidence incomplete | BPMN Error -> Request Correction |
| Entity not found in registry as valid business result | BPMN Error -> Manual Verification |
| Enforcement not legally allowed | BPMN Error / Gateway -> Close as No Action |
| Appeal not submitted in time | Timer -> Close Appeal Window |

### 23.2 Technical Errors

| Condition | Mechanism |
|---|---|
| Registry timeout | Async retry -> incident if exhausted |
| Document service unavailable | Async retry -> incident/custom ops task |
| Email gateway down | Async retry; do not rollback approval |
| PDF generation failure | Async retry; manual ops if repeated |

### 23.3 Escalations

| Condition | Mechanism |
|---|---|
| Assessment pending > 3 days | Non-interrupting timer -> supervisor task |
| Case high severity | Escalation -> senior review branch |
| Officer correction loop > 2 | Escalation -> quality review |

### 23.4 Compensation

| Action | Compensation |
|---|---|
| Temporary restriction issued | Revoke temporary restriction |
| Inspection slot reserved | Release slot |
| External case created | Close/cancel external case |
| Enforcement notice sent incorrectly | Issue correction/retraction notice |

### 23.5 Incident

| Condition | Incident meaning |
|---|---|
| Retry exhausted validating registry | Operator must fix integration or mark manual path |
| Missing delegate bean after deployment | Deployment/classpath issue |
| Variable deserialization failure | Versioning/serialization issue |
| Compensation release failed | Operator must inspect external state |

---

## 24. Testing Error and Recovery Semantics

A top-level workflow test suite should cover not only happy path.

### 24.1 Test Categories

- BPMN Error caught by correct boundary event.
- BPMN Error with wrong code is not silently ignored.
- Technical exception creates failed job when async.
- Failed job retries are configured correctly.
- Incident appears when retries exhausted.
- Retrying failed job progresses process after root cause fixed.
- Compensation handler executes after cancellation.
- Compensation handler is idempotent.
- Non-interrupting escalation creates extra branch without stopping original work.
- Interrupting boundary timer destroys original scope.
- External task `handleFailure` decreases retries.
- External task `handleBpmnError` enters business path.
- Manual recovery task records audit.

### 24.2 Example Process Test Mental Model

```java
@Test
void documentIncompleteShouldRouteToCorrection() {
  // start process
  // mock validation delegate to throw BpmnError(DOCUMENT_INCOMPLETE)
  // assert process waits at Request Correction task
  // assert no incident created
}

@Test
void registryTimeoutShouldCreateFailedJobIncident() {
  // start process to async registry validation
  // execute job and make delegate throw technical exception
  // exhaust retries
  // assert incident exists
  // fix mock
  // set retries
  // execute job
  // assert process progresses
}
```

---

## 25. Production Runbook Template

For each process definition, maintain runbook entries like:

```markdown
## Incident: Registry Validation Failed

### Symptom
- Incident type: failedJob
- Activity id: validateExternalRegistry
- Common message: timeout / 503 / unauthorized

### Business impact
- Case remains pending external validation
- Applicant sees processing delayed

### Immediate checks
- Check registry API health
- Check credentials/SSM/secrets
- Check outbound network/DNS
- Check recent deployment
- Check process variable `registryRequestId`

### Safe recovery
1. Fix external issue.
2. Confirm idempotency key exists in integration audit.
3. Retry job once.
4. Verify process moved to Officer Review or Manual Verification.
5. Record action in ops audit.

### Unsafe actions
- Do not update ACT_RU_JOB manually.
- Do not delete incident row manually.
- Do not complete downstream task manually without domain audit.

### Escalation
- If registry unavailable > 4 hours, route to Manual Verification process path.
```

---

## 26. Summary Mental Model

Camunda 7 recovery design is not about catching all exceptions.

It is about mapping failure semantics to the right process/runtime mechanism:

```text
Technical failure
  -> exception
  -> rollback/retry
  -> incident if unresolved

Expected business alternative
  -> BPMN Error or gateway
  -> explicit business path

Non-critical upward communication
  -> escalation
  -> optional parallel handling

Long-running undo/reversal
  -> compensation
  -> idempotent reversal action

Operational stuck state
  -> incident
  -> operator recovery

Time-based breach/warning
  -> timer
  -> escalation/manual task/business transition
```

A production-grade Camunda 7 system must make failure states explicit, observable, recoverable, and auditable.

The most important rule:

> Treat workflow error handling as state machine design, not exception handling syntax.

---

## 27. Part 017 Checklist

You should now be able to:

- distinguish Java exception, BPMN Error, escalation, compensation, and incident;
- decide which mechanism fits a failure type;
- explain why rollback does not undo external side effects;
- design async retry boundary before risky side effects;
- model business rejection without creating false incidents;
- model technical failure without polluting BPMN with infrastructure branches;
- design compensation as idempotent business reversal;
- define runbook-driven incident recovery;
- build audit-friendly recovery semantics;
- reason about external task failure vs BPMN error;
- design regulatory workflow failure paths defensibly.

---

## 28. Referensi Resmi

- Camunda 7.24 Manual — Error Handling
- Camunda 7.24 Manual — Incidents
- Camunda 7.24 BPMN Reference — Error Events
- Camunda 7.24 BPMN Reference — Escalation Events
- Camunda 7.24 BPMN Reference — Cancel and Compensation Events
- Camunda 7.24 Manual — Transactions in Processes
- Camunda 7.24 Manual — The Job Executor
- Camunda 7.24 Manual — External Tasks

---

## 29. Status Seri

- Part ini: **selesai**.
- Seri keseluruhan: **belum selesai**.
- Lanjut ke: `learn-java-camunda-7-bpm-platform-engineering-part-018.md` — **Process Versioning, Deployment, Migration, dan Long-Running Instance Evolution**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-016.md">⬅️ Part 016 — History, Auditability, Regulatory Traceability, dan Data Retention</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-018.md">Part 018 — Process Versioning, Deployment, Migration, dan Long-Running Instance Evolution ➡️</a>
</div>

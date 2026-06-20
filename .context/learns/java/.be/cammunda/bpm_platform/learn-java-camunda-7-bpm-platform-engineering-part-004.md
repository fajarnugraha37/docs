# learn-java-camunda-7-bpm-platform-engineering-part-004.md

# Part 004 — Async Continuations, Job Creation, Retry Semantics, dan Idempotency Design

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Fokus: Camunda BPM Platform / Camunda 7 `<= 7.x`  
> Target pembaca: Java engineer senior/principal yang ingin memahami Camunda 7 sebagai durable process runtime, bukan hanya BPMN automation tool.  
> Prasyarat seri sebelumnya: part 000–003, terutama mental model wait state, transaction boundary, execution tree, dan rollback ke last committed save point.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membangun fondasi penting:

1. Camunda 7 adalah **passive engine**.
2. Engine berjalan di thread pemanggil sampai mencapai wait state atau async continuation.
3. Wait state adalah durability boundary.
4. Kalau exception tidak tertangani terjadi sebelum commit, state proses rollback ke boundary terakhir.
5. `asyncBefore` dan `asyncAfter` bukan hanya “background execution”; keduanya adalah cara eksplisit membuat transaction boundary tambahan.

Part ini memperdalam satu area yang sering menentukan apakah sistem Camunda 7 di produksi akan stabil atau menjadi sumber incident: **async job dan retry semantics**.

Target akhir part ini:

- Anda memahami apa yang benar-benar terjadi saat `asyncBefore`/`asyncAfter` digunakan.
- Anda bisa membedakan job creation transaction dan job execution transaction.
- Anda paham kenapa retry Camunda berarti **at-least-once execution**, bukan exactly-once.
- Anda bisa mendesain delegate, external call, command handler, dan integration step supaya aman terhadap retry.
- Anda bisa memilih kapan memakai synchronous service task, async service task, external task, message wait state, atau outbox.
- Anda bisa membaca failed job dan incident dengan mental model yang benar.
- Anda bisa menjelaskan kepada tim kenapa “tinggal retry saja” bisa berbahaya tanpa idempotency.

---

## 1. Mental Model Utama: Async Continuation Adalah Durable Handoff

Kesalahan umum:

> “Kalau task dibuat async, berarti task itu jalan di background.”

Itu tidak sepenuhnya salah, tetapi terlalu dangkal.

Mental model yang lebih tepat:

> Async continuation adalah instruksi kepada process engine untuk **berhenti di titik tertentu, menyimpan state proses ke database, membuat job, commit transaction, lalu membiarkan job executor melanjutkan eksekusi dalam transaction terpisah**.

Jadi async continuation memiliki dua efek besar:

1. **Transaction split**  
   Work sebelum boundary dan work setelah boundary tidak lagi berada dalam database transaction yang sama.

2. **Operational handoff**  
   Lanjutan proses berubah dari caller thread menjadi job executor thread.

Tanpa async:

```text
caller thread
  -> complete user task
  -> run service A
  -> run service B
  -> create next wait state
  -> commit
```

Dengan `asyncBefore` pada service A:

```text
caller thread
  -> complete user task
  -> create job before service A
  -> commit

job executor thread
  -> acquire job
  -> run service A
  -> run service B until next wait state/async boundary
  -> commit or fail/retry
```

Implikasinya besar:

- User tidak menunggu service A selesai.
- Completion user task tidak rollback hanya karena service A gagal.
- Kegagalan service A menjadi failed job/incident, bukan exception langsung ke user.
- Service A dapat dieksekusi ulang oleh job executor.
- Semua side effect di service A harus aman terhadap retry.

---

## 2. Synchronous Execution vs Asynchronous Continuation

Camunda 7 default-nya **synchronous** untuk banyak aktivitas.

Misalnya:

```text
User Task: Review Application
  -> Service Task: Generate Notice
  -> Service Task: Send Email
  -> User Task: Supervisor Approval
```

Jika user menekan Complete pada `Review Application`, engine dapat menjalankan `Generate Notice` dan `Send Email` dalam transaction yang sama sampai mencapai `Supervisor Approval`.

Kalau `Send Email` melempar exception sebelum commit:

```text
Review Application completion rollback
Generate Notice rollback kalau hanya DB mutation dalam transaction yang sama
Send Email mungkin sudah terkirim kalau side effect eksternal terjadi sebelum exception
Supervisor Approval tidak dibuat
```

Ini menghasilkan bug klasik:

- User merasa task sudah completed.
- UI refresh dan task muncul lagi.
- Email mungkin sudah terkirim.
- User complete ulang.
- Email terkirim lagi.

Dengan `asyncBefore` pada `Send Email`:

```text
User Task complete
Generate Notice selesai
Job before Send Email dibuat
Commit

Job executor menjalankan Send Email
Kalau gagal, job retry/incident
User task tidak muncul lagi
```

Ini membuat proses lebih operable, tetapi tidak otomatis membuat side effect aman. Retry tetap bisa mengirim email lebih dari sekali kalau desainnya buruk.

---

## 3. Apa Itu Job di Camunda 7?

Job adalah representasi durable dari pekerjaan yang harus dieksekusi engine nanti.

Secara konseptual:

```text
Job = persisted continuation command
```

Job bukan thread. Job bukan queue message di Kafka/RabbitMQ. Job adalah row di database Camunda, terutama di `ACT_RU_JOB`, yang akan diambil oleh Job Executor.

Job dapat muncul karena beberapa hal:

- async continuation,
- timer event,
- async BPMN event handling,
- batch operation,
- history cleanup,
- beberapa internal engine operation lain.

Untuk part ini, fokus kita adalah job karena async continuation.

---

## 4. Lifecycle Job Async Continuation

Secara sederhana:

```text
[Process execution reaches async boundary]
        |
        v
[Create job row in ACT_RU_JOB]
        |
        v
[Commit transaction]
        |
        v
[Job executor acquisition loop sees due job]
        |
        v
[Lock job: LOCK_OWNER_ + LOCK_EXP_TIME_]
        |
        v
[Execute job in worker thread]
        |
        +--> success -> delete/complete job, advance process, commit
        |
        +--> failure -> decrement retries, unlock/reschedule, maybe incident
```

Kunci mental model:

- Job creation terjadi dalam transaction yang mencapai async boundary.
- Job execution terjadi dalam transaction berikutnya.
- Kalau job execution gagal, transaction job rollback.
- Engine mencatat failure state job secara terpisah.
- Retry berarti engine akan mencoba menjalankan continuation yang sama lagi.

---

## 5. `asyncBefore`: Boundary Sebelum Activity

`asyncBefore` membuat save point **sebelum activity dieksekusi**.

Contoh:

```xml
<serviceTask id="sendNotice"
             name="Send Notice"
             camunda:asyncBefore="true"
             camunda:delegateExpression="${sendNoticeDelegate}" />
```

Urutan konseptual:

```text
Previous state committed
  -> execution moves toward sendNotice
  -> job is created before sendNotice behavior
  -> commit

Later:
  -> job executor executes sendNotice START listener
  -> execute delegate
  -> execute END listener
  -> continue onward until next boundary
```

Gunakan `asyncBefore` saat:

- activity memanggil remote service,
- activity mahal/slow,
- activity sering gagal secara teknis,
- user interaction sebelumnya tidak boleh rollback,
- Anda ingin failure terlihat sebagai failed job di Cockpit,
- Anda ingin retry policy di level activity,
- node yang start process mungkin tidak memiliki class delegate tertentu dalam heterogeneous cluster.

Contoh bagus:

```text
User Task: Officer Submit Assessment
  -> asyncBefore Service Task: Generate Assessment PDF
  -> asyncBefore Service Task: Send Notification
  -> User Task: Supervisor Review
```

Officer tidak perlu menunggu PDF/email. Jika PDF generation gagal, officer task tidak muncul lagi; operator bisa retry job.

---

## 6. `asyncAfter`: Boundary Setelah Activity

`asyncAfter` membuat save point **setelah activity selesai**, sebelum keluar ke outgoing sequence flow.

Contoh:

```xml
<serviceTask id="calculateRisk"
             name="Calculate Risk Score"
             camunda:asyncAfter="true"
             camunda:delegateExpression="${riskScoreDelegate}" />
```

Urutan konseptual:

```text
Enter activity
Run activity behavior
Run END listener
Create job after activity
Commit

Later:
  -> job executor takes outgoing transition
  -> continue to next step
```

Gunakan `asyncAfter` saat:

- activity melakukan work yang ingin dianggap selesai secara durable,
- step berikutnya rawan gagal dan tidak boleh menyebabkan activity sebelumnya diulang,
- activity melakukan side effect yang tidak boleh diulang karena failure downstream,
- setelah activity ada parallel join, event propagation, atau path kompleks.

Contoh:

```text
Service Task: Reserve Appointment Slot
  -> asyncAfter
  -> Service Task: Notify Applicant
```

Jika `Notify Applicant` gagal, Anda mungkin tidak ingin `Reserve Appointment Slot` dieksekusi ulang karena bisa membuat double reservation.

Namun hati-hati: kalau activity sendiri side-effect eksternal dan gagal sebelum boundary after dibuat, tetap bisa terjadi ambiguity. Untuk side effect yang sangat sensitif, biasanya perlu idempotency/outbox, bukan hanya `asyncAfter`.

---

## 7. `asyncBefore` vs `asyncAfter`: Cara Memilih

### 7.1 Pertanyaan desain

Untuk setiap activity, tanyakan:

1. Apakah work sebelum activity boleh rollback jika activity gagal?
2. Apakah activity boleh diulang jika transaction setelahnya gagal?
3. Apakah activity punya side effect eksternal?
4. Apakah side effect itu idempotent?
5. Apakah user/client perlu menunggu activity selesai?
6. Apakah failure activity harus muncul sebagai failed job yang dapat dioperasikan?
7. Apakah activity mahal dan tidak boleh diulang karena failure downstream?

### 7.2 Rule praktis

| Situasi | Boundary yang sering masuk akal |
|---|---|
| Remote call bisa gagal | `asyncBefore` |
| User task completion tidak boleh rollback karena service downstream | `asyncBefore` setelah user task / sebelum service task |
| Activity mahal dan sudah selesai, step berikutnya tidak boleh mengulangnya | `asyncAfter` |
| Non-idempotent side effect | Jangan hanya andalkan async; pakai idempotency/outbox |
| Parallel join rawan optimistic locking | async sebelum join atau di cabang sebelum sinkronisasi, tergantung model |
| Start process harus cepat return | async start event |
| Long-running external worker | External task lebih cocok daripada JavaDelegate async |

### 7.3 Pattern “async around dangerous step”

Kadang activity perlu boundary sebelum dan sesudah:

```xml
<serviceTask id="sendLegalNotice"
             camunda:asyncBefore="true"
             camunda:asyncAfter="true"
             camunda:delegateExpression="${sendLegalNoticeDelegate}" />
```

Maknanya:

```text
Commit before sending notice
Run sending notice in job transaction
Commit immediately after activity
Continue downstream in separate job transaction
```

Ini berguna kalau:

- sebelum notice ada user task/approval yang tidak boleh rollback,
- setelah notice ada banyak downstream logic yang tidak boleh menyebabkan notice dikirim ulang.

Tetapi ini tidak menghilangkan requirement idempotency. Jika job gagal setelah notice terkirim tetapi sebelum commit, retry masih bisa mengirim notice ulang.

---

## 8. Async Start Event

Process instance bisa dibuat dengan start event async:

```xml
<startEvent id="start" camunda:asyncBefore="true" />
```

Efeknya:

```text
runtimeService.startProcessInstanceByKey(...)
  -> create process instance
  -> create initial job
  -> commit
  -> return to caller

job executor later:
  -> executes from start event onward
```

Berguna saat:

- start process harus cepat,
- caller tidak boleh terkena error downstream,
- process startup mahal,
- process started by REST/API gateway yang harus low latency,
- heterogeneous deployment: starter node tidak punya semua delegate classes,
- Anda ingin semua process execution terjadi via job executor, bukan request thread.

Trade-off:

- Caller tidak langsung tahu apakah first business step sukses.
- Error terjadi later sebagai failed job/incident.
- Perlu observability dan correlation id yang kuat.

---

## 9. Multi-Instance Async: Body vs Inner Activity

Multi-instance adalah sumber kebingungan besar.

Contoh:

```text
Multi-instance Service Task: Validate Each Document
  cardinality = N
```

Ada dua level:

1. **Multi-instance body**  
   Wrapper scope yang mengatur jumlah instance, completion condition, aggregation.

2. **Inner activity**  
   Activity yang dijalankan untuk setiap item.

Jika async diletakkan pada activity biasa, bisa berarti body-level async. Jika async diletakkan pada `multiInstanceLoopCharacteristics`, bisa berarti inner async.

Konseptual:

```text
asyncBefore on MI body:
  -> create job before creating all instances

asyncBefore on inner MI activity:
  -> each instance may become its own async job
```

Engineering implication:

- Inner async meningkatkan parallelism dan retry granularity.
- Inner async meningkatkan jumlah job.
- Untuk 10 item, ok. Untuk 100.000 item, bisa membanjiri `ACT_RU_JOB`.
- Completion condition dan aggregation perlu hati-hati terhadap optimistic locking.

Pattern aman:

```text
Small bounded N:
  inner async can be acceptable

Large N:
  externalize fan-out to worker/batch system
  or chunk items
  or use external task with controlled fetch/lock
```

---

## 10. Retry Semantics: Apa yang Sebenarnya Diulang?

Ketika job async gagal, Camunda mengulang **job continuation**, bukan hanya baris Java tertentu.

Misalnya:

```text
asyncBefore Service A
Service A
Service B
User Task C
```

Jika tidak ada boundary antara A dan B, maka job execution mencakup:

```text
run Service A
run Service B
create User Task C
commit
```

Jika Service B gagal, transaction job rollback ke boundary sebelum Service A. Retry akan menjalankan Service A lagi.

Ini penting.

Banyak engineer mengira:

> “Saya pasang asyncBefore di Service A, berarti kalau Service B gagal, cuma Service B yang retry.”

Salah.

Retry scope adalah semua execution sejak save point sampai next save point.

Jika Anda ingin A tidak diulang ketika B gagal:

```text
asyncBefore Service A
Service A
asyncAfter Service A
Service B
```

atau:

```text
asyncBefore Service A
Service A
asyncBefore Service B
Service B
```

Tergantung boundary yang diinginkan.

---

## 11. Default Retry Behavior

Camunda 7 default failed job retry behavior umumnya:

```text
initial execution + retries until RETRIES_ reaches 0
```

Dalam dokumentasi Camunda 7.24, failed job secara default dicoba total tiga kali: eksekusi awal ditambah retry sampai retries habis. Saat gagal, `RETRIES_` dikurangi dan job tidak langsung sekadar dianggap selesai. Jika retries habis, incident dapat dibuat.

Secara operasional:

```text
RETRIES_ = 3
execute -> fail -> RETRIES_ = 2
execute -> fail -> RETRIES_ = 1
execute -> fail -> RETRIES_ = 0 -> incident
```

Jangan bergantung buta pada angka default. Di production-grade system, retry harus didesain per activity berdasarkan karakter failure.

---

## 12. Retry Time Cycle

Camunda mendukung konfigurasi retry cycle, misalnya konsep seperti:

```text
R5/PT5M
```

Artinya secara konseptual:

```text
retry up to 5 times with interval 5 minutes
```

Contoh BPMN extension:

```xml
<serviceTask id="syncWithAgency"
             name="Sync With Agency"
             camunda:asyncBefore="true"
             camunda:delegateExpression="${syncWithAgencyDelegate}">
  <extensionElements>
    <camunda:failedJobRetryTimeCycle>R5/PT10M</camunda:failedJobRetryTimeCycle>
  </extensionElements>
</serviceTask>
```

Makna desain:

- Jangan retry remote dependency terlalu agresif.
- Jangan membuat retry storm saat downstream sedang outage.
- Beri jarak agar dependency punya waktu recover.
- Retry interval adalah bagian dari resilience architecture, bukan kosmetik BPMN.

Contoh buruk:

```text
100.000 process instances
remote API down
retry immediate 3x
= 300.000 failed calls in short time
```

Contoh lebih baik:

```text
retry 5x every 10 minutes
circuit breaker at delegate/client layer
job priority reduction for affected task type
operator alert after retries exhausted
```

---

## 13. Incident: Saat Retry Habis

Ketika job gagal sampai retries habis, Camunda membuat incident.

Incident bukan sekadar error log. Incident adalah operational state:

```text
Process is waiting because a technical problem prevents continuation.
```

Operator bisa:

- membaca error message,
- membaca stack trace/failure detail,
- memperbaiki dependency/config/data,
- menaikkan retries,
- retry job,
- modify/restart/migrate process instance jika perlu,
- escalate ke engineer/business owner.

Mental model:

```text
Incident = durable technical blockage requiring intervention
```

Jangan desain business rejection sebagai incident. Business rejection harus dimodelkan dengan BPMN path, error event, gateway, user task, atau decision result.

Incident cocok untuk:

- database unavailable,
- remote service timeout,
- invalid system config,
- serialization error,
- bug delegate,
- missing class after deployment,
- authentication to external system failed,
- infrastructure outage.

Incident tidak cocok untuk:

- applicant not eligible,
- approval rejected,
- document incomplete,
- payment insufficient,
- case requires clarification.

Itu business outcome, bukan technical failure.

---

## 14. At-Least-Once Reality

Camunda job retry menciptakan realitas:

> Activity code can be executed more than once.

Bahkan jika Anda merasa “harusnya sekali”, realitas distributed system berbeda.

Skenario duplicate execution:

1. Delegate memanggil remote service.
2. Remote service sukses.
3. Network timeout terjadi sebelum response diterima.
4. Delegate throw exception.
5. Job transaction rollback.
6. Camunda retry.
7. Delegate memanggil remote service lagi.
8. Remote service melakukan efek yang sama dua kali.

Atau:

1. Delegate kirim email.
2. Email sukses terkirim.
3. Setelah itu DB commit gagal.
4. Job rollback.
5. Retry mengirim email lagi.

Atau:

1. Job executor node lock job.
2. Delegate lama berjalan.
3. Lock expired karena execution melebihi lock time.
4. Node lain melihat job available.
5. Potensi double processing jika konfigurasi/timeout buruk.

Karena itu top 1% mental model-nya:

> Camunda dapat mengatur durable state mesin proses, tetapi tidak bisa otomatis membuat side effect eksternal menjadi exactly-once.

Exactly-once end-to-end biasanya ilusi. Yang realistis:

- at-least-once execution,
- idempotent operation,
- deduplication,
- transactional outbox,
- reconciliation,
- compensating action.

---

## 15. Idempotency: Definisi yang Benar

Operasi idempotent adalah operasi yang jika dijalankan berkali-kali dengan input/logical key yang sama menghasilkan efek akhir yang sama seperti dijalankan sekali.

Contoh idempotent:

```text
PUT /applications/{id}/risk-score
body: { score: 72, calculatedAt: ..., calculationVersion: ... }
```

Jika dipanggil ulang dengan idempotency key yang sama, server mengembalikan result yang sama atau mengabaikan duplicate.

Contoh tidak idempotent:

```text
POST /payments
body: { amount: 100 }
```

Jika dipanggil ulang, bisa membuat payment baru.

Bisa dibuat idempotent dengan:

```text
POST /payments
Idempotency-Key: processInstanceId:activityId:businessOperationId
body: { amount: 100, ... }
```

Remote service menyimpan key tersebut dan memastikan duplicate tidak menciptakan payment kedua.

---

## 16. Memilih Idempotency Key

Key buruk:

```text
UUID.randomUUID() setiap retry
```

Kenapa buruk? Karena retry menghasilkan key baru. Remote service tidak bisa tahu itu duplicate.

Key lebih baik:

```text
processDefinitionKey + processInstanceId + activityId + businessOperationType
```

Contoh:

```text
enforcement-case:9f32...:sendLegalNotice:notice-v1
```

Namun hati-hati: jika activity bisa dieksekusi legitimate lebih dari sekali dalam process instance, misalnya loop atau multi-instance, tambahkan discriminator:

```text
processInstanceId + activityId + executionId + itemId + operationType
```

Atau untuk business entity:

```text
caseId + noticeType + noticeVersion
```

Rule:

> Idempotency key harus merepresentasikan **logical business operation**, bukan sekadar technical attempt.

### 16.1 Untuk human/regulatory workflow

Contoh key:

```text
caseId + actionCode + decisionVersion
```

```text
applicationId + noticeTemplateCode + recipientId + noticeSequence
```

```text
inspectionId + reportType + generatedVersion
```

Dengan begitu retry tidak menciptakan duplicate notice/report/command.

---

## 17. Idempotency Store

Idempotency butuh tempat menyimpan hasil atau status.

Pilihan:

1. Remote service sendiri menyimpan idempotency key.
2. Camunda delegate menyimpan operation log di aplikasi domain DB.
3. Outbox table menyimpan command yang akan dikirim.
4. Inbox table di penerima menyimpan consumed commands.
5. Redis digunakan untuk short-lived dedup, tetapi jangan jadi satu-satunya source untuk irreversible side effect.

### 17.1 Minimal relational design

```sql
CREATE TABLE integration_operation (
  operation_key        VARCHAR(200) PRIMARY KEY,
  operation_type       VARCHAR(100) NOT NULL,
  business_key         VARCHAR(100) NOT NULL,
  status               VARCHAR(30)  NOT NULL,
  request_hash         VARCHAR(128) NOT NULL,
  response_payload     CLOB,
  error_code           VARCHAR(100),
  created_at           TIMESTAMP NOT NULL,
  updated_at           TIMESTAMP NOT NULL
);
```

Status:

```text
PENDING
IN_PROGRESS
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
```

Delegate flow:

```text
compute operationKey
insert operation row if absent
if existing SUCCEEDED -> return stored result
if existing IN_PROGRESS too old -> recover/reconcile
call remote system
store response
return
```

### 17.2 Request hash guard

Jika same idempotency key digunakan dengan request berbeda, itu bug.

```text
same key + same request hash = duplicate retry
same key + different request hash = conflict, fail fast
```

Ini mencegah kasus proses salah memakai key sama untuk command berbeda.

---

## 18. Transactional Outbox dengan Camunda 7

Outbox pattern sangat penting untuk side effect yang tidak boleh duplicate atau hilang.

Masalah tanpa outbox:

```text
Camunda transaction:
  update process state
  call remote API
  commit
```

Remote API tidak berada dalam transaction database Camunda. Jika commit gagal setelah API sukses, state engine rollback tetapi remote side effect sudah terjadi.

Dengan outbox:

```text
Camunda/domain transaction:
  update process/domain state
  insert outbox command
  commit

separate dispatcher:
  read outbox
  send command with idempotency key
  mark sent/acknowledged
```

Dalam Camunda delegate:

```java
public class CreateNoticeOutboxDelegate implements JavaDelegate {
  private final NoticeOutboxService outboxService;

  @Override
  public void execute(DelegateExecution execution) {
    String caseId = (String) execution.getVariable("caseId");
    String operationKey = caseId + ":NOTICE:INITIAL";

    outboxService.enqueueNoticeCommand(
        operationKey,
        caseId,
        "INITIAL_NOTICE"
    );
  }
}
```

Delegate hanya memasukkan command ke DB lokal dalam transaction yang sama dengan engine/domain jika transaction manager terintegrasi benar. Dispatcher mengirim setelah commit.

### 18.1 Outbox vs async continuation

Async continuation menjawab:

```text
Kapan proses disimpan dan job dieksekusi ulang?
```

Outbox menjawab:

```text
Bagaimana side effect eksternal dikirim secara reliable setelah state lokal commit?
```

Keduanya saling melengkapi.

---

## 19. Remote API Design untuk Camunda Delegate

Jika delegate memanggil API eksternal, API tersebut sebaiknya mendukung:

1. Idempotency key.
2. Business operation id.
3. Safe retry response.
4. Deterministic conflict response.
5. Query/reconciliation endpoint.

Contoh contract:

```http
POST /notices
Idempotency-Key: CASE-123:INITIAL_NOTICE:v1
Content-Type: application/json

{
  "caseId": "CASE-123",
  "noticeType": "INITIAL_NOTICE",
  "recipientId": "U-456",
  "templateVersion": "2026-06"
}
```

Response first success:

```json
{
  "noticeId": "N-999",
  "status": "CREATED",
  "duplicate": false
}
```

Response duplicate retry:

```json
{
  "noticeId": "N-999",
  "status": "CREATED",
  "duplicate": true
}
```

Conflict:

```json
{
  "error": "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"
}
```

Delegate behavior:

- success/duplicate success -> continue,
- retryable 5xx/timeout -> throw exception so Camunda retries,
- business validation failure -> map to BPMN error/path, not technical retry,
- idempotency conflict -> incident or BPMN error depending root cause.

---

## 20. Exception Taxonomy dalam Async Job

Tidak semua exception harus diperlakukan sama.

| Jenis failure | Contoh | Camunda behavior yang cocok |
|---|---|---|
| Retryable technical | timeout, 503, DB deadlock, rate limit | throw exception, job retry |
| Non-retryable technical config | missing API key, invalid endpoint | fail fast, incident, operator fix |
| Business error | applicant ineligible, quota exceeded | BPMN Error / gateway path |
| Data modelling bug | missing required variable due to process bug | incident, fix/migrate data/model |
| Duplicate safe success | idempotent duplicate response | treat as success |
| Ambiguous external outcome | timeout after side effect may have succeeded | reconcile before retrying side effect |

### 20.1 Jangan retry business rejection

Buruk:

```java
if (!eligible) {
  throw new RuntimeException("Applicant not eligible");
}
```

Akibat:

```text
Camunda retries same business rejection
retries exhausted
incident created
operator melihat incident yang bukan technical incident
```

Lebih baik:

```java
if (!eligible) {
  throw new BpmnError("APPLICANT_NOT_ELIGIBLE");
}
```

atau set variable decision result dan route via gateway.

### 20.2 Jangan swallow technical exception secara buta

Buruk:

```java
try {
  client.call();
} catch (Exception e) {
  execution.setVariable("status", "FAILED");
}
```

Akibat:

- process lanjut seolah sukses,
- tidak ada retry,
- tidak ada incident,
- operator tidak tahu dependency gagal,
- audit trail misleading.

Lebih baik:

```java
try {
  client.call();
} catch (RetryableRemoteException e) {
  throw e; // let job retry
} catch (BusinessRemoteException e) {
  throw new BpmnError("REMOTE_BUSINESS_REJECTION");
}
```

---

## 21. BPMN Error vs Job Retry

`BpmnError` bukan technical failure. Ia adalah business event yang dimodelkan.

Jika delegate melempar `BpmnError` dan ada boundary error event yang menangkapnya:

```text
job does not fail technically
process follows error path
transaction can commit
```

Jika tidak tertangkap, behavior bisa menjadi failure tergantung konteks. Namun secara desain, jangan lempar `BpmnError` tanpa model yang jelas.

### 21.1 Decision table

| Kondisi | Gunakan |
|---|---|
| Remote API timeout | throw exception, job retry |
| Remote API returns 400 business rejection | BPMN Error / process path |
| Remote API returns 409 duplicate same idempotency key | treat as success |
| Remote API returns 409 state conflict requiring human decision | BPMN Error to manual review |
| Serialization bug | incident |
| Unknown exception | incident after retry |

---

## 22. Retry Tidak Sama Dengan Circuit Breaker

Camunda retry bekerja pada level job. Ia tidak otomatis tahu kondisi downstream secara global.

Jika 10.000 job memanggil API yang sedang down, semua bisa retry sesuai schedule.

Perlu tambahan:

- HTTP client timeout yang benar,
- connection pool limit,
- circuit breaker,
- rate limiter,
- bulkhead,
- queue/outbox dispatcher control,
- job priority/range strategy,
- operational suspension jika perlu.

### 22.1 Delegate dengan circuit breaker

Konseptual:

```java
public void execute(DelegateExecution execution) {
  if (circuitBreaker.isOpen("notice-service")) {
    throw new RetryableDependencyUnavailableException("notice-service circuit open");
  }

  client.sendNotice(...);
}
```

Tetapi hati-hati: jika circuit open menyebabkan semua job retry terus, Anda tetap perlu retry interval yang tidak agresif.

---

## 23. Job Locking dan Long-Running Delegate

Job executor mengunci job dengan `LOCK_OWNER_` dan `LOCK_EXP_TIME_`.

Jika job berjalan terlalu lama dibanding lock duration, potensi masalah muncul:

```text
Node A acquires job until 10:05
Node A still running at 10:06
Node B sees lock expired
Node B may acquire same job
```

Dalam konfigurasi normal, engine berusaha mengelola ini, tetapi long-running delegate tetap smell.

Rule:

> JavaDelegate async cocok untuk work pendek-menengah yang process engine boleh jalankan. Untuk work lama, blocking, atau external system-heavy, pertimbangkan External Task atau outbox/worker.

Contoh buruk:

```java
public void execute(DelegateExecution execution) {
  // wait up to 20 minutes for remote batch to finish
  batchClient.submitAndPollUntilDone(...);
}
```

Lebih baik:

```text
Service Task: Submit Batch Command
  -> Receive Task / Message Catch: Batch Completed
```

atau:

```text
External Task topic=batch-processing
worker handles long-running interaction with controlled lock extension
```

---

## 24. Exclusive Jobs

Exclusive jobs membantu mencegah concurrent execution dalam process instance yang sama.

Misalnya parallel branches membuat beberapa async jobs. Jika semuanya mengubah execution tree yang sama, optimistic locking bisa terjadi. Dengan exclusive jobs, job executor berusaha menjalankan exclusive jobs dari process instance yang sama secara sequential.

Namun jangan salah paham:

- Exclusive job bukan distributed transaction lock untuk semua hal.
- Exclusive job bukan jaminan business-level serialization eksternal.
- Exclusive job adalah heuristic engine-level untuk mengurangi konflik job dalam process instance.

Gunakan untuk:

- mengurangi optimistic locking pada parallel branches,
- menjaga urutan job dalam process instance,
- default behavior yang aman untuk banyak proses.

Pertimbangkan non-exclusive hanya jika:

- Anda benar-benar butuh parallelism dalam process instance yang sama,
- side effect setiap branch independen,
- Anda memahami optimistic locking dan retry impact,
- Anda sudah load test.

---

## 25. Job Priority

Job priority memungkinkan job executor memilih job yang lebih penting.

Contoh use case:

- regulatory SLA escalation lebih prioritas daripada batch report,
- urgent manual decision routing lebih prioritas daripada email reminder massal,
- production recovery process lebih prioritas daripada cleanup job.

Namun priority bisa menyebabkan starvation.

Jika high-priority job terus datang, low-priority job bisa tertunda lama.

Rule:

> Priority adalah scheduling policy, bukan pengganti kapasitas.

Jika semua job urgent, tidak ada yang urgent. Tambah kapasitas, pisahkan priority range, atau kurangi workload.

---

## 26. Retry Storm

Retry storm terjadi saat banyak job gagal karena penyebab sama lalu retry bersamaan.

Contoh:

```text
10.000 jobs call Document Service
Document Service down 10 minutes
All jobs fail immediately
Retry after 5 minutes
All fail again
Retry after 5 minutes
Service recovers but overloaded by retry wave
```

Mitigasi:

1. Retry interval lebih tersebar.
2. Circuit breaker.
3. Rate limit per dependency.
4. Worker-side queue/outbox.
5. Suspend affected process definitions/jobs jika incident besar.
6. Job priority/range isolation.
7. Bulk retry secara terkontrol setelah dependency recover.

Camunda retry bukan load-shedding system. Anda harus mendesain load-shedding sendiri.

---

## 27. Async Boundary Placement Patterns

### 27.1 After user task pattern

Masalah:

```text
User completes task -> downstream service fails -> user task rollback
```

Pattern:

```text
User Task
  -> asyncBefore Service Task
```

Tujuan:

- user action commit cepat,
- downstream failure jadi incident,
- user tidak melihat task muncul lagi.

### 27.2 Before remote call pattern

```text
asyncBefore Service Task: Call Remote Service
```

Tujuan:

- remote failure retryable,
- stack trace visible as failed job,
- process stops at meaningful activity.

### 27.3 After irreversible operation pattern

```text
Service Task: Generate Official Number
  -> asyncAfter
  -> Service Task: Notify Applicant
```

Tujuan:

- official number generation tidak diulang karena notify failure.

Tetapi official number generation sendiri harus idempotent.

### 27.4 Around non-idempotent step pattern

```text
asyncBefore
Service Task: Issue License
asyncAfter
```

Tujuan:

- isolate before and after.
- still require idempotency because failure inside same transaction can retry issue license.

### 27.5 Before parallel join pattern

```text
parallel branch A -> asyncBefore join
parallel branch B -> asyncBefore join
```

Tujuan:

- optimistic locking retry ditangani job executor,
- user/API threads tidak terkena conflict.

### 27.6 Async start pattern

```text
Start Event asyncBefore
```

Tujuan:

- API returns quickly,
- first process work executed by job executor,
- consistent operational model.

---

## 28. Anti-Patterns

### 28.1 Mark everything async without understanding scope

Kadang direkomendasikan untuk banyak service orchestration, tetapi tidak boleh mekanis.

Risiko:

- terlalu banyak job,
- DB load naik,
- latency end-to-end naik,
- debugging lebih kompleks,
- retry storm lebih mudah terjadi,
- proses menjadi fragmented.

Gunakan policy:

```text
Async for remote/expensive/failure-prone/operationally meaningful boundaries.
Not async for tiny deterministic pure mapping unless needed.
```

### 28.2 Non-idempotent delegate under async retry

Buruk:

```java
emailClient.send(to, subject, body);
```

Tanpa:

- message id,
- idempotency key,
- sent log,
- duplicate guard.

### 28.3 Catch exception and complete anyway

Buruk:

```java
catch (Exception e) {
  log.error("failed", e);
  execution.setVariable("emailStatus", "FAILED");
}
```

Kalau proses butuh email terkirim sebelum lanjut, ini corrupting workflow.

### 28.4 Retry business error

Buruk:

```text
Applicant not eligible -> RuntimeException -> retry 3x -> incident
```

Harus jadi business path.

### 28.5 Huge variable payload in retrying activity

Jika job membawa/mengakses serialized object besar, setiap retry bisa mahal dan rapuh.

Gunakan:

- domain ID,
- document ID,
- external storage reference,
- JSON kecil,
- immutable payload versioning.

### 28.6 Long blocking delegate

Buruk:

```text
delegate waits 30 minutes for external batch
```

Lebih baik:

- external task,
- receive task/message correlation,
- outbox + callback,
- timer polling with backoff.

---

## 29. Designing a Production-Grade Delegate

Delegate yang baik harus eksplisit tentang:

- input variables,
- output variables,
- idempotency key,
- exception taxonomy,
- remote timeout,
- retry behavior,
- logging correlation,
- business error mapping,
- no hidden global state,
- no random key per attempt,
- no non-deterministic mutation unless guarded.

Contoh skeleton:

```java
public final class SendLegalNoticeDelegate implements JavaDelegate {

  private final NoticeClient noticeClient;
  private final NoticeOperationRepository operationRepository;

  public SendLegalNoticeDelegate(
      NoticeClient noticeClient,
      NoticeOperationRepository operationRepository
  ) {
    this.noticeClient = noticeClient;
    this.operationRepository = operationRepository;
  }

  @Override
  public void execute(DelegateExecution execution) {
    String processInstanceId = execution.getProcessInstanceId();
    String activityId = execution.getCurrentActivityId();
    String caseId = requireString(execution, "caseId");
    String recipientId = requireString(execution, "recipientId");
    String noticeType = requireString(execution, "noticeType");

    String operationKey = String.join(":",
        "case", caseId,
        "notice", noticeType,
        "recipient", recipientId,
        "activity", activityId
    );

    NoticeRequest request = new NoticeRequest(caseId, recipientId, noticeType);
    String requestHash = request.stableHash();

    NoticeOperation existing = operationRepository.find(operationKey);

    if (existing != null && existing.isSucceeded()) {
      execution.setVariable("noticeId", existing.noticeId());
      execution.setVariable("noticeDuplicate", true);
      return;
    }

    if (existing != null && !existing.requestHash().equals(requestHash)) {
      throw new IllegalStateException(
          "Idempotency key reused with different request: " + operationKey
      );
    }

    operationRepository.insertIfAbsent(operationKey, requestHash, caseId, noticeType);

    try {
      NoticeResponse response = noticeClient.send(operationKey, request);
      operationRepository.markSucceeded(operationKey, response.noticeId(), response.rawPayload());
      execution.setVariable("noticeId", response.noticeId());
      execution.setVariable("noticeDuplicate", response.duplicate());
    } catch (NoticeBusinessRejectedException e) {
      throw new BpmnError("NOTICE_BUSINESS_REJECTED", e.getMessage());
    } catch (NoticeRetryableException e) {
      throw e;
    }
  }

  private static String requireString(DelegateExecution execution, String name) {
    Object value = execution.getVariable(name);
    if (!(value instanceof String s) || s.isBlank()) {
      throw new IllegalStateException("Missing required variable: " + name);
    }
    return s;
  }
}
```

Catatan Java compatibility:

- Pattern matching `instanceof String s` butuh Java modern.
- Untuk Java 8, tulis manual cast.
- Seri ini membahas Java 8–25, jadi saat implementasi real, sesuaikan source/target compatibility dengan runtime Camunda 7 Anda.

Versi Java 8 style:

```java
private static String requireString(DelegateExecution execution, String name) {
  Object value = execution.getVariable(name);
  if (!(value instanceof String) || ((String) value).trim().isEmpty()) {
    throw new IllegalStateException("Missing required variable: " + name);
  }
  return (String) value;
}
```

---

## 30. Variable Update dan Retry

Hati-hati dengan variable yang di-set sebelum failure.

Contoh:

```java
execution.setVariable("emailAttempted", true);
emailClient.send(...);
throw new RuntimeException("after send failure");
```

Jika masih dalam transaction job yang rollback, variable `emailAttempted` juga rollback. Saat retry, variable tidak ada.

Jangan mengandalkan variable Camunda sebagai durable marker untuk side effect yang terjadi sebelum commit.

Jika perlu marker durable untuk side effect, gunakan:

- outbox table,
- operation table dalam transaction yang tepat,
- remote idempotency key,
- reconciliation endpoint.

### 30.1 Variable after remote success

```java
NoticeResponse response = client.send(...);
execution.setVariable("noticeId", response.noticeId());
```

Jika commit gagal setelah ini:

- remote notice sudah dibuat,
- variable `noticeId` rollback,
- retry harus bisa mendapatkan same `noticeId` dari idempotency store/remote duplicate response.

---

## 31. Retry and Optimistic Locking

Optimistic locking bisa terjadi pada concurrent process paths.

Misalnya parallel branches bertemu di join:

```text
Branch A job arrives at join
Branch B job arrives at join at same time
Both try update same parent execution
One wins
One gets optimistic locking
```

Jika terjadi dalam job executor, retry sering bisa menyelesaikan.

Namun jika terjadi di request/user thread, user bisa melihat exception. Async boundary dapat memindahkan conflict ke job executor supaya retry dilakukan otomatis.

Pattern:

```text
Before parallel join: asyncBefore or asyncAfter on branch activities
```

Tetapi jangan pakai async untuk menutupi model yang terlalu chaotic. Jika terlalu banyak branch mengubah shared variables, pertimbangkan desain ulang aggregation.

---

## 32. Retrying External Side Effects: Reconciliation Pattern

Untuk ambiguous failure, retry langsung bisa berbahaya.

Skenario:

```text
POST /licenses -> timeout
```

Timeout tidak berarti license gagal dibuat. Bisa jadi:

- request tidak sampai,
- request sampai dan sukses,
- response hilang,
- service masih memproses.

Delegate retry langsung `POST /licenses` bisa membuat duplicate jika API tidak idempotent.

Pattern:

```text
1. Send command with operation key.
2. On timeout, before retrying side effect, query by operation key.
3. If found success, treat as success.
4. If not found and safe to retry, retry.
5. If ambiguous, raise incident/manual reconciliation.
```

Remote API ideal:

```http
GET /operations/{operationKey}
```

Response:

```json
{
  "operationKey": "CASE-123:ISSUE_LICENSE:v1",
  "status": "SUCCEEDED",
  "resourceId": "LIC-999"
}
```

---

## 33. Designing Retry Policy per Dependency

Tidak semua dependency sama.

| Dependency | Retry Strategy |
|---|---|
| Internal fast service | short timeout, few retries, circuit breaker |
| Government/external API | longer interval, fewer attempts, manual incident after final failure |
| Email service | idempotent message key, retry with backoff, do not block core decision forever unless legally required |
| Document generation | retry compute if deterministic; cache output by document version |
| Payment/license issuance | strong idempotency, reconciliation, manual fallback |
| Search indexing | outbox eventual consistency, process may continue depending requirement |

Design retries based on:

- business criticality,
- side effect reversibility,
- expected outage duration,
- rate limits,
- human tolerance,
- SLA,
- legal/audit requirements.

---

## 34. Operational SQL Mental Model

Do not manually mutate Camunda runtime tables unless under official support/procedure. But you should understand what to inspect.

Typical job diagnostics:

```sql
SELECT ID_, TYPE_, PROCESS_INSTANCE_ID_, EXECUTION_ID_,
       RETRIES_, DUEDATE_, LOCK_OWNER_, LOCK_EXP_TIME_, EXCEPTION_MSG_
FROM ACT_RU_JOB
WHERE PROCESS_INSTANCE_ID_ = ?
ORDER BY DUEDATE_;
```

Failed jobs:

```sql
SELECT ID_, PROCESS_INSTANCE_ID_, EXECUTION_ID_, RETRIES_, EXCEPTION_MSG_
FROM ACT_RU_JOB
WHERE RETRIES_ = 0;
```

Incidents:

```sql
SELECT ID_, INCIDENT_TYPE_, INCIDENT_MSG_, PROCESS_INSTANCE_ID_, EXECUTION_ID_, CONFIGURATION_
FROM ACT_RU_INCIDENT
WHERE PROCESS_INSTANCE_ID_ = ?;
```

Execution around failed job:

```sql
SELECT ID_, PROC_INST_ID_, ACT_ID_, IS_ACTIVE_, IS_CONCURRENT_, IS_SCOPE_
FROM ACT_RU_EXECUTION
WHERE PROC_INST_ID_ = ?;
```

Use ManagementService where possible:

```java
List<Job> failedJobs = managementService
    .createJobQuery()
    .noRetriesLeft()
    .list();
```

Manual DB inspection is for diagnosis. Operational mutation should use Camunda API/Cockpit unless you have a very controlled recovery procedure.

---

## 35. ManagementService Operations

`ManagementService` lets you:

- query jobs,
- execute jobs manually in tests/admin tooling,
- set retries,
- get exception stack trace,
- manage job definitions,
- control suspended jobs depending scenario.

Example test style:

```java
Job job = managementService
    .createJobQuery()
    .processInstanceId(processInstance.getId())
    .singleResult();

managementService.executeJob(job.getId());
```

Example retry reset:

```java
managementService.setJobRetries(jobId, 3);
```

Caution:

- Resetting retries without fixing root cause creates repeated failure.
- Bulk retry after outage can overload dependency.
- Always pair retry operation with incident analysis.

---

## 36. Testing Async Jobs

Async jobs make tests non-linear. Do not write tests assuming job executor background timing unless integration test explicitly needs it.

Better unit/integration pattern:

```text
start process
assert job exists
execute job manually
assert process moved
```

Pseudo-test:

```java
ProcessInstance pi = runtimeService.startProcessInstanceByKey("caseProcess", variables);

Job job = managementService.createJobQuery()
    .processInstanceId(pi.getId())
    .activityId("sendNotice")
    .singleResult();

managementService.executeJob(job.getId());

assertThat(taskService.createTaskQuery()
    .processInstanceId(pi.getId())
    .taskDefinitionKey("supervisorReview")
    .singleResult()).isNotNull();
```

Failure test:

```java
try {
  managementService.executeJob(job.getId());
  fail("expected failure");
} catch (Exception expected) {
  // assert failed job retries decreased
}
```

Then:

```java
Job failed = managementService.createJobQuery()
    .jobId(job.getId())
    .singleResult();

assertThat(failed.getRetries()).isEqualTo(2);
```

### 36.1 Test idempotency

Test duplicate execution explicitly:

```text
execute delegate once, simulate failure after side effect
execute again
assert remote side effect called once logically
assert same operation key used
assert duplicate response treated as success
```

Top-tier Camunda testing includes retry semantics, not only happy path process completion.

---

## 37. Regulatory Workflow Example

Scenario:

```text
Officer completes review
System generates official notice
System sends notice
Applicant may respond within 14 days
If no response, escalate
```

Naive model:

```text
User Task Review
  -> Service Task Generate Notice
  -> Service Task Send Notice
  -> Timer 14 days
```

Problems:

- review completion can rollback if generate/send fails,
- notice can be generated/sent twice,
- technical failure may become user-facing issue,
- no idempotency boundary,
- no operator recovery point.

Better model:

```text
User Task Review
  -> asyncBefore Service Task Create Notice Command
  -> asyncBefore Service Task Dispatch Notice
  -> Intermediate Timer Catch 14 days
  -> Escalation path
```

Even better with outbox:

```text
User Task Review
  -> asyncBefore Service Task Enqueue Notice Outbox
  -> Receive Task / Message Catch Notice Dispatched
  -> Timer 14 days
```

Outbox dispatcher:

```text
reads notice_outbox
sends notice with idempotency key
receives provider ack
correlates message NoticeDispatched
```

This design separates:

- process state durability,
- side effect dispatch reliability,
- external provider acknowledgement,
- SLA timer start.

If legal SLA starts only after actual dispatch, timer must start after dispatch confirmation, not after enqueue.

---

## 38. When Not to Use Async Continuation

Async is not always better.

Avoid async if:

- activity is pure in-memory mapping and deterministic,
- immediate validation must block user completion,
- caller must know result synchronously,
- you cannot tolerate eventual execution,
- adding job creates unnecessary DB load,
- process model becomes harder to reason about,
- failure should remain directly visible to caller.

Example valid synchronous validation:

```text
User completes form
Service Task Validate Required Domain Data
if invalid -> throw validation exception and keep task open
```

This is intentional rollback. Do not async it if business wants user to fix form immediately.

---

## 39. Async vs External Task

Async JavaDelegate:

```text
engine job executor runs Java code inside engine application
```

External Task:

```text
engine creates external task wait state
external worker fetches and locks task
worker completes/fails task via API
```

Use async JavaDelegate when:

- code is part of same application/runtime,
- work is short/controlled,
- transaction integration with app DB is needed,
- operational coupling is acceptable.

Use external task when:

- worker is separate service/language/runtime,
- work may be slow/blocking,
- independent scaling needed,
- network-heavy integration,
- you want pull-based backpressure,
- you want worker deployment independent from engine.

But external task also has at-least-once characteristics. It still needs idempotency.

---

## 40. Async vs Message Wait State

Use async continuation when:

```text
engine should continue execution later by itself
```

Use message wait state when:

```text
engine must wait for an external event to say something happened
```

Example:

```text
Submit Payment Command
  -> Message Catch PaymentConfirmed
```

Do not model long polling inside delegate if the real business semantics is “wait for external confirmation”.

---

## 41. Checklist: Async Boundary Design Review

For every async activity, review:

```text
[ ] Why is this boundary needed?
[ ] What transaction is committed before this boundary?
[ ] What execution scope will be retried if this job fails?
[ ] Are all side effects inside retry scope idempotent?
[ ] Is retry interval appropriate for dependency?
[ ] What happens when retries are exhausted?
[ ] Is failure technical or business?
[ ] Is BPMN Error modelled if business failure is possible?
[ ] Is there a correlation id / operation key?
[ ] Are variables small and version-tolerant?
[ ] Can operator understand the failed activity name?
[ ] Is job priority needed?
[ ] Can retry storm happen?
[ ] Do we need circuit breaker/rate limit?
[ ] Is external task/message/outbox more appropriate?
```

---

## 42. Top 1% Heuristics

### 42.1 Model process failure as first-class state

Do not treat failure as only exception handling. Ask:

```text
Where does the process stop?
Who sees it?
Can it be retried?
Can it be skipped?
Can it be compensated?
What evidence remains?
```

### 42.2 Async boundary is an operational contract

Every async boundary says:

```text
From here, operations can observe, retry, suspend, prioritize, and recover this unit.
```

If the activity name is vague like `Process Data`, operator recovery becomes hard. Use meaningful activity names:

```text
Bad: Service Task: Process Data
Good: Service Task: Send Initial Enforcement Notice
```

### 42.3 Idempotency belongs to business operation

Do not base idempotency only on technical execution id if business operation survives migration/restart/retry differently.

Prefer:

```text
caseId + operationType + operationVersion + targetEntity
```

### 42.4 Retry policy is domain policy

Retry interval should reflect real dependency behavior.

- Rate-limited API? Longer retry.
- Local temporary DB deadlock? Shorter retry.
- Legal notice dispatch? Strong idempotency and manual recovery.
- Search indexing? Eventual retry/outbox.

### 42.5 Do not confuse rollback with undo

Rollback only rolls back DB transaction. It does not undo:

- email sent,
- HTTP call processed,
- payment created,
- file uploaded,
- message published outside transaction,
- external license issued.

---

## 43. Common Interview/Architecture Questions

### Q1. Why did completed user task appear again?

Because completing the task and executing subsequent synchronous work were in the same transaction. A downstream exception rolled back the transaction to the previous wait state, where the user task still existed.

Fix options:

- add async boundary after user task/before downstream service,
- handle validation intentionally before completion,
- separate business validation from technical side effects.

### Q2. Why did email send twice even though Camunda retried correctly?

Because email sending is external side effect outside Camunda DB transaction. If email succeeded but job transaction failed, retry re-executed delegate. Need idempotent message key, sent log, outbox, or provider-level deduplication.

### Q3. Does `asyncBefore` guarantee only that task retries?

No. It creates a save point before the activity. The retry scope includes all execution after that boundary until the next wait state/async boundary. If downstream activity fails and no new boundary exists, earlier activities in the same job transaction can be repeated.

### Q4. Should every service task be async?

Not blindly. It is often useful for service orchestration, but each async boundary adds jobs, DB load, latency, and operational complexity. Use async where transaction split and retry/recovery semantics are valuable.

### Q5. Is Camunda job retry exactly-once?

No. It is safer to treat it as at-least-once. Design side effects idempotently.

### Q6. What is the difference between technical failure and business error?

Technical failure prevents the engine/system from performing intended work and often deserves retry/incident. Business error is a valid business outcome and should be represented in the process model.

---

## 44. Mini Design Lab

### Problem

You have process:

```text
Start
  -> User Task: Review Case
  -> Service Task: Generate PDF
  -> Service Task: Send Email
  -> Service Task: Update Search Index
  -> End
```

Failures:

- PDF generation can take 20 seconds and may fail.
- Email provider sometimes times out.
- Search index can be eventually consistent.
- User review completion must not rollback after officer clicks Complete.
- Email must not be duplicated.

### Better design

```text
Start
  -> User Task: Review Case
  -> asyncBefore Service Task: Generate Official PDF
  -> asyncBefore Service Task: Enqueue Email Outbox
  -> Service Task: Enqueue Search Index Outbox
  -> End
```

Email outbox dispatcher:

```text
send email with message key = caseId + noticeType + recipientId + pdfVersion
provider duplicate response treated as success
```

Search index:

```text
outbox eventual consistency
failure does not block process completion unless business requires it
```

If legal process requires proof of email dispatch before completion:

```text
Enqueue Email Outbox
  -> Message Catch: EmailDispatched
  -> End
```

Timer/escalation can be added if dispatch ack never arrives.

---

## 45. Summary

Async continuation in Camunda 7 is one of the most important engineering tools in the platform.

It is not merely a performance feature. It is a way to design:

- transaction boundaries,
- retry boundaries,
- user experience boundaries,
- operational recovery points,
- failure visibility,
- workload scheduling,
- side-effect isolation.

The core laws:

1. `asyncBefore` creates a save point before activity execution.
2. `asyncAfter` creates a save point after activity execution.
3. Async continuation creates a job.
4. Job execution is handled by Job Executor.
5. Failed job is retried according to retry configuration.
6. Retry means code may run more than once.
7. External side effects are not rolled back by Camunda transaction rollback.
8. Idempotency is mandatory for retry-safe production systems.
9. Business errors should be modelled as process paths, not technical incidents.
10. Async boundary placement is architectural design, not annotation decoration.

---

## 46. What You Should Be Able to Do Now

After this part, you should be able to:

- Explain why a user task can reappear after completion.
- Explain what job creation and job execution mean.
- Decide between `asyncBefore` and `asyncAfter`.
- Predict what will be retried after a failed job.
- Design idempotency key for a business operation.
- Distinguish retryable technical failure from business error.
- Avoid duplicate side effects.
- Choose between async delegate, external task, message wait state, and outbox.
- Review BPMN models for retry safety.
- Diagnose failed jobs and incidents using a clear mental model.

---

## 47. Referensi Utama

- Camunda 7.24 Documentation — Transactions in Processes  
  `https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/`

- Camunda 7.24 Documentation — The Job Executor  
  `https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/`

- Camunda 7.24 Documentation — Error Handling  
  `https://docs.camunda.org/manual/7.24/user-guide/process-engine/error-handling/`

- Camunda 8 Best Practices — Understanding Camunda 7 transaction handling  
  `https://docs.camunda.io/docs/8.7/components/best-practices/development/understanding-transaction-handling-c7/`

---

## 48. Status Seri

Part ini selesai.

Seri belum selesai. Lanjut ke:

`learn-java-camunda-7-bpm-platform-engineering-part-005.md`

Topik berikutnya:

**Job Executor Internals: Acquisition, Locking, Backoff, Deployment Awareness, dan Cluster Behavior**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-003.md">⬅️ Transaction Boundaries, Wait States, Atomic Operations, dan Consistency Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-005.md">Part 005 — Job Executor Internals: Acquisition, Locking, Backoff, Deployment Awareness, dan Cluster Behavior ➡️</a>
</div>

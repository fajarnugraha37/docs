# learn-java-camunda-7-bpm-platform-engineering-part-003

# Transaction Boundaries, Wait States, Atomic Operations, dan Consistency Model

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Part: `003`  
> Target: Java engineer yang ingin memahami Camunda 7 bukan hanya sebagai BPMN runtime, tetapi sebagai durable execution engine dengan transaction semantics yang eksplisit.  
> Prasyarat: sudah memahami part-000 sampai part-002, terutama konsep process engine pasif, service API, command context, execution tree, activity instance, dan job executor.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun dua fondasi besar:

1. **Camunda 7 adalah process engine pasif yang dipanggil oleh thread caller.**
   Engine tidak selalu “berjalan sendiri”. Ia masuk lewat API call, message correlation, task completion, job executor, atau trigger lain, lalu mengeksekusi proses sampai mencapai titik stabil.

2. **State runtime Camunda bukan satu pointer linear.**
   Satu process instance dapat memiliki execution tree, activity instance tree, transition instance, child execution, event subscription, task, job, variable scope, dan scope boundary.

Part ini masuk ke fondasi berikutnya: **transaction boundary**.

Kalau execution tree menjawab:

> “Di mana proses sedang berada?”

Maka transaction boundary menjawab:

> “Kapan state proses benar-benar disimpan, kapan rollback terjadi, dan apa yang aman dianggap sudah terjadi?”

Ini adalah salah satu topik paling penting dalam Camunda 7. Banyak bug produksi bukan karena BPMN salah secara visual, tetapi karena engineer salah memahami **unit of work**.

Contoh bug klasik:

- User klik “Approve”, lalu service task gagal, ternyata task approval muncul lagi.
- Email terkirim, tetapi process instance rollback sehingga sistem berpikir email belum pernah dikirim.
- API eksternal terpanggil dua kali karena failed job retry.
- Message correlation berhasil di remote system, tetapi Camunda rollback sehingga subscription masih ada.
- Process start gagal, ternyata process instance sama sekali tidak tersimpan.
- Tim menaruh `asyncBefore` di semua activity tanpa memahami efek database/job/incident.
- Tim mengira BPMN transaction subprocess sama dengan database transaction.

Part ini akan membangun mental model untuk menghindari kesalahan tersebut.

Referensi resmi utama:

- Camunda 7.24 — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda 7.24 — Job Executor: https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/
- Camunda 7.24 — Error Handling: https://docs.camunda.org/manual/7.24/user-guide/process-engine/error-handling/

---

## 1. Core Mental Model

Camunda 7 tidak menyimpan state setelah setiap elemen BPMN.

Camunda 7 menjalankan proses dari satu titik stabil ke titik stabil berikutnya dalam satu unit kerja database.

Titik stabil itu disebut **wait state**.

Secara mental:

```text
external trigger
   |
   v
enter engine command
   |
   v
execute BPMN steps synchronously
   |
   v
advance until wait state / end / async boundary / exception
   |
   v
flush runtime changes
   |
   v
commit transaction
   |
   v
return to caller
```

Jika terjadi exception sebelum commit:

```text
external trigger
   |
   v
execute BPMN steps
   |
   v
exception
   |
   v
rollback database transaction
   |
   v
process state returns to last committed wait state
```

Ini berarti Camunda 7 memiliki model seperti:

```text
committed state N
   -- command execution -->
committed state N+1
```

Di antara `N` dan `N+1`, banyak hal bisa terjadi di memory:

- delegate dipanggil,
- listener dipanggil,
- variable diubah,
- task dibuat,
- job dibuat,
- execution tree dimodifikasi,
- event subscription dibuat/dihapus,
- history event disiapkan,
- database entity masuk cache command context.

Tetapi sampai transaction commit berhasil, state itu belum final.

---

## 2. Engine Pasif dan Borrowed Thread

Camunda 7 documentation menjelaskan bahwa process engine adalah passive Java code yang bekerja di thread client. Misalnya user menekan tombol di web application, lalu HTTP thread memanggil:

```java
runtimeService.startProcessInstanceByKey("caseApproval", variables);
```

Thread itu masuk ke engine, menjalankan proses, lalu keluar saat engine mencapai wait state atau process instance selesai.

Mental model penting:

```text
HTTP request thread
   -> application service
      -> runtimeService.startProcessInstanceByKey(...)
         -> Camunda command executor
            -> BPMN execution
               -> delegate/listener/task/job/subscription creation
         <- returns
   <- HTTP response
```

Camunda tidak otomatis membuat thread baru untuk setiap service task. Kecuali ada async boundary atau job executor involved, activity akan dijalankan dalam thread pemanggil.

### 2.1 Konsekuensi untuk Latency

Jika proses seperti ini:

```text
Start
  -> Service Task: validate request
  -> Service Task: call tax API
  -> Service Task: call license API
  -> User Task: Review
```

Dan tidak ada async boundary, maka saat `startProcessInstanceByKey()` dipanggil:

```text
caller thread akan menjalankan:
- validate request
- call tax API
- call license API
- create Review user task
- commit
- return
```

Akibatnya response API bisa lambat karena caller thread menunggu semua service task selesai.

### 2.2 Konsekuensi untuk Rollback

Jika `call license API` melempar exception sebelum user task tercipta dan commit:

```text
Start
  -> validate request       done in memory
  -> call tax API           remote side-effect mungkin sudah terjadi
  -> call license API       throws exception
  -> transaction rollback
```

Process instance bisa tidak tersimpan sama sekali, tergantung titik trigger dan save point terakhir.

Inilah awal dari masalah besar: **database transaction hanya bisa rollback database lokal, bukan side-effect eksternal**.

---

## 3. Wait State

Wait state adalah titik ketika engine berhenti mengeksekusi proses, menyimpan state ke database, dan menunggu trigger berikutnya.

Wait state bukan sekadar “activity yang lama”. Wait state adalah **durability boundary**.

Contoh wait state umum:

- User Task
- Receive Task
- Message Catch Event
- Timer Event
- Signal Catch Event
- Event-Based Gateway
- External Task
- Async continuation boundary

Secara sederhana:

```text
Non-wait activity:
  engine executes immediately in current transaction

Wait state:
  engine persists state and returns control
```

### 3.1 User Task sebagai Wait State

Model:

```text
Start
  -> Service Task: Prepare Case
  -> User Task: Review Case
  -> Service Task: Submit Decision
  -> End
```

Saat process started:

```text
runtimeService.startProcessInstanceByKey("case")
```

Engine menjalankan:

```text
Start
  -> Prepare Case
  -> create Review Case task
  -> persist process state
  -> commit
  -> return
```

Setelah commit, process instance durable di database. User task ada di `ACT_RU_TASK`. Execution menunggu user menyelesaikan task.

Saat user menyelesaikan task:

```java
taskService.complete(taskId, variables);
```

Engine melanjutkan:

```text
complete user task
  -> Submit Decision
  -> End
  -> delete runtime state
  -> write history according to history level
  -> commit
  -> return
```

Kalau `Submit Decision` gagal dan tidak ada async boundary:

```text
complete user task
  -> Submit Decision throws exception
  -> rollback
```

Hasilnya:

```text
Review Case task masih ada
process masih di last wait state
user task completion tidak committed
```

Ini sering mengejutkan tim bisnis: user sudah klik Complete, tetapi task muncul lagi. Dari perspektif Camunda, itu benar karena completion dan service task setelahnya berada dalam satu transaction boundary.

### 3.2 Timer sebagai Wait State

Model:

```text
Start
  -> User Task: Review
  -> Intermediate Timer: wait PT2H
  -> Service Task: Escalate
```

Timer event menciptakan job. Process berhenti, state tersimpan, dan job executor nanti mengambil job ketika due.

```text
complete Review
  -> create timer job
  -> commit
  -> return

later:
job executor acquires timer job
  -> executes continuation
  -> Escalate
  -> next wait state/end
  -> commit
```

Timer bukan dipicu oleh user/client thread, tetapi oleh active component yaitu job executor.

### 3.3 External Task sebagai Wait State

External task adalah wait state yang sengaja memisahkan engine dari worker.

```text
Start
  -> External Task: Generate Report
  -> User Task: Review Report
```

Engine tidak memanggil JavaDelegate. Engine membuat external task, menyimpan state, lalu worker mengambil pekerjaan dengan fetch-and-lock.

```text
engine transaction:
  create external task
  commit

worker transaction:
  fetch and lock external task
  do work outside engine
  complete external task
  engine continues
```

External task adalah salah satu pattern terbaik ketika:

- pekerjaan berat,
- pekerjaan remote,
- butuh independent scaling,
- butuh worker language lain,
- butuh backpressure,
- ingin menghindari long blocking transaction di engine.

---

## 4. Transaction Boundary

Transaction boundary adalah batas unit kerja database.

Dalam Camunda 7:

```text
state transition from one stable state to next stable state = one transaction
```

Contoh:

```text
User Task A
  -> Service Task B
  -> Service Task C
  -> Timer D
```

Jika current state adalah `User Task A`, maka saat user complete task:

```text
complete A + execute B + execute C + create timer D = one transaction
```

Jika B atau C gagal, semuanya rollback ke `User Task A`.

### 4.1 Save Point

Wait state adalah save point.

```text
[Wait State A] --transaction--> [Wait State B] --transaction--> [Wait State C]
```

Jika failure terjadi di tengah transition dari A ke B:

```text
rollback to A
```

Jika failure terjadi di tengah transition dari B ke C:

```text
rollback to B
```

Jadi process state tidak rollback ke awal proses, tetapi ke last committed wait state.

### 4.2 Not Every Activity Is a Save Point

Ini sangat penting.

```text
User Task A
  -> Service Task B
  -> Service Task C
  -> User Task D
```

Tanpa async:

- A adalah wait state.
- D adalah wait state.
- B dan C bukan wait state.

Saat A complete:

```text
A completion + B + C + D creation = satu transaction
```

Kalau C gagal:

```text
A belum benar-benar complete secara committed
B variable changes rollback
D belum dibuat
state kembali ke A
```

### 4.3 BPMN Visual Tidak Sama dengan Transaction Visual

BPMN diagram:

```text
A -> B -> C -> D -> E
```

Transaction view bisa seperti:

```text
Transaction 1:
  Start -> A(wait)

Transaction 2:
  Complete A -> B -> C -> D(wait)

Transaction 3:
  Complete D -> E -> End
```

Jika ditambah async boundary:

```text
A -> B(asyncBefore) -> C -> D
```

Transaction view berubah:

```text
Transaction 1:
  Start -> A(wait)

Transaction 2:
  Complete A -> create job for B -> commit

Transaction 3:
  JobExecutor executes B -> C -> D(wait) -> commit
```

Top 1% engineer selalu membaca BPMN dalam dua layer:

1. **Business flow layer** — apa yang terjadi secara domain.
2. **Transaction layer** — apa yang committed, rollbackable, retriable, async, and recoverable.

---

## 5. Atomic Operation Chain

Camunda internal execution tidak hanya “pindah activity”. Ia menjalankan rangkaian operation internal yang sering disebut atomic operations.

Kita tidak perlu menghafal semua internal class untuk menggunakan Camunda dengan benar, tetapi mental model-nya penting.

Activity execution kira-kira melewati tahap seperti:

```text
take incoming sequence flow
  -> invoke TAKE listeners
  -> enter activity
  -> invoke START listeners
  -> execute activity behavior
  -> invoke END listeners
  -> leave activity
  -> take outgoing sequence flow
```

Camunda documentation menjelaskan posisi async continuation terhadap lifecycle activity:

- `asyncBefore` memotong flow sebelum activity behavior dimulai.
- `asyncAfter` memotong flow setelah activity selesai tetapi sebelum outgoing sequence flow dilanjutkan.

Secara mental:

```text
incoming TAKE listeners
  -> [asyncBefore boundary]
  -> activity START listeners
  -> activity behavior
  -> activity END listeners
  -> [asyncAfter boundary]
  -> outgoing TAKE listeners
```

### 5.1 Kenapa Ini Penting?

Karena `asyncBefore` dan `asyncAfter` bukan hanya “background thread”. Mereka menentukan **bagian mana dari lifecycle activity yang masuk transaction sebelum atau sesudah job**.

Contoh:

```text
A -> Service Task B -> C
```

Jika `B` memakai `asyncBefore`:

```text
Transaction before job:
  leave A
  take sequence flow into B
  create job before B
  commit

Job transaction:
  start B
  execute B behavior
  end B
  continue to C
```

Jika `B` memakai `asyncAfter`:

```text
Transaction before job:
  leave A
  start B
  execute B behavior
  end B
  create job after B
  commit

Job transaction:
  take outgoing flow from B
  continue to C
```

Perbedaan ini sangat besar ketika B punya side-effect.

---

## 6. Synchronous Continuation

Default Camunda 7 adalah synchronous continuation.

Artinya setelah trigger eksternal masuk, engine akan terus mengeksekusi proses dalam thread dan transaction yang sama sampai mencapai wait state berikutnya.

### 6.1 Example: Start Process Synchronously

BPMN:

```text
Start
  -> Service Task: Validate
  -> Service Task: Create Internal Record
  -> User Task: Review
```

Java:

```java
Map<String, Object> variables = Map.of(
    "caseId", "CASE-2026-0001",
    "applicantId", "APP-001"
);

ProcessInstance pi = runtimeService.startProcessInstanceByKey(
    "caseIntake",
    "CASE-2026-0001",
    variables
);
```

What happens:

```text
HTTP/App Thread
  -> start process
  -> execute Validate
  -> execute Create Internal Record
  -> create Review user task
  -> commit
  -> return ProcessInstance
```

If `Create Internal Record` throws:

```text
process instance may not exist in DB
variables rollback
task not created
exception returns to caller
```

### 6.2 When Synchronous Is Good

Synchronous continuation cocok untuk:

- lightweight computation,
- local deterministic validation,
- pure variable transformation,
- short database read/write dalam transaction yang sama,
- business decision kecil,
- BPMN movement yang memang harus atomic dengan caller command.

Contoh baik:

```text
User Task Submit Form
  -> Service Task Validate Required Fields
  -> Exclusive Gateway Valid?
     -> invalid: User Task Fix Form
     -> valid: User Task Officer Review
```

Jika validation gagal secara technical, wajar task submit tetap belum committed.

### 6.3 When Synchronous Is Dangerous

Synchronous continuation berbahaya untuk:

- remote HTTP call,
- sending email,
- payment,
- pushing data to another system,
- generating large PDF,
- long-running computation,
- unreliable dependency,
- operation with non-transactional side-effect,
- anything that may take seconds/minutes.

Example smell:

```text
User Task Approve
  -> Service Task Call Remote API
  -> Service Task Send Email
  -> End
```

Jika email terkirim lalu transaction rollback karena later exception, engine tidak bisa “unsend email”.

---

## 7. Asynchronous Continuation

Asynchronous continuation adalah cara Camunda 7 menambah transaction boundary secara eksplisit.

Ada dua atribut utama:

```xml
camunda:asyncBefore="true"
camunda:asyncAfter="true"
```

Selain itu start event/process instantiation juga dapat dibuat async sebelum execution dimulai.

### 7.1 asyncBefore

`asyncBefore` berarti engine berhenti sebelum menjalankan activity, membuat job, commit, lalu job executor melanjutkan activity di transaction berikutnya.

```xml
<serviceTask id="generateInvoice"
             name="Generate Invoice"
             camunda:class="com.acme.GenerateInvoiceDelegate"
             camunda:asyncBefore="true" />
```

Transaction view:

```text
Before activity:
  arrive at generateInvoice
  create async continuation job
  commit

Later:
  job executor locks job
  execute GenerateInvoiceDelegate
  continue until next wait state
  commit or fail job
```

Use when:

- previous user action must be committed before work starts,
- work can fail independently,
- you want retry/incident semantics,
- the work is expensive or remote,
- you want job executor controlled throughput,
- current caller should not wait.

### 7.2 asyncAfter

`asyncAfter` berarti activity dijalankan dulu dalam current transaction, lalu engine membuat job setelah activity selesai.

```xml
<serviceTask id="calculateRisk"
             name="Calculate Risk"
             camunda:class="com.acme.CalculateRiskDelegate"
             camunda:asyncAfter="true" />
```

Transaction view:

```text
Current command:
  execute calculateRisk
  create async job after activity
  commit

Later job:
  continue outgoing flow
```

Use when:

- activity result should be committed before downstream flow,
- you want decouple post-activity routing,
- activity is safe inside current transaction but downstream is not,
- you want create checkpoint after a complex local calculation.

### 7.3 asyncBefore + asyncAfter

You can use both, but only with strong reason.

```xml
<serviceTask id="sendNotification"
             camunda:asyncBefore="true"
             camunda:asyncAfter="true"
             camunda:class="com.acme.SendNotificationDelegate" />
```

Transaction view:

```text
T1: create job before activity
T2: execute activity, create job after activity
T3: continue outgoing flow
```

This gives strong isolation but creates more jobs, more DB writes, more latency, and more operational surface.

Use carefully.

---

## 8. Async Is Not “Threading Optimization”

A common beginner mistake:

> “The process is slow. Add async everywhere.”

This is usually wrong.

Async continuation is not primarily a performance feature. It is primarily a **transaction boundary and retry boundary feature**.

Adding async everywhere causes:

- more rows in `ACT_RU_JOB`,
- more job acquisition load,
- more DB round trips,
- more optimistic locking opportunities,
- more incident objects,
- more operational complexity,
- harder tracing,
- more delay due to job executor backoff,
- possible job starvation if priority is misused.

Async is useful when the boundary means something.

Good reason:

```text
Commit user approval before attempting remote side effect.
```

Weak reason:

```text
Make every service task async because async sounds scalable.
```

---

## 9. Rollback Semantics

Camunda default behavior: unhandled exception rolls back current transaction.

### 9.1 Start Process Failure

BPMN:

```text
Start
  -> Service Task A
  -> User Task B
```

If `Service Task A` throws during `startProcessInstanceByKey()`:

```text
no wait state reached
transaction rolled back
process instance not persisted
```

Caller sees exception.

This means:

```java
try {
    runtimeService.startProcessInstanceByKey("caseProcess", businessKey, variables);
} catch (Exception ex) {
    // process may not exist
}
```

You cannot assume process instance exists unless commit completed.

### 9.2 Complete Task Failure

BPMN:

```text
User Task A
  -> Service Task B
  -> User Task C
```

If B throws during `taskService.complete(A)`:

```text
A remains active
C not created
variables passed to complete() rollback
```

Caller sees exception.

### 9.3 Job Execution Failure

If activity is async:

```text
User Task A
  -> Service Task B asyncBefore
  -> User Task C
```

When A is completed:

```text
A completion committed
job for B committed
caller returns success
```

If B throws in job executor:

```text
job retries decrease
process remains at async boundary
incident may be created when retries exhausted
A does not reappear
```

This is often what you want for side-effect boundary.

---

## 10. Error Propagation Models

Camunda has several ways failure can appear:

1. Java exception thrown synchronously to caller.
2. Failed job with retry count decreased.
3. Incident after retries exhausted.
4. BPMN Error caught by boundary event or error event subprocess.
5. Business result modelled as variable and routed by gateway.
6. Compensation event triggered by explicit BPMN semantics.

This part focuses on transaction semantics, but we need a failure taxonomy early.

### 10.1 Technical Exception

Example:

```java
public class SubmitDecisionDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        throw new RuntimeException("Remote service unavailable");
    }
}
```

If synchronous:

```text
rollback current transaction
exception to caller
```

If async:

```text
job failure
retry/incident semantics
```

### 10.2 BPMN Error

BPMN Error is a business error, not technical failure.

Example:

```java
throw new BpmnError("CASE_NOT_ELIGIBLE", "Case is not eligible");
```

If caught by boundary error event:

```text
normal BPMN path continues through error branch
transaction may still commit
```

If not caught:

```text
treated like exception depending context
```

Use BPMN Error for expected domain outcome:

- application invalid,
- eligibility failed,
- duplicate submission,
- insufficient document,
- business rule rejection.

Do not use BPMN Error for:

- database down,
- HTTP timeout,
- NullPointerException,
- serialization failure,
- infrastructure failure.

### 10.3 Data-Based Gateway Error Handling

Instead of exception:

```text
Service Task: Check Eligibility
  sets variable eligibilityStatus = "FAILED"
Exclusive Gateway:
  FAILED -> User Task: Request Correction
  PASSED -> Continue
```

This is appropriate when failure is a normal business result.

### 10.4 Incident

Incident means execution cannot proceed automatically and needs operational attention.

Usually caused by failed job retries exhausted.

Incident is good for:

- remote system down,
- repeated technical failure,
- non-idempotent uncertainty,
- unexpected runtime bug.

Incident is bad for:

- normal application rejection,
- user typo,
- missing optional document,
- expected decision branch.

---

## 11. Transaction Integration

Camunda can run with different transaction management modes:

- standalone transaction management,
- Spring transaction manager,
- JTA/container transaction integration.

The exact behavior depends on runtime topology, but core principle remains:

```text
engine command participates in a database transaction
commit finalizes process state
rollback returns to previous committed wait state
```

### 11.1 Embedded Spring Boot Example

Typical service:

```java
@Service
public class CaseApplicationService {

    private final RuntimeService runtimeService;
    private final CaseRepository caseRepository;

    public CaseApplicationService(RuntimeService runtimeService,
                                  CaseRepository caseRepository) {
        this.runtimeService = runtimeService;
        this.caseRepository = caseRepository;
    }

    @Transactional
    public void submitCase(SubmitCaseCommand command) {
        CaseEntity entity = new CaseEntity(command.caseId(), command.applicantId());
        caseRepository.save(entity);

        runtimeService.startProcessInstanceByKey(
            "caseReview",
            command.caseId(),
            Map.of("caseId", command.caseId())
        );
    }
}
```

If Spring transaction manager is correctly integrated, application DB write and Camunda engine write can be part of the same transaction if they share transaction resources appropriately.

But beware:

- if Camunda uses separate datasource/transaction manager, atomicity may not hold,
- remote calls inside transaction remain non-transactional,
- long transaction increases lock duration,
- rollback will affect both local app data and process engine data if truly same transaction.

### 11.2 Transaction Boundary vs Business Boundary

Business may say:

> “Submit case and start workflow must happen together.”

Technical design could be:

```text
single DB transaction:
  insert case row
  start process
  commit both
```

Or:

```text
app DB commit
outbox event
process starter consumes event
starts process idempotently
```

The first gives local atomicity but tighter coupling.
The second gives eventual consistency but better resilience and decoupling.

Top engineer chooses intentionally.

---

## 12. Side-Effect Problem

Database rollback cannot rollback external world.

Consider:

```text
User Task Approve
  -> Service Task Send Email
  -> Service Task Update External Registry
  -> User Task Confirm
```

No async boundary.

If `Send Email` succeeds, then `Update External Registry` fails:

```text
Camunda DB rollback -> Approve task returns
Email remains sent
External registry may or may not be updated
```

This is the classic side-effect inconsistency.

### 12.1 The Rule

Any delegate that calls external systems must be treated as **at-least-once** unless you have a stronger protocol.

Why?

- transaction may rollback after remote call,
- job may retry after timeout,
- worker may crash after remote success before completing job,
- network may fail after remote service processes request but before response received,
- engine may re-execute job after lock expiration,
- operator may manually retry incident.

Therefore external side-effect must be idempotent.

### 12.2 Bad Delegate

```java
public class SendEmailDelegate implements JavaDelegate {
    private final EmailClient emailClient;

    @Override
    public void execute(DelegateExecution execution) {
        String to = (String) execution.getVariable("email");
        emailClient.send(to, "Approved", "Your case is approved");
    }
}
```

Problem:

- no idempotency key,
- duplicate email possible,
- no durable record before/after send,
- no correlation id,
- no retry policy aligned with engine,
- impossible to know if send succeeded when timeout occurs.

### 12.3 Better Delegate with Idempotency

```java
public class SendEmailDelegate implements JavaDelegate {

    private final NotificationGateway notificationGateway;

    @Override
    public void execute(DelegateExecution execution) {
        String processInstanceId = execution.getProcessInstanceId();
        String activityId = execution.getCurrentActivityId();
        String businessKey = execution.getProcessBusinessKey();

        String idempotencyKey = businessKey + ":" + activityId + ":approval-email";

        notificationGateway.sendApprovalEmail(
            idempotencyKey,
            (String) execution.getVariable("email"),
            businessKey
        );
    }
}
```

Remote side must store/process idempotency key:

```text
if idempotencyKey already processed:
  return previous result
else:
  send email
  store processed key
  return success
```

### 12.4 Best Pattern: Outbox

Instead of sending email inside Camunda transaction:

```text
Service Task: Record Notification Intent
  -> writes notification_outbox row with unique key
  -> commit with process state

Notification Dispatcher:
  -> reads outbox
  -> sends email idempotently
  -> marks sent
```

BPMN:

```text
Approve
  -> Service Task: Create Notification Intent
  -> async boundary / wait for notification result if needed
```

This separates:

- process state transaction,
- external side-effect delivery,
- retry/dispatch concerns.

For high-integrity systems, outbox is usually safer than direct side-effect in delegate.

---

## 13. Async Boundary Decision Matrix

Use this matrix when deciding transaction boundaries.

| Situation | Recommended boundary | Reason |
|---|---:|---|
| Pure local validation | synchronous | cheap, deterministic, rollback with caller is useful |
| Create next user task after validation | synchronous | user gets immediate result, no job overhead |
| Call unreliable remote API | `asyncBefore` or external task | isolate retry and avoid caller rollback confusion |
| Send email/SMS | outbox or external task; usually async | side-effect must be idempotent |
| Generate large PDF | external task or asyncBefore | expensive, scalable worker needed |
| Update same local DB atomically with process | synchronous with shared transaction | true local atomicity possible |
| Update another service DB | async + idempotency/outbox | distributed transaction avoided |
| After completing user approval, downstream automation may fail | `asyncBefore` on first automation step | approval stays committed |
| Before creating final completion state | depends on business atomicity | decide if final state must rollback or incident |
| Multi-instance remote calls | async inner activity or external task | parallelism/retry isolation |
| Start process from public API | async start often useful | return quickly after durable creation |

---

## 14. Async Start

A process can be configured to start asynchronously by putting `camunda:asyncBefore="true"` on the start event.

```xml
<startEvent id="StartEvent" camunda:asyncBefore="true" />
```

Effect:

```text
startProcessInstanceByKey()
  -> create process instance
  -> create job for initial execution
  -> commit
  -> return

job executor later:
  -> executes from start event onward
```

### 14.1 Why Use Async Start?

Good use cases:

- public API should only persist request and return quickly,
- first service task may fail but process instance must exist for operator visibility,
- heterogeneous cluster: starting node may not have all delegate classes,
- heavy initialization,
- you want retry/incident semantics from the beginning,
- you want API layer decoupled from process execution.

### 14.2 Trade-Off

Without async start:

```text
API call starts process and may execute significant logic before returning.
```

With async start:

```text
API call creates durable process instance and job, but business work happens later.
```

This changes API semantics:

```text
201 Created means workflow accepted, not fully processed.
```

Your API contract must be clear.

---

## 15. Multi-Instance and Transaction Boundary

Multi-instance is a common source of misunderstanding.

BPMN:

```text
Service Task: Notify Agencies
  multi-instance parallel over agencies
```

Without async inner activity, execution may still happen in one transaction depending on model and behavior.

If you set async on multi-instance body:

```xml
<serviceTask id="notifyAgency" camunda:class="NotifyAgencyDelegate">
  <multiInstanceLoopCharacteristics isSequential="false" camunda:asyncBefore="true">
    <loopDataInputRef>agencies</loopDataInputRef>
  </multiInstanceLoopCharacteristics>
</serviceTask>
```

You create async boundary for each inner activity instance.

Effect:

```text
create N jobs
each job can execute/retry independently
parallelism possible through job executor threads
```

### 15.1 When Good

- notify 50 agencies independently,
- retry per agency,
- avoid one agency failure rollbacking all completed notifications,
- isolate remote side effects.

### 15.2 When Dangerous

- N is huge,
- job executor overloaded,
- database becomes hot,
- no idempotency per item,
- completion aggregation causes optimistic locking conflict,
- job priority not managed.

For very large fanout, consider external orchestration/batch table instead of raw BPMN multi-instance.

---

## 16. Transaction Subprocess Is Not Database Transaction

BPMN has a “transaction subprocess” concept. Do not confuse it with database transaction.

BPMN transaction subprocess models business transaction semantics with cancel and compensation behavior.

It does not mean:

```text
all activities inside are one ACID transaction across external systems
```

It means:

- certain cancel/compensation BPMN events can be modelled,
- completed compensation handlers can be invoked,
- business rollback is explicit process behavior.

Example:

```text
Transaction Subprocess: Book Trip
  -> Reserve Flight
  -> Reserve Hotel
  -> Charge Card
Cancel Boundary Event
  -> Compensate reservations
```

If charge fails after flight/hotel reservation, compensation may cancel reservations, but this is not DB rollback. It is business-level reversal.

Top engineer distinguishes:

```text
ACID rollback:
  database state reverts automatically

BPMN compensation:
  explicit business action attempts to semantically undo prior work
```

---

## 17. Consistency Model

Camunda 7 gives strong consistency for its own database transaction, not for the entire distributed business process.

### 17.1 Inside Engine DB

Within one command transaction:

- runtime state mutations are atomic,
- variables are persisted or rollback together,
- task creation/deletion follows commit/rollback,
- jobs/event subscriptions follow commit/rollback,
- optimistic locking protects concurrent updates.

### 17.2 Outside Engine DB

For external systems:

- no automatic rollback,
- no exactly-once guarantee,
- no distributed commit unless you implement XA/JTA carefully, which is often not desirable for microservices,
- remote side effects must be idempotent or compensatable.

### 17.3 Process-Level Consistency

Long-running process consistency is usually:

```text
eventual consistency + durable state + explicit recovery
```

Not:

```text
one giant transaction from start to end
```

This is the whole reason BPM engines exist: business processes span time, users, systems, retries, manual correction, and compensation.

---

## 18. State Machine View

Camunda process can be seen as a durable state machine.

```text
State: ReviewTaskActive
Event: taskService.complete(reviewTask)
Action:
  - delete task
  - run validation delegate
  - route by gateway
Next State: ApprovedTaskActive or CorrectionTaskActive
```

Transaction boundary defines whether the transition is atomic.

```text
Transition T1:
  ReviewTaskActive -> ApprovedTaskActive
```

If validation delegate fails:

```text
transition T1 fails
state remains ReviewTaskActive
```

If async boundary exists after review:

```text
Transition T1:
  ReviewTaskActive -> AutomationJobPending

Transition T2:
  AutomationJobPending -> ApprovedTaskActive or Incident
```

This is usually a better model for complex enterprise workflows because it exposes intermediate durable states.

### 18.1 Regulatory Workflow Implication

In regulatory systems, you often want durable separation between:

- user decision captured,
- post-decision automation running,
- external publication done,
- notification delivered,
- appeal window started.

Do not hide all of that in one synchronous transaction after user clicks Complete.

Better:

```text
Officer Review User Task
  -> asyncBefore Service Task: Persist Decision Effects
  -> asyncBefore External Task: Publish Decision
  -> asyncBefore Service Task: Create Notification Intent
  -> Timer: Appeal Window
```

This gives:

- auditability,
- retry points,
- incident recovery,
- operational visibility,
- less user-facing failure noise.

---

## 19. Practical BPMN Boundary Patterns

### 19.1 Pattern: Commit User Action Before Automation

Problem:

User completes an approval task. Downstream automation calls remote system. Remote failure should not make the approval task reappear.

Bad:

```text
User Task Approve
  -> Service Task Call Remote System
  -> End
```

Better:

```text
User Task Approve
  -> Service Task Call Remote System [asyncBefore]
  -> End
```

Transaction view:

```text
T1: complete approval, create job
T2: job calls remote system
```

### 19.2 Pattern: Durable Process Creation Before Initial Work

Bad:

```text
Start
  -> Service Task Heavy Initialization
  -> User Task Review
```

If heavy initialization fails, process instance may not exist.

Better:

```text
Start [asyncBefore]
  -> Service Task Heavy Initialization
  -> User Task Review
```

Now start call persists process instance/job. Failure becomes failed job/incident.

### 19.3 Pattern: Remote Call as External Task

Better for independently scalable integration:

```text
User Task Approve
  -> External Task Publish Decision
  -> User Task Verify Publication
```

Worker handles:

- HTTP client timeout,
- circuit breaker,
- idempotency,
- backpressure,
- deployment independently.

### 19.4 Pattern: Outbox for Notification

```text
Service Task: Write Notification Outbox
  -> End
```

Separate dispatcher sends email.

This makes process transaction local and deterministic.

### 19.5 Pattern: Business Error Branch

```text
Service Task Check Eligibility
  -> Boundary Error: Not Eligible
      -> User Task Inform Applicant
  -> Continue if eligible
```

Use for expected business outcome.

### 19.6 Pattern: Operator Recovery Task

```text
Service Task Sync Registry [asyncBefore, retries=3]
  -> User Task Continue

Incident if retries exhausted.
```

Operator resolves root cause and retries job.

Alternative explicit model:

```text
Service Task Try Sync Registry
  -> Gateway success?
      yes -> continue
      no -> User Task Manual Resolution
```

Use explicit model when failure is expected and business-owned.
Use incident when failure is technical and operator-owned.

---

## 20. Anti-Patterns

### 20.1 Long Synchronous Remote Chain

```text
User Task Submit
  -> REST Call A
  -> REST Call B
  -> REST Call C
  -> REST Call D
  -> User Task Done
```

Problems:

- user waits too long,
- one failure rollback everything,
- external side effects may duplicate,
- hard to recover,
- no intermediate visibility,
- thread blocked,
- transaction held too long.

Better:

```text
Submit
  -> asyncBefore A
  -> asyncBefore B
  -> asyncBefore C
  -> asyncBefore D
  -> Done
```

Or external task chain with idempotency.

### 20.2 Async Everywhere

```text
Every task asyncBefore and asyncAfter
```

Problems:

- job explosion,
- DB load,
- unnecessary latency,
- hard diagnostics,
- incident noise,
- priority/starvation issues.

Use async where boundary has semantic value.

### 20.3 Catching Exception and Pretending Success

Bad:

```java
try {
    remoteClient.call();
} catch (Exception ex) {
    log.warn("failed", ex);
}
```

Then process continues as if remote call succeeded.

This destroys correctness.

If failure matters, either:

- throw exception and let retry/incident happen,
- throw BPMN Error if business failure,
- set explicit failure variable and route,
- create manual recovery task.

### 20.4 Non-Idempotent Delegate Under Async Retry

```java
public void execute(DelegateExecution execution) {
    paymentClient.charge(card, amount);
}
```

If job retries, card may be charged twice.

Always use idempotency key.

### 20.5 Modelling Technical Retry as Business Loop

Bad:

```text
Call API
  -> Gateway failed?
     -> Timer wait 1 min
     -> Call API again
```

This may be appropriate sometimes, but often Camunda job retry is better.

Use BPMN loop only when retry timing/status is business-visible.
Use job retry when failure is technical infrastructure retry.

---

## 21. Example: Regulatory Case Approval

Let us model a realistic case.

Business flow:

1. Applicant submits application.
2. System validates application.
3. Officer reviews application.
4. Supervisor approves decision.
5. System publishes decision to external registry.
6. System sends notification.
7. Appeal window starts.

Naive BPMN:

```text
Start
  -> Validate
  -> Officer Review User Task
  -> Supervisor Approval User Task
  -> Publish Registry REST Call
  -> Send Email
  -> Timer Appeal Window
  -> End
```

Problem:

If Publish Registry succeeds and Send Email fails, supervisor approval may rollback if no wait/async boundary after approval.

Better transaction-aware BPMN:

```text
Start [asyncBefore]
  -> Validate Application
  -> Officer Review User Task
  -> Supervisor Approval User Task
  -> Publish Registry External Task
  -> Record Notification Outbox Service Task [asyncBefore]
  -> Timer Appeal Window
  -> End
```

Transaction view:

```text
T1: create process instance + start job
T2: validate application, create officer review task
T3: complete officer review, create supervisor approval task
T4: complete supervisor approval, create external task publish registry
T5: worker publishes registry, completes external task, creates async job for notification outbox
T6: write notification outbox, create appeal timer
T7: timer fires after appeal window
```

This is far more observable and recoverable.

### 21.1 What Is Committed When?

| Step | Committed state | Failure behavior |
|---|---|---|
| Start request | process/job created | if async start commit succeeds, process visible |
| Validation | officer task created | validation technical failure becomes failed job/incident |
| Officer review | supervisor task created | if downstream before next wait fails, officer completion may rollback unless boundary exists |
| Supervisor approval | external task created | approval committed before remote publish |
| Publish registry | next state after worker complete | worker must be idempotent |
| Notification outbox | outbox row + appeal timer | notification dispatch separated |
| Appeal timer | due job | job executor handles continuation |

---

## 22. Java Delegate Boundary Examples

### 22.1 Pure Local Delegate

Good synchronous delegate:

```java
public final class ValidateApplicationDelegate implements JavaDelegate {

    @Override
    public void execute(DelegateExecution execution) {
        String applicationType = requireString(execution, "applicationType");
        BigDecimal declaredRevenue = requireBigDecimal(execution, "declaredRevenue");

        if (declaredRevenue.signum() < 0) {
            throw new BpmnError("INVALID_APPLICATION", "Declared revenue cannot be negative");
        }

        execution.setVariable("riskBand", calculateRiskBand(applicationType, declaredRevenue));
    }

    private static String requireString(DelegateExecution execution, String name) {
        Object value = execution.getVariable(name);
        if (!(value instanceof String s) || s.isBlank()) {
            throw new BpmnError("INVALID_APPLICATION", "Missing variable: " + name);
        }
        return s;
    }

    private static BigDecimal requireBigDecimal(DelegateExecution execution, String name) {
        Object value = execution.getVariable(name);
        if (value instanceof BigDecimal bd) {
            return bd;
        }
        throw new BpmnError("INVALID_APPLICATION", "Invalid variable: " + name);
    }

    private static String calculateRiskBand(String type, BigDecimal revenue) {
        if (revenue.compareTo(new BigDecimal("1000000")) >= 0) {
            return "HIGH";
        }
        return "NORMAL";
    }
}
```

This is okay synchronous because:

- local deterministic logic,
- no external side effect,
- business invalidity represented as BPMN error,
- rollback behavior is acceptable.

### 22.2 Remote Delegate with Idempotency

```java
public final class PublishDecisionDelegate implements JavaDelegate {

    private final RegistryClient registryClient;

    public PublishDecisionDelegate(RegistryClient registryClient) {
        this.registryClient = registryClient;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String businessKey = execution.getProcessBusinessKey();
        String decisionId = (String) execution.getVariable("decisionId");
        String decisionOutcome = (String) execution.getVariable("decisionOutcome");

        String idempotencyKey = String.join(":",
            "publish-decision",
            businessKey,
            decisionId
        );

        RegistryPublishRequest request = new RegistryPublishRequest(
            idempotencyKey,
            decisionId,
            decisionOutcome
        );

        RegistryPublishResponse response = registryClient.publishDecision(request);

        execution.setVariable("registryReference", response.registryReference());
    }
}
```

BPMN should use:

```xml
<serviceTask id="publishDecision"
             name="Publish Decision"
             camunda:delegateExpression="${publishDecisionDelegate}"
             camunda:asyncBefore="true" />
```

Why asyncBefore:

- approval before this is committed,
- remote call failure becomes job failure,
- retry is isolated,
- incident can be handled operationally.

### 22.3 Delegate Must Not Swallow Technical Failure

Bad:

```java
try {
    registryClient.publishDecision(request);
} catch (Exception ex) {
    log.error("Registry failed", ex);
    execution.setVariable("registryFailed", true);
}
```

This silently changes technical failure into business path without clear ownership.

Better:

```java
try {
    registryClient.publishDecision(request);
} catch (RegistryBusinessRejection ex) {
    throw new BpmnError("REGISTRY_REJECTED", ex.getMessage());
} catch (Exception ex) {
    throw ex;
}
```

Then BPMN handles business rejection and job retry handles technical failure.

---

## 23. Process Variables and Transaction Semantics

Variable writes are part of the engine transaction.

```java
execution.setVariable("status", "APPROVED");
```

This is not committed until transaction commit.

If delegate later throws:

```text
variable update rollback
```

### 23.1 Variable Passed to taskService.complete

```java
taskService.complete(taskId, Map.of("decision", "APPROVED"));
```

If downstream synchronous service task fails before next wait state:

```text
decision variable rollback
user task still active
```

This often matters for UI/API.

### 23.2 Avoid Reading Uncommitted Assumptions Externally

If delegate writes variable and then calls external service with assumption that variable is committed, that assumption is false.

```java
execution.setVariable("decision", "APPROVED");
remoteClient.notifyDecision(execution.getProcessBusinessKey());
```

Remote system may query Camunda REST/history and not see committed variable yet.

If remote service needs committed data:

- commit first via async boundary,
- use outbox,
- pass data directly in request,
- use idempotent protocol,
- avoid remote read-back during same transaction.

---

## 24. History and Transaction Semantics

History events are also transaction-bound from an operational perspective.

If transaction rolls back:

- runtime changes rollback,
- history changes from that transaction should not appear as committed final records.

This matters when auditing.

Example:

```text
User completes task
Service task fails
Transaction rollback
```

A user may say “I clicked complete”.

But committed engine history may not show task completed because the transaction failed.

For regulatory UX, this suggests separating:

1. UI click/request audit at application boundary.
2. Engine committed workflow audit.

Example:

```text
application_request_audit:
  user clicked approve at 10:00:00
  request id REQ-123
  result engine exception

camunda_history:
  task remains active
```

Both are true. They answer different questions.

---

## 25. Optimistic Locking and Transaction Boundary

Optimistic locking will be covered deeply in part-007, but transaction boundary already matters.

When two commands attempt to update same process instance/execution concurrently:

```text
Command A reads version 3
Command B reads version 3
Command A commits version 4
Command B tries commit version 4 -> optimistic locking exception
```

If synchronous user action gets optimistic locking exception:

- transaction rollback,
- caller sees exception,
- user may retry.

If async job gets optimistic locking exception:

- job may be retried depending configuration and exception type,
- retries may or may not decrement depending engine behavior/configuration,
- process returns to last wait state/job boundary.

Boundary design can reduce contention.

Example problem:

```text
Parallel multi-instance tasks all update same parent variable at completion.
```

Better:

- use local variables per branch,
- aggregate at join,
- avoid writing shared process variable from many concurrent jobs,
- use external table with proper concurrency control.

---

## 26. Job Executor and Boundary

When async boundary or timer is reached, Camunda creates job.

Job processing has three phases:

```text
job creation
job acquisition
job execution
```

Job creation happens during process execution transaction.
Job acquisition/execution are handled by job executor.

### 26.1 Job Creation Is Transactional

If process reaches async boundary:

```text
create job row in ACT_RU_JOB
commit
```

If transaction rollback before commit:

```text
job does not exist
```

### 26.2 Job Execution Is New Transaction

Job executor later:

```text
acquire job
lock job
execute continuation
commit or rollback/fail
```

If job succeeds:

```text
job removed/updated
process advances
commit
```

If job fails:

```text
transaction rollback to job boundary
job retry count decreases
exception stored
incident may be created if retries exhausted
```

### 26.3 Backoff and Delay

Even if job is created immediately, job executor may not execute it instantly.

Reasons:

- acquisition cycle,
- backoff strategy,
- thread pool busy,
- job priority,
- due date,
- lock expiration,
- deployment-aware acquisition,
- cluster contention.

So async boundary changes not only transaction semantics but also latency model.

---

## 27. Designing Transaction Boundaries Step by Step

When designing a process, do not start with “where to put async”. Start with invariants.

### Step 1: Identify Business States

Example:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
PUBLISHED
NOTIFIED
CLOSED
```

### Step 2: Identify Durable Commit Points

Ask:

- After user submits, must submission remain even if validation automation fails?
- After supervisor approves, must approval remain even if publication fails?
- After publication succeeds, must notification failure rollback publication? Usually no.
- Is rejection a business result or technical failure?

### Step 3: Identify External Side Effects

List:

- call registry API,
- send email,
- generate PDF,
- update search index,
- send Kafka event,
- call payment API.

Every side effect needs:

- idempotency key,
- retry strategy,
- timeout strategy,
- ownership of failure,
- compensation if required,
- audit record.

### Step 4: Place Wait/Async Boundaries

Boundary should exist where:

- business state must be durable,
- external side effect begins,
- operator recovery should be possible,
- latency should be decoupled,
- retry should be isolated.

### Step 5: Define Error Semantics

For each activity:

| Failure | Type | Handling |
|---|---|---|
| applicant not eligible | business | BPMN Error / gateway |
| registry timeout | technical | job retry / incident |
| duplicate message | idempotency | return existing success |
| invalid variable schema | technical/design | fail fast, incident |
| missing user input | business/user | route back to correction |

### Step 6: Validate with Timeline

Draw transaction timeline:

```text
T1: start -> submitted wait state
T2: validation job -> review task
T3: complete review -> approval task
T4: complete approval -> publish external task
T5: complete publish -> notification outbox
T6: timer appeal window
```

If this timeline cannot be explained, the BPMN model is not production-ready.

---

## 28. Diagnostic Playbook

### 28.1 “User Completed Task but Task Reappeared”

Likely cause:

- downstream synchronous activity failed,
- transaction rollback to user task wait state.

Check:

- application logs around `taskService.complete`,
- exception thrown by delegate/listener after task completion,
- whether next activity has asyncBefore,
- whether variables passed during completion persisted.

Fix:

- if user completion should be committed, add `asyncBefore` after task before risky work,
- make risky work external task/job,
- handle business errors explicitly.

### 28.2 “Process Instance Not Created”

Likely cause:

- exception before first wait state during synchronous start.

Check:

- start event asyncBefore?
- service task before first wait state?
- delegate exception?
- transaction rollback?

Fix:

- async start if process instance must be visible even when initialization fails,
- move heavy initialization after wait/async boundary,
- validate input before starting process.

### 28.3 “Email Sent Twice”

Likely cause:

- async job retry,
- worker retry,
- timeout after remote success,
- manual retry incident,
- non-idempotent send.

Fix:

- idempotency key,
- notification outbox,
- external provider deduplication,
- store send status with unique constraint.

### 28.4 “Async Job Not Executing Immediately”

Likely cause:

- job executor inactive,
- acquisition backoff,
- due date not reached,
- deployment-aware executor cannot find deployment,
- job locked by another node,
- retries exhausted incident,
- priority starvation,
- thread pool saturated.

Fix:

- check `ACT_RU_JOB`,
- check retries, lock owner, lock expiration, due date,
- check job executor config,
- check deployment awareness,
- check incidents,
- check DB load.

### 28.5 “Rollback Did Not Undo External Update”

Expected behavior.

Fix design:

- use outbox,
- use compensation,
- make remote update idempotent,
- split transaction boundary before side-effect,
- use external task with clear completion semantics.

---

## 29. SQL-Oriented Mental Model

Do not mutate Camunda tables manually, but reading them helps diagnose.

### 29.1 Runtime State Around Wait State

User task wait state:

```text
ACT_RU_EXECUTION  -> active execution
ACT_RU_TASK       -> user task
ACT_RU_VARIABLE   -> variables
```

Async job boundary:

```text
ACT_RU_EXECUTION  -> execution waiting at transition/activity
ACT_RU_JOB        -> async continuation job
```

Timer wait state:

```text
ACT_RU_EXECUTION  -> execution waiting at timer
ACT_RU_JOB        -> timer job with due date
```

Message catch wait state:

```text
ACT_RU_EXECUTION       -> execution waiting
ACT_RU_EVENT_SUBSCR    -> message subscription
```

### 29.2 Transaction Rollback Visibility

If command fails before commit, SQL queries after the fact will show previous wait state.

That means:

```text
“I saw log line saying delegate executed”
```

does not imply:

```text
“delegate state committed”
```

Logs are not transaction state.

---

## 30. Engineering Heuristics

Use these heuristics in design reviews.

### 30.1 Every Remote Call Needs an Answer

For every remote call in BPMN/delegate, ask:

1. Is it inside a Camunda transaction?
2. What happens if remote succeeds but Camunda rolls back?
3. What happens if remote succeeds but response times out?
4. What happens if job retries?
5. What is the idempotency key?
6. Is duplicate acceptable?
7. Is compensation possible?
8. Who owns manual recovery?

If answers are unclear, design is not ready.

### 30.2 Every User Action Needs Commit Semantics

For every user task completion, ask:

1. Should completion rollback if next automation fails?
2. Should user see immediate failure?
3. Should task reappear?
4. Should approval be durable before publishing?
5. Should there be an intermediate “processing” state?

### 30.3 Every Async Boundary Needs Justification

For every `asyncBefore`/`asyncAfter`, ask:

1. What state is committed before this boundary?
2. What retry/incident behavior do we want after this boundary?
3. Is job executor capacity sufficient?
4. Is this boundary visible in operations?
5. Is the activity idempotent?
6. Does async placement match listener behavior?

### 30.4 Every Business Error Needs Explicit Modelling

Do not hide business outcomes in Java exceptions.

Business failures should be visible as:

- BPMN Error branch,
- gateway branch,
- correction task,
- rejection state,
- escalation path.

Technical failures should be visible as:

- retry,
- incident,
- operator task,
- monitoring alert.

---

## 31. Java 8 to Java 25 Considerations

Camunda 7 compatibility depends on Camunda minor version, application server, Spring generation, and supported environments. This series covers Java 8 to 25 as engineering context, but you must not assume one Camunda 7 runtime supports all Java versions equally.

### 31.1 Java 8 Legacy Estate

Common in older Camunda 7 deployments:

- Java 8,
- Spring Boot 2.x or older Spring,
- Java EE container,
- older app servers,
- older JDBC drivers,
- `javax.*` dependencies,
- legacy serialization risk.

Design concern:

- avoid Java language features unavailable in runtime,
- be careful with serialized object variables across upgrades,
- avoid tight delegate class coupling in long-running instances.

### 31.2 Java 11/17 Modernization

Java 11/17 often appears in modernization waves.

Consider:

- module system/classpath issues,
- newer TLS defaults,
- dependency upgrades,
- stronger illegal reflective access restrictions,
- GC changes,
- Spring Boot compatibility.

### 31.3 Java 21+

Java 21 introduces modern runtime baseline for many enterprise systems. However, Camunda 7 support depends on specific versions and announcements.

Virtual threads do not magically make Camunda synchronous transactions safe for long remote calls. Even if blocking becomes cheaper, transaction duration, side-effect semantics, DB locks, and rollback behavior remain.

Important:

```text
Virtual threads reduce thread cost.
They do not solve distributed consistency.
```

### 31.4 Java 25 Planning

For Java 25, treat as future runtime planning unless your exact Camunda 7 version, Spring version, app server, JDBC driver, and dependencies explicitly support it.

Engineering rule:

```text
Do not upgrade Java runtime for Camunda 7 production by assumption.
Use a tested compatibility matrix.
```

---

## 32. Review Checklist

Before approving a Camunda 7 BPMN model, check:

```text
[ ] Do we know all wait states?
[ ] Do we know all transaction boundaries?
[ ] Do we know what happens if each delegate throws?
[ ] Do we know which user actions may rollback?
[ ] Do remote calls have idempotency keys?
[ ] Are business errors modelled explicitly?
[ ] Are technical errors retried/incidented appropriately?
[ ] Are async boundaries placed for semantic reasons?
[ ] Are long-running tasks externalized or async?
[ ] Are variables committed before external consumers read them?
[ ] Are history/audit expectations aligned with rollback semantics?
[ ] Are multi-instance async jobs bounded and observable?
[ ] Can operators recover failed jobs safely?
[ ] Can we explain transaction timeline to QA/business/ops?
```

If you cannot explain the transaction timeline, you do not understand the process yet.

---

## 33. Mini Lab: Reasoning Exercise

Given BPMN:

```text
Start
  -> Service Task A
  -> User Task B
  -> Service Task C
  -> Service Task D
  -> User Task E
```

No async boundary.

Questions:

1. What happens if A throws during process start?
2. What happens if C throws during B completion?
3. What happens if D sends email then throws?
4. When is E created?
5. Which parts are in same transaction?

Answers:

1. Process instance is not committed because no wait state has been reached.
2. B remains active because B completion, C, D, and E creation are in one transaction.
3. Email remains sent externally, but Camunda rolls back to B. This is inconsistent unless email is idempotent/compensated/outboxed.
4. E is created only if C and D complete and transaction commits.
5. `Start -> A -> B creation` is transaction 1. `B completion -> C -> D -> E creation` is transaction 2.

Now add `asyncBefore` on C:

```text
Start
  -> Service Task A
  -> User Task B
  -> Service Task C [asyncBefore]
  -> Service Task D
  -> User Task E
```

New answers:

1. Same as before for A.
2. B completion commits and job for C is created.
3. If D sends email then throws inside job transaction, job retries may resend email unless idempotent.
4. E is created only if C and D complete in job transaction.
5. `B completion -> create C job` is separate from `C -> D -> E creation`.

Now add `asyncBefore` on D too:

```text
Start
  -> A
  -> B
  -> C [asyncBefore]
  -> D [asyncBefore]
  -> E
```

Now:

```text
T1: Start -> A -> B
T2: Complete B -> create C job
T3: Execute C -> create D job
T4: Execute D -> create E
```

If D fails, C remains committed.

---

## 34. Common Interview-Level Questions

### Q1: Why did my user task come back after I completed it?

Because completing the user task and executing following synchronous steps were part of one transaction. A later exception rolled back to the last wait state, which was the user task.

### Q2: Does Camunda save state after every service task?

No. Camunda saves at wait states and explicit async boundaries. A normal service task is executed synchronously inside the current transaction.

### Q3: Is `asyncBefore` used for scalability?

Not primarily. It defines a transaction/retry boundary and delegates execution to job executor. It may help scalability when used correctly, but it also adds job/database overhead.

### Q4: Can database rollback undo an HTTP call?

No. External side effects require idempotency, compensation, or outbox/inbox patterns.

### Q5: What is the difference between BPMN Error and Java exception?

BPMN Error models expected business error that can be caught and routed in BPMN. Java exception usually represents technical failure and triggers rollback or failed job retry unless handled.

### Q6: Why use async start?

To persist process instance/job first and defer execution. Useful when initial work is heavy, failure should create visible incident, or caller should not execute process logic synchronously.

### Q7: Does external task mean exactly once?

No. External task is still at-least-once from a side-effect perspective. Worker must be idempotent and handle lock expiration/retry scenarios.

---

## 35. What You Should Internalize

If you remember only one thing from this part:

```text
Camunda 7 executes from one committed wait state to the next committed wait state.
Everything between those points is one transaction unless you introduce async/wait boundaries.
```

If you remember the second thing:

```text
Rollback only rolls back Camunda/local database state, not the external world.
```

If you remember the third thing:

```text
Async continuation is a semantic boundary: commit-before, retry-after, incident-after, and job-executor-after.
```

Top-tier Camunda engineering is not about drawing more BPMN elements. It is about designing durable, observable, recoverable state transitions with explicit failure semantics.

---

## 36. Part Summary

In this part, we covered:

- Camunda 7 passive execution model.
- Borrowed caller thread.
- Wait state as durability boundary.
- Transaction boundary as transition between stable states.
- Rollback to last committed wait state.
- Synchronous continuation.
- `asyncBefore` and `asyncAfter`.
- Async start.
- Atomic operation mental model.
- Technical exception vs BPMN Error.
- Job creation and job execution transaction split.
- Side-effect problem.
- Idempotency requirement.
- Outbox pattern.
- Business vs technical failure handling.
- Transaction subprocess vs database transaction.
- Regulatory workflow boundary design.
- Diagnostic playbook.
- Java 8–25 runtime considerations.

---

## 37. Connection to Next Part

Part berikutnya akan masuk lebih dalam ke:

```text
Async Continuations, Job Creation, Retry Semantics, dan Idempotency Design
```

Part ini sudah menjelaskan mengapa async boundary penting. Part berikutnya akan membedah apa yang terjadi setelah boundary itu dibuat:

- bagaimana job dibuat,
- bagaimana retry bekerja,
- bagaimana incident muncul,
- bagaimana retry cycle dikonfigurasi,
- bagaimana idempotency key dirancang,
- bagaimana membedakan retry engine, retry HTTP client, dan retry business,
- bagaimana menghindari duplicate side-effect.

---

## 38. Status Seri

Status part ini: **selesai**.  
Status seri: **belum selesai**.  
Lanjut ke: `learn-java-camunda-7-bpm-platform-engineering-part-004.md`.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-002.md">⬅️ Part 002 — BPMN Execution Tree, Token Semantics, Scope, Activity Instance, dan Event Scope</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-004.md">Part 004 — Async Continuations, Job Creation, Retry Semantics, dan Idempotency Design ➡️</a>
</div>

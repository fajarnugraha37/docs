# Part 7 — Transactions Across Asynchronous Boundaries

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `07-transactions-across-asynchronous-boundaries.md`  
**Scope:** Java 8–25, Java EE/Jakarta EE, `javax.*` and `jakarta.*`, Jakarta Concurrency, Jakarta Transactions/JTA, CDI/EJB-style transaction demarcation, async task design, outbox/idempotency patterns.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami kenapa **transaction boundary** tidak boleh diperlakukan sama seperti ordinary execution context ketika pekerjaan melewati asynchronous boundary.
2. Membedakan antara:
   - thread context,
   - security context,
   - CDI context,
   - transaction context,
   - persistence context,
   - business correlation context.
3. Menjelaskan kenapa transaction biasanya **thread-associated**, bukan “global magic state” yang otomatis mengikuti task async.
4. Mendesain asynchronous work yang aman dengan prinsip:
   - enqueue inside transaction,
   - execute in independent transaction,
   - commit side effect explicitly,
   - record state transition durably.
5. Menentukan kapan memakai:
   - `ManagedExecutorService`,
   - `@Transactional`,
   - `UserTransaction`,
   - EJB `@TransactionAttribute`,
   - durable outbox,
   - message queue,
   - Jakarta Batch.
6. Menghindari anti-pattern umum seperti:
   - async task memakai entity managed dari transaction pemanggil,
   - background task bergantung pada request transaction,
   - retry non-idempotent write,
   - long-running transaction,
   - hidden side effect sebelum commit.
7. Membuat failure model untuk async transactional processing yang defensible di production dan regulatory system.

---

## 2. Problem yang Diselesaikan

Di aplikasi enterprise, kita sering butuh melakukan pekerjaan setelah request utama diterima:

- generate document setelah case disubmit,
- kirim email setelah approval,
- sync data ke external registry,
- recalculate case ageing,
- update search index,
- write audit detail besar,
- process attachment virus scan,
- fan-out ke beberapa downstream system,
- enqueue batch job setelah user action.

Secara intuitif developer sering menulis:

```java
@Transactional
public void approveCase(Long caseId) {
    Case c = caseRepository.find(caseId);
    c.approve();

    executor.submit(() -> {
        emailService.sendApprovalEmail(c);
        externalRegistry.sync(c);
    });
}
```

Kode ini tampak masuk akal, tetapi menyimpan banyak jebakan:

1. Apakah async task melihat data yang sudah commit?
2. Apakah entity `c` masih valid di thread lain?
3. Apakah async task berjalan dalam transaction yang sama?
4. Apa yang terjadi jika transaction utama rollback, tetapi email sudah terkirim?
5. Apa yang terjadi jika request sukses, tetapi async task gagal?
6. Apa yang terjadi saat server restart setelah commit tapi sebelum async task selesai?
7. Siapa yang bertanggung jawab terhadap retry?
8. Bagaimana audit membuktikan bahwa side effect terjadi karena approval tertentu?

Masalah sebenarnya bukan “cara menjalankan thread”. Masalah sebenarnya adalah **bagaimana memisahkan business state transition dari asynchronous side effect secara aman**.

---

## 3. Mental Model Utama

### 3.1 Transaction bukan sekadar context yang boleh dibawa ke mana-mana

Beberapa context relatif aman untuk dipropagasikan:

- correlation ID,
- logging MDC,
- tenant identifier,
- locale,
- caller identity untuk audit,
- trace context.

Tetapi transaction berbeda.

Transaction adalah **unit atomicity** atas resource yang berpartisipasi. Ia memiliki lifecycle:

```text
begin
  perform reads/writes
  enlist resources
  flush/prepare
commit OR rollback
end
```

Transaction bukan hanya metadata. Ia berhubungan dengan:

- database connection,
- lock,
- isolation level,
- persistence context,
- enlisted XA resource,
- timeout,
- rollback-only flag,
- synchronization callback,
- transaction manager internal state.

Karena itu transaction tidak boleh dianggap seperti `Map<String, Object>` yang bisa dicopy ke thread lain.

---

### 3.2 Transaction biasanya terasosiasi dengan thread eksekusi

Dalam model Jakarta Transactions/JTA, transaction manager mempertahankan asosiasi transaction context dengan thread sebagai bagian dari struktur internalnya. Artinya, ketika kode berjalan di thread tertentu, transaction manager dapat mengetahui transaction apa yang sedang aktif pada thread tersebut.

Mental model sederhana:

```text
Thread A
  -> associated transaction: TX-123

Thread B
  -> associated transaction: none
```

Ketika kamu berpindah dari request thread ke managed executor thread, kamu tidak otomatis membawa transaction aktif dari request thread ke worker thread.

```text
Request Thread
  begin TX-123
  update CASE
  submit async task
  commit TX-123

Worker Thread
  no TX-123 unless explicitly started by container/interceptor/application
```

Ini bukan kelemahan. Ini fitur keselamatan.

Jika transaction aktif bisa sembarang berjalan lintas thread tanpa struktur jelas, maka muncul pertanyaan sulit:

- siapa yang commit?
- siapa yang rollback?
- bagaimana kalau thread A rollback saat thread B masih menulis?
- bagaimana lock dilepas?
- bagaimana timeout dihitung?
- bagaimana exception di worker memengaruhi transaction caller?
- bagaimana transaction manager membedakan parallel work yang masih bagian dari transaction yang sama?

Di enterprise runtime, ambiguitas seperti ini adalah sumber corruption.

---

### 3.3 Async boundary adalah transaction boundary secara desain

Aturan praktis:

> Begitu pekerjaan melewati asynchronous boundary, anggap ia masuk ke **transaction baru atau no transaction**, kecuali spesifikasi/container secara eksplisit mengatakan sebaliknya dan kamu benar-benar memahami konsekuensinya.

Async boundary meliputi:

- `ManagedExecutorService.submit(...)`,
- `ManagedScheduledExecutorService.schedule(...)`,
- `CompletableFuture.supplyAsync(..., managedExecutor)`,
- EJB `@Asynchronous`,
- JMS/message listener,
- Jakarta Batch step,
- scheduler,
- HTTP callback,
- external workflow task,
- Kubernetes Job.

Setiap boundary ini memutus asumsi “satu call stack, satu transaction, satu failure result”.

---

## 4. Baseline Spesifikasi dan Runtime

### 4.1 Jakarta Concurrency

Jakarta Concurrency menyediakan API standar untuk menggunakan concurrency dari komponen Jakarta EE tanpa mengorbankan integritas container. Resource seperti managed executor, scheduled executor, context service, dan managed thread factory disediakan container agar task dapat berjalan dengan thread/context yang dikelola container.

Yang penting: managed executor membuat eksekusi async lebih aman dari sisi container, tetapi tidak berarti transaction aktif dari caller boleh dianggap otomatis dipakai task async.

---

### 4.2 Jakarta Transactions / JTA

Jakarta Transactions mendefinisikan interface antara transaction manager dan pihak-pihak yang terlibat dalam distributed transaction system: application, resource manager, dan application server.

Transaction manager mengelola asosiasi transaction context dengan thread. Ini menjelaskan kenapa thread boundary sangat penting dalam reasoning transaksi.

---

### 4.3 CDI `@Transactional`

`jakarta.transaction.Transactional` memberi kemampuan declarative transaction boundary pada CDI managed beans.

Tetapi `@Transactional` bekerja melalui container/interceptor invocation. Artinya:

- method harus dipanggil melalui proxy/interceptor path,
- self-invocation dapat melewati interceptor,
- task async yang langsung menjalankan lambda biasa tidak otomatis mendapat transaction hanya karena caller method transactional,
- transaction boundary harus ditempatkan pada method yang benar-benar dieksekusi di worker thread.

---

### 4.4 EJB Transaction Attribute

Di aplikasi Java EE/Jakarta EE klasik, EJB menyediakan transaction attribute seperti:

- `REQUIRED`,
- `REQUIRES_NEW`,
- `MANDATORY`,
- `SUPPORTS`,
- `NOT_SUPPORTED`,
- `NEVER`.

EJB asynchronous method juga memiliki semantics tersendiri. Yang penting untuk mental model seri ini: asynchronous invocation tidak boleh diasumsikan berjalan di transaction thread caller.

---

## 5. Taxonomy: Jenis Boundary yang Sering Tertukar

### 5.1 Call boundary

```text
A.method() -> B.method()
```

Jika synchronous dan berada dalam container invocation path, transaction caller dapat mengalir sesuai aturan propagation/interceptor.

---

### 5.2 Thread boundary

```text
A.method()
  -> executor.submit(B::method)
```

Call stack terputus. Exception tidak otomatis kembali ke caller. Transaction tidak otomatis menjadi satu unit atomik.

---

### 5.3 Transaction boundary

```text
TX-1: update case status
TX-2: insert email outbox
TX-3: send email and mark sent
```

Transaction boundary tidak selalu sama dengan method boundary. Desain yang baik membuat boundary eksplisit.

---

### 5.4 Durability boundary

```text
commit DB row
```

Setelah commit, state dapat dipulihkan setelah crash. Sebelum commit, state hanya niat di memory.

Async task yang hanya berada di memory queue belum durable.

---

### 5.5 Side-effect boundary

```text
send email
call external API
write file
publish message
```

External side effect sering tidak ikut rollback transaction database.

Ini sumber utama inconsistency:

```text
DB rollback, tetapi email sudah terkirim.
DB commit, tetapi API call gagal.
DB commit, server crash sebelum email dikirim.
```

---

## 6. Contoh Masalah: Async Side Effect di Dalam Transaction

### 6.1 Kode bermasalah

```java
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;

public class CaseApprovalService {

    @Inject
    ManagedExecutorService executor;

    @Inject
    CaseRepository caseRepository;

    @Inject
    EmailService emailService;

    @Transactional
    public void approve(long caseId) {
        CaseEntity entity = caseRepository.find(caseId);
        entity.approve();

        executor.submit(() -> {
            emailService.sendApprovalEmail(entity);
        });
    }
}
```

### 6.2 Kenapa bermasalah?

#### Problem 1 — Entity managed tidak aman dibawa ke thread lain

`entity` mungkin attached pada persistence context transaction caller. Persistence context biasanya tidak thread-safe dan lifecycle-nya terkait transaction/request/container invocation.

Async task seharusnya tidak memakai managed entity dari thread caller.

Yang lebih aman:

```java
long approvedCaseId = entity.getId();
executor.submit(() -> emailJobService.sendApprovalEmailByCaseId(approvedCaseId));
```

Tetapi ini juga belum cukup, karena masih ada problem durability.

---

#### Problem 2 — Task bisa berjalan sebelum transaction utama commit

Timeline:

```text
T1 request thread: begin TX
T1 request thread: update case status = APPROVED
T1 request thread: submit async task
T2 worker thread : load case by id
T2 worker thread : sees old status OR blocked OR inconsistent read
T1 request thread: commit TX
```

Bergantung isolation level dan database behavior, worker bisa melihat data lama, blocked by lock, atau gagal.

---

#### Problem 3 — Task bisa sukses walaupun transaction utama rollback

Timeline:

```text
T1 begin TX
T1 update case status APPROVED
T1 submit async email
T2 send email: "Your case has been approved"
T1 exception
T1 rollback
```

Hasil:

```text
Database: case belum approved
External world: user menerima email approved
```

Ini bukan bug kecil. Dalam sistem regulatory, ini bisa menjadi audit incident.

---

#### Problem 4 — Task hilang saat server crash

Timeline:

```text
T1 update case
T1 submit task into in-memory executor queue
T1 commit
server crash before task runs
```

Hasil:

```text
Case approved
No email sent
No durable record that email must be sent
No retry possible
```

Managed executor menjaga container semantics, bukan durability semantics.

---

## 7. Rule of Thumb: Async Task Harus Punya Transaction Sendiri

Desain lebih aman:

```text
Request transaction:
  - validate command
  - update domain state
  - insert durable work request/outbox row
  - commit

Worker transaction:
  - claim work item
  - execute work
  - update work status
  - commit
```

Bukan:

```text
Request transaction:
  - update domain state
  - start background lambda
  - hope everything works
```

---

## 8. Pattern 1: Pass Identifier, Not Managed Entity

### 8.1 Salah

```java
executor.submit(() -> notificationService.notify(entity));
```

### 8.2 Lebih benar

```java
long caseId = entity.getId();
executor.submit(() -> notificationService.notifyCaseApproved(caseId));
```

### 8.3 Kenapa identifier lebih aman?

Identifier adalah value stabil. Worker dapat:

- membuka transaction sendiri,
- load ulang state terbaru,
- melakukan authorization/system policy check,
- melihat apakah status masih relevan,
- membuat audit yang benar,
- retry secara aman.

### 8.4 Tetapi identifier saja belum menyelesaikan durability

Jika task hanya ada dalam memory queue, task tetap bisa hilang saat crash. Karena itu untuk work penting, gunakan durable work record.

---

## 9. Pattern 2: Transactional Outbox

### 9.1 Masalah yang diselesaikan

Kita ingin memastikan:

```text
Jika case approval commit, maka niat mengirim event/email juga commit.
Jika case approval rollback, maka niat mengirim event/email juga rollback.
```

Outbox menyatukan domain state change dan work request dalam satu database transaction.

---

### 9.2 Struktur tabel sederhana

```sql
CREATE TABLE OUTBOX_EVENT (
    ID              NUMBER PRIMARY KEY,
    EVENT_TYPE      VARCHAR2(100) NOT NULL,
    AGGREGATE_TYPE  VARCHAR2(100) NOT NULL,
    AGGREGATE_ID    VARCHAR2(100) NOT NULL,
    IDEMPOTENCY_KEY VARCHAR2(200) NOT NULL,
    PAYLOAD_JSON    CLOB NOT NULL,
    STATUS          VARCHAR2(30) NOT NULL,
    ATTEMPT_COUNT   NUMBER DEFAULT 0 NOT NULL,
    NEXT_ATTEMPT_AT TIMESTAMP,
    CREATED_AT      TIMESTAMP NOT NULL,
    UPDATED_AT      TIMESTAMP NOT NULL,
    LAST_ERROR      CLOB,
    CONSTRAINT UK_OUTBOX_IDEMPOTENCY UNIQUE (IDEMPOTENCY_KEY)
);
```

Status contoh:

```text
PENDING
CLAIMED
SENT
FAILED_RETRYABLE
FAILED_PERMANENT
CANCELLED
```

---

### 9.3 Request transaction

```java
import jakarta.transaction.Transactional;

public class CaseApprovalService {

    @Inject
    CaseRepository caseRepository;

    @Inject
    OutboxRepository outboxRepository;

    @Transactional
    public void approve(long caseId, String actorUserId) {
        CaseEntity c = caseRepository.findForUpdate(caseId);
        c.approve(actorUserId);

        OutboxEvent event = OutboxEvent.pending(
            "CASE_APPROVED_EMAIL",
            "CASE",
            String.valueOf(caseId),
            "CASE_APPROVED_EMAIL:" + caseId + ":" + c.getVersion(),
            buildPayload(caseId, actorUserId, c.getVersion())
        );

        outboxRepository.insert(event);
    }
}
```

Dalam transaction yang sama:

```text
CASE.status = APPROVED
OUTBOX_EVENT.status = PENDING
```

Jika commit, keduanya durable. Jika rollback, keduanya hilang.

---

### 9.4 Worker transaction

```java
public class OutboxWorker {

    @Inject
    OutboxRepository outboxRepository;

    @Inject
    EmailGateway emailGateway;

    @Transactional
    public void processOne(long eventId) {
        OutboxEvent event = outboxRepository.findForUpdate(eventId);

        if (!event.isProcessable()) {
            return;
        }

        event.markClaimed();

        EmailCommand command = EmailCommand.fromJson(event.getPayloadJson());

        emailGateway.send(command);

        event.markSent();
    }
}
```

Namun contoh ini masih punya problem jika `emailGateway.send()` sukses tetapi commit `markSent()` gagal.

---

## 10. The Hard Truth: External Side Effect Tidak Ikut Rollback DB

Misalnya:

```text
TX begin
mark event CLAIMED
send email succeeds
mark event SENT
DB commit fails
```

Setelah restart:

```text
OUTBOX_EVENT mungkin masih PENDING/CLAIMED
worker retry
email terkirim dua kali
```

Karena external side effect tidak ikut rollback database transaction, kamu harus mendesain idempotency.

---

## 11. Idempotency sebagai Syarat Async Transactional Work

### 11.1 Definisi praktis

Operasi idempotent berarti menjalankan operasi yang sama lebih dari sekali menghasilkan efek bisnis yang sama seperti menjalankannya sekali.

```text
sendApprovalEmail(caseId=123, version=7)
```

Jika dijalankan dua kali, sistem harus bisa mencegah atau menerima duplicate secara aman.

---

### 11.2 Idempotency key

```text
CASE_APPROVED_EMAIL:caseId=123:caseVersion=7
```

Atau:

```text
EXTERNAL_SYNC:caseId=123:targetSystem=REGISTRY:domainEventId=987
```

Idempotency key harus merepresentasikan business event, bukan random UUID setiap retry.

Salah:

```java
String idempotencyKey = UUID.randomUUID().toString();
```

Benar:

```java
String idempotencyKey = "CASE_APPROVED_EMAIL:" + caseId + ":" + approvedVersion;
```

---

### 11.3 Idempotency table

```sql
CREATE TABLE SIDE_EFFECT_LOG (
    IDEMPOTENCY_KEY VARCHAR2(200) PRIMARY KEY,
    EFFECT_TYPE     VARCHAR2(100) NOT NULL,
    STATUS          VARCHAR2(30) NOT NULL,
    CREATED_AT      TIMESTAMP NOT NULL,
    UPDATED_AT      TIMESTAMP NOT NULL,
    RESPONSE_REF     VARCHAR2(200),
    ERROR_DETAIL    CLOB
);
```

Sebelum side effect:

```text
try insert idempotency key
if duplicate and status SUCCESS -> skip
if duplicate and status IN_PROGRESS too old -> recover
if duplicate and status FAILED_RETRYABLE -> retry policy
```

---

## 12. Pattern 3: After-Commit Triggering

Kadang pekerjaan tidak cukup penting untuk durable outbox, tetapi harus dipastikan baru dijalankan setelah transaction commit.

Contoh:

- refresh in-memory cache,
- local metrics update,
- best-effort notification internal,
- non-critical warmup.

Dalam konteks JTA, kamu bisa menggunakan transaction synchronization callback seperti `afterCompletion`, tetapi API detail dan aksesnya bergantung container/environment.

Mental model:

```text
inside TX:
  register callback

on commit success:
  submit async task

on rollback:
  do nothing
```

Pseudocode:

```java
@Transactional
public void updateCase(...) {
    updateDatabase();

    transactionSynchronizationRegistry.registerInterposedSynchronization(
        new Synchronization() {
            @Override
            public void beforeCompletion() {}

            @Override
            public void afterCompletion(int status) {
                if (status == Status.STATUS_COMMITTED) {
                    executor.submit(() -> cacheRefresher.refresh(caseId));
                }
            }
        }
    );
}
```

Tetapi:

- callback bukan durable queue,
- jika server crash setelah commit sebelum callback submit, task hilang,
- jangan gunakan untuk business-critical side effect.

Rule:

```text
after-commit callback = okay for best-effort local follow-up
outbox/message/batch = required for durable business follow-up
```

---

## 13. Pattern 4: Independent Transaction Per Async Task

Async task yang melakukan database update harus membuka transaction sendiri.

### 13.1 CDI style

```java
public class AsyncCaseTask {

    @Inject
    CaseRepository caseRepository;

    @Transactional
    public void recomputeDerivedState(long caseId) {
        CaseEntity c = caseRepository.find(caseId);
        c.recomputeDerivedFields();
    }
}
```

Submit:

```java
executor.submit(() -> asyncCaseTask.recomputeDerivedState(caseId));
```

Syarat penting:

- `asyncCaseTask` harus CDI bean/proxy yang valid,
- method `@Transactional` harus dipanggil melalui interceptor,
- jangan self-invocation,
- jangan instantiate manual dengan `new AsyncCaseTask()`.

---

### 13.2 Problem self-invocation

Salah:

```java
public class MyService {

    @Transactional
    public void outer() {
        innerRequiresNew(); // self-invocation, interceptor may be bypassed
    }

    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void innerRequiresNew() {
        // may not start new tx if interceptor bypassed
    }
}
```

Lebih aman:

```java
public class OuterService {

    @Inject
    InnerTransactionalService inner;

    public void outer() {
        inner.innerRequiresNew();
    }
}
```

---

### 13.3 Programmatic transaction dengan `UserTransaction`

Untuk beberapa kasus, worker membutuhkan demarcation eksplisit:

```java
import jakarta.annotation.Resource;
import jakarta.transaction.UserTransaction;

public class ProgrammaticWorker {

    @Resource
    UserTransaction utx;

    public void runWork(long id) throws Exception {
        utx.begin();
        try {
            doDatabaseWork(id);
            utx.commit();
        } catch (Exception e) {
            try {
                utx.rollback();
            } catch (Exception rollbackFailure) {
                e.addSuppressed(rollbackFailure);
            }
            throw e;
        }
    }
}
```

Gunakan programmatic transaction hanya ketika declarative transaction tidak cukup jelas. Untuk kebanyakan service-layer logic, declarative transaction lebih readable.

---

## 14. Pattern 5: Durable Job Request

Untuk async work yang lebih besar dari event kecil, gunakan job request table.

```sql
CREATE TABLE ASYNC_JOB_REQUEST (
    ID              NUMBER PRIMARY KEY,
    JOB_TYPE        VARCHAR2(100) NOT NULL,
    BUSINESS_KEY    VARCHAR2(200) NOT NULL,
    STATUS          VARCHAR2(30) NOT NULL,
    REQUESTED_BY    VARCHAR2(100) NOT NULL,
    REQUESTED_AT    TIMESTAMP NOT NULL,
    STARTED_AT      TIMESTAMP,
    COMPLETED_AT    TIMESTAMP,
    ATTEMPT_COUNT   NUMBER DEFAULT 0 NOT NULL,
    PARAMETER_JSON  CLOB NOT NULL,
    LAST_ERROR      CLOB,
    CONSTRAINT UK_JOB_BUSINESS_KEY UNIQUE (JOB_TYPE, BUSINESS_KEY)
);
```

Contoh:

```text
JOB_TYPE      = RECALCULATE_CASE_AGEING
BUSINESS_KEY  = CASE:123:AGEING_VERSION:44
STATUS        = PENDING
```

Request transaction:

```java
@Transactional
public void requestRecalculation(long caseId, String actor) {
    caseRepository.markNeedsRecalculation(caseId);
    jobRequestRepository.insertPending(
        "RECALCULATE_CASE_AGEING",
        "CASE:" + caseId,
        actor,
        jsonParams(caseId)
    );
}
```

Worker:

```java
@Transactional
public void claimAndRun(long jobId) {
    AsyncJobRequest job = jobRequestRepository.findForUpdateSkipLocked(jobId);
    if (job == null || !job.isPending()) {
        return;
    }
    job.markStarted();
}

@Transactional
public void complete(long jobId, Result result) {
    AsyncJobRequest job = jobRequestRepository.find(jobId);
    job.markCompleted(result);
}
```

Untuk job panjang, jangan tahan satu transaction dari awal sampai akhir. Pecah menjadi beberapa transaction state transition.

---

## 15. Long-Running Transaction Anti-Pattern

### 15.1 Contoh buruk

```java
@Transactional
public void nightlySync() {
    List<CaseEntity> cases = caseRepository.findAllOpenCases();

    for (CaseEntity c : cases) {
        externalApi.sync(c);
        c.markSynced();
    }
}
```

Problem:

- transaction terlalu lama,
- lock terlalu lama,
- persistence context membesar,
- rollback sangat mahal,
- external API call terjadi di dalam DB transaction,
- timeout tinggi,
- retry sulit,
- partial progress tidak jelas.

---

### 15.2 Versi lebih baik

```text
TX-1: select page/key range to process
TX-2: claim item 1
outside or short TX: call external API with idempotency
TX-3: mark item 1 result
TX-4: claim item 2
...
```

Atau gunakan Jakarta Batch chunk:

```text
read N records
process N records
write N records in one chunk transaction
checkpoint
repeat
```

Rule:

> Transaction harus cukup panjang untuk menjaga invariant, tetapi cukup pendek untuk tidak menjadi resource hostage.

---

## 16. Transaction Boundary Design by Workload Type

| Workload | Recommended transaction model | Durable? | Notes |
|---|---:|---:|---|
| Fire-and-forget cache refresh | after-commit callback or managed executor | No | Accept lost execution |
| Email after case approval | outbox + idempotency | Yes | Avoid email before rollback |
| External registry sync | outbox/job request + idempotency | Yes | Handle 429/5xx/retry |
| Audit trail write | same transaction for core audit, async for heavy enrichment | Usually yes | Regulatory evidence must be durable |
| Search index update | outbox/event | Yes-ish | Rebuild possible but stale index must be tracked |
| Large report generation | durable job request / Jakarta Batch | Yes | User needs status/retry |
| Nightly recalculation | Jakarta Batch | Yes | Checkpoint/restart important |
| In-memory notification | after-commit callback | No | Non-critical only |

---

## 17. Failure Matrix

### 17.1 Submit async task before commit

| Failure | Result |
|---|---|
| Caller rollback after task success | external side effect contradicts DB |
| Worker reads before commit | stale/blocking read |
| Server crash before task run | lost task |
| Worker exception | caller may already return success |
| Redeploy | task may be interrupted/lost |

### 17.2 Outbox pattern

| Failure | Result |
|---|---|
| Caller rollback | no outbox row, no side effect |
| Caller commit | outbox row durable |
| Server crash after commit | worker can resume later |
| Worker fails before side effect | retry safe |
| Worker succeeds side effect but fails DB update | possible duplicate; needs idempotency |
| Poison payload | mark failed permanent, require operator action |

### 17.3 Jakarta Batch

| Failure | Result |
|---|---|
| Step fails before checkpoint | restart from previous checkpoint |
| Writer partial external side effect | needs idempotent writer |
| Node crash | job repository determines restart state |
| Bad record | skip/retry policy required |
| Job stopped | restart depends checkpoint and step status |

---

## 18. Transaction Propagation Illusions

### 18.1 “Managed executor means transaction propagates”

Tidak aman diasumsikan.

Managed executor berarti container mengelola execution environment. Tetapi transaction propagation punya aturan lebih ketat daripada context propagation umum.

### 18.2 “CompletableFuture akan ikut transaction karena dipanggil di method transactional”

Salah.

```java
@Transactional
public void handle() {
    CompletableFuture.runAsync(() -> repository.save(...));
}
```

Jika tidak memakai managed executor, ini bisa lebih buruk karena memakai `ForkJoinPool.commonPool()`. Jika memakai managed executor pun, worker tetap harus punya transaction boundary sendiri.

### 18.3 “Kalau exception di async task, transaction caller rollback”

Tidak otomatis.

```java
Future<?> f = executor.submit(...);
```

Jika caller tidak `get()`, exception tinggal di `Future` atau listener/log. Bahkan jika caller `get()`, timing-nya bisa membuat request thread menunggu dan kehilangan manfaat async.

### 18.4 “`REQUIRES_NEW` selalu bekerja”

Hanya jika method dipanggil melalui container proxy/interceptor. Self-invocation atau object manual bisa melewati transaction interceptor.

---

## 19. Safe Async Service Template

### 19.1 Command object

```java
public record CaseEmailCommand(
    long caseId,
    long caseVersion,
    String initiatedBy,
    String correlationId
) {}
```

Command berisi value, bukan entity managed.

---

### 19.2 Request service

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;

@ApplicationScoped
public class CaseApprovalService {

    @Inject
    CaseRepository caseRepository;

    @Inject
    OutboxRepository outboxRepository;

    @Transactional
    public void approve(long caseId, String actor, String correlationId) {
        CaseEntity c = caseRepository.findForUpdate(caseId);
        c.approve(actor);

        CaseEmailCommand command = new CaseEmailCommand(
            c.getId(),
            c.getVersion(),
            actor,
            correlationId
        );

        outboxRepository.insertPending(
            "CASE_APPROVED_EMAIL",
            "CASE:" + c.getId() + ":VERSION:" + c.getVersion(),
            Json.serialize(command)
        );
    }
}
```

---

### 19.3 Dispatcher

```java
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class OutboxDispatcher {

    @Inject
    ManagedExecutorService executor;

    @Inject
    OutboxProcessor processor;

    public void dispatch(long eventId) {
        executor.submit(() -> processor.process(eventId));
    }
}
```

---

### 19.4 Processor with independent transaction

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;

@ApplicationScoped
public class OutboxProcessor {

    @Inject
    OutboxRepository outboxRepository;

    @Inject
    EmailGateway emailGateway;

    @Transactional
    public void process(long eventId) {
        OutboxEvent event = outboxRepository.findForUpdate(eventId);

        if (!event.canProcess()) {
            return;
        }

        event.incrementAttempt();

        CaseEmailCommand command = Json.deserialize(
            event.getPayloadJson(),
            CaseEmailCommand.class
        );

        String key = event.getIdempotencyKey();

        emailGateway.sendApprovalEmail(command, key);

        event.markSucceeded();
    }
}
```

Catatan: untuk side effect yang tidak idempotent, kamu perlu side-effect log atau idempotency support dari downstream.

---

## 20. Claiming Work Safely in Cluster

Dalam cluster, beberapa node bisa mengambil outbox/job yang sama.

### 20.1 Naive query

```sql
SELECT * FROM OUTBOX_EVENT
WHERE STATUS = 'PENDING'
ORDER BY CREATED_AT
FETCH FIRST 100 ROWS ONLY;
```

Problem: dua node bisa membaca row yang sama.

---

### 20.2 Claim dengan lock

Database tertentu mendukung `FOR UPDATE SKIP LOCKED`.

```sql
SELECT *
FROM OUTBOX_EVENT
WHERE STATUS IN ('PENDING', 'FAILED_RETRYABLE')
  AND (NEXT_ATTEMPT_AT IS NULL OR NEXT_ATTEMPT_AT <= CURRENT_TIMESTAMP)
ORDER BY CREATED_AT
FETCH FIRST 100 ROWS ONLY
FOR UPDATE SKIP LOCKED;
```

Lalu dalam transaction:

```text
mark CLAIMED
set claimed_by=nodeId
set claimed_at=now
commit
```

Setelah itu proses dapat dilakukan.

---

### 20.3 Lease-based claim

```sql
ALTER TABLE OUTBOX_EVENT ADD (
    CLAIMED_BY VARCHAR2(100),
    CLAIMED_AT TIMESTAMP,
    CLAIM_UNTIL TIMESTAMP
);
```

Worker boleh mengambil:

```text
STATUS=PENDING
OR STATUS=CLAIMED but CLAIM_UNTIL < now
```

Ini penting untuk recovery jika node mati setelah claim.

---

## 21. Retry, Rollback, dan Status Transition

### 21.1 Jangan hanya rollback untuk semua failure

Jika worker selalu rollback transaction saat gagal, kamu bisa kehilangan informasi attempt/error.

Buruk:

```java
@Transactional
public void process(long eventId) {
    OutboxEvent event = repo.findForUpdate(eventId);
    event.incrementAttempt();
    callExternalApi(); // throws
    event.markSent();
}
```

Jika exception menyebabkan rollback, `attemptCount` ikut rollback.

---

### 21.2 Catat failure dalam transaction terpisah

Pola:

```text
TX-1 claim/increment attempt
outside or TX-2 do work
TX-3 mark success/failure
```

Atau:

```java
public void processSafely(long eventId) {
    try {
        claim(eventId);               // TX A
        performSideEffect(eventId);   // may have its own boundary
        markSuccess(eventId);         // TX B
    } catch (RetryableException e) {
        markRetryableFailure(eventId, e); // TX C
    } catch (PermanentException e) {
        markPermanentFailure(eventId, e); // TX D
    }
}
```

Transactional methods harus berada pada bean/proxy berbeda jika perlu interceptor.

---

### 21.3 Retry scheduling

```java
Duration delay = switch (attempt) {
    case 1 -> Duration.ofSeconds(30);
    case 2 -> Duration.ofMinutes(2);
    case 3 -> Duration.ofMinutes(10);
    default -> Duration.ofHours(1);
};

nextAttemptAt = now.plus(delay).plus(jitter());
```

Retry policy harus disimpan durable, bukan hanya `Thread.sleep()` di worker.

---

## 22. Transaction Timeout Design

Ada beberapa timeout berbeda:

| Timeout | Arti |
|---|---|
| Request timeout | batas HTTP/request client menunggu |
| Transaction timeout | batas transaction boleh aktif |
| DB query timeout | batas query tertentu |
| Lock wait timeout | batas menunggu lock |
| HTTP client timeout | batas call downstream |
| Executor queue timeout | batas task menunggu sebelum dianggap stale |
| Business SLA timeout | batas waktu bisnis untuk completion |

Kesalahan umum: menaikkan transaction timeout untuk menyembunyikan desain long-running transaction.

Lebih baik:

```text
short transaction + durable progress + retryable step
```

Daripada:

```text
one giant transaction for 45 minutes
```

---

## 23. Isolation Level and Async Visibility

### 23.1 Read committed

Worker hanya melihat data yang sudah commit. Jika worker mulai sebelum commit caller, ia mungkin melihat old state.

### 23.2 Repeatable read / serializable

Worker dapat mengalami blocking, serialization failure, atau retry requirement lebih tinggi.

### 23.3 Locking

Jika caller memegang lock lalu worker mencoba membaca/update row sama:

```text
caller TX holds lock
worker waits
caller waits for worker future
```

Ini bisa menjadi deadlock/timeout.

Anti-pattern:

```java
@Transactional
public void approve(long caseId) throws Exception {
    CaseEntity c = repo.findForUpdate(caseId);

    Future<?> f = executor.submit(() -> service.doSomething(caseId));

    f.get(); // caller waits while still holding transaction lock
}
```

Ini menggabungkan kelemahan sync dan async.

---

## 24. Persistence Context Across Async Boundary

### 24.1 Jangan membawa managed entity

Managed entity terkait dengan persistence context. Persistence context tidak didesain untuk diakses lintas thread.

Buruk:

```java
executor.submit(() -> entity.setFlag(true));
```

Lebih aman:

```java
executor.submit(() -> service.updateFlag(entity.getId()));
```

### 24.2 Jangan membawa lazy proxy

Buruk:

```java
List<Attachment> attachments = caseEntity.getAttachments();
executor.submit(() -> attachments.size());
```

Jika collection lazy belum initialized, worker dapat gagal karena persistence context sudah tertutup.

### 24.3 Gunakan DTO immutable

Untuk data kecil yang memang snapshot:

```java
public record ApprovalEmailSnapshot(
    long caseId,
    String caseNo,
    String applicantEmail,
    Instant approvedAt
) {}
```

Tetapi pahami bahwa snapshot bisa stale. Untuk keputusan bisnis penting, worker harus reload state.

---

## 25. Transactional Events vs Async Work

CDI/Jakarta memiliki konsep event dan transactional observer di beberapa konteks. Prinsipnya:

- event in-process bukan durable queue,
- transactional observer dapat membantu after-success semantics,
- tetapi tidak menggantikan outbox untuk work penting.

Decision:

```text
Need reliable execution after crash? -> outbox/message/batch
Need local decoupling only? -> event/listener possible
Need async but not durable? -> managed executor possible
```

---

## 26. Request Success vs Work Completion

Dalam async design, response `200 OK` bisa berarti beberapa hal berbeda:

### 26.1 Accepted only

```text
HTTP 202 Accepted
Case approval requested
Async work pending
```

### 26.2 Domain state committed

```text
HTTP 200 OK
Case approved
Notification may still be pending
```

### 26.3 End-to-end completed

```text
HTTP 200 OK
Case approved and email sent and registry synced
```

Jangan mencampur semantics. API contract harus jelas.

Untuk workload async penting, biasanya lebih jujur:

```http
202 Accepted
Location: /jobs/{jobId}
```

Atau response domain:

```json
{
  "caseId": 123,
  "status": "APPROVED",
  "postCommitWork": [
    { "type": "EMAIL", "status": "PENDING" },
    { "type": "REGISTRY_SYNC", "status": "PENDING" }
  ]
}
```

---

## 27. Regulatory Defensibility Model

Untuk sistem enforcement/case management, async transaction design harus bisa menjawab:

1. Siapa yang memulai work?
2. Transaction mana yang mengubah state bisnis?
3. Apakah side effect terjadi setelah commit?
4. Jika gagal, apakah failure tercatat?
5. Apakah retry dilakukan sesuai policy?
6. Apakah duplicate dicegah atau ditoleransi?
7. Apakah operator melakukan manual retry/cancel?
8. Apakah evidence cukup untuk audit?

Minimal audit fields:

```text
initiated_by
initiated_role
execution_identity
correlation_id
business_key
transactional_state_before
transactional_state_after
outbox_event_id
job_execution_id
attempt_count
last_error
operator_action
created_at
committed_at
processed_at
completed_at
```

---

## 28. Choosing Between ManagedExecutor, Messaging, and Batch

### 28.1 ManagedExecutorService

Gunakan ketika:

- task short-lived,
- tidak harus survive crash,
- work bisa hilang tanpa business inconsistency,
- butuh container-managed context/thread,
- fan-out kecil dalam request internal,
- after-commit best effort.

Contoh:

```text
refresh cache
parallel read from independent sources
best-effort notification
non-critical async metrics enrichment
```

---

### 28.2 Messaging / Outbox Publisher

Gunakan ketika:

- event harus durable,
- consumer bisa retry,
- loose coupling antar service,
- side effect penting,
- work dapat diproses eventual.

Contoh:

```text
case approved event
external registry sync
email notification
search indexing
```

---

### 28.3 Jakarta Batch

Gunakan ketika:

- data volume besar,
- perlu checkpoint/restart,
- step/chunk/partition model cocok,
- ada operator control plane,
- job punya status lifecycle,
- work bisa berlangsung lama.

Contoh:

```text
nightly ageing recalculation
bulk correspondence generation
data migration
large file ingestion
regulatory report generation
```

---

## 29. Java 8–25 Considerations

### 29.1 Java 8

- `CompletableFuture` tersedia.
- Jakarta era lama masih banyak `javax.*`.
- Tidak ada virtual threads.
- Async DB work berarti platform thread blocking.

### 29.2 Java 11/17

- Banyak enterprise runtime modern bergerak ke Java 11/17.
- Observability/JFR lebih matang dibanding Java 8.
- Tetap tidak ada virtual threads.

### 29.3 Java 21

- Virtual threads final.
- Membuat blocking I/O lebih scalable untuk banyak task pendek.
- Tidak menghapus kebutuhan transaction boundary.
- Tidak membuat JPA/JTA otomatis aman lintas async boundary.

### 29.4 Java 25

- Structured concurrency masih preview.
- Scoped values relevan untuk context propagation model modern.
- Namun Jakarta EE portability tetap bergantung spesifikasi/container.

Rule:

```text
Virtual threads improve execution scalability.
They do not solve atomicity, durability, idempotency, or auditability.
```

---

## 30. Testing Strategy

### 30.1 Unit test tidak cukup

Unit test biasanya tidak menangkap:

- transaction commit timing,
- rollback after async submit,
- persistence context closure,
- DB lock,
- crash recovery,
- duplicate processing,
- retry state.

### 30.2 Integration test cases

#### Case 1 — rollback should not create work

```text
Given approveCase throws after inserting outbox
When transaction rolls back
Then case status unchanged
And no outbox row exists
```

#### Case 2 — commit creates durable work

```text
Given approveCase succeeds
Then case status approved
And outbox row pending exists
```

#### Case 3 — worker failure increments attempt

```text
Given outbox pending
And email gateway returns 500
When worker processes event
Then status FAILED_RETRYABLE
And attempt_count = 1
And next_attempt_at set
```

#### Case 4 — duplicate worker claim

```text
Given two workers poll same event
When both attempt to claim
Then only one processes
```

#### Case 5 — idempotent duplicate

```text
Given side effect already logged success
When event retried
Then no duplicate external call is made
And event marked success/reconciled
```

#### Case 6 — stale business state

```text
Given event says case approved version 7
And case has since moved to cancelled version 8
When worker runs
Then worker applies business rule whether email is still valid
```

---

## 31. Operational Controls

Async transactional systems need operator visibility.

Minimum dashboard:

```text
pending work count by type
oldest pending age
retryable failure count
permanent failure count
attempt distribution
processing latency p50/p95/p99
success rate
external API error rate
duplicate suppression count
stale claim count
```

Minimum operator actions:

```text
retry event
cancel event
mark permanent failure
requeue stale claim
inspect payload
inspect audit chain
download error report
```

Minimum safety:

```text
operator action audited
reason mandatory for cancel/permanent failure
payload redacted for sensitive fields
retry limit enforced
manual override permission restricted
```

---

## 32. Common Anti-Patterns

### 32.1 Starting async work inside transaction for critical side effect

```java
@Transactional
public void approve() {
    updateDb();
    executor.submit(this::sendEmail);
}
```

Use outbox.

---

### 32.2 Passing JPA entity to async thread

```java
executor.submit(() -> process(entity));
```

Pass ID or immutable DTO.

---

### 32.3 Waiting for async result while holding transaction lock

```java
@Transactional
public void doWork() {
    Future<?> f = executor.submit(...);
    f.get();
}
```

This can cause lock contention/deadlock and usually defeats async purpose.

---

### 32.4 External API inside long DB transaction

```java
@Transactional
public void syncAll() {
    for (...) {
        api.call();
        updateDb();
    }
}
```

Split into small transactions and idempotent side effects.

---

### 32.5 Retry without idempotency

```text
external call timed out
retry blindly
```

Timeout does not mean downstream did not process.

---

### 32.6 Losing error state due rollback

```text
increment attempt inside transaction
throw exception
rollback removes attempt increment
retry forever with attempt_count 0
```

Record failure intentionally.

---

### 32.7 Treating transaction timeout as performance fix

Raising timeout may hide bad design. First ask whether transaction should be split.

---

## 33. Design Checklist

Before creating async transactional work, answer:

### Transaction boundary

- What transaction changes the core business state?
- What transaction records the async work request?
- Does async task start its own transaction?
- Are transaction timeouts bounded?

### Durability

- Can work be lost after commit?
- Is the queue durable or only memory?
- Can work resume after crash/redeploy?

### Idempotency

- What is the idempotency key?
- Can external side effect be safely repeated?
- Is duplicate suppression recorded?

### Visibility

- What does API response mean?
- Can user/operator see pending/failure state?
- Is retry/cancel audited?

### Context

- Are we passing managed entity or stable ID?
- Is security actor captured explicitly?
- Is correlation ID stored durably?

### Failure

- What happens if caller rolls back?
- What happens if worker crashes?
- What happens if external API times out?
- What happens if DB commit fails after side effect?
- What happens if two nodes process same work?

---

## 34. Thought Experiment: Case Approval + External Registry Sync

Requirement:

```text
When officer approves a license application:
1. Application status becomes APPROVED.
2. Applicant receives approval email.
3. External registry receives sync payload.
4. Audit trail must show who approved and whether notifications/sync succeeded.
5. If external registry fails, approval must remain approved, but sync must retry.
6. Duplicate approval email must not be sent.
```

Bad design:

```text
@Transactional approve()
  update application
  send email
  call registry
commit
```

Why bad:

- external calls inside transaction,
- slow approval response,
- rollback ambiguity,
- timeout risk,
- no durable retry,
- duplicate risk.

Better design:

```text
TX-1 approve command:
  update application APPROVED
  insert audit APPROVED
  insert outbox EMAIL_APPROVAL
  insert outbox REGISTRY_SYNC
  commit

Worker email:
  claim EMAIL_APPROVAL
  use idempotency key APPLICATION_APPROVED_EMAIL:{applicationId}:{version}
  send email
  mark SENT or retryable failure

Worker registry:
  claim REGISTRY_SYNC
  call registry with idempotency key
  mark SYNCED or retryable/permanent failure

Operator dashboard:
  application approved
  email status
  registry sync status
  retry/cancel actions audited
```

This separates:

```text
business decision durability
notification side effect
external integration side effect
operator recovery
```

That separation is the difference between “code works in happy path” and “system is defensible in production”.

---

## 35. Ringkasan

1. Async boundary harus dianggap sebagai transaction boundary.
2. Transaction tidak sama dengan ordinary context; ia berhubungan dengan resource, lock, timeout, rollback, commit, dan transaction manager state.
3. Managed executor menjaga container execution semantics, tetapi tidak otomatis memberi durability atau transaction propagation yang aman untuk semua kasus.
4. Jangan membawa managed entity/persistence context ke async thread.
5. Untuk critical side effect, gunakan outbox/job request/message/batch, bukan in-memory task saja.
6. External side effect tidak ikut rollback database transaction; idempotency wajib.
7. Long-running transaction adalah tanda desain perlu dipecah.
8. Retry harus durable, bounded, observable, dan audit-friendly.
9. API response harus jelas apakah berarti accepted, committed, atau fully completed.
10. Top-tier engineer tidak hanya bertanya “bagaimana menjalankan async”, tetapi “apa invariant setelah commit, rollback, retry, crash, duplicate, dan operator intervention”.

---

## 36. Latihan

### Latihan 1 — Identify boundary

Ambil satu use case di aplikasimu, misalnya:

```text
Submit application -> generate PDF -> send email -> sync registry
```

Pisahkan:

- domain transaction,
- durable work request,
- side effect,
- retry state,
- audit event.

### Latihan 2 — Failure timeline

Tuliskan timeline untuk failure berikut:

```text
DB commit succeeds.
Email send succeeds.
Worker crashes before marking SENT.
```

Jawab:

- apakah email akan retry?
- bagaimana duplicate dicegah?
- apa yang operator lihat?

### Latihan 3 — Transaction split

Refactor pseudocode ini:

```java
@Transactional
public void processAllCases() {
    for (Case c : caseRepository.findAll()) {
        externalApi.sync(c);
        c.markSynced();
    }
}
```

Menjadi desain dengan:

- claim,
- per-item transaction,
- idempotency key,
- retryable failure,
- permanent failure.

### Latihan 4 — API contract

Untuk endpoint:

```http
POST /cases/{id}/approve
```

Tentukan apakah response harus:

- `200 OK`,
- `202 Accepted`,
- atau `201 Created` job resource.

Jelaskan trade-off berdasarkan apakah email/registry sync harus selesai sebelum response.

---

## 37. Referensi

- Jakarta Concurrency 3.1 Specification — managed concurrency in Jakarta EE container.
- Jakarta Concurrency API — `ManagedExecutorService`, `ManagedScheduledExecutorService`, `ContextService`, `ManagedThreadFactory`.
- Jakarta Transactions 2.0 Specification — transaction manager, resource manager, thread association, transaction demarcation.
- Jakarta Transactions API — `jakarta.transaction.Transactional`, `UserTransaction`, transaction status and synchronization concepts.
- Jakarta CDI Specification — context lifecycle and limitations around asynchronous processes.
- OpenJDK JEP 444 — Virtual Threads, final in JDK 21.
- OpenJDK JEP 505 — Structured Concurrency, preview in JDK 25.
- OpenJDK JEP 506 — Scoped Values, preview in JDK 25.

---

## 38. Posisi dalam Seri

Kita sudah menyelesaikan:

```text
Part 0 — Orientation: Enterprise Concurrency & Batch Mental Model
Part 1 — Historical Map: Java EE Concurrency Utilities to Jakarta Concurrency
Part 2 — Container Integrity: Why Managed Concurrency Exists
Part 3 — ManagedExecutorService Deep Dive
Part 4 — ManagedScheduledExecutorService and Time-Based Workloads
Part 5 — ManagedThreadFactory and Thread Creation Without Losing Container Semantics
Part 6 — ContextService and Context Propagation
Part 7 — Transactions Across Asynchronous Boundaries
```

Berikutnya:

```text
Part 8 — Security, Identity, and Authorization in Async Execution
```

Seri belum selesai.

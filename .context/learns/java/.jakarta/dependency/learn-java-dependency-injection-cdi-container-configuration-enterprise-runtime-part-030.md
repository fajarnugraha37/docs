# Part 030 — Container Concurrency, Managed Executors, and Context Propagation

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-030.md`  
Target Java: 8 → 25  
Target Platform: Java EE / Jakarta EE, CDI, Enterprise Beans, Jakarta Concurrency, MicroProfile Context Propagation  
Level: Advanced / Enterprise Runtime Engineering

---

## 0. Why This Part Exists

Sampai part sebelumnya, kita sudah memahami:

- dependency graph dan runtime provider,
- container ownership model,
- CDI bean discovery,
- scope dan context,
- proxy dan method dispatch,
- qualifier/producer/conditional selection,
- lifecycle callback,
- Enterprise Beans,
- resource injection,
- configuration,
- profile,
- feature flag.

Sekarang kita masuk ke salah satu area yang paling sering menyebabkan bug produksi di enterprise Java:

> menjalankan pekerjaan secara asynchronous atau concurrent tanpa merusak kontrak container.

Di Java SE biasa, kita bisa membuat thread sendiri:

```java
new Thread(() -> doWork()).start();
```

atau memakai:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
```

Di aplikasi Jakarta EE / Java EE, pendekatan seperti ini sering terlihat sederhana, tetapi secara runtime dapat berbahaya karena thread tersebut tidak otomatis berada di bawah kendali container.

Container bukan hanya tempat menjalankan method. Container mengelola:

- security context,
- naming context,
- classloader context,
- transaction context,
- CDI context,
- resource lifecycle,
- request lifecycle,
- shutdown lifecycle,
- monitoring dan accounting,
- thread pool governance.

Ketika application code membuat thread sendiri, ia bisa keluar dari boundary ini.

Mental model utama part ini:

> Di enterprise runtime, concurrency bukan hanya soal “parallel execution”. Concurrency adalah soal menjalankan unit of work pada thread yang benar, dengan context yang benar, resource yang benar, lifecycle yang benar, dan failure semantics yang bisa dipertanggungjawabkan.

---

## 1. Core Problem: Java Thread Is Not Container Thread

Dalam Java SE, sebuah thread hanyalah eksekutor instruksi.

Dalam Jakarta EE, thread yang mengeksekusi request biasanya sudah disiapkan container dan diberi context tertentu.

Contoh request HTTP:

```text
Client request
   |
   v
Servlet/JAX-RS container thread
   |
   +-- security/caller context
   +-- request context
   +-- classloader context
   +-- naming context
   +-- transaction boundary maybe
   +-- CDI contextual resolution
   +-- resource access rules
```

Jika di tengah request kita membuat thread baru secara manual:

```java
@RequestScoped
public class CaseSubmissionResource {

    @Inject
    CaseSubmissionService service;

    public Response submit(CaseRequest request) {
        new Thread(() -> service.process(request)).start();
        return Response.accepted().build();
    }
}
```

Maka thread baru tersebut mungkin tidak memiliki:

- request context aktif,
- principal/caller identity,
- transaction association,
- naming context yang benar,
- CDI context propagation,
- classloader yang benar,
- observability correlation,
- shutdown coordination,
- container-managed error handling.

Bug yang muncul sering tidak langsung terlihat.

Contoh failure:

```text
jakarta.enterprise.context.ContextNotActiveException:
WELD-001303: No active contexts for scope type jakarta.enterprise.context.RequestScoped
```

atau:

```text
java.lang.IllegalStateException: No transaction associated with current thread
```

atau lebih parah: tidak ada exception, tetapi audit trail kehilangan user id, MDC trace id hilang, atau task tetap berjalan saat aplikasi sedang undeploy.

---

## 2. Unmanaged Thread Anti-Pattern

### 2.1 Bentuk Anti-Pattern

Beberapa bentuk umum:

```java
new Thread(runnable).start();
```

```java
ExecutorService executor = Executors.newFixedThreadPool(20);
executor.submit(task);
```

```java
CompletableFuture.supplyAsync(() -> work());
```

```java
Timer timer = new Timer();
timer.schedule(task, 1000L);
```

```java
ForkJoinPool.commonPool().submit(task);
```

Masalahnya bukan karena API ini buruk. API ini valid di Java SE. Masalahnya adalah di managed runtime, container tidak selalu mengetahui, mengatur, atau membersihkan thread tersebut.

### 2.2 Mengapa Berbahaya

| Risiko | Penjelasan |
|---|---|
| Lifecycle leak | Thread masih hidup setelah aplikasi undeploy/redeploy |
| Context loss | Security/request/CDI context tidak tersedia |
| Resource leak | Connection, classloader, atau object graph tertahan oleh thread |
| Shutdown broken | Container tidak bisa menunggu/menghentikan task secara benar |
| Classloader leak | Thread memegang reference ke classloader aplikasi lama |
| Pool explosion | Setiap aplikasi membuat thread pool sendiri tanpa governance |
| Observability gap | Trace id/MDC tidak ikut pindah |
| Transaction confusion | Developer mengira transaksi ikut, padahal tidak |
| Security bug | Task berjalan tanpa caller identity yang benar |

### 2.3 Classloader Leak Example

Saat redeploy:

```text
old deployment classloader
   |
   +-- static executor
           |
           +-- worker thread
                   |
                   +-- Runnable captures old application classes
```

Jika thread tidak berhenti, classloader lama tidak bisa di-GC.

Efek produksi:

- memory naik setelah beberapa redeploy,
- metaspace leak,
- behavior aneh karena dua versi class hidup bersamaan,
- restart server menjadi satu-satunya pemulihan.

---

## 3. Managed Concurrency Mental Model

Managed concurrency berarti:

> application meminta container menjalankan task; container memilih thread, menerapkan context policy, mengelola lifecycle, dan mengatur shutdown.

Diagram:

```text
Application code
   |
   | submit task
   v
ManagedExecutorService / ManagedScheduledExecutorService
   |
   +-- container-owned thread pool
   +-- context capture/clear policy
   +-- lifecycle coordination
   +-- resource governance
   +-- shutdown behavior
   |
   v
Task execution
```

Perbedaan kunci:

| Java SE Executor | Managed Executor |
|---|---|
| Dibuat application code | Disediakan container |
| Lifecycle manual | Lifecycle container-managed |
| Context tidak otomatis | Context bisa dipropagasi/dibersihkan |
| Shutdown tanggung jawab app | Shutdown terintegrasi container |
| Tidak tahu deployment | Tahu deployment/resource boundary |
| Cocok untuk Java SE | Cocok untuk Jakarta EE |

---

## 4. Jakarta Concurrency Overview

Jakarta Concurrency menyediakan API standar untuk concurrency dalam Jakarta EE tanpa merusak integrity container.

Komponen penting:

| API | Peran |
|---|---|
| `ManagedExecutorService` | Menjalankan task asynchronous di thread container-managed |
| `ManagedScheduledExecutorService` | Menjalankan task terjadwal di thread container-managed |
| `ContextService` | Membuat contextual object/proxy agar context tertentu ikut diterapkan |
| `ManagedThreadFactory` | Membuat thread managed oleh container ketika benar-benar butuh thread factory |
| `ManagedTask` | Memberi metadata/task listener ke task tertentu |
| `Trigger` | Menentukan jadwal custom untuk scheduled task |

Pada baseline modern Jakarta EE 11, Jakarta Concurrency 3.1 menjadi bagian dari platform dan membawa dukungan lebih baik terhadap CDI injection dan virtual thread support pada environment Java modern.

---

## 5. ManagedExecutorService

### 5.1 What It Is

`ManagedExecutorService` memperluas model `ExecutorService` untuk environment Jakarta EE.

Conceptually:

```text
ExecutorService + container-awareness
```

Ia dipakai untuk task pendek/asynchronous seperti:

- fire-and-forget local processing,
- post-response side effect yang masih berada di boundary aplikasi,
- parallel calls to independent external systems,
- asynchronous cache warmup,
- local audit enrichment,
- background validation,
- non-critical notification preparation.

### 5.2 Injection / Lookup

Tradisional Java EE/Jakarta EE:

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;

public class ReportService {

    @Resource
    private ManagedExecutorService executor;
}
```

Dengan Jakarta Concurrency modern, runtime dapat menyediakan resource concurrency sebagai injectable resource, dan beberapa platform juga mendukung integrasi CDI yang lebih nyaman.

Contoh konseptual:

```java
import jakarta.inject.Inject;
import jakarta.enterprise.concurrent.ManagedExecutorService;

@ApplicationScoped
public class ReportService {

    @Inject
    ManagedExecutorService executor;
}
```

Tetapi portability perlu diperhatikan. Untuk aplikasi yang harus portable lintas server, cek versi Jakarta Concurrency dan implementasi container.

### 5.3 Basic Usage

```java
@ApplicationScoped
public class NotificationDispatcher {

    @Resource
    ManagedExecutorService executor;

    public void dispatchLater(NotificationCommand command) {
        executor.submit(() -> sendNotification(command));
    }

    private void sendNotification(NotificationCommand command) {
        // external call, logging, retry, etc.
    }
}
```

### 5.4 Do Not Inject Request-Scoped Bean Directly Into Long Task

Contoh berbahaya:

```java
@RequestScoped
public class CurrentRequestContext {
    public String userId() { return "..."; }
}

@ApplicationScoped
public class AsyncService {

    @Inject
    CurrentRequestContext current;

    @Resource
    ManagedExecutorService executor;

    public void runAsync() {
        executor.submit(() -> {
            // may fail if request context not active
            String userId = current.userId();
        });
    }
}
```

Lebih aman:

```java
@ApplicationScoped
public class AsyncService {

    @Inject
    CurrentRequestContext current;

    @Resource
    ManagedExecutorService executor;

    public void runAsync() {
        String userIdSnapshot = current.userId();

        executor.submit(() -> {
            processForUser(userIdSnapshot);
        });
    }
}
```

Prinsip:

> Untuk asynchronous boundary, capture data yang dibutuhkan, bukan membawa seluruh request-scoped object graph.

---

## 6. ManagedScheduledExecutorService

### 6.1 Purpose

`ManagedScheduledExecutorService` dipakai untuk scheduling programmatic:

```java
@Resource
ManagedScheduledExecutorService scheduler;
```

Contoh:

```java
@ApplicationScoped
public class CacheWarmupService {

    @Resource
    ManagedScheduledExecutorService scheduler;

    public void scheduleWarmup() {
        scheduler.schedule(
            this::warmup,
            10,
            TimeUnit.SECONDS
        );
    }

    private void warmup() {
        // load reference data
    }
}
```

### 6.2 Scheduled Executor vs EJB Timer

| Concern | ManagedScheduledExecutorService | EJB Timer |
|---|---|---|
| Style | Programmatic Java concurrency | Enterprise Beans timer service |
| Persistence | Usually executor-style scheduling | Persistent timer supported |
| Transaction integration | Depends on task design | Stronger EJB container semantics |
| Use case | lightweight local scheduling | enterprise scheduled business callback |
| Clustering | implementation-specific concerns | server/container timer semantics |
| Migration | easier to map to SE/cloud patterns | useful for legacy EJB systems |

### 6.3 Do Not Use for Durable Workflow Alone

A scheduled executor is not a workflow engine.

If work must survive:

- node crash,
- pod eviction,
- server restart,
- cluster failover,
- exactly-once/at-least-once business guarantees,

then consider:

- persistent EJB timer,
- database-backed job table,
- batch framework,
- message broker,
- workflow engine,
- Kubernetes CronJob plus idempotent worker.

---

## 7. Context: The Hard Part

Concurrency bugs in container apps usually come from misunderstanding context.

Context means “ambient runtime information associated with current execution”.

Important contexts:

| Context | Example |
|---|---|
| Classloader context | which app deployment classes are visible |
| Naming/JNDI context | which resources can be looked up |
| Security context | caller principal, roles |
| Transaction context | active JTA transaction |
| CDI request context | request-scoped bean instances |
| CDI session context | session-scoped bean instances |
| Application context | application-scoped contextual instances |
| Locale context | user locale |
| MDC/logging context | trace id, request id, correlation id |
| OpenTelemetry context | tracing span context |
| Tenant context | agency/tenant id |
| Feature flag context | user/org/environment used for flag evaluation |

ThreadLocal-based frameworks make this harder because context often appears “magically available” on the original thread.

When execution moves to a different thread, ThreadLocal state is usually not there unless explicitly propagated.

---

## 8. Context Propagation vs Context Capture vs Context Snapshot

There are three different ideas that engineers often mix.

### 8.1 Context Propagation

Move selected ambient context from parent execution to child execution.

Example:

```text
request thread has security + trace context
   |
   | submit task
   v
worker thread receives selected contexts
```

### 8.2 Context Capture

Take a snapshot at task submission time.

Example:

```java
String userId = currentUser.id();
String correlationId = mdc.get("correlationId");
```

Then pass explicitly:

```java
executor.submit(() -> process(userId, correlationId));
```

### 8.3 Context Recalculation

Child execution does not inherit parent context. It reconstructs what it needs from explicit inputs.

Example:

```java
executor.submit(() -> {
    Tenant tenant = tenantRepository.findById(command.tenantId());
    FeatureEvaluationContext flags = featureContextFactory.forTenant(tenant);
});
```

### 8.4 Which Is Better?

| Need | Prefer |
|---|---|
| Audit user id | explicit capture |
| Trace/log correlation | propagation or explicit capture |
| Security authorization | usually explicit decision before async boundary, or controlled propagation |
| Request-scoped bean state | avoid propagation; pass immutable command |
| Transaction | do not assume propagation; create clear boundary |
| Tenant | explicit command field or controlled context propagation |
| Feature flag | explicit evaluation snapshot or stable context object |

Rule:

> Propagate technical context carefully. Pass business context explicitly.

---

## 9. MicroProfile Context Propagation

MicroProfile Context Propagation exists because plain `CompletionStage` / `CompletableFuture` chains can move work across threads and lose context.

It provides:

| API | Purpose |
|---|---|
| `ManagedExecutor` | Executor integrated with context propagation for async stages |
| `ThreadContext` | Capture/contextualize individual actions like `Runnable`, `Callable`, `Function`, `Supplier` |

### 9.1 ManagedExecutor Example

```java
import org.eclipse.microprofile.context.ManagedExecutor;
import jakarta.inject.Inject;

@ApplicationScoped
public class ExternalAggregationService {

    @Inject
    ManagedExecutor executor;

    public CompletionStage<AggregateResult> aggregate(String caseId) {
        CompletionStage<PartyInfo> party = executor.supplyAsync(() -> loadParty(caseId));
        CompletionStage<RiskInfo> risk = executor.supplyAsync(() -> loadRisk(caseId));

        return party.thenCombine(risk, AggregateResult::new);
    }
}
```

The purpose is not merely “more threads”. The purpose is context-aware async composition.

### 9.2 ThreadContext Example

```java
import org.eclipse.microprofile.context.ThreadContext;
import jakarta.inject.Inject;

@ApplicationScoped
public class AuditAsyncBridge {

    @Inject
    ThreadContext threadContext;

    @Resource
    ManagedExecutorService executor;

    public void submit(AuditCommand command) {
        Runnable contextualTask = threadContext.contextualRunnable(() -> {
            writeAudit(command);
        });

        executor.submit(contextualTask);
    }
}
```

### 9.3 Propagated vs Cleared vs Unchanged

Context propagation frameworks commonly distinguish:

- propagated context,
- cleared context,
- unchanged context.

Conceptual example:

```java
ManagedExecutor executor = ManagedExecutor.builder()
    .propagated(ThreadContext.SECURITY, ThreadContext.APPLICATION)
    .cleared(ThreadContext.TRANSACTION)
    .build();
```

Meaning:

- propagate security/application context,
- explicitly clear transaction context,
- avoid accidental transaction leakage.

Exact supported context types depend on implementation and available providers.

---

## 10. Transaction Context and Async Boundaries

This is one of the most important points.

> Do not assume transaction automatically follows asynchronous execution.

A transaction is usually associated with a thread and managed by container/interceptor boundaries.

Bad mental model:

```text
@Transactional method starts transaction
   |
   +-- submit async task
          |
          +-- async task uses same transaction
```

Better mental model:

```text
@Transactional method starts transaction on request thread
   |
   +-- submit async task command
   |
   +-- transaction commits/rolls back

async task later runs on managed executor thread
   |
   +-- no inherited transaction unless explicitly defined by runtime/policy
   +-- should create its own transaction boundary if it writes DB
```

### 10.1 Dangerous Example

```java
@Transactional
public void submitCase(CaseCommand command) {
    caseRepository.save(command);

    executor.submit(() -> {
        // Wrong assumption: this is part of same transaction
        auditRepository.saveAudit(command);
    });
}
```

Possible outcomes:

- audit runs before main transaction commits,
- audit runs after main transaction rolls back,
- audit fails independently,
- audit sees uncommitted/missing data,
- audit writes inconsistent record.

### 10.2 Safer Patterns

#### Pattern A — After Commit Event / Transactional Observer

```java
@Transactional
public void submitCase(CaseCommand command) {
    CaseSubmitted event = caseService.submit(command);
    events.fire(event);
}
```

Observer:

```java
public void afterSuccess(
    @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseSubmitted event
) {
    executor.submit(() -> auditWriter.write(event.toAuditCommand()));
}
```

#### Pattern B — Outbox

```text
business transaction
   |
   +-- write case
   +-- write outbox event
   |
commit
   |
background worker polls outbox
   |
publish/process idempotently
```

For durable side effects, outbox is often superior.

#### Pattern C — Explicit New Transaction in Worker

```java
executor.submit(() -> auditService.writeInNewTransaction(command));
```

Where `auditService.writeInNewTransaction` is a container-invoked method with its own transactional boundary.

Important: self-invocation still matters. The transactional method must be invoked through the container proxy.

---

## 11. CDI Request Context and Async Execution

`@RequestScoped` is tied to active request context.

In HTTP request:

```text
request begins
   |
request context active
   |
resource/service executes
   |
request ends
   |
request context destroyed
```

If async task executes after request ends, request-scoped instances are gone.

### 11.1 Bad Example

```java
@RequestScoped
public class CurrentUser {
    public String id() { return "..."; }
}

@ApplicationScoped
public class Worker {

    @Inject
    CurrentUser currentUser;

    @Resource
    ManagedExecutorService executor;

    public void runLater() {
        executor.submit(() -> {
            sendEmail(currentUser.id());
        });
    }
}
```

Even if injection succeeds, the proxy may fail when used later because the request context is no longer active.

### 11.2 Better

```java
public void runLater() {
    String userId = currentUser.id();
    executor.submit(() -> sendEmail(userId));
}
```

### 11.3 Best for Complex Jobs

Create immutable command:

```java
public record NotificationJob(
    String userId,
    String caseId,
    String tenantId,
    String correlationId,
    Instant requestedAt
) {}
```

Submit:

```java
NotificationJob job = new NotificationJob(
    currentUser.id(),
    command.caseId(),
    tenantContext.tenantId(),
    correlation.currentId(),
    clock.instant()
);

executor.submit(() -> notificationWorker.process(job));
```

Now async boundary is explicit and testable.

---

## 12. Security Context Propagation

Security context is tricky because blindly propagating identity can be dangerous.

Questions to ask:

1. Should the async work act as the original caller?
2. Should it act as the application/system?
3. Should it perform authorization before the async boundary?
4. Should it store user identity only for audit, not authorization?
5. What happens if user loses permission after task is queued?

### 12.1 Audit Identity vs Execution Identity

These are not always the same.

```text
Audit identity: who requested this work?
Execution identity: under whose permission is this work performed?
```

Example:

```java
public record CaseExportJob(
    String requestedByUserId,
    String executionMode,
    String caseId
) {}
```

A background export may execute as system but audit the original requester.

### 12.2 Authorization Snapshot

For sensitive operations, you may need to authorize synchronously before queueing:

```java
public void requestExport(String caseId) {
    authorization.checkCanExport(currentUser.id(), caseId);

    ExportJob job = new ExportJob(
        currentUser.id(),
        caseId,
        Instant.now()
    );

    executor.submit(() -> exportWorker.export(job));
}
```

For long-running tasks, you may need both:

- authorization at request time,
- revalidation at execution time.

This depends on domain risk.

---

## 13. Logging MDC and Trace Context

A common production symptom:

```text
HTTP request log has correlationId=abc
async task log has correlationId=null
```

This happens because MDC is often ThreadLocal-based.

### 13.1 Explicit Capture Pattern

```java
String correlationId = MDC.get("correlationId");

executor.submit(() -> {
    try (MDC.MDCCloseable ignored = MDC.putCloseable("correlationId", correlationId)) {
        doWork();
    }
});
```

But this is easy to forget and easy to leak if not cleared.

### 13.2 Contextual Wrapper Pattern

Create a reusable wrapper:

```java
public final class MdcPropagatingRunnable implements Runnable {
    private final Map<String, String> captured;
    private final Runnable delegate;

    public MdcPropagatingRunnable(Runnable delegate) {
        this.captured = MDC.getCopyOfContextMap();
        this.delegate = delegate;
    }

    @Override
    public void run() {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            if (captured != null) {
                MDC.setContextMap(captured);
            } else {
                MDC.clear();
            }
            delegate.run();
        } finally {
            if (previous != null) {
                MDC.setContextMap(previous);
            } else {
                MDC.clear();
            }
        }
    }
}
```

But in Jakarta/MicroProfile environment, prefer platform-supported context propagation where available.

### 13.3 Observability Rule

Every async task should have:

- correlation id,
- task id,
- parent request id if applicable,
- tenant/agency id if applicable,
- operation name,
- outcome,
- duration,
- failure reason.

---

## 14. CompletableFuture in Container Code

`CompletableFuture` is useful but dangerous when used carelessly.

### 14.1 Bad Default

```java
CompletableFuture.supplyAsync(() -> callExternalSystem());
```

Without executor, it commonly uses a default/common pool.

In managed runtime, that means:

- unmanaged thread pool,
- no container context policy,
- poor resource governance.

### 14.2 Better

```java
CompletableFuture.supplyAsync(
    () -> callExternalSystem(),
    managedExecutorService
);
```

or with MicroProfile:

```java
managedExecutor.supplyAsync(() -> callExternalSystem());
```

### 14.3 Chain Awareness

Even if first stage uses managed executor, later async stages may use default executor if not specified.

Risky:

```java
CompletableFuture
    .supplyAsync(() -> loadA(), managedExecutor)
    .thenApplyAsync(a -> enrich(a)); // executor missing
```

Better:

```java
CompletableFuture
    .supplyAsync(() -> loadA(), managedExecutor)
    .thenApplyAsync(a -> enrich(a), managedExecutor);
```

With MicroProfile `ManagedExecutor`, dependent stages can be configured for context propagation and execution behavior.

---

## 15. Backpressure and Bounded Work

Concurrency is not free.

A common production failure:

```text
request rate increases
   |
async tasks increase
   |
executor queue grows
   |
DB/external system overloaded
   |
timeouts increase
   |
retry creates more tasks
   |
system collapses
```

### 15.1 Questions Before Adding Async

Ask:

1. What is the maximum number of concurrent tasks?
2. What is the queue size?
3. What happens when queue is full?
4. Is work idempotent?
5. Can work be dropped?
6. Can work be retried?
7. Who observes failure?
8. Does caller need result?
9. Does task use DB connection?
10. Does task call external service?
11. What is timeout?
12. What is cancellation behavior?
13. What is shutdown behavior?

### 15.2 Executor Sizing Mental Model

For CPU-bound work:

```text
threads ≈ number of cores
```

For blocking I/O-bound work:

```text
threads can be higher, but limited by downstream capacity
```

But in enterprise systems, sizing should be governed by the scarcest downstream resource:

- DB connection pool,
- external API rate limit,
- message broker throughput,
- CPU,
- memory,
- transaction log capacity,
- tenant fairness constraints.

### 15.3 Never Size Executor in Isolation

Bad:

```text
executor threads = 100
DB pool = 20
external API rate limit = 50/min
```

Result:

- 100 tasks compete for 20 DB connections,
- many block,
- timeout storm,
- retry storm.

Better:

```text
executor threads = min(DB capacity, external API budget, latency budget, node capacity)
```

---

## 16. Retry, Timeout, Cancellation, and Idempotency

Async work must have failure semantics.

### 16.1 Timeout

Every external call should have timeout:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(Duration.ofSeconds(3))
    .build();
```

Task-level timeout:

```java
Future<?> future = executor.submit(task);
future.get(5, TimeUnit.SECONDS);
```

But cancellation does not always stop blocking I/O unless the underlying API cooperates.

### 16.2 Retry

Retry without idempotency is dangerous.

Before retry:

- is operation idempotent?
- can duplicate side effect happen?
- is there an idempotency key?
- is there exponential backoff?
- is there jitter?
- is there max attempt?
- is there circuit breaking?

### 16.3 Idempotency Key

```java
public record NotificationJob(
    String jobId,
    String caseId,
    String recipientId,
    String templateCode
) {}
```

Persistence:

```text
notification_send_attempt
   job_id unique
   status
   attempts
   last_error
```

Then retry can be safe.

### 16.4 Cancellation

Cancellation is a request, not a guarantee.

```java
future.cancel(true);
```

The task must cooperate:

```java
while (!Thread.currentThread().isInterrupted()) {
    doSmallUnitOfWork();
}
```

In container code, cancellation and shutdown should be designed explicitly.

---

## 17. Virtual Threads in Java 21+ / Java 25 Context

Virtual threads change the cost model of blocking concurrency.

They are useful when:

- tasks are mostly blocking I/O,
- code is structured synchronously,
- high concurrency is needed,
- thread-per-task model simplifies logic.

But virtual threads do not remove enterprise runtime concerns:

- context propagation still matters,
- transaction boundary still matters,
- CDI context still matters,
- security context still matters,
- downstream capacity still matters,
- DB connection pool still matters,
- rate limit still matters,
- backpressure still matters.

### 17.1 Wrong Mental Model

```text
Virtual threads mean unlimited concurrency.
```

Correct:

```text
Virtual threads reduce thread overhead, not downstream capacity limits.
```

### 17.2 Example Capacity Trap

```text
10,000 virtual threads
   |
   +-- all call DB
          |
          +-- DB pool has 50 connections
```

Result:

- 9,950 tasks wait,
- latency increases,
- memory pressure still grows,
- timeout/retry storm possible.

### 17.3 Container Compatibility

In Jakarta EE 11 era, Jakarta Concurrency has moved toward better virtual-thread support. However, whether and how virtual threads are used is ultimately controlled by runtime/container implementation and configuration.

Rule:

> In Jakarta EE, do not bypass container just because virtual threads exist. Prefer container-supported concurrency resources that can use modern JVM capabilities safely.

---

## 18. Request Async vs Background Async

Not all async is the same.

### 18.1 Request Async

The caller is still waiting for response eventually.

Example:

```text
request starts
   |
start async servlet/JAX-RS processing
   |
worker completes result
   |
response returned
```

Characteristics:

- latency matters,
- timeout tied to request,
- cancellation matters,
- request context may be specially managed by framework/container,
- error must map to HTTP response.

### 18.2 Background Async

Caller receives response before work completes.

Example:

```text
POST /exports
   |
202 Accepted {jobId}
   |
background export continues
```

Characteristics:

- durable tracking often needed,
- status endpoint needed,
- idempotency needed,
- retry/dead-letter needed,
- user identity must be captured,
- request context should not be assumed.

### 18.3 Different Design

Do not implement durable background jobs as hidden `executor.submit()` inside request unless failure can be lost.

For important work, create a job record:

```text
export_job
   id
   requested_by
   status
   created_at
   started_at
   completed_at
   attempts
   last_error
```

Then a worker processes it.

---

## 19. Enterprise Beans Async vs ManagedExecutor

Jakarta Enterprise Beans has `@Asynchronous`.

Example:

```java
@Stateless
public class ExportBean {

    @Asynchronous
    public Future<ExportResult> export(String caseId) {
        return new AsyncResult<>(doExport(caseId));
    }
}
```

### 19.1 When EJB Async Is Useful

- existing EJB-based application,
- want container-managed transaction/security behavior,
- business method naturally belongs to session bean,
- legacy code already uses EJB semantics.

### 19.2 When ManagedExecutor Is Better

- CDI-first codebase,
- functional composition with `CompletionStage`,
- explicit task object model,
- non-EJB runtime style,
- better separation between service and async orchestration.

### 19.3 Do Not Mix Blindly

Avoid this without clear reason:

```text
JAX-RS resource
   -> CDI service
      -> EJB async method
         -> ManagedExecutor task
            -> CompletableFuture common pool
```

You now have four concurrency semantics mixed.

Better:

```text
one concurrency orchestration boundary
clear transaction boundary
clear context propagation rule
clear observability rule
```

---

## 20. CDI Events Async vs ManagedExecutor

CDI supports asynchronous events via `fireAsync`.

Conceptually:

```java
event.fireAsync(new CaseSubmittedEvent(caseId));
```

This is useful for local async observer notification, but it is not automatically a durable event bus.

### 20.1 Use For

- local decoupled observers,
- non-critical side effects,
- in-process plugin hooks,
- post-processing that can fail independently if acceptable.

### 20.2 Avoid For

- durable cross-service workflow,
- regulatory-critical side effect,
- guaranteed delivery,
- exactly-once processing,
- integration event publishing without outbox.

### 20.3 Decision

| Requirement | Better Tool |
|---|---|
| In-process decoupling | CDI event |
| Async local work | ManagedExecutor |
| Durable event | Outbox + broker |
| Scheduled enterprise callback | EJB timer / scheduler |
| Long-running workflow | workflow engine / job table |

---

## 21. Resource Access From Async Tasks

Async tasks often use resources:

- JDBC datasource,
- JPA entity manager,
- JMS connection,
- HTTP client,
- cache client,
- file storage client.

### 21.1 EntityManager Warning

Do not pass request-scoped/transaction-scoped persistence context into async task.

Bad:

```java
@EntityManager
EntityManager em;

public void submit() {
    CaseEntity entity = em.find(CaseEntity.class, id);
    executor.submit(() -> {
        entity.setStatus(...); // detached? unsafe? transaction?
    });
}
```

Better:

```java
executor.submit(() -> caseWorker.process(caseId));
```

Inside worker:

```java
@Transactional
public void process(String caseId) {
    CaseEntity entity = repository.find(caseId);
    entity.process();
}
```

### 21.2 Connection Pool Awareness

Every async DB task may borrow connection.

If executor concurrency > DB pool capacity, tasks block.

Capacity formula should consider:

```text
HTTP request DB usage
+ async worker DB usage
+ scheduled job DB usage
+ migration/batch DB usage
<= DB pool capacity and DB server capacity
```

---

## 22. ThreadLocal Pitfalls

ThreadLocal is common for:

- security principal,
- tenant id,
- MDC,
- transaction association,
- locale,
- request id,
- feature evaluation context.

Problems:

1. child thread does not inherit value,
2. pooled thread may retain stale value if not cleared,
3. context from request A leaks to request B,
4. memory retained by ThreadLocal values,
5. virtual threads change assumptions but do not eliminate design issues.

### 22.1 Stale Context Leak

```java
TENANT.set("agency-a");
doWork();
// forgot TENANT.remove()
```

Later same worker thread processes agency B but still has agency A.

Correct:

```java
try {
    TENANT.set(job.tenantId());
    doWork();
} finally {
    TENANT.remove();
}
```

Even better: pass tenant explicitly where possible.

---

## 23. Designing an Async Command

A good async command is:

- immutable,
- serializable if needed,
- explicit about business identity,
- explicit about tenant/user/correlation,
- small enough,
- not holding managed beans/entities/resources,
- idempotency-aware.

Example:

```java
public record CaseScreeningJob(
    String jobId,
    String caseId,
    String tenantId,
    String requestedBy,
    String correlationId,
    Instant requestedAt,
    int attempt
) {}
```

Avoid:

```java
public class BadJob {
    EntityManager em;
    CaseEntity managedEntity;
    HttpServletRequest request;
    RequestScopedBean currentUser;
    Connection connection;
}
```

Rule:

> Async boundary should receive data, not runtime objects.

---

## 24. Failure Model for Async Tasks

Synchronous code has obvious failure path:

```text
method throws exception -> caller receives error
```

Async code needs explicit failure ownership.

Ask:

1. Who observes exception?
2. Where is failure stored?
3. Is it retried?
4. Is it visible to user?
5. Is there alerting?
6. Is partial side effect possible?
7. Can task be resumed?
8. Can duplicate execution happen?
9. What is the terminal state?

### 24.1 Bad

```java
executor.submit(() -> riskyWork());
```

If nobody calls `Future.get()`, exception may only be logged or lost depending on executor/task handling.

### 24.2 Better

```java
executor.submit(() -> {
    try {
        riskyWork();
        jobRepository.markSuccess(jobId);
    } catch (Exception e) {
        jobRepository.markFailed(jobId, e);
        alerting.notifyIfCritical(jobId, e);
    }
});
```

### 24.3 CompletionStage Failure

```java
managedExecutor
    .supplyAsync(() -> loadData(job))
    .thenApply(this::transform)
    .thenAccept(this::store)
    .exceptionally(ex -> {
        failureHandler.handle(job, ex);
        return null;
    });
```

But be careful: `exceptionally` returning null may hide failure if the caller expects propagation.

---

## 25. Shutdown Semantics

When application stops:

- should tasks finish?
- should tasks be cancelled?
- should new tasks be rejected?
- should in-flight task status be persisted?
- should task be resumed on next startup?

In container-managed executor, container participates in shutdown. But your business semantics still need design.

### 25.1 Graceful Shutdown Pattern

```text
shutdown begins
   |
stop accepting new work
   |
mark in-flight jobs as stopping or resumable
   |
allow short tasks to complete within timeout
   |
cancel/interrupt if necessary
   |
persist final state
```

### 25.2 Kubernetes / Cloud Runtime

In container orchestration:

- pod receives SIGTERM,
- readiness should fail,
- traffic stops,
- grace period begins,
- app must stop accepting work,
- background tasks need bounded shutdown.

Do not assume executor tasks can run forever.

---

## 26. Pattern: Synchronous Request + Durable Background Job

This pattern is common for enterprise case management.

### 26.1 Flow

```text
POST /cases/{id}/screening
   |
validate request
   |
authorize user
   |
create screening_job row
   |
commit
   |
return 202 Accepted + jobId

background worker
   |
claim pending job
   |
process with idempotency
   |
update status
   |
write audit
```

### 26.2 Why Good

- no hidden work lost after response,
- status visible,
- retry possible,
- audit possible,
- operation can survive restart,
- user sees job id,
- load can be throttled.

### 26.3 CDI Wiring

```java
@Path("/cases/{caseId}/screening")
@RequestScoped
public class ScreeningResource {

    @Inject
    ScreeningJobApplicationService service;

    @POST
    public Response request(@PathParam("caseId") String caseId) {
        ScreeningJobId jobId = service.requestScreening(caseId);
        return Response.accepted(new JobResponse(jobId.value())).build();
    }
}
```

```java
@ApplicationScoped
public class ScreeningJobApplicationService {

    @Inject
    CurrentUser currentUser;

    @Inject
    TenantContext tenantContext;

    @Inject
    ScreeningJobRepository jobs;

    @Transactional
    public ScreeningJobId requestScreening(String caseId) {
        ScreeningJob job = ScreeningJob.pending(
            caseId,
            tenantContext.id(),
            currentUser.id()
        );
        jobs.save(job);
        return job.id();
    }
}
```

Worker:

```java
@ApplicationScoped
public class ScreeningWorker {

    @Resource
    ManagedExecutorService executor;

    @Inject
    ScreeningJobProcessor processor;

    public void submit(ScreeningJobId jobId) {
        executor.submit(() -> processor.process(jobId));
    }
}
```

Processor:

```java
@ApplicationScoped
public class ScreeningJobProcessor {

    @Inject
    ScreeningJobRepository jobs;

    @Inject
    ScreeningGateway gateway;

    @Transactional
    public void process(ScreeningJobId jobId) {
        ScreeningJob job = jobs.claim(jobId);
        try {
            ScreeningResult result = gateway.screen(job.caseId());
            job.complete(result);
        } catch (Exception e) {
            job.fail(e);
        }
    }
}
```

Important: `process` should be invoked through CDI/container proxy if transaction interceptor is needed.

---

## 27. Pattern: Parallel External Calls Within a Request

Sometimes async is used to reduce latency, not background work.

Example:

```text
GET /case-summary/{id}
   |
parallel:
   +-- load case
   +-- load profile
   +-- load risk score
   +-- load outstanding tasks
   |
combine
   |
return response
```

### 27.1 Implementation

```java
@ApplicationScoped
public class CaseSummaryService {

    @Inject
    ManagedExecutor managedExecutor;

    public CompletionStage<CaseSummary> summary(String caseId) {
        CompletionStage<CaseData> caseData =
            managedExecutor.supplyAsync(() -> loadCase(caseId));

        CompletionStage<ProfileData> profile =
            managedExecutor.supplyAsync(() -> loadProfile(caseId));

        CompletionStage<RiskData> risk =
            managedExecutor.supplyAsync(() -> loadRisk(caseId));

        return caseData.thenCombine(profile, CaseSummaryPartial::new)
            .thenCombine(risk, CaseSummary::new);
    }
}
```

### 27.2 Must Have

- per-call timeout,
- bounded executor,
- fallback policy,
- partial response rule,
- correlation propagation,
- downstream rate limit,
- cancellation when request times out.

---

## 28. Pattern: Feature Flag Evaluation in Async Work

Feature flag decisions can be time-sensitive.

Question:

> Should async work use flag value at request time or execution time?

### 28.1 Request-Time Snapshot

Use when user action should be stable:

```java
boolean useNewScreening = flags.enabled("new-screening", context);

ScreeningJob job = new ScreeningJob(
    caseId,
    useNewScreening,
    requestedBy
);
```

Now job behavior is deterministic.

### 28.2 Execution-Time Evaluation

Use when operation should follow current operational state:

```java
public void process(ScreeningJob job) {
    if (flags.enabled("screening-worker-enabled", workerContext)) {
        run();
    }
}
```

Good for kill switch.

### 28.3 Rule

| Flag Type | Evaluation Time |
|---|---|
| release behavior chosen by user request | request-time snapshot |
| operational kill switch | execution-time |
| experiment variant | usually request-time snapshot |
| tenant rollout | depends on consistency requirement |
| safety fallback | execution-time |

---

## 29. Container Concurrency and Regulatory Systems

For regulatory/case management platforms, concurrency has domain implications.

Questions:

1. Can two officers process the same case concurrently?
2. Can screening result arrive after case state changed?
3. Can escalation run twice?
4. Can notification be sent after withdrawal?
5. Can enforcement deadline computation run with stale policy config?
6. Is audit event written once or per retry?
7. Should retry preserve original actor or system actor?
8. What happens if feature flag changes mid-case?
9. Is async task allowed to mutate closed case?
10. Does state machine guard every async callback?

### 29.1 State Guard Pattern

```java
@Transactional
public void applyScreeningResult(String caseId, ScreeningResult result) {
    CaseAggregate caze = repository.getForUpdate(caseId);

    if (!caze.canAcceptScreeningResult()) {
        audit.recordIgnoredLateResult(caseId, result.id());
        return;
    }

    caze.applyScreeningResult(result);
}
```

Async callback must not assume original state is still valid.

---

## 30. Testing Managed Concurrency

### 30.1 Unit Test Pure Logic

Make async command processing testable without container:

```java
class ScreeningJobProcessorTest {

    @Test
    void completesJobWhenGatewaySucceeds() {
        // instantiate processor with fake repository/gateway
    }
}
```

### 30.2 Integration Test Container Behavior

Test:

- executor injection works,
- context propagation works as expected,
- request context is not accidentally used,
- transaction boundary works,
- failure is recorded,
- MDC/correlation present,
- shutdown/rejection behavior if feasible.

### 30.3 Deterministic Executor for Tests

For unit tests, replace async executor with direct executor:

```java
class DirectExecutor implements Executor {
    @Override
    public void execute(Runnable command) {
        command.run();
    }
}
```

But do not let this hide real async race conditions. Use separate integration tests for actual concurrency.

### 30.4 Race Condition Tests

Test:

- duplicate job claim,
- concurrent update to same case,
- retry after partial failure,
- timeout while job still running,
- out-of-order callbacks,
- stale feature flag/config.

---

## 31. Observability Checklist

Every async/concurrent mechanism should emit structured telemetry.

### 31.1 Metrics

- tasks submitted,
- tasks started,
- tasks completed,
- tasks failed,
- tasks cancelled,
- task duration,
- queue size,
- active workers,
- retry count,
- dead-letter count,
- downstream timeout count,
- executor rejection count.

### 31.2 Logs

Each task log should include:

- job id,
- correlation id,
- tenant id,
- actor/requestedBy,
- operation,
- attempt,
- state transition,
- result.

### 31.3 Tracing

For distributed tracing:

- parent request span,
- async task span,
- external call spans,
- DB spans,
- publish/consume spans.

But be careful with long-running background tasks: trace duration may exceed useful request-span model. Use job-level trace correlation.

---

## 32. Design Decision Matrix

| Need | Recommended Mechanism |
|---|---|
| Run short local async task | `ManagedExecutorService` |
| Compose `CompletionStage` with context | MicroProfile `ManagedExecutor` |
| Contextualize one `Runnable`/`Supplier` | MicroProfile `ThreadContext` or Jakarta `ContextService` |
| Schedule lightweight programmatic task | `ManagedScheduledExecutorService` |
| Enterprise persistent timer | EJB Timer |
| Existing EJB business async | `@Asynchronous` |
| Durable background job | DB job table / outbox / broker |
| Cross-service event | outbox + message broker |
| Request parallelization | managed executor + bounded timeout |
| CPU-bound parallelism | bounded executor sized to CPU |
| Blocking I/O high concurrency | managed executor, possibly virtual-thread capable runtime, still bounded by downstream |
| Propagate user id for audit | explicit command field |
| Propagate security authorization | carefully; often authorize before boundary and/or revalidate |
| Propagate transaction | usually do not; create explicit transaction boundary |

---

## 33. Common Failure Catalog

### 33.1 ContextNotActiveException

Cause:

- request-scoped bean used outside active request context.

Fix:

- pass immutable data,
- activate context explicitly only when valid,
- avoid request-scoped dependency in background worker.

### 33.2 Lost Correlation ID

Cause:

- MDC/trace context not propagated.

Fix:

- use context propagation,
- explicit capture,
- task wrapper.

### 33.3 Transaction Not Active

Cause:

- async thread does not inherit transaction.

Fix:

- create explicit transaction boundary,
- use transactional observer/outbox,
- avoid assuming parent transaction.

### 33.4 Duplicate Side Effects

Cause:

- retry without idempotency,
- duplicate job claim,
- cluster race.

Fix:

- idempotency key,
- unique constraint,
- pessimistic/optimistic locking,
- state machine guard.

### 33.5 Thread Pool Exhaustion

Cause:

- unbounded queue,
- downstream slowness,
- too many blocking tasks.

Fix:

- bound concurrency,
- timeout,
- backpressure,
- rate limit,
- circuit breaker.

### 33.6 Classloader Leak

Cause:

- unmanaged executor/static thread survives redeploy.

Fix:

- managed executor,
- proper shutdown,
- avoid static executor in webapp.

### 33.7 Stale Tenant/User Context

Cause:

- ThreadLocal not cleared in pooled thread.

Fix:

- try/finally remove,
- context propagation framework,
- explicit command fields.

---

## 34. Code Review Checklist

Before approving concurrent/container code, ask:

- [ ] Does this create unmanaged threads?
- [ ] Does this use `CompletableFuture.supplyAsync` without executor?
- [ ] Is executor managed by container?
- [ ] Is concurrency bounded?
- [ ] Is queue bounded or rejection handled?
- [ ] Is timeout defined?
- [ ] Is retry idempotent?
- [ ] Are exceptions observed and persisted/logged?
- [ ] Are transaction boundaries explicit?
- [ ] Are request-scoped beans avoided in background tasks?
- [ ] Is user/tenant/correlation captured explicitly?
- [ ] Is security behavior defined?
- [ ] Is shutdown behavior defined?
- [ ] Is duplicate execution safe?
- [ ] Is state machine rechecked at callback time?
- [ ] Is observability sufficient?
- [ ] Is feature flag evaluation time chosen deliberately?
- [ ] Is test coverage enough for concurrency failure?

---

## 35. Top 1% Mental Model

A senior engineer may know how to write:

```java
executor.submit(task);
```

A top-tier enterprise engineer asks:

```text
Who owns this thread?
Which context is propagated?
Which context must be cleared?
What transaction boundary exists?
What happens if the parent request rolls back?
What happens if the task runs after request ends?
What happens if the task runs twice?
What happens if the server shuts down?
What happens if downstream slows down?
What happens if feature flag changes mid-flight?
What happens if tenant/user context is stale?
How is this observed, retried, cancelled, audited, and tested?
```

That is the difference between “concurrent code” and “production-grade managed concurrency”.

---

## 36. Summary

Key takeaways:

1. In Jakarta EE, do not treat concurrency as plain Java SE threading.
2. Prefer container-managed concurrency resources over unmanaged thread creation.
3. Async boundaries must explicitly define context, transaction, security, and failure behavior.
4. Pass business context explicitly; propagate technical context carefully.
5. `@RequestScoped` objects generally should not be used in background tasks.
6. Transactions do not magically follow async execution.
7. `CompletableFuture` should use a managed executor in container code.
8. Virtual threads reduce thread overhead but do not eliminate container/runtime constraints.
9. Durable work requires durable state, not just `executor.submit()`.
10. Observability, idempotency, and shutdown behavior are part of the design, not afterthoughts.

---

## 37. References

- Jakarta Concurrency 3.1 Specification — https://jakarta.ee/specifications/concurrency/3.1/
- Jakarta Concurrency 3.1 API — `ManagedExecutorService`
- Jakarta EE 11 Platform — https://jakarta.ee/specifications/platform/11/
- Jakarta EE Tutorial — Concurrency Utilities
- Jakarta CDI 4.1 Specification — https://jakarta.ee/specifications/cdi/4.1/
- MicroProfile Context Propagation — https://microprofile.io/specifications/microprofile-context-propagation/
- MicroProfile Config — https://microprofile.io/specifications/config/
- Java Virtual Threads / Project Loom, Java 21+

---

## 38. Next Part

Next:

```text
Part 031 — Testing CDI, EJB, and Configuration-Heavy Code
```

This series is not finished yet.

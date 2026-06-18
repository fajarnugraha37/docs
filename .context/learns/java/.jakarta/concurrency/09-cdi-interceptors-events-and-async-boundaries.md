# Part 9 — CDI, Interceptors, Events, and Async Boundaries

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `09-cdi-interceptors-events-and-async-boundaries.md`  
**Scope:** Java 8–25, Java EE/Jakarta EE, `javax.*` to `jakarta.*`, CDI, Interceptors, Events, Jakarta Concurrency  
**Baseline modern platform:** Jakarta EE 11, CDI 4.1, Jakarta Concurrency 3.1  
**Audience:** engineer yang sudah memahami Java concurrency dasar, CDI dasar, transaction dasar, security dasar, dan ingin memahami boundary enterprise runtime secara production-grade.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **bean object**, **CDI proxy**, **contextual instance**, dan **task object** ketika kode berjalan asynchronous.
2. Memahami kenapa object yang aman di request thread bisa menjadi tidak aman ketika dipakai di worker thread.
3. Menjelaskan apa yang terjadi pada `@RequestScoped`, `@SessionScoped`, `@ApplicationScoped`, `@Dependent`, dan custom scope saat melewati async boundary.
4. Mendesain async task yang tetap mendapatkan manfaat CDI tanpa membawa lifecycle context yang salah.
5. Memahami bagaimana interceptor bekerja, kenapa self-invocation sering menjebak, dan bagaimana async boundary mengubah ekspektasi interceptor.
6. Membedakan CDI event synchronous, asynchronous, transactional, dan executor-based workflow.
7. Menghindari bug production seperti stale contextual reference, leaked request data, lost interceptor, hidden side effect, dan event storm.
8. Membuat desain yang eksplisit untuk audit, correlation, cancellation, retry, observability, dan idempotency saat CDI dipakai bersama concurrency.

---

## 2. Problem yang Diselesaikan

Pada aplikasi Jakarta EE modern, CDI sering menjadi tulang punggung integrasi antar komponen:

- REST resource inject service.
- Service inject repository.
- Repository inject `EntityManager`.
- Service method diberi interceptor untuk logging, audit, transaction, metrics, authorization.
- Event dipakai untuk loose coupling.
- Background task dipakai untuk offload kerja berat.

Di request synchronous biasa, model ini terlihat sederhana:

```text
HTTP request
  -> JAX-RS resource
  -> CDI service proxy
  -> interceptor chain
  -> repository
  -> transaction
  -> response
```

Masalah muncul ketika workflow menjadi asynchronous:

```text
HTTP request
  -> JAX-RS resource
  -> submit async task
  -> response returned

managed worker thread later
  -> executes task
  -> uses CDI bean?
  -> uses request-scoped data?
  -> fires event?
  -> expects interceptor?
  -> expects transaction?
```

Pertanyaan pentingnya bukan hanya:

> “Apakah CDI bisa dipakai di background thread?”

Pertanyaan yang lebih tepat:

> “Context CDI mana yang valid, kapan ia aktif, siapa yang mengaktifkan, apa yang boleh dipropagasikan, dan apa yang harus direkonstruksi ulang sebagai execution context baru?”

Ini adalah inti bagian ini.

---

## 3. Mental Model Utama

### 3.1 CDI bukan sekadar dependency injection

Banyak engineer memahami CDI hanya sebagai:

```java
@Inject
MyService service;
```

Itu terlalu sempit.

CDI sebenarnya adalah kombinasi dari beberapa mekanisme runtime:

```text
CDI = type-safe resolution
    + lifecycle management
    + scopes/contextual instances
    + client proxies
    + interceptors/decorators
    + events
    + extension points
```

Dalam asynchronous execution, bagian yang paling sering bermasalah adalah:

1. **Scope** — instance mana yang sedang aktif?
2. **Context** — lifecycle context apa yang tersedia pada thread ini?
3. **Proxy** — proxy mengarah ke contextual instance yang mana?
4. **Interceptor** — apakah invocation masuk lewat proxy/interceptor chain atau bypass?
5. **Event** — observer dipanggil kapan, di thread siapa, dengan transaction apa?

---

### 3.2 Jangan mencampur object identity dengan contextual identity

Contoh sederhana:

```java
@Inject
CurrentUser currentUser;
```

Di request thread, `currentUser` mungkin terlihat seperti object biasa.

Namun jika `CurrentUser` adalah `@RequestScoped`, field tersebut sering kali bukan instance final sebenarnya, melainkan **client proxy**. Proxy akan resolve contextual instance berdasarkan context yang aktif saat method dipanggil.

Mental model:

```text
field currentUser
  bukan selalu CurrentUser instance final
  tetapi pintu/proxy menuju CurrentUser instance untuk context aktif saat ini
```

Di request thread:

```text
proxy -> request context active -> CurrentUser untuk request A
```

Di worker thread setelah request selesai:

```text
proxy -> request context tidak aktif -> ContextNotActiveException / invalid state
```

Atau lebih buruk, jika context dipropagasikan secara tidak benar:

```text
proxy -> stale request context -> data user lama terbawa ke task baru
```

---

### 3.3 Async boundary adalah lifecycle boundary

Dalam Part 7, kita sudah menetapkan prinsip:

```text
Async boundary harus diperlakukan sebagai transaction boundary.
```

Untuk CDI, prinsipnya mirip:

```text
Async boundary juga harus diperlakukan sebagai context lifecycle boundary.
```

Artinya:

- Jangan menganggap request context masih valid setelah request selesai.
- Jangan menyimpan contextual bean instance untuk dipakai nanti.
- Jangan membawa object graph dari request ke worker tanpa seleksi.
- Jangan mengandalkan interceptor request-time untuk execution-time behavior.
- Rekonstruksi execution context secara eksplisit di sisi task.

---

### 3.4 Ada dua jenis state dalam async task

Saat men-submit async task, bedakan:

#### A. Immutable command data

Ini aman dibawa melewati boundary.

Contoh:

```java
public record GenerateReportCommand(
    String requestId,
    Long reportId,
    String initiatedBy,
    Instant requestedAt
) {}
```

Karakteristik:

- serializable secara konseptual
- tidak bergantung pada thread
- tidak bergantung pada CDI context aktif
- tidak memegang connection, entity manager, request object, HTTP session
- bisa ditulis ke database/job table bila perlu durability

#### B. Runtime services

Ini sebaiknya di-resolve di execution side.

Contoh:

```java
@Inject ReportService reportService;
@Inject AuditService auditService;
@Inject EntityManager em;
```

Karakteristik:

- dikelola container
- lifecycle-nya mengikuti scope
- interceptor bisa berlaku jika dipanggil via proxy
- transaction/security/naming/classloader context dapat dikelola container

Prinsip:

```text
Pass data across async boundary.
Resolve services inside async execution boundary.
```

---

## 4. Taxonomy CDI Scope dalam Async Boundary

### 4.1 `@ApplicationScoped`

`@ApplicationScoped` biasanya paling aman dipakai dari async task karena instance-nya hidup sepanjang application lifecycle.

Namun “aman” bukan berarti bebas risiko.

Risiko utama:

- shared mutable state
- thread safety
- cache race condition
- lazy initialization race
- metrics counter tidak atomic
- state antar tenant/user bocor

Contoh buruk:

```java
@ApplicationScoped
public class ReportAccumulator {
    private final List<String> generatedReports = new ArrayList<>();

    public void add(String reportId) {
        generatedReports.add(reportId); // not thread-safe
    }
}
```

Jika dipanggil banyak async task, ini race condition.

Lebih baik:

```java
@ApplicationScoped
public class ReportAccumulator {
    private final Queue<String> generatedReports = new ConcurrentLinkedQueue<>();

    public void add(String reportId) {
        generatedReports.add(reportId);
    }
}
```

Namun top-tier design biasanya bertanya lebih jauh:

> “Apakah state ini memang harus in-memory? Bagaimana saat cluster? Bagaimana saat redeploy? Bagaimana saat node mati?”

Untuk regulatory/enterprise system, shared state penting biasanya lebih baik durable:

```text
DB table / cache with TTL / distributed lock / outbox / job repository
```

---

### 4.2 `@RequestScoped`

`@RequestScoped` valid selama request context aktif.

Dalam request synchronous:

```text
request starts -> request context active -> invoke service -> response -> request context destroyed
```

Dalam async:

```text
request starts
  -> create task capturing @RequestScoped proxy or object
  -> submit task
request ends
  -> request context destroyed
worker later
  -> task tries to use request-scoped dependency
  -> invalid
```

Contoh buruk:

```java
@RequestScoped
public class RequestInfo {
    private String correlationId;
    private String username;

    public String correlationId() {
        return correlationId;
    }
}

@ApplicationScoped
public class ExportResource {
    @Inject ManagedExecutorService executor;
    @Inject RequestInfo requestInfo;
    @Inject ExportService exportService;

    public void startExport(Long exportId) {
        executor.submit(() -> {
            exportService.generate(exportId, requestInfo.correlationId());
        });
    }
}
```

Masalah:

- `requestInfo` mungkin proxy ke request context.
- Worker thread belum tentu punya request context aktif.
- Request bisa sudah selesai.
- Data request tidak boleh diasumsikan hidup selama background task.

Desain lebih baik:

```java
public record ExportCommand(
    Long exportId,
    String correlationId,
    String initiatedBy,
    Instant requestedAt
) {}

@ApplicationScoped
public class ExportResource {
    @Inject ManagedExecutorService executor;
    @Inject RequestInfo requestInfo;
    @Inject ExportWorker worker;

    public void startExport(Long exportId) {
        ExportCommand command = new ExportCommand(
            exportId,
            requestInfo.correlationId(),
            requestInfo.username(),
            Instant.now()
        );

        executor.submit(() -> worker.run(command));
    }
}
```

Lalu worker menjalankan service dengan command data:

```java
@ApplicationScoped
public class ExportWorker {
    @Inject ExportService exportService;

    public void run(ExportCommand command) {
        exportService.generate(command);
    }
}
```

Poin penting:

```text
Ambil snapshot data request yang memang dibutuhkan.
Jangan membawa request-scoped bean ke task.
```

---

### 4.3 `@SessionScoped`

`@SessionScoped` lebih berbahaya untuk async background work.

Kenapa?

- Session bisa expire.
- User bisa logout.
- Node affinity bisa berubah.
- Session object bisa besar.
- Session bukan audit authority yang kuat untuk long-running job.
- Session state tidak cocok sebagai sumber kebenaran batch/background execution.

Contoh buruk:

```java
@SessionScoped
public class UserPreferences implements Serializable {
    private Locale locale;
    private ZoneId zoneId;
    private List<String> selectedModules;
}

executor.submit(() -> reportService.generateUsing(userPreferences));
```

Lebih baik snapshot value yang diperlukan:

```java
public record ReportRequestContext(
    String userId,
    Locale locale,
    ZoneId zoneId,
    List<String> selectedModules
) {}
```

Namun tetap validasi ulang di execution time:

```text
Apakah user masih berhak?
Apakah module masih ada?
Apakah job masih boleh berjalan?
Apakah parameter masih valid?
```

---

### 4.4 `@Dependent`

`@Dependent` sering tampak sederhana, tetapi justru mudah bocor.

`@Dependent` lifecycle mengikuti injection target. Jika dependent object di-inject ke task object yang hidup lama, object tersebut juga bisa hidup lama.

Contoh:

```java
public class HeavyParser {
    private byte[] buffer = new byte[100 * 1024 * 1024];
}

@ApplicationScoped
public class BatchCoordinator {
    @Inject HeavyParser parser; // dependent by default if no scope
}
```

Jika `HeavyParser` default dependent dan di-inject ke `@ApplicationScoped`, instance hidup sepanjang aplikasi.

Dalam async task, masalahnya bisa lebih halus:

```java
@Dependent
public class PerTaskState {
    private final List<Object> temporary = new ArrayList<>();
}
```

Jika disimpan di singleton service atau closure, state bisa leak.

Prinsip:

```text
Dependent object harus punya owner lifecycle yang jelas.
```

Untuk per-task state, sering lebih baik plain object/manual object:

```java
public final class ImportTaskState {
    private int processed;
    private int failed;
}
```

Atau gunakan CDI programmatic lookup dengan destruction jelas jika container mendukung pattern tersebut.

---

### 4.5 Custom scope

Custom scope lebih kompleks.

Contoh custom scope:

- tenant scope
- conversation/workflow scope
- job scope
- module scope
- request-correlation scope

Dalam async system, custom scope harus menjawab:

1. Siapa yang mengaktifkan scope?
2. Siapa yang menonaktifkan scope?
3. Apa key/context id-nya?
4. Apa yang terjadi jika task retry?
5. Apa yang terjadi jika worker thread reuse?
6. Apa yang terjadi jika execution pindah node?
7. Bagaimana cleanup saat failure/cancellation?

Tanpa jawaban ini, custom scope sering menjadi ThreadLocal leak berbungkus abstraksi indah.

---

## 5. CDI Proxy dan Contextual Instance

### 5.1 Client proxy adalah indirection layer

Untuk normal scoped bean, CDI sering menyuntikkan client proxy.

```java
@Inject OrderService orderService;
```

Field tersebut bisa berupa proxy yang saat method dipanggil akan mencari contextual instance sesuai scope aktif.

Mental model:

```text
Injected reference
  -> proxy
  -> current active context
  -> actual contextual instance
```

Ini bagus karena:

- object bisa lazy
- scope bisa berubah per request/session
- injection ke singleton tetap bisa resolve request-specific instance

Namun di async boundary, proxy dapat menjadi jebakan:

```text
Proxy bisa dibawa lintas thread,
tetapi context target belum tentu valid di thread tujuan.
```

---

### 5.2 Jangan menyimpan actual contextual instance untuk dipakai nanti

Kadang engineer mencoba menghindari proxy dengan mengambil actual object lalu menyimpannya.

Contoh konseptual buruk:

```java
RequestData actual = requestDataProvider.get();
executor.submit(() -> use(actual));
```

Jika `actual` merepresentasikan request state, maka kamu membawa object yang lifecycle-nya seharusnya selesai bersama request.

Masalah:

- object bisa berisi reference ke request resources
- object bisa tidak thread-safe
- object bisa berisi sensitive data lebih banyak dari yang dibutuhkan
- object bisa stale
- object bisa mencegah garbage collection

Solusi:

```java
RequestSnapshot snapshot = RequestSnapshot.from(requestData);
executor.submit(() -> use(snapshot));
```

Snapshot harus minimal, immutable, dan explicit.

---

## 6. Interceptors dalam Async Boundary

### 6.1 Interceptor hanya berjalan jika invocation melewati interception point

Contoh service:

```java
@ApplicationScoped
public class CaseService {

    @Audited
    public void approve(Long caseId) {
        validate(caseId);
        persistApproval(caseId);
    }
}
```

Jika dipanggil melalui CDI proxy:

```java
@Inject CaseService caseService;
caseService.approve(123L);
```

Interceptor dapat berjalan.

Namun jika method dipanggil dari dalam object yang sama:

```java
@ApplicationScoped
public class CaseService {

    public void approveFromAsync(Long caseId) {
        approve(caseId); // self-invocation
    }

    @Audited
    public void approve(Long caseId) {
        // ...
    }
}
```

Self-invocation sering bypass proxy/interceptor, tergantung model interception.

Mental model:

```text
Interceptor bukan magic pada bytecode semua call.
Interceptor biasanya berlaku pada method invocation yang melewati container/proxy/interception mechanism.
```

---

### 6.2 Async closure dapat bypass interception secara tidak sadar

Contoh buruk:

```java
@ApplicationScoped
public class ReportService {
    @Inject ManagedExecutorService executor;

    public void start(Long reportId) {
        executor.submit(() -> generate(reportId));
    }

    @Audited
    @Transactional
    public void generate(Long reportId) {
        // expected audited + transactional
    }
}
```

Masalah:

- Lambda `() -> generate(reportId)` memanggil method pada `this`.
- Bisa bypass proxy.
- `@Audited` dan `@Transactional` mungkin tidak berjalan sesuai ekspektasi.

Desain lebih baik:

```java
@ApplicationScoped
public class ReportStarter {
    @Inject ManagedExecutorService executor;
    @Inject ReportWorker reportWorker;

    public void start(Long reportId) {
        executor.submit(() -> reportWorker.generate(reportId));
    }
}

@ApplicationScoped
public class ReportWorker {

    @Audited
    @Transactional
    public void generate(Long reportId) {
        // invocation enters through CDI proxy if reportWorker is injected
    }
}
```

Pola:

```text
Separate starter/coordinator from worker.
Call intercepted method on another injected bean.
```

---

### 6.3 Interceptor harus async-aware

Misalnya interceptor audit:

```java
@AroundInvoke
public Object audit(InvocationContext ctx) throws Exception {
    auditStart(ctx);
    try {
        Object result = ctx.proceed();
        auditSuccess(ctx);
        return result;
    } catch (Exception e) {
        auditFailure(ctx, e);
        throw e;
    }
}
```

Ini bekerja untuk synchronous method.

Namun jika method mengembalikan `CompletionStage`:

```java
@Audited
public CompletionStage<Void> generateAsync(Long id) {
    return CompletableFuture.runAsync(...);
}
```

Interceptor di atas hanya melihat bahwa method berhasil mengembalikan `CompletionStage`, bukan bahwa async work selesai sukses.

Akibat:

```text
auditSuccess tercatat terlalu awal
padahal async task bisa gagal setelah method return
```

Async-aware interceptor perlu menempel ke completion stage:

```java
@AroundInvoke
public Object audit(InvocationContext ctx) throws Exception {
    auditStart(ctx);

    try {
        Object result = ctx.proceed();

        if (result instanceof CompletionStage<?> stage) {
            return stage.whenComplete((value, error) -> {
                if (error == null) {
                    auditSuccess(ctx);
                } else {
                    auditFailure(ctx, error);
                }
            });
        }

        auditSuccess(ctx);
        return result;
    } catch (Exception e) {
        auditFailure(ctx, e);
        throw e;
    }
}
```

Namun hati-hati:

- `InvocationContext` mungkin tidak aman disimpan lama.
- Ambil snapshot metadata sebelum return.
- Jangan menyimpan parameter sensitif tanpa masking.
- Jangan melakukan audit DB operation dari completion thread tanpa transaction strategy jelas.

Lebih aman:

```java
AuditSnapshot snapshot = AuditSnapshot.from(ctx);
```

Lalu gunakan snapshot di callback.

---

## 7. CDI Events dan Async Boundary

### 7.1 CDI event synchronous bukan message queue

CDI event sering disalahpahami sebagai message broker.

Contoh:

```java
@Inject Event<CaseApproved> caseApprovedEvent;

public void approve(Long caseId) {
    // update DB
    caseApprovedEvent.fire(new CaseApproved(caseId));
}
```

Observer:

```java
public void onCaseApproved(@Observes CaseApproved event) {
    // send email
}
```

Default event synchronous berarti observer dipanggil dalam call stack yang sama.

Mental model:

```text
fire(event)
  -> invoke observer A
  -> invoke observer B
  -> return after observers complete
```

Konsekuensi:

- observer lambat membuat caller lambat
- observer gagal bisa menggagalkan caller
- observer berjalan dalam context yang sama, tergantung transaction/context aktif
- bukan durable
- bukan cross-node queue
- bukan retryable secara natural

---

### 7.2 CDI async event bukan durable job queue

CDI juga memiliki async event API pada versi modern CDI:

```java
@Inject Event<CaseApproved> event;

public CompletionStage<CaseApproved> publish(CaseApproved payload) {
    return event.fireAsync(payload);
}
```

Namun ini tetap bukan pengganti message broker atau Jakarta Batch.

Pertanyaan production:

1. Apakah event survive server crash?
2. Apakah event bisa di-retry setelah node mati?
3. Apakah ada dead-letter?
4. Apakah ada ordering guarantee?
5. Apakah observer execution dapat dioperasikan dari admin UI?
6. Apakah ada backpressure policy?
7. Apakah ada idempotency key?

Jika jawaban tidak jelas, jangan gunakan CDI async event untuk business-critical durable workflow.

Gunakan CDI async event untuk:

- decoupled in-process notification
- non-critical side effect
- local observer pattern
- cache warming kecil
- metrics/logging ringan
- UI/application internal event yang disposable

Gunakan durable mechanism untuk:

- email resmi
- payment/settlement
- enforcement action
- regulatory correspondence
- data export/import besar
- external API sync yang harus restartable
- batch processing

---

### 7.3 Transactional observer harus dipahami sebagai transaction hook

CDI mendukung observer yang terkait fase transaksi, misalnya secara konseptual:

```java
public void afterSuccess(@Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event) {
    // only after transaction success
}
```

Ini berguna untuk menghindari side effect sebelum commit.

Namun tetap hati-hati:

```text
AFTER_SUCCESS berarti transaction commit sukses,
bukan berarti side effect observer durable/retryable.
```

Jika observer mengirim email lalu gagal:

- DB sudah commit.
- Email gagal.
- Caller mungkin sudah selesai.
- Tidak ada retry durable kecuali kamu desain sendiri.

Untuk side effect penting, pola yang lebih kuat:

```text
Business transaction:
  update business table
  insert outbox event
  commit

Background dispatcher:
  read outbox
  send side effect
  mark sent/retry/dead-letter
```

CDI transactional observer bisa dipakai untuk memasukkan ke outbox, tetapi jangan jadikan observer sebagai satu-satunya reliability mechanism.

---

## 8. Resource Injection dalam Async Task

### 8.1 Inject service, bukan resource mentah ke closure

Buruk:

```java
@ApplicationScoped
public class ImportResource {
    @PersistenceContext
    EntityManager em;

    @Inject ManagedExecutorService executor;

    public void startImport(List<Row> rows) {
        executor.submit(() -> {
            rows.forEach(row -> em.persist(row.toEntity()));
        });
    }
}
```

Masalah:

- `EntityManager` context/transaction belum tentu valid.
- Closure membawa resource injection ke worker.
- Transaction boundary tidak eksplisit.
- Error handling buruk.

Lebih baik:

```java
@ApplicationScoped
public class ImportResource {
    @Inject ManagedExecutorService executor;
    @Inject ImportWorker importWorker;

    public void startImport(ImportCommand command) {
        executor.submit(() -> importWorker.process(command));
    }
}

@ApplicationScoped
public class ImportWorker {
    @Inject ImportService importService;

    public void process(ImportCommand command) {
        importService.process(command);
    }
}

@ApplicationScoped
public class ImportService {
    @PersistenceContext
    EntityManager em;

    @Transactional
    public void process(ImportCommand command) {
        // transaction starts here on worker-side invocation
    }
}
```

---

### 8.2 Programmatic lookup sebagai bridge, bukan default gaya coding

Kadang async task object bukan CDI-managed object. Maka kita perlu masuk kembali ke CDI container.

Contoh konseptual:

```java
public class ImportTask implements Runnable {
    private final ImportCommand command;

    public ImportTask(ImportCommand command) {
        this.command = command;
    }

    @Override
    public void run() {
        ImportWorker worker = CDI.current().select(ImportWorker.class).get();
        worker.process(command);
    }
}
```

Kapan ini berguna:

- task dibuat sebagai plain command object
- task harus serializable/conceptually independent
- service harus di-resolve saat execution
- task execution harus masuk ke CDI-managed service

Risiko:

- service locator smell jika dipakai sembarangan
- lebih sulit dites jika tidak dibungkus
- lifecycle dependent object harus diperhatikan
- environment non-CDI bisa gagal

Pattern lebih bersih:

```java
@ApplicationScoped
public class TaskRunner {
    @Inject ImportWorker worker;

    public Runnable importTask(ImportCommand command) {
        return () -> worker.process(command);
    }
}
```

---

## 9. Event vs Executor vs Batch: Decision Model

### 9.1 Jangan pilih teknologi berdasarkan “bisa jalan”

Banyak hal bisa dilakukan dengan CDI event, executor, scheduler, batch, atau message broker. Pertanyaannya adalah reliability semantics.

| Kebutuhan | CDI Sync Event | CDI Async Event | Managed Executor | Jakarta Batch | Message Broker |
|---|---:|---:|---:|---:|---:|
| Loose coupling in-process | Kuat | Kuat | Sedang | Lemah | Sedang |
| Return cepat ke caller | Tidak | Ya | Ya | Ya | Ya |
| Durable setelah crash | Tidak | Tidak/tergantung impl detail, jangan diasumsikan | Tidak kecuali ada job table | Ya via job repository | Ya |
| Restartability | Tidak | Tidak | Manual | Kuat | Manual/consumer model |
| Chunk/checkpoint | Tidak | Tidak | Manual | Kuat | Manual |
| Cross-service integration | Tidak ideal | Tidak ideal | Tidak ideal | Terbatas | Kuat |
| Observability admin | Lemah | Lemah | Manual | Lebih kuat | Broker tooling |
| Cocok untuk side effect kritikal | Tidak | Tidak | Hanya jika durable wrapper | Ya | Ya |

---

### 9.2 Decision heuristic

Gunakan **CDI synchronous event** jika:

- observer cepat
- observer failure memang harus mempengaruhi caller
- coupling masih dalam satu transactional use case
- tidak perlu durability terpisah

Gunakan **CDI async event** jika:

- side effect ringan
- best-effort cukup
- tidak perlu restart setelah crash
- observability sederhana cukup

Gunakan **ManagedExecutorService** jika:

- kamu butuh async task in-process
- task relatif pendek/terkontrol
- lifecycle container harus aman
- durability tidak wajib atau kamu menambahkan durable job/outbox sendiri

Gunakan **Jakarta Batch** jika:

- workload besar
- perlu restartability
- perlu checkpoint
- perlu operator control
- perlu status execution
- perlu skip/retry/partition semantics

Gunakan **message broker** jika:

- perlu durable decoupling antar service/module
- perlu consumer retry/dead-letter
- perlu event-driven integration
- perlu cross-node/cross-service distribution

---

## 10. Pattern: Async Command + CDI Worker

Ini pattern paling aman untuk banyak use case Jakarta Concurrency + CDI.

### 10.1 Struktur

```text
Request thread
  -> validate input
  -> snapshot minimal context
  -> create command
  -> submit Runnable
  -> return accepted

Worker thread
  -> enter managed executor
  -> call injected worker bean
  -> interceptor applies
  -> transaction starts explicitly
  -> execute business logic
  -> record status/audit
```

### 10.2 Command object

```java
public record RecalculateCaseAgeCommand(
    String jobId,
    Long caseId,
    String requestedBy,
    String correlationId,
    Instant requestedAt
) {}
```

### 10.3 Request-side coordinator

```java
@Path("/cases")
@RequestScoped
public class CaseAgeResource {

    @Inject ManagedExecutorService executor;
    @Inject CaseAgeWorker worker;
    @Inject RequestIdentity requestIdentity;
    @Inject CorrelationContext correlationContext;

    @POST
    @Path("/{caseId}/recalculate-age")
    public Response recalculate(@PathParam("caseId") Long caseId) {
        RecalculateCaseAgeCommand command = new RecalculateCaseAgeCommand(
            UUID.randomUUID().toString(),
            caseId,
            requestIdentity.username(),
            correlationContext.id(),
            Instant.now()
        );

        executor.submit(() -> worker.recalculate(command));

        return Response.accepted(Map.of(
            "jobId", command.jobId(),
            "status", "ACCEPTED"
        )).build();
    }
}
```

### 10.4 Worker-side service

```java
@ApplicationScoped
public class CaseAgeWorker {

    @Inject CaseAgeService caseAgeService;
    @Inject AsyncAuditService auditService;

    @Audited
    public void recalculate(RecalculateCaseAgeCommand command) {
        auditService.started(command);

        try {
            caseAgeService.recalculateInNewTransaction(command);
            auditService.succeeded(command);
        } catch (RuntimeException e) {
            auditService.failed(command, e);
            throw e;
        }
    }
}
```

### 10.5 Transactional business method

```java
@ApplicationScoped
public class CaseAgeService {

    @Transactional
    public void recalculateInNewTransaction(RecalculateCaseAgeCommand command) {
        // load case by id
        // validate current state
        // compute ageing
        // update record
        // insert audit event
    }
}
```

Why this works:

- request-scoped values converted to immutable command
- worker is CDI-managed
- interceptor can apply on worker/service invocation
- transaction begins in worker execution boundary
- audit has explicit initiatedBy/correlationId
- task does not hold request/session object

---

## 11. Pattern: Durable Job Request + CDI Worker

Jika task penting, jangan hanya `executor.submit()`.

### 11.1 Problem

`executor.submit()` in-memory:

- hilang saat process crash
- sulit query status
- sulit prevent duplicate
- sulit restart
- sulit audit operator action

### 11.2 Durable pattern

```text
Request transaction:
  insert job_request(job_id, type, params, status=NEW, requested_by, correlation_id)
  commit

Dispatcher:
  claim NEW job
  mark RUNNING
  execute CDI worker
  mark SUCCEEDED/FAILED/RETRYABLE
```

### 11.3 Kenapa ini relevan dengan CDI

Worker tetap CDI-managed:

```java
@ApplicationScoped
public class JobDispatcher {

    @Inject ManagedExecutorService executor;
    @Inject JobRepository jobRepository;
    @Inject JobWorker worker;

    public void dispatch() {
        List<JobRequest> jobs = jobRepository.claimNextBatch(10);

        for (JobRequest job : jobs) {
            executor.submit(() -> worker.execute(job.id()));
        }
    }
}
```

Worker resolve fresh state:

```java
@ApplicationScoped
public class JobWorker {

    @Inject JobRepository jobRepository;
    @Inject CaseAgeService service;

    public void execute(String jobId) {
        JobRequest job = jobRepository.find(jobId);
        RecalculateCaseAgeCommand command = job.toCommand();
        service.recalculateInNewTransaction(command);
    }
}
```

Keuntungan:

- crash-safe
- status visible
- retry possible
- audit defensible
- request context tidak disimpan sebagai object, hanya snapshot param

---

## 12. CDI Event untuk Internal Domain Notification

### 12.1 Contoh aman synchronous event

```java
public record CaseStatusChanged(
    Long caseId,
    String oldStatus,
    String newStatus,
    String changedBy,
    Instant changedAt
) {}
```

Publisher:

```java
@ApplicationScoped
public class CaseService {

    @Inject Event<CaseStatusChanged> event;

    @Transactional
    public void transition(Long caseId, String targetStatus) {
        // update case
        event.fire(new CaseStatusChanged(
            caseId,
            "PENDING",
            targetStatus,
            "system-or-user",
            Instant.now()
        ));
    }
}
```

Observer ringan:

```java
@ApplicationScoped
public class CaseMetricsObserver {

    public void onChange(@Observes CaseStatusChanged event) {
        // update in-memory metric or lightweight log
    }
}
```

Ini aman jika observer cepat dan tidak melakukan side effect kritikal.

---

### 12.2 Contoh kurang aman

```java
public void sendEmail(@Observes CaseStatusChanged event) {
    mailClient.sendOfficialNotice(event.caseId());
}
```

Masalah:

- email bisa terkirim sebelum transaction commit jika observer biasa
- jika commit gagal, email sudah terkirim
- jika email gagal, transaction bisa rollback tergantung observer behavior
- tidak ada retry durable

Lebih baik:

```java
public void enqueueEmailOutbox(
    @Observes(during = TransactionPhase.BEFORE_COMPLETION) CaseStatusChanged event
) {
    outboxRepository.insert(...);
}
```

Atau langsung insert outbox dalam service method.

Outbox dispatcher yang mengirim email harus durable dan idempotent.

---

## 13. Context Propagation: CDI vs Application Context

Jakarta Concurrency dapat menyediakan context propagation tertentu melalui managed resources dan `ContextService`. Spesifikasi Concurrency menjelaskan contextual proxies untuk menjalankan function/proxy dengan context aplikasi seperti classloading, namespace, security, dan context container lain sesuai konfigurasi/container.

Namun jangan menganggap semua context otomatis benar.

Bedakan:

### Container-managed context

Contoh:

- classloader
- naming/JNDI
- security information
- sebagian context yang didukung container

### Application-defined context

Contoh:

- correlation id
- tenant id
- request id
- actor id
- module id
- regulatory case id
- MDC/logging metadata
- feature flag snapshot
- locale/timezone

Application-defined context harus eksplisit.

Contoh:

```java
public record AsyncExecutionContext(
    String correlationId,
    String tenantId,
    String initiatedBy,
    String moduleCode,
    Locale locale,
    ZoneId zoneId
) {}
```

Lalu masukkan ke command:

```java
public record GenerateNoticeCommand(
    Long caseId,
    AsyncExecutionContext context
) {}
```

Worker:

```java
public void generate(GenerateNoticeCommand command) {
    try (MdcScope ignored = MdcScope.from(command.context())) {
        noticeService.generate(command);
    }
}
```

---

## 14. Common Failure Modes

### 14.1 `ContextNotActiveException` di worker thread

Gejala:

```text
ContextNotActiveException: Request context is not active
```

Penyebab umum:

- task memakai `@RequestScoped` bean
- callback `CompletableFuture` memakai request proxy
- observer async mengakses request/session object

Solusi:

- snapshot request data menjadi immutable command
- jangan bawa request bean ke task
- resolve service di worker side
- gunakan explicit context activation hanya jika benar-benar dipahami dan portable

---

### 14.2 Interceptor tidak terpanggil

Gejala:

- audit tidak tercatat
- transaction tidak terbuka
- metrics tidak muncul
- security check tidak jalan

Penyebab:

- self-invocation
- membuat object dengan `new`
- task class bukan CDI-managed
- method dipanggil langsung dari lambda pada `this`

Solusi:

- panggil method pada injected CDI bean
- pisahkan coordinator dan worker
- jangan mengandalkan annotation pada private/internal method
- gunakan integration test untuk memastikan interceptor berjalan

---

### 14.3 Event observer membuat transaction lambat

Gejala:

- endpoint lambat padahal service logic sederhana
- stack trace menunjukkan observer melakukan email/API/report generation
- lock DB tertahan lama

Penyebab:

- synchronous CDI event dipakai untuk pekerjaan berat

Solusi:

- pindahkan side effect berat ke outbox/executor/batch
- observer hanya enqueue work
- pastikan enqueue durable jika side effect penting

---

### 14.4 Async event hilang saat restart

Gejala:

- event sudah `fireAsync`, tetapi observer tidak selesai setelah pod/server restart
- tidak ada status job
- tidak bisa retry

Penyebab:

- CDI async event diperlakukan seperti durable queue

Solusi:

- gunakan durable job table/outbox/message broker/Jakarta Batch

---

### 14.5 Request data leak ke background job

Gejala:

- job memakai user/tenant/correlation yang salah
- audit mencatat actor salah
- data tenant A muncul di proses tenant B

Penyebab:

- ThreadLocal tidak dibersihkan
- MDC tidak clear
- context snapshot mutable/shared
- custom scope leak

Solusi:

- gunakan immutable execution context
- set/clear MDC dengan try-finally
- jangan simpan context dalam static mutable field
- test dengan concurrent multi-user scenario

---

## 15. Testing Strategy

### 15.1 Unit test saja tidak cukup

Bug CDI async sering muncul karena container behavior:

- proxy
- context lifecycle
- interceptor
- event observer
- transaction interceptor
- managed executor

Unit test plain JUnit bisa melewatkan bug penting.

Butuh kombinasi:

1. Unit test untuk command mapping.
2. Unit test untuk pure business logic.
3. Container/integration test untuk CDI/interceptor/event behavior.
4. Concurrency test untuk race/leak.
5. Failure test untuk cancellation/retry/restart.

---

### 15.2 Test interceptor benar-benar terpanggil

Buat marker audit repository:

```java
@Test
void asyncWorkerInvocationShouldPassThroughAuditInterceptor() {
    String jobId = client.startJob(...);

    await().untilAsserted(() -> {
        AuditRecord record = auditRepository.findByJobId(jobId);
        assertThat(record.status()).isEqualTo("SUCCEEDED");
    });
}
```

Test ini menangkap masalah self-invocation.

---

### 15.3 Test request context tidak dipakai di worker

Desain test:

1. Request A submit task.
2. Request selesai.
3. Worker berjalan setelah delay.
4. Pastikan worker tidak membaca `@RequestScoped` bean.
5. Pastikan command punya snapshot value yang benar.

---

### 15.4 Test multi-user/multi-tenant leakage

Simulasi:

```text
User A tenant X submit job 1
User B tenant Y submit job 2
Run concurrently
Assert job 1 only uses tenant X
Assert job 2 only uses tenant Y
Assert MDC cleared after each job
```

Ini sangat penting untuk sistem regulatory/multi-agency.

---

## 16. Observability Checklist

Untuk async task yang memakai CDI/interceptor/event, catat minimal:

- `jobId`
- `correlationId`
- `initiatedBy`
- `executedBy`
- `tenantId` / `agencyId`
- `moduleCode`
- `beanName` / worker type
- `methodName` jika audit via interceptor
- `eventType` jika event-driven
- `observerName` jika observer penting
- `threadName`
- `executorName`
- `startTime`
- `endTime`
- `durationMs`
- `status`
- `failureClass`
- `retryCount`

Untuk metrics:

```text
async_task_submitted_total{type}
async_task_running{type}
async_task_completed_total{type,status}
async_task_duration_seconds{type}
cdi_event_fired_total{eventType}
cdi_observer_duration_seconds{observer,eventType}
cdi_observer_failed_total{observer,eventType}
interceptor_invocation_total{binding,method,status}
```

---

## 17. Production Design Rules

### Rule 1 — Jangan bawa CDI contextual object lintas async boundary

Bawa data, bukan bean.

```text
Bad: carry RequestInfo bean
Good: carry RequestInfoSnapshot record
```

---

### Rule 2 — Worker harus CDI-managed jika membutuhkan interceptor/resource injection

```text
Bad: new Worker().run()
Good: injectedWorker.run(command)
```

---

### Rule 3 — Pisahkan coordinator dan worker

Coordinator:

- validasi request
- snapshot context
- enqueue/submit
- return accepted

Worker:

- resolve latest state
- open transaction
- apply interceptor
- execute business logic
- audit result

---

### Rule 4 — Event bukan job queue

CDI event bagus untuk local decoupling, bukan durability.

---

### Rule 5 — Interceptor harus diuji di async path

Jangan hanya melihat annotation ada.

Pastikan invocation benar-benar melewati proxy/interceptor chain.

---

### Rule 6 — Application context harus eksplisit

Correlation, tenant, actor, locale, module, dan audit reason tidak boleh bergantung pada ThreadLocal yang “kebetulan ada”.

---

### Rule 7 — Semua cleanup context harus `try-finally`

```java
try {
    context.install();
    worker.run(command);
} finally {
    context.clear();
}
```

---

## 18. Anti-Patterns

### Anti-pattern 1 — Capturing request bean in lambda

```java
executor.submit(() -> service.run(requestScopedBean.value()));
```

Masalah:

- request context invalid
- stale data
- leak

---

### Anti-pattern 2 — Annotation berharap bekerja pada self-invocation

```java
executor.submit(() -> this.transactionalMethod());
```

Masalah:

- interceptor/transaction mungkin bypass

---

### Anti-pattern 3 — Heavy observer in synchronous CDI event

```java
public void onEvent(@Observes DomainEvent e) {
    externalApi.call(e);
    generatePdf(e);
    sendEmail(e);
}
```

Masalah:

- caller lambat
- transaction panjang
- failure coupling tidak jelas

---

### Anti-pattern 4 — CDI async event untuk mandatory side effect

```java
event.fireAsync(new SendOfficialNotice(...));
```

Tanpa outbox/status/retry, ini rapuh.

---

### Anti-pattern 5 — Storing contextual proxy in static field

```java
static UserContext userContext;
```

Masalah:

- context leak
- classloader leak
- wrong user/tenant
- redeploy issue

---

### Anti-pattern 6 — Hidden business logic in listener/observer

Listener/observer seharusnya cross-cutting atau orchestration ringan. Jika business-critical logic tersebar di observer, flow menjadi sulit dibaca, dites, dan diaudit.

---

## 19. Design Review Questions

Gunakan pertanyaan ini saat review PR async/CDI:

1. Apakah task membawa bean atau hanya command data?
2. Apakah command immutable?
3. Apakah command hanya berisi data minimum yang diperlukan?
4. Apakah worker CDI-managed?
5. Apakah method yang butuh interceptor dipanggil via proxy?
6. Apakah ada self-invocation yang melewati interceptor?
7. Apakah transaction dimulai di execution boundary yang benar?
8. Apakah request/session scoped bean dipakai di worker?
9. Apakah CDI event dipakai sebagai durable queue secara tidak sadar?
10. Apakah observer melakukan pekerjaan berat?
11. Apakah side effect penting punya outbox/retry/status?
12. Apakah correlation/tenant/actor context eksplisit?
13. Apakah MDC/ThreadLocal dibersihkan?
14. Apakah ada integration test untuk async path?
15. Apakah failure/cancellation/retry sudah punya audit trail?

---

## 20. Thought Experiment: Regulatory Enforcement Escalation

Misalnya ada fitur:

> Ketika compliance case berubah status menjadi `BREACH_CONFIRMED`, sistem harus menghitung escalation path, membuat draft notice, mengirim notifikasi internal, dan memperbarui SLA ageing.

Desain naive:

```java
@Transactional
public void confirmBreach(Long caseId) {
    updateStatus(caseId, BREACH_CONFIRMED);
    event.fire(new BreachConfirmed(caseId));
}

public void onBreach(@Observes BreachConfirmed event) {
    escalationService.calculate(event.caseId());
    noticeService.generateDraft(event.caseId());
    emailService.notifyOfficers(event.caseId());
    slaService.recalculate(event.caseId());
}
```

Problem:

- observer berat
- transaction bisa panjang
- email side effect tidak durable
- failure salah satu observer bisa mempengaruhi status update
- audit flow tersebar
- restartability buruk

Desain lebih kuat:

```text
confirmBreach transaction:
  update case status
  insert audit record
  insert job_request ESCALATION_RECALC
  insert outbox INTERNAL_NOTIFICATION_REQUESTED
  commit

Managed executor / batch dispatcher:
  claim job_request
  run CDI worker with explicit command
  calculate escalation in new transaction
  generate draft idempotently
  update job status

Outbox dispatcher:
  send notification
  retry/dead-letter if failed
```

CDI tetap dipakai:

- service injection
- interceptor audit
- event ringan untuk metrics/cache if needed
- worker orchestration

Namun reliability tidak diserahkan pada CDI event saja.

---

## 21. Ringkasan

Async boundary mengubah cara kita memakai CDI.

Di request synchronous, CDI terasa seperti dependency injection biasa. Di async execution, CDI harus dipahami sebagai runtime contextual system dengan scope, proxy, lifecycle, interceptor, dan event semantics.

Prinsip utama:

```text
Across async boundary:
  pass immutable command data,
  not contextual bean instances.
```

```text
Inside async execution:
  resolve CDI-managed services,
  invoke through proxies,
  define transaction boundary explicitly,
  record audit/observability explicitly.
```

```text
Use CDI events for in-process decoupling,
not as durable workflow infrastructure.
```

CDI, interceptor, dan event tetap sangat powerful untuk async enterprise application — tetapi hanya jika boundary-nya jelas. Engineer yang kuat bukan hanya tahu annotation apa yang dipakai, tetapi tahu lifecycle apa yang valid saat annotation itu dijalankan.

---

## 22. Checklist Praktis

Sebelum merge async/CDI code:

- [ ] Tidak ada `@RequestScoped`/`@SessionScoped` bean yang dibawa ke worker closure.
- [ ] Command object immutable dan minimal.
- [ ] Worker adalah CDI-managed bean.
- [ ] Interceptor-sensitive method dipanggil melalui injected bean/proxy.
- [ ] Tidak ada self-invocation untuk method yang membutuhkan interceptor.
- [ ] Transaction boundary jelas di worker side.
- [ ] Event synchronous tidak melakukan pekerjaan berat.
- [ ] Event async tidak dipakai untuk side effect mandatory tanpa durability.
- [ ] Side effect penting memakai outbox/job table/batch/message broker.
- [ ] Correlation id, actor, tenant, module, dan audit reason eksplisit.
- [ ] MDC/ThreadLocal di-set dan di-clear dengan benar.
- [ ] Ada integration test untuk async path.
- [ ] Ada metrics dan audit untuk success/failure/cancellation.

---

## 23. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

**Part 10 — `CompletableFuture` in Jakarta EE Without Breaking the Container**

Kita akan masuk ke masalah yang sangat sering terjadi di code modern:

```java
CompletableFuture.supplyAsync(() -> service.doWork())
```

Kode itu terlihat harmless, tetapi di Jakarta EE dapat diam-diam memakai `ForkJoinPool.commonPool()`, kehilangan container context, bypass executor governance, membuat observability lemah, dan mengacaukan propagation MDC/security/transaction.

Di Part 10, kita akan membahas bagaimana memakai `CompletableFuture`, `CompletionStage`, callback chain, timeout, cancellation, dan error handling tanpa merusak kontrak container.

---

## Referensi Resmi

- Jakarta EE 11 Release — platform baseline modern untuk seri ini.
- Jakarta CDI 4.1 — spesifikasi CDI untuk Jakarta EE 11, termasuk lifecycle, contexts, events, dan programming model CDI modern.
- Jakarta Concurrency 3.1 — managed executors, managed scheduled executors, managed thread factories, dan context propagation facilities.
- Jakarta Concurrency `ContextService` API — contextual proxy/function untuk menjalankan invocation dengan context yang diasosiasikan dengan Jakarta EE environment.
- Jakarta EE Tutorial — Interceptors dan CDI advanced examples untuk pemahaman programming model container.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./08-security-identity-and-authorization-in-async-execution.md">⬅️ Part 8 — Security, Identity, and Authorization in Async Execution</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./10-completablefuture-in-jakarta-ee.md">Part 10 — CompletableFuture in Jakarta EE Without Breaking the Container ➡️</a>
</div>

# Part 6 — ContextService and Context Propagation

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `06-context-service-and-context-propagation.md`  
**Target:** Java 8–25, Java EE/Jakarta EE, `javax.enterprise.concurrent` → `jakarta.enterprise.concurrent`  
**Baseline stable:** Jakarta EE 11, Jakarta Concurrency 3.1  
**Focus:** `ContextService`, contextual proxy, functional-interface context capture, propagation boundaries, context leak prevention, and production design.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami **apa itu context** di environment Jakarta EE, bukan hanya sebagai istilah abstrak, tetapi sebagai bagian dari kontrak runtime container.
2. Menjelaskan kenapa async execution sering kehilangan informasi penting seperti classloader, naming context, security identity, CDI scope, MDC, dan correlation ID.
3. Menggunakan `ContextService` untuk membuat **contextual proxy** yang dapat dijalankan di thread lain tanpa memutus kontrak container.
4. Membedakan:
   - propagation,
   - suspension,
   - clearing,
   - replacement,
   - dan explicit reconstruction of context.
5. Mendesain async flow dengan `ManagedExecutorService`, `CompletableFuture`, dan contextual function secara aman.
6. Menghindari bug production seperti:
   - wrong tenant,
   - wrong user attribution,
   - lost correlation ID,
   - classloader leak,
   - request object leak,
   - stale security context,
   - context propagation beyond valid lifetime.
7. Membangun mental model yang kuat untuk concurrency di enterprise runtime: **execution moves, context does not automatically move unless the runtime deliberately moves it**.

---

## 2. Problem yang Diselesaikan

Di Java SE biasa, ketika kita menjalankan kode di thread lain, biasanya kita hanya berpikir:

```java
executor.submit(() -> doWork());
```

Tetapi di Jakarta EE, masalahnya tidak sesederhana “menjalankan method di thread lain”. Kode enterprise biasanya bergantung pada banyak context yang “terlihat otomatis” selama request berjalan:

- classloader aplikasi,
- naming/JNDI environment,
- security principal,
- CDI contextual object,
- transaction behavior,
- logging MDC,
- tenant/correlation information,
- application/module identity,
- managed resource access.

Pada request thread, semua ini sering sudah disiapkan oleh container. Developer merasa semua dependency dan context “ada begitu saja”. Tetapi ketika execution pindah ke thread lain, pertanyaannya berubah:

> Apakah thread baru itu tahu sedang mewakili aplikasi yang mana, user yang mana, tenant yang mana, classloader yang mana, dan request/correlation yang mana?

Kalau jawabannya tidak jelas, sistem rentan menghasilkan bug yang sangat mahal:

- async task gagal mengakses resource karena JNDI context hilang,
- log tidak punya correlation ID sehingga insiden susah ditelusuri,
- audit trail kehilangan `initiatedBy`,
- security identity salah atau kosong,
- task memakai `ThreadLocal` lama dari request sebelumnya,
- data tenant A diproses dalam context tenant B,
- background work tetap hidup setelah redeploy,
- proxy CDI/JPA dipakai di luar lifecycle validnya,
- transaction dianggap masih aktif padahal sudah selesai.

`ContextService` hadir untuk menyelesaikan sebagian dari masalah ini: membuat object/function yang ketika dipanggil di thread lain tetap dijalankan dengan context container yang sesuai, sesuai konfigurasi managed context.

---

## 3. Mental Model Utama

### 3.1 Execution dan context adalah dua hal berbeda

Pemisahan paling penting:

```text
Execution = kapan dan di thread mana kode berjalan.
Context   = lingkungan semantik yang membuat kode itu bermakna.
```

Contoh:

```text
Execution:
- thread: managed-executor-12
- task: generateCorrespondence(applicationId=123)

Context:
- application module: correspondence-service
- classloader: current deployment classloader
- security identity: user fajar / system-batch / service-account
- JNDI namespace: java:comp/env/...
- correlation ID: req-2026-06-17-abc
- tenant/agency: CEA
- transaction: none / active / suspended
```

Di thread yang sama, execution dan context tampak menyatu. Di async execution, keduanya harus dipikirkan terpisah.

### 3.2 Context bukan sekadar data

Context bukan hanya `Map<String, Object>`. Context dapat berupa:

| Context Type | Bentuk | Contoh Risiko |
|---|---|---|
| Classloading | thread context classloader | class tidak ditemukan setelah async pindah thread |
| Naming | JNDI environment | resource lookup gagal |
| Security | principal/subject | task berjalan tanpa identity atau dengan identity salah |
| Transaction | JTA association | transaksi bocor / dipakai di thread salah |
| CDI | contextual reference | bean scope tidak aktif |
| Logging | MDC / correlation | log tidak bisa ditrace |
| Tenant | ThreadLocal/custom context | data cross-tenant |
| Locale/timezone | user/session preference | output dokumen salah format |
| Request | HTTP request state | object sudah invalid saat task berjalan |

Sebagian context adalah milik container. Sebagian adalah milik aplikasi. Sebagian bisa dipropagasi. Sebagian tidak boleh dipropagasi.

### 3.3 Context propagation adalah keputusan desain, bukan default asumsi

Jangan berpikir:

> “Async task pasti membawa context request.”

Pikirkan:

> “Context apa yang perlu ikut, sampai kapan valid, siapa pemiliknya, dan apa yang terjadi kalau execution tertunda?”

Ini fundamental untuk production-grade async design.

---

## 4. Apa Itu `ContextService`?

`ContextService` adalah service Jakarta Concurrency untuk membuat object/function yang dipanggil dengan **captured Jakarta EE container context**.

Secara konsep:

```text
Original object/function
        |
        | wrap using ContextService
        v
Contextual proxy/function
        |
        | invoked later, possibly by another thread
        v
Runs with captured/configured container context
```

Jakarta Concurrency mendefinisikan bahwa `ContextService` dapat membuat proxy object dan functional interface yang menjalankan method dengan context yang lazim diasosiasikan dengan aplikasi Jakarta EE, seperti classloading, namespace, security, dan context container lain yang didukung implementation.

### 4.1 Bentuk API historis

Di Java EE/Jakarta EE lama:

```java
import javax.enterprise.concurrent.ContextService;
```

Di Jakarta EE modern:

```java
import jakarta.enterprise.concurrent.ContextService;
```

Resource bisa diakses melalui JNDI/resource injection, dan pada Jakarta EE 11 terdapat peningkatan integrasi CDI untuk concurrency resources.

Contoh umum:

```java
@Resource
private ContextService contextService;
```

Atau pada environment yang mendukung CDI injection:

```java
@Inject
private ContextService contextService;
```

Catatan: dukungan injection dan konfigurasi detail tetap perlu dicek terhadap runtime yang dipakai.

---

## 5. Kenapa `ContextService` Penting?

`ManagedExecutorService` sudah menjalankan task di managed thread. Lalu kenapa masih butuh `ContextService`?

Karena tidak semua async boundary berbentuk `executor.submit(task)` langsung.

Contoh boundary lain:

1. Callback yang diberikan ke library.
2. `CompletableFuture` stage.
3. Functional interface seperti `Function`, `Consumer`, `Supplier`.
4. Listener yang dipanggil belakangan.
5. Proxy object yang dieksekusi di thread managed lain.
6. Runnable/Callable yang harus membawa context tertentu, tapi invocation-nya dikendalikan pihak lain.

`ManagedExecutorService` menjawab:

```text
Di mana task dijalankan?
```

`ContextService` menjawab:

```text
Dengan context apa object/function itu dijalankan ketika nanti dipanggil?
```

---

## 6. Contextual Proxy: Konsep Dasar

Misalkan kita punya interface:

```java
public interface AuditAction {
    void record(String message);
}
```

Implementasi:

```java
public class AuditActionImpl implements AuditAction {
    @Override
    public void record(String message) {
        // access JNDI/CDI/security/logging context indirectly
        System.out.println("Audit: " + message);
    }
}
```

Kita bisa membuat proxy contextual:

```java
AuditAction original = new AuditActionImpl();

AuditAction contextual = contextService.createContextualProxy(
    original,
    AuditAction.class
);
```

Lalu `contextual.record(...)` dapat dipanggil dari thread lain, dan invocation tersebut akan dipersiapkan dengan context yang dicapture oleh `ContextService`, sesuai aturan dan konfigurasi implementation.

### 6.1 Proxy bukan clone business object

Proxy bukan berarti object state menjadi aman secara concurrent.

```text
Contextual proxy solves context association.
It does not automatically solve thread safety of mutable object state.
```

Jika object original mutable dan dipakai dari banyak thread, kamu tetap harus mendesain thread-safety-nya.

Contoh buruk:

```java
public class MutableReportBuilder implements ReportBuilder {
    private final List<String> lines = new ArrayList<>();

    @Override
    public void addLine(String line) {
        lines.add(line); // not thread-safe if used concurrently
    }
}
```

Membungkus dengan contextual proxy tidak membuat `ArrayList` menjadi thread-safe.

---

## 7. Functional Interface dan `CompletableFuture`

Salah satu use case modern adalah `CompletableFuture`.

Masalah umum:

```java
CompletableFuture
    .supplyAsync(() -> loadData(), managedExecutor)
    .thenApply(data -> enrich(data))
    .thenAccept(result -> audit(result));
```

Secara Java SE, stage non-async seperti `thenApply` dapat berjalan di thread yang menyelesaikan stage sebelumnya. Stage async tanpa executor eksplisit bisa memakai default executor, seringnya common pool di Java SE.

Di Jakarta EE, ini berbahaya jika:

- stage berjalan di executor yang tidak managed,
- context tidak dipropagasi,
- MDC/correlation hilang,
- security identity tidak ada,
- library callback menjalankan function di thread yang tidak jelas.

`ContextService` dapat dipakai untuk membuat contextual function.

Contoh konseptual:

```java
Function<Order, Invoice> contextualEnricher = contextService.createContextualProxy(
    (Function<Order, Invoice>) this::enrichInvoice,
    Function.class
);

CompletableFuture
    .supplyAsync(this::loadOrder, managedExecutor)
    .thenApply(contextualEnricher)
    .thenAcceptAsync(
        contextService.createContextualProxy(
            (Consumer<Invoice>) this::writeAudit,
            Consumer.class
        ),
        managedExecutor
    );
```

Intinya:

```text
Executor controls execution resource.
ContextService controls invocation context.
```

Dalam kode production, wrapper generic perlu dibuat lebih rapi agar tidak penuh cast dan raw type.

---

## 8. Context yang Perlu Dipikirkan

### 8.1 Classloader context

Application server memakai classloader hierarchy. Saat deployment/redeployment, classloader lama harus bisa dilepas.

Async task yang berjalan di thread salah atau menyimpan reference ke classloader lama dapat menyebabkan:

- memory leak,
- redeploy leak,
- `ClassCastException` antar versi class,
- `ClassNotFoundException`,
- behavior aneh setelah hot deploy.

Prinsip:

```text
Async work must not outlive deployment lifecycle unless explicitly externalized.
```

### 8.2 Naming/JNDI context

Banyak resource Jakarta EE diakses melalui naming context:

```java
@Resource(lookup = "java:comp/DefaultDataSource")
DataSource dataSource;
```

Jika thread tidak punya naming context yang benar, lookup dapat gagal atau mengarah ke resource yang salah.

### 8.3 Security context

Security context menentukan siapa caller/effective principal.

Pertanyaan desain:

- Apakah task mewakili user asli?
- Apakah task harus berjalan sebagai system identity?
- Apakah authorization dicek saat enqueue atau saat execution?
- Bagaimana jika user sudah logout?
- Bagaimana jika role user berubah sebelum task berjalan?

Untuk sistem regulasi, jangan hanya menyimpan “current principal” secara implisit. Simpan attribution eksplisit:

```text
requestedByUserId
requestedByDisplayName
requestedByAgency
requestedAt
executionMode = USER_INITIATED | SYSTEM_SCHEDULED | ADMIN_RETRY
executedBy = system/batch-worker
correlationId
reason
```

### 8.4 Transaction context

Transaction context adalah area paling berbahaya.

Secara prinsip:

```text
Do not assume an active request transaction should flow into async work.
```

Kenapa?

- Transaction biasanya bound ke thread.
- Transaction punya timeout.
- Async work bisa mulai setelah request transaction selesai.
- Membawa transaction ke thread lain dapat menyebabkan lifecycle ambiguity.
- Long-running async transaction akan menahan lock dan resource.

Dalam banyak desain yang sehat, async task membuka transaksi sendiri, kecil, jelas, dan idempotent.

### 8.5 CDI context

CDI context seperti request/session/application/dependent punya lifecycle masing-masing.

Risiko:

- request scoped bean dipakai setelah request selesai,
- session scoped state dipakai di background tanpa user session valid,
- dependent bean tidak dibersihkan,
- self-invocation menyebabkan interceptor tidak berjalan.

Prinsip:

```text
Do not pass contextual bean references across async boundaries unless lifecycle and proxy semantics are understood.
Pass command data instead.
```

Lebih aman:

```java
record GenerateLetterCommand(
    String applicationId,
    String requestedBy,
    String correlationId
) {}
```

Daripada:

```java
class GenerateLetterTask {
    private HttpServletRequest request; // bad
    private UserSessionBean sessionBean; // risky
}
```

### 8.6 Logging MDC dan correlation ID

MDC biasanya berbasis `ThreadLocal`. Jika execution pindah thread, MDC tidak otomatis ikut kecuali dipropagasi.

Gejala production:

```text
Request log punya correlationId.
Async task log tidak punya correlationId.
Error terjadi di async task.
Incident timeline putus.
```

Solusi desain:

- capture correlation ID sebagai data eksplisit,
- set MDC saat task mulai,
- clear MDC di finally,
- jangan hanya bergantung pada inherited thread state.

Contoh:

```java
public final class MdcAwareRunnable implements Runnable {
    private final Runnable delegate;
    private final Map<String, String> capturedMdc;

    public MdcAwareRunnable(Runnable delegate, Map<String, String> capturedMdc) {
        this.delegate = delegate;
        this.capturedMdc = capturedMdc == null ? Map.of() : Map.copyOf(capturedMdc);
    }

    @Override
    public void run() {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            MDC.setContextMap(capturedMdc);
            delegate.run();
        } finally {
            if (previous == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(previous);
            }
        }
    }
}
```

Tetapi jangan lupa: MDC propagation ini aplikasi-level. `ContextService` menangani container context sesuai specification/implementation; MDC biasanya perlu strategi tambahan kecuali platform kamu menyediakan integration.

---

## 9. Propagation vs Suspension vs Clearing

Context tidak selalu harus “dibawa”. Ada beberapa strategi.

### 9.1 Propagation

Context dari caller ikut ke task.

Cocok untuk:

- correlation ID,
- application classloader,
- naming context,
- limited security attribution jika memang semantik user-initiated.

Risiko:

- membawa context terlalu lama,
- menggunakan identity yang sudah tidak valid,
- membawa tenant salah,
- menyimpan reference ke request object.

### 9.2 Suspension

Context caller sementara dihentikan ketika task berjalan.

Cocok untuk:

- transaction context yang tidak boleh mengalir ke async task,
- security context yang ingin diganti system identity.

### 9.3 Clearing

Context sengaja dikosongkan.

Cocok untuk:

- mencegah ThreadLocal contamination,
- memastikan task tidak accidentally memakai caller state,
- background system job yang tidak user-bound.

### 9.4 Replacement

Context diganti dengan context baru.

Contoh:

```text
User request enqueues job.
Job execution uses service account identity.
Audit still records requestedBy original user.
```

Ini sering lebih defensible di enterprise system.

---

## 10. Context Capture Timing

Salah satu pertanyaan paling penting:

```text
Context dicapture kapan?
```

Biasanya context dicapture ketika contextual object/proxy/function dibuat, bukan ketika original object dibuat bertahun-tahun sebelumnya.

Contoh:

```java
Function<Input, Output> contextual = contextService.createContextualProxy(
    function,
    Function.class
);
```

Mental model:

```text
create contextual proxy at request boundary -> captures current eligible context
invoke later -> applies captured context around invocation
```

Implikasi:

- Buat contextual proxy terlalu awal: context yang dicapture mungkin tidak relevan.
- Buat contextual proxy terlalu lambat: context yang dibutuhkan mungkin sudah hilang.
- Simpan contextual proxy terlalu lama: bisa menyebabkan context outlive lifecycle.

Rule of thumb:

```text
Capture context at the narrowest valid boundary.
Use it for the shortest necessary lifetime.
Prefer explicit command data for durable work.
```

---

## 11. Durable Work vs Contextual Invocation

Ini perbedaan krusial.

### 11.1 Contextual invocation

Cocok untuk async work pendek yang masih bagian dari request/operation:

```text
User request -> submit short async tasks -> combine result -> respond
```

Contoh:

- parallel read ke beberapa service,
- generate preview,
- send non-critical notification segera,
- enrich response.

### 11.2 Durable work

Cocok untuk job yang harus tetap bisa jalan walaupun:

- user logout,
- node restart,
- deployment rolling,
- task tertunda,
- retry besok pagi,
- batch diproses ulang.

Untuk durable work, jangan menyimpan live context. Simpan **data konteks eksplisit**.

```sql
CREATE TABLE JOB_REQUEST (
    ID               VARCHAR2(36) PRIMARY KEY,
    JOB_TYPE         VARCHAR2(100) NOT NULL,
    BUSINESS_KEY     VARCHAR2(100) NOT NULL,
    REQUESTED_BY     VARCHAR2(100) NOT NULL,
    REQUESTED_AT     TIMESTAMP NOT NULL,
    CORRELATION_ID   VARCHAR2(100) NOT NULL,
    TENANT_ID        VARCHAR2(50) NOT NULL,
    STATUS           VARCHAR2(30) NOT NULL,
    PARAMETERS_JSON  CLOB NOT NULL
);
```

Lalu execution membuat context operasional baru:

```text
execution principal = system-batch
business attribution = requestedBy from JOB_REQUEST
correlation = persisted correlationId or new child correlationId
transaction = new per chunk/task
```

---

## 12. Contoh Desain: Async Audit dengan ContextService

### 12.1 Use case

Request melakukan update case. Setelah commit, sistem ingin membuat audit enrichment async.

Kebutuhan:

- async work tetap punya classloader/naming context,
- log tetap punya correlation ID,
- audit tahu siapa initiator,
- transaction async terpisah,
- tidak memakai `HttpServletRequest` di background.

### 12.2 Command object

```java
public record AuditEnrichmentCommand(
    String caseId,
    String activityId,
    String requestedBy,
    String correlationId,
    Instant requestedAt
) {}
```

### 12.3 Service

```java
@ApplicationScoped
public class AuditEnrichmentService {

    @Resource
    private ManagedExecutorService executor;

    @Resource
    private ContextService contextService;

    @Inject
    private AuditWriter auditWriter;

    public void submit(AuditEnrichmentCommand command) {
        Runnable task = () -> runWithMdc(command, () -> enrichAndWrite(command));

        Runnable contextualTask = contextService.createContextualProxy(
            task,
            Runnable.class
        );

        executor.submit(contextualTask);
    }

    private void enrichAndWrite(AuditEnrichmentCommand command) {
        auditWriter.writeEnrichedAudit(
            command.caseId(),
            command.activityId(),
            command.requestedBy(),
            command.requestedAt()
        );
    }

    private void runWithMdc(AuditEnrichmentCommand command, Runnable runnable) {
        try {
            MDC.put("correlationId", command.correlationId());
            MDC.put("caseId", command.caseId());
            runnable.run();
        } finally {
            MDC.remove("caseId");
            MDC.remove("correlationId");
        }
    }
}
```

### 12.4 Kenapa desain ini lebih aman?

- Business context disimpan eksplisit dalam command.
- Container context dibantu oleh `ContextService`.
- Execution resource dikelola `ManagedExecutorService`.
- MDC diset/clear eksplisit.
- Tidak membawa request/session object.
- Transaction async dapat diatur oleh `AuditWriter` sendiri.

---

## 13. Contoh Desain: CompletableFuture Fan-Out/Fan-In

### 13.1 Use case

Endpoint perlu mengambil data dari tiga sumber internal:

- profile,
- compliance score,
- active enforcement case.

Kita ingin parallel fan-out, lalu combine.

### 13.2 Kode naïve yang berbahaya

```java
CompletableFuture<Profile> profile = CompletableFuture.supplyAsync(() -> profileClient.get(id));
CompletableFuture<Score> score = CompletableFuture.supplyAsync(() -> scoreClient.get(id));
CompletableFuture<List<Case>> cases = CompletableFuture.supplyAsync(() -> caseClient.findActive(id));
```

Masalah:

- executor default tidak eksplisit,
- bisa memakai common pool,
- context tidak jelas,
- timeout tidak jelas,
- cancellation tidak jelas,
- log correlation bisa hilang.

### 13.3 Versi lebih baik

```java
@ApplicationScoped
public class CaseOverviewAssembler {

    @Resource
    private ManagedExecutorService executor;

    @Resource
    private ContextService contextService;

    public CompletionStage<CaseOverview> assemble(String caseId, String correlationId) {
        Supplier<Profile> profileSupplier = contextualSupplier(() -> withMdc(correlationId, () -> loadProfile(caseId)));
        Supplier<Score> scoreSupplier = contextualSupplier(() -> withMdc(correlationId, () -> loadScore(caseId)));
        Supplier<List<CaseRef>> caseSupplier = contextualSupplier(() -> withMdc(correlationId, () -> loadActiveCases(caseId)));

        CompletableFuture<Profile> profileFuture = CompletableFuture.supplyAsync(profileSupplier, executor);
        CompletableFuture<Score> scoreFuture = CompletableFuture.supplyAsync(scoreSupplier, executor);
        CompletableFuture<List<CaseRef>> casesFuture = CompletableFuture.supplyAsync(caseSupplier, executor);

        return profileFuture
            .thenCombine(scoreFuture, (profile, score) -> new PartialOverview(profile, score))
            .thenCombine(casesFuture, (partial, cases) -> new CaseOverview(
                partial.profile(),
                partial.score(),
                cases
            ))
            .orTimeout(2, TimeUnit.SECONDS)
            .whenComplete((result, error) -> {
                if (error != null) {
                    // structured logging, metrics, etc.
                }
            });
    }

    @SuppressWarnings("unchecked")
    private <T> Supplier<T> contextualSupplier(Supplier<T> supplier) {
        return contextService.createContextualProxy(supplier, Supplier.class);
    }

    private <T> T withMdc(String correlationId, Supplier<T> supplier) {
        try {
            MDC.put("correlationId", correlationId);
            return supplier.get();
        } finally {
            MDC.remove("correlationId");
        }
    }

    private Profile loadProfile(String caseId) {
        // call internal client
        return new Profile(caseId);
    }

    private Score loadScore(String caseId) {
        return new Score(100);
    }

    private List<CaseRef> loadActiveCases(String caseId) {
        return List.of();
    }
}
```

Catatan:

- `orTimeout` tersedia sejak Java 9.
- Untuk Java 8, timeout perlu dibuat manual menggunakan scheduler.
- Pada Java 21+, virtual thread dapat mengubah model biaya blocking, tetapi context dan cancellation tetap harus didesain.

---

## 14. Context Propagation dan Java 8–25

### 14.1 Java 8

Java 8 membawa `CompletableFuture`, tetapi belum punya:

- `orTimeout`,
- `completeOnTimeout`,
- virtual threads,
- structured concurrency,
- scoped values.

Risiko di Java 8:

- banyak code menggunakan common pool tanpa sadar,
- propagation berbasis `ThreadLocal` manual,
- timeout/cancellation lebih verbose,
- thread pool pressure lebih mudah terjadi.

Di Java 8 Jakarta/Java EE app server, disiplin managed executor dan `ContextService` sangat penting.

### 14.2 Java 9–17

Ada peningkatan API `CompletableFuture`, module system, dan observability JVM. Tetapi model thread masih platform-thread oriented.

### 14.3 Java 21

Virtual threads menjadi final. Ini mengubah cost model blocking, tetapi tidak menghapus kebutuhan context management.

Dengan virtual threads:

```text
More executions become cheap.
But context correctness is still expensive if designed poorly.
```

Hal yang tetap harus benar:

- security attribution,
- transaction boundary,
- MDC/correlation,
- request/session lifetime,
- JNDI/resource access,
- cancellation,
- backpressure.

### 14.4 Java 25

Structured concurrency dan scoped values relevan untuk masa depan enterprise context.

- Structured concurrency memberi model parent-child task lifetime.
- Scoped values memberi alternatif immutable context passing dibanding `ThreadLocal`.

Namun, jika fitur masih preview, pemakaian production di Jakarta EE perlu kehati-hatian dan mengikuti dukungan runtime.

---

## 15. ContextService vs MicroProfile Context Propagation

Dalam ekosistem enterprise Java, kamu juga akan mendengar **MicroProfile Context Propagation**.

Secara mental model:

| Area | Jakarta Concurrency `ContextService` | MicroProfile Context Propagation |
|---|---|---|
| Platform | Jakarta EE | MicroProfile ecosystem |
| Fokus | Managed concurrency dan contextual proxy | Propagation context lintas async/reactive pipeline |
| Use case | Jakarta EE managed resources | Microservices/reactive style, `CompletionStage` heavy usage |
| Portability | Jakarta EE spec | MicroProfile spec/runtime support |
| Common concern | Context correctness | Context correctness |

Keduanya bukan musuh. Di runtime tertentu, keduanya bisa saling melengkapi. Tetapi untuk seri ini, baseline utama tetap Jakarta Concurrency.

---

## 16. Context Propagation untuk Regulatory / Case Management System

Dalam sistem case management/regulatory, context bukan sekadar convenience. Context mempengaruhi defensibility.

Contoh context penting:

```text
caseId
applicationId
module
activityType
initiatedBy
initiatedRole
effectiveAgency
correlationId
requestChannel = INTERNET | INTRANET | SYSTEM | BATCH
businessDate
legalBasis
```

### 16.1 Salah propagation bisa menjadi masalah audit

Contoh bug:

```text
User A submit action.
Async enrichment berjalan tanpa principal.
Audit trail menulis executedBy = null.
```

Atau lebih parah:

```text
Thread reused dari request sebelumnya.
MDC tenantId masih tenant lama karena tidak di-clear.
Async task menulis log tenant salah.
```

Ini bukan hanya bug teknis. Dalam sistem regulasi, ini bisa membuat evidence chain dipertanyakan.

### 16.2 Prinsip defensible async audit

Untuk setiap async task penting, simpan minimal:

```text
taskId
businessKey
initiatedBy
initiatedAt
acceptedAt
startedAt
completedAt
executionNode
executionThread/executor
correlationId
inputHash/outputHash jika relevan
status
failureCategory
failureMessage sanitized
retryCount
```

Jangan mengandalkan live security context sebagai satu-satunya sumber audit.

---

## 17. Failure Modes

### 17.1 Lost correlation ID

Gejala:

- request log lengkap,
- async task log tidak ada correlation,
- tracing putus.

Penyebab:

- MDC berbasis ThreadLocal tidak ikut ke thread executor,
- stage `CompletableFuture` pindah thread,
- callback dari library memakai thread sendiri.

Mitigasi:

- capture correlation ID eksplisit,
- set/clear MDC di task boundary,
- gunakan contextual proxy/function,
- standardisasi wrapper async.

### 17.2 Stale request context

Gejala:

- task mencoba akses request-scoped bean setelah request selesai,
- exception context not active,
- data user/session salah.

Mitigasi:

- jangan pass request/session object,
- pass immutable command data,
- reconstruct needed dependencies inside task.

### 17.3 Wrong user attribution

Gejala:

- audit mencatat system/null user,
- task memakai user identity yang sudah berubah,
- authorization tidak konsisten.

Mitigasi:

- bedakan `initiatedBy` dan `executedBy`,
- cek authorization saat enqueue,
- untuk job durable, gunakan service identity saat execution,
- simpan audit attribution eksplisit.

### 17.4 Transaction confusion

Gejala:

- transaction not active,
- lock lama,
- rollback tidak sesuai ekspektasi,
- async task melihat data yang belum commit.

Mitigasi:

- enqueue setelah commit,
- gunakan outbox,
- async task memakai transaksi sendiri,
- jangan bergantung pada transaction propagation.

### 17.5 Context leak across redeploy

Gejala:

- memory leak setelah redeploy,
- classloader lama tetap reachable,
- background thread masih berjalan.

Mitigasi:

- jangan simpan contextual proxy jangka panjang,
- pastikan task bounded,
- pakai managed lifecycle,
- stop/cancel task saat undeploy,
- externalize durable jobs.

### 17.6 ThreadLocal contamination

Gejala:

- tenant/correlation/user dari request lama muncul di task baru,
- bug sporadis dan sulit direproduksi.

Mitigasi:

- always clear ThreadLocal/MDC in finally,
- avoid static mutable context,
- use scoped context wrappers,
- centralize async submission.

---

## 18. Design Pattern: Context Envelope

Untuk production system, sering lebih aman membuat envelope eksplisit.

```java
public record ExecutionContextEnvelope(
    String correlationId,
    String tenantId,
    String requestedBy,
    String requestedRole,
    String channel,
    Instant requestedAt
) {}
```

Lalu command membawa envelope:

```java
public record AsyncCommand<T>(
    String commandId,
    String commandType,
    T payload,
    ExecutionContextEnvelope context
) {}
```

Wrapper execution:

```java
public final class ContextEnvelopeRunner {

    public static void run(ExecutionContextEnvelope context, Runnable runnable) {
        try {
            MDC.put("correlationId", context.correlationId());
            MDC.put("tenantId", context.tenantId());
            MDC.put("requestedBy", context.requestedBy());
            runnable.run();
        } finally {
            MDC.remove("requestedBy");
            MDC.remove("tenantId");
            MDC.remove("correlationId");
        }
    }
}
```

Manfaat:

- context bisnis eksplisit,
- mudah diaudit,
- mudah diserialisasi untuk durable job,
- tidak tergantung sepenuhnya pada thread-local container context,
- compatible dengan Java 8–25.

---

## 19. Design Pattern: Async Submission Gateway

Jangan biarkan semua service langsung memakai executor/context service dengan gaya masing-masing.

Buat gateway:

```java
@ApplicationScoped
public class ManagedAsyncGateway {

    @Resource
    private ManagedExecutorService executor;

    @Resource
    private ContextService contextService;

    public Future<?> submit(String taskName, ExecutionContextEnvelope context, Runnable task) {
        Runnable wrapped = () -> ContextEnvelopeRunner.run(context, task);

        Runnable contextual = contextService.createContextualProxy(
            wrapped,
            Runnable.class
        );

        return executor.submit(() -> {
            long startNanos = System.nanoTime();
            try {
                contextual.run();
            } finally {
                long durationMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
                // record metric: taskName, durationMillis
            }
        });
    }
}
```

Keuntungan:

- policy terpusat,
- MDC selalu konsisten,
- metric selalu tercatat,
- error handling bisa distandardisasi,
- mudah menambahkan timeout/rejection handling,
- mudah audit siapa submit task apa.

---

## 20. Anti-Patterns

### 20.1 Passing `HttpServletRequest` to async task

Buruk:

```java
executor.submit(() -> process(request));
```

Kenapa buruk:

- request lifecycle bisa selesai,
- object bukan untuk background access,
- session/security state bisa stale,
- memory retention besar.

Lebih baik:

```java
var command = new GenerateReportCommand(
    request.getParameter("caseId"),
    currentUserId,
    correlationId
);
executor.submit(() -> process(command));
```

### 20.2 Relying on `ThreadLocal` as durable context

Buruk:

```java
String tenant = TenantContext.getCurrentTenant();
executor.submit(() -> service.process()); // assumes ThreadLocal still exists
```

Lebih baik:

```java
String tenant = TenantContext.getCurrentTenant();
executor.submit(() -> service.process(tenant));
```

### 20.3 Creating contextual proxy and caching forever

Buruk:

```java
@ApplicationScoped
public class SomeService {
    private Runnable contextualTask;

    @PostConstruct
    void init() {
        contextualTask = contextService.createContextualProxy(this::doWork, Runnable.class);
    }
}
```

Masalah:

- context yang dicapture saat startup mungkin bukan context request yang diinginkan,
- proxy hidup terlalu lama,
- semantik context kabur.

### 20.4 Propagating user security context into long-running batch

Buruk:

```text
User clicks Run Big Batch.
Batch runs for 4 hours using user's live security context.
```

Lebih baik:

```text
At request time:
- validate user permission to start job
- persist requestedBy

At execution time:
- run as system batch identity
- audit requestedBy + approvedBy + executedBy
```

### 20.5 Assuming ContextService handles all custom context

`ContextService` handles container-defined context according to spec/implementation. Application-specific context seperti MDC, tenant ThreadLocal, custom LocaleContext, biasanya harus kamu tangani eksplisit kecuali runtime/framework menyediakan integrasi.

---

## 21. Testing Strategy

### 21.1 Unit test command extraction

Pastikan async command tidak menyimpan object lifecycle-bound.

```java
@Test
void commandShouldContainOnlySerializableBusinessContext() {
    var command = factory.fromRequest(mockRequest, currentUser);

    assertThat(command.caseId()).isEqualTo("CASE-1");
    assertThat(command.requestedBy()).isEqualTo("fajar");
    assertThat(command.correlationId()).isNotBlank();
}
```

### 21.2 Integration test managed context

Test di container/runtime target:

- resource injection tersedia di async task,
- security context sesuai ekspektasi,
- naming context tersedia,
- MDC wrapper bekerja,
- transaction boundary benar.

### 21.3 Negative test context leakage

Buat dua request berbeda:

```text
Request A: tenant = T1, correlation = C1
Request B: tenant = T2, correlation = C2
```

Pastikan async task B tidak pernah melihat T1/C1.

### 21.4 Redeploy/lifecycle test

Simulasikan:

- submit long-running task,
- redeploy application,
- pastikan task dibatalkan/selesai sesuai policy,
- tidak ada classloader leak.

### 21.5 Failure test

Simulasikan:

- task throws exception,
- future completes exceptionally,
- MDC clear tetap terjadi,
- metric failure tercatat,
- audit failure tidak kehilangan attribution.

---

## 22. Observability Checklist

Untuk setiap async boundary, catat:

```text
submission.count
submission.rejected.count
submission.latency
execution.started.count
execution.completed.count
execution.failed.count
execution.duration
execution.timeout.count
execution.cancelled.count
queue.depth jika tersedia
active.tasks jika tersedia
```

Logging minimal:

```text
correlationId
taskId
taskName
businessKey
requestedBy
executedBy
executorName
attempt
status
failureCategory
```

Tracing:

- buat span parent-child untuk async task,
- link trace jika task durable dan dieksekusi belakangan,
- jangan anggap trace context live selamanya.

---

## 23. Production Decision Framework

Gunakan pertanyaan ini sebelum memutuskan context propagation:

### 23.1 Apakah work ini short-lived atau durable?

Jika short-lived:

- contextual proxy/function bisa cocok,
- managed executor cukup,
- context propagation lebih masuk akal.

Jika durable:

- persist job request,
- persist business context,
- reconstruct execution context,
- jangan menyimpan live contextual proxy.

### 23.2 Apakah work mewakili user atau system?

Jika user:

- authorization harus jelas,
- expiry/role change harus dipikirkan,
- audit harus simpan initiatedBy.

Jika system:

- service identity harus jelas,
- permission harus minimal,
- original user tetap dicatat sebagai initiator jika ada.

### 23.3 Apakah side effect idempotent?

Jika tidak:

- jangan rely pada simple retry,
- pakai idempotency key,
- pakai outbox,
- simpan execution status.

### 23.4 Apakah context masih valid saat task berjalan?

Jika tidak pasti:

- jangan propagate live context,
- capture data eksplisit,
- validate ulang saat execution.

---

## 24. Hubungan dengan Part Selanjutnya

Part ini menjadi fondasi untuk pembahasan berikutnya:

- **Part 7 — Transactions Across Asynchronous Boundaries** akan membahas kenapa transaction context adalah context paling sensitif dalam async execution.
- **Part 8 — Security, Identity, and Authorization in Async Execution** akan memperdalam user/system identity, audit, dan privilege boundary.
- **Part 10 — CompletableFuture in Jakarta EE** akan memakai `ContextService` dalam async pipeline yang lebih kompleks.
- **Part 17+ Jakarta Batch** akan memakai prinsip ini untuk membedakan live context dari durable job parameters.

---

## 25. Best Practices

1. Gunakan `ManagedExecutorService` untuk execution resource, bukan executor unmanaged.
2. Gunakan `ContextService` ketika object/function/callback perlu dipanggil dengan container context yang benar.
3. Capture context pada boundary yang tepat dan gunakan sesingkat mungkin.
4. Jangan membawa `HttpServletRequest`, session object, atau request-scoped object ke async task.
5. Simpan business context eksplisit dalam command/envelope.
6. Bedakan `initiatedBy` dan `executedBy`.
7. Jangan propagate transaction context ke async work kecuali benar-benar memahami kontrak runtime.
8. Set dan clear MDC di boundary task.
9. Jangan menganggap `ContextService` menangani semua custom ThreadLocal aplikasi.
10. Untuk durable work, simpan job request dan reconstruct context saat execution.
11. Standardisasi async submission melalui gateway/wrapper.
12. Test leakage antar tenant/user/correlation.
13. Observability wajib ada di boundary async.
14. Jangan cache contextual proxy jangka panjang tanpa alasan kuat.
15. Pastikan lifecycle redeploy/shutdown tidak meninggalkan task liar.

---

## 26. Checklist Praktis

Sebelum membuat async task, jawab:

```text
[ ] Task short-lived atau durable?
[ ] Execution memakai managed executor?
[ ] Perlu ContextService/contextual proxy?
[ ] Context apa yang perlu dipropagasi?
[ ] Context apa yang harus di-clear/suspend?
[ ] Apakah task membawa request/session object? Jika ya, refactor.
[ ] Apakah command data immutable?
[ ] Apakah correlation ID eksplisit?
[ ] Apakah tenant/user attribution eksplisit?
[ ] Apakah transaction boundary jelas?
[ ] Apakah MDC dibersihkan di finally?
[ ] Apakah failure tercatat dengan business key?
[ ] Apakah retry/cancellation aman?
[ ] Apakah task bisa outlive deployment? Jika ya, durable-kan.
[ ] Apakah ada test untuk context leakage?
```

---

## 27. Ringkasan

`ContextService` adalah salah satu komponen paling penting dalam Jakarta Concurrency karena enterprise async programming tidak hanya berbicara tentang thread dan executor. Yang lebih sulit adalah menjaga agar kode yang berjalan di thread lain tetap memiliki **semantic environment** yang benar.

Mental model utamanya:

```text
Execution can move to another thread.
Context must be deliberately propagated, cleared, suspended, or reconstructed.
```

`ManagedExecutorService` mengelola resource execution. `ContextService` membantu invocation berjalan dengan context container yang sesuai. Namun, business context seperti correlation ID, tenant, initiatedBy, dan audit attribution tetap sebaiknya dibuat eksplisit, terutama untuk workload yang durable, auditable, atau regulatory-sensitive.

Engineer yang matang tidak bertanya hanya:

```text
Bagaimana menjalankan ini async?
```

Tetapi bertanya:

```text
Dengan identity apa?
Dengan transaction apa?
Dengan tenant apa?
Dengan correlation apa?
Sampai kapan context ini valid?
Apa yang terjadi jika task retry, timeout, cancelled, atau berjalan setelah redeploy?
```

Itulah perbedaan antara sekadar memakai concurrency API dan mendesain enterprise workload orchestration yang benar.

---

## 28. Latihan / Thought Experiment

### Latihan 1 — Audit enrichment

Kamu punya endpoint `POST /cases/{id}/approve`. Setelah approval, sistem perlu menjalankan async enrichment untuk audit trail.

Desain:

- command object,
- context envelope,
- executor submission,
- MDC propagation,
- transaction boundary,
- failure handling.

Tentukan context mana yang:

- dipropagasi,
- disimpan eksplisit,
- tidak boleh dibawa,
- direkonstruksi saat execution.

### Latihan 2 — User logout sebelum async task selesai

User memulai export report besar. Task berjalan 20 menit. User logout setelah 1 menit.

Jawab:

1. Apakah task harus tetap berjalan?
2. Apakah task berjalan sebagai user atau system?
3. Apa yang disimpan di audit?
4. Apa yang terjadi jika role user berubah saat task masih berjalan?
5. Apakah live security context boleh dipropagasi?

### Latihan 3 — Tenant leakage

Ada bug sporadis: log async task kadang menunjukkan tenant yang salah.

Susun diagnostic plan:

- kemungkinan sumber bug,
- log yang perlu ditambahkan,
- test reproduksi,
- mitigation di code,
- policy wrapper/gateway yang perlu dibuat.

### Latihan 4 — CompletableFuture pipeline

Sebuah service memakai:

```java
CompletableFuture.supplyAsync(() -> serviceA.call())
    .thenApply(result -> serviceB.enrich(result))
    .thenAccept(result -> audit.write(result));
```

Refactor agar:

- memakai managed executor,
- tidak memakai common pool,
- context-aware,
- punya timeout,
- punya error handling,
- tidak kehilangan correlation ID.

---

## 29. Referensi

- Jakarta Concurrency 3.1 Specification, Jakarta EE 11 release baseline.
- Jakarta Concurrency API Documentation: `ContextService`, `ManagedExecutorService`, `ManagedScheduledExecutorService`, `ManagedThreadFactory`.
- Jakarta EE 11 Platform Release Notes.
- Jakarta Concurrency Explained, Jakarta EE official learning material.
- Java SE `CompletableFuture`, `Executor`, `ExecutorService`, and `ScheduledExecutorService` API documentation.
- OpenJDK JEP 444: Virtual Threads.
- OpenJDK JEPs for Structured Concurrency and Scoped Values in modern Java.

---

## 30. Status Seri

Seri **belum selesai**.

Bagian yang sudah dibuat:

- Part 0 — Orientation: Enterprise Concurrency & Batch Mental Model
- Part 1 — Historical Map: Java EE Concurrency Utilities to Jakarta Concurrency
- Part 2 — Container Integrity: Why Managed Concurrency Exists
- Part 3 — ManagedExecutorService Deep Dive
- Part 4 — ManagedScheduledExecutorService and Time-Based Workloads
- Part 5 — ManagedThreadFactory and Thread Creation Without Losing Container Semantics
- Part 6 — ContextService and Context Propagation

Bagian berikutnya:

- Part 7 — Transactions Across Asynchronous Boundaries

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./05-managed-thread-factory-and-thread-ownership.md">⬅️ Part 5 — ManagedThreadFactory and Thread Creation Without Losing Container Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./07-transactions-across-asynchronous-boundaries.md">Part 7 — Transactions Across Asynchronous Boundaries ➡️</a>
</div>

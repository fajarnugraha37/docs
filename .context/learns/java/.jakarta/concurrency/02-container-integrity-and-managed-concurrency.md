# Part 2 — Container Integrity: Why Managed Concurrency Exists

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `02-container-integrity-and-managed-concurrency.md`  
> Scope: Java 8–25, Java EE/Jakarta EE, `javax.enterprise.concurrent` → `jakarta.enterprise.concurrent`  
> Baseline modern platform: Jakarta EE 11, Jakarta Concurrency 3.1

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami mengapa **managed concurrency** ada di Jakarta EE.
2. Membedakan concurrency biasa di Java SE dengan concurrency yang aman di application server/container.
3. Menjelaskan apa yang dimaksud dengan **container integrity**.
4. Memahami kenapa `new Thread()`, `Executors.newFixedThreadPool()`, `ForkJoinPool.commonPool()`, dan scheduler buatan sendiri sering menjadi masalah di enterprise runtime.
5. Menganalisis context apa saja yang melekat pada thread di Jakarta EE:
   - classloader
   - security identity
   - naming/JNDI
   - CDI/request context
   - transaction context
   - application/module context
   - logging/correlation context
6. Mengidentifikasi production failure mode seperti:
   - classloader leak
   - redeploy leak
   - zombie thread
   - lost security identity
   - lost transaction boundary
   - stuck shutdown
   - duplicate background execution
   - invisible operational workload
7. Membangun mental model bahwa application server bukan hanya tempat menjalankan kode, tetapi **runtime governance system**.

---

## 2. Problem yang Diselesaikan

Di Java SE biasa, kamu bebas membuat thread:

```java
Thread t = new Thread(() -> doWork());
t.start();
```

Atau membuat executor:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
executor.submit(() -> doWork());
```

Di aplikasi kecil, ini terlihat wajar. Namun di Jakarta EE, aplikasi hidup di dalam **container**. Container tidak hanya menjalankan method, tetapi juga mengelola:

- lifecycle aplikasi
- deployment/redeployment
- classloading isolation
- dependency injection
- transaction management
- security identity
- connection pool
- naming environment
- request/session context
- thread pool
- observability
- graceful shutdown
- resource cleanup

Maka pertanyaan utamanya bukan:

> “Apakah saya bisa menjalankan task secara parallel?”

Pertanyaan yang lebih benar:

> “Apakah task parallel itu masih berada dalam governance container sehingga lifecycle, security, transaction, resource, observability, dan shutdown tetap benar?”

Jakarta Concurrency ada untuk menjawab masalah ini. Spesifikasi Jakarta Concurrency mendefinisikan API standar untuk menjalankan concurrent task dari komponen Jakarta EE tanpa mengorbankan integritas container. API ini memperluas model `java.util.concurrent`, tetapi menambahkan konteks enterprise runtime.

---

## 3. Definisi Container Integrity

**Container integrity** berarti container tetap mampu menjaga kontrak runtime yang dijanjikan kepada aplikasi walaupun aplikasi melakukan concurrency.

Kontrak itu mencakup beberapa invariant.

### 3.1 Lifecycle Invariant

Container harus tahu pekerjaan apa yang masih berjalan untuk aplikasi tertentu.

Jika aplikasi di-undeploy atau redeploy:

- thread milik aplikasi harus berhenti atau dilepas dengan benar
- resource tidak boleh tertinggal
- classloader lama tidak boleh tetap hidup
- task tidak boleh lanjut menggunakan kode versi lama secara tersembunyi

Jika aplikasi membuat thread sendiri, container bisa tidak tahu bahwa thread itu masih hidup.

Akibatnya:

```text
old app version undeployed
        ↓
new app version deployed
        ↓
old thread still running
        ↓
old classloader retained
        ↓
memory leak + inconsistent behavior
```

### 3.2 Resource Ownership Invariant

Container harus tahu siapa yang menggunakan resource:

- JDBC connection
- JMS connection
- JPA `EntityManager`
- transaction
- security context
- naming context
- thread capacity
- timer/scheduler slot

Jika thread dibuat sendiri, resource bisa dipakai di luar lifecycle resmi.

### 3.3 Security Invariant

Ketika request datang dari user tertentu, container biasanya mengetahui principal/caller identity.

Contoh:

```text
HTTP request from Alice
        ↓
SecurityContext = Alice
        ↓
Application code checks role: CASE_OFFICER
```

Jika task dipindah ke unmanaged thread, thread baru belum tentu membawa identity Alice. Bisa terjadi:

- identity hilang
- identity menjadi anonymous
- identity menjadi system user
- identity dari request lain tertukar karena ThreadLocal leak
- authorization dilakukan di tempat yang salah

Untuk sistem regulasi, ini fatal karena audit bisa menjadi tidak defensible.

### 3.4 Transaction Invariant

Container mengelola transaction boundary:

```text
method enter
   begin transaction
   business logic
   commit/rollback
method exit
```

Async boundary memutus asumsi ini.

Jika task berjalan setelah method asal selesai, transaction asal mungkin sudah commit/rollback.

Maka pertanyaan desainnya:

- apakah async task harus ikut transaction asal?
- apakah async task harus membuka transaction baru?
- apakah side effect harus ditunda via outbox?
- apakah task boleh melihat data yang belum committed?
- apakah retry task aman?

Managed concurrency tidak membuat semua masalah transaction hilang, tetapi menyediakan execution model yang container-aware.

### 3.5 Context Invariant

Container context harus jelas:

- context apa yang dipropagasi
- context apa yang tidak boleh dipropagasi
- context apa yang harus dibuat baru
- context apa yang harus dibersihkan setelah task selesai

Tanpa ini, background task rawan memakai stale context.

### 3.6 Observability Invariant

Container/operator harus bisa menjawab:

- task apa yang sedang berjalan?
- dari aplikasi mana?
- dimulai oleh siapa?
- berapa lama sudah berjalan?
- stuck di mana?
- apakah bisa dihentikan?
- apakah sedang menahan resource?

Unmanaged thread sering tidak terlihat sebagai bagian dari application workload.

---

## 4. Mental Model Utama: Container Adalah Runtime Governor

Jangan bayangkan Jakarta EE container hanya sebagai “library besar”. Lebih tepat:

```text
+---------------------------------------------------------+
| Jakarta EE Container                                    |
|                                                         |
|  +-------------------+   +---------------------------+  |
|  | Lifecycle Manager |   | Security Manager          |  |
|  +-------------------+   +---------------------------+  |
|  | Transaction Coord |   | Connection Pool Manager   |  |
|  +-------------------+   +---------------------------+  |
|  | CDI Context       |   | Classloader Isolation     |  |
|  +-------------------+   +---------------------------+  |
|  | Managed Executors |   | Metrics/Tracing/Logging   |  |
|  +-------------------+   +---------------------------+  |
|                                                         |
|              Application Components                     |
+---------------------------------------------------------+
```

Application code seharusnya tidak diam-diam membangun runtime kedua di dalam runtime utama.

Membuat thread pool sendiri di application server sering berarti:

```text
Jakarta EE Container
  └── Application
        └── Hidden mini runtime
              ├── unmanaged thread pool
              ├── unmanaged queue
              ├── unmanaged scheduler
              ├── unmanaged lifecycle
              └── unmanaged failure mode
```

Masalahnya bukan “thread pool sendiri selalu langsung rusak”. Masalahnya adalah container tidak bisa menjamin invariant enterprise runtime.

---

## 5. Thread Ownership di Application Server

Di enterprise runtime, thread bukan sekadar CPU execution lane. Thread adalah carrier bagi banyak konteks.

### 5.1 Request Thread

Request thread biasanya berasal dari web container.

```text
HTTP request
    ↓
container assigns request thread
    ↓
sets context: classloader, security, request scope, naming
    ↓
invokes servlet/JAX-RS/CDI/EJB/application code
    ↓
cleans context
    ↓
returns thread to pool
```

Thread ini tidak boleh disimpan dan digunakan setelah request selesai.

### 5.2 Container Worker Thread

Container bisa memiliki worker thread untuk:

- async servlet
- JAX-RS async
- EJB timer
- managed executor
- messaging listener
- batch execution
- scheduled task

Thread ini tetap dikelola container.

### 5.3 Managed Executor Thread

Thread dari `ManagedExecutorService` adalah thread yang:

- disediakan oleh container
- dapat membawa container context sesuai konfigurasi/spec
- dapat diatur sizing dan policy-nya oleh server/admin
- mengikuti lifecycle aplikasi/server
- lebih observable daripada unmanaged thread

### 5.4 Unmanaged Thread

Unmanaged thread adalah thread yang dibuat langsung oleh aplikasi:

```java
new Thread(task).start();
```

Atau tidak langsung:

```java
Executors.newFixedThreadPool(8);
Executors.newSingleThreadScheduledExecutor();
CompletableFuture.supplyAsync(() -> work()); // default: common pool
```

Unmanaged thread tidak otomatis berada di bawah governance container.

### 5.5 Virtual Thread

Virtual thread dari Java 21+ mengubah cost model thread, tetapi tidak otomatis menyelesaikan container semantics.

Contoh:

```java
Thread.startVirtualThread(() -> doWork());
```

Virtual thread tetap bisa menjadi unmanaged jika dibuat langsung oleh aplikasi di dalam container tanpa managed resource.

Jakarta EE 11/Jakarta Concurrency 3.1 mulai mendukung virtual threads dalam managed resources. Ini penting karena problem utama bukan hanya “thread mahal”, tetapi “thread harus container-aware”.

---

## 6. Context yang Melekat pada Thread

Salah satu konsep paling penting: di enterprise Java, thread sering membawa **implicit execution context**.

### 6.1 Classloader Context

Application server memakai classloader isolation.

Misalnya:

```text
server classloader
  ├── app A classloader
  └── app B classloader
```

Thread biasanya memiliki thread context classloader:

```java
ClassLoader cl = Thread.currentThread().getContextClassLoader();
```

Framework memakai ini untuk:

- service discovery
- JPA provider discovery
- JAXB/Jakarta XML binding
- CDI extension
- logging provider
- resource loading
- SPI lookup

Jika unmanaged thread mempertahankan classloader app lama setelah redeploy, classloader lama tidak bisa di-GC.

Failure:

```text
Redeploy app 10 times
    ↓
old threads still reference old classloaders
    ↓
Metaspace/memory grows
    ↓
server restart required
```

### 6.2 Naming/JNDI Context

Jakarta EE memakai naming environment untuk lookup resource:

```java
InitialContext ctx = new InitialContext();
DataSource ds = (DataSource) ctx.lookup("java:comp/env/jdbc/AppDS");
```

`java:comp/env` bergantung pada component/application context.

Di unmanaged thread, naming context bisa:

- tidak tersedia
- salah aplikasi
- tidak stabil
- bergantung vendor behavior

### 6.3 Security Context

Security context menjawab:

- siapa caller?
- apa role-nya?
- apakah boleh menjalankan operasi ini?

Contoh pseudo-code:

```java
if (securityContext.isCallerInRole("ENFORCEMENT_OFFICER")) {
    approveEscalation(caseId);
}
```

Jika async task kehilangan context, operasi bisa:

- gagal karena anonymous
- sukses sebagai system identity tanpa audit benar
- salah atribusi

Untuk sistem enforcement/regulatory, selalu bedakan:

```text
initiatedBy = user yang meminta pekerjaan
executedBy  = identity teknis yang menjalankan pekerjaan
approvedBy  = authority yang memberi approval
```

Jangan bergantung hanya pada implicit thread principal untuk audit jangka panjang.

### 6.4 CDI Context

CDI memiliki beberapa scope:

- `@ApplicationScoped`
- `@RequestScoped`
- `@SessionScoped`
- `@ConversationScoped`
- `@Dependent`

Request context biasanya valid selama request.

Jika object request-scoped dipakai di background thread setelah request selesai:

```text
request completed
    ↓
request context destroyed
    ↓
async task uses request-scoped bean
    ↓
ContextNotActiveException / stale data / undefined behavior
```

### 6.5 Transaction Context

JTA transaction biasanya bound ke thread saat eksekusi.

```text
Thread T1
  └── transaction TX-123
```

Jika pekerjaan pindah ke thread lain:

```text
Thread T1 has TX-123
Thread T2 does not automatically have TX-123
```

Memindahkan transaction context secara sembarangan berbahaya karena:

- transaction bisa melewati request lifetime
- lock bisa ditahan terlalu lama
- rollback semantics menjadi tidak jelas
- side effect external tidak bisa rollback

### 6.6 Persistence Context

JPA `EntityManager` dan persistence context sering terkait transaction atau request.

Anti-pattern:

```java
@RequestScoped
public class CaseService {
    @PersistenceContext
    EntityManager em;

    public void startAsync(Long id) {
        executor.submit(() -> {
            Case c = em.find(Case.class, id); // dangerous if context not valid
        });
    }
}
```

Yang lebih aman:

- pass immutable command data
- ambil bean/service yang valid di task execution context
- buka transaction baru di task
- fetch ulang entity by ID
- jangan pass managed entity ke thread lain

### 6.7 Logging/MDC/Correlation Context

Logging context sering memakai `ThreadLocal`, misalnya MDC:

```text
correlationId=REQ-123
userId=alice
module=case-management
```

Jika task async tidak membawa correlation ID, observability putus.

Jika ThreadLocal tidak dibersihkan, thread pool bisa membawa context request sebelumnya.

Failure:

```text
Request A sets MDC user=Alice
Thread reused
Request B logs with user=Alice accidentally
```

Ini sangat berbahaya untuk audit dan incident investigation.

---

## 7. Kenapa `new Thread()` Bermasalah

### 7.1 Container Tidak Tahu Thread Itu Ada

```java
new Thread(() -> sendBulkEmails()).start();
```

Dari sudut pandang container:

```text
request selesai
response returned
application idle
```

Padahal sebenarnya:

```text
background email thread still running
holding resources
calling DB/API
possibly failing silently
```

### 7.2 Tidak Ada Lifecycle Binding

Jika aplikasi di-redeploy:

```text
old background thread may continue running
```

Ia bisa memakai:

- class versi lama
- config lama
- secret lama
- schema expectation lama
- endpoint lama

### 7.3 Tidak Ada Capacity Governance

Jika 100 request masing-masing membuat thread:

```text
100 requests × 1 thread = 100 new threads
```

Jika tiap thread membuka DB connection:

```text
100 unmanaged threads → DB pool exhaustion
```

Container tidak bisa menerapkan policy yang benar jika concurrency tidak melewati managed executor.

### 7.4 Tidak Ada Rejection Policy yang Terlihat

Managed executor bisa memiliki queue dan rejection behavior yang diatur.

Unmanaged model sering gagal diam-diam:

```java
try {
    new Thread(task).start();
} catch (Throwable t) {
    // rarely handled correctly
}
```

Atau membanjiri sistem tanpa backpressure.

### 7.5 Tidak Ada Centralized Observability

Thread manual mungkin muncul di thread dump, tetapi tidak otomatis muncul sebagai:

- managed task
- app workload
- request-derived task
- job execution
- operation with correlation

Nama thread default seperti `Thread-1829` tidak membantu operator.

---

## 8. Kenapa `Executors.newFixedThreadPool()` Juga Bermasalah

Banyak engineer mengira masalahnya hanya `new Thread()`, lalu menggantinya dengan:

```java
private final ExecutorService executor = Executors.newFixedThreadPool(20);
```

Ini lebih rapi dari raw thread, tetapi masih unmanaged.

### 8.1 Pool Lifecycle Tidak Diikat ke Deployment

Siapa yang memanggil?

```java
executor.shutdown();
```

Kapan dipanggil?

- app shutdown?
- redeploy?
- server shutdown?
- failed startup?
- partial deployment failure?

Kalau lupa, pool bisa hidup terus.

### 8.2 Queue Default Bisa Berbahaya

Beberapa factory method punya queue yang tidak intuitif.

Contoh:

```java
Executors.newFixedThreadPool(n)
```

menggunakan unbounded queue (`LinkedBlockingQueue`) di belakangnya.

Artinya saat producer lebih cepat dari consumer:

```text
queue grows
    ↓
heap grows
    ↓
GC pressure
    ↓
latency worsens
    ↓
OOM risk
```

### 8.3 Mengabaikan Server-Wide Capacity

Application server mungkin sudah memiliki thread pool untuk:

- HTTP
- EJB
- async tasks
- messaging
- batch
- scheduled work

Jika aplikasi membuat pool sendiri, total concurrency aktual menjadi tidak terkendali:

```text
HTTP pool: 200
App custom pool A: 100
App custom pool B: 100
Scheduler custom pool: 20
Batch custom pool: 50
DB pool: 80
```

Sistem bisa collapse bukan karena CPU kurang, tetapi karena concurrency tidak sejajar dengan bottleneck.

### 8.4 Tidak Ada Context Propagation

ExecutorService Java SE tidak tahu:

- security context
- CDI context
- naming context
- classloader context
- transaction context

Jika context dibutuhkan, developer biasanya menyalinnya manual. Manual propagation sering tidak lengkap dan rawan leak.

---

## 9. Kenapa `ForkJoinPool.commonPool()` Berbahaya di Jakarta EE

`CompletableFuture` tanpa executor eksplisit menggunakan default executor, biasanya `ForkJoinPool.commonPool()`:

```java
CompletableFuture.supplyAsync(() -> loadData());
```

Masalahnya:

1. Pool ini bukan container-managed.
2. Pool ini shared secara JVM-wide.
3. Workload aplikasi bisa mengganggu workload lain.
4. Blocking I/O di common pool bisa mengganggu task lain.
5. Context Jakarta EE tidak otomatis benar.

Lebih aman:

```java
@Inject
ManagedExecutorService executor;

CompletableFuture.supplyAsync(() -> loadData(), executor);
```

Atau di Jakarta Concurrency modern, gunakan managed executor/resource yang sesuai.

---

## 10. Hidden Runtime Anti-Pattern

Anti-pattern besar dalam enterprise Java:

```text
Application server already provides runtime services,
but application secretly builds another runtime inside it.
```

Contoh hidden runtime:

```java
@ApplicationScoped
public class BackgroundRuntime {
    private final ExecutorService workers = Executors.newFixedThreadPool(30);
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);
    private final BlockingQueue<Job> queue = new LinkedBlockingQueue<>();

    @PostConstruct
    void start() {
        scheduler.scheduleAtFixedRate(this::poll, 0, 1, TimeUnit.SECONDS);
    }
}
```

Ini terlihat seperti solusi sederhana. Namun sekarang aplikasi punya:

- scheduler sendiri
- queue sendiri
- worker pool sendiri
- lifecycle sendiri
- retry semantics sendiri
- shutdown sendiri
- metrics sendiri
- duplicate prevention sendiri

Jika semua itu tidak didesain serius, sistem akan menjadi rapuh.

Pertanyaan arsitekturalnya:

> Apakah kamu sedang membangun feature, atau sedang membangun mini-platform tanpa sadar?

---

## 11. Managed Concurrency sebagai Kontrak

Jakarta Concurrency menyediakan beberapa konsep utama:

| Konsep | Tujuan |
|---|---|
| `ManagedExecutorService` | Menjalankan task async dengan thread yang dikelola container |
| `ManagedScheduledExecutorService` | Menjalankan task berdasarkan waktu/schedule dengan thread managed |
| `ManagedThreadFactory` | Membuat thread yang tetap container-aware untuk kasus khusus |
| `ContextService` | Membuat contextual proxy dan mengelola context propagation |
| Managed executor definitions | Mendefinisikan resource concurrency secara deklaratif |

Yang penting bukan hanya API-nya, tetapi kontraknya:

```text
Application asks container for execution capacity.
Container executes with proper runtime context and lifecycle governance.
```

Bukan:

```text
Application secretly creates execution capacity behind container's back.
```

---

## 12. Diagram: Managed vs Unmanaged Execution

### 12.1 Unmanaged Execution

```text
HTTP Request
    ↓
Application method
    ↓
new Thread / custom ExecutorService
    ↓
Background task
    ├── unknown to container lifecycle
    ├── uncertain classloader context
    ├── uncertain security context
    ├── uncertain transaction context
    ├── uncertain CDI context
    ├── weak observability
    └── shutdown/redeploy risk
```

### 12.2 Managed Execution

```text
HTTP Request
    ↓
Application method
    ↓
ManagedExecutorService.submit(task)
    ↓
Container-managed task execution
    ├── container-owned thread/resource
    ├── defined context behavior
    ├── lifecycle-aware execution
    ├── configured capacity
    ├── manageable rejection policy
    ├── better integration with server monitoring
    └── safer redeploy/shutdown behavior
```

---

## 13. Context Propagation Is Not Always Good

Banyak orang menyederhanakan masalah menjadi:

> “Async task harus membawa semua context dari request.”

Ini tidak selalu benar.

Kadang context harus dipropagasi:

- correlation ID
- application classloader
- naming context
- selected security identity

Kadang context tidak boleh dipropagasi:

- request-scoped mutable object
- transaction yang hampir selesai
- stale user session
- temporary locale/request state
- uploaded file stream dari request

Kadang context harus diubah menjadi explicit data:

```java
public record CaseRecalculationCommand(
    String caseId,
    String initiatedBy,
    String correlationId,
    Instant requestedAt,
    String reason
) {}
```

Lalu async task bekerja dari command tersebut, bukan dari implicit request state.

Mental model yang lebih aman:

```text
Do not propagate everything.
Propagate deliberately.
Persist what must survive.
Reconstruct what must be fresh.
Reject what is no longer valid.
```

---

## 14. Request Context vs Work Context

Request adalah interaksi user/system pada waktu tertentu.

Work adalah pekerjaan yang mungkin hidup lebih lama dari request.

```text
Request lifetime: 200 ms - 30 s
Work lifetime:    seconds - hours - days
```

Jika work bisa hidup lebih lama dari request, jangan desain work bergantung pada request context.

Buruk:

```text
background task depends on request-scoped bean/session/user connection
```

Lebih baik:

```text
request validates intent
request persists durable job request
worker executes job with explicit parameters
job writes status and audit trail
```

---

## 15. Transaction Boundary vs Execution Boundary

Salah satu kesalahan paling mahal adalah mencampur execution boundary dengan transaction boundary.

### 15.1 Synchronous Transaction

```text
request thread
  begin TX
    validate
    update DB
  commit TX
return response
```

Ini sederhana.

### 15.2 Async Work Inside Request Transaction

```text
request thread
  begin TX
    update DB
    submit async task
  commit TX

async task may run before/after commit
```

Masalah:

- task bisa membaca data sebelum commit
- task bisa gagal setelah transaction utama commit
- task bisa sukses padahal transaction utama rollback
- task external side effect tidak ikut rollback

### 15.3 Safer Pattern: Outbox

```text
request thread
  begin TX
    update business data
    insert outbox event/job request
  commit TX

managed worker/batch
  reads committed outbox
  performs side effect
  marks processed
```

Ini membuat async boundary durable dan transactionally consistent.

---

## 16. Security Boundary: User Intent vs Execution Authority

Dalam async/background work, selalu pisahkan:

```text
who requested the work?
who approved the work?
who is technically executing the work?
under what authority is the work allowed?
```

Contoh audit-safe model:

```text
JobRequest
  id=JOB-2026-0001
  type=CASE_ESCALATION_RECALCULATION
  requestedBy=alice
  approvedBy=manager01
  executionIdentity=system-batch-worker
  requestedAt=2026-06-17T10:15:00Z
  reason=Monthly compliance recalculation
  correlationId=REQ-abc-123
```

Jangan mengandalkan user session yang mungkin sudah logout ketika task berjalan.

---

## 17. Classloader Leak Deep Dive

Classloader leak sering abstrak, tapi sangat nyata.

### 17.1 Bagaimana Leak Terjadi

```java
public class MyBackgroundTask implements Runnable {
    @Override
    public void run() {
        while (true) {
            doWork();
        }
    }
}
```

Thread ini memegang instance `MyBackgroundTask`.

Instance itu berasal dari classloader aplikasi.

```text
Thread
  → Runnable instance
      → Class object
          → Application ClassLoader
              → all loaded classes/static fields/resources
```

Saat redeploy:

```text
old Application ClassLoader should be garbage collected
```

Tapi thread masih memegang reference.

Akibat:

```text
old classloader retained forever
```

### 17.2 Gejala

- memory naik setelah beberapa redeploy
- Metaspace naik
- old config masih dipakai
- duplicate scheduler execution
- log muncul dari versi aplikasi lama
- server perlu restart periodik

### 17.3 Pencegahan

- gunakan managed executor/scheduler
- hindari static holder untuk executor
- hindari raw thread
- pastikan cleanup di lifecycle callback jika benar-benar unavoidable
- jangan simpan reference ke request/contextual bean di long-lived object

---

## 18. ThreadLocal Leak Deep Dive

Thread pool memakai ulang thread.

Jika task A menulis `ThreadLocal` tetapi tidak membersihkan:

```java
USER_ID.set("alice");
// forgot USER_ID.remove()
```

Thread yang sama bisa menjalankan task B.

```text
Task B sees USER_ID=alice
```

Ini bisa menyebabkan:

- salah audit user
- salah tenant
- salah locale
- salah security decision
- memory leak karena object besar tertahan

MDC juga berbasis ThreadLocal pada banyak logging framework.

Pattern aman:

```java
try {
    MDC.put("correlationId", correlationId);
    doWork();
} finally {
    MDC.clear();
}
```

Namun lebih baik lagi gunakan container/context propagation mechanism jika tersedia dan pahami behavior server.

---

## 19. Production Failure Modes

### 19.1 Zombie Thread After Redeploy

**Gejala:**

- log dari versi lama masih muncul
- job berjalan dua kali
- thread name aneh tetap hidup
- CPU usage tidak turun setelah undeploy

**Root cause:**

- custom executor tidak shutdown
- raw thread infinite loop
- scheduler manual masih aktif

**Mitigasi:**

- managed executor/scheduler
- lifecycle-aware stop
- cooperative cancellation
- thread dump saat undeploy test

### 19.2 Executor Exhaustion

**Gejala:**

- request latency naik
- task async lambat mulai
- queue bertambah
- timeout downstream

**Root cause:**

- pool terlalu kecil untuk arrival rate
- downstream lambat
- task blocking terlalu lama
- tidak ada backpressure

**Mitigasi:**

- bounded executor
- rejection policy
- bulkhead per workload
- timeout downstream
- metrics active/queued/rejected

### 19.3 DB Pool Collapse

**Gejala:**

- `Connection is not available`
- request normal ikut gagal
- batch/background job menyedot connection

**Root cause:**

- concurrency task > DB capacity
- setiap task membuka transaction/connection
- no bulkhead antara request dan batch

**Mitigasi:**

- batasi concurrency berdasarkan DB pool
- pisahkan pool jika perlu
- chunking
- rate limit
- batch window

### 19.4 Lost Security Identity

**Gejala:**

- audit `createdBy` null/system
- authorization berbeda antara sync dan async
- operation gagal hanya saat async

**Root cause:**

- security context tidak dipropagasi
- async task bergantung pada request principal

**Mitigasi:**

- explicit initiatedBy/executedBy
- authorization at enqueue time + execution time
- use managed context propagation deliberately

### 19.5 Transaction Surprise

**Gejala:**

- async task tidak melihat data baru
- duplicate side effect
- external API called even though DB rollback
- optimistic lock conflict tinggi

**Root cause:**

- task submitted before transaction commit
- passing managed entity across thread
- long transaction

**Mitigasi:**

- outbox/job request table
- transaction after commit hook where appropriate
- re-fetch by ID
- idempotency key

### 19.6 Stuck Shutdown

**Gejala:**

- deployment stuck
- pod termination timeout
- server shutdown slow
- Kubernetes sends SIGKILL after grace period

**Root cause:**

- task ignores interruption
- custom executor not shutdown
- blocking I/O no timeout

**Mitigasi:**

- cooperative cancellation
- timeouts everywhere
- graceful shutdown test
- use managed lifecycle

---

## 20. Decision Table: Managed Executor vs Other Mechanisms

| Need | Better Choice | Reason |
|---|---|---|
| Small async offload within app | `ManagedExecutorService` | Container-managed thread/context |
| Run at specific delay/time | `ManagedScheduledExecutorService` | Managed scheduling |
| Long-running restartable job | Jakarta Batch | Job repository, checkpoint, restart |
| Cross-service durable side effect | Outbox + worker/message | Transactional durability |
| High-volume event processing | Messaging/streaming | Durable queue/backpressure |
| Cluster-wide scheduled job | External scheduler / DB lock / leader election | Avoid duplicate per node |
| One-off infrastructure task | Kubernetes Job | Operational isolation |
| Complex human/business workflow | BPM/workflow engine | State machine/process visibility |

---

## 21. Step-by-Step Reasoning: Evaluating an Async Design

Misal requirement:

> Setelah case diapprove, sistem harus generate 500 correspondence PDF dan kirim ke external document service.

Jangan langsung berpikir:

```java
executor.submit(() -> generateAllPdf(caseId));
```

Gunakan reasoning berikut.

### Step 1 — Apakah pekerjaan harus selesai sebelum response?

Jika tidak, pisahkan request dan work.

```text
approve request returns quickly
background work continues
```

### Step 2 — Apakah pekerjaan harus durable?

Jika server restart, apakah pekerjaan boleh hilang?

Kalau tidak boleh hilang, jangan hanya taruh di memory queue.

Gunakan:

- job request table
- outbox
- Jakarta Batch job repository
- message queue

### Step 3 — Apakah pekerjaan restartable?

Generate 500 PDF bisa gagal di item ke-327.

Butuh:

- status per item
- idempotency key
- retry policy
- skip/fail policy
- checkpoint

Jakarta Batch mungkin lebih cocok daripada simple managed executor.

### Step 4 — Apa context yang harus dibawa?

Bukan membawa full request context, tapi simpan explicit metadata:

```text
caseId
approvedBy
requestedAt
correlationId
reason
```

### Step 5 — Apa resource bottleneck?

- CPU untuk PDF?
- DB untuk data?
- external document service rate limit?
- storage I/O?

Concurrency harus mengikuti bottleneck terkecil.

### Step 6 — Apa failure semantics?

Jika external service timeout:

- retry?
- skip?
- fail job?
- manual intervention?
- compensate?

### Step 7 — Apa operator control?

Operator harus bisa:

- lihat progress
- stop job
- restart job
- inspect failed item
- audit siapa memulai

Ini mendorong desain ke Jakarta Batch/control plane, bukan raw async task.

---

## 22. Code Example: Bad vs Better

### 22.1 Bad: Raw Thread

```java
@Path("/cases")
public class CaseResource {

    @POST
    @Path("/{id}/recalculate")
    public Response recalculate(@PathParam("id") String id) {
        new Thread(() -> {
            recalculateCase(id);
        }).start();

        return Response.accepted().build();
    }

    private void recalculateCase(String id) {
        // DB + API + audit work
    }
}
```

Masalah:

- unmanaged thread
- no capacity control
- no context clarity
- no durable status
- no graceful cancellation
- no restart semantics
- poor audit

### 22.2 Better: Managed Executor with Explicit Command

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.Response;

@Path("/cases")
public class CaseResource {

    @Resource
    ManagedExecutorService executor;

    @POST
    @Path("/{id}/recalculate")
    public Response recalculate(@PathParam("id") String id) {
        CaseRecalculationCommand command = new CaseRecalculationCommand(
            id,
            currentUserId(),
            currentCorrelationId(),
            java.time.Instant.now(),
            "Manual recalculation requested"
        );

        executor.submit(() -> recalculateCase(command));

        return Response.accepted().build();
    }

    private void recalculateCase(CaseRecalculationCommand command) {
        // Open/use proper service boundary.
        // Re-fetch data.
        // Use explicit audit metadata.
    }

    private String currentUserId() {
        return "alice"; // simplified
    }

    private String currentCorrelationId() {
        return "REQ-123"; // simplified
    }
}

record CaseRecalculationCommand(
    String caseId,
    String initiatedBy,
    String correlationId,
    java.time.Instant requestedAt,
    String reason
) {}
```

Ini lebih baik, tetapi masih belum cukup jika pekerjaan harus durable/restartable.

### 22.3 More Production-Grade: Persist Job Request

```java
@POST
@Path("/{id}/recalculate")
public Response recalculate(@PathParam("id") String id) {
    String jobId = jobRequestService.createJobRequest(
        "CASE_RECALCULATION",
        id,
        currentUserId(),
        currentCorrelationId()
    );

    // Option A: managed executor wakes worker
    // Option B: batch job processes pending requests
    // Option C: message published through outbox

    return Response.accepted()
        .header("Location", "/jobs/" + jobId)
        .build();
}
```

Now work survives request completion and server restart.

---

## 23. Container Integrity and Kubernetes

Modern Jakarta EE apps often run on Kubernetes/EKS.

Kubernetes adds another lifecycle layer:

```text
Kubernetes Pod lifecycle
    ↓
Application server lifecycle
    ↓
Jakarta EE application lifecycle
    ↓
Managed task lifecycle
```

If unmanaged thread ignores shutdown:

```text
SIGTERM
  ↓
server tries graceful shutdown
  ↓
unmanaged task keeps blocking
  ↓
grace period exceeded
  ↓
SIGKILL
  ↓
partial work / corrupted state / duplicate retry later
```

Managed concurrency does not solve every Kubernetes concern, but it aligns task lifecycle with server lifecycle.

For long-running work, design explicit stop/restart behavior.

---

## 24. Capacity Model: Thread Is Not the Bottleneck

A common mistake:

> “If task is slow, add more threads.”

But enterprise workload usually bottlenecked by:

- DB connection pool
- DB locks
- external API rate limit
- CPU
- disk I/O
- memory/GC
- remote latency
- transaction contention

Example:

```text
DB pool size = 30
HTTP request threads = 100
background executor = 100
```

If each background task needs DB connection:

```text
100 background tasks compete for 30 DB connections
request threads starve
system appears down
```

Concurrency limit should be derived from bottleneck.

Rule of thumb:

```text
executor concurrency <= safe capacity of downstream dependency
```

Not:

```text
executor concurrency = number that feels fast
```

---

## 25. Failure Modeling Checklist

Sebelum membuat async/background execution, jawab pertanyaan berikut:

### 25.1 Lifecycle

- Apa yang terjadi saat app redeploy?
- Apa yang terjadi saat server shutdown?
- Apa yang terjadi saat pod eviction?
- Apakah task bisa dihentikan?
- Apakah task bisa dilanjutkan?

### 25.2 Context

- Context apa yang harus dibawa?
- Context apa yang tidak boleh dibawa?
- Metadata apa yang harus dibuat explicit?
- Apakah user session masih valid saat task berjalan?

### 25.3 Transaction

- Apakah task membaca data committed?
- Apakah task punya transaction sendiri?
- Apakah task boleh berjalan jika transaction request rollback?
- Apakah external side effect idempotent?

### 25.4 Capacity

- Berapa max concurrent task?
- Apa queue bound?
- Apa rejection behavior?
- Apa downstream bottleneck?
- Apakah request workload diproteksi dari background workload?

### 25.5 Failure

- Retry berapa kali?
- Error apa yang retryable?
- Error apa yang fatal?
- Apa yang terjadi pada poison item?
- Bagaimana operator tahu ada failure?

### 25.6 Observability

- Ada correlation ID?
- Ada task ID/job ID?
- Ada metrics active/queued/completed/failed?
- Bisa lihat stuck task?
- Bisa audit initiatedBy/executedBy?

---

## 26. Anti-Patterns

### 26.1 Fire-and-Forget Without Status

```java
executor.submit(() -> doImportantWork());
return Response.accepted().build();
```

Tanpa status, user/operator tidak tahu apakah berhasil.

### 26.2 Passing Managed Entity to Another Thread

```java
Case c = em.find(Case.class, id);
executor.submit(() -> process(c));
```

Entity terkait persistence context/thread/transaction tertentu.

Pass ID, bukan managed entity.

### 26.3 Async Work Before Commit

```java
saveCase();
executor.submit(() -> notifyExternalSystem(caseId));
```

Jika transaction rollback, external system sudah terlanjur dipanggil.

Gunakan outbox atau after-commit pattern.

### 26.4 Unbounded Queue

```java
Executors.newFixedThreadPool(10);
```

Fixed thread pool default punya unbounded queue.

### 26.5 Context Copy-Paste Manual

```java
String user = CurrentUser.get();
Locale locale = LocaleContext.get();
Map<String, String> mdc = MDC.getCopyOfContextMap();
```

Manual context propagation sering lupa cleanup dan tidak mencakup container context.

### 26.6 Scheduler Per Node Without Cluster Awareness

```java
@ApplicationScoped
class MyScheduler {
    @PostConstruct
    void start() {
        executor.scheduleAtFixedRate(this::runJob, 0, 1, HOURS);
    }
}
```

Di cluster 4 node:

```text
job runs 4 times
```

---

## 27. Best Practices

1. Gunakan managed concurrency resource di Jakarta EE.
2. Jangan membuat raw thread di application component.
3. Jangan memakai common pool untuk workload enterprise tanpa sadar.
4. Selalu pass explicit command data ke async task.
5. Jangan pass `EntityManager`, managed entity, request object, input stream, atau request-scoped bean ke background thread.
6. Pisahkan `initiatedBy`, `executedBy`, dan `approvedBy`.
7. Gunakan durable job/outbox untuk work yang tidak boleh hilang.
8. Gunakan Jakarta Batch untuk work yang butuh checkpoint/restart/progress control.
9. Batasi concurrency berdasarkan downstream capacity.
10. Desain cancellation dan timeout dari awal.
11. Tambahkan metrics active/queued/failed/rejected/duration.
12. Test redeploy/shutdown behavior, bukan hanya happy path.
13. Treat async boundary as architectural boundary.

---

## 28. Practical Architecture Pattern

### 28.1 Request to Durable Work

```text
Client
  ↓
REST endpoint
  ↓
Validate permission
  ↓
Begin transaction
  ↓
Write business state
  ↓
Write job_request/outbox
  ↓
Commit
  ↓
Return 202 Accepted + jobId
```

### 28.2 Worker Execution

```text
Managed executor / batch runtime
  ↓
Claim job
  ↓
Set correlation/audit context
  ↓
Open transaction per safe unit
  ↓
Process item/chunk
  ↓
Record progress
  ↓
Handle retry/skip/fail
  ↓
Mark complete
```

### 28.3 Operator View

```text
GET /jobs/{jobId}
  → status
  → progress
  → startedAt/completedAt
  → initiatedBy/executedBy
  → failed item count
  → error summary
  → retry/restart eligibility
```

---

## 29. Relation to Jakarta Batch

Managed concurrency is good for:

- bounded async task
- fan-out/fan-in inside app
- short/medium-lived background operation
- scheduling with clear limits

Jakarta Batch is better for:

- long-running job
- checkpoint/restart
- chunk processing
- item-level skip/retry
- partitioned processing
- operational job repository
- progress tracking

Simple distinction:

```text
ManagedExecutorService = execute tasks safely inside container
Jakarta Batch          = execute jobs with state, progress, checkpoint, restart
```

A top-tier engineer does not choose based on familiarity. They choose based on failure semantics.

---

## 30. Thought Experiment

Bayangkan endpoint:

```text
POST /reports/monthly-compliance
```

Endpoint ini generate report besar untuk 30.000 cases.

Pertanyaan:

1. Apakah boleh selesai dalam request thread?
2. Jika pod mati di tengah proses, apakah report boleh hilang?
3. Jika item ke-20.000 gagal, apakah ulang dari awal?
4. Apakah user yang trigger masih harus login saat proses berjalan?
5. Bagaimana audit membuktikan siapa yang meminta report?
6. Apakah job boleh jalan di semua node?
7. Apa batas concurrency terhadap DB?
8. Bagaimana operator membatalkan job?
9. Bagaimana progress ditampilkan?
10. Apakah external side effect idempotent?

Jika jawaban pertanyaan-pertanyaan ini penting, kamu sedang mendesain workload orchestration, bukan sekadar async method.

---

## 31. Summary Mental Model

Container integrity adalah kemampuan container menjaga invariant runtime walaupun aplikasi melakukan concurrency.

Unmanaged thread merusak atau melemahkan invariant ini karena container tidak sepenuhnya tahu:

- thread itu milik siapa
- kapan harus dihentikan
- context apa yang berlaku
- resource apa yang dipakai
- security identity apa yang sah
- transaction boundary apa yang benar
- bagaimana mengobservasi task tersebut

Managed concurrency bukan sekadar “executor service versi Jakarta”. Ia adalah kontrak antara aplikasi dan container:

```text
Application declares work.
Container governs execution.
```

Untuk engineer level tinggi, pertanyaannya bukan hanya:

> “Bagaimana menjalankan task secara async?”

Tetapi:

> “Bagaimana menjalankan work secara async tanpa merusak lifecycle, security, transaction, capacity, audit, observability, dan restartability?”

Itulah fondasi seluruh seri ini.

---

## 32. Checklist Cepat

Sebelum memakai concurrency di Jakarta EE:

- [ ] Apakah saya memakai managed resource?
- [ ] Apakah task boleh hilang jika server restart?
- [ ] Apakah butuh Jakarta Batch/job repository?
- [ ] Apakah saya pass explicit command, bukan request object/entity?
- [ ] Apakah transaction boundary jelas?
- [ ] Apakah security attribution jelas?
- [ ] Apakah concurrency limit sesuai downstream capacity?
- [ ] Apakah queue bounded?
- [ ] Apakah timeout dan cancellation jelas?
- [ ] Apakah context propagation disengaja?
- [ ] Apakah logging/correlation aman?
- [ ] Apakah redeploy/shutdown sudah diuji?
- [ ] Apakah operator bisa melihat status/progress/failure?

---

## 33. Referensi

- Jakarta Concurrency 3.1 Specification — https://jakarta.ee/specifications/concurrency/3.1/
- Jakarta Concurrency 3.1 Spec Document — https://jakarta.ee/specifications/concurrency/3.1/jakarta-concurrency-spec-3.1
- Jakarta EE 11 Release — https://jakarta.ee/release/11/
- Jakarta EE Tutorial: Concurrency Utilities — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/concurrency-utilities/concurrency-utilities.html
- Jakarta Concurrency Explained — https://jakarta.ee/learn/specification-guides/concurrency-explained/
- ManagedExecutorService API — https://jakarta.ee/specifications/concurrency/3.0/apidocs/jakarta.concurrency/jakarta/enterprise/concurrent/managedexecutorservice

---

## 34. Status Seri

Seri belum selesai.

Bagian ini adalah:

```text
Part 2 — Container Integrity: Why Managed Concurrency Exists
```

Bagian berikutnya:

```text
Part 3 — ManagedExecutorService Deep Dive
File: 03-managed-executor-service-deep-dive.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 1 — Historical Map: Java EE Concurrency Utilities to Jakarta Concurrency](./01-history-java-ee-concurrency-to-jakarta-concurrency.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 3 — ManagedExecutorService Deep Dive](./03-managed-executor-service-deep-dive.md)

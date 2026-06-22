# learn-java-servlet-websocket-web-container-runtime-part-018

# Part 018 — Threading Model: Classic Servlet, Platform Threads, Virtual Threads

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `018 / 031`  
> Topik: Servlet threading model, worker pool, blocking boundary, virtual threads, `ThreadLocal`, context propagation, and capacity failure modelling  
> Target pembaca: engineer Java backend yang ingin memahami web runtime sampai level capacity, concurrency, observability, dan failure analysis

---

## 0. Tujuan Part Ini

Setelah memahami Servlet lifecycle, request/response object, dispatching, filter, listener, context, session, async servlet, non-blocking I/O, dan large payload handling, sekarang kita masuk ke salah satu area yang paling sering membedakan engineer biasa dan engineer senior/top-tier:

> **Bagaimana request benar-benar dieksekusi oleh thread, apa yang terjadi saat blocking, bagaimana container mengatur concurrency, dan kenapa virtual thread bukan magic capacity multiplier.**

Part ini tidak mengulang seluruh materi Java concurrency. Fokusnya spesifik pada **Servlet/Web runtime**:

- thread-per-request klasik;
- worker thread pool di servlet container;
- hubungan request concurrency dengan downstream capacity;
- shared servlet instance dan thread-safety;
- `ThreadLocal`, MDC, security context, request context;
- async servlet vs platform thread vs virtual thread;
- virtual threads Java 21+ dalam server-side web runtime;
- scoped values dan structured concurrency sebagai arah runtime modern Java 25;
- failure model production: starvation, queue buildup, overload, pool exhaustion, pinned virtual thread, context leak, and misleading metrics.

Mental model utamanya:

> **Servlet performance bukan hanya soal “berapa thread”. Servlet performance adalah koordinasi antara arrival rate, service time, queue, blocking point, downstream limit, memory footprint, cancellation, timeout, and graceful degradation.**

---

## 1. Kenapa Threading Model Penting untuk Servlet Engineer

Di banyak framework modern, developer menulis kode seperti ini:

```java
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable String id) {
    return caseService.getCase(id);
}
```

Atau Servlet mentah seperti ini:

```java
@Override
protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
    String id = req.getParameter("id");
    CaseDto dto = caseService.getCase(id);
    resp.setContentType("application/json");
    resp.getWriter().write(objectMapper.writeValueAsString(dto));
}
```

Dari sudut pandang application code, terlihat sederhana. Tapi dari sudut pandang runtime, banyak hal terjadi:

```text
TCP connection accepted
  -> HTTP request parsed
  -> request mapped to context/servlet/filter/framework
  -> worker execution begins
  -> application code runs
  -> maybe blocks on DB/HTTP/cache/filesystem
  -> response generated
  -> bytes written to socket/proxy/client
  -> thread returned/released
```

Setiap request membutuhkan **execution capacity**. Pada classic servlet model, execution capacity biasanya berupa **platform thread** dari pool container. Jika semua thread sibuk, request berikutnya tidak bisa langsung diproses. Ia akan antre, ditolak, timeout, atau akhirnya menyebabkan efek domino.

Top-tier engineer tidak hanya bertanya:

> “Endpoint ini cepat atau lambat?”

Tapi bertanya:

> “Endpoint ini mengonsumsi resource apa, selama berapa lama, pada concurrency berapa, dengan bottleneck di mana, dan bagaimana sistem gagal saat demand melebihi capacity?”

---

## 2. Model Dasar: Thread-Per-Request

Model servlet klasik sering disebut **thread-per-request**.

Secara sederhana:

```text
Request A -> Worker Thread 1 -> application code -> response
Request B -> Worker Thread 2 -> application code -> response
Request C -> Worker Thread 3 -> application code -> response
```

Satu request aktif biasanya dikerjakan oleh satu thread container sampai response selesai, kecuali:

- request masuk mode async servlet;
- request dipindah ke executor lain;
- request memakai non-blocking I/O callback;
- framework menjalankan sebagian pekerjaan di worker lain;
- virtual thread digunakan sebagai executor request.

### 2.1 Kenapa model ini populer?

Karena mental model-nya mudah:

```java
read request
call service
call database
build response
return
```

Control flow linear, stack trace jelas, debugging mudah, dan business logic tidak perlu callback-heavy.

### 2.2 Kelemahan model klasik

Kelemahan muncul saat request banyak menghabiskan waktu untuk **menunggu**:

- menunggu DB connection;
- menunggu query selesai;
- menunggu HTTP call ke service lain;
- menunggu Redis/cache;
- menunggu filesystem/object storage;
- menunggu lock;
- menunggu external API rate limit;
- menunggu client lambat menerima response.

Saat platform thread menunggu, thread itu tetap reserved. Ia tidak bisa mengerjakan request lain.

```text
Worker thread state:
RUNNABLE?     maybe useful CPU work
WAITING?      blocked on lock/condition
TIMED_WAITING? sleep/wait with timeout
BLOCKED?      monitor contention
native/socket wait? waiting for I/O
```

Banyak aplikasi web production bukan CPU-bound, tapi **wait-bound**.

---

## 3. Platform Threads: Apa yang Mahal?

Sebelum virtual threads, Java server umumnya memakai **platform threads**, yaitu Java thread yang dipetakan ke OS thread.

Platform thread mahal karena:

- punya stack memory relatif besar;
- dibuat/dihancurkan tidak gratis;
- scheduling dilakukan OS;
- context switching banyak dapat mahal;
- jumlah thread terlalu besar bisa meningkatkan memory dan latency;
- blocking thread berarti OS thread ikut tertahan.

Karena itu servlet container memakai **thread pool**, bukan membuat thread baru tak terbatas per request.

```text
Container worker pool
  minSpareThreads: 10
  maxThreads: 200
  activeThreads: 147
  queuedRequests: 35
```

Thread pool memberi batas, tapi juga membuat failure mode:

```text
if activeThreads == maxThreads:
    new requests cannot immediately execute
    -> wait in accept queue / executor queue
    -> timeout
    -> 503/504 from proxy
    -> user retries
    -> load increases
```

---

## 4. Servlet Container Threading: Dari Socket ke Worker

Walaupun detail tiap container berbeda, pola besarnya mirip:

```text
Client
  -> TCP connection
  -> Connector
  -> Acceptor
  -> Poller/Selector/NIO event loop
  -> Worker/executor
  -> Filter chain
  -> Servlet/framework
  -> Response write
```

### 4.1 Acceptor

Acceptor menerima koneksi baru dari socket server.

```text
accept TCP connection
register connection with poller/selector
```

Jumlah acceptor biasanya kecil.

### 4.2 Poller / selector / event loop

Pada NIO connector, socket readiness sering dipantau oleh selector/poller. Ini bukan business worker thread. Tugasnya melihat koneksi mana yang siap dibaca/ditulis.

### 4.3 Worker thread

Worker thread menjalankan request processing.

```text
parse request enough
map to application
run filters
run servlet
run framework controller/resource
write/flush response
```

Di titik inilah application code Anda biasanya berjalan.

### 4.4 Container-specific detail tidak boleh diasumsikan terlalu keras

Tomcat, Jetty, Undertow, WildFly, Open Liberty, Payara, dan embedded server punya detail berbeda. Tapi mental model capacity-nya tetap sama:

```text
network accepts connection
container schedules request execution
application consumes execution resource
response consumes output resource
```

---

## 5. Shared Servlet Instance dan Thread-Safety

Servlet container biasanya membuat satu instance servlet untuk satu servlet declaration, lalu banyak request masuk ke instance yang sama secara concurrent.

Berbahaya:

```java
public class UnsafeServlet extends HttpServlet {
    private String currentUser;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        currentUser = req.getParameter("user");
        doSomething();
        resp.getWriter().write("user=" + currentUser);
    }
}
```

Jika dua request masuk bersamaan:

```text
Request A sets currentUser = alice
Request B sets currentUser = bob
Request A writes currentUser -> bob
```

### 5.1 Rule praktis

Di servlet/filter/listener singleton-like object:

- immutable dependency: aman;
- stateless method-local variable: aman;
- thread-safe shared service: aman jika benar-benar thread-safe;
- mutable per-request field: tidak aman;
- collection global tanpa concurrency control: tidak aman;
- cache manual tanpa eviction/locking: rawan;
- formatter lama seperti `SimpleDateFormat`: tidak aman jika shared;
- `ObjectMapper` biasanya reusable setelah configured, tapi jangan mutate config runtime.

Aman:

```java
public class SafeServlet extends HttpServlet {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final CaseService caseService;

    public SafeServlet(CaseService caseService) {
        this.caseService = caseService;
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String currentUser = req.getParameter("user");
        CaseDto result = caseService.findForUser(currentUser);
        resp.getWriter().write(objectMapper.writeValueAsString(result));
    }
}
```

---

## 6. Request Concurrency Bukan Sama Dengan User Count

Salah satu kesalahan kapasitas paling umum:

> “Ada 10.000 user, berarti butuh 10.000 thread.”

Tidak. Yang penting adalah **concurrent active requests**, bukan total user login.

Jika 10.000 user membuka aplikasi, tapi hanya 200 request yang sedang aktif pada saat yang sama, worker capacity sekitar 200 request active mungkin cukup, tergantung service time dan queue.

Gunakan mental model Little's Law:

```text
Concurrency ≈ Throughput × Latency
```

Contoh:

```text
Throughput target: 100 requests/second
Average latency: 200 ms = 0.2 second
Estimated active requests: 100 × 0.2 = 20
```

Jika latency naik:

```text
Throughput target: 100 requests/second
Average latency: 2 seconds
Estimated active requests: 100 × 2 = 200
```

Throughput sama, tapi butuh active execution capacity 10x lebih besar karena request lebih lama selesai.

### 6.1 Tail latency lebih penting daripada average

Average latency menipu. Jika sebagian kecil request lambat, thread bisa tertahan lama.

```text
p50 = 80 ms
p95 = 2 s
p99 = 10 s
```

Pada puncak traffic, p99 request yang lambat dapat mengisi thread pool dan menyebabkan request ringan ikut antre.

---

## 7. Capacity Chain: Thread Pool Bukan Satu-Satunya Limit

Request web melewati banyak resource limit:

```text
client connections
  -> load balancer max connections
  -> proxy worker/connection limit
  -> container accept queue
  -> servlet worker pool
  -> DB connection pool
  -> HTTP client connection pool
  -> Redis pool
  -> message broker channel/pool
  -> external API rate limit
  -> CPU
  -> memory
  -> disk/network bandwidth
```

Sistem hanya sekuat bottleneck terkecil.

Misal:

```text
Tomcat maxThreads = 300
Hikari maxPoolSize = 30
DB can handle 50 active queries
External API rate limit = 100/min
```

Jika 300 servlet threads serentak menunggu 30 DB connections:

```text
30 requests execute DB query
270 requests wait for DB connection
all 300 servlet threads occupied
new requests queue/timeout
```

Menaikkan `maxThreads` ke 600 bisa membuat keadaan lebih buruk:

```text
30 execute DB
570 wait
more memory
more queue
more timeout
longer recovery
```

### 7.1 Prinsip penting

> **Thread pool yang terlalu besar dapat mengubah bottleneck kecil menjadi kegagalan sistemik yang lebih lambat dan lebih mahal.**

---

## 8. Request Lifecycle sebagai Execution State Machine

Untuk menganalisis threading, jangan hanya lihat method call. Lihat state request.

```text
NEW
  -> ACCEPTED
  -> QUEUED_FOR_WORKER
  -> RUNNING_APP_CODE
  -> WAITING_DOWNSTREAM
  -> WAITING_DB_CONNECTION
  -> WRITING_RESPONSE
  -> COMPLETED
```

Failure path:

```text
QUEUED_FOR_WORKER
  -> proxy timeout
  -> client retry

WAITING_DB_CONNECTION
  -> pool timeout
  -> app error response

WRITING_RESPONSE
  -> client abort
  -> broken pipe

RUNNING_APP_CODE
  -> uncaught exception
  -> error dispatch
```

Async path:

```text
RUNNING_APP_CODE
  -> startAsync
  -> CONTAINER_THREAD_RELEASED
  -> ASYNC_WORK_RUNNING
  -> ASYNC_DISPATCH_OR_COMPLETE
  -> RESPONSE_COMMITTED
```

Virtual thread path:

```text
RUNNING_ON_VIRTUAL_THREAD
  -> blocking call parks virtual thread
  -> carrier thread reused if not pinned
  -> unpark when result available
  -> response written
```

---

## 9. ThreadLocal, MDC, Security Context, and Request Context

Servlet stacks sering memakai `ThreadLocal` untuk menyimpan context request:

- correlation/request ID;
- authenticated principal;
- locale;
- tenant ID;
- transaction context;
- request-scoped framework context;
- logging MDC.

Contoh logging MDC:

```java
public class CorrelationFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest http = (HttpServletRequest) request;
        String requestId = Optional.ofNullable(http.getHeader("X-Request-Id"))
                .filter(s -> !s.isBlank())
                .orElse(UUID.randomUUID().toString());

        try {
            MDC.put("requestId", requestId);
            chain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
        }
    }
}
```

### 9.1 Kenapa harus cleanup?

Platform thread di pool dipakai ulang.

```text
Thread-17 handles Request A -> MDC requestId=A
Thread-17 returned to pool
Thread-17 handles Request B -> if MDC not cleared, log B may contain A
```

Ini bukan sekadar bug logging. Bisa menjadi security bug jika context tenant/user bocor.

### 9.2 ThreadLocal dan async

Async memindahkan execution ke thread lain. `ThreadLocal` tidak otomatis ikut.

```java
CompletableFuture.supplyAsync(() -> {
    // MDC/security context may be missing here
    return callBackend();
});
```

Perlu explicit propagation:

```java
Map<String, String> contextMap = MDC.getCopyOfContextMap();

executor.submit(() -> {
    Map<String, String> previous = MDC.getCopyOfContextMap();
    try {
        if (contextMap != null) {
            MDC.setContextMap(contextMap);
        }
        doWork();
    } finally {
        if (previous != null) {
            MDC.setContextMap(previous);
        } else {
            MDC.clear();
        }
    }
});
```

### 9.3 ThreadLocal dan virtual threads

Virtual thread membuat `ThreadLocal` lebih tricky:

- jumlah virtual thread bisa sangat besar;
- setiap virtual thread bisa membawa `ThreadLocal` sendiri;
- large object di `ThreadLocal` dapat memperbesar memory footprint;
- framework yang banyak memakai `ThreadLocal` tetap harus diuji;
- cleanup tetap wajib.

Virtual threads mengurangi biaya thread blocking, bukan menghilangkan konsekuensi context leak.

---

## 10. Async Servlet vs Virtual Threads

Async servlet dan virtual thread sering dianggap solusi yang sama. Padahal berbeda.

| Aspek | Async Servlet | Virtual Thread |
|---|---|---|
| Tujuan utama | Melepas container worker saat request menunggu event/resource | Membuat blocking code murah secara concurrency |
| Programming style | Callback/future/dispatch/complete | Linear blocking style |
| API Servlet | `startAsync`, `AsyncContext`, `AsyncListener` | Container/executor/runtime support |
| Complexity | Lifecycle state machine eksplisit | Lebih sederhana untuk application code |
| Risiko utama | lupa `complete`, timeout race, context propagation | pinning, downstream overload, unbounded concurrency |
| Cocok untuk | long polling, SSE, delayed response, event wait | blocking I/O heavy apps dengan banyak wait time |
| Tidak menyelesaikan | downstream limit | downstream limit |

### 10.1 Async bukan otomatis non-blocking

Kode ini async di level servlet, tapi tetap blocking di executor:

```java
AsyncContext async = req.startAsync();
executor.submit(() -> {
    try {
        Result result = blockingService.call();
        async.getResponse().getWriter().write(toJson(result));
    } catch (Exception e) {
        async.complete();
    } finally {
        async.complete();
    }
});
```

Container thread dilepas, tapi executor thread tetap blocking.

### 10.2 Virtual threads membuat blocking style lebih scalable, tapi bukan gratis

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> blockingService.call());
}
```

Saat virtual thread melakukan blocking I/O yang didukung runtime, virtual thread bisa diparkir dan carrier platform thread dipakai pekerjaan lain. Tapi:

- DB connection tetap terbatas;
- external API tetap punya rate limit;
- CPU tetap terbatas;
- memory tetap terbatas;
- synchronized/native/pinning bisa mengurangi benefit;
- response client lambat tetap butuh flow control.

---

## 11. Virtual Threads: Mental Model untuk Servlet Runtime Modern

Virtual threads adalah thread ringan di Java yang dirancang untuk concurrency tinggi dengan gaya pemrograman blocking/imperative.

Model konseptual:

```text
Virtual Thread A running on Carrier Platform Thread 1
Virtual Thread A blocks on socket I/O
Virtual Thread A is parked
Carrier Platform Thread 1 runs Virtual Thread B
I/O ready
Virtual Thread A resumes later
```

Ini berbeda dari platform thread:

```text
Platform Thread A blocks on socket I/O
OS thread remains blocked
```

### 11.1 Kenapa relevan untuk Servlet?

Servlet code tradisional banyak blocking:

```java
CaseEntity entity = repository.findById(id); // DB blocking
RiskProfile profile = riskClient.fetch(id);  // HTTP blocking
String json = objectMapper.writeValueAsString(dto);
```

Reactive programming mencoba membuat blocking wait tidak menghabiskan thread melalui event loop dan callback/stream chain. Virtual thread memberi alternatif: tetap menulis kode blocking linear, tapi dengan thread yang jauh lebih murah.

### 11.2 Container support

Container modern mulai menyediakan cara menjalankan request/task dengan virtual threads. Konfigurasi aktual berbeda per container dan versi.

Konsepnya:

```text
classic:
  connector -> platform worker pool -> request code

virtual thread capable:
  connector/event infrastructure -> virtual thread executor -> request code
```

Namun tetap ada bagian container yang memakai platform thread:

- acceptor;
- poller/selector;
- scheduler;
- internal lifecycle thread;
- garbage collector/JIT/internal JVM;
- some native operations.

Virtual thread bukan berarti seluruh server menjadi virtual-thread-only.

---

## 12. Virtual Threads dan Downstream Bottleneck

Misal endpoint:

```java
public CaseDto getCase(String id) {
    Case c = db.findCase(id);              // needs DB connection
    Profile p = profileClient.get(c.nric); // external HTTP
    return mapper.toDto(c, p);
}
```

Dengan platform threads:

```text
max request threads = 200
DB pool = 30
profile HTTP pool = 50
```

Dengan virtual threads:

```text
max virtual requests = maybe thousands
DB pool = still 30
profile HTTP pool = still 50
```

Jika tidak ada admission control, virtual threads bisa membuat lebih banyak request masuk ke waiting state:

```text
1000 virtual requests
30 hold DB connections
970 wait for DB connection
```

Memang platform threads tidak habis dengan cara yang sama, tapi user latency tetap naik, DB pool tetap bottleneck, dan memory/queue/backlog tetap dapat membesar.

### 12.1 Virtual threads perlu concurrency gate

Gunakan semaphore/bulkhead untuk downstream:

```java
public final class Bulkhead {
    private final Semaphore permits;

    public Bulkhead(int maxConcurrent) {
        this.permits = new Semaphore(maxConcurrent);
    }

    public <T> T call(Callable<T> action) throws Exception {
        if (!permits.tryAcquire(200, TimeUnit.MILLISECONDS)) {
            throw new ServiceUnavailableException("Downstream busy");
        }
        try {
            return action.call();
        } finally {
            permits.release();
        }
    }
}
```

Dalam virtual thread world, limit concurrency bukan lagi sekadar `maxThreads`; Anda perlu eksplisit membatasi:

- DB operations;
- outbound HTTP operations;
- expensive CPU tasks;
- file processing;
- object storage operations;
- per-tenant/per-user traffic;
- expensive report generation.

---

## 13. Pinned Virtual Threads

Virtual thread biasanya bisa diparkir saat blocking I/O. Namun ada situasi yang dapat **pin** virtual thread ke carrier platform thread, sehingga carrier tidak bisa dipakai virtual thread lain selama blocking.

Contoh risiko:

- blocking saat berada dalam `synchronized` block;
- beberapa native calls;
- monitor contention tertentu;
- library lama yang tidak friendly terhadap virtual threads.

Contoh buruk:

```java
public synchronized CaseDto loadCase(String id) {
    // Blocking DB call inside synchronized method.
    // With virtual threads, this can pin carrier while waiting.
    return repository.findCase(id);
}
```

Lebih baik:

```java
public CaseDto loadCase(String id) {
    // Avoid broad synchronized boundary around blocking I/O.
    return repository.findCase(id);
}
```

Jika butuh deduplication per key:

```java
private final ConcurrentHashMap<String, CompletableFuture<CaseDto>> inFlight = new ConcurrentHashMap<>();

public CaseDto loadCaseDedup(String id) {
    CompletableFuture<CaseDto> future = inFlight.computeIfAbsent(id, key ->
        CompletableFuture.supplyAsync(() -> repository.findCase(key))
            .whenComplete((v, e) -> inFlight.remove(key))
    );
    return future.join();
}
```

Tetap perlu hati-hati: `computeIfAbsent` function tidak boleh menjalankan blocking berat langsung di lock map internal.

---

## 14. CPU-Bound Work: Virtual Threads Tidak Membuat CPU Bertambah

Jika request CPU-bound:

```java
compress huge payload
hash large file
render PDF
process image
run big in-memory calculation
serialize massive graph
```

Virtual thread tidak memberi throughput ajaib. CPU core tetap batas.

```text
8 CPU cores
1000 CPU-bound virtual threads
=> contention, scheduling overhead, latency spike
```

Untuk CPU-bound task:

- gunakan bounded executor;
- batasi concurrency sesuai core;
- offload ke worker service jika berat;
- gunakan queue dengan rejection policy;
- buat endpoint async/job-based untuk task lama;
- jangan biarkan request path melakukan CPU heavy task tak terbatas.

```java
ExecutorService cpuPool = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());
```

Virtual threads cocok untuk **I/O-bound blocking concurrency**, bukan menggandakan core CPU.

---

## 15. Thread Pool Tuning: Jangan Mulai dari Angka, Mulai dari Model

Banyak orang bertanya:

> “Tomcat maxThreads sebaiknya berapa?”

Pertanyaan yang lebih benar:

1. Berapa target throughput?
2. Berapa latency p50/p95/p99?
3. Request blocking di mana?
4. Berapa DB pool?
5. Berapa outbound HTTP pool?
6. Berapa CPU core?
7. Berapa memory per request?
8. Apa timeout di proxy/container/app/downstream?
9. Apa policy saat overload?

### 15.1 Estimasi sederhana

```text
Target RPS: 200
p95 latency: 500 ms
Estimated p95 concurrency: 200 × 0.5 = 100 active requests
```

Jika p99 5 detik:

```text
200 × 5 = 1000 active requests at p99 condition
```

Artinya p99 tail dapat menghancurkan worker pool.

### 15.2 Align thread dengan downstream

Misal:

```text
maxThreads = 200
DB pool = 30
HTTP client pool = 50
```

Jika setiap request butuh DB, 200 threads terlalu banyak untuk DB pool 30 tanpa queue strategy. Tapi jika hanya 20% request butuh DB dan sisanya static/light, angka bisa masuk akal.

Tidak ada angka universal.

---

## 16. Queueing: Silent Killer di Web Runtime

Saat thread pool penuh, request tidak selalu langsung gagal. Ia bisa antre.

Antrean memberi ilusi sistem masih menerima traffic, padahal latency sedang membusuk.

```text
arrival rate > service rate
queue grows
latency grows
timeouts happen
clients retry
arrival rate grows more
system collapses
```

### 16.1 Antrean panjang bisa lebih buruk daripada fail fast

Jika request timeout di client setelah 30 detik, tapi server tetap memprosesnya selama 60 detik, server melakukan pekerjaan untuk user yang sudah pergi.

Desain lebih sehat:

- batasi queue;
- gunakan timeout pendek dan konsisten;
- reject lebih awal dengan `503` saat overload;
- gunakan `Retry-After` jika cocok;
- batasi per-tenant/per-user;
- jangan biarkan retry storm.

### 16.2 Queue harus punya meaning

Antrean boleh ada jika:

- bounded;
- observable;
- timeout-aware;
- ada rejection policy;
- tidak melampaui downstream capacity;
- sesuai UX.

---

## 17. Timeout Alignment

Timeout adalah bagian dari threading model karena request yang menunggu terlalu lama menahan execution capacity.

Contoh buruk:

```text
Browser/client timeout: 30s
Load balancer timeout: 60s
Servlet async timeout: 120s
DB query timeout: none
HTTP client timeout: none
```

Akibat:

```text
client sudah menyerah
server masih memproses
DB masih bekerja
thread/connection masih tertahan
```

Lebih sehat:

```text
Client timeout: 30s
LB/proxy timeout: 35s
Servlet/app timeout: 25s
DB query timeout: 20s
HTTP client timeout: connect 1s, read 3-10s depending use case
```

Prinsip:

> **Inner timeout sebaiknya lebih pendek daripada outer timeout supaya aplikasi bisa mengembalikan error terkontrol sebelum proxy/client memutus sepihak.**

---

## 18. Cancellation dan Client Abort

Dalam classic servlet blocking model, jika client disconnect, application code belum tentu langsung berhenti.

Contoh:

```text
client closes connection
server still running DB query
server tries to write response
write fails: broken pipe / connection reset
```

Dengan async/future/virtual threads, cancellation juga tidak otomatis jika tidak didesain.

```java
Future<Result> future = executor.submit(() -> slowCall());
// if request timeout happens, need cancel policy
future.cancel(true);
```

Tapi interruption hanya efektif jika library/blocking operation menghormatinya.

Checklist:

- set query timeout;
- set HTTP client timeout;
- close streams;
- stop expensive loops if interrupted;
- do not write huge response if client gone;
- log client abort differently from server error.

---

## 19. Observability: Metrics yang Harus Ada

Untuk memahami threading model production, minimal observability:

### 19.1 Container/thread metrics

- active request threads;
- max threads;
- queued tasks/requests;
- current connections;
- accept count/backlog indicators;
- request processing time;
- connection keep-alive count;
- rejected execution count;
- async request count;
- async timeout count.

### 19.2 Downstream metrics

- DB pool active/idle/pending;
- DB wait time for connection;
- query latency;
- outbound HTTP pool active/pending;
- external API timeout/error rate;
- Redis pool wait;
- message broker publish/consume latency.

### 19.3 JVM metrics

- live threads;
- virtual thread count if observable;
- heap usage;
- allocation rate;
- GC pause;
- CPU usage;
- blocked/waiting thread states;
- JFR events for virtual thread pinning when diagnosing.

### 19.4 Request metrics

- RPS;
- latency p50/p90/p95/p99;
- status code distribution;
- in-flight requests;
- timeout count;
- client abort count;
- per-endpoint latency and concurrency;
- per-tenant/user throttling.

---

## 20. Thread Dump Interpretation for Servlet Apps

Thread dump adalah alat kuat untuk melihat apakah server:

- CPU-bound;
- DB-bound;
- lock-bound;
- waiting on connection pool;
- waiting on remote HTTP;
- stuck writing response;
- deadlocked;
- starved.

### 20.1 Banyak thread waiting DB connection

Gejala:

```text
java.lang.Thread.State: TIMED_WAITING
at com.zaxxer.hikari.pool.HikariPool.getConnection(...)
```

Interpretasi:

```text
Servlet threads are not doing useful work.
They are waiting for DB connections.
Increasing servlet maxThreads will likely worsen queueing.
Check DB pool size, query latency, transaction duration, connection leak.
```

### 20.2 Banyak thread blocked on synchronized

Gejala:

```text
java.lang.Thread.State: BLOCKED (on object monitor)
at com.example.Cache.get(...)
```

Interpretasi:

```text
Shared lock contention.
Could serialize request processing.
Virtual threads may not help and can suffer pinning if blocking under monitor.
```

### 20.3 Banyak thread socket read external service

Gejala:

```text
java.net.SocketInputStream.socketRead0
```

Interpretasi:

```text
Remote dependency latency or timeout missing.
Check HTTP client timeouts, pool, circuit breaker, dependency status.
```

### 20.4 Banyak thread writing response

Gejala:

```text
socketWrite
OutputBuffer.flush
```

Interpretasi:

```text
Slow client/proxy/network, large response, compression cost, streaming issue.
Check response size, proxy buffering, client abort, bandwidth.
```

---

## 21. Threading and Session Concurrency

Multiple requests from same user/session can run concurrently:

```text
Tab 1: save form
Tab 2: refresh dashboard
AJAX 1: load notifications
AJAX 2: autosave draft
```

Do not assume session serializes access.

Risk:

```java
Cart cart = (Cart) session.getAttribute("cart");
cart.add(item); // mutable object accessed by concurrent requests
```

Safer approaches:

- keep session small and immutable where possible;
- synchronize carefully per session only for short critical section;
- use DB/source-of-truth with optimistic locking;
- use idempotency key for mutations;
- avoid storing complex mutable workflow state in session;
- design form submission against double-submit and tab duplication.

Bad:

```java
synchronized (session) {
    // long DB call inside session lock
    service.updateCase(...);
}
```

This serializes user requests and may create deadlocks/latency spikes.

Better:

```java
// validate request state
// call DB with optimistic version
// handle conflict explicitly
```

---

## 22. Threading and Transactions

A common hidden issue:

```java
@Transactional
public ResponseDto handle(RequestDto request) {
    Entity e = repository.load(request.id());
    ExternalResult x = externalClient.call(e.getRef());
    e.update(x);
    return mapper.toDto(e);
}
```

The transaction and DB connection may remain open while waiting for external HTTP call.

Failure:

```text
DB connections held longer
locks held longer
thread blocked longer
pool exhaustion
deadlocks/lock wait
```

Better pattern:

```text
transaction 1: load minimal state
external call outside transaction
transaction 2: update with optimistic check
```

Servlet threading impact:

```text
long transaction duration == long connection hold time == fewer requests can progress
```

This is why web runtime understanding cannot be separated from resource lifetime.

---

## 23. Threading and Response Streaming

Streaming response can hold execution resource longer than normal response.

Example:

```java
try (InputStream in = storage.open(fileId);
     OutputStream out = resp.getOutputStream()) {
    in.transferTo(out);
}
```

If file is large or client slow:

```text
request thread held for duration of transfer
storage connection held
socket output may block
```

Options:

- offload file download to object storage signed URL;
- use reverse proxy static file acceleration if applicable;
- use non-blocking I/O if complexity is justified;
- set download timeout;
- monitor client abort;
- avoid holding DB transaction during streaming.

---

## 24. Threading and WebSocket Preview

WebSocket will be covered deeply later, but threading implication starts here.

HTTP request is short-lived:

```text
request -> response -> thread released
```

WebSocket connection is long-lived:

```text
handshake -> open connection -> messages over time -> close
```

Do not allocate one platform thread per idle WebSocket connection. Modern WebSocket container implementations use event-driven/network infrastructure internally, but your endpoint message handling may still run on container/executor threads.

Risks:

- slow consumer;
- unbounded send queue;
- blocking work inside `@OnMessage`;
- shared session registry concurrency;
- per-connection memory overhead;
- reconnect storm.

Threading mental model still applies:

```text
message arrival rate × message processing time = active message concurrency
```

---

## 25. Classic Platform Thread Design Pattern

For many applications, classic servlet with bounded platform thread pool is still valid.

Good when:

- traffic moderate;
- blocking calls bounded by timeouts;
- downstream capacity is well controlled;
- codebase uses mature libraries;
- observability is strong;
- operational simplicity matters.

Pattern:

```text
bounded container threads
bounded DB pool
bounded HTTP client pool
short timeouts
clear overload response
thread-local cleanup
per-endpoint metrics
```

Anti-pattern:

```text
huge maxThreads
no downstream timeout
unbounded executor
large request body in memory
session mutable state
retry without jitter
```

---

## 26. Async Servlet Design Pattern

Use async servlet when request lifecycle must remain open while container worker should be released.

Good for:

- long polling;
- SSE;
- waiting for broker/event;
- delayed response;
- slow downstream where you have separate bounded executor;
- request orchestration where timeout/cancellation is explicit.

Pattern:

```text
startAsync
capture request context
submit bounded work / register event callback
set async timeout
on complete/error/timeout clean state
write response once
complete exactly once
```

Pseudo-code:

```java
AsyncContext async = req.startAsync();
async.setTimeout(10_000);

AtomicBoolean done = new AtomicBoolean(false);

async.addListener(new AsyncListener() {
    @Override
    public void onTimeout(AsyncEvent event) throws IOException {
        if (done.compareAndSet(false, true)) {
            HttpServletResponse response = (HttpServletResponse) event.getSuppliedResponse();
            response.setStatus(503);
            response.getWriter().write("timeout");
            event.getAsyncContext().complete();
        }
    }

    @Override public void onComplete(AsyncEvent event) {}
    @Override public void onError(AsyncEvent event) {}
    @Override public void onStartAsync(AsyncEvent event) {}
});

executor.submit(() -> {
    try {
        Result result = service.call();
        if (done.compareAndSet(false, true)) {
            HttpServletResponse response = (HttpServletResponse) async.getResponse();
            response.getWriter().write(toJson(result));
            async.complete();
        }
    } catch (Exception e) {
        if (done.compareAndSet(false, true)) {
            async.complete();
        }
    }
});
```

The key is not syntax. The key is state control.

---

## 27. Virtual Thread Design Pattern

Virtual threads are attractive when code is mostly blocking I/O and you want linear code without reactive complexity.

Good for:

- many concurrent I/O-bound requests;
- blocking JDBC/HTTP clients with proper timeouts;
- codebases that benefit from imperative style;
- reducing platform thread pool pressure;
- avoiding callback-heavy async logic.

Pattern:

```text
virtual thread per request/task
bounded downstream resources
bulkheads/semaphores
timeouts everywhere
avoid blocking inside synchronized
watch memory and ThreadLocal usage
observe pinning during load test
```

Bad pattern:

```text
enable virtual threads
remove all limits
let thousands of requests wait for 30 DB connections
ignore p99 latency
ignore memory/queue growth
```

Virtual threads should change how you think about thread scarcity, not how you think about capacity scarcity.

---

## 28. Scoped Values and Structured Concurrency: Why Mention in Servlet Series?

Java 25 context matters because server-side Java is moving toward better concurrency structure.

### 28.1 Scoped values

Scoped values are intended as a safer alternative to some `ThreadLocal` use cases: sharing immutable data within a bounded dynamic scope.

Servlet relevance:

```text
request id
tenant id
principal summary
locale
trace context
```

Instead of global mutable thread-local context, future code can increasingly use lexically scoped context propagation, especially with virtual threads and structured concurrency.

Conceptual shape:

```java
// Pseudocode-ish conceptual example
ScopedValue.where(REQUEST_ID, requestId).run(() -> {
    service.handle();
});
```

The idea:

```text
context exists only inside this execution scope
child tasks can inherit intentionally
cleanup is structural, not manual finally/remove
```

### 28.2 Structured concurrency

Structured concurrency treats related concurrent tasks as a unit.

Servlet relevance:

```java
// Conceptual: request needs case + profile + risk score
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var caseTask = scope.fork(() -> caseClient.load(id));
    var profileTask = scope.fork(() -> profileClient.load(id));
    var riskTask = scope.fork(() -> riskClient.score(id));

    scope.join();
    scope.throwIfFailed();

    return combine(caseTask.get(), profileTask.get(), riskTask.get());
}
```

Why useful:

- child tasks belong to request lifecycle;
- failure cancels siblings;
- timeout/cancellation can be applied coherently;
- easier to reason than unstructured `CompletableFuture` chains;
- works naturally with virtual threads.

Caveat:

- API maturity depends on JDK version;
- frameworks/container integration may vary;
- don't expose preview APIs casually in long-lived enterprise baseline without governance.

---

## 29. Choosing Between Classic Threads, Async Servlet, Non-Blocking I/O, Virtual Threads

Decision matrix:

| Situation | Good Fit |
|---|---|
| Simple CRUD, moderate traffic, blocking DB | Classic servlet platform threads, tuned pools |
| High I/O concurrency, mostly blocking libraries, Java 21+ | Virtual threads with bulkheads |
| Long polling / SSE / event wait | Async servlet |
| Massive streaming upload/download, slow clients, careful backpressure needed | Non-blocking I/O or offload |
| CPU-heavy report generation | Job queue / bounded CPU executor / async job model |
| WebSocket messaging | WebSocket endpoint with bounded message processing |
| Need reactive end-to-end and non-blocking drivers | Reactive stack, but only if whole chain supports it |

### 29.1 The wrong question

> “Should we use virtual threads or async?”

Better questions:

1. What is the dominant wait source?
2. Is code mostly blocking I/O or CPU-bound?
3. What downstream resources are limited?
4. Do we need request lifecycle to stay open without worker thread?
5. What is our timeout/cancellation model?
6. Can our libraries behave well under virtual threads?
7. Can our observability see what is happening?

---

## 30. Production Failure Scenarios

### 30.1 DB pool exhaustion

Symptoms:

```text
request latency rises
active servlet threads high
Hikari pending high
DB active maybe normal or high
504 from proxy
```

Root possibilities:

- slow query;
- missing index;
- transaction too long;
- connection leak;
- pool too small;
- app concurrency too high;
- DB overloaded.

Bad reaction:

```text
increase servlet maxThreads
```

Better reaction:

```text
measure pool wait
fix query/transaction
set query timeout
bound endpoint concurrency
fail fast when DB unavailable
```

### 30.2 External API slowness

Symptoms:

```text
threads stuck on socket read
outbound HTTP pool pending
p99 latency huge
retry rate increases
```

Mitigation:

- connect/read timeout;
- circuit breaker;
- bulkhead;
- fallback if valid;
- cache if safe;
- retry only with budget and jitter;
- never retry blindly from every servlet thread.

### 30.3 Lock contention in shared object

Symptoms:

```text
BLOCKED threads
low CPU maybe
latency high
throughput low
```

Mitigation:

- reduce critical section;
- use concurrent data structure;
- avoid blocking I/O inside lock;
- shard lock by key if needed;
- use immutable snapshots.

### 30.4 Unbounded executor inside servlet

Bad:

```java
ExecutorService executor = Executors.newCachedThreadPool();
```

Under load:

```text
threads grow
memory grows
CPU scheduling overhead grows
GC pressure rises
system collapse
```

Better:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    16,
    64,
    60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(500),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Even better: choose policy based on endpoint semantics.

### 30.5 Virtual thread overload without downstream limit

Symptoms:

```text
platform threads not maxed
virtual threads huge
DB pending huge
memory rises
latency extreme
```

Mitigation:

- bound expensive downstream calls;
- timeouts;
- admission control;
- per-endpoint concurrency;
- observe virtual thread count and heap.

---

## 31. Practical Capacity Design Template

For each important endpoint, document:

```text
Endpoint: GET /cases/{id}
Type: read
Dominant cost: DB + profile service HTTP
Expected RPS: 100 peak
Latency budget: p95 300ms, p99 1s
DB calls: 1 query, target <100ms
HTTP calls: 1 profile call, timeout 500ms
Threading model: classic servlet / virtual thread
Concurrency gate: profile service max 50 concurrent
Timeouts: app 900ms, profile 500ms, DB query 300ms
Fallback: partial profile? yes/no
Retry: no synchronous retry; async retry only for background enrichment
Observability: endpoint latency, DB wait, profile latency, timeout count
Overload behavior: 503 with Retry-After after bulkhead reject
```

This is the level of thinking expected from top-tier engineers.

---

## 32. Code Example: Bounded Downstream Call in Servlet

```java
public final class DownstreamBulkhead {
    private final Semaphore semaphore;
    private final Duration acquireTimeout;

    public DownstreamBulkhead(int maxConcurrent, Duration acquireTimeout) {
        this.semaphore = new Semaphore(maxConcurrent);
        this.acquireTimeout = acquireTimeout;
    }

    public <T> T execute(CheckedSupplier<T> supplier) throws Exception {
        boolean acquired = semaphore.tryAcquire(acquireTimeout.toMillis(), TimeUnit.MILLISECONDS);
        if (!acquired) {
            throw new DownstreamBusyException("Downstream concurrency limit reached");
        }
        try {
            return supplier.get();
        } finally {
            semaphore.release();
        }
    }

    @FunctionalInterface
    public interface CheckedSupplier<T> {
        T get() throws Exception;
    }
}
```

Usage:

```java
@Override
protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
    String id = req.getParameter("id");

    try {
        CaseDto dto = profileBulkhead.execute(() -> caseService.getCaseWithProfile(id));
        resp.setStatus(HttpServletResponse.SC_OK);
        resp.setContentType("application/json");
        resp.getWriter().write(objectMapper.writeValueAsString(dto));
    } catch (DownstreamBusyException e) {
        resp.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
        resp.setHeader("Retry-After", "3");
        resp.setContentType("application/json");
        resp.getWriter().write("{\"error\":\"service_busy\"}");
    } catch (Exception e) {
        resp.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
        resp.setContentType("application/json");
        resp.getWriter().write("{\"error\":\"internal_error\"}");
    }
}
```

This pattern remains useful with platform threads, async servlet, and virtual threads.

---

## 33. Code Example: Context Cleanup Filter

```java
public final class RequestContextFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest httpRequest = (HttpServletRequest) request;
        String requestId = resolveRequestId(httpRequest);
        String tenantId = resolveTenantId(httpRequest);

        try {
            MDC.put("requestId", requestId);
            MDC.put("tenantId", tenantId);
            RequestContextHolder.set(new RequestContext(requestId, tenantId));
            chain.doFilter(request, response);
        } finally {
            RequestContextHolder.clear();
            MDC.remove("tenantId");
            MDC.remove("requestId");
        }
    }

    private String resolveRequestId(HttpServletRequest request) {
        String header = request.getHeader("X-Request-Id");
        return header == null || header.isBlank() ? UUID.randomUUID().toString() : header;
    }

    private String resolveTenantId(HttpServletRequest request) {
        String header = request.getHeader("X-Tenant-Id");
        return header == null || header.isBlank() ? "default" : header;
    }
}
```

Important:

```text
set context before chain
clear context after chain
handle error path too
handle async separately if context is needed in async task
```

---

## 34. Design Heuristics

### 34.1 Do not tune blind

Never tune only by changing `maxThreads`. First inspect:

- p95/p99 latency;
- active threads;
- queue size;
- DB pool wait;
- CPU saturation;
- GC;
- outbound dependencies;
- timeout distribution.

### 34.2 Bound every expensive resource

Every expensive resource needs a bound:

```text
threads
DB connections
HTTP connections
file uploads
download concurrency
report jobs
WebSocket sends
per-user mutations
external API calls
```

### 34.3 Prefer fast failure over slow collapse

During overload, a fast `503` can be healthier than letting every request wait until proxy timeout.

### 34.4 Timeouts must form a hierarchy

```text
downstream timeout < app timeout < proxy timeout < client timeout
```

Not always exact, but the intent should be deliberate.

### 34.5 Virtual threads change execution economics, not system physics

They reduce the cost of waiting threads. They do not remove:

- database limits;
- CPU limits;
- memory limits;
- rate limits;
- lock contention;
- slow clients;
- bad retry behavior;
- need for observability.

---

## 35. Mental Model Summary

Think of Servlet runtime as a constrained execution pipeline:

```text
Arrival rate
  × service time
  = active concurrency
```

Active concurrency consumes:

```text
thread/execution capacity
connection capacity
memory
CPU
downstream quota
queue space
operator patience
```

Classic servlet model:

```text
request holds platform worker until done
```

Async servlet model:

```text
request lifecycle continues while container worker may be released
```

Non-blocking I/O model:

```text
read/write happens only when stream is ready
```

Virtual thread model:

```text
request can use cheap thread-like execution, but still consumes downstream resources
```

Top-tier engineering view:

> **Do not ask only “is this endpoint async?” Ask: what resources does this request hold, for how long, under what concurrency, with what timeout, with what cancellation, with what overload policy, and with what observability?**

---

## 36. Checklist

Before approving a Servlet/Web runtime design, check:

- [ ] Are servlet/filter/listener fields thread-safe?
- [ ] Are per-request variables local or properly scoped?
- [ ] Are `ThreadLocal`/MDC values cleaned in `finally`?
- [ ] Does async execution propagate context intentionally?
- [ ] Are all executors bounded or intentionally virtual-thread based?
- [ ] Are downstream resources protected by pool/bulkhead/rate limit?
- [ ] Are DB/HTTP/cache timeouts configured?
- [ ] Are timeouts aligned across client/proxy/app/downstream?
- [ ] Is queue length bounded and observable?
- [ ] Is overload behavior defined?
- [ ] Is cancellation handled for timeout/client abort?
- [ ] Are p95/p99 metrics available per endpoint?
- [ ] Are thread dumps understood for major failure modes?
- [ ] If using virtual threads, has pinning been tested under load?
- [ ] If using virtual threads, are downstream concurrency limits still explicit?
- [ ] Are CPU-heavy tasks bounded/offloaded?
- [ ] Are large streaming responses considered separately?
- [ ] Are session mutations safe under parallel requests?

---

## 37. What You Should Be Able to Explain After This Part

You should now be able to explain:

1. Why Servlet classic model is often thread-per-request.
2. Why platform thread pools are bounded.
3. Why request concurrency is not the same as user count.
4. Why increasing `maxThreads` can worsen outages.
5. How DB/HTTP connection pools interact with servlet threads.
6. Why tail latency can exhaust worker capacity.
7. How `ThreadLocal` leaks happen in pooled threads.
8. Why async servlet releases container workers but does not remove blocking unless work is redesigned.
9. Why virtual threads help I/O-bound blocking code but do not remove downstream bottlenecks.
10. What pinned virtual threads are and why broad `synchronized` boundaries around blocking calls are dangerous.
11. How to reason about queue, timeout, cancellation, and overload.
12. What metrics and thread dump patterns reveal about web runtime health.

---

## 38. References

- Jakarta Servlet 6.1 Specification — https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta Servlet 6.1 API Documentation — https://jakarta.ee/specifications/servlet/6.1/apidocs/
- Apache Tomcat 11 Executor Configuration — https://tomcat.apache.org/tomcat-11.0-doc/config/executor.html
- Eclipse Jetty 12 Threading Architecture — https://jetty.org/docs/jetty/12.1/programming-guide/arch/threads.html
- OpenJDK JEP 444: Virtual Threads — https://openjdk.org/jeps/444
- OpenJDK JEP 505: Structured Concurrency — https://openjdk.org/jeps/505
- OpenJDK JEP 506: Scoped Values — https://openjdk.org/jeps/506
- Java SE API: Executors — https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html
- Java SE API: Thread — https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

---

## 39. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

- Part 000 — Orientation: Mental Model Server-Side Java Web Runtime
- Part 001 — Evolution: Java EE `javax.*` ke Jakarta EE `jakarta.*`
- Part 002 — HTTP Fundamentals for Servlet Engineers
- Part 003 — Servlet Container Architecture
- Part 004 — Servlet Lifecycle Deep Dive
- Part 005 — Request Object Internals: `HttpServletRequest`
- Part 006 — Response Object Internals: `HttpServletResponse`
- Part 007 — Servlet Mapping, URL Pattern, and Dispatch Resolution
- Part 008 — Request Dispatching: Forward, Include, Async, Error
- Part 009 — Filters: Cross-Cutting Boundary Before Frameworks
- Part 010 — Listeners: Observing Web Application Lifecycle
- Part 011 — ServletContext and Application Scope
- Part 012 — Session Management: `HttpSession` Deep Dive
- Part 013 — Cookies, Headers, SameSite, and Browser Boundary
- Part 014 — Async Servlet: Non-Blocking Request Lifecycle
- Part 015 — Servlet Non-Blocking I/O
- Part 016 — Multipart Upload, File Download, and Large Payload Handling
- Part 017 — Error Handling and Failure Semantics in Servlet Apps
- Part 018 — Threading Model: Classic Servlet, Platform Threads, Virtual Threads

Part berikutnya:

- Part 019 — Web Application Classloading, Deployment, and Redeployment

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-servlet-websocket-web-container-runtime-part-017.md">⬅️ Part 017 — Error Handling and Failure Semantics in Servlet Apps</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-servlet-websocket-web-container-runtime-part-019.md">Part 019 — Web Application Classloading, Deployment, and Redeployment ➡️</a>
</div>

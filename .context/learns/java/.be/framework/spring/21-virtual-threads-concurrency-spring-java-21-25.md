# Part 21 — Virtual Threads, Concurrency, and Spring on Java 21–25

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `21-virtual-threads-concurrency-spring-java-21-25.md`  
> Status seri: Part 21 dari 35 — belum selesai  
> Prasyarat langsung: Part 9 AOP/proxy, Part 10 transaction, Part 14 WebFlux, Part 15 HTTP clients, Part 20 async/scheduling/events

---

## 0. Tujuan Part Ini

Virtual threads sering dipasarkan seolah-olah mereka membuat concurrency Spring menjadi sederhana sepenuhnya:

```text
aktifkan spring.threads.virtual.enabled=true
semua masalah scalability selesai
```

Itu salah.

Virtual threads memang mengubah salah satu biaya paling mahal dalam aplikasi server tradisional: biaya mempertahankan banyak platform thread ketika request sedang menunggu I/O. Tetapi virtual threads **tidak** menghapus constraint sistem lain:

- database connection pool tetap terbatas;
- outbound HTTP pool tetap terbatas;
- rate limit external system tetap berlaku;
- CPU tetap terbatas;
- lock tetap bisa menjadi bottleneck;
- transaction context tetap harus dijaga;
- ThreadLocal tetap perlu dipahami;
- backpressure tetap dibutuhkan;
- cache stampede tetap mungkin terjadi;
- scheduler/job tetap perlu idempotency;
- blocking call pada tempat yang salah tetap merusak sistem;
- reactive stack masih punya tempat untuk streaming/backpressure/event-loop use case tertentu.

Part ini bertujuan membuat Anda mampu menjawab pertanyaan berikut secara engineering, bukan hype:

1. Apa yang sebenarnya berubah dengan virtual threads?
2. Bagaimana Spring Boot mengintegrasikan virtual threads?
3. Kapan MVC + virtual threads lebih tepat daripada WebFlux?
4. Kapan WebFlux tetap lebih tepat?
5. Bagaimana virtual threads berinteraksi dengan transaction, security, logging, MDC, scheduler, `@Async`, JDBC, HTTP client, cache, dan observability?
6. Bagaimana melakukan migration dari platform-thread Spring app ke virtual-thread Spring app secara aman?
7. Bagaimana mendesain concurrency limit yang benar walaupun thread sekarang murah?

---

## 1. Mental Model: Thread Itu Bukan Kapasitas Bisnis

Sebelum virtual threads, banyak Spring MVC application memakai model sederhana:

```text
1 incoming request ≈ 1 servlet container platform thread
```

Jika request melakukan operasi seperti:

```text
controller
  -> service
     -> DB query 80 ms
     -> external API 300 ms
     -> DB update 40 ms
```

maka platform thread yang menangani request tersebut sering berada dalam keadaan menunggu I/O selama sebagian besar waktu.

Platform thread mahal karena diwakili oleh OS thread. Terlalu banyak platform thread menyebabkan:

- memory stack besar;
- context switching mahal;
- scheduler OS makin sibuk;
- thread pool harus dibatasi;
- request antre ketika pool habis;
- async/reactive model menjadi menarik karena bisa mengurangi blocking thread.

Virtual thread mengubah hal ini. Ia membuat thread menjadi jauh lebih murah sehingga gaya kode blocking-imperative kembali layak untuk banyak workload I/O-bound.

Tetapi kapasitas sistem tidak pernah hanya ditentukan oleh jumlah thread.

Contoh:

```text
Jika database pool = 30 connection
maka aplikasi tidak bisa menjalankan 10.000 query database secara bersamaan
meskipun aplikasi bisa membuat 10.000 virtual thread.
```

Virtual thread menghilangkan bottleneck thread, bukan bottleneck downstream.

Mental model yang benar:

```text
Virtual thread increases concurrency expression capacity.
It does not increase downstream service capacity.
```

Atau dalam bahasa sederhana:

```text
Virtual thread membuat lebih murah untuk menunggu.
Virtual thread tidak membuat resource yang ditunggu menjadi tidak terbatas.
```

---

## 2. Platform Thread vs Virtual Thread

### 2.1 Platform Thread

Platform thread adalah Java thread tradisional yang biasanya dipetakan ke OS thread.

Karakteristik:

- relatif mahal dibuat;
- biasanya dipool;
- jumlahnya dibatasi;
- cocok untuk CPU-bound work;
- blocking I/O menahan OS thread;
- terlalu banyak thread menyebabkan memory dan scheduling overhead.

Contoh executor tradisional:

```java
ExecutorService executor = Executors.newFixedThreadPool(100);
```

Model ini berkata:

```text
hanya 100 task bisa berjalan/menunggu secara aktif pada saat bersamaan
sisanya antre
```

### 2.2 Virtual Thread

Virtual thread adalah `java.lang.Thread` juga, tetapi tidak selalu memegang OS thread sepanjang hidupnya.

Karakteristik:

- sangat murah dibuat;
- biasanya dibuat per task/request;
- tidak perlu dipool seperti platform thread;
- ketika blocking I/O yang compatible terjadi, virtual thread bisa unmount dari carrier thread;
- carrier thread bisa menjalankan virtual thread lain;
- lebih cocok untuk I/O-bound concurrency;
- tidak membuat CPU-bound code menjadi lebih cepat.

Contoh:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 10_000; i++) {
        executor.submit(() -> callBlockingRemoteService());
    }
}
```

Model ini berkata:

```text
buat satu virtual thread per task
biarkan JVM menjadwalkannya di atas carrier threads
```

### 2.3 Carrier Thread

Virtual thread dijalankan di atas carrier thread, biasanya platform thread yang dikelola JVM.

Visual:

```text
Virtual Thread A ┐
Virtual Thread B ├── scheduled over ──> Carrier Thread Pool ──> OS threads/CPU
Virtual Thread C ┘
```

Ketika virtual thread melakukan blocking operation yang bisa di-unmount:

```text
Virtual Thread A waits for DB/network
Carrier Thread released
Carrier Thread runs Virtual Thread B
```

Inilah alasan virtual thread efektif untuk banyak request yang mostly waiting.

---

## 3. Apa yang Virtual Thread Selesaikan

Virtual thread sangat berguna ketika sistem memiliki karakteristik berikut:

```text
many concurrent tasks
mostly blocking I/O
simple request-per-task programming model
need readable imperative code
```

Contoh workload cocok:

- REST API yang banyak melakukan JDBC call;
- service aggregator yang memanggil beberapa HTTP API;
- workflow service dengan banyak wait ke database/external service;
- blocking SDK integration;
- synchronous Spring MVC application dengan high concurrent I/O wait;
- batch/job yang menjalankan banyak task I/O-bound;
- command handler yang mostly menunggu DB/queue/object storage.

Keuntungan utama:

1. Kode tetap imperative dan mudah dibaca.
2. Tidak perlu membungkus semua hal dalam callback/reactive chain.
3. Stack trace tetap natural.
4. Lebih mudah debugging dibanding callback-heavy async style.
5. Lebih mudah migration dari Spring MVC tradisional.
6. Thread-per-request model menjadi scalable untuk I/O-bound workload.

---

## 4. Apa yang Virtual Thread Tidak Selesaikan

Virtual thread tidak menyelesaikan:

### 4.1 CPU Bottleneck

Jika task Anda CPU-bound:

```java
calculateLargeReport();
compressHugePayload();
parseHugeJson();
runComplexCrypto();
```

maka menambah virtual thread tidak membuat CPU bertambah.

CPU-bound concurrency tetap perlu dibatasi kira-kira sesuai core CPU.

```text
Virtual threads are cheap, CPU cycles are not.
```

### 4.2 Database Pool Bottleneck

Jika HikariCP maksimum 30 connection, hanya 30 operasi database yang bisa memegang connection pada saat bersamaan.

```text
10.000 virtual threads waiting for 30 DB connections
= thread problem solved
= DB pool contention still real
```

Tanpa concurrency limit, aplikasi bisa membuat antrean besar di pool database, menyebabkan:

- latency naik;
- timeout meningkat;
- memory pressure;
- cascading failure;
- database overload;
- request timeout padahal thread masih banyak.

### 4.3 External API Rate Limit

Jika partner API hanya mengizinkan 300 request/minute, virtual thread tidak mengubah batas tersebut.

Anda tetap butuh:

- rate limiter;
- bulkhead;
- queueing policy;
- retry budget;
- timeout;
- backoff;
- idempotency.

### 4.4 Lock Contention

Jika banyak virtual thread berebut lock yang sama:

```java
synchronized (globalLock) {
    updateSharedState();
}
```

maka throughput tetap bisa buruk.

Masalahnya bukan thread, tetapi serialization point.

### 4.5 Transaction Semantics

Virtual thread tidak mengubah aturan transaction Spring:

- transaction tetap biasanya bound ke thread;
- proxy tetap harus dilalui;
- self-invocation tetap bypass;
- async boundary tetap memutus transaction context;
- external call di dalam transaction tetap berisiko.

### 4.6 Backpressure

Virtual thread bisa membuat banyak task murah, tetapi sistem tetap membutuhkan mekanisme menolak/membatasi beban.

Tanpa backpressure:

```text
lebih mudah menerima terlalu banyak pekerjaan
lebih mudah membanjiri database/external API
lebih mudah memperbesar tail latency
```

---

## 5. Spring Boot Virtual Threads: Konfigurasi Dasar

Pada Spring Boot modern, virtual threads bisa diaktifkan dengan property:

```properties
spring.threads.virtual.enabled=true
```

Efek umum pada aplikasi Spring Boot berbasis Java 21+:

- auto-configured `AsyncTaskExecutor` dapat memakai virtual threads;
- task execution dan scheduling builder disesuaikan;
- servlet web request dapat dijalankan dengan virtual-thread executor tergantung container dan konfigurasi Boot;
- `@Async` dapat memakai executor virtual thread bila tidak dioverride;
- scheduler dapat memakai virtual-thread-enabled implementation sesuai konfigurasi dan versi.

Namun jangan memahami property ini sebagai “semua concurrency sekarang aman”. Ia hanya mengubah execution substrate.

Checklist setelah mengaktifkan:

```text
[ ] cek DB pool
[ ] cek HTTP client pool
[ ] cek timeout semua outbound call
[ ] cek scheduler concurrency
[ ] cek @Async executor
[ ] cek MDC/correlation propagation
[ ] cek SecurityContext propagation
[ ] cek transaction assumptions
[ ] cek blocking call di WebFlux/event loop
[ ] cek pinning/lock hotspot
[ ] cek metrics thread/executor/pool
[ ] cek graceful shutdown
```

---

## 6. Spring MVC + Virtual Threads

Spring MVC tradisional memakai model request/response blocking-imperative.

Contoh:

```java
@RestController
@RequestMapping("/applications")
class ApplicationController {

    private final ApplicationService service;

    ApplicationController(ApplicationService service) {
        this.service = service;
    }

    @GetMapping("/{id}")
    ApplicationResponse get(@PathVariable Long id) {
        return service.getApplication(id);
    }
}
```

Service:

```java
@Service
class ApplicationService {

    private final ApplicationRepository repository;
    private final ApplicantClient applicantClient;

    ApplicationService(ApplicationRepository repository, ApplicantClient applicantClient) {
        this.repository = repository;
        this.applicantClient = applicantClient;
    }

    @Transactional(readOnly = true)
    ApplicationResponse getApplication(Long id) {
        Application app = repository.findRequiredById(id);
        ApplicantProfile profile = applicantClient.getProfile(app.applicantId());
        return ApplicationResponse.from(app, profile);
    }
}
```

Dengan platform thread, request thread akan menunggu DB dan external HTTP call.

Dengan virtual thread, request tetap terlihat blocking secara kode, tetapi waiting cost jauh lebih murah.

Ini sangat cocok untuk banyak Spring enterprise application karena:

- programming model tetap sederhana;
- repository/JDBC/JPA tetap bisa dipakai;
- transaction model tetap familiar;
- debugging lebih mudah;
- migration tidak memaksa reactive rewrite.

Tetapi tetap ada risiko besar:

```text
Jika setiap request memanggil external API lambat dan tidak ada timeout,
virtual thread hanya membuat aplikasi mampu menunggu lebih banyak request yang macet.
```

Virtual thread harus ditemani timeout dan bulkhead.

---

## 7. WebFlux vs MVC + Virtual Threads

Setelah virtual threads, pertanyaan umum:

```text
Apakah WebFlux masih perlu?
```

Jawaban engineering:

```text
Masih, tetapi alasan memilih WebFlux harus lebih spesifik.
```

### 7.1 MVC + Virtual Threads Cocok Jika

Gunakan MVC + virtual threads jika:

- mayoritas stack blocking;
- memakai JDBC/JPA/Hibernate;
- tim lebih kuat di imperative code;
- request-response API biasa;
- streaming/backpressure bukan kebutuhan utama;
- integrasi banyak dengan blocking SDK;
- ingin migration path dari Spring MVC lama;
- debugging dan maintainability lebih penting dari reactive purity.

### 7.2 WebFlux Cocok Jika

Gunakan WebFlux jika:

- end-to-end stack reactive;
- memakai non-blocking driver seperti R2DBC atau reactive Redis/Mongo;
- butuh streaming besar;
- Server-Sent Events atau event stream intensif;
- high fan-out non-blocking HTTP;
- backpressure menjadi requirement nyata;
- workload sangat connection-heavy dengan low memory footprint;
- tim paham Reactor secara operasional.

### 7.3 Jangan Campur Sembarangan

Anti-pattern:

```java
Mono.just(repository.findById(id)) // blocking call dieksekusi sebelum Mono dibuat
```

Atau:

```java
return webClient.get()
    .retrieve()
    .bodyToMono(Response.class)
    .block(); // buruk jika dilakukan di event loop WebFlux
```

Jika Anda memakai WebFlux tetapi memanggil blocking JDBC tanpa isolasi scheduler, Anda menghancurkan model event loop.

Jika Anda memakai MVC + virtual threads, Anda tidak perlu membungkus semua hal dalam `Mono` hanya agar terlihat modern.

---

## 8. Virtual Threads and JDBC/JPA

Spring enterprise app banyak memakai JDBC/JPA. Ini area virtual threads paling menarik.

### 8.1 Kenapa Cocok

JDBC adalah blocking API. Pada platform thread, setiap query menahan platform thread.

Dengan virtual threads:

```text
blocking JDBC wait can become cheaper from thread perspective
```

Kode tetap:

```java
@Transactional(readOnly = true)
public CaseView getCase(String caseNo) {
    CaseEntity c = caseRepository.findByCaseNo(caseNo)
        .orElseThrow(CaseNotFoundException::new);
    return mapper.toView(c);
}
```

### 8.2 Connection Pool Tetap Batas Utama

HikariCP size tetap harus dihitung.

Misal:

```text
request concurrency         = 2.000
virtual threads available  = effectively many
DB pool max                = 40
average DB time            = 80 ms
```

Maka hanya 40 request bisa memegang DB connection bersamaan.

Yang lain menunggu connection.

Ini bukan selalu buruk. Pool adalah bulkhead. Tetapi Anda harus sadar bahwa antrean sekarang berpindah dari thread pool ke resource pool.

### 8.3 Jangan Membesarkan DB Pool Secara Buta

Kesalahan umum setelah virtual threads:

```text
thread murah -> naikkan DB pool besar-besaran
```

Itu bisa membunuh database.

DB pool harus dikalibrasi berdasarkan:

- CPU database;
- query latency;
- lock contention;
- transaction duration;
- max sessions database;
- workload read/write;
- index quality;
- connection acquisition timeout;
- SLA latency.

Rule penting:

```text
virtual thread count is not database capacity
```

### 8.4 Transaction Duration Jadi Lebih Penting

Jika virtual threads membuat aplikasi menerima lebih banyak concurrent requests, transaction yang terlalu lama menjadi lebih berbahaya.

Buruk:

```java
@Transactional
public void approve(Long id) {
    Case c = repository.findByIdForUpdate(id);
    externalClient.notifyApproval(c); // network call inside transaction
    c.approve();
}
```

Lebih baik:

```java
@Transactional
public ApprovalResult approve(Long id) {
    Case c = repository.findByIdForUpdate(id);
    c.approve();
    outboxRepository.save(OutboxEvent.approvalCreated(c.id()));
    return ApprovalResult.accepted(c.id());
}
```

Lalu publish setelah commit via outbox worker.

Virtual threads tidak mengubah prinsip ini.

---

## 9. Virtual Threads and Transaction Context

Spring transaction context biasanya disimpan melalui `TransactionSynchronizationManager`, yang memakai thread-bound state.

Artinya:

```text
transaction context belongs to the executing thread
```

Pada virtual thread, ini tetap masuk akal karena virtual thread tetap `Thread` dari perspektif Java code.

Contoh aman:

```java
@Transactional
public void updateCase(Long id) {
    repository.updateStatus(id, Status.APPROVED);
    auditRepository.save(...);
}
```

Semua berjalan di virtual thread yang sama.

Yang tetap tidak aman:

```java
@Transactional
public void updateCase(Long id) {
    repository.updateStatus(id, Status.APPROVED);

    CompletableFuture.runAsync(() -> {
        auditRepository.save(...); // transaction context tidak otomatis ikut
    });
}
```

Atau:

```java
@Transactional
public void updateCase(Long id) {
    asyncAuditService.record(...); // @Async -> thread lain / virtual thread lain
}
```

`@Async` tetap boundary baru. Transaction context tidak otomatis pindah.

Mental model:

```text
virtual thread preserves thread-local style within one execution flow
but does not magically propagate context across async boundaries
```

---

## 10. Virtual Threads and ThreadLocal

Banyak komponen Spring memakai ThreadLocal-like context:

- transaction synchronization;
- request context;
- security context;
- MDC/logging context;
- locale context;
- tenant context buatan sendiri;
- observation/tracing context.

Virtual threads mendukung ThreadLocal. Tetapi ada beberapa implikasi.

### 10.1 Jangan Simpan Data Besar di ThreadLocal

Karena virtual thread bisa sangat banyak, ThreadLocal besar menjadi mahal.

Buruk:

```java
TenantContext.set(new HugeTenantObject(...));
```

Lebih baik:

```java
TenantContext.setTenantId(tenantId);
```

Simpan identifier kecil, bukan object besar.

### 10.2 Selalu Clear Context

Jika Anda membuat custom context:

```java
public final class TenantContext {
    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    public static void set(String tenantId) {
        CURRENT.set(tenantId);
    }

    public static String get() {
        return CURRENT.get();
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Filter harus clear:

```java
@Component
class TenantFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {

        try {
            TenantContext.set(resolveTenant(request));
            chain.doFilter(request, response);
        } finally {
            TenantContext.clear();
        }
    }
}
```

Virtual thread sering per request, sehingga leak antar request lebih kecil dibanding reused platform thread pool. Tetapi cleanup tetap wajib karena:

- task bisa panjang;
- library bisa reuse abstraction;
- testing bisa berjalan dalam thread berbeda;
- context object bisa menahan memory.

### 10.3 Async Boundary Tetap Butuh Propagation

Jika Anda pindah ke executor lain:

```java
executor.submit(() -> doWork());
```

ThreadLocal tidak otomatis ikut.

Spring menyediakan beberapa mekanisme seperti task decorator untuk propagasi MDC/security/tenant context secara eksplisit.

Contoh konseptual:

```java
@Bean
TaskDecorator contextCopyingTaskDecorator() {
    return runnable -> {
        String tenantId = TenantContext.get();
        Map<String, String> mdc = MDC.getCopyOfContextMap();

        return () -> {
            try {
                TenantContext.set(tenantId);
                if (mdc != null) MDC.setContextMap(mdc);
                runnable.run();
            } finally {
                TenantContext.clear();
                MDC.clear();
            }
        };
    };
}
```

---

## 11. Virtual Threads and SecurityContext

Spring Security memakai `SecurityContextHolder`. Secara default, context biasanya thread-bound.

Dalam request biasa:

```text
Security filter
  -> set SecurityContext
  -> controller/service
  -> clear SecurityContext
```

Dengan MVC + virtual thread, model ini tetap natural selama request diproses dalam virtual thread yang sama.

Masalah muncul saat async boundary:

```java
@Async
public void sendNotification() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
}
```

Context mungkin tidak tersedia atau tidak sesuai.

Solusi harus eksplisit:

- jangan bergantung pada security context di background job;
- pass principal/user id sebagai value eksplisit;
- gunakan delegating security context executor jika memang perlu;
- audit identity sebaiknya ditentukan di command/event payload;
- jangan membawa seluruh Authentication object ke job jangka panjang.

Pattern lebih baik:

```java
public record ApproveCaseCommand(
    Long caseId,
    String actorUserId,
    Set<String> actorRoles,
    Instant requestedAt
) {}
```

Bukan:

```java
public record ApproveCaseCommand(
    Long caseId,
    Authentication authentication
) {}
```

Authentication adalah runtime security object, bukan durable business command.

---

## 12. Virtual Threads and MDC / Logging Context

MDC sering dipakai untuk:

- correlation ID;
- trace ID;
- tenant ID;
- user ID;
- request ID.

Dalam request thread yang sama, MDC bekerja normal.

Namun async boundary tetap butuh propagation.

### 12.1 Filter Pattern

```java
@Component
class CorrelationIdFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {

        String correlationId = Optional.ofNullable(request.getHeader("X-Correlation-Id"))
            .orElse(UUID.randomUUID().toString());

        try {
            MDC.put("correlationId", correlationId);
            response.setHeader("X-Correlation-Id", correlationId);
            chain.doFilter(request, response);
        } finally {
            MDC.remove("correlationId");
        }
    }
}
```

### 12.2 Async Propagation

Jika Anda memakai `@Async`, gunakan TaskDecorator atau explicit payload.

```java
@Configuration
@EnableAsync
class AsyncConfig {

    @Bean
    AsyncTaskExecutor applicationTaskExecutor(TaskDecorator taskDecorator) {
        SimpleAsyncTaskExecutor executor = new SimpleAsyncTaskExecutor("app-vt-");
        executor.setVirtualThreads(true);
        executor.setTaskDecorator(taskDecorator);
        executor.setConcurrencyLimit(500);
        return executor;
    }
}
```

Catatan: angka `500` bukan rekomendasi universal. Itu harus dikalibrasi berdasarkan downstream capacity.

---

## 13. Virtual Threads and `@Async`

`@Async` menjalankan method pada executor berbeda melalui proxy.

Masalah lama tetap berlaku:

- self-invocation tidak jalan;
- method harus dipanggil melalui proxy;
- exception handling berbeda;
- transaction context tidak otomatis ikut;
- return type perlu dipilih dengan benar;
- executor harus dipilih/diatur.

### 13.1 Contoh Salah: Self Invocation

```java
@Service
class ReportService {

    public void generateAll() {
        generateOneAsync(); // self-invocation: @Async tidak aktif
    }

    @Async
    public void generateOneAsync() {
        // runs synchronously if called internally
    }
}
```

Solusi:

```java
@Service
class ReportOrchestrator {
    private final ReportWorker worker;

    ReportOrchestrator(ReportWorker worker) {
        this.worker = worker;
    }

    public void generateAll() {
        worker.generateOneAsync();
    }
}

@Service
class ReportWorker {
    @Async
    public void generateOneAsync() {
        // runs through proxy
    }
}
```

### 13.2 Virtual Thread Executor for `@Async`

```java
@Configuration
@EnableAsync
class AsyncConfiguration {

    @Bean(name = "ioBoundExecutor")
    AsyncTaskExecutor ioBoundExecutor() {
        SimpleAsyncTaskExecutor executor = new SimpleAsyncTaskExecutor("io-vt-");
        executor.setVirtualThreads(true);
        executor.setConcurrencyLimit(1000);
        return executor;
    }
}
```

Usage:

```java
@Async("ioBoundExecutor")
public CompletableFuture<ExternalResult> fetchExternalData(String id) {
    return CompletableFuture.completedFuture(client.fetch(id));
}
```

### 13.3 Do Not Use Virtual Threads as Unlimited Fire-and-Forget

Buruk:

```java
for (Item item : items) {
    asyncService.process(item); // no limit, no result handling, no failure handling
}
```

Lebih baik:

- batasi concurrency;
- simpan job state;
- tangani exception;
- pakai outbox/command table untuk pekerjaan durable;
- gunakan structured concurrency jika applicable di luar Spring proxy model;
- ukur downstream capacity.

---

## 14. SimpleAsyncTaskExecutor vs ThreadPoolTaskExecutor

### 14.1 ThreadPoolTaskExecutor

`ThreadPoolTaskExecutor` cocok untuk platform thread pool:

```java
@Bean
ThreadPoolTaskExecutor platformExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(20);
    executor.setMaxPoolSize(80);
    executor.setQueueCapacity(1000);
    executor.setThreadNamePrefix("platform-");
    return executor;
}
```

Ada pooling karena platform thread mahal.

### 14.2 SimpleAsyncTaskExecutor with Virtual Threads

Virtual threads tidak perlu dipool dalam arti tradisional.

```java
@Bean
SimpleAsyncTaskExecutor virtualExecutor() {
    SimpleAsyncTaskExecutor executor = new SimpleAsyncTaskExecutor("vt-");
    executor.setVirtualThreads(true);
    executor.setConcurrencyLimit(1000);
    return executor;
}
```

`SimpleAsyncTaskExecutor` membuat thread baru per task. Dengan virtual threads, ini model yang masuk akal.

Tetapi `concurrencyLimit` tetap penting sebagai bulkhead.

Mental model:

```text
pool size controls expensive platform threads
concurrency limit controls downstream pressure
```

### 14.3 Queueing Policy

Pada platform thread pool, queue capacity sering dipakai.

Pada virtual thread executor, Anda perlu berpikir ulang:

```text
Apakah task boleh antre?
Berapa lama?
Apakah caller harus ditolak cepat?
Apakah downstream sedang overload?
```

Kadang lebih baik menolak cepat daripada membuat backlog besar.

---

## 15. Virtual Threads and `@Scheduled`

Scheduled jobs sering terlihat sederhana:

```java
@Scheduled(fixedDelayString = "${jobs.sync.delay}")
public void sync() {
    syncService.run();
}
```

Dengan virtual threads, job execution bisa lebih murah jika banyak I/O. Namun masalah schedule tetap sama:

- job bisa overlap;
- multi-replica app bisa menjalankan job yang sama;
- downstream bisa overload;
- retry bisa menggandakan efek;
- crash di tengah proses harus recoverable;
- lock/idempotency tetap wajib.

### 15.1 Fixed Rate vs Fixed Delay

`fixedRate`:

```text
mulai berdasarkan interval tetap
bisa overlap jika execution lebih lama dari interval tergantung scheduler/executor
```

`fixedDelay`:

```text
tunggu selesai, lalu delay, lalu jalan lagi
```

Virtual thread tidak mengubah semantik bisnis ini.

### 15.2 Multi-Replica Lock

Jika aplikasi berjalan 4 pod:

```text
pod A runs job
pod B runs job
pod C runs job
pod D runs job
```

Virtual threads tidak mencegah duplicate job.

Solusi:

- database lock;
- advisory lock;
- distributed lock;
- leader election;
- queue-based worker;
- external scheduler.

### 15.3 Scheduled Job Should Have Capacity Policy

Buruk:

```java
@Scheduled(cron = "0 * * * * *")
void syncAll() {
    repository.findAllPending().forEach(client::send);
}
```

Lebih baik:

```java
@Scheduled(cron = "0 * * * * *")
void syncBatch() {
    List<Item> items = repository.claimNextBatch(100);
    for (Item item : items) {
        syncOneWithTimeoutAndRetryBudget(item);
    }
}
```

Virtual thread dapat membantu menjalankan beberapa item paralel, tetapi batch size dan rate limit tetap harus eksplisit.

---

## 16. Virtual Threads and HTTP Clients

Outbound HTTP sering menjadi bottleneck nyata.

### 16.1 Blocking HTTP Client + Virtual Threads

Dengan `RestClient` atau blocking HTTP client:

```java
@Component
class PartnerClient {

    private final RestClient restClient;

    PartnerClient(RestClient.Builder builder) {
        this.restClient = builder
            .baseUrl("https://partner.example")
            .build();
    }

    PartnerResponse get(String id) {
        return restClient.get()
            .uri("/records/{id}", id)
            .retrieve()
            .body(PartnerResponse.class);
    }
}
```

Virtual thread membuat blocking wait lebih murah.

Tetapi Anda tetap harus mengatur:

- connect timeout;
- response/read timeout;
- connection pool;
- max connection per route;
- retry;
- circuit breaker;
- rate limit;
- idempotency;
- error mapping.

### 16.2 WebClient in MVC + Virtual Threads

Anda bisa memakai `WebClient` di MVC app, tetapi jangan menjadikannya reactive chain palsu jika pada akhirnya `.block()`.

```java
PartnerResponse response = webClient.get()
    .uri("/records/{id}", id)
    .retrieve()
    .bodyToMono(PartnerResponse.class)
    .block(timeout);
```

Dalam MVC + virtual thread, blocking dengan timeout bisa acceptable. Tetapi jika Anda sudah memilih imperative model, `RestClient` sering lebih natural.

### 16.3 Fan-Out Pattern

Virtual threads memudahkan fan-out blocking calls:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<A> a = executor.submit(() -> clientA.get(id));
    Future<B> b = executor.submit(() -> clientB.get(id));
    Future<C> c = executor.submit(() -> clientC.get(id));

    return aggregate(a.get(), b.get(), c.get());
}
```

Namun production-grade fan-out butuh:

- timeout per call;
- total deadline;
- fallback policy;
- partial response semantics;
- cancellation;
- rate limit;
- bulkhead per downstream;
- correlation ID propagation.

---

## 17. Structured Concurrency and Spring

Java modern memperkenalkan gagasan structured concurrency, yaitu subtask memiliki scope/lifetime yang jelas.

Konsepnya:

```text
start child tasks inside a scope
wait/join them
cancel siblings on failure if policy says so
leave no orphan background work
```

Ini cocok untuk request-level fan-out:

```text
GET /dashboard
  -> fetch profile
  -> fetch permissions
  -> fetch notifications
  -> fetch open cases
```

Tanpa structured concurrency, mudah membuat orphan async work.

Dalam Spring, penggunaan structured concurrency perlu hati-hati karena:

- API Java tertentu mungkin masih preview di beberapa versi;
- integration dengan Spring context/proxy tidak otomatis;
- ThreadLocal context propagation harus dipikirkan;
- transaction jangan dibawa lintas child tasks sembarangan;
- downstream bulkhead tetap dibutuhkan.

Pattern aman secara konsep:

```text
Controller request scope
  -> create bounded concurrent subtasks for independent I/O
  -> each subtask has timeout
  -> no shared mutable transaction entity
  -> aggregate result
  -> return response
```

Jangan gunakan fan-out child tasks untuk operasi yang harus berada dalam satu transaction JPA yang sama.

---

## 18. Virtual Threads and Pinning

Pinning terjadi ketika virtual thread tidak bisa unmount dari carrier thread saat blocking, sehingga carrier thread ikut tertahan.

Penyebab klasik:

- blocking dalam `synchronized` region;
- native call tertentu;
- monitor contention;
- beberapa library/driver lama;
- operasi yang belum virtual-thread friendly.

Contoh berisiko:

```java
synchronized (lock) {
    externalClient.call(); // blocking while holding monitor
}
```

Lebih baik:

```java
StateSnapshot snapshot;

synchronized (lock) {
    snapshot = copyState();
}

externalClient.call(snapshot);
```

Atau gunakan lock/concurrency primitive yang lebih sesuai, tetapi tetap jangan tahan lock saat I/O.

Rule penting:

```text
Never hold a contended lock while doing blocking I/O.
```

Ini benar sebelum virtual threads, dan makin penting setelah virtual threads karena concurrency bisa jauh lebih besar.

---

## 19. Virtual Threads and Locks

Virtual thread bukan lisensi untuk menulis shared mutable state sembarangan.

Buruk:

```java
@Service
class GlobalCounterService {
    private final Map<String, Integer> counters = new HashMap<>();

    public synchronized void increment(String key) {
        counters.merge(key, 1, Integer::sum);
        externalAuditClient.send(key); // terrible
    }
}
```

Masalah:

- global lock;
- blocking I/O dalam lock;
- memory visibility bergantung pada monitor;
- external failure memperpanjang lock;
- concurrency virtual threads memperbesar contention.

Lebih baik:

```java
@Service
class CounterService {
    private final ConcurrentHashMap<String, LongAdder> counters = new ConcurrentHashMap<>();
    private final AuditOutboxRepository outbox;

    public void increment(String key) {
        counters.computeIfAbsent(key, ignored -> new LongAdder()).increment();
        outbox.save(AuditEvent.counterIncremented(key));
    }
}
```

Tetap review:

- apakah state perlu in-memory?
- apakah cluster-safe?
- apakah restart-safe?
- apakah harus durable?

---

## 20. Virtual Threads and Backpressure

Virtual threads dapat membuat aplikasi menerima lebih banyak concurrent operations. Itu baik jika downstream sanggup. Buruk jika downstream tidak sanggup.

Backpressure berarti sistem punya cara untuk berkata:

```text
cukup, jangan kirim pekerjaan lebih banyak sekarang
```

Dalam Spring imperative app, bentuk backpressure bisa berupa:

- bounded executor concurrency;
- database connection pool;
- HTTP client connection pool;
- rate limiter;
- semaphore per downstream;
- queue capacity;
- bulkhead;
- 429/503 response;
- load shedding;
- circuit breaker open;
- scheduler batch size;
- message consumer concurrency limit.

Contoh bulkhead sederhana:

```java
@Component
class PartnerBulkhead {
    private final Semaphore permits = new Semaphore(50);

    <T> T execute(Supplier<T> supplier) {
        boolean acquired = permits.tryAcquire();
        if (!acquired) {
            throw new PartnerBusyException("partner bulkhead full");
        }
        try {
            return supplier.get();
        } finally {
            permits.release();
        }
    }
}
```

Dengan virtual threads, semaphore ini bukan untuk menghemat thread, tetapi untuk melindungi downstream.

---

## 21. Capacity Model: Dari Thread Pool ke Resource Budget

Sebelum virtual threads, banyak capacity planning dimulai dari:

```text
Tomcat max threads = 200
```

Setelah virtual threads, capacity planning harus lebih eksplisit:

```text
max DB connections per app
max DB active query per service
max outbound connections per downstream
max request rate per endpoint
max scheduled batch size
max message listener concurrency
max CPU-bound workers
max memory per in-flight request
```

### 21.1 Contoh Budget

Misal service case-management:

```text
Kubernetes pod replicas          : 4
DB max sessions available        : 240
Reserved DB sessions             : 40
Available for app                : 200
Per-pod DB pool                  : 40-45
Partner API rate limit           : 300/minute
Per-pod partner budget           : 60/minute + burst
Average request memory           : 200 KB
Max target in-flight requests    : 2.000/pod
CPU cores per pod                : 2
```

Maka virtual threads boleh banyak, tetapi actual policies:

```text
DB pool max                      : 40
partner bulkhead                 : 20 concurrent
partner rate limiter             : 60/min/pod
CPU-bound executor               : 2-4 workers
scheduler batch                  : 100/item run
message listener concurrency     : 8-16 depending DB/partner load
```

### 21.2 Tail Latency

Virtual threads dapat meningkatkan throughput pada I/O-bound workload, tetapi tail latency bisa memburuk jika resource queue tidak dikontrol.

Tanda masalah:

- p50 bagus, p99 buruk;
- connection acquisition timeout naik;
- external API timeout naik;
- database active session naik;
- CPU tidak penuh tetapi latency buruk;
- memory naik karena in-flight request terlalu banyak;
- GC pressure naik karena banyak continuation/request object.

---

## 22. Virtual Threads and Reactive Interop

Kadang aplikasi MVC + virtual threads perlu memanggil reactive API.

### 22.1 Blocking at Boundary

Jika Anda berada di MVC virtual thread, blocking pada reactive client dengan timeout bisa acceptable:

```java
public PartnerResponse fetch(String id) {
    return reactiveClient.fetch(id)
        .timeout(Duration.ofSeconds(2))
        .block();
}
```

Tetapi pastikan:

- ini tidak berjalan di event loop;
- timeout jelas;
- error mapping jelas;
- tidak ada nested `.block()` di reactive chain;
- observability tetap tercatat.

### 22.2 Blocking Inside WebFlux Is Different

Di WebFlux handler:

```java
@GetMapping("/{id}")
Mono<Response> get(@PathVariable String id) {
    return Mono.just(blockingRepository.find(id)); // wrong
}
```

Ini salah karena blocking terjadi segera pada thread yang memanggil.

Jika harus memakai blocking dependency di WebFlux:

```java
@GetMapping("/{id}")
Mono<Response> get(@PathVariable String id) {
    return Mono.fromCallable(() -> blockingRepository.find(id))
        .subscribeOn(Schedulers.boundedElastic())
        .map(mapper::toResponse);
}
```

Tetapi jika mayoritas dependency blocking, pertimbangkan kembali: mungkin MVC + virtual threads lebih tepat.

---

## 23. Virtual Threads and Message Consumers

Message listeners memiliki concurrency sendiri.

Contoh Kafka/Rabbit/JMS listener:

```java
@KafkaListener(topics = "case-events", concurrency = "8")
public void handle(CaseEvent event) {
    service.process(event);
}
```

Virtual threads tidak otomatis berarti concurrency listener harus dinaikkan besar-besaran.

Yang menentukan:

- partition count;
- ordering requirement;
- idempotency;
- DB pool capacity;
- downstream rate limit;
- retry/DLQ behavior;
- processing latency;
- transaction boundary.

Jika listener memproses pesan dengan blocking I/O, virtual thread executor bisa membantu. Tetapi concurrency tetap harus dibatasi.

Anti-pattern:

```text
virtual thread enabled
consumer concurrency dinaikkan dari 8 ke 500
DB pool tetap 30
partner API rate limit 300/min
```

Hasilnya biasanya timeout storm, bukan scalability.

---

## 24. Virtual Threads and Batch Jobs

Spring Batch atau custom batch sering I/O-bound.

Virtual threads bisa membantu untuk:

- parallel remote enrichment;
- file chunk upload/download;
- independent item processing;
- object storage calls;
- many blocking operations.

Tetapi batch tetap butuh:

- chunk size;
- transaction boundary;
- skip/retry policy;
- item idempotency;
- restartability;
- throttle limit;
- partitioning policy;
- resource budget.

Contoh conceptual design:

```text
Batch Step
  reads 10.000 records
  chunks by 100
  within each chunk:
    validate CPU-light
    call remote enrichment with max 20 concurrent virtual-thread tasks
    write DB results in controlled transaction
```

Jangan melakukan:

```text
read 10.000 records
spawn 10.000 virtual threads
all call same partner API
all write DB randomly
```

Virtual threads membuat ini mungkin secara teknis, bukan benar secara operasional.

---

## 25. Virtual Threads and Graceful Shutdown

Dengan platform thread pool, lifecycle biasanya jelas:

```text
stop accepting new tasks
wait for running tasks
shutdown pool
```

Dengan virtual-thread-per-task executor, Anda tetap perlu memikirkan:

- apakah task dilacak?
- apakah shutdown menunggu task selesai?
- apakah task bisa dicancel?
- apakah HTTP server stop menerima request?
- apakah readiness berubah sebelum shutdown?
- apakah long-running background task punya checkpoint?

Production shutdown sequence ideal:

```text
1. readiness -> not ready
2. stop accepting external traffic
3. stop message listeners / schedulers
4. stop accepting async jobs
5. wait bounded time for in-flight work
6. cancel or checkpoint long work
7. close DB/HTTP resources
8. exit
```

Virtual threads tidak mengubah kebutuhan ini.

---

## 26. Virtual Threads and Observability

Virtual threads membuat jumlah thread bisa sangat besar. Observability harus berubah dari “lihat thread count” ke “lihat resource pressure”.

Metrics penting:

### 26.1 HTTP Server

- request rate;
- active requests;
- p50/p95/p99 latency;
- error rate;
- timeout rate;
- endpoint-level latency;
- payload size.

### 26.2 Database

- active connections;
- idle connections;
- pending connection acquisition;
- connection acquisition time;
- query latency;
- transaction duration;
- lock wait;
- deadlock count.

### 26.3 HTTP Client

- active connections;
- pending connection acquisition;
- connect timeout;
- response timeout;
- retry count;
- circuit breaker state;
- rate limiter rejection.

### 26.4 Executor / Scheduler

- active task count;
- submitted/completed tasks;
- rejected tasks;
- concurrency limit hit;
- queue depth jika ada;
- task duration;
- failure rate.

### 26.5 JVM

- CPU usage;
- allocation rate;
- heap usage;
- GC pause;
- carrier thread saturation indicators;
- virtual thread pinning events via JFR;
- lock contention.

### 26.6 Business Metrics

- approved cases/minute;
- pending queue size;
- sync lag;
- failed integration count;
- retry backlog;
- stuck workflow count.

Top-tier Spring engineer tidak bertanya:

```text
berapa thread saya punya?
```

Ia bertanya:

```text
resource mana yang sekarang menjadi limiter?
apakah antrean berada di tempat yang memang saya desain?
apakah tail latency naik karena downstream, lock, pool, CPU, atau retry storm?
```

---

## 27. Debugging Virtual Thread Issues

### 27.1 Symptom: Latency Naik Setelah Enable Virtual Threads

Kemungkinan:

- DB pool acquisition antre;
- external API overload;
- missing timeout;
- excessive in-flight request;
- lock contention;
- CPU saturation;
- memory pressure;
- cache stampede;
- retry storm.

Cek:

```text
Hikari pending threads / acquisition time
HTTP client pool pending
p99 endpoint latency
external dependency latency
JFR lock/pinning events
CPU utilization
GC allocation rate
retry metrics
```

### 27.2 Symptom: CPU Tinggi

Kemungkinan:

- workload CPU-bound;
- JSON serialization besar;
- compression;
- encryption;
- regex/parsing heavy;
- excessive logging;
- retry loop;
- busy polling;
- lock contention.

Virtual threads tidak membantu CPU-bound workload.

### 27.3 Symptom: Banyak Timeout DB

Kemungkinan:

- DB pool terlalu kecil untuk workload;
- DB query lambat;
- transaction terlalu panjang;
- lock wait;
- N+1 query;
- too much concurrency from virtual threads;
- scheduled/message workload bersaing dengan HTTP workload.

Solusi bukan selalu menaikkan pool. Bisa jadi:

- batasi concurrency;
- pisahkan executor/job;
- optimalkan query;
- kurangi transaction duration;
- gunakan read replica;
- rate limit endpoint mahal;
- tambahkan cache yang benar.

### 27.4 Symptom: MDC Hilang di Async

Penyebab:

- async boundary tanpa context propagation;
- custom executor tanpa task decorator;
- manual `CompletableFuture` memakai common pool;
- job scheduler tidak set context.

Solusi:

- explicit context payload;
- task decorator;
- observation context propagation;
- jangan bergantung pada request context di durable job.

---

## 28. Migration Strategy: Spring App Lama ke Virtual Threads

### 28.1 Jangan Big Bang

Jangan langsung aktifkan virtual threads di production high-traffic tanpa measurement.

Gunakan tahapan:

```text
1. inventory blocking boundaries
2. ensure timeouts everywhere
3. measure current pool/resource pressure
4. enable in local/perf environment
5. run realistic load test
6. observe DB/HTTP pools and p99 latency
7. add bulkhead/rate limit where needed
8. canary rollout
9. compare metrics
10. expand gradually
```

### 28.2 Inventory

Cari:

- controllers dengan external call;
- services dengan long transaction;
- `@Async` usage;
- scheduled jobs;
- message listeners;
- synchronized blocks;
- custom ThreadLocal;
- MDC propagation;
- `CompletableFuture.supplyAsync` tanpa executor;
- blocking call in WebFlux;
- no-timeout HTTP/database calls.

### 28.3 Baseline Metrics Sebelum Migration

Catat:

```text
HTTP RPS
p50/p95/p99 latency
error rate
CPU
heap/GC
Tomcat thread usage
DB pool active/pending/acquisition time
query latency
external HTTP latency
retry count
scheduler duration
message lag
```

Setelah virtual threads, bandingkan.

### 28.4 Endpoint-by-Endpoint Thinking

Tidak semua endpoint mendapat manfaat sama.

| Endpoint Type | Virtual Thread Benefit | Risk |
|---|---:|---|
| DB-heavy read endpoint | High | DB pool/query bottleneck |
| External API aggregator | High | partner rate limit/timeouts |
| CPU-heavy report generation | Low | CPU saturation |
| File streaming | Medium | memory/backpressure |
| Simple CRUD | Medium | DB pool |
| WebFlux SSE stream | Low/Depends | reactive may remain better |
| Batch enrichment | High | downstream overload |

---

## 29. Spring Configuration Patterns

### 29.1 Global Enablement

```properties
spring.threads.virtual.enabled=true
```

Use when:

- app is Java 21+;
- dependencies tested;
- workload mostly I/O-bound;
- observability ready;
- timeout/bulkhead policy exists.

### 29.2 Named Executor for I/O Work

```java
@Configuration
class VirtualThreadExecutors {

    @Bean(name = "externalIoExecutor")
    AsyncTaskExecutor externalIoExecutor() {
        SimpleAsyncTaskExecutor executor = new SimpleAsyncTaskExecutor("external-io-vt-");
        executor.setVirtualThreads(true);
        executor.setConcurrencyLimit(200);
        return executor;
    }
}
```

Usage:

```java
@Async("externalIoExecutor")
public CompletableFuture<PartnerResult> enrich(String id) {
    return CompletableFuture.completedFuture(partnerClient.fetch(id));
}
```

### 29.3 Separate CPU Executor

Jangan jalankan CPU-heavy work dengan unlimited virtual threads.

```java
@Bean(name = "cpuExecutor")
ExecutorService cpuExecutor() {
    return Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());
}
```

Usage:

```java
public CompletableFuture<Report> computeReport(Input input) {
    return CompletableFuture.supplyAsync(() -> reportEngine.compute(input), cpuExecutor);
}
```

### 29.4 Explicit Downstream Bulkhead

```java
@Component
class ExternalPartnerGateway {

    private final Semaphore bulkhead = new Semaphore(30);
    private final PartnerClient client;

    ExternalPartnerGateway(PartnerClient client) {
        this.client = client;
    }

    PartnerResponse get(String id) {
        if (!bulkhead.tryAcquire()) {
            throw new PartnerUnavailableException("partner concurrency limit reached");
        }
        try {
            return client.get(id);
        } finally {
            bulkhead.release();
        }
    }
}
```

---

## 30. Design Heuristics for Top-Tier Spring Engineers

### 30.1 Treat Virtual Threads as Execution Substrate, Not Architecture

Virtual thread is not an architecture.

Architecture tetap tentang:

- boundary;
- ownership;
- state;
- consistency;
- failure;
- capacity;
- observability;
- recovery.

### 30.2 Prefer Imperative Clarity When Workload Is Blocking

Jika semua dependency blocking, jangan memaksakan reactive hanya untuk fashionable.

MVC + virtual threads sering menghasilkan code yang lebih mudah:

```java
Application app = repository.findRequired(id);
RiskScore risk = riskClient.score(app);
Decision decision = policy.evaluate(app, risk);
repository.save(decision);
```

Dibanding reactive chain yang akhirnya tetap blocking.

### 30.3 Keep Reactive Where Backpressure/Streaming Is Real

Jangan menghapus WebFlux hanya karena virtual threads ada. Untuk streaming dan non-blocking end-to-end, WebFlux tetap kuat.

### 30.4 Resource Pools Are Business Capacity Controls

Setelah virtual threads, pool bukan lagi sekadar thread-saver. Pool adalah protection boundary.

- DB pool melindungi DB.
- HTTP pool melindungi partner/downstream.
- executor concurrency melindungi CPU/downstream.
- rate limiter melindungi contract.

### 30.5 Never Hide Unlimited Concurrency in Library Code

Buruk:

```java
public void processAll(List<Item> items) {
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        for (Item item : items) {
            executor.submit(() -> process(item));
        }
    }
}
```

Ini terlihat innocent, tetapi library diam-diam bisa membuat concurrency tidak terbatas.

Lebih baik:

```java
public void processAll(List<Item> items, int concurrencyLimit) {
    Semaphore limit = new Semaphore(concurrencyLimit);
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        for (Item item : items) {
            executor.submit(() -> {
                limit.acquireUninterruptibly();
                try {
                    process(item);
                } finally {
                    limit.release();
                }
            });
        }
    }
}
```

Lebih baik lagi: desain API yang eksplisit menerima policy object.

---

## 31. Anti-Patterns

### 31.1 “Virtual Threads Means No Need for WebFlux Understanding”

Salah. Anda tetap perlu memahami WebFlux jika:

- app Anda memakai reactive stack;
- library mengembalikan `Mono`/`Flux`;
- ada SSE/streaming;
- event loop blocking risk;
- backpressure penting.

### 31.2 “Virtual Threads Means Unlimited DB Queries”

Salah. DB tetap resource finite.

### 31.3 “Remove All Thread Pools”

Salah. CPU-bound work tetap butuh bounded executor. Downstream-bound work tetap butuh bulkhead.

### 31.4 “No Need Timeout Because Threads Are Cheap”

Lebih salah lagi. Karena threads cheap, aplikasi bisa menunggu lebih banyak operasi yang macet. Timeout makin penting.

### 31.5 “Use Virtual Threads for Long-Lived Idle Background Threads Without Lifecycle”

Virtual thread murah, tetapi pekerjaan background tetap perlu lifecycle, cancellation, observability, dan shutdown.

### 31.6 “Put Everything in ThreadLocal”

Virtual thread mendukung ThreadLocal, tetapi jumlah virtual thread besar membuat ThreadLocal besar/berantakan menjadi masalah memory dan clarity.

### 31.7 “Enable and Forget”

Virtual thread adalah perubahan runtime behavior. Harus diuji dengan load pattern realistis.

---

## 32. Practical Decision Matrix

| Situation | Prefer | Why |
|---|---|---|
| Existing Spring MVC + JDBC/JPA | MVC + virtual threads | Minimal rewrite, blocking I/O cheaper |
| High concurrency external API aggregator | MVC + VT or WebFlux | VT if blocking clients; WebFlux if non-blocking end-to-end |
| Streaming/SSE large event stream | WebFlux | Backpressure and non-blocking streaming |
| CPU-heavy analytics endpoint | Bounded CPU executor | VT does not add CPU |
| Batch remote enrichment | VT with bounded concurrency | Cheap waits, still protect downstream |
| Legacy blocking SDK | VT | Avoid callback wrapper complexity |
| Reactive DB/R2DBC end-to-end | WebFlux | Keep non-blocking chain |
| Team weak in Reactor | MVC + VT | Maintainability wins |
| No timeout/no metrics legacy app | Fix first | VT can amplify hidden overload |
| Many synchronized I/O blocks | Refactor first | Pinning/contention risk |

---

## 33. Review Checklist for Pull Requests

When reviewing Spring code using virtual threads, ask:

```text
[ ] Is this workload I/O-bound or CPU-bound?
[ ] What resource is actually limited?
[ ] Is there a timeout for every outbound call?
[ ] Is DB connection pool sized and observed?
[ ] Is external API concurrency/rate limited?
[ ] Are transactions short?
[ ] Are external calls outside DB transaction?
[ ] Does @Async cross transaction/security/MDC boundaries safely?
[ ] Is custom ThreadLocal cleared?
[ ] Is MDC/correlation propagated where needed?
[ ] Are scheduled jobs idempotent and non-overlapping?
[ ] Are message listener concurrency settings aligned with DB/downstream capacity?
[ ] Are locks held during blocking I/O?
[ ] Is there evidence from load test/JFR/metrics?
[ ] Is graceful shutdown safe for in-flight virtual-thread tasks?
[ ] Does the code avoid unlimited hidden fan-out?
```

---

## 34. Mini Case Study: Case Management Approval Endpoint

### 34.1 Initial Design

```java
@Transactional
public ApprovalResponse approve(Long caseId) {
    Case c = caseRepository.findByIdForUpdate(caseId);
    EligibilityResult eligibility = eligibilityClient.check(c.applicantId());
    if (!eligibility.allowed()) {
        c.reject(eligibility.reason());
    } else {
        c.approve();
    }
    emailClient.sendApprovalEmail(c); // inside transaction
    return mapper.toResponse(c);
}
```

Problems:

- DB lock held during external eligibility call;
- DB transaction held during email call;
- external latency increases lock time;
- virtual thread makes waiting cheaper but lock/transaction still bad;
- email side effect can happen even if later DB commit fails depending flow;
- retries can duplicate email.

### 34.2 Better Design

```java
@Transactional
public ApprovalResponse approve(Long caseId, Actor actor) {
    Case c = caseRepository.findByIdForUpdate(caseId);

    EligibilitySnapshot eligibility = eligibilityRepository.findLatestRequired(c.applicantId());
    c.applyApprovalDecision(eligibility, actor.userId());

    outboxRepository.save(OutboxEvent.caseApprovalChanged(c.id(), actor.userId()));

    return mapper.toResponse(c);
}
```

External eligibility refresh happens before/after through controlled worker:

```java
@Async("externalIoExecutor")
public CompletableFuture<Void> refreshEligibility(Long applicantId) {
    EligibilityResult result = eligibilityGateway.check(applicantId);
    eligibilityRepository.saveSnapshot(result);
    return CompletableFuture.completedFuture(null);
}
```

Outbox worker sends email after commit:

```java
@Scheduled(fixedDelayString = "${outbox.poll.delay:PT5S}")
public void publishOutboxBatch() {
    List<OutboxEvent> events = outboxRepository.claimNextBatch(100);
    for (OutboxEvent event : events) {
        publisher.publish(event);
        outboxRepository.markPublished(event.id());
    }
}
```

Virtual thread helps external I/O workers, but correctness comes from boundary design.

---

## 35. Mini Lab: Measuring Virtual Thread Benefit

Create two endpoints:

```java
@GetMapping("/blocking")
public String blocking() throws InterruptedException {
    Thread.sleep(200);
    return "ok";
}
```

And:

```java
@GetMapping("/cpu")
public long cpu() {
    long result = 0;
    for (long i = 0; i < 500_000_000L; i++) {
        result += i;
    }
    return result;
}
```

Run load test with virtual threads disabled and enabled.

Expected learning:

- `/blocking` benefits more because waiting is cheaper;
- `/cpu` does not improve much and can get worse if concurrency too high;
- p99 matters more than average;
- active DB/HTTP pools matter more than thread count;
- metrics tell the truth.

Add DB endpoint:

```java
@GetMapping("/db")
public List<Record> db() {
    return jdbcTemplate.query("select * from records where status = ?", mapper, "ACTIVE");
}
```

Then vary Hikari pool size. Observe:

- acquisition time;
- active connection;
- pending request;
- p99 latency.

This teaches the main lesson:

```text
Virtual threads expose downstream capacity limits more clearly.
```

---

## 36. How This Fits the Whole Spring Series

Part 21 connects previous parts:

- Part 9: proxy still controls `@Async`, `@Transactional`, cache, method security.
- Part 10: transaction remains thread-bound and boundary-sensitive.
- Part 14: WebFlux remains useful when non-blocking/backpressure is real.
- Part 15: HTTP clients still need timeout, pool, retry, and bulkhead.
- Part 17: failure semantics become more important with more concurrency.
- Part 20: async/scheduler/event execution model must be explicit.

Virtual threads do not replace Spring architecture knowledge. They make architectural mistakes scale faster.

---

## 37. Key Takeaways

1. Virtual threads make blocking I/O cheaper from a thread perspective.
2. Virtual threads do not increase database, CPU, partner API, or lock capacity.
3. Spring Boot can enable virtual-thread integration with a property, but production readiness requires timeout, bulkhead, observability, and load testing.
4. MVC + virtual threads is often the best path for Spring apps using JDBC/JPA and blocking integrations.
5. WebFlux remains valuable for end-to-end non-blocking, streaming, and backpressure-heavy systems.
6. ThreadLocal-based Spring contexts still work within one virtual thread, but async boundaries still need explicit propagation.
7. `@Async`, `@Scheduled`, message listeners, and batch jobs still need concurrency limits and failure handling.
8. Transaction design is unchanged: keep transactions short, do not hold DB transactions during external calls, use outbox for side effects.
9. Capacity planning shifts from thread pool thinking to resource budget thinking.
10. Top-tier Spring engineering means knowing where concurrency should be allowed, where it must be bounded, and where it must be rejected.

---

## 38. References

- Spring Boot Reference — Task Execution and Scheduling: `spring.threads.virtual.enabled`, auto-configured executors, task scheduler builders.
- Spring Framework Reference — Task Execution and Scheduling: `SimpleAsyncTaskExecutor`, virtualThreads option, concurrency limit, graceful shutdown behavior.
- Spring Framework Javadoc — `SimpleAsyncTaskExecutor`: virtual thread support on JDK 21+, concurrency limit, task termination timeout.
- OpenJDK JEP 444 — Virtual Threads: virtual threads introduced as a final feature in JDK 21.
- Oracle Java 21 Documentation — Virtual Threads: platform thread vs virtual thread conceptual model.
- Spring Boot System Requirements — Spring Boot 4.x Java baseline and compatibility.
- Spring Blog — Embracing Virtual Threads: Spring team discussion of virtual threads and blocking compatibility.

---

## 39. Status

```text
Part saat ini : 21 dari 35
Status        : belum selesai
Berikutnya    : 22-spring-messaging-jms-amqp-kafka-boundary.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./20-async-scheduling-events-execution-model.md">⬅️ Part 20 — Async, Scheduling, Events, and Execution Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./22-spring-messaging-jms-amqp-kafka-boundary.md">Part 22 — Spring Messaging: JMS, AMQP/RabbitMQ, Kafka, and Integration Boundary ➡️</a>
</div>

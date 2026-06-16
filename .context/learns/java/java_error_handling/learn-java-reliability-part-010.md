# learn-java-reliability-part-010.md

# Part 010 — Spring Boot Graceful Shutdown Deep Dive

> Seri: **Graceful Shutdown, Error Handling, Exceptions, and Reliability**  
> Posisi: **Part 010 dari 030**  
> Status seri: **belum selesai**  
> Fokus: memahami mekanisme graceful shutdown di Spring Boot secara mendalam: web server, `ApplicationContext`, `SmartLifecycle`, executor, scheduler, readiness/liveness, resource ordering, dan jebakan produksi.

---

## 0. Kenapa Part Ini Penting?

Pada part sebelumnya kita sudah turun ke level JVM: shutdown hook, daemon/non-daemon thread, signal, `System.exit`, dan keterbatasan cleanup di akhir hidup proses.

Part ini naik satu lapisan ke runtime aplikasi yang paling sering dipakai di Java backend modern: **Spring Boot**.

Banyak engineer mengira Spring Boot graceful shutdown cukup dengan konfigurasi:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Lalu dianggap selesai.

Itu keliru.

Konfigurasi tersebut memang penting, tetapi hanya menyelesaikan sebagian masalah: **embedded web server akan mencoba berhenti menerima request baru dan memberi kesempatan request yang sedang berjalan untuk selesai dalam grace period**.

Namun production application biasanya lebih dari HTTP server:

```text
Spring Boot application
├── embedded web server
│   ├── Tomcat / Jetty / Undertow / Reactor Netty
│   └── request in-flight
├── ApplicationContext
│   ├── beans
│   ├── lifecycle processor
│   ├── SmartLifecycle components
│   └── destroy callbacks
├── executors
│   ├── @Async
│   ├── ThreadPoolTaskExecutor
│   └── virtual thread executor
├── schedulers
│   ├── @Scheduled jobs
│   └── internal polling jobs
├── integrations
│   ├── HTTP clients
│   ├── DB pool
│   ├── Redis client
│   ├── RabbitMQ/Kafka consumers
│   └── external API tokens/cache
├── observability
│   ├── logs
│   ├── metrics
│   └── tracing exporters
└── container platform
    ├── Kubernetes readiness/liveness
    ├── endpoint removal
    ├── load balancer delay
    └── terminationGracePeriodSeconds
```

Jadi pertanyaan sebenarnya bukan:

> Apakah Spring Boot support graceful shutdown?

Pertanyaan yang lebih benar:

> Apakah semua work source, resource dependency, lifecycle phase, dan platform termination budget kita tersusun sehingga shutdown benar-benar aman?

Bagian ini membangun jawaban tersebut.

---

## 1. Core Problem

Spring Boot graceful shutdown sering gagal bukan karena Spring Boot buruk, tetapi karena aplikasi dibangun dengan asumsi yang terlalu sempit.

### 1.1 Asumsi umum yang salah

#### Asumsi 1 — “Kalau web server graceful, seluruh aplikasi graceful”

Salah.

Web server hanya satu entry point. Background worker, scheduler, message consumer, async executor, dan batch process bisa tetap berjalan atau berhenti dalam urutan yang tidak kamu pikirkan.

#### Asumsi 2 — “Shutdown timeout adalah total timeout aplikasi”

Tidak selalu.

`spring.lifecycle.timeout-per-shutdown-phase` adalah timeout per lifecycle phase. Dalam konteks container/Kubernetes, total waktu tetap dibatasi oleh platform termination budget.

#### Asumsi 3 — “Bean destroy akan selalu aman dipanggil terakhir”

Secara lifecycle, ada tahapan stop processing dan destroy processing. Tetapi kalau kamu salah menempatkan cleanup, worker bisa masih membutuhkan resource yang sudah mulai ditutup.

#### Asumsi 4 — “Spring otomatis tahu task mana yang business-critical”

Tidak.

Spring tahu lifecycle bean, bukan semantic business operation kamu. Ia tidak tahu apakah task boleh dibatalkan, harus selesai, harus checkpoint, harus requeue, atau harus compensate.

#### Asumsi 5 — “Readiness probe otomatis turun sebelum traffic masuk lagi”

Tidak cukup.

Readiness state, endpoint removal, kube-proxy propagation, ingress/load balancer deregistration, dan client keep-alive bisa membuat traffic masih masuk beberapa saat setelah shutdown dimulai.

---

## 2. Mental Model: Spring Boot Shutdown sebagai Multi-Phase State Machine

Jangan bayangkan shutdown sebagai satu event.

Bayangkan sebagai state machine:

```text
RUNNING
  |
  | SIGTERM / context close / actuator shutdown / System.exit
  v
SHUTDOWN_REQUESTED
  |
  | mark availability/refuse new work
  v
DRAINING
  |
  | in-flight work complete / deadline approaching
  v
STOPPING_LIFECYCLE_COMPONENTS
  |
  | SmartLifecycle stop by phase
  v
DESTROYING_BEANS
  |
  | @PreDestroy / DisposableBean / destroyMethod
  v
CLOSING_RESOURCES
  |
  | DB pool / clients / exporters
  v
EXITED
```

Tetapi real production flow lebih kompleks:

```text
Kubernetes sends SIGTERM
  |
  +--> preStop may run before TERM depending on hook design
  |
  +--> Spring Boot receives shutdown through JVM hook
        |
        +--> ApplicationContext close begins
              |
              +--> availability/readiness changes
              |
              +--> web server graceful shutdown begins
              |
              +--> SmartLifecycle beans stop by phase
              |
              +--> executors stop accepting tasks
              |
              +--> schedulers stop scheduling
              |
              +--> destroy callbacks run
              |
              +--> resources close
```

### 2.1 Ada empat boundary waktu

Spring shutdown harus dipahami dengan empat budget waktu:

| Boundary | Contoh | Siapa yang mengontrol |
|---|---|---|
| Request timeout | `server.tomcat.connection-timeout`, gateway timeout, client timeout | App/gateway/client |
| Spring lifecycle timeout | `spring.lifecycle.timeout-per-shutdown-phase` | Spring |
| Container termination timeout | `terminationGracePeriodSeconds` | Kubernetes/platform |
| Load balancer drain timeout | ALB/Nginx/Ingress deregistration delay | Infrastruktur |

Graceful shutdown aman hanya kalau budget ini selaras.

Contoh buruk:

```text
Client timeout:                      60s
Spring lifecycle timeout:            30s
Kubernetes termination grace period:  20s
Long request duration:               45s
```

Hasil:

```text
Spring ingin menunggu 30s
Kubernetes hanya memberi 20s
Long request butuh 45s
=> pod dibunuh sebelum request selesai
```

### 2.2 Prinsip utama

```text
Graceful shutdown bukan tentang menunggu selama mungkin.
Graceful shutdown adalah membuat keputusan eksplisit tentang pekerjaan mana yang:
- tidak boleh dimulai lagi,
- boleh diselesaikan,
- harus dibatalkan,
- harus dikembalikan ke antrean,
- harus di-checkpoint,
- harus dikompensasi,
- atau harus dibuat idempotent agar aman diulang.
```

---

## 3. Spring Boot Graceful Shutdown: Apa yang Disediakan Framework?

Spring Boot menyediakan graceful shutdown untuk embedded web server ketika properti ini diaktifkan:

```properties
server.shutdown=graceful
```

Dan timeout lifecycle dapat dikonfigurasi:

```properties
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Dokumentasi Spring Boot menjelaskan bahwa graceful shutdown terjadi ketika `ApplicationContext` ditutup. Pada fase itu web server akan berhenti menerima request baru dan memberi kesempatan request aktif untuk selesai dalam grace period. Timeout dikonfigurasi melalui `spring.lifecycle.timeout-per-shutdown-phase`.

### 3.1 Minimal configuration

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Ini adalah baseline, bukan solusi penuh.

### 3.2 Apa yang terjadi pada web server?

Secara konseptual:

```text
Context close starts
  -> web server begins graceful shutdown
  -> no new request accepted according to server capability
  -> existing request gets time to complete
  -> timeout reached or request completed
  -> server stops
```

Tetapi detailnya tergantung embedded server:

| Server | Catatan umum |
|---|---|
| Tomcat | Berhenti menerima request baru di network layer dan menunggu request aktif sesuai graceful period |
| Jetty | Mendukung shutdown berbasis lifecycle server |
| Undertow | Mekanisme graceful shutdown berbeda dan harus diuji pada workload aktual |
| Reactor Netty | Relevan untuk Spring WebFlux; shutdown harus mempertimbangkan event loop dan reactive streams |

Jangan menganggap semua server identik. Test dengan server yang benar-benar dipakai.

---

## 4. ApplicationContext Close: Urutan Besar

Spring application shutdown umumnya terjadi melalui `ConfigurableApplicationContext.close()`.

Secara mental model:

```text
ApplicationContext.close()
  -> publish ContextClosedEvent
  -> stop Lifecycle/SmartLifecycle beans
  -> destroy singleton beans
  -> close bean factory resources
```

### 4.1 ContextClosedEvent

`ContextClosedEvent` dapat dipakai untuk mengetahui bahwa context mulai ditutup.

Contoh:

```java
@Component
public class ShutdownEventLogger {

    private static final Logger log = LoggerFactory.getLogger(ShutdownEventLogger.class);

    @EventListener(ContextClosedEvent.class)
    public void onContextClosed(ContextClosedEvent event) {
        log.info("ApplicationContext is closing: contextId={}", event.getApplicationContext().getId());
    }
}
```

Namun event listener bukan tempat ideal untuk operasi shutdown panjang.

Kenapa?

Karena listener seperti ini tidak secara eksplisit berpartisipasi dalam `SmartLifecycle` phase ordering. Untuk shutdown logic yang harus terurut, `SmartLifecycle` lebih tepat.

---

## 5. `SmartLifecycle`: Core Abstraction untuk Shutdown Ordering

`SmartLifecycle` adalah mekanisme penting untuk komponen yang punya lifecycle start/stop dan perlu urutan shutdown.

Konsep penting:

```java
public interface SmartLifecycle extends Lifecycle, Phased {
    boolean isAutoStartup();
    void stop(Runnable callback);
    int getPhase();
}
```

### 5.1 Kenapa `SmartLifecycle` penting?

Karena graceful shutdown production sering butuh urutan:

```text
1. Stop accepting new business work
2. Stop consumers/pollers
3. Let in-flight tasks finish/checkpoint
4. Stop async executors
5. Flush observability
6. Close resource clients
```

Kalau semua hanya mengandalkan `@PreDestroy`, ordering bisa terlalu kasar.

### 5.2 Phase ordering

`SmartLifecycle` memiliki `getPhase()`.

Mental model:

```text
Startup:  lower phase starts earlier
Shutdown: higher phase stops earlier
```

Contoh:

```text
Startup order:
phase 0     -> resource base
phase 100   -> worker
phase 1000  -> inbound adapter

Shutdown order:
phase 1000  -> inbound adapter stops first
phase 100   -> worker drains
phase 0     -> resource base closes last
```

Ini sangat penting.

Kalau HTTP/message ingress harus berhenti sebelum executor/resource ditutup, beri phase lebih tinggi pada ingress controller.

### 5.3 Contoh `SmartLifecycle` untuk admission control

```java
@Component
public final class ShutdownAdmissionController implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(ShutdownAdmissionController.class);

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean acceptingNewWork = new AtomicBoolean(false);

    @Override
    public void start() {
        running.set(true);
        acceptingNewWork.set(true);
        log.info("Admission controller started; accepting new work");
    }

    @Override
    public void stop(Runnable callback) {
        try {
            acceptingNewWork.set(false);
            running.set(false);
            log.info("Admission controller stopped; rejecting new work");
        } finally {
            callback.run();
        }
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }

    @Override
    public boolean isAutoStartup() {
        return true;
    }

    @Override
    public int getPhase() {
        // High phase: stop early during shutdown.
        return Integer.MAX_VALUE;
    }

    public boolean isAcceptingNewWork() {
        return acceptingNewWork.get();
    }
}
```

Controller dapat menggunakan ini:

```java
@RestController
@RequestMapping("/commands")
public class CommandController {

    private final ShutdownAdmissionController admission;
    private final CommandService commandService;

    public CommandController(
            ShutdownAdmissionController admission,
            CommandService commandService
    ) {
        this.admission = admission;
        this.commandService = commandService;
    }

    @PostMapping
    public ResponseEntity<CommandResponse> submit(@RequestBody CommandRequest request) {
        if (!admission.isAcceptingNewWork()) {
            return ResponseEntity
                    .status(HttpStatus.SERVICE_UNAVAILABLE)
                    .header(HttpHeaders.RETRY_AFTER, "5")
                    .body(CommandResponse.rejected("SERVICE_DRAINING"));
        }

        CommandResponse response = commandService.handle(request);
        return ResponseEntity.accepted().body(response);
    }
}
```

Catatan:

- Jangan hanya bergantung pada web server menolak koneksi baru.
- Aplikasi tetap perlu admission control untuk business work.
- Ini berguna saat masih ada traffic akibat race readiness/load balancer.

---

## 6. `stop(Runnable callback)`: Jebakan Penting

Dalam `SmartLifecycle`, method ini penting:

```java
void stop(Runnable callback)
```

Callback harus dipanggil setelah stop selesai.

### 6.1 Anti-pattern: lupa memanggil callback

```java
@Override
public void stop(Runnable callback) {
    running.set(false);
    // BUG: callback.run() tidak dipanggil
}
```

Dampak:

```text
Spring menunggu sampai timeout phase habis
  -> shutdown lebih lama
  -> phase berikutnya tertunda
  -> container grace period bisa habis
  -> SIGKILL
```

### 6.2 Pattern benar untuk stop cepat

```java
@Override
public void stop(Runnable callback) {
    try {
        running.set(false);
    } finally {
        callback.run();
    }
}
```

### 6.3 Pattern benar untuk stop async

```java
@Override
public void stop(Runnable callback) {
    accepting.set(false);

    CompletableFuture
            .runAsync(this::drainSafely, shutdownExecutor)
            .whenComplete((ignored, throwable) -> {
                if (throwable != null) {
                    log.error("Drain failed during shutdown", throwable);
                }
                callback.run();
            });
}
```

Tetapi hati-hati: executor yang dipakai untuk shutdown async **tidak boleh sudah dihentikan sebelum drain selesai**.

---

## 7. Web Server Shutdown vs Application Work Shutdown

Spring Boot web graceful shutdown membantu request lifecycle, tetapi aplikasi sering punya business work yang keluar dari request thread.

Contoh:

```java
@PostMapping("/reports")
public ResponseEntity<Void> generate(@RequestBody GenerateReportCommand command) {
    reportExecutor.submit(() -> reportService.generate(command));
    return ResponseEntity.accepted().build();
}
```

Request selesai cepat, tetapi work sesungguhnya berjalan di executor.

Web graceful shutdown hanya melihat request selesai. Ia tidak tahu report masih berjalan.

### 7.1 Implikasi

```text
HTTP request completed
  -> client receives 202 Accepted
  -> async report task still running
  -> shutdown begins
  -> executor stops abruptly or resource closes
  -> report half-complete
```

### 7.2 Solusi desain

Ada beberapa opsi:

| Work type | Shutdown strategy |
|---|---|
| Short synchronous request | allow completion within request timeout |
| Long async task | persist command first, process via queue/worker |
| Critical batch | checkpoint and resume |
| External side-effect task | idempotency key + outbox |
| Non-critical task | cancel/drop explicitly with metric |

Rule:

```text
Jika work lebih panjang dari request lifecycle, jangan mengandalkan web graceful shutdown sebagai reliability boundary.
```

---

## 8. Spring Availability: Readiness dan Liveness

Spring Boot Actuator menyediakan konsep application availability:

```text
LivenessState  -> apakah aplikasi hidup atau broken secara internal?
ReadinessState -> apakah aplikasi siap menerima traffic?
```

Di Kubernetes, readiness penting untuk routing traffic.

### 8.1 Liveness bukan readiness

Kesalahan umum:

```text
shutdown mulai -> liveness DOWN
```

Ini buruk.

Liveness DOWN berarti platform boleh membunuh/restart aplikasi karena dianggap rusak.

Saat shutdown normal, aplikasi tidak broken. Ia hanya tidak siap menerima traffic baru.

Yang harus berubah adalah readiness/admission, bukan liveness.

### 8.2 State yang benar saat shutdown

```text
RUNNING:
  liveness  = CORRECT
  readiness = ACCEPTING_TRAFFIC

DRAINING:
  liveness  = CORRECT
  readiness = REFUSING_TRAFFIC

BROKEN:
  liveness  = BROKEN
  readiness = REFUSING_TRAFFIC
```

### 8.3 Publishing readiness refused

```java
@Component
public class ShutdownReadinessPublisher implements SmartLifecycle {

    private final ApplicationEventPublisher publisher;
    private volatile boolean running;

    public ShutdownReadinessPublisher(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    @Override
    public void start() {
        this.running = true;
        AvailabilityChangeEvent.publish(
                publisher,
                this,
                ReadinessState.ACCEPTING_TRAFFIC
        );
    }

    @Override
    public void stop(Runnable callback) {
        try {
            AvailabilityChangeEvent.publish(
                    publisher,
                    this,
                    ReadinessState.REFUSING_TRAFFIC
            );
            this.running = false;
        } finally {
            callback.run();
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return Integer.MAX_VALUE;
    }
}
```

Catatan:

- Ini bukan pengganti Kubernetes endpoint delay handling.
- Ini hanya mempercepat signal bahwa app tidak siap.
- Tetap perlu admission control dan load balancer drain alignment.

---

## 9. Controller-Level Draining Guard

Walaupun web server mulai graceful shutdown, tetap ada race.

Contoh race:

```text
T0: SIGTERM received
T1: readiness becomes false
T2: Kubernetes endpoint update propagates
T3: Ingress/load balancer still has old endpoint
T4: Client sends request to terminating pod
T5: Pod receives request during draining
```

Karena itu endpoint penting harus punya draining guard.

### 9.1 Filter-based guard

```java
@Component
public class DrainingRequestFilter extends OncePerRequestFilter {

    private final ShutdownAdmissionController admission;

    public DrainingRequestFilter(ShutdownAdmissionController admission) {
        this.admission = admission;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        if (!admission.isAcceptingNewWork() && isMutatingRequest(request)) {
            response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
            response.setHeader(HttpHeaders.RETRY_AFTER, "5");
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("""
                    {"code":"SERVICE_DRAINING","message":"Service is draining and temporarily unavailable"}
                    """);
            return;
        }

        filterChain.doFilter(request, response);
    }

    private boolean isMutatingRequest(HttpServletRequest request) {
        String method = request.getMethod();
        return method.equals("POST")
                || method.equals("PUT")
                || method.equals("PATCH")
                || method.equals("DELETE");
    }
}
```

### 9.2 Kenapa hanya mutating request?

Tidak selalu harus begitu.

Untuk beberapa aplikasi, semua request baru harus ditolak saat draining. Untuk aplikasi lain, read-only request masih boleh dilayani karena aman dan cepat.

Decision matrix:

| Request type | Saat draining | Alasan |
|---|---|---|
| Health/readiness | tetap layani | platform observability |
| Read-only cepat | opsional | aman jika resource masih ada |
| Mutating command | biasanya tolak | mengurangi partial side effect |
| Long-running report | tolak | tidak cukup waktu |
| Streaming | biasanya tolak new stream | sulit drain |
| Admin recovery endpoint | tergantung | bisa dibutuhkan operator |

---

## 10. Executor Shutdown di Spring Boot

Banyak reliability bug muncul dari executor.

### 10.1 Problem dasar

```java
@Async
public void sendEmailAsync(...) {
    emailClient.send(...);
}
```

Saat shutdown:

```text
ApplicationContext closing
  -> task executor shutdown
  -> existing task may or may not finish depending config
  -> new task rejected
  -> resource dependency may close before task done if ordering salah
```

### 10.2 ThreadPoolTaskExecutor configuration

Contoh konfigurasi lebih eksplisit:

```java
@Configuration
@EnableAsync
public class AsyncExecutorConfig {

    @Bean(name = "businessTaskExecutor")
    public ThreadPoolTaskExecutor businessTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setThreadNamePrefix("business-task-");
        executor.setCorePoolSize(8);
        executor.setMaxPoolSize(16);
        executor.setQueueCapacity(500);

        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(25);

        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.initialize();
        return executor;
    }
}
```

### 10.3 Apa arti konfigurasi ini?

```text
waitForTasksToCompleteOnShutdown=true
  -> saat shutdown, executor tidak langsung membatalkan task yang sudah masuk

awaitTerminationSeconds=25
  -> Spring menunggu maksimal 25 detik untuk task selesai

AbortPolicy
  -> task baru yang ditolak terlihat sebagai RejectedExecutionException
```

### 10.4 Jebakan: queue besar memperburuk shutdown

```java
executor.setQueueCapacity(100_000);
```

Ini terlihat aman saat traffic tinggi, tetapi buruk saat shutdown.

Jika ada 50.000 task di queue:

```text
shutdown begins
  -> executor stops accepting new task
  -> tries finishing queued tasks
  -> impossible within grace period
  -> termination timeout
  -> forced kill
```

Rule:

```text
Queue capacity adalah reliability decision, bukan sekadar performance tuning.
```

### 10.5 Better pattern: bounded queue + persistent work

Untuk work penting:

```text
HTTP request
  -> validate
  -> persist command/job record
  -> enqueue durable message / outbox
  -> return 202

worker
  -> claim job
  -> process idempotently
  -> checkpoint
  -> complete
```

Jangan menaruh critical long-running work hanya di in-memory executor queue.

---

## 11. `@Async` During Shutdown

`@Async` membuat method berjalan di executor. Masalahnya: banyak engineer lupa bahwa `@Async` memutus lifecycle request.

### 11.1 Anti-pattern

```java
@PostMapping("/submit")
public ResponseEntity<Void> submit(@RequestBody SubmitRequest request) {
    service.validate(request);
    service.processAsync(request);
    return ResponseEntity.accepted().build();
}

@Async
public void processAsync(SubmitRequest request) {
    repository.save(...);
    externalClient.notify(...);
}
```

Bug:

```text
Client menerima 202
Tetapi processAsync belum tentu durable
Saat shutdown, task bisa belum dimulai atau gagal di tengah
Tidak ada job id, no retry, no checkpoint
```

### 11.2 Design yang lebih reliable

```java
@Transactional
public SubmitResponse submit(SubmitCommand command) {
    Submission submission = Submission.create(command);
    submissionRepository.save(submission);

    outboxRepository.save(OutboxEvent.submissionCreated(submission.id()));

    return new SubmitResponse(submission.id(), "ACCEPTED");
}
```

Kemudian worker memproses outbox secara idempotent.

### 11.3 Prinsip

```text
@Async cocok untuk optimization.
@Async tidak otomatis cocok untuk durability boundary.
```

Kalau client diberi respons bahwa kerja diterima, harus ada state durable yang membuktikan kerja itu memang diterima.

---

## 12. Scheduled Task Shutdown

`@Scheduled` sering menjadi sumber shutdown bug.

Contoh:

```java
@Scheduled(fixedDelay = 60_000)
public void syncExternalStatus() {
    List<Item> items = repository.findPending();
    for (Item item : items) {
        externalClient.sync(item);
        repository.markSynced(item.id());
    }
}
```

Masalah saat shutdown:

```text
job sedang loop 10.000 item
shutdown dimulai
DB pool mulai closing
HTTP client closing
job masih berjalan
sebagian item sudah synced, sebagian belum
tidak jelas checkpoint
```

### 12.1 Scheduled task harus shutdown-aware

```java
@Component
public class ExternalStatusSyncJob {

    private final ShutdownAdmissionController admission;
    private final SyncService syncService;

    public ExternalStatusSyncJob(
            ShutdownAdmissionController admission,
            SyncService syncService
    ) {
        this.admission = admission;
        this.syncService = syncService;
    }

    @Scheduled(fixedDelayString = "${jobs.external-sync.delay:60000}")
    public void run() {
        if (!admission.isAcceptingNewWork()) {
            return;
        }

        syncService.syncOneBatch(() -> admission.isAcceptingNewWork());
    }
}
```

Service:

```java
public void syncOneBatch(BooleanSupplier shouldContinue) {
    List<Item> batch = repository.claimPendingBatch(100);

    for (Item item : batch) {
        if (!shouldContinue.getAsBoolean()) {
            repository.releaseClaim(item.id());
            return;
        }

        syncOneItemIdempotently(item);
    }
}
```

### 12.2 Batch size menentukan shutdown safety

Batch besar membuat throughput naik, tetapi shutdown lebih sulit.

```text
batch size 10_000
  -> high throughput
  -> long lock/claim
  -> shutdown drain lama
  -> retry besar jika gagal

batch size 100
  -> lower overhead efficiency
  -> easier checkpoint
  -> safer shutdown
  -> smaller failure window
```

### 12.3 Rule

```text
Scheduled job production-grade harus punya:
- bounded batch,
- checkpoint,
- claim/release,
- idempotency,
- shutdown-aware loop,
- metric progress,
- safe retry.
```

---

## 13. Resource Shutdown Ordering

Resource seperti DB pool, Redis client, HTTP client, dan telemetry exporter biasanya ditutup saat bean destroy.

Masalah terjadi jika worker masih memakai resource ketika resource mulai ditutup.

### 13.1 Bad ordering

```text
shutdown starts
  -> DB pool closes
  -> worker still processing
  -> worker tries repository.save
  -> SQLException / pool closed
  -> partial work
```

### 13.2 Good ordering

```text
shutdown starts
  -> stop new work
  -> stop polling/consuming
  -> drain active work
  -> stop worker/executor
  -> flush telemetry
  -> close DB/Redis/HTTP clients
```

### 13.3 Cara memodelkan dependency

Gunakan phase:

```text
phase 3000: inbound HTTP admission / consumer admission
phase 2000: message listeners / schedulers / pollers
phase 1000: business workers / async executors
phase 0:    resource providers / DB pool / clients
phase -100: telemetry finalization if needed
```

Tetapi jangan asal angka. Yang penting adalah dependency direction:

```text
Component A depends on B during shutdown
=> A must stop before B closes
```

---

## 14. Database Pool Shutdown

Dalam Spring Boot, pool umum seperti HikariCP akan ditutup saat context destroy.

Pertanyaan penting:

```text
Apakah semua transaction sudah selesai sebelum pool ditutup?
Apakah masih ada async task yang akan butuh connection?
Apakah scheduler masih berjalan?
Apakah message listener masih memproses message?
```

### 14.1 Transaction timeout harus lebih kecil dari shutdown budget

Contoh buruk:

```text
transaction timeout:                 120s
spring shutdown phase timeout:        30s
kubernetes termination grace period:  45s
```

Jika transaction menggantung, shutdown tidak mungkin graceful.

### 14.2 Practical guideline

```text
max transaction duration < request timeout < shutdown drain budget < container termination budget
```

Tidak selalu literal, tetapi sebagai arah desain.

### 14.3 Avoid transaction during destroy callback

Anti-pattern:

```java
@PreDestroy
@Transactional
public void flushSomething() {
    repository.save(...);
}
```

Kenapa berbahaya?

- Transaction infrastructure mungkin sedang dalam proses destroy.
- DB pool mungkin tidak lagi stabil.
- Shutdown callback harus bounded dan predictable.
- Side effect baru saat shutdown membuat state makin sulit dianalisis.

Lebih baik flush secara periodik saat running, bukan menunggu shutdown.

---

## 15. HTTP Client Shutdown

External HTTP client bisa berupa:

- `RestClient`
- `WebClient`
- Apache HttpClient
- OkHttp
- Reactor Netty client
- SDK client cloud provider

Masalah:

```text
worker sedang call external API
shutdown starts
HTTP client closes connection pool
call fails mid-flight
retry logic may or may not run
external side effect may already happened
```

### 15.1 Rule

External side-effect call saat shutdown harus punya:

- timeout pendek dan jelas;
- idempotency key jika mutating;
- retry hanya jika safe;
- clear outcome state;
- compensation/reconciliation kalau result unknown;
- no new external call after draining starts kecuali recovery-critical.

### 15.2 Jangan mulai external side effect baru saat draining

```java
public void notifyExternalSystem(Command command) {
    if (!admission.isAcceptingNewWork()) {
        throw new ServiceDrainingException("Refusing new external side effect during shutdown");
    }

    externalClient.notify(command);
}
```

Tetapi jika task sudah berjalan, keputusan bisa berbeda:

```text
already started external side effect
  -> complete if short and safe
  -> record unknown outcome if interrupted
  -> reconcile later
```

---

## 16. Message Listener Shutdown di Spring Boot

Message listeners punya lifecycle sendiri. Contoh:

- RabbitMQ listener container
- Kafka listener container
- JMS listener
- Spring Integration flow
- custom polling consumer

Walau detail tiap broker berbeda, mental model sama:

```text
Stop receiving new messages
Finish current message if safe
Ack only after durable success
Nack/requeue if not complete
Commit offset only after processing safe
Close consumer
```

### 16.1 Shutdown error paling umum

```text
Message received
  -> processing starts
  -> DB write success
  -> external call pending
  -> shutdown starts
  -> listener container stops
  -> ack behavior unclear
  -> duplicate or lost side effect
```

### 16.2 Design rule

```text
Ack/offset commit is reliability boundary.
Never ack before durable completion of the business effect that the message represents.
```

Kalau tidak bisa menjamin, gunakan:

- idempotency key;
- inbox table;
- outbox table;
- deduplication table;
- retry/DLQ;
- reconciliation job.

---

## 17. Spring Boot Actuator Shutdown Endpoint

Spring Boot pernah memiliki actuator shutdown endpoint yang bisa diaktifkan, tetapi untuk production biasanya harus sangat hati-hati.

Konsep penting:

```text
Shutdown trigger bukan hanya SIGTERM.
ApplicationContext bisa ditutup dari kode, actuator, test, IDE, System.exit, atau platform.
```

Untuk production:

- Jangan expose shutdown endpoint publik.
- Kalau diaktifkan, wajib protected secara ketat.
- Prefer platform-native termination: Kubernetes deployment rollout, systemd, ECS, etc.
- Treat shutdown as privileged operation.

---

## 18. `@PreDestroy`, `DisposableBean`, dan Destroy Method

Spring mendukung destroy callback:

```java
@PreDestroy
public void close() {
    // cleanup
}
```

atau:

```java
public class MyResource implements DisposableBean {
    @Override
    public void destroy() {
        // cleanup
    }
}
```

atau:

```java
@Bean(destroyMethod = "shutdown")
public SomeClient someClient() {
    return new SomeClient();
}
```

### 18.1 Kapan cocok?

Cocok untuk:

- close resource lokal;
- flush small buffer;
- unregister local hook;
- stop metrics exporter;
- close client.

Tidak cocok untuk:

- long-running business recovery;
- memulai transaksi besar;
- network call yang tidak bounded;
- batch finalization besar;
- logic yang harus punya ordering rumit.

### 18.2 Prinsip

```text
Destroy callback harus cepat, bounded, idempotent, dan tidak bergantung pada resource yang mungkin sudah ditutup.
```

---

## 19. Graceful Shutdown dan Virtual Threads

Spring Boot modern dapat memakai virtual threads untuk beberapa workload. Virtual threads membantu scalability blocking I/O, tetapi tidak otomatis menyelesaikan shutdown semantics.

Masalah tetap sama:

```text
Apakah work sudah durable?
Apakah task boleh dibatalkan?
Apakah deadline dipatuhi?
Apakah resource masih tersedia?
Apakah interruption ditangani?
```

### 19.1 Virtual thread bukan durability mechanism

```java
Executors.newVirtualThreadPerTaskExecutor()
```

Executor ini bisa menjalankan banyak task, tetapi jika proses mati, task hilang.

Jadi rule tetap:

```text
Virtual thread improves concurrency structure.
It does not replace idempotency, checkpointing, queue durability, or shutdown design.
```

### 19.2 Interruption handling tetap penting

```java
try {
    blockingCall();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new ServiceShuttingDownException("Interrupted during shutdown", e);
}
```

Jangan swallow interrupt.

---

## 20. Designing a Shutdown Coordinator

Untuk sistem kompleks, lebih baik punya komponen eksplisit:

```text
ShutdownCoordinator
├── admission control
├── readiness state
├── in-flight tracker
├── drain deadline
├── worker stop signal
└── shutdown metrics
```

### 20.1 In-flight tracker

```java
@Component
public class InFlightWorkTracker {

    private final AtomicInteger inFlight = new AtomicInteger();

    public WorkHandle start(String workType) {
        inFlight.incrementAndGet();
        return () -> inFlight.decrementAndGet();
    }

    public int currentInFlight() {
        return inFlight.get();
    }

    public boolean awaitZero(Duration timeout) throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (inFlight.get() > 0 && System.nanoTime() < deadline) {
            Thread.sleep(100);
        }
        return inFlight.get() == 0;
    }

    @FunctionalInterface
    public interface WorkHandle extends AutoCloseable {
        @Override
        void close();
    }
}
```

Usage:

```java
public void handle(Command command) {
    try (InFlightWorkTracker.WorkHandle ignored = tracker.start("command")) {
        commandHandler.handle(command);
    }
}
```

### 20.2 Shutdown lifecycle using tracker

```java
@Component
public class BusinessDrainLifecycle implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(BusinessDrainLifecycle.class);

    private final ShutdownAdmissionController admission;
    private final InFlightWorkTracker tracker;
    private volatile boolean running;

    public BusinessDrainLifecycle(
            ShutdownAdmissionController admission,
            InFlightWorkTracker tracker
    ) {
        this.admission = admission;
        this.tracker = tracker;
    }

    @Override
    public void start() {
        this.running = true;
    }

    @Override
    public void stop(Runnable callback) {
        try {
            admission.stop(() -> { });
            boolean drained = tracker.awaitZero(Duration.ofSeconds(20));
            if (!drained) {
                log.warn("Shutdown drain timed out: inFlight={}", tracker.currentInFlight());
            } else {
                log.info("Shutdown drain completed");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("Shutdown drain interrupted: inFlight={}", tracker.currentInFlight(), e);
        } finally {
            running = false;
            callback.run();
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return 2000;
    }
}
```

Catatan:

Contoh ini memberi mental model. Dalam production, jangan memanggil `admission.stop(() -> {})` manual jika admission juga dikelola Spring dengan lifecycle sendiri. Lebih baik buat method eksplisit seperti `admission.refuseNewWork()`.

---

## 21. Better Shutdown Coordinator Design

Versi lebih bersih:

```java
@Component
public class ShutdownState {

    private final AtomicBoolean draining = new AtomicBoolean(false);

    public void beginDraining() {
        draining.set(true);
    }

    public boolean isDraining() {
        return draining.get();
    }

    public boolean acceptsNewWork() {
        return !draining.get();
    }
}
```

Lifecycle:

```java
@Component
public class ShutdownStateLifecycle implements SmartLifecycle {

    private final ShutdownState shutdownState;
    private volatile boolean running;

    public ShutdownStateLifecycle(ShutdownState shutdownState) {
        this.shutdownState = shutdownState;
    }

    @Override
    public void start() {
        running = true;
    }

    @Override
    public void stop(Runnable callback) {
        try {
            shutdownState.beginDraining();
        } finally {
            running = false;
            callback.run();
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return Integer.MAX_VALUE;
    }
}
```

In-flight tracker lifecycle:

```java
@Component
public class InFlightDrainLifecycle implements SmartLifecycle {

    private final InFlightWorkTracker tracker;
    private volatile boolean running;

    public InFlightDrainLifecycle(InFlightWorkTracker tracker) {
        this.tracker = tracker;
    }

    @Override
    public void start() {
        running = true;
    }

    @Override
    public void stop(Runnable callback) {
        try {
            boolean drained = tracker.awaitZero(Duration.ofSeconds(20));
            if (!drained) {
                // emit metric + warning
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            running = false;
            callback.run();
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return 1000;
    }
}
```

Ordering:

```text
Shutdown:
phase MAX_VALUE -> mark draining / reject new work
phase 1000      -> wait for in-flight work
phase lower     -> close resources
```

---

## 22. Shutdown Logging: Apa yang Harus Dicatat?

Shutdown tanpa log yang jelas sulit dianalisis.

Minimal log:

```text
shutdown_received
readiness_refusing_traffic
admission_closed
web_server_graceful_shutdown_started
inflight_drain_started count=N timeout=20s
inflight_drain_completed duration=X
inflight_drain_timeout remaining=N
executors_shutdown_started
executors_shutdown_completed
resources_closing
application_exit
```

### 22.1 Contoh structured log

```java
log.info("shutdown.drain.started inFlight={} timeoutMs={}", inFlight, timeout.toMillis());
log.warn("shutdown.drain.timeout remaining={} timeoutMs={}", remaining, timeout.toMillis());
log.info("shutdown.drain.completed durationMs={}", duration.toMillis());
```

### 22.2 Jangan log terlalu akhir

Jika logger backend/exporter sudah ditutup, log akhir bisa hilang.

Karena itu log milestone penting sebelum resource observability ditutup.

---

## 23. Metrics untuk Graceful Shutdown

Metric yang berguna:

| Metric | Type | Tujuan |
|---|---|---|
| `app_shutdown_started_total` | counter | berapa kali shutdown dimulai |
| `app_shutdown_duration_seconds` | timer | durasi shutdown |
| `app_shutdown_inflight_work` | gauge | jumlah work aktif saat drain |
| `app_shutdown_drain_timeout_total` | counter | drain timeout |
| `app_shutdown_rejected_requests_total` | counter | request ditolak saat draining |
| `app_shutdown_executor_queue_size` | gauge | backlog executor saat shutdown |
| `app_shutdown_forced_exit_total` | counter | indikasi forced termination jika bisa dideteksi |

### 23.1 Kenapa metric shutdown penting?

Karena tanpa metric, kamu tidak tahu apakah rolling deployment sebenarnya clean.

Contoh insight:

```text
Setiap deployment ada 20 request 503 SERVICE_DRAINING
  -> normal jika client retry safe
  -> buruk jika user-facing mutation gagal tanpa retry

Drain timeout terjadi 30% pod termination
  -> shutdown budget terlalu kecil
  -> task terlalu panjang
  -> admission terlambat
  -> LB drain tidak selaras
```

---

## 24. Configuration Blueprint

Contoh baseline `application.yml`:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s

management:
  endpoint:
    health:
      probes:
        enabled: true
  health:
    livenessstate:
      enabled: true
    readinessstate:
      enabled: true
```

Catatan:

- Jangan copy angka `30s` tanpa memahami workload.
- Selaraskan dengan Kubernetes `terminationGracePeriodSeconds`.
- Selaraskan dengan gateway/client timeout.
- Selaraskan dengan executor await termination.

### 24.1 Executor config example

```yaml
app:
  shutdown:
    drain-timeout: 20s
  executor:
    business:
      core-size: 8
      max-size: 16
      queue-capacity: 500
      await-termination: 25s
```

---

## 25. Kubernetes Alignment Preview

Detail Kubernetes akan dibahas lebih dalam di part berikutnya, tetapi Spring Boot config tidak boleh dipisah dari platform config.

Contoh:

```yaml
terminationGracePeriodSeconds: 60

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  failureThreshold: 1

livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 10
  failureThreshold: 3
```

Mental budget:

```text
terminationGracePeriodSeconds = 60s
  - endpoint/load balancer propagation buffer = 10s
  - application drain budget              = 30s
  - resource close / telemetry flush       = 10s
  - safety margin                          = 10s
```

Jika `spring.lifecycle.timeout-per-shutdown-phase=60s` tetapi Kubernetes hanya 60s total, itu terlalu agresif karena tidak menyisakan margin.

---

## 26. Common Anti-Patterns

### 26.1 Hanya set `server.shutdown=graceful`

Masalah:

- async task tidak aman;
- scheduler tidak aware;
- message consumer tidak jelas;
- resource ordering tidak dikontrol;
- platform budget tidak selaras.

### 26.2 Shutdown callback melakukan pekerjaan besar

```java
@PreDestroy
public void finalSync() {
    syncAllPendingRecords();
}
```

Buruk karena:

- tidak bounded;
- rentan gagal;
- resource mungkin sudah closing;
- membuat shutdown tidak predictable.

### 26.3 Menelan `InterruptedException`

```java
catch (InterruptedException e) {
    log.warn("Interrupted");
}
```

Harus restore interrupt:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new ServiceShuttingDownException("Interrupted", e);
}
```

### 26.4 Queue executor terlalu besar

Queue besar menyembunyikan overload saat runtime dan memperburuk drain saat shutdown.

### 26.5 Liveness dibuat DOWN saat shutdown normal

Ini mencampur konsep “app broken” dan “app draining”.

### 26.6 Fallback palsu saat shutdown

```java
catch (Exception e) {
    return SuccessResponse.ok();
}
```

Saat shutdown, ini bisa membuat client percaya operasi berhasil padahal dibatalkan.

### 26.7 Memulai task baru dari destroy callback

Destroy callback seharusnya cleanup, bukan generate business work baru.

### 26.8 Tidak mengetes dengan SIGTERM asli

IDE stop button bisa berbeda dari `SIGTERM` di container.

Test harus mendekati production termination path.

---

## 27. Failure Scenario Walkthrough

### Scenario A — Long HTTP request saat rolling deploy

```text
T0  client sends POST /generate-report
T1  report generation starts, expected 45s
T5  Kubernetes starts pod termination
T6  Spring graceful shutdown starts
T6  web server stops accepting new request
T35 lifecycle timeout reached
T45 report would have completed
```

Jika timeout 30s:

```text
request likely interrupted / connection closed / response failed
```

Better design:

```text
POST /reports
  -> persist job
  -> return 202 + jobId
worker processes job asynchronously with checkpoint/idempotency
```

### Scenario B — `@Async` email send after response

```text
POST /approve
  -> DB status APPROVED
  -> @Async send notification
  -> response 200
  -> shutdown before async executes
```

Bug:

```text
approval succeeded but email missing
```

Better:

```text
transaction:
  -> status APPROVED
  -> outbox EMAIL_APPROVAL_NOTIFICATION_REQUIRED
worker:
  -> send email idempotently
  -> mark outbox sent
```

### Scenario C — Scheduler mid-batch

```text
job claims 1000 records
processed 350
shutdown starts
job killed
650 records remain claimed forever
```

Better:

```text
claim lease with expiry
small batch
checkpoint per item
release claim on shutdown if safe
reconciliation for expired claims
```

### Scenario D — Message listener ack too early

```text
receive message
ack message
process DB write
shutdown interrupts before DB write
```

Data loss.

Better:

```text
receive message
process idempotently
commit durable state
ack after success
```

---

## 28. Production Checklist

### 28.1 Spring configuration

- [ ] `server.shutdown=graceful` enabled.
- [ ] `spring.lifecycle.timeout-per-shutdown-phase` set based on workload.
- [ ] Actuator readiness/liveness enabled if running in Kubernetes.
- [ ] Shutdown timeout aligned with container grace period.
- [ ] Shutdown tested outside IDE.

### 28.2 Lifecycle design

- [ ] Critical components implement `SmartLifecycle` where ordering matters.
- [ ] Higher phase components stop first during shutdown.
- [ ] `stop(Runnable callback)` always invokes callback.
- [ ] Shutdown logic is bounded.
- [ ] No long business transaction in destroy callback.

### 28.3 Admission control

- [ ] App can mark itself draining.
- [ ] New mutating work is rejected during draining.
- [ ] 503 includes retry-safe semantics where appropriate.
- [ ] Health endpoints remain understandable.
- [ ] Liveness is not abused for normal shutdown.

### 28.4 Executors and async

- [ ] Executor queue is bounded.
- [ ] Await termination configured.
- [ ] RejectedExecutionException handled meaningfully.
- [ ] Critical async work is durable before response.
- [ ] No critical work depends only on in-memory queue.

### 28.5 Scheduler and workers

- [ ] Scheduled jobs check shutdown state.
- [ ] Batch size is bounded.
- [ ] Work has checkpoint/claim/lease.
- [ ] Worker can stop between units.
- [ ] Incomplete work can be retried safely.

### 28.6 Resources

- [ ] DB pool closes after workers stop.
- [ ] HTTP clients close after active calls complete or timeout.
- [ ] Telemetry flush happens before process exit.
- [ ] No new external side effect starts during draining.

### 28.7 Observability

- [ ] Shutdown start logged.
- [ ] Readiness/admission transition logged.
- [ ] In-flight count logged.
- [ ] Drain timeout logged.
- [ ] Metrics exist for rejected work and drain duration.

### 28.8 Testing

- [ ] SIGTERM test exists.
- [ ] Long request shutdown test exists.
- [ ] Async task shutdown test exists.
- [ ] Scheduler mid-batch shutdown test exists.
- [ ] Message listener mid-processing shutdown test exists.
- [ ] Kubernetes rolling update behavior observed.

---

## 29. Reference Implementation Sketch

Struktur package:

```text
com.example.reliability.shutdown
├── ShutdownState.java
├── ShutdownStateLifecycle.java
├── InFlightWorkTracker.java
├── InFlightDrainLifecycle.java
├── DrainingRequestFilter.java
├── ShutdownMetrics.java
└── ServiceDrainingException.java
```

### 29.1 ShutdownState

```java
package com.example.reliability.shutdown;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public final class ShutdownState {

    private final AtomicBoolean draining = new AtomicBoolean(false);
    private final AtomicReference<Instant> drainingSince = new AtomicReference<>();

    public boolean beginDraining() {
        boolean changed = draining.compareAndSet(false, true);
        if (changed) {
            drainingSince.set(Instant.now());
        }
        return changed;
    }

    public boolean isDraining() {
        return draining.get();
    }

    public boolean acceptsNewWork() {
        return !draining.get();
    }

    public Instant drainingSince() {
        return drainingSince.get();
    }
}
```

### 29.2 Lifecycle marker

```java
@Component
public final class ShutdownStateLifecycle implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(ShutdownStateLifecycle.class);

    private final ShutdownState shutdownState;
    private volatile boolean running;

    public ShutdownStateLifecycle(ShutdownState shutdownState) {
        this.shutdownState = shutdownState;
    }

    @Override
    public void start() {
        running = true;
        log.info("shutdown.state.running");
    }

    @Override
    public void stop(Runnable callback) {
        try {
            boolean changed = shutdownState.beginDraining();
            log.info("shutdown.state.draining changed={}", changed);
        } finally {
            running = false;
            callback.run();
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public boolean isAutoStartup() {
        return true;
    }

    @Override
    public int getPhase() {
        return Integer.MAX_VALUE;
    }
}
```

### 29.3 In-flight tracker

```java
@Component
public final class InFlightWorkTracker {

    private final AtomicInteger current = new AtomicInteger();

    public WorkScope enter() {
        current.incrementAndGet();
        return () -> current.decrementAndGet();
    }

    public int current() {
        return current.get();
    }

    public boolean awaitZero(Duration timeout) throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (current.get() > 0) {
            if (System.nanoTime() >= deadline) {
                return false;
            }
            Thread.sleep(100);
        }
        return true;
    }

    @FunctionalInterface
    public interface WorkScope extends AutoCloseable {
        @Override
        void close();
    }
}
```

### 29.4 Drain lifecycle

```java
@Component
public final class InFlightDrainLifecycle implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(InFlightDrainLifecycle.class);

    private final InFlightWorkTracker tracker;
    private volatile boolean running;

    public InFlightDrainLifecycle(InFlightWorkTracker tracker) {
        this.tracker = tracker;
    }

    @Override
    public void start() {
        running = true;
    }

    @Override
    public void stop(Runnable callback) {
        Instant started = Instant.now();
        int initial = tracker.current();
        log.info("shutdown.inflight.drain.started count={}", initial);

        try {
            boolean drained = tracker.awaitZero(Duration.ofSeconds(20));
            Duration duration = Duration.between(started, Instant.now());

            if (drained) {
                log.info("shutdown.inflight.drain.completed durationMs={}", duration.toMillis());
            } else {
                log.warn(
                        "shutdown.inflight.drain.timeout remaining={} durationMs={}",
                        tracker.current(),
                        duration.toMillis()
                );
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("shutdown.inflight.drain.interrupted remaining={}", tracker.current(), e);
        } finally {
            running = false;
            callback.run();
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return 1000;
    }
}
```

### 29.5 Filter

```java
@Component
public final class DrainingRequestFilter extends OncePerRequestFilter {

    private final ShutdownState shutdownState;
    private final InFlightWorkTracker tracker;

    public DrainingRequestFilter(
            ShutdownState shutdownState,
            InFlightWorkTracker tracker
    ) {
        this.shutdownState = shutdownState;
        this.tracker = tracker;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        if (shutdownState.isDraining() && isBusinessMutatingRequest(request)) {
            response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
            response.setHeader(HttpHeaders.RETRY_AFTER, "5");
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("""
                    {"code":"SERVICE_DRAINING","message":"Service is temporarily draining"}
                    """);
            return;
        }

        try (InFlightWorkTracker.WorkScope ignored = tracker.enter()) {
            filterChain.doFilter(request, response);
        }
    }

    private boolean isBusinessMutatingRequest(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (path.startsWith("/actuator/")) {
            return false;
        }

        return switch (request.getMethod()) {
            case "POST", "PUT", "PATCH", "DELETE" -> true;
            default -> false;
        };
    }
}
```

Production note:

- Filter-level in-flight tracking counts the request lifecycle, not async work after request returns.
- For async work, track separately at worker boundary.

---

## 30. How to Test Spring Boot Graceful Shutdown

### 30.1 Manual local test

Run jar:

```bash
java -jar app.jar
```

Trigger long request:

```bash
curl -X POST http://localhost:8080/test/long-running
```

Send SIGTERM:

```bash
kill -TERM <pid>
```

Observe:

- Does app log shutdown start?
- Does request finish?
- Are new mutating requests rejected?
- Does process exit before timeout?
- Are resources closed cleanly?

### 30.2 Avoid relying on IDE stop button

IDE stop may not mirror production signal behavior. Always test with actual signal/container termination.

### 30.3 Container test

```bash
docker run --name app -p 8080:8080 my-app:latest
```

Then:

```bash
docker stop --time 60 app
```

`docker stop` sends SIGTERM then waits before SIGKILL.

### 30.4 Kubernetes test

```bash
kubectl rollout restart deployment/my-app
kubectl logs -f deployment/my-app
```

Observe:

- readiness transition;
- traffic errors during rollout;
- pod termination duration;
- 5xx spike;
- in-flight completion;
- forced kill events.

---

## 31. Senior Engineer Heuristics

### 31.1 Graceful shutdown is admission + drain + bounded exit

If one is missing, shutdown is incomplete.

```text
admission: stop new work

drain: finish/requeue/checkpoint active work

bounded exit: do not wait forever
```

### 31.2 Every work source must be named

Make a list:

```text
HTTP controllers
@Async methods
@Scheduled jobs
Kafka listeners
RabbitMQ listeners
batch runners
startup runners
cache warmers
outbox pollers
websocket sessions
SSE streams
file watchers
```

Each must have shutdown behavior.

### 31.3 In-memory work is disposable unless made durable

If work exists only in memory, shutdown/crash can remove it.

### 31.4 Rejecting work can be more reliable than accepting it

During shutdown, accepting a command you cannot finish is worse than returning 503 with retry semantics.

### 31.5 Shutdown should not create new uncertainty

Do not start new side effects during shutdown unless they are explicitly part of safe recovery and bounded.

### 31.6 Test the boring path

Most teams test startup and happy path. Senior teams test termination, drain, retry, partial failure, and recovery.

---

## 32. Mini Review Questions

1. Apa perbedaan graceful shutdown web server dan graceful shutdown seluruh aplikasi?
2. Kenapa `server.shutdown=graceful` tidak cukup untuk `@Async` work?
3. Apa arti `spring.lifecycle.timeout-per-shutdown-phase`?
4. Dalam `SmartLifecycle`, phase mana yang stop lebih dulu saat shutdown: phase rendah atau tinggi?
5. Kenapa `stop(Runnable callback)` wajib memanggil callback?
6. Kenapa liveness tidak boleh dibuat DOWN untuk shutdown normal?
7. Apa risiko queue executor yang terlalu besar saat shutdown?
8. Kenapa critical async work harus dibuat durable sebelum response dikirim?
9. Apa yang harus terjadi pada scheduled job saat shutdown dimulai?
10. Kenapa destroy callback tidak cocok untuk long-running business recovery?
11. Apa hubungan transaction timeout, request timeout, shutdown timeout, dan Kubernetes grace period?
12. Bagaimana cara tahu rolling deploy benar-benar graceful?

---

## 33. Key Takeaways

1. Spring Boot graceful shutdown adalah fondasi penting, tetapi bukan solusi lengkap.
2. `server.shutdown=graceful` terutama membantu web server berhenti menerima request baru dan menunggu request aktif.
3. Application-level work seperti `@Async`, scheduler, queue consumer, dan worker butuh shutdown strategy sendiri.
4. `SmartLifecycle` adalah alat utama untuk lifecycle ordering yang eksplisit.
5. Pada shutdown, phase lebih tinggi berhenti lebih dulu.
6. `stop(Runnable callback)` harus selalu memanggil callback agar shutdown tidak menunggu timeout.
7. Readiness/admission harus turun saat draining; liveness tidak boleh dipakai untuk shutdown normal.
8. Critical work tidak boleh hanya hidup di in-memory executor queue.
9. Shutdown harus bounded; menunggu selamanya adalah bug reliability.
10. Graceful shutdown harus diuji dengan signal/container/platform yang mirip production.

---

## 34. Referensi

- Spring Boot Reference Documentation — Graceful Shutdown: `server.shutdown=graceful` dan `spring.lifecycle.timeout-per-shutdown-phase`.
- Spring Framework Javadoc — `SmartLifecycle`, `Lifecycle`, `Phased`.
- Spring Framework Reference — bean lifecycle, destroy callbacks, lifecycle management.
- Spring Framework Reference — task execution and scheduling; `ThreadPoolTaskExecutor` supports lifecycle-based graceful shutdown behavior.
- Spring Boot Actuator / Availability — readiness and liveness state model.
- Kubernetes Documentation — pod termination, readiness probes, lifecycle hooks, and termination grace period.

---

## 35. Penutup Part 010

Part ini membawa graceful shutdown dari level JVM ke level Spring Boot application runtime.

Mental model utamanya:

```text
Spring Boot graceful shutdown is necessary but not sufficient.
A reliable application must coordinate:
- web server shutdown,
- admission control,
- lifecycle phase ordering,
- executor drain,
- scheduler stop,
- message consumer stop,
- resource close ordering,
- readiness/liveness semantics,
- platform termination budget,
- and observability.
```

Kita belum selesai.

Part berikutnya:

```text
Part 011 — Kubernetes, Containers, and Shutdown Reality
```

Di sana kita akan membahas realitas container orchestration: `SIGTERM`, `preStop`, `terminationGracePeriodSeconds`, readiness propagation, service endpoint removal, ingress/load balancer delay, rolling update, sidecar, dan kenapa aplikasi yang graceful di lokal masih bisa gagal di Kubernetes.

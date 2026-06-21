# Part 20 — Async, Scheduling, Events, and Execution Model

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `20-async-scheduling-events-execution-model.md`  
> Status: Part 20 dari 35 — belum selesai  
> Target pembaca: engineer yang sudah memahami Java concurrency, Spring container, AOP/proxy, transaction, Web MVC/WebFlux, error handling, observability, dan production failure model.

---

## 0. Tujuan Part Ini

Part ini membahas **execution model non-request** di aplikasi Spring:

1. eksekusi asynchronous dengan `@Async`, `TaskExecutor`, dan executor configuration;
2. job periodik dengan `@Scheduled`, `TaskScheduler`, cron, fixed rate, fixed delay;
3. event internal dengan `ApplicationEventPublisher`, `@EventListener`, dan `@TransactionalEventListener`;
4. interaksi async/event/schedule dengan transaction, security context, MDC, observability, retry, shutdown, dan cluster deployment;
5. bagaimana membedakan **in-process async/event** dari **durable messaging/workflow**;
6. bagaimana mendesain failure semantics yang jelas agar background execution tidak menjadi sumber bug diam-diam.

Fokus part ini bukan mengulang Java concurrency dasar. Kita akan melihat bagaimana Spring memberi abstraction di atas concurrency primitive dan bagaimana abstraction tersebut bisa salah dipakai di sistem produksi.

---

## 1. Peta Mental: Request Thread Bukan Satu-satunya Jalur Eksekusi

Dalam aplikasi Spring biasa, engineer sering mulai dari mental model ini:

```text
HTTP request
  -> controller
  -> service
  -> repository
  -> database
  -> response
```

Itu hanya satu jalur. Aplikasi enterprise biasanya punya banyak jalur eksekusi lain:

```text
1. HTTP request thread
2. Async task thread
3. Scheduled job thread
4. Event listener thread
5. Message listener thread
6. Batch worker thread
7. WebClient/reactive event loop
8. Shutdown hook / lifecycle thread
9. Startup runner thread
10. Virtual thread, jika diaktifkan
```

Setiap jalur punya pertanyaan penting:

```text
Siapa yang menjalankan kode ini?
Thread apa?
Context apa yang ikut terbawa?
Transaction aktif atau tidak?
Security context tersedia atau tidak?
MDC/log correlation tersedia atau tidak?
Jika gagal, siapa yang tahu?
Jika aplikasi shutdown, apakah task dibiarkan selesai?
Jika aplikasi ada 4 replica, apakah job berjalan 4 kali?
Jika task hilang saat crash, apakah acceptable?
```

Itulah inti dari part ini.

---

## 2. Abstraction Utama Spring

Spring menyediakan beberapa abstraction untuk execution model:

| Area | Abstraction | Fungsi |
|---|---|---|
| Async execution | `TaskExecutor`, `AsyncTaskExecutor`, `@Async` | menjalankan method di thread lain |
| Scheduling | `TaskScheduler`, `@Scheduled` | menjalankan task berdasarkan waktu |
| Events | `ApplicationEventPublisher`, `@EventListener` | komunikasi in-process antar component |
| Transaction-bound event | `@TransactionalEventListener` | listener dijalankan berdasarkan fase transaction |
| Lifecycle | `SmartLifecycle`, shutdown phase | mengatur start/stop resource dan executor |
| Context propagation | `TaskDecorator`, delegating wrappers | membawa MDC/security/context ke thread lain |

Secara arsitektural, semuanya adalah variasi dari satu pertanyaan:

```text
Bagaimana memindahkan eksekusi dari satu waktu/tempat ke waktu/tempat lain dengan contract yang jelas?
```

---

## 3. Async Execution: Apa Arti `@Async` Secara Mekanis?

`@Async` membuat method dieksekusi melalui executor, bukan langsung di thread pemanggil.

Contoh sederhana:

```java
@Service
public class EmailNotificationService {

    @Async("notificationExecutor")
    public CompletableFuture<Void> sendEmailAsync(NotificationCommand command) {
        // send email
        return CompletableFuture.completedFuture(null);
    }
}
```

Saat caller memanggil:

```java
emailNotificationService.sendEmailAsync(command);
```

Spring tidak langsung mengeksekusi method target di caller thread. Jika method dipanggil melalui proxy Spring, flow-nya kira-kira:

```text
caller
  -> proxy
  -> AsyncExecutionInterceptor
  -> submit task ke Executor
  -> caller menerima Future/void
  -> worker thread menjalankan target method
```

Poin penting:

```text
@Async adalah proxy-based.
```

Artinya semua aturan AOP proxy berlaku:

1. self-invocation tidak bekerja;
2. method harus dipanggil lewat bean proxy;
3. final/private method tidak bisa diintercept dengan cara biasa;
4. order dengan annotation lain seperti `@Transactional` harus dipahami;
5. return type mempengaruhi error handling.

---

## 4. Mengaktifkan Async

`@Async` aktif jika async processing di-enable.

```java
@Configuration
@EnableAsync
public class AsyncConfiguration {
}
```

Di Spring Boot, executor bisa dikonfigurasi otomatis. Jika tidak ada `Executor` bean tertentu, Boot dapat menyediakan executor default untuk task execution. Pada generasi modern, konfigurasi Boot juga mempertimbangkan virtual threads ketika `spring.threads.virtual.enabled=true` di Java 21+.

Contoh eksplisit:

```java
@Configuration
@EnableAsync
public class AsyncConfiguration {

    @Bean(name = "notificationExecutor")
    public ThreadPoolTaskExecutor notificationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setThreadNamePrefix("notification-");
        executor.setCorePoolSize(8);
        executor.setMaxPoolSize(32);
        executor.setQueueCapacity(500);
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}
```

Konfigurasi ini lebih baik daripada membiarkan semua async task berbagi executor default tanpa ownership.

---

## 5. `TaskExecutor` vs Java `Executor`

Spring `TaskExecutor` adalah abstraction di atas executor.

```java
public interface TaskExecutor extends Executor {
    @Override
    void execute(Runnable task);
}
```

Kenapa Spring punya abstraction sendiri?

Karena Spring ingin mengintegrasikan executor dengan:

1. lifecycle container;
2. configuration properties;
3. task decoration;
4. scheduling;
5. exception handling;
6. observability;
7. graceful shutdown;
8. environment profile;
9. Boot auto-configuration.

Secara praktis, di aplikasi modern Spring, gunakan bean executor yang jelas:

```java
@Bean
public ThreadPoolTaskExecutor caseWorkflowExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setThreadNamePrefix("case-workflow-");
    executor.setCorePoolSize(10);
    executor.setMaxPoolSize(20);
    executor.setQueueCapacity(1000);
    executor.initialize();
    return executor;
}
```

---

## 6. Return Type `@Async`

Method `@Async` biasanya menggunakan return type:

```text
void
Future<T>
CompletableFuture<T>
ListenableFuture<T> legacy
```

Contoh:

```java
@Async("reportExecutor")
public CompletableFuture<ReportSummary> generateReport(ReportCommand command) {
    ReportSummary summary = reportGenerator.generate(command);
    return CompletableFuture.completedFuture(summary);
}
```

### 6.1 `void` Async Method

```java
@Async
public void sendAuditTrail(AuditCommand command) {
    auditClient.send(command);
}
```

Masalah utama `void`:

```text
Caller tidak bisa tahu apakah task berhasil atau gagal.
```

Exception dari `void @Async` tidak kembali ke caller. Exception biasanya ditangani oleh `AsyncUncaughtExceptionHandler`.

```java
@Configuration
@EnableAsync
public class AsyncConfiguration implements AsyncConfigurer {

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (ex, method, params) -> {
            // log structured error, metric, alert if needed
        };
    }
}
```

`void @Async` cocok untuk side effect best-effort yang kegagalannya tidak harus mempengaruhi caller, misalnya low-criticality telemetry. Untuk business-critical task, `void @Async` sering terlalu lemah.

### 6.2 `CompletableFuture<T>`

Lebih eksplisit:

```java
@Async("enrichmentExecutor")
public CompletableFuture<CustomerRisk> calculateRisk(CustomerId id) {
    try {
        return CompletableFuture.completedFuture(riskService.calculate(id));
    } catch (Exception ex) {
        return CompletableFuture.failedFuture(ex);
    }
}
```

Caller bisa compose:

```java
CompletableFuture<CustomerRisk> riskFuture = riskService.calculateRisk(id);
CompletableFuture<AddressScore> addressFuture = addressService.scoreAddress(id);

return riskFuture.thenCombine(addressFuture, DecisionInput::new);
```

Tetapi hati-hati: composition `CompletableFuture` bukan otomatis context-aware Spring. MDC/security/transaction tidak otomatis aman kecuali didesain.

---

## 7. Self-Invocation Problem pada `@Async`

Contoh bug klasik:

```java
@Service
public class ReportService {

    public void requestReport(ReportCommand command) {
        generateAsync(command); // self-invocation: @Async tidak aktif
    }

    @Async
    public void generateAsync(ReportCommand command) {
        // berjalan synchronous karena dipanggil dari this.generateAsync(...)
    }
}
```

Karena call internal tidak melewati proxy Spring, interceptor async tidak berjalan.

Solusi yang lebih sehat:

```java
@Service
public class ReportRequestService {

    private final ReportGenerationService generationService;

    public ReportRequestService(ReportGenerationService generationService) {
        this.generationService = generationService;
    }

    public void requestReport(ReportCommand command) {
        generationService.generateAsync(command);
    }
}

@Service
public class ReportGenerationService {

    @Async("reportExecutor")
    public void generateAsync(ReportCommand command) {
        // async works: call crosses bean proxy
    }
}
```

Mental model:

```text
Jika annotation Spring bergantung pada proxy, boundary method harus berada di bean lain atau dipanggil melalui proxy.
```

---

## 8. `@Async` dan `@Transactional`

Kombinasi ini sering disalahpahami.

Contoh:

```java
@Service
public class CaseService {

    @Transactional
    public void submitCase(SubmitCaseCommand command) {
        caseRepository.save(...);
        notificationService.sendSubmittedEmail(command.caseId());
    }
}

@Service
public class NotificationService {

    @Async
    public void sendSubmittedEmail(CaseId caseId) {
        CaseEntity entity = caseRepository.findById(caseId).orElseThrow();
        emailClient.send(...);
    }
}
```

Jika async task berjalan sebelum transaction commit, worker thread bisa:

1. tidak melihat data yang baru disimpan;
2. membaca state lama;
3. gagal karena row belum committed;
4. mengirim email padahal transaction caller akhirnya rollback.

Ini bug serius.

Solusi lebih benar: publish transaction-bound event.

```java
@Service
public class CaseService {

    private final ApplicationEventPublisher events;

    @Transactional
    public void submitCase(SubmitCaseCommand command) {
        CaseEntity entity = caseRepository.save(...);
        events.publishEvent(new CaseSubmittedEvent(entity.getId()));
    }
}
```

Listener:

```java
@Component
public class CaseNotificationListener {

    @Async("notificationExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onCaseSubmitted(CaseSubmittedEvent event) {
        // runs only after commit
        // async thread, new execution context
    }
}
```

Tetapi ada nuance penting:

```text
@Async + @TransactionalEventListener berarti listener berjalan setelah commit, tetapi eksekusi business logic listener terjadi di thread lain.
```

Jika listener butuh database transaction sendiri, tambahkan transaction baru secara eksplisit:

```java
@Async("notificationExecutor")
@Transactional
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onCaseSubmitted(CaseSubmittedEvent event) {
    // own transaction if DB operations are needed
}
```

Namun design ini tetap **in-memory async**. Jika aplikasi crash setelah commit tetapi sebelum listener menjalankan side effect, event bisa hilang. Untuk side effect critical, gunakan outbox/durable messaging.

---

## 9. Executor Sizing: Jangan Menebak Secara Buta

Executor bukan hanya “jumlah thread”. Executor adalah capacity boundary.

Parameter utama:

```text
corePoolSize
maxPoolSize
queueCapacity
keepAliveSeconds
rejectionPolicy
threadNamePrefix
shutdown behavior
TaskDecorator
```

### 9.1 CPU-bound Task

Contoh: hashing berat, report calculation in-memory, compression.

Heuristic awal:

```text
thread count ≈ number of cores atau sedikit lebih
queue bounded
rejection explicit
```

CPU-bound async task dengan pool terlalu besar menyebabkan context switching dan latency naik.

### 9.2 IO-bound Task

Contoh: kirim email, call external API, upload object storage.

Heuristic awal:

```text
thread count bisa lebih besar dari core count
wajib timeout
wajib bounded queue
wajib rate limit/backpressure
```

Tetapi bottleneck biasanya bukan thread saja:

1. connection pool;
2. remote service rate limit;
3. database pool;
4. downstream SLA;
5. memory queue;
6. retry storm.

### 9.3 Virtual Thread

Virtual thread membuat blocking IO lebih murah dari sisi thread, tetapi tidak menghapus bottleneck:

```text
DB connection pool tetap terbatas.
HTTP connection pool tetap terbatas.
Remote API tetap punya rate limit.
Memory tetap terbatas.
Transaction lock tetap nyata.
```

Jadi virtual thread bukan alasan untuk unbounded concurrency.

---

## 10. Queue Capacity dan Rejection Policy

Queue adalah tempat failure sering disembunyikan.

```java
executor.setQueueCapacity(10_000);
```

Angka besar terlihat aman, tetapi bisa berbahaya:

1. latency task menjadi tidak terkontrol;
2. memory naik;
3. caller mengira task diterima padahal akan diproses jauh terlambat;
4. shutdown makin lama;
5. failure menjadi delayed dan sulit ditrace.

Lebih baik explicit:

```java
executor.setCorePoolSize(8);
executor.setMaxPoolSize(16);
executor.setQueueCapacity(200);
executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
```

Pilihan rejection:

| Policy | Efek | Cocok untuk |
|---|---|---|
| AbortPolicy | lempar exception | fail-fast, caller harus tahu |
| CallerRunsPolicy | caller ikut menjalankan task | backpressure sederhana |
| DiscardPolicy | buang diam-diam | hampir selalu berbahaya |
| DiscardOldestPolicy | buang task lama | hanya untuk workload tertentu seperti refresh best-effort |

Untuk sistem enterprise, silent discard hampir selalu salah kecuali task memang telemetry/best-effort dan ada metrik drop.

---

## 11. Context Propagation: MDC, Security, Tenant, Trace

Thread baru tidak otomatis membawa semua context dari caller.

Context yang sering dibutuhkan:

```text
MDC / correlation id
SecurityContext
TenantContext
LocaleContext
RequestContext
Observation/trace context
custom workflow context
```

### 11.1 TaskDecorator

Spring menyediakan `TaskDecorator` untuk membungkus `Runnable` sebelum dijalankan.

Contoh MDC propagation:

```java
public class MdcTaskDecorator implements TaskDecorator {

    @Override
    public Runnable decorate(Runnable runnable) {
        Map<String, String> contextMap = MDC.getCopyOfContextMap();

        return () -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try {
                if (contextMap != null) {
                    MDC.setContextMap(contextMap);
                } else {
                    MDC.clear();
                }
                runnable.run();
            } finally {
                if (previous != null) {
                    MDC.setContextMap(previous);
                } else {
                    MDC.clear();
                }
            }
        };
    }
}
```

Register:

```java
@Bean
public ThreadPoolTaskExecutor notificationExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setThreadNamePrefix("notification-");
    executor.setCorePoolSize(8);
    executor.setMaxPoolSize(16);
    executor.setQueueCapacity(200);
    executor.setTaskDecorator(new MdcTaskDecorator());
    executor.initialize();
    return executor;
}
```

### 11.2 SecurityContext Propagation

Spring Security menyediakan wrapper seperti `DelegatingSecurityContextAsyncTaskExecutor`.

```java
@Bean
public AsyncTaskExecutor securedExecutor(ThreadPoolTaskExecutor delegate) {
    return new DelegatingSecurityContextAsyncTaskExecutor(delegate);
}
```

Tetapi hati-hati:

```text
Membawa user security context ke async task tidak selalu benar.
```

Untuk task background yang berjalan setelah request selesai, lebih baik simpan actor eksplisit:

```java
public record ApproveCaseCommand(
    CaseId caseId,
    UserId actorId,
    Set<String> actorAuthorities,
    Instant requestedAt
) {}
```

Jangan bergantung pada `SecurityContextHolder` untuk business audit jangka panjang.

### 11.3 Tenant Context

Jika multi-tenant, async tanpa tenant propagation bisa fatal.

Bad:

```java
@Async
public void rebuildIndex(CaseId caseId) {
    caseRepository.findById(caseId); // tenant unknown
}
```

Better:

```java
public record RebuildIndexCommand(TenantId tenantId, CaseId caseId) {}
```

```java
@Async("indexExecutor")
public void rebuildIndex(RebuildIndexCommand command) {
    tenantContext.runWith(command.tenantId(), () -> {
        caseRepository.findById(command.caseId());
    });
}
```

Explicit context beats magical ThreadLocal propagation for critical business state.

---

## 12. Scheduling: `@Scheduled` sebagai Time-Based Trigger

Scheduling adalah menjalankan method berdasarkan waktu.

Enable:

```java
@Configuration
@EnableScheduling
public class SchedulingConfiguration {
}
```

Contoh:

```java
@Component
public class CaseReminderJob {

    @Scheduled(cron = "0 */10 * * * *")
    public void sendPendingCaseReminders() {
        // every 10 minutes
    }
}
```

Spring mendukung beberapa model:

```text
fixedRate
fixedDelay
cron
initialDelay
```

---

## 13. Fixed Rate vs Fixed Delay vs Cron

### 13.1 Fixed Rate

```java
@Scheduled(fixedRate = 10_000)
public void runEveryTenSeconds() {
}
```

Artinya trigger berusaha berjalan setiap 10 detik berdasarkan start time schedule.

Jika task lebih lama dari interval, perilakunya tergantung scheduler/thread pool. Dengan single-thread scheduler, task berikutnya menunggu. Dengan pool multi-thread, overlap bisa terjadi jika tidak dikontrol.

### 13.2 Fixed Delay

```java
@Scheduled(fixedDelay = 10_000)
public void runTenSecondsAfterCompletion() {
}
```

Artinya delay dihitung setelah task sebelumnya selesai.

Cocok untuk polling yang tidak boleh overlap.

### 13.3 Cron

```java
@Scheduled(cron = "0 0 2 * * *", zone = "Asia/Jakarta")
public void runAtTwoAmJakarta() {
}
```

Cron cocok untuk jadwal kalender, tetapi wajib memperhatikan timezone dan DST untuk region yang punya DST.

Untuk sistem lintas negara, jangan membiarkan timezone implicit.

---

## 14. Scheduler Thread Pool

Default scheduler sering single-thread jika tidak dikonfigurasi. Ini bisa menyebabkan job saling menahan.

Contoh konfigurasi:

```java
@Configuration
@EnableScheduling
public class SchedulerConfiguration implements SchedulingConfigurer {

    @Override
    public void configureTasks(ScheduledTaskRegistrar registrar) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setThreadNamePrefix("scheduler-");
        scheduler.setPoolSize(4);
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(60);
        scheduler.initialize();
        registrar.setTaskScheduler(scheduler);
    }
}
}
```

Lebih baik lagi, deklarasikan bean:

```java
@Bean
public ThreadPoolTaskScheduler taskScheduler() {
    ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
    scheduler.setThreadNamePrefix("scheduled-");
    scheduler.setPoolSize(4);
    scheduler.setWaitForTasksToCompleteOnShutdown(true);
    scheduler.setAwaitTerminationSeconds(60);
    return scheduler;
}
```

Pertanyaan sizing scheduler:

```text
Berapa banyak job bisa berjalan bersamaan?
Apakah ada job yang long-running?
Apakah job boleh overlap?
Apakah job memanggil DB/API?
Apakah job critical?
Apakah job harus cluster-singleton?
```

---

## 15. Scheduling di Multi-Replica Deployment

Ini salah satu bug production paling umum.

Jika aplikasi berjalan 4 pod:

```text
pod-1: @Scheduled job runs
pod-2: @Scheduled job runs
pod-3: @Scheduled job runs
pod-4: @Scheduled job runs
```

`@Scheduled` default adalah **per JVM instance**, bukan cluster singleton.

Jika job harus hanya berjalan sekali per cluster, perlu mekanisme tambahan:

1. distributed lock;
2. database lock;
3. ShedLock atau equivalent;
4. leader election;
5. Kubernetes CronJob;
6. external scheduler;
7. batch platform;
8. message queue with single consumer group semantics.

Contoh sederhana dengan DB lock conceptually:

```text
job starts
  -> try acquire lock row: JOB_NAME = case-reminder
  -> if acquired: run job
  -> update heartbeat / release lock
  -> if not acquired: skip
```

Jangan mengasumsikan `@Scheduled` otomatis cluster-aware.

---

## 16. Idempotency untuk Scheduled Job

Scheduled job harus diasumsikan bisa:

1. berjalan dua kali;
2. gagal di tengah;
3. restart setelah partial progress;
4. overlap dengan eksekusi sebelumnya;
5. berjalan di replica lain;
6. dieksekusi manual oleh operator.

Maka job harus idempotent.

Bad:

```java
@Scheduled(cron = "0 0 9 * * *")
public void sendDailyReminder() {
    List<CaseEntity> cases = caseRepository.findPendingCases();
    for (CaseEntity c : cases) {
        emailClient.sendReminder(c);
    }
}
```

Jika job retry, email bisa terkirim dua kali.

Better:

```text
select cases where reminder_due = true and reminder_sent_at is null
for each case:
  acquire per-case idempotency marker
  send email
  mark reminder_sent_at
```

Lebih robust:

```text
create notification_outbox row with unique business key
separate sender processes outbox exactly-once-per-key semantics
```

Scheduled job sebaiknya sering menjadi **trigger/reconciler**, bukan langsung menjalankan side effect irreversible tanpa guard.

---

## 17. Scheduling sebagai Reconciliation Pattern

Dalam sistem enterprise, scheduled job paling aman jika didesain sebagai reconciliation:

```text
desired state vs actual state
```

Contoh:

```text
Case should have reminder notification if:
  status = PENDING_REVIEW
  due_date < now + 2 days
  reminder_sent_at is null
```

Job:

```text
find missing reminders
create reminder commands/outbox rows idempotently
```

Ini lebih baik daripada:

```text
every 10 minutes blindly send email for all pending cases
```

Reconciliation membuat job bisa diulang tanpa merusak state.

---

## 18. Application Events: In-Process Pub/Sub

Spring event memungkinkan satu component publish event dan component lain listen.

```java
public record CaseSubmittedEvent(CaseId caseId, UserId submittedBy) {}
```

Publisher:

```java
@Service
public class CaseSubmissionService {

    private final ApplicationEventPublisher events;

    public CaseSubmissionService(ApplicationEventPublisher events) {
        this.events = events;
    }

    @Transactional
    public void submit(SubmitCaseCommand command) {
        CaseEntity entity = caseRepository.save(...);
        events.publishEvent(new CaseSubmittedEvent(entity.getId(), command.actorId()));
    }
}
```

Listener:

```java
@Component
public class CaseSubmittedListener {

    @EventListener
    public void on(CaseSubmittedEvent event) {
        // handle event
    }
}
```

Default Spring event listener bersifat synchronous, berjalan di thread publisher, kecuali event multicaster dikonfigurasi dengan executor atau listener diberi `@Async`.

---

## 19. Event Bukan Message Queue

Spring event adalah **in-memory application event**.

Karakteristik default:

| Aspek | Spring event default |
|---|---|
| Durability | tidak durable |
| Cross-service | tidak |
| Cross-process | tidak |
| Transaction aware | hanya jika menggunakan transactional listener |
| Retry durable | tidak otomatis |
| Ordering global | tidak dijamin sebagai messaging system |
| Crash recovery | tidak |

Gunakan Spring event untuk:

1. decoupling internal module dalam satu JVM;
2. side effect lokal yang bukan mission-critical;
3. domain event internal yang diproses dalam transaction sama atau after commit;
4. trigger untuk menulis outbox;
5. modular monolith event.

Jangan gunakan Spring event sebagai pengganti Kafka/RabbitMQ/JMS untuk integrasi durable antar service.

---

## 20. Synchronous `@EventListener`

Synchronous listener berjalan di thread publisher.

```java
@EventListener
public void on(CaseSubmittedEvent event) {
    auditService.writeAudit(event);
}
```

Keuntungan:

1. simple;
2. failure langsung terlihat oleh publisher;
3. bisa ikut transaction caller jika dipanggil dalam transaction;
4. ordering lebih mudah dipahami.

Risiko:

1. listener lambat memperlambat caller;
2. listener exception bisa menggagalkan use case;
3. terlalu banyak listener membuat service flow implicit;
4. remote call di listener synchronous memperburuk latency.

Gunakan synchronous listener untuk operasi lokal yang cepat dan memang harus menjadi bagian dari use case.

---

## 21. Asynchronous Event Listener

Ada dua cara umum:

### 21.1 `@Async` pada Listener

```java
@Async("eventExecutor")
@EventListener
public void on(CaseSubmittedEvent event) {
    notificationService.notifyReviewer(event.caseId());
}
```

### 21.2 Async ApplicationEventMulticaster

```java
@Bean(name = "applicationEventMulticaster")
public ApplicationEventMulticaster applicationEventMulticaster(
        @Qualifier("eventExecutor") Executor executor) {

    SimpleApplicationEventMulticaster multicaster = new SimpleApplicationEventMulticaster();
    multicaster.setTaskExecutor(executor);
    multicaster.setErrorHandler(ex -> {
        // log, metric, alert
    });
    return multicaster;
}
```

Perbedaan penting:

```text
@Async per listener memberi kontrol granular.
Async multicaster membuat semua listener default asynchronous kecuali ada desain khusus.
```

Untuk enterprise system, lebih aman mulai dari listener eksplisit `@Async` daripada mengubah seluruh event multicaster menjadi async.

---

## 22. Transactional Event Listener

`@TransactionalEventListener` mengikat listener ke fase transaction.

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void on(CaseSubmittedEvent event) {
    // only if transaction committed
}
```

Fase:

| Phase | Makna |
|---|---|
| `BEFORE_COMMIT` | sebelum commit transaction |
| `AFTER_COMMIT` | setelah commit sukses |
| `AFTER_ROLLBACK` | setelah rollback |
| `AFTER_COMPLETION` | setelah selesai, commit atau rollback |

### 22.1 `AFTER_COMMIT`

Cocok untuk:

1. publish outbox notification;
2. invalidate cache;
3. trigger async process;
4. send non-transactional side effect setelah data committed.

Tetapi ingat:

```text
AFTER_COMMIT listener bukan berarti durable.
```

Jika app crash setelah DB commit dan sebelum listener selesai, side effect bisa hilang.

### 22.2 `BEFORE_COMMIT`

Cocok untuk validasi final atau update state yang harus masih masuk transaction.

Risiko: listener failure menyebabkan commit gagal.

### 22.3 `AFTER_ROLLBACK`

Cocok untuk cleanup lokal atau metrics.

Jangan melakukan side effect bisnis irreversible di sini kecuali benar-benar didesain.

---

## 23. Transactional Event vs Outbox

Perbandingan:

| Kebutuhan | `@TransactionalEventListener` | Outbox |
|---|---|---|
| Side effect lokal non-critical | cocok | mungkin berlebihan |
| Kirim event ke service lain | tidak cukup | cocok |
| Crash recovery | tidak | ya, jika outbox diproses durable |
| Audit legal/regulatory | lemah jika hanya in-memory | lebih kuat |
| Exactly-once business key | manual | bisa didesain |
| Operational retry | terbatas | lebih baik |

Pattern kuat:

```java
@Transactional
public void submitCase(...) {
    CaseEntity entity = caseRepository.save(...);
    outboxRepository.insert(new OutboxMessage(...));
}
```

Lalu scheduler/message relay:

```text
poll pending outbox
publish to Kafka/RabbitMQ/email
mark sent with retry metadata
```

Spring event bisa dipakai untuk mengorganisasi internal code, tetapi outbox yang memberi durability.

---

## 24. Event Design: Jangan Publish Entity Mutable

Bad:

```java
public record CaseSubmittedEvent(CaseEntity entity) {}
```

Masalah:

1. entity mungkin lazy-loaded;
2. entity attached/detached tergantung transaction;
3. listener bisa memodifikasi entity;
4. serialization sulit;
5. event tidak stabil;
6. audit sulit.

Better:

```java
public record CaseSubmittedEvent(
    CaseId caseId,
    UserId submittedBy,
    Instant submittedAt
) {}
```

Event harus membawa fakta penting, bukan object persistence penuh.

Untuk event internal, cukup bawa ID + snapshot minimal. Listener bisa reload state jika perlu.

---

## 25. Event Naming dan Semantics

Gunakan nama event berbasis fakta masa lalu:

```text
CaseSubmittedEvent
CaseApprovedEvent
CaseRejectedEvent
PaymentCapturedEvent
DocumentUploadedEvent
```

Hindari nama command:

```text
SendEmailEvent
UpdateSearchIndexEvent
RunValidationEvent
```

Perbedaan:

```text
Event = sesuatu sudah terjadi.
Command = instruksi agar sesuatu dilakukan.
```

Jika listener mendengarkan `CaseSubmittedEvent` lalu mengirim email, event tetap domain fact. Jika event bernama `SendEmailEvent`, publisher sudah tahu side effect spesifik dan coupling meningkat.

---

## 26. Async/Event/Schedule Error Handling

Error handling berbeda tergantung jalur.

| Jalur | Error default |
|---|---|
| synchronous method | exception kembali ke caller |
| `void @Async` | masuk async uncaught handler/log |
| `CompletableFuture @Async` | future completed exceptionally |
| `@Scheduled` | biasanya logged by scheduler error handler; next run tetap bisa jalan |
| synchronous event | exception bisa propagate ke publisher |
| async event | bergantung executor/multicaster error handler |
| transactional event | bergantung phase dan sync/async behavior |

Prinsip:

```text
Setiap non-request execution path harus punya explicit error policy.
```

Minimal:

1. structured log;
2. metric counter;
3. correlation id atau job id;
4. retry policy jika appropriate;
5. alert untuk critical failure;
6. dead-letter atau failure table untuk recoverable work;
7. idempotency key.

---

## 27. Retry pada Async/Scheduled/Event

Retry tidak boleh asal.

Pertanyaan sebelum retry:

```text
Apakah operasi idempotent?
Apakah exception transient?
Apakah downstream punya rate limit?
Apakah retry memperburuk overload?
Apakah ada max attempt?
Apakah ada backoff + jitter?
Apakah failure disimpan setelah retry habis?
```

Bad:

```java
while (true) {
    try {
        externalClient.call();
        break;
    } catch (Exception ignored) {
    }
}
```

Better conceptual policy:

```text
attempt 1
wait 250ms + jitter
attempt 2
wait 1s + jitter
attempt 3
mark failed / DLQ / alert
```

Untuk scheduled reconciler, sering lebih baik tidak melakukan aggressive retry dalam satu run. Biarkan run berikutnya memproses ulang item pending.

---

## 28. `@Scheduled` dan Long-Running Work

Jangan membuat scheduled method memproses jutaan data dalam satu transaction besar.

Bad:

```java
@Scheduled(cron = "0 0 * * * *")
@Transactional
public void processAllPendingCases() {
    List<CaseEntity> cases = caseRepository.findAllPending();
    for (CaseEntity c : cases) {
        process(c);
    }
}
```

Masalah:

1. transaction terlalu lama;
2. lock lama;
3. memory besar;
4. rollback besar;
5. restart sulit;
6. progress tidak terlihat;
7. satu item gagal menggagalkan semua.

Better:

```text
scheduled trigger
  -> fetch small page of pending work
  -> process item/chunk with independent transaction
  -> store progress/failure
  -> next run continues
```

Contoh:

```java
@Scheduled(fixedDelayString = "${jobs.case-reconciliation.delay-ms}")
public void reconcileCases() {
    List<CaseWorkItem> items = workRepository.findPendingBatch(100);
    for (CaseWorkItem item : items) {
        caseWorkProcessor.processOne(item.id());
    }
}
```

```java
@Service
public class CaseWorkProcessor {

    @Transactional
    public void processOne(WorkItemId id) {
        // small transaction
    }
}
```

Pastikan `processOne` dipanggil dari bean lain agar transaction proxy aktif.

---

## 29. Async Boundary dan Database Connection Pool

`@Async` sering dipakai untuk parallelize DB work:

```java
CompletableFuture<A> a = serviceA.loadAsync(id);
CompletableFuture<B> b = serviceB.loadAsync(id);
CompletableFuture<C> c = serviceC.loadAsync(id);
```

Jika setiap async task membuka DB connection, concurrency bisa menghabiskan pool.

Misalnya:

```text
HTTP threads: 100
async fanout per request: 5
potential DB operations: 500
Hikari max pool: 50
```

Hasil:

1. connection timeout;
2. thread blocked menunggu connection;
3. latency naik;
4. retry memperburuk;
5. pool starvation.

Rule:

```text
Async parallelism harus dikontrol oleh resource paling sempit, bukan oleh jumlah thread yang bisa dibuat.
```

Gunakan bulkhead per downstream/resource.

---

## 30. Graceful Shutdown

Saat aplikasi shutdown, pertanyaan penting:

```text
Apakah async task dibiarkan selesai?
Apakah scheduled task dihentikan?
Apakah new task ditolak?
Berapa lama menunggu?
Apa yang terjadi setelah timeout?
Apakah partial progress aman?
```

Konfigurasi executor:

```java
executor.setWaitForTasksToCompleteOnShutdown(true);
executor.setAwaitTerminationSeconds(60);
```

Spring Boot juga punya property untuk task execution/scheduling shutdown.

Contoh konseptual:

```properties
spring.task.execution.shutdown.await-termination=true
spring.task.execution.shutdown.await-termination-period=60s
spring.task.scheduling.shutdown.await-termination=true
spring.task.scheduling.shutdown.await-termination-period=60s
spring.lifecycle.timeout-per-shutdown-phase=60s
```

Namun graceful shutdown bukan pengganti idempotency. Jika proses dimatikan paksa setelah timeout, task tetap bisa berhenti di tengah.

Design task agar bisa resume.

---

## 31. Observability untuk Async/Scheduled/Event

Non-request execution harus terlihat di observability stack.

Minimal metric:

```text
task_submitted_total
task_completed_total
task_failed_total
task_duration_seconds
task_queue_size
task_active_threads
task_rejected_total
scheduled_job_started_total
scheduled_job_completed_total
scheduled_job_failed_total
scheduled_job_duration_seconds
event_listener_failed_total
event_listener_duration_seconds
```

Log field minimal:

```text
job.name
job.runId
event.type
event.id
correlationId
tenantId
actorId if applicable
attempt
status
error.code
```

Untuk scheduled job, buat run id:

```java
String runId = UUID.randomUUID().toString();
```

Lalu log:

```text
case-reminder job started runId=...
case-reminder job completed runId=... processed=... failed=... durationMs=...
```

Jika job memproses batch, log per item hanya untuk error atau sampling agar tidak membanjiri log.

---

## 32. Testing Async Code

Async test sering flaky jika hanya pakai `Thread.sleep()`.

Bad:

```java
service.doAsync();
Thread.sleep(1000);
verify(...);
```

Better approach:

1. gunakan synchronous executor di test;
2. gunakan Awaitility-style polling;
3. expose observable state;
4. test unit logic tanpa async wrapper;
5. test async integration secara terbatas.

### 32.1 Synchronous Executor untuk Test

```java
@TestConfiguration
public class SynchronousAsyncTestConfig {

    @Bean(name = "notificationExecutor")
    public Executor notificationExecutor() {
        return Runnable::run;
    }
}
```

Dengan ini, method async berjalan langsung di thread test sehingga deterministic.

### 32.2 Pisahkan Async Wrapper dari Logic

```java
@Service
public class AsyncNotificationFacade {

    private final NotificationProcessor processor;

    @Async("notificationExecutor")
    public void sendAsync(NotificationCommand command) {
        processor.process(command);
    }
}

@Service
public class NotificationProcessor {

    public void process(NotificationCommand command) {
        // test this synchronously
    }
}
```

Test utama fokus ke `NotificationProcessor`, bukan proxy async.

---

## 33. Testing Scheduled Job

Jangan menunggu cron di test.

Desain scheduled method sebagai trigger tipis:

```java
@Component
public class CaseReminderSchedule {

    private final CaseReminderJob job;

    @Scheduled(cron = "${jobs.case-reminder.cron}")
    public void run() {
        job.runOnce();
    }
}
```

Test:

```java
@Test
void runOnce_sendsReminderForDueCases() {
    job.runOnce();
    // assert state
}
```

Dengan ini, scheduling annotation tidak menjadi pusat testing. Logic job bisa diuji seperti service biasa.

---

## 34. Testing Events

Untuk event, ada beberapa level test:

### 34.1 Unit Test Listener

```java
listener.on(new CaseSubmittedEvent(caseId, actorId, now));
```

### 34.2 Integration Test Publishing Event

```java
publisher.publishEvent(new CaseSubmittedEvent(caseId, actorId, now));
```

### 34.3 Transactional Event Test

Transactional event butuh commit. Dalam test Spring yang default transactional rollback, `AFTER_COMMIT` listener mungkin tidak jalan.

Solusi:

1. jangan gunakan transactional test untuk case ini;
2. gunakan `TestTransaction.flagForCommit()` dan `TestTransaction.end()`;
3. test listener logic secara unit;
4. test outbox row, bukan side effect listener.

---

## 35. Design Pattern: Async Command Table

Untuk task critical tapi belum ingin memakai queue external, bisa gunakan DB-backed command table.

Pattern:

```text
request transaction:
  insert async_command(id, type, payload, status=PENDING, unique_key)

scheduled worker:
  claim pending rows
  process
  mark SUCCESS/FAILED
  retry with attempt count
```

Keuntungan:

1. durable;
2. observable;
3. retryable;
4. idempotent via unique key;
5. operator bisa inspect;
6. tidak hilang saat crash.

Kekurangan:

1. perlu polling;
2. perlu locking;
3. throughput tidak setinggi broker;
4. perlu cleanup/archive;
5. harus hati-hati dengan concurrency.

Ini sering lebih kuat daripada `@Async void` untuk enterprise internal workload.

---

## 36. Design Pattern: Scheduled Reconciler + Outbox

Untuk side effect seperti email, notification, indexing, webhook:

```text
business transaction:
  update business state
  insert outbox event with unique business key

scheduled relay:
  claim unsent events
  send to downstream
  mark sent or failed
```

Outbox table contoh:

```sql
CREATE TABLE outbox_message (
    id              VARCHAR(64) PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    VARCHAR(100) NOT NULL,
    event_type      VARCHAR(100) NOT NULL,
    payload_json    CLOB NOT NULL,
    status          VARCHAR(30) NOT NULL,
    attempt_count   INTEGER NOT NULL,
    next_attempt_at TIMESTAMP NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL,
    unique_key      VARCHAR(200) NOT NULL,
    CONSTRAINT uk_outbox_unique_key UNIQUE (unique_key)
);
```

Worker:

```java
@Scheduled(fixedDelayString = "${outbox.relay.delay-ms}")
public void relayOutbox() {
    List<OutboxMessage> messages = outboxRepository.claimBatch(100);
    for (OutboxMessage message : messages) {
        outboxProcessor.process(message.id());
    }
}
```

Processor:

```java
@Transactional
public void process(OutboxMessageId id) {
    OutboxMessage message = outboxRepository.findClaimed(id).orElseThrow();
    // send outside transaction? depends on design; often split claim/send/mark carefully
}
```

Nuance: external send inside DB transaction can hold locks too long. External send outside DB transaction can create mark-sent consistency issue. Ini harus didesain dengan idempotency downstream.

---

## 37. Anti-Pattern: `@Async` untuk Menyembunyikan Latency Buruk

Bad:

```java
@Transactional
public void approveCase(CaseId id) {
    updateCase(id);
    slowExternalSystem.update(id); // slow
}
```

Lalu “solusi”:

```java
@Async
public void updateExternalSystem(CaseId id) {
    slowExternalSystem.update(id);
}
```

Masalah belum tentu selesai:

1. external update sekarang bisa hilang;
2. caller tidak tahu gagal;
3. tidak ada retry durable;
4. ordering tidak jelas;
5. audit tidak jelas;
6. downstream inconsistency.

Solusi engineering:

```text
approve case transaction
  -> persist state
  -> persist integration command/outbox
worker
  -> update external system with retry/idempotency
  -> mark integration status
UI/API
  -> expose integration state if relevant
```

Async bukan pengganti integration design.

---

## 38. Anti-Pattern: Semua Event Dibuat Async

Mengubah application event multicaster menjadi async global terlihat menarik:

```java
multicaster.setTaskExecutor(executor);
```

Tetapi ini mengubah semantics seluruh event:

1. listener exception tidak lagi menggagalkan publisher;
2. ordering berubah;
3. transaction context hilang;
4. test bisa flaky;
5. startup/internal framework events bisa terpengaruh jika tidak hati-hati;
6. debugging lebih sulit.

Lebih baik:

```text
Default synchronous.
Async hanya untuk listener yang memang didesain async.
```

---

## 39. Anti-Pattern: Scheduled Job sebagai Business Workflow Engine

Bad:

```text
Every minute:
  scan all cases
  infer what should happen
  move status
  send email
  call external systems
  close expired tasks
```

Jika semua workflow ditanam dalam scheduled scanner, sistem menjadi sulit diaudit:

1. siapa yang memutuskan transition?
2. kapan transition seharusnya terjadi?
3. kenapa case berubah status?
4. apakah retry menyebabkan double action?
5. bagaimana operator melihat pending action?

Better:

```text
workflow command/event/outbox model
scheduled job only reconciles missing/expired work
state transition recorded explicitly
```

Scheduled job boleh menjadi safety net, bukan satu-satunya otak workflow.

---

## 40. Async/Event/Schedule Decision Matrix

| Kebutuhan | Pilihan yang cocok |
|---|---|
| local fast side effect, harus gagal bersama caller | synchronous event/listener |
| local side effect setelah commit, non-critical | `@TransactionalEventListener(AFTER_COMMIT)` |
| local best-effort non-critical async | `@Async` listener/method dengan metric |
| critical side effect harus tidak hilang | outbox/DB command/message broker |
| periodic reconciliation | `@Scheduled` + idempotent job |
| cluster singleton schedule | scheduler + distributed lock / external scheduler |
| high-throughput durable async | Kafka/RabbitMQ/JMS |
| long-running batch with restartability | Spring Batch |
| complex workflow state machine | BPM/workflow engine/state machine model |

---

## 41. Production Checklist untuk `@Async`

Sebelum approve PR yang menambahkan `@Async`, cek:

```text
[ ] Method dipanggil lewat Spring proxy, bukan self-invocation.
[ ] Executor eksplisit, bukan default global tanpa ownership.
[ ] Thread name jelas.
[ ] Queue bounded.
[ ] Rejection policy jelas.
[ ] Timeout downstream jelas.
[ ] Error handling jelas.
[ ] Return type sesuai semantics.
[ ] Context propagation diputuskan, bukan kebetulan.
[ ] Security/tenant/audit actor eksplisit jika critical.
[ ] Transaction interaction aman.
[ ] Shutdown behavior dikonfigurasi.
[ ] Metrics/logging tersedia.
[ ] Test tidak flaky.
[ ] Task critical tidak hilang saat crash, atau loss acceptable dan terdokumentasi.
```

---

## 42. Production Checklist untuk `@Scheduled`

```text
[ ] Job idempotent.
[ ] Job tidak asumsi single replica jika deployment multi-pod.
[ ] Jika perlu cluster singleton, ada lock/leader/external scheduler.
[ ] Timezone eksplisit untuk cron.
[ ] Long-running work diproses chunk/page.
[ ] Transaction kecil dan terkontrol.
[ ] Overlap policy jelas.
[ ] Retry/backoff jelas.
[ ] Partial failure disimpan.
[ ] Metrics per run tersedia.
[ ] Run id tersedia di log.
[ ] Shutdown behavior aman.
[ ] Job bisa dijalankan manual/replayed jika perlu.
[ ] Test memanggil service job langsung, bukan menunggu cron.
```

---

## 43. Production Checklist untuk Events

```text
[ ] Event bernama sebagai fakta masa lalu, bukan command tersembunyi.
[ ] Payload tidak membawa mutable entity penuh.
[ ] Listener sync/async dipilih eksplisit.
[ ] Transaction phase jelas.
[ ] Critical side effect tidak hanya bergantung pada in-memory event.
[ ] Listener failure semantics jelas.
[ ] Listener tidak melakukan remote call lambat dalam transaction caller.
[ ] Ordering requirement diketahui.
[ ] Event tidak menjadi hidden workflow yang sulit diaudit.
[ ] Observability listener tersedia.
[ ] Test mencakup publish/listen atau listener logic sesuai kebutuhan.
```

---

## 44. Case Study: Case Submission Notification

Requirement:

```text
Saat case submitted:
1. status case berubah menjadi SUBMITTED;
2. audit trail ditulis;
3. reviewer mendapat notification;
4. search index diperbarui;
5. external agency system diberi tahu;
6. user tidak perlu menunggu semua side effect selesai;
7. side effect critical tidak boleh hilang diam-diam.
```

### 44.1 Naive Design

```java
@Transactional
public void submitCase(...) {
    caseRepository.save(...);
    auditService.write(...);
    notificationService.sendEmail(...);
    searchService.updateIndex(...);
    agencyClient.notify(...);
}
```

Masalah:

1. transaction lama;
2. external call dalam transaction;
3. rollback ambiguity;
4. latency tinggi;
5. external failure menggagalkan submit;
6. retry tidak jelas.

### 44.2 Slightly Better but Still Weak

```java
@Transactional
public void submitCase(...) {
    caseRepository.save(...);
    auditService.write(...);
    notificationService.sendEmailAsync(...);
    searchService.updateIndexAsync(...);
    agencyClient.notifyAsync(...);
}
```

Masalah:

1. async bisa jalan sebelum commit;
2. task hilang saat crash;
3. failure tidak jelas;
4. audit side effect tidak menyatu dengan command;
5. integration state tidak terlihat.

### 44.3 Stronger Enterprise Design

```text
submit transaction:
  update case state
  write audit trail
  insert outbox rows:
    CASE_SUBMITTED_NOTIFICATION
    CASE_SUBMITTED_SEARCH_INDEX
    CASE_SUBMITTED_AGENCY_NOTIFY

post-commit:
  optional local event for non-critical in-memory refresh

workers/schedulers:
  process outbox idempotently
  retry transient failure
  mark failure for operator if exhausted
```

API response:

```json
{
  "caseId": "CASE-123",
  "status": "SUBMITTED",
  "integrationStatus": "PENDING"
}
```

This design makes side effects explicit and recoverable.

---

## 45. Case Study: Daily SLA Escalation Job

Requirement:

```text
Every day, find cases breaching SLA and escalate them.
Should not double-escalate.
Should run once per cluster.
Should be auditable.
Should survive restart.
```

Design:

```text
@Scheduled trigger
  -> acquire cluster lock SLA_ESCALATION
  -> find eligible cases page by page
  -> for each case:
       create escalation command with unique key caseId + slaPolicyId + breachDate
  -> worker processes commands
```

Unique key:

```text
ESCALATION:{caseId}:{policyId}:{breachDate}
```

This ensures rerun does not double-escalate.

Transition audit:

```text
CaseEscalated:
  fromStatus
  toStatus
  policyId
  breachDate
  jobRunId
  triggeredBy = SYSTEM
```

This is defensible.

---

## 46. Common Failure Modes

### 46.1 Async Method Not Async

Cause:

```text
self-invocation
method not public in proxy mode
bean not managed by Spring
final method/class
```

Symptom:

```text
runs in caller thread
latency not reduced
transaction behavior surprising
```

### 46.2 Transaction Data Not Visible in Async Task

Cause:

```text
async task started before commit
```

Fix:

```text
AFTER_COMMIT transactional event or outbox
```

### 46.3 Scheduled Job Runs Multiple Times

Cause:

```text
multiple app replicas
```

Fix:

```text
distributed lock, external scheduler, idempotency
```

### 46.4 Lost Event

Cause:

```text
in-memory async event and app crash
```

Fix:

```text
outbox/durable queue
```

### 46.5 Queue Explosion

Cause:

```text
large unbounded queue, downstream slow
```

Fix:

```text
bounded queue, backpressure, rate limit, circuit breaker
```

### 46.6 Missing MDC/Security/Tenant

Cause:

```text
new thread without context propagation
```

Fix:

```text
explicit command fields + TaskDecorator where appropriate
```

---

## 47. Mental Model Final

Spring async/scheduling/events bukan fitur “agar kode jalan di belakang layar”. Itu adalah **execution boundary**.

Boundary yang baik harus menjawab:

```text
What starts the work?
When does it run?
Where does it run?
What context does it need?
What transaction does it observe?
What happens if it fails?
Can it run twice?
Can it be resumed?
Can it be observed?
Can it be stopped safely?
Can it survive crash?
```

Jika jawabannya tidak jelas, fitur async/schedule/event akan menjadi sumber bug tersembunyi.

---

## 48. Ringkasan

Di part ini kita membahas:

1. `@Async` sebagai proxy-based method interception;
2. `TaskExecutor` sebagai capacity boundary;
3. return type dan error semantics async;
4. self-invocation problem;
5. interaksi async dengan transaction;
6. executor sizing, queue, rejection, virtual thread caution;
7. context propagation untuk MDC/security/tenant;
8. `@Scheduled`, fixed rate, fixed delay, cron, scheduler pool;
9. scheduled job dalam multi-replica deployment;
10. idempotency dan reconciliation pattern;
11. Spring application events;
12. synchronous vs asynchronous listener;
13. `@TransactionalEventListener` dan transaction phase;
14. event vs durable messaging;
15. outbox dan async command table;
16. graceful shutdown;
17. observability dan testing;
18. production checklist.

Core lesson:

```text
Do not use async to hide design uncertainty.
Use async, scheduling, and events only after defining execution, transaction, failure, idempotency, and recovery semantics.
```

---

## 49. Latihan

### Latihan 1 — Diagnose Self-Invocation

Diberikan service:

```java
@Service
public class InvoiceService {

    public void approveInvoice(InvoiceId id) {
        sendApprovalEmail(id);
    }

    @Async
    public void sendApprovalEmail(InvoiceId id) {
        emailClient.send(...);
    }
}
```

Jawab:

1. Apakah email dikirim async?
2. Mengapa?
3. Bagaimana refactor yang benar?

### Latihan 2 — Design Scheduled Job

Requirement:

```text
Every 5 minutes, close expired sessions.
Application runs on 6 pods.
Closing must not happen twice for same session.
```

Desain:

1. trigger model;
2. cluster lock atau idempotency strategy;
3. transaction boundary;
4. observability;
5. retry/failure handling.

### Latihan 3 — Transactional Side Effect

Requirement:

```text
After case approval commit, send notification and update external registry.
Notification can be delayed.
External registry update must not be lost.
```

Tentukan:

1. mana yang bisa pakai `@TransactionalEventListener`;
2. mana yang harus pakai outbox;
3. apa payload event/command;
4. bagaimana retry dan idempotency.

### Latihan 4 — Executor Capacity

Diberikan:

```text
HTTP concurrency: 80
Each request submits 3 async DB tasks
DB pool max: 40
Async executor max: 200
Queue: 10,000
```

Analisis:

1. bottleneck;
2. failure mode;
3. konfigurasi yang lebih aman;
4. metric yang harus dipantau.

---

## 50. Referensi Resmi

1. Spring Framework Reference — Task Execution and Scheduling.
2. Spring Boot Reference — Task Execution and Scheduling.
3. Spring Framework Reference — Application Events.
4. Spring Framework Reference — Transaction-bound Events.
5. Spring Framework Reference — Core AOP/proxy semantics.
6. Spring Boot Reference — Graceful Shutdown and Application Lifecycle.

---

## 51. Penutup Part 20

Part ini adalah fondasi untuk memahami semua execution path selain request-response biasa.

Part berikutnya:

```text
21-virtual-threads-concurrency-spring-java-21-25.md
```

Di sana kita akan masuk lebih dalam ke Java 21–25, virtual threads, pinning, ThreadLocal, transaction/security context, pool bottleneck, dan bagaimana memilih antara MVC + virtual threads, WebFlux, dan executor-based async.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./19-spring-caching-semantics-consistency-risk.md">⬅️ Part 19 — Spring Caching Semantics and Consistency Risk</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./21-virtual-threads-concurrency-spring-java-21-25.md">Part 21 — Virtual Threads, Concurrency, and Spring on Java 21–25 ➡️</a>
</div>

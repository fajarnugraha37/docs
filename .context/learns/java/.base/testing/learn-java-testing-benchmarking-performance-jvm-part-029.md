# learn-java-testing-benchmarking-performance-jvm-part-029

# Performance Engineering for Services: Thread Pool, Connection Pool, Backpressure, Timeout

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `029`  
> Topik: performance engineering pada service runtime Java 8–25  
> Fokus: thread pool, virtual thread, connection pool, queueing, backpressure, timeout, retry, bulkhead, rate limiting, tail latency, dan saturation control.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita membahas optimasi pada level kode: allocation, collections, strings, IO, serialization, logging, exception, dan cache. Tetapi service Java enterprise jarang gagal hanya karena satu method lambat. Service biasanya melambat karena **interaksi antar-resource**:

- request datang lebih cepat daripada service rate,
- thread pool penuh,
- connection pool habis,
- queue makin panjang,
- timeout terlalu panjang,
- retry memperparah beban,
- dependency lambat,
- GC/CPU/memory terlihat “normal” tetapi p99 latency naik,
- throughput tiba-tiba collapse setelah melewati knee point.

Tujuan part ini adalah membangun mental model untuk menjawab pertanyaan seperti:

1. Berapa ukuran thread pool yang masuk akal?
2. Apakah virtual thread menghilangkan kebutuhan sizing pool?
3. Berapa ukuran JDBC connection pool yang aman?
4. Bagaimana timeout budget didesain dari API gateway sampai database?
5. Kapan retry membantu dan kapan menjadi retry storm?
6. Bagaimana backpressure berbeda dari rate limiting?
7. Bagaimana bulkhead mencegah satu dependency lambat menjatuhkan seluruh service?
8. Bagaimana membaca gejala saturation dari metrik production?
9. Bagaimana men-tune service tanpa sekadar menaikkan semua pool size?

Target akhirnya: kamu bisa melihat service Java sebagai **sistem antrian yang memiliki resource terbatas**, bukan sekadar kumpulan endpoint dan method.

---

## 2. Mental Model Utama: Service Adalah Sistem Antrian

Service menerima pekerjaan. Pekerjaan itu masuk, menunggu, diproses, mungkin memanggil dependency, lalu keluar.

```text
incoming request
    ↓
acceptor / server queue
    ↓
application execution
    ↓
thread / virtual thread
    ↓
connection pool / dependency / DB / broker / cache
    ↓
response
```

Setiap titik bisa menjadi bottleneck:

```text
client concurrency
    ↓
HTTP server worker / event loop / request executor
    ↓
application executor
    ↓
JDBC connection pool
    ↓
DB CPU / locks / IO
```

Ketika arrival rate lebih besar daripada processing capacity, pekerjaan tidak hilang secara otomatis. Ia biasanya berubah menjadi:

- queue,
- blocked thread,
- pending future,
- saturated connection pool,
- timeout,
- retry,
- memory pressure,
- p99 latency spike.

Formula paling penting adalah Little's Law:

```text
L = λ × W
```

Keterangan:

- `L` = jumlah pekerjaan rata-rata di dalam sistem,
- `λ` = arrival/completion rate,
- `W` = waktu rata-rata pekerjaan berada dalam sistem.

Dalam konteks service:

```text
concurrency ≈ throughput × latency
```

Contoh:

```text
throughput = 200 requests/second
average latency = 100 ms = 0.1 second
concurrency ≈ 200 × 0.1 = 20 in-flight requests
```

Jika dependency melambat:

```text
throughput target = 200 requests/second
latency naik menjadi 1 second
concurrency ≈ 200 × 1 = 200 in-flight requests
```

Artinya tanpa traffic naik pun, service bisa tiba-tiba butuh 10× lebih banyak in-flight capacity hanya karena latency dependency naik.

Inilah akar banyak incident:

```text
small dependency slowdown
  → in-flight request naik
  → thread pool penuh
  → connection pool penuh
  → queue naik
  → timeout naik
  → retry naik
  → traffic efektif naik
  → dependency makin lambat
  → collapse
```

---

## 3. Throughput, Latency, Utilization, dan Saturation

Empat konsep ini harus dipisahkan.

## 3.1 Throughput

Throughput adalah berapa banyak pekerjaan selesai per satuan waktu.

Contoh:

```text
500 request/s
2,000 message/s
10,000 row/s
```

Throughput tinggi tidak selalu berarti sistem sehat. Sistem bisa punya throughput tinggi tetapi p99 latency buruk.

## 3.2 Latency

Latency adalah waktu yang dialami satu request/message/job.

Latency terdiri dari:

```text
latency = queue time + service time + dependency time + network time + serialization time + GC/scheduling delay
```

Banyak engineer hanya mengukur service time, padahal user merasakan total latency.

## 3.3 Utilization

Utilization adalah seberapa sibuk resource.

Contoh:

```text
CPU 70%
DB CPU 85%
JDBC pool active 90%
executor active threads 100%
```

Utilization tinggi bukan selalu buruk. Tetapi ketika utilization mendekati 100%, queueing delay naik tajam.

## 3.4 Saturation

Saturation adalah tanda bahwa resource tidak lagi mampu menerima pekerjaan tanpa menambah waiting time/error.

Contoh saturation:

- executor queue length naik,
- active threads selalu maksimum,
- Hikari pending threads naik,
- DB wait event naik,
- HTTP client connection pending naik,
- Redis command latency naik,
- Kafka consumer lag naik,
- timeout naik,
- p99/p999 latency naik,
- CPU throttling naik,
- GC overhead naik.

Saturation adalah sinyal operasional yang lebih penting daripada “CPU masih 50%”.

---

## 4. Queueing: Kenapa Pool Besar Bukan Selalu Solusi

Misalkan satu service punya thread pool 200. Lalu p99 latency naik karena DB query lambat. Engineer menaikkan thread pool ke 500.

Apa yang terjadi?

Kemungkinan:

```text
lebih banyak request bisa masuk ke DB
  → DB makin overloaded
  → query makin lambat
  → connection pool makin penuh
  → timeout makin banyak
  → retry makin banyak
  → sistem makin buruk
```

Pool besar bukan menambah capacity dependency. Pool besar hanya mengizinkan lebih banyak pekerjaan menunggu atau menekan bottleneck di tempat lain.

Rule mental:

```text
A pool is not capacity. A pool is a concurrency limiter.
```

Jika bottleneck adalah DB yang hanya sanggup 40 concurrent query sehat, thread pool 400 tidak membuat DB sanggup 400 query. Itu hanya memperbesar blast radius.

---

## 5. Thread Pool Engineering

Thread pool mengontrol berapa banyak pekerjaan berjalan secara concurrent pada platform thread.

Thread pool biasanya dipakai untuk:

- HTTP request worker,
- async task,
- scheduler,
- message consumer,
- batch worker,
- blocking IO isolation,
- CPU-bound computation,
- background job,
- external dependency call.

## 5.1 Dua Jenis Workload: CPU-Bound vs IO-Bound

### CPU-bound

CPU-bound berarti pekerjaan terutama menghabiskan CPU.

Contoh:

- compression,
- cryptographic hashing,
- image processing,
- heavy JSON transformation,
- rule evaluation berat,
- large in-memory calculation.

Untuk CPU-bound, thread terlalu banyak menyebabkan context switching.

Baseline kasar:

```text
threads ≈ number of effective CPU cores
```

Atau sedikit lebih tinggi jika ada occasional wait.

```text
threads ≈ cores × (1 + wait_time / compute_time)
```

### IO-bound

IO-bound berarti pekerjaan sering menunggu network, DB, file, broker, atau remote API.

Contoh:

- JDBC query,
- HTTP call,
- Redis call,
- S3 upload,
- RabbitMQ publish,
- Kafka send,
- file IO.

Untuk platform threads, IO-bound workload kadang butuh thread lebih banyak karena thread blocked saat menunggu IO. Tetapi thread banyak tetap punya biaya:

- stack memory,
- scheduler overhead,
- context switch,
- lock contention,
- GC pressure dari request state,
- pressure ke dependency.

## 5.2 Formula Awal Thread Pool

Formula klasik:

```text
threads = cores × target_cpu_utilization × (1 + wait_time / compute_time)
```

Contoh:

```text
cores = 8
compute_time = 20 ms
wait_time = 80 ms
target_cpu = 0.8
threads = 8 × 0.8 × (1 + 80/20)
threads = 6.4 × 5
threads ≈ 32
```

Ini bukan jawaban final. Ini titik awal eksperimen.

Validasi dengan:

- CPU utilization,
- run queue,
- request latency,
- queue length,
- dependency saturation,
- GC,
- context switch,
- error rate.

## 5.3 Executor Queue: Bounded vs Unbounded

Unbounded queue terlihat nyaman, tetapi berbahaya.

```java
ExecutorService executor = Executors.newFixedThreadPool(32);
```

`newFixedThreadPool` memakai unbounded `LinkedBlockingQueue`. Jika producer lebih cepat daripada consumer, queue bisa tumbuh sampai memory habis.

Lebih defensible:

```java
int core = 16;
int max = 16;
int queueCapacity = 500;

ThreadPoolExecutor executor = new ThreadPoolExecutor(
    core,
    max,
    30, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(queueCapacity),
    new ThreadFactory() {
        private final AtomicInteger seq = new AtomicInteger();

        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r);
            t.setName("case-worker-" + seq.incrementAndGet());
            t.setDaemon(false);
            return t;
        }
    },
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Queue policy penting:

| Policy | Behavior | Cocok Untuk |
|---|---|---|
| `AbortPolicy` | reject dengan exception | command yang boleh gagal cepat |
| `CallerRunsPolicy` | caller ikut menjalankan task | backpressure sederhana |
| `DiscardPolicy` | buang diam-diam | jarang cocok untuk enterprise |
| `DiscardOldestPolicy` | buang task lama | event volatile, bukan critical command |

Untuk regulatory/case-management system, silent discard hampir selalu salah karena kehilangan auditability.

## 5.4 Queue Capacity Bukan Angka Asal

Queue capacity harus didesain dari latency budget.

Misalnya:

```text
worker throughput = 100 task/s
max acceptable queue delay = 2 seconds
queue capacity ≈ 100 × 2 = 200 tasks
```

Jika queue capacity 10,000:

```text
queue delay ≈ 10,000 / 100 = 100 seconds
```

Artinya request yang masuk queue mungkin sudah tidak relevan ketika diproses.

Rule:

```text
Queue capacity encodes how much latency you are willing to hide.
```

---

## 6. ForkJoinPool dan Common Pool Trap

Banyak API Java memakai `ForkJoinPool.commonPool()` secara default, misalnya:

- `CompletableFuture.supplyAsync()` tanpa executor,
- parallel stream,
- beberapa library async tertentu.

Contoh berbahaya:

```java
CompletableFuture<UserProfile> future = CompletableFuture.supplyAsync(() -> {
    return userClient.fetchProfile(userId); // blocking HTTP call
});
```

Masalah:

- blocking IO memakai common pool,
- parallel stream lain bisa terganggu,
- CPU-bound task tercampur dengan IO-bound task,
- sulit observability,
- sulit tuning.

Lebih baik:

```java
CompletableFuture<UserProfile> future = CompletableFuture.supplyAsync(
    () -> userClient.fetchProfile(userId),
    userClientExecutor
);
```

Pisahkan executor berdasarkan workload:

```text
cpuExecutor
httpClientExecutor
emailExecutor
reportGenerationExecutor
caseEscalationExecutor
```

Tetapi jangan membuat terlalu banyak pool tanpa alasan, karena setiap pool adalah resource dan policy baru.

---

## 7. Virtual Threads Java 21+

Virtual threads mengubah cara kita memikirkan concurrency untuk blocking IO. Virtual threads adalah lightweight threads yang dijadwalkan oleh JVM di atas carrier platform threads.

Keuntungan utama:

- lebih mudah menulis kode blocking-style,
- bisa memiliki banyak concurrent tasks dengan overhead lebih rendah daripada platform thread,
- cocok untuk server-side request-per-task yang banyak menunggu IO,
- mengurangi kebutuhan thread pool besar hanya untuk menunggu network/DB.

Contoh:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<UserProfile> profile = executor.submit(() -> userClient.fetchProfile(userId));
    Future<List<Permission>> permissions = executor.submit(() -> permissionClient.fetch(userId));

    return UserView.of(profile.get(), permissions.get());
}
```

## 7.1 Virtual Thread Bukan Infinite Capacity

Virtual thread tidak menghilangkan bottleneck:

- DB connection pool tetap terbatas,
- HTTP connection pool tetap terbatas,
- remote API tetap punya rate limit,
- CPU tetap terbatas,
- memory untuk in-flight request tetap terbatas,
- lock contention tetap bisa terjadi,
- transaction duration tetap penting.

Rule:

```text
Virtual threads remove the need to ration threads for blocking waits.
They do not remove the need to ration downstream resources.
```

Jadi pada virtual-thread service, limiter pindah dari thread pool ke:

- connection pool,
- semaphore,
- rate limiter,
- bulkhead,
- timeout,
- queue boundary,
- request admission control.

## 7.2 Pinning

Virtual thread bisa “pinned” ke carrier thread ketika menjalankan operasi tertentu, terutama ketika blocking di dalam synchronized region atau native/foreign call tertentu.

Contoh buruk:

```java
public synchronized Response callExternalSystem(Request request) {
    return httpClient.send(request); // blocking while holding monitor
}
```

Lebih baik:

```java
public Response callExternalSystem(Request request) {
    // jangan hold intrinsic lock saat blocking IO
    return httpClient.send(request);
}
```

Atau gunakan lock dengan scope pendek:

```java
public Response process(Request request) {
    Metadata metadata;
    lock.lock();
    try {
        metadata = snapshotMetadata();
    } finally {
        lock.unlock();
    }

    return httpClient.send(enrich(request, metadata));
}
```

## 7.3 Virtual Threads dan JDBC

Virtual threads cocok untuk blocking JDBC dari sisi thread management. Tetapi JDBC connection tetap limited.

Jika ada 10,000 virtual threads dan Hikari pool 30:

```text
10,000 virtual threads
    ↓
30 DB connections
    ↓
9,970 virtual threads menunggu connection
```

Ini bisa baik jika timeout dan admission control benar. Ini buruk jika semua request dibiarkan menunggu terlalu lama.

## 7.4 Pattern Aman dengan Virtual Threads

Gunakan virtual thread untuk concurrency, tetapi tambahkan limiter untuk resource mahal.

```java
public final class ExternalCaseLookupService {
    private final Semaphore permits = new Semaphore(50);
    private final ExternalClient client;

    public ExternalCaseLookupService(ExternalClient client) {
        this.client = client;
    }

    public CaseInfo lookup(String caseId) throws InterruptedException {
        if (!permits.tryAcquire(200, TimeUnit.MILLISECONDS)) {
            throw new TooBusyException("external lookup is saturated");
        }

        try {
            return client.lookup(caseId);
        } finally {
            permits.release();
        }
    }
}
```

---

## 8. Connection Pool Engineering

Connection pool adalah concurrency limiter untuk dependency connection-based.

Contoh:

- JDBC connection pool,
- HTTP connection pool,
- Redis connection pool,
- LDAP connection pool,
- message broker channel/session pool.

## 8.1 JDBC Connection Pool

JDBC connection mahal. Pool menjaga sejumlah connection siap pakai. Tetapi pool terlalu besar bisa menghancurkan database.

Mental model:

```text
application pool size × number of app instances = total possible DB concurrency
```

Contoh:

```text
10 pods
Hikari maximumPoolSize = 50
possible DB connections = 500
```

Jika DB hanya sehat di 120 concurrent active sessions, konfigurasi ini berbahaya.

## 8.2 Pool Size Harus Dihitung Global

Jangan sizing per pod saja.

```text
DB max safe active connections = 120
reserved for admin/migration/batch = 20
available for app = 100
number of pods = 10
max pool per pod ≈ 100 / 10 = 10
```

Jika autoscaling naik ke 20 pods:

```text
max pool per pod 10 → total 200
```

Maka perlu:

- pool lebih kecil,
- autoscaling-aware limit,
- DB proxy,
- separate pool per workload,
- admission control,
- capacity planning.

## 8.3 HikariCP Baseline

Contoh konfigurasi Spring Boot:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 10
      minimum-idle: 10
      connection-timeout: 1000
      validation-timeout: 500
      idle-timeout: 600000
      max-lifetime: 1800000
      keepalive-time: 300000
      leak-detection-threshold: 30000
```

Makna penting:

| Property | Makna |
|---|---|
| `maximumPoolSize` | batas maksimum physical DB connection di pool |
| `connectionTimeout` | berapa lama caller menunggu connection sebelum gagal |
| `maxLifetime` | usia maksimum connection sebelum diganti |
| `idleTimeout` | kapan idle connection boleh dikurangi |
| `leakDetectionThreshold` | deteksi connection dipinjam terlalu lama |
| `minimumIdle` | jumlah idle connection yang dipertahankan |

`connectionTimeout` bukan sekadar teknikal. Itu bagian dari latency budget.

Jika API timeout 2 detik tetapi `connectionTimeout` 30 detik, request bisa menggantung lebih lama daripada kontrak API.

## 8.4 Connection Pool Saturation

Gejala Hikari saturation:

- active connections mendekati max,
- idle connections 0,
- pending threads naik,
- connection acquisition time naik,
- timeout acquiring connection,
- DB CPU/wait event naik,
- request p99 naik.

Interpretasi:

| Gejala | Kemungkinan |
|---|---|
| active max, DB CPU rendah | query blocked/lock/network, pool too small, connection leak |
| active max, DB CPU tinggi | DB saturated, query too heavy, too much concurrency |
| pending tinggi, idle 0 | pool bottleneck atau DB bottleneck |
| leak detection warning | transaction too long, connection not closed, slow dependency inside transaction |

## 8.5 Anti-Pattern: Remote Call di Dalam DB Transaction

Buruk:

```java
@Transactional
public void approveCase(ApproveCommand command) {
    CaseRecord record = repository.findByIdForUpdate(command.caseId());
    record.approve(command.officerId());

    externalNotificationClient.notifyApproval(record); // remote call inside transaction

    repository.save(record);
}
```

Masalah:

- DB connection dipegang selama network call,
- lock lebih lama,
- pool lebih cepat habis,
- retry remote call bisa memperpanjang transaction,
- failure ambiguity.

Lebih baik:

```java
@Transactional
public void approveCase(ApproveCommand command) {
    CaseRecord record = repository.findByIdForUpdate(command.caseId());
    record.approve(command.officerId());
    repository.save(record);
    outboxRepository.insert(CaseApprovedEvent.from(record));
}
```

Lalu worker publish event setelah commit.

---

## 9. HTTP Client Pool dan Dependency Concurrency

Banyak latency incident berasal dari HTTP client pool yang tidak dikontrol.

Per dependency, tentukan:

```text
max concurrent calls
connect timeout
read/request timeout
connection acquisition timeout
retry policy
rate limit
bulkhead
circuit breaker
```

Contoh mental model:

```text
service A receives 500 RPS
30% requests call service B
B call rate = 150 RPS
B p95 latency = 200 ms
expected concurrency ≈ 150 × 0.2 = 30
```

Tambahkan headroom:

```text
max connections to B = 40–60
```

Jika B melambat ke 2 detik:

```text
concurrency ≈ 150 × 2 = 300
```

Jika pool max 50, maka call ke B akan queue/fail fast. Ini bisa menyelamatkan service A. Jika pool unlimited, service A bisa collapse.

---

## 10. Timeout Engineering

Timeout adalah batas waktu menunggu. Tanpa timeout, failure menjadi resource leak.

Jenis timeout:

| Timeout | Makna |
|---|---|
| connect timeout | waktu maksimum membuka koneksi |
| connection acquisition timeout | waktu maksimum menunggu connection dari pool |
| request/read timeout | waktu maksimum menunggu response/data |
| write timeout | waktu maksimum mengirim request body |
| transaction timeout | batas waktu transaction DB |
| lock timeout | batas menunggu lock DB/application |
| end-to-end timeout | batas total dari client/API gateway |

## 10.1 Timeout Budget

Misalnya API contract:

```text
POST /cases/{id}/approve p95 <= 800 ms, hard timeout 2,000 ms
```

Budget:

```text
API gateway/request budget: 2000 ms
  auth/session lookup: 100 ms
  validation/domain: 50 ms
  DB transaction: 500 ms
  audit write: 100 ms
  outbox insert: 50 ms
  margin: 300 ms
  response serialization/network: 100 ms
```

Untuk dependency remote:

```text
external profile lookup budget: 300 ms
  connection acquisition: 50 ms
  connect: 100 ms
  read: 200 ms
```

Timeout harus nested:

```text
client timeout > gateway timeout > service timeout > dependency timeout
```

Tetapi jangan terlalu jauh. Jika upstream timeout 2s dan downstream timeout 30s, thread/resource tetap terpakai setelah client sudah pergi.

## 10.2 Timeout Terlalu Panjang

Timeout terlalu panjang menyebabkan:

- in-flight request menumpuk,
- pool penuh,
- memory retention,
- retry terlambat,
- user menunggu tanpa manfaat,
- failure detection lambat.

## 10.3 Timeout Terlalu Pendek

Timeout terlalu pendek menyebabkan:

- false failure,
- retry berlebihan,
- dependency menerima duplicate work,
- user experience buruk,
- lower effective throughput.

Timeout harus berdasarkan:

- latency distribution dependency,
- business criticality,
- user-facing SLA,
- retry count,
- capacity saat degraded,
- idempotency support.

---

## 11. Retry Engineering

Retry membantu untuk transient failure. Retry berbahaya untuk overload.

Retry cocok untuk:

- temporary network glitch,
- connection reset,
- 502/503 dari dependency yang recover cepat,
- optimistic locking dengan bounded attempts,
- idempotent command dengan idempotency key,
- rate-limited call jika ada server-specified retry-after dan request memang boleh ditunda.

Retry tidak cocok untuk:

- validation error,
- authorization error,
- deterministic business error,
- DB query lambat karena overload,
- dependency sudah saturated,
- non-idempotent command tanpa deduplication,
- long-running request tanpa cancellation.

## 11.1 Retry Amplification

Misalnya:

```text
original traffic = 1,000 RPS
retry attempts = 2 additional retries
```

Worst case:

```text
effective traffic = 3,000 RPS
```

Saat dependency sedang overload, retry bisa memperburuk overload.

## 11.2 Bounded Retry dengan Backoff dan Jitter

Contoh policy:

```text
max attempts: 3 total
initial delay: 100 ms
backoff: exponential
jitter: enabled
total retry budget: 500 ms
retry only: IOException, 502, 503, 504
never retry: 400, 401, 403, 404 business not found, validation error
```

Contoh Java sederhana:

```java
public <T> T retry(RetryableOperation<T> operation) {
    int attempts = 0;
    long delayMillis = 100;

    while (true) {
        attempts++;
        try {
            return operation.call();
        } catch (TransientDependencyException ex) {
            if (attempts >= 3) {
                throw ex;
            }

            sleepWithJitter(delayMillis);
            delayMillis = Math.min(delayMillis * 2, 500);
        }
    }
}
```

Production-grade system sebaiknya memakai library resilience yang observable dan configurable, bukan custom retry tersebar di semua service.

---

## 12. Backpressure

Backpressure adalah mekanisme agar producer tidak mengirim pekerjaan lebih cepat daripada consumer bisa memproses.

Bentuk backpressure:

- bounded queue,
- semaphore,
- caller-runs policy,
- HTTP 429/503,
- broker consumer pause,
- reactive streams demand,
- rate limiter,
- load shedding,
- circuit breaker open,
- bulkhead rejection.

Backpressure yang baik membuat overload terlihat sebagai sinyal cepat dan terkendali, bukan latency diam-diam.

```text
without backpressure:
  overload → queue grows → latency explodes → memory grows → collapse

with backpressure:
  overload → reject/slow producer → preserve core capacity
```

## 12.1 Bounded Queue as Backpressure

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    8,
    8,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(100),
    new ThreadPoolExecutor.AbortPolicy()
);
```

Jika queue penuh:

```java
try {
    executor.execute(task);
} catch (RejectedExecutionException ex) {
    throw new TooBusyException("case worker queue is full", ex);
}
```

Untuk HTTP API, mapping bisa menjadi:

```text
503 Service Unavailable
Retry-After: 2
```

Atau `429 Too Many Requests` jika overload disebabkan rate/admission policy.

## 12.2 Semaphore Bulkhead

```java
public final class BoundedClient {
    private final Semaphore semaphore;
    private final ExternalClient client;

    public BoundedClient(int maxConcurrency, ExternalClient client) {
        this.semaphore = new Semaphore(maxConcurrency);
        this.client = client;
    }

    public Response call(Request request) {
        boolean acquired = false;
        try {
            acquired = semaphore.tryAcquire(100, TimeUnit.MILLISECONDS);
            if (!acquired) {
                throw new TooBusyException("external client saturated");
            }
            return client.call(request);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RequestInterruptedException(e);
        } finally {
            if (acquired) {
                semaphore.release();
            }
        }
    }
}
```

Semaphore tetap berguna walaupun memakai virtual threads.

---

## 13. Bulkhead

Bulkhead membatasi blast radius. Jika satu area gagal, area lain tetap berjalan.

Tanpa bulkhead:

```text
all requests share same executor / connection pool / queue
slow report generation consumes all threads
case approval also fails
login also slow
```

Dengan bulkhead:

```text
case approval pool
report generation pool
email sending pool
external lookup pool
```

Atau:

```text
critical command: reserved concurrency 50
non-critical search: reserved concurrency 20
batch/export: reserved concurrency 5
```

## 13.1 Bulkhead by Dependency

```text
Profile Service bulkhead: 40 concurrent calls
Payment Service bulkhead: 20 concurrent calls
Notification Service bulkhead: 10 concurrent calls
```

Jika notification service lambat, profile/payment tidak ikut habis.

## 13.2 Bulkhead by Use Case

```text
interactive API: priority high
scheduled sync: priority medium
report export: priority low
```

Untuk regulatory platform, ini penting karena:

- approval/submission mungkin lebih kritikal daripada report export,
- audit write tidak boleh tertahan oleh bulk email,
- scheduler backlog tidak boleh menghabiskan pool interactive API.

---

## 14. Circuit Breaker

Circuit breaker mencegah service terus memanggil dependency yang sedang gagal.

State umum:

```text
CLOSED
  → calls allowed
  → failure rate high
OPEN
  → calls rejected fast
  → wait duration elapsed
HALF_OPEN
  → limited trial calls
  → success → CLOSED
  → failure → OPEN
```

Circuit breaker bukan pengganti timeout. Circuit breaker membutuhkan timeout/error signal untuk menentukan health dependency.

Gunakan circuit breaker jika:

- dependency remote bisa gagal lama,
- failure rate tinggi memperparah latency,
- fallback/rejection lebih baik daripada menunggu,
- service harus menjaga core function tetap hidup.

Hati-hati:

- breaker terlalu agresif menyebabkan false open,
- breaker terlalu longgar tidak melindungi,
- fallback bisa menyembunyikan data stale,
- half-open trial harus dibatasi.

---

## 15. Rate Limiting dan Load Shedding

Rate limiting membatasi laju request.

Contoh:

```text
max 300 requests/minute per API key
max 50 requests/second per tenant
max 20 export jobs/hour per agency
```

Load shedding membuang atau menolak pekerjaan saat sistem overload untuk menyelamatkan fungsi inti.

Perbedaan:

| Mechanism | Fokus |
|---|---|
| Rate limiting | fairness dan protection dari traffic berlebih |
| Backpressure | menahan producer agar consumer tidak collapse |
| Bulkhead | isolasi resource/blast radius |
| Circuit breaker | stop calling failing dependency |
| Load shedding | reject lower-priority work saat overload |

## 15.1 Priority-Aware Load Shedding

Contoh policy:

```text
If CPU > 85% and request queue > threshold:
  reject report export
  reject non-critical search
  allow case submission
  allow audit write
  allow health check/readiness only if service can really serve
```

Untuk sistem enterprise, load shedding harus eksplisit dan diaudit.

---

## 16. Head-of-Line Blocking

Head-of-line blocking terjadi saat pekerjaan lambat di depan menahan pekerjaan cepat di belakang.

Contoh:

```text
same executor handles:
  - report export 60 seconds
  - case status lookup 50 ms
```

Jika pool penuh report export, lookup ikut menunggu.

Solusi:

- separate executor,
- priority queue dengan hati-hati,
- async job untuk long-running task,
- admission control,
- pagination/streaming,
- timeout per task class,
- max concurrency per task type.

---

## 17. Tail Latency

Tail latency adalah latency pada percentile tinggi, misalnya p95, p99, p999.

User dan upstream sering merasakan tail, bukan average.

Penyebab tail latency:

- queueing,
- GC pause,
- lock contention,
- DB lock wait,
- cold cache,
- connection acquisition wait,
- CPU throttling,
- noisy neighbor,
- retry,
- slow dependency,
- large payload,
- synchronized bottleneck,
- uneven data distribution,
- long-running task bercampur dengan short task.

Untuk service orchestration, tail latency mengalikan risiko.

Jika request memanggil 5 dependency, masing-masing p99 500 ms, p99 end-to-end bisa jauh lebih buruk dari satu dependency.

---

## 18. Timeout, Retry, Circuit Breaker: Urutan yang Benar

Urutan desain defensible:

```text
1. Define end-to-end latency budget.
2. Define dependency-specific timeout.
3. Define retry only within remaining budget.
4. Define bulkhead/concurrency limit.
5. Define circuit breaker threshold.
6. Define fallback/rejection semantics.
7. Define metrics and alerts.
```

Jangan mulai dari retry.

Retry tanpa timeout dan idempotency adalah bug generator.

---

## 19. Service-Level Configuration Example

Contoh konfigurasi konseptual:

```yaml
service:
  latency-budget:
    case-approval: 2000ms
    case-search: 1000ms
    report-export-submit: 500ms

executors:
  case-command:
    type: platform
    threads: 32
    queue-capacity: 200
    rejection: fail-fast
  report-export:
    type: platform
    threads: 4
    queue-capacity: 20
    rejection: fail-fast
  notification:
    type: virtual
    max-concurrency: 50

http-clients:
  profile-service:
    max-concurrency: 40
    connect-timeout: 100ms
    request-timeout: 400ms
    retry:
      max-attempts: 2
      backoff: 100ms
      jitter: true
    circuit-breaker:
      failure-rate-threshold: 50
      slow-call-threshold: 300ms
  notification-service:
    max-concurrency: 10
    connect-timeout: 100ms
    request-timeout: 1000ms
    retry:
      max-attempts: 3
      backoff: exponential

jdbc:
  maximum-pool-size: 10
  connection-timeout: 1000ms
  transaction-timeout: 1500ms
```

Setiap angka harus punya alasan, bukan sekadar default.

---

## 20. Observability untuk Service Performance

Minimal metrics:

## 20.1 Request Metrics

- request rate,
- error rate,
- latency histogram,
- p50/p90/p95/p99,
- status code,
- endpoint/use-case label,
- tenant/agency label dengan cardinality hati-hati.

## 20.2 Executor Metrics

- active threads,
- pool size,
- queue size,
- completed task count,
- rejected task count,
- task execution time,
- task queue wait time.

## 20.3 JDBC Pool Metrics

- active connections,
- idle connections,
- pending threads,
- connection acquisition time,
- timeout count,
- max pool size,
- connection usage duration.

## 20.4 HTTP Client Metrics

- request count per dependency,
- latency per dependency,
- connect time,
- pool acquisition time,
- error by type,
- timeout count,
- retry count,
- circuit breaker state,
- bulkhead rejection.

## 20.5 JVM/System Metrics

- CPU utilization,
- CPU throttling,
- memory RSS,
- heap used,
- allocation rate,
- GC pause,
- thread count,
- virtual thread count if available,
- safepoint time,
- native memory,
- file descriptor count.

## 20.6 Queue/Async Metrics

- consumer lag,
- queue depth,
- DLQ count,
- retry count,
- message age,
- processing time,
- handler error rate.

---

## 21. Diagnostic Playbook: p99 Naik tapi CPU Normal

Gejala:

```text
p99 latency naik dari 800 ms ke 8 seconds
CPU service 45%
heap normal
GC normal
error rate mulai naik
```

Jangan simpulkan “bukan aplikasi karena CPU normal”.

Langkah diagnosis:

## 21.1 Cek Request Distribution

```text
endpoint mana yang naik?
semua endpoint atau subset?
read atau write?
tenant tertentu?
payload besar?
```

## 21.2 Cek Queueing

```text
executor queue naik?
active thread max?
request server queue?
message lag?
```

## 21.3 Cek Connection Pool

```text
Hikari active max?
idle 0?
pending threads naik?
acquisition time naik?
```

## 21.4 Cek Dependency

```text
HTTP dependency latency naik?
retry count naik?
circuit breaker open?
timeout meningkat?
```

## 21.5 Cek DB

```text
DB CPU?
lock wait?
slow query?
connection count?
transaction duration?
```

## 21.6 Cek Thread Dump

Cari pola:

```text
many threads waiting on HikariPool.getConnection
many threads blocked on same lock
many threads waiting on HTTP client response
many threads doing JSON serialization
many threads parked in CompletableFuture.get
```

## 21.7 Ambil JFR/Profile

Gunakan JFR untuk:

- socket read,
- file IO,
- lock contention,
- allocation,
- method profiling,
- GC pause,
- thread park/block.

Gunakan async-profiler wall-clock jika banyak waiting.

---

## 22. Anti-Pattern Besar

## 22.1 Menaikkan Semua Pool Size

Buruk:

```text
increase Tomcat threads
increase Hikari pool
increase HTTP max connection
increase consumer concurrency
```

Tanpa mengetahui bottleneck, ini bisa memperbesar traffic ke dependency.

## 22.2 Timeout Default

Banyak library punya timeout default yang terlalu panjang atau bahkan tidak ada. Ini tidak acceptable untuk production.

## 22.3 Retry Semua Exception

Buruk:

```java
catch (Exception e) {
    retry();
}
```

Ini me-retry validation error, auth error, dan business error.

## 22.4 Shared Executor untuk Semua Use Case

Batch, report, email, API request, dan scheduler memakai executor sama. Satu workload lambat menjatuhkan yang lain.

## 22.5 Unbounded Queue

Unbounded queue menyembunyikan overload sampai menjadi OOM atau latency collapse.

## 22.6 Blocking di Common Pool

`CompletableFuture.supplyAsync()` tanpa executor untuk blocking IO adalah sumber performance interference.

## 22.7 Remote Call dalam Transaction

Ini memperpanjang DB connection hold time dan lock duration.

## 22.8 Virtual Threads Tanpa Resource Limit

Virtual threads memungkinkan banyak concurrency. Tanpa limiter, dependency bisa menerima pressure jauh lebih besar.

## 22.9 Average Latency sebagai SLO

Average latency menyembunyikan tail. Pakai percentile/histogram.

---

## 23. Java 8–25 Compatibility Notes

## Java 8

- Tidak ada virtual threads.
- Banyak sistem enterprise masih memakai platform thread + executor.
- `CompletableFuture` tersedia, tetapi default common pool harus hati-hati.
- Gunakan bounded executor eksplisit.
- HikariCP, Resilience4j, Micrometer versi kompatibel harus dipilih sesuai baseline.

## Java 11

- Baseline modern lama untuk enterprise.
- HTTP Client standar Java tersedia sejak Java 11.
- Masih platform-thread centric.
- Container support lebih baik daripada Java 8 update lama.

## Java 17

- Baseline modern kuat untuk Spring Boot 3.x/Jakarta modern.
- JFR/JDK diagnostics matang.
- Banyak library modern mulai menjadikan Java 17 sebagai baseline.

## Java 21

- Virtual threads menjadi fitur final.
- Blocking-style server code bisa jauh lebih scalable jika dependency limit benar.
- Structured concurrency masih perlu memperhatikan status preview/inkubasi pada versi tertentu.

## Java 25

- Perlakukan sebagai baseline modern untuk JVM diagnostics dan virtual thread era.
- Tetap gunakan prinsip sama: virtual threads bukan pengganti timeout, bulkhead, connection pool, dan backpressure.

---

## 24. Practical Design Framework

Saat mendesain service Java, isi tabel ini.

| Area | Pertanyaan |
|---|---|
| Workload | CPU-bound, IO-bound, mixed, batch, interactive? |
| Latency budget | Berapa p95/p99 dan hard timeout? |
| Throughput target | Berapa RPS/message per second? |
| Concurrency estimate | `throughput × latency` berapa? |
| Critical dependency | DB, HTTP service, Redis, broker? |
| Limiter | Thread pool, semaphore, connection pool, rate limiter? |
| Queue boundary | Berapa queue max dan queue wait max? |
| Timeout | Connect/read/acquire/transaction timeout? |
| Retry | Error apa yang boleh retry? Berapa total budget? |
| Bulkhead | Workload/dependency mana harus diisolasi? |
| Degradation | Fail fast, fallback, stale data, async job? |
| Observability | Metric apa yang membuktikan policy bekerja? |

---

## 25. Example: Case Approval Service

Scenario:

```text
POST /cases/{id}/approve
```

Steps:

1. Validate command.
2. Load case.
3. Check permission.
4. Update state.
5. Write audit.
6. Insert outbox event.
7. Return response.

Design:

```text
hard timeout: 2s
DB transaction target: <= 500ms
JDBC pool per pod: 10
case command executor: 32 threads, queue 200
remote notification: outbox async, not inside transaction
retry: no retry for approval command itself unless idempotency key exists
outbox publish retry: bounded retry with DLQ
```

Bad design:

```text
approval transaction calls notification API synchronously
Hikari pool 50 per pod × 20 pods = 1000 possible DB connections
HTTP notification timeout 30s
retry 3 times inside transaction
unbounded executor queue
```

Good design:

```text
approval transaction only mutates DB + audit + outbox
notification async with separate bulkhead
short DB transaction timeout
bounded command executor
idempotency key for duplicate approval request
metrics for pool acquisition, transaction duration, outbox lag
```

---

## 26. Load Test Validation

Untuk membuktikan konfigurasi service, load test harus mengukur:

- endpoint latency p50/p95/p99,
- error rate,
- executor queue,
- Hikari active/idle/pending,
- dependency latency,
- retry count,
- circuit breaker state,
- CPU/memory/GC,
- DB CPU/wait/lock,
- queue lag,
- timeout/rejection count.

Test scenarios:

## 26.1 Normal Load

```text
Expected traffic × 1.0
```

Validasi:

- no saturation,
- p95/p99 within SLO,
- queue stable,
- pool not constantly maxed.

## 26.2 Peak Load

```text
Expected peak × 1.5
```

Validasi:

- graceful degradation,
- rejection controlled,
- no retry storm,
- core use cases preserved.

## 26.3 Dependency Slowdown

Inject dependency latency:

```text
Profile service p95 from 100ms → 2s
```

Validasi:

- bulkhead limits impact,
- timeout triggers,
- circuit breaker opens if needed,
- unrelated endpoints remain healthy.

## 26.4 DB Slow Query

Inject slow DB query/lock.

Validasi:

- Hikari pending visible,
- transaction timeout works,
- approval does not hang indefinitely,
- lock wait observable.

## 26.5 Retry Storm Test

Force transient 503.

Validasi:

- retry bounded,
- jitter applied,
- effective traffic does not explode,
- circuit breaker protects dependency.

---

## 27. Review Checklist

Sebelum production, tanyakan:

```text
[ ] Apakah semua external call punya timeout?
[ ] Apakah timeout lebih kecil dari upstream request budget?
[ ] Apakah retry hanya untuk transient retryable errors?
[ ] Apakah retry total duration masuk latency budget?
[ ] Apakah command non-idempotent dilindungi idempotency key/dedup?
[ ] Apakah queue bounded?
[ ] Apakah rejection behavior eksplisit?
[ ] Apakah thread pool dipisahkan untuk workload lambat/berat?
[ ] Apakah common pool tidak dipakai untuk blocking IO?
[ ] Apakah JDBC pool dihitung global terhadap jumlah pod?
[ ] Apakah remote call tidak dilakukan di dalam DB transaction?
[ ] Apakah virtual thread tetap dilindungi semaphore/connection/rate limiter?
[ ] Apakah bulkhead per dependency/use case tersedia?
[ ] Apakah metrics pool/queue/timeout/retry/circuit breaker tersedia?
[ ] Apakah load test mencakup dependency slowdown?
[ ] Apakah p99 dipakai, bukan average saja?
```

---

## 28. Top 1% Engineer Notes

Engineer biasa bertanya:

```text
Berapa thread pool yang bagus?
```

Engineer kuat bertanya:

```text
Workload ini CPU-bound atau IO-bound?
Apa latency budget-nya?
Berapa arrival rate-nya?
Apa bottleneck dependency-nya?
Berapa concurrency sehat downstream?
Apa yang terjadi saat downstream melambat?
Apakah queue ini menyembunyikan overload?
Apa rejection semantics-nya?
Apa metric yang membuktikan ini benar?
```

Engineer biasa menaikkan pool.

Engineer kuat membatasi concurrency, menurunkan timeout, menghapus remote call dari transaction, mengisolasi workload, dan membuktikan hasilnya dengan load test.

Engineer biasa melihat CPU.

Engineer kuat melihat:

```text
latency histogram
queue length
pool pending
retry amplification
dependency saturation
DB wait event
thread dump
JFR socket/lock/park events
```

---

## 29. Summary

Service Java performance bukan hanya soal kode cepat atau GC tuning. Banyak incident production terjadi karena desain runtime yang tidak punya batas:

- thread pool terlalu besar/kecil,
- queue unbounded,
- connection pool salah sizing,
- timeout default,
- retry tanpa budget,
- remote call di dalam transaction,
- common pool dipakai blocking IO,
- virtual threads dipakai tanpa resource limiter,
- tail latency tidak diamati,
- dependency slowdown tidak diuji.

Mental model inti:

```text
Performance service = workload × queueing × resource limits × dependency behavior × failure policy
```

Prinsip paling penting:

```text
Bound everything.
Measure waiting time.
Protect downstream.
Fail fast when useful.
Retry only with budget and idempotency.
Separate critical from non-critical work.
Validate under degraded conditions.
```

Setelah part ini, kita siap masuk ke **Part 030 — Performance Regression Pipeline: CI Benchmark, Baseline, Threshold, and Release Gate**.

Status seri: **belum selesai**.  
Progress: **Part 029 dari 031 selesai**.

---

## Referensi

- Oracle Java SE 25 Documentation — Virtual Threads.
- Oracle Java SE 25 Documentation — Java Flight Recorder and diagnostics.
- OpenJDK JEP 444 — Virtual Threads.
- HikariCP Documentation and Wiki — Pool sizing and configuration.
- Resilience4j Documentation — Retry, TimeLimiter, Bulkhead, RateLimiter, CircuitBreaker.
- Little's Law / queueing theory references.
- Martin Thompson / Mechanical Sympathy discussions on latency, queueing, and coordinated omission.
- Brendan Gregg — Systems performance and latency analysis concepts.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 028 — Performance Engineering for Java Code: Allocation, Collections, Strings, IO, Serialization](./learn-java-testing-benchmarking-performance-jvm-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Performance Regression Pipeline: CI Benchmark, Baseline, Threshold, and Release Gate](./learn-java-testing-benchmarking-performance-jvm-part-030.md)

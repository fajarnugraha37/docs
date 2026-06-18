# Part 27 — Backpressure, Rate Limiting, Bulkhead, Circuit Breaker, and Adaptive Protection

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `027-backpressure-rate-limiting-bulkhead-circuit-breaker-adaptive-protection.md`  
> Target: Java 8–25  
> Level: Advanced / production systems engineering

---

## 0. Posisi Materi Ini Dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- TCP dan socket sebagai resource nyata.
- DNS dan endpoint discovery.
- HTTP/1.1, HTTP/2, HTTP/3, WebSocket.
- JDK `HttpClient`, Apache, OkHttp, Netty, gRPC.
- timeout, retry, idempotency, pooling.
- concurrency model: blocking, async, reactive, virtual threads.

Bagian ini menyatukan semua itu ke satu pertanyaan produksi yang sangat penting:

> Bagaimana Java service tetap hidup ketika dunia luar lebih lambat, lebih ramai, lebih rusak, atau lebih tidak stabil daripada asumsi desain awal?

Topik ini sering disebut resilience, tetapi istilah itu terlalu luas. Di sini kita fokus ke lima mekanisme proteksi utama:

1. **Backpressure** — jangan menerima/menghasilkan lebih cepat daripada kemampuan downstream.
2. **Rate limiting** — batasi laju permintaan.
3. **Bulkhead** — pisahkan kapasitas agar satu dependency/user/workload tidak menenggelamkan semuanya.
4. **Circuit breaker** — berhenti sementara memanggil dependency yang sedang rusak/lambat.
5. **Adaptive protection** — ubah limit secara dinamis berdasarkan sinyal runtime.

Mental model utamanya:

```text
A networked Java service is not stable because it is fast.
It is stable because it has explicit limits, explicit rejection, explicit isolation,
and explicit recovery behavior.
```

---

## 1. Kenapa Proteksi Ini Dibutuhkan?

Misalkan service A memanggil service B.

```text
Client -> Service A -> Service B -> Database
```

Saat B sehat, semua terlihat normal:

```text
RPS masuk      : 500/s
Latency B p95  : 80 ms
Concurrency A->B ≈ RPS × latency = 500 × 0.08 = 40 in-flight
```

Sekarang B melambat:

```text
RPS masuk      : 500/s
Latency B p95  : 3 s
Concurrency A->B ≈ 500 × 3 = 1500 in-flight
```

Tanpa limit eksplisit, efeknya berantai:

```text
B lambat
-> request A menumpuk
-> thread/virtual thread/task menumpuk
-> connection pool penuh
-> heap naik karena request context/body/response buffer
-> GC pressure naik
-> latency A naik
-> client retry
-> traffic makin naik
-> A ikut jatuh
-> sistem terlihat seperti outage total
```

Masalah utama bukan hanya dependency gagal. Masalah utamanya adalah **kegagalan dependency diubah menjadi konsumsi resource tanpa batas di caller**.

---

## 2. Prinsip Dasar: Semua Resource Harus Punya Batas

Top 1% engineer tidak bertanya hanya:

> Berapa timeout-nya?

Mereka bertanya:

```text
Berapa concurrency maksimum?
Berapa queue maksimum?
Berapa memory per request?
Berapa body size maksimum?
Berapa retry budget?
Berapa connection budget?
Berapa RPS maksimum per tenant/user/caller?
Apa yang direject lebih dulu?
Apa error contract untuk rejection?
Apa metrik yang membuktikan limit bekerja?
```

Setiap sistem networked punya resource terbatas:

| Resource | Contoh limit nyata |
|---|---|
| CPU | worker thread, event loop, crypto/TLS, serialization |
| memory | request body, response body, queue, protobuf object graph |
| connection | HTTP pool, gRPC channel streams, DB pool, file descriptor |
| time | deadline, timeout, SLA/SLO |
| external capacity | downstream rate limit, DB IOPS, third-party quota |
| human/operational | ability to debug, support, replay, audit |

Jika limit tidak eksplisit, limit tetap ada — hanya muncul dalam bentuk yang buruk:

```text
OutOfMemoryError
GC storm
connection timeout
thread starvation
502/503/504 spike
pod restart loop
DB connection exhaustion
ephemeral port exhaustion
unbounded queue latency
```

---

## 3. Little’s Law Sebagai Mental Model Kapasitas

Rumus sederhana yang sangat kuat:

```text
L = λ × W
```

Di mana:

```text
L = jumlah work in-flight / concurrency
λ = arrival rate / throughput
W = response time / latency
```

Contoh:

```text
arrival rate = 200 request/s
latency avg  = 100 ms = 0.1 s
in-flight    = 200 × 0.1 = 20
```

Jika latency naik menjadi 2 detik:

```text
in-flight = 200 × 2 = 400
```

Artinya latency yang naik 20x menyebabkan concurrency yang dibutuhkan naik 20x juga, jika arrival rate tidak dikurangi.

Inilah alasan timeout, bulkhead, rate limit, dan circuit breaker harus dilihat sebagai satu sistem:

```text
latency naik
-> concurrency naik
-> queue naik
-> timeout naik
-> retry naik
-> concurrency naik lagi
```

Tanpa proteksi, sistem masuk feedback loop negatif.

---

## 4. Backpressure

### 4.1 Definisi

Backpressure adalah mekanisme agar producer tidak mengirim lebih banyak daripada yang bisa diproses consumer.

```text
Fast producer -> bounded buffer / demand signal -> slower consumer
```

Backpressure bukan sekadar “menolak request”. Itu salah satu bentuknya. Backpressure bisa berupa:

- blocking producer.
- memperlambat producer.
- menolak request baru.
- mengurangi concurrency.
- mengirim `429 Too Many Requests`.
- mengirim `503 Service Unavailable`.
- menghentikan read dari socket sementara.
- reactive demand signal.
- gRPC manual flow control.
- TCP receive window.

### 4.2 Backpressure Di Banyak Layer

```text
Application queue
-> thread pool queue
-> connection pool queue
-> HTTP/2 stream window
-> TCP socket buffer
-> network device queue
-> remote server queue
```

Jika application layer tidak punya batas, backpressure biasanya pindah ke layer yang lebih buruk:

```text
unbounded application queue
-> heap pressure
-> GC storm
-> crash
```

atau:

```text
no app-level limit
-> socket buffer fills
-> write blocks
-> virtual threads pile up
-> memory grows
```

### 4.3 Backpressure vs Buffering

Buffering sering disalahartikan sebagai solusi.

```text
Buffering buys time.
Backpressure controls demand.
```

Buffer tanpa limit hanya menunda kegagalan.

```java
// Buruk: unbounded queue
ExecutorService executor = Executors.newFixedThreadPool(50);
for (Task task : tasks) {
    executor.submit(() -> callRemote(task));
}
```

`newFixedThreadPool` memakai unbounded `LinkedBlockingQueue`. Jika downstream lambat, queue bisa tumbuh sangat besar.

Lebih aman:

```java
int workers = 50;
int queueSize = 500;

ThreadPoolExecutor executor = new ThreadPoolExecutor(
        workers,
        workers,
        0L,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(queueSize),
        new ThreadPoolExecutor.AbortPolicy()
);
```

Sekarang sistem punya keputusan eksplisit:

```text
Jika 50 worker penuh dan 500 queue penuh,
request berikutnya ditolak daripada heap terus naik.
```

### 4.4 Backpressure Dalam Java Blocking Model

Dalam blocking model, backpressure sering berupa:

```text
bounded queue
bounded thread pool
bounded semaphore
bounded connection pool
bounded request body size
bounded response body size
```

Contoh semaphore bulkhead:

```java
public final class BoundedRemoteClient {
    private final Semaphore permits;
    private final HttpClient httpClient;

    public BoundedRemoteClient(int maxConcurrent, HttpClient httpClient) {
        this.permits = new Semaphore(maxConcurrent);
        this.httpClient = httpClient;
    }

    public HttpResponse<String> call(HttpRequest request, Duration acquireTimeout)
            throws Exception {
        boolean acquired = permits.tryAcquire(acquireTimeout.toMillis(), TimeUnit.MILLISECONDS);
        if (!acquired) {
            throw new RejectedExecutionException("remote dependency bulkhead full");
        }

        try {
            return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } finally {
            permits.release();
        }
    }
}
```

Ini sederhana, tetapi sangat kuat.

### 4.5 Backpressure Dengan Virtual Threads

Virtual threads membuat blocking lebih murah, tetapi tidak membuat resource downstream tidak terbatas.

Buruk:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request r : requests) {
        executor.submit(() -> callRemote(r));
    }
}
```

Jika `requests` berisi 100.000 item dan remote lambat, kamu bisa membuat 100.000 in-flight operation.

Lebih aman:

```java
Semaphore permits = new Semaphore(200);

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request r : requests) {
        executor.submit(() -> {
            if (!permits.tryAcquire(100, TimeUnit.MILLISECONDS)) {
                throw new RejectedExecutionException("too many concurrent remote calls");
            }
            try {
                return callRemote(r);
            } finally {
                permits.release();
            }
        });
    }
}
```

Virtual threads mengubah cost model thread, bukan hukum kapasitas network.

### 4.6 Backpressure Dalam Reactive Streams

Reactive Streams punya konsep `request(n)`.

```text
subscriber says: I can handle n more items
publisher sends at most n items
```

Ini demand-driven.

Namun backpressure reactive hanya efektif jika semua layer menghormatinya. Jika kamu menaruh blocking call atau unbounded buffering di tengah pipeline, backpressure bisa rusak.

Anti-pattern:

```java
Flux.range(1, 1_000_000)
    .flatMap(i -> Mono.fromCallable(() -> blockingRemoteCall(i)))
```

Tanpa concurrency limit, `flatMap` bisa membuat terlalu banyak work.

Lebih aman:

```java
Flux.range(1, 1_000_000)
    .flatMap(i -> Mono.fromCallable(() -> blockingRemoteCall(i))
                      .subscribeOn(Schedulers.boundedElastic()),
             100) // concurrency limit
```

### 4.7 Backpressure Dalam Netty

Netty punya sinyal writability:

```java
@Override
public void channelWritabilityChanged(ChannelHandlerContext ctx) {
    if (ctx.channel().isWritable()) {
        // resume producing
    } else {
        // stop producing or slow down
    }
    ctx.fireChannelWritabilityChanged();
}
```

Key idea:

```text
Do not keep writing blindly when the channel is not writable.
```

Jika kamu terus `writeAndFlush` ke slow client, outbound buffer bisa tumbuh dan memory pressure naik.

### 4.8 Backpressure Dalam gRPC Streaming

gRPC Java menyediakan `CallStreamObserver.isReady()` dan `setOnReadyHandler()` untuk manual outbound flow control.

Mental model:

```text
onNext() is not a license to push infinite messages.
It must be guarded by readiness, queue bound, cancellation, and deadline.
```

Pola aman:

```java
public void streamItems(Request request, StreamObserver<Item> responseObserver) {
    ServerCallStreamObserver<Item> out =
            (ServerCallStreamObserver<Item>) responseObserver;

    Queue<Item> queue = new ArrayDeque<>();
    AtomicBoolean cancelled = new AtomicBoolean(false);

    out.setOnCancelHandler(() -> cancelled.set(true));

    out.setOnReadyHandler(() -> {
        while (out.isReady() && !queue.isEmpty() && !cancelled.get()) {
            out.onNext(queue.poll());
        }
    });

    // Producer must also be bounded; do not fill queue infinitely.
}
```

---

## 5. Rate Limiting

### 5.1 Definisi

Rate limiting membatasi laju request dalam satuan waktu.

```text
max 100 request/second
max 1000 request/minute per tenant
max 10 login attempts/minute per user
max 50 external API calls/minute per service instance
```

Rate limit menjawab:

```text
How fast may work enter the system?
```

Bulkhead menjawab:

```text
How many may run at the same time?
```

Keduanya berbeda.

### 5.2 Rate Limit vs Concurrency Limit

| Mekanisme | Mengontrol | Cocok untuk |
|---|---|---|
| Rate limit | request per time window | quota, abuse protection, third-party API limit |
| Concurrency limit | in-flight work | latency spike, slow dependency, capacity protection |

Contoh:

```text
Rate limit 100/s tidak cukup jika setiap request tiba-tiba butuh 30 detik.
Concurrency tetap bisa meledak menjadi 3000.
```

Sebaliknya:

```text
Concurrency limit 100 tidak cukup jika request sangat cepat tetapi external vendor membatasi 1000/minute.
```

### 5.3 Fixed Window

```text
Minute 10:00: 1000 allowed
Minute 10:01: 1000 allowed
```

Mudah, tetapi punya boundary burst:

```text
999 request at 10:00:59
999 request at 10:01:00
= hampir 2000 request dalam 2 detik
```

### 5.4 Sliding Window

Sliding window memperhalus boundary.

```text
count requests in last 60 seconds
```

Lebih adil, sedikit lebih mahal.

### 5.5 Token Bucket

Token bucket memberi token dengan rate tertentu dan mengizinkan burst sampai kapasitas bucket.

```text
bucket capacity = 100
refill rate     = 10 tokens/second
request cost    = 1 token
```

Jika bucket penuh, burst 100 bisa lewat. Setelah itu rate stabil 10/s.

Pseudo-code:

```java
public final class SimpleTokenBucket {
    private final long capacity;
    private final long refillTokensPerSecond;
    private long tokens;
    private long lastRefillNanos;

    public SimpleTokenBucket(long capacity, long refillTokensPerSecond) {
        this.capacity = capacity;
        this.refillTokensPerSecond = refillTokensPerSecond;
        this.tokens = capacity;
        this.lastRefillNanos = System.nanoTime();
    }

    public synchronized boolean tryAcquire() {
        refill();
        if (tokens <= 0) {
            return false;
        }
        tokens--;
        return true;
    }

    private void refill() {
        long now = System.nanoTime();
        long elapsedNanos = now - lastRefillNanos;
        long refill = elapsedNanos * refillTokensPerSecond / 1_000_000_000L;
        if (refill > 0) {
            tokens = Math.min(capacity, tokens + refill);
            lastRefillNanos = now;
        }
    }
}
```

Production implementation harus mempertimbangkan:

- clock behavior.
- concurrency.
- distributed limit.
- per-key cardinality.
- memory cleanup.
- cost per request.
- burst policy.

### 5.6 Leaky Bucket

Leaky bucket memproses request dengan rate konstan.

```text
incoming burst -> queue -> drain at fixed rate
```

Cocok untuk smoothing, tetapi queue harus bounded.

Jika queue tidak bounded, leaky bucket berubah menjadi latency amplifier.

### 5.7 Rate Limit Response Contract

Untuk HTTP:

```text
429 Too Many Requests
Retry-After: 5
Content-Type: application/problem+json
```

Contoh body:

```json
{
  "type": "https://example.com/problems/rate-limit-exceeded",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "Too many requests for tenant T-123.",
  "limit": 1000,
  "window": "PT1M",
  "retryAfterSeconds": 5,
  "correlationId": "..."
}
```

Untuk gRPC:

```text
RESOURCE_EXHAUSTED
```

dengan metadata/trailer yang menjelaskan retry-after jika tersedia.

### 5.8 Per-Tenant / Per-User / Per-Dependency Limit

Rate limit harus ditempatkan sesuai risiko.

```text
per IP          -> abuse protection kasar
per user        -> login/API abuse
per tenant      -> fairness multi-tenant
per endpoint    -> expensive operation protection
per dependency  -> third-party quota protection
per node        -> local safety
cluster-wide    -> global quota
```

Dalam sistem regulatory/case management, per-tenant/per-agency/per-module limit sering lebih masuk akal daripada global limit tunggal.

---

## 6. Bulkhead

### 6.1 Definisi

Bulkhead berasal dari kapal: ruang-ruang dipisahkan agar kebocoran satu ruang tidak menenggelamkan seluruh kapal.

Dalam software:

```text
Pisahkan resource agar satu dependency, endpoint, tenant, atau workload tidak menghabiskan seluruh kapasitas service.
```

### 6.2 Tanpa Bulkhead

```text
API A: cheap read
API B: expensive export
API C: external vendor call
```

Jika semuanya memakai thread pool dan connection pool yang sama:

```text
export lambat
-> thread pool penuh
-> cheap read ikut lambat
-> health check ikut lambat
-> pod dianggap unhealthy
-> restart
-> makin buruk
```

### 6.3 Jenis Bulkhead

| Bulkhead | Bentuk |
|---|---|
| Thread pool bulkhead | worker pool terpisah |
| Semaphore bulkhead | limit in-flight tanpa queue besar |
| Connection pool bulkhead | pool per dependency/route |
| Queue bulkhead | queue per workload |
| CPU bulkhead | workload scheduling / separate deployment |
| Tenant bulkhead | quota per tenant |
| Endpoint bulkhead | limit per operation |
| Process/pod bulkhead | deployment terpisah |

### 6.4 Semaphore Bulkhead

Cocok untuk blocking atau virtual-thread code.

```java
public final class DependencyBulkhead {
    private final Semaphore semaphore;

    public DependencyBulkhead(int maxConcurrent) {
        this.semaphore = new Semaphore(maxConcurrent);
    }

    public <T> T execute(Callable<T> action) throws Exception {
        if (!semaphore.tryAcquire()) {
            throw new RejectedExecutionException("bulkhead full");
        }
        try {
            return action.call();
        } finally {
            semaphore.release();
        }
    }
}
```

Kelebihan:

- sederhana.
- murah.
- cocok dengan virtual threads.
- queue tidak tersembunyi.

Kekurangan:

- tidak memberi worker isolation.
- caller tetap menjalankan kerja.
- perlu policy rejection jelas.

### 6.5 Thread Pool Bulkhead

Cocok jika kamu perlu isolasi worker.

```java
ThreadPoolExecutor vendorExecutor = new ThreadPoolExecutor(
        20,
        20,
        0,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(200),
        new ThreadPoolExecutor.AbortPolicy()
);
```

Kelebihan:

- dependency lambat tidak memakai worker umum.
- queue bisa dipantau.
- bisa diberi timeout acquisition.

Kekurangan:

- tuning lebih kompleks.
- queue bisa menyebabkan latency tinggi.
- tidak cocok jika terlalu banyak dependency masing-masing punya pool besar.

### 6.6 Bulkhead Per Dependency

Jangan semua outbound call memakai satu pool/limit.

Lebih baik:

```text
onemapClientBulkhead        max 50
paymentClientBulkhead       max 20
notificationClientBulkhead  max 30
reportExportBulkhead        max 5
```

Kenapa?

```text
Jika notification vendor lambat, OneMap lookup tetap berjalan.
Jika report export berat, normal case search tetap jalan.
```

### 6.7 Bulkhead Per Workload

Contoh case management:

```text
interactive user request  -> low latency, small concurrency, high priority
batch remediation job     -> large volume, lower priority, separate pool
report export             -> low concurrency, streaming, cancelable
external sync             -> rate-limited, retryable, idempotent
```

Jangan campur semua dalam satu executor.

---

## 7. Circuit Breaker

### 7.1 Definisi

Circuit breaker mencegah caller terus memanggil dependency yang sedang gagal/lambat.

State umum:

```text
CLOSED      -> calls allowed, metrics collected
OPEN        -> calls rejected fast
HALF_OPEN   -> limited trial calls to test recovery
```

Diagram:

```text
          failures exceed threshold
CLOSED ----------------------------> OPEN
  ^                                    |
  |                                    | wait duration elapsed
  | success threshold                  v
  +------------------------------ HALF_OPEN
          trial calls succeed/fail
```

### 7.2 Circuit Breaker Bukan Retry

Retry:

```text
Try again because this attempt may be transient.
```

Circuit breaker:

```text
Stop trying because recent evidence says calls are likely harmful.
```

### 7.3 Failure Rate vs Slow Call Rate

Circuit breaker modern tidak hanya melihat error. Ia juga melihat latency.

```text
failure rate > 50%
slow call rate > 70%
slow call threshold > 2s
minimum calls in window >= 100
```

Kenapa slow call penting?

```text
Dependency yang tidak error tetapi sangat lambat tetap bisa membunuh caller.
```

### 7.4 Sliding Window

Circuit breaker biasanya memakai count-based atau time-based sliding window.

```text
count-based: last 100 calls
time-based : last 60 seconds
```

Minimum sample penting.

Buruk:

```text
1 call gagal dari 1 call => failure rate 100% => open
```

Lebih baik:

```text
minimumNumberOfCalls = 50
failureRateThreshold = 50%
```

### 7.5 Half-Open Trial

Saat breaker open cukup lama, masuk half-open.

```text
allow 5 trial calls
if 5 succeed -> close
if some fail/slow -> open again
```

Half-open harus dibatasi. Jika 1000 caller langsung mengirim trial call, recovery dependency bisa langsung dihancurkan lagi.

### 7.6 Apa Yang Dihitung Sebagai Failure?

Tidak semua error harus membuka breaker.

Biasanya dihitung failure:

```text
connect timeout
read/request timeout
tls handshake failure
connection reset
HTTP 502/503/504
HTTP 429 sometimes, depending policy
gRPC UNAVAILABLE
gRPC DEADLINE_EXCEEDED
gRPC RESOURCE_EXHAUSTED sometimes
```

Biasanya bukan failure dependency:

```text
HTTP 400 invalid request
HTTP 401 auth failure due to caller token
HTTP 403 authorization denied
HTTP 404 valid not found
gRPC INVALID_ARGUMENT
gRPC PERMISSION_DENIED
gRPC NOT_FOUND
```

Tapi domain matters.

### 7.7 Fallback Dengan Hati-Hati

Fallback sering terdengar menarik:

```text
Jika service B gagal, pakai cache.
Jika payment gagal, anggap sukses? Tidak boleh.
```

Fallback aman jika:

- stale data diterima secara bisnis.
- error tidak disembunyikan dari audit.
- user diberi status jelas.
- fallback tidak memicu dependency lain yang lebih buruk.
- fallback tidak menghasilkan keputusan regulatory yang salah.

Contoh aman:

```text
Address enrichment service gagal -> user bisa input manual.
Notification service gagal -> simpan pending notification untuk retry async.
Recommendation gagal -> tampilkan default ordering.
```

Contoh berbahaya:

```text
Eligibility check gagal -> approve otomatis.
Identity verification gagal -> lanjut tanpa flag.
Payment capture gagal -> mark paid.
```

### 7.8 Circuit Breaker Placement

Circuit breaker biasanya ditempatkan di client boundary:

```text
Application service
-> typed dependency client
-> resilience wrapper
-> HTTP/gRPC client
```

Jangan menyebar breaker logic di setiap business method.

```java
public final class SafeVendorClient {
    private final VendorClient delegate;
    private final CircuitBreaker breaker;

    public VendorResponse call(VendorRequest request) {
        Supplier<VendorResponse> protectedCall =
                CircuitBreaker.decorateSupplier(breaker, () -> delegate.call(request));
        return protectedCall.get();
    }
}
```

### 7.9 Circuit Breaker Anti-Patterns

```text
one global breaker for all dependencies
breaker opens on validation errors
breaker hides real error with fake success
breaker has no metrics
breaker has no per-method separation
half-open allows too many trial calls
retry is outside breaker and amplifies calls
breaker timeout longer than caller deadline
breaker state not visible in dashboard
```

---

## 8. Adaptive Protection

### 8.1 Kenapa Static Limit Tidak Cukup?

Static limit:

```text
max concurrent calls = 100
```

Masalah:

- kapasitas dependency berubah saat autoscaling.
- latency berubah karena DB/cache/network.
- traffic mix berubah.
- payload size berubah.
- node capacity berbeda.
- satu angka aman saat normal bisa terlalu tinggi saat partial outage.
- satu angka aman saat outage bisa terlalu rendah saat sistem sehat.

Adaptive protection mencoba menjawab:

```text
Can the system learn a safer concurrency level from observed latency/error?
```

### 8.2 Adaptive Concurrency Limit

Sinyal umum:

```text
latency baseline
current latency
queueing signal
timeout/rejection rate
in-flight count
success/failure rate
```

Jika latency naik tajam, sistem mengurangi concurrency.

```text
latency healthy -> increase limit carefully
latency queuing -> reduce limit quickly
```

Mental model:

```text
Concurrency limit is a control loop.
```

### 8.3 AIMD

AIMD = Additive Increase, Multiplicative Decrease.

```text
success/healthy -> limit = limit + 1
failure/queueing -> limit = limit × 0.8
```

Mirip prinsip TCP congestion control.

Kelebihan:

- sederhana.
- stabil secara umum.
- mudah dipahami.

Kekurangan:

- butuh sinyal failure/latency yang benar.
- bisa lambat naik.
- bisa berosilasi.

### 8.4 Gradient / Latency-Based Limit

Adaptive limit bisa melihat perbandingan latency saat ini vs latency baseline.

```text
baseline latency = latency tanpa queue signifikan
current latency  = latency sekarang
if current >> baseline, queueing likely exists
```

Maka concurrency dikurangi.

### 8.5 Adaptive Protection Tidak Mengganti Limit Dasar

Adaptive limit tetap butuh guardrail:

```text
minimum limit
maximum limit
per-endpoint separation
per-tenant fairness
manual override
safe default during cold start
observability
```

Tanpa guardrail, adaptive algorithm bisa salah karena metrik noisy.

---

## 9. Load Shedding

### 9.1 Definisi

Load shedding adalah menolak sebagian request secara sengaja agar request yang diterima bisa selesai dengan latency yang masuk akal.

Ini terasa counterintuitive, tetapi penting:

```text
Rejecting early can be more reliable than accepting work that will time out anyway.
```

### 9.2 Late Failure vs Early Rejection

Late failure:

```text
accept request
queue 20 seconds
process partially
call dependency
client timeout
server still working
finally fail
```

Early rejection:

```text
queue full
return 429/503 immediately
client can retry later or degrade
server capacity preserved
```

Early rejection lebih jujur dan lebih murah.

### 9.3 Apa Yang Dished?

Tidak semua request sama.

Kamu bisa klasifikasi:

```text
critical user action
read-only page load
background sync
analytics
report export
bulk import
notification retry
health check
```

Saat overload:

```text
shed background first
shed expensive optional work
preserve critical state-changing workflows
preserve health/readiness correctness
```

### 9.4 Brownout

Brownout adalah menonaktifkan fitur non-essential saat load tinggi.

Contoh:

```text
hide recommendation panel
skip expensive enrichment
reduce search result decoration
turn off live preview
pause report generation
serve stale cache with warning
```

Untuk regulatory system:

```text
Do not brownout compliance-critical validation silently.
Do not hide mandatory audit steps.
Do not convert uncertain decision into approved decision.
```

---

## 10. Combining Mechanisms Correctly

### 10.1 Typical Outbound Client Stack

```text
business service
-> dependency client API
-> deadline propagation
-> rate limiter
-> bulkhead / concurrency limiter
-> circuit breaker
-> retry policy
-> HTTP/gRPC transport
-> metrics/tracing/logging
```

Order matters.

### 10.2 Rate Limiter Before Bulkhead?

If request rate exceeds allowed quota, reject before consuming concurrency.

```text
rate limiter -> bulkhead -> actual call
```

### 10.3 Bulkhead Before Circuit Breaker?

Usually:

```text
bulkhead protects caller resources
circuit breaker protects downstream and caller from known-bad dependency
```

Practical order often:

```text
rate limit
-> bulkhead/concurrency limiter
-> circuit breaker
-> retry/deadline-aware call
```

But metrics classification must be intentional:

```text
bulkhead rejection should not always count as downstream failure
rate-limit rejection should not open dependency breaker
client cancellation should not be counted as dependency failure blindly
```

### 10.4 Retry Placement

Retry must not bypass breaker/bulkhead.

Dangerous:

```text
retry wraps everything
-> every retry reacquires bulkhead and hits breaker strangely
-> metrics misleading
```

Safer conceptual model:

```text
for each attempt:
    check deadline
    check retry budget
    check breaker permission
    acquire bulkhead/concurrency permit
    call transport
    classify result
    update metrics
    backoff with jitter if allowed
```

### 10.5 Deadline Dominates Everything

Never retry beyond caller deadline.

```java
Instant deadline = Instant.now().plusMillis(800);

for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    Duration remaining = Duration.between(Instant.now(), deadline);
    if (remaining.isNegative() || remaining.isZero()) {
        throw new TimeoutException("deadline exceeded before attempt");
    }

    try {
        return callWithTimeout(request, remaining);
    } catch (TransientException e) {
        Duration sleep = computeBackoff(attempt);
        if (sleep.compareTo(Duration.between(Instant.now(), deadline)) >= 0) {
            throw e;
        }
        Thread.sleep(sleep.toMillis());
    }
}
```

---

## 11. Java Implementation Patterns

### 11.1 Production Wrapper Interface

```java
public interface RemoteCall<I, O> {
    O execute(I input, CallContext context) throws Exception;
}

public record CallContext(
        String dependencyName,
        String operationName,
        String correlationId,
        Instant deadline,
        String tenantId
) {}
```

### 11.2 Protection Policy

```java
public record ProtectionPolicy(
        int maxConcurrent,
        Duration bulkheadAcquireTimeout,
        int maxAttempts,
        Duration baseBackoff,
        Duration maxBackoff,
        Duration slowCallThreshold
) {}
```

### 11.3 Minimal Protected Client Skeleton

```java
public final class ProtectedClient<I, O> {
    private final RemoteCall<I, O> delegate;
    private final Semaphore concurrency;
    private final SimpleTokenBucket rateLimiter;
    private final ProtectionPolicy policy;

    public ProtectedClient(
            RemoteCall<I, O> delegate,
            SimpleTokenBucket rateLimiter,
            ProtectionPolicy policy
    ) {
        this.delegate = delegate;
        this.rateLimiter = rateLimiter;
        this.policy = policy;
        this.concurrency = new Semaphore(policy.maxConcurrent());
    }

    public O call(I input, CallContext context) throws Exception {
        if (!rateLimiter.tryAcquire()) {
            throw new RejectedExecutionException("rate limit exceeded");
        }

        int attempt = 0;
        Exception last = null;

        while (++attempt <= policy.maxAttempts()) {
            ensureDeadline(context.deadline());

            boolean acquired = concurrency.tryAcquire(
                    policy.bulkheadAcquireTimeout().toMillis(),
                    TimeUnit.MILLISECONDS
            );

            if (!acquired) {
                throw new RejectedExecutionException("bulkhead full");
            }

            long start = System.nanoTime();
            try {
                O result = delegate.execute(input, context);
                recordSuccess(context, elapsed(start));
                return result;
            } catch (Exception e) {
                recordFailure(context, elapsed(start), e);
                last = e;
                if (!isRetryable(e) || attempt >= policy.maxAttempts()) {
                    throw e;
                }
                sleepBeforeRetry(attempt, context.deadline());
            } finally {
                concurrency.release();
            }
        }

        throw last;
    }

    private void ensureDeadline(Instant deadline) throws TimeoutException {
        if (!Instant.now().isBefore(deadline)) {
            throw new TimeoutException("deadline exceeded");
        }
    }

    private Duration elapsed(long startNanos) {
        return Duration.ofNanos(System.nanoTime() - startNanos);
    }

    private boolean isRetryable(Exception e) {
        return e instanceof SocketTimeoutException
                || e instanceof ConnectException
                || e instanceof TimeoutException;
    }

    private void sleepBeforeRetry(int attempt, Instant deadline) throws InterruptedException {
        long millis = Math.min(1000, 50L * (1L << Math.min(attempt, 5)));
        long jitter = ThreadLocalRandom.current().nextLong(millis + 1);
        Instant wake = Instant.now().plusMillis(jitter);
        if (wake.isBefore(deadline)) {
            Thread.sleep(jitter);
        }
    }

    private void recordSuccess(CallContext context, Duration duration) {
        // metrics: dependency, operation, tenant bucket, duration, outcome=success
    }

    private void recordFailure(CallContext context, Duration duration, Exception e) {
        // metrics: dependency, operation, exception class, duration, outcome=failure
    }
}
```

Ini bukan pengganti Resilience4j/production library, tetapi skeleton mental model.

### 11.4 Resilience4j Conceptual Stack

Resilience4j menyediakan decorator seperti:

```text
CircuitBreaker
RateLimiter
Retry
Bulkhead
TimeLimiter
```

Contoh konseptual:

```java
Supplier<Response> supplier = () -> client.call(request);

Supplier<Response> protectedSupplier = Decorators.ofSupplier(supplier)
        .withBulkhead(bulkhead)
        .withCircuitBreaker(circuitBreaker)
        .withRetry(retry)
        .withRateLimiter(rateLimiter)
        .decorate();

Response response = protectedSupplier.get();
```

Tetapi urutan decorator, exception classification, dan metrics tetap tanggung jawab desain.

---

## 12. HTTP-Specific Protection

### 12.1 HTTP Status Classification

| Status | Meaning | Protection handling |
|---|---|---|
| 400 | bad request | no retry, no breaker failure usually |
| 401 | unauthenticated | maybe token refresh once |
| 403 | forbidden | no retry |
| 404 | not found | domain-specific |
| 408 | request timeout | maybe retry if idempotent |
| 409 | conflict | no blind retry; domain resolution |
| 412 | precondition failed | no retry without state refresh |
| 422 | validation | no retry |
| 429 | rate limited | respect Retry-After |
| 500 | server error | maybe retry if idempotent |
| 502 | gateway bad upstream | retryable with budget |
| 503 | unavailable | retryable with budget; maybe breaker |
| 504 | gateway timeout | retryable if idempotent |

### 12.2 429 vs 503

Use `429` when the client/caller exceeded allowed rate/quota.

Use `503` when service is temporarily unavailable or shedding load.

Both may use `Retry-After`.

### 12.3 Client-Side Rejection Response

If your Java service rejects before calling dependency:

```text
Do not return fake downstream status.
Return your own error clearly.
```

Example:

```json
{
  "type": "https://example.com/problems/dependency-bulkhead-full",
  "title": "Dependency capacity exhausted",
  "status": 503,
  "detail": "The address verification dependency is temporarily saturated.",
  "dependency": "address-verification",
  "retryable": true,
  "correlationId": "..."
}
```

---

## 13. gRPC-Specific Protection

### 13.1 Status Mapping

| Condition | gRPC status |
|---|---|
| local rate limit exceeded | `RESOURCE_EXHAUSTED` |
| bulkhead full | `RESOURCE_EXHAUSTED` or `UNAVAILABLE` |
| circuit breaker open | `UNAVAILABLE` |
| deadline exceeded | `DEADLINE_EXCEEDED` |
| caller cancelled | `CANCELLED` |
| invalid request | `INVALID_ARGUMENT` |
| optimistic conflict | `ABORTED` or `FAILED_PRECONDITION` |
| dependency unavailable | `UNAVAILABLE` |

### 13.2 gRPC Deadline First

gRPC already has deadline support. Do not add independent timeout layers that disagree.

Better:

```text
caller deadline -> gRPC deadline -> downstream deadline
```

Not:

```text
gRPC deadline 2s
HTTP wrapper timeout 5s
bulkhead wait 10s
retry loop 30s
```

### 13.3 Streaming Protection

For streaming RPC:

```text
limit active streams
limit messages per stream
limit bytes per stream
limit outbound queue
honor cancellation
honor isReady()
set max inbound message size
set deadline for stream lifetime if business allows
```

---

## 14. Observability

Proteksi tanpa observability akan terlihat seperti random failure.

### 14.1 Required Metrics

Per dependency + operation:

```text
request count
success count
failure count
rejected count by reason
rate limited count
bulkhead full count
circuit breaker state
circuit breaker open count
retry attempts
retry exhausted count
hedged requests count
in-flight count
queue depth
pool acquisition time
latency histogram
slow call count
timeout count
cancelled count
```

### 14.2 Metrics Naming Example

```text
remote_client_requests_total{dependency,operation,outcome}
remote_client_rejections_total{dependency,operation,reason}
remote_client_inflight{dependency,operation}
remote_client_latency_seconds{dependency,operation,outcome}
remote_client_retries_total{dependency,operation,result}
remote_client_circuit_state{dependency,operation,state}
remote_client_bulkhead_available_permits{dependency,operation}
```

### 14.3 Logs

Log rejections as structured events:

```json
{
  "event": "remote_call_rejected",
  "reason": "bulkhead_full",
  "dependency": "address-service",
  "operation": "lookupPostalCode",
  "tenantId": "agency-a",
  "correlationId": "...",
  "inFlight": 50,
  "limit": 50
}
```

Avoid logging every rejection at error level during overload. That can create log storm.

Use sampling or aggregated metrics.

### 14.4 Tracing

Span attributes should show:

```text
dependency name
operation
attempt number
retry count
breaker state
bulkhead wait duration
rate limiter wait/reject
deadline remaining
outcome
```

For rejected calls, create span/event only if useful and sampled.

---

## 15. Sizing Strategy

### 15.1 Start From SLO

Example:

```text
Endpoint p95 target: 500 ms
Dependency budget: 150 ms
Expected RPS: 200
```

Little’s Law:

```text
concurrency ≈ 200 × 0.15 = 30
```

Add headroom:

```text
bulkhead limit = 50
```

But if dependency degrades to 2s:

```text
without bulkhead: 200 × 2 = 400 in-flight
with bulkhead   : capped at 50
```

### 15.2 Queue Size

Queue should be derived from acceptable waiting time.

```text
worker capacity = 100/s
acceptable queue wait = 200 ms
queue size ≈ 100 × 0.2 = 20
```

If queue size is 10,000, it probably hides overload.

### 15.3 Rejection Before Timeout

If caller deadline is 800ms, queue wait of 2s is useless.

```text
queue wait timeout must be smaller than remaining deadline
```

### 15.4 Per-Instance vs Cluster-Wide Limit

If third-party quota is 300/min cluster-wide and you have 6 pods:

```text
naive per-pod limit = 50/min
```

But autoscaling changes pod count. Consider:

- distributed limiter.
- central quota service.
- conservative per-pod limit.
- gateway-level throttling.
- token allocation per instance.

---

## 16. Failure Modes

### 16.1 Retry Storm

```text
dependency slow
-> callers timeout
-> callers retry
-> traffic multiplies
-> dependency slower
-> breaker not configured
-> outage expands
```

Prevention:

```text
retry budget
jitter
circuit breaker
bulkhead
server load shedding
idempotency
```

### 16.2 Queue Meltdown

```text
unbounded queue
-> request waits too long
-> client cancels
-> server still processes
-> useless work consumes capacity
```

Prevention:

```text
bounded queue
queue wait timeout
cancellation propagation
load shedding
```

### 16.3 Slow Dependency Consumes All Threads

```text
all worker threads blocked on vendor
health endpoint starves
pod removed from LB
traffic shifts to remaining pods
cascade
```

Prevention:

```text
bulkhead per dependency
separate health path
short deadline
circuit breaker
```

### 16.4 Circuit Breaker Opens Incorrectly

```text
client sends invalid requests
400 responses counted as failure
breaker opens
valid traffic rejected
```

Prevention:

```text
error classification
domain-aware mapping
separate client/server error metrics
```

### 16.5 Rate Limiter Unfairness

```text
one tenant sends huge traffic
shared global limit exhausted
small tenants rejected
```

Prevention:

```text
per-tenant limit
priority classes
fair queueing
separate quota buckets
```

### 16.6 Adaptive Limit Oscillation

```text
limit increases too fast
latency spikes
limit drops too low
throughput collapses
limit rises again
oscillation
```

Prevention:

```text
smoothing
min/max guardrails
slow increase, fast decrease
stable latency signal
manual override
```

---

## 17. Design Pattern: Dependency Client Protection Envelope

A mature service should not call remote dependencies directly from business code.

Bad:

```java
public CaseResult approve(CaseRequest request) {
    Address address = httpClient.lookupAddress(request.postalCode());
    Risk risk = riskClient.score(request);
    return approvalEngine.decide(address, risk);
}
```

Better:

```text
CaseService
-> AddressVerificationClient
   -> protection envelope
      -> rate limit
      -> deadline
      -> bulkhead
      -> circuit breaker
      -> retry
      -> transport
      -> metrics/tracing
```

Business code sees domain result:

```java
public CaseResult approve(CaseRequest request) {
    AddressLookupResult address = addressClient.lookup(request.postalCode(), context);
    RiskScoreResult risk = riskClient.score(request, context);
    return approvalEngine.decide(address, risk);
}
```

The client wrapper owns remote failure semantics.

---

## 18. Regulatory / Case Management Lens

Dalam regulatory system, proteksi teknis harus cocok dengan audit dan decision integrity.

### 18.1 Jangan Sembunyikan Uncertainty

Jika dependency enrichment gagal:

```text
Do not silently use empty enrichment.
Do not convert unknown into safe.
```

Lebih baik:

```text
status = PENDING_EXTERNAL_CHECK
manual review required
retry scheduled
reason captured in audit trail
```

### 18.2 Rejection Harus Audit-Friendly

Jika action user ditolak karena overload:

```text
record attempt?
record correlation id?
show retryable message?
ensure no partial state mutation?
```

### 18.3 Batch vs Interactive

Batch remediation job harus bisa dished/delayed lebih dulu daripada interactive case action.

```text
interactive case update: high priority
report export: medium/low priority
historical sync: low priority
notification retry: low priority, async
```

### 18.4 External Quota

Jika vendor API punya rate limit, sistem harus punya local limiter sebelum vendor menolak.

```text
local limiter protects vendor quota
idempotency protects duplicate retry
audit stores external call attempt/result
```

---

## 19. Production Checklist

### 19.1 Per Dependency

```text
[ ] timeout/deadline defined
[ ] retry policy defined
[ ] idempotency decision documented
[ ] max concurrency defined
[ ] connection pool size defined
[ ] queue size defined or explicitly avoided
[ ] rate limit defined if dependency quota exists
[ ] circuit breaker configured
[ ] fallback decision documented
[ ] error classification documented
[ ] rejection response contract defined
[ ] metrics dashboard exists
[ ] alert thresholds exist
[ ] load test validates overload behavior
```

### 19.2 Per Endpoint

```text
[ ] request body size limit
[ ] response size strategy
[ ] max active request limit
[ ] expensive operation isolated
[ ] cancellation honored
[ ] async job pattern used for long work
[ ] priority class known
[ ] overload response specified
```

### 19.3 Per System

```text
[ ] global load shedding strategy
[ ] per-tenant fairness
[ ] health endpoint isolated
[ ] graceful shutdown drains in-flight work
[ ] retry storm protection
[ ] dashboards show saturation not only errors
[ ] runbook explains breaker/rate-limit/bulkhead states
```

---

## 20. Exercises

### Exercise 1 — Little’s Law

A dependency receives 300 RPS from your service. Normal p95 latency is 100ms. During degradation, latency becomes 2 seconds.

Answer:

```text
normal in-flight?
degraded in-flight?
what max concurrency would you set?
what rejection behavior?
```

### Exercise 2 — Error Classification

Classify whether these should trigger retry and/or circuit breaker:

```text
HTTP 400
HTTP 401
HTTP 429
HTTP 503
HTTP 504
gRPC INVALID_ARGUMENT
gRPC UNAVAILABLE
gRPC DEADLINE_EXCEEDED
gRPC RESOURCE_EXHAUSTED
SocketTimeoutException
SSLHandshakeException expired certificate
```

### Exercise 3 — Bulkhead Design

You have:

```text
search endpoint
case approval endpoint
report export endpoint
external address lookup
notification sending
batch sync
```

Design separate concurrency/bulkhead/pool strategy.

### Exercise 4 — Rate Limit Contract

Design HTTP and gRPC error contracts for:

```text
per-tenant API quota exceeded
external vendor quota exhausted
local overload shedding
```

### Exercise 5 — Circuit Breaker Tuning

Given:

```text
RPS: 20/s
normal p95: 120ms
bad p95: 3s
failure threshold: 50%
minimum calls: ?
sliding window: ?
slow call threshold: ?
open duration: ?
half-open trial calls: ?
```

Propose values and justify them.

---

## 21. Key Takeaways

1. Stability comes from explicit limits, not hope.
2. Backpressure controls demand; buffering only buys time.
3. Rate limit controls arrival rate; concurrency limit controls in-flight work.
4. Bulkhead prevents one dependency/workload from consuming all resources.
5. Circuit breaker rejects fast when recent evidence says calls are harmful.
6. Adaptive protection adjusts limits based on runtime signals but still needs guardrails.
7. Load shedding is a reliability feature, not a failure of engineering.
8. Virtual threads make blocking cheaper but do not remove the need for bounded concurrency.
9. Retry without budget, idempotency, and breaker can amplify outages.
10. In regulatory systems, degradation must preserve auditability and decision integrity.

---

## 22. How This Prepares The Next Part

Part berikutnya akan membahas observability:

```text
Part 28 — Observability for Networked Java Systems: Logs, Metrics, Traces, Correlation, and Wire Debugging
```

Proteksi seperti rate limiter, bulkhead, circuit breaker, dan adaptive concurrency hanya bisa dipercaya jika terlihat.

Kita akan membahas:

```text
what to log
what to measure
what to trace
how to correlate across HTTP/gRPC
how to debug DNS/TLS/TCP/HTTP/gRPC failures
how to build dashboards for network clients
how to avoid high-cardinality metrics disaster
how to make production incidents diagnosable
```

---

## Status Seri

```text
Part 27 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 28 — Observability for Networked Java Systems: Logs, Metrics, Traces, Correlation, and Wire Debugging
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./026-reactive-async-virtual-threads-blocking-io-choosing-right-concurrency-model.md">⬅️ Part 26 — Reactive, Async, Virtual Threads, and Blocking I/O: Choosing the Right Concurrency Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./028-observability-for-networked-java-systems-logs-metrics-traces-correlation-wire-debugging.md">Part 28 — Observability for Networked Java Systems: Logs, Metrics, Traces, Correlation, and Wire Debugging ➡️</a>
</div>

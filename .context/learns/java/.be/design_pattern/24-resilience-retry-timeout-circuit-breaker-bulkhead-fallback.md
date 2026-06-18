# 24 — Resilience Pattern: Retry, Timeout, Circuit Breaker, Bulkhead, Fallback

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 24 dari 35  
> Topik: Java Design Pattern dan Anti-Pattern — Advanced Resilience Pattern  
> Rentang Java: Java 8 sampai Java 25

---

## 0. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami resilience pattern bukan sebagai library feature, tetapi sebagai **model pengendalian kegagalan**.
2. Membedakan failure yang layak di-retry dan failure yang harus langsung dihentikan.
3. Mendesain timeout yang benar, bukan sekadar memasang angka acak.
4. Memahami Circuit Breaker sebagai mekanisme **fail fast** dan recovery protection.
5. Memakai Bulkhead untuk mencegah satu downstream merusak seluruh aplikasi.
6. Memahami Rate Limiter, Fallback, Backoff, Jitter, Retry Budget, dan Load Shedding.
7. Menentukan urutan komposisi pattern resilience.
8. Menghindari anti-pattern seperti retry storm, timeoutless call, fallback hiding corruption, dan circuit breaker everywhere.
9. Mendesain resilience dengan awareness terhadap idempotency, transaction boundary, observability, dan operability.
10. Membaca kegagalan sistem distributed Java dari sudut pandang senior engineer: bukan “kenapa method ini error”, tetapi “kenapa arsitektur ini memperbesar error”.

---

## 1. Masalah Nyata yang Ingin Diselesaikan

Di sistem Java enterprise, service jarang berdiri sendiri. Biasanya aplikasi akan memanggil:

- database,
- cache,
- message broker,
- identity provider,
- payment gateway,
- government API,
- file storage,
- email gateway,
- search engine,
- internal microservice,
- third-party SaaS,
- batch processor,
- external regulatory integration.

Setiap dependency itu bisa gagal.

Yang membedakan engineer biasa dan engineer senior bukan apakah mereka tahu `try-catch`, tetapi apakah mereka bisa menjawab:

```text
Jika downstream lambat, apakah aplikasi kita ikut lambat?
Jika downstream mati, apakah thread pool kita habis?
Jika request di-retry, apakah data bisa dobel?
Jika fallback aktif, apakah user menerima data stale tanpa sadar?
Jika circuit breaker open, apakah ada alert?
Jika timeout terjadi, apakah task benar-benar dibatalkan?
Jika satu tenant memicu overload, apakah tenant lain ikut terkena?
Jika retry dilakukan oleh client, gateway, service, dan library bersamaan, apakah load menjadi berkali-kali lipat?
```

Resilience pattern mencoba menjawab pertanyaan-pertanyaan itu.

---

## 2. Mental Model Utama

### 2.1 Resilience Bukan “Mencegah Semua Error”

Resilience bukan berarti sistem tidak pernah gagal.

Resilience berarti:

```text
Sistem tetap mempertahankan fungsi penting,
membatasi radius kerusakan,
memberi sinyal yang jelas,
dan pulih secara terkendali ketika sebagian dependency gagal.
```

Sistem distributed yang sehat tidak menganggap error sebagai kejadian aneh. Ia menganggap error sebagai bagian dari operasi normal.

### 2.2 Local Failure vs Systemic Failure

Tidak semua failure sama.

```text
Local failure:
- satu request timeout
- satu koneksi putus
- satu packet loss
- satu transient 503

Systemic failure:
- database overload
- downstream thread pool habis
- DNS issue
- Kafka broker under-replicated
- identity provider degraded
- network partition
- retry storm
- deployment bad release
```

Pattern seperti retry membantu pada local transient failure. Tetapi retry bisa memperburuk systemic failure.

Inilah prinsip penting:

```text
A pattern that heals local failure can amplify systemic failure.
```

### 2.3 Every Remote Call Is a Failure Boundary

Di Java code, remote call sering tampak seperti method call biasa:

```java
CustomerProfile profile = profileClient.getProfile(customerId);
```

Padahal secara realitas, baris itu bisa berarti:

```text
thread blocked
connection acquired
DNS resolved
TLS negotiated
request serialized
network traversed
load balancer selected target
downstream queued request
database queried
response serialized
network returned
body parsed
object allocated
```

Setiap tahap bisa gagal atau lambat.

Jadi mental model-nya:

```text
Remote call is not a function call.
Remote call is a negotiated failure boundary.
```

### 2.4 Latency Is Also Failure

Banyak engineer hanya menganggap failure sebagai exception.

Namun dalam distributed system:

```text
slow success can be worse than fast failure.
```

Contoh:

- API berhasil setelah 40 detik.
- Thread request tertahan.
- Connection pool tertahan.
- User sudah refresh browser.
- Upstream retry membuat request kedua.
- Downstream tetap memproses request pertama.
- Data bisa berubah dua kali.

Karena itu timeout adalah resilience primitive, bukan hanya setting teknis.

### 2.5 Resilience Pattern Adalah Control Loop

Banyak resilience pattern dapat dilihat sebagai control loop:

```text
observe -> decide -> act -> recover -> observe again
```

Contoh Circuit Breaker:

```text
observe failures -> open circuit -> reject calls -> wait -> probe -> close or reopen
```

Contoh Retry:

```text
observe transient failure -> wait -> try again -> stop if budget exhausted
```

Contoh Bulkhead:

```text
observe resource usage -> isolate capacity -> reject/localize overload
```

Top engineer melihat pattern bukan sebagai class diagram, tetapi sebagai control loop.

---

## 3. Resilience Pattern Landscape

Kita akan membahas pattern utama berikut:

```text
Timeout
Retry
Backoff
Jitter
Retry Budget
Circuit Breaker
Bulkhead
Rate Limiter
Load Shedding
Fallback
Hedging
Cache-aside/Stale fallback
Idempotency
Deadline Propagation
Cancellation Propagation
```

Walaupun judul bagian ini menyebut Retry, Timeout, Circuit Breaker, Bulkhead, Fallback, pemahaman yang matang membutuhkan beberapa pattern pendukung.

---

## 4. Timeout Pattern

### 4.1 Definisi

Timeout membatasi waktu maksimum yang boleh digunakan oleh operasi tertentu sebelum dianggap gagal.

```text
Timeout = explicit upper bound for waiting.
```

Tanpa timeout, sistem secara implisit berkata:

```text
Saya bersedia menunggu selamanya.
```

Itu hampir selalu salah.

### 4.2 Kenapa Timeout Penting

Tanpa timeout:

- thread bisa tertahan terlalu lama,
- connection pool bisa habis,
- servlet request bisa menumpuk,
- virtual thread pun tetap bisa menahan resource eksternal,
- user menunggu tanpa kepastian,
- upstream bisa retry sementara request lama masih berjalan,
- cascading failure mudah terjadi.

Timeout adalah pagar pertama untuk mencegah latency berubah menjadi resource exhaustion.

### 4.3 Jenis Timeout

Remote call biasanya memiliki beberapa timeout:

```text
Connection timeout:
  batas waktu membuat koneksi.

TLS handshake timeout:
  batas waktu negosiasi TLS.

Request write timeout:
  batas waktu mengirim request body.

Response header timeout:
  batas waktu menunggu header response.

Read timeout:
  batas waktu membaca response body.

Overall call timeout:
  batas total seluruh operasi.

Business deadline:
  batas waktu dari perspektif use case end-to-end.
```

Kesalahan umum: hanya mengatur read timeout, tetapi tidak mengatur total deadline.

### 4.4 Timeout vs Deadline

Timeout biasanya relatif terhadap satu operasi.

```text
call profile service with timeout 2 seconds
```

Deadline adalah batas absolut untuk keseluruhan request.

```text
this user request must complete before 10:15:30.500
```

Untuk workflow yang memanggil banyak downstream, deadline lebih kuat.

Contoh:

```text
Total SLA: 2 seconds

Step A: took 600 ms
Step B: took 500 ms
Remaining: 900 ms
Step C must not receive full 2 seconds again
```

Jika setiap dependency diberi timeout 2 detik, total latency bisa melebihi SLA.

### 4.5 Timeout Budgeting

Misalnya endpoint punya target p95 1000 ms.

Kemungkinan budget:

```text
Controller + auth       : 50 ms
DB query                : 250 ms
External profile call   : 300 ms
External risk call      : 250 ms
Serialization           : 50 ms
Buffer                  : 100 ms
```

Timeout tidak boleh dipilih asal.

Pertanyaan desain:

```text
Berapa latency normal downstream?
Berapa p95/p99?
Berapa SLA upstream?
Berapa jumlah dependency serial?
Berapa retry yang mungkin terjadi?
Berapa cost jika operasi terus berjalan setelah user sudah timeout?
```

### 4.6 Java Example: Basic Timeout with CompletableFuture

```java
CompletableFuture<Profile> future = CompletableFuture.supplyAsync(() -> {
    return profileClient.fetchProfile(customerId);
}, executor);

Profile profile = future.orTimeout(500, TimeUnit.MILLISECONDS)
        .exceptionally(ex -> Profile.unavailable(customerId))
        .join();
```

Ini terlihat sederhana, tetapi ada bahaya.

`orTimeout()` membuat future selesai dengan timeout, tetapi pekerjaan underlying belum tentu berhenti jika task tidak cooperative terhadap cancellation.

### 4.7 Timeout Must Cooperate with Cancellation

Timeout tanpa cancellation bisa menjadi ilusi.

```text
Caller sudah menyerah.
Underlying task masih jalan.
Thread masih bekerja.
Connection masih dipakai.
Downstream masih menerima load.
```

Dengan Java modern, terutama structured concurrency, timeout dan cancellation bisa lebih eksplisit.

Pseudo-code konseptual:

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<Profile> profile = scope.fork(() -> profileClient.fetch(id));
    Subtask<Risk> risk = scope.fork(() -> riskClient.evaluate(id));

    scope.joinUntil(deadline);
    scope.throwIfFailed();

    return combine(profile.get(), risk.get());
}
```

Inti desainnya:

```text
Jika parent request habis waktunya,
child tasks juga harus dihentikan.
```

### 4.8 Timeout Anti-Pattern

#### Anti-pattern 1: Timeoutless Call

```java
String body = httpClient.send(request, BodyHandlers.ofString()).body();
```

Jika tidak ada timeout eksplisit, behavior bergantung pada default library/runtime.

#### Anti-pattern 2: Same Timeout Everywhere

```text
Semua downstream timeout = 30 seconds
```

Ini biasanya tanda tidak ada latency budget.

#### Anti-pattern 3: Timeout Lebih Panjang dari Upstream SLA

Jika API gateway timeout 10 detik, tetapi service internal menunggu DB 60 detik, maka backend tetap bekerja setelah user sudah menerima error.

#### Anti-pattern 4: Timeout Tanpa Metrics

Timeout tanpa metrics membuat engineer tidak tahu:

- timeout terjadi berapa kali,
- downstream mana yang lambat,
- timeout terjadi sebelum atau sesudah retry,
- apakah timeout meningkat setelah release.

---

## 5. Retry Pattern

### 5.1 Definisi

Retry mencoba ulang operasi yang gagal dengan asumsi failure bersifat sementara.

```text
Retry = repeat a failed operation when failure is likely transient and retry is safe.
```

Kata pentingnya:

```text
likely transient
safe
bounded
observable
```

Jika salah satu tidak terpenuhi, retry berbahaya.

### 5.2 Kapan Retry Masuk Akal

Retry masuk akal untuk failure seperti:

- temporary network glitch,
- transient 502/503/504,
- connection reset,
- rate-limited response dengan `Retry-After`,
- optimistic locking conflict tertentu,
- leader election/failover short window,
- temporary DNS or load balancer routing issue.

Retry tidak masuk akal untuk:

- validation error,
- authentication failure,
- authorization denied,
- insufficient balance,
- duplicate submission tanpa idempotency,
- malformed request,
- business rule violation,
- permanent 404 untuk resource yang memang tidak ada,
- downstream overload berat tanpa backoff.

### 5.3 Retry Safety Requires Idempotency

Retry terhadap operasi read biasanya relatif aman.

Retry terhadap write berbahaya kecuali operasi idempotent.

Contoh tidak aman:

```java
paymentClient.charge(card, amount);
```

Jika timeout terjadi, caller tidak tahu apakah charge berhasil di downstream.

Retry bisa membuat double charge.

Versi lebih aman:

```java
paymentClient.charge(new ChargeRequest(
        idempotencyKey,
        card,
        amount
));
```

Downstream harus menyimpan `idempotencyKey` dan mengembalikan hasil yang sama untuk request duplikat.

### 5.4 Retry Classification

Sebelum retry, error harus diklasifikasikan.

```java
enum RetryDecision {
    RETRY,
    DO_NOT_RETRY,
    RETRY_AFTER,
    UNKNOWN
}
```

Contoh classifier:

```java
final class RetryClassifier {
    RetryDecision classify(Throwable error) {
        if (error instanceof TimeoutException) {
            return RetryDecision.RETRY;
        }
        if (error instanceof ValidationException) {
            return RetryDecision.DO_NOT_RETRY;
        }
        if (error instanceof RemoteHttpException ex) {
            int status = ex.statusCode();
            if (status == 429 || status == 503 || status == 504) {
                return RetryDecision.RETRY;
            }
            if (status >= 400 && status < 500) {
                return RetryDecision.DO_NOT_RETRY;
            }
            if (status >= 500) {
                return RetryDecision.RETRY;
            }
        }
        return RetryDecision.UNKNOWN;
    }
}
```

Top engineer tidak menulis retry seperti ini:

```java
catch (Exception e) {
    retry();
}
```

Karena itu retry tanpa taxonomy error.

### 5.5 Bounded Retry

Retry harus punya batas.

```text
max attempts
max elapsed time
deadline
retry budget
```

Contoh sederhana:

```java
public <T> T retry(Callable<T> action) throws Exception {
    int maxAttempts = 3;
    Exception last = null;

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return action.call();
        } catch (Exception ex) {
            last = ex;
            if (attempt == maxAttempts || !isRetryable(ex)) {
                throw ex;
            }
            Thread.sleep(delayFor(attempt));
        }
    }
    throw last;
}
```

Ini masih belum ideal, tetapi menunjukkan prinsip:

```text
Retry must stop.
```

### 5.6 Backoff

Backoff memberi jeda sebelum retry.

Tanpa backoff, failure bisa langsung diperparah.

```text
attempt 1: now
attempt 2: after 100 ms
attempt 3: after 300 ms
attempt 4: after 700 ms
```

Jenis backoff:

```text
Fixed backoff:
  delay tetap.

Linear backoff:
  delay naik linear.

Exponential backoff:
  delay naik eksponensial.

Capped exponential backoff:
  exponential tetapi dibatasi maksimum.
```

### 5.7 Jitter

Jika semua client retry pada waktu yang sama, backoff tetap bisa menyebabkan herd effect.

Jitter menambahkan randomization.

```java
long exponential = Math.min(maxDelayMillis, baseDelayMillis * (1L << attempt));
long jittered = ThreadLocalRandom.current().nextLong(0, exponential + 1);
```

Prinsip:

```text
Backoff reduces retry pressure.
Jitter spreads retry pressure.
```

### 5.8 Retry Budget

Retry budget membatasi jumlah retry relatif terhadap traffic normal.

Tanpa retry budget, saat failure terjadi, traffic bisa meledak.

Contoh:

```text
Normal request rate: 1000 rps
Max retry budget: 10%
Allowed retry rate: 100 rps
```

Jika failure meningkat, retry tidak boleh membuat downstream menerima 3000 rps.

### 5.9 Retry Storm

Retry storm terjadi ketika banyak caller melakukan retry terhadap dependency yang sudah overload.

```text
Downstream lambat
-> caller timeout
-> caller retry
-> downstream menerima lebih banyak request
-> downstream makin lambat
-> lebih banyak timeout
-> lebih banyak retry
-> outage
```

Retry storm adalah contoh pattern yang niatnya resilience tetapi hasilnya cascading failure.

### 5.10 Retry Anti-Pattern

#### Anti-pattern 1: Retry Semua Exception

```java
catch (Exception ex) {
    retry();
}
```

Masalah:

- validation error diulang,
- authorization error diulang,
- bug diulang,
- duplicate write terjadi,
- downstream overload makin parah.

#### Anti-pattern 2: Immediate Retry

```text
attempt 1 failed
attempt 2 immediately
attempt 3 immediately
```

Ini hampir selalu memperbesar load.

#### Anti-pattern 3: Nested Retry

```text
HTTP client retries 3x
SDK retries 3x
Service wrapper retries 3x
Message consumer retries 3x
```

Total attempt bisa menjadi:

```text
3 * 3 * 3 * 3 = 81 attempts
```

#### Anti-pattern 4: Retry Write Tanpa Idempotency

Ini sumber bug produksi yang serius.

---

## 6. Circuit Breaker Pattern

### 6.1 Definisi

Circuit Breaker membungkus operasi berisiko dan memonitor failure. Jika failure melewati threshold, circuit dibuka sehingga call berikutnya langsung gagal tanpa memanggil downstream.

```text
Circuit Breaker = fail fast gate protecting a failing dependency and caller resources.
```

### 6.2 Kenapa Circuit Breaker Dibutuhkan

Retry dan timeout membantu request individual.

Circuit breaker melindungi sistem pada level aliran traffic.

Tanpa circuit breaker:

```text
setiap request tetap mencoba downstream yang sedang rusak
setiap request menunggu timeout
thread pool habis
connection pool habis
latency naik
caller ikut rusak
```

Dengan circuit breaker:

```text
setelah failure threshold tercapai
call baru langsung ditolak
resource caller tidak habis
system punya kesempatan recover
alert bisa dikirim
```

### 6.3 State Circuit Breaker

Umumnya ada tiga state:

```text
CLOSED:
  request diteruskan ke downstream.
  failure dihitung.

OPEN:
  request langsung gagal tanpa memanggil downstream.

HALF_OPEN:
  sebagian kecil request probe diizinkan.
  jika sukses, kembali CLOSED.
  jika gagal, kembali OPEN.
```

Diagram:

```text
             failure threshold reached
      +-----------------------------------+
      |                                   v
  +--------+        wait duration       +------+
  | CLOSED | -------------------------> | OPEN |
  +--------+                            +------+
      ^                                   |
      | success probes                    | after cool-down
      |                                   v
  +-----------+ <--------------------------+
  | HALF_OPEN |
  +-----------+
      |
      | failed probe
      v
    OPEN
```

### 6.4 What Counts as Failure?

Tidak semua error harus membuka circuit.

Biasanya dihitung sebagai failure:

- timeout,
- connection error,
- 5xx tertentu,
- rejected by downstream,
- slow call melebihi threshold.

Biasanya tidak dihitung sebagai failure:

- 400 validation error,
- 401 unauthorized karena token salah dari caller,
- 403 forbidden,
- 404 valid not found,
- business rejection.

Circuit breaker harus punya failure classifier.

### 6.5 Count-Based vs Time-Based Window

Count-based:

```text
Buka circuit jika 50 dari 100 request terakhir gagal.
```

Time-based:

```text
Buka circuit jika failure rate dalam 30 detik terakhir > 50%.
```

Time-based biasanya lebih cocok untuk traffic bervariasi.

### 6.6 Slow Call Circuit Breaker

Downstream tidak harus error untuk dianggap bermasalah.

Jika banyak call sukses tetapi lambat, caller tetap bisa kehabisan resource.

Slow call threshold bisa membuka circuit sebelum error eksplisit terjadi.

```text
If 70% calls > 2 seconds within last 60 seconds, open circuit.
```

### 6.7 Circuit Breaker vs Retry

Retry:

```text
Mencoba lagi karena berharap transient failure.
```

Circuit breaker:

```text
Berhenti mencoba sementara karena dependency kemungkinan sedang bermasalah.
```

Keduanya bisa dikombinasikan, tetapi harus hati-hati.

Prinsip umum:

```text
Retry should call through circuit breaker, not bypass it.
```

Atau secara pipeline:

```text
caller
 -> timeout/deadline
 -> circuit breaker
 -> bulkhead
 -> retry with backoff/jitter
 -> remote call
```

Namun urutan bisa berubah tergantung library dan semantics. Yang penting: jangan sampai retry menembus circuit breaker yang sedang open.

### 6.8 Simple Circuit Breaker Sketch

Ini bukan production-grade implementation, hanya mental model.

```java
enum CircuitState {
    CLOSED,
    OPEN,
    HALF_OPEN
}

final class SimpleCircuitBreaker {
    private final int failureThreshold;
    private final Duration openDuration;

    private CircuitState state = CircuitState.CLOSED;
    private int failures;
    private Instant openedAt;

    SimpleCircuitBreaker(int failureThreshold, Duration openDuration) {
        this.failureThreshold = failureThreshold;
        this.openDuration = openDuration;
    }

    synchronized <T> T call(Callable<T> action) throws Exception {
        if (state == CircuitState.OPEN) {
            if (Instant.now().isBefore(openedAt.plus(openDuration))) {
                throw new CircuitOpenException();
            }
            state = CircuitState.HALF_OPEN;
        }

        try {
            T result = action.call();
            onSuccess();
            return result;
        } catch (Exception ex) {
            onFailure(ex);
            throw ex;
        }
    }

    private void onSuccess() {
        failures = 0;
        state = CircuitState.CLOSED;
    }

    private void onFailure(Exception ex) {
        failures++;
        if (state == CircuitState.HALF_OPEN || failures >= failureThreshold) {
            state = CircuitState.OPEN;
            openedAt = Instant.now();
        }
    }
}
```

Production circuit breaker membutuhkan:

- sliding window,
- concurrency safety,
- slow call tracking,
- metrics,
- event hooks,
- state transition log,
- half-open permit count,
- failure classification,
- config per dependency,
- integration dengan registry/monitoring.

### 6.9 Circuit Breaker Anti-Pattern

#### Anti-pattern 1: Circuit Breaker Everywhere

Memasang circuit breaker pada semua method internal membuat noise dan complexity.

Circuit breaker cocok untuk dependency yang:

- remote,
- unreliable,
- expensive,
- slow,
- shared,
- bisa menyebabkan resource exhaustion.

Bukan untuk pure local method.

#### Anti-pattern 2: Threshold Tanpa Traffic Awareness

Jika traffic rendah, sample kecil bisa membuat circuit sering false open.

```text
2 failure dari 3 request = 66%
```

Apakah itu cukup untuk open? Belum tentu.

Butuh minimum number of calls.

#### Anti-pattern 3: Open Circuit Tanpa Alert

Circuit breaker open adalah signal operasional penting. Jika tidak terlihat, sistem bisa silently degraded.

#### Anti-pattern 4: Fallback Menyembunyikan Circuit Open

Jika circuit open tetapi fallback selalu memberi data palsu/stale tanpa sinyal, tim operasi tidak sadar dependency rusak.

---

## 7. Bulkhead Pattern

### 7.1 Definisi

Bulkhead membagi resource agar kegagalan atau overload pada satu area tidak menenggelamkan seluruh sistem.

Analogi kapal:

```text
Jika satu kompartemen bocor, air tidak langsung memenuhi seluruh kapal.
```

Dalam Java system:

```text
Jika one downstream lambat, jangan biarkan semua thread/connection habis.
```

### 7.2 Bentuk Bulkhead

Bulkhead bisa berupa:

```text
Separate thread pool per dependency
Separate connection pool per dependency
Semaphore limit per dependency
Queue limit per operation
Tenant-level isolation
Priority-level isolation
Database pool separation
Kafka consumer group/resource separation
Rate limit per caller
CPU/memory/container resource limit
```

### 7.3 Thread Pool Bulkhead

Contoh buruk:

```text
All remote calls use same executor with 200 threads.
```

Jika `profile-service` lambat, semua 200 thread bisa habis untuk profile call. Call ke `notification-service` yang sehat pun ikut tertahan.

Lebih baik:

```text
profileExecutor      : 40 threads
riskExecutor         : 30 threads
notificationExecutor : 20 threads
reportExecutor       : 10 threads
```

Namun dengan virtual threads, thread pool bulkhead berubah bentuk.

### 7.4 Bulkhead with Virtual Threads

Java virtual threads mengurangi cost blocking thread, tetapi tidak menghapus kebutuhan bulkhead.

Kenapa?

Karena bottleneck masih ada pada:

- database connection,
- HTTP connection,
- downstream capacity,
- rate limit external API,
- memory,
- queue,
- CPU,
- file descriptor,
- transaction slot.

Dengan virtual thread, bulkhead sering lebih tepat dibuat sebagai semaphore/concurrency limiter daripada fixed thread pool.

Contoh:

```java
final class ConcurrencyBulkhead {
    private final Semaphore permits;

    ConcurrencyBulkhead(int maxConcurrentCalls) {
        this.permits = new Semaphore(maxConcurrentCalls);
    }

    <T> T call(Callable<T> action) throws Exception {
        if (!permits.tryAcquire()) {
            throw new BulkheadRejectedException();
        }
        try {
            return action.call();
        } finally {
            permits.release();
        }
    }
}
```

### 7.5 Queue Limit

Bulkhead tanpa queue limit bisa tetap berbahaya.

```text
max workers: 20
queue size: unlimited
```

Jika downstream lambat, request menumpuk di queue. Latency membengkak. Memory naik. Request lama mungkin sudah tidak relevan.

Lebih baik:

```text
max concurrent: 20
queue size: 50
beyond that: reject fast
```

### 7.6 Bulkhead and Fairness

Bulkhead juga bisa dipakai untuk fairness.

Contoh multi-tenant:

```text
Tenant A overload tidak boleh menghabiskan semua capacity tenant B.
```

Model:

```text
global limit: 1000 concurrent requests
tenant A limit: 200
tenant B limit: 200
system-reserved: 100
```

### 7.7 Bulkhead Anti-Pattern

#### Anti-pattern 1: One Global Pool

Semua dependency berbagi pool yang sama.

Akibatnya satu downstream bisa memblokir semua operasi.

#### Anti-pattern 2: Unlimited Queue

Queue bukan solusi kapasitas. Queue hanya menunda kegagalan.

#### Anti-pattern 3: Bulkhead Tanpa Metrics

Harus terlihat:

- active permits,
- waiting queue,
- rejection count,
- wait time,
- saturation rate.

#### Anti-pattern 4: Too Many Tiny Bulkheads

Terlalu banyak pool kecil bisa membuat capacity fragmented dan operasional sulit.

---

## 8. Rate Limiter Pattern

### 8.1 Definisi

Rate limiter membatasi jumlah request dalam satu rentang waktu.

```text
Rate limit = maximum request rate allowed.
```

Contoh:

```text
100 requests per second
300 requests per minute
10 requests per user per minute
```

### 8.2 Rate Limiter vs Bulkhead

Bulkhead membatasi concurrency.

Rate limiter membatasi rate.

```text
Bulkhead:
  berapa banyak operasi berjalan bersamaan?

Rate limiter:
  berapa banyak operasi boleh dimulai per waktu?
```

Keduanya berbeda.

### 8.3 Token Bucket

Token bucket memberi token secara periodik. Request membutuhkan token.

```text
bucket capacity: 100 tokens
refill: 10 tokens/second
request consumes: 1 token
```

Jika token habis:

- reject,
- wait,
- degrade,
- enqueue terbatas.

### 8.4 Rate Limit External API

Jika external API punya limit 300/minute, jangan mengandalkan error 429 dari mereka sebagai mekanisme utama.

Service kita harus membatasi diri sebelum melanggar limit.

```java
if (!rateLimiter.tryAcquire()) {
    throw new ExternalRateLimitBudgetExceededException();
}
```

### 8.5 Anti-Pattern

- rate limit hanya di edge, padahal internal batch bisa bypass,
- tidak ada per-tenant fairness,
- retry mengabaikan rate limit,
- tidak menghormati `Retry-After`,
- rate limit tanpa backpressure strategy.

---

## 9. Load Shedding Pattern

### 9.1 Definisi

Load shedding menolak sebagian workload saat sistem overload untuk menjaga fungsi utama tetap hidup.

```text
Load shedding = intentional rejection to prevent collapse.
```

Ini terdengar buruk, tetapi dalam sistem overload, menolak sebagian request bisa lebih baik daripada semua request timeout.

### 9.2 Kapan Load Shedding Dibutuhkan

Contoh:

- CPU > 90%,
- DB connection pool saturated,
- queue terlalu panjang,
- latency p99 melewati threshold,
- downstream degraded,
- JVM memory pressure tinggi,
- request deadline sudah hampir habis.

### 9.3 Reject Early

Jika request tidak mungkin selesai dalam deadline, lebih baik reject awal.

```text
fail fast is often more honest than fake hope.
```

### 9.4 Prioritized Load Shedding

Tidak semua request sama.

Contoh prioritas:

```text
P0: health-critical internal control
P1: user write operation
P2: user read operation
P3: report export
P4: background enrichment
```

Saat overload, P4 bisa ditolak dulu.

---

## 10. Fallback Pattern

### 10.1 Definisi

Fallback menyediakan alternatif ketika operasi utama gagal.

```text
Fallback = alternative response or path when primary path fails.
```

Jenis fallback:

```text
return cached value
return stale value
return default value
return partial response
use secondary provider
queue request for later
manual review
skip non-critical enrichment
show degraded UI
```

### 10.2 Fallback Harus Semantically Safe

Fallback bukan berarti “asal ada response”.

Contoh aman:

```text
Jika recommendation service gagal, tampilkan daftar populer.
```

Contoh berbahaya:

```text
Jika authorization service gagal, allow access by default.
```

Fallback harus sesuai domain.

### 10.3 Fallback and Data Freshness

Jika fallback memakai cache stale, response harus tahu freshness.

```java
record FallbackProfile(
        CustomerId customerId,
        ProfileData data,
        Instant dataAsOf,
        boolean stale
) {}
```

Dalam regulatory/financial system, data stale bisa punya konsekuensi legal.

### 10.4 Partial Response

Tidak semua dependency failure harus membuat seluruh endpoint gagal.

Contoh:

```json
{
  "caseId": "CASE-123",
  "status": "UNDER_REVIEW",
  "profile": {
    "available": false,
    "reason": "PROFILE_SERVICE_UNAVAILABLE"
  },
  "documents": [ ... ]
}
```

Partial response harus eksplisit.

Jangan sembunyikan missing data sebagai empty array jika empty array bisa berarti benar-benar tidak ada data.

### 10.5 Queue for Later

Untuk operasi non-synchronous:

```text
Jika email gateway gagal,
simpan email request ke outbox,
retry async.
```

Ini fallback yang baik karena user operation tidak selalu harus menunggu email terkirim.

### 10.6 Fallback Anti-Pattern

#### Anti-pattern 1: Fallback Hiding Corruption

Jika primary gagal karena data corruption, fallback bisa menyembunyikan masalah dan menyebarkan keputusan salah.

#### Anti-pattern 2: Default Allow

```java
catch (Exception ex) {
    return true; // allow
}
```

Untuk authorization, compliance, regulatory decision, ini sangat berbahaya.

#### Anti-pattern 3: Silent Stale Data

Mengembalikan data lama tanpa menandai stale.

#### Anti-pattern 4: Fallback That Calls Same Broken Dependency

Fallback yang akhirnya memanggil dependency yang sama dengan path utama bukan fallback.

---

## 11. Hedging Pattern

### 11.1 Definisi

Hedging mengirim request tambahan jika request pertama lambat, bukan menunggu gagal.

```text
Send duplicate request after delay to reduce tail latency.
```

Contoh:

```text
Call replica A.
If no response after 100 ms, call replica B.
Use first successful response.
Cancel slower request.
```

### 11.2 Kapan Hedging Cocok

Cocok untuk:

- read-only operation,
- idempotent operation,
- replicated backend,
- tail latency sensitive,
- backend punya capacity cukup.

Tidak cocok untuk:

- write operation non-idempotent,
- overloaded backend,
- expensive operation,
- external API dengan rate limit ketat.

### 11.3 Hedging vs Retry

Retry dilakukan setelah failure.

Hedging dilakukan saat request lambat.

Hedging bisa mengurangi tail latency, tetapi meningkatkan load.

---

## 12. Idempotency Pattern

### 12.1 Definisi

Operasi idempotent menghasilkan efek akhir yang sama meskipun dijalankan lebih dari sekali.

```text
f(f(x)) = f(x)
```

Untuk distributed system:

```text
Same idempotency key + same request intent = same outcome.
```

### 12.2 Idempotency Key

```java
record SubmitRequest(
        String idempotencyKey,
        ApplicationId applicationId,
        UserId submittedBy
) {}
```

Server menyimpan:

```text
idempotency_key
request_hash
status
response
created_at
expires_at
```

Jika request yang sama datang lagi:

- jika masih processing: return processing/409/202,
- jika completed: return same result,
- jika request hash berbeda: reject conflict.

### 12.3 Idempotency and Retry

Retry write tanpa idempotency adalah bug waiting to happen.

Pattern resilience yang matang selalu bertanya:

```text
Can this operation be safely repeated?
```

---

## 13. Composition Order

### 13.1 Kenapa Urutan Penting

Resilience pattern saling memengaruhi.

Jika salah urutan, efeknya bisa berubah.

Contoh:

```text
Retry outside timeout:
  timeout applies to each attempt or all attempts?

Timeout outside retry:
  total operation bounded, but each attempt must still be bounded.

Circuit breaker outside retry:
  circuit sees final failure or each failed attempt?

Circuit breaker inside retry:
  retry may stop quickly when circuit open.
```

### 13.2 Prinsip Umum

Tidak ada satu urutan universal, tetapi model yang masuk akal:

```text
Inbound request
  -> authentication/authorization
  -> deadline check
  -> rate limit/load shedding
  -> bulkhead/concurrency limit
  -> circuit breaker
  -> retry with backoff/jitter
  -> per-attempt timeout
  -> remote call
  -> fallback if semantically safe
```

Namun beberapa sistem memakai circuit breaker membungkus seluruh retry agar failure rate dihitung per logical operation, bukan per attempt.

Yang penting adalah eksplisit:

```text
Apakah metric circuit breaker menghitung attempt atau logical request?
Apakah timeout total atau per attempt?
Apakah fallback terjadi setelah circuit open atau sebelum?
Apakah retry boleh terjadi ketika bulkhead sudah penuh?
```

### 13.3 Recommended Mental Pipeline

```text
1. Deadline:
   Apakah request masih layak diproses?

2. Admission control:
   Apakah sistem punya capacity menerima request ini?

3. Isolation:
   Resource mana yang boleh dipakai request ini?

4. Failure prediction:
   Apakah downstream sedang cukup sehat untuk dicoba?

5. Attempt:
   Jalankan bounded call.

6. Retry:
   Ulangi hanya jika aman dan masih dalam budget.

7. Fallback:
   Berikan alternatif hanya jika semantically valid.

8. Signal:
   Log/metric/trace/audit status degradasi.
```

---

## 14. Java Implementation Model

### 14.1 Without Library: Decorator-Based Resilience

Kita bisa memodelkan resilience sebagai decorator.

```java
@FunctionalInterface
interface RemoteCall<T> {
    T execute() throws Exception;
}
```

Timeout decorator:

```java
final class TimeoutDecorator<T> implements RemoteCall<T> {
    private final RemoteCall<T> delegate;
    private final Duration timeout;
    private final ExecutorService executor;

    TimeoutDecorator(RemoteCall<T> delegate, Duration timeout, ExecutorService executor) {
        this.delegate = delegate;
        this.timeout = timeout;
        this.executor = executor;
    }

    @Override
    public T execute() throws Exception {
        Future<T> future = executor.submit(delegate::execute);
        try {
            return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException ex) {
            future.cancel(true);
            throw ex;
        }
    }
}
```

Retry decorator:

```java
final class RetryDecorator<T> implements RemoteCall<T> {
    private final RemoteCall<T> delegate;
    private final int maxAttempts;
    private final Predicate<Throwable> retryable;

    RetryDecorator(RemoteCall<T> delegate, int maxAttempts, Predicate<Throwable> retryable) {
        this.delegate = delegate;
        this.maxAttempts = maxAttempts;
        this.retryable = retryable;
    }

    @Override
    public T execute() throws Exception {
        Throwable last = null;

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return delegate.execute();
            } catch (Throwable ex) {
                last = ex;
                if (attempt == maxAttempts || !retryable.test(ex)) {
                    throw ex;
                }
                sleepWithJitter(attempt);
            }
        }

        if (last instanceof Exception e) {
            throw e;
        }
        throw new RuntimeException(last);
    }

    private void sleepWithJitter(int attempt) throws InterruptedException {
        long maxDelay = Math.min(1000, 100L * (1L << Math.min(attempt, 5)));
        long delay = ThreadLocalRandom.current().nextLong(maxDelay + 1);
        Thread.sleep(delay);
    }
}
```

Bulkhead decorator:

```java
final class BulkheadDecorator<T> implements RemoteCall<T> {
    private final RemoteCall<T> delegate;
    private final Semaphore semaphore;

    BulkheadDecorator(RemoteCall<T> delegate, int maxConcurrent) {
        this.delegate = delegate;
        this.semaphore = new Semaphore(maxConcurrent);
    }

    @Override
    public T execute() throws Exception {
        if (!semaphore.tryAcquire()) {
            throw new BulkheadRejectedException();
        }
        try {
            return delegate.execute();
        } finally {
            semaphore.release();
        }
    }
}
```

Fallback decorator:

```java
final class FallbackDecorator<T> implements RemoteCall<T> {
    private final RemoteCall<T> delegate;
    private final Function<Throwable, T> fallback;

    FallbackDecorator(RemoteCall<T> delegate, Function<Throwable, T> fallback) {
        this.delegate = delegate;
        this.fallback = fallback;
    }

    @Override
    public T execute() throws Exception {
        try {
            return delegate.execute();
        } catch (Throwable ex) {
            return fallback.apply(ex);
        }
    }
}
```

Ini menunjukkan bahwa resilience pattern sering merupakan structural/behavioral composition.

Namun production code sebaiknya memakai library matang atau framework yang sudah punya metrics, state machine, concurrency safety, dan config support.

### 14.2 Resilience as Policy Object

Jangan hardcode resilience config tersebar.

Lebih baik:

```java
record ResiliencePolicy(
        Duration totalTimeout,
        Duration attemptTimeout,
        int maxAttempts,
        Duration baseBackoff,
        Duration maxBackoff,
        int maxConcurrent,
        double circuitFailureRateThreshold,
        Duration circuitOpenDuration
) {}
```

Policy per dependency:

```text
identityProviderPolicy
profileServicePolicy
emailGatewayPolicy
reportExportPolicy
paymentGatewayPolicy
```

Kenapa per dependency?

Karena setiap dependency punya:

- latency profile berbeda,
- criticality berbeda,
- failure semantics berbeda,
- idempotency berbeda,
- rate limit berbeda,
- fallback possibility berbeda.

---

## 15. Java 8–25 Perspective

### 15.1 Java 8

Java 8 membawa:

- `CompletableFuture`,
- lambda,
- functional interface,
- stream.

Dampak resilience:

- retry/fallback bisa dimodelkan sebagai function decorator,
- async composition lebih mudah,
- tetapi `CompletableFuture` bisa menjadi spaghetti jika timeout/cancellation/context tidak jelas.

### 15.2 Java 9–17

Peningkatan HTTP client dan language feature membuat client wrapper lebih clean.

Records membantu membuat result/error/config immutable.

Sealed classes membantu error taxonomy:

```java
sealed interface RemoteFailure permits TimeoutFailure, CircuitOpenFailure, RateLimitedFailure {}
```

### 15.3 Java 21

Virtual threads mengubah cost model blocking I/O.

Namun virtual threads bukan pengganti resilience.

Dengan virtual threads:

```text
blocking becomes cheaper,
unbounded concurrency becomes more tempting,
downstream overload becomes easier if no limiter exists.
```

Jadi virtual threads membuat bulkhead/concurrency limiter semakin penting.

### 15.4 Java 25

Structured concurrency dan scoped values membantu desain resilience yang lebih eksplisit:

- parent-child task lifecycle,
- cancellation propagation,
- deadline propagation,
- context propagation tanpa `ThreadLocal` leak.

Dengan model ini, resilience bisa bergerak dari “timeout per future” ke “bounded task tree”.

---

## 16. Anti-Pattern Catalog

### 16.1 Retry Storm

Gejala:

- downstream latency naik,
- upstream retry naik,
- traffic meningkat saat error,
- error rate makin parah,
- CPU/thread/connection pool saturated.

Penyebab:

- immediate retry,
- no backoff,
- no jitter,
- nested retry,
- no retry budget,
- retry write tanpa idempotency,
- retry saat downstream overload.

Solusi:

- bounded retry,
- backoff + jitter,
- retry budget,
- circuit breaker,
- rate limiter,
- idempotency,
- classify retryable failures.

### 16.2 Timeoutless Call

Gejala:

- request menggantung,
- thread pool habis,
- deployment sulit shutdown,
- p99 latency tidak terkendali.

Solusi:

- set connect/read/write/call timeout,
- propagate deadline,
- cancel task on timeout,
- measure timeout.

### 16.3 Fallback Hiding Corruption

Gejala:

- user melihat response “normal”,
- dependency sebenarnya rusak,
- keputusan bisnis salah,
- audit sulit menjelaskan data source.

Solusi:

- fallback explicit,
- mark stale/partial/degraded,
- alert on fallback rate,
- no fallback for safety-critical decisions unless domain-approved.

### 16.4 Circuit Breaker Everywhere

Gejala:

- terlalu banyak config,
- false open,
- debugging sulit,
- circuit untuk local method,
- alert noise.

Solusi:

- circuit hanya untuk failure boundary signifikan,
- define per dependency,
- minimum call volume,
- sensible threshold,
- metrics and ownership.

### 16.5 Bulkhead Without Rejection Strategy

Gejala:

- queue panjang,
- latency naik,
- memory naik,
- request obsolete tetap diproses.

Solusi:

- queue bound,
- reject early,
- priority handling,
- deadline check before queue.

### 16.6 Default Success on Failure

Contoh:

```java
boolean allowed;
try {
    allowed = authzClient.isAllowed(user, action);
} catch (Exception ex) {
    allowed = true;
}
```

Ini anti-pattern serius.

Untuk security/compliance:

```text
fail closed unless explicitly designed otherwise.
```

### 16.7 Config Copy-Paste

Semua downstream diberi config sama:

```text
timeout 30s
retry 3x
circuit threshold 50%
bulkhead 100
```

Ini menunjukkan tidak ada dependency-specific thinking.

---

## 17. Refactoring Path

### 17.1 Starting Point

```java
public Decision enrich(Application app) {
    Profile profile = profileClient.get(app.applicantId());
    RiskScore risk = riskClient.score(app.applicantId());
    Address address = addressClient.lookup(app.postalCode());

    return decisionEngine.decide(app, profile, risk, address);
}
```

Masalah:

- tidak ada timeout,
- tidak ada fallback,
- tidak ada classification error,
- semua dependency dianggap sama,
- no observability,
- no deadline,
- no partial semantics,
- no retry/idempotency model.

### 17.2 Step 1: Define Dependency Contracts

```java
interface ProfileGateway {
    ProfileResult getProfile(ApplicantId applicantId, RequestDeadline deadline);
}
```

Result eksplisit:

```java
sealed interface ProfileResult {
    record Available(Profile profile) implements ProfileResult {}
    record Unavailable(String reason) implements ProfileResult {}
    record Stale(Profile profile, Instant asOf) implements ProfileResult {}
}
```

### 17.3 Step 2: Add Timeout and Deadline

```java
ProfileResult getProfile(ApplicantId applicantId, RequestDeadline deadline) {
    Duration remaining = deadline.remaining();
    if (remaining.isNegative() || remaining.isZero()) {
        return new ProfileResult.Unavailable("deadline_exceeded_before_call");
    }
    return client.fetch(applicantId, remaining);
}
```

### 17.4 Step 3: Classify Error

```java
catch (RemoteException ex) {
    return switch (classifier.classify(ex)) {
        case RETRYABLE -> retryThenFallback(applicantId, deadline, ex);
        case NON_RETRYABLE -> new ProfileResult.Unavailable(ex.code());
        case SECURITY -> throw ex;
    };
}
```

### 17.5 Step 4: Add Retry with Budget

```java
RetryPolicy retryPolicy = RetryPolicy.forDependency("profile-service");
```

Ensure:

- max attempt,
- total elapsed time,
- jitter,
- idempotency for writes,
- metrics.

### 17.6 Step 5: Add Circuit Breaker

Circuit breaker sits at gateway boundary.

```java
return circuitBreaker.call(() -> retry.call(() -> client.fetch(applicantId, timeout)));
```

### 17.7 Step 6: Add Bulkhead

```java
return bulkhead.call(() -> circuitBreaker.call(() -> retry.call(...)));
```

### 17.8 Step 7: Add Explicit Fallback

```java
catch (CircuitOpenException ex) {
    return cache.find(applicantId)
            .map(cached -> new ProfileResult.Stale(cached.profile(), cached.updatedAt()))
            .orElse(new ProfileResult.Unavailable("profile_service_circuit_open"));
}
```

### 17.9 Step 8: Add Observability

Metrics:

```text
profile.calls.total
profile.calls.success
profile.calls.timeout
profile.calls.retry
profile.calls.circuit_open
profile.calls.bulkhead_rejected
profile.calls.fallback_stale
profile.latency
```

Logs:

```json
{
  "event": "profile_gateway_call_failed",
  "dependency": "profile-service",
  "reason": "timeout",
  "attempt": 2,
  "remainingDeadlineMs": 320,
  "correlationId": "..."
}
```

Trace:

```text
span attributes:
- dependency.name
- resilience.retry.attempt
- resilience.circuit.state
- resilience.fallback.used
- error.classification
```

---

## 18. Testing Strategy

### 18.1 Unit Test Failure Classification

```text
Given HTTP 400 -> do not retry
Given HTTP 429 -> retry after
Given TimeoutException -> retry
Given AccessDenied -> do not retry and fail closed
```

### 18.2 Retry Test

Test:

- retry count,
- stops after success,
- stops after non-retryable error,
- uses backoff,
- respects deadline,
- does not retry when budget exhausted.

### 18.3 Circuit Breaker Test

Test:

- closed -> open after threshold,
- open rejects without downstream call,
- half-open allows limited probe,
- success closes,
- failure reopens,
- business error not counted as circuit failure.

### 18.4 Bulkhead Test

Test:

- max concurrency enforced,
- permit released on success,
- permit released on exception,
- reject when full,
- metrics emitted.

### 18.5 Fallback Test

Test:

- fallback only for allowed failure,
- no fallback for security failure,
- stale flag present,
- partial response explicit,
- fallback emits metric.

### 18.6 Chaos/Failure Injection

Important scenarios:

```text
Downstream returns 500 for 60 seconds
Downstream latency p99 jumps to 10 seconds
Downstream accepts connection but never responds
DNS fails
TLS handshake stalls
Rate limit 429 returned
DB connection pool saturated
Cache stale only
Circuit half-open probe fails
```

### 18.7 Load Test

Measure:

- p50/p95/p99 latency,
- timeout rate,
- retry rate,
- saturation,
- rejection rate,
- fallback rate,
- downstream request amplification factor.

Request amplification factor:

```text
actual downstream calls / incoming logical requests
```

If incoming 1000 requests produce 2800 downstream calls due to retry, you must know.

---

## 19. Observability and Operations

### 19.1 Metrics You Need

Per dependency:

```text
request count
success count
failure count
timeout count
retry attempt count
retry exhausted count
circuit state
circuit open count
bulkhead active count
bulkhead rejected count
rate limit rejected count
fallback count
fallback type
latency histogram
queue wait time
```

### 19.2 Log Events

Important events:

```text
retry attempt
retry exhausted
circuit opened
circuit half-opened
circuit closed
bulkhead rejected
fallback used
deadline exceeded
rate limited
load shed
```

### 19.3 Alerting

Alert examples:

```text
Circuit open for critical dependency > 2 minutes
Fallback rate > 5% for 10 minutes
Timeout rate doubled after deployment
Bulkhead rejection > 1% sustained
Retry amplification factor > 1.5x
p99 latency above SLA for 15 minutes
```

### 19.4 Dashboard Questions

A good resilience dashboard answers:

```text
Which dependency is degraded?
Are we failing fast or waiting until timeout?
Are retries helping or amplifying load?
Is circuit breaker protecting us?
Are fallbacks being used?
Are users seeing stale or partial data?
Is any tenant causing saturation?
Did this start after a deployment?
```

---

## 20. Security and Compliance Angle

Resilience can create security issues.

### 20.1 Fail Open vs Fail Closed

For security-sensitive decisions:

```text
Authentication failure -> fail closed
Authorization failure -> fail closed
Policy engine unavailable -> usually fail closed or manual review
Audit write failure -> depends on regulatory requirement; often must block or use durable outbox
```

Never casually fallback to allow.

### 20.2 Fallback Data Exposure

Fallback cache may contain data user no longer has permission to see.

If authorization changes, stale cache can leak data.

Need:

- permission-aware cache,
- short TTL,
- revalidation,
- user-scoped cache,
- no shared fallback for sensitive data.

### 20.3 Auditability

For regulated decisions, record:

```text
primary dependency result
fallback used or not
fallback data version
reason for degraded decision
operator/user visible flag
correlation id
```

A decision made with stale external data must be distinguishable from a decision made with fresh authoritative data.

---

## 21. Performance Considerations

### 21.1 Retry Increases Load

Retry is not free.

Cost:

- more network calls,
- more CPU,
- more allocations,
- more downstream pressure,
- longer user latency,
- more logs/traces.

### 21.2 Timeout Too Low

If timeout too low:

- false failure,
- unnecessary retry,
- circuit opens incorrectly,
- user sees error despite downstream healthy but slow.

### 21.3 Timeout Too High

If timeout too high:

- resource held too long,
- failure detected late,
- cascading failure risk.

### 21.4 Circuit Threshold Too Sensitive

If threshold too sensitive:

- false open,
- unnecessary degraded mode,
- recovery flapping.

### 21.5 Circuit Threshold Too Lenient

If threshold too lenient:

- callers continue waiting,
- resources exhausted before circuit opens.

### 21.6 Bulkhead Too Small

- too many rejected requests,
- underutilization.

### 21.7 Bulkhead Too Large

- downstream overwhelmed,
- local resource exhaustion.

---

## 22. Design Review Checklist

Gunakan checklist ini saat review remote dependency atau integration boundary.

### 22.1 Timeout

```text
[ ] Ada connect timeout?
[ ] Ada read/response timeout?
[ ] Ada overall call timeout?
[ ] Ada request deadline?
[ ] Timeout lebih kecil dari upstream SLA?
[ ] Timeout terlihat di metric/log?
[ ] Timeout membatalkan underlying work bila mungkin?
```

### 22.2 Retry

```text
[ ] Failure diklasifikasikan sebelum retry?
[ ] Retry hanya untuk transient failure?
[ ] Ada max attempts?
[ ] Ada max elapsed time/deadline?
[ ] Ada backoff?
[ ] Ada jitter?
[ ] Ada retry budget?
[ ] Write operation idempotent?
[ ] Tidak ada nested retry yang tidak disadari?
```

### 22.3 Circuit Breaker

```text
[ ] Circuit breaker dipasang pada real failure boundary?
[ ] Ada minimum call volume?
[ ] Ada failure rate threshold?
[ ] Ada slow call threshold bila perlu?
[ ] Ada half-open strategy?
[ ] Open/close event logged?
[ ] State exposed as metric?
[ ] Ada owner yang menerima alert?
```

### 22.4 Bulkhead

```text
[ ] Resource dependency di-isolate?
[ ] Ada concurrency limit?
[ ] Ada queue limit?
[ ] Rejection behavior jelas?
[ ] Metrics saturation tersedia?
[ ] Virtual thread tidak membuat concurrency unlimited?
```

### 22.5 Fallback

```text
[ ] Fallback semantically safe?
[ ] Stale/partial/degraded response eksplisit?
[ ] Tidak fallback untuk security-critical failure kecuali disetujui domain?
[ ] Fallback rate dimonitor?
[ ] Fallback tidak memanggil dependency yang sama?
```

### 22.6 Observability

```text
[ ] Ada metric per dependency?
[ ] Retry amplification factor terlihat?
[ ] Circuit state terlihat?
[ ] Bulkhead rejection terlihat?
[ ] Fallback usage terlihat?
[ ] Trace menunjukkan attempt dan fallback?
[ ] Alert tidak hanya berdasarkan 5xx, tapi juga degraded mode?
```

---

## 23. Case Study: External Address Validation API

### 23.1 Context

Sistem regulatory application perlu memvalidasi alamat melalui external address API.

Requirement:

```text
- User submit application.
- Address API kadang rate limited.
- API punya limit 300 requests/minute.
- Validasi alamat membantu, tetapi bukan satu-satunya syarat submit.
- Untuk beberapa application type, alamat authoritative wajib.
- Untuk type lain, manual review boleh.
```

### 23.2 Naive Design

```java
public void submit(Application app) {
    Address address = addressClient.validate(app.postalCode());
    app.setAddress(address);
    repository.save(app);
}
```

Masalah:

- no timeout,
- no rate limit,
- no fallback,
- no business differentiation,
- external failure blocks all submissions,
- no audit evidence.

### 23.3 Better Model

```java
sealed interface AddressValidationResult {
    record Valid(Address address, Instant validatedAt) implements AddressValidationResult {}
    record Invalid(String reason) implements AddressValidationResult {}
    record Unavailable(String reason) implements AddressValidationResult {}
    record Deferred(String reason) implements AddressValidationResult {}
}
```

### 23.4 Policy

```java
final class AddressValidationPolicy {
    boolean mustBlockSubmission(ApplicationType type, AddressValidationResult result) {
        return switch (result) {
            case AddressValidationResult.Valid ignored -> false;
            case AddressValidationResult.Invalid ignored -> true;
            case AddressValidationResult.Unavailable ignored -> type.requiresAuthoritativeAddress();
            case AddressValidationResult.Deferred ignored -> false;
        };
    }
}
```

### 23.5 Resilience Boundary

```text
submit use case
  -> deadline check
  -> address gateway
       -> rate limiter 300/min
       -> bulkhead max 20 concurrent
       -> circuit breaker
       -> retry only 429/503/timeout with jitter
       -> timeout 800ms per attempt
       -> fallback to deferred/manual review if domain allows
  -> persist result with validation status
  -> audit event
```

### 23.6 Outcome

Now the system can say:

```text
Application submitted.
Address validation deferred because external address API unavailable.
Manual review required before approval.
```

This is much better than either:

```text
- block all users because external API is down
- silently accept unvalidated address
```

---

## 24. Staff-Level Discussion Prompts

Gunakan pertanyaan ini untuk mengevaluasi kedalaman pemahaman.

```text
1. Kapan retry memperbaiki availability, dan kapan memperburuk outage?
2. Apa beda timeout per attempt dan total deadline?
3. Bagaimana kamu mendesain retry untuk write operation?
4. Apa indikator bahwa circuit breaker threshold terlalu agresif?
5. Bagaimana virtual threads mengubah bulkhead design?
6. Apa fallback yang aman untuk authorization service failure?
7. Bagaimana mengukur retry amplification factor?
8. Apakah circuit breaker harus menghitung setiap attempt atau logical request?
9. Bagaimana mencegah fallback cache membocorkan data yang sudah tidak boleh diakses user?
10. Apa yang harus terlihat di dashboard saat downstream degraded?
```

---

## 25. Summary

Resilience pattern bukan library checklist.

```text
Retry bukan default.
Timeout bukan angka random.
Circuit breaker bukan dekorasi.
Bulkhead bukan hanya thread pool.
Fallback bukan pemalsuan sukses.
```

Mental model utama:

```text
Resilience adalah desain untuk membatasi kegagalan,
mengendalikan resource,
menjaga fungsi penting,
dan memberi sinyal operasional yang jujur.
```

Top engineer selalu bertanya:

```text
Apa failure boundary-nya?
Apa timeout budget-nya?
Apakah retry aman?
Apakah operation idempotent?
Apa yang terjadi saat dependency lambat, bukan hanya mati?
Apa blast radius-nya?
Apa fallback-nya valid secara domain?
Apakah degradation terlihat?
Apakah recovery terkendali?
```

Jika pattern resilience tidak menjawab pertanyaan ini, ia hanya konfigurasi kosmetik.

---

## 26. Referensi Lanjut

Gunakan referensi berikut untuk memperdalam konsep:

1. Martin Fowler — Circuit Breaker.
2. Microsoft Azure Architecture Center — Circuit Breaker Pattern.
3. Microsoft Azure Architecture Center — Bulkhead Pattern.
4. AWS Builders Library — Timeouts, retries, and backoff with jitter.
5. Google SRE Book — Addressing Cascading Failures.
6. Release It! — Michael Nygard.
7. Resilience4j documentation.
8. Java SE documentation: `CompletableFuture`, `ExecutorService`, `HttpClient`, virtual threads, scoped values, structured concurrency.
9. Enterprise Integration Patterns — Messaging and endpoint reliability concepts.

---

## 27. Status Seri

```text
Part 24 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
25-integration-gateway-adapter-outbox-inbox-saga-idempotency.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./23-concurrency-executor-future-completablefuture-structured-concurrency.md">⬅️ Concurrency Pattern II: Executor, Future, CompletableFuture, Structured Concurrency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./25-integration-gateway-adapter-outbox-inbox-saga-idempotency.md">Part 25 — Integration Pattern: Gateway, Adapter, Outbox, Inbox, Saga, Idempotency ➡️</a>
</div>

# learn-java-reliability-part-016.md

# Part 016 — Timeouts, Deadlines, and Cancellation

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Status: Part 016 / 030  
> Bagian sebelumnya: Part 015 — Idempotency as Core Reliability Primitive  
> Bagian berikutnya: Part 017 — Retry Engineering

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas **idempotency** sebagai primitive yang membuat retry dan duplicate execution menjadi aman. Namun idempotency saja belum cukup. Sebelum sistem memutuskan untuk retry, fail, cancel, atau degrade, sistem harus punya batas waktu yang jelas.

Masalah intinya:

> Banyak sistem tidak gagal karena ada exception. Banyak sistem gagal karena menunggu terlalu lama, menunggu tanpa batas, atau tetap bekerja setelah caller sudah menyerah.

Bagian ini membahas **timeouts, deadlines, dan cancellation** sebagai kontrak waktu dalam sistem reliable.

Setelah bagian ini, kamu diharapkan mampu:

1. membedakan timeout, deadline, cancellation, abort, interrupt, dan shutdown timeout;
2. memahami kenapa timeout bukan sekadar konfigurasi angka;
3. mendesain timeout budget lintas call-chain;
4. menerapkan deadline propagation dari entrypoint sampai dependency;
5. membedakan client timeout, server timeout, DB timeout, pool timeout, transaction timeout, message processing timeout, dan shutdown timeout;
6. menangani orphan work, zombie task, stuck thread, slow dependency, dan resource leak;
7. memahami cancellation semantics di Java, Spring, HTTP client, DB operation, async worker, dan RPC;
8. menghindari anti-pattern seperti infinite wait, retry tanpa deadline, nested timeout yang tidak sinkron, dan cancellation yang hanya menghentikan `Future` tetapi pekerjaan tetap jalan.

---

## 1. Core Problem

Bayangkan service berikut:

```text
Client
  -> API Gateway
    -> Service A
      -> Service B
        -> Database
        -> External Provider
```

Client punya timeout 3 detik.

Service A punya timeout 10 detik ke Service B.

Service B punya timeout 30 detik ke external provider.

Database query bisa berjalan 60 detik.

Sekilas semua punya timeout. Tapi sistem tetap rusak.

Kenapa?

Karena timeout-nya tidak membentuk satu kontrak waktu yang konsisten.

Skenario failure:

```text
T+0s   Client sends request
T+3s   Client gives up
T+10s  Service A gives up
T+30s  Service B gives up on provider
T+60s  Database query ends
```

Selama 57 detik setelah client menyerah, backend masih mungkin:

- memakai thread;
- memegang DB connection;
- menahan lock;
- memproses side effect;
- mengirim event;
- melakukan retry;
- menulis audit;
- memanggil external dependency;
- memperbesar backlog;
- membuat response yang tidak akan pernah diterima client.

Ini disebut **orphan work**: pekerjaan yang sudah tidak memiliki caller yang menunggu, tetapi masih mengonsumsi resource dan mungkin mengubah state.

Masalahnya bukan hanya latency. Masalahnya adalah **resource ownership dan semantic ownership**.

Pertanyaan reliability-nya:

```text
Jika caller sudah menyerah, apakah callee masih boleh bekerja?
Jika request budget habis, apakah transaksi masih boleh commit?
Jika shutdown dimulai, apakah worker masih boleh mengambil pekerjaan baru?
Jika timeout terjadi, apakah operasi aman di-retry?
Jika cancellation dikirim, apakah downstream benar-benar berhenti?
```

Tanpa jawaban eksplisit, sistem akan punya behavior yang bergantung pada kebetulan library, thread scheduler, network timing, dan database driver.

---

## 2. Mental Model: Timeout adalah Kontrak Waktu, Bukan Angka

Banyak engineer memperlakukan timeout seperti config:

```properties
external.timeout=5000
```

Padahal timeout adalah bagian dari desain sistem.

Timeout menjawab:

1. **berapa lama caller bersedia menunggu?**
2. **berapa lama callee boleh memakai resource?**
3. **kapan hasil dianggap tidak lagi berguna?**
4. **kapan pekerjaan harus dihentikan?**
5. **kapan sistem harus melepaskan resource?**
6. **apakah setelah timeout operasi boleh dilanjutkan diam-diam?**
7. **apakah setelah timeout caller boleh retry?**
8. **apakah timeout berarti failure final atau unknown outcome?**

Timeout yang baik bukan sekadar mencegah lambat. Timeout yang baik membatasi **blast radius waktu**.

```text
Tanpa timeout:
- thread bisa tertahan tanpa batas
- connection pool bisa habis
- lock bisa bertahan lama
- queue bisa menumpuk
- shutdown bisa macet
- retry bisa berlapis
- cascading failure lebih mungkin terjadi

Dengan timeout yang benar:
- resource dilepas lebih cepat
- caller mendapat failure signal
- retry bisa dikontrol
- overload bisa dibatasi
- shutdown bisa diprediksi
- incident lebih mudah dianalisis
```

Timeout adalah salah satu bentuk **temporal isolation**.

---

## 3. Vocabulary: Timeout, Deadline, Cancellation, Interrupt, Abort

Sebelum masuk desain, kita perlu membedakan beberapa istilah.

### 3.1 Timeout

**Timeout** adalah durasi maksimum untuk sebuah operasi.

Contoh:

```text
HTTP call timeout: 2 seconds
DB query timeout: 5 seconds
Pool acquisition timeout: 500 ms
Transaction timeout: 10 seconds
```

Timeout biasanya bersifat relatif terhadap saat operasi dimulai.

```text
start at 10:00:00
allowed duration 2 seconds
must finish by 10:00:02
```

Kelemahannya: kalau setiap layer membuat timeout sendiri tanpa melihat waktu tersisa dari caller, total waktu bisa membengkak.

---

### 3.2 Deadline

**Deadline** adalah batas waktu absolut kapan operasi harus selesai.

Contoh:

```text
request deadline = 10:00:02.500
```

Setiap downstream menghitung sisa waktu dari deadline yang sama.

```text
remaining = deadline - now
```

Deadline lebih cocok untuk distributed system karena seluruh call-chain bekerja dalam satu budget yang sama.

Model mental:

```text
Timeout lokal:
A memberi B 2s
B memberi C 2s
C memberi D 2s
Total bisa 6s+

Deadline propagated:
Client memberi deadline T+3s
A, B, C, D semua melihat deadline yang sama
Tidak ada layer yang boleh melewati T+3s
```

gRPC secara eksplisit memakai konsep deadline: client dapat menentukan berapa lama ia bersedia menunggu, dan server dapat membatalkan call ketika deadline terlampaui. Dokumentasi gRPC juga menekankan bahwa server harus menghentikan komputasi ketika call dibatalkan.

---

### 3.3 Cancellation

**Cancellation** adalah sinyal bahwa pekerjaan tidak lagi diperlukan atau tidak lagi boleh dilanjutkan.

Cancellation dapat terjadi karena:

- user membatalkan request;
- client disconnect;
- deadline exceeded;
- timeout;
- shutdown;
- parent task failed;
- circuit breaker open;
- system overload;
- batch job stopped;
- operator kill switch.

Cancellation idealnya bukan hanya menghentikan wait di caller. Cancellation harus dipropagasikan ke pekerjaan yang sedang berjalan.

```text
Bad cancellation:
caller stops waiting, worker keeps running

Good cancellation:
caller stops waiting, worker gets signal, downstream gets signal, resource released
```

---

### 3.4 Interrupt

Dalam Java, thread interruption adalah mekanisme kooperatif untuk memberi sinyal ke thread bahwa ia sebaiknya berhenti.

Important:

```text
Thread.interrupt() tidak membunuh thread secara paksa.
```

Thread harus:

- sedang berada di blocking call yang interruptible; atau
- secara berkala mengecek interrupt flag; atau
- menangani `InterruptedException` dengan benar.

Anti-pattern:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    // ignore
}
```

Ini buruk karena cancellation signal hilang.

Lebih benar:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("Interrupted while waiting", e);
}
```

---

### 3.5 Abort

**Abort** adalah penghentian paksa atau semi-paksa.

Contoh:

- close socket;
- close DB statement;
- cancel query;
- kill process;
- SIGKILL;
- force shutdown executor;
- terminate pod setelah grace period habis.

Abort biasanya lebih berisiko daripada cancellation karena operasi bisa berhenti di tengah side effect.

---

### 3.6 Shutdown Timeout

Shutdown timeout adalah budget waktu untuk berhenti secara graceful.

Contoh:

```text
Kubernetes terminationGracePeriodSeconds = 30s
Spring shutdown phase timeout = 25s
Executor awaitTermination = 20s
HTTP server drain = 20s
```

Shutdown timeout tidak boleh dilihat terpisah dari request timeout. Kalau request bisa berjalan 120 detik tetapi pod termination budget 30 detik, maka graceful shutdown tidak realistis.

---

## 4. Why Infinite Wait is a Reliability Bug

Infinite wait sering muncul dalam bentuk:

```java
future.get();
queue.take();
lock.lock();
condition.await();
httpClient.send(request, handler);
repository.findSomethingHeavy();
executor.awaitTermination(Long.MAX_VALUE, TimeUnit.DAYS);
```

Kadang infinite wait memang valid untuk daemon worker tertentu, tetapi di request path dan shutdown path, infinite wait hampir selalu berbahaya.

Dampaknya:

### 4.1 Thread Exhaustion

Thread menunggu dependency lambat. Traffic tetap masuk. Thread pool penuh. Request baru tidak bisa diproses.

```text
Dependency slow
-> threads blocked
-> thread pool exhausted
-> health endpoint slow
-> load balancer thinks service unhealthy
-> traffic shifts to remaining pods
-> remaining pods overloaded
-> cascading failure
```

---

### 4.2 Connection Pool Exhaustion

DB query lambat memegang connection. Request lain menunggu connection. Pool acquisition ikut macet.

```text
Query slow
-> DB connections held
-> connection pool exhausted
-> unrelated endpoints fail
```

Timeout query dan timeout pool harus dibedakan.

---

### 4.3 Lock Contention

Satu transaction lambat memegang row lock. Transaction lain menunggu. Sistem terlihat “hang” tanpa CPU tinggi.

```text
Transaction A locks row
Transaction A waits external API
Transaction B waits same row
Transaction C waits same row
```

Akar masalahnya sering bukan database, tetapi transaction boundary yang terlalu besar dan tidak punya timeout jelas.

---

### 4.4 Shutdown Cannot Finish

Pod menerima SIGTERM. Spring mulai shutdown. Executor menunggu task selesai. Task menunggu dependency tanpa timeout.

```text
SIGTERM
-> graceful shutdown starts
-> worker still blocked
-> grace period expires
-> SIGKILL
-> partial work
-> duplicate/replay uncertainty
```

Shutdown yang “graceful” berubah menjadi forced termination.

---

### 4.5 Orphan Work and False Failure

Caller timeout, tetapi server tetap memproses dan commit.

```text
Client sees failure
Server commits success
Client retries
Duplicate unless idempotent
```

Timeout harus dikaitkan dengan idempotency dan outcome uncertainty.

---

## 5. Timeout Types in Backend Systems

Timeout bukan satu jenis. Dalam service produksi, ada banyak timeout yang punya tujuan berbeda.

---

## 5.1 Client Request Timeout

Timeout di sisi caller.

Contoh:

```text
Browser timeout
Mobile app timeout
API gateway timeout
Service-to-service HTTP client timeout
```

Pertanyaan desain:

- Berapa lama caller bersedia menunggu?
- Apakah caller akan retry?
- Apakah retry memakai idempotency key?
- Apakah timeout berarti user boleh submit ulang?
- Apakah caller menerima `Retry-After`?

Client timeout adalah batas kesabaran caller, bukan bukti bahwa server tidak memproses.

---

## 5.2 Server Request Timeout

Timeout di sisi service penerima request.

Tujuannya:

- mencegah request berjalan terlalu lama;
- melepas thread/resource;
- mengembalikan error response sebelum upstream timeout;
- mencegah orphan work;
- menjaga SLO.

Server timeout harus lebih kecil dari timeout caller/upstream.

Contoh:

```text
API Gateway timeout: 30s
Service server timeout: 25s
Internal dependency budget: 20s
DB/query budget: 5s
```

Jika server timeout lebih panjang dari upstream, server akan tetap bekerja setelah upstream menyerah.

---

## 5.3 Connect Timeout

Connect timeout adalah waktu maksimum untuk membuka koneksi ke remote address.

Failure mode:

- DNS lambat;
- TCP connect lambat;
- network unreachable;
- SYN packet drop;
- remote host tidak menerima connection.

Connect timeout biasanya harus pendek.

Contoh mental:

```text
Jika service internal normalnya connect < 20 ms,
connect timeout 10 seconds mungkin terlalu besar.
```

Java `HttpClient.Builder` menyediakan `connectTimeout(Duration)` untuk mengatur timeout saat membangun koneksi baru.

---

## 5.4 Read / Response Timeout

Read timeout atau response timeout adalah waktu maksimum menunggu response data.

Failure mode:

- dependency menerima request tetapi lambat memproses;
- server remote hang;
- network idle;
- response streaming berhenti;
- proxy menahan response.

Read timeout biasanya lebih panjang dari connect timeout, tetapi harus tetap sesuai request budget.

---

## 5.5 Write Timeout

Write timeout adalah waktu maksimum untuk mengirim request body ke remote.

Penting untuk:

- upload besar;
- file transfer;
- streaming;
- slow network;
- backpressure.

Write timeout yang tidak jelas bisa membuat thread tertahan saat remote tidak membaca data.

---

## 5.6 Pool Acquisition Timeout

Pool acquisition timeout adalah waktu maksimum menunggu resource dari pool.

Contoh:

- DB connection pool;
- HTTP connection pool;
- thread pool;
- object pool;
- Redis connection pool.

Ini berbeda dari operation timeout.

```text
Pool acquisition timeout: menunggu connection tersedia
Query timeout: query berjalan setelah connection diperoleh
```

Jika pool acquisition timeout terlalu panjang, request menumpuk dan tail latency memburuk.

Jika terlalu pendek, sistem bisa gagal cepat saat spike kecil.

---

## 5.7 Query Timeout

Query timeout membatasi durasi statement/query di database.

Tujuannya:

- mencegah query berat berjalan tanpa batas;
- mencegah lock lama;
- melindungi DB capacity;
- memastikan request budget tidak habis hanya di DB.

Query timeout tidak selalu identik dengan transaction timeout.

Satu transaksi dapat menjalankan beberapa query. Masing-masing query punya timeout, tetapi transaksi juga perlu budget keseluruhan.

---

## 5.8 Transaction Timeout

Transaction timeout membatasi durasi keseluruhan transaksi.

Spring `@Transactional` memiliki atribut `timeout` yang default-nya mengikuti transaction system yang mendasari. Timeout transaksi terutama relevan untuk propagation `REQUIRED` dan `REQUIRES_NEW` menurut dokumentasi `@Transactional`.

Contoh:

```java
@Transactional(timeout = 5)
public void approveCase(ApproveCaseCommand command) {
    // all transactional work should finish within 5 seconds
}
```

Namun transaction timeout tidak boleh dijadikan solusi untuk transaction boundary yang salah.

Anti-pattern:

```java
@Transactional(timeout = 60)
public void process() {
    repository.updateSomething();
    externalApi.call(); // bad inside DB transaction
    repository.updateSomethingElse();
}
```

Masalahnya bukan timeout 60 detik. Masalahnya external call berada di dalam transaksi DB.

---

## 5.9 Lock Timeout

Lock timeout membatasi berapa lama operasi menunggu lock.

Jenis:

- database row lock timeout;
- distributed lock timeout;
- JVM lock wait timeout;
- advisory lock timeout.

Lock timeout harus dikaitkan dengan semantic conflict.

Contoh:

```text
User A sedang approve case
User B mencoba approve case yang sama
```

Jika lock timeout terjadi, apakah response-nya:

- 409 Conflict?
- 423 Locked?
- 503 Service Unavailable?
- retryable technical failure?

Jawabannya tergantung domain.

---

## 5.10 Queue Processing Timeout

Worker yang mengambil message dari queue harus punya processing timeout.

Pertanyaan:

- Berapa lama satu message boleh diproses?
- Jika timeout, ack atau nack?
- Apakah message boleh requeue?
- Apakah operasi idempotent?
- Apakah ada checkpoint?
- Kapan masuk dead letter queue?

Tanpa processing timeout, satu message poison atau stuck bisa menahan worker tanpa batas.

---

## 5.11 Batch Job Timeout

Batch job sering lebih lama dari request HTTP, tetapi tetap perlu batas.

Timeout batch dapat diterapkan per:

- job;
- partition;
- chunk;
- item;
- external call;
- DB batch;
- lock lease.

Batch reliable harus bisa resume dari checkpoint, bukan hanya “diperpanjang timeout-nya”.

---

## 5.12 Shutdown Timeout

Shutdown timeout membatasi durasi drain.

Harus konsisten dengan:

- max request duration;
- max message processing duration;
- executor await termination;
- broker visibility timeout / ack timeout;
- Kubernetes grace period;
- load balancer deregistration;
- readiness removal delay.

Jika message processing normalnya 5 menit, tetapi pod grace period 30 detik, maka shutdown tidak bisa dijamin graceful untuk message tersebut.

---

## 6. Deadline Budgeting Across Call Chain

Timeout lokal sering menghasilkan total latency yang tidak terkendali.

Contoh buruk:

```text
API Gateway timeout: 30s
Service A -> B timeout: 30s
Service B -> C timeout: 30s
Service C -> DB timeout: 30s
```

Ini tidak berarti request selesai dalam 30 detik. Ini bisa menghasilkan nested waiting dan orphan work.

Model yang lebih baik adalah deadline budget.

```text
Client deadline: T+3000 ms
Gateway overhead: 100 ms
Service A internal budget: remaining - safety margin
Service B budget: remaining - safety margin
DB query budget: min(remaining - margin, dbMax)
```

---

## 6.1 Budget Decomposition

Misalnya endpoint punya SLO 2 detik untuk p95.

Kita bisa memecah budget:

```text
Total request budget: 2000 ms

Ingress/gateway overhead:       100 ms
Authentication/session:         100 ms
Input validation:                50 ms
Service orchestration:          100 ms
DB read/write:                  400 ms
External API call:              700 ms
Serialization/response:          50 ms
Safety margin:                  500 ms
```

Safety margin penting karena:

- GC pause;
- scheduling delay;
- network jitter;
- queueing;
- logging overhead;
- TLS overhead;
- thread handoff;
- retry/fallback decision.

Tanpa margin, service akan sering menyelesaikan pekerjaan setelah upstream sudah timeout.

---

## 6.2 Remaining Time Calculation

Deadline harus dihitung berdasarkan waktu monotonic, bukan wall clock yang bisa berubah karena NTP.

Konsep:

```java
public final class Deadline {
    private final long deadlineNanos;

    private Deadline(long deadlineNanos) {
        this.deadlineNanos = deadlineNanos;
    }

    public static Deadline after(Duration duration) {
        return new Deadline(System.nanoTime() + duration.toNanos());
    }

    public Duration remaining() {
        long remaining = deadlineNanos - System.nanoTime();
        return remaining <= 0 ? Duration.ZERO : Duration.ofNanos(remaining);
    }

    public boolean isExpired() {
        return remaining().isZero();
    }

    public Duration remainingMinus(Duration margin) {
        Duration remaining = remaining();
        if (remaining.compareTo(margin) <= 0) {
            return Duration.ZERO;
        }
        return remaining.minus(margin);
    }
}
```

Catatan:

- `System.nanoTime()` cocok untuk elapsed time.
- Jangan gunakan `LocalDateTime.now()` untuk menghitung durasi internal.
- Deadline absolut antar-service biasanya dikirim sebagai timestamp atau duration remaining, tetapi service lokal tetap sebaiknya memakai monotonic clock setelah menerima.

---

## 6.3 Deadline Propagation Header

Untuk HTTP service-to-service, deadline bisa dipropagasikan melalui header internal.

Contoh:

```http
X-Request-Deadline-Millis: 1760000000123
X-Request-Timeout-Millis: 2500
X-Correlation-Id: abc-123
```

Lebih aman memilih satu canonical form.

Trade-off:

```text
Absolute timestamp:
+ mudah dibandingkan antar-service
- sensitif clock skew

Remaining duration:
+ tidak sensitif clock skew saat diterima
- setiap hop perlu mengurangi elapsed time sendiri

Hybrid:
+ bisa dipakai untuk observability dan safety
- lebih kompleks
```

Dalam sistem enterprise internal, pendekatan sederhana:

```text
Ingress membuat deadline.
Service internal membaca header deadline.
Jika missing, service membuat default deadline konservatif.
Jika expired, reject early.
Jika too large, cap ke max allowed.
```

---

## 6.4 Deadline Cap

Jangan percaya deadline dari client eksternal secara mentah.

Client bisa mengirim:

```http
X-Request-Deadline-Millis: 9999999999999
```

Service harus punya max cap.

```java
Duration maxAllowed = Duration.ofSeconds(10);
Duration requested = parseDeadlineOrDefault(request);
Duration effective = min(requested, maxAllowed);
```

Untuk request eksternal, deadline dari client biasanya bukan trust boundary yang aman. Lebih baik API gateway atau edge service menetapkan deadline internal.

---

## 7. Timeout Ordering Rule

Rule penting:

> Timeout downstream harus lebih pendek daripada timeout upstream, dengan margin yang cukup untuk handling, fallback, logging, dan response.

Contoh:

```text
Client timeout:           10s
API gateway timeout:       9s
Service request timeout:   8s
External call timeout:     3s
DB timeout:                2s
Transaction timeout:       5s
```

Bukan berarti semua endpoint harus sama. Tapi harus ada ordering.

Anti-pattern:

```text
Client timeout:           5s
Service timeout:          30s
DB query timeout:         60s
```

Dampak:

- client sudah pergi;
- service tetap bekerja;
- DB tetap bekerja;
- retry bisa masuk;
- duplicate/outcome uncertainty muncul.

---

## 8. Timeout as Admission Control

Timeout bukan hanya untuk operasi yang sudah berjalan. Timeout juga bagian dari admission control.

Jika deadline tersisa terlalu pendek, lebih baik reject sebelum memulai pekerjaan mahal.

Contoh:

```java
public void handle(Command command, Deadline deadline) {
    if (deadline.remaining().compareTo(Duration.ofMillis(300)) < 0) {
        throw new DeadlineTooShortException("Not enough time to safely process command");
    }

    process(command, deadline);
}
```

Kenapa?

Karena memulai transaksi, mengambil lock, atau memanggil external API ketika waktu tersisa 50 ms hampir pasti menghasilkan partial work atau timeout.

Decision:

```text
If remaining time < minimum safe processing time:
    reject early with retryable response if idempotent
else:
    proceed with bounded sub-budgets
```

---

## 9. Java Timeout Building Blocks

Java menyediakan beberapa building block, tetapi masing-masing punya jebakan.

---

## 9.1 `Future.get(timeout)`

Contoh:

```java
Future<Result> future = executor.submit(() -> doWork());

try {
    return future.get(2, TimeUnit.SECONDS);
} catch (TimeoutException e) {
    future.cancel(true);
    throw new OperationTimedOutException("Work timed out", e);
}
```

Important:

```text
future.get(timeout) hanya membatasi waktu menunggu caller.
Pekerjaan di worker belum tentu berhenti kecuali cancel dikirim dan task kooperatif terhadap interrupt.
```

Jika task mengabaikan interrupt, ia tetap berjalan.

---

## 9.2 `CompletableFuture.orTimeout`

Contoh:

```java
CompletableFuture<Result> future = CompletableFuture
        .supplyAsync(() -> doWork(), executor)
        .orTimeout(2, TimeUnit.SECONDS);
```

Caveat:

```text
Timeout pada CompletableFuture sering menyelesaikan future secara exceptional,
tetapi tidak selalu menghentikan pekerjaan underlying yang sudah berjalan.
```

Karena itu, untuk operation yang punya side effect, jangan mengandalkan `orTimeout` sebagai cancellation penuh.

---

## 9.3 `completeOnTimeout`

Contoh:

```java
CompletableFuture<Result> future = callDependency()
        .completeOnTimeout(Result.degraded(), 1, TimeUnit.SECONDS);
```

Ini fallback temporal.

Risiko:

- dependency call masih berjalan;
- fallback bisa menciptakan false success;
- caller melihat success padahal dependency gagal/lambat;
- side effect bisa terjadi setelah fallback diberikan.

Gunakan hanya untuk read-only/degradable operation yang aman.

---

## 9.4 `ExecutorService.awaitTermination`

Saat shutdown:

```java
executor.shutdown();
if (!executor.awaitTermination(20, TimeUnit.SECONDS)) {
    List<Runnable> dropped = executor.shutdownNow();
}
```

Caveat:

- `shutdown()` stop menerima task baru tetapi task existing tetap jalan.
- `shutdownNow()` mencoba interrupt running tasks dan mengembalikan queued tasks yang belum mulai.
- Running task harus kooperatif terhadap interrupt.
- Shutdown timeout harus lebih kecil dari container grace period.

---

## 9.5 `Thread.sleep` and `InterruptedException`

Rule:

> Jangan swallow `InterruptedException`.

Benar:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("Interrupted", e);
}
```

Atau jika method memang bagian dari loop worker:

```java
while (!Thread.currentThread().isInterrupted()) {
    processNext();
}
```

---

## 10. HTTP Client Timeout Design

Service-to-service HTTP call minimal perlu:

- connect timeout;
- request/response timeout;
- pool acquisition timeout jika memakai pool;
- total deadline;
- cancellation behavior;
- retry policy;
- idempotency behavior;
- circuit breaker behavior.

---

## 10.1 Java `HttpClient`

Contoh:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(300))
        .build();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://provider.example.com/api"))
        .timeout(Duration.ofSeconds(2))
        .GET()
        .build();

try {
    HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
    return response.body();
} catch (HttpTimeoutException e) {
    throw new DependencyTimedOutException("Provider timed out", e);
} catch (IOException e) {
    throw new DependencyUnavailableException("Provider I/O failure", e);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("Interrupted while calling provider", e);
}
```

Design note:

```text
connectTimeout: batas membuka connection
request.timeout: batas request selesai
InterruptedException: cancellation/shutdown signal
```

Jangan treat semua sebagai 500 generic. Klasifikasikan:

```text
connect timeout -> dependency unavailable / transient
request timeout -> dependency slow / transient / maybe unknown outcome
interrupted -> cancellation / shutdown / caller no longer interested
```

---

## 10.2 Timeout from Remaining Deadline

Jangan hardcode semua dependency timeout.

```java
Duration timeout = deadline.remainingMinus(Duration.ofMillis(100));

if (timeout.compareTo(Duration.ofMillis(200)) < 0) {
    throw new DeadlineTooShortException("Not enough remaining time for provider call");
}

HttpRequest request = HttpRequest.newBuilder()
        .uri(providerUri)
        .timeout(min(timeout, Duration.ofSeconds(2)))
        .GET()
        .build();
```

Prinsip:

```text
actual dependency timeout = min(configured max timeout, remaining deadline - margin)
```

---

## 10.3 Response Timeout vs Whole Operation Timeout

Untuk external call dengan retry:

```text
Total budget: 2s
Attempt 1 timeout: 500ms
Backoff: 100ms
Attempt 2 timeout: 500ms
Backoff: 200ms
Attempt 3 timeout: 500ms
Safety margin: 200ms
```

Jangan lakukan:

```text
3 attempts × 2s each = 6s
padahal caller hanya punya 2s
```

Retry harus tunduk pada deadline.

---

## 11. Database and Transaction Timeout Design

Database timeout sering paling kritikal karena DB adalah shared bottleneck.

---

## 11.1 Pool Acquisition Timeout

Jika connection pool habis, request harus gagal cepat, bukan menunggu sampai upstream timeout.

Failure mapping:

```text
Cannot acquire DB connection quickly
-> system saturation
-> 503 Service Unavailable
-> retryable maybe yes, but with backoff
```

Ini biasanya bukan validation error dan bukan 409 conflict.

---

## 11.2 Query Timeout

Query timeout harus mencerminkan:

- endpoint SLO;
- transaction timeout;
- expected query complexity;
- lock risk;
- DB capacity;
- operational tolerance.

Jika query timeout terjadi, outcome bisa berbeda:

```text
SELECT timeout:
- usually no business mutation
- response can be 503/504 or dependency timeout

UPDATE timeout:
- database may have rolled back statement
- transaction may be marked rollback-only
- caller sees uncertain state depending driver/transaction manager
```

Jangan sembarangan retry write query kecuali command idempotent.

---

## 11.3 Transaction Timeout

Transaction timeout harus lebih kecil dari request timeout dan shutdown budget.

Contoh:

```text
Request timeout:      8s
Transaction timeout:  5s
DB query timeout:     2s
```

Transaction timeout terlalu besar menyebabkan lock bertahan lebih lama.

Transaction timeout terlalu kecil menyebabkan rollback pada operasi valid.

Gunakan transaction timeout sebagai guardrail, bukan solusi performa.

---

## 11.4 Avoid External Calls Inside Transactions

Anti-pattern:

```java
@Transactional
public void approve(ApproveCommand command) {
    Case c = repository.lockById(command.caseId());
    c.approve();
    provider.notifyApproval(c); // external call inside transaction
    auditRepository.save(...);
}
```

Risiko:

- DB lock ditahan selama external call;
- external timeout menyebabkan transaction rollback;
- external provider mungkin sudah menerima side effect;
- retry bisa duplicate;
- shutdown di tengah call menghasilkan uncertainty.

Lebih baik:

```java
@Transactional
public void approve(ApproveCommand command) {
    Case c = repository.lockById(command.caseId());
    c.approve();
    outboxRepository.save(ApprovalNotificationRequested.from(c));
    auditRepository.save(...);
}
```

Lalu worker memproses outbox dengan timeout/retry/idempotency sendiri.

---

## 12. Cancellation Propagation

Timeout tanpa cancellation menghasilkan orphan work.

Cancellation propagation berarti:

```text
Caller no longer interested
-> current service stops local work if safe
-> downstream calls are cancelled/closed if possible
-> DB query is cancelled if possible
-> worker checks cancellation token
-> transaction rolls back if not committed
-> resource released
```

---

## 12.1 Cancellation Token Pattern

Java tidak punya universal cancellation token seperti beberapa platform lain. Kita bisa membuat abstraction sendiri.

```java
public interface CancellationToken {
    boolean isCancellationRequested();
    void throwIfCancellationRequested();
}
```

Implementasi sederhana dengan deadline dan interrupt:

```java
public final class RequestCancellationToken implements CancellationToken {
    private final Deadline deadline;

    public RequestCancellationToken(Deadline deadline) {
        this.deadline = deadline;
    }

    @Override
    public boolean isCancellationRequested() {
        return Thread.currentThread().isInterrupted() || deadline.isExpired();
    }

    @Override
    public void throwIfCancellationRequested() {
        if (Thread.currentThread().isInterrupted()) {
            throw new OperationCancelledException("Thread interrupted");
        }
        if (deadline.isExpired()) {
            throw new DeadlineExceededException("Request deadline exceeded");
        }
    }
}
```

Gunakan di loop panjang:

```java
for (Item item : items) {
    token.throwIfCancellationRequested();
    processItem(item, token);
}
```

---

## 12.2 Cancellation at Service Boundary

Tidak semua operasi aman dibatalkan.

Classification:

```text
Read-only operation:
- usually safe to cancel

Before side effect:
- safe to cancel

During local transaction before commit:
- safe if rollback happens

After commit:
- cannot cancel past state change
- must return/recover/reconcile

During external side effect:
- outcome unknown
- need idempotency/reconciliation

After external provider accepted request:
- cannot assume cancellation succeeded
```

Cancellation bukan time machine. Ia tidak membatalkan side effect yang sudah terjadi.

---

## 12.3 Cancellation and Transaction Boundary

Jika cancellation terjadi sebelum commit:

```text
throw exception
transaction rolls back
return timeout/cancelled
```

Jika cancellation terjadi setelah commit tetapi sebelum response:

```text
state already changed
client may see timeout
retry must be idempotent
```

Karena itu, operasi mutating harus punya idempotency/outcome lookup.

---

## 13. Error Semantics: Timeout vs Cancelled vs Deadline Exceeded

Jangan samakan semua.

### 13.1 Timeout

Operation exceeded local duration.

Possible mapping:

```text
504 Gateway Timeout if acting as gateway/proxy to dependency
503 Service Unavailable if internal resource saturated/slow
500 only if unexpected and not classifiable
```

---

### 13.2 Deadline Exceeded

Request-level budget habis.

Meaning:

```text
The operation did not complete within the allowed end-to-end time.
```

Response bisa menyertakan:

```json
{
  "type": "https://errors.example.com/deadline-exceeded",
  "title": "Request deadline exceeded",
  "status": 504,
  "code": "REQUEST_DEADLINE_EXCEEDED",
  "retryable": true,
  "correlationId": "..."
}
```

Tetapi retryable hanya benar jika operation idempotent atau belum dimulai.

---

### 13.3 Cancelled

Operation cancelled because caller/shutdown/system no longer wants it.

Contoh:

- client disconnected;
- shutdown started;
- user cancelled;
- parent workflow cancelled.

Cancelled tidak selalu error bisnis. Kadang itu expected lifecycle event.

Logging level bisa `INFO` atau `WARN`, bukan selalu `ERROR`.

---

### 13.4 Interrupted

Thread received interrupt. Dalam Java, ini adalah signal. Jangan dibungkus menjadi generic runtime exception tanpa restore interrupt.

---

### 13.5 Unknown Outcome

Timeout pada mutating external call sering berarti unknown outcome.

```text
Did provider receive request?
Did provider commit?
Did response get lost?
```

Error contract harus jujur.

```json
{
  "code": "PAYMENT_PROVIDER_OUTCOME_UNKNOWN",
  "retryable": false,
  "resolution": "CHECK_STATUS_BY_IDEMPOTENCY_KEY"
}
```

Jangan bilang “failed” jika sebenarnya “unknown”.

---

## 14. Designing Deadline-Aware Use Case Handler

Contoh command handler:

```java
public final class SubmitApplicationUseCase {
    private static final Duration MIN_SAFE_TIME = Duration.ofMillis(500);
    private static final Duration DB_MARGIN = Duration.ofMillis(100);

    private final ApplicationRepository repository;
    private final IdempotencyService idempotencyService;

    public SubmitApplicationResult handle(
            SubmitApplicationCommand command,
            Deadline deadline,
            CancellationToken cancellation
    ) {
        cancellation.throwIfCancellationRequested();

        if (deadline.remaining().compareTo(MIN_SAFE_TIME) < 0) {
            throw new DeadlineTooShortException("Not enough time to safely submit application");
        }

        return idempotencyService.execute(command.idempotencyKey(), command.fingerprint(), () -> {
            cancellation.throwIfCancellationRequested();
            return createApplication(command, deadline, cancellation);
        });
    }

    @Transactional(timeout = 5)
    protected SubmitApplicationResult createApplication(
            SubmitApplicationCommand command,
            Deadline deadline,
            CancellationToken cancellation
    ) {
        cancellation.throwIfCancellationRequested();

        Application app = Application.submit(command);
        repository.save(app);

        cancellation.throwIfCancellationRequested();

        return SubmitApplicationResult.created(app.id());
    }
}
```

Important:

- cek deadline sebelum side effect;
- cek cancellation pada boundary penting;
- gunakan idempotency untuk mutating command;
- transaction timeout tetap ada sebagai guardrail;
- jangan mulai command jika waktu tersisa terlalu pendek.

---

## 15. Timeout and Retry Interaction

Retry tanpa deadline sangat berbahaya.

Anti-pattern:

```text
Attempt timeout: 2s
Max attempts: 5
Backoff: 1s, 2s, 4s
Total worst-case: 2+1+2+2+2+4+2 = 15s+
Caller timeout: 5s
```

Retry harus berhenti jika remaining deadline tidak cukup.

Pseudo-code:

```java
for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    Duration remaining = deadline.remaining();

    if (remaining.compareTo(minAttemptBudget) < 0) {
        throw new DeadlineExceededException("No time left for another attempt");
    }

    Duration attemptTimeout = min(configuredAttemptTimeout, remaining.minus(safetyMargin));

    try {
        return callDependency(attemptTimeout);
    } catch (RetriableException e) {
        if (attempt == maxAttempts) {
            throw e;
        }

        Duration backoff = backoffFor(attempt);
        if (deadline.remaining().compareTo(backoff.plus(minAttemptBudget)) < 0) {
            throw new DeadlineExceededException("No time left after backoff", e);
        }

        sleep(backoff);
    }
}
```

Rule:

```text
Retry policy must be deadline-aware.
```

---

## 16. Timeout and Circuit Breaker Interaction

Circuit breaker dan timeout saling terkait.

Jika timeout terlalu panjang:

```text
slow dependency holds resources longer
failure detected late
circuit opens late
system overloads first
```

Jika timeout terlalu pendek:

```text
normal slow-but-valid calls fail
circuit sees many failures
circuit opens unnecessarily
availability drops
```

Circuit breaker harus melihat metric yang sesuai:

- failure rate;
- slow call rate;
- timeout count;
- rejected call count;
- half-open success/failure;
- dependency latency distribution.

Resilience4j memiliki TimeLimiter untuk membatasi durasi asynchronous operation, tetapi tetap perlu dipahami bahwa time limiter bukan jaminan side effect berhenti kalau underlying task tidak kooperatif.

---

## 17. Timeout and Bulkhead Interaction

Bulkhead membatasi concurrency. Timeout membatasi durasi.

Keduanya perlu bersama.

Tanpa timeout:

```text
Bulkhead size 10
10 calls stuck forever
bulkhead permanently exhausted
```

Tanpa bulkhead:

```text
Timeout 5s
1000 calls concurrently waiting
resource exhausted before timeout fires
```

Desain yang benar:

```text
bulkhead max concurrent calls: 20
bulkhead wait duration: 100 ms
call timeout: 800 ms
request deadline: 2 s
```

Bulkhead wait timeout harus pendek. Jika tidak bisa masuk bulkhead, fail fast atau degrade.

---

## 18. Timeout and Rate Limiter Interaction

Rate limiter membatasi jumlah request per waktu. Timeout membatasi durasi request.

Masalah umum:

```text
Thread waits too long to acquire rate limit permission
Then call still needs timeout
Total exceeds deadline
```

Rate limiter acquisition harus deadline-aware.

```text
If permission cannot be acquired within remaining budget:
    reject early
```

---

## 19. Timeout and Graceful Shutdown

Shutdown adalah cancellation massal dengan deadline.

Saat shutdown dimulai:

```text
1. stop accepting new work
2. mark readiness false
3. drain in-flight requests
4. stop schedulers from starting new jobs
5. stop consumers from polling new messages
6. allow current safe units to finish within deadline
7. cancel/interrupt remaining work if deadline almost exhausted
8. release resources
9. exit
```

Setiap task harus tahu shutdown deadline.

Anti-pattern:

```java
@PreDestroy
public void stop() {
    executor.shutdown();
    executor.awaitTermination(10, TimeUnit.MINUTES);
}
```

Jika Kubernetes grace period 30 detik, menunggu 10 menit tidak berguna. Pod akan di-SIGKILL.

Lebih baik:

```java
@PreDestroy
public void stop() {
    executor.shutdown();
    try {
        if (!executor.awaitTermination(20, TimeUnit.SECONDS)) {
            executor.shutdownNow();
        }
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        executor.shutdownNow();
    }
}
```

Tetapi yang lebih baik lagi adalah lifecycle management via Spring `SmartLifecycle` atau managed executor configuration, bukan ad-hoc shutdown di banyak bean.

---

## 20. Message Consumer Timeout and Visibility/Ack Semantics

Worker queue punya timeout semantics yang unik.

### 20.1 RabbitMQ Style Ack

Jika worker menerima message dan manual ack:

```text
message delivered
worker processes
worker ack -> broker removes message
worker dies before ack -> broker redelivers
```

Processing timeout harus menentukan:

- stop processing;
- nack/requeue;
- reject to DLQ;
- extend processing lease jika ada;
- checkpoint partial progress.

---

### 20.2 Kafka Style Offset Commit

Kafka consumer memproses record dan commit offset.

Timeout risks:

```text
process succeeds but offset commit fails -> duplicate processing
process times out before commit -> record redelivered/reprocessed
process hangs too long -> consumer group rebalance
```

Maka handler harus idempotent.

---

### 20.3 Worker Processing Timeout Template

```java
public void handleMessage(Message message, Deadline deadline) {
    CancellationToken token = new RequestCancellationToken(deadline);

    try {
        if (deadline.remaining().compareTo(Duration.ofSeconds(1)) < 0) {
            nackRequeue(message);
            return;
        }

        process(message, token);
        ack(message);
    } catch (DeadlineExceededException e) {
        nackRequeueOrDlq(message, e);
    } catch (NonRetriableMessageException e) {
        rejectToDlq(message, e);
    } catch (RetriableDependencyException e) {
        nackRequeue(message);
    } catch (Exception e) {
        rejectToDlqOrRetryByPolicy(message, e);
    }
}
```

Key point:

```text
Timeout decision must map to broker semantics.
```

---

## 21. Long-Running Operations

Tidak semua operasi cocok diproses synchronously dalam request timeout.

Jika operasi butuh waktu lama:

- submit command;
- persist request;
- return `202 Accepted`;
- process async;
- expose status endpoint;
- make operation idempotent;
- support cancellation if domain allows;
- expose progress/checkpoint;
- provide reconciliation.

Contoh:

```http
POST /reports
Idempotency-Key: abc

202 Accepted
Location: /reports/jobs/job-123
```

Kemudian:

```http
GET /reports/jobs/job-123
```

Response:

```json
{
  "jobId": "job-123",
  "status": "PROCESSING",
  "startedAt": "2026-06-15T10:00:00Z",
  "expiresAt": "2026-06-16T10:00:00Z"
}
```

Ini lebih reliable daripada memaksa HTTP request menunggu 5 menit.

---

## 22. Timeout Selection Heuristics

Tidak ada angka universal. Timeout harus dipilih berdasarkan data dan failure mode.

Pertimbangkan:

1. p50/p95/p99 latency normal;
2. SLO endpoint;
3. upstream timeout;
4. dependency SLO;
5. retry attempts;
6. idempotency availability;
7. resource cost per in-flight request;
8. lock duration tolerance;
9. user experience;
10. shutdown grace period;
11. queue visibility/ack timeout;
12. operational recovery time.

Rule awal:

```text
Timeout should be:
- longer than normal p99 plus reasonable jitter
- shorter than caller timeout
- shorter than resource exhaustion window
- short enough to fail before cascading failure
- long enough to avoid false failures under normal load
```

---

## 23. Example Timeout Matrix

Contoh untuk service internal request-response:

| Layer | Timeout | Rationale |
|---|---:|---|
| Browser/mobile | 15s | UX upper bound |
| API Gateway | 12s | edge protection |
| Backend request deadline | 10s | end-to-end budget |
| Service-to-service call | 2s | dependency bounded |
| External provider call | 3s | slower dependency |
| DB pool acquisition | 200ms | fail fast on saturation |
| DB query | 1s-3s | based on query class |
| Transaction | 5s | lock protection |
| Bulkhead wait | 50ms-100ms | admission control |
| Retry total | within remaining deadline | avoid amplification |
| Shutdown drain | 20s | within pod grace period |

Ini bukan angka final. Ini pola berpikir.

---

## 24. Timeout Classes by Endpoint Type

Endpoint tidak semua sama.

### 24.1 Fast Read Endpoint

```text
GET /cases/{id}
Expected: < 200ms
Timeout: 1s
Retry: possible
Fallback: maybe cache
```

### 24.2 Search Endpoint

```text
GET /cases/search
Expected: 500ms-2s
Timeout: 3s-5s
Retry: maybe not automatic
Fallback: partial/empty risky
```

### 24.3 Mutating Command

```text
POST /applications/submit
Expected: 1s-3s
Timeout: 5s-8s
Retry: only with idempotency key
Fallback: no fake success
```

### 24.4 Approval/State Transition

```text
POST /cases/{id}/approve
Expected: 1s-3s
Timeout: 5s
Retry: idempotency + state check
Lock timeout: short
```

### 24.5 Report Generation

```text
POST /reports
Expected: long
Synchronous timeout: short
Pattern: async job + 202 Accepted
```

### 24.6 External Provider Lookup

```text
GET /address/lookup?postalCode=...
Expected: provider dependent
Timeout: 1s-3s
Fallback: cache if allowed
Rate limit: yes
```

---

## 25. Timeout Observability

Timeout tanpa observability membuat debugging sulit.

Log harus mencatat:

- operation name;
- configured timeout;
- remaining deadline;
- elapsed time;
- dependency name;
- attempt number;
- retryable classification;
- idempotency key presence, bukan value sensitif;
- cancellation reason;
- correlation ID;
- trace ID.

Contoh structured log:

```json
{
  "event": "dependency_timeout",
  "operation": "AddressLookupClient.lookup",
  "dependency": "OneMap",
  "configuredTimeoutMs": 2000,
  "remainingDeadlineMs": 2300,
  "elapsedMs": 2001,
  "attempt": 1,
  "retryable": true,
  "correlationId": "abc-123"
}
```

Metrics:

```text
request_deadline_exceeded_total
request_cancelled_total
dependency_timeout_total{dependency="..."}
dependency_connect_timeout_total
db_query_timeout_total
db_pool_acquisition_timeout_total
transaction_timeout_total
executor_task_timeout_total
shutdown_timeout_total
orphan_work_detected_total
retry_skipped_due_to_deadline_total
```

Histograms:

```text
request_duration_seconds
dependency_call_duration_seconds
db_query_duration_seconds
queue_message_processing_duration_seconds
shutdown_phase_duration_seconds
```

Alerting:

```text
Timeout rate increase + saturation increase = possible dependency/DB overload
Timeout rate increase only = possible timeout too aggressive or dependency slow
Deadline exceeded increase = request budget mismatch
Pool acquisition timeout = capacity or leak
Shutdown timeout = stuck worker/request
```

---

## 26. Timeout Error Response Design

Timeout response harus jelas.

### 26.1 Dependency Timeout

```json
{
  "type": "https://errors.example.com/dependency-timeout",
  "title": "Dependency timed out",
  "status": 504,
  "code": "DEPENDENCY_TIMEOUT",
  "message": "A required downstream service did not respond in time.",
  "retryable": true,
  "correlationId": "abc-123"
}
```

---

### 26.2 Request Deadline Exceeded

```json
{
  "type": "https://errors.example.com/request-deadline-exceeded",
  "title": "Request deadline exceeded",
  "status": 504,
  "code": "REQUEST_DEADLINE_EXCEEDED",
  "message": "The request could not complete within the allowed time budget.",
  "retryable": true,
  "correlationId": "abc-123"
}
```

---

### 26.3 Unknown Outcome for Mutating Command

```json
{
  "type": "https://errors.example.com/operation-outcome-unknown",
  "title": "Operation outcome unknown",
  "status": 202,
  "code": "OPERATION_OUTCOME_UNKNOWN",
  "message": "The operation was submitted but the final outcome could not be confirmed before timeout.",
  "retryable": false,
  "statusUrl": "/operations/op-123",
  "correlationId": "abc-123"
}
```

Kadang `202 Accepted` lebih jujur daripada `500` jika sistem sudah menerima command tetapi hasil final belum diketahui.

Namun ini harus didesain sejak awal, bukan improvisasi saat timeout.

---

## 27. Common Anti-Patterns

### 27.1 No Timeout

```java
httpClient.send(request, handler); // no clear timeout
```

Dampak:

- thread stuck;
- resource leak;
- shutdown stuck.

---

### 27.2 Timeout Only at Caller

```text
Caller stops waiting
Callee keeps working
```

Dampak:

- orphan work;
- duplicate on retry;
- hidden resource consumption.

---

### 27.3 Same Timeout Everywhere

```text
Every dependency timeout = 30s
```

Dampak:

- no budget reasoning;
- long tail;
- unpredictable total duration.

---

### 27.4 Downstream Timeout Longer Than Upstream

```text
Gateway: 5s
Service: 30s
DB: 60s
```

Dampak:

- guaranteed orphan work under slow condition.

---

### 27.5 Retrying After Deadline Expired

```text
Deadline already expired
Retry still starts new attempt
```

Dampak:

- wasted work;
- overload amplification.

---

### 27.6 Swallowing InterruptedException

```java
catch (InterruptedException ignored) {}
```

Dampak:

- cancellation lost;
- shutdown slow;
- task refuses to stop.

---

### 27.7 Timeout Inside Transaction Around External Call

```java
@Transactional
void process() {
    updateDb();
    callExternalWithTimeout();
}
```

Dampak:

- DB lock held during network wait;
- partial side effect;
- rollback does not undo external call.

---

### 27.8 Fallback on Mutating Timeout

```text
Payment provider timeout -> return success using fallback
```

Dampak:

- false success;
- reconciliation nightmare;
- user/business sees wrong state.

---

### 27.9 Overly Aggressive Timeout

Timeout terlalu pendek bisa menciptakan failure palsu.

```text
Normal p99 = 900ms
Timeout = 500ms
```

Dampak:

- unnecessary retry;
- circuit breaker opens;
- user sees instability.

---

### 27.10 Timeout Without Metrics

Jika timeout terjadi tetapi tidak ada metric, tuning menjadi tebak-tebakan.

---

## 28. Production Checklist

Gunakan checklist ini untuk review service.

### 28.1 Request Path

- [ ] Apakah setiap endpoint punya request deadline?
- [ ] Apakah deadline lebih pendek dari upstream timeout?
- [ ] Apakah deadline dipropagasikan ke downstream?
- [ ] Apakah service reject early jika remaining time terlalu kecil?
- [ ] Apakah mutating command memakai idempotency?
- [ ] Apakah timeout error membedakan failure final vs unknown outcome?

---

### 28.2 Dependency Calls

- [ ] Apakah ada connect timeout?
- [ ] Apakah ada response/read timeout?
- [ ] Apakah timeout dihitung dari remaining deadline?
- [ ] Apakah retry tunduk pada deadline?
- [ ] Apakah cancellation menutup request jika memungkinkan?
- [ ] Apakah dependency timeout dimetric-kan per dependency?

---

### 28.3 Database

- [ ] Apakah DB pool acquisition timeout dikonfigurasi?
- [ ] Apakah query timeout dikonfigurasi untuk query berisiko?
- [ ] Apakah transaction timeout sesuai request budget?
- [ ] Apakah external call dihindari di dalam transaction?
- [ ] Apakah lock timeout punya mapping error yang benar?
- [ ] Apakah write timeout dianggap unknown outcome jika perlu?

---

### 28.4 Async / Worker

- [ ] Apakah message processing punya timeout?
- [ ] Apakah timeout mapping ke ack/nack/DLQ jelas?
- [ ] Apakah worker bisa menerima cancellation/shutdown signal?
- [ ] Apakah long-running job punya checkpoint?
- [ ] Apakah duplicate processing aman?
- [ ] Apakah poison message tidak menahan worker selamanya?

---

### 28.5 Shutdown

- [ ] Apakah shutdown timeout selaras dengan Kubernetes grace period?
- [ ] Apakah executor awaitTermination punya batas?
- [ ] Apakah task kooperatif terhadap interrupt?
- [ ] Apakah scheduler berhenti membuat job baru saat shutdown?
- [ ] Apakah consumers stop polling sebelum resource ditutup?
- [ ] Apakah shutdown timeout punya metric/log?

---

### 28.6 Observability

- [ ] Apakah timeout diklasifikasikan per type?
- [ ] Apakah logs mencatat elapsed, configured timeout, remaining deadline?
- [ ] Apakah timeout rate dimonitor?
- [ ] Apakah pool timeout dan dependency timeout dibedakan?
- [ ] Apakah cancellation bukan selalu error-level log?
- [ ] Apakah unknown outcome punya evidence?

---

## 29. Design Patterns

### 29.1 Deadline Context Pattern

Buat `RequestContext` internal:

```java
public record RequestContext(
        String correlationId,
        Deadline deadline,
        CancellationToken cancellationToken
) {
    public Duration timeoutFor(Duration configuredMax, Duration margin) {
        Duration remaining = deadline.remainingMinus(margin);
        if (remaining.compareTo(configuredMax) > 0) {
            return configuredMax;
        }
        return remaining;
    }
}
```

Penggunaan:

```java
Duration timeout = context.timeoutFor(Duration.ofSeconds(2), Duration.ofMillis(100));
providerClient.call(command, timeout);
```

---

### 29.2 Minimum Safe Time Guard

```java
public void assertEnoughTime(Deadline deadline, Duration minimum) {
    if (deadline.remaining().compareTo(minimum) < 0) {
        throw new DeadlineTooShortException(
                "Remaining deadline is too short to safely start operation"
        );
    }
}
```

Gunakan sebelum:

- start transaction;
- acquire lock;
- call external provider;
- process batch chunk;
- publish side-effect.

---

### 29.3 Deadline-Aware Retry

```java
public <T> T executeWithRetry(Callable<T> action, Deadline deadline) {
    int attempt = 0;

    while (true) {
        attempt++;

        if (deadline.remaining().compareTo(Duration.ofMillis(300)) < 0) {
            throw new DeadlineExceededException("No time left for retry attempt");
        }

        try {
            return action.call();
        } catch (RetriableException e) {
            if (attempt >= 3) {
                throw e;
            }

            Duration backoff = Duration.ofMillis(100L * attempt);
            if (deadline.remaining().compareTo(backoff.plusMillis(300)) < 0) {
                throw new DeadlineExceededException("No time left for backoff and retry", e);
            }

            sleepInterruptibly(backoff);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

---

### 29.4 Cancellation-Aware Loop

```java
public void processBatch(List<Item> items, CancellationToken token) {
    for (Item item : items) {
        token.throwIfCancellationRequested();
        processItem(item);
    }
}
```

---

### 29.5 Async Job Instead of Long Request

```text
POST /bulk-imports
-> validate request
-> create job
-> enqueue job
-> return 202 + job status URL

Worker:
-> process chunk
-> checkpoint
-> respect cancellation
-> respect per-chunk timeout
-> expose progress
```

---

## 30. Failure Scenario Walkthroughs

### 30.1 External Dependency Slow

```text
External API latency increases from 200ms to 5s
```

Bad system:

```text
No timeout
-> threads block
-> pool exhausted
-> all endpoints fail
```

Better system:

```text
timeout 1s
-> calls fail fast
-> circuit breaker detects slow/failure rate
-> fallback for safe read endpoint
-> mutating endpoint returns dependency unavailable
-> metrics alert dependency_timeout_total spike
```

---

### 30.2 DB Pool Exhaustion

```text
Slow queries hold connections
```

Bad system:

```text
requests wait indefinitely for connection
upstream timeout happens
backend still waiting
```

Better system:

```text
pool acquisition timeout 200ms
return 503 saturation
alert db_pool_acquisition_timeout_total
protect thread pool
```

---

### 30.3 Timeout After Commit

```text
Server commits order
Response fails due network timeout
Client retries
```

Bad system:

```text
creates duplicate order
```

Better system:

```text
idempotency key detects existing completed operation
returns same result or status URL
```

---

### 30.4 Shutdown During Worker Processing

```text
Pod receives SIGTERM while processing message
```

Bad system:

```text
worker ignores interrupt
pod SIGKILL
message redelivered
partial external side effect duplicate
```

Better system:

```text
consumer stops polling
current message gets deadline from shutdown budget
worker finishes if safe
or nacks before side effect
or records checkpoint
idempotent external call protects duplicate
```

---

### 30.5 Retry Storm After Timeout

```text
Dependency slow
100 clients timeout and retry immediately
```

Bad system:

```text
load doubles/triples
dependency gets worse
cascading failure
```

Better system:

```text
retry budget
exponential backoff with jitter
circuit breaker
rate limiter
deadline-aware retry
idempotency
```

---

## 31. Practical Spring-Oriented Configuration Model

Contoh konsep konfigurasi:

```yaml
app:
  deadline:
    default-request-timeout: 8s
    max-request-timeout: 15s
    safety-margin: 100ms

  http-clients:
    address-provider:
      connect-timeout: 300ms
      response-timeout: 2s
      max-attempts: 2
      min-attempt-budget: 300ms

  database:
    transaction-timeout: 5s
    query-timeout: 2s
    pool-acquisition-timeout: 200ms

  workers:
    message-processing-timeout: 20s
    shutdown-drain-timeout: 25s
```

Prinsip:

- config default boleh ada;
- endpoint/dependency penting boleh override;
- deadline runtime tetap harus menjadi sumber kebenaran;
- config timeout tidak boleh melanggar upstream budget.

---

## 32. What Top-Tier Engineers Pay Attention To

Engineer yang matang tidak hanya bertanya:

```text
Berapa timeout-nya?
```

Mereka bertanya:

```text
Timeout ini melindungi resource apa?
Timeout ini lebih kecil dari timeout siapa?
Jika timeout terjadi, apakah outcome known atau unknown?
Jika caller retry, apakah aman?
Jika cancellation dikirim, siapa yang berhenti?
Jika dependency tetap memproses, bagaimana kita reconcile?
Jika timeout rate naik, metric mana yang membedakan dependency slow vs pool exhausted?
Jika shutdown terjadi, apakah timeout ini masih realistis?
Jika ada fallback, apakah fallback ini benar secara domain?
```

Itulah perbedaan antara menambahkan konfigurasi timeout dan mendesain reliability boundary.

---

## 33. Review Questions

Gunakan pertanyaan ini untuk menguji pemahaman:

1. Apa perbedaan timeout dan deadline?
2. Kenapa timeout caller tidak otomatis menghentikan pekerjaan server?
3. Apa itu orphan work?
4. Kenapa downstream timeout harus lebih pendek dari upstream timeout?
5. Apa risiko `Future.get(timeout)` jika task tidak kooperatif terhadap interrupt?
6. Kenapa `CompletableFuture.orTimeout` bukan jaminan side effect berhenti?
7. Apa perbedaan connect timeout, read timeout, pool acquisition timeout, query timeout, dan transaction timeout?
8. Kenapa external call di dalam transaction berbahaya?
9. Apa yang harus dilakukan ketika timeout terjadi setelah commit?
10. Kapan timeout response harus dianggap unknown outcome?
11. Bagaimana deadline mempengaruhi retry policy?
12. Kenapa cancellation harus dipropagasikan?
13. Kenapa `InterruptedException` tidak boleh diabaikan?
14. Bagaimana timeout worker queue dikaitkan dengan ack/nack/DLQ?
15. Apa hubungan timeout dengan graceful shutdown?
16. Metrics apa yang wajib ada untuk timeout?
17. Bagaimana memilih timeout berdasarkan p99 latency dan SLO?
18. Kapan operasi harus diubah menjadi async job daripada synchronous request?

---

## 34. Ringkasan

Timeout, deadline, dan cancellation adalah fondasi reliability temporal.

Inti bagian ini:

1. Timeout bukan angka konfigurasi, tetapi kontrak waktu.
2. Deadline lebih kuat daripada timeout lokal untuk distributed call-chain.
3. Cancellation harus dipropagasikan agar tidak menciptakan orphan work.
4. Timeout harus diurutkan dari upstream ke downstream.
5. Retry harus tunduk pada deadline.
6. Timeout mutating operation sering menghasilkan unknown outcome, bukan failure pasti.
7. Transaction timeout, query timeout, pool timeout, dan request timeout harus dibedakan.
8. Shutdown adalah cancellation massal dengan deadline.
9. Long-running operation sebaiknya memakai async job, checkpoint, dan status endpoint.
10. Timeout tanpa observability hanya memindahkan masalah ke incident debugging.

Mental model terpenting:

> Sistem reliable bukan hanya sistem yang cepat. Sistem reliable adalah sistem yang tahu batas waktu setiap pekerjaan, tahu kapan harus berhenti, tahu apakah hasilnya masih berguna, dan tahu bagaimana memulihkan state ketika waktu habis.

---

## 35. Referensi

Referensi yang relevan untuk bagian ini:

1. Java `HttpClient.Builder#connectTimeout` dan `HttpRequest.Builder#timeout` — timeout pada Java HTTP Client.
2. Java concurrency primitives — `Future#get(timeout)`, `Future#cancel`, `ExecutorService#awaitTermination`, dan interruption semantics.
3. Spring Framework `@Transactional(timeout = ...)` — transaction timeout mengikuti transaction manager yang digunakan.
4. Resilience4j TimeLimiter — pembatas durasi untuk asynchronous operation.
5. gRPC Deadlines and Cancellation — deadline propagation dan cancellation semantics untuk RPC.
6. Kubernetes Pod termination lifecycle — shutdown budget dan termination grace period.
7. Spring Boot graceful shutdown — relationship antara application shutdown dan in-flight request draining.

---

## 36. Status Seri

```text
Part 016 / 030 completed
Seri belum selesai.
```

Bagian berikutnya:

```text
Part 017 — Retry Engineering
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-reliability-part-015.md](./learn-java-reliability-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-017.md](./learn-java-reliability-part-017.md)

</div>
# Part 13 — Timeout Engineering: Connect, DNS, TLS, Request, Read, Write, Pool Acquisition, and Deadline

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `013-timeout-engineering-connect-dns-tls-request-read-write-pool-acquisition-deadline.md`  
> Target: Java 8–25  
> Level: Advanced / production engineering  
> Prasyarat: Part 0–12, terutama TCP, DNS, HTTP/1.1, HTTP/2, dan JDK `HttpClient`

---

## 1. Tujuan Bagian Ini

Setelah bagian ini, kamu tidak hanya tahu bahwa “timeout harus diset”.

Kamu harus mampu:

1. membedakan jenis-jenis timeout di network call;
2. membaca timeout sebagai **symptom dari phase tertentu**, bukan error generik;
3. mendesain timeout hierarchy yang konsisten dari caller sampai dependency terdalam;
4. menghindari retry storm, thread starvation, pool exhaustion, dan cascading failure;
5. mendesain deadline propagation untuk HTTP dan gRPC;
6. menentukan timeout berdasarkan latency distribution, SLO, criticality, dan capacity budget;
7. menjelaskan kenapa satu angka seperti `timeout = 30s` sering berbahaya;
8. membuat wrapper Java HTTP/gRPC client yang punya timeout policy yang eksplisit;
9. mengobservasi timeout dengan metric dan trace yang bisa dipakai saat incident;
10. menguji timeout behavior secara deterministik.

---

## 2. Core Mental Model

Network call bukan satu operasi.

Network call adalah **pipeline of bounded waiting**.

```text
caller thread/task
  -> local queue / bulkhead / rate limiter
  -> connection pool acquisition
  -> DNS resolution
  -> TCP connect
  -> TLS handshake / ALPN
  -> request write
  -> server queue
  -> server processing
  -> first byte response
  -> response body read
  -> deserialization
  -> return / throw
```

Timeout yang baik tidak menjawab:

```text
Berapa lama saya rela menunggu?
```

Timeout yang baik menjawab:

```text
Berapa lama operasi ini boleh menahan resource lokal,
dengan tetap menjaga SLO caller,
tanpa memperburuk kondisi dependency,
dan tanpa menyembunyikan phase failure?
```

Ini perbedaan besar.

Engineer biasa menulis:

```java
timeout = Duration.ofSeconds(30);
```

Engineer kuat bertanya:

```text
30 detik untuk apa?

- Menunggu connection pool?
- DNS?
- TCP connect?
- TLS handshake?
- Full request?
- First byte?
- Full body?
- Retry total?
- Entire user workflow?
- Per attempt?
- Per dependency?
```

Kalau semua phase memakai satu timeout besar, aplikasi akan sulit didiagnosis, mudah overload, dan failure akan menyebar.

---

## 3. Timeout Bukan Reliability Feature yang Berdiri Sendiri

Timeout hanya salah satu bagian dari control system.

```text
timeout
retry
backoff
jitter
deadline
bulkhead
circuit breaker
rate limiter
connection pool
queue bound
cancellation
fallback
observability
```

Timeout tanpa cancellation bisa tetap membiarkan pekerjaan berjalan di background.

Retry tanpa timeout bisa menggantung terlalu lama.

Timeout tanpa retry bisa terlalu sensitif terhadap transient failure.

Retry tanpa budget bisa menyebabkan retry storm.

Circuit breaker tanpa timeout bisa terlambat membuka.

Bulkhead tanpa timeout bisa penuh oleh request lambat.

Deadline tanpa propagation hanya memotong caller, tetapi dependency tetap bekerja sia-sia.

Jadi bagian ini bukan sekadar “set timeout”.

Bagian ini membahas **time as a resource**.

---

## 4. Vocabulary Penting

### 4.1 Timeout

Timeout adalah batas waktu lokal untuk satu phase atau operasi.

Contoh:

```text
connect timeout = 500 ms
request timeout = 2 s
pool acquisition timeout = 100 ms
read timeout = 1 s
```

Timeout biasanya di-enforce oleh client/library tertentu.

### 4.2 Deadline

Deadline adalah waktu absolut kapan operasi harus selesai.

Contoh:

```text
request masuk pada 10:00:00.000
caller deadline: 10:00:02.000
sisa budget sekarang: 1.3 s
```

Deadline lebih kuat daripada timeout karena dapat dipropagasikan lintas service.

### 4.3 Time Budget

Time budget adalah durasi yang tersedia untuk menyelesaikan pekerjaan.

```text
deadline - now = remaining budget
```

### 4.4 Per-Attempt Timeout

Batas waktu untuk satu percobaan.

```text
attempt #1 timeout 300 ms
attempt #2 timeout 300 ms
```

### 4.5 Total Timeout

Batas waktu total untuk semua attempt, termasuk wait/backoff.

```text
overall deadline 1 s
attempt + backoff + attempt tidak boleh melewati 1 s
```

### 4.6 Idle Timeout

Batas waktu koneksi boleh idle sebelum ditutup.

Contoh:

```text
load balancer idle timeout = 60 s
client idle connection lifetime = 30 s
```

### 4.7 Keepalive

Mekanisme untuk mendeteksi koneksi mati atau menjaga koneksi tetap aktif.

Jangan campur adukkan:

```text
TCP keepalive
HTTP keep-alive
HTTP/2 ping
gRPC keepalive
load balancer health check
application heartbeat
```

Mereka berbeda.

---

## 5. Taxonomy Timeout di Network Call

### 5.1 Queue Timeout / Admission Timeout

Sebelum network call benar-benar dimulai, request mungkin menunggu di queue lokal.

Contoh:

```text
thread pool queue
bounded executor
bulkhead semaphore
rate limiter wait
connection pool pending queue
reactive scheduler queue
```

Jika queue tidak dibatasi, timeout network tidak akan menyelamatkan sistem.

```text
request waits 10 s in local queue
then network call timeout 1 s
total user latency = 11 s
```

Top-tier design:

```text
Queue wait harus ikut deadline.
```

### 5.2 Pool Acquisition Timeout

Connection pool adalah resource terbatas.

Ketika semua connection sedang dipakai, request baru menunggu connection available.

```text
client wants connection
pool has max 100
all 100 busy
request waits in pool queue
```

Jika pool acquisition timeout tidak diset:

```text
caller threads pile up
latency naik
heap naik
queue naik
retry storm muncul
```

Pool acquisition timeout sering lebih kecil dari request timeout.

Contoh:

```text
overall request deadline: 2 s
pool acquisition timeout: 50–200 ms
connect timeout: 200–500 ms
server response timeout: 1–1.5 s
```

### 5.3 DNS Timeout

DNS resolution bisa lambat atau gagal.

Pada Java, DNS sering tersembunyi di balik `InetAddress`, HTTP client, atau gRPC resolver.

Gejala:

```text
UnknownHostException
No address associated with hostname
Name or service not known
sporadic connection failure after endpoint change
slow first request
```

Masalahnya: tidak semua Java HTTP client mengekspos DNS timeout secara eksplisit.

Akibatnya DNS bisa ikut masuk ke timeout phase lain atau bergantung ke OS resolver behavior.

Prinsip:

```text
DNS is a runtime dependency.
```

### 5.4 TCP Connect Timeout

Connect timeout membatasi waktu membuat koneksi TCP baru.

Phase:

```text
client SYN
server SYN-ACK
client ACK
```

Jika remote tidak reachable atau packet drop, connect bisa menggantung sampai OS-level timeout jika tidak dibatasi.

JDK `HttpClient.Builder.connectTimeout(Duration)` mengatur batas saat koneksi baru perlu dibuat. Jika koneksi existing direuse, connect timeout tidak berlaku.

Implikasi besar:

```text
connectTimeout tidak melindungi request yang memakai pooled connection.
```

### 5.5 TLS Handshake Timeout

TLS handshake terjadi setelah TCP connect.

Tergantung library, handshake bisa termasuk dalam connect timeout atau request timeout, atau memiliki timeout sendiri.

Apache HttpClient 5 documentation mencatat connect timeout dapat mencakup TLS protocol negotiation.

Tetapi secara mental model, pisahkan:

```text
TCP connect success
TLS handshake start
certificate exchange
hostname verification
ALPN negotiation
TLS ready
```

Failure:

```text
handshake timeout
certificate expired
unknown CA
hostname mismatch
ALPN failure
protocol/cipher mismatch
```

Kalau metric hanya “connect timeout”, kamu bisa salah diagnosis.

### 5.6 Write Timeout

Write timeout membatasi waktu mengirim request body.

Penting untuk:

```text
large upload
slow network
server not reading
proxy buffering
TCP send buffer full
backpressure
```

Banyak high-level client tidak mengekspos write timeout secara jelas.

Kalau request body kecil, write phase biasanya tidak terlihat.

Kalau upload besar, write timeout sangat penting.

### 5.7 First Byte Timeout / Response Header Timeout

Ini batas waktu dari selesai menulis request sampai response header/first byte diterima.

Gejala:

```text
server accepted connection but slow to respond
server queue penuh
upstream dependency lambat
application deadlock
DB query lambat
```

Ini sering disebut:

```text
response timeout
socket read timeout
time to first byte timeout
```

Tapi namanya tergantung library.

### 5.8 Read Timeout / Body Timeout

Setelah response header diterima, body bisa lama dibaca.

Penting untuk:

```text
large download
streaming endpoint
SSE
chunked response
slow server
slow proxy
slow consumer
```

Salah desain:

```text
read timeout terlalu pendek untuk streaming valid
read timeout terlalu panjang untuk normal API kecil
```

Untuk streaming, yang lebih tepat sering:

```text
idle read timeout
heartbeat timeout
overall deadline
max bytes
max duration
```

### 5.9 Request Timeout

Request timeout biasanya batas untuk seluruh request attempt.

Pada JDK `HttpRequest.Builder.timeout(Duration)`, timeout berlaku untuk request; jika timeout terjadi, operasi sync melempar `HttpTimeoutException`, sedangkan async selesai exceptional.

Namun request timeout tidak otomatis sama dengan deadline workflow.

Contoh:

```text
request timeout 2 s
retry 3 kali
backoff 500 ms
total bisa > 6 s
```

Karena itu total budget harus dikelola di wrapper.

### 5.10 Deadline

Deadline adalah batas global.

Contoh:

```text
incoming API SLO: 2 s
validation: 100 ms
service A: 300 ms
service B: 500 ms
DB: 400 ms
serialization + margin: 200 ms
```

Setiap downstream call harus memakai sisa budget.

```text
remaining = deadline - now
perAttempt = min(policyAttemptTimeout, remaining - safetyMargin)
```

gRPC memiliki deadline concept first-class. HTTP tidak punya standar tunggal yang universal untuk deadline propagation, sehingga biasanya memakai custom header.

---

## 6. Why Timeout Incidents Happen

### 6.1 Timeout Tidak Diset

Default timeout sering terlalu besar atau infinite.

Akibat:

```text
thread/blocking task menggantung
pool penuh
connection leak terlihat seperti latency
deployment rollback lambat
circuit breaker tidak cepat bereaksi
```

### 6.2 Timeout Diset Sama untuk Semua Dependency

Contoh:

```text
semua HTTP call timeout 30 s
```

Masalah:

```text
fast dependency diberi terlalu banyak waktu
slow dependency diberi terlalu sedikit/tidak sesuai
critical path tidak dikontrol
failure tidak terklasifikasi
```

### 6.3 Connect Timeout Disangka Request Timeout

Connect timeout hanya berlaku saat membuat koneksi baru.

Kalau pooled connection dipakai, request bisa tetap menggantung di read phase.

### 6.4 Request Timeout Disangka Deadline

Request timeout per attempt tidak cukup untuk workflow multi-hop.

### 6.5 Timeout Lebih Panjang daripada Caller Timeout

Contoh buruk:

```text
API gateway timeout: 30 s
service internal HTTP client timeout: 60 s
DB query timeout: 120 s
```

Akibat:

```text
client sudah disconnect
gateway sudah memberi 504
server masih bekerja
thread/resource tetap habis
```

Rule:

```text
Downstream timeout harus lebih kecil dari upstream remaining deadline.
```

### 6.6 Retry Mengabaikan Deadline

Contoh:

```text
deadline user: 2 s
attempt timeout: 1 s
retry: 3
backoff: 500 ms
```

Worst case:

```text
1s + 0.5s + 1s + 1s = 3.5s+
```

Ini melanggar SLO dan memperburuk overload.

### 6.7 Timeout Tidak Membatalkan Work

Jika caller timeout tetapi server tetap memproses:

```text
wasted CPU
DB query tetap jalan
lock tetap ditahan
side effect tetap terjadi
retry menghasilkan duplicate
```

gRPC deadline/cancellation membantu, tetapi handler harus menghormati cancellation.

HTTP butuh desain eksplisit:

```text
client disconnect detection
request context cancellation
idempotency key
short server-side timeout
DB statement timeout
```

### 6.8 Timeout Tidak Terobservasi Per Phase

Log:

```text
java.net.SocketTimeoutException: Read timed out
```

Tidak cukup.

Kamu butuh:

```text
dependency
operation
method/path
attempt
phase
elapsed_ms
timeout_ms
remaining_deadline_ms
pool_wait_ms
connect_ms
tls_ms
ttfb_ms
body_ms
status/outcome
```

---

## 7. Timeout Hierarchy

Think in layers.

```text
User / external caller deadline
  -> API gateway timeout
    -> service request deadline
      -> local queue timeout
        -> downstream client total timeout
          -> per attempt timeout
            -> pool acquisition timeout
            -> connect timeout
            -> TLS timeout
            -> write timeout
            -> response timeout
            -> body timeout
              -> DB/query/cache/message timeout
```

A good hierarchy has these properties:

1. outer deadline is largest;
2. inner timeouts are smaller and derived from remaining budget;
3. queue wait is bounded;
4. retry total fits within deadline;
5. dependency-specific policy exists;
6. cancellation propagates downward;
7. metrics expose where time was spent.

Bad hierarchy:

```text
gateway: 30s
service HTTP client: 60s
DB: 120s
retry: 3x
queue: unbounded
```

Good hierarchy:

```text
gateway: 3s
service total deadline: 2.5s
local queue max wait: 100ms
dependency A total: 700ms
dependency A attempt: 250ms
connect: 100ms
pool acquisition: 50ms
server response: 200ms
retry: at most 1 retry if remaining budget > 300ms
DB statement timeout: 400ms
```

---

## 8. Budgeting Strategy

### 8.1 Start from SLO

Misal API target:

```text
p95 latency <= 1.5 s
hard timeout <= 3 s
```

Jangan mulai dari library default.

Mulai dari user-visible contract.

### 8.2 Map Critical Path

Contoh:

```text
incoming request
  -> auth check
  -> load case profile
  -> call screening engine
  -> call document service
  -> update DB
  -> publish event
```

Tentukan mana sequential, mana parallel.

Sequential budget:

```text
total = sum(each step)
```

Parallel budget:

```text
total = max(branches) + join overhead
```

### 8.3 Assign Budget by Criticality

Dependency tidak sama.

```text
identity provider        critical
audit logging sync       should be avoided if possible
address lookup           maybe degraded/fallback
recommendation service   optional
payment submission       critical with careful idempotency
```

### 8.4 Reserve Margin

Selalu sisakan margin untuk:

```text
serialization
deserialization
thread scheduling
GC pause
network jitter
logging
response write
```

Contoh:

```text
overall 2s
business work 1.6s
margin 400ms
```

### 8.5 Use Percentiles, Not Average

Mean latency menipu.

Jika dependency:

```text
p50 = 30ms
p95 = 120ms
p99 = 700ms
```

Timeout 100ms akan memotong lebih dari 5% request.

Timeout 5s mungkin menyembunyikan p99 regression.

Timeout perlu didasarkan pada:

```text
p95/p99
SLO
retry policy
capacity
failure mode
```

### 8.6 Differentiate Normal Endpoint vs Bulk Endpoint

Jangan satu timeout untuk semua API.

```text
GET /case/{id}: 500ms–1s
POST /case/search: 1s–3s
POST /document/upload: streaming/body-specific
GET /report/export: async job, not long sync timeout
```

---

## 9. Timeout and Retry Coupling

Timeout dan retry tidak boleh dipisah.

Retry adalah multiplier.

Jika satu request timeout 1 detik dan retry 3 kali:

```text
worst-case latency >= 3s + backoff
worst-case load <= original + retries
```

Jika 1000 RPS dan setiap request retry 2 kali saat dependency lambat:

```text
dependency receives up to 3000 attempts/sec
```

Saat dependency sedang bermasalah, retry bisa menjadi self-inflicted DDoS.

### 9.1 Retry Budget

Gunakan retry budget:

```text
Only retry if:
- operation retryable
- error transient
- method/idempotency safe
- remaining deadline sufficient
- retry budget available
- circuit not open
- backoff can fit
```

### 9.2 Per-Attempt Timeout Must Be Smaller

Contoh:

```text
overall deadline: 1s
attempt timeout: 300ms
backoff: 50–100ms
max attempts: 2
```

Bukan:

```text
overall deadline: 1s
attempt timeout: 1s
max attempts: 3
```

### 9.3 Jitter

Backoff tanpa jitter membuat banyak client retry bersamaan.

Gunakan jitter agar retry tersebar.

Pattern umum:

```text
base = 50ms
cap = 500ms
sleep = random(0, min(cap, base * 2^attempt))
```

AWS Builders Library menekankan bahwa timeout, retry, backoff, dan jitter harus dipikirkan bersama untuk menghindari overload amplification.

---

## 10. Timeout in Java 8–25

### 10.1 Java 8 Era

Java 8 umum memakai:

```text
HttpURLConnection
Apache HttpClient
OkHttp
Netty
JAX-RS client
Spring RestTemplate
```

Masalah umum:

```text
default timeout tidak jelas
read timeout disangka request timeout
pool acquisition timeout lupa
connection pool tidak dimonitor
thread pool unbounded
```

### 10.2 Java 11+ JDK HttpClient

JDK `HttpClient` menyediakan:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofMillis(300))
    .build();

HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(Duration.ofSeconds(2))
    .GET()
    .build();
```

`connectTimeout` adalah client-level untuk koneksi baru.

`request.timeout()` adalah request-level.

Tapi JDK `HttpClient` tidak memberi semua knob seperti pool acquisition timeout, per-route max connection, atau detailed read/write timeout seperti beberapa client lain.

Jadi untuk production, kamu tetap butuh wrapper policy dan observability.

### 10.3 Java 21–25 Virtual Threads

Virtual threads membuat blocking I/O lebih scalable dari sisi thread.

Namun virtual threads tidak membuat ini unlimited:

```text
connection pool
remote server capacity
database connection
bandwidth
file descriptor
ephemeral port
rate limit
heap
CPU
```

Bad virtual-thread design:

```java
for (Request r : manyRequests) {
    Thread.startVirtualThread(() -> client.send(...));
}
```

Kalau tidak ada concurrency limit:

```text
bisa menciptakan ribuan simultaneous downstream attempts
```

Top-tier design:

```text
virtual threads + bounded concurrency + deadline + retry budget
```

### 10.4 Structured Concurrency

Structured concurrency cocok untuk parallel downstream call dalam satu request.

Mental model:

```text
all child calls belong to one parent operation
if parent times out, children should be cancelled
if one required child fails, siblings can be cancelled
deadline is shared
```

Ini cocok untuk:

```text
load profile
load entitlements
load case summary
join results
```

Tapi tetap perlu:

```text
per dependency timeout
remaining budget
bounded concurrency
cancellation-aware clients
```

---

## 11. JDK HttpClient Timeout Pattern

### 11.1 Basic Example

```java
import java.net.URI;
import java.net.http.*;
import java.time.Duration;

public final class BasicTimeoutExample {
    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(300))
                .version(HttpClient.Version.HTTP_2)
                .build();

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://example.com/api/cases/123"))
                .timeout(Duration.ofSeconds(2))
                .GET()
                .build();

        HttpResponse<String> response = client.send(
                request,
                HttpResponse.BodyHandlers.ofString()
        );

        System.out.println(response.statusCode());
    }
}
```

Important:

```text
connectTimeout = only new connection establishment
request timeout = request attempt
not necessarily full workflow deadline
```

### 11.2 Wrapper with Deadline

```java
import java.net.URI;
import java.net.http.*;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

public final class DeadlineHttpClient {
    private final HttpClient client;
    private final Clock clock;
    private final Duration defaultConnectTimeout;
    private final Duration maxAttemptTimeout;
    private final Duration safetyMargin;

    public DeadlineHttpClient(
            HttpClient client,
            Clock clock,
            Duration defaultConnectTimeout,
            Duration maxAttemptTimeout,
            Duration safetyMargin
    ) {
        this.client = Objects.requireNonNull(client);
        this.clock = Objects.requireNonNull(clock);
        this.defaultConnectTimeout = Objects.requireNonNull(defaultConnectTimeout);
        this.maxAttemptTimeout = Objects.requireNonNull(maxAttemptTimeout);
        this.safetyMargin = Objects.requireNonNull(safetyMargin);
    }

    public HttpResponse<String> get(URI uri, Instant deadline) throws Exception {
        Duration remaining = Duration.between(clock.instant(), deadline);

        if (remaining.compareTo(safetyMargin) <= 0) {
            throw new DeadlineExceededException("No remaining time budget before call");
        }

        Duration attemptTimeout = min(maxAttemptTimeout, remaining.minus(safetyMargin));

        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(attemptTimeout)
                .header("X-Request-Deadline-Epoch-Millis", String.valueOf(deadline.toEpochMilli()))
                .GET()
                .build();

        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private static Duration min(Duration a, Duration b) {
        return a.compareTo(b) <= 0 ? a : b;
    }

    public static final class DeadlineExceededException extends RuntimeException {
        public DeadlineExceededException(String message) {
            super(message);
        }
    }
}
```

Catatan:

```text
Header deadline custom harus distandardisasi internal.
Jangan kirim header internal ke external untrusted service tanpa kebijakan.
```

### 11.3 Async with Timeout Awareness

```java
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;

public final class AsyncTimeoutExample {
    private final HttpClient client;

    public AsyncTimeoutExample(HttpClient client) {
        this.client = client;
    }

    public CompletableFuture<HttpResponse<String>> get(URI uri, Duration timeout) {
        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(timeout)
                .GET()
                .build();

        return client.sendAsync(request, HttpResponse.BodyHandlers.ofString());
    }
}
```

Do not assume `CompletableFuture.orTimeout()` is identical to HTTP request timeout.

```java
client.sendAsync(request, handler)
      .orTimeout(500, java.util.concurrent.TimeUnit.MILLISECONDS);
```

This may timeout the future at the CompletableFuture layer. You must understand whether underlying HTTP work is cancelled and whether body/subscribers/resources are released. Prefer using the client's native request timeout and explicit cancellation strategy.

---

## 12. Apache HttpClient 5 Timeout Concepts

Apache HttpClient exposes more granular knobs depending on sync/async/classic config.

Common concepts:

```text
connection request timeout / pool acquisition timeout
connect timeout
response timeout
socket timeout
TLS handshake may be covered by connect depending configuration
```

Example style:

```java
RequestConfig requestConfig = RequestConfig.custom()
        .setConnectionRequestTimeout(Timeout.ofMilliseconds(100))
        .setConnectTimeout(Timeout.ofMilliseconds(300))
        .setResponseTimeout(Timeout.ofSeconds(2))
        .build();
```

Key mental model:

```text
connectionRequestTimeout != connectTimeout
```

The first is waiting for a connection from the pool.

The second is establishing a new connection.

The third is waiting for response.

This distinction is critical in production.

---

## 13. OkHttp Timeout Concepts

OkHttp commonly exposes:

```text
connectTimeout
readTimeout
writeTimeout
callTimeout
```

Mental model:

```text
connectTimeout = TCP connect
writeTimeout = request body write inactivity
readTimeout = response body read inactivity
callTimeout = entire call from start to finish
```

This split is useful for upload/download-heavy systems.

Important:

```text
read timeout is not always total body deadline;
it may be idle/inactivity timeout.
```

For streaming, this can be desirable.

For fixed-size API response, total request timeout may be more important.

---

## 14. Netty Timeout Concepts

Netty makes timeout explicit via pipeline handlers:

```text
ReadTimeoutHandler
WriteTimeoutHandler
IdleStateHandler
custom deadline handler
```

Example concept:

```java
pipeline.addLast(new ReadTimeoutHandler(2));
pipeline.addLast(new WriteTimeoutHandler(2));
pipeline.addLast(new IdleStateHandler(0, 0, 30));
```

Netty forces you to think at transport event level:

```text
no read event for N seconds
write did not complete within N seconds
channel idle for N seconds
```

This is powerful but dangerous if you misunderstand streaming semantics.

---

## 15. gRPC Deadlines

gRPC has first-class deadline support.

Client-side concept:

```java
stub.withDeadlineAfter(500, TimeUnit.MILLISECONDS)
    .getCase(request);
```

Deadline is propagated across gRPC calls by default in many implementations, with conversion to timeout relative to avoid clock skew issues.

Server behavior:

```text
if deadline expires, call is cancelled
server handler should stop work if cancellation is observed
client receives DEADLINE_EXCEEDED if operation did not complete in time
```

Important distinction:

```text
DEADLINE_EXCEEDED = operation did not complete before deadline
CANCELLED = operation cancelled, often by caller or server context
UNAVAILABLE = transport unavailable/transient
```

### 15.1 gRPC Server Handler Must Respect Cancellation

Bad handler:

```java
public void getCase(Request req, StreamObserver<Response> out) {
    Response response = expensiveWork(req); // ignores cancellation
    out.onNext(response);
    out.onCompleted();
}
```

Better concept:

```java
Context context = Context.current();

while (workRemaining) {
    if (context.isCancelled()) {
        cleanup();
        return;
    }
    doSmallUnitOfWork();
}
```

### 15.2 Deadline to Downstream

If gRPC service calls HTTP downstream:

```text
gRPC deadline remaining -> HTTP request timeout
```

If HTTP service calls gRPC downstream:

```text
HTTP X-Request-Deadline -> gRPC withDeadlineAfter(remaining)
```

---

## 16. Designing Deadline Propagation for HTTP

HTTP does not have one universal built-in deadline header like gRPC.

Common internal patterns:

```text
X-Request-Deadline-Epoch-Millis: 1760000000000
X-Request-Timeout-Millis: 750
X-Request-Start-Millis: ...
```

Prefer deadline over timeout if services have synchronized enough clocks.

But if clock skew is a concern:

```text
propagate remaining timeout duration
or combine deadline + received_at
```

Caution:

```text
Never blindly trust external user-supplied deadline headers.
```

Ingress should sanitize:

```text
if no header: create deadline from route policy
if too large: cap it
if already expired: fail fast
if from untrusted source: replace it
```

Internal services can then propagate sanitized deadline.

---

## 17. Timeout Policy Object

Production code should avoid scattering raw duration literals.

Bad:

```java
request.timeout(Duration.ofSeconds(30));
```

Better:

```java
public record DependencyTimeoutPolicy(
        Duration poolAcquireTimeout,
        Duration connectTimeout,
        Duration tlsTimeout,
        Duration attemptTimeout,
        Duration totalTimeout,
        Duration backoffBase,
        Duration backoffCap,
        int maxAttempts
) {
    public DependencyTimeoutPolicy {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be >= 1");
        }
        if (attemptTimeout.compareTo(totalTimeout) > 0) {
            throw new IllegalArgumentException("attemptTimeout cannot exceed totalTimeout");
        }
    }
}
```

Example registry:

```java
public enum Dependency {
    IDENTITY,
    SCREENING_ENGINE,
    DOCUMENT_SERVICE,
    ADDRESS_LOOKUP,
    AUDIT_SERVICE
}
```

```java
public interface TimeoutPolicyRegistry {
    DependencyTimeoutPolicy policyFor(Dependency dependency, String operation);
}
```

Benefits:

```text
central review
configurable per dependency
testable
observable
documented
safe migration
```

---

## 18. Recommended Starting Policies

Do not blindly copy these. Use them as starting points.

### 18.1 Fast Internal Metadata Lookup

```text
total deadline: 300–500ms
pool acquire: 20–50ms
connect: 50–100ms
attempt: 150–250ms
retry: maybe 1, only if idempotent
```

### 18.2 Normal Internal REST Call

```text
total deadline: 500ms–2s
pool acquire: 50–100ms
connect: 100–300ms
attempt: 300ms–1s
retry: 0–1
```

### 18.3 External Internet API

```text
total deadline: 2s–10s depending business
pool acquire: 100–300ms
connect: 500ms–2s
attempt: 1s–5s
retry: careful, low count, jittered
```

### 18.4 Large Download

```text
connect: short
first byte: bounded
body read: size-aware
idle read timeout: heartbeat/inactivity based
overall max duration: explicit
max bytes: explicit
checksum: explicit
```

### 18.5 Upload

```text
connect: short
write timeout: throughput/idle based
server response timeout: bounded
overall max duration: explicit
idempotency key: required if retried
```

### 18.6 Streaming

```text
connect: short
initial response timeout: bounded
idle timeout: heartbeat based
overall duration: business-specific
backpressure: mandatory
retry/resume protocol: explicit
```

---

## 19. Common Java Exception Mapping

Do not map all timeout exceptions to `500`.

Possible mapping:

```text
Pool acquisition timeout
  -> local overload / dependency saturation
  -> HTTP 503 or internal error code DEPENDENCY_POOL_TIMEOUT

Connect timeout
  -> dependency unreachable/network
  -> 503/504 depending boundary

TLS handshake timeout
  -> dependency security/connection issue
  -> 502/503

Request timeout / read timeout
  -> dependency slow
  -> 504 if acting as gateway
  -> 503 if internal dependency unavailable

Deadline exceeded
  -> caller budget exhausted
  -> 504 at gateway boundary
  -> internal DEADLINE_EXCEEDED code

Client cancellation
  -> do not continue expensive work
  -> often logged as cancelled, not error
```

gRPC mapping:

```text
DEADLINE_EXCEEDED -> deadline expired
UNAVAILABLE -> transient transport/service unavailable
RESOURCE_EXHAUSTED -> quota/rate/resource exhausted
CANCELLED -> caller/server cancelled
```

---

## 20. Timeout Observability

Minimum metrics per dependency operation:

```text
request_count{dependency,operation,outcome}
latency_histogram{dependency,operation}
timeout_count{dependency,operation,phase}
retry_count{dependency,operation,reason}
attempt_count{dependency,operation}
pool_pending{dependency}
pool_acquire_latency{dependency}
active_connections{dependency}
idle_connections{dependency}
connect_latency{dependency}
tls_handshake_latency{dependency}
response_first_byte_latency{dependency}
body_read_latency{dependency}
deadline_remaining_ms{dependency}
```

Log fields:

```json
{
  "event": "downstream_call_timeout",
  "dependency": "screening-engine",
  "operation": "evaluateApplication",
  "method": "POST",
  "uriTemplate": "/screening/evaluate",
  "attempt": 1,
  "maxAttempts": 2,
  "phase": "response",
  "elapsedMs": 752,
  "timeoutMs": 750,
  "remainingDeadlineMs": 1040,
  "retryable": true,
  "correlationId": "..."
}
```

Trace spans should include:

```text
net.peer.name
server.address
http.request.method
url.template / route
http.response.status_code
rpc.system = grpc
rpc.service
rpc.method
timeout.ms
deadline.remaining.ms
retry.attempt
pool.wait.ms
error.type
```

Avoid high-cardinality labels:

```text
raw URL with IDs
exception message with dynamic host
user ID
case ID
full query string
```

---

## 21. Timeout Testing

### 21.1 Test Connect Timeout

Use non-routable or controlled blackhole endpoint where possible.

But be careful: behavior varies by OS/network.

Better: use test server/proxy that accepts but delays specific phase.

### 21.2 Test Response Timeout

Fake server:

```text
accept connection
read request
sleep beyond timeout
return response
```

Expected:

```text
client fails within configured timeout
metric phase=response_timeout
no retry if non-idempotent
```

### 21.3 Test Body Timeout

Fake server:

```text
send headers
send first chunk
sleep
send next chunk
```

This distinguishes first-byte vs body idle timeout.

### 21.4 Test Pool Acquisition Timeout

Configure small pool:

```text
max connections = 1
request A holds connection
request B waits
expect pool timeout
```

### 21.5 Test Deadline Propagation

Scenario:

```text
incoming deadline = now + 500ms
local work = 300ms
downstream should receive <= 200ms
```

Assert:

```text
downstream timeout is derived from remaining budget
not static 1s
```

### 21.6 Test Retry Budget

Scenario:

```text
overall deadline = 1s
attempt timeout = 400ms
backoff = 200ms
max attempts = 3
```

Assert:

```text
third attempt is skipped if not enough budget
```

---

## 22. Production Failure Patterns

### 22.1 “Everything Became Slow”

Symptoms:

```text
p99 latency high
thread count high
connection pool pending high
dependency CPU normal
many timeout logs
```

Possible cause:

```text
pool acquisition timeout missing
connection pool saturated
callers waiting locally
```

Fix:

```text
bound pool wait
increase pool only if dependency can handle it
add bulkhead
add metrics
review retry
```

### 22.2 “We Set Connect Timeout but Still Hang”

Cause:

```text
connect timeout only applies to new connection
pooled connection read phase can still wait
```

Fix:

```text
set request/response/read timeout
validate stale connection handling
align idle timeout with LB
```

### 22.3 “Gateway Returns 504 but Service Keeps Working”

Cause:

```text
downstream timeout > gateway timeout
no cancellation propagation
DB query timeout too long
```

Fix:

```text
ingress deadline
propagate deadline
server cancellation
DB statement timeout
```

### 22.4 “Retry Made Outage Worse”

Cause:

```text
all callers retry slow dependency
no jitter
no retry budget
timeout too long
circuit breaker too slow
```

Fix:

```text
short per-attempt timeout
bounded retries
jitter
token bucket retry budget
circuit breaker
load shedding
```

### 22.5 “Only First Request Is Slow”

Possible causes:

```text
DNS resolution
TCP connect
TLS handshake
JIT/warmup
connection pool cold
certificate validation
```

Fix:

```text
measure phase latency
warm critical clients carefully
avoid fake warmup that hides readiness issue
```

### 22.6 “HTTP/2 gRPC Calls Timeout Randomly”

Possible causes:

```text
MAX_CONCURRENT_STREAMS reached
connection-level flow control blocked
event loop blocked
large streaming response starving small unary
keepalive misconfigured
LB/proxy HTTP/2 behavior
```

Fix:

```text
monitor active streams
separate channels for workloads
deadline per RPC
flow control tuning
event loop protection
```

---

## 23. Timeout Design for Case Management / Regulatory Systems

For regulatory/case management systems, timeout design must consider:

```text
auditability
idempotency
user-visible workflow
legal defensibility
partial completion
external agency dependency
document upload/download
long-running workflow
manual retry/reconciliation
```

Bad pattern:

```text
User submits enforcement action
service calls 5 dependencies synchronously
one dependency times out
system returns generic error
some side effects already happened
no idempotency key
no clear audit trail
```

Better pattern:

```text
submission accepted with command id
critical validation synchronous with short deadline
non-critical enrichment async
idempotency key prevents duplicate submission
outbox records intended side effects
timeout reason recorded
operator can reconcile
external dependency calls have clear retry policy
```

Timeout is not only technical. It affects:

```text
legal record
operator trust
replay safety
case state correctness
appeal/audit trail
```

---

## 24. Practical Design Recipe

When adding a new downstream call:

### Step 1 — Classify the operation

```text
read or write?
idempotent?
critical or optional?
internal or external?
small response or large/streaming?
user-facing or background?
```

### Step 2 — Define SLO and deadline

```text
caller SLO:
hard max:
remaining budget:
```

### Step 3 — Define phase timeouts

```text
pool acquisition:
connect:
TLS:
write:
first byte:
body:
attempt:
total:
```

### Step 4 — Define retry policy

```text
retryable status/errors:
max attempts:
backoff:
jitter:
retry budget:
idempotency key:
```

### Step 5 — Define cancellation behavior

```text
what happens if caller disconnects?
what happens if deadline expires?
are DB queries cancelled?
are downstream calls cancelled?
```

### Step 6 — Define fallback/degradation

```text
fail closed?
fail open?
cached response?
async continuation?
manual review?
```

### Step 7 — Define observability

```text
metrics:
logs:
trace fields:
dashboard:
alerts:
```

### Step 8 — Define tests

```text
connect timeout
response timeout
pool timeout
deadline propagation
retry budget
cancellation
```

---

## 25. Design Checklist

Before production:

```text
[ ] Every outbound dependency has named timeout policy.
[ ] Connect timeout is set.
[ ] Request/response timeout is set.
[ ] Pool acquisition timeout is set where library supports it.
[ ] Large payload has body/idle/size policy.
[ ] Retry total fits within deadline.
[ ] Retry uses jitter.
[ ] Retry only applies to safe/idempotent operations.
[ ] Deadline is propagated internally.
[ ] External deadline headers are sanitized.
[ ] Server-side cancellation is honored.
[ ] DB/query timeout is aligned with request deadline.
[ ] Gateway timeout is larger than internal service timeout but smaller than user tolerance.
[ ] Load balancer idle timeout is aligned with client connection idle timeout.
[ ] Timeout metrics include dependency, operation, phase, and attempt.
[ ] Timeout logs avoid raw high-cardinality URL.
[ ] Timeout tests exist.
[ ] Runbook explains each timeout exception.
```

---

## 26. Anti-Patterns

### 26.1 One Global Timeout

```text
all clients timeout = 30s
```

Why bad:

```text
ignores dependency profile
ignores SLO
hides phase failure
causes slow resource retention
```

### 26.2 Infinite Timeout for “Important” Operation

Important operation needs more careful timeout, not infinite timeout.

### 26.3 Retry on Timeout for Non-Idempotent Write

Danger:

```text
duplicate transaction
duplicate email
duplicate payment
duplicate case action
```

Use:

```text
idempotency key
operation id
deduplication
safe retry contract
```

### 26.4 Timeout Hidden in Annotation

Example:

```java
@Retry
@TimeLimiter
@CircuitBreaker
```

Annotations can be useful, but dangerous if no one knows ordering:

```text
Does retry wrap timeout?
Does timeout wrap retry?
Does circuit breaker count timeout?
Does cancellation happen?
```

For critical systems, make the composition explicit.

### 26.5 Timeout Longer Than Upstream

Already discussed, but very common.

### 26.6 Timeout Without Metrics

If timeout policy cannot be observed, it cannot be tuned.

---

## 27. Example: Explicit Retry + Deadline Pseudocode

```java
public <T> T executeWithDeadline(
        Dependency dependency,
        String operation,
        Instant deadline,
        Callable<T> attempt
) throws Exception {
    DependencyTimeoutPolicy policy = registry.policyFor(dependency, operation);

    int attemptNo = 0;
    Throwable last = null;

    while (attemptNo < policy.maxAttempts()) {
        attemptNo++;

        Duration remaining = Duration.between(clock.instant(), deadline);
        if (remaining.compareTo(policy.minimumRemainingForAttempt()) < 0) {
            throw new DeadlineExceededException("Not enough time for another attempt", last);
        }

        Duration attemptTimeout = min(policy.attemptTimeout(), remaining.minus(policy.safetyMargin()));

        try {
            return timeoutRunner.call(attempt, attemptTimeout);
        } catch (Throwable t) {
            last = t;

            if (!retryClassifier.isRetryable(t)) {
                throw t;
            }

            if (attemptNo >= policy.maxAttempts()) {
                throw t;
            }

            Duration backoff = jitteredBackoff(policy, attemptNo);
            Duration afterBackoffRemaining = Duration.between(clock.instant().plus(backoff), deadline);

            if (afterBackoffRemaining.compareTo(policy.minimumRemainingForAttempt()) < 0) {
                throw t;
            }

            sleeper.sleep(backoff);
        }
    }

    throw new IllegalStateException("unreachable");
}
```

The exact implementation depends on your stack.

The invariant matters more:

```text
No attempt starts if it cannot finish within remaining budget.
```

---

## 28. Example Timeout Policy Documentation

Every dependency should have something like this:

```markdown
# Dependency Timeout Policy: Screening Engine

## Operation
POST /screening/evaluate

## Nature
- Synchronous user-facing validation
- Idempotent only with screeningRequestId
- Critical for submission decision

## SLO
- Caller API hard deadline: 2s
- Target dependency budget: 700ms

## Policy
- Pool acquisition timeout: 50ms
- Connect timeout: 150ms
- Attempt timeout: 500ms
- Total timeout: 700ms
- Max attempts: 2
- Backoff: full jitter 50–150ms
- Retryable:
  - connection reset before response
  - connect timeout
  - HTTP 503 with Retry-After within remaining budget
- Not retryable:
  - HTTP 400/409/422
  - response timeout after server may have processed non-idempotent request unless idempotency key is present

## Cancellation
- Propagate X-Request-Deadline-Epoch-Millis
- Abort downstream if caller deadline expires

## Observability
- Metrics:
  - screening_engine_latency
  - screening_engine_timeout_total{phase}
  - screening_engine_retry_total{reason}
  - screening_engine_pool_wait
- Logs:
  - requestId
  - screeningRequestId
  - phase
  - elapsedMs
  - timeoutMs
```

This documentation makes timeout a design artifact, not accidental config.

---

## 29. Exercises

### Exercise 1 — Decompose a Timeout

You see this log:

```text
java.net.http.HttpTimeoutException: request timed out
elapsed=2000ms
dependency=document-service
```

List at least 8 possible causes hidden behind this one exception.

Expected categories:

```text
pool wait
DNS
connect
TLS
write
server queue
server processing
first byte
body read
client executor starvation
```

### Exercise 2 — Design a Policy

For an internal read API:

```text
GET /profile/{id}
caller deadline: 1s
dependency p95: 80ms
dependency p99: 250ms
operation idempotent
traffic: 500 RPS
```

Design:

```text
connect timeout
pool acquisition timeout
attempt timeout
total timeout
retry count
backoff
metrics
```

### Exercise 3 — Detect Bad Hierarchy

Given:

```text
API gateway timeout: 10s
service A downstream timeout: 15s
DB query timeout: 30s
retry: 3
```

Explain failure mode and propose corrected hierarchy.

### Exercise 4 — gRPC to HTTP Bridge

A gRPC request arrives with 600ms remaining deadline. Service must call an HTTP downstream.

Design how to map:

```text
gRPC deadline -> HTTP timeout
HTTP timeout exception -> gRPC status
cancellation -> HTTP request cancellation
metrics
```

### Exercise 5 — Streaming Timeout

A document download can take 2 minutes but must send a chunk every 5 seconds.

Design:

```text
connect timeout
first byte timeout
idle body timeout
overall max duration
max bytes
checksum
client cancellation behavior
```

---

## 30. Key Takeaways

Timeout engineering is resource engineering.

The strongest mental model:

```text
Every wait must be bounded.
Every bound must fit a parent deadline.
Every retry must consume budget.
Every cancellation must stop useful work.
Every timeout must identify its phase.
```

Do not design timeout as magic constants.

Design timeout as:

```text
contract
capacity protection
failure classifier
observability signal
SLO enforcement mechanism
```

For Java 8–25, the APIs differ, but the invariants are stable:

```text
connect timeout is not request timeout
request timeout is not workflow deadline
retry without budget is dangerous
virtual threads do not remove downstream capacity limits
gRPC deadline is a first-class model worth learning from
HTTP needs explicit internal deadline propagation
```

---

## 31. References

- Java SE 25 `HttpClient` and `HttpClient.Builder` documentation.
- Java SE 25 `HttpRequest.Builder.timeout` documentation.
- gRPC Deadlines guide.
- gRPC Status code documentation.
- AWS Builders Library: Timeouts, retries, and backoff with jitter.
- Apache HttpClient 5.x request configuration documentation.
- Resilience4j documentation for Retry, TimeLimiter, CircuitBreaker, Bulkhead, and RateLimiter patterns.
- OpenTelemetry semantic conventions for HTTP/RPC client/server telemetry.

---

## 32. Status Seri

```text
Part 13 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 14 — Retry, Idempotency, Backoff, Jitter, Hedging, and Duplicate Suppression
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./012-jdk-java-net-http-httpclient-architecture-usage-production-patterns.md">⬅️ Part 12 — JDK `java.net.http.HttpClient`: Architecture, Usage, and Production Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./014-retry-idempotency-backoff-jitter-hedging-duplicate-suppression.md">Part 14 — Retry, Idempotency, Backoff, Jitter, Hedging, and Duplicate Suppression ➡️</a>
</div>

# Part 24 — Performance Engineering: Throughput, Latency, Allocation, GC, Threading

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `24-performance-engineering-throughput-latency-allocation-gc-threading.md`  
> Scope: Java 8–25, JDK HttpClient, OkHttp, Retrofit, Apache HttpClient 5, Spring HTTP Client Layer

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas lifecycle, URI, header, body, timeout, pooling, DNS, TLS, authentication, retry, rate limit, circuit breaker, library deep dive, architecture, error modelling, observability, dan testing.

Part ini masuk ke area yang sering membedakan engineer biasa dengan engineer yang benar-benar matang: **performance engineering untuk HTTP client**.

Bukan sekadar:

```java
client.get(url);
```

Bukan sekadar:

```yaml
max-connections: 200
timeout: 5s
```

Bukan juga sekadar “pakai async supaya cepat”.

HTTP client performance adalah hasil dari banyak layer yang saling mempengaruhi:

```text
application concurrency
→ thread model
→ queueing
→ connection pool
→ DNS
→ TCP
→ TLS
→ HTTP/1.1 or HTTP/2
→ request body write
→ downstream processing
→ response body read
→ decompression
→ parsing
→ object allocation
→ GC
→ mapper
→ retry/fallback policy
→ caller SLA
```

Kalau satu layer salah, performance bisa runtuh meskipun library yang dipakai “cepat”.

Target part ini:

1. Membangun mental model performance HTTP client.
2. Memisahkan latency, throughput, concurrency, dan resource cost.
3. Memahami bottleneck yang umum terjadi di client-side integration.
4. Menentukan kapan blocking, async, reactive, atau virtual threads cocok.
5. Menghindari benchmark yang menipu.
6. Membuat checklist diagnosis performance di production.
7. Menyusun desain client yang stabil di P95/P99, bukan hanya cepat di happy path.

---

## 2. Prinsip Utama: Performance HTTP Client Bukan Hanya Kecepatan Request

Banyak orang mengira HTTP client performance berarti:

```text
berapa ms untuk satu request selesai?
```

Itu terlalu sempit.

Dalam production system, performance HTTP client minimal mencakup:

| Dimensi | Pertanyaan |
|---|---|
| Latency | Berapa lama satu operasi selesai? |
| Tail latency | Seberapa buruk P95/P99/P999? |
| Throughput | Berapa operasi per detik yang bisa diproses? |
| Concurrency | Berapa request in-flight yang aman? |
| Saturation | Resource mana yang mulai penuh dulu? |
| Allocation | Berapa objek/byte dialokasikan per request? |
| GC pressure | Apakah parsing/logging/body buffering memicu GC? |
| Thread cost | Apakah thread pool, event loop, atau virtual thread sehat? |
| Pool behavior | Apakah koneksi reused atau selalu dibuat ulang? |
| Downstream impact | Apakah client membanjiri dependency? |
| Stability | Apakah performa tetap stabil saat downstream lambat? |
| Recoverability | Apakah retry memperbaiki atau memperburuk beban? |

Top-tier engineer tidak hanya bertanya:

```text
Library mana paling cepat?
```

Mereka bertanya:

```text
Pada workload ini, bottleneck dominan ada di mana?
Batas concurrency aman berapa?
Apa yang terjadi saat downstream mulai lambat?
Apa yang terjadi pada P99 saat payload besar?
Apa yang terjadi pada GC saat response body dilog?
Apa yang terjadi pada pool saat retry aktif?
```

---

## 3. Performance Model Dasar

### 3.1 Latency Total

Untuk satu HTTP operation, latency total bisa dipikirkan seperti ini:

```text
total_latency
= queue_wait
+ dns_time
+ pool_acquire_time
+ tcp_connect_time
+ tls_handshake_time
+ request_write_time
+ server_processing_time
+ first_byte_wait_time
+ response_read_time
+ decompression_time
+ parsing_time
+ mapping_time
+ policy_overhead
```

Tidak semua fase terjadi di semua request.

Jika koneksi sudah pooled:

```text
dns_time ≈ 0
connect_time ≈ 0
tls_handshake_time ≈ 0
```

Jika response kecil dan parser ringan:

```text
response_read_time + parsing_time kecil
```

Jika response besar:

```text
response_read_time + decompression_time + parsing_time + allocation cost dominan
```

Jika downstream lambat:

```text
server_processing_time / first_byte_wait_time dominan
```

Jika client overload:

```text
queue_wait dan pool_acquire_time dominan
```

### 3.2 Throughput

Throughput kira-kira:

```text
throughput ≈ concurrency / average_latency
```

Contoh:

```text
100 concurrent requests
average latency 200 ms
throughput ≈ 100 / 0.2 = 500 req/s
```

Tetapi ini hanya approximation. Realita dipengaruhi oleh:

- pool limit
- thread limit
- CPU
- GC
- downstream rate limit
- HTTP/2 stream limit
- retry
- queue limit
- body size
- network bandwidth

### 3.3 Little's Law untuk HTTP Client

Rumus mental yang sangat berguna:

```text
L = λ × W
```

Di mana:

| Simbol | Makna |
|---|---|
| L | jumlah request in-flight/concurrency |
| λ | arrival rate/throughput |
| W | average time in system/latency |

Contoh:

```text
Target throughput = 300 req/s
Average latency = 250 ms = 0.25s
Required concurrency ≈ 300 × 0.25 = 75
```

Kalau latency naik menjadi 1 detik:

```text
Required concurrency ≈ 300 × 1 = 300
```

Artinya downstream slowness otomatis menaikkan jumlah in-flight request jika arrival rate tetap. Kalau concurrency tidak dibatasi, sistem akan mengisi thread, pool, memory, queue, dan akhirnya collapse.

Inilah kenapa performance engineering tidak bisa dipisahkan dari timeout, bulkhead, rate limit, dan circuit breaker.

---

## 4. Latency Distribution: Jangan Hanya Lihat Average

Average latency sering menipu.

Misalnya:

```text
95 request selesai dalam 50 ms
5 request selesai dalam 2 detik
```

Average:

```text
(95 × 50ms + 5 × 2000ms) / 100
= 147.5 ms
```

Terlihat cukup baik.

Tetapi P95/P99 buruk.

Untuk sistem production, terutama service-to-service call, yang penting:

| Metric | Makna |
|---|---|
| P50 | median user experience |
| P90 | mulai terlihat tail |
| P95 | common SLO threshold |
| P99 | worst common production pain |
| P999 | rare-but-dangerous tail |
| max | sering noisy tapi berguna saat incident |

HTTP client performance harus diukur dengan histogram, bukan hanya average.

### 4.1 Kenapa P99 Penting?

Karena satu request aplikasi sering melakukan banyak downstream call.

Jika satu user operation melakukan 10 HTTP calls, dan masing-masing call punya 1% chance lambat, maka kemungkinan minimal satu call lambat jauh lebih besar.

Approximation:

```text
P(no slow call) = 0.99^10 = 0.904
P(at least one slow call) = 1 - 0.904 = 9.6%
```

Jadi P99 di dependency bisa menjadi P90 di user operation.

---

## 5. Throughput vs Latency vs Concurrency

Tiga hal ini sering tercampur.

### 5.1 Latency

Berapa lama satu request selesai.

```text
request start → response done
```

### 5.2 Throughput

Berapa banyak request selesai per satuan waktu.

```text
requests/second
```

### 5.3 Concurrency

Berapa request berjalan bersamaan.

```text
in-flight requests
```

Menaikkan concurrency bisa menaikkan throughput sampai titik tertentu. Setelah bottleneck jenuh, menaikkan concurrency hanya menaikkan latency.

```text
low concurrency
→ resource underused
→ throughput rendah

optimal concurrency
→ resource cukup terpakai
→ throughput tinggi, latency stabil

too high concurrency
→ queueing, contention, GC, downstream overload
→ throughput plateau/turun, latency naik tajam
```

### 5.4 Saturation Curve

Secara mental:

```text
throughput
  ^
  |                 _________
  |              __/
  |           __/
  |        __/
  |______/____________________> concurrency
        good zone    overload

latency
  ^
  |                         /
  |                       _/
  |                    __/
  |___________________/________> concurrency
        stable       queueing cliff
```

Tujuan bukan concurrency maksimal. Tujuan adalah concurrency yang menjaga throughput cukup tinggi dan tail latency stabil.

---

## 6. Bottleneck Taxonomy HTTP Client

Sebelum tuning, klasifikasikan bottleneck.

### 6.1 Client CPU Bottleneck

Gejala:

- CPU service caller tinggi.
- Latency naik walaupun downstream sehat.
- Flame graph menunjukkan JSON parsing, compression, logging, mapping, crypto, regex, object creation.
- GC meningkat.

Penyebab:

- payload besar
- parser inefficient
- response body dilog penuh
- object allocation terlalu tinggi
- compression/decompression berat
- TLS handshake terlalu sering
- terlalu banyak retry

### 6.2 Client Memory/GC Bottleneck

Gejala:

- heap naik saat request spike
- GC pause meningkat
- allocation rate tinggi
- OOM saat response besar
- P99 latency ikut GC pause

Penyebab:

- body dibaca sebagai `String` besar
- response list besar dimuat semua ke memory
- multipart buffering
- logging body
- retry menyimpan body berulang
- JSON tree model (`JsonNode`) dipakai untuk payload besar tanpa perlu

### 6.3 Thread Bottleneck

Gejala:

- thread pool penuh
- queue wait tinggi
- timeout meningkat
- CPU rendah tapi latency tinggi
- thread dump penuh `WAITING`/`TIMED_WAITING` pada I/O

Penyebab:

- blocking client dengan thread pool kecil
- downstream lambat
- no timeout
- retry memperpanjang occupancy thread
- executor shared dengan task lain

### 6.4 Connection Pool Bottleneck

Gejala:

- pool acquire time tinggi
- active connection = max connection
- pending connection request naik
- latency naik sebelum request benar-benar dikirim

Penyebab:

- pool terlalu kecil
- response body tidak ditutup
- downstream lambat
- per-route limit terlalu rendah
- HTTP/1.1 butuh banyak socket
- HTTP/2 stream limit tercapai

### 6.5 Network Bottleneck

Gejala:

- connect timeout
- TLS handshake lambat
- read timeout
- packet loss
- bandwidth penuh
- NAT port exhaustion
- DNS latency tinggi

Penyebab:

- cross-region call
- overloaded proxy
- bad route
- DNS issue
- LB idle timeout mismatch
- frequent new connections

### 6.6 Downstream Bottleneck

Gejala:

- caller CPU rendah
- pool/thread penuh karena menunggu
- first byte latency tinggi
- 5xx/429 meningkat
- retry memperburuk situasi

Penyebab:

- downstream overloaded
- DB downstream lambat
- rate limit downstream
- dependency chain downstream bermasalah

---

## 7. Connection Reuse: Performance Booster Paling Dasar

Membuat koneksi baru mahal karena melibatkan:

```text
DNS
→ TCP handshake
→ TLS handshake
→ HTTP negotiation
```

Koneksi yang reused menghindari sebagian besar biaya itu.

### 7.1 Anti-Pattern: Membuat Client Baru per Request

Buruk:

```java
public String call(String url) throws Exception {
    OkHttpClient client = new OkHttpClient();
    Request request = new Request.Builder().url(url).build();
    try (Response response = client.newCall(request).execute()) {
        return response.body().string();
    }
}
```

Masalah:

- connection pool baru per call
- DNS/TLS/cache tidak optimal
- resource cleanup sulit
- GC pressure dari object client
- latency lebih tinggi

Lebih benar:

```java
public final class ExternalApiTransport {
    private final OkHttpClient client;

    public ExternalApiTransport(OkHttpClient client) {
        this.client = client;
    }

    public String call(String url) throws IOException {
        Request request = new Request.Builder().url(url).build();
        try (Response response = client.newCall(request).execute()) {
            ResponseBody body = response.body();
            if (body == null) {
                return "";
            }
            return body.string();
        }
    }
}
```

### 7.2 JDK HttpClient

`HttpClient` dirancang reusable dan immutable setelah dibuat.

```java
public final class JdkTransport {
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .version(HttpClient.Version.HTTP_2)
            .build();
}
```

### 7.3 Apache HttpClient

Apache performance sangat bergantung pada connection manager.

```java
PoolingHttpClientConnectionManager cm = new PoolingHttpClientConnectionManager();
cm.setMaxTotal(200);
cm.setDefaultMaxPerRoute(50);

CloseableHttpClient client = HttpClients.custom()
        .setConnectionManager(cm)
        .evictExpiredConnections()
        .evictIdleConnections(TimeValue.ofSeconds(30))
        .build();
```

---

## 8. HTTP/1.1 vs HTTP/2 Performance

### 8.1 HTTP/1.1

HTTP/1.1 umumnya satu koneksi hanya memproses satu request aktif pada satu waktu.

```text
connection 1 → request A
connection 2 → request B
connection 3 → request C
```

Untuk concurrency tinggi, perlu banyak koneksi.

Kelebihan:

- sederhana
- mature
- predictable
- cocok jika downstream/LB tidak optimal HTTP/2

Kekurangan:

- connection count lebih tinggi
- TLS handshake lebih banyak jika pool tidak warmed
- head-of-line pada koneksi individual

### 8.2 HTTP/2

HTTP/2 memungkinkan multiplexing beberapa stream di atas satu koneksi.

```text
connection 1
  ├─ stream A
  ├─ stream B
  ├─ stream C
  └─ stream D
```

Kelebihan:

- connection lebih sedikit
- TLS reuse lebih baik
- multiplexing
- header compression

Kekurangan:

- satu koneksi bisa menjadi shared fate
- stream limit downstream bisa menjadi bottleneck
- jika satu TCP connection mengalami packet loss, semua stream terdampak di bawah TCP
- debugging bisa lebih kompleks

### 8.3 Rule of Thumb

| Kondisi | Pilihan Awal |
|---|---|
| Banyak small request ke host sama | HTTP/2 bagus |
| Payload besar bercampur payload kecil | hati-hati HTTP/2 single connection contention |
| Legacy proxy/LB | HTTP/1.1 mungkin lebih stabil |
| High fan-out internal service | HTTP/2 bisa mengurangi socket pressure |
| Downstream membatasi concurrent stream rendah | perlu tuning/observability |

---

## 9. Pool Sizing sebagai Queueing Problem

Pool size bukan angka ajaib.

Gunakan reasoning:

```text
required_connection_or_streams ≈ target_rps × average_latency_seconds
```

Misalnya:

```text
target = 200 rps
avg latency = 100 ms = 0.1s
needed concurrency ≈ 20
```

Tambahkan headroom:

```text
pool target ≈ 30–50
```

Jika P95 latency 500 ms:

```text
needed concurrency at P95-ish pressure ≈ 200 × 0.5 = 100
```

Kalau pool cuma 20, saat downstream melambat request akan antre di pool.

### 9.1 Pool Terlalu Kecil

Gejala:

```text
pool acquire wait ↑
latency ↑
CPU rendah
connection active = max
pending acquire ↑
```

### 9.2 Pool Terlalu Besar

Gejala:

```text
banyak socket idle
NAT pressure
server downstream overload
tail latency downstream naik
more TLS/session state
```

Pool besar bukan solusi universal. Kadang yang benar adalah membatasi concurrency lebih rendah agar downstream tidak mati.

### 9.3 Pool Limit vs Bulkhead Limit

Jangan memakai connection pool sebagai satu-satunya bulkhead.

Connection pool membatasi transport resource. Bulkhead membatasi operation concurrency.

```text
bulkhead limit <= safe downstream concurrency
pool limit >= transport need for accepted operations
```

Jika pool limit lebih kecil dari bulkhead tanpa sengaja, pool menjadi hidden queue.

---

## 10. Threading Model

### 10.1 Blocking Client dengan Platform Threads

Model klasik:

```text
1 request in-flight ≈ 1 thread blocked
```

Kelebihan:

- sederhana
- mudah debug
- stack trace jelas
- cocok untuk Java 8–17 legacy

Kekurangan:

- banyak concurrent I/O butuh banyak thread
- thread memory overhead
- thread pool saturation
- queueing tersembunyi

### 10.2 Blocking Client dengan Virtual Threads

Java 21+ virtual threads mengurangi biaya blocking I/O pada sisi aplikasi.

Mental model:

```text
many virtual threads
→ blocking style code tetap readable
→ carrier threads digunakan efisien
```

Tetapi virtual threads bukan magic.

Virtual threads tidak menghilangkan:

- downstream latency
- connection pool limit
- rate limit
- memory allocation
- response body buffering
- CPU parsing
- retry storm
- database bottleneck

Salah paham umum:

```text
virtual threads berarti boleh unlimited outbound HTTP
```

Salah.

Tetap perlu:

```text
bulkhead
rate limit
timeout
pool configuration
backpressure
```

### 10.3 Async CompletableFuture

JDK `sendAsync` mengembalikan `CompletableFuture`.

Kelebihan:

- tidak block caller thread
- komposisi fan-out/fan-in
- cocok untuk many concurrent I/O

Kekurangan:

- cancellation dan timeout lebih sulit
- exception wrapping
- debugging stack lebih sulit
- bisa membuat unbounded in-flight jika tidak dibatasi

Anti-pattern:

```java
List<CompletableFuture<Response>> futures = urls.stream()
        .map(url -> client.sendAsync(build(url), BodyHandlers.ofString()))
        .toList();
```

Jika `urls` berisi 100.000 item, ini bisa membuat 100.000 request in-flight/queued.

Lebih aman pakai concurrency limiter.

### 10.4 Reactive Model

Reactive client cocok jika:

- aplikasi sudah reactive end-to-end
- butuh non-blocking backpressure
- payload streaming
- concurrency sangat tinggi
- tim memahami scheduler/event loop model

Reactive bisa buruk jika:

- hanya dipakai sebagai wrapper lalu `.block()` di mana-mana
- blocking operation dilakukan di event loop
- observability/debugging tidak siap
- error handling tidak matang

### 10.5 Rule of Thumb Java 8–25

| Era | Default Praktis |
|---|---|
| Java 8 | blocking + bounded executor + pool + timeout |
| Java 11–17 | JDK HttpClient/OkHttp/Apache + clear concurrency limit |
| Java 21–25 | blocking style with virtual threads is often attractive, but still bounded by downstream policies |
| Reactive stack | WebClient/Reactor Netty if app is reactive end-to-end |

---

## 11. Queueing: Hidden Source of Latency

HTTP client sering punya beberapa queue:

```text
application work queue
→ executor queue
→ bulkhead queue
→ OkHttp Dispatcher queue
→ connection pool pending acquire
→ OS socket buffer
→ downstream queue
```

Masalah muncul saat semua queue dibiarkan unbounded.

### 11.1 Queue Bukan Kapasitas Gratis

Queue menyimpan pekerjaan lama.

Jika request punya timeout 2 detik tetapi antre 10 detik, request tersebut sudah tidak berguna saat dikirim.

Rule:

```text
queue wait harus masuk dalam deadline budget
```

### 11.2 Prefer Bounded Queue + Rejection

Lebih baik menolak lebih awal daripada menunggu sampai sistem collapse.

```text
fast fail > slow collapse
```

### 11.3 Metric Wajib

Untuk setiap HTTP client penting:

- request arrival rate
- accepted rate
- rejected rate
- queue depth
- queue wait time
- in-flight count
- pool acquire time
- downstream latency

---

## 12. Allocation Engineering

HTTP client performance sering turun bukan karena network, tetapi karena allocation.

### 12.1 Allocation Sources

| Source | Contoh |
|---|---|
| response body as string | `body.string()`, `BodyHandlers.ofString()` |
| JSON parsing | DTO, collections, strings |
| logging | concatenate large body/header |
| retries | repeated request/response wrappers |
| metrics labels | high-cardinality tag strings |
| exceptions | stack traces on frequent failure |
| mapper | copying DTO → domain |
| compression | intermediate buffers |

### 12.2 Body as String vs Stream

Untuk small payload:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

Untuk large payload, hindari full buffering:

```java
HttpResponse<Path> response = client.send(
        request,
        BodyHandlers.ofFile(downloadPath)
);
```

OkHttp:

```java
try (Response response = client.newCall(request).execute()) {
    ResponseBody body = response.body();
    if (body == null) return;

    try (InputStream in = body.byteStream()) {
        Files.copy(in, targetPath, StandardCopyOption.REPLACE_EXISTING);
    }
}
```

### 12.3 JSON Tree vs Data Binding vs Streaming

| Approach | Memory | Flexibility | Use Case |
|---|---:|---:|---|
| DTO binding | medium | medium | normal API response |
| `JsonNode` tree | high | high | dynamic fields, validation |
| streaming parser | low | low/medium | large arrays/events |

Large response array jangan selalu dimuat penuh ke `List<Dto>` jika bisa diproses streaming/paginated.

### 12.4 Logging Body = Performance + Security Risk

Buruk:

```java
log.info("response={}", responseBody);
```

Masalah:

- memory allocation
- PII/secret leakage
- log volume explosion
- latency tambahan
- disk/network logging bottleneck

Lebih aman:

```text
log metadata:
  method
  route template
  status
  duration
  size
  correlation id
  error class
  retry count
```

---

## 13. GC Pressure

HTTP client yang tampak ringan bisa menghasilkan allocation rate tinggi.

Contoh:

```text
500 req/s
response body 200 KB
body buffered as String + DTO + log copy
≈ multiple copies per request
```

Kalau satu response menghasilkan 1 MB allocation efektif:

```text
500 MB/s allocation rate
```

Ini bisa memicu GC pressure besar.

### 13.1 Gejala GC-Driven Tail Latency

- P99 latency naik bersamaan dengan GC pause.
- CPU GC meningkat.
- Allocation rate naik saat traffic naik.
- Heap sawtooth tajam.
- Flame graph menunjukkan parser/logging/mapping allocation.

### 13.2 Mitigasi

- stream large body
- batasi body logging
- pagination
- avoid unnecessary DTO copies
- reuse configured mapper/client
- avoid per-request ObjectMapper
- avoid collecting all futures/results jika tidak perlu
- gunakan bounded concurrency
- ukur allocation dengan profiler

Buruk:

```java
public ExternalResponse parse(String json) throws IOException {
    ObjectMapper mapper = new ObjectMapper();
    return mapper.readValue(json, ExternalResponse.class);
}
```

Lebih baik:

```java
public final class ExternalJsonCodec {
    private final ObjectMapper mapper;

    public ExternalJsonCodec(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public ExternalResponse parse(String json) throws IOException {
        return mapper.readValue(json, ExternalResponse.class);
    }
}
```

---

## 14. Compression Performance

Compression mengurangi bandwidth tetapi menambah CPU.

### 14.1 Gzip Trade-Off

Bagus jika:

- response besar
- network bandwidth terbatas
- CPU cukup

Bisa buruk jika:

- response kecil
- CPU caller/callee sudah tinggi
- low latency critical path
- payload sudah compressed

### 14.2 Transparent Decompression

Banyak client mendukung transparent gzip. Ini nyaman, tetapi observability harus membedakan:

```text
compressed bytes over network
vs
uncompressed bytes processed by application
```

Metric ideal:

- request bytes sent
- response bytes received compressed
- response bytes processed decompressed
- decompression time jika signifikan

---

## 15. TLS Performance

TLS handshake mahal dibanding reused connection.

### 15.1 Frequent Handshake Problem

Gejala:

- TLS handshake time tinggi
- CPU crypto meningkat
- connect latency tinggi
- connection churn tinggi

Penyebab:

- client baru per request
- pool idle timeout terlalu pendek
- LB menutup koneksi lebih cepat dari client
- no keep-alive reuse
- DNS/load balancing menyebabkan route churn
- connection TTL terlalu agresif

### 15.2 Mitigasi

- reuse client
- tune pool idle timeout selaras dengan LB
- enable HTTP/2 jika cocok
- avoid unnecessary client recreation
- monitor handshake count
- avoid over-short TTL

---

## 16. DNS Performance

DNS bukan hanya correctness issue, tapi juga performance issue.

Gejala DNS bottleneck:

- latency spike di awal request
- connect belum mulai tapi request lambat
- DNS timeout/error
- banyak lookup per request

Mitigasi:

- reuse connection
- perhatikan JVM DNS cache TTL
- custom DNS hanya jika benar-benar perlu
- monitor DNS lookup time jika library mendukung hook
- hindari membuat client baru per request

OkHttp `EventListener` bisa membantu mengamati fase DNS.

---

## 17. Retry Impact terhadap Performance

Retry menaikkan latency dan beban.

Jika original traffic:

```text
100 rps
```

Dan 20% request retry sekali:

```text
actual downstream attempts = 100 + 20 = 120 rps
```

Jika retry dua kali:

```text
bisa 140 rps atau lebih
```

Saat downstream sedang overload, retry bisa memperparah overload.

### 17.1 Retry Amplification

```text
downstream slow
→ timeout
→ retry
→ more requests
→ downstream slower
→ more timeout
→ retry storm
```

### 17.2 Performance-Safe Retry

Retry harus:

- bounded by deadline
- bounded by max attempts
- menggunakan backoff+jitter
- menghormati `Retry-After`
- hanya untuk retryable failure
- dikontrol retry budget
- observable as attempts, not hidden

---

## 18. Fan-Out Performance

Satu operation sering memanggil banyak API:

```text
getDashboard()
  ├─ profile API
  ├─ balance API
  ├─ notification API
  ├─ recommendation API
  └─ audit API
```

Sequential:

```text
total latency = sum(all calls)
```

Parallel:

```text
total latency ≈ max(call latencies) + coordination overhead
```

Tetapi parallel fan-out menaikkan concurrency.

### 18.1 Fan-Out Anti-Pattern

```java
List<CompletableFuture<Result>> futures = items.stream()
        .map(item -> callExternal(item))
        .toList();

return futures.stream()
        .map(CompletableFuture::join)
        .toList();
```

Masalah:

- unbounded fan-out
- pool exhaustion
- downstream overload
- memory menahan semua future/result
- cancellation sulit

### 18.2 Bounded Fan-Out

Gunakan semaphore/bulkhead.

```java
public final class BoundedHttpCaller {
    private final Semaphore semaphore;
    private final HttpClient client;

    public BoundedHttpCaller(HttpClient client, int maxConcurrent) {
        this.client = client;
        this.semaphore = new Semaphore(maxConcurrent);
    }

    public HttpResponse<String> call(HttpRequest request) throws Exception {
        if (!semaphore.tryAcquire(100, TimeUnit.MILLISECONDS)) {
            throw new RejectedExecutionException("external API concurrency limit reached");
        }
        try {
            return client.send(request, HttpResponse.BodyHandlers.ofString());
        } finally {
            semaphore.release();
        }
    }
}
```

---

## 19. Virtual Threads Performance Model

Virtual threads membuat blocking I/O jauh lebih scalable dari sisi thread memory/management.

Contoh Java 21+:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<HttpResponse<String>>> futures = requests.stream()
            .map(request -> executor.submit(() ->
                    client.send(request, HttpResponse.BodyHandlers.ofString())
            ))
            .toList();

    for (Future<HttpResponse<String>> future : futures) {
        HttpResponse<String> response = future.get();
        // process response
    }
}
```

Tetapi tetap butuh limit.

Lebih aman:

```java
public final class VirtualThreadExternalClient {
    private final HttpClient client;
    private final Semaphore bulkhead;

    public VirtualThreadExternalClient(HttpClient client, int maxInFlight) {
        this.client = client;
        this.bulkhead = new Semaphore(maxInFlight);
    }

    public HttpResponse<String> send(HttpRequest request) throws Exception {
        if (!bulkhead.tryAcquire(50, TimeUnit.MILLISECONDS)) {
            throw new RejectedExecutionException("bulkhead full");
        }
        try {
            return client.send(request, HttpResponse.BodyHandlers.ofString());
        } finally {
            bulkhead.release();
        }
    }
}
```

Virtual threads reduce thread bottleneck, not downstream bottleneck.

---

## 20. Async Performance Model

Async bukan otomatis lebih cepat.

Async membantu jika bottleneck adalah thread blocking.

Async tidak membantu jika bottleneck adalah:

- downstream latency
- CPU parsing
- GC
- pool size
- bandwidth
- rate limit

### 20.1 Async Benefit

```text
few platform threads
→ many in-flight I/O
→ better resource usage
```

### 20.2 Async Cost

- future/callback allocation
- context propagation complexity
- exception handling complexity
- cancellation complexity
- harder profiling
- accidental unbounded concurrency

### 20.3 Async with Limit

```java
public CompletableFuture<HttpResponse<String>> sendBounded(HttpRequest request) {
    if (!semaphore.tryAcquire()) {
        return CompletableFuture.failedFuture(
                new RejectedExecutionException("client bulkhead full")
        );
    }

    return client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
            .whenComplete((r, t) -> semaphore.release());
}
```

---

## 21. Event Loop Performance Pitfall

Reactive/event-loop systems sangat sensitif terhadap blocking.

Buruk:

```java
webClient.get()
        .uri("/data")
        .retrieve()
        .bodyToMono(String.class)
        .map(body -> blockingDatabaseCall(body)); // dangerous if running on event loop
```

Aturan:

```text
Jangan block event loop.
```

Jika harus blocking, pindahkan ke bounded scheduler/executor yang tepat.

Masalah lain:

```text
reactive client + blocking downstream mapper + large JSON parsing
```

Bisa tetap membuat CPU bottleneck.

---

## 22. Payload Size dan Streaming Strategy

### 22.1 Small Payload

Untuk payload kecil:

- buffer as string/byte array acceptable
- simpler error handling
- easier retry
- easier logging metadata

### 22.2 Medium Payload

Perlu perhatian:

- content length limit
- parse cost
- DTO allocation
- timeout read

### 22.3 Large Payload

Gunakan streaming/file.

Jangan:

```java
String body = response.body().string(); // huge body
```

Gunakan:

```java
try (InputStream in = response.body().byteStream()) {
    processIncrementally(in);
}
```

Atau JDK:

```java
client.send(request, BodyHandlers.ofFile(path));
```

### 22.4 Batas Body Size

Production client sebaiknya punya batas:

```text
max response bytes
max error body bytes for logging
max decompressed size
max upload size
```

Tanpa limit, malicious/buggy downstream bisa mengirim body besar dan membunuh heap.

---

## 23. ObjectMapper, Converter, Codec Performance

### 23.1 Reuse Mapper

`ObjectMapper` mahal untuk dibuat dan sebaiknya reusable setelah konfigurasi.

Buruk:

```java
new ObjectMapper().readValue(json, Dto.class);
```

Baik:

```java
private final ObjectMapper mapper;
```

### 23.2 DTO Design

DTO yang terlalu nested dan generic bisa memperberat parsing/mapping.

Perhatikan:

- `Map<String, Object>` berlebihan
- polymorphic deserialization
- BigDecimal untuk semua angka tanpa perlu
- date parsing custom per field
- reflection-heavy mapping

### 23.3 Converter Retrofit

Retrofit converter mempengaruhi CPU/allocation.

Jika performance critical:

- ukur converter cost
- hindari double parsing error body
- batasi error body buffer
- gunakan DTO khusus

---

## 24. Logging dan Metrics Cardinality Performance

Observability juga punya cost.

### 24.1 High Cardinality Labels

Buruk:

```text
http.client.duration{url="/orders/123456/items/987"}
```

Baik:

```text
http.client.duration{route="/orders/{orderId}/items/{itemId}"}
```

High cardinality menyebabkan:

- memory besar di metrics backend
- query lambat
- biaya observability tinggi
- cardinality explosion saat incident

### 24.2 Logging Volume

Jika 1000 rps dan tiap request log 5 KB:

```text
5 MB/s logs
≈ 300 MB/minute
≈ 18 GB/hour
```

Saat incident, log bisa menjadi bottleneck sendiri.

---

## 25. Performance Testing Strategy

Performance testing HTTP client perlu beberapa level.

### 25.1 Microbenchmark

Cocok untuk:

- JSON parsing strategy
- mapper cost
- small utility cost
- header construction
- canonicalization

Gunakan JMH, bukan loop manual.

Buruk:

```java
long start = System.nanoTime();
for (int i = 0; i < 1_000_000; i++) {
    parse(json);
}
System.out.println(System.nanoTime() - start);
```

Masalah:

- JIT warmup
- dead code elimination
- constant folding
- unrealistic profile
- GC interference

JMH membantu menghindari banyak jebakan, tetapi tetap tidak menggantikan benchmark sistem nyata.

### 25.2 Component Benchmark

Cocok untuk:

- client wrapper
- mock downstream
- pool behavior
- timeout behavior
- retry overhead
- body streaming

Gunakan:

- MockWebServer
- WireMock
- MockServer
- local controlled server

### 25.3 Load Test

Cocok untuk:

- concurrency limit
- P95/P99
- downstream behavior
- pool sizing
- retry storm risk
- GC pressure

### 25.4 Soak Test

Cocok untuk:

- connection leak
- memory leak
- stale connection
- idle eviction
- DNS rotation
- log growth

### 25.5 Chaos/Fault Test

Cocok untuk:

- timeout
- slow response
- connection reset
- TLS failure
- 429
- 503
- partial response
- malformed body

---

## 26. Benchmark Pitfalls

### 26.1 Benchmarking Library Without Workload Context

Pertanyaan buruk:

```text
Mana paling cepat: JDK HttpClient, OkHttp, Apache?
```

Pertanyaan lebih baik:

```text
Untuk Java 21 service dengan 300 rps ke 3 downstream, payload 20 KB JSON,
P95 downstream 150 ms, mTLS, retry max 1, observability OTel,
client mana yang paling mudah dibuat stabil dan operable?
```

### 26.2 Localhost Benchmark Bias

Localhost menghilangkan:

- real DNS
- real TLS latency
- LB behavior
- network loss
- bandwidth constraint
- cross-zone latency
- proxy

Localhost benchmark berguna, tapi tidak cukup.

### 26.3 Happy Path Only

Benchmark 200 OK saja menipu.

Harus ukur:

- 2xx small body
- 2xx large body
- 4xx error body
- 5xx retryable
- 429 with Retry-After
- timeout
- slow first byte
- slow body
- connection reset
- malformed JSON

### 26.4 No Warmup

HTTP client performance dipengaruhi:

- JIT warmup
- connection warmup
- TLS session
- DNS cache
- downstream cache
- object allocation profile

Pisahkan cold start dan warm path.

---

## 27. Profiling HTTP Client Performance

### 27.1 Metrics First

Sebelum flame graph, lihat:

- request rate
- latency histogram
- error rate
- retry attempts
- timeout count
- queue depth
- active in-flight
- pool active/idle/pending
- body size
- CPU
- heap
- GC pause
- thread count

### 27.2 Thread Dump

Berguna jika:

- latency tinggi tapi CPU rendah
- thread pool stuck
- deadlock suspected
- blocking unexpected

Cari:

- banyak thread menunggu connection pool
- banyak thread blocked I/O
- event loop blocked
- executor queue penuh

### 27.3 Heap/Allocation Profiling

Cari:

- `byte[]`
- `char[]`
- `String`
- JSON node/object
- log event
- exception stack trace
- DTO collections

### 27.4 CPU Flame Graph

Cari:

- JSON parse
- regex
- logging
- TLS crypto
- compression
- mapping
- metrics label creation
- retries

---

## 28. Library-Specific Performance Notes

## 28.1 JDK HttpClient

Strength:

- built-in since Java 11
- HTTP/2 support
- sync and async API
- reusable immutable client
- no extra dependency

Performance notes:

- reuse client
- configure executor consciously for async if needed
- choose correct `BodyHandler`
- avoid `ofString()` for large body
- be explicit about timeout policy
- wrap with bulkhead/rate limit/retry yourself

Example:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(2))
        .version(HttpClient.Version.HTTP_2)
        .build();
```

## 28.2 OkHttp

Strength:

- efficient defaults
- connection pooling
- HTTP/2 multiplexing
- interceptor model
- EventListener
- good testing via MockWebServer

Performance notes:

- reuse `OkHttpClient`
- close response body
- tune Dispatcher for async workload
- avoid heavy interceptor logic
- use EventListener for lifecycle timing
- do not rely only on `retryOnConnectionFailure` for semantic retry

## 28.3 Retrofit

Strength:

- type-safe API interface
- converter/call adapter ecosystem
- rides on OkHttp

Performance notes:

- underlying OkHttp config matters most
- converter cost matters
- error body parsing can double-read if careless
- avoid returning raw DTO directly into domain if mapping heavy/uncontrolled
- avoid dynamic proxy overhead concerns unless proven; network/parsing usually dominates

## 28.4 Apache HttpClient 5

Strength:

- strong enterprise configuration
- classic and async APIs
- pooling connection managers
- proxy/TLS/route control

Performance notes:

- configure max total/per route
- configure connection request timeout
- close response/entity properly
- evict idle/expired connections
- choose classic vs async intentionally
- avoid per-request client construction

## 28.5 Spring RestClient/WebClient/RestTemplate

Performance notes:

- abstraction is not transport; underlying factory/connector matters
- configure pool/timeout at underlying client
- `WebClient` needs event-loop discipline
- `RestClient` with virtual threads can be simple and scalable
- observability filters have cost; control cardinality

---

## 29. Performance Design Patterns

### 29.1 Client Policy Object

```java
public record HttpClientPerformancePolicy(
        int maxInFlight,
        int maxConnections,
        Duration connectTimeout,
        Duration responseTimeout,
        int maxResponseBytes,
        boolean enableCompression,
        boolean preferHttp2
) {}
```

Policy harus eksplisit, bukan tersebar di magic constants.

### 29.2 Per-Downstream Client Isolation

Jangan satu global client policy untuk semua external API.

```text
Payment API:
  maxInFlight=50
  timeout=2s
  retry=1

Report API:
  maxInFlight=10
  timeout=30s
  retry=0

Search API:
  maxInFlight=100
  timeout=500ms
  retry=0/hedge carefully
```

### 29.3 Separate Critical and Non-Critical Traffic

```text
critical transaction call
→ strict timeout
→ low retry
→ strong audit

background sync call
→ longer timeout
→ rate-limited worker
→ resumable checkpoint
```

### 29.4 Deadline Propagation

Jika upstream punya deadline 1 detik, jangan downstream client timeout 5 detik.

```text
remaining deadline = upstream deadline - elapsed - safety margin
```

### 29.5 Load Shedding

Saat client saturated:

```text
reject early
rather than
queue indefinitely
```

---

## 30. Production Dashboard untuk HTTP Client Performance

Minimal dashboard per downstream:

### 30.1 Traffic

- request rate
- attempt rate
- success rate
- error rate
- retry rate
- rejection rate

### 30.2 Latency

- operation latency P50/P95/P99
- per-attempt latency P50/P95/P99
- pool acquire time
- DNS time jika ada
- connect time
- TLS time
- time to first byte
- body read time
- parsing time jika signifikan

### 30.3 Resource

- in-flight requests
- queue depth
- active connections
- idle connections
- pending pool acquire
- thread pool active/queued
- heap usage
- allocation rate
- GC pause

### 30.4 Policy

- timeout count by phase
- circuit breaker state
- bulkhead rejection
- rate limiter rejection
- fallback count
- hedged request count

### 30.5 Payload

- request size distribution
- response size distribution
- error body size truncated count

---

## 31. Diagnosis Playbook: Latency Naik

Jika HTTP client latency naik, jangan langsung menaikkan timeout.

### Step 1 — Apakah latency naik di semua downstream atau satu downstream?

Semua downstream:

- caller CPU/GC/thread issue
- network shared issue
- proxy issue
- observability/logging issue

Satu downstream:

- downstream slow
- route/DNS/LB issue
- pool per-route issue

### Step 2 — CPU tinggi atau rendah?

CPU tinggi:

- parsing
- compression
- logging
- TLS churn
- GC

CPU rendah:

- waiting I/O
- pool starvation
- thread blocking
- downstream slow

### Step 3 — Pool acquire time tinggi?

Ya:

- pool too small
- body leak
- downstream slow
- too much concurrency

Tidak:

- downstream response time
- network
- parsing

### Step 4 — Retry rate naik?

Ya:

- retry storm possible
- disable/reduce retry temporarily
- respect Retry-After
- circuit breaker

### Step 5 — Response size berubah?

Ya:

- payload bloat
- pagination broken
- compression disabled
- mapping/GC pressure

### Step 6 — GC pause naik?

Ya:

- allocation profiling
- body buffering/logging
- DTO explosion

---

## 32. Diagnosis Playbook: Throughput Tidak Naik Meski Concurrency Dinaikkan

Kemungkinan:

1. Downstream sudah saturated.
2. Connection pool limit tercapai.
3. CPU caller penuh.
4. GC pressure tinggi.
5. Rate limiter membatasi.
6. Network bandwidth penuh.
7. HTTP/2 stream limit tercapai.
8. Lock/contention di client wrapper.
9. Executor queue/thread limit.
10. Logging/metrics bottleneck.

Yang dicek:

```text
CPU
GC
active threads
in-flight
pool active/pending
retry rate
status code distribution
body size
network throughput
P95/P99 latency
```

---

## 33. Diagnosis Playbook: Memory Naik Saat Traffic HTTP Naik

Cek:

- apakah response dibaca penuh sebagai string?
- apakah body dilog?
- apakah error body disimpan?
- apakah futures/results dikumpulkan semua?
- apakah pagination terlalu besar?
- apakah retry menyimpan banyak body?
- apakah metrics cardinality meledak?
- apakah exception rate tinggi?
- apakah client dibuat per request?

Mitigasi:

- streaming
- truncation
- bounded concurrency
- pagination
- DTO simplification
- mapper reuse
- reduce error stack trace spam
- cardinality control

---

## 34. Production Hardening Checklist

Sebelum HTTP client dianggap performance-ready:

### 34.1 Client Lifecycle

- [ ] Client reused/singleton per downstream policy.
- [ ] Tidak membuat client per request.
- [ ] Shutdown lifecycle jelas jika client punya resources.

### 34.2 Timeout

- [ ] Connect timeout.
- [ ] Response/read timeout.
- [ ] Call/deadline timeout.
- [ ] Pool acquisition timeout jika applicable.
- [ ] Timeout masuk akal terhadap upstream SLA.

### 34.3 Pool/Concurrency

- [ ] Pool size dihitung dari throughput × latency.
- [ ] Bulkhead/concurrency limiter ada.
- [ ] Queue bounded.
- [ ] Rejection observable.
- [ ] Response body selalu ditutup.

### 34.4 Payload

- [ ] Large body streaming.
- [ ] Max response size.
- [ ] Error body truncated.
- [ ] No full body logging.
- [ ] Compression understood.

### 34.5 CPU/GC

- [ ] Mapper reused.
- [ ] DTO boundary tidak boros tanpa alasan.
- [ ] Allocation measured for hot path.
- [ ] GC monitored.

### 34.6 Retry/Policy

- [ ] Retry bounded.
- [ ] Retry respects deadline.
- [ ] Retry rate measured.
- [ ] Idempotency considered.
- [ ] Circuit/bulkhead/rate limit composition tested.

### 34.7 Observability

- [ ] Latency histogram, not just average.
- [ ] Attempt vs operation metrics separated.
- [ ] Pool metrics visible.
- [ ] Timeout classified by phase where possible.
- [ ] Cardinality controlled.
- [ ] Sensitive data redacted.

### 34.8 Testing

- [ ] Load test with realistic latency/body/error mix.
- [ ] Fault injection for timeout/reset/429/503.
- [ ] Soak test for leak.
- [ ] Benchmark includes warm and cold behavior.

---

## 35. Design Review Questions

Saat review HTTP client performance, tanyakan:

1. Berapa target RPS per downstream?
2. Berapa P50/P95/P99 downstream latency?
3. Berapa max in-flight yang aman?
4. Apa yang terjadi jika downstream latency naik 5x?
5. Apakah request akan antre, ditolak, retry, atau fallback?
6. Apakah timeout mengikuti upstream deadline?
7. Apakah retry bisa menggandakan traffic?
8. Apakah body besar akan masuk heap?
9. Apakah response body selalu ditutup?
10. Apakah pool acquire time observable?
11. Apakah metrics route menggunakan template, bukan URL literal?
12. Apakah logging body dibatasi/redacted?
13. Apakah event loop pernah diblok?
14. Apakah virtual threads dipakai dengan bulkhead?
15. Apakah benchmark mencerminkan workload production?
16. Apakah failure path diuji, bukan hanya 200 OK?
17. Apakah client dan downstream punya rate contract?
18. Apakah connection reuse benar-benar terjadi?
19. Apakah TLS handshake count wajar?
20. Apakah performance regression akan terdeteksi di CI/CD atau pre-prod?

---

## 36. Mental Model Ringkas

HTTP client performance bukan pertanyaan:

```text
Bagaimana membuat request cepat?
```

Tetapi:

```text
Bagaimana membuat outbound operation tetap stabil,
terukur, bounded, dan diagnosable
saat traffic naik, payload membesar, downstream lambat,
network buruk, retry aktif, dan production sedang tidak ideal?
```

Model akhirnya:

```text
performance = latency distribution + throughput + resource cost + stability under failure
```

Dan untuk HTTP client:

```text
stability > raw speed
bounded concurrency > unlimited parallelism
reuse > recreate
stream > buffer large payload
histogram > average
deadline > timeout angka acak
policy composition > scattered retry
measurement > assumption
```

---

## 37. Ringkasan Part 24

Kita telah membahas:

- latency decomposition
- throughput/concurrency/Little's Law
- P95/P99 tail latency
- bottleneck taxonomy
- connection reuse
- HTTP/1.1 vs HTTP/2 performance
- pool sizing
- blocking, async, reactive, virtual threads
- queueing
- allocation dan GC pressure
- compression/TLS/DNS performance
- retry amplification
- fan-out performance
- payload streaming
- mapper/converter cost
- observability cardinality
- benchmark pitfalls
- profiling strategy
- library-specific notes
- production dashboard
- diagnosis playbook
- hardening checklist

Part ini menjadi dasar untuk memahami bahwa performance tuning tidak boleh dilakukan dengan “tebak angka konfigurasi”. Harus dimulai dari model beban, lifecycle request, measurement, dan batas resource.

---

## 38. Koneksi ke Part Berikutnya

Part berikutnya:

```text
Part 25 — Virtual Threads, CompletableFuture, Reactive, dan Structured Concurrency
File: 25-virtual-threads-completablefuture-reactive-structured-concurrency.md
```

Di Part 24 kita sudah menyentuh thread model dari sisi performance. Part 25 akan lebih dalam membahas model concurrency itu sendiri:

```text
blocking platform thread
→ virtual thread
→ CompletableFuture
→ reactive stream
→ structured concurrency
→ cancellation
→ deadline propagation
→ fan-out/fan-in
→ bounded parallelism
```

Tujuannya agar kita tidak hanya tahu “async lebih cepat” atau “virtual thread lebih mudah”, tetapi bisa memilih model concurrency berdasarkan workload, failure semantics, observability, dan maintainability.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 23 — JSON/XML Mapping for HTTP Client Boundary](./23-json-xml-mapping-at-http-client-boundary.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 25 — Virtual Threads, CompletableFuture, Reactive, dan Structured Concurrency](./25-virtual-threads-completablefuture-reactive-structured-concurrency.md)

# Part 12 — Rate Limiting, Throttling, Bulkhead, dan Client-Side Load Shedding

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `12-rate-limiting-throttling-bulkhead-client-side-load-shedding.md`  
> Target: Java 8–25, production-grade HTTP client engineering  
> Fokus: mengendalikan beban keluar, membatasi concurrency, mencegah queue explosion, dan menjaga sistem tetap stabil ketika downstream lambat, mahal, atau membatasi request.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan **rate limit**, **throttle**, **bulkhead**, **queue limit**, **concurrency limit**, dan **load shedding**.
2. Mendesain HTTP client yang tidak hanya “bisa retry”, tetapi juga **tidak memperparah overload**.
3. Menentukan batas request berdasarkan SLA, downstream quota, thread model, connection pool, dan business priority.
4. Mengimplementasikan client-side guard menggunakan Java 8–25, OkHttp, Retrofit, JDK HttpClient, Apache HttpClient, Resilience4j, Failsafe, atau custom primitive.
5. Mendeteksi gejala production seperti pool exhaustion, retry storm, queue explosion, thread starvation, dan NAT/ephemeral port pressure.
6. Membuat policy yang defensible untuk sistem enterprise/regulatory: dapat dijelaskan, diamati, diuji, dan diaudit.

---

## 2. Mental Model Utama

HTTP client bukan hanya komponen yang mengirim request. HTTP client adalah **traffic governor**.

Tanpa governor, caller akan melakukan ini:

```text
incoming traffic naik
→ service membuat lebih banyak outbound HTTP call
→ downstream mulai lambat / 429 / 503
→ caller retry
→ jumlah outbound call makin naik
→ thread, pool, memory, dan socket penuh
→ caller ikut jatuh
→ upstream ikut retry
→ cascading failure
```

Client-side rate limiting dan bulkhead bertugas memutus spiral itu.

Model yang lebih sehat:

```text
incoming work
→ classify priority
→ check concurrency capacity
→ check rate quota
→ check queue budget
→ execute outbound call
→ observe latency/error/rate-limit signal
→ adapt / reject / degrade when needed
```

Prinsipnya:

> Tidak semua request yang bisa dibuat harus dikirim.

Top-tier engineer tidak hanya bertanya:

```text
Bagaimana cara call API ini?
```

Tetapi:

```text
Berapa banyak call yang boleh saya kirim?
Berapa lama saya boleh menunggu?
Apa yang terjadi jika downstream lambat?
Apakah retry saya memperburuk keadaan?
Siapa yang harus dikorbankan lebih dulu saat kapasitas habis?
Apa sinyal bahwa sistem mulai tidak sehat?
```

---

## 3. Istilah Penting

### 3.1 Rate Limit

Rate limit membatasi **jumlah eksekusi per satuan waktu**.

Contoh:

```text
maksimal 100 request / detik
maksimal 300 request / menit
maksimal 10.000 request / hari
```

Rate limit menjawab:

```text
Seberapa cepat request boleh dikirim?
```

Rate limit cocok untuk:

- third-party API quota
- payment gateway
- SMS/email provider
- geocoding API
- government/agency API
- expensive AI/ML endpoint
- internal service dengan kapasitas terbatas

---

### 3.2 Throttling

Throttling adalah tindakan **memperlambat atau menahan request** agar sesuai batas.

Rate limit adalah rule. Throttling adalah mekanisme enforcement.

Contoh:

```text
request masuk terlalu cepat
→ client menunggu permit
→ request dikirim setelah permit tersedia
```

Throttling bisa:

- blocking wait
- async wait
- queue
- reject langsung
- degrade ke cache

---

### 3.3 Concurrency Limit

Concurrency limit membatasi **jumlah request yang sedang in-flight secara bersamaan**.

Contoh:

```text
maksimal 50 request bersamaan ke payment-api
maksimal 10 request bersamaan ke legacy-mainframe
maksimal 5 upload file besar bersamaan
```

Concurrency limit menjawab:

```text
Berapa banyak pekerjaan yang boleh aktif saat ini?
```

Ini berbeda dari rate limit.

```text
Rate limit:        100 request/detik
Concurrency limit: 20 request aktif
```

Jika downstream cepat, 100 rps mungkin hanya butuh concurrency kecil. Jika downstream lambat, rps yang sama bisa membutuhkan concurrency jauh lebih besar.

Formula kasar:

```text
required concurrency ≈ throughput × latency
```

Contoh:

```text
100 request/detik × 200 ms = 20 concurrent request
100 request/detik × 2 detik = 200 concurrent request
```

Maka latency spike bisa membuat concurrency meledak walaupun request rate tidak naik.

---

### 3.4 Bulkhead

Bulkhead membagi resource supaya satu downstream atau satu jenis traffic tidak menenggelamkan seluruh service.

Analogi kapal:

```text
kompartemen A bocor
→ air tidak langsung memenuhi seluruh kapal
```

Dalam HTTP client:

```text
payment-api lambat
→ hanya bulkhead payment-api penuh
→ client lain seperti profile-api, notification-api, audit-api tetap berjalan
```

Tanpa bulkhead:

```text
satu downstream lambat
→ semua thread pool habis
→ semua endpoint service ikut lambat
```

---

### 3.5 Queue Limit

Queue limit membatasi jumlah request yang boleh menunggu sebelum dieksekusi.

Queue tidak gratis. Queue memakai:

- memory
- object allocation
- timeout budget
- user patience
- operational visibility

Queue besar sering menyembunyikan overload sampai terlambat.

Anti-pattern:

```text
unbounded queue
→ latency naik diam-diam
→ memory naik
→ GC pressure
→ timeout massal
→ retry storm
```

Rule of thumb:

> Queue harus kecil, bounded, observable, dan punya reject policy.

---

### 3.6 Load Shedding

Load shedding adalah menolak sebagian request secara sadar untuk menjaga sistem tetap hidup.

Contoh:

```text
bulkhead penuh
→ reject low-priority request
→ return 503 / 429 / fallback
→ high-priority request tetap punya kapasitas
```

Load shedding bukan kegagalan desain. Dalam sistem production, load shedding adalah mekanisme survival.

Yang buruk bukan menolak request. Yang buruk adalah:

```text
menerima semua request
→ membuat semuanya menunggu
→ akhirnya semuanya timeout
```

---

## 4. Perbedaan Konsep Secara Ringkas

| Konsep | Membatasi Apa | Pertanyaan Utama | Contoh |
|---|---:|---|---|
| Rate limit | request per waktu | Seberapa cepat? | 300/minute |
| Concurrency limit | in-flight request | Berapa banyak aktif? | max 50 concurrent |
| Bulkhead | resource per domain | Siapa memakai resource apa? | payment pool terpisah |
| Queue limit | request menunggu | Berapa banyak boleh antre? | max queue 100 |
| Throttling | mekanisme perlambatan | Tunggu atau reject? | wait permit 200 ms |
| Load shedding | request yang dibuang | Siapa dikorbankan? | reject low-priority |

---

## 5. Kenapa Ini Sangat Penting di HTTP Client

HTTP call tampak sederhana:

```java
client.send(request, BodyHandlers.ofString());
```

Tapi di production, satu baris itu menyentuh banyak resource:

```text
application thread
→ scheduler / executor
→ queue
→ DNS
→ socket
→ TLS state
→ connection pool
→ downstream capacity
→ response buffer
→ JSON parser
→ retry loop
→ log / metric / trace
```

Jika tidak dibatasi, HTTP client bisa menjadi amplifier.

Contoh amplifier:

```text
100 incoming request / second
setiap request call 4 downstream
setiap downstream retry 3 kali
```

Worst-case outbound attempt:

```text
100 × 4 × 3 = 1.200 outbound attempts / second
```

Padahal sistem terlihat hanya menerima 100 rps.

Inilah kenapa retry, timeout, rate limit, dan bulkhead tidak boleh didesain terpisah.

---

## 6. Little’s Law sebagai Fondasi Concurrency

Little’s Law:

```text
L = λ × W
```

Dalam konteks HTTP client:

```text
concurrency ≈ throughput × latency
```

Keterangan:

- `L`: jumlah request in-flight
- `λ`: arrival rate / throughput
- `W`: waktu tunggu / latency

Contoh normal:

```text
throughput = 200 rps
latency    = 100 ms = 0.1 s
concurrency ≈ 200 × 0.1 = 20
```

Saat downstream lambat:

```text
throughput = 200 rps
latency    = 2 s
concurrency ≈ 200 × 2 = 400
```

Artinya tanpa traffic naik pun, concurrency bisa naik 20x hanya karena latency naik.

Ini menjelaskan banyak incident:

```text
downstream latency naik
→ request in-flight menumpuk
→ thread pool penuh
→ connection pool penuh
→ queue penuh
→ timeout
→ retry
→ lebih penuh
```

Maka concurrency limit adalah rem utama untuk mencegah latency spike berubah menjadi resource collapse.

---

## 7. Rate Limit vs Concurrency Limit: Jangan Disamakan

### 7.1 Rate Limit Saja Tidak Cukup

Misalnya:

```text
rate limit = 100 rps
```

Jika downstream latency 50 ms:

```text
concurrency ≈ 5
```

Jika downstream latency 5 detik:

```text
concurrency ≈ 500
```

Rate sama, resource usage berbeda drastis.

### 7.2 Concurrency Limit Saja Tidak Cukup

Misalnya:

```text
concurrency limit = 20
latency = 10 ms
```

Maka theoretical throughput bisa:

```text
20 / 0.01 = 2.000 rps
```

Kalau downstream quota hanya 300/minute, concurrency limit saja masih bisa melanggar quota.

### 7.3 Kombinasi yang Benar

```text
rate limit       → melindungi quota / downstream admission rate
concurrency limit → melindungi resource caller dan downstream saturation
queue limit      → melindungi memory dan tail latency
bulkhead         → melindungi blast radius
load shedding    → menjaga sistem tetap hidup saat overload
```

---

## 8. Token Bucket

Token bucket adalah algoritma umum untuk rate limiting.

Model:

```text
bucket memiliki kapasitas token
setiap interval token ditambah
setiap request mengambil token
jika token tersedia → request boleh jalan
jika token habis → tunggu atau reject
```

Karakteristik:

- mendukung burst sampai kapasitas bucket
- rata-rata rate tetap terkendali
- cocok untuk API quota yang mengizinkan burst kecil

Contoh:

```text
rate = 100 token / detik
bucket size = 200 token
```

Maka client bisa mengirim burst 200 request, lalu kembali ke rata-rata 100 rps.

### 8.1 Kapan Token Bucket Cocok

Cocok untuk:

- API quota per second/minute
- endpoint yang mengizinkan burst
- worker batch yang perlu mempercepat saat idle sebelumnya
- event drain dengan batas provider

Tidak cocok jika provider menuntut request benar-benar rata tanpa burst.

---

## 9. Leaky Bucket

Leaky bucket memodelkan request keluar seperti air bocor dari ember dengan laju tetap.

Model:

```text
request masuk ke queue
queue dikuras dengan rate konstan
jika queue penuh → reject
```

Karakteristik:

- output lebih smooth
- burst diserap sebagai antrean
- latency bisa naik jika antrean panjang

Cocok untuk:

- sistem yang tidak suka burst
- integrasi legacy
- downstream dengan kapasitas stabil tapi kecil

Risikonya:

```text
queue terlalu besar
→ request menunggu terlalu lama
→ caller timeout sebelum dieksekusi
→ kerja sia-sia
```

---

## 10. Semaphore Bulkhead

Semaphore bulkhead membatasi jumlah pekerjaan aktif.

Contoh Java sederhana:

```java
public final class BoundedHttpGateway {
    private final Semaphore permits = new Semaphore(20);
    private final HttpClient client;

    public BoundedHttpGateway(HttpClient client) {
        this.client = client;
    }

    public HttpResponse<String> call(HttpRequest request) throws Exception {
        boolean acquired = permits.tryAcquire(100, TimeUnit.MILLISECONDS);
        if (!acquired) {
            throw new DownstreamBusyException("downstream bulkhead is full");
        }

        try {
            return client.send(request, HttpResponse.BodyHandlers.ofString());
        } finally {
            permits.release();
        }
    }
}
```

Catatan penting:

- `tryAcquire` lebih aman daripada `acquire` tanpa batas.
- Timeout acquire harus bagian dari total deadline.
- Permit harus dilepas dalam `finally`.
- Exception bulkhead penuh harus diklasifikasikan berbeda dari downstream 500.

---

## 11. Thread Pool Bulkhead

Thread pool bulkhead memakai executor terpisah per downstream atau per traffic class.

Contoh:

```text
payment-api-executor      max 30 threads, queue 50
notification-api-executor max 10 threads, queue 100
audit-api-executor        max 5 threads, queue 500
```

Kelebihan:

- isolasi lebih kuat
- cocok untuk blocking IO
- bisa punya queue terpisah
- mudah diamati via executor metrics

Kekurangan:

- thread overhead
- sizing lebih sulit
- dengan Java 21 virtual threads, thread pool bulkhead bukan selalu primitive terbaik

### 11.1 Dengan Virtual Threads

Virtual threads membuat blocking lebih murah, tetapi tidak menghapus kebutuhan bulkhead.

Tanpa bulkhead:

```text
100.000 virtual threads block ke downstream lambat
→ connection pool penuh
→ memory object tetap naik
→ downstream makin berat
→ timeout massal
```

Dengan virtual threads, bulkhead sering bergeser dari:

```text
thread limit
```

menjadi:

```text
concurrency permit / connection / rate / queue limit
```

---

## 12. Queue: Antara Buffer dan Bom Waktu

Queue berguna untuk menyerap burst kecil.

Tapi queue bisa menjadi bom waktu jika:

- unbounded
- tidak punya timeout
- tidak punya priority
- tidak punya visibility
- diisi request yang sudah expired
- dipakai untuk menyembunyikan downstream slowness

### 12.1 Queue Budget

Queue harus dihitung dari latency budget.

Misalnya SLA total outbound 1 detik:

```text
max wait in queue: 100 ms
max connect:       100 ms
max request IO:    700 ms
margin:            100 ms
```

Jika request menunggu di queue lebih dari 100 ms, lebih baik reject daripada mengirim request yang hampir pasti timeout.

### 12.2 Anti-Pattern: Infinite Dispatcher Queue

Beberapa HTTP client atau executor bisa memiliki queue internal. Jika aplikasi juga punya queue sendiri, retry juga punya queue, dan message broker juga punya queue, overload menjadi sulit dilihat.

```text
broker queue
→ application executor queue
→ rate limiter wait queue
→ HTTP dispatcher queue
→ connection pool wait queue
→ downstream queue
```

Top-tier engineer mencari semua antrean tersembunyi ini.

---

## 13. Load Shedding Strategy

Saat kapasitas habis, pilihan buruk adalah tetap menerima semuanya.

Load shedding memerlukan policy:

```text
request mana yang ditolak?
request mana yang ditunggu?
request mana yang diberi fallback?
request mana yang harus tetap lewat?
```

### 13.1 Berdasarkan Priority

Contoh:

```text
P0: safety / payment authorization / enforcement decision
P1: user-facing read
P2: background sync
P3: analytics / enrichment / optional notification
```

Saat bulkhead penuh:

```text
P3 reject dulu
P2 throttle
P1 limited fallback
P0 reserve capacity
```

### 13.2 Berdasarkan Freshness

Untuk request yang bisa stale:

```text
gunakan cache lama
return stale response dengan marker
jadwalkan refresh asynchronous
```

### 13.3 Berdasarkan User Journey

Tidak semua call sama penting.

Contoh regulatory case management:

```text
submit enforcement decision → high priority
load optional address suggestion → low priority
send non-critical survey notification → shed-able
fetch audit metadata → maybe required, maybe deferred tergantung action
```

---

## 14. Client-Side Rate Limit untuk Third-Party API

Misalnya provider memberi limit:

```text
300 request / minute
```

Naive implementation:

```text
5 request / second
```

Namun production harus mempertimbangkan:

- multi-instance deployment
- multiple pods sharing one quota
- clock skew
- retry attempts juga memakai quota
- token refresh call juga memakai quota atau tidak
- burst allowance
- `429 Retry-After`
- daily/monthly quota
- endpoint-specific quota
- tenant-specific quota

### 14.1 Single Instance Limit

Jika hanya satu instance:

```java
RateLimiter limiter = RateLimiter.smoothBuilder(5, Duration.ofSeconds(1)).build();
```

Konsepnya:

```text
sebelum call → acquire permit
jika permit tidak tersedia → wait bounded atau reject
```

### 14.2 Multi-Instance Limit

Jika ada 5 pod dan total quota 300/minute:

```text
opsi 1: static partition
300 / 5 = 60/minute per pod

opsi 2: distributed rate limiter
Redis / database / central coordinator

opsi 3: adaptive local limiter
pakai feedback 429 dan telemetry
```

Static partition mudah, tetapi buruk jika traffic tidak merata.

Distributed limiter lebih akurat, tetapi menambah dependency. Jangan sampai rate limiter Redis down membuat semua call ikut down tanpa fallback policy.

---

## 15. Handling HTTP 429

`429 Too Many Requests` berarti server menolak karena rate limit.

Client harus memperlakukan 429 berbeda dari 500.

```text
429 → traffic control problem
500 → downstream internal failure
408/504 → timeout problem
401 → auth/credential problem
```

Jika response membawa `Retry-After`, client perlu mempertimbangkannya.

Policy sehat:

```text
if 429 with Retry-After:
    wait according to Retry-After if within deadline and retry budget
else if 429 without Retry-After:
    backoff with jitter and reduce local rate temporarily
```

Jangan melakukan immediate retry untuk 429.

Immediate retry terhadap 429 biasanya memperburuk overload.

---

## 16. Bulkhead per Downstream

Jangan menggunakan satu global executor/bulkhead untuk semua downstream.

Buruk:

```text
all outbound HTTP calls share same thread pool and queue
```

Lebih baik:

```text
payment-api       bulkhead: 30 active, queue 20
identity-api      bulkhead: 20 active, queue 50
notification-api  bulkhead: 10 active, queue 200
audit-api         bulkhead: 5 active, queue 500
```

Tiap downstream punya karakteristik berbeda:

| Downstream | Latency | Criticality | Retry | Queue | Bulkhead |
|---|---:|---|---|---:|---:|
| Auth/identity | rendah/sedang | tinggi | hati-hati | kecil | sedang |
| Payment | sedang | sangat tinggi | idempotent only | kecil | sedang |
| Notification | tinggi/variable | rendah/sedang | boleh async | besar terbatas | kecil |
| Geocoding | variable | rendah | cache-friendly | kecil | kecil |
| Audit | sedang | tinggi | durable/outbox | queue durable | kecil |

---

## 17. Bulkhead per Traffic Class

Selain per downstream, bisa juga per traffic class.

Contoh:

```text
interactive-user-traffic
batch-job-traffic
scheduled-sync-traffic
replay/retry-traffic
admin-tool-traffic
```

Tanpa pemisahan:

```text
batch job besar
→ memenuhi connection pool
→ user request timeout
```

Dengan pemisahan:

```text
batch job hanya punya 20% kapasitas
user journey punya reserved capacity
```

Ini sangat penting untuk sistem enterprise yang memiliki UI, scheduler, event consumer, dan batch dalam aplikasi yang sama.

---

## 18. Rate Limit dan Retry Harus Terintegrasi

Retry memakai quota yang sama dengan request biasa.

Jika tidak dihitung:

```text
normal request = 300/minute
retry attempt  = tambahan 600/minute
provider limit = 300/minute
```

Akibat:

```text
retry menyebabkan 429 lebih banyak
→ lebih banyak retry
→ lebih banyak 429
```

Policy sehat:

```text
attempt harus acquire rate-limit permit
retry harus masuk retry budget
retry harus menghormati deadline
retry harus punya backoff+jitter
429 harus menurunkan aggressiveness
```

---

## 19. Timeout dan Bulkhead Harus Terintegrasi

Jika bulkhead penuh, request bisa menunggu permit.

Tapi waktu tunggu itu harus memakan budget.

Buruk:

```text
wait permit 2s
then call downstream timeout 3s
user SLA 3s
```

Lebih baik:

```text
total deadline = 3s
wait permit max 100ms
remaining deadline dikirim ke HTTP timeout
```

Pseudo-flow:

```text
start deadline 3s
→ try acquire bulkhead within 100ms
→ try acquire rate permit within remaining budget
→ execute HTTP call with remaining deadline
→ retry only if enough remaining budget
```

---

## 20. Connection Pool Bukan Bulkhead yang Cukup

Banyak engineer mengira:

```text
max connection pool = 50
berarti sudah ada bulkhead
```

Sebagian benar, tapi tidak cukup.

Connection pool limit hanya membatasi koneksi, bukan selalu membatasi:

- request queue di atasnya
- HTTP/2 streams
- async call queue
- retry attempts
- memory buffering
- downstream-specific priority
- wait time sebelum mendapatkan connection

Connection pool adalah resource control. Bulkhead adalah failure isolation policy.

Keduanya terkait, tetapi bukan hal yang sama.

---

## 21. OkHttp Dispatcher sebagai Concurrency Control

OkHttp memiliki `Dispatcher` untuk asynchronous calls.

Konsep penting:

```text
maxRequests        → maximum concurrent async requests globally
maxRequestsPerHost → maximum concurrent async requests per host
```

Jika jumlah request melebihi batas, request akan queue di memori sampai call aktif selesai.

Implikasi production:

- Dispatcher membantu mengontrol concurrency async.
- Queue tetap harus diperhatikan.
- `maxRequestsPerHost` berbasis hostname, bukan physical downstream/IP tunggal.
- Jika beberapa hostname menuju proxy/IP yang sama, limit per host tidak selalu melindungi resource fisik yang sama.
- Synchronous `execute()` tetap perlu dipikirkan bersama thread model aplikasi.

Contoh konfigurasi:

```java
Dispatcher dispatcher = new Dispatcher();
dispatcher.setMaxRequests(100);
dispatcher.setMaxRequestsPerHost(20);

OkHttpClient client = new OkHttpClient.Builder()
    .dispatcher(dispatcher)
    .build();
```

Namun jangan hanya mengandalkan ini sebagai satu-satunya policy. Tambahkan rate limiter, bulkhead, timeout, dan retry budget di boundary client adapter.

---

## 22. Retrofit dan Rate/Bulkhead

Retrofit sendiri adalah type-safe API abstraction. Karena biasanya berjalan di atas OkHttp, kontrol concurrency/network banyak berasal dari OkHttp.

Namun policy sebaiknya tidak tersebar di annotation interface.

Buruk:

```text
Controller
→ retrofit interface langsung
→ setiap pemanggil membuat retry/rate sendiri-sendiri
```

Lebih baik:

```text
Controller / Use Case
→ Domain Port
→ Client Adapter
→ Rate Limiter
→ Bulkhead
→ Retry/Timeout
→ Retrofit Interface
→ OkHttp
```

Contoh struktur:

```java
public interface AddressLookupPort {
    AddressResult lookupPostalCode(String postalCode);
}

public final class RateLimitedAddressLookupClient implements AddressLookupPort {
    private final AddressApi api;
    private final Semaphore bulkhead;
    private final RateLimiter rateLimiter;

    @Override
    public AddressResult lookupPostalCode(String postalCode) {
        // acquire bulkhead
        // acquire rate permit
        // execute retrofit call
        // classify error
        // release permit
        return null;
    }
}
```

Dengan ini, policy berada di adapter, bukan bocor ke seluruh application layer.

---

## 23. JDK HttpClient dan Concurrency Control

JDK `HttpClient` menyediakan client reusable dan async API berbasis `CompletableFuture`, tetapi tidak memberikan built-in rate limiter/bulkhead tingkat aplikasi.

Maka kamu perlu menambahkan policy sendiri:

```java
public final class GuardedJdkHttpClient {
    private final HttpClient client;
    private final Semaphore bulkhead;

    public CompletableFuture<HttpResponse<String>> sendAsync(HttpRequest request) {
        if (!bulkhead.tryAcquire()) {
            return CompletableFuture.failedFuture(
                new DownstreamBusyException("bulkhead full")
            );
        }

        return client
            .sendAsync(request, HttpResponse.BodyHandlers.ofString())
            .whenComplete((response, error) -> bulkhead.release());
    }
}
```

Untuk Java 8, `CompletableFuture.failedFuture` belum ada. Gunakan helper:

```java
public static <T> CompletableFuture<T> failedFuture(Throwable error) {
    CompletableFuture<T> future = new CompletableFuture<>();
    future.completeExceptionally(error);
    return future;
}
```

Catatan:

- Untuk async, release permit harus di `whenComplete`.
- Untuk cancellation, pastikan completion handler tetap melepas permit.
- Jangan acquire permit lalu membuat future yang tidak pernah selesai.

---

## 24. Apache HttpClient dan Pool Limit

Apache HttpClient memiliki connection manager dengan batas total dan per route.

Konsep:

```text
maxTotal      → total koneksi seluruh route
maxPerRoute   → koneksi maksimal ke route tertentu
```

Ini penting untuk high-throughput service dan integrasi enterprise.

Namun seperti sebelumnya:

```text
connection pool limit ≠ full bulkhead policy
```

Kamu tetap perlu memikirkan:

- queue ketika menunggu connection
- connection request timeout
- response timeout
- retry policy
- per-downstream isolation
- fallback/load shedding

---

## 25. Resilience4j

Resilience4j menyediakan decorator untuk pola seperti:

- Retry
- RateLimiter
- CircuitBreaker
- Bulkhead
- TimeLimiter

Modelnya cocok karena policy bisa dibungkus di sekitar call.

Pseudo-structure:

```java
Supplier<Response> supplier = () -> httpGateway.call(request);

Supplier<Response> guarded = Decorators.ofSupplier(supplier)
    .withBulkhead(bulkhead)
    .withRateLimiter(rateLimiter)
    .withRetry(retry)
    .decorate();

Response response = guarded.get();
```

Hal yang perlu diperhatikan:

- Urutan decorator penting.
- Retry di luar rate limiter bisa membuat retry tidak dihitung permit, tergantung komposisi.
- Timeout harus selaras dengan HTTP timeout.
- Bulkhead exception harus dimapping jelas.
- Metrics dari Resilience4j harus dikorelasikan dengan HTTP metrics.

### 25.1 Urutan Komposisi

Tidak ada satu urutan universal, tetapi untuk HTTP client sering masuk akal:

```text
caller
→ total deadline
→ bulkhead/concurrency admission
→ rate limiter admission
→ retry policy
→ per-attempt timeout
→ HTTP call
```

Namun jika retry harus acquire permit per attempt, rate limiter perlu berada di jalur tiap attempt, bukan hanya sekali sebelum seluruh retry loop.

Mental model:

```text
permit per logical request?
permit per physical attempt?
```

Untuk third-party quota, biasanya:

```text
permit per physical attempt
```

Karena setiap attempt mencapai provider dan memakai quota.

---

## 26. Failsafe

Failsafe adalah library fault-tolerance Java yang menyediakan policy seperti:

- Retry
- CircuitBreaker
- RateLimiter
- Timeout
- Bulkhead
- Fallback

Failsafe mendukung komposisi policy dan cocok untuk Java 8+.

Contoh konseptual:

```java
RateLimiter<Object> rateLimiter = RateLimiter.smoothBuilder(100, Duration.ofSeconds(1)).build();
Bulkhead<Object> bulkhead = Bulkhead.builder(50).build();

Response response = Failsafe
    .with(rateLimiter, bulkhead)
    .get(() -> httpGateway.call(request));
```

Catatan:

- Pastikan policy type cocok dengan synchronous/async execution.
- Jangan menyembunyikan `BulkheadFullException` sebagai generic 500.
- Observability tetap harus ditambahkan.

---

## 27. Designing Admission Control

Admission control adalah keputusan apakah request boleh masuk ke eksekusi.

Flow sehat:

```text
1. classify request
2. check deadline still valid
3. check circuit/bulkhead availability
4. check rate permit
5. check queue availability
6. execute
7. record outcome
```

Contoh decision table:

| Kondisi | Action |
|---|---|
| deadline sudah habis | reject immediately |
| low priority dan overload | shed |
| bulkhead penuh | reject / fallback |
| rate permit tidak tersedia | bounded wait / 429 / schedule later |
| retry budget habis | stop retry |
| downstream memberi Retry-After besar | defer / reject |
| cache tersedia | return stale/degraded |

---

## 28. Backpressure vs Load Shedding

Backpressure berarti caller diberi sinyal untuk memperlambat.

Load shedding berarti request ditolak/dibuang.

Dalam HTTP synchronous API, backpressure sering diekspresikan sebagai:

```text
429 Too Many Requests
503 Service Unavailable
Retry-After header
slow response / blocking wait
```

Namun blocking wait bisa berbahaya jika caller memegang thread mahal.

Untuk internal API, lebih baik eksplisit:

```text
429 + Retry-After untuk rate issue
503 untuk temporary capacity issue
problem detail body dengan error code stabil
```

Untuk message consumer, backpressure bisa berupa:

```text
pause consumption
reduce poll batch
nack with delay
move to retry topic
```

---

## 29. Adaptive Concurrency Limit

Static limit kadang tidak cukup.

Adaptive concurrency mencoba menyesuaikan limit berdasarkan sinyal runtime:

- latency naik
- error rate naik
- queue wait naik
- timeout naik
- 429 naik
- successful throughput turun

Konsep sederhana:

```text
latency sehat dan error rendah → limit boleh naik perlahan
latency naik atau timeout naik → limit turun cepat
```

Hati-hati:

- adaptive control bisa oscillate
- perlu smoothing/window
- perlu minimum dan maximum bound
- jangan gabungkan dengan retry agresif tanpa budget

Untuk banyak sistem enterprise, static limit + good metrics + manual tuning sudah cukup. Adaptive limit cocok jika traffic dan downstream capacity sangat dinamis.

---

## 30. Client-Side Cache sebagai Load Reduction

Cache bukan rate limiter, tapi bisa mengurangi call.

Cocok untuk:

- postal code lookup
- reference data
- configuration
- public key/JWKS
- feature metadata
- user profile yang tidak perlu real-time

Pattern:

```text
request
→ check cache
→ if hit return
→ if miss acquire rate/bulkhead
→ call downstream
→ store cache
```

Tambahkan:

- TTL
- negative cache untuk not found tertentu
- stale-while-revalidate
- in-flight deduplication
- cache key canonicalization

Cache harus hati-hati untuk data sensitif, tenant-specific, atau authorization-specific.

---

## 31. In-Flight Deduplication

Jika banyak request meminta resource yang sama secara bersamaan, jangan semua call downstream.

Buruk:

```text
100 request mencari postal code 123456
→ 100 outbound call
```

Lebih baik:

```text
request pertama call downstream
request lain join future yang sama
→ 1 outbound call
→ 100 caller menerima hasil
```

Pseudo Java:

```java
public final class InFlightDeduplicator<K, V> {
    private final ConcurrentHashMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();

    public CompletableFuture<V> get(K key, Supplier<CompletableFuture<V>> supplier) {
        return inFlight.computeIfAbsent(key, ignored ->
            supplier.get().whenComplete((value, error) -> inFlight.remove(key))
        );
    }
}
```

Catatan:

- Remove harus terjadi saat complete.
- Harus ada timeout agar future tidak menggantung.
- Jangan dedup request yang tidak benar-benar equivalent.
- Authorization/tenant harus masuk cache key jika relevan.

---

## 32. Distributed Rate Limiting

Untuk multi-pod service dengan shared quota, local limiter bisa tidak akurat.

Opsi:

### 32.1 Static Partition

```text
total quota 300/minute
jumlah pod 3
limit per pod 100/minute
```

Kelebihan:

- sederhana
- tidak butuh dependency runtime

Kekurangan:

- buruk saat traffic tidak merata
- perubahan jumlah pod perlu config update
- pod idle tidak bisa meminjam quota

### 32.2 Redis Token Bucket

Semua pod acquire permit dari Redis.

Kelebihan:

- quota lebih akurat
- bisa tenant-specific
- bisa dynamic

Kekurangan:

- Redis menjadi dependency di path request
- latency tambahan
- failure mode harus jelas

Pertanyaan desain:

```text
Jika Redis rate limiter down, fail-open atau fail-closed?
```

Jawabannya tergantung risiko:

- API mahal/regulated: cenderung fail-closed atau degraded.
- API low-risk internal: mungkin fail-open dengan local emergency limit.

### 32.3 Central Worker

Daripada semua pod call provider, satu worker/service mengatur dispatch.

Cocok untuk:

- batch integration
- notification delivery
- external agency API dengan strict quota
- durable queue/outbox

---

## 33. Worker Pool Pattern

Untuk API dengan quota ketat, worker pool sering lebih stabil daripada request langsung.

Flow:

```text
application request
→ enqueue command
→ worker pool drains queue at allowed rate
→ update status/result
```

Cocok untuk:

- email/SMS
- file transfer
- agency sync
- report generation
- non-immediate enrichment

Tidak cocok untuk:

- user journey yang butuh immediate response
- authentication request
- payment authorization real-time

Worker pool harus punya:

- bounded queue atau durable queue
- dead-letter handling
- retry schedule
- idempotency key
- visibility dashboard
- rate limit
- concurrency limit
- poison message handling

---

## 34. Failure Modes

### 34.1 Queue Explosion

Gejala:

```text
latency naik
memory naik
GC naik
thread dump banyak waiting
outbound request count tertunda
```

Penyebab:

- unbounded executor queue
- dispatcher queue tidak dimonitor
- downstream slow
- retry storm

Mitigasi:

- bounded queue
- fail fast
- reduce concurrency
- disable/reduce retry
- shed low priority

---

### 34.2 Retry Storm

Gejala:

```text
upstream traffic stabil
tapi outbound attempts naik tajam
429/503 naik
retry metric naik
```

Mitigasi:

- retry budget
- exponential backoff + jitter
- obey Retry-After
- circuit breaker
- rate limiter per attempt

---

### 34.3 Bulkhead Starvation

Gejala:

```text
bulkhead active penuh
queue penuh
request baru langsung gagal
latency downstream tinggi
```

Mitigasi:

- cek downstream latency
- cek per-route pool
- cek response body leak
- cek long-running request
- pisahkan priority class
- kurangi timeout agar permit cepat kembali

---

### 34.4 Connection Pool Starvation

Gejala:

```text
threads waiting for connection
connection lease time tinggi
active connections maxed
idle connection rendah
```

Mitigasi:

- pastikan response body ditutup
- tune max per route
- tune timeout connection request
- cek HTTP/2 stream limit
- cek downstream latency
- cek long-polling/download besar

---

### 34.5 NAT / Ephemeral Port Exhaustion

Gejala:

```text
connect timeout naik
connection reset naik
hanya terjadi saat traffic tinggi
banyak koneksi short-lived
```

Mitigasi:

- reuse client/pool
- enable keep-alive
- reduce connection churn
- tune pool
- avoid creating client per request
- coordinate with infra/NAT capacity

---

## 35. Observability Wajib

Untuk rate limiting/bulkhead, minimal metric:

```text
outbound_requests_total{client, endpoint, status}
outbound_attempts_total{client, endpoint, attempt}
outbound_latency_seconds{client, endpoint}
outbound_queue_wait_seconds{client}
outbound_bulkhead_active{client}
outbound_bulkhead_rejected_total{client}
outbound_rate_limit_wait_seconds{client}
outbound_rate_limit_rejected_total{client}
outbound_retry_total{client, reason}
outbound_429_total{client}
outbound_timeout_total{client, phase}
outbound_connection_acquire_seconds{client}
```

Log minimal saat reject:

```json
{
  "event": "outbound_request_rejected",
  "client": "address-api",
  "reason": "bulkhead_full",
  "priority": "P2",
  "active": 20,
  "maxActive": 20,
  "queueSize": 50,
  "correlationId": "..."
}
```

Jangan log token, API key, atau body sensitif.

---

## 36. Alert yang Berguna

Alert buruk:

```text
HTTP error > 0
```

Alert lebih baik:

```text
bulkhead rejection rate > 5% selama 5 menit
rate limiter wait p95 > 200ms
outbound 429 meningkat 3x dari baseline
connection acquire p95 > 100ms
retry attempts per logical request > 1.5
queue depth > 80% selama 3 menit
timeout rate > 2% untuk critical client
```

Alert harus mengarah ke diagnosis.

---

## 37. Policy Design Template

Untuk setiap HTTP client, dokumentasikan:

```yaml
client: address-api
purpose: Postal code lookup
auth: bearer token
criticality: medium
quota:
  provider: 300/minute
  localLimit: 250/minute
rateLimit:
  algorithm: token-bucket
  permits: 250/minute
  burst: 20
bulkhead:
  maxConcurrent: 20
  maxQueue: 50
  queueWaitTimeout: 100ms
timeout:
  totalDeadline: 1500ms
  connect: 200ms
  read: 800ms
retry:
  maxAttempts: 2
  retryOn: [429, 502, 503, 504, connect-timeout]
  backoff: exponential-with-jitter
  obeyRetryAfter: true
fallback:
  cache: stale-up-to-24h
  rejectStatus: 503
observability:
  metrics: enabled
  tracing: enabled
  logBodies: false
```

---

## 38. Code Structure yang Disarankan

Jangan menaruh semua policy di controller/service.

Struktur sehat:

```text
application/
  usecase/
    SubmitApplicationUseCase.java

domain/
  port/
    AddressLookupPort.java

infrastructure/
  http/
    address/
      AddressApi.java               # Retrofit/JDK/OkHttp low-level interface
      AddressHttpClientAdapter.java # implements domain port
      AddressClientProperties.java
      AddressClientPolicy.java
      AddressErrorMapper.java
      AddressMetrics.java
      AddressClientConfig.java
```

Boundary:

```text
UseCase tidak tahu Retrofit/OkHttp/429/Retry-After.
Adapter tahu HTTP semantics.
Domain port tahu business result.
```

---

## 39. Example: Production-Grade Guard Flow

```java
public AddressResult lookup(String postalCode, RequestContext context) {
    Deadline deadline = context.deadline();

    if (deadline.isExpired()) {
        throw new ClientRejectedException("deadline_expired_before_call");
    }

    if (!bulkhead.tryAcquire(Duration.ofMillis(100))) {
        metrics.bulkheadRejected("address-api");
        return fallbackOrReject(postalCode, "bulkhead_full");
    }

    try {
        if (!rateLimiter.tryAcquire(deadline.remaining())) {
            metrics.rateLimitRejected("address-api");
            return fallbackOrReject(postalCode, "rate_limited_locally");
        }

        return retryPolicy.execute(() -> {
            Duration remaining = deadline.remaining();
            if (remaining.isNegative() || remaining.isZero()) {
                throw new DeadlineExceededException();
            }

            HttpResponse response = httpClient.call(postalCode, remaining);
            return mapper.toAddressResult(response);
        });
    } finally {
        bulkhead.release();
    }
}
```

Yang penting bukan syntax-nya, tetapi invariant-nya:

```text
permit selalu dilepas
rate permit dihitung sebelum attempt
deadline selalu dicek
fallback eksplisit
reject punya reason
metric selalu dicatat
```

---

## 40. Checklist Design Review

Untuk setiap HTTP client, tanyakan:

1. Apakah client punya rate limit lokal?
2. Apakah limit sesuai quota downstream?
3. Apakah multi-instance deployment diperhitungkan?
4. Apakah retry attempt ikut dihitung dalam rate limit?
5. Apakah ada concurrency limit?
6. Apakah concurrency limit per downstream atau global saja?
7. Apakah queue bounded?
8. Apakah queue wait timeout ada?
9. Apakah request expired bisa dibuang sebelum dikirim?
10. Apakah low-priority traffic bisa dished?
11. Apakah batch traffic terpisah dari user traffic?
12. Apakah `429 Retry-After` dihormati?
13. Apakah bulkhead rejection observable?
14. Apakah rate limiter wait time observable?
15. Apakah connection pool wait time observable?
16. Apakah response body selalu ditutup?
17. Apakah timeout lebih kecil dari caller SLA?
18. Apakah retry budget dibatasi?
19. Apakah fallback aman secara domain?
20. Apakah runbook menjelaskan apa yang harus dilakukan saat limiter/bulkhead aktif?

---

## 41. Common Anti-Patterns

### 41.1 Membuat Client Baru per Request

```java
OkHttpClient client = new OkHttpClient(); // di dalam method request
```

Dampak:

- pool tidak efektif
- connection churn
- TLS handshake berulang
- port exhaustion risk

---

### 41.2 Retry Tanpa Rate Limit

```text
429 diterima
→ immediate retry
→ 429 lagi
→ retry lagi
```

Ini seperti mengetuk pintu lebih keras saat diminta menunggu.

---

### 41.3 Queue Besar untuk Menyembunyikan Slowness

```text
queue 100.000
```

Ini bukan resilience. Ini delay sebelum collapse.

---

### 41.4 Satu Thread Pool untuk Semua Downstream

```text
legacy-api lambat
→ semua outbound call ikut stuck
```

Gunakan bulkhead per downstream/traffic class.

---

### 41.5 Menganggap Virtual Threads Menghapus Semua Limit

Virtual threads mengurangi biaya blocking thread, tetapi tidak membuat downstream, socket, memory, database, atau quota menjadi tak terbatas.

---

### 41.6 Menganggap Connection Pool Limit Sama dengan Rate Limit

Pool limit membatasi koneksi. Rate limit membatasi kecepatan request. Keduanya berbeda.

---

### 41.7 Tidak Membedakan Rejection Reason

Buruk:

```text
throw RuntimeException("failed")
```

Baik:

```text
DownstreamRateLimitedException
DownstreamBulkheadFullException
DownstreamTimeoutException
DownstreamAuthException
DownstreamProtocolException
```

Reason yang jelas mempercepat incident response.

---

## 42. Tuning Approach

Jangan memilih angka limit secara asal.

Langkah:

### 42.1 Pahami Constraint

```text
provider quota
SLA caller
latency downstream normal/p95/p99
jumlah instance
connection pool size
thread model
business priority
retry policy
```

### 42.2 Hitung Awal

Misal:

```text
quota provider = 300/minute
instance = 3
safety margin = 80%
```

Static per pod:

```text
300 × 0.8 / 3 = 80/minute per pod
```

Jika p95 latency 500 ms dan target 80/minute:

```text
80/minute = 1.33 rps
concurrency ≈ 1.33 × 0.5 = 0.67
```

Maka concurrency 5 mungkin sudah cukup untuk normal, tetapi perlu burst dan tail latency. Jangan langsung set 100.

### 42.3 Load Test

Uji:

- normal latency
- latency spike
- 429 burst
- 503 burst
- slow response
- connection timeout
- queue full
- pod scale up/down

### 42.4 Observe dan Iterate

Tuning berdasarkan:

- p95/p99 latency
- limiter wait time
- rejection rate
- success throughput
- downstream error
- pool wait
- retry amplification

---

## 43. Production Runbook Singkat

### Symptom: Banyak 429

Cek:

```text
rate per client/pod
total pod count
retry attempts
Retry-After handling
provider quota change
batch job overlap
```

Action:

```text
reduce local rate
pause batch
increase backoff
disable aggressive retry
coordinate provider quota
```

### Symptom: Bulkhead Full

Cek:

```text
latency downstream
active request duration
timeout config
long download/upload
response body leak
connection pool wait
```

Action:

```text
shed low priority
reduce timeout
separate traffic class
increase capacity carefully
open circuit if downstream unhealthy
```

### Symptom: Queue Wait Tinggi

Cek:

```text
queue depth
arrival rate
worker throughput
downstream latency
retry volume
```

Action:

```text
lower queue limit
fail fast
pause producer
scale worker if downstream supports
reduce retry
```

---

## 44. Hubungan dengan Part Sebelumnya

Bagian ini memakai fondasi dari:

```text
Part 6  → timeout budget
Part 7  → connection pooling/resource reuse
Part 8  → network topology/NAT/proxy/LB
Part 10 → auth/token refresh
Part 11 → retry/idempotency/backoff
```

Rate limit dan bulkhead tidak bisa berdiri sendiri. Mereka harus membaca sinyal dari lifecycle request, timeout, retry, connection pool, dan downstream response.

---

## 45. Intisari Top 1% Engineer

Engineer biasa membuat HTTP client yang bisa mengirim request.

Engineer kuat membuat HTTP client yang bisa bertahan saat downstream gagal.

Engineer top-tier membuat HTTP client yang:

```text
membatasi beban sebelum overload
mengisolasi failure domain
menghormati quota downstream
mencegah retry amplification
menjaga latency budget
menolak request secara sadar saat perlu
memberi sinyal observability yang jelas
punya fallback yang aman secara domain
punya runbook yang bisa dipakai saat incident
```

Ingat invariant utama:

```text
Setiap outbound HTTP client harus punya:
- timeout budget
- retry budget
- concurrency limit
- rate policy jika downstream punya quota/kapasitas terbatas
- bounded queue atau no queue
- clear rejection semantics
- metrics untuk wait, reject, retry, latency, dan error
```

Kalau salah satu hilang, client belum production-grade.

---

## 46. Ringkasan

Pada Part 12, kita belajar bahwa HTTP client harus menjadi traffic governor.

Kita membahas:

- rate limit
- throttling
- concurrency limit
- bulkhead
- queue limit
- load shedding
- token bucket
- leaky bucket
- semaphore bulkhead
- thread pool bulkhead
- virtual threads implication
- 429 handling
- per-downstream isolation
- per-traffic-class isolation
- retry integration
- timeout integration
- OkHttp Dispatcher
- Retrofit boundary
- JDK HttpClient wrapper
- Apache pool relation
- Resilience4j
- Failsafe
- distributed limiter
- worker pool
- failure modes
- observability
- design checklist
- production runbook

Part berikutnya akan membahas komposisi lebih lanjut antara:

```text
Circuit Breaker
→ Timeout
→ Retry
→ Fallback
```

dan bagaimana urutan komposisi yang salah bisa membuat sistem terlihat “resilient” di kode tetapi tetap rapuh di production.

---

## 47. Status Series

Selesai:

```text
Part 0  — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
Part 1  — Java HTTP Client Landscape di Java 8–25
Part 2  — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body
Part 3  — URI, URL, Encoding, Query Parameter, dan Canonical Request
Part 4  — Headers, Content Negotiation, Compression, dan Metadata Contract
Part 5  — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download
Part 6  — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS
Part 7  — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse
Part 8  — DNS, Proxy, Load Balancer, NAT, dan Network Topology Awareness
Part 9  — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning
Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh
Part 11 — Retry Engineering: Idempotency, Backoff, Jitter, Retry Budget, dan Hedging
Part 12 — Rate Limiting, Throttling, Bulkhead, dan Client-Side Load Shedding
```

Belum selesai. Part berikutnya:

```text
Part 13 — Circuit Breaker, Timeout, Retry, dan Fallback Composition
File: 13-circuit-breaker-timeout-retry-fallback-composition.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./11-retry-engineering-idempotency-backoff-jitter-budget-hedging.md">⬅️ Part 11 — Retry Engineering: Idempotency, Backoff, Jitter, Retry Budget, dan Hedging</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./13-circuit-breaker-timeout-retry-fallback-composition.md">Part 13 — Circuit Breaker, Timeout, Retry, dan Fallback Composition ➡️</a>
</div>

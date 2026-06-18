# Part 11 — Retry Engineering: Idempotency, Backoff, Jitter, Retry Budget, dan Hedging

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `11-retry-engineering-idempotency-backoff-jitter-budget-hedging.md`  
> Target: Java 8 hingga Java 25  
> Fokus: mendesain retry HTTP client sebagai mekanisme reliability yang aman, terukur, tidak memperparah incident, dan tidak menimbulkan duplikasi efek samping.

---

## 1. Tujuan Part Ini

Setelah bagian sebelumnya membahas request lifecycle, timeout, pooling, topology, TLS, dan authentication, sekarang kita masuk ke salah satu mekanisme yang paling sering disalahpahami: **retry**.

Banyak engineer memandang retry seperti ini:

```text
request gagal → coba lagi → kemungkinan berhasil
```

Mental model itu terlalu dangkal dan berbahaya. Dalam sistem production, retry harus dilihat seperti ini:

```text
retry = membuat request tambahan
      = menambah load
      = memperpanjang waktu hidup operasi
      = dapat menggandakan side effect
      = dapat mengubah failure kecil menjadi cascading failure
      = hanya aman jika dibatasi oleh idempotency, deadline, backoff, jitter, budget, dan observability
```

Tujuan part ini:

1. Memahami retry sebagai **control loop**, bukan sekadar loop `for`.
2. Membedakan error yang aman untuk di-retry dan yang tidak.
3. Memahami idempotency sebagai fondasi retry untuk operasi mutasi.
4. Mendesain backoff dan jitter agar retry tidak menjadi thundering herd.
5. Menggunakan retry budget agar retry tidak menghabiskan kapasitas sistem.
6. Memahami hedging sebagai teknik tail-latency reduction yang lebih berisiko daripada retry biasa.
7. Menerapkan pola retry di JDK HttpClient, OkHttp, Retrofit, Apache HttpClient, Resilience4j, dan Failsafe.
8. Membuat decision framework untuk production-grade HTTP client.

---

## 2. Prinsip Utama: Retry Bukan Reliability Gratis

Retry bisa meningkatkan keberhasilan jika failure bersifat **transient**:

- temporary network blip
- stale pooled connection
- connection reset
- DNS record sementara gagal
- downstream overloaded sesaat
- rate limit sementara
- leader election / rolling deployment
- load balancer draining
- TLS session atau route transient issue

Namun retry juga bisa memperburuk kondisi jika failure bersifat **persistent** atau **capacity-related**:

- downstream sedang overload
- database downstream saturated
- API quota habis
- credential invalid
- request payload invalid
- endpoint salah
- schema tidak cocok
- resource memang tidak ada
- user tidak authorized
- service dependency sedang total outage

Retry yang tidak terkontrol menciptakan efek berikut:

```text
original traffic = 1,000 rps
retry 1x pada 50% failure = +500 rps
retry 2x pada 50% failure = +750 rps tambahan teoretis
retry tanpa jitter = spike sinkron
retry tanpa deadline = thread menunggu terlalu lama
retry tanpa idempotency = duplicate side effect
```

Jadi aturan dasarnya:

> Retry hanya boleh dilakukan jika peluang berhasil lebih besar daripada risiko load tambahan, latency tambahan, dan side effect tambahan.

---

## 3. Retry sebagai Control Loop

Retry bukan sekadar alur linear. Ia adalah control loop:

```text
attempt request
    ↓
observe result
    ↓
classify failure
    ↓
decide retryable or not
    ↓
check remaining deadline/budget
    ↓
compute delay
    ↓
wait with cancellation support
    ↓
next attempt
```

Control loop yang baik punya komponen berikut:

| Komponen | Fungsi |
|---|---|
| Attempt limit | Membatasi jumlah percobaan |
| Deadline | Membatasi total waktu operasi |
| Failure classifier | Menentukan error retryable/tidak |
| Idempotency policy | Menentukan aman/tidaknya retry side-effecting request |
| Backoff | Meningkatkan jarak antar retry |
| Jitter | Mengacak delay agar tidak sinkron |
| Retry budget | Membatasi total retry traffic |
| Rate-limit awareness | Menghormati `Retry-After` atau quota |
| Cancellation | Menghentikan retry saat caller sudah tidak membutuhkan hasil |
| Observability | Melihat apakah retry membantu atau merusak |

Tanpa komponen ini, retry hanyalah hazard.

---

## 4. Failure Taxonomy untuk Retry

Sebelum menentukan retry policy, kita harus mengklasifikasikan failure.

### 4.1 Transport Failure

Transport failure terjadi sebelum response HTTP valid diterima.

Contoh:

- DNS resolution failed
- TCP connect timeout
- connection refused
- connection reset
- socket closed
- TLS handshake failed
- read timeout
- write timeout
- premature EOF

Tidak semua transport failure retryable.

| Failure | Umumnya retryable? | Catatan |
|---|---:|---|
| DNS temporary failure | Ya, terbatas | Jangan agresif; bisa persistent misconfig |
| Connect timeout | Ya, terbatas | Bisa route/downstream overload |
| Connection refused | Kadang | Bisa deployment rolling, bisa service down |
| Connection reset sebelum request terkirim | Ya | Biasanya aman |
| Connection reset setelah body terkirim | Berbahaya | Server mungkin sudah memproses |
| Read timeout | Kadang | Response mungkin lambat; mutasi mungkin sudah terjadi |
| TLS cert invalid | Tidak | Biasanya config/security issue |
| Hostname verification failure | Tidak | Jangan retry |
| Auth proxy failure | Tidak, kecuali refresh credential | Perlu auth path, bukan retry biasa |

### 4.2 HTTP Status Failure

Response HTTP valid diterima, tetapi status menunjukkan failure.

| Status | Retry? | Reasoning |
|---|---:|---|
| 400 Bad Request | Tidak | Request invalid |
| 401 Unauthorized | Bukan retry biasa | Refresh token lalu retry sekali jika aman |
| 403 Forbidden | Tidak | Permission issue |
| 404 Not Found | Biasanya tidak | Kecuali eventual consistency/read-after-write |
| 408 Request Timeout | Ya, terbatas | Server timeout membaca request |
| 409 Conflict | Domain-specific | Bisa retry untuk optimistic locking dengan re-read |
| 412 Precondition Failed | Tidak otomatis | Conditional update failed |
| 423 Locked | Domain-specific | Bisa backoff jika lock sementara |
| 425 Too Early | Ya dengan syarat | Hindari replay unsafe request |
| 429 Too Many Requests | Ya, jika menghormati `Retry-After`/quota | Harus throttle, bukan spam |
| 500 Internal Server Error | Ya, terbatas | Jika transient |
| 501 Not Implemented | Tidak | Capability mismatch |
| 502 Bad Gateway | Ya | Gateway/upstream transient |
| 503 Service Unavailable | Ya, hormati `Retry-After` | Downstream unavailable/overloaded |
| 504 Gateway Timeout | Ya, hati-hati | Upstream mungkin masih memproses |

### 4.3 Protocol Failure

Contoh:

- malformed HTTP response
- invalid header
- unexpected content type
- corrupted compressed body
- invalid JSON/XML
- schema mismatch

Retryability-nya tergantung sumber masalah.

```text
Jika response rusak karena network/proxy transient → mungkin retryable.
Jika response selalu invalid karena contract mismatch → tidak retryable.
```

### 4.4 Domain Failure

Contoh:

- insufficient balance
- invalid state transition
- duplicate application
- case already closed
- validation failed
- license expired

Domain failure **hampir selalu tidak boleh diretry secara buta**.

Retry domain hanya masuk akal jika domain failure memang merepresentasikan kondisi sementara, misalnya:

- resource locked
- approval engine busy
- eventual consistency belum settle
- downstream batch belum selesai
- asynchronous job masih processing

---

## 5. Idempotency: Fondasi Retry yang Aman

Retry aman hanya jika operasi aman untuk diulang, atau jika sistem menyediakan mekanisme deduplikasi.

### 5.1 Safe, Idempotent, Non-Idempotent

Dalam HTTP, method punya semantic intent, tetapi implementasi server tetap bisa salah. Secara desain umum:

| Method | Safe? | Idempotent? | Retry default? |
|---|---:|---:|---:|
| GET | Ya | Ya | Biasanya ya |
| HEAD | Ya | Ya | Biasanya ya |
| OPTIONS | Ya | Ya | Biasanya ya |
| TRACE | Ya secara spesifikasi, jarang dipakai | Ya | Umumnya tidak relevan |
| PUT | Tidak safe | Ya secara intent | Ya jika server benar-benar idempotent |
| DELETE | Tidak safe | Ya secara intent | Hati-hati |
| POST | Tidak | Tidak | Tidak, kecuali ada idempotency key/dedupe |
| PATCH | Tidak | Tidak secara default | Tidak, kecuali domain menjamin |

**Safe** berarti tidak dimaksudkan mengubah state.  
**Idempotent** berarti diulang beberapa kali menghasilkan efek akhir yang sama.

Contoh idempotent:

```http
PUT /users/123/email
Content-Type: application/json

{"email":"a@example.com"}
```

Jika dipanggil 1 kali atau 3 kali, efek akhirnya tetap email yang sama.

Contoh non-idempotent:

```http
POST /payments
Content-Type: application/json

{"amount":100000,"currency":"IDR"}
```

Jika dipanggil 3 kali, bisa membuat 3 pembayaran.

### 5.2 Idempotency Key

Untuk operasi mutasi seperti payment/order/submission/case creation, client dan server dapat menggunakan idempotency key:

```http
POST /payments
Idempotency-Key: 7f7ef5c4-f31a-4bb8-80c3-15e9c1dd6a1e
Content-Type: application/json

{"amount":100000,"currency":"IDR"}
```

Server menyimpan hasil pertama untuk key tersebut. Jika request yang sama dikirim ulang, server mengembalikan hasil yang sama, bukan membuat efek baru.

Mental model:

```text
idempotency key = client-generated operation identity
not request identity
not trace id
not random per attempt
```

Salah:

```text
attempt 1: Idempotency-Key = A
attempt 2: Idempotency-Key = B
```

Benar:

```text
operation: submit application X
attempt 1: Idempotency-Key = OP-123
attempt 2: Idempotency-Key = OP-123
attempt 3: Idempotency-Key = OP-123
```

### 5.3 Idempotency Key Scope

Key harus punya scope yang jelas:

- per tenant
- per user
- per endpoint
- per operation type
- per business operation
- per payload hash

Contoh robust server-side dedupe key:

```text
tenant_id + endpoint + idempotency_key
```

Lebih kuat:

```text
tenant_id + endpoint + idempotency_key + payload_hash
```

Jika key sama tetapi payload berbeda, server harus menolak dengan conflict, bukan memproses ulang.

### 5.4 Idempotency untuk Regulatory / Case Management System

Dalam sistem case management/regulatory, operasi berikut sangat sensitif:

- create case
- submit application
- approve/reject decision
- issue notice
- send email/SMS
- create payment instruction
- assign officer
- escalate enforcement stage
- generate legal document

Retry tanpa idempotency dapat menyebabkan:

- duplicate case
- duplicate notice
- duplicate payment
- duplicate audit trail
- duplicate email
- state transition ganda
- SLA timeline rusak
- defensibility problem

Untuk sistem seperti ini, pola aman:

```text
external command request
→ generate operation id
→ persist command intent/outbox
→ send HTTP request with idempotency key
→ downstream dedupes
→ caller stores response correlation
→ retry uses same operation id
```

---

## 6. Retryable Status Code: Jangan Hafal, Pahami Semantik

### 6.1 408 Request Timeout

`408` berarti server timeout menunggu request dari client. Ini sering retryable, tetapi hati-hati untuk body besar atau mutasi.

Policy:

```text
GET/HEAD/OPTIONS → retry terbatas
PUT/DELETE → retry jika idempotent
POST/PATCH → retry hanya dengan idempotency key
```

### 6.2 429 Too Many Requests

`429` berarti client melebihi limit. Retry boleh dilakukan jika client menghormati sinyal server.

Jika ada:

```http
Retry-After: 30
```

client seharusnya menunggu minimal 30 detik, bukan memakai delay sendiri yang lebih pendek.

Jika tidak ada `Retry-After`, gunakan backoff lebih konservatif dan idealnya local throttle.

Salah:

```text
429 → retry immediately 3x
```

Benar:

```text
429 → parse Retry-After
    → reduce local rate/concurrency
    → retry after delay if deadline masih cukup
```

### 6.3 500 Internal Server Error

`500` bisa transient, bisa persistent bug. Retry terbatas dapat membantu, tetapi harus ada budget.

Policy umum:

```text
retry 1-2 kali untuk idempotent request
pakai exponential backoff + jitter
jangan retry jika error body menunjukkan permanent domain issue
```

### 6.4 502 Bad Gateway

`502` sering berasal dari proxy/gateway yang gagal mendapat response valid dari upstream. Biasanya retryable untuk request idempotent.

### 6.5 503 Service Unavailable

`503` sering menunjukkan service overload, maintenance, atau unavailable. Jika ada `Retry-After`, hormati.

### 6.6 504 Gateway Timeout

`504` berarti gateway timeout menunggu upstream. Ini tricky.

Untuk read-only request, retry sering aman. Untuk mutasi, upstream mungkin tetap memproses request walaupun gateway timeout.

```text
POST /submit-case
→ gateway timeout
→ upstream mungkin sudah membuat case
→ retry tanpa idempotency key dapat membuat duplicate case
```

---

## 7. Backoff: Memberi Waktu Sistem Pulih

Retry immediate sering salah.

```text
attempt 1 fails at t=0ms
attempt 2 immediately at t=1ms
attempt 3 immediately at t=2ms
```

Jika failure disebabkan overload, immediate retry memperparah overload.

### 7.1 Fixed Delay

```text
retry every 500ms
```

Sederhana, tetapi jika banyak client melakukan hal yang sama, retry tetap sinkron.

### 7.2 Linear Backoff

```text
attempt 1 delay = 200ms
attempt 2 delay = 400ms
attempt 3 delay = 600ms
```

Lebih baik daripada fixed, tetapi sering kurang agresif menurunkan tekanan.

### 7.3 Exponential Backoff

```text
base = 100ms
attempt 1 delay = 100ms
attempt 2 delay = 200ms
attempt 3 delay = 400ms
attempt 4 delay = 800ms
```

Formula:

```text
delay = min(maxDelay, baseDelay * multiplier^(attempt - 1))
```

Contoh:

```text
baseDelay = 100ms
multiplier = 2
maxDelay = 2s

attempt 1: 100ms
attempt 2: 200ms
attempt 3: 400ms
attempt 4: 800ms
attempt 5: 1600ms
attempt 6: 2000ms capped
```

### 7.4 Cap

Tanpa cap, exponential delay bisa terlalu besar.

```text
100ms → 200ms → 400ms → 800ms → 1.6s → 3.2s → 6.4s → 12.8s
```

Dalam request-response API, delay 12.8s sering sudah melewati user/caller deadline.

Gunakan cap:

```text
maxDelay = 2s atau 5s sesuai SLA
```

---

## 8. Jitter: Mencegah Retry Storm Sinkron

Backoff tanpa jitter masih bisa sinkron jika banyak client gagal pada waktu yang sama.

Contoh incident:

```text
10,000 clients receive 503 at t=0
all retry after 1s
all retry after 2s
all retry after 4s
```

Ini menciptakan wave traffic.

Jitter mengacak delay.

### 8.1 No Jitter

```text
delay = exponentialDelay
```

Masalah: sinkron.

### 8.2 Full Jitter

```text
delay = random(0, exponentialDelay)
```

Contoh:

```text
computed = 800ms
actual delay = random antara 0..800ms
```

Bagus untuk menyebar traffic.

### 8.3 Equal Jitter

```text
delay = exponentialDelay / 2 + random(0, exponentialDelay / 2)
```

Contoh:

```text
computed = 800ms
actual delay = 400ms + random(0..400ms)
```

Lebih menjaga minimum delay.

### 8.4 Decorrelated Jitter

```text
delay = min(maxDelay, random(baseDelay, previousDelay * 3))
```

Bagus untuk menghindari pola terlalu reguler.

### 8.5 Practical Default

Untuk kebanyakan HTTP client:

```text
maxAttempts = 2 atau 3 total attempts
baseDelay = 100ms - 300ms
multiplier = 2
maxDelay = 1s - 2s untuk low-latency internal API
maxDelay = 5s - 30s untuk batch/third-party API
jitter = full jitter atau equal jitter
respect Retry-After untuk 429/503
```

---

## 9. Retry Budget

Retry budget membatasi proporsi retry terhadap traffic normal.

Tanpa budget:

```text
normal request: unlimited
retry request: unlimited
```

Saat downstream failure, retry bisa mengambil semua kapasitas.

Dengan budget:

```text
retry traffic <= 10% dari successful/original traffic window
```

Contoh:

```text
original calls in 1 minute = 10,000
retry budget = 20%
max retry calls = 2,000
```

Jika retry budget habis:

```text
fail fast
return controlled error
open circuit / degrade
```

### 9.1 Mengapa Retry Budget Penting

Retry budget mencegah:

- retry storm
- cascading failure
- queue buildup
- pool starvation
- CPU waste
- log explosion
- quota burn
- downstream self-DDoS

### 9.2 Budget Per Apa?

Budget bisa diterapkan per:

- client name
- downstream service
- endpoint
- tenant
- operation type
- status category
- cluster/node

Untuk API eksternal multi-tenant, per-tenant retry budget penting agar satu tenant buruk tidak menghabiskan kapasitas tenant lain.

### 9.3 Retry Budget dan Circuit Breaker

Retry budget dan circuit breaker saling melengkapi:

```text
retry budget = membatasi extra attempt
circuit breaker = menghentikan panggilan saat downstream tampak unhealthy
```

Retry budget habis bukan selalu berarti circuit breaker open, tetapi sering menjadi sinyal kuat.

---

## 10. Deadline-Aware Retry

Retry harus tunduk pada total deadline.

Salah:

```text
call timeout = 2s per attempt
max attempts = 3
actual worst case = 6s + delay
caller SLA = 2s
```

Benar:

```text
total deadline = 2s
attempt 1 budget = 700ms
retry delay = 100ms
attempt 2 budget = 600ms
remaining = 600ms
attempt 3 hanya jika remaining cukup
```

### 10.1 Timeout vs Deadline

Timeout sering relatif per operasi:

```text
connect timeout = 300ms
read timeout = 1s
```

Deadline adalah batas absolut:

```text
operation must finish before t = now + 2s
```

Retry production-grade harus menghitung:

```text
remaining = deadline - now
if remaining <= minimumUsefulAttemptTime:
    do not retry
```

### 10.2 Minimum Useful Attempt Time

Jangan retry jika sisa waktu terlalu kecil untuk berhasil.

Contoh:

```text
remaining deadline = 40ms
connect timeout normal = 200ms
network RTT p95 = 80ms
```

Retry hampir pasti gagal dan hanya menambah load.

Policy:

```text
if remaining < minAttemptBudget:
    fail fast
```

---

## 11. Retry dan Timeout Ordering

Urutan komposisi penting.

### 11.1 Timeout Per Attempt di Dalam Retry

```text
Retry(
  AttemptTimeout(500ms)
)
```

Artinya setiap attempt punya timeout 500ms. Total bisa lebih dari 500ms.

### 11.2 Total Timeout di Luar Retry

```text
TotalTimeout(2s,
  Retry(
    AttemptTimeout(500ms)
  )
)
```

Ini lebih aman karena total operasi dibatasi.

### 11.3 Retry di Luar Timeout yang Salah

```text
Retry(
  TotalTimeout(2s)
)
```

Bisa berarti setiap retry mendapat total timeout baru, membuat operasi jauh lebih lama.

Prinsip:

```text
outermost: total deadline / cancellation
middle: retry / circuit / rate limit
inner: per-attempt timeout + actual HTTP call
```

Tetapi urutan dengan circuit breaker dan bulkhead perlu dipikirkan khusus, akan dibahas lebih dalam di Part 13.

---

## 12. Retry dan Authentication

Retry untuk authentication punya aturan khusus.

### 12.1 401 Karena Token Expired

Alur aman:

```text
request with token
→ 401
→ refresh token once using single-flight
→ retry original request once if safe
→ if still 401, fail auth
```

Jangan:

```text
401 → retry 3x with same expired token
```

### 12.2 Single-Flight Refresh

Jika 100 thread mendapat 401 bersamaan:

Salah:

```text
100 refresh token calls
```

Benar:

```text
1 refresh token call
99 wait for result
all retry with new token
```

### 12.3 403 Forbidden

Biasanya bukan retryable.

```text
403 = token valid, permission tidak cukup
```

Retry tidak memperbaiki permission.

---

## 13. Retry dan Rate Limiting

### 13.1 429 Harus Mengubah Perilaku Client

`429` bukan sekadar failure; itu feedback control.

Client harus melakukan salah satu atau lebih:

- menunggu `Retry-After`
- menurunkan rate
- menurunkan concurrency
- menghentikan retry sementara
- mengaktifkan local queue dengan batas
- fail fast untuk request non-kritis

### 13.2 Retry-After Parsing

`Retry-After` bisa berupa:

```http
Retry-After: 120
```

atau HTTP-date:

```http
Retry-After: Wed, 21 Oct 2015 07:28:00 GMT
```

Client production-grade harus mampu:

- parse delta seconds
- parse HTTP-date
- cap delay sesuai max policy
- reject negative/invalid value
- menambahkan jitter kecil jika banyak instance

### 13.3 Rate Limit Header Vendor-Specific

Banyak API memakai header seperti:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1710000000
```

atau:

```http
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 30
```

Client adapter harus menerjemahkan header ini menjadi local throttling policy, bukan hanya log.

---

## 14. Hedging: Bukan Retry Biasa

Hedging adalah mengirim request kedua sebelum request pertama gagal, untuk mengurangi tail latency.

Contoh:

```text
attempt 1 at t=0ms
if no response by p95 latency, send hedge attempt 2 at t=200ms
whichever returns first wins
cancel the other if possible
```

Tujuan: mengurangi P99 latency ketika beberapa request lambat karena outlier.

### 14.1 Hedging vs Retry

| Aspek | Retry | Hedging |
|---|---|---|
| Kapan attempt tambahan dikirim | Setelah gagal | Sebelum gagal, saat lambat |
| Target | Failure recovery | Tail latency reduction |
| Risiko load | Sedang | Tinggi |
| Risiko duplikasi | Ada | Lebih tinggi |
| Cocok untuk | transient failure | read-only latency-sensitive request |

### 14.2 Kapan Hedging Masuk Akal

Hedging cocok jika:

- request read-only
- operation idempotent
- downstream punya cukup kapasitas
- tail latency disebabkan outlier, bukan overload
- ada cancellation support
- ada hedge budget
- hanya hedge setelah latency threshold, bukan langsung

Contoh kandidat:

- read profile cache
- read reference data
- search replica
- call replicated service
- query service yang punya beberapa endpoint setara

### 14.3 Kapan Hedging Berbahaya

Hedging berbahaya jika:

- downstream overload
- request mutasi
- API punya quota ketat
- request mahal
- downstream tidak support cancellation
- setiap hedge tetap mengeksekusi query berat
- tidak ada observability per hedge attempt

Salah:

```text
POST /payments
hedge after 200ms
```

Benar:

```text
GET /reference-data/license-types
hedge after p95 latency
max one hedge
hedge budget 5%
```

### 14.4 Hedging Budget

Hedging harus punya budget lebih ketat daripada retry.

Contoh:

```text
hedged requests <= 2% dari total request
hanya untuk endpoint read-only critical
hanya jika recent error rate rendah
hanya jika downstream saturation rendah
```

---

## 15. Library Behavior: Jangan Asumsikan Semua Client Sama

### 15.1 JDK HttpClient

JDK `HttpClient` tidak memberi retry policy application-level kaya Resilience4j/Failsafe. Biasanya retry dibangun di wrapper.

Contoh wrapper konseptual:

```java
public final class RetryingHttpClient {
    private final HttpClient client;
    private final RetryPolicy retryPolicy;

    public RetryingHttpClient(HttpClient client, RetryPolicy retryPolicy) {
        this.client = client;
        this.retryPolicy = retryPolicy;
    }

    public HttpResponse<String> send(HttpRequest request) throws IOException, InterruptedException {
        int attempt = 1;
        long deadlineNanos = System.nanoTime() + retryPolicy.totalTimeout().toNanos();
        Throwable lastFailure = null;

        while (true) {
            try {
                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                if (!retryPolicy.shouldRetryStatus(request.method(), response.statusCode())) {
                    return response;
                }

                if (!retryPolicy.canRetryRequest(request, attempt, deadlineNanos)) {
                    return response;
                }
            } catch (IOException ex) {
                lastFailure = ex;
                if (!retryPolicy.shouldRetryException(request.method(), ex)
                        || !retryPolicy.canRetryRequest(request, attempt, deadlineNanos)) {
                    throw ex;
                }
            }

            Duration delay = retryPolicy.nextDelay(attempt);
            if (!retryPolicy.hasEnoughTime(deadlineNanos, delay)) {
                if (lastFailure instanceof IOException io) {
                    throw io;
                }
                throw new IOException("Retry deadline exceeded");
            }

            Thread.sleep(delay.toMillis());
            attempt++;
        }
    }
}
```

Catatan:

- Ini contoh mental model, bukan final implementation.
- Untuk Java 8, tidak ada JDK `HttpClient`; gunakan OkHttp/Apache/custom.
- Untuk Java 21+, blocking sleep di virtual thread lebih murah, tetapi tetap harus bounded.

### 15.2 OkHttp

OkHttp memiliki built-in recovery untuk beberapa connectivity problem. `retryOnConnectionFailure` mengatur apakah client mencoba recover dari masalah konektivitas tertentu. Namun ini bukan pengganti application-level retry.

Built-in recovery berbeda dengan:

- retry status `500`
- retry `429` dengan `Retry-After`
- retry token refresh setelah `401`
- retry idempotent command dengan idempotency key
- retry domain-aware

Application-level retry biasanya dibuat dengan:

- interceptor
- wrapper `Call.Factory`
- service gateway layer
- Resilience4j/Failsafe decorator

Hati-hati: retry di interceptor harus memperhatikan body repeatability.

### 15.3 Retrofit

Retrofit sendiri adalah type-safe API declaration layer. Retry biasanya diletakkan di bawahnya melalui OkHttp atau di atasnya melalui service wrapper.

Contoh arsitektur:

```text
Domain Service
    ↓
ExternalApiGateway
    ↓
Retrofit Interface
    ↓
OkHttpClient with interceptors/events
```

Tempat retry yang lebih baik:

```text
ExternalApiGateway / resilience wrapper
```

Alasannya:

- punya domain context
- tahu operasi mutasi/read-only
- tahu idempotency key
- tahu error model
- bisa map error body
- bisa observability dengan operation name

### 15.4 Apache HttpClient 5

Apache HttpClient 5 punya mekanisme retry dan execution chain yang lebih extensible, tetapi tetap perlu policy domain-aware.

Gunakan dengan hati-hati:

- jangan retry non-repeatable entity
- bedakan connection request timeout vs response timeout
- gunakan route-level pool limit
- observability tetap dibungkus di adapter

### 15.5 Resilience4j

Resilience4j menyediakan `Retry` sebagai decorator. Cocok untuk:

- retry berdasarkan exception
- retry berdasarkan result predicate
- interval function
- event publishing
- integrasi circuit breaker/rate limiter/bulkhead

Tetapi Resilience4j tidak otomatis tahu apakah HTTP `POST` aman diretry. Itu tetap tanggung jawab adapter kita.

### 15.6 Failsafe

Failsafe menyediakan `RetryPolicy` dengan delay/backoff/jitter dan komposisi policy. Cocok untuk wrapper application-level.

Tetap perlu:

- failure classifier
- idempotency check
- deadline check
- metric tags
- safe body repeatability

---

## 16. Body Repeatability: Retry Tidak Selalu Bisa Mengirim Body Lagi

Tidak semua request body bisa diulang.

Repeatable body:

- string body
- byte array body
- small JSON object serialized ulang
- file body yang bisa dibuka ulang
- buffered body

Non-repeatable body:

- live `InputStream`
- streaming upload dari network
- one-shot publisher
- large stream tanpa rewind
- multipart stream dari source yang tidak repeatable

Jika body tidak repeatable:

```text
attempt 1 sends partial body
connection fails
attempt 2 cannot reconstruct same body safely
```

Policy:

```text
non-repeatable body → no automatic retry after body write starts
```

Untuk upload besar:

- gunakan resumable upload protocol jika tersedia
- chunk upload dengan chunk id
- server-side dedupe
- checksum per chunk
- explicit resume token

---

## 17. Retry dan Observability

Retry tanpa observability membuat sistem tampak sehat padahal sedang sakit.

Jika request berhasil setelah retry, user mungkin melihat sukses, tetapi downstream mengalami masalah.

Metric wajib:

| Metric | Makna |
|---|---|
| `http.client.requests.total` | total logical requests |
| `http.client.attempts.total` | total physical attempts |
| `http.client.retries.total` | retry attempts |
| `http.client.retry.exhausted.total` | retry habis |
| `http.client.retry.skipped.total` | retry tidak dilakukan karena policy |
| `http.client.retry.delay` | delay antar retry |
| `http.client.retry.budget.remaining` | sisa budget |
| `http.client.hedges.total` | hedge attempt |
| `http.client.hedge.wins.total` | hedge menang |
| `http.client.duplicate_risk.total` | attempt mutasi yang butuh idempotency |

Tags yang berguna:

- client name
- downstream service
- operation
- method
- status class
- exception class
- retry reason
- attempt number
- idempotent true/false
- has idempotency key true/false

Hindari cardinality tinggi:

- full URL dengan ID
- raw query
- idempotency key
- trace id
- user id
- token

### 17.1 Logging Attempt

Log retry minimal:

```json
{
  "event": "http_client_retry_scheduled",
  "client": "payment-api",
  "operation": "createPayment",
  "method": "POST",
  "attempt": 2,
  "maxAttempts": 3,
  "delayMs": 247,
  "reason": "HTTP_503",
  "idempotencyKeyPresent": true,
  "remainingDeadlineMs": 1200
}
```

Jangan log:

- bearer token
- API key
- full body sensitive
- idempotency key jika dianggap sensitive
- raw PII query

---

## 18. Retry Policy Object

Daripada menyebar `if` retry di mana-mana, gunakan policy object.

```java
public interface HttpRetryPolicy {
    boolean isRetryableStatus(HttpRequestMetadata request, int statusCode, HttpHeaders headers);

    boolean isRetryableException(HttpRequestMetadata request, Throwable throwable);

    boolean isRequestRetrySafe(HttpRequestMetadata request);

    Duration computeDelay(RetryContext context);

    boolean canRetry(RetryContext context);
}
```

Request metadata:

```java
public record HttpRequestMetadata(
        String clientName,
        String operationName,
        String method,
        URI uri,
        boolean idempotent,
        boolean hasIdempotencyKey,
        boolean bodyRepeatable,
        boolean mutation
) {}
```

Retry context:

```java
public record RetryContext(
        int attempt,
        int maxAttempts,
        Instant startedAt,
        Instant deadline,
        Optional<Integer> lastStatus,
        Optional<Throwable> lastException,
        Optional<Duration> retryAfter
) {}
```

Policy object membuat aturan eksplisit dan testable.

---

## 19. Example: Safe Retry Decision Matrix

```text
IF request is not repeatable
    THEN do not retry after send started

IF method is GET/HEAD/OPTIONS
    THEN retry transient transport + 408/429/500/502/503/504 with budget

IF method is PUT/DELETE
    THEN retry only if endpoint declared idempotent

IF method is POST/PATCH
    THEN retry only if idempotency key present and server supports dedupe

IF status is 401
    THEN refresh credential once, retry once if still within policy

IF status is 429/503 and Retry-After exists
    THEN use Retry-After capped by deadline/policy

IF deadline remaining is insufficient
    THEN do not retry

IF retry budget exhausted
    THEN do not retry

IF circuit breaker open
    THEN do not retry
```

---

## 20. Example: Retry Policy for Internal Read API

Scenario:

```text
GET /reference-data/license-types
SLA: 500ms p95
Downstream internal service
Read-only
Low cost
```

Policy:

```yaml
maxAttempts: 2
baseDelay: 50ms
maxDelay: 100ms
jitter: full
totalDeadline: 400ms
retryOnStatus: [408, 500, 502, 503, 504]
retryOnException:
  - connect timeout
  - connection reset before response
  - read timeout
hedging:
  enabled: maybe
  threshold: p95
  maxHedges: 1
```

Reasoning:

- Read-only, low cost, retry safe.
- SLA pendek, jadi delay kecil.
- Jangan 3-5 attempts karena akan melanggar latency budget.

---

## 21. Example: Retry Policy for Payment/Create Command

Scenario:

```text
POST /payments
Creates external payment instruction
High risk duplicate side effect
Third-party API
```

Policy:

```yaml
maxAttempts: 2
requiresIdempotencyKey: true
bodyRepeatableRequired: true
baseDelay: 300ms
maxDelay: 2s
jitter: full
totalDeadline: 5s
retryOnStatus: [408, 429, 500, 502, 503, 504]
respectRetryAfter: true
retryOnException:
  - connect timeout before request body sent
  - connection refused
  - connection reset only if server did not receive request OR idempotency key exists
neverRetry:
  - 400
  - 401 except token refresh once
  - 403
  - validation error
```

Tambahan:

- Persist operation id sebelum call.
- Reconcile uncertain outcome.
- Provide manual/audit workflow untuk ambiguous payment state.

---

## 22. Example: Retry Policy for Case Submission

Scenario:

```text
POST /case-submissions
Creates regulatory case/application
Audit-sensitive
```

Policy:

```text
must have clientOperationId
must have idempotency key
must persist command intent
retry max 1 or 2 attempts only
on timeout after send: mark outcome unknown
perform status lookup by clientOperationId before retry if supported
never blindly create again
```

Better flow:

```text
1. Generate operationId
2. Save local submission command: PENDING_SEND
3. Send POST with Idempotency-Key = operationId
4. If 2xx: mark SENT/ACCEPTED
5. If timeout/504: mark OUTCOME_UNKNOWN
6. Query downstream by operationId
7. Only retry same operationId if lookup says not received or server supports dedupe
```

This is the kind of design expected in high-defensibility systems.

---

## 23. Retry and Outbox Pattern

For critical side-effecting calls, retry inside HTTP request path may not be enough.

Use outbox when:

- operation must eventually be delivered
- caller should not wait too long
- external API unstable
- audit trail required
- retry may happen over minutes/hours
- manual reconciliation needed

Flow:

```text
business transaction
→ persist local state + outbox event atomically
→ background dispatcher sends HTTP request
→ retry with durable state
→ store attempt history
→ reconcile uncertain outcome
→ dead-letter after policy exhausted
```

Outbox retry differs from synchronous retry:

| Aspek | Synchronous retry | Outbox retry |
|---|---|---|
| Timescale | milliseconds-seconds | seconds-hours-days |
| Caller waits | Ya | Tidak selalu |
| State durable | Sering tidak | Ya |
| Auditability | Terbatas | Kuat |
| Manual recovery | Sulit | Lebih mudah |
| Cocok untuk | read, light mutation | critical side effect |

---

## 24. Retry Anti-Patterns

### 24.1 Retry Semua Exception

```java
catch (Exception e) {
    retry();
}
```

Masalah:

- validation error ikut retry
- auth error ikut retry
- serialization bug ikut retry
- SSL config error ikut retry

### 24.2 Retry POST Tanpa Idempotency

```text
POST /create-order failed with timeout → retry with new request
```

Risiko duplicate order.

### 24.3 Retry Tanpa Total Deadline

```text
read timeout 2s
max attempts 5
delay exponential
actual operation > 20s
```

Caller upstream mungkin sudah timeout, tetapi thread masih bekerja.

### 24.4 Retry Tanpa Jitter

Menciptakan synchronized retry wave.

### 24.5 Retry 429 Immediate

Ini melanggar feedback dari server dan memperparah quota exhaustion.

### 24.6 Nested Retry

Contoh:

```text
Retrofit/OkHttp built-in retry
+ service wrapper retry
+ Resilience4j retry
+ service mesh retry
+ gateway retry
```

Total attempt bisa meledak.

Jika tiap layer retry 3x:

```text
3 * 3 * 3 * 3 = 81 attempts
```

Harus ada inventory retry di semua layer.

### 24.7 Retry Setelah Caller Cancel

Jika HTTP client terus retry setelah request upstream sudah dibatalkan, kapasitas terbuang.

### 24.8 Retry Error Permanen

Contoh:

- invalid API key
- invalid certificate
- malformed URI
- invalid JSON schema
- unsupported API version

Retry tidak memperbaiki bug/config.

---

## 25. Nested Retry Inventory

Sebelum menambahkan retry, cek layer berikut:

```text
application client wrapper
→ SDK/generated client
→ Retrofit/OkHttp/JDK/Apache behavior
→ Resilience4j/Failsafe
→ service mesh
→ API gateway
→ load balancer
→ downstream SDK
→ message broker redelivery
→ job scheduler retry
```

Buat tabel:

| Layer | Retry? | Max attempts | Timeout | Jitter? | Idempotency aware? |
|---|---:|---:|---:|---:|---:|
| Application gateway | Ya | 2 | total 2s | Ya | Ya |
| OkHttp connection recovery | Ya | internal | call timeout | N/A | Tidak domain-aware |
| Service mesh | Tidak | 0 | N/A | N/A | N/A |
| API gateway | Ya | 1 | 1s | Tidak | Tidak |

Jika layer bawah tidak domain-aware, jangan biarkan ia melakukan retry mutasi secara agresif.

---

## 26. Implementation Sketch: Retry with Jitter

```java
import java.time.Duration;
import java.util.concurrent.ThreadLocalRandom;

public final class Backoff {
    private final Duration baseDelay;
    private final Duration maxDelay;
    private final double multiplier;

    public Backoff(Duration baseDelay, Duration maxDelay, double multiplier) {
        if (baseDelay.isNegative() || baseDelay.isZero()) {
            throw new IllegalArgumentException("baseDelay must be positive");
        }
        if (maxDelay.compareTo(baseDelay) < 0) {
            throw new IllegalArgumentException("maxDelay must be >= baseDelay");
        }
        if (multiplier < 1.0) {
            throw new IllegalArgumentException("multiplier must be >= 1.0");
        }
        this.baseDelay = baseDelay;
        this.maxDelay = maxDelay;
        this.multiplier = multiplier;
    }

    public Duration fullJitterDelay(int nextAttempt) {
        long computedMillis = computeExponentialMillis(nextAttempt);
        long jittered = ThreadLocalRandom.current().nextLong(computedMillis + 1);
        return Duration.ofMillis(jittered);
    }

    public Duration equalJitterDelay(int nextAttempt) {
        long computedMillis = computeExponentialMillis(nextAttempt);
        long half = computedMillis / 2;
        long jittered = half + ThreadLocalRandom.current().nextLong(half + 1);
        return Duration.ofMillis(jittered);
    }

    private long computeExponentialMillis(int nextAttempt) {
        int exponent = Math.max(0, nextAttempt - 1);
        double raw = baseDelay.toMillis() * Math.pow(multiplier, exponent);
        return Math.min(maxDelay.toMillis(), (long) raw);
    }
}
```

Catatan:

- `nextAttempt` adalah attempt yang akan datang, bukan attempt yang baru gagal.
- Untuk production, pertimbangkan nanosecond precision jika perlu.
- Untuk test deterministik, inject random source/clock.

---

## 27. Implementation Sketch: Retry-After Parser

```java
import java.net.http.HttpHeaders;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Optional;

public final class RetryAfterParser {
    private final Clock clock;
    private final Duration maxDelay;

    public RetryAfterParser(Clock clock, Duration maxDelay) {
        this.clock = clock;
        this.maxDelay = maxDelay;
    }

    public Optional<Duration> parse(HttpHeaders headers) {
        return headers.firstValue("Retry-After").flatMap(this::parseValue);
    }

    private Optional<Duration> parseValue(String value) {
        String trimmed = value.trim();

        try {
            long seconds = Long.parseLong(trimmed);
            if (seconds < 0) {
                return Optional.empty();
            }
            return Optional.of(cap(Duration.ofSeconds(seconds)));
        } catch (NumberFormatException ignored) {
            // Try HTTP-date below.
        }

        try {
            ZonedDateTime dateTime = ZonedDateTime.parse(trimmed, DateTimeFormatter.RFC_1123_DATE_TIME);
            Duration delay = Duration.between(Instant.now(clock), dateTime.toInstant());
            if (delay.isNegative()) {
                return Optional.of(Duration.ZERO);
            }
            return Optional.of(cap(delay));
        } catch (DateTimeParseException ignored) {
            return Optional.empty();
        }
    }

    private Duration cap(Duration delay) {
        return delay.compareTo(maxDelay) > 0 ? maxDelay : delay;
    }
}
```

---

## 28. Implementation Sketch: Request Retry Safety

```java
public final class RetrySafety {
    public boolean isSafeToRetry(HttpRequestMetadata request) {
        if (!request.bodyRepeatable()) {
            return false;
        }

        String method = request.method().toUpperCase();

        return switch (method) {
            case "GET", "HEAD", "OPTIONS" -> true;
            case "PUT", "DELETE" -> request.idempotent();
            case "POST", "PATCH" -> request.hasIdempotencyKey();
            default -> false;
        };
    }
}
```

Untuk Java 8, gunakan `switch` biasa.

---

## 29. Implementation Sketch: Retrofit Gateway Wrapper

```java
public final class PaymentGateway {
    private final PaymentApi api;
    private final RetryExecutor retryExecutor;
    private final IdempotencyKeyGenerator keyGenerator;

    public PaymentGateway(
            PaymentApi api,
            RetryExecutor retryExecutor,
            IdempotencyKeyGenerator keyGenerator
    ) {
        this.api = api;
        this.retryExecutor = retryExecutor;
        this.keyGenerator = keyGenerator;
    }

    public PaymentResult createPayment(CreatePaymentCommand command) {
        String operationId = command.operationId();
        String idempotencyKey = keyGenerator.forOperation(operationId);

        HttpRequestMetadata metadata = HttpRequestMetadata.mutatingPost(
                "payment-api",
                "createPayment",
                true,
                true
        );

        return retryExecutor.execute(metadata, () -> {
            retrofit2.Response<PaymentResponse> response = api.createPayment(
                    idempotencyKey,
                    PaymentRequest.from(command)
            ).execute();

            if (response.isSuccessful() && response.body() != null) {
                return PaymentResult.success(response.body().paymentId());
            }

            throw PaymentApiException.from(response);
        });
    }
}
```

Point penting:

- Retry tidak disembunyikan di interface Retrofit.
- Gateway tahu operation name dan idempotency.
- Error body bisa dimodelkan.
- Metrics bisa diberi tag domain operation.

---

## 30. Testing Retry Policy

Test retry harus mencakup behavior, bukan hanya happy path.

### 30.1 Test Case Wajib

| Test | Ekspektasi |
|---|---|
| GET 503 lalu 200 | retry dan sukses |
| GET 400 | tidak retry |
| POST tanpa idempotency key 503 | tidak retry |
| POST dengan idempotency key 503 lalu 200 | retry |
| 429 dengan Retry-After | delay mengikuti header |
| Retry-After invalid | fallback ke policy atau no retry |
| deadline hampir habis | tidak retry |
| retry budget habis | tidak retry |
| non-repeatable body | tidak retry |
| token expired 401 | refresh sekali lalu retry |
| 403 | tidak retry |
| IOException retryable | retry sesuai classifier |
| SSLHandshakeException | tidak retry |

### 30.2 Fault Injection dengan Mock Server

Gunakan server test seperti:

- OkHttp MockWebServer
- WireMock
- MockServer
- custom JDK test server

Fault yang perlu diuji:

- delayed response
- disconnect at start
- disconnect after request
- malformed response
- chunked body error
- 500 sequence
- 429 with Retry-After
- 504 then successful lookup

### 30.3 Deterministic Time

Retry test sering flaky jika memakai real sleep.

Lebih baik:

- inject `Clock`
- inject `Sleeper`
- inject random source
- gunakan fake scheduler
- assert computed delay, bukan benar-benar tidur

---

## 31. Production Readiness Checklist

Sebelum retry policy dinyatakan production-ready, jawab pertanyaan ini:

### Request Semantics

- Apakah method safe/idempotent?
- Untuk POST/PATCH, apakah ada idempotency key?
- Apakah server benar-benar mendukung dedupe?
- Apakah body repeatable?
- Apakah operasi bisa menghasilkan side effect eksternal?

### Failure Classification

- Exception apa saja yang retryable?
- Status code apa saja yang retryable?
- Apakah 401 ditangani sebagai token refresh, bukan retry buta?
- Apakah 429/503 menghormati `Retry-After`?
- Apakah domain error tidak ikut retry?

### Budget dan Timing

- Berapa max attempts?
- Berapa total deadline?
- Berapa per-attempt timeout?
- Apakah delay punya jitter?
- Apakah retry budget ada?
- Apakah retry berhenti jika caller cancel?

### Layering

- Apakah ada retry di OkHttp/JDK/Apache?
- Apakah ada retry di service mesh?
- Apakah ada retry di gateway?
- Apakah generated client punya retry sendiri?
- Total worst-case attempts berapa?

### Observability

- Apakah logical request dan physical attempt dipisah?
- Apakah attempt number terlihat?
- Apakah reason retry terlihat?
- Apakah exhausted retry terlihat?
- Apakah budget exhaustion terlihat?
- Apakah idempotency presence terlihat tanpa membocorkan key?

### Safety

- Apakah sensitive header/body tidak dilog?
- Apakah retry tidak memperbesar SSRF/redirect risk?
- Apakah retry tidak mengulang credential invalid terus-menerus?
- Apakah retry tidak menghabiskan API quota?

---

## 32. Design Review Questions

Gunakan pertanyaan ini saat review HTTP client:

1. Apa operasi ini read-only atau mutating?
2. Jika request dikirim dua kali, apa efeknya?
3. Jika client timeout tetapi server tetap memproses, bagaimana kita tahu hasilnya?
4. Apakah ada idempotency key atau operation id?
5. Apakah retry menggunakan same idempotency key atau key baru?
6. Apa failure yang benar-benar transient?
7. Apa failure yang permanent?
8. Apa max physical attempts untuk satu logical operation?
9. Apa total worst-case latency?
10. Apakah retry menghormati caller deadline?
11. Apakah `Retry-After` dihormati?
12. Apakah retry budget ada?
13. Apakah ada retry lain di service mesh/gateway/generated client?
14. Apakah retry metric dapat membedakan first attempt vs retry attempt?
15. Jika retry memperburuk incident, bagaimana dimatikan cepat?

---

## 33. Mental Model Akhir

Retry production-grade bukan:

```text
try again because maybe it works
```

Retry production-grade adalah:

```text
under a bounded deadline,
for a classified transient failure,
only when request semantics are safe,
with idempotency protection for side effects,
with backoff and jitter,
within retry budget,
while respecting rate-limit feedback,
with observability and cancellation,
and with clear fallback/reconciliation for uncertain outcomes.
```

Jika diringkas:

```text
retry = policy + semantics + budget + feedback + telemetry
```

Engineer biasa menambahkan retry untuk membuat error hilang.

Engineer top-tier mendesain retry agar:

- tidak menyembunyikan systemic failure
- tidak menggandakan side effect
- tidak memperburuk overload
- tidak melanggar SLA upstream
- tidak membakar quota
- tidak membuat incident sulit didiagnosis
- tetap memberi peluang recovery untuk transient failure

---

## 34. Ringkasan Part 11

Kita sudah membahas:

- Retry sebagai control loop.
- Failure taxonomy untuk retry.
- Status code retryable dan non-retryable.
- Idempotency sebagai fondasi retry aman.
- Idempotency key untuk operasi mutasi.
- Backoff dan jitter.
- Retry budget.
- Deadline-aware retry.
- Retry ordering dengan timeout.
- Retry untuk authentication dan rate limit.
- Hedging untuk tail latency.
- Perilaku library JDK HttpClient, OkHttp, Retrofit, Apache HttpClient.
- Resilience4j dan Failsafe sebagai policy/decorator layer.
- Body repeatability.
- Observability retry.
- Testing retry.
- Production checklist.

Part berikutnya akan membahas **Rate Limiting, Throttling, Bulkhead, dan Client-Side Load Shedding**, yaitu kontrol yang sangat erat dengan retry. Retry mencoba recover dari failure, sedangkan rate limit dan bulkhead mencegah client membuat failure semakin besar.

---

## Referensi Resmi dan Bacaan Lanjutan

- OkHttp retryOnConnectionFailure: https://square.github.io/okhttp/5.x/okhttp/okhttp3/-ok-http-client/-builder/retry-on-connection-failure.html
- OkHttp overview: https://square.github.io/okhttp/
- Resilience4j Retry: https://resilience4j.readme.io/docs/retry
- Resilience4j Getting Started / decorators: https://resilience4j.readme.io/docs/getting-started
- Failsafe Retry Policy: https://failsafe.dev/retry/
- MDN Retry-After header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After
- JDK HttpClient Java 25: https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html
- RFC 9110 HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh](./10-client-side-auth-basic-bearer-oauth2-apikey-hmac-token-refresh.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 12 — Rate Limiting, Throttling, Bulkhead, dan Client-Side Load Shedding](./12-rate-limiting-throttling-bulkhead-client-side-load-shedding.md)

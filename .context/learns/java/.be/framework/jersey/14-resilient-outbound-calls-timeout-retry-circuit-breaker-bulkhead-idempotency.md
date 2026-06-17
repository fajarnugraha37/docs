# Part 14 — Resilient Outbound Calls: Timeout, Retry, Circuit Breaker, Bulkhead, Idempotency

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
File: `14-resilient-outbound-calls-timeout-retry-circuit-breaker-bulkhead-idempotency.md`  
Status: **Part 14 dari 32**  
Target Java: **Java 8 sampai Java 25**  
Target Jersey: **Jersey 2.x (`javax.ws.rs`), Jersey 3.x/4.x (`jakarta.ws.rs`)**

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya, kita membedah **Jersey Client** sebagai runtime outbound HTTP: `Client`, `WebTarget`, `Invocation.Builder`, connector, provider, timeout, pooling, TLS, dan lifecycle.

Bagian ini naik satu lapis: kita tidak lagi bertanya:

> “Bagaimana cara memanggil API lain dengan Jersey Client?”

Tetapi:

> “Bagaimana cara membuat outbound call yang tidak memperbesar kerusakan saat dependency lambat, gagal, overload, partial down, atau memberi response ambigu?”

Inilah wilayah **resilience engineering**.

Di production, outbound call adalah salah satu sumber incident paling umum karena dia menghubungkan service kita dengan dunia luar yang tidak sepenuhnya kita kontrol:

- network bisa lambat,
- DNS bisa delay,
- TLS handshake bisa stuck,
- dependency bisa overload,
- response bisa `500`, `429`, `503`, atau malformed,
- retry bisa memperparah beban,
- thread bisa habis,
- connection pool bisa bocor,
- request bisa berhasil di remote side tetapi gagal dibaca oleh client,
- user menekan submit ulang,
- job scheduler mengirim ulang payload,
- message consumer melakukan redelivery.

Engineer top-tier tidak hanya menambahkan `try-catch`. Ia mendesain **failure boundary**.

---

## 1. Mental Model: Outbound Call Bukan Function Call

Kesalahan mental model paling berbahaya adalah menganggap HTTP call seperti function call biasa.

```java
PaymentResponse response = paymentClient.charge(request);
```

Secara visual, kode ini terlihat seperti local method invocation. Tetapi secara realitas, ini adalah operasi distributed system:

```text
Application Thread
   |
   | build request
   v
DNS / service discovery
   |
   v
TCP connect
   |
   v
TLS handshake
   |
   v
connection pool / socket
   |
   v
remote gateway / load balancer
   |
   v
remote service thread pool
   |
   v
remote database / queue / dependency
   |
   v
response serialization
   |
   v
network transfer
   |
   v
client response parsing
   |
   v
application mapping
```

Setiap titik bisa gagal dengan mode berbeda.

Top 1% mental model:

> An outbound HTTP call is not a method call. It is a bounded, observable, cancellable, classified interaction with an unreliable remote system.

Maka setiap outbound call production-grade harus punya:

1. **timeout** — supaya tidak menunggu selamanya,
2. **retry policy** — supaya transient failure bisa pulih tanpa human intervention,
3. **idempotency semantics** — supaya retry tidak membuat duplicate side effect,
4. **circuit breaker** — supaya repeated failure tidak terus dipukul,
5. **bulkhead** — supaya satu dependency tidak menghabiskan semua thread/connection,
6. **rate limit / concurrency limit** — supaya kita tidak menyerang dependency,
7. **fallback / degradation** — jika sesuai domain,
8. **observability** — supaya bisa dibuktikan apa yang terjadi,
9. **error classification** — supaya caller tahu apakah retry, compensate, reject, atau escalate,
10. **resource cleanup** — supaya connection tidak bocor.

---

## 2. Baseline Resilience References

Beberapa standar dan library yang relevan:

- Jersey menyediakan client runtime dan properties seperti connect/read timeout melalui `ClientProperties`.
- Dokumentasi Jersey 2.45 menyebut `CONNECT_TIMEOUT` sebagai interval timeout koneksi dalam milidetik, dengan nilai `0` berarti infinity/default tanpa batas. Ini penting karena default timeout yang tidak terbatas adalah risiko production besar.
- MicroProfile Fault Tolerance mendefinisikan strategi seperti `Timeout`, `Retry`, `Bulkhead`, `CircuitBreaker`, dan `Fallback` untuk aplikasi microservice.
- Resilience4j menyediakan decorator untuk `CircuitBreaker`, `Retry`, `RateLimiter`, `Bulkhead`, dan `TimeLimiter`. Resilience4j 2.x menargetkan Java 17+, sementara akar desainnya sejak awal mendukung style functional Java.

Catatan praktis:

- Untuk **Java 8 legacy**, Resilience4j versi 1.x sering lebih realistis.
- Untuk **Java 17+**, Resilience4j 2.x dan runtime modern lebih masuk akal.
- Untuk **Jakarta EE/MicroProfile server**, MicroProfile Fault Tolerance bisa menjadi pilihan standar jika runtime mendukung.
- Untuk **Spring Boot + Jersey**, Resilience4j atau Spring-native resilience integration sering lebih natural.

---

## 3. Failure Taxonomy untuk Outbound HTTP

Sebelum bicara retry/circuit breaker, kita harus mengklasifikasi failure.

Tanpa taxonomy, policy akan acak.

### 3.1 Failure Sebelum Request Terkirim

Contoh:

- DNS failure,
- connection refused,
- connect timeout,
- TLS handshake failure,
- connection pool exhausted,
- proxy unavailable.

Karakteristik:

- Remote service kemungkinan belum menerima request.
- Retry sering aman untuk operasi idempotent.
- Untuk operasi non-idempotent, biasanya juga relatif aman jika request benar-benar belum terkirim, tetapi sulit dibuktikan penuh di semua connector/network layer.

Contoh exception bisa bergantung connector:

```text
ProcessingException
ConnectException
SocketTimeoutException
SSLHandshakeException
UnknownHostException
```

Jersey sering membungkus low-level exception dalam `ProcessingException`.

### 3.2 Failure Saat Menunggu Response

Contoh:

- read timeout,
- connection reset setelah request dikirim,
- remote menutup koneksi,
- gateway timeout,
- partial response.

Karakteristik:

- Remote service **mungkin sudah menerima dan memproses** request.
- Untuk operasi write, retry bisa menyebabkan duplicate side effect.
- Untuk operasi read, retry biasanya aman.

Ini adalah zona paling berbahaya.

```text
Client sends POST /payments
Remote charges card
Remote response lost
Client sees timeout
Client retries POST /payments
Remote charges card again
```

Tanpa idempotency key, timeout bisa berubah menjadi double execution.

### 3.3 Failure Response HTTP

Contoh status:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
```

Tidak semua error boleh di-retry.

| Status | Biasanya retry? | Catatan |
|---|---:|---|
| `400` | Tidak | Request salah. Retry request sama tidak membantu. |
| `401` | Conditional | Bisa refresh token lalu retry sekali. |
| `403` | Tidak | Authorization denial. |
| `404` | Biasanya tidak | Kecuali eventual consistency/read-after-write. |
| `409` | Conditional | Bisa retry jika conflict optimistic/concurrent dan domain mendukung. |
| `422` | Tidak | Semantic validation error. |
| `429` | Ya, dengan backoff | Hormati `Retry-After` jika ada. |
| `500` | Conditional | Bisa transient, tapi jangan agresif. |
| `502` | Ya | Sering gateway/upstream transient. |
| `503` | Ya | Service unavailable/overload; backoff penting. |
| `504` | Conditional | Remote mungkin masih memproses. Hati-hati untuk write. |

### 3.4 Failure Setelah Response Diterima

Contoh:

- JSON malformed,
- schema incompatible,
- enum value baru tidak dikenali,
- required field missing,
- deserialization failure,
- unexpected content type,
- response body terlalu besar.

Karakteristik:

- Retry jarang membantu kalau masalah contract permanen.
- Bisa transient jika remote sedang deploy versi incompatible atau gateway mengembalikan HTML error page.

### 3.5 Failure Semantik Domain

Contoh:

```json
{
  "status": "FAILED",
  "reason": "ACCOUNT_LOCKED"
}
```

HTTP `200`, tetapi domain gagal.

Ini bukan technical success. Untuk outbound integration layer, hasil harus dinormalisasi:

```text
Transport success + domain success
Transport success + domain rejection
Transport success + ambiguous domain state
Transport failure before remote acceptance
Transport failure after possible remote acceptance
```

---

## 4. Timeout: Guardrail Paling Dasar

Timeout bukan optimasi. Timeout adalah **safety boundary**.

Tanpa timeout, satu dependency lambat bisa mengunci thread sampai pool habis.

### 4.1 Timeout Taxonomy

Jangan hanya bilang “timeout 5 detik”. Timeout punya beberapa bentuk:

| Timeout | Meaning | Failure protected |
|---|---|---|
| DNS timeout | Waktu resolve hostname | DNS/service discovery lambat |
| Connect timeout | Waktu membuat koneksi TCP | Host down, network unreachable |
| TLS handshake timeout | Waktu negosiasi TLS | TLS/proxy/cert issue |
| Connection request timeout | Waktu menunggu connection dari pool | Pool habis |
| Read/socket timeout | Waktu menunggu byte response | Remote lambat/stuck |
| Write timeout | Waktu mengirim body | Upload besar/network lambat |
| Total deadline | Maksimum waktu seluruh operasi | Kombinasi semua tahap |
| Queue timeout | Waktu menunggu executor/bulkhead slot | Bulkhead penuh |

Jersey core paling umum menyediakan connect/read timeout. Connector tertentu bisa menyediakan property tambahan.

### 4.2 Setting Timeout di Jersey Client

Contoh `jakarta` style:

```java
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.ClientBuilder;
import org.glassfish.jersey.client.ClientProperties;

public final class ExternalClientFactory {

    public static Client createClient() {
        return ClientBuilder.newBuilder()
                .property(ClientProperties.CONNECT_TIMEOUT, 1_000) // 1 second
                .property(ClientProperties.READ_TIMEOUT, 3_000)    // 3 seconds
                .build();
    }
}
```

Untuk Jersey 2.x / Java EE style, import JAX-RS berubah:

```java
import javax.ws.rs.client.Client;
import javax.ws.rs.client.ClientBuilder;
import org.glassfish.jersey.client.ClientProperties;
```

### 4.3 Timeout Per Request

Kadang tiap endpoint dependency punya profile berbeda:

```java
Response response = client
        .target(baseUri)
        .path("/risk-score")
        .request()
        .property(ClientProperties.CONNECT_TIMEOUT, 500)
        .property(ClientProperties.READ_TIMEOUT, 2_000)
        .get();
```

Namun hati-hati: konfigurasi tersebar di banyak call-site sulit diaudit.

Lebih baik buat typed client wrapper:

```java
public final class RiskScoreClient {

    private final WebTarget target;

    public RiskScoreClient(Client client, URI baseUri) {
        this.target = client.target(baseUri);
    }

    public RiskScoreResponse getRiskScore(String caseId) {
        try (Response response = target
                .path("/risk-score/{caseId}")
                .resolveTemplate("caseId", caseId)
                .request("application/json")
                .property(ClientProperties.CONNECT_TIMEOUT, 500)
                .property(ClientProperties.READ_TIMEOUT, 2_000)
                .get()) {

            return mapResponse(response);
        }
    }

    private RiskScoreResponse mapResponse(Response response) {
        if (response.getStatus() == 200) {
            return response.readEntity(RiskScoreResponse.class);
        }
        throw new RemoteServiceException("Unexpected risk score response: " + response.getStatus());
    }
}
```

### 4.4 Timeout Budget dari Upstream SLA

Timeout tidak boleh dipilih random.

Misal user-facing request punya total budget 2 detik:

```text
Total API budget: 2000 ms

Authentication/context      100 ms
Validation/mapping           50 ms
DB query                    400 ms
External risk API           700 ms
External profile API        300 ms
Serialization/logging       100 ms
Buffer/reserve              350 ms
```

Kalau external risk API diberi read timeout 10 detik, maka timeout itu tidak selaras dengan budget. Request user sudah pasti gagal sebelum remote call selesai.

Mental model:

> Timeout harus diturunkan dari caller deadline, bukan dari perasaan.

### 4.5 Deadline Propagation

Idealnya setiap request punya deadline:

```text
Incoming request deadline = now + 2000 ms

Before outbound call:
remaining = deadline - now
riskTimeout = min(configuredRiskTimeout, remaining - safetyMargin)
```

Pseudo-code:

```java
Duration remaining = requestDeadline.remaining();
Duration timeout = min(Duration.ofMillis(700), remaining.minusMillis(100));

if (timeout.isNegative() || timeout.isZero()) {
    throw new DeadlineExceededException("No time left for risk score call");
}
```

Jersey tidak memaksakan model deadline seperti gRPC. Kita perlu membangun sendiri melalui filter/context atau service-layer policy.

---

## 5. Retry: Obat yang Bisa Menjadi Racun

Retry memperbaiki transient failure, tetapi bisa memperparah overload.

### 5.1 Retry Amplification

Misal:

```text
1000 request/sec masuk ke service A
Service A memanggil service B
Service B mulai lambat
Service A retry 3 kali

B menerima hingga 3000 request/sec
```

Jika banyak service melakukan retry berlapis, beban bisa meledak.

```text
Client retries 3x
API Gateway retries 2x
Service A retries 3x
Service B client retries 2x

Total worst-case attempts = 3 * 2 * 3 * 2 = 36
```

Ini disebut retry storm.

### 5.2 Retry Harus Punya Batas

Retry policy minimal:

```text
max attempts
retryable exceptions
retryable status codes
backoff
jitter
deadline awareness
idempotency awareness
metrics
```

### 5.3 Retryable Exception

Biasanya retryable:

- connect timeout,
- connection refused,
- temporary DNS failure,
- connection reset,
- `503`,
- `502`,
- `429`,
- maybe `504` untuk read operation.

Biasanya non-retryable:

- validation error,
- authentication failure setelah token refresh gagal,
- authorization failure,
- malformed request,
- domain rejection,
- deserialization failure karena contract mismatch.

### 5.4 Retry Berdasarkan Method

| Method | Safe? | Idempotent? | Retry tendency |
|---|---:|---:|---|
| GET | Ya | Ya | Umumnya aman |
| HEAD | Ya | Ya | Aman |
| OPTIONS | Ya | Ya | Aman |
| PUT | Tidak safe, tapi idempotent | Ya | Bisa retry dengan hati-hati |
| DELETE | Tidak safe, tapi idempotent secara intent | Ya | Bisa retry dengan hati-hati |
| POST | Tidak | Tidak secara default | Butuh idempotency key |
| PATCH | Tidak | Biasanya tidak | Hati-hati, butuh domain semantics |

Catatan: idempotent secara HTTP tidak berarti bebas risiko. DELETE kedua kali bisa menghasilkan `404`, tetapi state target tetap “deleted”. Itu masih sering acceptable.

### 5.5 Retry dengan Backoff dan Jitter

Jangan retry langsung berurutan:

```text
attempt 1: now
attempt 2: immediately
attempt 3: immediately
```

Gunakan backoff:

```text
attempt 1: now
attempt 2: +100 ms
attempt 3: +300 ms
attempt 4: +700 ms
```

Tambahkan jitter supaya semua instance tidak retry bersamaan:

```text
delay = baseDelay * multiplier + random(0..jitter)
```

### 5.6 Menghormati Retry-After

Untuk `429` atau `503`, remote bisa mengirim:

```http
Retry-After: 10
```

atau tanggal HTTP.

Policy yang baik:

```text
if Retry-After exists and within caller deadline:
    wait up to Retry-After
else:
    use local backoff policy
```

Namun jangan tunggu `Retry-After: 120` untuk user-facing request dengan budget 2 detik. Itu harus cepat gagal atau degrade.

---

## 6. Idempotency: Syarat Aman untuk Retry Write Operation

Retry tanpa idempotency pada write operation adalah sumber duplicate side effect.

### 6.1 Apa Itu Idempotency

Operasi idempotent berarti operasi yang sama jika dikirim berkali-kali menghasilkan efek akhir yang sama.

Contoh natural idempotent:

```http
PUT /cases/C-123/status
Content-Type: application/json

{
  "status": "CLOSED"
}
```

Jika dikirim dua kali, state akhir tetap `CLOSED`.

Contoh non-idempotent:

```http
POST /payments
Content-Type: application/json

{
  "amount": 100000,
  "currency": "IDR"
}
```

Jika dikirim dua kali, bisa terjadi dua pembayaran.

### 6.2 Idempotency Key

Untuk POST yang punya side effect, gunakan idempotency key:

```http
POST /payments
Idempotency-Key: 8df0d984-96b0-40cc-87e2-5d3fd5c8913a
Content-Type: application/json
```

Remote service menyimpan:

```text
idempotency_key
request_hash
status
response
created_at
expires_at
```

Jika request dengan key sama datang lagi:

- jika payload hash sama dan request sudah sukses, return response yang sama,
- jika payload hash beda, return conflict,
- jika request sedang diproses, return processing/locked/conflict sesuai desain,
- jika request gagal sebelum side effect, boleh diproses ulang,
- jika status ambiguous, return state yang bisa direkonsiliasi.

### 6.3 Idempotency Key dari Client

Outbound Jersey wrapper bisa generate atau menerima key dari upstream:

```java
public PaymentResult createPayment(CreatePaymentCommand command, String idempotencyKey) {
    try (Response response = target
            .path("/payments")
            .request("application/json")
            .header("Idempotency-Key", idempotencyKey)
            .post(Entity.json(command))) {

        return mapPaymentResponse(response);
    }
}
```

Pertanyaan desain penting:

```text
Apakah key dibuat oleh UI?
Apakah key dibuat oleh API boundary?
Apakah key dibuat oleh background job?
Apakah key disimpan di command table?
Apakah key dipropagasi ke semua downstream?
```

Untuk workflow/case management, idempotency key biasanya lebih kuat jika berasal dari command identity:

```text
caseId + actionType + actorId + clientCommandId
```

Bukan random setiap retry.

Jika retry membuat random key baru, idempotency gagal.

### 6.4 Request Hash

Idempotency key tanpa request hash bisa berbahaya.

Contoh:

```text
POST /payments Idempotency-Key: abc amount=100
POST /payments Idempotency-Key: abc amount=999
```

Remote harus menolak request kedua karena key sama tetapi payload berbeda.

---

## 7. Circuit Breaker: Stop Memukul Dependency yang Sedang Jatuh

Circuit breaker mencegah service terus mengirim request ke dependency yang sudah terbukti gagal.

### 7.1 State Circuit Breaker

```text
CLOSED
  Normal. Request lewat.
  Jika failure rate melewati threshold -> OPEN.

OPEN
  Request langsung gagal cepat.
  Tidak memanggil remote.
  Setelah wait duration -> HALF_OPEN.

HALF_OPEN
  Beberapa trial request diizinkan.
  Jika berhasil -> CLOSED.
  Jika gagal -> OPEN lagi.
```

Diagram:

```text
       failures exceed threshold
CLOSED ------------------------> OPEN
  ^                               |
  |                               | wait duration elapsed
  | success trial                 v
  +-------------------------- HALF_OPEN
                 failure trial     |
                 ------------------+
```

### 7.2 Kapan Circuit Breaker Berguna

Circuit breaker berguna ketika:

- dependency sering gagal beruntun,
- dependency overload,
- failure cepat lebih baik daripada request menggantung,
- caller bisa degrade/fallback,
- kita ingin memberi waktu dependency pulih.

Circuit breaker kurang berguna jika:

- traffic sangat rendah sehingga statistik tidak stabil,
- failure mostly client-side validation,
- dependency wajib sukses dan tidak ada fallback,
- policy terlalu sensitif sehingga sering false open.

### 7.3 Circuit Breaker Bukan Timeout

Timeout membatasi satu call.

Circuit breaker mengatur pola banyak call.

```text
Timeout: call ini tidak boleh lebih dari 2 detik.
Circuit breaker: dependency ini sudah gagal 50% dalam window terakhir, jangan dipanggil dulu.
```

### 7.4 Circuit Breaker Bukan Rate Limiter

Circuit breaker bereaksi terhadap failure.

Rate limiter membatasi volume.

```text
Circuit breaker: stop karena gagal.
Rate limiter: stop karena terlalu banyak.
```

### 7.5 Granularity Circuit Breaker

Jangan hanya satu circuit breaker global untuk semua outbound.

Granularity yang lebih baik:

```text
per dependency
per operation group
per critical endpoint
per tenant jika multi-tenant ekstrem
```

Contoh:

```text
PaymentService.createPayment       -> breaker A
PaymentService.getPaymentStatus    -> breaker B
ProfileService.getProfile          -> breaker C
```

Kenapa? Karena `getPaymentStatus` bisa sehat walaupun `createPayment` sedang gagal.

---

## 8. Bulkhead: Isolasi Agar Satu Dependency Tidak Menenggelamkan Semua

Bulkhead berasal dari desain kapal: kompartemen terpisah supaya kebocoran satu bagian tidak menenggelamkan seluruh kapal.

Dalam aplikasi:

> Bulkhead membatasi resource yang boleh dipakai oleh satu dependency/operation.

### 8.1 Masalah Tanpa Bulkhead

```text
HTTP server thread pool: 200 threads

Dependency A lambat
200 request menunggu Dependency A
Semua server thread habis
Endpoint lain ikut mati
```

Padahal dependency B, DB, dan endpoint health masih sehat.

### 8.2 Bulkhead dengan Semaphore

```text
Payment outbound max concurrent: 20
Profile outbound max concurrent: 50
Notification outbound max concurrent: 10
```

Jika payment dependency lambat, hanya 20 call yang menunggu. Request ke area lain masih punya kapasitas.

### 8.3 Bulkhead dengan Thread Pool

Thread-pool bulkhead memindahkan execution ke pool khusus:

```text
server request thread
    -> submits outbound task to paymentOutboundPool
    -> waits / async callback
```

Kelebihan:

- isolasi thread lebih kuat,
- bisa queue terbatas,
- cocok untuk blocking legacy operation.

Kekurangan:

- menambah context switching,
- queue bisa menyembunyikan overload,
- deadline harus mengikutsertakan queue time,
- dengan virtual threads, desain perlu dievaluasi ulang.

### 8.4 Queue Bukan Solusi Ajaib

Queue besar sering terlihat membantu karena error rate turun sesaat, tetapi latency naik tajam.

```text
maxConcurrent = 20
queue = 1000
remote latency = 5s
incoming = 200 rps
```

Queue akan menumpuk. User tetap timeout, tetapi sistem terlihat “sibuk”.

Rule of thumb:

> Untuk user-facing synchronous request, queue outbound harus kecil atau bahkan nol. Fail fast sering lebih sehat daripada menambah antrian panjang.

---

## 9. Rate Limiting dan Concurrency Limiting

Bulkhead membatasi concurrency internal.

Rate limiter membatasi request per waktu.

### 9.1 Kapan Rate Limit Diperlukan

- remote dependency punya quota,
- public API punya limit,
- downstream lambat saat burst,
- mencegah retry storm,
- melindungi sistem sendiri.

Contoh:

```text
OneMap-like API limit: 300 requests/minute
Local worker budget: 250 requests/minute
```

Dengan local budget lebih rendah, kita punya buffer terhadap clock skew, burst, dan retries.

### 9.2 Token Bucket Mental Model

```text
bucket capacity = 100 tokens
refill rate = 50 tokens/sec

setiap call butuh 1 token
jika token habis -> wait atau reject
```

Untuk synchronous API, biasanya lebih baik reject cepat jika tidak ada token daripada menunggu lama.

### 9.3 Adaptive Concurrency

Untuk sistem lebih advanced, concurrency limit bisa adaptif berdasarkan latency/error.

Konsep:

```text
if latency p95 naik tajam or error meningkat:
    reduce allowed concurrency
else if healthy:
    slowly increase concurrency
```

Ini lebih kompleks, tapi berguna untuk platform high-scale.

---

## 10. Fallback dan Degradation

Fallback bukan berarti “return dummy data”. Fallback adalah keputusan domain.

### 10.1 Jenis Fallback

| Fallback | Contoh | Risiko |
|---|---|---|
| Cache fallback | Pakai profile terakhir | Data stale |
| Default fallback | Risk score unknown -> manual review | Lebih banyak human workload |
| Partial response | Response tanpa optional data | Client harus siap |
| Async fallback | Terima request, proses nanti | Butuh state tracking |
| Alternative provider | Coba provider B | Bisa mahal/inkonsisten |
| Fail closed | Tolak operasi | Aman tapi mengganggu user |
| Fail open | Izinkan operasi | Risiko security/compliance |

### 10.2 Fail Open vs Fail Closed

Untuk sistem regulatory/security:

```text
Jika authorization service down:
    fail closed

Jika recommendation service down:
    degrade gracefully

Jika address enrichment service down:
    allow save with pending enrichment

Jika sanction screening service down:
    likely fail closed or manual review
```

Fallback harus dibahas dengan business/security, bukan diputuskan developer sendiri.

### 10.3 Fallback Harus Terlihat

Jangan sembunyikan fallback.

Log/metric/audit:

```text
dependency=profile-service
operation=getProfile
fallback=cache
cacheAge=PT4H
correlationId=...
```

Jika fallback mengubah keputusan case, harus ada evidence trail.

---

## 11. Policy Composition: Urutan Itu Penting

Policy resilience tidak berdiri sendiri.

Pertanyaan:

```text
Retry di dalam circuit breaker atau circuit breaker di dalam retry?
Timeout membungkus satu attempt atau seluruh retry operation?
Bulkhead di luar atau di dalam retry?
Rate limit dihitung per logical request atau per attempt?
```

### 11.1 Model yang Direkomendasikan

Untuk kebanyakan outbound synchronous call:

```text
Caller deadline
  -> bulkhead / concurrency limit
    -> circuit breaker
      -> retry policy
        -> per-attempt timeout
          -> Jersey Client invocation
```

Namun perlu dipahami konsekuensinya.

### 11.2 Retry Inside Circuit Breaker

```text
Circuit breaker sees final result after retries.
```

Kelebihan:

- transient failure bisa dipulihkan sebelum breaker mencatat failure.

Kekurangan:

- breaker tidak melihat setiap failed attempt,
- dependency tetap menerima lebih banyak call.

### 11.3 Circuit Breaker Inside Retry

```text
Each retry attempt goes through circuit breaker.
```

Kelebihan:

- breaker bisa menghentikan retry saat dependency sudah open.

Kekurangan:

- failure rate breaker bisa cepat naik karena retry attempts dihitung sebagai banyak failure.

### 11.4 Timeout Per Attempt vs Total Timeout

Per-attempt timeout:

```text
maxAttempts = 3
perAttemptTimeout = 2s
backoff = 500ms
worst-case > 6.5s
```

Total deadline:

```text
whole operation must finish within 2s
```

Production-grade policy harus punya keduanya:

```text
per attempt timeout <= 700ms
total operation deadline <= 2000ms
```

### 11.5 Rate Limit Per Attempt

Retry attempts tetap membebani remote.

Jadi rate limiter biasanya harus menghitung **attempt**, bukan hanya logical operation.

---

## 12. Manual Resilience Wrapper dengan Jersey Client

Sebelum menggunakan library, pahami bentuk manualnya.

### 12.1 Domain Result

Jangan biarkan seluruh aplikasi bergantung pada `Response` Jersey.

Buat typed result:

```java
public sealed interface RemoteCallResult<T>
        permits RemoteCallResult.Success,
                RemoteCallResult.ClientRejected,
                RemoteCallResult.RemoteRejected,
                RemoteCallResult.TemporaryFailure,
                RemoteCallResult.AmbiguousFailure {

    record Success<T>(T value) implements RemoteCallResult<T> {}

    record ClientRejected<T>(int status, String message) implements RemoteCallResult<T> {}

    record RemoteRejected<T>(int status, String code, String message) implements RemoteCallResult<T> {}

    record TemporaryFailure<T>(String reason, Throwable cause) implements RemoteCallResult<T> {}

    record AmbiguousFailure<T>(String reason, Throwable cause) implements RemoteCallResult<T> {}
}
```

Untuk Java 8, sealed interface belum ada. Gunakan interface biasa + final classes.

### 12.2 Basic Retry Loop

```java
public final class RetryingJerseyExecutor {

    private final int maxAttempts;
    private final long initialBackoffMillis;
    private final long maxBackoffMillis;

    public RetryingJerseyExecutor(int maxAttempts,
                                  long initialBackoffMillis,
                                  long maxBackoffMillis) {
        this.maxAttempts = maxAttempts;
        this.initialBackoffMillis = initialBackoffMillis;
        this.maxBackoffMillis = maxBackoffMillis;
    }

    public <T> T execute(RemoteOperation<T> operation) {
        Throwable lastFailure = null;

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return operation.invoke(attempt);
            } catch (RuntimeException ex) {
                lastFailure = ex;

                if (!isRetryable(ex) || attempt == maxAttempts) {
                    throw ex;
                }

                sleep(backoffWithJitter(attempt));
            }
        }

        throw new IllegalStateException("Unreachable", lastFailure);
    }

    private boolean isRetryable(RuntimeException ex) {
        // Production code should classify ProcessingException causes,
        // HTTP status exceptions, and domain-specific failures carefully.
        return ex instanceof RemoteTemporaryException;
    }

    private long backoffWithJitter(int attempt) {
        long exponential = initialBackoffMillis * (1L << Math.max(0, attempt - 1));
        long capped = Math.min(exponential, maxBackoffMillis);
        long jitter = ThreadLocalRandom.current().nextLong(0, Math.max(1, capped / 2));
        return capped + jitter;
    }

    private void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RemoteTemporaryException("Interrupted during retry backoff", e);
        }
    }

    @FunctionalInterface
    public interface RemoteOperation<T> {
        T invoke(int attempt);
    }
}
```

Ini bukan rekomendasi final untuk semua sistem, tetapi membangun pemahaman.

### 12.3 Mapping HTTP Status ke Exception

```java
private PaymentResponse mapPaymentResponse(Response response) {
    int status = response.getStatus();

    if (status == 200 || status == 201) {
        return response.readEntity(PaymentResponse.class);
    }

    if (status == 409) {
        throw new RemoteConflictException(readError(response));
    }

    if (status == 429 || status == 502 || status == 503) {
        throw new RemoteTemporaryException("Temporary remote failure: " + status);
    }

    if (status >= 500) {
        throw new RemoteTemporaryException("Remote server error: " + status);
    }

    if (status >= 400) {
        throw new RemotePermanentException("Remote rejected request: " + status);
    }

    throw new RemoteProtocolException("Unexpected status: " + status);
}
```

### 12.4 Always Close Response

```java
try (Response response = target.request("application/json").get()) {
    return map(response);
}
```

Jika response tidak ditutup, connection pool bisa bocor. Ini bisa terlihat sebagai timeout, padahal akar masalahnya adalah connection leak.

---

## 13. Resilience4j Integration Pattern

Resilience4j cocok untuk aplikasi standalone/Spring/modern Java yang ingin komposisi policy eksplisit.

### 13.1 Decorator Mental Model

Resilience4j membungkus supplier/function:

```text
Supplier<T> rawCall
  -> decorate with Retry
  -> decorate with CircuitBreaker
  -> decorate with Bulkhead
  -> execute
```

### 13.2 Contoh Konseptual

```java
Supplier<PaymentResponse> rawCall = () -> paymentClient.createPayment(command, idempotencyKey);

Supplier<PaymentResponse> decorated = Decorators.ofSupplier(rawCall)
        .withCircuitBreaker(paymentCircuitBreaker)
        .withRetry(paymentRetry)
        .withBulkhead(paymentBulkhead)
        .decorate();

PaymentResponse response = decorated.get();
```

Catatan:

- Urutan decorator harus dipahami, jangan hanya copy-paste.
- Exception classification harus disesuaikan.
- Metrics harus diberi nama dependency/operation yang jelas.

### 13.3 Retry Config

Pseudo-code:

```java
RetryConfig config = RetryConfig.custom()
        .maxAttempts(3)
        .waitDuration(Duration.ofMillis(200))
        .retryExceptions(RemoteTemporaryException.class)
        .ignoreExceptions(RemotePermanentException.class)
        .build();
```

Untuk response-based retry:

```java
RetryConfig config = RetryConfig.<PaymentResponse>custom()
        .maxAttempts(3)
        .retryOnResult(response -> response.isTemporaryFailure())
        .retryOnException(ex -> ex instanceof RemoteTemporaryException)
        .build();
```

### 13.4 Circuit Breaker Config

Konsep config:

```text
failureRateThreshold = 50%
slowCallRateThreshold = 50%
slowCallDurationThreshold = 2s
minimumNumberOfCalls = 20
slidingWindowSize = 100
waitDurationInOpenState = 30s
permittedNumberOfCallsInHalfOpenState = 5
```

Interpretasi:

- Jangan buka breaker hanya karena 1 failure.
- Minimum number of calls mencegah noise.
- Slow call threshold penting karena dependency lambat bisa sama buruknya dengan dependency gagal.

### 13.5 Bulkhead Config

Konsep:

```text
maxConcurrentCalls = 20
maxWaitDuration = 0-100ms
```

Untuk user-facing request, `maxWaitDuration` kecil lebih sehat.

### 13.6 TimeLimiter Caveat

TimeLimiter biasanya bekerja dengan `Future`/async execution. Untuk blocking Jersey call, membatalkan Future tidak selalu menghentikan socket call jika underlying connector tidak mendukung interruption/cancellation dengan baik.

Jangan menganggap TimeLimiter menggantikan socket timeout.

Tetap set:

```text
Jersey connect timeout
Jersey read timeout
operation deadline
```

---

## 14. MicroProfile Fault Tolerance Pattern

Jika aplikasi berjalan di runtime yang mendukung MicroProfile Fault Tolerance, kita bisa menggunakan annotation.

Contoh konseptual:

```java
@ApplicationScoped
public class ProfileGateway {

    @Inject
    ProfileJerseyClient client;

    @Timeout(1000)
    @Retry(maxRetries = 2, delay = 100, jitter = 50)
    @CircuitBreaker(requestVolumeThreshold = 20, failureRatio = 0.5, delay = 30000)
    @Bulkhead(value = 20, waitingTaskQueue = 0)
    @Fallback(ProfileFallback.class)
    public ProfileResponse getProfile(String userId) {
        return client.getProfile(userId);
    }
}
```

Kelebihan:

- declarative,
- standard-ish dalam MicroProfile ecosystem,
- integrasi metrics/telemetry bisa lebih natural di runtime tertentu.

Kekurangan:

- hanya aktif jika object dikelola container yang benar,
- self-invocation bisa bypass interceptor,
- annotation order/semantics harus dipahami,
- lebih sulit jika perlu dynamic per-operation policy,
- tidak otomatis menyelesaikan idempotency.

Top-tier caution:

> Annotation resilience yang tidak dipahami sering lebih berbahaya daripada tidak ada resilience, karena memberi ilusi aman.

---

## 15. Token Refresh sebagai Special Retry

`401 Unauthorized` biasanya tidak di-retry biasa.

Namun ada pola khusus:

```text
Call remote API
  -> receives 401
  -> refresh token once
  -> retry original request once
  -> if still 401, fail authentication
```

### 15.1 Token Refresh Guard

Jangan semua thread refresh token bersamaan.

Gunakan single-flight / lock:

```text
100 requests receive 401
only 1 performs refresh
others wait/reuse refreshed token
```

Pseudo-code:

```java
public String getValidTokenAfterUnauthorized() {
    synchronized (refreshLock) {
        if (tokenStore.currentTokenIsFreshEnough()) {
            return tokenStore.currentToken();
        }
        TokenResponse refreshed = authClient.refreshToken();
        tokenStore.save(refreshed);
        return refreshed.accessToken();
    }
}
```

### 15.2 Retry Limit

Jangan retry 401 terus-menerus.

```text
max token refresh retry per logical request = 1
```

Jika masih 401 setelah refresh:

- credential salah,
- permission revoked,
- clock skew,
- wrong audience/scope,
- remote auth outage.

---

## 16. Correlation and Idempotency Propagation

Outbound call harus membawa context yang berguna untuk tracing.

Headers umum:

```http
X-Correlation-Id: ...
X-Request-Id: ...
Idempotency-Key: ...
traceparent: ...
tracestate: ...
Authorization: Bearer ...
```

### 16.1 Jersey Client Filter untuk Correlation

```java
public final class CorrelationClientFilter implements ClientRequestFilter {

    private final CorrelationIdProvider correlationIdProvider;

    public CorrelationClientFilter(CorrelationIdProvider correlationIdProvider) {
        this.correlationIdProvider = correlationIdProvider;
    }

    @Override
    public void filter(ClientRequestContext requestContext) {
        requestContext.getHeaders().putSingle(
                "X-Correlation-Id",
                correlationIdProvider.currentOrCreate()
        );
    }
}
```

Register:

```java
Client client = ClientBuilder.newBuilder()
        .register(new CorrelationClientFilter(correlationIdProvider))
        .build();
```

### 16.2 Retry Attempt Header

Untuk debugging, kadang berguna:

```http
X-Retry-Attempt: 2
```

Tetapi jangan mengandalkan header ini sebagai security control.

---

## 17. Observability untuk Outbound Calls

Tanpa observability, resilience policy tidak bisa divalidasi.

### 17.1 Metrics Minimal

Per dependency + operation:

```text
outbound.requests.count
outbound.requests.duration
outbound.requests.in_flight
outbound.requests.timeout
outbound.requests.retry.count
outbound.requests.retry.exhausted
outbound.requests.circuit.open
outbound.requests.bulkhead.rejected
outbound.requests.rate_limited
outbound.requests.status_code
outbound.requests.exception_type
```

Tag/cardinality:

```text
dependency=payment-service
operation=create-payment
method=POST
status=503
outcome=temporary_failure
```

Jangan tag dengan:

```text
userId
caseId
full URL with ID
exception message raw
```

Itu bisa meledakkan cardinality dan/atau membocorkan data sensitif.

### 17.2 Logs Minimal

Untuk failure:

```text
correlationId
remoteDependency
operation
method
uriTemplate, not full sensitive URL
attempt
maxAttempts
status
exceptionClass
elapsedMs
timeoutMs
circuitState
idempotencyKey hash/prefix, not full if sensitive
```

Contoh log aman:

```text
WARN outbound_call_failed correlationId=abc dependency=payment operation=createPayment method=POST uri=/payments attempt=2 maxAttempts=3 status=503 elapsedMs=812 outcome=retrying
```

### 17.3 Tracing

Setiap outbound call idealnya menjadi child span:

```text
HTTP POST payment-service /payments
```

Span attributes:

```text
http.method
http.route / uri template
server.address
http.response.status_code
retry.attempt
resilience.circuit.state
```

Jangan masukkan request body sensitif ke span.

---

## 18. Response Body Drain and Error Mapping

Ketika menerima error response, kita sering ingin membaca body.

```java
String errorBody = response.readEntity(String.class);
```

Ini boleh, tetapi:

- batasi ukuran body,
- jangan log mentah jika mengandung PII,
- setelah body dibaca, stream consumed,
- pastikan response tetap ditutup.

Pattern:

```java
try (Response response = invocation.invoke()) {
    int status = response.getStatus();

    if (status >= 400) {
        RemoteError error = safelyReadError(response);
        throw classify(status, error);
    }

    return response.readEntity(SuccessDto.class);
}
```

Untuk body besar atau tidak terpercaya, gunakan limit.

---

## 19. Async, Cancellation, dan Jersey Client

Jersey Client mendukung async invocation.

Konsep:

```java
Future<Response> future = target.request().async().get();
```

atau callback:

```java
target.request().async().get(new InvocationCallback<MyDto>() {
    @Override
    public void completed(MyDto response) {
        // handle success
    }

    @Override
    public void failed(Throwable throwable) {
        // handle failure
    }
});
```

### 19.1 Async Tidak Otomatis Resilient

Async hanya mengubah cara menunggu.

Ia tidak otomatis memberi:

- timeout benar,
- retry benar,
- cancellation benar,
- bulkhead benar,
- context propagation benar.

### 19.2 Cancellation Caveat

`future.cancel(true)` belum tentu langsung membatalkan network operation di semua connector.

Tetap gunakan socket timeout.

### 19.3 Virtual Threads

Pada Java 21+, blocking Jersey Client call di virtual thread bisa menjadi model yang lebih sederhana dibanding async callback, jika connector/container tidak menyebabkan pinning berat.

Namun:

- connection pool tetap terbatas,
- remote dependency tetap terbatas,
- timeout tetap wajib,
- bulkhead/concurrency limit tetap wajib,
- ThreadLocal/MDC propagation harus dicek.

Virtual threads mengurangi biaya menunggu, bukan menghilangkan kebutuhan resilience.

---

## 20. Java 8–25 Considerations

### 20.1 Java 8

Keterbatasan:

- tidak ada `HttpClient` standar modern,
- tidak ada records/sealed/virtual threads,
- library versi modern mungkin tidak support,
- TLS/cipher default bisa tua,
- GC options berbeda.

Rekomendasi:

- gunakan Jersey 2.x untuk `javax.ws.rs`,
- pilih library resilience yang masih support Java 8,
- perkuat timeout/pooling,
- hindari pattern async terlalu kompleks,
- pastikan TLS config modern tersedia.

### 20.2 Java 11

- JDK punya `java.net.http.HttpClient`, tetapi jika stack memilih Jersey Client, tetap gunakan Jersey secara konsisten.
- TLS/runtime lebih modern.
- Container image lebih umum.

### 20.3 Java 17

- Baseline modern untuk banyak library.
- Resilience4j 2.x lebih relevan.
- Jakarta EE 10/11 ecosystem lebih natural.

### 20.4 Java 21

- Virtual threads available.
- Bisa menyederhanakan blocking integration.
- Tetap butuh connection pool, timeout, deadline, bulkhead.

### 20.5 Java 25

- Sebagai LTS modern, cocok untuk mengevaluasi runtime Jersey/Jakarta terbaru.
- Perhatikan compatibility Jersey version, Jakarta namespace, connector, dan observability agent.

---

## 21. Designing a Production Outbound Client Wrapper

Jangan biarkan resource class memanggil Jersey Client langsung.

Buruk:

```java
@Path("/cases")
public class CaseResource {

    private final Client client = ClientBuilder.newClient();

    @POST
    public Response create(CreateCaseRequest request) {
        Response remote = client.target("https://remote/api")
                .request()
                .post(Entity.json(request));
        return Response.status(remote.getStatus()).build();
    }
}
```

Masalah:

- client dibuat per resource,
- timeout tidak jelas,
- response tidak ditutup,
- tidak ada retry classification,
- tidak ada idempotency,
- tidak ada correlation,
- resource bocor ke integration detail,
- sulit test.

Lebih baik:

```text
Resource
  -> Application service
    -> Gateway interface
      -> Jersey outbound adapter
        -> resilience executor
          -> Jersey Client
```

Contoh interface:

```java
public interface PaymentGateway {
    PaymentCreationResult createPayment(CreatePaymentCommand command, IdempotencyKey key);
    PaymentStatusResult getPaymentStatus(String paymentId);
}
```

Implementation:

```java
public final class JerseyPaymentGateway implements PaymentGateway {

    private final WebTarget target;
    private final ResilienceExecutor resilience;

    public JerseyPaymentGateway(Client client,
                                URI baseUri,
                                ResilienceExecutor resilience) {
        this.target = client.target(baseUri);
        this.resilience = resilience;
    }

    @Override
    public PaymentCreationResult createPayment(CreatePaymentCommand command, IdempotencyKey key) {
        return resilience.execute("payment-service", "createPayment", () -> {
            try (Response response = target
                    .path("/payments")
                    .request("application/json")
                    .header("Idempotency-Key", key.value())
                    .post(Entity.json(command))) {

                return mapCreatePayment(response);
            }
        });
    }

    @Override
    public PaymentStatusResult getPaymentStatus(String paymentId) {
        return resilience.execute("payment-service", "getPaymentStatus", () -> {
            try (Response response = target
                    .path("/payments/{id}")
                    .resolveTemplate("id", paymentId)
                    .request("application/json")
                    .get()) {

                return mapPaymentStatus(response);
            }
        });
    }
}
```

---

## 22. Handling Ambiguous Outcomes

Distributed systems sering menghasilkan outcome ambigu.

Contoh:

```text
POST /payments dikirim
read timeout terjadi
```

Pertanyaan:

```text
Apakah remote menerima request?
Apakah remote memproses payment?
Apakah payment berhasil tetapi response hilang?
Apakah payment gagal sebelum side effect?
```

Kita tidak tahu.

Jangan mapping semua timeout menjadi “failed”. Lebih tepat:

```text
UNKNOWN / AMBIGUOUS
```

### 22.1 Ambiguous State Pattern

Untuk command penting:

```text
1. Simpan command lokal dengan status SUBMITTED
2. Kirim ke remote dengan idempotency key
3. Jika success -> COMPLETED
4. Jika clear rejection -> REJECTED
5. Jika timeout after possible send -> UNKNOWN
6. Jalankan reconciliation getStatus(idempotencyKey / externalRef)
7. Update final state
```

### 22.2 Jangan Bohong ke User

Untuk operasi kritikal:

Buruk:

```text
Payment failed. Please try again.
```

Jika sebenarnya outcome ambiguous, user retry bisa double charge.

Lebih aman:

```text
Payment is being verified. Please do not retry yet.
```

Atau dalam API:

```json
{
  "status": "PENDING_CONFIRMATION",
  "message": "The request was submitted but the final result is not confirmed yet.",
  "trackingId": "PAY-2026-00001"
}
```

---

## 23. Reconciliation Pattern

Untuk operation dengan side effect, resilience bukan hanya retry. Kadang butuh reconciliation.

```text
Command sent
  -> timeout/ambiguous
  -> query remote by idempotency key / external reference
  -> determine final state
  -> compensate if needed
```

Contoh scheduled reconciliation:

```text
Every 1 minute:
  find payment commands status UNKNOWN older than 30 seconds
  call GET /payments/by-idempotency-key/{key}
  update local state
```

Tanpa reconciliation, sistem bisa punya status menggantung selamanya.

---

## 24. Dependency-Specific Policy Matrix

Jangan satu policy untuk semua dependency.

| Dependency | Operation | Criticality | Retry | Timeout | Circuit | Bulkhead | Fallback |
|---|---|---:|---:|---:|---:|---:|---|
| Profile API | GET profile | Medium | 2 | 800ms | Yes | 50 | stale cache |
| Payment API | POST payment | High | 1-2 with idempotency | 1500ms | Yes | 20 | pending confirmation |
| Notification API | POST email | Low | async retry | 1000ms | Yes | 10 | queue later |
| Authorization API | check access | Critical | limited | 500ms | Yes | 30 | fail closed |
| Address API | enrich postal | Low/Medium | 2 | 700ms | Yes | rate-limited | save pending |

Policy harus lahir dari domain criticality.

---

## 25. Anti-Patterns

### 25.1 No Timeout

```java
Client client = ClientBuilder.newClient();
```

Default timeout yang tidak terbatas dapat menggantung thread.

### 25.2 Retry Semua Exception

```java
catch (Exception e) {
    retry();
}
```

Bisa retry validation error, auth error, atau duplicate write.

### 25.3 Retry POST Tanpa Idempotency

Berbahaya untuk side effect.

### 25.4 Circuit Breaker Global

Satu breaker untuk semua dependency menyebabkan unrelated operation ikut gagal.

### 25.5 Queue Besar untuk User Request

Menyembunyikan overload dan meningkatkan latency.

### 25.6 Swallow Error dengan Fallback Palsu

Fallback yang tidak terlihat bisa membuat data salah.

### 25.7 Log Full Request/Response Body

Risiko PII, credential, token, secret.

### 25.8 Tidak Menutup Response

Connection pool leak.

### 25.9 Token Refresh Stampede

Semua thread refresh token bersamaan setelah 401.

### 25.10 Menganggap Virtual Threads Menghapus Bottleneck

Virtual threads tidak membuat remote service lebih kuat.

---

## 26. Testing Resilience

Resilience yang tidak dites sering hanya dekorasi.

### 26.1 Test Cases Minimal

Untuk setiap outbound gateway:

```text
success 2xx
client error 4xx non-retryable
server error 5xx retryable
429 with Retry-After
connect timeout
read timeout
malformed JSON
empty body
unexpected content type
response body too large
retry exhausted
circuit open
bulkhead full
fallback used
idempotency key propagated
correlation ID propagated
response always closed
```

### 26.2 Fault Injection

Gunakan mock HTTP server seperti WireMock/MockWebServer atau test double sendiri.

Simulasi:

```text
respond after delay
close socket
return 503 twice then 200
return 429 with Retry-After
return invalid JSON
return huge payload
```

### 26.3 Assert Attempts

Test retry harus memverifikasi jumlah attempt:

```text
expected remote calls = 3
```

Bukan hanya response akhir.

### 26.4 Assert Timing

Jangan test timing terlalu rigid, tetapi validasi batas besar:

```text
operation should finish under 2 seconds
```

### 26.5 Assert Metrics/Logs Where Possible

Untuk platform library, metrics adalah contract.

---

## 27. Practical Implementation Checklist

Untuk setiap Jersey outbound client, jawab:

```text
[ ] Apakah Client singleton/reused dan ditutup saat shutdown?
[ ] Apakah connect timeout diset?
[ ] Apakah read timeout diset?
[ ] Apakah ada total deadline?
[ ] Apakah response selalu ditutup?
[ ] Apakah retry hanya untuk failure yang tepat?
[ ] Apakah retry punya max attempts?
[ ] Apakah retry punya backoff + jitter?
[ ] Apakah retry menghormati caller deadline?
[ ] Apakah POST/PATCH write operation punya idempotency key?
[ ] Apakah ambiguous timeout dimodelkan secara eksplisit?
[ ] Apakah ada circuit breaker per dependency/operation?
[ ] Apakah ada bulkhead/concurrency limit?
[ ] Apakah ada rate limit jika remote punya quota?
[ ] Apakah 401 token refresh dibatasi satu kali?
[ ] Apakah token refresh single-flight?
[ ] Apakah correlation ID dipropagasi?
[ ] Apakah trace context dipropagasi?
[ ] Apakah metrics tersedia?
[ ] Apakah log tidak membocorkan PII/secret?
[ ] Apakah fallback sesuai domain?
[ ] Apakah fallback terlihat di log/metric/audit?
[ ] Apakah dependency-specific policy terdokumentasi?
[ ] Apakah failure mode dites?
```

---

## 28. Mini Case Study: Case Management Calls Risk Service

### 28.1 Scenario

Sistem case management memanggil Risk Scoring API saat officer submit case.

Risk API:

```text
GET /risk-score?entityId=...
```

Karakteristik:

- read-only,
- response penting tetapi bukan satu-satunya basis keputusan,
- remote kadang lambat,
- stale score sampai 6 jam masih acceptable untuk draft, tetapi tidak untuk final approval.

### 28.2 Policy

Untuk draft:

```text
timeout: 700ms
retry: 1 retry for 502/503/connect timeout
circuit breaker: yes
bulkhead: 30 concurrent
fallback: cached risk score <= 6h, mark stale=true
```

Untuk final approval:

```text
timeout: 1500ms
retry: 2 with backoff
circuit breaker: yes
bulkhead: 20 concurrent
fallback: no automatic approval; route to manual review or block depending policy
```

### 28.3 Why Different?

Same dependency, different operation context.

Draft can degrade. Final approval has regulatory consequence.

Top-tier engineer tidak hanya membuat `RiskClient`. Ia membuat policy berdasarkan decision criticality.

---

## 29. Mini Case Study: POST to External Notification Service

Notification service dipakai untuk email/SMS.

Endpoint:

```http
POST /notifications/email
```

### 29.1 Synchronous Bad Design

```text
User submits case
System sends email synchronously
Email provider slow
Case submission fails
```

Padahal email bisa diproses async.

### 29.2 Better Design

```text
User submits case
Transaction saves case + outbox event
Background worker sends email
Worker uses Jersey Client with retry/idempotency
Email failure does not rollback case creation
```

Outbound resilience di worker:

```text
timeout: 3s
retry: 5 with exponential backoff
idempotency key: notificationId
circuit breaker: yes
bulkhead: 10
dead-letter: after max attempts
```

### 29.3 Lesson

Kadang resilience terbaik bukan retry di request thread, tetapi mengubah interaction mode menjadi async/outbox.

---

## 30. How This Connects to Previous Parts

Part 13 memberi kita Jersey Client mechanics:

```text
Client
WebTarget
Invocation
Connector
Provider
Response lifecycle
```

Part 14 menambahkan production policy:

```text
Timeout
Retry
Idempotency
Circuit breaker
Bulkhead
Rate limit
Fallback
Observability
Ambiguous outcome handling
```

Part berikutnya, Part 15, akan masuk ke sisi server:

```text
AsyncResponse
request suspension
timeout handler
cancellation
executor ownership
context propagation
```

Ini penting karena outbound call yang resilient sering berkaitan dengan async processing di server.

---

## 31. Ringkasan Inti

Outbound Jersey call production-grade harus dilihat sebagai distributed systems boundary.

Prinsip utama:

1. **Always set timeout.** Default infinite timeout adalah risiko besar.
2. **Retry selectively.** Retry hanya transient failure dan harus bounded.
3. **Never retry unsafe writes without idempotency.** Timeout pada POST bisa ambiguous.
4. **Use circuit breaker to fail fast during repeated dependency failure.**
5. **Use bulkhead to isolate resource exhaustion.**
6. **Use rate limit when downstream has quota or overload risk.**
7. **Make fallback a domain decision.** Jangan mengarang fallback teknis yang merusak correctness.
8. **Model ambiguous outcomes explicitly.** Jangan semua timeout disebut gagal.
9. **Propagate correlation and idempotency context.**
10. **Instrument everything.** Resilience tanpa observability tidak bisa dibuktikan.
11. **Test failure modes.** Success path test tidak cukup.
12. **Virtual threads reduce waiting cost, not dependency risk.**

---

## 32. Latihan

### Latihan 1 — Classify Failure

Untuk setiap case berikut, tentukan retry atau tidak:

```text
1. GET profile returns 503
2. POST payment read timeout after request sent
3. POST payment connect timeout before connection established
4. GET report returns malformed JSON
5. POST case returns 409 conflict
6. GET address returns 429 Retry-After: 2
7. POST notification returns 500
8. Authenticated request returns 401 once
```

Jawaban yang baik harus mempertimbangkan method, side effect, idempotency, dan deadline.

### Latihan 2 — Design Policy Matrix

Buat policy matrix untuk dependency berikut:

```text
Identity API
Document Storage API
Payment API
Notification API
Risk Scoring API
Audit Sink API
```

Kolom:

```text
operation
criticality
timeout
retry
idempotency
circuit breaker
bulkhead
fallback
observability
```

### Latihan 3 — Ambiguous Outcome

Desain flow untuk:

```text
POST /external-licenses
```

Jika Jersey Client mengalami read timeout setelah request dikirim, bagaimana sistem lokal harus menyimpan state, memberi response ke user, dan melakukan reconciliation?

---

## 33. Referensi

- Eclipse Jersey Documentation — Client API and Client Runtime.
- Eclipse Jersey API Docs — `org.glassfish.jersey.client.ClientProperties`, including `CONNECT_TIMEOUT` and `READ_TIMEOUT` semantics.
- Jakarta RESTful Web Services 4.0 Specification and API Docs.
- MicroProfile Fault Tolerance 4.1 Specification — Timeout, Retry, Bulkhead, CircuitBreaker, Fallback.
- Resilience4j Documentation — CircuitBreaker, Retry, RateLimiter, Bulkhead, TimeLimiter.
- OpenTelemetry semantic conventions for HTTP client spans.

---

## 34. Status Seri

Selesai:

```text
Part 0  — Orientasi Seri
Part 1  — Jersey Mental Model
Part 2  — Application Bootstrap
Part 3  — Resource Model Internals
Part 4  — Request Matching
Part 5  — Parameter Injection Semantics
Part 6  — Entity Provider Pipeline
Part 7  — JSON in Jersey
Part 8  — Response Engineering
Part 9  — Exception Mapping Architecture
Part 10 — Filters and Interceptors
Part 11 — Jersey Injection Model
Part 12 — CDI, Spring, and Jersey Integration
Part 13 — Jersey Client Deep Dive
Part 14 — Resilient Outbound Calls
```

Berikutnya:

```text
Part 15 — Async Server Processing: AsyncResponse, Suspension, Timeout, Cancellation
```

Seri belum selesai. Target akhir tetap:

```text
Part 32 — Capstone: Building a Production-Grade Jersey Platform Module
```

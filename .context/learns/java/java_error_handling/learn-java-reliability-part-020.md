# learn-java-reliability-part-020.md

# Part 020 — Reliability Patterns for External Integrations

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Status: Part 020 dari 030  
> Fokus: mendesain integrasi eksternal sebagai unreliable boundary, bukan sebagai method call biasa.

---

## 0. Executive Summary

External integration adalah salah satu sumber failure paling berbahaya di sistem enterprise karena failure-nya sering berada di luar kendali kita, tetapi dampaknya masuk ke dalam state, transaksi, user journey, SLA, dan reputasi sistem kita.

Kesalahan umum engineer adalah memperlakukan external API seperti local function call:

```java
ExternalResponse response = externalClient.call(request);
```

Padahal secara reliability, panggilan eksternal adalah boundary yang memiliki karakteristik berbeda:

- network bisa lambat, putus, atau flapping;
- DNS bisa gagal;
- TLS handshake bisa gagal;
- token bisa expired;
- credential bisa salah;
- provider bisa rate limit;
- provider bisa return 5xx;
- provider bisa return 200 tetapi body invalid;
- provider bisa berubah schema;
- provider bisa memproses request tetapi response gagal sampai ke kita;
- provider bisa duplicate-process kalau kita retry tanpa idempotency;
- provider bisa down saat kita sedang shutdown;
- provider bisa recover tetapi circuit breaker kita masih open;
- provider bisa sehat tetapi quota shared kita habis karena service lain.

Mental model utama bagian ini:

> External integration bukan sekadar HTTP client. External integration adalah unreliable distributed boundary yang harus punya contract, failure taxonomy, timeout budget, retry policy, idempotency model, observability, fallback decision, dan operational playbook sendiri.

---

## 1. Core Problem

### 1.1 Integrasi eksternal mengubah local error menjadi distributed uncertainty

Pada local method call, ketika method return, throw, atau timeout secara lokal, kita biasanya punya cukup kepastian tentang apa yang terjadi.

Pada external call, banyak failure menghasilkan **uncertain outcome**.

Contoh:

```text
Service A mengirim request ke Provider B.
Provider B menerima request.
Provider B memproses dan commit.
Response dikirim balik.
Network timeout terjadi sebelum response diterima Service A.
```

Dari perspektif Service A:

```text
call failed: timeout
```

Dari perspektif Provider B:

```text
operation succeeded
```

Kalau Service A retry tanpa idempotency, mungkin efek bisnis terjadi dua kali.

Inilah inti reliability external integration:

> Timeout bukan bukti bahwa provider tidak memproses request. Timeout hanya bukti bahwa caller tidak menerima response dalam batas waktu.

---

### 1.2 External integration punya banyak jenis failure yang tidak boleh disamakan

Kode buruk:

```java
try {
    return externalClient.call(request);
} catch (Exception e) {
    throw new RuntimeException("External call failed", e);
}
```

Masalahnya:

- 400 karena request kita salah berbeda dengan 500 provider.
- 401 token expired berbeda dengan 401 credential invalid.
- 403 permission denied berbeda dengan 429 quota exceeded.
- 404 data tidak ditemukan berbeda dengan 404 endpoint salah.
- timeout berbeda dengan connection refused.
- malformed response berbeda dengan domain rejection.
- duplicate request berbeda dengan transient failure.

Jika semua digabung menjadi `RuntimeException`, sistem kehilangan kemampuan mengambil keputusan:

- boleh retry atau tidak;
- harus refresh token atau tidak;
- harus fallback atau tidak;
- harus alert operator atau tidak;
- harus return 4xx atau 5xx ke client kita;
- harus mark dependency unhealthy atau tidak;
- harus open circuit breaker atau tidak.

---

## 2. External Boundary Mental Model

Bayangkan external dependency sebagai stateful system lain yang kita akses melalui unreliable channel.

```text
+-------------------+        unreliable channel        +----------------------+
| Our Service        | -------------------------------> | External Provider    |
|                   |                                  |                      |
| domain state       | <------------------------------- | provider state       |
| transaction        |          uncertain response       | provider transaction |
| retry policy       |                                  | provider limits      |
+-------------------+                                  +----------------------+
```

Ada 3 hal yang harus dipisahkan:

| Layer | Pertanyaan | Contoh |
|---|---|---|
| Transport | Apakah request/response bisa dikirim? | DNS, TLS, timeout, connection reset |
| Protocol | Apakah HTTP/API contract valid? | 400, 401, 429, 500, invalid content-type |
| Business | Apakah operasi domain diterima? | insufficient balance, duplicate claim, invalid status |

Reliability integration yang matang tidak mencampur ketiganya.

---

## 3. Failure Taxonomy untuk External Integration

### 3.1 Transport failure

Contoh:

- DNS lookup failed;
- connection refused;
- connection timeout;
- TLS handshake failed;
- socket timeout;
- connection reset;
- proxy error;
- no route to host.

Makna:

```text
Kita belum tentu tahu apakah provider menerima request.
```

Retry:

- aman hanya jika operasi idempotent atau punya idempotency key;
- untuk GET biasanya lebih aman;
- untuk POST command harus sangat hati-hati.

Classification:

```java
public final class ExternalTransportException extends ExternalDependencyException {
    private final DependencyId dependencyId;
    private final boolean outcomeUnknown;

    public ExternalTransportException(
            DependencyId dependencyId,
            String message,
            Throwable cause
    ) {
        super(message, cause);
        this.dependencyId = dependencyId;
        this.outcomeUnknown = true;
    }

    public DependencyId dependencyId() {
        return dependencyId;
    }

    public boolean outcomeUnknown() {
        return outcomeUnknown;
    }
}
```

---

### 3.2 Timeout failure

Timeout perlu dibagi:

| Timeout | Makna |
|---|---|
| connection timeout | gagal membuat koneksi |
| TLS handshake timeout | gagal secure channel |
| request write timeout | gagal mengirim request selesai |
| response/read timeout | request mungkin sudah diproses, response terlambat |
| pool acquisition timeout | client kita kehabisan connection pool |
| total deadline exceeded | budget request sudah habis |

Read timeout paling berbahaya karena outcome sering unknown.

```text
read timeout != operation not executed
```

Design rule:

> Untuk command yang punya side effect, timeout harus dianggap `unknown outcome` kecuali provider menjamin sebaliknya.

---

### 3.3 Authentication and authorization failure

External auth failure biasanya punya beberapa bentuk:

| Failure | Meaning | Action |
|---|---|---|
| 401 token expired | access token invalid karena expiry | refresh token lalu retry satu kali |
| 401 credential invalid | client credential salah | alert/config incident, jangan retry loop |
| 403 forbidden | credential valid tapi tidak punya permission | non-retryable, operator/config issue |
| 400 invalid_grant | refresh token invalid | re-auth/reconfigure |
| token endpoint timeout | auth provider transient failure | retry terbatas dengan backoff |

Anti-pattern:

```java
if (status == 401) {
    refreshToken();
    return callAgain(request);
}
```

Masalah:

- bisa infinite loop;
- bisa refresh storm;
- bisa membuat semua thread stuck di token refresh;
- bisa menutupi credential incident;
- bisa race antar instance.

Better model:

```text
on 401:
  if token is believed expired or near expiry:
      single-flight refresh
      retry original request once
  else:
      classify as authentication failure
      do not retry repeatedly
```

---

### 3.4 Rate limiting and quota failure

HTTP `429 Too Many Requests` berarti caller terkena rate limit. Provider dapat menyertakan `Retry-After` untuk memberi tahu kapan request boleh dicoba ulang.

Reliability behavior:

- jangan retry langsung;
- hormati `Retry-After` jika valid;
- gunakan local rate limiter agar request tidak terus ditembak;
- gunakan queue/backpressure untuk non-interactive work;
- gunakan fail-fast untuk interactive request kalau deadline user sudah habis;
- monitor quota consumption.

Rate limit bukan cuma error teknis. Rate limit adalah capacity contract.

```text
Provider limit: 300 requests/minute
Our local policy: 250 requests/minute
Reason: reserve headroom for retries, clock skew, other clients, burst, and provider-side calculation differences.
```

---

### 3.5 Provider 5xx failure

Contoh:

- 500 Internal Server Error;
- 502 Bad Gateway;
- 503 Service Unavailable;
- 504 Gateway Timeout.

Interpretasi:

| Status | Possible meaning | Retry? |
|---|---|---|
| 500 | provider failed internally | maybe, with classification |
| 502 | upstream/proxy issue | often transient |
| 503 | temporary unavailable/overloaded | retry later, respect Retry-After |
| 504 | gateway timeout | outcome may be unknown |

Jangan semua 5xx dianggap sama.

`503` + `Retry-After` harus diperlakukan berbeda dari random `500` tanpa body.

---

### 3.6 Provider 4xx failure

4xx sering dianggap non-retryable, tapi perlu hati-hati.

| Status | Interpretation |
|---|---|
| 400 | request malformed / invalid input / provider contract rejected |
| 401 | authentication problem |
| 403 | authorization/config/permission problem |
| 404 | resource missing, endpoint wrong, or eventual consistency gap |
| 409 | conflict, duplicate, stale state, already processed |
| 422 | semantic validation failure |
| 429 | rate limited, usually retryable later |

`404` bisa retryable dalam eventual consistency scenario:

```text
Step 1: create resource in provider
Step 2: immediately query resource
Provider returns 404 because replication delay
```

Tetapi `404 endpoint not found` jelas bukan retryable.

Maka classification harus dependency-specific, bukan hanya status-code-specific.

---

### 3.7 Malformed response and schema drift

Provider bisa return:

- status 200 tetapi body bukan JSON;
- field wajib hilang;
- enum value baru;
- numeric string berubah menjadi number;
- date format berubah;
- nested object null;
- semantic meaning berubah;
- content-type salah;
- response sukses tetapi error code di body.

Ini sering lebih berbahaya daripada 500 karena sistem kita bisa salah interpretasi.

Rule:

> Treat malformed success response as provider contract violation, not as successful business result.

Contoh exception:

```java
public final class ExternalContractViolationException extends ExternalDependencyException {
    private final String responseStatus;
    private final String contractField;
    private final boolean providerBugSuspected;

    public ExternalContractViolationException(
            String dependency,
            String responseStatus,
            String contractField,
            String message
    ) {
        super("External contract violation from " + dependency + ": " + message);
        this.responseStatus = responseStatus;
        this.contractField = contractField;
        this.providerBugSuspected = true;
    }
}
```

---

## 4. Dependency-Specific Error Model

### 4.1 Jangan desain error model eksternal terlalu generik

Anti-pattern:

```java
public enum ExternalErrorType {
    BAD_REQUEST,
    UNAUTHORIZED,
    SERVER_ERROR,
    TIMEOUT
}
```

Ini terlalu miskin untuk sistem enterprise.

Better:

```java
public enum DependencyFailureKind {
    TRANSPORT_UNAVAILABLE,
    CONNECTION_TIMEOUT,
    READ_TIMEOUT_UNKNOWN_OUTCOME,
    AUTH_TOKEN_EXPIRED,
    AUTH_CREDENTIAL_INVALID,
    AUTH_FORBIDDEN,
    RATE_LIMITED,
    PROVIDER_OVERLOADED,
    PROVIDER_INTERNAL_ERROR,
    PROVIDER_GATEWAY_TIMEOUT_UNKNOWN_OUTCOME,
    CONTRACT_VIOLATION,
    BUSINESS_REJECTED,
    RESOURCE_NOT_FOUND,
    CONFLICT_ALREADY_PROCESSED,
    CONFLICT_STALE_STATE,
    DUPLICATE_REQUEST,
    UNKNOWN_PROVIDER_FAILURE
}
```

Kemudian tambahkan metadata:

```java
public record DependencyFailure(
        String dependencyId,
        DependencyFailureKind kind,
        boolean retryable,
        boolean idempotencyRequired,
        boolean outcomeUnknown,
        boolean operatorActionRequired,
        boolean clientCorrectable,
        Integer httpStatus,
        String providerErrorCode,
        Duration retryAfter,
        String correlationId,
        String providerRequestId,
        String safeMessage
) {
}
```

Tujuannya bukan membuat class banyak-banyakan. Tujuannya agar sistem bisa mengambil keputusan yang benar.

---

### 4.2 Mapping provider error ke internal meaning

Provider error:

```json
{
  "code": "E1021",
  "message": "Invalid customer status"
}
```

Internal meaning:

```text
DEPENDENCY_BUSINESS_REJECTED_CUSTOMER_STATUS
retryable=false
clientCorrectable=false
operatorActionRequired=false
businessActionRequired=true
```

Provider error:

```json
{
  "code": "SYS_BUSY",
  "message": "System temporarily busy"
}
```

Internal meaning:

```text
PROVIDER_OVERLOADED
retryable=true
respectRetryAfter=true
circuitBreakerRecordFailure=true
```

Provider error:

```json
{
  "code": "DUPLICATE_TXN",
  "message": "Duplicate transaction reference"
}
```

Internal meaning:

```text
CONFLICT_ALREADY_PROCESSED
retryable=false
outcomeKnown=true
requiresReconciliationMaybe=true
```

---

## 5. External Client Architecture

### 5.1 Layering yang sehat

```text
Controller / Message Consumer
        |
Application Service
        |
Domain Service / Use Case
        |
External Gateway Interface
        |
External Client Adapter
        |
HTTP Client / SDK / SOAP Client
        |
Provider
```

Domain/application layer tidak boleh tahu detail:

- raw HTTP status;
- provider-specific JSON error shape;
- vendor SDK exception;
- OAuth token endpoint detail;
- retry implementation detail.

Adapter bertugas menerjemahkan external detail menjadi internal failure semantics.

---

### 5.2 Gateway interface harus domain-oriented

Buruk:

```java
public interface PaymentHttpClient {
    ResponseEntity<String> postPayment(String json);
}
```

Lebih baik:

```java
public interface PaymentGateway {
    PaymentSubmissionResult submitPayment(PaymentSubmissionCommand command);
}
```

Result-nya bisa explicit:

```java
public sealed interface PaymentSubmissionResult
        permits PaymentSubmissionResult.Accepted,
                PaymentSubmissionResult.Rejected,
                PaymentSubmissionResult.UnknownOutcome {

    record Accepted(String providerTransactionId) implements PaymentSubmissionResult {}

    record Rejected(String reasonCode, String safeMessage) implements PaymentSubmissionResult {}

    record UnknownOutcome(String idempotencyKey, String reason) implements PaymentSubmissionResult {}
}
```

Mengapa `UnknownOutcome` explicit?

Karena timeout/504 pada command side-effect tidak boleh dipaksa menjadi failed.

---

## 6. Timeout Design untuk External Call

### 6.1 Timeout harus lebih kecil dari caller deadline

Misal user request punya total budget 2 detik:

```text
HTTP request deadline: 2000 ms
internal validation:     50 ms
db read:                150 ms
external call:          800 ms
db write:               200 ms
response buffer:        100 ms
safety margin:          700 ms
```

Kalau external call timeout diset 5 detik, maka caller deadline sudah pasti jebol.

Rule:

> Downstream timeout harus berasal dari upstream deadline, bukan angka random dari konfigurasi global.

---

### 6.2 Pisahkan connection timeout dan read timeout

Contoh konfigurasi Java HTTP Client:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(300))
        .build();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://provider.example.com/api"))
        .timeout(Duration.ofMillis(900))
        .POST(HttpRequest.BodyPublishers.ofString(payload))
        .build();
```

Connection timeout pendek membantu cepat mendeteksi endpoint tidak reachable. Request timeout/read timeout menentukan batas keseluruhan call.

---

### 6.3 Timeout bukan pengganti cancellation

Kalau external call timeout tetapi local worker masih lanjut menjalankan task lain tanpa sadar deadline sudah habis, sistem bisa menciptakan orphan work.

Prinsip:

- propagate deadline;
- check cancellation sebelum side effect;
- jangan mulai external call jika sisa deadline tidak cukup;
- jangan retry jika sisa deadline tidak cukup;
- mark unknown outcome jika command sudah dikirim tetapi response tidak diterima.

---

## 7. Retry Design untuk External Integration

### 7.1 Retryability matrix

| Failure | Retry? | Condition |
|---|---:|---|
| DNS transient | maybe | bounded retry, idempotent operation |
| connection timeout | maybe | idempotent or safe command |
| read timeout | dangerous | unknown outcome, requires idempotency key |
| 400 invalid request | no | fix caller bug/request |
| 401 expired token | once | refresh token once |
| 403 forbidden | no | config/permission issue |
| 404 eventual consistency | maybe | dependency-specific |
| 409 duplicate | no direct retry | interpret as known outcome or conflict |
| 429 rate limited | later | respect Retry-After/backoff |
| 500 provider error | maybe | bounded retry |
| 503 overloaded | later | respect Retry-After, circuit breaker |
| malformed 200 | no | contract violation |

---

### 7.2 Retry harus punya budget

Retry tanpa budget bisa menyebabkan retry storm.

Minimal policy:

```text
maxAttempts: 3
delay: exponential backoff
jitter: enabled
retry only: transient transport, 502, 503, 504, 429 with delay
never retry: 400, 403, validation rejection, contract violation
stop if: deadline insufficient
require idempotency for side-effect command
```

---

### 7.3 Retry location

Retry bisa dilakukan di banyak tempat:

```text
browser/client
API gateway
our service
HTTP client library
message broker redelivery
job scheduler
provider SDK
```

Masalahnya kalau semua layer retry, total attempt bisa meledak.

Contoh:

```text
client retries 3x
API gateway retries 2x
service retries 3x
SDK retries 3x

Total possible provider calls = 3 * 2 * 3 * 3 = 54
```

Prinsip:

> Tetapkan retry owner. Jangan biarkan setiap layer retry tanpa koordinasi.

---

## 8. Circuit Breaker per Dependency

### 8.1 Circuit breaker harus dependency-specific

Buruk:

```text
one global circuit breaker for all external calls
```

Lebih baik:

```text
circuitBreaker.paymentProvider.submit
circuitBreaker.paymentProvider.query
circuitBreaker.identityProvider.token
circuitBreaker.identityProvider.userInfo
circuitBreaker.addressProvider.search
```

Mengapa?

Karena endpoint berbeda punya failure mode berbeda:

- token endpoint down tidak selalu berarti API endpoint down;
- submit command gagal tidak selalu berarti query gagal;
- search endpoint rate limited tidak selalu berarti validate endpoint rate limited.

---

### 8.2 Failure yang dicatat circuit breaker harus diseleksi

Jangan record semua exception sebagai circuit failure.

Record failure:

- connection timeout;
- read timeout;
- 5xx provider;
- 503 overloaded;
- repeated 429 maybe, tergantung policy;
- contract violation maybe, jika provider bug.

Do not record failure:

- 400 karena request kita salah;
- business rejection valid;
- 404 valid not found;
- 409 business conflict;
- validation failure dari caller.

Jika 400 ikut dihitung, circuit breaker bisa open karena bug caller, bukan karena provider down.

---

### 8.3 Half-open behavior harus aman

Saat circuit half-open, beberapa trial call diizinkan.

Pertanyaan penting:

- Trial call boleh command side-effect?
- Atau hanya health/query call?
- Jika command, apakah idempotent?
- Berapa concurrent trial?
- Apa yang terjadi jika trial timeout unknown outcome?

Untuk dependency kritikal, lebih aman half-open menggunakan read-only probe atau lightweight health endpoint jika provider mendukung.

---

## 9. Rate Limiter and Concurrency Control

### 9.1 Provider quota harus diterjemahkan menjadi local admission control

Jika provider memberi limit:

```text
300 requests/minute
```

Jangan konfigurasi local rate limiter tepat 300/minute tanpa headroom.

Better:

```text
local steady rate: 240-270/minute
burst: kecil dan terkontrol
retry: memakai budget terpisah
queue: bounded
```

Kenapa?

- ada clock skew;
- provider mungkin pakai sliding window;
- ada beberapa instance service;
- ada retry;
- ada traffic dari sistem lain;
- ada request manual/support;
- ada batch job.

---

### 9.2 Per-instance vs global limiter

Jika ada 5 pod dan limit provider 300/minute:

```text
Wrong:
  each pod limit = 300/minute
  total possible = 1500/minute

Better:
  each pod limit = 50/minute
  total = 250/minute
```

Atau gunakan distributed rate limiter jika butuh fairness dan adaptasi runtime.

---

### 9.3 Concurrency limiter berbeda dari rate limiter

Rate limiter menjawab:

```text
berapa request per unit waktu?
```

Concurrency limiter menjawab:

```text
berapa request sedang berjalan bersamaan?
```

Keduanya dibutuhkan.

Contoh:

```text
Provider bisa handle 300/minute tetapi response p99 2 detik.
Jika kita izinkan 300 concurrent call, thread/connection pool bisa habis.
```

---

## 10. Token Management Reliability

### 10.1 Token cache harus punya lifecycle

Token cache tidak cukup hanya:

```java
String token = cache.get("token");
```

Perlu metadata:

```java
public record AccessTokenState(
        String accessToken,
        Instant issuedAt,
        Instant expiresAt,
        Instant refreshAfter,
        String scope,
        String tokenType
) {
    boolean shouldRefresh(Clock clock) {
        return Instant.now(clock).isAfter(refreshAfter);
    }
}
```

Gunakan `refreshAfter` sebelum `expiresAt` agar tidak menunggu token benar-benar expired.

---

### 10.2 Single-flight refresh

Ketika token expired, 100 request bersamaan bisa semua mencoba refresh token.

Anti-pattern:

```text
100 threads see token expired
100 threads call token endpoint
provider rate limits token endpoint
all business calls fail
```

Better:

```text
only one thread/instance refreshes
others wait briefly or use still-valid token if within safe window
```

Pseudocode:

```java
public final class TokenProvider {
    private final ReentrantLock refreshLock = new ReentrantLock();
    private volatile AccessTokenState current;

    public String getToken() {
        AccessTokenState token = current;
        if (token != null && !token.shouldRefresh(Clock.systemUTC())) {
            return token.accessToken();
        }

        if (refreshLock.tryLock()) {
            try {
                AccessTokenState latest = current;
                if (latest != null && !latest.shouldRefresh(Clock.systemUTC())) {
                    return latest.accessToken();
                }
                current = fetchNewToken();
                return current.accessToken();
            } finally {
                refreshLock.unlock();
            }
        }

        AccessTokenState fallback = current;
        if (fallback != null && Instant.now().isBefore(fallback.expiresAt())) {
            return fallback.accessToken();
        }

        throw new ExternalAuthenticationUnavailableException("Token refresh already in progress");
    }
}
```

Untuk multi-pod, gunakan distributed coordination bila token endpoint sangat sensitif.

---

### 10.3 Retry original request after 401 hanya satu kali

```text
call with token
if 401 and token may be expired:
    invalidate token
    refresh token
    retry once
else:
    fail as auth error
```

Jangan retry 401 berkali-kali.

---

## 11. Idempotency for External Commands

### 11.1 Side-effect command harus punya idempotency key

Contoh command:

```text
submit application
create payment
send notification
reserve slot
create booking
trigger verification
```

Jika provider mendukung idempotency key, gunakan.

```http
POST /payments
Idempotency-Key: payment-2026-000123
```

Jika provider tidak mendukung idempotency, kita harus membuat strategi internal:

- local outbox;
- command ledger;
- reconciliation job;
- provider reference uniqueness;
- natural key;
- duplicate detection;
- manual resolution.

---

### 11.2 Unknown outcome handling

Jika timeout terjadi setelah request dikirim:

```text
status = UNKNOWN_OUTCOME
idempotencyKey = K123
nextAction = query provider by idempotency key or reconciliation reference
```

Jangan langsung mark failed.

Buruk:

```java
catch (TimeoutException e) {
    payment.markFailed();
}
```

Lebih benar:

```java
catch (ReadTimeoutException e) {
    payment.markSubmissionOutcomeUnknown(idempotencyKey);
    reconciliationQueue.enqueue(payment.id());
}
```

---

## 12. In-Flight Deduplication

Untuk request yang sama dalam waktu singkat, kita bisa dedup supaya tidak menembak provider berkali-kali.

Contoh:

```text
100 user requests search postal code 123456
only one actual provider call in-flight
99 requests wait for same result
```

Pseudocode:

```java
public final class InFlightDeduplicator<K, V> {
    private final ConcurrentHashMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();

    public CompletableFuture<V> execute(K key, Supplier<CompletableFuture<V>> supplier) {
        return inFlight.computeIfAbsent(key, ignored ->
                supplier.get().whenComplete((value, error) -> inFlight.remove(key))
        );
    }
}
```

Cocok untuk:

- read-only lookup;
- token refresh;
- geocoding by postal code;
- metadata fetch;
- reference data fetch.

Tidak cocok untuk:

- command dengan side effect berbeda;
- request yang harus punya audit terpisah;
- request yang hasilnya user-specific dan security-sensitive tanpa key yang benar.

---

## 13. Caching External Results

### 13.1 Cache bukan hanya performance tool

Cache bisa menjadi reliability tool:

- mengurangi provider load;
- menurunkan risiko rate limit;
- menyediakan stale fallback;
- mengurangi latency p99;
- mengurangi blast radius provider slowness.

Tetapi cache juga bisa menyebabkan correctness bug:

- stale decision;
- wrong user data;
- permission drift;
- regulatory error;
- privacy leak;
- data divergence.

---

### 13.2 Cache classification

| Data type | Cacheability |
|---|---|
| postal code geolocation | usually cacheable |
| reference code table | cacheable with TTL/version |
| user permission | careful, short TTL |
| financial balance | usually dangerous |
| eligibility result | depends on regulation |
| auth token | cacheable with secure handling |
| provider error | sometimes negative cache briefly |

---

### 13.3 Negative caching

Jika provider return stable not found untuk key tertentu, kita bisa cache negative result.

Tetapi hati-hati:

```text
404 because resource truly absent
```

berbeda dengan:

```text
404 because resource not replicated yet
```

Gunakan TTL pendek untuk negative cache jika eventual consistency mungkin terjadi.

---

## 14. Schema Drift and Contract Resilience

### 14.1 Defensive deserialization

Provider bisa menambah field baru. Client harus toleran terhadap unknown fields jika contract mengizinkan.

Namun client tidak boleh toleran terhadap field wajib yang hilang.

```text
unknown optional field: ignore/log debug
missing required field: contract violation
unknown enum: map to UNKNOWN only jika business logic aman
invalid type: contract violation
```

---

### 14.2 Unknown enum handling

Buruk:

```java
Status status = Status.valueOf(providerStatus);
```

Jika provider menambah enum baru, sistem crash.

Lebih baik:

```java
public enum ProviderStatus {
    APPROVED,
    REJECTED,
    PENDING,
    UNKNOWN;

    public static ProviderStatus fromExternal(String value) {
        return switch (value) {
            case "APPROVED" -> APPROVED;
            case "REJECTED" -> REJECTED;
            case "PENDING" -> PENDING;
            default -> UNKNOWN;
        };
    }
}
```

Tetapi `UNKNOWN` tidak boleh otomatis dianggap aman. Domain harus menentukan:

```text
UNKNOWN status => stop processing and require review
```

bukan:

```text
UNKNOWN status => treat as APPROVED
```

---

### 14.3 Consumer-driven contract tests

Untuk dependency yang penting, buat contract tests:

- expected request shape;
- expected response shape;
- error response shape;
- auth behavior;
- timeout behavior where possible;
- retryable status semantics;
- idempotency behavior.

Jika provider tidak menyediakan sandbox stabil, simpan contract fixture dan lakukan periodic verification.

---

## 15. Observability for External Integrations

### 15.1 Minimal telemetry

Setiap external dependency perlu metric:

```text
dependency_call_total{dependency, operation, outcome}
dependency_call_duration_seconds{dependency, operation}
dependency_failure_total{dependency, operation, failure_kind}
dependency_retry_total{dependency, operation, reason}
dependency_circuit_state{dependency, operation}
dependency_rate_limited_total{dependency, operation}
dependency_timeout_total{dependency, operation, timeout_type}
dependency_token_refresh_total{dependency, outcome}
dependency_contract_violation_total{dependency, field}
```

---

### 15.2 Log fields

Structured log external call failure harus punya:

```json
{
  "event": "external_dependency_call_failed",
  "dependency": "address-provider",
  "operation": "searchPostalCode",
  "failureKind": "RATE_LIMITED",
  "httpStatus": 429,
  "retryable": true,
  "outcomeUnknown": false,
  "attempt": 2,
  "maxAttempts": 3,
  "durationMs": 842,
  "retryAfterMs": 30000,
  "correlationId": "...",
  "providerRequestId": "..."
}
```

Jangan log:

- access token;
- refresh token;
- client secret;
- full PII payload;
- raw provider body jika mengandung sensitive data.

---

### 15.3 Trace spans

Setiap external call idealnya menjadi span:

```text
span.name = external.address-provider.searchPostalCode
attributes:
  dependency.name
  dependency.operation
  http.status_code
  retry.attempt
  circuit.state
  rate_limit.remaining if available
  error.kind
```

Trace membantu menjawab:

- latency habis di mana?
- retry terjadi berapa kali?
- timeout terjadi setelah call mana?
- apakah circuit breaker open?
- apakah provider failure menyebar ke user request?

---

## 16. Security Reliability in External Integrations

### 16.1 Credential handling

Prinsip:

- credentials dari secret manager, bukan hardcoded;
- rotate secret harus bisa tanpa full redeploy jika memungkinkan;
- token disimpan aman;
- jangan log token;
- jangan kirim token ke frontend jika tidak perlu;
- gunakan least privilege;
- pisahkan credential per dependency/environment;
- monitor auth failure spike.

---

### 16.2 Fail-closed untuk security dependency

Jika dependency adalah authorization/risk/security check, fallback success biasanya berbahaya.

Contoh:

```text
fraud check unavailable => approve transaction
```

Ini fail-open dan sering tidak defensible.

Lebih aman:

```text
fraud check unavailable => pending manual review / reject temporarily / queue for later
```

Tergantung domain.

---

## 17. Fallback and Degradation for External Integration

### 17.1 Decision matrix

| Dependency role | Fallback allowed? | Example |
|---|---|---|
| optional enrichment | yes | missing avatar, recommendation |
| reference data | maybe | stale cache |
| address lookup | maybe | manual input allowed |
| notification sending | async retry | email/SMS queue |
| payment submission | no fake success | unknown outcome/reconciliation |
| identity verification | usually no | fail closed/pending |
| audit trail sink | no silent drop | local durable buffer/outbox |

---

### 17.2 Fallback harus terlihat

Fallback response harus bisa diamati.

Buruk:

```text
provider down => return empty list
```

Kalau empty list bermakna “tidak ada data”, client akan salah mengambil keputusan.

Lebih baik:

```json
{
  "data": [],
  "degraded": true,
  "degradationReason": "ADDRESS_PROVIDER_UNAVAILABLE"
}
```

Atau fail explicit jika domain tidak boleh degrade.

---

## 18. Reconciliation Pattern

Untuk command eksternal dengan unknown outcome, reconciliation adalah wajib.

### 18.1 Reconciliation ledger

Simpan:

```text
internalCommandId
idempotencyKey
providerReference
requestHash
submittedAt
lastAttemptAt
currentStatus
outcomeKnown
nextReconciliationAt
attemptCount
lastFailureKind
operatorNote
```

### 18.2 Reconciliation flow

```text
1. Submit command to provider.
2. Timeout/read failure happens.
3. Mark internal state as OUTCOME_UNKNOWN.
4. Enqueue reconciliation task.
5. Query provider by idempotency key/reference.
6. If provider confirms success: mark success.
7. If provider confirms not found and safe retry window remains: retry submit.
8. If still unknown after threshold: escalate to manual review.
```

---

## 19. Shutdown Interaction

External calls during shutdown need special handling.

When application enters draining mode:

- stop accepting new user work;
- stop starting new external commands if insufficient shutdown budget;
- allow safe in-flight calls to complete within deadline;
- cancel read-only calls if caller no longer needs them;
- do not start token refresh storm;
- persist unknown outcome before exit;
- flush outbox/ledger state before stopping;
- stop workers before closing HTTP client if worker uses it.

Shutdown bug example:

```text
SIGTERM received
worker continues processing message
external submit succeeds
app is killed before DB state is updated
message re-delivered later
external submit happens again
```

Mitigation:

- idempotency key;
- outbox/ledger before external call;
- ack message only after durable state update;
- graceful worker drain;
- bounded shutdown budget.

---

## 20. Example: External Address Provider Client

### 20.1 Requirements

```text
Provider:
- Search by 6-digit postal code.
- Requires bearer token.
- Rate limit 300/minute.
- Token expires after 1 hour.
- 401 may mean token expired.
- 429 may include Retry-After.
- 5xx transient.

Our policy:
- Local rate limit 250/minute.
- Cache exact postal code result for 24 hours.
- In-flight dedup per postal code.
- Refresh token single-flight.
- Retry 401 once after refresh.
- Retry 5xx max 2 attempts with jitter.
- Do not retry malformed response.
- Return degraded/manual-entry path if provider unavailable.
```

---

### 20.2 Domain gateway

```java
public interface AddressLookupGateway {
    AddressLookupResult lookupByPostalCode(PostalCode postalCode);
}
```

```java
public sealed interface AddressLookupResult
        permits AddressLookupResult.Found,
                AddressLookupResult.NotFound,
                AddressLookupResult.Unavailable,
                AddressLookupResult.ContractViolation {

    record Found(String postalCode, String roadName, String building, String country)
            implements AddressLookupResult {}

    record NotFound(String postalCode) implements AddressLookupResult {}

    record Unavailable(String reasonCode, boolean retryable) implements AddressLookupResult {}

    record ContractViolation(String reasonCode) implements AddressLookupResult {}
}
```

---

### 20.3 Adapter skeleton

```java
public final class ProviderAddressLookupGateway implements AddressLookupGateway {
    private final ProviderHttpClient httpClient;
    private final TokenProvider tokenProvider;
    private final AddressCache cache;
    private final InFlightDeduplicator<String, AddressLookupResult> deduplicator;
    private final ExternalFailureClassifier classifier;

    @Override
    public AddressLookupResult lookupByPostalCode(PostalCode postalCode) {
        String key = postalCode.value();

        AddressLookupResult cached = cache.get(key);
        if (cached != null) {
            return cached;
        }

        return deduplicator.execute(key, () -> CompletableFuture.supplyAsync(() -> fetchAndClassify(postalCode)))
                .join();
    }

    private AddressLookupResult fetchAndClassify(PostalCode postalCode) {
        try {
            String token = tokenProvider.getToken();
            ProviderAddressResponse response = httpClient.search(postalCode, token);
            AddressLookupResult result = mapSuccess(response);
            cache.put(postalCode.value(), result);
            return result;
        } catch (ProviderHttpException e) {
            DependencyFailure failure = classifier.classify(e);
            return mapFailure(failure);
        } catch (ExternalContractViolationException e) {
            return new AddressLookupResult.ContractViolation("PROVIDER_CONTRACT_VIOLATION");
        }
    }

    private AddressLookupResult mapFailure(DependencyFailure failure) {
        return switch (failure.kind()) {
            case RESOURCE_NOT_FOUND -> new AddressLookupResult.NotFound("unknown");
            case RATE_LIMITED, PROVIDER_OVERLOADED, CONNECTION_TIMEOUT, READ_TIMEOUT_UNKNOWN_OUTCOME ->
                    new AddressLookupResult.Unavailable(failure.kind().name(), failure.retryable());
            default -> new AddressLookupResult.Unavailable("ADDRESS_PROVIDER_FAILURE", false);
        };
    }
}
```

Catatan: production code perlu menghindari `join()` blocking sembarangan jika berada di reactive/event-loop context. Di sini skeleton dipakai untuk menjelaskan boundary pattern.

---

## 21. Example: External Command with Unknown Outcome

### 21.1 Flow

```text
Use case: submit application to external regulator system.
```

Possible outcomes:

```text
ACCEPTED
REJECTED
UNKNOWN_OUTCOME
DEPENDENCY_UNAVAILABLE_BEFORE_SEND
CONTRACT_VIOLATION
```

### 21.2 Ledger-first design

```java
@Transactional
public SubmissionResult submit(SubmitApplicationCommand command) {
    Application app = applicationRepository.get(command.applicationId());
    app.ensureSubmittable();

    String idempotencyKey = idempotencyKeyFactory.forApplicationSubmission(app.id());

    SubmissionLedger ledger = submissionLedgerRepository.createOrGet(
            app.id(),
            idempotencyKey,
            hash(command)
    );

    if (ledger.isKnownSuccess()) {
        return SubmissionResult.alreadyAccepted(ledger.providerReference());
    }

    // transaction commits ledger before external side effect if using outbox-style workflow
    return SubmissionResult.acceptedForProcessing(app.id());
}
```

Worker:

```java
public void processSubmission(SubmissionLedgerId ledgerId) {
    SubmissionLedger ledger = repository.get(ledgerId);

    try {
        ProviderSubmitResponse response = provider.submit(
                ledger.toProviderRequest(),
                ledger.idempotencyKey()
        );

        repository.markAccepted(ledgerId, response.providerReference());
        message.ack();
    } catch (ReadTimeoutException | GatewayTimeoutException e) {
        repository.markOutcomeUnknown(ledgerId, e.getMessage());
        reconciliationQueue.enqueue(ledgerId);
        message.ack();
    } catch (ProviderRejectedException e) {
        repository.markRejected(ledgerId, e.providerCode());
        message.ack();
    } catch (TransientProviderException e) {
        message.nackRequeueWithBackoff();
    }
}
```

Key principle:

> External side effect harus dikaitkan dengan durable local intent sebelum dipanggil.

---

## 22. Anti-Patterns

### 22.1 Treating all external failures as 500

Masalah:

- client tidak tahu harus retry atau tidak;
- operator tidak tahu apakah provider down atau request invalid;
- SLO error menjadi noisy;
- retry policy tidak bisa cerdas.

---

### 22.2 Retrying all exceptions

Masalah:

- memperparah provider overload;
- duplicate side effect;
- retry storm;
- thread starvation;
- quota exhaustion.

---

### 22.3 Fallback to fake success

Contoh buruk:

```text
payment provider unavailable => return payment success
```

Ini menciptakan data divergence dan incident yang lebih mahal.

---

### 22.4 Logging full request/response

Masalah:

- PII leakage;
- token leakage;
- credential leakage;
- regulatory violation;
- log storage bloat.

---

### 22.5 Ignoring provider request ID

Banyak provider mengembalikan request ID/correlation ID. Jika tidak disimpan, investigasi cross-party menjadi sulit.

---

### 22.6 One timeout for everything

Connection timeout, read timeout, total deadline, pool acquisition timeout, dan shutdown timeout punya fungsi berbeda. Satu angka global biasanya salah.

---

### 22.7 SDK blind trust

Vendor SDK kadang punya retry default tersembunyi. Selalu cek:

- default timeout;
- default retry;
- retryable status;
- max attempts;
- connection pool;
- metrics exposure;
- thread model;
- shutdown behavior.

---

## 23. Production Checklist

### 23.1 Contract and semantics

- [ ] Setiap dependency punya `dependencyId` dan operation name.
- [ ] Ada dependency-specific failure taxonomy.
- [ ] Provider error code dimapping ke internal failure kind.
- [ ] 4xx tidak disamakan dengan 5xx.
- [ ] Business rejection tidak dianggap provider outage.
- [ ] Malformed success response dianggap contract violation.
- [ ] Unknown outcome dimodelkan eksplisit.

### 23.2 Timeout and retry

- [ ] Connection timeout diset eksplisit.
- [ ] Read/request timeout diset eksplisit.
- [ ] Timeout berasal dari caller deadline.
- [ ] Retry hanya untuk failure yang benar-benar retryable.
- [ ] Retry punya max attempts.
- [ ] Retry memakai backoff dan jitter.
- [ ] Retry berhenti jika deadline tidak cukup.
- [ ] Retry command membutuhkan idempotency.

### 23.3 Token/auth

- [ ] Token cache punya expiry dan refresh window.
- [ ] Token refresh single-flight.
- [ ] 401 retry maksimal satu kali setelah refresh.
- [ ] Credential failure tidak masuk infinite retry.
- [ ] Token tidak dilog.
- [ ] Secret rotation dipikirkan.

### 23.4 Rate limit and load control

- [ ] Local rate limiter di bawah provider limit.
- [ ] Multi-pod quota dihitung.
- [ ] Ada concurrency limiter untuk slow provider.
- [ ] `Retry-After` dihormati.
- [ ] 429 dimonitor.
- [ ] Batch job tidak menghabiskan quota interactive flow.

### 23.5 Idempotency and reconciliation

- [ ] Side-effect command punya idempotency key.
- [ ] Local ledger/outbox ada sebelum external side effect.
- [ ] Timeout setelah send dimark unknown outcome.
- [ ] Reconciliation job tersedia.
- [ ] Duplicate provider response dimapping benar.
- [ ] Manual review path tersedia untuk unresolved outcome.

### 23.6 Observability

- [ ] Metric per dependency/operation/outcome tersedia.
- [ ] Retry count dimonitor.
- [ ] Circuit breaker state dimonitor.
- [ ] Rate limit failure dimonitor.
- [ ] Contract violation dimonitor.
- [ ] Provider request ID disimpan.
- [ ] Logs structured dan redacted.

### 23.7 Shutdown

- [ ] Draining mode mencegah external command baru yang tidak aman.
- [ ] Worker stop polling sebelum shutdown dependency client.
- [ ] In-flight external command punya deadline.
- [ ] Unknown outcome dipersist sebelum exit.
- [ ] Message ack/nack dilakukan setelah state durable.

---

## 24. Review Questions

1. Apakah setiap external dependency di sistemmu sudah punya failure taxonomy sendiri?
2. Apakah timeout pada command side-effect diperlakukan sebagai failed atau unknown outcome?
3. Apakah retry policy membutuhkan idempotency key untuk POST/command?
4. Apakah provider 429 dihormati dengan local rate limiter dan `Retry-After`?
5. Apakah 401 token expired hanya retry sekali setelah refresh?
6. Apakah token refresh bisa menyebabkan refresh storm?
7. Apakah circuit breaker mencatat 400 sebagai provider failure?
8. Apakah fallback response bisa dibedakan dari real response?
9. Apakah malformed 200 response dianggap sukses?
10. Apakah provider request ID disimpan untuk incident investigation?
11. Apakah SDK vendor punya default retry tersembunyi?
12. Apakah shutdown bisa terjadi setelah external side effect tetapi sebelum local DB update?
13. Apakah reconciliation tersedia untuk unknown outcome?
14. Apakah logs mengandung token/PII/full provider payload?
15. Apakah external integration punya dashboard sendiri?

---

## 25. Key Takeaways

1. External API bukan local method call; ia adalah unreliable distributed boundary.
2. Timeout tidak membuktikan operasi gagal; timeout sering berarti outcome unknown.
3. Retry tanpa idempotency bisa mengubah transient failure menjadi data corruption.
4. 401, 403, 429, 500, 503, 504 punya reliability meaning yang berbeda.
5. Provider error code harus diterjemahkan menjadi internal failure semantics.
6. Circuit breaker harus per dependency/operation dan tidak boleh mencatat business rejection sebagai provider outage.
7. Rate limit harus dikontrol dari sisi client dengan headroom, bukan hanya bereaksi pada 429.
8. Token refresh perlu single-flight agar tidak menciptakan auth storm.
9. Fallback harus explicit dan observable; fake success lebih buruk daripada failure.
10. Unknown outcome membutuhkan durable ledger dan reconciliation.
11. Observability external integration harus menjawab dependency mana, operation mana, failure kind apa, retry berapa kali, dan provider request ID apa.
12. Shutdown harus mempertimbangkan external side effect yang sedang berjalan, bukan hanya menutup HTTP server.

---

## 26. References

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
- AWS Builders Library — Timeouts, retries, and backoff with jitter: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
- Resilience4j Documentation: https://resilience4j.readme.io/docs/getting-started
- Resilience4j CircuitBreaker: https://resilience4j.readme.io/docs/circuitbreaker
- Google SRE Book — Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/

---

## 27. Series Progress

```text
Part 020 / 030 completed
Seri belum selesai.
```

Part berikutnya:

```text
Part 021 — Data Reliability and Persistence Failure
```

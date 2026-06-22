# Part 31 — Advanced Patterns: Fan-Out Aggregator, Token Single-Flight, Client-Side Cache, Idempotent Command

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
Target: Java 8 hingga Java 25  
Level: Advanced / production engineering  
File: `31-advanced-patterns-fanout-token-singleflight-cache-idempotent-command.md`

---

## 1. Tujuan Part Ini

Pada part sebelumnya, kita sudah membangun fondasi: lifecycle request, timeout, pooling, DNS, TLS, auth, retry, rate limit, circuit breaker, observability, testing, performance, concurrency, security, generated client, configuration, dan incident playbook.

Part ini masuk ke pola-pola yang lebih tinggi: bukan lagi “bagaimana melakukan HTTP call”, tetapi **bagaimana menyusun beberapa HTTP call menjadi perilaku sistem yang benar, efisien, aman, dan tahan failure**.

Advanced pattern yang akan dibahas:

1. Fan-out aggregator.
2. Scatter-gather.
3. Token single-flight refresh.
4. Request coalescing / in-flight deduplication.
5. Client-side cache.
6. Stale-while-revalidate.
7. Idempotent command client.
8. Outbox + HTTP delivery.
9. Polling client untuk long-running operation.
10. Pagination abstraction.
11. Cursor/offset/page-token iterator.
12. Partial failure policy.
13. Race/fallback request.
14. Hedging yang aman.
15. Multi-endpoint failover.
16. Client workflow orchestration.

Tujuan utamanya adalah membangun keluwesan desain. Engineer top-tier tidak hanya tahu API library, tetapi bisa bertanya:

> “Apa semantik operasi ini? Apakah aman diulang? Apakah boleh partial? Apakah boleh stale? Apakah response perlu konsisten antar downstream? Apa batas beban keluar? Apa yang terjadi jika auth refresh berbarengan 1.000 request? Apa yang terjadi jika polling berjalan selamanya?”

---

## 2. Mental Model: Advanced HTTP Client Pattern Adalah Control Flow + Semantics + Failure Policy

HTTP client biasa biasanya berpikir seperti ini:

```text
request → response
```

Advanced HTTP client berpikir seperti ini:

```text
business intent
→ external dependency graph
→ concurrency plan
→ timeout/deadline budget
→ idempotency model
→ cache/freshness model
→ auth/token lifecycle
→ retry/rate/bulkhead policy
→ error/partial failure policy
→ domain-safe result
→ telemetry/audit
```

Perbedaannya besar.

Contoh sederhana: aplikasi butuh menampilkan profil customer.

Naive implementation:

```text
call customer-service
call address-service
call risk-service
call notification-preference-service
return combined response
```

Advanced implementation bertanya:

```text
Apakah semua call wajib?
Apakah risk-service boleh stale?
Apakah address-service timeout boleh fallback ke cached value?
Apakah preference-service failure harus menggagalkan seluruh response?
Apakah semua call perlu parallel?
Apakah ada global deadline 800 ms?
Apakah retry pada tiap downstream akan mengamplifikasi beban?
Apakah response butuh konsistensi snapshot?
Apakah hasil harus diaudit?
Apakah ada data yang tidak boleh dilog?
```

Advanced pattern bukan sekadar pattern code. Ia adalah **cara memindahkan business semantics ke client boundary**.

---

## 3. Baseline Library dan Konsep yang Relevan

Beberapa konsep/library yang sering muncul dalam pattern ini:

- JDK `HttpClient.sendAsync` mengembalikan `CompletableFuture<HttpResponse<T>>`, sehingga cocok untuk komposisi asynchronous dan fan-out ringan di Java 11+.
- OkHttp menyediakan `Call`, `Dispatcher`, `ConnectionPool`, interceptor, cache, dan event listener; cocok sebagai transport engine yang efisien, termasuk saat dipakai oleh Retrofit.
- Retrofit cocok untuk membungkus external API sebagai Java interface type-safe.
- Resilience4j menyediakan decorator seperti retry, circuit breaker, rate limiter, dan bulkhead yang dapat dikomposisi pada operasi synchronous/asynchronous.
- Caffeine sering dipakai untuk in-memory client-side cache dengan eviction, expiry, refresh, dan async loading.

Catatan penting: library hanyalah alat. Pattern tetap harus didesain dari semantics operasi.

---

## 4. Taxonomy Advanced Pattern

Kita bisa kelompokkan pattern menjadi beberapa keluarga.

### 4.1 Coordination Pattern

Pattern untuk mengatur banyak call:

```text
fan-out
scatter-gather
parallel compose
race request
fallback chain
multi-endpoint failover
```

Pertanyaan utama:

```text
Mana yang wajib?
Mana yang opsional?
Mana yang boleh telat?
Mana yang boleh stale?
Mana yang boleh gagal?
Mana yang harus konsisten?
```

### 4.2 Deduplication Pattern

Pattern untuk menghindari call duplikat:

```text
single-flight
in-flight deduplication
request coalescing
client-side cache
negative cache
```

Pertanyaan utama:

```text
Apakah banyak request identik sedang meminta data yang sama?
Apakah perlu satu request saja ke downstream?
Apakah error juga boleh di-cache sementara?
```

### 4.3 Command Safety Pattern

Pattern untuk operasi write/side-effect:

```text
idempotency key
idempotent command client
outbox delivery
deduplication key
reconciliation
```

Pertanyaan utama:

```text
Jika request dikirim dua kali, apa akibatnya?
Jika timeout terjadi setelah downstream menerima request, bolehkah retry?
Bagaimana membuktikan command pernah dikirim?
```

### 4.4 Long Interaction Pattern

Pattern untuk operasi yang tidak selesai langsung:

```text
polling
long-running operation client
pagination iterator
cursor iterator
streaming download
batch page processor
```

Pertanyaan utama:

```text
Bagaimana menghindari loop tanpa batas?
Bagaimana resume dari checkpoint?
Bagaimana backoff antar poll?
Bagaimana membatasi memory?
```

---

## 5. Fan-Out Aggregator

### 5.1 Apa Itu Fan-Out Aggregator?

Fan-out aggregator adalah client/service yang menerima satu intent, lalu memanggil beberapa downstream, kemudian menggabungkan hasilnya.

```text
Incoming request
      |
      v
Aggregator
  |      |       |
  v      v       v
API A   API B   API C
  |      |       |
  +------+-------+
         |
         v
Combined result
```

Contoh:

```text
GET /customer-dashboard/{id}
→ customer profile API
→ account API
→ risk API
→ notification preference API
→ document summary API
```

### 5.2 Kenapa Fan-Out Berbahaya?

Karena fan-out memperbesar probabilitas failure.

Jika setiap downstream punya success probability 99%, dan aggregator membutuhkan 5 downstream semuanya sukses:

```text
0.99^5 = 0.95099
```

Artinya reliability end-to-end turun menjadi sekitar 95.1% jika semua wajib.

Jika 10 downstream:

```text
0.99^10 = 0.904
```

Jadi fan-out bukan hanya masalah performa. Fan-out adalah **reliability multiplier**.

### 5.3 Naive Fan-Out Anti-Pattern

```java
Dashboard load(String customerId) {
    Customer customer = customerClient.get(customerId);
    Accounts accounts = accountClient.list(customerId);
    Risk risk = riskClient.get(customerId);
    Preferences preferences = preferenceClient.get(customerId);

    return Dashboard.of(customer, accounts, risk, preferences);
}
```

Masalah:

1. Sequential latency = total latency semua call.
2. Tidak ada deadline global.
3. Tidak ada partial failure policy.
4. Tidak ada bounded concurrency.
5. Tidak ada per-downstream criticality.
6. Tidak ada observability per branch.
7. Retry tiap client dapat mengamplifikasi latency.

### 5.4 Fan-Out yang Lebih Sehat

Pertama, kategorikan downstream.

```text
Required:
- customer profile
- account summary

Optional:
- notification preference
- recommendation

Stale-allowed:
- risk score, max stale 5 minutes

Fail-closed:
- compliance block status

Fail-open:
- marketing banner
```

Kemudian desain result model.

```java
public final class DashboardResult {
    private final CustomerProfile profile;
    private final AccountSummary accounts;
    private final Optional<RiskScore> riskScore;
    private final Optional<NotificationPreference> preference;
    private final List<PartialFailure> partialFailures;
    private final Freshness freshness;

    // constructor/getters
}
```

Jangan sembunyikan partial failure jika partial failure relevan untuk downstream consumer atau audit.

### 5.5 Fan-Out dengan CompletableFuture

Contoh sederhana Java 11+:

```java
public DashboardResult loadDashboard(String customerId) {
    Duration deadline = Duration.ofMillis(900);
    Instant startedAt = Instant.now();

    CompletableFuture<CustomerProfile> profileFuture =
            CompletableFuture.supplyAsync(() -> profileClient.get(customerId), executor);

    CompletableFuture<AccountSummary> accountFuture =
            CompletableFuture.supplyAsync(() -> accountClient.getSummary(customerId), executor);

    CompletableFuture<Optional<RiskScore>> riskFuture =
            CompletableFuture.supplyAsync(() -> Optional.of(riskClient.get(customerId)), executor)
                    .completeOnTimeout(Optional.empty(), 250, TimeUnit.MILLISECONDS)
                    .exceptionally(ex -> Optional.empty());

    CompletableFuture<Optional<NotificationPreference>> prefFuture =
            CompletableFuture.supplyAsync(() -> Optional.of(preferenceClient.get(customerId)), executor)
                    .completeOnTimeout(Optional.empty(), 150, TimeUnit.MILLISECONDS)
                    .exceptionally(ex -> Optional.empty());

    CompletableFuture<Void> required = CompletableFuture.allOf(profileFuture, accountFuture);

    try {
        required.get(remainingMillis(startedAt, deadline), TimeUnit.MILLISECONDS);
    } catch (Exception e) {
        throw new DashboardUnavailableException("Required downstream failed", e);
    }

    return new DashboardResult(
            profileFuture.join(),
            accountFuture.join(),
            safeJoinOptional(riskFuture),
            safeJoinOptional(prefFuture),
            collectPartialFailures(riskFuture, prefFuture),
            Freshness.now()
    );
}
```

Ini belum sempurna, tetapi lebih baik dari sequential naive call.

Masih perlu:

1. Bounded executor.
2. Per-client bulkhead.
3. Proper cancellation.
4. Trace/span per branch.
5. Deadline propagation.
6. Error classification.

### 5.6 Fan-Out dengan Virtual Threads

Java 21+ membuat blocking style lebih murah untuk I/O-bound call.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<CustomerProfile> profile = executor.submit(() -> profileClient.get(customerId));
    Future<AccountSummary> accounts = executor.submit(() -> accountClient.getSummary(customerId));
    Future<RiskScore> risk = executor.submit(() -> riskClient.get(customerId));

    return DashboardResult.required(
            profile.get(400, TimeUnit.MILLISECONDS),
            accounts.get(400, TimeUnit.MILLISECONDS),
            tryGetOptional(risk, 200, TimeUnit.MILLISECONDS)
    );
}
```

Virtual thread mengurangi biaya thread blocking, tetapi tidak menghapus kebutuhan:

```text
bounded concurrency
bulkhead
rate limit
timeout
cancellation
pool sizing
retry budget
```

Jika 10.000 virtual thread memanggil downstream yang sama tanpa bulkhead, downstream tetap bisa hancur.

### 5.7 Fan-Out dengan Structured Concurrency

Konsep structured concurrency membantu memperlakukan beberapa subtask sebagai satu unit kerja.

Mental model:

```text
scope starts
  fork task A
  fork task B
  fork task C
  wait/join with policy
  cancel unfinished tasks if needed
scope ends
```

Keuntungan:

1. Cancellation lebih jelas.
2. Tidak ada task yatim.
3. Failure propagation lebih eksplisit.
4. Deadline bisa dikelola per scope.

Walaupun API structured concurrency mengalami evolusi across Java preview/incubator, mental model-nya sangat penting untuk desain HTTP fan-out modern.

---

## 6. Partial Failure Policy

### 6.1 Pertanyaan Paling Penting

Dalam aggregator, pertanyaan kuncinya bukan “bagaimana handle exception”, tetapi:

> Jika salah satu dependency gagal, apakah hasil utama masih valid?

Klasifikasi dependency:

| Dependency Type | Failure Policy | Contoh |
|---|---|---|
| Required | Fail whole operation | identity verification |
| Optional | Return partial result | recommendation |
| Stale-allowed | Return cached stale data | exchange rate display |
| Fail-open | Continue as permissive | non-critical banner |
| Fail-closed | Block operation | sanction/compliance check |
| Defer-able | Queue/process later | notification send |

### 6.2 Fail-Open vs Fail-Closed

Ini sangat penting di sistem regulasi/keamanan.

```text
Fail-open:
Downstream gagal → izinkan operasi lanjut.

Fail-closed:
Downstream gagal → blokir operasi.
```

Contoh fail-closed:

```text
Jika compliance blacklist service tidak bisa dicek,
jangan izinkan high-risk transaction.
```

Contoh fail-open:

```text
Jika recommendation service gagal,
tetap tampilkan dashboard tanpa recommendation.
```

Kesalahan fatal: memperlakukan semua downstream sama.

### 6.3 Result Envelope untuk Partial Failure

```java
public final class AggregatedResult<T> {
    private final T data;
    private final boolean partial;
    private final List<ComponentFailure> failures;
    private final Map<String, Freshness> freshnessByComponent;
}
```

Contoh component failure:

```java
public final class ComponentFailure {
    private final String component;
    private final FailureType type;
    private final boolean retryable;
    private final boolean userVisible;
    private final String safeMessage;
}
```

Partial failure tidak selalu harus dikirim ke end-user, tetapi harus tersedia untuk observability/audit.

---

## 7. Token Single-Flight Refresh

### 7.1 Problem: Token Refresh Stampede

Misal access token expired. Ada 500 concurrent request. Semua mendeteksi token expired dan semua memanggil token endpoint.

```text
500 application requests
       |
       v
500 token refresh requests
       |
       v
auth server overloaded
```

Ini disebut refresh stampede.

### 7.2 Prinsip Single-Flight

Untuk key yang sama, hanya satu operation yang berjalan. Request lain menunggu hasil operation tersebut.

```text
request A sees expired token → starts refresh
request B sees expired token → waits refresh A
request C sees expired token → waits refresh A

refresh A completes → A/B/C reuse same token
```

### 7.3 Token Cache Model

Token cache minimal:

```java
public final class AccessTokenState {
    private final String token;
    private final Instant expiresAt;

    public boolean isUsable(Clock clock, Duration skew) {
        return token != null && Instant.now(clock).plus(skew).isBefore(expiresAt);
    }
}
```

Gunakan expiry skew.

```text
expires_at = 12:00:00
skew = 60 seconds
client considers token expired at 11:59:00
```

Ini mencegah request dikirim dengan token yang hampir expired.

### 7.4 Single-Flight Implementation dengan CompletableFuture

```java
public final class TokenProvider {
    private final AtomicReference<AccessTokenState> current = new AtomicReference<>();
    private final AtomicReference<CompletableFuture<AccessTokenState>> inFlightRefresh = new AtomicReference<>();
    private final TokenEndpointClient tokenClient;
    private final Clock clock;
    private final Duration skew = Duration.ofSeconds(60);

    public String getToken() {
        AccessTokenState state = current.get();
        if (state != null && state.isUsable(clock, skew)) {
            return state.token();
        }

        return refreshSingleFlight().join().token();
    }

    private CompletableFuture<AccessTokenState> refreshSingleFlight() {
        CompletableFuture<AccessTokenState> existing = inFlightRefresh.get();
        if (existing != null) {
            return existing;
        }

        CompletableFuture<AccessTokenState> created = CompletableFuture.supplyAsync(() -> {
            AccessTokenState refreshed = tokenClient.requestToken();
            current.set(refreshed);
            return refreshed;
        });

        if (inFlightRefresh.compareAndSet(null, created)) {
            created.whenComplete((ok, ex) -> inFlightRefresh.compareAndSet(created, null));
            return created;
        }

        return inFlightRefresh.get();
    }
}
```

Catatan production:

1. Tambahkan timeout untuk token endpoint.
2. Tambahkan retry terbatas untuk token endpoint jika aman.
3. Jangan retry semua request jika token endpoint down.
4. Jangan log token.
5. Pisahkan token per tenant/client credential.
6. Cache key harus mencakup tenant/scope/audience.

### 7.5 Cache Key untuk Token

Token cache key tidak boleh terlalu sederhana.

Buruk:

```text
token
```

Lebih benar:

```text
client_id + tenant_id + audience + scope set + environment
```

Karena token untuk scope berbeda tidak boleh tertukar.

### 7.6 Refresh Setelah 401

Ada dua jenis 401:

```text
Token expired/revoked → refresh mungkin berguna
Credential invalid/scope invalid → refresh tidak berguna
```

Pattern:

1. Kirim request dengan token saat ini.
2. Jika 401 dan error code menunjukkan token expired, invalidate token.
3. Refresh single-flight.
4. Retry sekali jika operation retryable.
5. Jika masih 401, fail.

Jangan infinite refresh loop.

---

## 8. Request Coalescing / In-Flight Deduplication

### 8.1 Problem

Banyak request masuk menanyakan data yang sama dalam waktu hampir bersamaan.

```text
100 calls getPostalCode("123456")
→ 100 outbound calls ke address API
```

Padahal satu outbound call cukup.

### 8.2 In-Flight Dedup

```text
first request starts outbound call
subsequent same-key requests join same future
when completed, all receive same result
```

### 8.3 Implementation Sketch

```java
public final class InFlightDeduplicator<K, V> {
    private final ConcurrentHashMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();

    public CompletableFuture<V> getOrStart(K key, Supplier<CompletableFuture<V>> operation) {
        return inFlight.computeIfAbsent(key, k -> {
            CompletableFuture<V> future = operation.get();
            future.whenComplete((result, error) -> inFlight.remove(k, future));
            return future;
        });
    }
}
```

Usage:

```java
CompletableFuture<Address> future = dedup.getOrStart(
        postalCode,
        () -> addressClient.lookupAsync(postalCode)
);
```

### 8.4 Cache Key Correctness

Dedup key harus mencakup semua input yang mempengaruhi hasil.

Contoh address lookup:

```text
postalCode + country + language + API version
```

Contoh user-specific call:

```text
userId + tenantId + authorization scope + locale
```

Jangan dedup response yang authorization-dependent tanpa memasukkan identity/scope ke key.

### 8.5 Error Deduplication

Jika outbound call gagal, semua waiter menerima error yang sama.

Pertanyaan:

```text
Apakah error boleh langsung di-share?
Apakah error perlu negative-cache sebentar?
Apakah caller boleh retry sendiri?
```

Untuk failure yang mahal dan kemungkinan tetap gagal, negative cache singkat bisa melindungi downstream.

```text
404 stable → boleh cache 30s/5m tergantung domain
503 transient → jangan cache lama
429 → cache throttle state sampai Retry-After
```

---

## 9. Client-Side Cache

### 9.1 Kenapa Client-Side Cache?

Client-side cache dapat mengurangi:

1. Latency.
2. Load downstream.
3. Cost.
4. Failure exposure.
5. Rate limit pressure.

Tetapi cache juga menambah risiko:

1. Stale data.
2. Authorization leak.
3. Invalidasi sulit.
4. Memory pressure.
5. Inconsistent behavior.

### 9.2 Kapan Cache Cocok?

Cocok:

```text
reference data
configuration data
public catalog
postal/address lookup
currency display rate with TTL
feature metadata
idempotent GET dengan stable result
```

Tidak cocok atau perlu sangat hati-hati:

```text
permission/authorization result
compliance/sanction result
financial balance real-time
highly personalized data
legal status yang harus fresh
```

### 9.3 Cache Dimension

Cache bukan hanya TTL.

```text
key correctness
value freshness
max stale
eviction policy
negative caching
refresh policy
size bound
memory cost
tenant isolation
security classification
```

### 9.4 Cache Key Design

Buruk:

```java
cache.get(userId)
```

Lebih benar jika response dipengaruhi tenant/scope/locale/version:

```java
record CacheKey(
    String tenantId,
    String userId,
    String locale,
    String apiVersion,
    Set<String> scopes
) {}
```

### 9.5 Cache Value Metadata

Jangan hanya simpan value.

```java
public final class CachedValue<T> {
    private final T value;
    private final Instant fetchedAt;
    private final Instant expiresAt;
    private final boolean fromFallback;
    private final String sourceVersion;
}
```

Metadata membantu observability dan fallback.

### 9.6 Caffeine Example

```java
LoadingCache<AddressKey, Address> addressCache = Caffeine.newBuilder()
        .maximumSize(100_000)
        .expireAfterWrite(Duration.ofHours(12))
        .recordStats()
        .build(key -> addressClient.lookup(key));
```

Async example:

```java
AsyncLoadingCache<AddressKey, Address> addressCache = Caffeine.newBuilder()
        .maximumSize(100_000)
        .expireAfterWrite(Duration.ofHours(12))
        .refreshAfterWrite(Duration.ofHours(1))
        .recordStats()
        .buildAsync(key -> addressClient.lookupAsync(key));
```

### 9.7 Cache Stampede

Jika cache item populer expired, banyak request bersamaan bisa memicu banyak reload.

Mitigasi:

1. Async refresh.
2. Single-flight load.
3. Stale-while-revalidate.
4. TTL jitter.
5. Refresh-ahead.
6. Per-key lock.

### 9.8 TTL Jitter

Tanpa jitter:

```text
100.000 keys cached at 10:00, TTL 1 hour
→ all expire at 11:00
→ reload storm
```

Dengan jitter:

```text
TTL = 1 hour ± random 10 minutes
```

### 9.9 Negative Cache

Negative cache menyimpan hasil “tidak ditemukan” atau failure tertentu.

Contoh:

```text
postal code not found → cache 10 minutes
invalid tenant config → cache 1 minute
429 rate limited → cache until Retry-After
```

Jangan cache transient 500 terlalu lama.

---

## 10. Stale-While-Revalidate

### 10.1 Ide Utama

Jika cache value sudah expired tetapi masih dalam batas stale yang diizinkan, client boleh mengembalikan stale value cepat sambil refresh di background.

```text
fresh window: return fresh
stale window: return stale + trigger refresh
beyond max stale: block/fail/reload synchronously
```

### 10.2 Timeline

```text
fetched at 10:00
fresh TTL = 5m
max stale = 30m

10:00-10:05 → fresh
10:05-10:30 → stale allowed, refresh async
>10:30 → too stale, must fetch or fail
```

### 10.3 Use Case

Cocok untuk:

```text
catalog
reference data
UI enrichment
display-only metadata
exchange rate display jika bukan settlement rate
```

Tidak cocok untuk:

```text
permission decision
fraud decision
compliance blocking decision
fund transfer balance
```

### 10.4 Result Harus Menyatakan Freshness

```java
public final class ClientResponse<T> {
    private final T value;
    private final Freshness freshness;
}

public enum FreshnessLevel {
    FRESH,
    STALE_WITH_REFRESH_TRIGGERED,
    STALE_REFRESH_FAILED,
    UNKNOWN
}
```

Jika stale data dipakai untuk keputusan penting, itu harus eksplisit.

---

## 11. Idempotent Command Client

### 11.1 Problem: Timeout Tidak Berarti Downstream Tidak Menerima Request

Pada command/write operation:

```text
client sends POST /payment
server receives request
server creates payment
server response delayed
client times out
```

Dari sisi client:

```text
timeout
```

Dari sisi server:

```text
payment created
```

Jika client retry tanpa idempotency, payment bisa tercipta dua kali.

### 11.2 Idempotency Key

Idempotency key adalah identifier unik untuk command logical yang sama.

```http
POST /payments
Idempotency-Key: tenant-123:payment-request-789
```

Server menyimpan hasil command untuk key tersebut. Jika request sama dikirim ulang, server mengembalikan hasil yang sama atau status duplikat yang aman.

### 11.3 Client-Side Command Model

```java
public final class CreatePaymentCommand {
    private final String commandId;
    private final String tenantId;
    private final BigDecimal amount;
    private final String currency;
    private final String recipientId;
}
```

Idempotency key:

```java
String key = tenantId + ":" + commandId;
```

Jangan generate key baru setiap retry. Key harus stabil untuk logical command yang sama.

### 11.4 Retry Decision untuk Command

| Failure | Retry? | Syarat |
|---|---:|---|
| Connect failure sebelum request terkirim | Mungkin | operation idempotent atau key tersedia |
| Read timeout setelah body terkirim | Hati-hati | idempotency key wajib |
| 500 | Mungkin | jika server support dedup |
| 409 duplicate | Interpretasi domain | mungkin success duplicate |
| 400 validation | Tidak | fix request |
| 401 invalid credential | Tidak langsung | refresh token jika expired |

### 11.5 Idempotent Command Client Skeleton

```java
public PaymentResult createPayment(CreatePaymentCommand command) {
    String idempotencyKey = command.tenantId() + ":" + command.commandId();

    HttpRequest request = requestFactory.createPayment(command, idempotencyKey);

    try {
        return retryPolicy.execute(() -> {
            HttpResponse<String> response = httpClient.send(request, BodyHandlers.ofString());
            return paymentResponseMapper.map(response);
        });
    } catch (AmbiguousCommandException e) {
        return reconciliationClient.lookupByCommandId(command.commandId());
    }
}
```

### 11.6 Ambiguous Result

Command client harus punya state “ambiguous”.

```text
SUCCESS
FAILED_REJECTED
FAILED_VALIDATION
AMBIGUOUS_SENT_BUT_NO_RESPONSE
UNKNOWN_NOT_SENT
```

Jangan menyamakan timeout dengan failure final.

### 11.7 Reconciliation

Untuk command penting, siapkan endpoint reconciliation:

```text
GET /payments/by-command-id/{commandId}
GET /applications/by-submission-reference/{ref}
GET /requests/{idempotencyKey}/status
```

Tanpa reconciliation, timeout pada command menjadi sulit dibuktikan.

---

## 12. Outbox + HTTP Delivery

### 12.1 Problem

Aplikasi menyimpan perubahan lokal dan harus mengirim HTTP command ke downstream. Jika proses crash setelah DB commit tetapi sebelum HTTP send, event hilang.

Naive:

```text
save database
send HTTP
```

Failure window:

```text
DB commit success
process crash before HTTP send
```

### 12.2 Outbox Pattern

```text
same DB transaction:
  save business state
  save outbox message

separate worker:
  read outbox
  send HTTP
  mark delivered / retry / dead-letter
```

### 12.3 Struktur Outbox

```sql
CREATE TABLE outbound_http_outbox (
    id                VARCHAR(64) PRIMARY KEY,
    aggregate_id      VARCHAR(64) NOT NULL,
    destination       VARCHAR(100) NOT NULL,
    idempotency_key   VARCHAR(150) NOT NULL,
    method            VARCHAR(10) NOT NULL,
    path              VARCHAR(500) NOT NULL,
    body_json         CLOB NOT NULL,
    status            VARCHAR(30) NOT NULL,
    attempt_count     INTEGER NOT NULL,
    next_attempt_at   TIMESTAMP NOT NULL,
    created_at        TIMESTAMP NOT NULL,
    updated_at        TIMESTAMP NOT NULL
);
```

### 12.4 Delivery Worker

```text
select due messages
claim with lock/status
send HTTP with idempotency key
classify response
mark delivered / retry / dead-letter
emit metrics
```

### 12.5 Retry Policy untuk Outbox

Outbox retry berbeda dari request-response retry.

```text
request-response retry: within user request deadline
outbox retry: across time, durable, recoverable
```

Outbox bisa retry selama menit/jam/hari, tetapi harus punya:

1. Max attempts atau max age.
2. Dead-letter queue/table.
3. Manual replay tooling.
4. Idempotency key.
5. Audit trail.

### 12.6 Kapan Pakai Outbox?

Pakai untuk:

```text
regulatory submission delivery
notification delivery penting
sync command antar system
payment/settlement instruction
case escalation event
```

Tidak perlu untuk:

```text
best-effort analytics fire-and-forget
UI enrichment call
simple synchronous lookup
```

---

## 13. Polling Client untuk Long-Running Operation

### 13.1 Problem

Beberapa API tidak menyelesaikan pekerjaan langsung.

Pattern umum:

```text
POST /jobs → 202 Accepted + operationId
GET /jobs/{operationId} → RUNNING / SUCCEEDED / FAILED
```

### 13.2 Naive Polling Anti-Pattern

```java
while (true) {
    Status status = client.getStatus(id);
    if (status.done()) return status.result();
    Thread.sleep(1000);
}
```

Masalah:

1. Infinite loop.
2. Tidak ada max duration.
3. Tidak respect `Retry-After`.
4. Tidak ada cancellation.
5. Poll interval fixed menyebabkan synchronized load.
6. Tidak ada failure classification.
7. Tidak ada checkpoint/resume.

### 13.3 Polling Policy

```java
public final class PollingPolicy {
    private final Duration initialDelay;
    private final Duration maxDelay;
    private final Duration maxDuration;
    private final int maxAttempts;
    private final boolean respectRetryAfter;
}
```

### 13.4 Polling Loop yang Lebih Aman

```java
public OperationResult waitUntilDone(String operationId, PollingPolicy policy) {
    Instant deadline = Instant.now().plus(policy.maxDuration());
    int attempt = 0;
    Duration delay = policy.initialDelay();

    while (Instant.now().isBefore(deadline) && attempt < policy.maxAttempts()) {
        attempt++;

        OperationStatus status = operationClient.getStatus(operationId);

        if (status.isSucceeded()) {
            return operationClient.getResult(operationId);
        }

        if (status.isFailed()) {
            throw mapFailure(status);
        }

        Duration serverSuggested = status.retryAfter().orElse(delay);
        sleep(jitter(min(serverSuggested, policy.maxDelay())));
        delay = min(delay.multipliedBy(2), policy.maxDelay());
    }

    throw new OperationTimeoutException(operationId);
}
```

### 13.5 Polling Observability

Metrics:

```text
poll_attempts_total{operation}
poll_duration_seconds{operation}
poll_terminal_status_total{status}
poll_timeout_total
poll_retry_after_used_total
```

Logs:

```text
operationId
attempt
status
delayMs
elapsedMs
traceId
```

Jangan log payload sensitif.

---

## 14. Pagination Abstraction

### 14.1 Problem

External API sering memakai pagination:

```text
page + size
offset + limit
cursor
nextPageToken
Link header
```

Naive client memaksa application layer tahu detail pagination external API.

Buruk:

```java
var page1 = externalClient.search(q, 1, 100);
var page2 = externalClient.search(q, 2, 100);
```

Lebih baik: client menyediakan iterator/stream abstraction.

### 14.2 Pagination Semantics

Pertanyaan penting:

```text
Apakah dataset bisa berubah saat pagination berjalan?
Apakah page token expire?
Apakah ada snapshot consistency?
Apakah item bisa duplikat antar page?
Apakah item bisa hilang?
Apakah order deterministic?
Apakah max page size diketahui?
```

### 14.3 Iterator Abstraction

```java
public interface PageFetcher<T, C> {
    Page<T, C> fetch(C cursor);
}

public final class Page<T, C> {
    private final List<T> items;
    private final Optional<C> nextCursor;
}
```

Usage:

```java
for (Customer item : customerClient.searchAll(criteria)) {
    process(item);
}
```

Application layer tidak perlu tahu apakah API memakai cursor/page/offset.

### 14.4 Safe Pagination Loop

```java
public <T, C> void forEachPage(
        C initialCursor,
        PageFetcher<T, C> fetcher,
        Consumer<T> consumer,
        int maxPages
) {
    C cursor = initialCursor;
    int pages = 0;

    while (cursor != null && pages < maxPages) {
        pages++;
        Page<T, C> page = fetcher.fetch(cursor);

        for (T item : page.items()) {
            consumer.accept(item);
        }

        cursor = page.nextCursor().orElse(null);
    }

    if (pages >= maxPages) {
        throw new PaginationLimitExceededException(maxPages);
    }
}
```

### 14.5 Memory-Safe Batch Processing

Jangan kumpulkan semua page ke memory jika dataset besar.

Buruk:

```java
List<Item> all = client.fetchAll();
```

Lebih aman:

```java
client.forEachItem(criteria, item -> processor.process(item));
```

Atau batch:

```java
client.forEachPage(criteria, page -> processor.processBatch(page.items()));
```

### 14.6 Resume / Checkpoint

Untuk job panjang:

```text
last successful cursor/token
timestamp
page number
last item id
```

Simpan checkpoint agar job bisa dilanjutkan setelah crash.

---

## 15. Race Request / Fastest Wins

### 15.1 Apa Itu Race Request?

Race request mengirim request ke beberapa source dan mengambil hasil tercepat.

```text
request → endpoint A
        → endpoint B
first successful response wins
cancel the other
```

Use case:

```text
read replica across regions
primary/secondary data source
low-latency quote source
```

### 15.2 Risiko

1. Menggandakan beban.
2. Bisa melanggar rate limit.
3. Bisa menghasilkan data beda freshness.
4. Untuk command/write sangat berbahaya.
5. Cancellation mungkin tidak menghentikan request yang sudah terkirim.

Gunakan hanya untuk read operation yang aman.

### 15.3 CompletableFuture Race

```java
CompletableFuture<Result> a = clientA.fetchAsync(key);
CompletableFuture<Result> b = clientB.fetchAsync(key);

CompletableFuture<Result> fastest = a.applyToEither(b, Function.identity());

fastest.whenComplete((result, error) -> {
    a.cancel(true);
    b.cancel(true);
});
```

Catatan: cancellation di future tidak selalu membatalkan network call yang sudah berjalan, tergantung library dan integrasi.

---

## 16. Hedging Revisited

Hedging mirip race request, tetapi request kedua dikirim setelah delay jika request pertama lambat.

```text
t=0ms    send request A
t=80ms   if A not done, send request B
t=100ms  B returns, use B, cancel A
```

Hedging cocok untuk mengurangi tail latency, tetapi harus dibatasi.

Syarat:

1. Operasi read-only atau idempotent.
2. Ada hedge budget.
3. Tidak untuk semua request.
4. Hanya untuk request yang melewati latency percentile tertentu.
5. Bounded concurrency.
6. Observability khusus.

Anti-pattern:

```text
Semua request langsung dikirim dua kali untuk mempercepat response.
```

Itu bukan hedging, itu load multiplier.

---

## 17. Multi-Endpoint Failover

### 17.1 Use Case

```text
primary endpoint down → secondary endpoint
region A down → region B
new API endpoint migration → fallback old endpoint
```

### 17.2 Failover Decision

Pertanyaan:

```text
Apakah secondary punya data yang sama?
Apakah write ke secondary aman?
Apakah auth sama?
Apakah idempotency key valid lintas endpoint?
Apakah latency budget cukup?
Apakah failover otomatis atau manual?
```

### 17.3 Failover Pattern

```java
public Result fetch(Key key) {
    try {
        return primaryClient.fetch(key);
    } catch (ExternalUnavailableException e) {
        if (!failoverPolicy.allowFailover(e)) {
            throw e;
        }
        return secondaryClient.fetch(key);
    }
}
```

Untuk write command, failover jauh lebih rumit karena risiko split-brain/duplicate side effect.

---

## 18. Client Workflow Orchestration

Kadang HTTP client bukan hanya satu call, tetapi workflow:

```text
1. create draft
2. upload attachment
3. submit
4. poll status
5. fetch result
```

Naive implementation sering tersebar di service layer.

Lebih baik bungkus sebagai client workflow adapter:

```java
public interface ExternalSubmissionGateway {
    SubmissionResult submit(SubmissionCommand command);
}
```

Internal implementation:

```text
createDraft
→ uploadDocuments
→ submitDraft
→ pollUntilCompleted
→ fetchReceipt
→ map result
```

Service layer hanya tahu business operation.

### 18.1 Workflow State

Untuk workflow panjang, simpan state:

```text
DRAFT_CREATED
DOCUMENTS_UPLOADED
SUBMITTED
POLLING
COMPLETED
FAILED
AMBIGUOUS
```

Jika crash, workflow bisa resume.

### 18.2 Per-Step Idempotency

Setiap step command harus punya idempotency semantics.

```text
create draft: idempotency key = submissionId:create
upload doc: idempotency key = submissionId:docId:upload
submit: idempotency key = submissionId:submit
```

---

## 19. Pattern Composition Example: Production-Grade Address Lookup Client

### 19.1 Requirement

```text
Given postal code, return normalized address.
Third-party API rate limit: 300/min.
Latency budget: 500 ms.
Data can be stale up to 24h.
Postal code lookup is read-only.
Many users may request same postal code.
```

### 19.2 Design

```text
validate postal code
→ cache lookup
→ if fresh: return
→ if stale but allowed: return stale + async refresh
→ if missing: in-flight dedup
→ rate limiter
→ timeout 300ms
→ retry 1x on transient failure
→ map response
→ cache result
→ return
```

### 19.3 Components

```java
public interface AddressLookupClient {
    AddressLookupResult lookup(PostalCode postalCode);
}
```

Result:

```java
public final class AddressLookupResult {
    private final Address address;
    private final Freshness freshness;
    private final Source source;
}
```

### 19.4 Why This Is Better

Itu melindungi:

1. User latency.
2. Third-party rate limit.
3. Downstream dari duplicate request.
4. Aplikasi dari failure cascading.
5. Observability dari blind spot.

---

## 20. Pattern Composition Example: Payment Command Client

### 20.1 Requirement

```text
Create payment through external API.
Duplicate payment is unacceptable.
Timeout may happen.
Need audit trail.
Need retry for transient failures.
Need reconciliation.
```

### 20.2 Design

```text
commandId generated by caller
→ persist local payment request
→ enqueue outbox with idempotency key
→ delivery worker sends POST
→ classify response
→ mark success/failure/ambiguous
→ if ambiguous, reconcile by commandId
→ audit every transition
```

### 20.3 Why Synchronous Retry Alone Is Not Enough

Because payment command is side-effecting. Timeout after send means outcome may already exist. Durable outbox + idempotency + reconciliation is safer than blindly retrying in user request thread.

---

## 21. Pattern Composition Example: Case Dashboard Aggregator

### 21.1 Requirement

```text
Show case dashboard.
Core case data required.
Risk summary fail-closed.
Notification count optional.
Document count stale up to 10 minutes.
Latency budget 1 second.
```

### 21.2 Design

```text
case data: required, 400ms timeout
risk summary: required/fail-closed, 300ms timeout
notification count: optional, 150ms timeout
document count: cached stale allowed, 100ms timeout if refresh needed
```

### 21.3 Result

```java
public final class CaseDashboard {
    private final CaseData caseData;
    private final RiskSummary riskSummary;
    private final Optional<Integer> notificationCount;
    private final DocumentCount documentCount;
    private final List<PartialFailure> partialFailures;
}
```

Ini lebih jujur daripada membuat semua field seolah selalu tersedia.

---

## 22. Observability untuk Advanced Pattern

Advanced pattern butuh metric yang lebih kaya dari sekadar `http.client.duration`.

### 22.1 Fan-Out Metrics

```text
aggregator_duration_seconds{operation}
aggregator_partial_result_total{operation, component}
aggregator_required_failure_total{operation, component}
aggregator_branch_timeout_total{component}
aggregator_branch_cancelled_total{component}
```

### 22.2 Single-Flight Metrics

```text
token_refresh_total{outcome}
token_refresh_inflight_waiters
singleflight_join_total{key_type}
singleflight_leader_total{key_type}
```

### 22.3 Cache Metrics

```text
cache_hit_total{client, cache}
cache_miss_total{client, cache}
cache_stale_return_total{client, cache}
cache_refresh_success_total{client, cache}
cache_refresh_failure_total{client, cache}
cache_eviction_total{client, cache}
```

### 22.4 Command Metrics

```text
command_sent_total{operation}
command_success_total{operation}
command_ambiguous_total{operation}
command_reconciled_total{operation, outcome}
outbox_delivery_attempt_total{destination, outcome}
outbox_deadletter_total{destination, reason}
```

---

## 23. Testing Advanced Pattern

### 23.1 Fan-Out Test

Test cases:

```text
all required succeed
optional fails → partial result
required fails → operation fails
stale cache used
branch timeout
global deadline exceeded
cancellation triggered
```

### 23.2 Single-Flight Test

Test cases:

```text
100 concurrent calls trigger exactly 1 refresh
refresh failure releases in-flight state
next call can retry refresh
separate tenant gets separate refresh
expired token skew respected
401 triggers only one refresh
```

### 23.3 Cache Test

Test cases:

```text
fresh hit
miss load
stale return + refresh
max stale exceeded
negative cache
TTL jitter behavior
cache key includes auth/tenant/scope
```

### 23.4 Idempotent Command Test

Test cases:

```text
retry uses same idempotency key
read timeout after send becomes ambiguous
ambiguous triggers reconciliation
409 duplicate maps to existing success when safe
validation error not retried
outbox retries durable message
```

### 23.5 Polling Test

Test cases:

```text
success after N polls
failure terminal state
max attempts exceeded
max duration exceeded
Retry-After respected
backoff capped
cancellation stops polling
```

---

## 24. Anti-Pattern Catalogue

### 24.1 Fan-Out Without Deadline

```text
Each branch has timeout, but no global deadline.
```

Akibat:

```text
user request hangs too long
retry expands total latency
threads occupied too long
```

### 24.2 Retry Inside Every Branch

```text
aggregator calls 8 downstream
all have retry 3x
one incoming request can become 24 outbound calls
```

### 24.3 Cache Without Tenant/Auth Key

```text
cache.get(resourceId)
```

Akibat:

```text
user A can receive user B's authorized data
```

### 24.4 Token Refresh Without Single-Flight

Akibat:

```text
auth server overload during expiry window
all calls slow/fail
```

### 24.5 Polling Forever

Akibat:

```text
resource leak
worker stuck
unbounded downstream load
```

### 24.6 Idempotency Key Generated Per Attempt

Buruk:

```java
for each retry:
    idempotencyKey = UUID.randomUUID()
```

Akibat:

```text
server sees each retry as new command
```

### 24.7 Partial Failure Hidden as Empty Data

Buruk:

```java
catch (Exception e) {
    return List.of();
}
```

Akibat:

```text
consumer cannot distinguish “real empty” vs “dependency failed”
```

---

## 25. Design Review Checklist

Gunakan checklist ini saat meninjau advanced HTTP client.

### 25.1 Semantics

```text
[ ] Apakah operasi read atau write?
[ ] Apakah operasi idempotent?
[ ] Apakah retry aman?
[ ] Apakah partial result diizinkan?
[ ] Apakah stale data diizinkan?
[ ] Apakah fail-open/fail-closed sudah jelas?
```

### 25.2 Concurrency

```text
[ ] Apakah fan-out bounded?
[ ] Apakah ada global deadline?
[ ] Apakah branch cancellation jelas?
[ ] Apakah executor/bulkhead dipisah per dependency?
[ ] Apakah virtual threads tidak dipakai sebagai alasan unbounded outbound call?
```

### 25.3 Dedup/Cache

```text
[ ] Apakah cache key mencakup tenant/auth/scope/locale/version?
[ ] Apakah cache punya max size?
[ ] Apakah TTL sesuai domain freshness?
[ ] Apakah stale behavior eksplisit?
[ ] Apakah negative cache aman?
[ ] Apakah cache stampede dicegah?
```

### 25.4 Auth

```text
[ ] Apakah token refresh single-flight?
[ ] Apakah token cache key mencakup tenant/scope/audience?
[ ] Apakah refresh punya timeout?
[ ] Apakah 401 retry dibatasi satu kali?
[ ] Apakah token tidak pernah dilog?
```

### 25.5 Command Safety

```text
[ ] Apakah command punya idempotency key stabil?
[ ] Apakah timeout setelah send diperlakukan ambiguous?
[ ] Apakah reconciliation tersedia?
[ ] Apakah outbox diperlukan?
[ ] Apakah audit trail mencatat transition?
```

### 25.6 Observability

```text
[ ] Apakah metric membedakan required vs optional failure?
[ ] Apakah cache hit/miss/stale terlihat?
[ ] Apakah single-flight leader/waiter terlihat?
[ ] Apakah command ambiguous terlihat?
[ ] Apakah polling attempts/duration terlihat?
[ ] Apakah log aman dari PII/secret?
```

---

## 26. Heuristik Top-Tier Engineer

### 26.1 Jangan Tanya “Library Apa?” Terlalu Awal

Pertanyaan lebih penting:

```text
Apa semantics operasi?
Apa consequence jika gagal?
Apa consequence jika duplikat?
Apa consequence jika stale?
Apa consequence jika partial?
```

Baru setelah itu pilih JDK HttpClient, OkHttp, Retrofit, Apache, Spring WebClient, atau generated client.

### 26.2 Treat External API as Unreliable, Slow, and Evolving

Desain client dengan asumsi:

```text
API akan lambat
API akan berubah
API akan memberi error aneh
API akan rate-limit
API akan timeout setelah menerima command
API akan mengirim field baru
API akan menghapus field dokumentasi diam-diam
```

Bukan karena pesimis, tetapi karena production realism.

### 26.3 Make Ambiguity Explicit

Especially for command.

```text
timeout != failed
timeout after send == ambiguous
```

### 26.4 Separate Business Semantics from Transport Mechanics

Transport mechanics:

```text
HTTP status
exception
timeout
socket reset
```

Business semantics:

```text
payment created
case submitted
address not found
compliance check unavailable
```

HTTP client boundary harus menerjemahkan mechanics menjadi semantics.

### 26.5 Optimize for Failure Containment

Advanced client pattern bukan hanya membuat success path cepat. Ia harus mencegah failure menyebar.

```text
bulkhead prevents thread starvation
rate limit prevents outbound overload
single-flight prevents refresh stampede
cache prevents repeated lookup
outbox prevents lost command
idempotency prevents duplicate side effect
partial result prevents optional dependency from killing main flow
```

---

## 27. Ringkasan Mental Model

Advanced HTTP client adalah komposisi:

```text
semantics
+ concurrency
+ deduplication
+ cache/freshness
+ command safety
+ failure policy
+ observability
+ operational recovery
```

Pola yang paling penting:

```text
fan-out aggregator
→ parallelism harus bounded dan punya partial failure policy

token single-flight
→ mencegah auth server stampede

in-flight dedup
→ mencegah duplicate identical outbound request

client-side cache
→ mengurangi latency/load, tetapi harus benar secara tenant/auth/freshness

stale-while-revalidate
→ latency rendah dengan stale risk eksplisit

idempotent command
→ mencegah duplicate side effect saat retry/timeout

outbox delivery
→ membuat side-effect delivery durable dan recoverable

polling client
→ mengelola long-running operation dengan bounded loop

pagination abstraction
→ memisahkan application layer dari detail external pagination
```

---

## 28. Latihan Praktis

### Latihan 1 — Token Single-Flight

Buat `TokenProvider` yang:

1. Cache token per `tenantId + scope`.
2. Menggunakan expiry skew 60 detik.
3. Menjamin 100 concurrent request hanya memicu 1 refresh per key.
4. Jika refresh gagal, next request bisa mencoba refresh lagi.
5. Tidak pernah log token.

### Latihan 2 — Address Lookup Cache

Buat `AddressLookupClient` yang:

1. Validasi postal code.
2. Cache result 24 jam.
3. Dedup in-flight request per postal code.
4. Rate limit 250 request/min.
5. Return stale data sampai 7 hari jika downstream gagal.
6. Metric hit/miss/stale/refresh failure.

### Latihan 3 — Idempotent Submission Client

Buat client untuk submit application ke external API:

1. `commandId` stabil.
2. Header `Idempotency-Key`.
3. Retry 2x hanya untuk transient failure.
4. Timeout setelah body sent menjadi `AMBIGUOUS`.
5. Reconciliation by `commandId`.
6. Audit setiap status transition.

### Latihan 4 — Fan-Out Case Dashboard

Buat aggregator dengan 5 downstream:

```text
case core: required
risk check: fail-closed
document count: stale allowed
notification count: optional
assignment history: optional but auditable
```

Tentukan:

1. Timeout per branch.
2. Global deadline.
3. Partial failure model.
4. Cache/freshness policy.
5. Metrics.
6. Test cases.

---

## 29. Penutup

Pada level advanced, HTTP client bukan lagi wrapper kecil. Ia adalah **coordination layer** antara domain internal dan dunia eksternal yang lambat, tidak sempurna, dan berubah.

Skill yang membedakan engineer kuat adalah kemampuan membuat keputusan seperti:

```text
retry atau tidak?
cache atau tidak?
stale boleh atau tidak?
partial boleh atau tidak?
fail-open atau fail-closed?
synchronous atau outbox?
sequential atau fan-out?
parallel atau bounded?
ambiguous atau failed?
```

Part ini sengaja menyatukan banyak konsep dari part sebelumnya agar terlihat sebagai sistem utuh.

Di part berikutnya, kita akan masuk ke case study production-grade third-party API client dan menerapkan pattern-pattern ini secara lebih konkret dalam desain end-to-end.

---

## 30. Status Series

Selesai:

```text
Part 31 — Advanced Patterns: Fan-Out Aggregator, Token Single-Flight, Client-Side Cache, Idempotent Command
```

Belum selesai. Part berikutnya:

```text
Part 32 — Case Study: Building a Production-Grade Third-Party API Client
File: 32-case-study-production-grade-third-party-api-client.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./30-migration-patterns-legacy-client-to-modern-client.md">⬅️ Part 30 — Migration Patterns: Legacy Client ke Modern Client</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./32-case-study-production-grade-third-party-api-client.md">Part 32 — Case Study: Building a Production-Grade Third-Party API Client ➡️</a>
</div>

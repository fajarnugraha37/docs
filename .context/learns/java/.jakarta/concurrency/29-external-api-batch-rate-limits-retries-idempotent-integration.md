# Part 29 — External API Batch: Rate Limits, Retries, and Idempotent Integration

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `29-external-api-batch-rate-limits-retries-idempotent-integration.md`  
> Scope: Java 8–25, Java EE/Jakarta EE, Jakarta Batch, Jakarta Concurrency, external API integration, resilient batch orchestration

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Mendesain batch job yang memanggil external API tanpa menghancurkan sistem sendiri, external provider, atau database internal.
2. Membedakan masalah **throughput**, **rate limit**, **concurrency limit**, **quota**, **latency**, **deadline**, dan **SLA window**.
3. Mendesain retry yang benar, bukan retry yang memperparah outage.
4. Menggunakan idempotency key, outbox/inbox, deduplication, dan replay log untuk membuat integrasi aman terhadap duplicate execution.
5. Menentukan kapan API call dilakukan langsung dari `ItemWriter`, kapan memakai durable outbox, dan kapan lebih baik dipisah menjadi job downstream.
6. Menangani token lifecycle seperti OAuth client credentials, 401 refresh, secret rotation, dan token cache secara aman.
7. Mendesain batch external API yang observable, restartable, auditable, dan defensible.
8. Memahami hubungan Jakarta Batch, Jakarta Concurrency, MicroProfile Fault Tolerance, dan pattern resiliency seperti bulkhead/circuit breaker.

---

## 2. Problem yang Diselesaikan

External API batch sering terlihat sederhana:

```text
ambil data dari database
for setiap record:
    panggil API external
    simpan hasil
```

Tetapi di production, desain seperti itu hampir selalu rapuh.

Masalah nyata yang muncul:

1. External provider punya **rate limit**.
2. Token bisa expired di tengah batch.
3. API kadang mengembalikan `429 Too Many Requests`.
4. API bisa lambat, timeout, atau partial outage.
5. Batch restart bisa mengirim request yang sama dua kali.
6. Writer gagal setelah external API sukses, sehingga database lokal tidak tahu bahwa side effect sudah terjadi.
7. Parallel partitioning bisa melewati quota external tanpa sadar.
8. Retry dari banyak partition bisa menjadi retry storm.
9. External API mungkin tidak idempotent.
10. Audit perlu menjawab: siapa mengirim apa, kapan, dengan correlation ID apa, dan hasilnya apa.

Karena itu, external API batch harus dipikirkan sebagai **distributed side-effect orchestration**, bukan sekadar HTTP loop.

---

## 3. Mental Model Utama

### 3.1 External API call adalah side effect di luar transaction lokal

Database lokal bisa berada dalam transaksi Jakarta Batch chunk. Tetapi external API tidak ikut rollback ketika transaksi database rollback.

```text
Local DB Transaction:
    read item
    call external API  ----> side effect outside DB transaction
    update local DB
commit/rollback local DB
```

Jika external API sukses tetapi local DB rollback, maka sistem berada dalam kondisi:

```text
External world: sudah berubah
Local DB: mengira belum berubah
```

Ini disebut **dual-write problem**.

Batch external API yang serius harus punya strategi untuk kasus ini.

---

### 3.2 Rate limit bukan concurrency limit

Keduanya sering tertukar.

| Konsep | Pertanyaan | Contoh |
|---|---|---|
| Concurrency limit | Berapa request yang boleh in-flight bersamaan? | Maksimal 20 request paralel |
| Rate limit | Berapa request per waktu? | 300 request per menit |
| Quota | Berapa request per periode billing/hari/bulan? | 100.000 request per hari |
| Deadline | Kapan satu request dianggap gagal? | Timeout 5 detik |
| SLA window | Kapan batch harus selesai? | Harus selesai sebelum 06:00 |

Batch yang hanya membatasi thread belum tentu mematuhi rate limit.

Contoh:

```text
10 thread
masing-masing request selesai 50 ms
throughput = 10 / 0.05 = 200 request/s = 12.000 request/min
```

Jika provider hanya mengizinkan 300 request/min, maka 10 thread sudah terlalu banyak.

---

### 3.3 Retry adalah amplifier

Retry bisa meningkatkan reliability ketika error transient. Tetapi retry juga bisa memperbesar beban saat provider sedang overload.

```text
1000 failed requests
retry 3x tanpa backoff
= 3000 request tambahan
```

Jika semua partition retry bersamaan, kamu membuat **retry storm**.

Retry yang benar harus dikontrol oleh:

1. exception/status classification,
2. retry budget,
3. backoff,
4. jitter,
5. circuit breaker,
6. rate limiter,
7. idempotency,
8. observability.

---

### 3.4 Idempotency adalah syarat restartability

Jakarta Batch bisa restart job. Tetapi restartability tidak otomatis membuat external side effect aman.

Jika job restart dan memproses item yang sama lagi, external API bisa dipanggil ulang.

Agar aman, external API operation harus salah satu dari:

1. idempotent by natural key,
2. idempotent by provider-supported idempotency key,
3. deduplicated by local outbox/inbox,
4. compensatable,
5. atau explicitly non-restartable dengan manual reconciliation.

Top-tier engineer tidak hanya bertanya:

> “Bisa retry?”

Tetapi bertanya:

> “Kalau request yang sama dikirim dua kali, state akhirnya apa?”

---

## 4. Jakarta Batch dalam Konteks External API

Jakarta Batch menyediakan model chunk, skip, retry, checkpoint, listener, partitioning, job repository, dan `JobOperator`. Spesifikasi Jakarta Batch 2.1 mendefinisikan atribut seperti `skip-limit` dan `retry-limit` untuk chunk processing, serta model reader/processor/writer/checkpoint untuk batch job yang restartable.

External API batch biasanya memakai salah satu dari tiga model:

1. **Direct API call inside chunk writer**
2. **Outbox-driven API dispatch**
3. **Hybrid: batch prepares requests, managed executor dispatches bounded calls**

Mari bahas satu per satu.

---

## 5. Model A — Direct API Call Inside ItemWriter

### 5.1 Bentuk sederhana

```java
import jakarta.batch.api.chunk.ItemWriter;
import jakarta.enterprise.context.Dependent;
import java.io.Serializable;
import java.util.List;

@Dependent
public class ExternalSyncWriter implements ItemWriter {

    @Override
    public void open(Serializable checkpoint) {
    }

    @Override
    public void writeItems(List<Object> items) throws Exception {
        for (Object item : items) {
            ExternalSyncRequest request = (ExternalSyncRequest) item;
            callExternalApi(request);
            markAsSynced(request);
        }
    }

    @Override
    public Serializable checkpointInfo() {
        return null;
    }

    @Override
    public void close() {
    }

    private void callExternalApi(ExternalSyncRequest request) {
        // HTTP call
    }

    private void markAsSynced(ExternalSyncRequest request) {
        // DB update
    }
}
```

Model ini mudah dipahami, tetapi punya risiko besar.

### 5.2 Kelebihan

1. Sederhana.
2. Cocok untuk API idempotent.
3. Cocok untuk volume kecil.
4. Mudah dihubungkan dengan retry/skip chunk.
5. Semua logic terlihat dalam batch step.

### 5.3 Kekurangan

1. External API tidak ikut rollback transaksi lokal.
2. Jika writer gagal setelah beberapa API call sukses, batch bisa mengulang request yang sama.
3. Commit interval besar memperbesar area ketidakpastian.
4. Timeout API memperlama transaksi DB.
5. Parallel partition bisa melanggar rate limit.
6. Sulit membedakan “API sukses tapi DB gagal” vs “API gagal sebelum side effect”.

### 5.4 Kapan masih boleh dipakai

Direct API call inside writer boleh dipakai jika semua kondisi ini terpenuhi:

1. Operasi external API idempotent.
2. Ada idempotency key yang stabil.
3. Volume kecil/menengah.
4. Rate limit cukup longgar.
5. Tidak ada requirement recovery kompleks.
6. External side effect tidak terlalu kritikal.
7. Ada reconciliation report.
8. Timeout pendek dan controlled.
9. Commit interval kecil.

Contoh yang relatif cocok:

```text
sinkronisasi status read-only ke API internal yang idempotent
GET enrichment API
POST upsert dengan business key unik
validasi data ke service internal yang tidak punya side effect
```

---

## 6. Model B — Outbox-Driven API Dispatch

### 6.1 Mental model

Batch tidak langsung melakukan external side effect. Batch hanya menulis request ke tabel outbox secara transactional.

```text
Jakarta Batch chunk transaction:
    read item
    transform into API request
    insert API request into OUTBOX
    mark source item as QUEUED
commit

Dispatcher:
    pick pending OUTBOX rows
    call external API
    record result
    retry safely
```

Ini memisahkan:

1. batch preparation,
2. durable queueing,
3. external API dispatch,
4. retry/reconciliation.

### 6.2 Kenapa outbox kuat

Karena database lokal menjadi sumber kebenaran untuk niat melakukan side effect.

Jika batch crash setelah commit:

```text
OUTBOX row tetap ada
Dispatcher bisa lanjut
```

Jika dispatcher crash setelah API call sukses tetapi sebelum update DB:

```text
OUTBOX row masih pending/in-flight
Idempotency key dipakai untuk retry/reconciliation
```

### 6.3 Skema tabel outbox contoh

```sql
CREATE TABLE EXTERNAL_API_OUTBOX (
    OUTBOX_ID           VARCHAR2(64) PRIMARY KEY,
    BUSINESS_KEY        VARCHAR2(128) NOT NULL,
    API_NAME            VARCHAR2(100) NOT NULL,
    IDEMPOTENCY_KEY     VARCHAR2(128) NOT NULL,
    REQUEST_PAYLOAD     CLOB NOT NULL,
    STATUS              VARCHAR2(30) NOT NULL,
    ATTEMPT_COUNT       NUMBER DEFAULT 0 NOT NULL,
    NEXT_ATTEMPT_AT     TIMESTAMP NULL,
    LAST_HTTP_STATUS    NUMBER NULL,
    LAST_ERROR_CODE     VARCHAR2(100) NULL,
    LAST_ERROR_MESSAGE  VARCHAR2(1000) NULL,
    PROVIDER_REQUEST_ID VARCHAR2(128) NULL,
    PROVIDER_RESULT_ID  VARCHAR2(128) NULL,
    CREATED_AT          TIMESTAMP NOT NULL,
    UPDATED_AT          TIMESTAMP NOT NULL,
    CREATED_BY          VARCHAR2(100) NULL,
    CORRELATION_ID      VARCHAR2(128) NOT NULL,
    CONSTRAINT UK_EXTERNAL_API_OUTBOX_IDEMP UNIQUE (API_NAME, IDEMPOTENCY_KEY)
);
```

Status umum:

```text
PENDING
IN_FLIGHT
SUCCEEDED
FAILED_RETRYABLE
FAILED_PERMANENT
DEAD_LETTER
CANCELLED
RECONCILIATION_REQUIRED
```

### 6.4 Writer Jakarta Batch untuk outbox

```java
import jakarta.batch.api.chunk.ItemWriter;
import jakarta.enterprise.context.Dependent;
import jakarta.inject.Inject;
import java.io.Serializable;
import java.time.Instant;
import java.util.List;

@Dependent
public class ApiOutboxWriter implements ItemWriter {

    @Inject
    ApiOutboxRepository outboxRepository;

    @Inject
    ExternalRequestMapper mapper;

    @Override
    public void open(Serializable checkpoint) {
    }

    @Override
    public void writeItems(List<Object> items) throws Exception {
        for (Object item : items) {
            SourceRecord record = (SourceRecord) item;

            ExternalApiOutbox outbox = mapper.toOutbox(record);
            outbox.setStatus("PENDING");
            outbox.setAttemptCount(0);
            outbox.setCreatedAt(Instant.now());
            outbox.setUpdatedAt(Instant.now());

            // Must be idempotent insert/upsert.
            outboxRepository.insertIfAbsent(outbox);
            outboxRepository.markSourceQueued(record.getId(), outbox.getOutboxId());
        }
    }

    @Override
    public Serializable checkpointInfo() {
        return null;
    }

    @Override
    public void close() {
    }
}
```

Kunci penting: `insertIfAbsent`.

Jika chunk diulang saat restart, outbox row tidak boleh dibuat ganda.

---

## 7. Model C — Hybrid Batch + ManagedExecutor Dispatch

### 7.1 Kapan digunakan

Kadang kita ingin batch tetap menjadi orchestrator, tetapi API call dilakukan paralel secara bounded.

Contoh:

1. External API latensinya tinggi.
2. Provider rate limit cukup jelas.
3. Operasi idempotent.
4. Kita ingin satu job menyelesaikan dispatch end-to-end.
5. Volume sedang, bukan jutaan item.

### 7.2 Risiko utama

Jangan membuat writer memanggil ribuan `CompletableFuture` tanpa bound.

Buruk:

```java
for (Object item : items) {
    CompletableFuture.runAsync(() -> callApi(item)); // default commonPool: bad in Jakarta EE
}
```

Di Jakarta EE, gunakan managed executor dan explicit capacity control.

```java
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.inject.Inject;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Semaphore;

public class BoundedApiDispatcher {

    @Inject
    ManagedExecutorService executor;

    private final Semaphore inFlight = new Semaphore(20);

    public CompletableFuture<ApiResult> dispatch(ApiRequest request) {
        return CompletableFuture.supplyAsync(() -> {
            acquirePermit();
            try {
                return callApi(request);
            } finally {
                inFlight.release();
            }
        }, executor);
    }

    private void acquirePermit() {
        try {
            inFlight.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CancellationRequestedException("Interrupted while waiting for API permit", e);
        }
    }

    private ApiResult callApi(ApiRequest request) {
        // HTTP call with timeout, idempotency key, retry policy, etc.
        return null;
    }
}
```

Tetapi `Semaphore` hanya membatasi concurrency, bukan rate per menit. Untuk rate limit, perlu token bucket/leaky bucket atau dispatcher scheduler.

---

## 8. Rate Limit Design

### 8.1 Tipe rate limit provider

External API bisa memakai beberapa model:

| Model | Contoh | Implikasi |
|---|---|---|
| Fixed window | 300/min dari 12:00:00 sampai 12:00:59 | Burst di awal window bisa terjadi |
| Sliding window | 300 request dalam 60 detik terakhir | Perlu smoothing |
| Token bucket | Token refill bertahap | Bisa burst terbatas |
| Concurrent request limit | Maksimal 10 request in-flight | Perlu semaphore |
| Daily quota | 100.000/day | Perlu budget harian |
| Per-client quota | Per API key/client id | Perlu isolate per credential |
| Per-endpoint limit | `/search` 100/min, `/update` 30/min | Per route limiter |
| Adaptive throttling | Limit berubah saat overload | Perlu baca header response |

### 8.2 Rate limiter sederhana berbasis token bucket

Untuk ilustrasi lokal:

```java
import java.time.Duration;
import java.time.Instant;

public class SimpleTokenBucket {
    private final long capacity;
    private final double refillPerSecond;

    private double tokens;
    private Instant lastRefill;

    public SimpleTokenBucket(long capacity, long refillPerMinute) {
        this.capacity = capacity;
        this.refillPerSecond = refillPerMinute / 60.0;
        this.tokens = capacity;
        this.lastRefill = Instant.now();
    }

    public synchronized boolean tryAcquire() {
        refill();
        if (tokens >= 1.0) {
            tokens -= 1.0;
            return true;
        }
        return false;
    }

    public synchronized long millisUntilNextToken() {
        refill();
        if (tokens >= 1.0) return 0;
        double missing = 1.0 - tokens;
        return (long) Math.ceil((missing / refillPerSecond) * 1000.0);
    }

    private void refill() {
        Instant now = Instant.now();
        long millis = Duration.between(lastRefill, now).toMillis();
        if (millis <= 0) return;

        double newTokens = (millis / 1000.0) * refillPerSecond;
        tokens = Math.min(capacity, tokens + newTokens);
        lastRefill = now;
    }
}
```

Catatan penting:

1. Ini hanya cocok untuk single JVM.
2. Untuk cluster, limiter harus distributed atau dispatcher harus single-active.
3. Untuk external provider serius, hormati response header seperti `Retry-After`, `X-RateLimit-Remaining`, dan `X-RateLimit-Reset` jika tersedia.

### 8.3 Cluster-aware rate limit

Jika batch berjalan di 4 node dan masing-masing node mengira limit 300/min, total bisa menjadi 1200/min.

Pilihan desain:

1. **Single dispatcher**
   - hanya satu node/pod yang melakukan API dispatch.
   - paling sederhana.

2. **DB-backed token claim**
   - token dihitung/diambil dari tabel shared.
   - portable tetapi perlu hati-hati locking.

3. **Redis token bucket**
   - cocok jika Redis reliable dan dekat.
   - perlu atomic operation/Lua script.

4. **Provider-side idempotency + tolerate 429**
   - tetap perlu backoff.
   - bukan pengganti rate limiter.

5. **External queue with controlled consumer count**
   - misalnya JMS/Kafka/SQS worker dengan consumer concurrency fixed.

---

## 9. Token Lifecycle dan Authentication

### 9.1 Token bukan sekadar string

Token punya lifecycle:

```text
acquire
cache
use
expire
refresh/re-acquire
rotate secret
revoke
failover
```

Batch external API yang berjalan lama harus siap token expired di tengah eksekusi.

### 9.2 Token cache minimal

```java
import java.time.Instant;

public class AccessTokenCache {
    private volatile CachedToken cached;

    public String getToken() {
        CachedToken current = cached;
        if (current != null && !current.isExpiringSoon()) {
            return current.value();
        }

        synchronized (this) {
            current = cached;
            if (current != null && !current.isExpiringSoon()) {
                return current.value();
            }
            cached = fetchNewToken();
            return cached.value();
        }
    }

    public void invalidate(String token) {
        CachedToken current = cached;
        if (current != null && current.value().equals(token)) {
            synchronized (this) {
                current = cached;
                if (current != null && current.value().equals(token)) {
                    cached = null;
                }
            }
        }
    }

    private CachedToken fetchNewToken() {
        // OAuth client credentials / provider-specific login
        return new CachedToken("token", Instant.now().plusSeconds(3300));
    }

    public record CachedToken(String value, Instant expiresAt) {
        boolean isExpiringSoon() {
            return Instant.now().plusSeconds(60).isAfter(expiresAt);
        }
    }
}
```

### 9.3 401 handling

Rule aman:

```text
Jika 401:
    invalidate token
    refresh token once
    retry request once if operation is idempotent
    jika masih 401 -> fail permanent/authentication issue
```

Jangan retry 401 berkali-kali. Itu biasanya:

1. credential salah,
2. secret expired,
3. permission revoked,
4. token audience/scope salah,
5. provider auth outage.

### 9.4 Secret rotation

Batch panjang harus mampu menangani secret rotation:

1. jangan cache secret selamanya,
2. gunakan central secret manager,
3. reload credential saat token fetch gagal karena invalid client,
4. audit secret version tanpa log secret value,
5. siapkan runbook rotation.

---

## 10. HTTP Status Classification

External API batch harus punya classification eksplisit.

| Status | Makna umum | Treatment |
|---|---|---|
| 200/201/202/204 | sukses | mark success; untuk 202 mungkin poll/result later |
| 400 | request invalid | permanent failure; jangan retry kecuali payload bisa diperbaiki |
| 401 | token invalid/expired | refresh once; retry once if safe |
| 403 | forbidden | permanent/security/config issue |
| 404 | resource not found | domain-specific; bisa permanent atau acceptable |
| 409 | conflict | retry jika optimistic conflict; permanent jika business conflict |
| 408 | timeout by server | retryable with idempotency |
| 422 | semantic validation failed | usually permanent data issue |
| 423/429 | locked/throttled | retry with backoff/Retry-After |
| 500 | provider error | retryable with budget |
| 502/503/504 | gateway/service unavailable | retryable with backoff/circuit breaker |

Jangan membuat rule generik seperti:

```text
all 4xx permanent, all 5xx retryable
```

Itu terlalu kasar. Misalnya `409` bisa retryable dalam concurrency conflict, tetapi bisa permanent dalam business rule conflict.

---

## 11. Retry Design

### 11.1 Retry policy minimal

Retry policy harus punya:

1. max attempts,
2. max elapsed time,
3. exponential backoff,
4. jitter,
5. status/exception classification,
6. idempotency guard,
7. retry budget,
8. observability.

### 11.2 Backoff dengan jitter

```java
import java.time.Duration;
import java.util.concurrent.ThreadLocalRandom;

public class BackoffPolicy {
    private final long baseMillis;
    private final long maxMillis;

    public BackoffPolicy(long baseMillis, long maxMillis) {
        this.baseMillis = baseMillis;
        this.maxMillis = maxMillis;
    }

    public Duration nextDelay(int attempt) {
        long exponential = baseMillis * (1L << Math.min(attempt, 10));
        long capped = Math.min(exponential, maxMillis);
        long jitter = ThreadLocalRandom.current().nextLong(0, Math.max(1, capped / 2));
        return Duration.ofMillis((capped / 2) + jitter);
    }
}
```

Jitter mencegah semua worker retry pada detik yang sama.

### 11.3 Retry-After

Jika provider mengembalikan `Retry-After`, gunakan itu sebagai sinyal kuat.

```text
if HTTP 429 and Retry-After exists:
    nextAttemptAt = now + Retry-After
else:
    nextAttemptAt = now + backoffPolicy.nextDelay(attempt)
```

### 11.4 Retry budget

Retry budget mencegah retry menguasai kapasitas.

Contoh:

```text
normal capacity: 300 request/min
retry budget: max 10% = 30 retry/min
fresh work budget: 270 request/min
```

Tanpa retry budget, retry bisa men-starve pekerjaan baru.

---

## 12. Circuit Breaker dan Bulkhead

MicroProfile Fault Tolerance menyediakan strategi seperti timeout, retry, bulkhead, circuit breaker, fallback, dan asynchronous execution. Dalam konteks Jakarta Batch, annotation tersebut bisa berguna di service layer, tetapi harus dipahami sebagai bagian dari control policy, bukan magic reliability.

### 12.1 Bulkhead

Bulkhead menjawab:

```text
Berapa banyak concurrent execution yang boleh masuk ke area external API ini?
```

Contoh pembagian:

```text
Provider A update API: max 10 in-flight
Provider A search API: max 20 in-flight
Provider B notification API: max 5 in-flight
```

### 12.2 Circuit breaker

Circuit breaker menjawab:

```text
Jika provider sedang gagal berat, kapan kita berhenti mencoba sementara?
```

State mental model:

```text
CLOSED     -> normal, request allowed
OPEN       -> fail fast, request not sent
HALF_OPEN  -> trial limited requests
```

### 12.3 Circuit breaker dalam batch

Dalam batch, circuit breaker harus terhubung ke job policy:

| Circuit state | Batch behavior |
|---|---|
| Closed | process normally |
| Open short | defer outbox rows to later |
| Open long | stop job gracefully or mark step failed retryable |
| Half-open | send small probe only |

Jangan biarkan circuit breaker hanya melempar exception tanpa control plane yang paham apa artinya.

---

## 13. Idempotency Key Design

### 13.1 Syarat idempotency key

Idempotency key harus:

1. stabil untuk business operation yang sama,
2. unik untuk operation yang berbeda,
3. bisa direkonstruksi saat restart,
4. tidak bergantung pada timestamp random,
5. disimpan di local database,
6. dikirim ke provider jika provider mendukungnya,
7. masuk audit trail.

Buruk:

```text
UUID.randomUUID() setiap retry
```

Bagus:

```text
<system>-<apiName>-<businessKey>-<operationVersion>
```

Contoh:

```text
ACEAS-ONEMAP-POSTAL-lookup-123456-v1
CASEMGMT-ENFORCEMENT-sync-case-CASE-2026-000123-v3
```

### 13.2 Idempotency key untuk update mutable

Jika payload bisa berubah, idempotency key harus mencerminkan versi operasi.

```text
caseId = C123
operation = submitEscalation
operationVersion = escalationDecisionVersion 7
key = C123-submitEscalation-v7
```

Jika versi 8 muncul, itu operasi baru.

### 13.3 Local idempotency table

```sql
CREATE TABLE API_IDEMPOTENCY_RECORD (
    IDEMPOTENCY_KEY      VARCHAR2(128) PRIMARY KEY,
    BUSINESS_KEY         VARCHAR2(128) NOT NULL,
    API_NAME             VARCHAR2(100) NOT NULL,
    REQUEST_HASH         VARCHAR2(128) NOT NULL,
    STATUS               VARCHAR2(30) NOT NULL,
    RESPONSE_HASH        VARCHAR2(128) NULL,
    PROVIDER_REFERENCE   VARCHAR2(128) NULL,
    FIRST_REQUEST_AT     TIMESTAMP NOT NULL,
    LAST_REQUEST_AT      TIMESTAMP NOT NULL,
    ATTEMPT_COUNT        NUMBER NOT NULL
);
```

Jika request dengan idempotency key sama tetapi request hash berbeda, itu red flag.

```text
same idempotency key + different payload = bug or semantic conflict
```

---

## 14. Inbox Pattern untuk Response/Event dari Provider

Outbox menangani request keluar. Inbox menangani response/event masuk.

Jika provider mengirim callback/webhook:

```text
Provider -> callback endpoint -> INBOX table -> processor job -> update domain state
```

Inbox mencegah callback duplicate diproses berkali-kali.

```sql
CREATE TABLE EXTERNAL_API_INBOX (
    EVENT_ID          VARCHAR2(128) PRIMARY KEY,
    PROVIDER_NAME     VARCHAR2(100) NOT NULL,
    EVENT_TYPE        VARCHAR2(100) NOT NULL,
    PAYLOAD           CLOB NOT NULL,
    STATUS            VARCHAR2(30) NOT NULL,
    RECEIVED_AT       TIMESTAMP NOT NULL,
    PROCESSED_AT      TIMESTAMP NULL,
    CORRELATION_ID    VARCHAR2(128) NULL
);
```

Rule:

```text
insert event if absent
process only once
make domain update idempotent
retain raw payload for evidence
```

---

## 15. Jakarta Batch JSL Contoh: Outbox Preparation Job

```xml
<?xml version="1.0" encoding="UTF-8"?>
<job id="prepareExternalSyncOutbox" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">

    <properties>
        <property name="apiName" value="external-case-sync"/>
        <property name="batchWindow" value="#{jobParameters['batchWindow']}"/>
        <property name="requestedBy" value="#{jobParameters['requestedBy']}"/>
    </properties>

    <step id="prepare-outbox">
        <chunk item-count="100" skip-limit="100" retry-limit="3">
            <reader ref="caseSyncCandidateReader"/>
            <processor ref="caseSyncRequestProcessor"/>
            <writer ref="apiOutboxWriter"/>

            <skippable-exception-classes>
                <include class="com.example.batch.InvalidBusinessDataException"/>
            </skippable-exception-classes>

            <retryable-exception-classes>
                <include class="jakarta.persistence.OptimisticLockException"/>
                <include class="java.sql.SQLTransientException"/>
            </retryable-exception-classes>
        </chunk>
    </step>
</job>
```

Perhatikan: job ini belum memanggil API external. Ia hanya membuat outbox secara aman.

---

## 16. Dispatcher Job untuk Outbox

Dispatcher bisa berupa:

1. Jakarta Batch job periodik,
2. Jakarta ManagedScheduledExecutorService,
3. JMS consumer,
4. Kubernetes CronJob/Job,
5. dedicated worker service.

Jika memakai Jakarta Batch:

```xml
<job id="dispatchExternalApiOutbox" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    <step id="dispatch-outbox">
        <chunk item-count="25" retry-limit="0" skip-limit="1000">
            <reader ref="pendingOutboxReader"/>
            <processor ref="outboxDispatchProcessor"/>
            <writer ref="outboxResultWriter"/>
        </chunk>
    </step>
</job>
```

Kenapa `retry-limit="0"` di Jakarta Batch layer bisa masuk akal?

Karena retry external API bisa dikelola oleh outbox state:

```text
attempt_count
next_attempt_at
last_status
last_error
```

Dengan begitu, retry tidak harus terjadi dalam transaksi chunk yang sama.

---

## 17. Outbox Claiming Pattern

Di cluster, dua worker tidak boleh mengirim outbox row yang sama.

### 17.1 Claim by status transition

```sql
UPDATE EXTERNAL_API_OUTBOX
SET STATUS = 'IN_FLIGHT',
    UPDATED_AT = SYSTIMESTAMP
WHERE OUTBOX_ID = :outboxId
  AND STATUS IN ('PENDING', 'FAILED_RETRYABLE')
  AND (NEXT_ATTEMPT_AT IS NULL OR NEXT_ATTEMPT_AT <= SYSTIMESTAMP)
```

Jika update count = 1, worker berhasil claim.

Jika update count = 0, row sudah diambil worker lain atau belum waktunya.

### 17.2 Claim with lease

Untuk worker crash setelah claim:

```sql
ALTER TABLE EXTERNAL_API_OUTBOX ADD (
    LEASE_OWNER VARCHAR2(128),
    LEASE_UNTIL TIMESTAMP
);
```

Claim rule:

```text
claim if status pending/retryable and lease expired
set lease_owner=thisWorker
set lease_until=now+5min
```

Jika worker mati, lease expired dan row bisa diproses ulang.

Karena itu idempotency tetap wajib.

---

## 18. HTTP Client Design

### 18.1 Timeout harus eksplisit

Minimal timeout:

1. connect timeout,
2. request timeout,
3. read/response timeout,
4. overall operation deadline.

Contoh Java 11+ `HttpClient`:

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class ExternalApiClient {

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    public ApiResponse send(ApiRequest request, String token) throws Exception {
        HttpRequest httpRequest = HttpRequest.newBuilder()
                .uri(URI.create(request.url()))
                .timeout(Duration.ofSeconds(10))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .header("Idempotency-Key", request.idempotencyKey())
                .header("X-Correlation-Id", request.correlationId())
                .POST(HttpRequest.BodyPublishers.ofString(request.body()))
                .build();

        HttpResponse<String> response = client.send(httpRequest, HttpResponse.BodyHandlers.ofString());
        return ApiResponse.from(response.statusCode(), response.headers(), response.body());
    }
}
```

### 18.2 Jangan log payload mentah sembarangan

Untuk audit dan debugging, simpan:

1. request hash,
2. response hash,
3. redacted payload,
4. provider request ID,
5. correlation ID,
6. status code,
7. error code.

Hindari:

1. access token,
2. PII mentah,
3. credential,
4. full payload sensitif di log aplikasi.

---

## 19. Processor untuk Dispatch Classification

```java
public class OutboxDispatchProcessor {

    private final ExternalApiClient client;
    private final AccessTokenCache tokenCache;
    private final ApiResultClassifier classifier;
    private final BackoffPolicy backoffPolicy;

    public OutboxDispatchProcessor(
            ExternalApiClient client,
            AccessTokenCache tokenCache,
            ApiResultClassifier classifier,
            BackoffPolicy backoffPolicy
    ) {
        this.client = client;
        this.tokenCache = tokenCache;
        this.classifier = classifier;
        this.backoffPolicy = backoffPolicy;
    }

    public DispatchResult process(ExternalApiOutbox outbox) {
        String token = tokenCache.getToken();

        try {
            ApiResponse response = client.send(outbox.toApiRequest(), token);

            if (response.statusCode() == 401) {
                tokenCache.invalidate(token);
                String refreshed = tokenCache.getToken();
                response = client.send(outbox.toApiRequest(), refreshed);
            }

            return classifier.classify(outbox, response, backoffPolicy);
        } catch (java.net.http.HttpTimeoutException e) {
            return DispatchResult.retryable(outbox.id(), "HTTP_TIMEOUT", e.getMessage());
        } catch (java.io.IOException e) {
            return DispatchResult.retryable(outbox.id(), "IO_ERROR", e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return DispatchResult.cancelled(outbox.id(), "INTERRUPTED", e.getMessage());
        } catch (Exception e) {
            return DispatchResult.retryable(outbox.id(), "UNKNOWN_CLIENT_ERROR", e.getMessage());
        }
    }
}
```

Classification harus menghasilkan decision eksplisit:

```text
SUCCEEDED
RETRY_LATER
PERMANENT_FAILURE
DEAD_LETTER
RECONCILIATION_REQUIRED
CANCELLED
```

---

## 20. Writer untuk Menyimpan Dispatch Result

```java
import jakarta.batch.api.chunk.ItemWriter;
import jakarta.enterprise.context.Dependent;
import jakarta.inject.Inject;
import java.io.Serializable;
import java.util.List;

@Dependent
public class OutboxResultWriter implements ItemWriter {

    @Inject
    ApiOutboxRepository repository;

    @Override
    public void open(Serializable checkpoint) {
    }

    @Override
    public void writeItems(List<Object> items) {
        for (Object item : items) {
            DispatchResult result = (DispatchResult) item;

            switch (result.decision()) {
                case SUCCEEDED -> repository.markSucceeded(result);
                case RETRY_LATER -> repository.markRetryable(result);
                case PERMANENT_FAILURE -> repository.markPermanentFailure(result);
                case DEAD_LETTER -> repository.markDeadLetter(result);
                case RECONCILIATION_REQUIRED -> repository.markReconciliationRequired(result);
                case CANCELLED -> repository.releaseClaim(result);
            }
        }
    }

    @Override
    public Serializable checkpointInfo() {
        return null;
    }

    @Override
    public void close() {
    }
}
```

Di Java 8, gunakan `switch` biasa, bukan arrow switch.

---

## 21. Commit Interval untuk External API Batch

Commit interval terlalu besar:

```text
+ throughput DB mungkin bagus
- rollback mengulang banyak state
- banyak external call terjadi sebelum commit lokal
- debugging sulit
```

Commit interval terlalu kecil:

```text
+ failure bounded
+ checkpoint frequent
- overhead DB meningkat
- throughput turun
```

Rule awal:

| Workload | Commit interval awal |
|---|---:|
| Direct external side effect | 1–10 |
| Outbox preparation only | 100–1000 |
| Dispatch result writer | 10–100 |
| High-risk regulatory action | 1–25 |
| Read-only enrichment | 50–500 |

Tuning harus berbasis metric, bukan perasaan.

---

## 22. Partitioning External API Batch

Partitioning bisa mempercepat batch, tetapi bisa melanggar rate limit.

### 22.1 Formula kasar

```text
providerRateLimitPerMinute = 300
averageLatencySeconds = 2
safeUtilization = 0.8

allowedThroughputPerSecond = 300 / 60 * 0.8 = 4 req/s
requiredConcurrency = throughput * latency = 4 * 2 = 8 in-flight
```

Jika kamu membuat 16 partition dan masing-masing 5 concurrency:

```text
16 * 5 = 80 in-flight
```

Itu mungkin jauh di atas kebutuhan dan limit.

### 22.2 Partition fairness

Jika partition berdasarkan tenant/module:

```text
partition A: 1.000.000 records
partition B: 10.000 records
partition C: 100 records
```

Maka partition A bisa mendominasi quota. Fairness perlu policy:

1. per-tenant quota,
2. weighted round robin,
3. per-module concurrency cap,
4. priority lane,
5. starvation prevention.

---

## 23. SLA-Aware Batch Design

Batch external API sering punya window:

```text
start 01:00
must finish 05:30
external provider maintenance 02:00–02:30
rate limit 300/min
records 50.000
```

Hitung feasibility:

```text
capacity = 300/min
available window = 4 hours = 240 min
max requests = 72.000
```

Secara quota cukup. Tetapi jika retry rate 20%:

```text
effective requests = 50.000 * 1.2 = 60.000
```

Masih cukup. Jika retry rate 60%:

```text
80.000 > 72.000
```

Job tidak feasible dalam window.

Top-tier batch design harus bisa menjawab sebelum implementation:

```text
Apakah pekerjaan ini secara matematis mungkin selesai dalam SLA window?
```

---

## 24. External API Batch State Machine

State machine outbox yang sehat:

```text
PENDING
  -> IN_FLIGHT
  -> SUCCEEDED
  -> FAILED_RETRYABLE -> PENDING/IN_FLIGHT
  -> FAILED_PERMANENT
  -> DEAD_LETTER
  -> RECONCILIATION_REQUIRED
  -> CANCELLED
```

Invariants:

1. `SUCCEEDED` terminal kecuali manual correction.
2. `FAILED_PERMANENT` tidak auto retry.
3. `FAILED_RETRYABLE` harus punya `next_attempt_at`.
4. `IN_FLIGHT` harus punya lease timeout.
5. `DEAD_LETTER` harus punya reason.
6. `RECONCILIATION_REQUIRED` harus punya evidence.
7. Setiap transition harus audit-able.

---

## 25. Reconciliation

Reconciliation adalah proses membandingkan local state dan provider state.

Dibutuhkan saat:

1. API timeout setelah request terkirim,
2. provider return 202 accepted,
3. client crash setelah API sukses sebelum DB update,
4. duplicate idempotency response tidak jelas,
5. provider tidak mendukung idempotency key,
6. partial outage.

### 25.1 Reconciliation strategy

```text
for each outbox row in RECONCILIATION_REQUIRED:
    query provider by provider_reference or business_key
    if provider says operation applied:
        mark succeeded
    else if provider says not applied and retry safe:
        mark retryable
    else:
        mark dead_letter/manual_review
```

### 25.2 Evidence yang harus disimpan

1. request timestamp,
2. timeout timestamp,
3. idempotency key,
4. provider request ID jika ada,
5. request hash,
6. response partial/error,
7. correlation ID,
8. retry attempts,
9. reconciliation result.

---

## 26. Anti-Patterns

### 26.1 Retry semua exception

```xml
<retryable-exception-classes>
    <include class="java.lang.Exception"/>
</retryable-exception-classes>
```

Ini berbahaya. Validation error dan authentication error bisa di-retry tanpa akhir.

### 26.2 UUID idempotency baru setiap attempt

```java
String idempotencyKey = UUID.randomUUID().toString();
```

Ini bukan idempotency. Ini membuat setiap retry terlihat seperti operasi baru.

### 26.3 Parallel partition tanpa global limiter

```text
8 nodes * 10 partitions * 5 threads = 400 concurrent request
```

Jika provider limit 20 in-flight, ini self-inflicted outage.

### 26.4 Menaruh token di log

```text
Authorization: Bearer eyJ...
```

Ini security incident.

### 26.5 Menjadikan HTTP 500 sebagai skip

Skip berarti item dianggap boleh dilewati. HTTP 500 biasanya provider failure, bukan data invalid.

### 26.6 Commit interval besar dengan side effect non-idempotent

Jika writer mengirim 1000 external requests sebelum commit lokal, lalu gagal pada item ke-999, restart bisa mengulang side effect dalam skala besar.

### 26.7 Circuit breaker tanpa operational meaning

Circuit breaker open tetapi batch terus membaca dan menandai semua item failed. Harus ada policy: defer, stop, atau pause.

---

## 27. Testing Strategy

### 27.1 Unit tests

Test classification:

```text
200 -> success
401 first -> refresh then retry
401 second -> permanent auth failure
429 Retry-After -> retry later at specified time
500 -> retryable
422 -> permanent data failure
Timeout after send -> reconciliation required or retryable depending API semantics
```

### 27.2 Idempotency tests

```text
same item processed twice -> one outbox row
same idempotency key same payload -> accepted
same idempotency key different payload -> conflict
restart after writer failure -> no duplicate side effect
```

### 27.3 Rate limit tests

1. fake provider returns 429 after N request/min,
2. verify limiter slows down,
3. verify Retry-After honored,
4. verify parallel partitions do not exceed global limit.

### 27.4 Chaos tests

Simulate:

1. provider 500 for 10 minutes,
2. provider latency spike,
3. token endpoint down,
4. DB deadlock,
5. worker crash after API success before DB update,
6. duplicate callback,
7. pod eviction,
8. network partition.

### 27.5 Restart tests

```text
crash before outbox commit
crash after outbox commit
crash after claim before send
crash after send before result update
crash after result update before checkpoint
restart job
verify state correctness
```

---

## 28. Observability

Metrics minimum:

```text
api_outbox_pending_count
api_outbox_in_flight_count
api_outbox_succeeded_count
api_outbox_failed_retryable_count
api_outbox_failed_permanent_count
api_outbox_dead_letter_count
api_outbox_reconciliation_required_count
api_request_duration_seconds
api_request_attempt_total
api_request_retry_total
api_request_429_total
api_request_5xx_total
api_token_refresh_total
api_circuit_breaker_open_total
api_rate_limiter_wait_seconds
api_dispatch_lag_seconds
```

Logs minimum:

```text
jobExecutionId
stepExecutionId
outboxId
businessKey
apiName
idempotencyKey
correlationId
attempt
httpStatus
providerRequestId
resultDecision
nextAttemptAt
```

Alert examples:

```text
dead_letter_count > 0 for critical API
reconciliation_required_count increasing
429 rate > threshold for 5 minutes
token refresh failure
pending lag > SLA
circuit breaker open > 10 minutes
retryable failure age > threshold
```

---

## 29. Audit dan Compliance

Untuk regulatory/enterprise system, audit harus menjawab:

1. siapa yang memulai job,
2. parameter apa yang dipakai,
3. dataset apa yang diproses,
4. request apa yang dikirim,
5. kapan dikirim,
6. response apa yang diterima,
7. item mana yang sukses/gagal,
8. item mana yang di-retry,
9. item mana yang di-skip/dead-letter,
10. apakah ada manual override,
11. apakah ada reconciliation,
12. bukti bahwa duplicate request tidak menyebabkan duplicate effect.

Audit event contoh:

```json
{
  "eventType": "EXTERNAL_API_DISPATCH_RESULT",
  "jobExecutionId": 918273,
  "stepExecutionId": 918274,
  "outboxId": "OUT-20260617-000001",
  "businessKey": "CASE-2026-000123",
  "apiName": "external-case-sync",
  "idempotencyKey": "CASE-2026-000123-sync-v7",
  "correlationId": "corr-abc-123",
  "attempt": 2,
  "httpStatus": 200,
  "decision": "SUCCEEDED",
  "requestedBy": "system.batch",
  "createdAt": "2026-06-17T10:15:30Z"
}
```

---

## 30. Design Decision Matrix

| Situation | Recommended design |
|---|---|
| GET enrichment, no side effect | Direct call with cache/rate limit |
| Idempotent upsert API, small volume | Direct writer acceptable with idempotency key |
| Non-idempotent API | Avoid direct call; use outbox + reconciliation/compensation |
| High volume, strict rate limit | Outbox + controlled dispatcher |
| Provider supports callback | Outbox + inbox |
| Provider returns 202 async accepted | Outbox + polling/reconciliation job |
| Batch must finish in strict window | Capacity math + SLA-aware throttling |
| Multi-node cluster | Distributed limiter or single dispatcher |
| Strong audit requirement | Outbox/inbox with immutable audit evidence |
| External API unstable | Circuit breaker + deferred retry + control plane visibility |

---

## 31. End-to-End Example Architecture

```text
+-----------------------------+
| Admin / Scheduler           |
| Start batch with parameters |
+--------------+--------------+
               |
               v
+-----------------------------+
| Jakarta Batch Job A         |
| Prepare API Outbox          |
| - read candidates           |
| - validate                  |
| - create idempotent outbox  |
+--------------+--------------+
               |
               v
+-----------------------------+
| EXTERNAL_API_OUTBOX         |
| Durable request ledger      |
+--------------+--------------+
               |
               v
+-----------------------------+
| Dispatcher Job / Worker     |
| - claim rows                |
| - rate limit                |
| - token cache               |
| - call API                  |
| - classify result           |
+--------------+--------------+
               |
               v
+-----------------------------+
| Provider API                |
+--------------+--------------+
               |
               v
+-----------------------------+
| Result Update / Inbox       |
| - success                   |
| - retry later               |
| - permanent failure         |
| - reconciliation required   |
+--------------+--------------+
               |
               v
+-----------------------------+
| Metrics / Audit / Dashboard |
+-----------------------------+
```

---

## 32. Production Checklist

### External contract

- [ ] Rate limit documented.
- [ ] Quota documented.
- [ ] Timeout expectation documented.
- [ ] Retryable status documented.
- [ ] Idempotency support confirmed.
- [ ] Correlation/request ID support confirmed.
- [ ] Error schema documented.
- [ ] Maintenance window documented.

### Batch design

- [ ] Direct call vs outbox decision explicit.
- [ ] Commit interval justified.
- [ ] Restart scenario tested.
- [ ] Duplicate execution tested.
- [ ] Skip/retry classification explicit.
- [ ] Partition count aligned with rate limit.
- [ ] Stop/cancel behavior tested.

### Resilience

- [ ] Connect/read/request timeout configured.
- [ ] Retry max attempts configured.
- [ ] Exponential backoff + jitter implemented.
- [ ] Retry-After honored.
- [ ] Circuit breaker policy defined.
- [ ] Bulkhead/concurrency limit defined.
- [ ] Global rate limit in cluster handled.

### Idempotency

- [ ] Stable idempotency key defined.
- [ ] Request hash stored.
- [ ] Duplicate key with different payload rejected.
- [ ] Provider idempotency response handled.
- [ ] Reconciliation path exists.

### Security

- [ ] Token not logged.
- [ ] Secret loaded from secure source.
- [ ] Token refresh safe under concurrency.
- [ ] 401 retry limited.
- [ ] Scope/permission validated.

### Observability

- [ ] Metrics for pending/in-flight/success/failure/retry.
- [ ] 429/5xx/timeout metrics.
- [ ] Rate limiter wait metric.
- [ ] Dispatch lag metric.
- [ ] Dashboard exists.
- [ ] Alerts defined.

### Audit

- [ ] Job parameters auditable.
- [ ] Outbox state transitions auditable.
- [ ] Request/response hash stored.
- [ ] Provider request ID stored.
- [ ] Dead-letter reason stored.
- [ ] Manual override tracked.

---

## 33. Ringkasan

External API batch adalah salah satu bentuk batch paling berisiko karena ia menggabungkan:

1. batch restartability,
2. distributed side effects,
3. external provider capacity,
4. token lifecycle,
5. network failure,
6. rate limit,
7. retry,
8. idempotency,
9. audit evidence,
10. operational control.

Prinsip utamanya:

```text
Never treat external API calls as ordinary method calls inside a loop.
```

Desain yang kuat biasanya memakai:

1. stable idempotency key,
2. explicit status classification,
3. bounded concurrency,
4. global rate limit,
5. retry with budget/backoff/jitter,
6. outbox for durable side effects,
7. inbox for callback deduplication,
8. reconciliation for ambiguous outcomes,
9. full observability,
10. audit-ready state transitions.

Jakarta Batch memberi struktur job, step, chunk, checkpoint, retry/skip, dan restart. Jakarta Concurrency memberi primitive untuk managed async execution. MicroProfile Fault Tolerance memberi abstraction untuk timeout, retry, bulkhead, circuit breaker, dan fallback. Tetapi reliability external API batch tetap bergantung pada desain state, idempotency, capacity, dan operational governance.

---

## 34. Latihan / Thought Experiment

### Latihan 1 — Direct writer atau outbox?

Kamu punya batch 100.000 records yang mengirim update ke provider external. Provider:

```text
rate limit: 600/min
supports idempotency key: yes
average latency: 1.5s
maintenance window: 02:00–03:00
batch window: 00:00–05:00
```

Pertanyaan:

1. Apakah direct writer aman?
2. Berapa concurrency teoritis yang cukup?
3. Bagaimana desain retry budget?
4. Apa yang terjadi jika provider down 30 menit?
5. Apa metric utama yang harus dipantau?

### Latihan 2 — Ambiguous timeout

External API call timeout setelah 10 detik. Tidak ada response. Bisa jadi request tidak sampai, bisa jadi request sukses tetapi response hilang.

Desain:

1. status outbox apa yang tepat?
2. apakah langsung retry?
3. bagaimana jika API non-idempotent?
4. evidence apa yang harus disimpan?
5. apakah reconciliation wajib?

### Latihan 3 — Cluster rate limit

Batch berjalan di 5 pod. Masing-masing pod punya 4 partition. Provider limit 300/min global.

Pertanyaan:

1. Mengapa local limiter per pod tidak cukup?
2. Pilih desain: single dispatcher, DB token bucket, Redis limiter, atau external queue.
3. Apa failure mode pilihanmu?
4. Bagaimana memastikan fairness antar tenant?

---

## 35. Koneksi ke Part Berikutnya

Part berikutnya akan membahas **Clustered Jakarta Batch and Distributed Execution Concerns**.

Kita akan masuk lebih jauh ke:

1. single-node vs cluster execution,
2. duplicate job start prevention,
3. job repository sebagai coordination point,
4. node failure dan lease,
5. rolling deployment saat batch berjalan,
6. Kubernetes/EKS concern,
7. kapan Jakarta Batch cocok dan kapan Kubernetes Job/CronJob lebih tepat.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 28 — File, CSV, XML, JSON, and Large Payload Batch Processing](./28-file-csv-xml-json-large-payload-batch-processing.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 30 — Clustered Jakarta Batch and Distributed Execution Concerns](./30-clustered-jakarta-batch-distributed-execution.md)

</div>
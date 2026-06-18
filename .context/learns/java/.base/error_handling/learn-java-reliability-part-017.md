# learn-java-reliability-part-017.md

# Part 017 — Retry Engineering

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Untuk: Java Software Engineer / Tech Lead  
> Level: Advanced / Production Reliability  
> Status seri: Part 017 dari 030 — **belum selesai**

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas **timeouts, deadlines, dan cancellation**. Itu penting karena retry tanpa timeout adalah ilusi: kalau request pertama tidak pernah selesai, retry tidak pernah punya kesempatan untuk bekerja dengan benar.

Bagian ini membahas **retry engineering**.

Kata kuncinya adalah **engineering**, bukan sekadar “tambahkan retry”. Retry adalah salah satu mekanisme recovery paling umum, tetapi juga salah satu penyebab paling umum dari cascading failure, duplicate side effect, retry storm, dan overload amplification.

Tujuan bagian ini:

1. Membangun mental model retry sebagai **controlled re-execution**, bukan “coba lagi sampai berhasil”.
2. Membedakan failure yang boleh retry dan tidak boleh retry.
3. Mendesain retry policy yang mempertimbangkan idempotency, timeout budget, downstream capacity, dan user impact.
4. Memahami backoff, jitter, retry budget, retry amplification, dan circuit breaker interaction.
5. Mampu membuat retry policy Java/Spring yang defensible untuk production.
6. Mampu mereview apakah retry dalam suatu service memperbaiki reliability atau justru memperbesar incident.

Referensi utama yang relevan:

- Resilience4j Retry documentation: https://resilience4j.readme.io/docs/retry
- Google SRE — Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/
- Google SRE — Production Services Best Practices: https://sre.google/sre-book/service-best-practices/
- AWS Builders Library — Timeouts, retries, and backoff with jitter: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
- Microsoft Azure Architecture Center — Retry Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/retry
- Microsoft Azure Architecture Center — Transient Fault Handling: https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults

---

## 1. Core Problem

Retry terlihat sederhana:

```text
call dependency
if failed:
  try again
```

Tetapi di production, pertanyaannya bukan sesederhana itu.

Pertanyaan sebenarnya:

```text
Apakah failure ini transient?
Apakah operation ini aman diulang?
Apakah downstream sedang overload?
Apakah retry akan membantu atau memperburuk?
Apakah caller masih punya waktu menunggu?
Apakah side effect sebelumnya mungkin sudah terjadi?
Apakah retry dilakukan di layer yang tepat?
Apakah ada retry lain di bawah/atas layer ini?
Apakah hasil retry bisa dibedakan dari duplicate execution?
Apa yang terjadi jika 1.000 client melakukan retry bersamaan?
```

Retry yang baik meningkatkan availability pada transient failure.

Retry yang buruk mengubah temporary failure menjadi systemic outage.

---

## 2. Mental Model: Retry sebagai Controlled Re-Execution

Retry bukan “mengulang request”. Retry adalah:

```text
controlled re-execution of an operation whose previous outcome is failed, unknown, delayed, or inconclusive
```

Ada empat kemungkinan outcome dari attempt pertama:

| Outcome attempt pertama | Makna | Retry aman? |
|---|---|---|
| Tidak terkirim sama sekali | Dependency belum menerima request | Mungkin aman |
| Terkirim, gagal sebelum side effect | Dependency menerima tapi tidak mutate state | Mungkin aman |
| Terkirim, side effect terjadi, response gagal | Outcome unknown bagi caller | Hanya aman jika idempotent |
| Terkirim, dependency overload | Retry mungkin memperburuk | Harus dibatasi/backoff/circuit-break |

Masalah utama retry bukan hanya “gagal lalu coba lagi”, tetapi **uncertainty**.

Contoh:

```text
Service A -> Payment Provider

A mengirim charge request.
Provider berhasil charge kartu.
Response provider timeout.
A melihat timeout.
A retry.
Provider charge lagi.
User kena double charge.
```

Dalam kasus ini, retry tidak memperbaiki reliability. Retry merusak correctness.

Mental model utama:

```text
Retry is safe only when repeated execution preserves correctness and does not overload the dependency.
```

---

## 3. Retry Bukan Error Handling Universal

Retry hanya cocok untuk failure yang memiliki peluang berhasil jika dicoba lagi.

Retry tidak cocok untuk:

- invalid request;
- missing required field;
- unauthorized request;
- forbidden action;
- business rule violation;
- invariant violation;
- duplicate command tanpa idempotency key;
- data corruption;
- programmer bug;
- permanent configuration error;
- unsupported operation;
- schema mismatch yang tidak kompatibel;
- downstream sedang hard-down dan sudah jelas tidak recover dalam deadline.

Retry cocok untuk beberapa transient failure:

- network glitch;
- temporary DNS resolution issue;
- connection reset;
- short-lived timeout;
- temporary 503;
- selected 502/504;
- selected 429 dengan `Retry-After`;
- database deadlock;
- database lock timeout;
- optimistic concurrency conflict tertentu;
- temporary connection pool acquisition failure jika penyebabnya burst singkat;
- leader election / failover window;
- dependency warm-up saat rolling deployment.

Namun “transient” bukan berarti selalu retry. Transient tetap harus diuji terhadap:

```text
idempotency + deadline + budget + capacity + layer ownership
```

---

## 4. Failure Classification untuk Retry

Sebelum membuat retry policy, kita harus mengklasifikasikan failure.

### 4.1 Classification Matrix

| Failure | Contoh | Retriable? | Catatan |
|---|---|---:|---|
| Validation failure | 400 invalid payload | Tidak | Caller harus memperbaiki request |
| Authentication failure | 401 token expired | Kadang | Refresh token sekali, bukan retry buta |
| Authorization failure | 403 | Tidak | Permission tidak berubah dengan retry |
| Not found | 404 | Biasanya tidak | Kecuali read-after-write eventual consistency |
| Conflict | 409 | Kadang | Bisa retry jika optimistic lock dan command masih valid |
| Rate limit | 429 | Kadang | Ikuti `Retry-After`, gunakan backoff |
| Bad gateway | 502 | Kadang | Bisa transient |
| Service unavailable | 503 | Kadang | Hati-hati overload |
| Gateway timeout | 504 | Kadang | Outcome downstream bisa unknown |
| Client timeout | read timeout | Kadang | Butuh idempotency karena request mungkin diproses |
| Connection refused | dependency down | Kadang | Jangan retry agresif |
| DNS failure | temporary resolver issue | Kadang | Batasi dan backoff |
| DB deadlock | SQL transient | Kadang | Retry transaksi utuh, bukan statement acak |
| Constraint violation | unique key violation | Tidak / conflict | Bisa menjadi idempotency success jika matching key |
| NullPointerException | bug | Tidak | Fix code |
| IllegalStateException | invariant breach | Tidak | Investigasi |

### 4.2 Retriable Bukan Properti Exception Class Saja

Kesalahan umum:

```java
catch (IOException e) {
    retry();
}
```

Masalahnya:

- IOException bisa terjadi sebelum request terkirim;
- bisa terjadi setelah request terkirim;
- bisa terjadi setelah response sebagian diterima;
- bisa menandakan network glitch;
- bisa menandakan remote peer overload;
- bisa menandakan local resource exhaustion.

Jadi classification harus mempertimbangkan:

```text
exception type
+ operation type
+ side effect possibility
+ idempotency guarantee
+ downstream signal
+ caller deadline
+ system health
```

---

## 5. Retry Safety Formula

Sebelum retry, engineer harus bisa menjawab:

```text
Can I safely execute this operation again?
```

Gunakan formula mental berikut:

```text
Retry safety = Retriable failure
             AND Idempotent operation
             AND Remaining deadline exists
             AND Retry budget available
             AND Downstream not obviously overloaded
             AND Retry layer ownership is clear
```

Jika salah satu false, retry harus ditolak atau dibatasi ketat.

### 5.1 Pseudocode Decision

```text
if failure is non-retriable:
    fail immediately

if operation is not idempotent and outcome may be unknown:
    fail safely / reconcile / query status

if no remaining deadline:
    fail immediately

if retry budget exhausted:
    fail immediately

if circuit breaker open:
    fail fast

wait according to backoff + jitter
retry once more
```

---

## 6. Retry dan Idempotency

Retry dan idempotency tidak bisa dipisahkan.

Tanpa idempotency, retry dapat membuat duplicate side effect.

Contoh operasi yang biasanya aman diulang:

```text
GET resource by ID
PUT resource with deterministic full replacement
DELETE resource by ID with idempotent delete semantics
POST command with idempotency key
message processing with inbox/dedup table
```

Contoh operasi yang tidak aman tanpa desain tambahan:

```text
POST /payments/charge
POST /orders
POST /case/{id}/approve
POST /email/send
POST /audit-events
POST /file/upload
```

Untuk operasi command, gunakan idempotency key:

```http
POST /payments
Idempotency-Key: 7f3e3f6a-9c4d-4e8e-91a6-d12e7dcb11f3
```

Server menyimpan:

```text
idempotency_key
request_hash
operation_type
resource_id
status
response_body
created_at
expires_at
```

Jika request retry datang dengan key yang sama:

| Kondisi | Response |
|---|---|
| Key belum ada | Proses baru |
| Key ada, request hash sama, selesai sukses | Return response yang sama |
| Key ada, request hash sama, sedang proses | 409/202 tergantung kontrak |
| Key ada, request hash berbeda | 409 idempotency key conflict |
| Key expired | Bisa treat as new atau reject, sesuai kontrak |

---

## 7. Retry dan Unknown Outcome

Timeout sering disalahpahami sebagai “operation gagal”.

Padahal timeout berarti:

```text
caller stopped waiting
```

Bukan:

```text
dependency stopped processing
```

### 7.1 Failure Window

```text
T0 caller sends request
T1 dependency receives request
T2 dependency commits side effect
T3 dependency sends response
T4 response lost / delayed
T5 caller timeout
```

Dari sisi caller, operation gagal. Dari sisi dependency, operation sukses.

Retry pada T6 bisa duplicate jika operation tidak idempotent.

### 7.2 Strategy untuk Unknown Outcome

Jika outcome unknown:

1. Gunakan idempotency key.
2. Query status by operation ID.
3. Gunakan outbox/inbox.
4. Gunakan reconciliation job.
5. Return pending/accepted jika synchronous certainty tidak mungkin.
6. Jangan menganggap timeout sebagai rollback.

---

## 8. Retry Budget

Retry budget membatasi seberapa banyak tambahan load yang boleh dibuat oleh retry.

Tanpa retry budget:

```text
normal traffic = 1000 RPS
error rate = 20%
retry 3x
potential downstream load = 1000 + 200 + 200 + 200 = 1600 RPS
```

Jika semua layer juga retry, amplification bisa jauh lebih besar.

### 8.1 Retry Amplification Antar Layer

Misal:

```text
Mobile client retry 3x
API Gateway retry 2x
Service A retry 3x
HTTP client library retry 2x
Database driver retry 2x
```

Worst-case attempts:

```text
3 * 2 * 3 * 2 * 2 = 72 attempts
```

Satu user action bisa menjadi 72 attempt downstream.

Ini bukan reliability. Ini self-DDoS.

### 8.2 Retry Budget Rule of Thumb

Gunakan budget berdasarkan:

- request deadline;
- downstream capacity;
- SLO;
- current error rate;
- current saturation;
- operation criticality;
- user tolerance.

Contoh policy sederhana:

```text
max total attempts: 2 or 3
max retry duration: 20-30% of caller deadline
no retry if downstream circuit open
no retry if request already near deadline
no retry on non-idempotent command without key
no retry on 4xx except selected 409/429/401-refresh
```

---

## 9. Backoff

Backoff adalah jeda sebelum retry.

Tanpa backoff, semua caller retry langsung, menambah tekanan pada dependency yang mungkin sedang overload.

### 9.1 Fixed Backoff

```text
attempt 1 failed
wait 100ms
attempt 2 failed
wait 100ms
attempt 3 failed
```

Sederhana, tetapi kurang adaptif.

### 9.2 Linear Backoff

```text
100ms, 200ms, 300ms, 400ms
```

Lebih pelan, tetapi masih cukup predictable.

### 9.3 Exponential Backoff

```text
100ms, 200ms, 400ms, 800ms, 1600ms
```

Lebih baik untuk memberi downstream waktu pulih.

### 9.4 Capped Exponential Backoff

```text
100ms, 200ms, 400ms, 800ms, 1000ms, 1000ms
```

Cap diperlukan agar delay tidak tumbuh terlalu lama.

### 9.5 Backoff Harus Masuk Deadline

Kesalahan umum:

```text
request deadline = 2s
retry waits = 1s + 2s + 4s
```

Policy ini tidak masuk akal karena retry schedule melebihi deadline caller.

Retry harus dihitung dari total budget:

```text
caller deadline = 2s
attempt 1 timeout = 500ms
backoff 1 = 100ms
attempt 2 timeout = 500ms
backoff 2 = 200ms
attempt 3 timeout = 500ms
remaining = 200ms buffer
```

---

## 10. Jitter

Jitter adalah randomization pada backoff.

Tanpa jitter, banyak client bisa retry bersamaan.

Contoh tanpa jitter:

```text
1000 client gagal pada waktu T0
semua retry di T0 + 100ms
semua retry lagi di T0 + 300ms
semua retry lagi di T0 + 700ms
```

Ini menciptakan traffic spike berulang.

Dengan jitter:

```text
retry tersebar antara T0+50ms sampai T0+150ms
retry berikutnya tersebar lagi
```

### 10.1 Jenis Jitter

| Jenis | Ide | Catatan |
|---|---|---|
| Full jitter | random antara 0 dan cap | Sangat menyebar |
| Equal jitter | setengah delay tetap + setengah random | Lebih stabil |
| Decorrelated jitter | delay berikutnya random dari rentang berdasarkan delay sebelumnya | Baik untuk menghindari lockstep |

### 10.2 Practical Rule

Untuk distributed systems, hindari retry schedule yang deterministic pada banyak instance.

Gunakan:

```text
exponential backoff + cap + jitter
```

---

## 11. Retry Placement

Salah satu pertanyaan paling penting:

```text
Retry harus dilakukan di layer mana?
```

Kemungkinan layer:

```text
client/browser/mobile
API gateway
service caller
HTTP client library
service callee
message broker consumer
DB driver
scheduler/job framework
platform mesh/proxy
```

Jika semua layer retry, amplification menjadi besar.

### 11.1 Prinsip Ownership

Retry sebaiknya ditempatkan di layer yang:

1. tahu operation semantics;
2. tahu apakah operation idempotent;
3. tahu remaining deadline;
4. tahu failure classification;
5. bisa observe attempt count;
6. bisa emit metric;
7. bisa stop saat downstream overload.

Sering kali, layer terbaik adalah **service caller**, bukan generic gateway/proxy.

### 11.2 Kapan Gateway Retry Boleh?

Gateway/proxy retry hanya aman untuk operasi yang jelas idempotent dan failure terjadi sebelum request dikirim ke backend atau pada safe methods tertentu.

Hati-hati retry otomatis pada:

```text
POST
PATCH
state-changing DELETE
file upload
payment command
approval command
message publish
```

### 11.3 Library Retry Default Harus Diaudit

Banyak HTTP client, SDK cloud, DB driver, message library punya default retry.

Engineer harus tahu:

- berapa max attempt;
- status code apa yang diretry;
- exception apa yang diretry;
- apakah ada jitter;
- apakah ada timeout per attempt;
- apakah retry mematuhi deadline;
- apakah retry metric terekspos;
- apakah bisa dimatikan untuk operasi tertentu.

---

## 12. Retry dan Circuit Breaker

Retry dan circuit breaker sering dipakai bersama, tetapi urutan dan semantics penting.

### 12.1 Tanpa Circuit Breaker

```text
Dependency down
Service A tetap retry semua request
Thread pool penuh
Latency naik
Caller timeout
Caller retry
Cascading failure
```

### 12.2 Dengan Circuit Breaker

```text
Dependency mulai gagal
Failure rate melewati threshold
Circuit open
Request baru fail fast
Retry tidak terus menghantam dependency
Setelah wait duration, half-open probe terbatas
Jika sehat, close
```

### 12.3 Composition Order

Umum digunakan:

```text
TimeLimiter -> CircuitBreaker -> Retry -> Bulkhead
```

Tetapi tidak ada urutan universal.

Pertimbangan:

- Apakah circuit breaker menghitung setiap attempt atau final call?
- Apakah retry dilakukan saat circuit open?
- Apakah time limiter berlaku per attempt atau total operation?
- Apakah bulkhead slot ditahan selama seluruh retry atau per attempt?

Rule praktis:

```text
Retry harus berhenti jika circuit open.
Retry harus masuk deadline total.
Retry attempt harus terlihat di metrics.
Circuit breaker tidak boleh dibuat noise oleh retry internal yang tidak terlihat.
```

---

## 13. Retry dan Bulkhead

Retry mengonsumsi resource.

Jika setiap request menahan thread selama attempt + backoff + attempt ulang, thread pool bisa penuh.

Contoh:

```text
100 request masuk
semua call dependency timeout 1s
retry 2x dengan backoff
thread tertahan 3s+
request baru antri
latency naik
caller timeout
```

Bulkhead membatasi concurrency ke dependency.

Policy:

```text
max concurrent calls to dependency X = 20
queue = small or zero
retry only if bulkhead has capacity
fail fast if saturated
```

Retry tanpa bulkhead bisa membuat satu dependency failure menghabiskan seluruh worker service.

---

## 14. Retry dan Rate Limit

Status `429 Too Many Requests` berarti caller perlu mengurangi laju.

Jika response punya `Retry-After`, client sebaiknya menghormatinya.

Retry terhadap 429 harus:

- tidak immediate;
- mengikuti `Retry-After` jika tersedia;
- menggunakan backoff/jitter;
- masuk global rate limiter;
- tidak dilakukan oleh semua instance secara sinkron;
- berhenti setelah budget habis.

Contoh:

```text
provider rate limit = 300 request/minute
10 pod service masing-masing retry 3x
```

Tanpa distributed rate limiting, retry bisa membuat service terus melanggar limit.

---

## 15. Retry dan Queue Consumer

Pada message processing, retry punya bentuk berbeda.

Ada beberapa jenis retry:

1. immediate retry in-memory;
2. broker redelivery;
3. delayed retry queue;
4. dead letter queue;
5. manual replay;
6. scheduled reconciliation.

### 15.1 Immediate Retry

```text
consume message
process failed
retry immediately 3x
```

Cocok untuk glitch sangat singkat, tetapi berbahaya jika failure disebabkan dependency down.

### 15.2 Delayed Retry Queue

```text
main queue -> failed -> retry queue 1m -> main queue
```

Lebih baik untuk transient dependency failure.

### 15.3 Dead Letter Queue

Setelah max retry habis:

```text
message -> DLQ
alert / dashboard / manual handling / replay tool
```

### 15.4 Poison Message

Poison message adalah message yang selalu gagal karena data buruk atau bug.

Retry poison message tanpa batas akan:

- memblokir partition;
- membuang compute;
- memenuhi log;
- menunda message lain;
- menciptakan alert noise.

Rule:

```text
Transient failure -> retry with delay
Permanent message defect -> DLQ
Bug/invariant breach -> stop or quarantine
```

---

## 16. Retry dan Database

Database failure perlu classification lebih halus.

### 16.1 Retriable DB Failure

Mungkin retriable:

- deadlock;
- serialization failure;
- lock wait timeout;
- transient connection failure;
- failover window;
- read replica temporarily unavailable.

### 16.2 Non-Retriable DB Failure

Biasanya tidak retriable:

- syntax error;
- missing table/column;
- constraint violation;
- invalid data type;
- permission denied;
- data too long;
- not null violation;
- unique violation kecuali sebagai idempotency conflict.

### 16.3 Retry Transaksi Utuh

Untuk database deadlock/serialization failure, retry harus mengulang **transaction unit**, bukan hanya statement terakhir.

Salah:

```text
begin tx
update A
update B failed deadlock
retry update B only
commit
```

Benar:

```text
retry whole command transaction:
  begin tx
  read required state
  validate still valid
  update A
  update B
  commit
```

Karena state yang dibaca sebelumnya mungkin sudah berubah.

---

## 17. Retry dan Authentication Token

401 kadang retriable jika penyebabnya token expired.

Tetapi pattern-nya bukan retry umum.

Benar:

```text
call dependency with token
if 401 and token may be expired:
    refresh token once with lock/singleflight
    retry original request once
else:
    fail
```

Salah:

```text
retry 401 five times
```

Masalah yang harus dicegah:

- token refresh storm;
- semua pod refresh token bersamaan;
- retry dengan token yang sama terus-menerus;
- infinite 401 loop;
- refresh credential salah dianggap transient;
- 403 diperlakukan seperti 401.

Pattern:

```text
401 -> invalidate token cache -> refresh with synchronization -> retry once
403 -> fail closed, no retry
invalid credentials -> fail, alert/operator action
```

---

## 18. Retry Storm

Retry storm terjadi ketika banyak client melakukan retry bersamaan setelah failure.

Penyebab umum:

- no jitter;
- immediate retry;
- too many attempts;
- retry di banyak layer;
- downstream overload;
- autoscaling lambat;
- timeout terlalu pendek;
- all clients share same schedule;
- global dependency outage;
- thundering herd after recovery.

### 18.1 Retry Storm Timeline

```text
T0 dependency latency naik
T1 caller timeout
T2 caller retry immediate
T3 downstream load naik
T4 latency makin naik
T5 lebih banyak timeout
T6 lebih banyak retry
T7 circuit belum ada / threshold terlambat
T8 service ikut gagal
```

Ini positive feedback loop.

Retry yang seharusnya memperbaiki transient failure justru memperbesar overload.

---

## 19. Retrying User-Facing Requests

Untuk synchronous user-facing request, retry harus sangat hati-hati karena user menunggu.

Pertimbangkan:

- total response time;
- UX timeout;
- browser/mobile retry;
- duplicate submit;
- idempotency key dari frontend;
- user pressing button again;
- server-side deduplication;
- partial success message.

Policy umum:

```text
read-only request:
  1-2 retries with short backoff if deadline allows

state-changing command:
  require idempotency key
  prefer async operation ID for long-running work
  no blind retry after unknown outcome
```

---

## 20. Retrying Batch Jobs

Batch job retry punya risiko berbeda:

- duplicate row processing;
- partial batch committed;
- checkpoint corrupt;
- retry from beginning causing duplicates;
- downstream rate limit;
- long retry delaying job window;
- retry hides bad data.

Design:

```text
process item with item-level idempotency
checkpoint after durable success
separate transient retry from poison item quarantine
track attempt count per item
resume from checkpoint
emit summary metrics
```

Jangan hanya retry seluruh batch tanpa deduplication.

---

## 21. Retrying Event Publishing

Event publishing failure punya failure window:

```text
DB commit success
publish event failed
```

Retry langsung di request thread sering tidak cukup.

Gunakan outbox:

```text
same DB transaction:
  update aggregate
  insert outbox event

separate publisher:
  read unpublished outbox
  publish to broker
  mark as published
```

Publisher retry aman karena event punya stable event ID.

Consumer harus idempotent karena broker publish/consume biasanya at-least-once.

---

## 22. Resilience4j Retry di Java/Spring

Resilience4j menyediakan modul Retry yang dapat dikonfigurasi dengan max attempts, wait duration, interval function, exception predicate, result predicate, dan event publisher.

### 22.1 Dependency Conceptual

Di Spring Boot, biasanya digunakan:

```text
resilience4j-spring-boot3
resilience4j-retry
resilience4j-circuitbreaker
resilience4j-timelimiter
resilience4j-bulkhead
```

### 22.2 Example Configuration

```yaml
resilience4j:
  retry:
    instances:
      oneMapClient:
        max-attempts: 3
        wait-duration: 200ms
        retry-exceptions:
          - java.net.SocketTimeoutException
          - java.net.ConnectException
        ignore-exceptions:
          - com.example.domain.ValidationException
          - com.example.domain.BusinessRuleViolationException
```

Catatan:

- `max-attempts` biasanya termasuk attempt pertama.
- Jangan memasukkan semua `Exception` sebagai retriable.
- Jangan retry business exception.
- Jangan retry unknown outcome command tanpa idempotency.

### 22.3 Programmatic Policy

```java
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryConfig;

import java.time.Duration;
import java.util.function.Supplier;

public final class ExternalLookupClient {

    private final RemotePostalClient remotePostalClient;
    private final Retry retry;

    public ExternalLookupClient(RemotePostalClient remotePostalClient) {
        this.remotePostalClient = remotePostalClient;

        RetryConfig config = RetryConfig.custom()
                .maxAttempts(3)
                .waitDuration(Duration.ofMillis(200))
                .retryExceptions(
                        java.net.SocketTimeoutException.class,
                        java.net.ConnectException.class
                )
                .ignoreExceptions(
                        InvalidPostalCodeException.class,
                        PostalCodeNotFoundException.class
                )
                .build();

        this.retry = Retry.of("postalLookup", config);
    }

    public PostalAddress lookup(String postalCode) {
        Supplier<PostalAddress> supplier = Retry.decorateSupplier(
                retry,
                () -> remotePostalClient.lookup(postalCode)
        );

        return supplier.get();
    }
}
```

### 22.4 Predicate Based Retry

Kadang retry ditentukan oleh HTTP status.

```java
RetryConfig config = RetryConfig.<ExternalResponse>custom()
        .maxAttempts(3)
        .waitDuration(Duration.ofMillis(150))
        .retryOnResult(response -> response.statusCode() == 502
                || response.statusCode() == 503
                || response.statusCode() == 504)
        .retryOnException(ex -> ex instanceof ConnectTimeoutException
                || ex instanceof ReadTimeoutException)
        .build();
```

Hati-hati:

- `429` perlu `Retry-After` handling.
- `401` perlu token refresh flow, bukan generic retry.
- `409` tergantung domain.
- `500` belum tentu retriable jika disebabkan request invalid tapi server buruk mengembalikan 500.

---

## 23. Spring Retry vs Resilience4j Retry

Di Java/Spring ecosystem, ada beberapa cara:

1. Spring Retry;
2. Resilience4j Retry;
3. SDK/client built-in retry;
4. custom retry loop;
5. broker retry/dead-letter mechanism.

### 23.1 Spring Retry

Cocok untuk:

- simple method-level retry;
- declarative annotation;
- legacy Spring applications;
- retry dengan recover method.

### 23.2 Resilience4j

Cocok untuk:

- microservice fault tolerance;
- composition dengan circuit breaker, bulkhead, rate limiter, time limiter;
- metrics/event integration;
- explicit named instances;
- production observability.

### 23.3 Custom Retry

Custom retry boleh jika:

- semantics sangat domain-specific;
- butuh idempotency status handling;
- butuh `Retry-After` parsing khusus;
- butuh operation deadline propagation;
- butuh attempt-level audit/evidence.

Namun custom retry harus tetap punya:

- max attempts;
- backoff;
- jitter;
- classification;
- logging rules;
- metrics;
- tests.

---

## 24. Retry Logging Rules

Retry logging yang buruk bisa menghancurkan observability.

### 24.1 Jangan Log Error Besar untuk Setiap Attempt Jika Akhirnya Sukses

Salah:

```text
ERROR attempt 1 failed stacktrace...
ERROR attempt 2 failed stacktrace...
INFO attempt 3 success
```

Ini membuat false alarm.

Lebih baik:

```text
WARN dependency_call_retry attempt=1 reason=timeout next_delay_ms=200
WARN dependency_call_retry attempt=2 reason=timeout next_delay_ms=400
INFO dependency_call_success attempts=3 total_duration_ms=850
```

Jika semua attempt gagal:

```text
ERROR dependency_call_failed attempts=3 total_duration_ms=1200 final_error=timeout correlation_id=...
```

### 24.2 Log Fields

Gunakan structured fields:

```text
operation
attempt
max_attempts
retryable
reason
exception_class
http_status
downstream
delay_ms
deadline_remaining_ms
idempotency_key_present
correlation_id
trace_id
final_outcome
```

### 24.3 Log Once Rule

Boundary akhir yang mengembalikan error ke caller biasanya tempat terbaik untuk log error final.

Retry attempt bisa log WARN/DEBUG dengan ringkas.

Jangan setiap layer log stack trace yang sama.

---

## 25. Retry Metrics

Retry harus terlihat di metrics.

Minimum metrics:

```text
retry_attempts_total{dependency,operation,outcome}
retry_exhausted_total{dependency,operation}
retry_success_after_attempt_total{attempt}
retry_delay_seconds
retry_budget_exhausted_total
non_retriable_failure_total
circuit_open_no_retry_total
```

Dashboard harus bisa menjawab:

1. dependency mana paling sering diretry;
2. apakah retry berhasil atau hanya menunda failure;
3. berapa p95/p99 latency akibat retry;
4. apakah retry meningkat sebelum incident;
5. apakah retry exhausted naik;
6. apakah retry menambah load saat downstream overload;
7. apakah retry terjadi pada operasi yang tidak seharusnya.

---

## 26. Retry Tracing

Dalam distributed tracing, attempt perlu terlihat.

Pattern:

```text
span: call dependency X
  attribute retry.max_attempts=3
  attribute retry.final_attempt=2
  event attempt_1_failed
  event backoff_wait
  event attempt_2_success
```

Atau tiap attempt menjadi child span:

```text
call dependency X
  attempt 1 span -> timeout
  wait event
  attempt 2 span -> success
```

Trace harus menunjukkan apakah latency tinggi disebabkan:

- downstream slow;
- backoff wait;
- repeated attempts;
- connection pool wait;
- circuit breaker half-open wait;
- rate limiter wait.

---

## 27. Retry Policy Template

Gunakan template ini saat mendesain retry.

```text
Operation name:
Dependency:
Operation type: read / command / publish / consume / batch
Side effect: none / local / remote / irreversible
Idempotency guarantee:
Failure classes retried:
Failure classes ignored:
Max attempts:
Per-attempt timeout:
Total deadline:
Backoff:
Jitter:
Retry budget:
Circuit breaker interaction:
Rate limiter interaction:
Bulkhead interaction:
Logging:
Metrics:
Trace attributes:
Fallback behavior:
Final failure mapping:
Test scenarios:
Runbook action:
```

Contoh:

```text
Operation name: resolvePostalCode
Dependency: OneMap API
Operation type: read lookup
Side effect: none
Idempotency guarantee: naturally idempotent by postal code
Failure classes retried: connect timeout, read timeout, 502, 503, 504, selected 429
Failure classes ignored: 400 invalid postal code, 401 after refresh failure, 403
Max attempts: 3
Per-attempt timeout: 800ms
Total deadline: 2500ms
Backoff: 200ms exponential capped 600ms
Jitter: enabled
Retry budget: no more than 10% extra request volume during normal operation
Circuit breaker: no retry when open
Rate limiter: 250/min client-side
Bulkhead: max 20 concurrent calls
Logging: warn per retry, error only after exhausted
Metrics: attempts, exhausted, status, latency
Fallback: cached value if fresh enough; otherwise fail explicit
Final failure mapping: 503 dependency_unavailable
Test scenarios: timeout then success, 429 with Retry-After, 401 refresh once, circuit open
Runbook action: check provider status, rate limit dashboard, token refresh health
```

---

## 28. Example: Bad Retry Implementation

```java
public Address lookup(String postalCode) {
    for (int i = 0; i < 10; i++) {
        try {
            return client.lookup(postalCode);
        } catch (Exception e) {
            log.error("Lookup failed, retrying", e);
        }
    }
    throw new RuntimeException("Lookup failed");
}
```

Masalah:

- retry semua exception;
- tidak ada backoff;
- tidak ada jitter;
- terlalu banyak attempts;
- tidak ada deadline;
- log error setiap attempt;
- kehilangan semantic exception;
- tidak ada metrics;
- tidak ada circuit breaker;
- tidak ada classification;
- `RuntimeException` generic;
- bisa retry invalid input;
- bisa memperburuk overload.

---

## 29. Example: Better Retry Implementation

```java
public final class PostalLookupService {

    private final PostalClient client;
    private final RetryPolicy retryPolicy;
    private final Clock clock;

    public PostalLookupService(
            PostalClient client,
            RetryPolicy retryPolicy,
            Clock clock
    ) {
        this.client = client;
        this.retryPolicy = retryPolicy;
        this.clock = clock;
    }

    public Address lookup(String postalCode, RequestDeadline deadline) {
        validatePostalCode(postalCode);

        RetryContext context = RetryContext.start(
                "postalLookup",
                3,
                deadline,
                clock
        );

        while (true) {
            try {
                context.beforeAttempt();
                Address result = client.lookup(postalCode, context.remainingTimeout());
                context.recordSuccess();
                return result;
            } catch (PostalClientException ex) {
                context.recordFailure(ex);

                if (!retryPolicy.shouldRetry(ex, context)) {
                    throw translateFinalFailure(ex, context);
                }

                Duration delay = retryPolicy.nextDelay(context);

                if (!context.canWait(delay)) {
                    throw translateFinalFailure(ex, context);
                }

                context.sleep(delay);
            }
        }
    }

    private void validatePostalCode(String postalCode) {
        if (postalCode == null || !postalCode.matches("\\d{6}")) {
            throw new InvalidPostalCodeException(postalCode);
        }
    }

    private RuntimeException translateFinalFailure(
            PostalClientException ex,
            RetryContext context
    ) {
        if (ex.isRateLimited()) {
            return new DependencyRateLimitedException("postal-provider", ex, context.attempts());
        }
        if (ex.isTransient()) {
            return new DependencyUnavailableException("postal-provider", ex, context.attempts());
        }
        return new DependencyFailureException("postal-provider", ex, context.attempts());
    }
}
```

Lebih baik karena:

- input invalid tidak diretry;
- retry dikendalikan policy;
- deadline dipakai;
- exception diterjemahkan;
- attempt count dipertahankan;
- final failure semantic;
- bisa ditambah metrics/logging;
- bisa dihubungkan dengan circuit breaker.

---

## 30. Example Retry Policy

```java
public final class RetryPolicy {

    private final Random random = new Random();

    public boolean shouldRetry(PostalClientException ex, RetryContext context) {
        if (context.attempts() >= context.maxAttempts()) {
            return false;
        }

        if (!context.hasRemainingDeadline()) {
            return false;
        }

        if (ex.isInvalidRequest()) {
            return false;
        }

        if (ex.isUnauthorizedAfterRefresh()) {
            return false;
        }

        if (ex.isForbidden()) {
            return false;
        }

        if (ex.isRateLimited()) {
            return true;
        }

        return ex.isConnectTimeout()
                || ex.isReadTimeout()
                || ex.isServiceUnavailable()
                || ex.isGatewayTimeout()
                || ex.isConnectionReset();
    }

    public Duration nextDelay(RetryContext context) {
        long baseMs = 200L;
        long capMs = 1000L;

        long exponential = Math.min(
                capMs,
                baseMs * (1L << Math.max(0, context.attempts() - 1))
        );

        long jittered = random.nextLong(exponential + 1);
        return Duration.ofMillis(jittered);
    }
}
```

Catatan:

- Ini contoh konseptual, bukan library production final.
- Di production, gunakan injected `RandomGenerator`, clock/testability, metric hooks, dan interrupt handling.
- Jangan telan `InterruptedException`; restore interrupt flag.

---

## 31. Handling InterruptedException During Retry Sleep

Retry loop sering melakukan sleep.

Kesalahan umum:

```java
try {
    Thread.sleep(delay.toMillis());
} catch (InterruptedException ignored) {
}
```

Ini buruk karena shutdown/cancellation signal hilang.

Benar:

```java
try {
    Thread.sleep(delay.toMillis());
} catch (InterruptedException ex) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("Retry interrupted", ex);
}
```

Dalam service yang mendukung shutdown graceful, interrupted sleep harus dianggap sebagai cancellation signal.

---

## 32. Retry dan Graceful Shutdown

Saat aplikasi masuk shutdown/draining mode, retry behavior harus berubah.

Jangan memulai retry panjang saat service sedang dimatikan.

Policy:

```text
if application is draining:
    do not start new retry chains
    allow short in-flight attempt if safe
    stop background retry workers gracefully
    persist retryable work to durable queue/outbox
    avoid holding shutdown forever
```

Contoh:

```text
SIGTERM received
readiness false
new request rejected
in-flight request dependency timeout
retry policy checks shutdown state
if remaining shutdown budget insufficient:
    fail fast or persist for async recovery
```

Retry harus tunduk pada shutdown deadline.

---

## 33. Retry Anti-Patterns

### 33.1 Retry Everything

```java
catch (Exception e) { retry(); }
```

Mengaburkan bug, validation error, dan invariant breach.

### 33.2 Infinite Retry

```text
while true retry
```

Bisa membuat resource bocor dan dependency tidak pulih.

### 33.3 Immediate Retry Storm

```text
retry instantly without delay
```

Memperbesar overload.

### 33.4 Retry Without Idempotency

State-changing command diulang tanpa key.

### 33.5 Retry at Every Layer

Client, gateway, service, SDK, DB driver semua retry.

### 33.6 Retry After Deadline

Caller sudah tidak menunggu, tetapi backend masih retry.

### 33.7 Retry Hides Incident

Retry membuat request akhirnya sukses, tetapi latency tinggi dan dependency hampir down. Tanpa metric, incident tidak terlihat.

### 33.8 Fallback Fake Success After Retry Exhausted

```text
retry failed -> return default success
```

Berbahaya untuk domain/regulatory systems.

### 33.9 Retrying Poison Messages Forever

Message buruk terus diproses ulang.

### 33.10 Retrying During Shutdown Without Budget

Shutdown tertunda, pod kena SIGKILL, work hilang.

---

## 34. Production Checklist

Gunakan checklist ini untuk review retry policy.

### 34.1 Classification

- [ ] Failure retriable dan non-retriable didefinisikan eksplisit.
- [ ] 4xx tidak diretry kecuali case spesifik.
- [ ] 401 punya refresh-once flow.
- [ ] 403 tidak diretry.
- [ ] 429 mengikuti rate limit semantics.
- [ ] Timeout diperlakukan sebagai unknown outcome.

### 34.2 Safety

- [ ] Operation idempotent atau punya idempotency key.
- [ ] Duplicate side effect dicegah.
- [ ] Retry tidak dilakukan untuk irreversible command tanpa protection.
- [ ] Retry transaksi mengulang transaction unit secara utuh.
- [ ] Queue retry punya DLQ/quarantine.

### 34.3 Budget

- [ ] Max attempts terbatas.
- [ ] Total retry duration masuk request deadline.
- [ ] Per-attempt timeout ada.
- [ ] Backoff ada.
- [ ] Jitter ada untuk distributed clients.
- [ ] Retry budget didefinisikan.

### 34.4 Capacity Protection

- [ ] Circuit breaker digunakan untuk dependency rawan overload.
- [ ] Bulkhead membatasi concurrency.
- [ ] Rate limiter diterapkan untuk provider limited API.
- [ ] Retry berhenti saat circuit open.
- [ ] Retry tidak memperbesar overload tanpa batas.

### 34.5 Layering

- [ ] Retry ownership jelas.
- [ ] Retry default SDK/client diketahui.
- [ ] Tidak ada retry multiplication antar layer.
- [ ] Gateway retry dibatasi untuk safe/idempotent operations.

### 34.6 Observability

- [ ] Attempt count dimetric-kan.
- [ ] Retry exhausted dimetric-kan.
- [ ] Retry success after N attempts dimetric-kan.
- [ ] Logs tidak spam stack trace per attempt.
- [ ] Trace menunjukkan attempt/backoff.
- [ ] Dashboard dapat membedakan first-attempt success vs retry success.

### 34.7 Shutdown

- [ ] Retry tunduk pada shutdown state.
- [ ] Retry tidak melewati shutdown grace period.
- [ ] Background retry durable jika harus dilanjutkan setelah restart.
- [ ] Interrupted sleep restore interrupt flag.

---

## 35. Testing Retry Behavior

Retry harus dites, bukan diasumsikan.

### 35.1 Unit Test

Test classification:

```text
400 -> no retry
403 -> no retry
429 -> retry with delay
503 -> retry
timeout -> retry if idempotent
business exception -> no retry
```

### 35.2 Integration Test

Simulasikan dependency:

```text
fail once then success
fail twice then success
always fail
slow response then timeout
429 with Retry-After
401 then token refresh success
401 then refresh fail
```

### 35.3 Deadline Test

```text
remaining deadline too small -> no retry
backoff would exceed deadline -> no retry
attempt timeout consumes budget
```

### 35.4 Idempotency Test

```text
first request commits but response timeout
retry same idempotency key
server returns same result
no duplicate side effect
```

### 35.5 Load Test

Test saat dependency error rate naik:

- apakah retry storm terjadi;
- apakah circuit breaker open;
- apakah bulkhead melindungi service;
- apakah latency naik terkendali;
- apakah retry attempts masuk budget.

---

## 36. Review Questions

1. Apa bedanya retry pada transient failure dan retry pada unknown outcome?
2. Mengapa timeout tidak selalu berarti operation gagal di downstream?
3. Mengapa retry tanpa idempotency berbahaya untuk command?
4. Apa itu retry amplification?
5. Mengapa retry di banyak layer bisa menyebabkan cascading failure?
6. Apa perbedaan backoff dan jitter?
7. Mengapa `429` tidak boleh diretry immediate?
8. Mengapa `401` sebaiknya ditangani dengan refresh-once flow?
9. Bagaimana cara retry database deadlock dengan benar?
10. Mengapa poison message tidak boleh diretry tanpa batas?
11. Apa metric minimum untuk retry observability?
12. Bagaimana retry harus berubah saat aplikasi sedang graceful shutdown?
13. Mengapa retry yang akhirnya sukses tetap bisa menjadi signal reliability problem?
14. Kapan retry harus diganti dengan reconciliation?
15. Kapan retry harus ditolak walaupun failure tampak transient?

---

## 37. Ringkasan Mental Model

Retry adalah alat recovery yang kuat, tetapi hanya aman jika dikendalikan.

Prinsip utama:

```text
Retry only when the failure is likely transient,
the operation is safe to repeat,
the caller still has time,
the dependency has capacity to recover,
and the retry does not hide or amplify systemic failure.
```

Checklist mental:

```text
Is it retriable?
Is it idempotent?
Is the outcome known?
Is there remaining deadline?
Is there budget?
Is there backoff and jitter?
Is downstream overloaded?
Is circuit open?
Is retry happening elsewhere?
Is it observable?
```

Retry bukan pengganti desain reliability. Retry adalah bagian kecil dari desain yang harus terhubung dengan:

- timeout;
- deadline;
- idempotency;
- circuit breaker;
- bulkhead;
- rate limiter;
- observability;
- graceful shutdown;
- reconciliation;
- incident response.

---

## 38. Hubungan ke Part Berikutnya

Part ini membahas retry sebagai mekanisme re-execution.

Part berikutnya akan membahas:

```text
Part 018 — Circuit Breaker, Bulkhead, Rate Limiter, and Time Limiter
```

Di sana kita akan melihat bagaimana sistem mencegah retry dan request biasa menghantam dependency yang sedang sakit, dengan mekanisme isolasi dan load-shedding yang lebih eksplisit.

---

## 39. Status Seri

```text
Part 017 / 030 completed
Seri belum selesai.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-reliability-part-016.md](./learn-java-reliability-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-018.md](./learn-java-reliability-part-018.md)

</div>
# learn-java-reliability-part-018.md

# Part 018 — Circuit Breaker, Bulkhead, Rate Limiter, and Time Limiter

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Status: Part 018 dari 030  
> Fokus: mekanisme kontrol untuk mencegah dependency failure, overload, latency spike, dan resource starvation menyebar menjadi cascading failure.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- failure mental model;
- exception semantics;
- error contract;
- graceful shutdown;
- in-flight request draining;
- worker/message consumer shutdown;
- transaction failure window;
- idempotency;
- timeout/deadline/cancellation;
- retry engineering.

Part ini adalah lanjutan natural dari retry dan timeout.

Retry menjawab:

> “Jika operasi gagal sementara, bolehkah kita mencoba lagi?”

Timeout menjawab:

> “Berapa lama kita bersedia menunggu sebelum menganggap operasi gagal?”

Part ini menjawab:

> “Bagaimana kita mencegah dependency yang lambat/rusak/overload menghabiskan resource service kita dan menjatuhkan sistem lain?”

Di production, banyak outage bukan terjadi karena satu dependency gagal. Outage sering terjadi karena **sistem lain terus memanggil dependency yang sudah gagal**, melakukan retry, menunggu terlalu lama, memenuhi thread pool, memenuhi connection pool, lalu menular ke service lain. Inilah pola klasik **cascading failure**.

Circuit breaker, bulkhead, rate limiter, dan time limiter bukan “magic resilience annotation”. Mereka adalah **control surface** untuk membatasi failure propagation.

---

## 1. Core Problem

Dalam microservices/distributed systems, sebuah service jarang berdiri sendiri. Ia biasanya bergantung pada:

- database;
- cache;
- object storage;
- identity provider;
- payment provider;
- search engine;
- document service;
- email/SMS gateway;
- message broker;
- downstream internal service;
- third-party API;
- regulatory/agency integration;
- network/DNS/TLS infrastructure.

Setiap dependency bisa gagal dengan cara berbeda:

| Failure Mode | Contoh | Risiko Utama |
|---|---|---|
| Hard failure | connection refused, host down | request gagal cepat |
| Slow failure | dependency masih merespons tapi sangat lambat | thread exhaustion |
| Partial failure | hanya subset endpoint/data gagal | inconsistent behavior |
| Intermittent failure | kadang berhasil kadang gagal | retry storm |
| Overload failure | 429/503, queue penuh | cascading overload |
| Capacity collapse | pool penuh, thread penuh, CPU tinggi | service ikut mati |
| Gray failure | health check terlihat sehat tapi real traffic gagal | sulit dideteksi |
| Dependency regression | schema/error berubah | mapping failure |

Tanpa guardrail, caller biasanya melakukan hal buruk berikut:

1. tetap mengirim request ke dependency rusak;
2. menunggu terlalu lama;
3. retry tanpa budget;
4. membuka terlalu banyak concurrent calls;
5. tidak membedakan failure type;
6. fallback palsu yang membuat business state salah;
7. logging terlalu banyak saat failure;
8. alert storm;
9. semua thread/request ikut tertahan;
10. shutdown menjadi lambat karena banyak in-flight call menggantung.

Reliability control harus menjawab empat pertanyaan:

1. **Haruskah call ini dilanjutkan?**  
   Dijawab oleh circuit breaker.

2. **Berapa banyak call yang boleh berjalan bersamaan?**  
   Dijawab oleh bulkhead.

3. **Berapa cepat call boleh masuk?**  
   Dijawab oleh rate limiter.

4. **Berapa lama call boleh hidup?**  
   Dijawab oleh time limiter / timeout / deadline.

---

## 2. Mental Model: Empat Katup Kendali Reliability

Bayangkan service kamu sebagai sistem pipa. Request adalah air. Dependency adalah pipa keluar. Kalau dependency tersumbat, air bisa balik dan merusak pompa utama.

Empat pattern di part ini adalah empat jenis katup:

```text
                    ┌────────────────────┐
Incoming Request ──▶│ Your Java Service   │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Dependency Call     │
                    └────────────────────┘
```

Dengan control:

```text
Incoming Request
      │
      ▼
[Rate Limiter]  -> batasi kecepatan masuk / call rate
      │
      ▼
[Bulkhead]      -> batasi concurrent resource usage
      │
      ▼
[Time Limiter]  -> batasi durasi setiap call
      │
      ▼
[Circuit Breaker] -> stop call sementara jika dependency terbukti unhealthy
      │
      ▼
Dependency
```

Namun urutan aktual tidak selalu sama. Urutan harus mengikuti tujuan:

- ingin menghindari overload lokal? bulkhead/rate limiter lebih awal;
- ingin fail fast saat dependency open? circuit breaker lebih awal;
- ingin mencegah hanging call? timeout/time limiter wajib membungkus actual call;
- ingin retry? retry harus diposisikan hati-hati agar tidak melanggar circuit/bulkhead budget.

Mental model penting:

> Pattern ini bukan membuat dependency menjadi sehat. Pattern ini menjaga agar dependency failure tidak menghabiskan caller.

---

## 3. Pattern Overview

| Pattern | Pertanyaan | Melindungi Dari | Failure Signal |
|---|---|---|---|
| Circuit Breaker | “Apakah dependency sedang layak dipanggil?” | repeated failure, slow dependency, cascading failure | failure rate, slow call rate |
| Bulkhead | “Berapa banyak resource boleh dipakai dependency ini?” | thread/connection starvation | concurrent calls penuh |
| Rate Limiter | “Berapa banyak call per waktu?” | traffic spike, provider quota, burst overload | permission tidak tersedia |
| Time Limiter | “Berapa lama operasi boleh berjalan?” | slow/hanging call | timeout |

Keempatnya sering dipakai bersama, tapi tidak selalu semua diperlukan.

Rule sederhana:

- **External API**: timeout + retry terbatas + circuit breaker + rate limiter + bulkhead.
- **Database**: timeout + pool limit + retry sangat selektif + no generic circuit breaker kecuali jelas.
- **Cache**: timeout pendek + fallback/degrade + circuit breaker.
- **Critical command**: idempotency + timeout + controlled retry; fallback palsu dilarang.
- **Read-only enrichment**: timeout pendek + fallback/stale cache boleh.
- **Message consumer**: bulkhead/concurrency limit + retry/DLQ + circuit breaker untuk downstream.

---

## 4. Circuit Breaker Deep Dive

### 4.1 Apa Itu Circuit Breaker?

Circuit breaker adalah state machine yang mengamati hasil call ke dependency. Jika dependency gagal/terlalu lambat melewati threshold, breaker berpindah ke state **OPEN** dan menolak call baru sementara waktu.

Tujuannya:

- menghindari membanjiri dependency yang sudah sakit;
- membuat caller fail fast;
- membebaskan thread/connection;
- memberi dependency waktu recovery;
- mengurangi cascading failure;
- menghasilkan signal operasional bahwa dependency sedang tidak sehat.

Circuit breaker bukan retry. Ia tidak memperbaiki call. Ia memutus call sementara.

---

### 4.2 State Machine Circuit Breaker

State umum:

```text
                 failure/slow rate exceeds threshold
        ┌──────────────────────────────────────────────┐
        │                                              ▼
   ┌──────────┐                               ┌────────────┐
   │ CLOSED   │                               │ OPEN       │
   │ calls    │                               │ reject all │
   │ allowed  │                               │ calls      │
   └────┬─────┘                               └─────┬──────┘
        ▲                                           │
        │ trial calls healthy                       │ wait duration elapsed
        │                                           ▼
   ┌────┴────────┐                         ┌────────────────┐
   │ HALF_OPEN   │◀────────────────────────│ allow limited  │
   │ probe calls │                         │ trial calls    │
   └─────────────┘                         └────────────────┘
```

#### CLOSED

Normal mode. Semua call allowed. Breaker merekam:

- success;
- failure;
- slow call;
- ignored exception;
- duration.

Jika failure rate atau slow call rate melewati threshold setelah minimum call tercapai, breaker pindah ke OPEN.

#### OPEN

Fail-fast mode. Call baru langsung ditolak, biasanya dengan exception seperti `CallNotPermittedException` di Resilience4j.

Dependency tidak dipanggil.

#### HALF_OPEN

Probe mode. Setelah wait duration, breaker mengizinkan sejumlah kecil trial calls. Jika cukup sehat, kembali CLOSED. Jika masih gagal/lambat, kembali OPEN.

---

### 4.3 Failure Rate vs Slow Call Rate

Circuit breaker modern tidak hanya membuka karena error. Ia juga bisa membuka karena latency.

Failure rate menjawab:

> “Berapa persen call gagal?”

Slow call rate menjawab:

> “Berapa persen call terlalu lambat?”

Slow call rate sangat penting karena banyak dependency failure dimulai sebagai latency spike, bukan error eksplisit.

Contoh:

```text
Dependency masih return 200 OK,
tapi P95 naik dari 200ms ke 8s.
```

Tanpa slow-call breaker:

- semua request menunggu;
- thread pool penuh;
- queue tumbuh;
- memory naik;
- upstream timeout;
- retry storm;
- service ikut dianggap down.

Dengan slow-call breaker:

- dependency dianggap unhealthy sebelum error rate tinggi;
- caller fail fast;
- resource terlindungi.

Resilience4j CircuitBreaker menggunakan sliding window dan threshold seperti `failureRateThreshold`, `slowCallRateThreshold`, `slowCallDurationThreshold`, dan `minimumNumberOfCalls`. Failure/slow rate baru bermakna setelah minimum number of calls tercapai.

---

### 4.4 Sliding Window: Count-Based vs Time-Based

Circuit breaker tidak melihat seluruh history. Ia melihat jendela observasi.

#### Count-based sliding window

Melihat N call terakhir.

Contoh:

```yaml
slidingWindowType: COUNT_BASED
slidingWindowSize: 100
minimumNumberOfCalls: 50
```

Cocok untuk:

- traffic stabil;
- service dengan call volume cukup tinggi;
- ingin reaksi berdasarkan jumlah sample.

Risiko:

- pada traffic rendah, sample lambat terkumpul;
- pada traffic sangat tinggi, window terlalu cepat berganti;
- spike singkat bisa membuka breaker jika window kecil.

#### Time-based sliding window

Melihat call selama N detik terakhir.

Contoh:

```yaml
slidingWindowType: TIME_BASED
slidingWindowSize: 60
minimumNumberOfCalls: 100
```

Cocok untuk:

- production traffic tinggi;
- ingin threshold berbasis periode waktu;
- observability/SLO selaras dengan time window.

Risiko:

- traffic rendah bisa tidak mencapai minimum calls;
- threshold perlu disesuaikan dengan pola traffic.

---

### 4.5 Circuit Breaker Bukan Health Check

Health check biasanya menjawab:

> “Apakah dependency secara umum hidup?”

Circuit breaker menjawab:

> “Apakah call aktual dari service ini ke dependency ini sehat berdasarkan real traffic?”

Keduanya berbeda.

Dependency bisa lolos health check tapi gagal untuk endpoint tertentu, tenant tertentu, payload tertentu, region tertentu, atau auth token tertentu.

Circuit breaker harus ditempatkan pada **call path spesifik**:

```text
Bad:
  one global breaker for all external integrations

Better:
  breaker per dependency

Best:
  breaker per dependency + operation class when failure modes differ
```

Contoh:

```text
onemap-geocode-search breaker
onemap-token-refresh breaker
payment-create-charge breaker
payment-query-status breaker
document-render-pdf breaker
email-send breaker
```

Jangan mencampur operasi yang failure semantics-nya berbeda.

---

### 4.6 Exception Classification untuk Circuit Breaker

Tidak semua exception harus dihitung sebagai failure.

| Exception | Count as Failure? | Reason |
|---|---:|---|
| timeout | yes | dependency slow/unavailable |
| connection refused | yes | dependency unavailable |
| HTTP 500/502/503/504 | yes | server-side/transient failure |
| HTTP 429 | usually yes or special handling | provider overloaded/quota |
| HTTP 401 due expired token | maybe no if refresh succeeds | auth lifecycle issue |
| HTTP 403 | usually no retry, may not open breaker | authorization/config issue |
| HTTP 400 validation | no | caller bug/client input |
| domain conflict | no | expected business result |
| not found | no, unless dependency contract says impossible | domain/data state |
| deserialization schema drift | yes or operator-correctable | integration contract broken |

Resilience4j menyediakan konfigurasi `recordExceptions`, `ignoreExceptions`, dan predicate untuk menentukan failure classification.

Prinsip:

> Circuit breaker harus merekam dependency health, bukan business rejection biasa.

Jika 400 validation dihitung sebagai dependency failure, breaker bisa terbuka padahal dependency sehat dan caller yang salah.

---

### 4.7 Fallback pada Circuit Breaker

Fallback bukan bagian wajib circuit breaker. Fallback adalah keputusan domain/API.

Fallback boleh jika:

- response non-critical;
- data bisa stale;
- user experience lebih baik dengan partial result;
- downstream hanya enrichment;
- fallback jujur sebagai degraded result.

Fallback berbahaya jika:

- membuat transaksi terlihat sukses padahal tidak;
- mengganti authorization decision;
- membuat audit/compliance hilang;
- menyembunyikan payment failure;
- menulis data default palsu;
- menghilangkan signal incident.

Contoh buruk:

```java
// BAD: dependency failed, but system returns approved
return new EligibilityResult(true, "APPROVED_BY_FALLBACK");
```

Contoh lebih aman:

```java
return new EligibilityResult(
    EligibilityStatus.UNAVAILABLE,
    "Eligibility provider temporarily unavailable",
    true // retryable
);
```

---

### 4.8 Circuit Breaker Anti-Patterns

#### Anti-pattern 1 — Circuit breaker everywhere

Memasang breaker di semua method membuat sistem sulit dipahami dan di-tune.

Gunakan pada boundary yang benar:

- external API;
- remote service;
- cache/search dependency;
- expensive optional dependency;
- operation dengan high latency risk.

Tidak semua local method perlu breaker.

#### Anti-pattern 2 — One breaker for everything

Satu breaker global untuk semua dependency menghancurkan isolation.

Jika email service down, jangan sampai payment API ikut short-circuited.

#### Anti-pattern 3 — Fallback returns fake success

Ini anti-pattern paling berbahaya.

Fallback harus merepresentasikan degraded/unavailable state, bukan memalsukan success.

#### Anti-pattern 4 — Threshold terlalu sensitif

Window kecil + threshold rendah bisa membuat breaker sering open/close tanpa alasan kuat.

#### Anti-pattern 5 — Threshold terlalu longgar

Breaker baru open setelah service sudah collapse.

#### Anti-pattern 6 — Ignore slow calls

Banyak incident dimulai dari latency, bukan error.

#### Anti-pattern 7 — No metrics/alerts

Circuit breaker yang open tanpa alert adalah silent degradation.

#### Anti-pattern 8 — Circuit breaker menggantikan timeout

Breaker butuh timeout untuk mengklasifikasikan slow/hanging call. Tanpa timeout, call bisa menggantung sebelum breaker punya data berguna.

---

## 5. Bulkhead Deep Dive

### 5.1 Apa Itu Bulkhead?

Bulkhead adalah pattern isolasi resource.

Nama ini berasal dari kapal: sekat antar-kompartemen mencegah satu bagian bocor menenggelamkan seluruh kapal.

Dalam software:

> Bulkhead memastikan satu dependency/operation tidak menghabiskan seluruh thread, connection, memory, atau executor service.

Tanpa bulkhead:

```text
All requests share same thread pool

Dependency A slow
  -> threads waiting on A
  -> thread pool full
  -> unrelated Dependency B also fails
  -> health check slow
  -> service removed
  -> cascading failure
```

Dengan bulkhead:

```text
Dependency A has max 20 concurrent calls
Dependency B has max 30 concurrent calls
Critical local path has reserved capacity

A slow -> only A's compartment full
B and critical paths still work
```

---

### 5.2 Semaphore Bulkhead vs Thread Pool Bulkhead

#### Semaphore Bulkhead

Membatasi jumlah concurrent calls, tetapi call tetap berjalan di thread caller.

```text
request thread enters
  acquire permit
    call dependency
  release permit
```

Cocok untuk:

- synchronous calls;
- virtual threads / lightweight blocking model;
- simple concurrency control;
- low overhead;
- ingin membatasi concurrent dependency access.

Risiko:

- thread caller tetap blocked;
- tidak memberi queue/executor isolation;
- perlu timeout agar permit tidak tertahan lama.

#### Thread Pool Bulkhead

Call dijalankan di executor terpisah.

```text
request thread submits task
  dependency executor runs call
  queue may fill
  result returned/future completed
```

Cocok untuk:

- blocking dependency yang ingin diisolasi dari request executor;
- legacy blocking IO;
- operation mahal;
- ingin separate queue/rejection policy.

Risiko:

- queue bisa menambah latency;
- context propagation lebih kompleks;
- cancellation lebih sulit;
- thread pool sizing harus hati-hati;
- nested thread pools bisa boros.

---

### 5.3 Bulkhead Sizing

Bulkhead size bukan angka asal.

Pertimbangkan:

- dependency capacity;
- service instance count;
- expected concurrency;
- timeout;
- average latency;
- P95/P99 latency;
- connection pool size;
- CPU/memory;
- priority traffic;
- provider quota;
- retry behavior;
- shutdown budget.

Approximation mental model:

```text
concurrency ≈ arrival_rate_per_second × average_latency_seconds
```

Contoh:

```text
Expected 50 calls/second
Average dependency latency 200ms = 0.2s
Concurrency needed ≈ 50 × 0.2 = 10
```

Namun gunakan headroom:

```text
bulkhead size 15-25
```

Jika P95 latency naik ke 2s:

```text
50 × 2 = 100 concurrent calls
```

Kalau bulkhead size tetap 20, 30 call/s akan ditolak/ditunda. Itu mungkin benar: service melindungi diri dari latency collapse.

---

### 5.4 Queue dalam Bulkhead

Queue tampak membantu, tetapi sering menyembunyikan overload.

Queue besar:

- mengurangi immediate rejection;
- meningkatkan latency;
- membuat request menunggu sampai client timeout;
- menyebabkan stale work;
- memperburuk shutdown;
- membuat overload tidak terlihat sampai terlambat.

Rule:

> Lebih baik reject cepat secara eksplisit daripada menumpuk work yang kemungkinan sudah tidak berguna.

Gunakan queue kecil atau tanpa queue untuk path latency-sensitive.

---

### 5.5 Bulkhead untuk Critical vs Non-Critical Path

Bulkhead bukan hanya per dependency. Bulkhead juga bisa per traffic class.

Contoh:

```text
critical-command-executor      max 30
read-enrichment-executor       max 20
report-generation-executor     max 5
notification-executor          max 10
external-geocode-bulkhead      max 15
```

Tujuannya:

- report berat tidak mengganggu login;
- optional enrichment tidak mengganggu command utama;
- slow notification tidak menghabiskan worker utama;
- admin batch tidak mengganggu public API.

---

### 5.6 Bulkhead Anti-Patterns

#### Anti-pattern 1 — Semua dependency share executor yang sama

Ini menghilangkan isolasi.

#### Anti-pattern 2 — Queue terlalu besar

Queue besar sering berarti “latency bomb”.

#### Anti-pattern 3 — Bulkhead tanpa timeout

Permit/thread bisa tertahan terlalu lama.

#### Anti-pattern 4 — Bulkhead size lebih besar dari downstream capacity

Kalau provider hanya sanggup 100 concurrent calls total, dan kamu punya 10 pod masing-masing bulkhead 50, total potential concurrency 500. Itu overload by design.

#### Anti-pattern 5 — Tidak ada rejection semantics

Saat bulkhead penuh, error response harus jelas:

- `503 Service Unavailable` untuk temporary overload;
- `429 Too Many Requests` jika rate/concurrency policy ke client;
- internal error code seperti `DEPENDENCY_CONCURRENCY_LIMIT_REACHED`.

---

## 6. Rate Limiter Deep Dive

### 6.1 Apa Itu Rate Limiter?

Rate limiter membatasi jumlah operasi dalam periode waktu tertentu.

Pertanyaan utamanya:

> “Berapa banyak call yang boleh dilakukan per waktu?”

Rate limiter melindungi:

- service sendiri dari traffic spike;
- downstream dependency dari overload;
- third-party quota;
- database dari expensive query spike;
- admin/job endpoint dari accidental flood;
- retry storm.

Resilience4j RateLimiter menggunakan konsep permission per refresh period: sejumlah permission tersedia pada setiap cycle, dan caller harus mendapat permission sebelum call berjalan.

---

### 6.2 Rate Limiter vs Bulkhead

Keduanya sering tertukar.

| Aspek | Bulkhead | Rate Limiter |
|---|---|---|
| Mengatur | concurrent calls | calls per time window |
| Fokus | resource isolation | throughput/quota |
| Contoh | max 20 calls in-flight | max 300 calls/minute |
| Failure | permit/concurrency penuh | rate permission habis |
| Cocok untuk | slow dependency, thread pool protection | provider quota, burst control |

Contoh perbedaan:

```text
Rate limit: 300/minute
Bulkhead: 20 concurrent
Timeout: 2s
```

Jika traffic 300 call dalam 1 detik:

- rate limiter mungkin memperbolehkan burst jika token tersedia;
- bulkhead akan membatasi concurrent call;
- sisanya ditolak/menunggu tergantung konfigurasi.

Jika traffic stabil 10 call/s tetapi dependency latency naik ke 10s:

- rate masih normal;
- bulkhead penuh;
- bulkhead melindungi service.

---

### 6.3 Rate Limiter Placement

Rate limiter bisa ditempatkan di beberapa level:

| Level | Tujuan |
|---|---|
| Edge/API gateway | melindungi platform dari client flood |
| Service endpoint | policy per endpoint/user/tenant |
| Downstream client | melindungi dependency/provider quota |
| Worker consumer | mengontrol processing throughput |
| Retry layer | membatasi retry storm |

Untuk external provider, limiter biasanya ditempatkan dekat client adapter:

```text
Domain Service
  -> ExternalProviderClient
       -> rate limiter
       -> bulkhead
       -> timeout
       -> circuit breaker
       -> HTTP call
```

Jangan hanya mengandalkan gateway rate limit untuk downstream quota. Gateway membatasi inbound traffic, bukan necessarily outbound call amplification.

Satu inbound request bisa menghasilkan banyak outbound call.

---

### 6.4 Rate Limiting Scope

Scope penting:

```text
Bad:
  global limiter for all tenants and operations

Better:
  per dependency + operation

Best when needed:
  per dependency + operation + tenant/user/client class
```

Contoh:

```text
onemap-geocode: 250/min total
onemap-token-refresh: 5/min
email-send: 100/min
document-render: 20/min
high-priority-case-query: separate quota
```

Jika provider quota 300/min, jangan set 300/min di setiap pod tanpa koordinasi.

Jika ada 5 pod:

```text
300/min provider quota total
naive per-pod limiter 300/min -> possible 1500/min
safer per-pod limiter 50/min with headroom -> 250/min total
```

Untuk quota global yang ketat, perlu distributed rate limiter atau centralized token bucket. Namun distributed limiter membawa latency dan availability trade-off.

---

### 6.5 Rate Limiter Response Semantics

Jika request ditolak oleh rate limiter, response harus jelas.

Untuk client-facing endpoint:

- `429 Too Many Requests` jika client melebihi policy;
- sertakan `Retry-After` jika memungkinkan;
- error code stabil;
- jangan treat sebagai server bug.

Untuk internal dependency limiter:

- bisa map ke `503 Service Unavailable` jika service tidak bisa memenuhi request karena downstream quota;
- atau domain-specific unavailable/degraded response;
- log sebagai controlled rejection, bukan stacktrace error berisik.

---

### 6.6 Rate Limiter Anti-Patterns

#### Anti-pattern 1 — Per-pod limiter untuk global quota tanpa pembagian

Ini menyebabkan quota provider tetap dilanggar saat pod scale out.

#### Anti-pattern 2 — Rate limiter setelah expensive work

Limiter harus ditempatkan sebelum operasi mahal.

#### Anti-pattern 3 — Queue panjang saat permit habis

Menunggu permit terlalu lama bisa membuat client timeout dan work menjadi stale.

#### Anti-pattern 4 — Semua traffic satu bucket

Low-priority traffic bisa menghabiskan quota critical traffic.

#### Anti-pattern 5 — Retry tidak dihitung dalam rate budget

Retry juga traffic. Jika tidak dibatasi, retry bisa melanggar quota walaupun request asli normal.

---

## 7. Time Limiter Deep Dive

### 7.1 Apa Itu Time Limiter?

Time limiter membatasi durasi operasi asynchronous/future-based. Dalam praktik lebih luas, ia bagian dari timeout/deadline strategy.

Pertanyaan:

> “Berapa lama operasi ini boleh berjalan sebelum caller berhenti menunggu?”

Time limiter melindungi:

- request thread;
- executor;
- bulkhead permit;
- user latency;
- shutdown budget;
- retry budget;
- downstream overload.

Resilience4j TimeLimiter umumnya bekerja dengan `CompletionStage`, `Future`, atau asynchronous supplier. Ia bisa timeout dan, tergantung konfigurasi, mencoba cancel running future.

---

### 7.2 Timeout Tidak Sama dengan Cancellation

Ini penting.

Timeout berarti:

> Caller berhenti menunggu.

Cancellation berarti:

> Work yang sedang berjalan dihentikan atau diminta berhenti.

Banyak library tidak bisa benar-benar membatalkan underlying IO jika IO blocking tidak interruptible.

Contoh:

```text
Caller timeout at 2s
Underlying HTTP call may still run until socket timeout 10s
Thread may remain occupied
Dependency may still receive/process request
```

Maka time limiter harus diselaraskan dengan:

- HTTP client connect/read/write timeout;
- database query timeout;
- transaction timeout;
- executor timeout;
- servlet request timeout;
- upstream gateway timeout;
- shutdown timeout.

---

### 7.3 Deadline Budget

Jangan konfigurasi timeout secara terpisah tanpa budget.

Contoh buruk:

```text
API gateway timeout: 30s
service A timeout to B: 30s
service B timeout to C: 30s
DB query timeout: 30s
```

Ini membuat request bisa tetap bekerja setelah caller sudah menyerah.

Contoh lebih baik:

```text
Client SLA: 3s
Gateway budget: 3s
Service A total budget: 2.5s
Validation/local processing: 200ms
Call B: 1.5s
Fallback/degrade: 300ms
Response serialization: 200ms
Safety margin: 300ms
```

Time limiter harus menjadi bagian dari end-to-end deadline.

---

### 7.4 Time Limiter dan Circuit Breaker

Circuit breaker butuh signal slow/failure. Time limiter memberi signal tersebut.

Tanpa time limiter:

```text
Dependency hangs
call never returns
breaker does not get result quickly
threads fill
system collapses
```

Dengan time limiter:

```text
call exceeds 2s
TimeoutException recorded
breaker sees failure/slow call
bulkhead permit released sooner
caller can degrade/fail fast
```

Namun jika underlying work tidak cancel, thread masih bisa tertahan. Karena itu timeout harus ada di layer IO juga.

---

### 7.5 Time Limiter Anti-Patterns

#### Anti-pattern 1 — Time limiter lebih lama dari upstream timeout

Jika client/gateway timeout 5s, dependency call timeout 10s tidak berguna.

#### Anti-pattern 2 — Time limiter tanpa IO timeout

Caller timeout, tapi socket tetap menggantung.

#### Anti-pattern 3 — Timeout terlalu agresif tanpa data latency

Timeout terlalu rendah bisa menciptakan false failure dan retry storm.

#### Anti-pattern 4 — Semua dependency pakai timeout sama

Auth token refresh, search query, payment command, dan document generation punya latency profile berbeda.

#### Anti-pattern 5 — Timeout tanpa observability

Timeout rate harus dimonitor. Timeout bukan noise; ia signal capacity/dependency issue.

---

## 8. Composition: Menggabungkan Pattern dengan Benar

### 8.1 Kenapa Composition Sulit?

Pattern ini saling mempengaruhi.

Contoh:

- Retry di luar circuit breaker bisa membuat setiap attempt dihitung dan membuka breaker lebih cepat.
- Retry di dalam circuit breaker bisa membuat satu user request terlihat sebagai satu failure, tapi dependency mendapat banyak call.
- Bulkhead di luar retry membatasi seluruh operation termasuk retry.
- Bulkhead di dalam retry bisa membuat setiap retry berebut permit baru.
- Rate limiter di luar retry membatasi user request, tetapi retry bisa tetap memperbanyak outbound call.
- Rate limiter di dalam retry membatasi outbound attempts.

Tidak ada satu urutan universal.

---

### 8.2 Common Safe Composition untuk External API

Untuk external dependency yang mahal/limited quota:

```text
Caller
  -> validate idempotency/retryability
  -> rate limiter for outbound attempts
  -> bulkhead for concurrent outbound calls
  -> time limiter / client timeout
  -> circuit breaker observation
  -> retry carefully, usually around transient failures only
  -> fallback/degrade if domain-safe
```

Namun di Resilience4j decorator, urutan aktual bergantung cara kita compose.

Contoh konseptual:

```java
Supplier<Response> decorated = Decorators.ofSupplier(() -> externalClient.call(request))
    .withCircuitBreaker(circuitBreaker)
    .withBulkhead(bulkhead)
    .withRateLimiter(rateLimiter)
    .withRetry(retry)
    .decorate();
```

Jangan copy urutan ini sebagai dogma. Tentukan dulu semantics:

- Apakah rate limiter membatasi original call atau semua retry attempts?
- Apakah circuit breaker menghitung setiap retry attempt atau final operation?
- Apakah bulkhead permit mencakup semua retry atau per attempt?
- Apakah fallback dipanggil setelah retry exhausted atau setelah breaker open?

---

### 8.3 Composition Decision Matrix

| Tujuan | Pattern Placement yang Umum |
|---|---|
| Lindungi dependency quota | rate limiter dekat HTTP client, mencakup retry attempts |
| Lindungi thread lokal | bulkhead sebelum blocking call |
| Deteksi dependency rusak | circuit breaker mengobservasi actual attempt outcome |
| Fail fast saat dependency unhealthy | circuit breaker sebelum expensive setup |
| Batasi latency user | time limiter/deadline mengelilingi operation total |
| Hindari retry storm | retry budget + rate limiter + circuit breaker |
| Preserve correctness | fallback hanya setelah domain-safe classification |

---

### 8.4 Example: Read Enrichment Dependency

Use case:

- service menampilkan case detail;
- optional enrichment dari document-preview service;
- kalau document-preview gagal, case detail tetap boleh tampil tanpa preview.

Strategy:

```text
Timeout: 300ms
Retry: none or 1 retry only for connection reset
Circuit breaker: yes, slow threshold 250ms
Bulkhead: small, e.g. 10 concurrent
Rate limiter: optional
Fallback: return previewUnavailable=true
```

Response:

```json
{
  "caseId": "CASE-001",
  "title": "Application Review",
  "documentPreview": null,
  "degraded": true,
  "degradationReasons": ["DOCUMENT_PREVIEW_UNAVAILABLE"]
}
```

Correctness:

- user sees main data;
- system does not fake preview;
- degradation visible;
- observability tracks dependency issue.

---

### 8.5 Example: Payment/Create Command

Use case:

- create charge against payment provider;
- side effect external;
- unknown outcome possible.

Strategy:

```text
Timeout: controlled but not too aggressive
Retry: only with idempotency key and provider-safe semantics
Circuit breaker: yes, but fallback must not approve payment
Bulkhead: yes
Rate limiter: yes if provider quota
Fallback: no fake success; return pending/unknown/unavailable depending state
```

Response semantics:

```text
If idempotency key known and provider returns duplicate:
  return original result

If provider unavailable before request sent:
  return PAYMENT_PROVIDER_UNAVAILABLE, retryable=true

If timeout after request may have been sent:
  return PAYMENT_OUTCOME_UNKNOWN
  schedule reconciliation
```

Correctness:

- do not double charge;
- do not mark paid without confirmation;
- preserve reconciliation trail.

---

## 9. Java/Spring Implementation Model

### 9.1 Dependency Adapter Boundary

Tempat terbaik memasang resilience control biasanya di adapter boundary.

```text
Application Service
  -> Port / Interface
      -> Adapter implementation
          -> Resilience controls
          -> HTTP/DB/client library
```

Contoh package:

```text
com.example.caseapp.integration.onemap
  OneMapClient.java                 // port/interface
  OneMapHttpClient.java             // adapter
  OneMapErrorMapper.java
  OneMapProperties.java
  OneMapResilienceConfig.java
```

Application service tidak perlu tahu detail Resilience4j. Ia cukup menerima domain result/exception yang sudah diterjemahkan.

---

### 9.2 Example Domain-Safe Client Interface

```java
public interface AddressLookupClient {
    AddressLookupResult lookupByPostalCode(String postalCode);
}
```

Result eksplisit:

```java
public sealed interface AddressLookupResult permits
        AddressLookupResult.Found,
        AddressLookupResult.NotFound,
        AddressLookupResult.Unavailable {

    record Found(Address address) implements AddressLookupResult {}

    record NotFound(String postalCode) implements AddressLookupResult {}

    record Unavailable(
            String reasonCode,
            boolean retryable,
            Throwable cause
    ) implements AddressLookupResult {}
}
```

Keuntungan:

- caller tidak dipaksa menangkap semua technical exception;
- unavailable menjadi explicit state;
- fallback tidak memalsukan found;
- retryability bisa dipreservasi.

---

### 9.3 Example Resilience4j Configuration

Contoh konfigurasi Spring Boot YAML konseptual:

```yaml
resilience4j:
  circuitbreaker:
    instances:
      onemapAddressLookup:
        slidingWindowType: TIME_BASED
        slidingWindowSize: 60
        minimumNumberOfCalls: 50
        failureRateThreshold: 50
        slowCallRateThreshold: 50
        slowCallDurationThreshold: 1500ms
        waitDurationInOpenState: 30s
        permittedNumberOfCallsInHalfOpenState: 5
        automaticTransitionFromOpenToHalfOpenEnabled: true
        recordExceptions:
          - java.net.SocketTimeoutException
          - java.net.ConnectException
          - org.springframework.web.client.ResourceAccessException
        ignoreExceptions:
          - com.example.integration.ExternalValidationException

  bulkhead:
    instances:
      onemapAddressLookup:
        maxConcurrentCalls: 20
        maxWaitDuration: 0

  ratelimiter:
    instances:
      onemapAddressLookup:
        limitForPeriod: 250
        limitRefreshPeriod: 60s
        timeoutDuration: 0

  timelimiter:
    instances:
      onemapAddressLookup:
        timeoutDuration: 2s
        cancelRunningFuture: true

  retry:
    instances:
      onemapAddressLookup:
        maxAttempts: 2
        waitDuration: 200ms
        retryExceptions:
          - java.net.SocketTimeoutException
          - java.net.ConnectException
        ignoreExceptions:
          - com.example.domain.NonRetriableExternalException
```

Catatan:

- angka di atas contoh, bukan best universal;
- tune berdasarkan latency/traffic/quotas;
- `maxWaitDuration: 0` membuat bulkhead fail fast;
- `timeoutDuration: 0` pada rate limiter membuat call ditolak langsung jika permit tidak tersedia;
- `recordExceptions`/`ignoreExceptions` harus selaras dengan exception translation.

---

### 9.4 Annotation vs Programmatic Style

Resilience4j bisa dipakai dengan annotation seperti:

```java
@CircuitBreaker(name = "onemapAddressLookup", fallbackMethod = "fallback")
@Bulkhead(name = "onemapAddressLookup")
@RateLimiter(name = "onemapAddressLookup")
@TimeLimiter(name = "onemapAddressLookup")
public CompletableFuture<AddressResponse> lookupAsync(String postalCode) {
    return CompletableFuture.supplyAsync(() -> callProvider(postalCode));
}
```

Annotation mudah, tetapi ada risiko:

- urutan aspect tidak selalu dipahami;
- fallback signature mudah salah;
- domain semantics tersembunyi;
- sulit melakukan composition eksplisit;
- self-invocation problem pada proxy-based AOP;
- test behavior bisa tidak obvious.

Untuk sistem kritis, programmatic composition sering lebih jelas.

---

### 9.5 Programmatic Composition Example

```java
public final class ResilientAddressLookupClient implements AddressLookupClient {

    private final ExternalAddressHttpClient httpClient;
    private final CircuitBreaker circuitBreaker;
    private final Bulkhead bulkhead;
    private final RateLimiter rateLimiter;

    public ResilientAddressLookupClient(
            ExternalAddressHttpClient httpClient,
            CircuitBreaker circuitBreaker,
            Bulkhead bulkhead,
            RateLimiter rateLimiter
    ) {
        this.httpClient = httpClient;
        this.circuitBreaker = circuitBreaker;
        this.bulkhead = bulkhead;
        this.rateLimiter = rateLimiter;
    }

    @Override
    public AddressLookupResult lookupByPostalCode(String postalCode) {
        Supplier<AddressLookupResult> supplier = () -> callAndMap(postalCode);

        Supplier<AddressLookupResult> decorated = Decorators.ofSupplier(supplier)
                .withCircuitBreaker(circuitBreaker)
                .withBulkhead(bulkhead)
                .withRateLimiter(rateLimiter)
                .decorate();

        try {
            return decorated.get();
        } catch (CallNotPermittedException e) {
            return new AddressLookupResult.Unavailable(
                    "ADDRESS_PROVIDER_CIRCUIT_OPEN",
                    true,
                    e
            );
        } catch (BulkheadFullException e) {
            return new AddressLookupResult.Unavailable(
                    "ADDRESS_PROVIDER_CONCURRENCY_LIMIT_REACHED",
                    true,
                    e
            );
        } catch (RequestNotPermitted e) {
            return new AddressLookupResult.Unavailable(
                    "ADDRESS_PROVIDER_RATE_LIMITED",
                    true,
                    e
            );
        } catch (ExternalDependencyException e) {
            return new AddressLookupResult.Unavailable(
                    e.reasonCode(),
                    e.retryable(),
                    e
            );
        }
    }

    private AddressLookupResult callAndMap(String postalCode) {
        try {
            ExternalAddressResponse response = httpClient.lookup(postalCode);

            if (response.notFound()) {
                return new AddressLookupResult.NotFound(postalCode);
            }

            return new AddressLookupResult.Found(response.toDomainAddress());
        } catch (ExternalHttpException e) {
            throw ExternalAddressErrorMapper.toDependencyException(e);
        }
    }
}
```

Catatan:

- technical exceptions diterjemahkan di adapter;
- caller menerima domain-safe result;
- breaker/bulkhead/rate limit exceptions tidak bocor ke controller;
- fallback tidak memalsukan data.

---

## 10. Observability Requirements

Pattern ini harus observable. Tanpa observability, ia hanya menyembunyikan failure.

### 10.1 Metrics Minimal

Untuk circuit breaker:

- state: closed/open/half-open;
- failure rate;
- slow call rate;
- not permitted calls;
- successful calls;
- failed calls;
- slow calls;
- transition count.

Untuk bulkhead:

- available concurrent calls;
- max allowed concurrent calls;
- rejected calls;
- waiting duration;
- queue depth jika thread pool bulkhead.

Untuk rate limiter:

- available permissions;
- waiting threads;
- rejected calls;
- permitted calls;
- per dependency/operation quota usage.

Untuk time limiter:

- timeout count;
- timeout rate;
- cancellation success/failure;
- operation duration histogram.

Untuk composition:

- retry attempts;
- retry exhausted;
- fallback count;
- degraded response count;
- downstream latency;
- client-visible error rate;
- upstream timeout rate.

---

### 10.2 Logging Rules

Jangan log stacktrace untuk setiap rejected call saat breaker open. Itu bisa membuat log storm.

Rekomendasi:

| Event | Log Level | Notes |
|---|---|---|
| breaker opens | WARN/ERROR depending criticality | one event, high signal |
| breaker closes | INFO | recovery signal |
| breaker half-open | INFO/DEBUG | trial state |
| call not permitted | DEBUG/INFO sampled | avoid spam |
| bulkhead full | WARN sampled | overload signal |
| rate limited | INFO/WARN sampled | depends client/internal |
| timeout | WARN sampled if elevated | include dependency/operation/duration |
| fallback used | INFO metric + sampled log | must be visible |

Always include:

- dependency name;
- operation name;
- correlation id;
- trace id;
- failure class;
- retryable flag;
- degraded flag;
- circuit state if relevant;
- attempt count if retry involved.

---

### 10.3 Alerting

Alert bukan untuk setiap timeout tunggal.

Alert ketika:

- breaker open for critical dependency;
- breaker flapping repeatedly;
- fallback/degradation rate exceeds threshold;
- bulkhead rejection sustained;
- rate limiter rejection unexpected;
- timeout rate above baseline;
- retry exhausted rate above baseline;
- critical dependency unavailable;
- SLO burn rate tinggi.

Rule:

> Alert harus memetakan signal ke aksi manusia.

Contoh alert buruk:

```text
Exception occurred
```

Contoh alert bagus:

```text
PaymentProviderCreateCharge circuit breaker OPEN for 4m.
Impact: payment creation unavailable.
Fallback: none.
User response: PAYMENT_PROVIDER_UNAVAILABLE.
Runbook: check provider status, auth token, outbound network, recent deploy.
```

---

## 11. Failure Scenario Walkthrough

### Scenario 1 — Dependency Hard Down

```text
T0: payment provider unreachable
T1: connect exception starts
T2: retry tries limited attempts
T3: circuit breaker failure rate exceeds threshold
T4: breaker opens
T5: new calls fail fast
T6: bulkhead no longer consumed by long waits
T7: alert fires
T8: after wait duration, half-open probe starts
T9: provider recovers
T10: breaker closes
```

Expected design:

- no thread exhaustion;
- no infinite retry;
- clear user-facing unavailable response;
- metric shows dependency failure;
- reconciliation if unknown outcomes possible.

---

### Scenario 2 — Dependency Slow but Still Returns 200

```text
T0: latency normal 200ms
T1: dependency P95 becomes 5s
T2: timeout at 2s fires
T3: slow call rate/failure rate rises
T4: breaker opens
T5: caller fails fast/degrades
```

Expected design:

- slow call threshold catches latency collapse;
- time limiter/client timeout prevents resource retention;
- bulkhead limits concurrent waits;
- degraded response if safe.

---

### Scenario 3 — Provider Rate Limit 300/min

Bad design:

```text
5 pods × 300/min limiter = 1500/min potential traffic
Provider quota exceeded
429 storm
retry storm
breaker opens incorrectly
```

Better design:

```text
Total provider quota: 300/min
Per-pod safe quota: 50/min for 5 pods = 250/min
Headroom: 50/min
Retry attempts included in limiter
429 handled with Retry-After/backoff
```

Best for strict global quota:

```text
centralized/distributed token bucket
or queue-based controlled worker pool
or provider-specific scheduler
```

---

### Scenario 4 — One Optional Dependency Starves Whole Service

Bad design:

```text
All request threads blocked on document preview service
Login/case query/payment also slow
Service appears down
```

Better design:

```text
document preview bulkhead max 10
timeout 300ms
fallback previewUnavailable
critical path remains healthy
```

---

## 12. Production Tuning Method

### Step 1 — Identify Dependency Boundary

For each outbound dependency:

```text
dependency name:
operation:
criticality:
side effect:
idempotent:
expected latency:
provider quota:
retryable failures:
fallback allowed:
max tolerated user latency:
```

### Step 2 — Define Failure Classification

Classify:

- timeout;
- connection failure;
- HTTP 5xx;
- HTTP 429;
- HTTP 4xx;
- auth failure;
- schema failure;
- business rejection;
- domain not found/conflict.

### Step 3 — Define Timeout Budget

Set:

- connect timeout;
- read/response timeout;
- operation timeout;
- total request deadline;
- retry max elapsed time.

### Step 4 — Define Concurrency Limit

Set bulkhead based on:

- dependency capacity;
- pod count;
- latency;
- criticality;
- connection pool.

### Step 5 — Define Rate Limit

Set quota based on:

- provider limits;
- expected traffic;
- scale-out factor;
- retry inclusion;
- tenant/user priority.

### Step 6 — Define Circuit Breaker Threshold

Set:

- sliding window type/size;
- minimum calls;
- failure rate threshold;
- slow call threshold;
- slow duration;
- open wait duration;
- half-open permitted calls.

### Step 7 — Define Fallback/Degradation

For each failure:

```text
What does caller see?
Is it retryable?
Is result partial?
Is data stale?
Is manual action required?
Is reconciliation required?
```

### Step 8 — Define Observability

Add:

- metrics;
- logs;
- traces;
- alerts;
- dashboard;
- runbook.

### Step 9 — Test Failure Modes

Test:

- dependency down;
- dependency slow;
- 429;
- 500;
- invalid response;
- breaker open;
- bulkhead full;
- rate limit exceeded;
- timeout;
- retry exhausted;
- shutdown during in-flight calls.

---

## 13. Checklist: Architecture Review

### Circuit Breaker Checklist

- [ ] Breaker scoped per dependency/operation, not global everything.
- [ ] Failure classification excludes expected business errors.
- [ ] Slow calls are considered, not only failures.
- [ ] Minimum calls configured to avoid noisy small samples.
- [ ] Sliding window type matches traffic pattern.
- [ ] Open duration and half-open probes are reasonable.
- [ ] Fallback does not fake success.
- [ ] Open/close transitions are observable.
- [ ] Critical breaker open triggers actionable alert.

### Bulkhead Checklist

- [ ] Critical and non-critical paths isolated.
- [ ] Blocking dependency has concurrency control.
- [ ] Bulkhead size respects downstream capacity and pod count.
- [ ] Queue is small or disabled for latency-sensitive paths.
- [ ] Rejection semantics are explicit.
- [ ] Bulkhead full events are monitored.
- [ ] Timeout prevents permits being held too long.

### Rate Limiter Checklist

- [ ] Rate limit scope matches provider/client/tenant policy.
- [ ] Per-pod vs global quota is accounted for.
- [ ] Retry attempts consume quota.
- [ ] Critical traffic has reserved capacity if needed.
- [ ] Rejection maps to correct error response.
- [ ] `Retry-After` used when appropriate.
- [ ] Metrics show allowed/rejected calls.

### Time Limiter Checklist

- [ ] Timeout aligns with end-to-end deadline.
- [ ] IO/client timeout exists below time limiter.
- [ ] Timeout differs per operation profile.
- [ ] Cancellation behavior understood.
- [ ] Timeout errors are classified correctly.
- [ ] Timeout rate is monitored.
- [ ] Shutdown budget accounts for max timeout.

### Composition Checklist

- [ ] Order of retry/circuit/bulkhead/rate/time is intentional.
- [ ] Retry does not bypass rate/concurrency budget.
- [ ] Circuit breaker does not count client validation errors.
- [ ] Bulkhead protects local resource before expensive blocking.
- [ ] Fallback is domain-safe.
- [ ] Metrics distinguish timeout, breaker open, bulkhead full, rate limit, retry exhausted.

---

## 14. Review Questions

1. Apa perbedaan circuit breaker dan retry?
2. Mengapa circuit breaker tanpa timeout tetap berbahaya?
3. Kapan slow call rate lebih penting daripada failure rate?
4. Apa risiko menggunakan satu circuit breaker global untuk semua dependency?
5. Apa perbedaan bulkhead dan rate limiter?
6. Kenapa queue besar pada bulkhead sering menjadi anti-pattern?
7. Apa yang terjadi jika provider quota 300/min tetapi ada 5 pod masing-masing limiter 300/min?
8. Mengapa timeout tidak selalu membatalkan underlying work?
9. Bagaimana cara menentukan apakah fallback aman?
10. Bagaimana retry bisa memperparah circuit breaker/open state?
11. Apa observability minimal untuk circuit breaker?
12. Bagaimana response API seharusnya saat bulkhead penuh?
13. Apa hubungan bulkhead size, latency, dan arrival rate?
14. Mengapa 400 validation error tidak boleh dihitung sebagai dependency failure?
15. Bagaimana pattern ini berinteraksi dengan graceful shutdown?

---

## 15. Key Takeaways

1. Circuit breaker melindungi sistem dari dependency yang berulang kali gagal atau lambat.
2. Bulkhead melindungi resource lokal agar satu dependency/operation tidak menghabiskan semuanya.
3. Rate limiter membatasi throughput dan melindungi quota/capacity.
4. Time limiter membatasi durasi operasi, tetapi harus diselaraskan dengan IO timeout dan cancellation reality.
5. Pattern ini bukan pengganti domain modeling, idempotency, timeout, atau observability.
6. Fallback harus domain-safe; fallback palsu lebih berbahaya daripada error eksplisit.
7. Retry tanpa rate/concurrency/deadline budget bisa menciptakan cascading failure.
8. Per-pod limiter harus memperhitungkan scale-out dan global provider quota.
9. Circuit breaker harus menghitung dependency health, bukan expected business rejection.
10. Top-tier reliability design bukan “pakai Resilience4j”, tetapi memilih control mechanism sesuai failure mode.

---

## 16. Practical Heuristic

Gunakan pertanyaan ini saat review desain:

```text
Jika dependency ini menjadi lambat 10x selama 10 menit,
apakah service kita:

1. tetap menunggu sampai thread habis?
2. retry sampai provider makin overload?
3. membuka circuit dan fail fast?
4. membatasi concurrency?
5. membatasi outbound rate?
6. mengembalikan degraded response yang jujur?
7. preserve correctness?
8. memberi signal jelas ke operator?
9. recover otomatis saat dependency pulih?
```

Jika jawaban dominan masih “tidak tahu”, resilience design belum selesai.

---

## 17. Referensi

- Resilience4j CircuitBreaker Documentation — https://resilience4j.readme.io/docs/circuitbreaker
- Resilience4j Bulkhead Documentation — https://resilience4j.readme.io/docs/bulkhead
- Resilience4j RateLimiter Documentation — https://resilience4j.readme.io/docs/ratelimiter
- Resilience4j Getting Started / Decorators — https://resilience4j.readme.io/docs/getting-started
- Google SRE Book: Addressing Cascading Failures — https://sre.google/sre-book/addressing-cascading-failures/
- Google SRE Book: Handling Overload — https://sre.google/sre-book/handling-overload/
- AWS Builders Library: Timeouts, retries, and backoff with jitter — https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
- AWS Builders Library: Avoiding overload in distributed systems — https://aws.amazon.com/builders-library/avoiding-overload-in-distributed-systems-by-putting-the-smaller-service-in-control/

---

## 18. Status Seri

```text
Part 018 / 030 completed
Seri belum selesai.
```

Part berikutnya:

```text
Part 019 — Fallback, Degradation, and Recovery Design
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-reliability-part-017.md](./learn-java-reliability-part-017.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-019.md](./learn-java-reliability-part-019.md)

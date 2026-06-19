# Learn Java Microservices Patterns — Advanced Engineering
## Part 16 — Backpressure, Flow Control, and Capacity-Aware Design

> **File:** `learn-java-microservices-patterns-advanced-engineering-16-backpressure-flow-control-capacity-aware-design.md`  
> **Series:** `learn-java-microservices-patterns-advanced-engineering`  
> **Part:** 16 of 35  
> **Scope:** Java 8–25, microservices, distributed systems, production architecture  
> **Level:** Advanced / Principal Engineer Thinking

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas resilience pattern: timeout, retry, circuit breaker, bulkhead, rate limiter, fallback, dan load shedding.

Part ini naik satu level lebih dalam:

> **Bagaimana sistem microservices tetap hidup ketika permintaan lebih cepat daripada kemampuan prosesnya?**

Ini adalah inti dari **backpressure, flow control, dan capacity-aware design**.

Banyak engineer memahami retry, circuit breaker, dan autoscaling. Namun sistem tetap bisa tumbang karena satu hal sederhana:

> **Arrival rate > service rate for long enough.**

Kalau request/event/message masuk lebih cepat daripada yang bisa diproses, sistem akan menumpuk pekerjaan. Tumpukan itu bisa berbentuk:

- thread yang menunggu,
- connection yang menggantung,
- queue yang membesar,
- heap yang penuh,
- broker lag yang naik,
- DB connection pool yang habis,
- CPU saturation,
- GC pressure,
- disk spill,
- timeout,
- retry storm,
- cascading failure.

Backpressure adalah cara sistem mengatakan:

> **"Saya tidak bisa menerima pekerjaan lebih banyak dengan aman saat ini."**

Flow control adalah cara sistem mengatur:

> **"Berapa banyak pekerjaan yang boleh mengalir dari upstream ke downstream."**

Capacity-aware design adalah cara engineer mendesain sistem dengan sadar bahwa:

> **Setiap service punya batas kapasitas, dan batas itu harus menjadi bagian dari contract arsitektur.**

---

## 1. Mental Model Utama

### 1.1 Sistem Bukan Hanya Code, Tetapi Pipeline Kapasitas

Microservice jarang berdiri sendiri. Biasanya ia adalah bagian dari pipeline:

```text
Client
  -> API Gateway
  -> Service A
  -> Service B
  -> Database
  -> Message Broker
  -> Consumer C
  -> External System
```

Setiap node punya kapasitas:

```text
API Gateway      : max concurrent requests
Service A        : max worker threads / virtual threads / CPU / memory
Service B        : max connection pool / executor / DB calls
Database         : max sessions / IOPS / locks / CPU
Broker           : max ingress / egress / partition throughput
Consumer C       : max messages/sec
External System  : rate limit / latency / availability
```

Satu bottleneck kecil bisa menentukan throughput seluruh chain.

Top 1% engineer tidak hanya bertanya:

```text
Apakah service ini scalable?
```

Mereka bertanya:

```text
Di mana bottleneck paling sempit?
Apa yang terjadi saat bottleneck itu tercapai?
Apakah upstream berhenti?
Apakah request ditolak?
Apakah queue tumbuh?
Apakah latency naik?
Apakah retry memperparah?
Apakah sistem gagal secara terkendali atau runtuh?
```

---

### 1.2 Backpressure Adalah Sinyal, Bukan Sekadar Mekanisme

Backpressure bukan hanya konsep reactive programming.

Backpressure bisa muncul dalam banyak bentuk:

| Layer | Bentuk Backpressure |
|---|---|
| HTTP | 429 Too Many Requests, 503 Service Unavailable, Retry-After |
| TCP | receive window, congestion control |
| Reactive Streams | `request(n)` demand signal |
| Message Broker | consumer lag, prefetch limit, pause/resume |
| Executor | bounded queue reject policy |
| Database | connection pool exhaustion |
| Kubernetes | readiness false, HPA scale-out lag |
| Business workflow | intake closed, manual review backlog |
| External API | rate limit response |

Intinya sama:

```text
Downstream memberi tahu upstream bahwa kapasitasnya terbatas.
```

---

### 1.3 Queue Tidak Menghilangkan Beban

Queue sering dianggap solusi ajaib.

```text
Problem: service lambat.
Solution: taruh queue.
```

Ini framing yang lemah.

Queue memang bisa menyerap spike, tetapi queue tidak menambah kapasitas downstream. Queue hanya mengubah bentuk tekanan:

```text
Synchronous pressure
  -> asynchronous backlog
```

Queue bisa membantu jika:

- spike pendek,
- downstream bisa mengejar setelah spike,
- backlog punya batas,
- message punya TTL atau business deadline,
- consumer bisa diskalakan,
- ordering requirement tidak terlalu ketat,
- processing idempotent,
- replay aman.

Queue berbahaya jika:

- arrival rate selalu lebih tinggi dari processing rate,
- backlog tidak dibatasi,
- message tidak punya expiry,
- consumer tidak bisa mengejar,
- retry memasukkan ulang message terlalu agresif,
- DLQ tidak dimonitor,
- queue dipakai untuk menyembunyikan bottleneck permanen.

Queue yang tidak dibatasi adalah **memory leak arsitektural**.

---

## 2. Formula Dasar: Little's Law

Untuk memahami kapasitas, gunakan model sederhana:

```text
L = λ × W
```

Di mana:

```text
L = average number of items in system
λ = arrival rate / throughput
W = average time in system
```

Dalam konteks microservice:

```text
Concurrency = Throughput × Latency
```

Contoh:

```text
Throughput = 200 requests/second
Latency    = 250 ms = 0.25 second

Concurrency = 200 × 0.25 = 50 concurrent requests
```

Kalau latency naik:

```text
Throughput = 200 requests/second
Latency    = 2 seconds

Concurrency = 200 × 2 = 400 concurrent requests
```

Artinya, tanpa traffic bertambah pun, hanya karena dependency melambat, concurrency bisa melonjak 8x.

Ini menjelaskan kenapa slow dependency sangat berbahaya:

```text
Dependency lambat
  -> request menunggu lebih lama
  -> thread/connection tertahan
  -> concurrency naik
  -> pool habis
  -> latency naik lagi
  -> timeout
  -> retry
  -> traffic efektif naik
  -> collapse
```

Top 1% engineer memakai Little's Law sebagai alat diagnosis:

```text
Jika latency naik dan throughput sama, in-flight work naik.
Jika in-flight work naik, resource pressure naik.
Jika resource pressure naik, queue/thread/connection/heap akan terdampak.
```

---

## 3. Kenapa Sistem Mati Saat Overload

### 3.1 Overload Bukan Sekadar Traffic Tinggi

Overload terjadi saat demand melebihi capacity.

```text
Demand > Capacity
```

Demand bisa naik karena:

- user traffic spike,
- bot traffic,
- batch job,
- retry storm,
- scheduled cron serentak,
- downstream latency naik,
- consumer pause,
- deployment restart,
- cache miss storm,
- query plan berubah,
- DB lock contention,
- external API rate limit,
- GC pause,
- node CPU throttling.

Capacity bisa turun karena:

- dependency lambat,
- node berkurang,
- pod restart,
- DB CPU tinggi,
- thread pool habis,
- connection pool habis,
- heap pressure,
- disk latency,
- broker partition leader movement,
- autoscaling belum sempat,
- network degradation.

Overload sering bukan karena traffic naik, tetapi karena **effective capacity turun**.

---

### 3.2 Positive Feedback Loop

Overload berbahaya karena sering membentuk feedback loop:

```text
Service lambat
  -> caller timeout
  -> caller retry
  -> traffic bertambah
  -> service makin lambat
  -> queue tumbuh
  -> memory naik
  -> GC naik
  -> latency makin tinggi
  -> lebih banyak timeout
  -> lebih banyak retry
```

Ini disebut **retry amplification**.

Misal chain:

```text
Client -> A -> B -> C
```

Jika tiap layer retry 3 kali:

```text
Client: 3 attempts
A     : 3 attempts
B     : 3 attempts

Total possible attempts to C = 3 × 3 × 3 = 27
```

Traffic asli 1 bisa berubah menjadi 27 call ke dependency paling bawah.

Backpressure harus memotong loop ini.

---

### 3.3 Queue Collapse

Queue menambah latency saat service rate tidak cukup.

```text
Arrival rate: 1000 msg/s
Service rate: 800 msg/s

Backlog growth: 200 msg/s
```

Setelah 10 menit:

```text
200 × 60 × 10 = 120,000 messages backlog
```

Jika setiap message masih valid, consumer butuh waktu ekstra untuk mengejar.

Jika message punya deadline 5 menit, sebagian backlog sudah basi sebelum diproses.

Failure mode:

```text
Queue tumbuh
  -> message makin lama menunggu
  -> message expired secara bisnis
  -> consumer tetap memproses pekerjaan tidak berguna
  -> resource terbuang
  -> fresh work tertahan
```

Karena itu queue perlu:

- max depth,
- TTL,
- priority,
- dead-letter,
- backpressure signal,
- lag alert,
- consumer scaling,
- discard/degrade strategy,
- business freshness rule.

---

## 4. Backpressure vs Rate Limiting vs Throttling vs Load Shedding

Istilah ini sering bercampur. Bedakan dengan jelas.

### 4.1 Backpressure

Backpressure adalah sinyal dari downstream/upstream boundary bahwa kapasitas terbatas.

Contoh:

```text
Consumer hanya request 100 item lagi.
Executor queue full dan reject task.
HTTP service return 429.
Broker prefetch dibatasi.
Service readiness false.
```

Fokus:

```text
Prevent overload by slowing or stopping incoming work.
```

---

### 4.2 Rate Limiting

Rate limiting membatasi laju request/event per waktu.

Contoh:

```text
100 requests/minute per user
1000 requests/second per tenant
300 API calls/minute to external provider
```

Fokus:

```text
Fairness, protection, quota enforcement.
```

Rate limiting bisa bersifat:

- global,
- per client,
- per tenant,
- per endpoint,
- per API key,
- per user,
- per external dependency,
- per workflow type.

---

### 4.3 Throttling

Throttling memperlambat atau membatasi konsumsi/produksi.

Contoh:

```text
Consumer hanya mengambil 50 msg/s.
Batch job sleep saat DB CPU > 70%.
Scheduler pause jika queue depth > threshold.
```

Fokus:

```text
Control pace.
```

---

### 4.4 Load Shedding

Load shedding menolak sebagian pekerjaan agar sistem tetap hidup.

Contoh:

```text
Reject non-critical requests.
Disable expensive enrichment.
Return cached/stale result.
Drop low-priority messages.
Skip optional notification.
```

Fokus:

```text
Preserve core functionality under overload.
```

Load shedding bukan bug. Dalam sistem production mature, load shedding adalah survival mechanism.

---

### 4.5 Graceful Degradation

Graceful degradation menurunkan kualitas response tetapi tetap memberi nilai.

Contoh:

```text
Search hanya top 100 candidate, bukan full corpus.
Dashboard tampil data cached 5 menit lalu.
Application listing tanpa enrichment non-critical.
Autocomplete disabled sementara.
Report export dipindah ke async.
```

Fokus:

```text
Serve less expensive but still useful behavior.
```

---

## 5. Kapasitas Harus Didisain, Bukan Ditebak

### 5.1 Capacity Contract

Setiap service sebaiknya punya capacity contract:

```yaml
service: application-service
max_rps_sustained: 500
max_rps_burst_30s: 1000
p95_latency_budget_ms: 200
p99_latency_budget_ms: 800
max_inflight_requests: 300
http_server_queue_limit: 100
db_pool_size: 40
external_api_rate_limit: 250/min
message_consumer_max_concurrency: 32
message_processing_timeout_ms: 5000
max_queue_lag_seconds: 120
degradation_policy:
  - skip_optional_enrichment
  - return_partial_response
  - reject_bulk_export
```

Ini bukan hanya dokumen. Ini harus tercermin di:

- configuration,
- autoscaling,
- SLO,
- alerts,
- dashboards,
- load tests,
- runbooks,
- API contract,
- consumer contract.

---

### 5.2 Capacity Budget per Dependency

Sebuah service harus tahu dependency mana yang membatasi kapasitasnya.

Contoh:

```text
Application Service:
- DB pool: 40 connections
- DB average query time: 50ms
- Max DB throughput theoretical: 40 / 0.05 = 800 qps
```

Jika setiap request butuh 4 query:

```text
Max request throughput ≈ 800 / 4 = 200 rps
```

Jika query time naik ke 200ms:

```text
Max DB throughput = 40 / 0.2 = 200 qps
Max request throughput = 200 / 4 = 50 rps
```

Traffic sama, tapi kapasitas turun 4x.

Karena itu performance issue di dependency harus diterjemahkan menjadi kapasitas sistem.

---

### 5.3 Capacity Is Multi-Dimensional

Kapasitas tidak hanya RPS.

| Dimension | Contoh Limit |
|---|---|
| CPU | JSON serialization, crypto, validation, rules |
| Memory | queue, cache, request body, projection |
| Threads | platform thread pool, virtual thread carrier pressure |
| DB connections | HikariCP pool |
| DB CPU | query plan, join, index |
| DB locks | concurrent update |
| Broker partitions | throughput per partition |
| External API | rate limit |
| Network | bandwidth, connection churn |
| Disk | log write, spill, broker persistence |
| GC | allocation rate |
| Tenant fairness | noisy neighbor |

Sistem bisa overload di satu dimensi walau dimensi lain terlihat normal.

Contoh:

```text
CPU 35%, memory 50%, tetapi DB connection pool 100% busy.
```

Artinya bottleneck bukan CPU/memory, tetapi downstream concurrency.

---

## 6. Bounded Everything

Prinsip dasar capacity-aware design:

> **Everything that can grow must have a bound.**

Yang harus dibatasi:

- HTTP request body size,
- upload size,
- page size,
- result set size,
- executor queue,
- thread pool,
- virtual thread creation rate,
- DB pool,
- outbound connection pool,
- pending futures,
- in-memory cache,
- broker prefetch,
- batch size,
- retry count,
- retry duration,
- saga duration,
- workflow outstanding tasks,
- per-tenant concurrency,
- per-user request rate,
- report export queue,
- DLQ size,
- log volume,
- trace sampling,
- metric cardinality.

Unbounded structure adalah hidden outage.

---

## 7. HTTP Backpressure Pattern

### 7.1 Return 429 for Client-Specific Limit

Gunakan 429 ketika client melampaui quota/rate limit.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json
```

```json
{
  "error": "RATE_LIMITED",
  "message": "Too many requests for tenant.",
  "retryAfterSeconds": 30,
  "correlationId": "..."
}
```

Cocok untuk:

- per-user quota,
- per-tenant quota,
- API key quota,
- abusive client,
- burst control.

---

### 7.2 Return 503 for Service Capacity Exhaustion

Gunakan 503 ketika service sedang tidak mampu menerima load secara aman.

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 10
Content-Type: application/json
```

```json
{
  "error": "SERVICE_OVERLOADED",
  "message": "Service is temporarily overloaded.",
  "retryAfterSeconds": 10,
  "correlationId": "..."
}
```

Cocok untuk:

- thread pool full,
- DB pool exhausted,
- circuit open,
- internal queue full,
- dependency degraded,
- node draining.

---

### 7.3 Reject Early

Jangan tunggu request masuk terlalu dalam baru gagal.

Buruk:

```text
Accept request
  -> parse full body
  -> validate
  -> call DB
  -> call downstream
  -> wait
  -> timeout
```

Lebih baik:

```text
Check capacity guard at edge
  -> reject early if overloaded
```

Reject early melindungi:

- CPU,
- memory,
- DB,
- thread,
- connection,
- downstream.

---

### 7.4 Deadline-Aware HTTP Handling

Setiap request harus punya deadline.

```text
Gateway total deadline: 2000ms
Service A budget      : 600ms
Service B budget      : 400ms
DB budget             : 200ms
Response composition  : 200ms
Safety margin         : 600ms
```

Jika request datang dengan deadline tersisa 100ms, jangan mulai operasi 500ms.

```java
if (deadline.remainingMillis() < minimumRequiredMillis) {
    throw new DeadlineExceededException();
}
```

Deadline-aware design mengurangi pekerjaan sia-sia.

---

## 8. Executor Backpressure Pattern

### 8.1 Jangan Pakai Unbounded Queue untuk Critical Work

Buruk:

```java
ExecutorService executor = new ThreadPoolExecutor(
    20,
    20,
    0L,
    TimeUnit.MILLISECONDS,
    new LinkedBlockingQueue<>()
);
```

Masalah:

```text
LinkedBlockingQueue tanpa capacity bisa tumbuh sampai memory habis.
```

Lebih aman:

```java
ExecutorService executor = new ThreadPoolExecutor(
    20,
    20,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(100),
    new ThreadPoolExecutor.AbortPolicy()
);
```

Dengan bounded queue, sistem bisa menolak pekerjaan saat overload.

---

### 8.2 Rejection Policy Adalah Bagian dari Desain

Pilihan rejection:

| Policy | Dampak |
|---|---|
| Abort | fail fast |
| CallerRuns | backpressure ke caller |
| Discard | drop silent, berbahaya untuk business command |
| DiscardOldest | cocok hanya untuk data yang boleh kehilangan freshness |

Untuk business command:

```text
Abort + explicit error biasanya lebih aman.
```

Untuk telemetry/log non-critical:

```text
Discard bisa diterima jika dimonitor.
```

Untuk streaming UI update:

```text
DiscardOldest mungkin masuk akal.
```

---

### 8.3 CallerRuns sebagai Backpressure

```java
new ThreadPoolExecutor.CallerRunsPolicy()
```

Jika executor penuh, caller menjalankan task sendiri. Ini memperlambat upstream secara natural.

Namun hati-hati:

```text
Jika caller adalah event loop thread, CallerRuns bisa memblok event loop.
Jika caller adalah servlet thread, CallerRuns menahan request thread lebih lama.
Jika task bisa lambat, latency caller naik.
```

Tidak ada policy universal. Semua tergantung call path.

---

## 9. Database Backpressure Pattern

### 9.1 Connection Pool sebagai Bulkhead

DB connection pool bukan hanya performance optimization. Ia adalah bulkhead.

```text
Pool size terlalu kecil:
  -> throughput rendah

Pool size terlalu besar:
  -> DB overload
  -> context switching
  -> lock contention
  -> query latency naik
```

Prinsip:

```text
Pool size harus melindungi DB, bukan memaksimalkan koneksi.
```

---

### 9.2 Jangan Semua Endpoint Berbagi Pool Tanpa Prioritas

Jika endpoint mahal memakai pool yang sama dengan endpoint ringan, endpoint mahal bisa membuat semua endpoint timeout.

Contoh:

```text
/report/export
/application/list
/application/approve
```

Jika report export menghabiskan DB pool, approve ikut gagal.

Solusi:

- separate pool untuk workload batch/report,
- separate replica untuk read/report,
- async export,
- concurrency limit per endpoint,
- query timeout,
- priority queue,
- rate limit.

---

### 9.3 DB Queue Harus Terlihat

Connection pool wait time adalah sinyal backpressure.

Monitor:

```text
active connections
idle connections
pending threads
connection acquisition time
query latency
transaction duration
lock wait
deadlock count
slow query count
```

Jika pending threads naik:

```text
Service menerima lebih banyak DB work daripada DB pool bisa layani.
```

---

## 10. Messaging Backpressure Pattern

### 10.1 Prefetch / Max Poll / Batch Size

Consumer harus membatasi berapa banyak message yang diambil sebelum diproses.

Jika prefetch terlalu besar:

```text
Broker mengirim banyak message
  -> consumer memory naik
  -> message tertahan di satu consumer
  -> rebalancing lambat
  -> processing unfair
```

Jika terlalu kecil:

```text
Throughput rendah karena round-trip tinggi.
```

Cari titik seimbang berdasarkan:

- processing time,
- message size,
- memory,
- ordering,
- ack strategy,
- consumer concurrency,
- retry behavior.

---

### 10.2 Pause/Resume Consumer

Consumer mature bisa pause saat downstream tidak sehat.

```text
DB pool saturated
  -> pause consuming
  -> broker lag naik
  -> alert
  -> avoid killing DB
```

Ini lebih baik daripada:

```text
Terus consume
  -> DB makin overload
  -> timeout
  -> retry
  -> DLQ
```

---

### 10.3 Consumer Lag Is Not Always Bad

Lag tidak selalu outage.

Lag bisa berarti:

- spike sedang diserap,
- consumer sengaja throttled,
- downstream dilindungi,
- processing batch lebih lambat.

Lag buruk jika:

- terus tumbuh,
- melebihi business freshness SLA,
- message expired,
- DLQ naik,
- consumer error tinggi,
- partition tertentu stuck.

Karena itu alert tidak cukup:

```text
lag > 10000
```

Lebih meaningful:

```text
estimated catch-up time > freshness SLA
```

Formula sederhana:

```text
catchUpTime = backlog / (consumerRate - arrivalRate)
```

Jika `consumerRate <= arrivalRate`, backlog tidak akan habis.

---

### 10.4 Retry Topic dan Delayed Retry

Jangan retry poison message secara tight loop.

Buruk:

```text
consume
  -> fail
  -> nack requeue immediately
  -> consume same message again
  -> fail
  -> infinite hot loop
```

Lebih baik:

```text
main topic
  -> retry-1 after 30s
  -> retry-2 after 5m
  -> retry-3 after 30m
  -> DLQ / parking lot
```

Retry harus memperhitungkan:

- error type,
- dependency recovery time,
- message age,
- business deadline,
- attempt count,
- idempotency.

---

## 11. Reactive Streams Backpressure

Reactive Streams mendefinisikan standar untuk asynchronous stream processing dengan non-blocking backpressure pada JVM.

Mental model-nya:

```text
Subscriber tidak pasif menerima semua data.
Subscriber menyatakan demand: "Saya siap menerima N item."
Publisher hanya boleh mengirim sesuai demand.
```

Simplified:

```java
subscriber.request(10);
```

Artinya:

```text
Saya siap menerima maksimal 10 item lagi.
```

Ini berbeda dari push-only model:

```text
Publisher kirim secepat mungkin.
Subscriber kewalahan.
Buffer tumbuh.
Memory habis.
```

Reactive Streams cocok untuk:

- streaming data,
- non-blocking IO,
- pipeline asynchronous,
- bounded memory processing,
- high concurrency with controlled demand.

Namun reactive bukan magic.

Jika downstream DB lambat, backpressure hanya membantu jika seluruh chain menghormati demand.

Jika ada boundary yang mengubah stream menjadi unbounded queue, backpressure putus.

---

## 12. Java 8–25 Considerations

### 12.1 Java 8

Java 8 umum di legacy enterprise.

Relevant tools:

- `ExecutorService`,
- `ThreadPoolExecutor`,
- `CompletableFuture`,
- blocking IO,
- servlet thread pool,
- custom bounded queue,
- HikariCP,
- Hystrix-era patterns,
- RxJava/Reactor external libraries.

Risiko umum:

- unbounded executor,
- common ForkJoinPool disalahgunakan,
- blocking call di async pipeline,
- timeout tidak konsisten,
- pool tidak dikaitkan dengan downstream capacity,
- queue tidak dimonitor.

---

### 12.2 Java 11

Java 11 membawa baseline modern yang lebih baik:

- standardized `HttpClient`,
- TLS/runtime improvements,
- container awareness lebih matang dibanding Java 8,
- long-term support baseline enterprise.

Untuk capacity-aware design:

- gunakan `HttpClient` dengan timeout eksplisit,
- batasi concurrency outbound,
- jangan hanya mengandalkan async send tanpa bounded demand,
- observe pool dan pending futures.

---

### 12.3 Java 17

Java 17 sering menjadi baseline modern enterprise.

Relevant improvements:

- records untuk DTO/config snapshot,
- sealed classes untuk error/result modeling,
- improved GC/runtime,
- stronger platform baseline,
- pattern matching evolution.

Untuk backpressure:

- records membantu immutable configuration dan capacity contract,
- sealed result membantu eksplisitkan accepted/rejected/degraded response,
- modern GC membantu, tetapi tidak mengganti bounded design.

---

### 12.4 Java 21

Java 21 memperkenalkan virtual threads sebagai fitur final melalui JEP 444.

Virtual threads membuat blocking code lebih scalable dalam banyak workload IO-bound.

Namun prinsip penting:

> **Virtual threads increase concurrency feasibility; they do not remove downstream capacity limits.**

Dengan virtual threads, service bisa membuat lebih banyak concurrent request. Itu bisa menjadi baik atau buruk.

Baik jika:

- bottleneck adalah platform thread exhaustion,
- downstream mampu menampung concurrency,
- DB/external pool tetap bounded,
- deadline/timeout jelas,
- memory per task terkendali.

Buruk jika:

- virtual threads membuat lebih banyak call ke DB,
- DB pool jadi bottleneck,
- external API kena rate limit,
- heap pressure naik karena banyak in-flight object,
- pinned/blocking native call menyebabkan carrier pressure.

Jadi virtual threads harus dipasangkan dengan:

- semaphore limit,
- connection pool limit,
- rate limiter,
- deadline propagation,
- structured concurrency mindset,
- metrics in-flight work.

---

### 12.5 Java 25

Java 25 berada pada horizon modern Java setelah Java 21. Untuk seri ini, prinsipnya:

- Jangan mendesain microservices yang hanya valid untuk satu versi Java kecuali memang controlled runtime.
- Java 8–17 masih banyak di enterprise legacy.
- Java 21+ membuka ulang diskusi blocking vs reactive.
- Java 25 memperkuat arah modern Java, tetapi capacity-aware design tetap sama:
  - bound concurrency,
  - protect downstream,
  - propagate deadline,
  - reject early,
  - observe saturation,
  - design degradation.

---

## 13. Virtual Threads and Backpressure

Virtual threads sering disalahpahami.

Salah:

```text
Dulu kita butuh reactive untuk high concurrency.
Sekarang virtual threads berarti kita tidak perlu backpressure.
```

Benar:

```text
Virtual threads membuat menulis concurrent blocking code lebih murah.
Tetapi kapasitas downstream tetap terbatas.
```

Contoh buruk:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request req : requests) {
        executor.submit(() -> callExternalApi(req));
    }
}
```

Jika `requests` berisi 100.000 item, ini bisa membuat terlalu banyak outstanding call.

Lebih aman:

```java
Semaphore externalApiLimit = new Semaphore(100);

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request req : requests) {
        executor.submit(() -> {
            if (!externalApiLimit.tryAcquire(200, TimeUnit.MILLISECONDS)) {
                throw new RejectedExecutionException("external API concurrency limit reached");
            }

            try {
                return callExternalApi(req);
            } finally {
                externalApiLimit.release();
            }
        });
    }
}
```

Virtual threads butuh **concurrency limiter** sama seperti platform threads.

---

## 14. Concurrency Limit Pattern

### 14.1 Fixed Concurrency Limit

Gunakan semaphore untuk membatasi concurrent call ke dependency.

```java
public final class DependencyLimiter {
    private final Semaphore semaphore;

    public DependencyLimiter(int maxConcurrent) {
        this.semaphore = new Semaphore(maxConcurrent);
    }

    public <T> T execute(Callable<T> action, long waitMillis) throws Exception {
        boolean acquired = semaphore.tryAcquire(waitMillis, TimeUnit.MILLISECONDS);

        if (!acquired) {
            throw new RejectedExecutionException("Dependency capacity limit reached");
        }

        try {
            return action.call();
        } finally {
            semaphore.release();
        }
    }
}
```

Cocok untuk:

- external API,
- DB-heavy operation,
- expensive report,
- CPU-heavy validation,
- file processing,
- legacy SOAP endpoint.

---

### 14.2 Per-Endpoint Limit

Tidak semua endpoint sama.

```text
GET /applications        -> limit 300
POST /applications       -> limit 100
POST /applications/{id}/approve -> limit 50
POST /reports/export     -> limit 5
```

Reasoning:

- approval mungkin punya lock/state transition,
- export mahal,
- listing lebih murah,
- create butuh validation dan DB write,
- query endpoint bisa cache.

---

### 14.3 Per-Tenant Limit

Tanpa per-tenant limit, satu tenant bisa menjadi noisy neighbor.

```text
Tenant A sends 1000 rps
Tenant B sends 10 rps
Tenant C sends 10 rps
```

Jika limit global saja, Tenant A bisa menghabiskan kapasitas.

Per-tenant capacity:

```text
global limit      : 1000 rps
tenant soft limit : 100 rps
tenant burst      : 200 rps for 30 seconds
tenant hard limit : 300 rps
```

Untuk regulatory/multi-agency system, ini sangat penting.

---

## 15. Queue Design Pattern

### 15.1 Bounded Queue

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(1000);
```

Jika queue penuh:

- reject,
- drop low-priority,
- block producer,
- persist for later,
- route to overflow queue,
- return 503/429.

Yang tidak boleh:

```text
Queue tumbuh diam-diam tanpa limit.
```

---

### 15.2 Queue Admission Control

Sebelum memasukkan job ke queue, validasi:

```text
Apakah job masih valid?
Apakah tenant over quota?
Apakah queue punya kapasitas?
Apakah duplicate?
Apakah deadline cukup?
Apakah priority cukup?
Apakah downstream sehat?
```

Admission control mencegah queue menjadi tempat sampah semua pekerjaan.

---

### 15.3 Priority Queue

Tidak semua pekerjaan sama.

Contoh:

```text
Priority 1: user-facing approval
Priority 2: SLA-driven case escalation
Priority 3: notification
Priority 4: report export
Priority 5: analytics sync
```

Namun priority queue juga berbahaya:

```text
Low priority bisa starvation.
```

Perlu:

- aging,
- fairness,
- separate queue per class,
- reserved capacity.

---

### 15.4 Deadline-Aware Queue

Setiap job sebaiknya punya deadline.

```java
record WorkItem(
    String id,
    Instant createdAt,
    Instant deadlineAt,
    Priority priority,
    Payload payload
) {
    boolean expired(Clock clock) {
        return !deadlineAt.isAfter(clock.instant());
    }
}
```

Consumer harus skip expired work:

```java
if (item.expired(clock)) {
    markExpired(item);
    return;
}
```

Ini mencegah sistem memproses pekerjaan yang sudah tidak berguna.

---

## 16. Bulk Processing and Batch Flow Control

Batch sering menghancurkan sistem online jika tidak dibatasi.

Contoh:

```text
Nightly job memproses 10 juta record
  -> DB CPU naik
  -> online request lambat
  -> timeout
  -> retry
  -> incident
```

Batch harus capacity-aware:

- chunk size,
- sleep between chunks,
- DB CPU guard,
- lock wait guard,
- max concurrency,
- rate limit,
- pause/resume,
- checkpoint,
- off-peak schedule,
- low-priority DB pool,
- separate read replica,
- kill switch.

Contoh pseudo-code:

```java
while (cursor.hasNext()) {
    if (systemHealth.dbCpuAbove(70) || systemHealth.onlineLatencyP95Above(500)) {
        sleep(Duration.ofSeconds(30));
        continue;
    }

    List<Record> batch = cursor.nextBatch(500);
    process(batch);
    checkpoint(batch);
}
```

Top 1% engineer tidak membiarkan batch job “berkompetisi bebas” dengan traffic user-facing.

---

## 17. Adaptive Concurrency Control

Fixed limit kadang tidak cukup. Dependency capacity bisa berubah.

Adaptive concurrency mengubah limit berdasarkan sinyal:

- latency,
- error rate,
- timeout rate,
- queue depth,
- CPU,
- connection wait,
- p95/p99,
- saturation.

Simplified logic:

```text
If latency low and errors low:
    slowly increase concurrency

If latency high or timeouts rising:
    quickly reduce concurrency
```

Ini mirip control system.

Risiko:

- oscillation,
- terlalu agresif,
- metric noisy,
- salah sinyal,
- per-instance local view tidak sama dengan global view.

Prinsip:

```text
Increase slowly, decrease quickly.
```

---

## 18. Autoscaling Is Not Backpressure

Autoscaling membantu, tetapi bukan pengganti backpressure.

Kenapa?

1. Scaling butuh waktu.
2. Bottleneck mungkin DB/external API, bukan pod.
3. Scaling service bisa memperparah downstream.
4. HPA berdasarkan CPU tidak melihat queue/DB pool.
5. Cold start/warmup.
6. Rebalancing consumer butuh waktu.
7. Scale-out bisa menaikkan connection count ke DB.
8. Pod baru belum tentu langsung ready.

Contoh failure:

```text
Service A CPU high
  -> HPA scale 3 to 12 pods
  -> each pod has DB pool 50
  -> DB possible connections 150 -> 600
  -> DB overload
  -> latency naik
  -> all pods timeout
```

Autoscaling harus dipasangkan dengan:

- global concurrency control,
- DB pool budget,
- per-pod pool sizing,
- queue-based scaling,
- rate limiting,
- readiness,
- load shedding.

---

## 19. Service Mesh and Backpressure

Service mesh bisa memberi:

- retry,
- timeout,
- circuit breaking,
- outlier detection,
- rate limiting,
- mTLS,
- telemetry.

Namun mesh juga bisa memperparah jika policy tidak sinkron dengan aplikasi.

Contoh bahaya:

```text
Application retries 3x
Mesh retries 3x
Client retries 3x
Total amplification = 27x
```

Mesh tidak tahu business idempotency.

Mesh tidak tahu apakah operation aman di-retry.

Mesh tidak tahu business deadline kecuali dikonfigurasi.

Prinsip:

```text
Retry policy harus dimiliki secara arsitektural, bukan tersebar di tiap layer.
```

---

## 20. Load Shedding Strategy

### 20.1 Shed by Priority

```text
Keep:
- authentication
- critical command
- case approval
- payment-like confirmation
- SLA escalation

Shed:
- autocomplete
- analytics
- recommendation
- report export
- non-critical enrichment
- background sync
```

---

### 20.2 Shed by Cost

Jika request mahal, reject lebih awal.

```text
Expensive:
- wide date range query
- report export
- full text search
- external enrichment
- large upload
- bulk operation
```

Gunakan:

- max page size,
- max date range,
- async export,
- cost-based admission,
- quota by cost unit.

---

### 20.3 Shed by Tenant/User

Saat tenant tertentu overload:

```text
Shed tenant-specific workload, not global workload.
```

Ini menjaga fairness.

---

### 20.4 Shed by Freshness

Jika data sudah terlalu lama:

```text
Drop stale notification.
Skip expired sync.
Cancel outdated recalculation.
```

---

## 21. Graceful Degradation Pattern

Contoh degradation di microservices:

| Normal Mode | Degraded Mode |
|---|---|
| Full profile enrichment | basic profile only |
| Live external lookup | cached result |
| Full dashboard | critical widgets only |
| Real-time report | queued async report |
| Strong consistency read | eventually consistent projection |
| Complex search | simple filter |
| Notification all channels | email only |
| Audit detail full text | metadata only |

Desain response harus mengkomunikasikan degradation.

```json
{
  "data": {
    "applicationId": "APP-123",
    "status": "PENDING_REVIEW",
    "profile": {
      "name": "..."
    }
  },
  "meta": {
    "degraded": true,
    "omitted": ["externalRiskScore", "fullHistory"],
    "reason": "DEPENDENCY_OVERLOADED",
    "correlationId": "..."
  }
}
```

Ini lebih jujur daripada memberi response seolah normal.

---

## 22. Capacity-Aware API Design

API design harus mencegah request yang terlalu mahal.

### 22.1 Pagination Limit

Jangan izinkan:

```http
GET /applications?pageSize=100000
```

Gunakan:

```text
default page size: 50
max page size: 200
```

---

### 22.2 Date Range Limit

Jangan izinkan query tak terbatas:

```http
GET /audit-trails?from=2010-01-01&to=2026-01-01
```

Gunakan:

```text
max range: 31 days for UI
async export for larger range
```

---

### 22.3 Filter Cost Awareness

Filter tertentu mahal:

```text
LIKE '%abc%'
unindexed sort
large join
full text search
cross-service enrichment
```

API harus punya:

- allowed filters,
- indexed filters,
- cost classification,
- query plan review,
- async path untuk query mahal.

---

### 22.4 Async for Expensive Work

Daripada:

```http
POST /reports/generate
# waits 2 minutes
```

Lebih baik:

```http
POST /report-jobs
202 Accepted
Location: /report-jobs/{jobId}
```

Kemudian:

```http
GET /report-jobs/{jobId}
```

Pattern ini memindahkan pekerjaan mahal dari request path ke managed queue dengan capacity control.

---

## 23. Capacity-Aware State Machine

Untuk workflow/case management, backpressure tidak hanya teknis.

Contoh state machine:

```text
SUBMITTED
  -> UNDER_VALIDATION
  -> PENDING_REVIEW
  -> APPROVED
  -> REJECTED
```

Jika reviewer backlog tinggi:

```text
PENDING_REVIEW queue grows
```

Technical capacity harus dikaitkan dengan business capacity:

```text
Reviewer capacity: 100 cases/day
Incoming cases: 150 cases/day
Backlog growth: 50/day
SLA breach in: backlog / excess rate
```

Backpressure bisnis bisa berupa:

- intake cap,
- SLA warning,
- routing to alternate team,
- auto-prioritization,
- temporary simplified review,
- supervisor escalation,
- additional reviewers,
- queue aging,
- deadline-aware prioritization.

Microservices top-tier tidak hanya melihat CPU dan RPS, tetapi juga **business queue**.

---

## 24. Metrics for Backpressure and Flow Control

### 24.1 Core Metrics

Monitor:

```text
arrival_rate
service_rate
inflight_requests
request_queue_depth
executor_queue_depth
executor_rejections
db_pool_active
db_pool_pending
db_connection_acquire_time
outbound_call_latency
outbound_call_timeout_rate
retry_attempt_rate
retry_amplification_factor
circuit_open_count
rate_limited_count
load_shed_count
consumer_lag
consumer_processing_rate
message_age_p95
dlq_rate
heap_used
allocation_rate
gc_pause
cpu_throttling
```

---

### 24.2 Saturation Metrics

Saturation lebih penting daripada utilization biasa.

```text
CPU 60% tidak berarti aman jika DB pool pending tinggi.
Memory 50% tidak berarti aman jika executor queue penuh.
RPS stabil tidak berarti aman jika latency naik.
```

Saturation indicators:

- queue depth rising,
- wait time rising,
- p99 rising,
- active == max,
- pending > 0,
- rejection > 0,
- lag increasing,
- retry rate increasing,
- deadline exceeded increasing.

---

### 24.3 Business Capacity Metrics

Untuk regulatory/case workflow:

```text
submitted_cases_per_hour
validated_cases_per_hour
review_queue_depth
average_case_age
p95_case_age
sla_breach_projection
officer_capacity
external_dependency_delay
manual_intervention_queue
```

Ini menghubungkan technical backpressure dengan business outcome.

---

## 25. Alerting Strategy

Alert harus berbasis symptom + saturation, bukan angka mentah.

Lemah:

```text
consumer lag > 10000
```

Lebih baik:

```text
consumer lag increasing for 15 minutes
AND estimated catch-up time > 30 minutes
AND message age p95 > freshness SLA
```

Lemah:

```text
DB active connections > 80%
```

Lebih baik:

```text
DB pool pending threads > 0 for 5 minutes
AND connection acquisition p95 > 100ms
AND request p95 latency > SLO
```

Lemah:

```text
HTTP 429 > 0
```

Lebih baik:

```text
429 rate > expected baseline
AND affected tenant count > threshold
OR critical endpoint 429 > 0
```

---

## 26. Testing Backpressure

### 26.1 Load Test

Test normal capacity:

```text
Can service sustain expected RPS under normal dependency latency?
```

---

### 26.2 Stress Test

Naikkan load sampai service menolak.

Expected behavior:

```text
Latency bounded
Errors explicit
No OOM
No thread exhaustion
No DB collapse
No unbounded queue
Clear 429/503
Metrics visible
Recovery after load drops
```

---

### 26.3 Soak Test

Long-running test.

Cari:

- memory leak,
- queue growth,
- thread leak,
- connection leak,
- cache growth,
- GC pressure,
- consumer lag drift.

---

### 26.4 Spike Test

Test sudden burst.

Expected:

- burst absorbed within limit,
- queue bounded,
- excess rejected,
- downstream protected,
- recovery after spike.

---

### 26.5 Dependency Slowdown Test

Simulasikan downstream lambat.

Expected:

- timeout triggers,
- concurrency limit protects,
- retry budget respected,
- circuit opens if needed,
- load shedding activates,
- queue does not explode.

---

### 26.6 Poison Message Test

Expected:

- limited retry,
- delayed retry,
- DLQ,
- no hot loop,
- clear diagnostics,
- replay possible after fix.

---

## 27. Failure Mode Matrix

| Failure | Bad System | Capacity-Aware System |
|---|---|---|
| DB slow | threads pile up, timeout storm | DB pool wait detected, concurrency limited, reject early |
| External API rate limited | retry storm | token bucket, Retry-After, delayed retry |
| Queue backlog | infinite lag | freshness SLA, scaling, drop expired, DLQ |
| Batch job too heavy | online outage | throttled chunks, low-priority pool, pause guard |
| Tenant spike | all tenants affected | per-tenant limit |
| Consumer bug | poison hot loop | retry topic, DLQ, parking lot |
| Gateway accepts too much | downstream collapse | edge rate limit, global inflight limit |
| Virtual threads unbounded | DB/external overload | semaphore + pool + deadline |
| Autoscale too much | DB connection storm | pool budget + max replicas + global limit |
| Cache miss storm | DB overload | single-flight, negative cache, stale fallback |

---

## 28. Anti-Patterns

### 28.1 Infinite Queue Anti-Pattern

```text
"We do not reject requests; we queue them."
```

If queue is unbounded, this means:

```text
"We prefer delayed collapse over controlled rejection."
```

---

### 28.2 Retry Without Budget

```text
Every component retries independently.
```

This creates traffic amplification.

---

### 28.3 Autoscaling as Only Protection

```text
If overloaded, scale pods.
```

This ignores DB/external bottlenecks.

---

### 28.4 Virtual Threads as Capacity Solution

```text
Virtual threads solved thread exhaustion, so we can remove limits.
```

Virtual threads solve one bottleneck, not all bottlenecks.

---

### 28.5 Queue as Architecture Trash Bin

```text
If design is hard, publish event and let someone handle it.
```

This creates hidden backlog and unclear ownership.

---

### 28.6 Backpressure Only at Broker

Backpressure must exist at multiple boundaries:

- client,
- gateway,
- service,
- executor,
- DB,
- external API,
- broker,
- consumer,
- batch,
- workflow.

---

### 28.7 No Business Deadline

Processing expired work wastes capacity.

---

### 28.8 Global Limit Only

Global limit without tenant/user/workload fairness creates noisy neighbor problem.

---

## 29. Java Implementation Sketch: Bounded Admission Controller

```java
public final class AdmissionController {
    private final Semaphore inflight;
    private final int maxQueueDepth;
    private final Supplier<Integer> currentQueueDepth;
    private final Clock clock;

    public AdmissionController(
            int maxInflight,
            int maxQueueDepth,
            Supplier<Integer> currentQueueDepth,
            Clock clock
    ) {
        this.inflight = new Semaphore(maxInflight);
        this.maxQueueDepth = maxQueueDepth;
        this.currentQueueDepth = currentQueueDepth;
        this.clock = clock;
    }

    public AdmissionTicket tryEnter(Instant deadline) {
        if (deadline != null && !deadline.isAfter(clock.instant())) {
            return AdmissionTicket.rejected("DEADLINE_EXCEEDED");
        }

        if (currentQueueDepth.get() >= maxQueueDepth) {
            return AdmissionTicket.rejected("QUEUE_FULL");
        }

        boolean acquired = inflight.tryAcquire();

        if (!acquired) {
            return AdmissionTicket.rejected("INFLIGHT_LIMIT_REACHED");
        }

        return AdmissionTicket.accepted(inflight::release);
    }

    public sealed interface AdmissionTicket permits Accepted, Rejected {
        static AdmissionTicket accepted(Runnable release) {
            return new Accepted(release);
        }

        static AdmissionTicket rejected(String reason) {
            return new Rejected(reason);
        }
    }

    public record Accepted(Runnable release) implements AdmissionTicket, AutoCloseable {
        @Override
        public void close() {
            release.run();
        }
    }

    public record Rejected(String reason) implements AdmissionTicket {
    }
}
```

Java 8-compatible version bisa mengganti sealed interface/record dengan class biasa.

Usage:

```java
AdmissionController.AdmissionTicket ticket = controller.tryEnter(deadline);

if (ticket instanceof AdmissionController.Rejected rejected) {
    throw new ServiceOverloadedException(rejected.reason());
}

try (AdmissionController.Accepted ignored = (AdmissionController.Accepted) ticket) {
    return process(request);
}
```

---

## 30. Java Implementation Sketch: Deadline Propagation

```java
public final class Deadline {
    private final Instant deadlineAt;
    private final Clock clock;

    private Deadline(Instant deadlineAt, Clock clock) {
        this.deadlineAt = deadlineAt;
        this.clock = clock;
    }

    public static Deadline after(Duration duration, Clock clock) {
        return new Deadline(clock.instant().plus(duration), clock);
    }

    public long remainingMillis() {
        return Math.max(0, Duration.between(clock.instant(), deadlineAt).toMillis());
    }

    public boolean expired() {
        return !deadlineAt.isAfter(clock.instant());
    }

    public void throwIfLessThan(Duration required) {
        if (remainingMillis() < required.toMillis()) {
            throw new DeadlineExceededException("Not enough time remaining");
        }
    }
}
```

Call path:

```java
deadline.throwIfLessThan(Duration.ofMillis(200));

httpClient.call(
    request,
    Duration.ofMillis(Math.min(deadline.remainingMillis(), 500))
);
```

---

## 31. Java Implementation Sketch: Consumer Flow Control

```java
public final class ConsumerFlowController {
    private final Semaphore concurrency;
    private final HealthProbe downstreamHealth;

    public ConsumerFlowController(int maxConcurrency, HealthProbe downstreamHealth) {
        this.concurrency = new Semaphore(maxConcurrency);
        this.downstreamHealth = downstreamHealth;
    }

    public boolean shouldPoll() {
        return downstreamHealth.healthy()
                && concurrency.availablePermits() > 0;
    }

    public boolean tryStart() {
        return downstreamHealth.healthy() && concurrency.tryAcquire();
    }

    public void finish() {
        concurrency.release();
    }
}
```

Pseudo consumer:

```java
while (running) {
    if (!flowController.shouldPoll()) {
        sleep(Duration.ofMillis(200));
        continue;
    }

    Message message = broker.poll();

    if (message == null) {
        continue;
    }

    if (!flowController.tryStart()) {
        broker.pause();
        continue;
    }

    executor.submit(() -> {
        try {
            process(message);
            broker.ack(message);
        } catch (TransientException e) {
            broker.retryLater(message);
        } catch (PermanentException e) {
            broker.deadLetter(message);
        } finally {
            flowController.finish();
        }
    });
}
```

---

## 32. Design Checklist

Sebelum menyatakan service production-ready, jawab:

```text
1. Berapa max inflight request/service?
2. Berapa max inflight request per endpoint?
3. Berapa max inflight request per tenant?
4. Berapa DB connection budget per pod?
5. Berapa total DB connection jika semua pod scale max?
6. Apa yang terjadi jika executor queue penuh?
7. Apa yang terjadi jika DB pool pending?
8. Apa yang terjadi jika external API rate limited?
9. Apa yang terjadi jika consumer lag naik?
10. Apakah message punya business deadline?
11. Apakah expired work didrop?
12. Apakah retry punya budget?
13. Apakah retry punya jitter?
14. Apakah retry lintas layer dikontrol?
15. Apakah endpoint mahal punya limit berbeda?
16. Apakah batch job bisa pause?
17. Apakah report export async?
18. Apakah cache miss storm dikendalikan?
19. Apakah noisy tenant bisa diisolasi?
20. Apakah degradation response eksplisit?
21. Apakah autoscaling menghormati downstream capacity?
22. Apakah queue bounded?
23. Apakah DLQ dimonitor?
24. Apakah catch-up time dihitung?
25. Apakah latency p99 memicu protection?
26. Apakah load shedding diuji?
27. Apakah runbook menjelaskan overload mitigation?
28. Apakah business owner tahu behavior saat degraded?
29. Apakah capacity contract terdokumentasi?
30. Apakah contract tersebut diuji di load/stress test?
```

---

## 33. Architecture Review Questions

Pertanyaan untuk senior/principal review:

```text
1. Di mana bottleneck paling sempit di flow ini?
2. Apa resource pertama yang saturate?
3. Apakah kita reject sebelum resource kritis habis?
4. Apakah queue ini bounded?
5. Apa yang terjadi saat queue penuh?
6. Apakah caller tahu kapan harus berhenti/retry?
7. Apa retry amplification terburuk?
8. Apakah virtual threads membuat concurrency terlalu besar?
9. Berapa total DB connections di max replicas?
10. Apa workload yang bisa dikorbankan saat overload?
11. Apakah degradation benar secara bisnis?
12. Apakah stale data lebih baik daripada error?
13. Apa freshness SLA read model?
14. Bagaimana menghitung catch-up time consumer?
15. Apakah batch bisa mengganggu online traffic?
16. Apakah tenant besar bisa mengganggu tenant kecil?
17. Apakah overload test sudah membuktikan recovery?
18. Apa alert pertama sebelum collapse?
19. Apakah system fails closed, fails open, atau fails slow?
20. Apakah rejection dianggap sukses survival atau incident?
```

---

## 34. Case Study: Regulatory Application Platform

### 34.1 Scenario

Sistem menerima application submission, validation, review, approval, document generation, notification, audit logging, dan external identity/profile lookup.

Flow:

```text
Citizen Portal
  -> API Gateway
  -> Application Service
  -> Validation Service
  -> Profile Lookup Service
  -> Review Queue
  -> Officer Review Service
  -> Approval Service
  -> Notification Service
  -> Audit Trail Service
```

### 34.2 Bottleneck Map

| Component | Bottleneck |
|---|---|
| API Gateway | RPS, request body, TLS |
| Application Service | DB writes, validation |
| Profile Lookup | external API rate limit |
| Review Queue | human capacity |
| Approval Service | state transition lock |
| Notification | SMTP/external provider |
| Audit Trail | write volume, LOB, index |
| Reporting | large read queries |

### 34.3 Capacity Controls

```text
API Gateway:
- per-tenant rate limit
- max body size
- 429 with Retry-After

Application Service:
- max inflight submission
- DB pool bounded
- idempotency key
- deadline-aware validation

Profile Lookup:
- token bucket 250/min
- cache by stable key
- single-flight deduplication
- fallback to manual verification

Review Queue:
- queue depth visible
- SLA projection
- priority by deadline
- escalation

Approval Service:
- optimistic locking
- per-application transition guard
- low concurrency for state mutation

Notification:
- async queue
- retry with delay
- DLQ
- expired notification skip

Audit Trail:
- asynchronous append where allowed
- bounded writer queue
- fallback to durable local buffer only if accepted by compliance
- alert on lag
```

### 34.4 Degradation Policy

Under overload:

```text
Keep:
- application submission
- approval state transition
- audit metadata write
- officer critical actions

Degrade:
- external enrichment
- dashboard widgets
- notification fan-out
- report export
- full audit text search
```

### 34.5 Business Backpressure

If review queue grows beyond SLA:

```text
- reduce intake for non-urgent applications
- route cases to backup review team
- auto-prioritize near-SLA cases
- notify supervisors
- disable non-critical manual tasks
- publish backlog forecast
```

This is not only technical scaling. It is socio-technical capacity management.

---

## 35. Production Readiness Checklist

A microservice is not capacity-ready until it has:

```text
[ ] Explicit max inflight request limit
[ ] Explicit per-endpoint expensive operation limit
[ ] Explicit per-tenant/user rate limit
[ ] Bounded executor queues
[ ] Bounded message prefetch/poll size
[ ] Bounded DB connection pool
[ ] Total DB connection budget across replicas
[ ] Timeout and deadline propagation
[ ] Retry budget and jitter
[ ] Load shedding policy
[ ] Graceful degradation contract
[ ] Queue TTL / message freshness rule
[ ] DLQ and parking lot strategy
[ ] Consumer lag and catch-up time metrics
[ ] DB pool pending metrics
[ ] Rejection metrics
[ ] Rate limit metrics
[ ] Saturation dashboard
[ ] Stress test result
[ ] Spike test result
[ ] Dependency slowdown test result
[ ] Poison message test result
[ ] Batch throttling mechanism
[ ] Kill switch for expensive workload
[ ] Runbook for overload
[ ] Business-approved degradation behavior
```

---

## 36. Exercises

### Exercise 1 — Calculate Capacity

Given:

```text
RPS: 300
Average latency: 400ms
DB calls per request: 3
DB pool: 50
Average DB query latency: 30ms
```

Questions:

```text
1. Estimated request concurrency?
2. Estimated DB query throughput capacity?
3. Max request throughput from DB perspective?
4. What happens if DB query latency becomes 150ms?
```

---

### Exercise 2 — Design Backpressure for Report Export

Design:

```text
POST /reports/export
```

Requirements:

```text
- max date range 1 year
- large reports can take 5 minutes
- user should not wait synchronously
- DB must not impact online traffic
- duplicate export request should not create duplicate job
```

Produce:

```text
1. API contract
2. queue design
3. worker concurrency
4. DB isolation
5. retry policy
6. user-visible status
7. cancellation strategy
```

---

### Exercise 3 — Consumer Lag Runbook

You see:

```text
consumer lag: 1,000,000
arrival rate: 500 msg/s
processing rate: 700 msg/s
message freshness SLA: 30 minutes
oldest message age: 90 minutes
DLQ rate: low
```

Questions:

```text
1. Is the system recovering?
2. How long to catch up?
3. Is freshness SLA already violated?
4. Should you scale consumers?
5. What downstream capacity must be checked first?
6. Should expired messages be skipped?
```

---

### Exercise 4 — Virtual Thread Safety Review

Review this design:

```text
Java 21 service uses virtual threads.
Each request fans out to 20 downstream HTTP calls.
Service allows 1000 concurrent requests.
Each downstream has rate limit 500 rps.
```

Questions:

```text
1. What is worst-case outbound call concurrency?
2. What is worst-case outbound RPS?
3. What limiter is needed?
4. Where should deadline be enforced?
5. Is virtual thread usage safe?
```

---

## 37. Key Takeaways

1. Backpressure is about survival.
2. Queue does not remove load; it delays it.
3. Everything that can grow must be bounded.
4. Slow dependency increases concurrency through Little's Law.
5. Retry without budget creates amplification.
6. Autoscaling is not a substitute for flow control.
7. Virtual threads do not remove downstream capacity limits.
8. Per-tenant fairness is required in shared systems.
9. Load shedding is a feature, not a failure.
10. Business workflow also needs backpressure.
11. Capacity must be designed, configured, tested, observed, and documented.
12. A service that cannot reject work safely is not production-ready.

---

## 38. References

- Reactive Streams JVM Specification — standard for asynchronous stream processing with non-blocking backpressure: https://github.com/reactive-streams/reactive-streams-jvm
- Reactive Streams official site: https://www.reactive-streams.org/
- OpenJDK JEP 444: Virtual Threads: https://openjdk.org/jeps/444
- Oracle Java 21 Virtual Threads documentation: https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html
- Google SRE Book — Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/
- Google SRE Book — Handling Overload: https://sre.google/sre-book/handling-overload/
- BigBinary — Little's Law overview: https://www.bigbinary.com/blog/understanding-queueing-theory

---

## 39. Posisi Dalam Series

Kita sudah menyelesaikan:

```text
Part 0  — Introduction and Mental Model
Part 1  — Distributed Systems Reality
Part 2  — Service Boundary Engineering
Part 3  — Domain Modeling for Microservices
Part 4  — Microservice Architecture Styles
Part 5  — Synchronous API Communication
Part 6  — Asynchronous Messaging
Part 7  — Event-Driven Architecture
Part 8  — Transaction, Saga, and Compensation
Part 9  — Outbox, Inbox, CDC, and Reliable Publishing
Part 10 — Consistency and Distributed Invariants
Part 11 — Data Ownership and Database-per-Service
Part 12 — Query Pattern, API Composition, CQRS, and Materialized Views
Part 13 — API Gateway, Edge, BFF, and Experience Layer
Part 14 — Service Discovery, Configuration, and Runtime Topology
Part 15 — Resilience Pattern
Part 16 — Backpressure, Flow Control, and Capacity-Aware Design
```

Seri belum selesai.

Part berikutnya:

```text
Part 17 — Idempotency, Deduplication, and Exactly-Once Business Effect
```

Filename:

```text
learn-java-microservices-patterns-advanced-engineering-17-idempotency-deduplication-exactly-once-business-effect.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-15-resilience-timeout-retry-circuit-breaker-bulkhead.md">⬅️ Learn Java Microservices Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-17-idempotency-deduplication-exactly-once-business-effect.md">Learn Java Microservices Patterns Advanced Engineering ➡️</a>
</div>

# learn-http-for-web-backend-perspective-part-019.md

# Part 019 — Timeouts, Cancellation, Backpressure, and Load Shedding

> Seri: **HTTP for Web — Backend Perspective**  
> Target pembaca: **Java software engineer / backend engineer**  
> Fokus: memahami HTTP backend sebagai sistem konsumsi resource yang harus dibatasi, dibatalkan, diberi tekanan balik, dan dilindungi dari overload.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 018, kita sudah membangun fondasi besar:

- HTTP semantics.
- Request lifecycle.
- Methods dan status codes.
- Headers dan body framing.
- URI/resource modeling.
- Representation design.
- Validation/error model.
- Idempotency.
- Conditional requests.
- Caching.
- Authentication/authorization.
- Cookies/CSRF/CORS.
- Rate limiting, quotas, dan abuse control.

Part ini masuk ke area yang sering menentukan apakah backend API akan **survive di production**.

Banyak backend gagal bukan karena salah business logic, tetapi karena:

- timeout tidak konsisten,
- retry memperbesar beban,
- queue tidak dibatasi,
- thread pool habis,
- connection pool habis,
- downstream lambat,
- request terus diproses walaupun client sudah pergi,
- reactive stack dipakai tapi blocking operation tetap bocor,
- service menerima semua request sampai mati total,
- tidak ada load shedding.

Di backend production, HTTP request bukan sekadar “panggil controller”. Ia adalah **resource lease** atas CPU, memory, thread, socket, connection pool, database connection, lock, queue slot, dan downstream capacity.

Top 1% backend engineer melihat request seperti ini:

```text
A request is allowed to consume bounded resources for bounded time,
under a bounded concurrency policy,
while respecting the caller's remaining deadline,
and must stop consuming resources when its result is no longer useful.
```

---

## 1. Core Mental Model

### 1.1 HTTP Request adalah Resource Consumption Unit

Setiap request bisa mengonsumsi:

- TCP connection.
- TLS session state.
- HTTP parser memory.
- request body buffer.
- worker thread atau event-loop attention.
- application heap.
- database connection.
- transaction.
- lock.
- cache connection.
- outbound HTTP connection.
- message broker connection.
- file descriptor.
- object storage bandwidth.
- log volume.
- trace span volume.

Kesalahan umum: backend engineer hanya melihat request dari sudut pandang functional correctness.

```java
@PostMapping("/cases")
public CaseResponse create(@RequestBody CreateCaseRequest request) {
    return service.create(request);
}
```

Secara functional, ini terlihat sederhana. Secara production, banyak pertanyaan belum dijawab:

- Berapa lama request ini boleh berjalan?
- Apakah client punya deadline?
- Kalau client disconnect, apakah proses tetap lanjut?
- Kalau database lambat, apakah thread akan menunggu tanpa batas?
- Kalau downstream API timeout, apakah kita retry?
- Kalau retry terjadi, apakah operation idempotent?
- Kalau semua thread sedang menunggu DB, apakah request baru tetap diterima?
- Kalau queue penuh, status apa yang dikembalikan?
- Apakah timeout app lebih pendek dari timeout gateway?
- Apakah error 504 muncul dari gateway padahal app masih memproses?
- Apakah operasi create bisa commit setelah client sudah menerima timeout?

Part ini membangun jawaban untuk pertanyaan-pertanyaan tersebut.

---

## 2. Istilah Dasar

### 2.1 Timeout

Timeout adalah batas waktu untuk suatu fase operasi.

Contoh:

- connect timeout,
- read timeout,
- write timeout,
- request timeout,
- idle timeout,
- acquisition timeout,
- transaction timeout,
- upstream timeout,
- gateway timeout.

Timeout bukan sekadar “angka konfigurasi”. Timeout adalah **policy tentang kapan hasil operasi dianggap tidak lagi layak ditunggu**.

### 2.2 Deadline

Deadline adalah batas waktu absolut atau sisa waktu end-to-end.

Contoh:

```text
Client request started at 10:00:00.000
Overall budget: 2 seconds
Deadline: 10:00:02.000
```

Jika service A memanggil service B setelah 1.3 detik, service B tidak boleh diberi timeout 2 detik penuh. Sisa waktu tinggal sekitar 700 ms dikurangi margin.

### 2.3 Cancellation

Cancellation adalah sinyal bahwa pekerjaan sebaiknya berhenti karena:

- client disconnect,
- deadline habis,
- caller membatalkan request,
- upstream tidak lagi membutuhkan result,
- server melakukan shutdown,
- circuit breaker/load shedder menolak operasi.

Tanpa cancellation, backend bisa terus membakar resource untuk hasil yang sudah tidak akan dipakai.

### 2.4 Backpressure

Backpressure adalah mekanisme untuk mengatakan:

```text
Producer, slow down. Consumer cannot keep up.
```

Dalam HTTP backend, producer bisa berupa:

- client yang mengirim request,
- gateway yang meneruskan traffic,
- app yang membaca request body,
- app yang streaming response,
- upstream service,
- message broker,
- database cursor,
- file storage.

Consumer bisa berupa:

- application handler,
- database,
- downstream API,
- client connection,
- event loop,
- thread pool,
- network socket.

### 2.5 Load Shedding

Load shedding adalah menolak sebagian request secara sengaja agar sistem tetap hidup.

Prinsipnya:

```text
Reject some work early to preserve capacity for useful work.
```

Tanpa load shedding, sistem sering masuk ke pola:

```text
traffic spike -> queues grow -> latency grows -> timeouts grow -> retries grow -> load grows more -> collapse
```

---

## 3. Kenapa Timeout Saja Tidak Cukup

Banyak tim berpikir cukup menambahkan timeout:

```properties
client.timeout=30s
server.timeout=30s
```

Ini belum cukup.

Timeout tanpa concurrency limit hanya membuat request menumpuk sampai timeout. Selama menunggu timeout, request tetap mengonsumsi thread, memory, connection, queue, dan lock.

Timeout tanpa cancellation membuat pekerjaan tetap berjalan walaupun hasilnya tidak lagi diperlukan.

Timeout tanpa retry policy bisa membuat transient failure tidak tertangani.

Timeout dengan retry sembarangan bisa menggandakan traffic dan mempercepat outage.

Timeout tanpa idempotency bisa membuat duplicate mutation.

Timeout tanpa observability hanya terlihat sebagai “random slow request”.

Timeout harus dipasangkan dengan:

- deadline propagation,
- concurrency limit,
- queue bound,
- cancellation,
- retry budget,
- circuit breaker,
- load shedding,
- idempotency,
- observability.

---

## 4. Timeout Taxonomy

### 4.1 Connect Timeout

Connect timeout adalah batas waktu untuk membuat koneksi ke remote host.

Misalnya backend memanggil service lain:

```text
Service A -> Service B
```

Connect timeout mengontrol berapa lama A menunggu koneksi TCP/TLS ke B terbentuk.

Jika connect timeout terlalu lama:

- thread/event loop menunggu terlalu lama,
- request upstream menumpuk,
- failover lambat.

Jika terlalu pendek:

- false failure saat network jitter,
- service dianggap down padahal hanya lambat sedikit.

Rule praktis:

- Connect timeout biasanya lebih pendek dari read timeout.
- Untuk internal network, connect timeout sering berada pada ratusan milidetik sampai beberapa detik, tergantung environment.
- Untuk internet/external API, mungkin lebih longgar tetapi tetap bounded.

### 4.2 TLS Handshake Timeout

TLS handshake bisa menjadi fase tersendiri.

Risiko:

- handshake lambat,
- certificate validation delay,
- OCSP/CRL dependency,
- CPU spike karena handshake storm,
- bot membuka banyak TLS connections.

Backend yang berada di belakang reverse proxy sering tidak melihat TLS handshake langsung karena TLS termination terjadi di edge.

Namun service-to-service mTLS tetap membutuhkan handshake budget.

### 4.3 Connection Acquisition Timeout

Jika menggunakan HTTP client dengan connection pool, sebelum request dikirim client perlu mendapatkan connection dari pool.

```text
request wants outbound connection
-> wait for pool slot
-> send HTTP request
```

Connection acquisition timeout adalah batas menunggu slot pool.

Jika tidak dibatasi:

- thread menunggu pool selamanya,
- latency naik,
- caller timeout,
- app tetap sibuk menunggu.

Contoh masalah:

```text
Max outbound connections to service B = 50
Incoming concurrent requests = 500
All 500 need service B
50 jalan, 450 menunggu pool
Gateway timeout 10s
App masih menunggu pool 30s
```

Hasilnya:

- gateway mengembalikan 504,
- app masih sibuk,
- retry menambah beban,
- service A collapse walaupun service B mungkin hanya lambat.

### 4.4 Read Timeout / Response Timeout

Read timeout adalah batas waktu menunggu data dari remote peer setelah request dikirim.

Dalam HTTP client, ini sering berarti:

- menunggu response header,
- menunggu response body chunk,
- atau total response timeout, tergantung library.

Hati-hati: nama konfigurasi berbeda antar-client.

Misalnya:

- Java `HttpClient` punya `connectTimeout`, sedangkan request timeout bisa diatur pada `HttpRequest`.
- Reactor Netty punya response timeout dan channel options.
- Apache HttpClient membedakan connection request timeout, connect timeout, response timeout.
- OkHttp membedakan connect, read, write, call timeout.

Jangan menganggap semua “timeout” sama.

### 4.5 Write Timeout

Write timeout adalah batas waktu untuk mengirim request body atau response body.

Penting untuk:

- file upload,
- large JSON,
- streaming,
- slow client,
- slow upstream.

Jika client sangat lambat membaca response, server bisa tertahan menulis output. Tanpa write timeout/backpressure, server bisa menyimpan buffer besar di memory.

### 4.6 Idle Timeout

Idle timeout adalah batas waktu koneksi boleh idle tanpa aktivitas.

Ada pada:

- load balancer,
- reverse proxy,
- app server,
- client connection pool,
- database pool,
- service mesh proxy.

Mismatch idle timeout bisa menyebabkan error sporadis.

Contoh:

```text
Client pool keeps connection idle for 60s
Load balancer closes idle connection after 30s
Client reuses stale connection at 45s
Request fails with connection reset
```

Solusi:

- pastikan client idle timeout lebih pendek dari server/LB idle timeout,
- enable stale connection validation jika tersedia,
- configure keep-alive secara konsisten.

### 4.7 Request Timeout di Server

Server request timeout membatasi total durasi request masuk.

Pertanyaan penting:

- Apakah timeout dihitung sejak connection accepted atau sejak request fully read?
- Apakah mencakup body upload?
- Apakah mencakup controller execution?
- Apakah framework membatalkan pekerjaan atau hanya response timeout?
- Apakah thread dilepas?

Di Servlet stack, request yang sedang blocking biasanya tidak otomatis berhenti kecuali operasi blocking-nya mendukung timeout/cancellation.

Di reactive stack, cancellation signal bisa lebih natural, tetapi blocking operation tetap tidak magically cancellable.

### 4.8 Gateway / Proxy Timeout

Reverse proxy dan gateway biasanya punya timeout sendiri:

- connect to upstream timeout,
- upstream response header timeout,
- upstream idle/read timeout,
- request body timeout,
- response send timeout.

Contoh failure:

```text
Gateway timeout: 10s
Application DB query timeout: 30s
```

Pada detik ke-10, gateway mengembalikan 504 ke client. Tetapi app masih memproses sampai detik ke-30. Jika operation melakukan commit pada detik ke-20, client sudah melihat failure tetapi state berubah.

Ini sangat berbahaya untuk mutation.

Prinsip:

```text
Application deadline should be shorter than gateway timeout,
and downstream deadlines should be shorter than application deadline.
```

### 4.9 Database Timeout

Database timeout bisa berada pada beberapa level:

- connection acquisition timeout,
- query timeout,
- transaction timeout,
- lock wait timeout,
- statement timeout,
- socket timeout.

Jika HTTP timeout 2 detik tetapi DB query bisa berjalan 60 detik, request bisa timeout di client sementara database tetap bekerja.

Prinsip:

```text
No downstream operation should outlive the usefulness of its parent HTTP request,
unless explicitly converted into an async job.
```

### 4.10 Transaction Timeout

Transaction timeout membatasi durasi transaksi database.

Mutation HTTP yang panjang berisiko:

- memegang lock terlalu lama,
- menyebabkan lock contention,
- membuat deadlock lebih mungkin,
- memperburuk latency request lain,
- rollback besar,
- membuat timeout chain sulit diprediksi.

Idealnya:

- validasi awal sebelum transaction,
- external call jangan dilakukan di dalam transaction panjang,
- transaction kecil dan deterministik,
- gunakan outbox untuk side effect asynchronous.

---

## 5. Deadline Propagation

### 5.1 Masalah Timeout Lokal

Misalnya request masuk punya SLA 2 detik.

```text
Client -> Gateway -> Service A -> Service B -> Database
```

Jika setiap layer punya timeout 2 detik, total bisa melebihi 2 detik jauh sekali.

```text
Gateway waits 2s
Service A waits 2s for B
Service B waits 2s for DB
```

Hasilnya bukan 2 detik end-to-end, tetapi chain yang saling menunggu sampai layer luar timeout duluan.

### 5.2 Deadline sebagai Budget End-to-End

Lebih benar:

```text
Client deadline: 2000 ms
Gateway overhead: 50 ms
Service A budget: 1800 ms
Service B budget: 1200 ms
DB budget: 800 ms
Response margin: 100 ms
```

Konsepnya:

```text
remaining_time = deadline - now - safety_margin
```

Sebelum memanggil downstream, caller menghitung sisa waktu.

Jika sisa waktu tidak cukup, lebih baik fail fast daripada membuat downstream melakukan pekerjaan yang pasti terlambat.

### 5.3 Deadline Header

Beberapa organisasi menggunakan header internal seperti:

```http
X-Request-Deadline: 2026-06-19T10:15:30.123Z
X-Timeout-Ms: 1500
```

Atau mekanisme context di RPC framework.

Untuk HTTP backend internal, prinsipnya:

- jangan percaya deadline header dari public internet tanpa gateway policy,
- gateway boleh menetapkan deadline,
- service internal boleh meneruskan deadline,
- downstream harus menghormati sisa deadline,
- deadline harus masuk ke logs/traces.

### 5.4 Deadline dan Business Operation

Tidak semua operasi cocok diselesaikan synchronous.

Jika operasi butuh waktu lebih lama dari reasonable HTTP request budget, ubah menjadi async resource.

Contoh:

```http
POST /exports
Idempotency-Key: exp-123

HTTP/1.1 202 Accepted
Location: /exports/export-789
Retry-After: 5
```

Client lalu polling:

```http
GET /exports/export-789
```

Ini lebih sehat daripada:

```text
POST /exports blocks for 5 minutes
```

---

## 6. Cancellation

### 6.1 Client Disconnect

Client bisa disconnect karena:

- user menutup browser,
- mobile network hilang,
- gateway timeout,
- client-side timeout,
- retry strategy mengganti request,
- caller service crash.

Pertanyaan backend:

```text
If the client is gone, should the server keep processing?
```

Jawabannya tergantung operasi.

### 6.2 Cancellation untuk Read-Only Request

Untuk read-only query, biasanya aman dan diinginkan untuk stop.

Contoh:

```text
GET /reports/large-query
client disconnects
```

Server sebaiknya membatalkan:

- DB query,
- streaming response,
- downstream calls,
- serialization.

Jika tidak, server tetap melakukan pekerjaan sia-sia.

### 6.3 Cancellation untuk Mutation

Untuk mutation, cancellation lebih rumit.

Contoh:

```http
POST /payments
```

Jika client disconnect setelah server mulai memproses, apakah operasi dibatalkan?

Kemungkinan:

1. Belum ada side effect: boleh cancel.
2. Sudah commit local DB: tidak bisa undo begitu saja.
3. Sudah call payment provider: cancellation bisa menyebabkan inconsistency.
4. Sedang di tengah transaction: rollback mungkin bisa.
5. Sudah publish event: perlu compensating action.

Karena itu mutation harus didesain dengan:

- idempotency key,
- transaction boundary jelas,
- state machine,
- outbox,
- durable operation record,
- recoverability.

Cancellation bukan pengganti desain consistency.

### 6.4 Cancellation di Servlet Stack

Dalam traditional Servlet/Spring MVC, setiap request biasanya memakai worker thread.

Jika thread sedang blocking:

```java
String result = blockingHttpClient.call();
```

Membatalkan request tidak selalu menghentikan blocking call secara otomatis.

Agar cancellation efektif, perlu:

- timeout di blocking client,
- interrupt-aware operation jika memungkinkan,
- database query timeout,
- transaction timeout,
- async servlet support untuk long-running operation,
- explicit cancellation token jika logic sendiri.

### 6.5 Cancellation di WebFlux/Reactor

Reactive chain bisa menerima cancellation signal.

Contoh konseptual:

```java
return service.streamCases()
    .doOnCancel(() -> log.info("client cancelled stream"));
```

Tetapi jika di dalamnya ada blocking call:

```java
return Mono.fromCallable(() -> jdbcTemplate.queryForObject(...));
```

Cancellation tidak otomatis menghentikan query jika query sudah berjalan dan driver tidak menerima cancellation.

Reactive cancellation efektif hanya jika resource dan library di bawahnya mendukung cancellation/non-blocking behavior.

### 6.6 Jangan Confuse Cancellation dengan Timeout

Timeout adalah trigger. Cancellation adalah tindakan.

```text
timeout occurred -> cancel work -> release resources -> return/record failure
```

Tanpa cancellation, timeout hanya berarti caller berhenti menunggu, tapi worker tetap bekerja.

---

## 7. Backpressure

### 7.1 Backpressure dalam Synchronous Stack

Dalam Spring MVC/Servlet, backpressure sering muncul sebagai bounded resource:

- max threads,
- accept queue,
- request queue,
- connection pool size,
- DB pool size,
- bounded executor queue,
- rate limiter,
- semaphore/bulkhead.

Contoh:

```text
Tomcat max threads = 200
DB pool = 30
Every request needs DB
```

Jika 200 request masuk dan semua menunggu DB, 170 thread bisa idle menunggu pool. Request baru tidak punya worker. Health check bisa gagal. Service dianggap down.

Backpressure yang lebih baik:

```text
If DB pool is saturated, reject or shed early instead of letting all request threads wait.
```

### 7.2 Backpressure dalam Reactive Stack

Reactive Streams memiliki konsep demand:

```text
subscriber requests N items
publisher emits at most N items
```

Ini berguna untuk streaming response dan pipeline non-blocking.

Namun reactive stack tidak menghilangkan kebutuhan limit:

- max concurrent request,
- max in-flight downstream call,
- max memory buffer,
- max connection pool,
- timeout,
- rate limit,
- circuit breaker.

Jika reactive service menerima data dari source yang tidak menghormati backpressure, tetap bisa overload.

### 7.3 Backpressure pada Request Body

Untuk upload besar:

```text
client sends large body -> server reads -> app processes -> storage writes
```

Jika app membaca lebih cepat dari storage, memory buffer bisa tumbuh.

Jika app tidak membaca, TCP flow control bisa memperlambat client.

Framework/proxy bisa juga melakukan buffering, yang bisa menyembunyikan backpressure dari app tetapi memindahkan masalah ke proxy disk/memory.

### 7.4 Backpressure pada Response Body

Untuk streaming response:

```text
DB cursor -> JSON serialization -> network socket -> slow client
```

Jika client lambat membaca, server harus:

- memperlambat producer,
- buffer dengan batas,
- cancel stream,
- timeout,
- close connection.

Jangan unlimited buffer response untuk slow clients.

### 7.5 Backpressure vs Rate Limiting

Rate limiting mengatur laju request dari caller.

Backpressure mengatur aliran kerja berdasarkan kapasitas consumer.

Rate limiting biasanya policy eksternal:

```text
Tenant A max 100 req/min
```

Backpressure biasanya sinyal kapasitas internal:

```text
DB pool saturated, stop accepting DB-heavy requests
```

Keduanya saling melengkapi.

---

## 8. Load Shedding

### 8.1 Mengapa Perlu Menolak Request

Sistem yang menerima semua request saat overload biasanya mati lebih buruk.

Tanpa load shedding:

```text
Queue grows
Latency grows
Timeouts increase
Clients retry
Traffic grows
CPU burns on doomed requests
More timeouts
System collapse
```

Dengan load shedding:

```text
Overload detected
Reject low-priority/excess work early
Preserve capacity for useful/critical work
System degrades instead of collapses
```

### 8.2 Status Code untuk Load Shedding

Umumnya:

- `429 Too Many Requests` jika caller melanggar rate/quota policy.
- `503 Service Unavailable` jika service sedang overload atau temporary unavailable.
- `Retry-After` bisa membantu caller menunggu.

Contoh:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 10
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/service-overloaded",
  "title": "Service temporarily overloaded",
  "status": 503,
  "detail": "The service is currently unable to accept more requests.",
  "instance": "/requests/abc-123"
}
```

### 8.3 Reject Early

Load shedding harus terjadi sedini mungkin.

Urutan ideal:

```text
edge/CDN/gateway -> service ingress -> endpoint limiter -> domain capacity guard -> downstream guard
```

Jangan tunggu sampai:

- body besar selesai dibaca,
- DB transaction dibuka,
- downstream dipanggil,
- lock diambil,
- expensive query jalan.

### 8.4 Priority-Based Shedding

Tidak semua request sama penting.

Contoh regulatory system:

- health check: harus ringan dan survive.
- internal readiness: penting untuk orchestration.
- case submission: penting.
- evidence upload: besar, bisa dibatasi.
- report export: bisa di-shed saat overload.
- analytics dashboard: bisa degrade.
- audit log write: critical, tapi harus dirancang async/durable.

Priority model:

```text
P0: health/readiness/control plane
P1: critical write path
P2: normal read/write
P3: expensive read/report/export
P4: background/non-urgent
```

### 8.5 Brownout

Brownout adalah mematikan fitur non-essential sementara agar core service tetap jalan.

Contoh:

- disable expensive recommendations,
- skip non-critical enrichment,
- return cached stale data,
- defer report generation,
- reduce page size,
- disable search facets,
- suppress optional downstream calls.

Brownout lebih baik daripada total outage.

---

## 9. Queueing and Collapse

### 9.1 Queue Tidak Selalu Baik

Queue sering dianggap solusi overload.

```text
Traffic spike? Add queue.
```

Queue memang bisa menyerap burst kecil, tetapi queue besar bisa memperparah latency.

Jika average arrival rate lebih besar dari service rate, queue akan terus tumbuh.

```text
arrival rate > processing rate -> backlog grows without bound
```

Bounded queue penting karena unbounded queue mengubah overload menjadi memory exhaustion atau latency explosion.

### 9.2 Little's Law Intuition

Secara intuitif:

```text
concurrency ≈ throughput × latency
```

Jika throughput tetap tetapi latency naik, concurrency in-flight naik.

Contoh:

```text
100 req/s × 100 ms = 10 concurrent requests
100 req/s × 5 s = 500 concurrent requests
```

Saat downstream melambat dari 100 ms ke 5 s, jumlah request in-flight melonjak 50x, walaupun traffic rate sama.

Ini alasan latency spike bisa menyebabkan resource exhaustion.

### 9.3 Tail Latency dan Retry Storm

Jika p95/p99 latency naik, caller timeout dan retry.

```text
Original traffic: 100 req/s
10% timeout and retry twice
Effective traffic can jump sharply
```

Retry yang tidak dibatasi bisa mengubah partial degradation menjadi outage.

Karena itu retry harus:

- hanya untuk error transient,
- idempotency-aware,
- punya max attempt,
- punya backoff + jitter,
- menghormati deadline,
- punya retry budget.

---

## 10. Bulkhead Pattern

Bulkhead memisahkan resource agar satu failure domain tidak menenggelamkan semua sistem.

### 10.1 Problem tanpa Bulkhead

```text
All endpoints share same thread pool and DB pool.
Report export becomes slow.
All worker threads blocked.
Case submission cannot proceed.
Health check fails.
Service restarted.
```

### 10.2 Resource Partitioning

Bulkhead bisa diterapkan pada:

- endpoint group,
- tenant,
- downstream dependency,
- operation type,
- priority level,
- thread pool,
- connection pool,
- semaphore,
- queue,
- executor.

Contoh:

```text
Search endpoint max concurrent = 20
Export endpoint max concurrent = 5
Case write endpoint max concurrent = 50
Admin batch endpoint max concurrent = 2
```

### 10.3 Semaphore Bulkhead

Untuk synchronous Java service:

```java
if (!semaphore.tryAcquire()) {
    throw new ServiceUnavailableException("Too many concurrent exports");
}
try {
    return exportService.runExport(request);
} finally {
    semaphore.release();
}
```

Ini sederhana dan efektif.

Jangan biarkan expensive operation berjalan unlimited.

### 10.4 Thread Pool Bulkhead

Dedicated executor bisa memisahkan work type.

Namun hati-hati:

- terlalu banyak thread pool memperumit tuning,
- queue harus bounded,
- rejection policy harus jelas,
- context propagation harus benar,
- metrics per pool wajib.

---

## 11. Circuit Breaker vs Load Shedding

Circuit breaker melindungi caller dari dependency yang sedang gagal.

Load shedding melindungi service dari overload.

Keduanya berbeda.

### 11.1 Circuit Breaker

Circuit breaker biasanya punya state:

- closed: request jalan normal,
- open: request langsung fail fast,
- half-open: coba beberapa request untuk recovery.

Dipakai untuk downstream:

```text
Service A calls Service B
B failing/slow
A opens circuit to B
A fails fast or degrades
```

### 11.2 Load Shedding

Load shedding melihat kapasitas service sendiri:

```text
Service A CPU/thread/queue saturated
A rejects some incoming requests
```

### 11.3 Keduanya Harus Menghormati HTTP Semantics

Jika downstream unavailable:

- response bisa `503` jika service tidak bisa memenuhi request karena dependency critical,
- response bisa degraded `200` jika fallback valid dan explicitly part of contract,
- response bisa `202` jika work diterima untuk async retry,
- response tidak boleh diam-diam sukses jika data incomplete tapi contract menyatakan lengkap.

---

## 12. HTTP Status and Error Mapping

### 12.1 Timeout dari Perspektif Server

Jika server menunggu downstream dan gagal karena timeout:

- `504 Gateway Timeout` biasanya cocok jika service bertindak sebagai gateway/proxy terhadap upstream.
- `503 Service Unavailable` cocok jika dependency internal unavailable dan service tidak bisa memproses.
- `500` terlalu generik jika timeout dependency sudah bisa diklasifikasikan.

Dalam microservice API, `504` bisa digunakan oleh gateway. App service sering memilih `503` dengan problem type yang jelas.

### 12.2 Timeout dari Perspektif Gateway

Gateway bisa mengembalikan:

- `502 Bad Gateway`: upstream response invalid/error.
- `503 Service Unavailable`: upstream unavailable/no healthy backend/overload.
- `504 Gateway Timeout`: upstream tidak merespons tepat waktu.

Jangan hanya melihat status code. Lihat source-nya:

```text
Was 504 generated by gateway, app, service mesh, or downstream client wrapper?
```

### 12.3 Client Timeout Tidak Selalu Terlihat sebagai Response

Jika client timeout duluan, server mungkin tidak bisa mengirim response.

Di logs bisa terlihat sebagai:

- broken pipe,
- client aborted connection,
- connection reset by peer,
- cancelled stream,
- write failure.

Jangan masukkan semua ini sebagai 500 application bug tanpa klasifikasi.

### 12.4 Problem Details untuk Overload

Gunakan error shape konsisten.

```json
{
  "type": "https://api.example.com/problems/dependency-timeout",
  "title": "Dependency timed out",
  "status": 503,
  "detail": "The request could not be completed because a required dependency did not respond in time.",
  "instance": "/requests/01J...",
  "dependency": "case-search",
  "retryable": true
}
```

Hati-hati: jangan bocorkan nama dependency internal ke public API jika sensitif.

---

## 13. Java/Spring MVC Implementation Patterns

### 13.1 Set Timeout di Semua Outbound Client

Contoh Java `HttpClient` konseptual:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofMillis(300))
    .build();

HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(Duration.ofMillis(800))
    .GET()
    .build();
```

Jangan biarkan default timeout library tidak diketahui.

### 13.2 RestClient / RestTemplate / Apache Client

Untuk blocking HTTP client:

- set connect timeout,
- set response/read timeout,
- set connection request/acquisition timeout,
- set max connections,
- set max connections per route,
- set idle eviction,
- set retry policy,
- instrument metrics.

Checklist outbound client:

```text
[ ] connect timeout
[ ] response timeout
[ ] pool acquisition timeout
[ ] max total connections
[ ] max per-host connections
[ ] idle timeout lower than LB idle timeout
[ ] retry only idempotent/safe operations unless idempotency key exists
[ ] deadline-aware timeout
[ ] circuit breaker / bulkhead where needed
```

### 13.3 Controller-Level Timeout Bukan Cukup

Spring MVC controller method yang blocking tidak otomatis berhenti hanya karena outer timeout.

Lebih penting:

- HTTP client timeout,
- DB query timeout,
- transaction timeout,
- executor timeout,
- bounded queues,
- bulkhead.

### 13.4 Bounded Executor

Jika memakai `@Async` atau executor manual:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10,
    50,
    60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(200),
    new ThreadPoolExecutor.AbortPolicy()
);
```

Jangan gunakan unbounded queue sembarangan.

Masalah umum:

```java
Executors.newFixedThreadPool(50)
```

Ini memakai unbounded queue secara default. Saat overload, memory bisa tumbuh dan latency meledak.

### 13.5 Servlet Async

Servlet async bisa melepas request thread saat menunggu operasi asynchronous.

Namun:

- work tetap harus punya timeout,
- executor tetap harus bounded,
- cancellation tetap harus ditangani,
- complexity meningkat.

Async servlet bukan lisensi untuk long-running request tak terbatas.

### 13.6 Tomcat/Servlet Container Tuning

Parameter yang biasanya relevan:

- max threads,
- accept count,
- max connections,
- connection timeout,
- keep alive timeout,
- max keep alive requests,
- max header size,
- max swallow size,
- request body limit via app/proxy.

Tuning harus berbasis workload dan metrics, bukan copy-paste.

Pertanyaan desain:

```text
If all threads are busy, where does backpressure happen?
At TCP accept queue?
At Tomcat executor?
At gateway?
At client timeout?
```

---

## 14. WebFlux/Reactor Netty Patterns

### 14.1 Non-Blocking Bukan Berarti Unlimited

WebFlux bisa menangani banyak concurrent connection dengan sedikit thread, tetapi tetap butuh limit:

- max connections,
- pending acquire timeout,
- response timeout,
- memory buffer limit,
- operator concurrency,
- rate limit,
- bulkhead.

### 14.2 Jangan Blocking Event Loop

Anti-pattern:

```java
@GetMapping("/cases/{id}")
public Mono<CaseResponse> get(@PathVariable String id) {
    return Mono.just(jdbcTemplate.queryForObject(...));
}
```

Ini menjalankan blocking call sebelum Mono dibuat atau di event loop.

Jika harus blocking, isolasi:

```java
return Mono.fromCallable(() -> jdbcTemplate.queryForObject(...))
    .subscribeOn(Schedulers.boundedElastic())
    .timeout(Duration.ofMillis(500));
```

Namun ini tetap bukan performa ideal. Blocking dependency dalam reactive stack harus diperlakukan sebagai migration compromise.

### 14.3 WebClient Timeout

Dengan Reactor Netty, timeout bisa dikonfigurasi pada HttpClient/connection provider.

Konsep yang perlu ada:

- connect timeout,
- response timeout,
- pending acquire timeout,
- max connections,
- read/write timeout jika perlu,
- deadline-aware override per request.

### 14.4 Cancellation Signal

Reactive pipeline bisa mendeteksi cancellation:

```java
return repository.findStream(...)
    .doOnCancel(() -> log.info("stream cancelled"));
```

Gunakan ini untuk:

- menutup cursor,
- membatalkan upstream subscription,
- membersihkan resource,
- mengurangi noise log.

### 14.5 Backpressure dan Buffer Limit

Jangan gunakan operator buffer tanpa batas:

```java
flux.collectList()
```

Jika hasil bisa besar, `collectList()` mengumpulkan semua data di memory.

Untuk response besar, pertimbangkan:

- pagination,
- streaming NDJSON,
- SSE,
- async export job,
- bounded buffer.

---

## 15. Database and Persistence Considerations

### 15.1 Connection Pool Saturation

DB pool adalah bottleneck umum.

Jika pool size 30 dan request concurrency 300, tidak semua request boleh menunggu DB.

Terapkan:

- pool acquisition timeout pendek,
- metrics pool active/idle/pending,
- endpoint concurrency limit,
- query timeout,
- paging limit,
- read replica jika sesuai,
- expensive query guard.

### 15.2 Query Timeout

Query timeout harus lebih pendek dari request deadline.

```text
HTTP deadline remaining: 800 ms
DB query timeout: 600 ms
response margin: 100 ms
```

Jika query tidak bisa selesai dalam budget, lebih baik fail fast atau pindahkan ke async job.

### 15.3 Lock Wait Timeout

Mutation bisa menunggu lock.

Jika lock wait terlalu panjang:

- request timeout,
- transaction menumpuk,
- deadlock meningkat,
- user retry,
- contention bertambah.

Untuk workflow system, sering lebih baik mengembalikan conflict daripada menunggu terlalu lama.

Contoh:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/case-state-conflict",
  "title": "Case is being modified",
  "status": 409,
  "detail": "The case is currently being updated by another operation. Retry after refreshing the resource."
}
```

### 15.4 Long Transaction adalah Musuh HTTP Request

Jangan membuat HTTP request memegang transaction saat:

- upload file besar,
- call external API,
- generate PDF,
- send email,
- publish message secara blocking,
- run report query panjang.

Gunakan pola:

- validate,
- short transaction update state,
- outbox event,
- async worker,
- status resource.

---

## 16. Retry, Timeout, and Idempotency Interaction

Part 011 sudah membahas idempotency. Di sini kita lihat dari sisi timeout.

### 16.1 Timeout Ambiguity

Jika caller timeout, ia tidak tahu apakah server:

- belum menerima request,
- menerima tapi belum memproses,
- memproses lalu rollback,
- memproses dan commit,
- commit lalu gagal mengirim response.

Karena itu retry mutation tanpa idempotency berbahaya.

### 16.2 Retry Budget

Retry harus punya budget.

Contoh:

```text
Overall deadline: 1000 ms
Attempt 1: 300 ms
Backoff: 50 ms
Attempt 2: 300 ms
Backoff: 100 ms
Attempt 3: only if remaining budget enough
```

Jangan lakukan:

```text
3 attempts × 1000 ms each
```

Jika caller punya deadline 1000 ms, tiap attempt harus berbagi budget.

### 16.3 Jitter

Backoff tanpa jitter bisa membuat retry synchronized.

```text
1000 clients timeout at same time
all retry exactly after 1s
traffic spike repeats
```

Jitter menyebar retry.

### 16.4 Retryable vs Non-Retryable

Retryable biasanya:

- connection reset sebelum request body terkirim,
- 503 temporary unavailable,
- 504 timeout,
- 429 with Retry-After,
- transient network error.

Non-retryable biasanya:

- 400 validation error,
- 401 invalid auth,
- 403 forbidden,
- 404 stable missing resource,
- 409 unless workflow says retry after refresh,
- 422 semantic invalid request.

Mutation retry hanya aman jika:

- method idempotent by semantics, atau
- idempotency key digunakan, atau
- operation designed as idempotent command.

---

## 17. Gateway, Proxy, and Service Mesh Alignment

### 17.1 Timeout Layering

Typical chain:

```text
Client
  -> CDN
  -> WAF
  -> API Gateway
  -> Load Balancer
  -> Service Mesh Sidecar
  -> App Server
  -> Downstream Service
  -> Database
```

Setiap layer bisa punya timeout.

Jika tidak disejajarkan, behavior menjadi sulit ditebak.

### 17.2 Timeout Ordering

Prinsip ordering:

```text
outer timeout > inner timeout + response margin
```

Contoh:

```text
client timeout: 5s
gateway timeout: 4.5s
app request deadline: 4s
downstream call timeout: 1s-2s depending operation
DB query timeout: < remaining deadline
```

Tujuannya: app punya kesempatan mengembalikan error terstruktur sebelum gateway memotong connection.

### 17.3 Proxy Buffering

Proxy bisa buffer request/response.

Dampak:

- app mungkin tidak melihat slow upload karena proxy sudah buffer body,
- app mungkin tidak bisa streaming karena proxy buffer response,
- memory/disk pressure pindah ke proxy,
- timeout semantics berubah.

Untuk streaming/SSE/large upload, proxy config harus eksplisit.

### 17.4 Health Check During Overload

Jika health endpoint memakai thread pool/resource yang sama dengan endpoint berat, service bisa dianggap unhealthy saat overload lokal.

Health/readiness harus:

- ringan,
- bounded,
- tidak tergantung dependency berat kecuali memang readiness,
- punya timeout pendek,
- tidak memicu cascading restart.

---

## 18. Observability

Tanpa observability, timeout terlihat seperti kabut.

### 18.1 Metrics yang Wajib

Untuk HTTP server:

- request count by route/status/method,
- latency histogram,
- active requests,
- request duration until cancellation,
- response status distribution,
- server abort/client abort count,
- body size distribution,
- queue time jika tersedia.

Untuk thread/executor:

- active threads,
- queue size,
- rejected tasks,
- completed tasks,
- task duration,
- saturation.

Untuk HTTP client:

- outbound request count,
- latency per dependency,
- timeout count,
- connection pool active/idle/pending,
- pending acquire duration,
- retry count,
- circuit breaker state.

Untuk DB:

- pool active/idle/pending,
- connection acquire time,
- query latency,
- lock wait,
- timeout count,
- transaction duration.

### 18.2 Log Fields

Setiap timeout/cancellation log sebaiknya punya:

```text
request_id
trace_id
method
route_template
status
elapsed_ms
deadline_ms
remaining_budget_ms
timeout_type
dependency
operation
retry_attempt
client_aborted
shed_reason
concurrency_limit_name
```

Jangan log body sensitif.

### 18.3 Trace Modeling

Trace harus menunjukkan:

```text
HTTP server span
  -> validation
  -> authz
  -> DB query
  -> outbound HTTP call
  -> serialization
```

Timeout harus terlihat di span dependency, bukan hanya di root.

Jika root span timeout tapi child span masih berjalan setelah root selesai, itu sinyal cancellation/deadline tidak dipropagasikan.

### 18.4 Distinguish These Cases

Jangan gabungkan semuanya sebagai “timeout”:

- connection timeout,
- pool acquisition timeout,
- response header timeout,
- read body timeout,
- write timeout,
- gateway timeout,
- DB query timeout,
- lock wait timeout,
- client aborted,
- server request timeout,
- circuit breaker open,
- bulkhead full,
- rate limited,
- queue rejected.

Klasifikasi ini penting untuk diagnosis.

---

## 19. Security and Abuse Angle

Timeout/backpressure juga security control.

### 19.1 Slowloris

Attacker membuka koneksi dan mengirim request sangat lambat untuk menahan connection/thread.

Mitigasi:

- header read timeout,
- request body timeout,
- max connections per IP,
- WAF/proxy limits,
- rate limiting,
- minimum data rate jika tersedia.

### 19.2 Large Body DoS

Attacker mengirim body besar atau compressed bomb.

Mitigasi:

- max body size,
- decompressed size limit,
- streaming parser,
- early rejection by Content-Length,
- upload endpoint isolation,
- quota.

### 19.3 Expensive Query DoS

Attacker memanggil endpoint legal tapi mahal.

Mitigasi:

- max page size,
- query complexity limit,
- index-aware filtering,
- timeout,
- tenant quota,
- async export,
- cached aggregate.

### 19.4 Retry Abuse

Caller bisa memperparah overload dengan retry agresif.

Mitigasi:

- 429/503 with Retry-After,
- per-client rate limit,
- idempotency key policy,
- server-side duplicate suppression,
- client SDK guidelines,
- circuit breaker.

---

## 20. Design Patterns by Operation Type

### 20.1 Simple Read

Example:

```http
GET /cases/{caseId}
```

Policy:

- short timeout,
- cancellable,
- cache/ETag if allowed,
- no retry needed from server side,
- client retry safe,
- DB query timeout,
- authz early.

### 20.2 Search/List

Example:

```http
GET /cases?status=OPEN&page=1&size=50
```

Policy:

- max page size,
- query complexity limit,
- DB timeout,
- pagination required,
- cancellation important,
- maybe rate limit per tenant,
- expensive filters guarded.

### 20.3 Mutation

Example:

```http
POST /cases/{caseId}/assignments
Idempotency-Key: ...
```

Policy:

- idempotency key,
- short transaction,
- no external call inside transaction if avoidable,
- deadline-aware downstream calls,
- retry only with idempotency,
- return 202 if long-running,
- audit result.

### 20.4 File Upload

Example:

```http
POST /cases/{caseId}/evidence
Content-Type: multipart/form-data
```

Policy:

- body size limit,
- upload timeout,
- streaming to object storage,
- virus scan async,
- DB metadata transaction short,
- per-case/per-tenant quota,
- cancellation handling,
- avoid holding DB transaction during body upload.

### 20.5 Report Export

Example:

```http
POST /exports/case-report
```

Policy:

- async job,
- 202 Accepted,
- status resource,
- concurrency limit,
- queue limit,
- priority lower than critical write,
- idempotency key,
- expiry for generated file.

### 20.6 Streaming Feed

Example:

```http
GET /cases/{caseId}/events/stream
Accept: text/event-stream
```

Policy:

- long idle timeout alignment,
- heartbeat,
- proxy buffering disabled,
- client disconnect detection,
- max stream duration,
- authz revalidation strategy if long-lived,
- backpressure-aware producer.

---

## 21. Case Study: Regulatory Enforcement Platform

### 21.1 Scenario

System memiliki operasi:

- submit complaint,
- create enforcement case,
- assign investigator,
- upload evidence,
- run risk scoring,
- request legal review,
- generate decision package,
- publish notice,
- export audit bundle.

### 21.2 Bad Design

```text
POST /cases/{id}/finalize
```

Handler melakukan:

1. validate case,
2. call identity service,
3. call evidence service,
4. call risk scoring,
5. generate PDF,
6. write DB,
7. send email,
8. publish event,
9. return response.

Semua synchronous dalam satu HTTP request dengan timeout 60 detik.

Risiko:

- client timeout,
- duplicate finalize,
- partial side effect,
- DB transaction panjang,
- PDF generation bottleneck,
- email provider down membuat finalize gagal,
- retry storm,
- audit ambiguity.

### 21.3 Better Design

```http
POST /cases/{id}/finalization-requests
Idempotency-Key: fin-case-123-v7
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /cases/{id}/finalization-requests/req-789
Retry-After: 5
```

Server melakukan transaction pendek:

1. check authorization,
2. check case version/precondition,
3. create finalization request resource,
4. persist state `PENDING`,
5. write outbox event,
6. return 202.

Worker async:

1. consumes outbox,
2. performs risk scoring with timeout,
3. generates PDF with job timeout,
4. records step status,
5. publishes event,
6. updates finalization request state.

Client:

```http
GET /cases/{id}/finalization-requests/req-789
```

Benefits:

- HTTP request short,
- operation durable,
- retry safe via idempotency key,
- each step has timeout,
- partial progress auditable,
- failures recoverable,
- no long DB transaction,
- load can be controlled by worker concurrency.

---

## 22. Production Checklist

### 22.1 Inbound HTTP

```text
[ ] Gateway timeout known and documented
[ ] App request timeout shorter than gateway timeout
[ ] Max header size configured
[ ] Max body size configured
[ ] Header read timeout configured
[ ] Request body timeout configured
[ ] Slow client protection exists
[ ] Max connections configured
[ ] Worker thread pool sized and monitored
[ ] Accept queue understood
[ ] Client abort classified separately
```

### 22.2 Outbound HTTP

```text
[ ] Connect timeout
[ ] TLS handshake timeout if applicable
[ ] Pool acquisition timeout
[ ] Response timeout
[ ] Read/write timeout where applicable
[ ] Max total connections
[ ] Max per-host connections
[ ] Idle timeout alignment
[ ] Retry policy documented
[ ] Retry respects idempotency
[ ] Retry respects deadline
[ ] Circuit breaker for critical dependencies
[ ] Bulkhead for expensive dependencies
[ ] Metrics per dependency
```

### 22.3 Database

```text
[ ] Pool acquisition timeout
[ ] Pool metrics
[ ] Query timeout
[ ] Transaction timeout
[ ] Lock wait timeout
[ ] Expensive query guard
[ ] Pagination enforced
[ ] Long jobs moved async
[ ] No external call inside long transaction
```

### 22.4 Backpressure and Load Shedding

```text
[ ] Bounded queues
[ ] Rejection policy defined
[ ] Endpoint concurrency limits for expensive operations
[ ] Tenant fairness controls
[ ] Priority-based shedding
[ ] 429 vs 503 distinction documented
[ ] Retry-After used where meaningful
[ ] Brownout strategy for optional features
[ ] Health checks resilient under overload
```

### 22.5 Observability

```text
[ ] Timeout type is classified
[ ] Cancellation/client abort tracked
[ ] Active request metrics
[ ] Queue depth metrics
[ ] Executor saturation metrics
[ ] Connection pool metrics
[ ] DB pool metrics
[ ] Dependency latency histograms
[ ] Retry attempt metrics
[ ] Circuit breaker state metrics
[ ] Shed/rejected request metrics
[ ] Trace spans include dependency time
```

---

## 23. Common Anti-Patterns

### Anti-Pattern 1: One Global 30s Timeout

Problem:

```text
Everything has 30 seconds.
```

Why bad:

- no deadline propagation,
- gateway may timeout first,
- slow operations consume resources too long,
- retry multiplies load.

Better:

- per-operation budget,
- end-to-end deadline,
- shorter downstream timeouts,
- async for long work.

### Anti-Pattern 2: Infinite Queue

Problem:

```java
Executors.newFixedThreadPool(100)
```

with unbounded queue.

Why bad:

- overload becomes latency explosion,
- memory grows,
- request becomes stale before execution,
- shutdown slow.

Better:

- bounded queue,
- rejection policy,
- load shedding.

### Anti-Pattern 3: Retry Everything

Problem:

```text
retry on any exception
maxAttempts=5
```

Why bad:

- retries non-idempotent mutation,
- amplifies outage,
- violates deadline,
- duplicate side effects.

Better:

- retry only classified transient failures,
- idempotency-aware,
- backoff+jitter,
- retry budget.

### Anti-Pattern 4: Gateway Timeout Shorter than App Work

Problem:

```text
gateway timeout = 10s
app mutation can run 60s
```

Why bad:

- client sees failure,
- app may commit later,
- retry creates duplicate,
- audit confusion.

Better:

- app deadline shorter than gateway,
- async job for long mutation,
- idempotency key.

### Anti-Pattern 5: Reactive Stack with Blocking Calls Everywhere

Problem:

```text
Use WebFlux but call JDBC/blocking SDK on event loop.
```

Why bad:

- event loop blocked,
- latency spikes,
- concurrency collapses,
- hard to debug.

Better:

- use non-blocking drivers where possible,
- isolate blocking calls,
- choose Spring MVC if workload is blocking.

### Anti-Pattern 6: No Client Disconnect Handling for Streams

Problem:

```text
Client disconnects but server keeps generating stream/export.
```

Why bad:

- wasted CPU/DB/network,
- resource leak,
- incident under slow clients.

Better:

- detect cancellation,
- close cursor,
- stop producer,
- log client abort separately.

---

## 24. Decision Framework

When designing an endpoint, ask:

```text
1. What is the expected p50/p95/p99 duration?
2. What is the maximum useful duration for caller?
3. Is the operation read-only, mutation, or long-running process?
4. Can the result be cancelled safely?
5. Does it call downstream services?
6. Does it open a DB transaction?
7. Does it hold locks?
8. Does it process large body/response?
9. What concurrency is safe?
10. What queue is safe?
11. What happens if dependency is slow?
12. What happens if client disconnects?
13. What status code should overload return?
14. Is retry safe?
15. How is timeout/cancellation observed?
```

Map answer to design:

| Operation Type | HTTP Pattern | Timeout Strategy | Cancellation | Load Control |
|---|---|---|---|---|
| Simple read | `GET` | short | yes | normal rate limit |
| Expensive search | `GET` with pagination | bounded | yes | query complexity + concurrency limit |
| Small mutation | `POST/PUT/PATCH` | short transaction | before commit only | idempotency + concurrency guard |
| Long mutation | `POST` -> `202` job | short accept request, async worker timeout | job cancellation explicit | queue + worker bulkhead |
| Upload | multipart/presigned URL | body timeout | cleanup partial | size/quota/concurrency |
| Streaming | SSE/NDJSON | idle/max duration | yes | connection cap + heartbeat |
| Report export | async resource | job timeout | explicit cancel endpoint | low-priority queue |

---

## 25. Exercises

### Exercise 1 — Timeout Budget

Design timeout budget for:

```text
Client -> API Gateway -> Case Service -> Identity Service -> Database
```

Assume user-facing SLA is 2 seconds.

Define:

- gateway timeout,
- app request deadline,
- identity service timeout,
- DB query timeout,
- response margin,
- retry policy.

### Exercise 2 — Duplicate Mutation after Timeout

Endpoint:

```http
POST /cases/{caseId}/submit
```

Client times out after 3 seconds. Server commits at 4 seconds.

Design how to make retry safe.

Include:

- idempotency key,
- operation record,
- response replay,
- status code,
- audit log.

### Exercise 3 — Slow Report Export

Endpoint:

```http
GET /reports/monthly-enforcement-summary
```

Sometimes takes 90 seconds.

Redesign it as production-safe HTTP API.

Include:

- async job resource,
- `202 Accepted`,
- `Location`,
- polling,
- timeout,
- cancellation,
- quota.

### Exercise 4 — Thread Pool Collapse

Given:

```text
Tomcat max threads = 200
DB pool size = 20
Endpoint /search can take 5 seconds
Traffic spike = 100 req/s
```

Explain failure mode and propose controls.

### Exercise 5 — Streaming Cancellation

Design an SSE endpoint:

```http
GET /cases/{id}/events/stream
```

Define:

- heartbeat,
- max stream duration,
- client disconnect handling,
- authorization re-check,
- proxy timeout alignment,
- backpressure behavior.

---

## 26. Key Takeaways

1. HTTP backend request is a bounded resource consumption unit.
2. Timeout is not enough without cancellation, concurrency limit, queue bound, and observability.
3. Deadline propagation is stronger than local timeout configuration.
4. Gateway, app, downstream, and database timeouts must be aligned.
5. Client disconnect should stop useless read/stream work where safe.
6. Mutation cancellation requires idempotency and durable operation design.
7. Backpressure prevents producers from overwhelming consumers.
8. Load shedding intentionally rejects work to preserve system survival.
9. Retry without idempotency and budget can amplify outages.
10. Long-running work should usually become async resource with `202 Accepted`.
11. Queueing is useful only when bounded and monitored.
12. Bulkheads isolate expensive or failing work.
13. Reactive stack helps only if blocking work is controlled.
14. Observability must classify timeout type, not just count generic failures.
15. Production-grade HTTP API design is capacity design, not just controller design.

---

## 27. How This Prepares the Next Part

Part 020 akan membahas:

```text
File Upload, Download, Multipart, and Large Payloads
```

Part 019 ini penting karena large payload adalah salah satu tempat timeout/backpressure paling sering gagal.

Saat masuk Part 020, kita akan memakai mental model berikut:

- body upload adalah long-lived resource consumption,
- DB transaction tidak boleh menunggu upload selesai,
- body size dan streaming harus dibatasi,
- slow client harus dikontrol,
- download besar perlu range, async export, atau object storage offload,
- cancellation harus membersihkan partial state.

---

## 28. Status Seri

Kita sudah menyelesaikan:

```text
Part 000 — Orientation: HTTP Backend Mental Model
Part 001 — HTTP Semantics from Server Point of View
Part 002 — Request Lifecycle: From Socket to Controller
Part 003 — Methods Deep Dive for Backend Correctness
Part 004 — Status Codes as Backend State Contracts
Part 005 — Headers as Backend Control Plane
Part 006 — Request Body, Response Body, and Message Framing
Part 007 — URI, Routing, and Resource Modeling
Part 008 — Content Negotiation and Representation Design
Part 009 — Validation, Parsing, and Defensive Boundaries
Part 010 — Error Response Design and Problem Details
Part 011 — Idempotency, Retries, and Exactly-Once Illusions
Part 012 — Conditional Requests and Optimistic Concurrency
Part 013 — Caching for Backend Engineers
Part 014 — Authentication over HTTP
Part 015 — Authorization and Resource-Level Security
Part 016 — Cookies, Sessions, CSRF, and Browser-Coupled Backend
Part 017 — CORS from Backend Enforcement Perspective
Part 018 — Rate Limiting, Quotas, and Abuse Control
Part 019 — Timeouts, Cancellation, Backpressure, and Load Shedding
```

Seri belum selesai. Bagian berikutnya:

```text
learn-http-for-web-backend-perspective-part-020.md
```

Dengan judul:

```text
File Upload, Download, Multipart, and Large Payloads
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-018.md">⬅️ Part 018 — Rate Limiting, Quotas, and Abuse Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-020.md">Part 020 — File Upload, Download, Multipart, and Large Payloads ➡️</a>
</div>

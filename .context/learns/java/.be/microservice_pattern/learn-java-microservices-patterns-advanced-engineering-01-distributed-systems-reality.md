# Part 1 — Distributed Systems Reality Before Microservices

**Series:** `learn-java-microservices-patterns-advanced-engineering`  
**File:** `learn-java-microservices-patterns-advanced-engineering-01-distributed-systems-reality.md`  
**Target:** Java 8 hingga Java 25  
**Level:** Advanced / Principal Engineer Track  
**Status:** Part 1 dari 35

---

## 0. Tujuan Part Ini

Sebelum membahas service boundary, API gateway, saga, event-driven architecture, circuit breaker, service mesh, CQRS, atau deployment pattern, kita harus memahami realitas paling dasar:

> Microservices adalah distributed system. Distributed system bukan sekadar aplikasi yang dipisah menjadi banyak repository dan banyak container. Distributed system adalah sistem di mana kebenaran, waktu, state, failure, ownership, dan observability tersebar di banyak proses yang tidak bisa dipercaya sepenuhnya.

Part ini membangun mental model bahwa microservices bukan primarily tentang framework, bukan tentang Spring Boot, bukan tentang Kafka, bukan tentang Kubernetes, dan bukan tentang REST/gRPC. Semua itu hanya alat. Masalah aslinya adalah:

1. network bisa gagal sebagian,
2. latency selalu berubah,
3. dependency bisa lambat tanpa mati,
4. retry bisa memperbesar outage,
5. timeout yang salah bisa membuat sistem self-destruct,
6. queue bisa menyerap beban sekaligus menyembunyikan kegagalan,
7. observability harus didesain sejak awal,
8. data dan keputusan tersebar,
9. user journey melewati banyak komponen,
10. failure harus dianggap kondisi normal, bukan exception langka.

Setelah menyelesaikan part ini, kamu harus bisa membaca desain microservices dan langsung bertanya:

- Di mana partial failure bisa terjadi?
- Siapa yang menunggu siapa?
- Timeout budget-nya berapa?
- Retry-nya aman atau memperbesar masalah?
- Apa yang terjadi jika dependency lambat, bukan down?
- Apa blast radius kalau service ini overload?
- Apa yang terjadi kalau event terlambat, duplikat, atau out of order?
- Apakah sistem ini bisa degrade, atau hanya bisa fail total?
- Apakah failure dapat diobservasi, direkonstruksi, dan dipertanggungjawabkan?

---

## 1. Mengapa Distributed Systems Harus Dipahami Sebelum Microservices

Microservices sering dijual dengan narasi:

- lebih scalable,
- lebih independent,
- lebih modern,
- lebih cloud native,
- lebih mudah deploy,
- lebih cocok untuk banyak team.

Semua itu bisa benar, tetapi hanya jika organisasi dan sistemnya siap membayar biaya distribusi.

Biaya distribusi muncul karena operasi yang sebelumnya lokal menjadi remote.

Dalam monolith:

```text
OrderService.placeOrder()
  -> InventoryService.reserve()
  -> PaymentService.authorize()
  -> NotificationService.send()
```

Jika semua berada dalam satu process, panggilan method memiliki karakteristik:

- sangat cepat,
- gagal secara eksplisit melalui exception,
- berada dalam memory yang sama,
- bisa ikut transaction yang sama,
- stack trace masih utuh,
- debug relatif langsung,
- consistency lebih mudah dipahami.

Dalam microservices:

```text
Order Service
  -> HTTP/gRPC -> Inventory Service
  -> HTTP/gRPC -> Payment Service
  -> message -> Notification Service
```

Karakteristik berubah total:

- call melewati network,
- request bisa timeout,
- response bisa hilang,
- service tujuan bisa sudah memproses tapi caller tidak tahu,
- dependency bisa lambat,
- retry bisa membuat duplikasi,
- log tersebar,
- transaction lokal tidak lagi mencakup seluruh workflow,
- state akhir mungkin baru konsisten beberapa detik kemudian,
- debugging butuh correlation id, trace, metrics, event log, dan domain audit.

Perubahan ini bukan detail implementasi. Ini perubahan model kebenaran sistem.

---

## 2. Definisi Kerja: Distributed System

Untuk konteks engineering praktis, distributed system adalah:

> Sekumpulan process independen yang berkomunikasi melalui network untuk mencapai tujuan bersama, tetapi masing-masing process dapat gagal, lambat, restart, kehilangan koneksi, atau melihat state yang berbeda pada waktu yang sama.

Dalam microservices Java, process tersebut bisa berupa:

- Spring Boot service,
- Quarkus service,
- Jakarta EE application,
- batch worker,
- Kafka consumer,
- RabbitMQ worker,
- scheduled job,
- API gateway,
- BFF,
- service mesh sidecar,
- database,
- cache,
- external provider,
- identity provider,
- object storage,
- workflow engine.

Yang penting: semua komponen itu punya lifecycle dan failure mode sendiri.

Distributed system bukan hanya ketika kamu punya ratusan service. Dua service yang saling memanggil melalui HTTP sudah cukup untuk menghadirkan distributed failure.

---

## 3. Fallacies of Distributed Computing

Ada beberapa asumsi palsu klasik dalam distributed computing. Ini sering disebut *fallacies of distributed computing*. Dalam praktik microservices, hampir semua production incident besar bisa dikaitkan ke salah satu asumsi palsu ini.

### 3.1 Network Is Reliable

Asumsi salah:

> Jika service A memanggil service B, request akan sampai dan response akan kembali.

Realitas:

- packet bisa drop,
- DNS bisa gagal,
- connection bisa reset,
- load balancer bisa terminate koneksi,
- pod bisa restart saat request sedang berjalan,
- firewall/security group bisa berubah,
- NAT gateway bisa exhausted,
- TLS handshake bisa gagal,
- service mesh sidecar bisa error,
- node bisa mengalami network partition.

Konsekuensi desain:

- setiap remote call harus punya timeout,
- setiap operation yang di-retry harus idempotent atau punya deduplication,
- setiap dependency harus diasumsikan bisa unavailable,
- setiap request harus punya correlation id,
- caller harus tahu apa yang dilakukan jika response tidak datang.

### 3.2 Latency Is Zero

Asumsi salah:

> Remote call kira-kira sama seperti local method call.

Realitas:

Remote call melibatkan:

- serialization,
- socket,
- TLS,
- kernel networking,
- load balancer,
- service mesh,
- queueing,
- thread scheduling,
- GC pause,
- downstream database,
- deserialization,
- response path balik.

Satu remote call mungkin cepat. Tetapi sepuluh remote call serial dalam satu user request bisa membuat latency meledak.

Jika satu call P95 = 100 ms, bukan berarti sepuluh call tetap 100 ms. Critical path bisa menjadi:

```text
P95 total ≈ sum of serial dependency latency + queueing + retry + network variance
```

### 3.3 Bandwidth Is Infinite

Asumsi salah:

> Payload size tidak terlalu penting.

Realitas:

- JSON besar memperlambat serialization,
- network transfer mahal,
- compression memakai CPU,
- huge response membuat GC pressure,
- log payload besar meningkatkan biaya observability,
- fan-out response besar bisa menurunkan throughput.

Dalam Java, masalah ini terasa pada:

- heap pressure,
- allocation rate,
- Jackson serialization/deserialization,
- large byte arrays,
- HTTP buffer,
- Netty buffer,
- GC pause,
- off-heap direct memory.

### 3.4 Network Is Secure

Asumsi salah:

> Traffic internal aman karena berada dalam cluster/VPC.

Realitas:

- internal service bisa compromised,
- credential bisa bocor,
- misconfiguration bisa membuka route,
- pod bisa melakukan lateral movement,
- log bisa berisi token,
- service-to-service call bisa impersonate actor jika identity tidak jelas.

Konsekuensi:

- service identity harus eksplisit,
- mTLS atau equivalent trust mechanism perlu dipertimbangkan,
- token audience harus dibatasi,
- authorization tidak boleh hanya di edge jika service bisa dipanggil internal,
- audit actor harus jelas: user, system, service, atau batch.

### 3.5 Topology Does Not Change

Asumsi salah:

> IP service stabil, node stabil, dependency endpoint stabil.

Realitas cloud/Kubernetes:

- pod ephemeral,
- node autoscale,
- service endpoint berubah,
- DNS cache bisa stale,
- deployment rolling update mengubah instance,
- traffic shifting mengubah route,
- service mesh memperkenalkan dynamic routing,
- blue-green/canary membuat beberapa versi hidup bersamaan.

Desain harus menganggap topology berubah tanpa perlu redeploy semua service.

### 3.6 There Is One Administrator

Asumsi salah:

> Semua service dikendalikan satu team dengan standar, timeline, dan prioritas sama.

Realitas microservices:

- service dimiliki team berbeda,
- versi berubah berbeda waktu,
- contract bisa berubah,
- incident ownership bisa ambigu,
- dependency bisa dikelola vendor/external agency,
- release window bisa tidak sinkron.

Konsekuensi:

- contract governance wajib,
- backward compatibility wajib,
- observability lintas service wajib,
- ownership matrix wajib,
- dependency risk harus eksplisit.

### 3.7 Transport Cost Is Zero

Asumsi salah:

> Memanggil remote service tidak punya cost berarti.

Realitas:

- CPU serialization,
- memory allocation,
- connection pooling,
- TLS,
- network charge,
- proxy overhead,
- logging cost,
- tracing cost,
- retry cost,
- operational complexity.

Satu call mungkin murah. Tetapi satu call dalam hot path dengan traffic tinggi bisa mahal.

### 3.8 The Network Is Homogeneous

Asumsi salah:

> Semua service punya latency, bandwidth, runtime, security posture, dan reliability yang sama.

Realitas:

- service Java 8 dan Java 21 punya karakteristik runtime berbeda,
- service dengan blocking I/O berbeda dari reactive I/O,
- service di zone berbeda punya latency berbeda,
- external provider punya SLA berbeda,
- database primary dan replica punya behavior berbeda,
- Kafka/RabbitMQ/Redis punya failure mode berbeda.

Microservices yang baik tidak menyembunyikan perbedaan ini. Ia mendesain berdasarkan perbedaan tersebut.

---

## 4. Local Call vs Remote Call: Perbedaan Fundamental

Salah satu kesalahan terbesar engineer saat pindah dari monolith ke microservices adalah memperlakukan remote call seperti method call.

### 4.1 Local Call

```java
PaymentResult result = paymentService.authorize(command);
```

Karakteristik:

- sangat cepat,
- deterministic relatif tinggi,
- failure biasanya exception langsung,
- memory sama,
- transaction bisa sama,
- stack trace jelas,
- tidak perlu serialization,
- tidak butuh network timeout.

### 4.2 Remote Call

```java
PaymentResult result = paymentClient.authorize(command);
```

Meski syntax mirip, semantic berbeda total.

Remote call bisa menghasilkan keadaan ambigu:

| Kondisi | Apa yang caller lihat | Apa yang mungkin terjadi di callee |
|---|---:|---|
| Success | response 200 | action berhasil |
| Business failure | response 4xx/domain error | action ditolak |
| Server failure | response 5xx | action bisa gagal, bisa sebagian berhasil |
| Timeout | tidak ada response | action bisa belum diterima, sedang diproses, atau sudah berhasil |
| Connection reset | error transport | action bisa sudah diproses |
| Retry success | response dari percobaan berikutnya | action pertama mungkin juga berhasil |

Poin penting:

> Timeout bukan bukti bahwa operation gagal. Timeout hanya bukti bahwa caller berhenti menunggu.

Ini sangat penting untuk idempotency, saga, outbox, inbox, reconciliation, dan audit.

---

## 5. Partial Failure

Dalam monolith, banyak failure bersifat total terhadap satu process. Jika process mati, seluruh module di dalamnya mati.

Dalam microservices, failure sering partial:

- service A hidup,
- service B hidup tapi lambat,
- service C mati,
- database D hidup tapi replica lag,
- cache E timeout,
- Kafka broker masih hidup tapi consumer lag tinggi,
- identity provider lambat,
- API gateway sehat tapi downstream overload.

Partial failure lebih sulit karena sistem tampak “sebagian jalan”.

### 5.1 Contoh Partial Failure

```text
User submits application
  -> Application Service saves draft successfully
  -> Document Service upload succeeds
  -> Payment Service timeout
  -> Notification Service not called
```

Apa status application?

- Draft?
- Pending payment?
- Payment unknown?
- Failed?
- Requires reconciliation?

Jawaban yang buruk:

```text
Tergantung error teknis.
```

Jawaban yang baik:

```text
Domain harus punya state eksplisit untuk uncertainty, misalnya PAYMENT_AUTHORIZATION_UNKNOWN, dan sistem harus punya reconciliation flow.
```

Top 1% engineer tidak hanya bertanya “bagaimana handle exception”. Ia bertanya:

- apa semantic state setelah partial failure?
- apakah user boleh retry?
- apakah operation idempotent?
- apakah perlu background reconciliation?
- apakah audit trail cukup menjelaskan ketidakpastian?
- siapa owner recovery?

---

## 6. Slow Is Worse Than Down

Service yang mati total sering lebih mudah ditangani daripada service yang lambat.

Jika dependency down:

- health check gagal,
- circuit breaker bisa open,
- caller fail fast,
- traffic bisa dialihkan,
- alert jelas.

Jika dependency lambat:

- thread caller tertahan,
- connection pool penuh,
- request queue naik,
- memory naik,
- latency naik,
- timeout terjadi satu per satu,
- retry menambah traffic,
- upstream ikut penuh,
- akhirnya cascade.

### 6.1 Slow Dependency Cascade

```text
Payment Service latency naik dari 100 ms ke 5 detik

Order Service:
  request thread menunggu Payment
  thread pool penuh
  request baru masuk queue
  queue wait bertambah
  user retry dari browser/mobile
  gateway retry juga mungkin terjadi
  Order Service CPU naik karena serialization/retry/logging
  database connection tertahan
  service lain ikut terdampak
```

Outage tidak selalu dimulai dari crash. Banyak outage dimulai dari latency degradation.

### 6.2 Design Principle

> Jangan hanya mendesain untuk dependency yang down. Desainlah untuk dependency yang lambat, flapping, inconsistent, dan overloaded.

---

## 7. Timeout Engineering

Timeout adalah salah satu kontrol paling penting dalam distributed system.

Tanpa timeout, caller bisa menunggu terlalu lama dan menghabiskan resource.

Dengan timeout yang salah, caller bisa terlalu cepat gagal atau membuat retry storm.

### 7.1 Jenis Timeout

Dalam Java service, setidaknya ada beberapa timeout:

| Timeout | Makna |
|---|---|
| DNS timeout | waktu resolve host |
| connection timeout | waktu membangun koneksi |
| TLS handshake timeout | waktu negosiasi TLS |
| request write timeout | waktu mengirim request body |
| response/read timeout | waktu menunggu response |
| total deadline | batas total operation dari perspektif caller |
| database query timeout | batas query DB |
| transaction timeout | batas transaction |
| message processing timeout | batas consumer memproses message |
| lock timeout | batas menunggu lock |
| pool acquisition timeout | batas menunggu connection dari pool |

Kesalahan umum adalah hanya mengatur read timeout dan mengabaikan total deadline.

### 7.2 Timeout Harus Berbasis Budget

Misalnya user-facing endpoint punya target P95 1 detik.

```text
Total budget: 1000 ms

Gateway/auth overhead:        50 ms
Application validation:       50 ms
Inventory call:              150 ms
Payment call:                300 ms
Database write:              150 ms
Event publish/outbox:         50 ms
Serialization/logging/etc:    50 ms
Safety margin:               200 ms
```

Jika Payment call diberi timeout 5 detik, itu tidak masuk akal karena melebihi total budget user request.

Timeout harus turun dari caller ke callee sebagai deadline, bukan setiap layer mengarang timeout sendiri.

### 7.3 Timeout Layering Problem

```text
Browser timeout: 30s
Gateway timeout: 60s
Service A timeout to B: 45s
Service B DB timeout: 120s
```

Ini buruk. Browser sudah berhenti menunggu, tetapi backend masih bekerja. Resource tetap digunakan untuk hasil yang tidak lagi dibutuhkan.

Lebih baik:

```text
Client request budget: 2s
Gateway deadline: 2s
Service A remaining budget: 1.8s
Service B remaining budget: 1.3s
DB query timeout: 800ms
```

### 7.4 Java Consideration

Java 8 sering memakai:

- Apache HttpClient,
- OkHttp,
- RestTemplate,
- Jersey Client,
- custom executor.

Java 11+ punya `java.net.http.HttpClient`.

Java 21+ membuat blocking I/O dengan virtual threads lebih feasible, tetapi tidak menghapus kebutuhan timeout. Virtual threads mengurangi biaya thread blocking, bukan menghilangkan latency, dependency failure, atau resource saturation downstream.

Poin penting:

> Virtual thread membuat waiting lebih murah di caller, tetapi tidak membuat callee lebih cepat dan tidak membuat database/cache/message broker punya kapasitas tak terbatas.

---

## 8. Retry: Obat yang Bisa Menjadi Racun

Retry berguna untuk transient failure:

- packet loss,
- short network glitch,
- temporary load balancer issue,
- short-lived leader election,
- momentary 503,
- optimistic locking conflict tertentu.

Tetapi retry berbahaya jika:

- downstream overload,
- operation tidak idempotent,
- semua client retry bersamaan,
- retry dilakukan di banyak layer,
- retry tidak punya budget,
- retry terhadap error yang permanent,
- retry membuat user action terduplikasi.

### 8.1 Retry Amplification

Misalnya satu request melewati tiga layer:

```text
Gateway -> Service A -> Service B -> Service C
```

Jika setiap layer retry 3 kali, total call ke Service C bisa menjadi:

```text
3 x 3 x 3 = 27 attempts
```

Jika 1000 request masuk saat Service C overload, retry bisa membuat puluhan ribu attempt tambahan.

### 8.2 Retry Storm

Retry storm terjadi ketika failure kecil diperbesar oleh retry massal.

Contoh:

```text
Payment Service mulai overload
-> request timeout
-> caller retry
-> gateway retry
-> user refresh page
-> mobile app retry
-> batch job retry
-> traffic ke Payment makin besar
-> Payment makin lambat
-> timeout makin banyak
-> retry makin banyak
```

Sistem tidak sedang “menyembuhkan diri”. Sistem sedang menyerang dependency-nya sendiri.

### 8.3 Retry Policy yang Waras

Retry harus punya:

1. error classification,
2. max attempt,
3. total retry budget,
4. exponential backoff,
5. jitter,
6. idempotency guarantee,
7. observability,
8. cancellation saat deadline habis,
9. tidak dilakukan di semua layer sembarangan.

Contoh policy:

```text
Retry only for:
  - connection reset before request body sent
  - HTTP 503 with Retry-After
  - HTTP 429 with bounded backoff
  - known transient network error

Do not retry:
  - validation error
  - authorization error
  - domain rejection
  - non-idempotent command without idempotency key
  - timeout after unknown side effect unless operation is idempotent/reconcilable
```

### 8.4 Jitter

Backoff tanpa jitter bisa membuat semua caller retry pada waktu yang sama.

```text
Attempt 1 fails at t=0
All clients retry at t=100ms
All clients retry again at t=300ms
All clients retry again at t=700ms
```

Jitter menyebarkan retry agar tidak sinkron.

```text
retry_delay = random(0, base * 2^attempt)
```

Ini bukan detail kecil. Pada skala tinggi, jitter bisa membedakan antara recovery dan cascading failure.

---

## 9. Backpressure

Backpressure adalah mekanisme agar producer tidak mengirim lebih cepat daripada kemampuan consumer memproses.

Tanpa backpressure:

```text
producer rate > consumer capacity
-> queue grows
-> memory grows
-> latency grows
-> timeout grows
-> retry grows
-> system collapses
```

Backpressure bukan hanya konsep reactive programming. Ini konsep sistem.

### 9.1 Bentuk Backpressure

Backpressure bisa muncul sebagai:

- bounded queue,
- rate limit,
- semaphore limit,
- thread pool limit,
- connection pool limit,
- consumer pause,
- Kafka consumer lag handling,
- HTTP 429,
- load shedding,
- adaptive concurrency limit,
- token bucket,
- reactive streams demand signal.

### 9.2 Queue Bukan Solusi Ajaib

Queue sering dipakai untuk menyerap burst.

Itu benar, tetapi queue juga bisa menyembunyikan overload.

Jika producer mengirim 10.000 msg/s dan consumer hanya mampu 2.000 msg/s, queue akan tumbuh 8.000 msg/s.

```text
Lag growth per second = producer rate - consumer rate
```

Jika message processing punya SLA 5 menit, queue lag yang tumbuh 1 jam berarti business failure, walaupun broker masih “hijau”.

### 9.3 Little’s Law sebagai Mental Model

Little’s Law:

```text
L = λ × W
```

Dimana:

- `L` = jumlah item dalam sistem,
- `λ` = arrival rate,
- `W` = waktu rata-rata item berada dalam sistem.

Jika arrival rate naik dan processing time tetap, jumlah item yang menunggu naik.

Dalam service:

```text
concurrency ≈ throughput × latency
```

Jika service memproses 100 request/s dengan latency 200 ms:

```text
concurrency ≈ 100 × 0.2 = 20 concurrent requests
```

Jika latency naik ke 2 detik:

```text
concurrency ≈ 100 × 2 = 200 concurrent requests
```

Tanpa traffic naik pun, latency degradation bisa membuat concurrency naik 10x.

---

## 10. Tail Latency

Average latency sering menipu.

Misalnya:

```text
Average latency: 80 ms
P95 latency:     300 ms
P99 latency:     2 s
P99.9 latency:   8 s
```

User yang terkena P99 merasakan sistem lambat, walaupun average terlihat bagus.

Dalam microservices, tail latency makin penting karena satu request bisa bergantung pada banyak dependency.

### 10.1 Fan-Out Amplifies Tail Latency

Jika satu endpoint memanggil 10 downstream service paralel dan response harus menunggu semua selesai, probabilitas terkena salah satu slow call meningkat.

```text
User request completes when slowest dependency completes.
```

Jika setiap dependency punya 1% chance lambat, maka peluang minimal satu dependency lambat dalam 10 call kira-kira:

```text
1 - 0.99^10 ≈ 9.56%
```

Jadi P99 di dependency bisa menjadi pengalaman yang jauh lebih sering di aggregator.

### 10.2 Critical Path

Microservices performance harus dianalisis sebagai critical path:

```text
Request total latency = serial work + max(parallel branches) + queueing + retry + overhead
```

Tidak cukup bertanya “service mana lambat?”. Tanya juga:

- dependency mana di critical path?
- call mana bisa dihilangkan?
- call mana bisa parallel?
- data mana bisa dipindahkan ke read model?
- apakah response harus complete atau boleh partial?
- apakah dependency lambat bisa degrade?

---

## 11. Cascading Failure

Cascading failure adalah kegagalan yang menyebar dari satu komponen ke komponen lain sampai sistem yang lebih luas ikut gagal.

Penyebab umum:

- dependency lambat,
- retry storm,
- thread pool exhaustion,
- connection pool exhaustion,
- queue overload,
- database lock contention,
- cache outage,
- thundering herd,
- autoscaling terlambat,
- load balancer misrouting,
- bad deployment,
- config error,
- circuit breaker tidak ada atau salah,
- fallback terlalu mahal.

### 11.1 Contoh Cascade Synchronous

```text
Service C lambat
Service B menunggu C
Service B thread pool penuh
Service A menunggu B
Service A thread pool penuh
Gateway menunggu A
Gateway connection penuh
User retry
Traffic naik
Semua makin lambat
```

### 11.2 Contoh Cascade Asynchronous

```text
Consumer lambat memproses event
Queue lag naik
Producer tetap publish
Message TTL lewat
DLQ penuh
Reprocessor dijalankan terlalu agresif
Database downstream overload
Consumer makin lambat
Lag makin naik
```

### 11.3 Prinsip Mencegah Cascade

1. timeout pendek dan berbasis budget,
2. retry terbatas dan pakai jitter,
3. circuit breaker,
4. bulkhead,
5. bounded queue,
6. load shedding,
7. graceful degradation,
8. observability per dependency,
9. dependency isolation,
10. capacity planning,
11. chaos/resilience testing.

---

## 12. Blast Radius

Blast radius adalah luas dampak ketika satu komponen gagal.

Pertanyaan penting:

> Jika service X gagal, siapa saja yang ikut rusak, seberapa parah, dan berapa lama?

### 12.1 Blast Radius Buruk

```text
Notification Service down
-> Application submission gagal
-> Payment confirmation gagal
-> Report generation gagal
-> Admin dashboard gagal
```

Ini buruk karena service non-critical membuat workflow critical gagal.

### 12.2 Blast Radius Baik

```text
Notification Service down
-> Application submission tetap berhasil
-> Notification event masuk outbox/queue
-> User melihat status submitted
-> Admin mendapat alert bahwa notification tertunda
-> Worker retry nanti
```

Microservices yang baik tidak hanya memisahkan deployment. Ia memisahkan failure impact.

### 12.3 Blast Radius Review

Untuk setiap service, tanyakan:

- apakah service ini critical path?
- siapa upstream-nya?
- siapa downstream-nya?
- jika down, apa yang gagal?
- jika lambat, siapa yang ikut lambat?
- apakah ada fallback?
- apakah fallback aman secara domain?
- apakah failure bisa diisolasi per tenant?
- apakah failure bisa diisolasi per module?
- apakah ada kill switch?
- apakah ada degraded mode?

---

## 13. Coupling dalam Distributed Systems

Microservices bertujuan mengurangi coupling tertentu, tetapi bisa memperkenalkan coupling baru.

### 13.1 Jenis Coupling

| Coupling | Makna | Contoh |
|---|---|---|
| Temporal coupling | service harus hidup bersamaan | synchronous REST call wajib sukses |
| Availability coupling | uptime satu service menentukan service lain | checkout gagal jika recommendation service down |
| Data coupling | service bergantung pada struktur data service lain | shared table/shared DTO |
| Semantic coupling | service bergantung pada makna field/event | status `APPROVED` berubah makna |
| Deployment coupling | service harus deploy bersama | breaking API change |
| Operational coupling | incident satu service memerlukan koordinasi banyak team | unknown owner dependency |
| Transactional coupling | satu business operation butuh atomicity lintas service | distributed transaction |
| Security coupling | trust/identity ambigu antar service | token relay tanpa audience |

Top 1% engineer tidak hanya menghitung jumlah service. Ia memetakan coupling.

### 13.2 Synchronous Coupling

Synchronous call menciptakan temporal dan availability coupling.

```text
A -> B
```

A butuh B tersedia saat itu juga.

Jika B down, A mungkin gagal.

### 13.3 Asynchronous Coupling

Async mengurangi temporal coupling, tetapi tidak menghilangkan semantic coupling.

```text
A publishes CustomerApproved
B consumes CustomerApproved
```

B tidak butuh A hidup saat itu, tetapi B tetap bergantung pada makna event.

Jika event schema berubah sembarangan, B rusak.

---

## 14. Time, Ordering, and Clocks

Dalam monolith, waktu sering dianggap sederhana. Dalam distributed system, waktu sulit.

Masalah:

- clock antar node bisa berbeda,
- event bisa datang terlambat,
- event bisa datang out of order,
- timestamp producer dan consumer berbeda,
- retry membuat operation lama muncul lagi,
- batch bisa memproses data historis,
- replication lag membuat read tidak melihat write terbaru.

### 14.1 Wall Clock vs Logical Order

Jangan selalu menganggap timestamp menentukan urutan kebenaran.

Contoh:

```text
10:00:01 Service A publishes ApplicationSubmitted
09:59:59 Service B publishes DocumentUploaded
```

Karena clock skew, timestamp bisa membuat urutan tampak salah.

Untuk workflow, sering lebih aman memakai:

- version number,
- sequence number,
- aggregate version,
- event offset,
- state transition rule,
- causal relationship melalui causation id.

### 14.2 Out-of-Order Event

```text
Expected order:
ApplicationSubmitted -> ApplicationApproved

Actual arrival:
ApplicationApproved arrives first
ApplicationSubmitted arrives later
```

Consumer harus punya strategi:

1. reject and retry later,
2. buffer sementara,
3. query source of truth,
4. process idempotently jika state memungkinkan,
5. mark as inconsistent untuk reconciliation.

---

## 15. Failure Semantics: Technical Failure vs Business Failure

Salah satu skill penting dalam microservices adalah membedakan technical failure dan business failure.

### 15.1 Business Failure

Business failure adalah penolakan valid berdasarkan aturan domain.

Contoh:

- application tidak memenuhi syarat,
- payment declined,
- user tidak punya permission,
- document format ditolak,
- case tidak bisa approve karena state salah.

Business failure biasanya final untuk request tersebut.

### 15.2 Technical Failure

Technical failure adalah kegagalan infrastruktur/transport/runtime.

Contoh:

- timeout,
- connection reset,
- DB unavailable,
- broker unavailable,
- pod restart,
- thread pool exhausted,
- cache timeout,
- serialization error,
- dependency 500.

Technical failure bisa transient, tetapi bisa juga menunjukkan systemic failure.

### 15.3 Mengapa Pembedaan Ini Penting

Retry business failure biasanya salah.

Retry technical failure mungkin benar, tapi hanya jika aman.

```text
HTTP 400 validation error       -> do not retry
HTTP 401/403                    -> do not retry blindly
HTTP 409 optimistic conflict    -> maybe retry with reread/recompute
HTTP 429                        -> retry with backoff if allowed
HTTP 500                        -> maybe retry if idempotent
Timeout                         -> unknown; retry only if idempotent/reconcilable
```

---

## 16. Idempotency sebagai Survival Requirement

Idempotency berarti operation dapat dipanggil lebih dari sekali dengan efek akhir yang sama.

Dalam distributed systems, idempotency bukan nice-to-have. Ia adalah syarat survival.

Kenapa?

Karena caller bisa tidak tahu apakah request pertama berhasil.

### 16.1 Contoh Non-Idempotent

```text
POST /payments
```

Jika request timeout, lalu caller retry, bisa terjadi double charge.

### 16.2 Idempotent dengan Key

```text
POST /payments
Idempotency-Key: application-123/payment-attempt-1
```

Server menyimpan hasil berdasarkan key.

Jika request sama datang lagi:

- jangan proses ulang side effect,
- kembalikan result yang sama,
- atau kembalikan status bahwa operation sedang/proses/sudah selesai.

### 16.3 Idempotent State Transition

Untuk state machine:

```text
APPROVE application-123 transition-id=abc
```

Jika transition sudah diterapkan, retry tidak boleh membuat side effect kedua.

---

## 17. Resource Exhaustion

Distributed failure sering bukan karena bug business logic, tetapi karena resource habis.

Resource yang bisa habis:

- request threads,
- virtual thread scheduler carrier capacity under blocking native/pinned sections,
- database connections,
- HTTP connections,
- file descriptors,
- heap,
- direct memory,
- CPU,
- disk I/O,
- network bandwidth,
- message broker partition throughput,
- cache connection,
- TLS handshake capacity,
- logging pipeline,
- tracing collector,
- ephemeral ports.

### 17.1 Thread Pool Exhaustion

Service A memiliki 200 request threads.

Dependency B lambat 5 detik.

Traffic 100 RPS.

Concurrency yang dibutuhkan:

```text
100 RPS × 5 seconds = 500 concurrent waits
```

Thread pool 200 penuh. Request baru queue. Latency naik. Timeout naik. Retry naik.

### 17.2 Connection Pool Exhaustion

Database pool 50 connection.

Query lambat karena lock contention.

Semua connection tertahan.

Service tidak hanya gagal pada endpoint yang memakai query lambat. Endpoint lain yang butuh DB juga ikut gagal.

### 17.3 Virtual Threads Tidak Menghapus Pool Exhaustion

Java 21 virtual threads memungkinkan banyak blocking tasks dengan biaya thread lebih rendah.

Tetapi:

- DB connection tetap terbatas,
- downstream service tetap terbatas,
- CPU tetap terbatas,
- memory tetap terbatas,
- lock contention tetap ada,
- rate limit external tetap ada.

Virtual threads membuat model blocking lebih scalable di sisi caller, tetapi desain kapasitas tetap wajib.

---

## 18. Queueing Theory untuk Engineer Microservices

Kita tidak perlu menjadi ahli matematika untuk memakai queueing theory secara praktis.

Cukup pahami beberapa prinsip.

### 18.1 Utilization Mendekati 100% Membuat Latency Meledak

Jika server bekerja mendekati kapasitas maksimal, antrian tumbuh cepat.

```text
utilization = arrival_rate / service_rate
```

Saat utilization mendekati 1.0, latency biasanya meningkat non-linear.

Artinya target kapasitas tidak boleh 100%.

Microservices production butuh headroom.

### 18.2 Queue Harus Bounded

Unbounded queue adalah memory leak yang menyamar sebagai reliability feature.

Jika queue tidak dibatasi:

- latency tidak terlihat di awal,
- memory naik,
- GC pressure naik,
- request stale tetap diproses,
- failure terlambat muncul,
- recovery makin lama.

Lebih baik reject lebih awal daripada menerima request yang sudah tidak mungkin memenuhi SLA.

### 18.3 Work Conservation Tidak Selalu Baik

Kadang sistem harus sengaja menolak work.

Jika semua request diterima saat overload, semua bisa gagal.

Jika sebagian request ditolak cepat, sebagian lain masih bisa sukses.

Ini dasar load shedding.

---

## 19. Degradation dan Load Shedding

Graceful degradation adalah kemampuan sistem tetap memberikan fungsi terbatas saat sebagian dependency bermasalah.

Load shedding adalah kemampuan menolak sebagian load untuk melindungi sistem.

### 19.1 Contoh Graceful Degradation

Jika recommendation service gagal:

```text
Product page tetap tampil
Recommendation section kosong/default
Core purchase flow tetap jalan
```

Jika notification service gagal:

```text
Application tetap submitted
Notification ditunda
Admin alert dibuat
```

Jika audit service gagal:

Ini lebih sensitif. Untuk sistem regulasi, audit mungkin critical invariant. Jika audit wajib sebelum state change, maka service harus fail closed.

### 19.2 Semua Fallback Tidak Sama

Fallback bisa:

- safe default,
- cached response,
- partial response,
- queued side effect,
- manual review,
- degraded UI,
- fail closed,
- fail open.

Pemilihan fallback adalah keputusan domain, bukan hanya teknis.

### 19.3 Load Shedding

Contoh load shedding:

- reject low-priority request,
- disable expensive report,
- pause batch job,
- stop reprocessor,
- reduce polling frequency,
- return 429,
- serve cached read model,
- temporarily disable non-critical enrichment.

Prinsip:

> Saat overload, sistem harus memilih pekerjaan mana yang diselamatkan dan pekerjaan mana yang ditolak.

---

## 20. Observability Sejak Desain

Distributed system tanpa observability adalah sistem yang tidak bisa dipahami saat gagal.

Log saja tidak cukup.

Diperlukan:

- metrics,
- logs,
- traces,
- audit trail,
- event history,
- dependency map,
- service ownership,
- runbook,
- dashboard berbasis user journey.

### 20.1 Correlation ID

Correlation ID menghubungkan semua log dalam satu request/workflow.

```text
correlation_id = 7f3c...
Gateway log
Application Service log
Document Service log
Payment Service log
Outbox publisher log
Notification worker log
```

### 20.2 Causation ID

Causation ID menjelaskan hubungan sebab-akibat antar event/command.

```text
Command SubmitApplication caused Event ApplicationSubmitted
Event ApplicationSubmitted caused Command StartScreening
Command StartScreening caused Event ScreeningStarted
```

### 20.3 Trace ID vs Business ID

Trace ID berguna untuk observability teknis.

Business ID berguna untuk investigasi domain.

Dalam case management, kamu butuh keduanya:

- trace id untuk melihat request teknis,
- application id/case id untuk melihat lifecycle domain,
- actor id untuk audit,
- tenant/agency/module untuk segmentasi.

### 20.4 Metrics yang Harus Ada

Untuk setiap dependency:

- request rate,
- error rate,
- latency percentile,
- timeout count,
- retry count,
- circuit breaker state,
- pool usage,
- queue depth,
- consumer lag,
- DLQ count,
- saturation,
- success/failure by error class.

Untuk business flow:

- submitted count,
- approved count,
- rejected count,
- stuck in state count,
- reconciliation count,
- compensation count,
- SLA breach count,
- manual intervention count.

---

## 21. Data Consistency Reality

Dalam monolith, satu transaction bisa menjaga banyak invariant.

Dalam microservices, transaction lokal lebih kecil. Cross-service consistency harus didesain.

### 21.1 Strong vs Eventual

Strong consistency:

```text
Setelah write berhasil, semua pembaca melihat state terbaru.
```

Eventual consistency:

```text
Setelah write berhasil, sistem akan converge ke state benar setelah beberapa waktu jika tidak ada update baru.
```

Eventual consistency bukan excuse untuk data kacau. Ia harus punya:

- convergence rule,
- reconciliation,
- retry,
- deduplication,
- observability,
- user communication,
- SLA.

### 21.2 Read-Your-Writes Problem

User submit application lalu langsung membuka halaman detail.

Jika read model belum update, user melihat status lama.

Solusi bisa berupa:

- read from write model untuk flow tertentu,
- synchronous update untuk state minimal,
- client-side pending state,
- read model freshness indicator,
- polling with correlation,
- command result berisi enough state.

### 21.3 Distributed Invariant

Contoh invariant:

```text
Application cannot be approved unless required documents are verified.
```

Jika Application Service dan Document Service terpisah, invariant ini harus punya owner.

Pilihan:

1. Application Service menyimpan projection status dokumen.
2. Approval workflow memanggil Document Service secara synchronous.
3. Process manager memastikan dokumen verified sebelum approve command.
4. Approval masuk pending verification.
5. Manual review jika status tidak pasti.

Tidak ada jawaban universal. Ada trade-off latency, consistency, availability, dan auditability.

---

## 22. CAP Theorem sebagai Warning, Bukan Jawaban Semua Hal

CAP sering disalahgunakan.

Secara praktis:

- network partition bisa terjadi,
- saat partition, sistem harus memilih bagaimana merespons operasi tertentu,
- tidak semua komponen harus memilih sama,
- domain menentukan apakah fail open, fail closed, queue, atau degrade.

Untuk regulatory system, beberapa operation harus fail closed:

```text
Approve case tanpa verifikasi authorization dan audit mungkin tidak boleh.
```

Operation lain bisa degrade:

```text
Load recommendation, notification, dashboard enrichment bisa ditunda.
```

Top 1% engineer tidak berkata “CAP says eventual consistency”. Ia bertanya:

- invariant mana yang wajib strong?
- invariant mana yang boleh eventual?
- partition behavior apa yang diterima regulator/user/business?
- apakah ada reconciliation?
- apakah audit cukup?

---

## 23. Microservices dan Human/Organizational Failure

Distributed systems bukan hanya mesin. Ia juga organisasi.

Failure bisa terjadi karena:

- owner service tidak jelas,
- contract berubah tanpa komunikasi,
- dashboard tidak dimiliki,
- runbook tidak ada,
- on-call tidak tahu dependency,
- deployment dilakukan tanpa compatibility check,
- incident handoff buruk,
- team berbeda punya prioritas berbeda,
- platform abstraksi tidak dipahami.

### 23.1 Ownership as Reliability Mechanism

Service tanpa owner adalah risiko operasional.

Setiap service harus punya:

- owner team,
- on-call path,
- repository,
- deployment pipeline,
- dashboard,
- alert,
- runbook,
- contract owner,
- data owner,
- escalation owner.

### 23.2 Conway’s Law Reality

Jika komunikasi antar team buruk, arsitektur microservices akan memantulkan keburukan itu.

Service boundary yang ideal secara domain bisa gagal jika ownership tidak sesuai.

Kadang modular monolith lebih baik daripada microservices tanpa ownership matang.

---

## 24. Java 8–25: Runtime Reality untuk Distributed Systems

Microservices Java harus memperhatikan versi Java karena runtime behavior berbeda.

### 24.1 Java 8

Karakteristik umum:

- masih banyak enterprise legacy,
- blocking thread-per-request umum,
- CompletableFuture tersedia,
- HTTP client modern belum built-in,
- GC tuning sering G1/CMS legacy,
- container awareness lebih terbatas dibanding versi modern,
- banyak stack enterprise masih Java 8-compatible.

Implikasi:

- thread pool sizing sangat penting,
- blocking I/O harus dikontrol,
- timeout eksplisit wajib,
- dependency client sering library eksternal,
- observability sering perlu manual instrumentation lebih banyak.

### 24.2 Java 11

Karakteristik:

- LTS modern baseline lama,
- `java.net.http.HttpClient` tersedia,
- container support lebih baik,
- GC dan TLS lebih modern,
- banyak organisasi migrasi dari Java 8 ke 11.

Implikasi:

- standar client HTTP built-in bisa dipakai,
- runtime behavior di container lebih baik,
- masih perlu thread pool discipline.

### 24.3 Java 17

Karakteristik:

- LTS baseline modern luas,
- language improvement,
- GC/runtime lebih matang,
- cocok sebagai baseline enterprise modern.

Implikasi:

- lebih baik untuk service modern,
- cocok untuk Spring Boot 3 era,
- observability dan container ergonomics lebih baik.

### 24.4 Java 21

Karakteristik:

- virtual threads,
- structured concurrency sebagai arah desain,
- ZGC generational tersedia,
- lebih menarik untuk blocking microservices.

Implikasi:

- blocking I/O bisa lebih scalable,
- thread-per-request model kembali menarik,
- tetapi connection pools, DB pools, downstream capacity tetap bottleneck,
- concurrency limit tetap wajib.

### 24.5 Java 25

Karakteristik:

- latest generation setelah Java 21,
- relevan untuk organisasi yang ingin horizon baru,
- harus dilihat dengan kompatibilitas framework, library, container, agent observability, dan vendor support.

Implikasi:

- jangan upgrade hanya untuk “latest”,
- validasi bytecode compatibility,
- validasi instrumentation agent,
- validasi GC behavior,
- validasi native image/tooling jika dipakai,
- validasi dependency library.

### 24.6 Versi Java Tidak Menghapus Distributed Problems

Tidak peduli Java 8 atau 25, masalah berikut tetap ada:

- partial failure,
- timeout,
- retry storm,
- stale data,
- distributed invariant,
- service ownership,
- schema compatibility,
- observability,
- incident response.

Runtime membantu, tetapi arsitektur menentukan survival.

---

## 25. Mental Model: Remote Call sebagai Risk Boundary

Setiap remote call harus dianggap risk boundary.

Untuk setiap remote call, tanyakan:

```text
1. Apa dependency-nya?
2. Apakah call ini wajib synchronous?
3. Apa timeout budget-nya?
4. Apakah retry aman?
5. Apakah operation idempotent?
6. Apa yang terjadi jika timeout?
7. Apa yang terjadi jika response 500?
8. Apa yang terjadi jika dependency lambat?
9. Apa fallback-nya?
10. Apa blast radius-nya?
11. Apa data yang dikirim?
12. Apakah contract backward-compatible?
13. Apakah call ini ada di critical path user?
14. Bagaimana observability-nya?
15. Siapa owner dependency?
```

Jika pertanyaan ini tidak bisa dijawab, desain belum production-ready.

---

## 26. Mental Model: Failure Is a State, Not Just an Exception

Dalam aplikasi sederhana, failure sering dianggap exception.

Dalam microservices, failure harus menjadi bagian dari domain state.

Contoh buruk:

```java
try {
    paymentClient.authorize(command);
    application.approvePayment();
} catch (Exception e) {
    application.fail();
}
```

Ini buruk karena semua failure disamakan.

Contoh lebih baik secara konsep:

```text
Payment result classification:

- AUTHORIZED
- DECLINED
- AUTHORIZATION_TIMEOUT_UNKNOWN
- PROVIDER_UNAVAILABLE_RETRYABLE
- PROVIDER_REJECTED_NON_RETRYABLE
- DUPLICATE_REQUEST_ALREADY_AUTHORIZED
- REQUIRES_RECONCILIATION
```

Domain state harus bisa merepresentasikan uncertainty.

---

## 27. Mental Model: Capacity Is a Contract

Service tidak hanya punya API contract. Service juga punya capacity contract.

Contoh capacity contract:

```text
Service: Document Verification
Expected RPS: 100
Burst RPS: 300 for 2 minutes
P95 latency: < 500 ms
P99 latency: < 2 s
Max payload: 10 MB
Max concurrent verification: 50
Timeout recommendation: 1.5 s
Retry: only idempotent request with key
Degraded mode: queue verification request
```

Tanpa capacity contract, upstream akan membuat asumsi sendiri.

---

## 28. Mental Model: Dependency Is a Product

Internal service bukan hanya code. Ia adalah product untuk consumer internal.

Service yang baik punya:

- clear API,
- clear event contract,
- compatibility guarantee,
- deprecation policy,
- SLO,
- dashboard,
- documentation,
- examples,
- support path,
- incident communication,
- migration guide.

Jika internal service tidak punya hal ini, consumer akan membuat workaround:

- direct DB access,
- shared library terlalu tebal,
- copy-paste domain model,
- bypass API,
- hidden dependency.

Akhirnya distributed monolith.

---

## 29. Design Checklist Part 1

Gunakan checklist ini untuk review desain microservices awal.

### 29.1 Remote Call Checklist

- [ ] Apakah remote call benar-benar perlu?
- [ ] Apakah bisa diganti local decision/read model/event?
- [ ] Apakah call synchronous wajib?
- [ ] Apakah timeout jelas?
- [ ] Apakah timeout berbasis total request budget?
- [ ] Apakah retry policy jelas?
- [ ] Apakah retry idempotent?
- [ ] Apakah error diklasifikasikan?
- [ ] Apakah fallback aman?
- [ ] Apakah response partial diperbolehkan?
- [ ] Apakah dependency ada di critical path?

### 29.2 Failure Checklist

- [ ] Apa yang terjadi jika dependency down?
- [ ] Apa yang terjadi jika dependency lambat?
- [ ] Apa yang terjadi jika dependency timeout setelah side effect berhasil?
- [ ] Apa yang terjadi jika response hilang?
- [ ] Apa yang terjadi jika retry menghasilkan duplicate?
- [ ] Apa yang terjadi jika event terlambat?
- [ ] Apa yang terjadi jika event out of order?
- [ ] Apa yang terjadi jika queue lag tinggi?
- [ ] Apa yang terjadi jika DLQ penuh?
- [ ] Apa yang terjadi jika observability pipeline down?

### 29.3 Capacity Checklist

- [ ] Apa expected throughput?
- [ ] Apa burst throughput?
- [ ] Apa max concurrency?
- [ ] Apa pool limit?
- [ ] Apa queue limit?
- [ ] Apa payload limit?
- [ ] Apa CPU/memory headroom?
- [ ] Apa backpressure mechanism?
- [ ] Apa load shedding policy?
- [ ] Apa autoscaling signal?

### 29.4 Observability Checklist

- [ ] Apakah ada correlation id?
- [ ] Apakah ada causation id untuk async flow?
- [ ] Apakah trace context diteruskan?
- [ ] Apakah metrics per dependency tersedia?
- [ ] Apakah timeout/retry count terlihat?
- [ ] Apakah queue depth/lag terlihat?
- [ ] Apakah domain state stuck terlihat?
- [ ] Apakah audit trail bisa merekonstruksi flow?
- [ ] Apakah dashboard berbasis user journey tersedia?
- [ ] Apakah runbook ada?

---

## 30. Anti-Pattern yang Harus Dikenali Sejak Awal

### 30.1 Treating HTTP Like Method Call

Gejala:

- client generated dari interface tanpa timeout jelas,
- exception langsung dilempar ke controller,
- tidak ada idempotency,
- tidak ada error classification,
- tidak ada circuit breaker,
- tidak ada fallback.

### 30.2 Retry Everywhere

Gejala:

- gateway retry,
- service retry,
- client retry,
- SDK retry,
- broker retry,
- user retry,
- semua tanpa koordinasi.

### 30.3 Infinite Queue

Gejala:

- queue dipakai untuk “reliability”,
- tidak ada max depth,
- tidak ada lag SLA,
- tidak ada DLQ policy,
- tidak ada consumer capacity planning.

### 30.4 No Timeout or Arbitrary Timeout

Gejala:

- timeout 30 detik karena default,
- semua dependency timeout sama,
- timeout lebih besar dari user request budget,
- database query timeout tidak sinkron dengan HTTP timeout.

### 30.5 Shared Failure Domain

Gejala:

- semua service bergantung pada satu database,
- semua service memakai satu Redis tanpa isolation,
- semua service memakai satu thread pool executor,
- semua service gagal jika notification down,
- semua module gagal jika report service lambat.

### 30.6 Observability Afterthought

Gejala:

- log ada tapi tidak bisa dicari per request,
- trace tidak lintas async boundary,
- metrics hanya CPU/memory,
- tidak ada business metrics,
- audit trail tidak cukup menjelaskan state transition,
- incident analysis bergantung pada tebakan.

---

## 31. Contoh Analisis: Application Submission Flow

Misalnya sistem punya flow:

```text
User submits application
  -> Application Service
  -> Profile Service
  -> Document Service
  -> Payment Service
  -> Screening Service
  -> Notification Service
```

Desain naif:

```text
Application Service memanggil semua service synchronous.
Jika semua sukses, application submitted.
Jika salah satu gagal, return error.
```

Masalah:

- temporal coupling tinggi,
- availability semua dependency menentukan submission,
- latency total tinggi,
- partial failure sulit,
- retry bisa duplikasi,
- Notification failure bisa menggagalkan core flow,
- Screening mungkin tidak perlu blocking,
- Payment timeout punya unknown state,
- Document verification bisa async,
- user experience buruk.

Desain lebih matang:

```text
1. Application Service menerima submit command.
2. Validate local invariant.
3. Persist application state SUBMISSION_RECEIVED.
4. Persist outbox event ApplicationSubmitted.
5. Return accepted/submitted state ke user jika core invariant terpenuhi.
6. Document/Screening/Notification berjalan async.
7. Payment jika wajib immediate, gunakan idempotency key dan explicit UNKNOWN state.
8. Process manager melacak workflow.
9. State machine punya status pending/verified/failed/requires action.
10. Observability memakai correlation id + application id + causation id.
```

Trade-off:

- user mungkin melihat status pending,
- sistem butuh read model/projection,
- workflow lebih kompleks,
- tetapi blast radius lebih kecil,
- recovery lebih jelas,
- audit lebih kuat,
- dependency failure tidak otomatis menggagalkan semua.

---

## 32. Principal-Level Review Questions

Saat mereview desain microservices, ajukan pertanyaan berikut.

### 32.1 Architecture Questions

1. Apa alasan sistem ini perlu distributed?
2. Apa yang akan lebih buruk jika tetap monolith/modular monolith?
3. Apa boundary utama dan mengapa?
4. Apa dependency paling critical?
5. Apa critical path user?
6. Apa operation yang harus strong consistent?
7. Apa operation yang boleh eventual?
8. Apa blast radius tiap service?
9. Apa fallback untuk dependency non-critical?
10. Apa kill switch yang tersedia?

### 32.2 Runtime Questions

1. Apa timeout budget per endpoint?
2. Apa retry policy per dependency?
3. Apakah retry punya jitter?
4. Apakah ada circuit breaker?
5. Apa max concurrency?
6. Apa queue bound?
7. Apa pool limit?
8. Apa autoscaling signal?
9. Apa overload behavior?
10. Apa yang terjadi saat downstream lambat 10x?

### 32.3 Data Questions

1. Siapa owner data?
2. Apakah ada shared DB?
3. Apa invariant lokal?
4. Apa invariant lintas service?
5. Bagaimana read-your-writes ditangani?
6. Bagaimana duplicate command/event ditangani?
7. Bagaimana out-of-order event ditangani?
8. Bagaimana reconciliation dilakukan?
9. Bagaimana audit direkonstruksi?
10. Bagaimana schema compatibility dijaga?

### 32.4 Operational Questions

1. Siapa owner service?
2. Siapa on-call?
3. Dashboard apa yang dipakai?
4. Alert apa yang meaningful?
5. Runbook apa yang tersedia?
6. Apa SLO-nya?
7. Apa error budget-nya?
8. Bagaimana incident dikomunikasikan?
9. Bagaimana dependency outage diuji?
10. Bagaimana deployment rollback/roll-forward dilakukan?

---

## 33. Java Implementation Sketch: Deadline-Aware Remote Call

Ini bukan full framework. Ini ilustrasi mental model.

```java
public final class Deadline {
    private final long deadlineNanos;

    private Deadline(long deadlineNanos) {
        this.deadlineNanos = deadlineNanos;
    }

    public static Deadline afterMillis(long millis) {
        return new Deadline(System.nanoTime() + millis * 1_000_000L);
    }

    public long remainingMillis() {
        long remaining = deadlineNanos - System.nanoTime();
        return Math.max(0L, remaining / 1_000_000L);
    }

    public boolean expired() {
        return remainingMillis() <= 0;
    }
}
```

Caller tidak mengarang timeout baru. Caller memakai remaining budget.

```java
public PaymentResult authorizePayment(PaymentCommand command, Deadline deadline) {
    if (deadline.expired()) {
        return PaymentResult.deadlineExceededBeforeCall(command.paymentId());
    }

    long timeoutMillis = Math.min(deadline.remainingMillis(), 800L);

    try {
        return paymentClient.authorize(command, timeoutMillis);
    } catch (TimeoutException e) {
        return PaymentResult.unknown(command.paymentId(), "CALLER_TIMEOUT");
    } catch (PaymentDeclinedException e) {
        return PaymentResult.declined(command.paymentId(), e.reason());
    } catch (TransientDependencyException e) {
        return PaymentResult.retryableFailure(command.paymentId(), e.getMessage());
    }
}
```

Poin penting:

- timeout menghasilkan `UNKNOWN`, bukan otomatis `FAILED`,
- business decline berbeda dari technical timeout,
- deadline dipropagasikan,
- result domain eksplisit.

---

## 34. Java Implementation Sketch: Bounded Retry with Jitter

```java
import java.time.Duration;
import java.util.concurrent.ThreadLocalRandom;

public final class RetryPolicy {
    private final int maxAttempts;
    private final long baseDelayMillis;
    private final long maxDelayMillis;

    public RetryPolicy(int maxAttempts, long baseDelayMillis, long maxDelayMillis) {
        if (maxAttempts < 1) throw new IllegalArgumentException("maxAttempts must be >= 1");
        this.maxAttempts = maxAttempts;
        this.baseDelayMillis = baseDelayMillis;
        this.maxDelayMillis = maxDelayMillis;
    }

    public boolean shouldRetry(int attempt, Throwable error, boolean idempotent, Deadline deadline) {
        if (!idempotent) return false;
        if (attempt >= maxAttempts) return false;
        if (deadline.expired()) return false;
        return isTransient(error);
    }

    public Duration delay(int attempt, Deadline deadline) {
        long exponential = baseDelayMillis * (1L << Math.min(attempt, 10));
        long capped = Math.min(exponential, maxDelayMillis);
        long jittered = ThreadLocalRandom.current().nextLong(0, capped + 1);
        long remaining = deadline.remainingMillis();
        return Duration.ofMillis(Math.min(jittered, remaining));
    }

    private boolean isTransient(Throwable error) {
        return error instanceof TimeoutException
            || error instanceof ConnectionResetException
            || error instanceof TooManyRequestsException
            || error instanceof ServiceUnavailableException;
    }
}
```

Ini hanya sketsa. Dalam production, kamu juga perlu:

- metrics per attempt,
- retry budget global,
- error classification yang lebih presisi,
- cancellation,
- observability tags,
- integration dengan circuit breaker/rate limiter,
- idempotency key enforcement.

---

## 35. Java Implementation Sketch: Explicit Result Instead of Exception Soup

Daripada semua error menjadi exception, gunakan classification.

```java
public sealed interface RemoteCallResult<T> permits
        RemoteCallResult.Success,
        RemoteCallResult.BusinessRejected,
        RemoteCallResult.TimeoutUnknown,
        RemoteCallResult.DependencyUnavailable,
        RemoteCallResult.RateLimited {

    record Success<T>(T value) implements RemoteCallResult<T> {}

    record BusinessRejected<T>(String code, String message) implements RemoteCallResult<T> {}

    record TimeoutUnknown<T>(String operationId) implements RemoteCallResult<T> {}

    record DependencyUnavailable<T>(String dependency, boolean retryable) implements RemoteCallResult<T> {}

    record RateLimited<T>(String dependency, long retryAfterMillis) implements RemoteCallResult<T> {}
}
```

Untuk Java 8, sealed interface belum tersedia. Gunakan class hierarchy biasa atau enum + payload object.

Tujuan desain bukan syntax modern. Tujuannya adalah semantic eksplisit.

---

## 36. Production Readiness Checklist

Sebelum service dianggap siap berada dalam microservices environment, minimal harus jelas:

### 36.1 API and Communication

- [ ] Semua outbound call punya timeout.
- [ ] Timeout berdasarkan request/deadline budget.
- [ ] Retry terbatas.
- [ ] Retry memakai backoff dan jitter.
- [ ] Retry hanya untuk operation aman.
- [ ] Idempotency key tersedia untuk command penting.
- [ ] Error contract eksplisit.
- [ ] Transport failure tidak dicampur dengan business failure.

### 36.2 Resilience

- [ ] Circuit breaker untuk dependency kritis/lambat.
- [ ] Bulkhead untuk dependency berbeda.
- [ ] Pool limit jelas.
- [ ] Queue bounded.
- [ ] Load shedding tersedia.
- [ ] Graceful degradation didefinisikan.
- [ ] Fallback diuji.
- [ ] Dependency latency degradation diuji.

### 36.3 Observability

- [ ] Correlation id lintas service.
- [ ] Trace context propagation.
- [ ] Async causation tracking.
- [ ] Metrics per dependency.
- [ ] Retry/timeout/circuit metrics.
- [ ] Queue lag metrics.
- [ ] Business state metrics.
- [ ] Audit trail untuk state transition.

### 36.4 Data and Correctness

- [ ] Duplicate request aman.
- [ ] Duplicate event aman.
- [ ] Out-of-order event ditangani.
- [ ] Reconciliation flow tersedia.
- [ ] Unknown state eksplisit.
- [ ] Cross-service invariant punya owner.
- [ ] Eventual consistency punya SLA.

### 36.5 Operations

- [ ] Owner jelas.
- [ ] SLO jelas.
- [ ] Dashboard ada.
- [ ] Alert meaningful.
- [ ] Runbook ada.
- [ ] Incident escalation jelas.
- [ ] Capacity assumption terdokumentasi.
- [ ] Load test dan failure test tersedia.

---

## 37. Ringkasan Mental Model

Distributed systems reality dapat diringkas sebagai berikut:

```text
Local call is simple.
Remote call is uncertainty.

Failure is not binary.
Failure can be partial, slow, duplicated, delayed, ambiguous, and cascading.

Timeout is not failure proof.
Timeout is caller impatience.

Retry is not reliability.
Retry is extra load unless controlled.

Queue is not infinite safety.
Queue is delayed work with latency debt.

Backpressure is not optional.
It is how systems survive overload.

Observability is not decoration.
It is how distributed truth is reconstructed.

Microservices do not remove complexity.
They move complexity from code structure into runtime behavior, contracts, data ownership, and operations.
```

Jika part ini dipahami dengan benar, maka part berikutnya tentang service boundary akan jauh lebih masuk akal. Boundary yang baik bukan hanya memisahkan domain. Boundary yang baik juga memisahkan failure, ownership, deployment, data, latency, dan change.

---

## 38. Latihan Praktis

Ambil satu flow nyata dari sistem enterprise, misalnya:

```text
Submit application
Approve case
Upload document
Generate report
Send notification
Start screening
Renew license
Appeal decision
```

Untuk flow tersebut, jawab:

1. Service apa saja yang terlibat?
2. Mana yang synchronous?
3. Mana yang asynchronous?
4. Mana yang critical path?
5. Timeout budget total berapa?
6. Dependency mana yang boleh degrade?
7. Dependency mana yang harus fail closed?
8. Operation mana yang harus idempotent?
9. Apa yang terjadi jika dependency timeout tapi side effect berhasil?
10. Apa state domain untuk uncertainty?
11. Apa event yang mungkin duplikat?
12. Apa event yang mungkin out of order?
13. Apa queue yang bisa lag?
14. Apa metric pertama yang menunjukkan masalah?
15. Apa blast radius dependency paling lemah?

Jika kamu bisa menjawab ini, kamu sudah mulai berpikir seperti engineer yang mendesain production distributed system, bukan hanya menulis service kecil.

---

## 39. Referensi

1. Google SRE Book — *Addressing Cascading Failures*: https://sre.google/sre-book/addressing-cascading-failures/
2. Google SRE Book — *Handling Overload*: https://sre.google/sre-book/handling-overload/
3. Google SRE Book — *Production Services: Best Practices*: https://sre.google/sre-book/service-best-practices/
4. AWS Builders Library — *Timeouts, retries, and backoff with jitter*: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
5. AWS Architecture Blog — *Exponential Backoff And Jitter*: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
6. Reactive Streams Specification for the JVM: https://github.com/reactive-streams/reactive-streams-jvm
7. Reactive Streams Initiative: https://www.reactive-streams.org/
8. Martin Fowler — *Microservices*: https://martinfowler.com/articles/microservices.html
9. OpenJDK JDK 25 Project: https://openjdk.org/projects/jdk/25/

---

## 40. Status Seri

Part ini adalah **Part 1 dari 35**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 2 — Service Boundary Engineering
```

File berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-02-service-boundary-engineering.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-00-introduction-and-mental-model.md">⬅️ Learn Java Microservices Patterns Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-02-service-boundary-engineering.md">Learn Java Microservices Patterns Advanced Engineering — Part 2 ➡️</a>
</div>

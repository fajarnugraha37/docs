# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-025

# Part 25 — Backpressure and Capacity Engineering: Throughput, Latency, Queue Depth, Consumer Lag, dan Saturation

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: `025 / 035`  
> Topik: JMS/Jakarta Messaging capacity engineering, backpressure, throughput, latency, queue depth, consumer lag, saturation, and scaling decision  
> Target Java: Java 8 sampai Java 25  
> Fokus: mental model production-grade, bukan sekadar konfigurasi broker

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 24, kita sudah membahas:

- JMS/Jakarta Messaging sebagai abstraction untuk enterprise messaging.
- Queue dan topic semantics.
- Producer, consumer, acknowledgement, transaction, reliability, ordering, retry, DLQ.
- Provider differences, Jakarta EE runtime, Spring integration.
- Microservices, contract evolution, idempotency, dan deduplication.

Sekarang kita masuk ke pertanyaan yang lebih operasional dan lebih sulit:

> "Sistem JMS saya aman secara semantic, tetapi apakah dia mampu menahan beban nyata?"

Atau lebih presisi:

> "Ketika message masuk lebih cepat daripada sistem memprosesnya, bagian mana yang menahan tekanan, bagaimana tekanannya terlihat, dan apa keputusan engineering yang benar?"

Itulah inti **backpressure and capacity engineering**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Memahami queue bukan hanya sebagai tempat menyimpan message, tetapi sebagai **pressure buffer**.
2. Membaca hubungan antara:
   - arrival rate,
   - processing rate,
   - queue depth,
   - latency,
   - consumer lag,
   - broker memory,
   - broker disk,
   - database capacity,
   - downstream dependency.
3. Menentukan apakah sistem perlu:
   - menambah consumer,
   - mengurangi prefetch,
   - memperbesar broker,
   - memperbaiki DB query,
   - mengubah payload,
   - membatasi producer,
   - menambah partitioning,
   - atau mengubah arsitektur.
4. Menghindari anti-pattern:
   - scaling consumer tanpa mengukur bottleneck,
   - menaikkan thread count sampai DB collapse,
   - memakai queue depth sebagai satu-satunya metric,
   - membiarkan broker menjadi infinite buffer,
   - menganggap durable queue berarti sistem pasti aman.
5. Mendesain capacity model yang defensible untuk sistem enterprise/regulatory.

---

## 2. Sumber Konseptual Resmi yang Menjadi Dasar

Jakarta Messaging API mendefinisikan cara umum program Java untuk membuat, mengirim, menerima, dan membaca message dari enterprise messaging system. Artinya, API memberi kontrak penggunaan, tetapi kapasitas dan backpressure nyata sangat bergantung pada provider/broker/runtime. Dokumentasi Jakarta Messaging menyatakan API ini menyediakan common way bagi program Java untuk create, send, receive, dan read messages dari enterprise messaging system.

ActiveMQ Artemis, sebagai reference broker modern dalam seri ini, memiliki dokumentasi khusus tentang flow control. Dokumentasi Artemis menjelaskan bahwa consumer window size mengontrol buffering message di sisi client, dan nilai `-1` memungkinkan unbounded client-side buffering yang harus digunakan hati-hati karena dapat menghabiskan memori client jika consumer tidak mampu memproses secepat menerima message.

Dalam queueing theory, **Little's Law** menyatakan hubungan jangka panjang:

```text
L = λ × W
```

di mana `L` adalah jumlah rata-rata item dalam sistem, `λ` adalah arrival/throughput rate, dan `W` adalah waktu rata-rata item berada dalam sistem. Prinsip ini sangat berguna untuk membaca queue depth, latency, dan throughput secara rasional.

---

## 3. Mental Model Utama: Queue adalah Shock Absorber, Bukan Mesin Ajaib

Queue sering dijelaskan sebagai:

> "Tempat menyimpan message sebelum diproses."

Definisi itu benar, tapi terlalu dangkal.

Secara production engineering, queue adalah:

> **mechanical buffer yang menyerap perbedaan kecepatan antara producer dan consumer.**

Jika producer mengirim 1.000 message/detik dan consumer memproses 800 message/detik, maka queue bertambah 200 message/detik.

```text
Producer rate       = 1000 msg/s
Consumer capacity   =  800 msg/s
Backlog growth      =  200 msg/s
```

Dalam 10 menit:

```text
200 msg/s × 600 s = 120,000 messages backlog
```

Queue tidak menghilangkan overload. Queue hanya **menunda konsekuensi overload**.

Kalimat penting:

> Queue mengubah overload yang langsung terlihat menjadi backlog yang perlahan membesar.

Ini bisa sangat berguna karena sistem bisa bertahan terhadap spike sementara. Tetapi ini juga berbahaya karena overload jangka panjang menjadi terlihat terlambat.

---

## 4. Synchronous Overload vs Asynchronous Overload

### 4.1 Synchronous System

Pada HTTP synchronous call:

```text
Client -> Service -> DB
```

Jika service/DB lambat:

- request latency naik,
- thread pool penuh,
- timeout terjadi,
- client melihat error,
- pressure langsung terlihat.

Synchronous overload cenderung cepat terlihat.

### 4.2 JMS Asynchronous System

Pada JMS:

```text
Producer -> Broker Queue -> Consumer -> DB
```

Jika consumer/DB lambat:

- producer mungkin tetap sukses send,
- queue depth naik,
- processing delay naik,
- user tidak langsung melihat error,
- failure terasa belakangan.

Asynchronous overload sering tersembunyi.

### 4.3 Consequence

JMS membuat sistem lebih resilient terhadap burst, tetapi bukan berarti kapasitas downstream tidak penting.

Sistem JMS yang buruk sering terlihat "baik-baik saja" dari sisi producer, padahal message menumpuk dan SLA diam-diam terbakar.

---

## 5. Vocabulary Capacity Engineering

Kita perlu vocabulary yang presisi.

| Istilah | Makna |
|---|---|
| Arrival rate | Jumlah message masuk per satuan waktu |
| Publish rate | Kecepatan producer mengirim message ke broker |
| Enqueue rate | Kecepatan broker menerima message ke queue |
| Dequeue rate | Kecepatan message keluar dari queue ke consumer |
| Processing rate | Kecepatan consumer menyelesaikan business processing |
| Ack rate | Kecepatan consumer melakukan acknowledgement/commit |
| Queue depth | Jumlah message yang menunggu atau berada di queue |
| In-flight message | Message sudah dikirim ke consumer tetapi belum ack/commit |
| Consumer lag | Selisih antara message masuk dan message yang selesai diproses |
| Processing latency | Waktu consumer memproses satu message |
| End-to-end latency | Waktu dari message dibuat sampai business effect selesai |
| Service time | Waktu kerja aktual untuk memproses message |
| Wait time | Waktu message menunggu sebelum mulai diproses |
| Utilization | Rasio pemakaian kapasitas worker/downstream |
| Saturation | Kondisi ketika sistem mendekati/melewati kapasitas efektif |
| Backpressure | Mekanisme menghambat input agar tidak menghancurkan sistem downstream |

---

## 6. Formula Dasar yang Wajib Dikuasai

### 6.1 Throughput Consumer

Jika satu consumer thread memproses rata-rata satu message dalam 200 ms:

```text
service_time = 0.2 s/message
capacity_per_thread = 1 / 0.2 = 5 msg/s
```

Jika ada 20 consumer thread:

```text
theoretical_capacity = 20 × 5 = 100 msg/s
```

Tetapi ini hanya theoretical. Real capacity bisa lebih rendah karena:

- database connection pool,
- lock contention,
- downstream API latency,
- GC pause,
- broker dispatch limit,
- transaction overhead,
- serialization/deserialization,
- CPU saturation,
- network RTT,
- disk fsync,
- logging overhead.

### 6.2 Backlog Growth

```text
backlog_growth_rate = arrival_rate - completed_processing_rate
```

Jika positif terus-menerus, queue akan terus bertambah.

### 6.3 Drain Time

Jika backlog ada 500.000 message, arrival rate sudah berhenti, dan consumer mampu menyelesaikan 1.000 msg/s:

```text
drain_time = backlog / processing_rate
           = 500,000 / 1,000
           = 500 s
           = 8.33 menit
```

Jika arrival tetap 700 msg/s:

```text
effective_drain_rate = processing_rate - arrival_rate
                     = 1,000 - 700
                     = 300 msg/s

drain_time = 500,000 / 300
           = 1,666.67 s
           = 27.78 menit
```

### 6.4 Little's Law untuk Messaging

Little's Law:

```text
L = λ × W
```

Dalam konteks queue:

```text
queue_depth ≈ arrival_rate × average_wait_time
```

Jika arrival rate 100 msg/s dan message rata-rata menunggu 60 detik:

```text
queue_depth ≈ 100 × 60 = 6,000 messages
```

Jika queue depth 60.000 dan arrival rate 100 msg/s:

```text
average_wait_time ≈ 60,000 / 100 = 600 s = 10 menit
```

Ini penting karena queue depth sendiri tidak cukup. Queue depth 10.000 bisa ringan atau parah tergantung arrival rate dan SLA.

---

## 7. Queue Depth Bukan Metric Tunggal

Banyak engineer bertanya:

> "Queue depth 50.000 itu bahaya atau tidak?"

Jawabannya:

> Tergantung arrival rate, processing rate, SLA, age of oldest message, backlog trend, dan downstream capacity.

### 7.1 Queue Depth 50.000 Bisa Aman

Misalnya:

```text
queue_depth = 50,000
processing_rate = 10,000 msg/s
new_arrival = 0 msg/s
drain_time = 5 detik
```

Ini mungkin hanya burst pendek.

### 7.2 Queue Depth 5.000 Bisa Bahaya

Misalnya:

```text
queue_depth = 5,000
processing_rate = 1 msg/s
new_arrival = 2 msg/s
oldest_message_age = 2 jam
```

Ini bahaya karena backlog tumbuh dan latency sudah tinggi.

### 7.3 Metric yang Lebih Penting

Untuk production JMS, minimal pantau:

| Metric | Kenapa penting |
|---|---|
| Queue depth | Melihat backlog |
| Enqueue rate | Melihat tekanan input |
| Dequeue/ack rate | Melihat output aktual |
| Oldest message age | Melihat SLA latency |
| Redelivery count | Melihat processing failure |
| DLQ growth rate | Melihat permanent failure |
| Consumer count | Melihat kapasitas worker aktif |
| In-flight count | Melihat message yang sudah dikirim tapi belum selesai |
| Broker memory usage | Melihat pressure broker |
| Broker disk usage | Melihat durability/paging pressure |
| Consumer processing latency | Melihat bottleneck handler |
| DB connection usage | Melihat bottleneck downstream |
| Error/timeout rate | Melihat failure amplification |

---

## 8. Consumer Lag di JMS

Kafka punya istilah consumer lag yang formal karena log offset. JMS tidak selalu punya offset model. Tetapi secara engineering, kita tetap bisa mendefinisikan lag.

### 8.1 Lag sebagai Backlog Count

```text
consumer_lag_count = messages_waiting + messages_in_flight_unacked
```

### 8.2 Lag sebagai Time Delay

```text
consumer_lag_time = now - message_created_at
```

Biasanya memakai:

- `JMSTimestamp`,
- custom header `createdAt`,
- custom envelope field `occurredAt`,
- broker metric oldest message age.

### 8.3 Count Lag vs Time Lag

| Lag Type | Kelebihan | Kelemahan |
|---|---|---|
| Count lag | Mudah dibaca | Tidak langsung menunjukkan SLA |
| Time lag | Langsung terkait SLA | Butuh timestamp valid |
| Oldest age | Bagus untuk alert | Bisa bias oleh poison/stuck message |
| P95/P99 age | Lebih representatif | Butuh instrumentation tambahan |

### 8.4 Invariant

Untuk system SLA, **oldest message age** dan **end-to-end latency** biasanya lebih penting daripada queue depth.

---

## 9. Backpressure: Definisi yang Benar

Backpressure adalah:

> Mekanisme agar downstream yang lambat dapat memberi sinyal kepada upstream untuk memperlambat, menahan, menolak, atau mengalihkan beban.

Dalam JMS, backpressure bisa terjadi di beberapa layer:

```text
[Producer]
    |
    v
[Broker accept / protocol / connection]
    |
    v
[Broker memory / journal / paging]
    |
    v
[Queue dispatch]
    |
    v
[Consumer prefetch/window]
    |
    v
[Consumer thread pool]
    |
    v
[DB / downstream API / file / external system]
```

Backpressure yang bagus bukan hanya broker menolak message. Backpressure yang bagus adalah pressure signal yang terkendali, observable, dan tidak menyebabkan collapse.

---

## 10. Jenis Backpressure dalam JMS System

### 10.1 Producer-Side Backpressure

Broker dapat memperlambat producer ketika:

- address/queue memory limit tercapai,
- disk penuh,
- journal lambat,
- paging aktif,
- connection credit habis,
- broker tidak bisa accept message lebih cepat.

Efek ke producer:

- `send()` menjadi lambat,
- async send callback lambat,
- timeout,
- exception,
- blocked connection,
- producer retry.

### 10.2 Broker-Side Backpressure

Broker menahan message karena:

- queue depth besar,
- dispatch lambat,
- consumer tidak cukup,
- consumer window penuh,
- memory limit,
- paging to disk,
- disk IO saturation.

### 10.3 Consumer-Side Backpressure

Consumer lambat karena:

- handler mahal,
- DB lambat,
- external API lambat,
- lock contention,
- transaction commit lambat,
- listener thread kurang,
- connection pool penuh,
- GC tinggi,
- CPU saturated.

### 10.4 Downstream Backpressure

Sumber overload paling umum bukan broker, tetapi resource setelah consumer:

```text
Consumer -> Database
Consumer -> HTTP downstream
Consumer -> Object storage
Consumer -> Email server
Consumer -> Legacy system
```

Jika consumer concurrency dinaikkan tanpa memperhatikan downstream, kamu hanya memindahkan backlog dari queue ke DB.

---

## 11. Broker Buffer vs Client Buffer

Salah satu jebakan penting di JMS adalah message tidak selalu "ada di broker queue".

Message bisa berada di:

1. broker persistent storage,
2. broker memory,
3. broker dispatch buffer,
4. network buffer,
5. client prefetch/window buffer,
6. listener thread processing,
7. transaction in-flight.

Secara monitoring, queue depth bisa turun bukan karena message selesai, tetapi karena message sudah diprefetch ke client.

### 11.1 Contoh

```text
Queue depth visible on broker: 0
Consumer prefetch buffer: 10,000 messages
Consumer processing rate: 10 msg/s
```

Secara broker terlihat kosong, tetapi sebenarnya ada 10.000 message belum selesai.

### 11.2 Konsekuensi

- Shutdown consumer bisa menyebabkan redelivery besar.
- Slow consumer bisa "menahan" message sehingga consumer lain tidak mendapat kerja.
- Queue depth tidak selalu sama dengan pending business work.
- Prefetch/window terlalu besar bisa merusak fairness.

---

## 12. Prefetch / Consumer Window

Banyak broker menggunakan konsep prefetch atau consumer window.

Tujuan:

- mengurangi roundtrip,
- meningkatkan throughput,
- menjaga consumer selalu punya message,
- mengurangi idle time.

Tetapi prefetch terlalu besar menyebabkan:

- client memory tinggi,
- unfair distribution,
- message stuck di slow consumer,
- redelivery storm saat consumer crash,
- queue depth misleading,
- graceful shutdown lebih lama.

### 12.1 Fast Consumer

Fast consumer bisa memproses message secepat broker mengirim. Untuk kasus ini, prefetch/window lebih besar bisa meningkatkan throughput.

### 12.2 Slow Consumer

Slow consumer memproses message lambat. Untuk kasus ini, prefetch/window besar berbahaya karena message terkumpul di client dan tidak tersedia untuk consumer lain.

### 12.3 Rule of Thumb

| Kondisi | Prefetch/Window |
|---|---|
| Handler CPU-light, cepat, idempotent | Bisa lebih besar |
| Handler DB-heavy | Moderat/rendah |
| Handler external API | Rendah |
| Ordering penting | Rendah atau partitioned |
| Message besar | Rendah |
| Consumer tidak stabil | Rendah |
| Need fairness tinggi | Rendah |
| Batch processing cepat | Moderat/tinggi setelah benchmark |

---

## 13. In-Flight Messages

In-flight message adalah message yang sudah dikirim ke consumer tetapi belum di-ack/commit.

```text
in_flight = delivered_to_consumer - acknowledged
```

In-flight tinggi bisa berarti:

1. consumer sedang memproses banyak message,
2. prefetch/window terlalu besar,
3. listener thread stuck,
4. transaction commit lambat,
5. consumer mati tapi broker belum mendeteksi,
6. network issue,
7. ack batching tertahan.

### 13.1 Kenapa In-Flight Penting

Jika in-flight tinggi:

- failover bisa redeliver banyak message,
- duplicate risk naik,
- memory pressure naik,
- latency tail naik,
- shutdown lebih lama,
- operational visibility menurun.

### 13.2 Invariant

Untuk sistem regulated, in-flight harus bounded dan observable.

---

## 14. Saturation: Titik Sistem Mulai Tidak Linear

Sistem tidak melambat secara linear selamanya. Biasanya ada titik ketika:

- CPU mendekati 100%,
- DB connection pool penuh,
- disk latency melonjak,
- GC meningkat,
- thread pool queue membesar,
- lock contention naik,
- broker paging aktif,
- network packet loss/retry,
- timeout saling memperburuk.

Setelah titik ini, menambah beban sedikit bisa menyebabkan latency naik drastis.

### 14.1 Utilization dan Latency

Secara umum:

```text
utilization = arrival_rate / capacity
```

Jika utilization 50%, latency mungkin stabil.

Jika utilization 80%, latency mulai sensitif.

Jika utilization 95%, sedikit spike bisa membuat queue membesar cepat.

Jika utilization >100%, backlog pasti tumbuh.

### 14.2 Target Headroom

Untuk sistem enterprise, jangan desain untuk 100% utilization.

Contoh target:

| Layer | Target Normal |
|---|---|
| Consumer CPU | 50–70% |
| DB connection pool | 50–75% |
| Broker memory | <70% |
| Broker disk | <70–80% |
| Queue latency | jauh di bawah SLA |
| Consumer thread saturation | <80% |
| Downstream timeout rate | mendekati 0 |

Headroom bukan pemborosan; headroom adalah asuransi terhadap burst, retry, failover, dan maintenance.

---

## 15. Capacity Model: Cara Menghitung dari Bawah

Misalkan satu message diproses seperti ini:

```text
Deserialize payload       5 ms
Validate                 10 ms
DB read                  30 ms
Business logic           15 ms
DB write                 60 ms
Audit insert             20 ms
Commit transaction       40 ms
Ack/commit JMS            5 ms
--------------------------------
Total                   185 ms
```

Capacity satu worker:

```text
1 / 0.185 = 5.4 msg/s
```

Jika 10 worker:

```text
54 msg/s theoretical
```

Tetapi DB connection pool hanya 10, dan setiap message butuh DB connection hampir sepanjang 150 ms.

DB-bound capacity kira-kira:

```text
db_connections / db_hold_time
= 10 / 0.150
= 66.6 msg/s
```

Consumer theoretical 54 msg/s, DB theoretical 66 msg/s. Consumer adalah bottleneck.

Jika worker dinaikkan ke 30:

```text
consumer_theoretical = 30 × 5.4 = 162 msg/s
db_capacity ≈ 66.6 msg/s
```

Sekarang DB menjadi bottleneck. Thread tambahan hanya membuat antrean di DB pool.

---

## 16. Capacity Budget per Message

Untuk sistem serius, setiap message type harus punya capacity budget.

Contoh:

```yaml
messageType: CaseSubmitted.v1
sla:
  p95EndToEndLatency: 60s
  maxOldestMessageAge: 300s
load:
  normalArrivalRate: 20 msg/s
  peakArrivalRate: 100 msg/s for 10 minutes
processing:
  avgProcessingTime: 120ms
  p95ProcessingTime: 300ms
  p99ProcessingTime: 800ms
consumer:
  concurrency: 20
  targetUtilization: 60%
downstream:
  dbConnectionPoolAllocated: 15
  externalApiTimeout: 2s
failure:
  maxRetryAttempts: 5
  retryBackoff: exponential
  dlqAfter: permanentFailure or exhaustedRetries
```

Ini bukan dokumentasi kosmetik. Ini dasar untuk:

- sizing consumer,
- sizing broker,
- defining alerts,
- proving SLA,
- explaining incidents,
- estimating CR impact.

---

## 17. Queue Growth Scenario

Misal:

```text
normal arrival    = 50 msg/s
normal capacity   = 100 msg/s
peak arrival      = 500 msg/s
peak duration     = 10 menit
```

Selama peak:

```text
excess = 500 - 100 = 400 msg/s
backlog = 400 × 600 = 240,000 messages
```

Setelah peak selesai, arrival kembali 50 msg/s.

Effective drain:

```text
capacity - normal_arrival = 100 - 50 = 50 msg/s
```

Drain time:

```text
240,000 / 50 = 4,800 s = 80 menit
```

Artinya spike 10 menit menyebabkan backlog 80 menit.

Jika SLA processing 15 menit, sistem gagal.

### 17.1 Solusi Apa?

Pilihan:

1. naikkan consumer capacity selama/ setelah peak,
2. throttle producer,
3. batch processing,
4. prioritization,
5. split queue berdasarkan type/priority,
6. precompute/cache dependency,
7. scale DB,
8. ubah workflow agar peak tidak masuk sekaligus.

---

## 18. Little's Law sebagai Sanity Check

Misal monitoring menunjukkan:

```text
enqueue rate = 200 msg/s
oldest age = 600s
queue depth = 10,000
```

Secara Little's Law, jika stable:

```text
L ≈ λ × W = 200 × 600 = 120,000
```

Tetapi observed queue depth hanya 10.000.

Kemungkinan:

- banyak message sudah in-flight di consumer buffer,
- arrival rate baru naik,
- timestamp tidak akurat,
- queue tidak stable,
- metric queue depth hanya ready messages, bukan delivered/unacked,
- oldest age disebabkan satu stuck poison message.

Little's Law bukan alat absolut, tetapi bagus untuk mendeteksi metric yang tidak konsisten.

---

## 19. Bottleneck Classification

Ketika queue naik, jangan langsung menambah consumer.

Klasifikasikan dulu bottleneck.

### 19.1 Broker-Bound

Gejala:

- producer send latency tinggi,
- broker CPU/memory/disk tinggi,
- paging aktif,
- journal latency tinggi,
- network broker saturated,
- dispatch lambat,
- banyak connection blocked.

Solusi:

- tuning journal,
- SSD/IOPS lebih baik,
- paging threshold,
- split destination,
- scale broker topology,
- reduce payload size,
- tune persistence,
- reduce sync send,
- broker clustering/HA evaluation.

### 19.2 Consumer CPU-Bound

Gejala:

- CPU consumer tinggi,
- DB normal,
- broker normal,
- processing latency naik,
- GC mungkin naik.

Solusi:

- optimize handler,
- reduce serialization overhead,
- improve algorithm,
- batch where safe,
- increase consumer replicas,
- allocate CPU,
- tune JVM/GC.

### 19.3 Consumer Thread-Bound

Gejala:

- CPU tidak tinggi,
- DB tidak penuh,
- thread pool fully busy,
- queue depth naik.

Solusi:

- increase listener concurrency,
- reduce blocking,
- async downstream if safe,
- tune prefetch,
- split handler.

### 19.4 Database-Bound

Gejala:

- DB CPU/IO tinggi,
- connection pool penuh,
- query latency naik,
- locks/waits tinggi,
- consumer threads waiting for connection,
- transaction commit lambat.

Solusi:

- optimize SQL/index,
- reduce transaction scope,
- batch writes,
- partition workload,
- increase DB capacity,
- avoid N+1,
- introduce outbox/inbox properly,
- throttle consumer.

### 19.5 Downstream API-Bound

Gejala:

- HTTP timeout/retry tinggi,
- external latency tinggi,
- circuit breaker open,
- consumer thread blocked,
- DLQ/retry naik.

Solusi:

- lower concurrency,
- circuit breaker,
- rate limit,
- bulkhead,
- cache,
- async compensation,
- isolate queue per downstream.

### 19.6 Lock/Ordering-Bound

Gejala:

- CPU rendah,
- DB tidak saturated,
- few hot entity IDs,
- message groups stuck,
- one partition has high lag.

Solusi:

- investigate hot key,
- split aggregate,
- improve state transition,
- reduce lock duration,
- shard by better key,
- remove unnecessary global ordering.

---

## 20. Scaling Consumer: Kenapa Tidak Selalu Menyelesaikan Masalah

### 20.1 Naive Thinking

```text
Queue depth naik -> tambah consumer
```

### 20.2 Better Thinking

```text
Queue depth naik
  -> apakah arrival > completed rate?
  -> bottleneck di mana?
  -> apakah consumer idle atau saturated?
  -> apakah DB/downstream punya headroom?
  -> apakah ordering/message group membatasi parallelism?
  -> apakah retry storm sedang terjadi?
  -> apakah DLQ naik?
  -> apakah broker paging?
```

### 20.3 Scaling Consumer Membantu Jika

- handler parallelizable,
- downstream punya headroom,
- broker dispatch mampu,
- ordering tidak terlalu ketat,
- message tidak semua hot key sama,
- transaction cost masih manageable.

### 20.4 Scaling Consumer Membahayakan Jika

- DB sudah saturated,
- external API punya rate limit,
- message handler tidak idempotent,
- ada lock contention,
- retry storm sedang terjadi,
- DLQ disebabkan permanent error,
- broker memory/paging sudah kritis.

---

## 21. Thread Count vs Throughput

Thread count bukan throughput.

```text
more threads != more completed work
```

Thread count hanya meningkatkan concurrency. Throughput hanya naik jika sistem punya resource untuk menyelesaikan pekerjaan paralel.

### 21.1 CPU-Bound Workload

Jika workload CPU-bound, thread > CPU core sering menambah context switching.

### 21.2 IO-Bound Workload

Jika workload IO-bound, lebih banyak thread bisa membantu sampai downstream saturation.

### 21.3 DB-Bound Workload

Jika workload DB-bound, thread count harus dikaitkan dengan DB connection pool dan query latency.

### 21.4 External API-Bound Workload

Jika downstream punya rate limit 100 req/s, 1.000 consumer thread hanya membuat 900 req/s gagal/timeout/retry.

---

## 22. Java 8 sampai Java 25: Dampak Runtime terhadap Capacity

### 22.1 Java 8

Karakteristik:

- umum di legacy JMS system,
- thread-per-listener normal,
- GC tuning lebih penting,
- no virtual threads,
- older client library compatibility.

Perhatian:

- heap pressure dari deserialization,
- blocked thread mahal,
- TLS/crypto performance lebih lama,
- monitoring harus lebih manual.

### 22.2 Java 11/17

Karakteristik:

- runtime modern,
- better GC options,
- better TLS performance,
- banyak enterprise baseline.

Perhatian:

- migration javax/jakarta tetap terpisah dari JDK version,
- container memory ergonomics lebih baik daripada Java 8 tetapi tetap harus dituning.

### 22.3 Java 21/25

Karakteristik:

- virtual threads tersedia dari Java 21,
- modern GC seperti ZGC/Shenandoah makin matang,
- structured concurrency masih perlu hati-hati tergantung versi/status API,
- runtime observability lebih baik.

Namun:

> Virtual threads tidak membuat broker, DB, atau downstream API punya kapasitas tak terbatas.

Virtual threads bisa mengurangi biaya blocked threads, tetapi:

- DB connection pool tetap finite,
- external API rate limit tetap finite,
- broker credit tetap finite,
- transaction lock tetap finite,
- memory untuk in-flight work tetap finite.

### 22.4 JMS Listener dan Virtual Threads

Banyak JMS listener container masih berbasis thread pool/platform thread. Jika kamu memakai virtual threads di handler internal:

```text
JMS listener thread receives message
  -> submit business processing to virtual thread
  -> waits/join before ack
```

Harus hati-hati:

- ack harus tetap terjadi setelah side effect selesai,
- jangan ack lalu proses async tanpa recovery model,
- batasi concurrency dengan semaphore/bulkhead,
- jangan membuat in-flight unbounded.

---

## 23. Backpressure dan Transaction Boundary

Backpressure harus diselaraskan dengan transaction boundary.

### 23.1 Bad Pattern

```java
public void onMessage(Message message) {
    executor.submit(() -> process(message));
    message.acknowledge();
}
```

Masalah:

- message di-ack sebelum side effect selesai,
- jika async task gagal, message hilang,
- broker melihat consumer cepat padahal sistem sebenarnya overload,
- backpressure rusak.

### 23.2 Better Pattern

```java
public void onMessage(Message message) {
    processSynchronouslyWithinBoundedConcurrency(message);
    message.acknowledge();
}
```

Atau jika ingin async:

- message disimpan dulu ke durable inbox,
- ack setelah inbox commit,
- worker internal memproses inbox dengan backpressure sendiri.

### 23.3 Invariant

> Jangan memutus hubungan ack dengan durability side effect kecuali kamu punya durable handoff lain.

---

## 24. Bounded Concurrency di Consumer

Jika consumer handler memanggil downstream yang terbatas, gunakan bounded concurrency.

### 24.1 Semaphore Pattern

```java
private final Semaphore permits = new Semaphore(50);

public void onMessage(Message message) throws JMSException {
    boolean acquired = false;
    try {
        permits.acquire();
        acquired = true;

        handleBusiness(message);

        message.acknowledge();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new JMSException("Interrupted while waiting for capacity");
    } finally {
        if (acquired) {
            permits.release();
        }
    }
}
```

Catatan:

- Ini contoh konseptual.
- Dalam container-managed listener, acknowledgement/transaction handling bisa berbeda.
- Jangan menelan exception jika ingin rollback/redelivery.

### 24.2 Bulkhead per Downstream

Jika satu consumer memanggil beberapa dependency:

```text
Case DB bulkhead:       50 permits
Notification API:       20 permits
Document service:       10 permits
Audit DB:               30 permits
```

Ini mencegah satu dependency lambat menghancurkan semua flow.

---

## 25. Producer Throttling

Backpressure ideal terjadi sebelum broker collapse.

Producer bisa menerapkan:

- rate limiter,
- bounded local queue,
- circuit breaker,
- send timeout,
- retry budget,
- adaptive throttling,
- batch limit,
- payload size limit.

### 25.1 Bad Producer

```text
while(true):
  send message
  if fail: retry immediately forever
```

Efek:

- broker overload,
- network overload,
- duplicate risk,
- retry storm,
- disk pressure,
- log spam.

### 25.2 Better Producer

```text
send with timeout
if transient failure:
  retry with exponential backoff + jitter
if broker saturated:
  shed load / return 429 / defer work
if business critical:
  persist locally to outbox and relay gradually
```

### 25.3 Producer Rate Limit Based on SLA

Jika downstream hanya bisa memproses 1.000 msg/s, producer tidak boleh mengirim 10.000 msg/s terus-menerus kecuali backlog SLA masih acceptable.

---

## 26. Retry Storm sebagai Capacity Killer

Retry bukan free.

Jika setiap failed message di-retry 5 kali, effective workload bisa naik 6x:

```text
original attempt + 5 retries = 6 processing attempts
```

Jika permanent error terjadi pada 10.000 message:

```text
10,000 × 6 = 60,000 attempts
```

Jika tiap attempt memanggil DB/API, downstream bisa collapse.

### 26.1 Retry Budget

Gunakan retry budget:

```yaml
retry:
  maxAttempts: 5
  backoff:
    initial: 5s
    multiplier: 2
    max: 5m
    jitter: true
  stopOn:
    - validation_error
    - schema_error
    - unauthorized
    - entity_not_found_permanent
```

### 26.2 Retry Classification

| Error | Retry? |
|---|---|
| DB connection timeout | Ya, dengan backoff |
| Deadlock | Ya, dengan backoff |
| External 503 | Ya, dengan backoff |
| External 429 | Ya, sesuai rate limit |
| JSON schema invalid | Tidak |
| Unknown message type | Tidak |
| Authorization failure | Biasanya tidak |
| Missing mandatory business data | Biasanya tidak |
| Optimistic lock conflict | Tergantung state model |

---

## 27. DLQ Growth dan Capacity

DLQ bukan hanya reliability topic. DLQ juga capacity signal.

Jika DLQ naik:

- message gagal permanen,
- retry exhausted,
- handler bug,
- schema mismatch,
- downstream permanent rejection,
- data quality issue.

### 27.1 Jangan Requeue DLQ Massal Tanpa Kontrol

DLQ replay massal bisa menyebabkan:

- retry storm,
- duplicate side effects,
- queue starvation,
- DB overload,
- operational incident kedua.

### 27.2 DLQ Replay Rate Limit

Replay harus:

- rate-limited,
- audited,
- idempotent,
- filterable,
- dry-run capable,
- reversible jika possible,
- tied to fix version.

---

## 28. Priority dan Capacity

JMS priority dapat memengaruhi dispatch order, tetapi priority bukan solusi capacity.

### 28.1 Risiko Priority

Jika high priority terus masuk, low priority bisa starvation.

### 28.2 Better Design

Untuk workload berbeda SLA, lebih baik gunakan:

```text
queue.case.critical
queue.case.normal
queue.case.bulk
```

Dengan consumer pool berbeda:

```text
critical consumers: reserved capacity
normal consumers: scalable
bulk consumers: throttled
```

Ini lebih observable dan controllable daripada satu queue priority campur.

---

## 29. Queue Partitioning untuk Capacity

Satu queue global sering menjadi bottleneck logical.

Partitioning dapat dilakukan berdasarkan:

- tenant,
- agency,
- module,
- message type,
- aggregate ID hash,
- priority,
- SLA class,
- downstream dependency.

### 29.1 Partition by Message Type

```text
queue.case.submitted
queue.case.approved
queue.case.rejected
queue.notification.email
queue.audit.write
```

Kelebihan:

- clearer ownership,
- easier scaling,
- better alert,
- isolated failure.

Kekurangan:

- lebih banyak destination,
- lebih banyak config,
- routing governance perlu rapi.

### 29.2 Partition by Aggregate Hash

```text
queue.case.command.00
queue.case.command.01
...
queue.case.command.15
```

Kelebihan:

- parallelism naik,
- per-entity ordering bisa dipertahankan,
- hot partition terlihat.

Kekurangan:

- routing lebih kompleks,
- rebalance sulit,
- monitoring harus per-partition.

### 29.3 Partition by Tenant

Cocok jika tenant isolation penting.

```text
queue.tenant-a.case
queue.tenant-b.case
queue.tenant-c.case
```

Risiko:

- tenant kecil membuat resource fragmentasi,
- tenant besar tetap butuh internal partitioning.

---

## 30. Payload Size dan Capacity

Message besar berdampak ke:

- broker memory,
- network throughput,
- serialization cost,
- disk journal,
- paging,
- GC,
- consumer heap,
- DLQ storage,
- replay time.

### 30.1 Claim Check Pattern

Daripada mengirim dokumen besar:

```text
Message body:
{
  "documentRef": "s3://bucket/path/file.pdf",
  "checksum": "...",
  "size": 104857600
}
```

Payload besar disimpan di object storage, message hanya membawa reference.

### 30.2 Tapi Claim Check Punya Trade-off

- perlu lifecycle storage,
- perlu permission,
- perlu checksum,
- perlu cleanup,
- perlu idempotent download,
- object storage menjadi dependency baru.

---

## 31. Batching

Batching bisa meningkatkan throughput, tetapi mengubah failure semantics.

### 31.1 Producer Batch

Producer mengirim banyak message lebih efisien.

Risiko:

- latency per message naik,
- batch partial failure,
- transaction lebih besar,
- memory lebih tinggi.

### 31.2 Consumer Batch

Consumer memproses beberapa message sekaligus.

Kelebihan:

- DB batch insert/update,
- fewer commits,
- better throughput.

Risiko:

- satu message buruk menggagalkan batch,
- ack boundary lebih rumit,
- redelivery duplicate lebih banyak,
- ordering effect lebih sulit.

### 31.3 Batch Size Rule

Batch size harus dikontrol oleh:

- max count,
- max bytes,
- max wait time,
- transaction timeout,
- memory budget,
- downstream limit.

Contoh:

```yaml
batch:
  maxMessages: 100
  maxBytes: 1MB
  maxWait: 500ms
  maxTransactionTime: 5s
```

---

## 32. Paging dan Disk Spill

Broker biasanya punya memory limit. Ketika message terlalu banyak, broker dapat memindahkan message ke disk/paging.

Paging menyelamatkan broker dari OOM, tetapi:

- latency naik,
- disk IO naik,
- recovery lebih lama,
- dequeue lebih lambat,
- producer bisa ikut melambat,
- monitoring harus jelas.

### 32.1 Paging Bukan Normal Mode

Jika broker terus-menerus paging, itu tanda capacity model salah.

Paging cocok untuk burst sementara, bukan sustained overload.

---

## 33. Disk as Bottleneck

Persistent JMS message membutuhkan durability.

Durability biasanya berarti:

- write journal,
- fsync/group commit,
- replication,
- paging,
- index/metadata update.

Jika disk lambat:

- producer send latency naik,
- broker paging lambat,
- failover recovery lambat,
- DLQ write lambat,
- broker CPU terlihat tidak tinggi tetapi throughput rendah.

### 33.1 Metric Disk

Pantau:

- disk utilization,
- write latency,
- fsync latency,
- IOPS,
- throughput MB/s,
- queue length,
- free space,
- journal growth,
- paging store usage.

---

## 34. Memory as Bottleneck

Memory pressure muncul di:

- broker message buffer,
- client prefetch buffer,
- consumer heap,
- deserialized payload,
- retry queue,
- batch accumulator,
- log buffers,
- observability exporter.

### 34.1 Message Count vs Message Bytes

Queue depth 100.000 bisa kecil jika message 200 bytes.

Queue depth 10.000 bisa besar jika message 2 MB.

Selalu pantau:

```text
message count + message bytes
```

---

## 35. CPU as Bottleneck

CPU bottleneck bisa dari:

- serialization/deserialization,
- JSON parsing,
- compression,
- encryption/decryption,
- validation,
- business rule engine,
- logging,
- metrics cardinality,
- TLS,
- broker routing/filtering,
- selector evaluation.

### 35.1 Selector CPU

Message selector yang kompleks dapat mengubah broker menjadi filter engine.

Jika selector berat dan throughput tinggi, pertimbangkan:

- separate queue,
- explicit routing,
- broker-side address model,
- application-level router,
- avoid high-cardinality dynamic selectors.

---

## 36. Network as Bottleneck

Network bottleneck muncul ketika:

- message besar,
- many producers/consumers,
- cross-region messaging,
- TLS overhead,
- broker replication,
- bridge/federation,
- chatty request/reply.

Metric:

- throughput,
- packet loss,
- retransmit,
- RTT,
- connection errors,
- TLS handshake rate,
- broker acceptor saturation.

---

## 37. Alert Design

Alert harus berbasis gejala yang berarti.

### 37.1 Bad Alerts

```text
queue depth > 1000
```

Terlalu statis. Bisa false positive/negative.

### 37.2 Better Alerts

```text
oldest_message_age > 5 minutes for 10 minutes
enqueue_rate > dequeue_rate by 20% for 15 minutes
DLQ_growth_rate > 0 for critical queues
broker_disk_usage > 75%
broker_paging_active for > 5 minutes
consumer_ack_rate drops by 50%
redelivery_rate > baseline × 5
```

### 37.3 SLA-Based Alert

Untuk queue yang SLA 15 menit:

```text
warning: oldest_message_age > 5m
critical: oldest_message_age > 10m
page: oldest_message_age > 12m and increasing
```

---

## 38. Dashboard Minimum

Dashboard production JMS harus menunjukkan:

```text
Per destination:
  - enqueue rate
  - dequeue/ack rate
  - queue depth
  - in-flight
  - oldest message age
  - redelivery rate
  - DLQ count/growth
  - consumer count
  - average/p95/p99 processing latency

Broker:
  - CPU
  - heap/native memory
  - disk usage
  - disk latency
  - paging status
  - connection count
  - producer send latency
  - dispatch rate

Consumer app:
  - listener active threads
  - handler latency
  - DB pool active/waiting
  - downstream latency/error
  - transaction commit latency
  - GC pause
  - error by type
```

---

## 39. Capacity Testing

JMS capacity tidak bisa ditebak dari konfigurasi.

Harus diuji.

### 39.1 Test Types

| Test | Tujuan |
|---|---|
| Baseline throughput | Kapasitas normal |
| Burst test | Menilai buffer dan drain time |
| Soak test | Menilai leak, paging, disk growth |
| Failure test | Menilai retry/DLQ/backpressure |
| Downstream slowdown | Menilai bulkhead |
| Consumer crash | Menilai redelivery/in-flight |
| Broker restart | Menilai recovery |
| DLQ replay | Menilai replay safety |
| Payload size test | Menilai memory/network |
| Peak + retry test | Menilai amplification |

### 39.2 Jangan Hanya Test Happy Path

Backpressure muncul saat sistem stress.

Test harus mencakup:

- DB lambat,
- DB timeout,
- external API 429,
- broker disk hampir penuh,
- consumer crash,
- network partition,
- schema invalid,
- poison message,
- retry storm.

---

## 40. Load Test Data Design

Load test harus realistis.

### 40.1 Variasi Payload

Jangan hanya kirim payload kecil identik.

Gunakan variasi:

- small/medium/large payload,
- valid/invalid ratio,
- hot key distribution,
- tenant distribution,
- different message type,
- duplicate ratio,
- retry-triggering data.

### 40.2 Hot Key Simulation

Jika production punya entity tertentu yang sering di-update, test harus mensimulasikan hot aggregate.

```text
80% messages hit 20% case IDs
```

Atau lebih ekstrem:

```text
50% messages hit 1% case IDs
```

Ini penting untuk melihat lock contention dan ordering bottleneck.

---

## 41. Graceful Shutdown and Backpressure

Shutdown adalah capacity event.

Jika consumer dimatikan:

- capacity turun,
- in-flight harus selesai/rollback,
- queue depth bisa naik,
- redelivery bisa terjadi,
- rolling deployment bisa menyebabkan temporary backlog.

### 41.1 Shutdown Rules

Consumer harus:

1. stop menerima message baru,
2. selesaikan in-flight dalam deadline,
3. commit/ack yang sukses,
4. rollback/unack yang belum selesai,
5. release resource,
6. expose shutdown timeout metric.

### 41.2 Deployment Capacity

Jika kamu rolling deploy 50% consumer, capacity turun 50% sementara.

Pastikan:

```text
remaining_capacity > arrival_rate
```

atau backlog sementara masih acceptable.

---

## 42. Backpressure di Spring JMS

Dalam Spring, capacity sering dikontrol oleh:

- listener container concurrency,
- max concurrency,
- task executor,
- cache level,
- transaction manager,
- receive timeout,
- error handler,
- backoff,
- message converter cost.

Contoh konseptual:

```java
@Bean
DefaultJmsListenerContainerFactory jmsListenerContainerFactory(
        ConnectionFactory connectionFactory,
        PlatformTransactionManager transactionManager) {

    DefaultJmsListenerContainerFactory factory =
            new DefaultJmsListenerContainerFactory();

    factory.setConnectionFactory(connectionFactory);
    factory.setTransactionManager(transactionManager);
    factory.setConcurrency("5-20");
    factory.setReceiveTimeout(1000L);
    factory.setErrorHandler(t -> {
        // structured logging + metrics
    });

    return factory;
}
```

Catatan:

- `5-20` bukan berarti selalu aman.
- Max concurrency harus diselaraskan dengan DB/downstream.
- Error handler jangan menelan error yang harus menyebabkan rollback.
- Transaction manager menentukan ack/commit behavior.

---

## 43. Backpressure di Jakarta EE MDB

Dalam MDB/container-managed runtime, concurrency sering dikontrol melalui:

- MDB pool size,
- activation config,
- resource adapter config,
- max sessions,
- transaction timeout,
- destination config,
- app server thread pool.

Contoh konseptual:

```java
@MessageDriven(activationConfig = {
    @ActivationConfigProperty(
        propertyName = "destinationLookup",
        propertyValue = "jms/queue/CaseCommandQueue"
    ),
    @ActivationConfigProperty(
        propertyName = "destinationType",
        propertyValue = "jakarta.jms.Queue"
    )
})
public class CaseCommandListener implements MessageListener {

    @Override
    public void onMessage(Message message) {
        // Business processing inside container-managed boundary.
    }
}
```

Concurrency bukan di kode MDB semata. Banyaknya instance dan session sering dikendalikan container/resource adapter.

---

## 44. Dynamic Scaling

Autoscaling consumer berdasarkan CPU saja sering salah.

### 44.1 CPU-Based Scaling

Bagus jika workload CPU-bound.

Buruk jika:

- DB-bound,
- external API-bound,
- queue latency naik tapi CPU rendah,
- thread blocked,
- message groups bottleneck.

### 44.2 Queue-Based Scaling

Consumer bisa autoscale berdasarkan:

- queue depth,
- oldest message age,
- enqueue/dequeue delta,
- processing latency,
- pending work per consumer.

### 44.3 Safer Autoscaling Signal

Gunakan kombinasi:

```text
desired_consumers =
  function(queue_depth, oldest_age, arrival_rate, processing_rate, downstream_headroom)
```

Jangan scale jika downstream tidak punya headroom.

### 44.4 Scaling Limit

Selalu punya max replicas/concurrency:

```yaml
minConsumers: 4
maxConsumers: 40
scaleOut:
  oldestAgeThreshold: 2m
  queueDepthPerConsumer: 1000
scaleIn:
  idleDuration: 15m
guardrails:
  dbPoolUtilizationMustBeBelow: 70%
  externalErrorRateMustBeBelow: 1%
```

---

## 45. Rate Limiting by Message Type

Tidak semua message setara.

Contoh:

```text
Case command: high priority, low latency
Audit write: high volume, lower urgency
Email notification: external dependency, rate limited
Report generation: batch workload
```

Gunakan rate limit berbeda:

```yaml
caseCommand:
  maxRate: 500/s
auditWrite:
  maxRate: 2000/s
emailNotification:
  maxRate: 50/s
reportGeneration:
  maxConcurrent: 5
```

Ini lebih baik daripada satu global consumer pool.

---

## 46. Backpressure and SLA Classes

Buat SLA class:

| Class | Contoh | Strategy |
|---|---|---|
| Critical interactive | User action completion event | reserved consumers, strict alert |
| Operational command | Case transition | bounded retry, low lag |
| Integration event | Sync to external | durable, retry, DLQ |
| Notification | Email/SMS | rate-limited |
| Audit | Append-only audit | high durability, batch |
| Bulk | Report/index rebuild | throttled, off-peak |

Setiap class punya:

- queue,
- consumer pool,
- retry policy,
- DLQ policy,
- alert threshold,
- scaling limit.

---

## 47. Control Plane vs Data Plane

Dalam JMS production, pisahkan:

### Data Plane

Yang membawa business messages:

```text
CaseSubmitted
CaseApproved
NotificationRequested
AuditRecordCreated
```

### Control Plane

Yang mengontrol operasional:

```text
pause consumer
resume consumer
replay DLQ
change rate limit
drain queue
quarantine tenant
```

Jangan mencampur control message dengan business queue biasa tanpa governance.

---

## 48. Overload Policy

Setiap sistem perlu overload policy.

Saat arrival > capacity, pilihan hanya:

1. buffer,
2. throttle,
3. shed load,
4. degrade functionality,
5. prioritize,
6. fail fast,
7. scale,
8. reject,
9. defer.

Tidak punya policy berarti sistem akan memilih sendiri melalui collapse.

### 48.1 Contoh Overload Policy

```text
If queue oldest age > 10 minutes:
  - pause low-priority producers
  - reduce bulk consumers
  - reserve DB connections for critical queue
  - disable DLQ replay
  - increase consumer replicas only if DB < 70%
  - notify operations
```

---

## 49. Case Study: Regulatory Case Management

Bayangkan sistem case management:

```text
User submits application
  -> ApplicationSubmitted command
  -> ScreeningRequested event
  -> RiskAssessmentRequested event
  -> AuditLogWrite command
  -> NotificationRequested command
```

### 49.1 Normal Load

```text
ApplicationSubmitted: 20/s
ScreeningRequested: 20/s
AuditLogWrite: 200/s
NotificationRequested: 10/s
```

### 49.2 Peak Load

Batch migration atau agency upload:

```text
ApplicationSubmitted: 300/s for 30 minutes
AuditLogWrite: 3000/s
```

Jika audit queue dan case command memakai DB pool sama, audit volume bisa mengganggu case processing.

### 49.3 Better Architecture

```text
queue.case.command          -> DB pool critical
queue.screening.request     -> screening pool
queue.audit.write           -> audit batch pool
queue.notification.email    -> email rate-limited pool
queue.bulk.import           -> throttled pool
```

Setiap queue punya capacity budget.

---

## 50. Failure Scenario: DB Slowdown

### 50.1 Situation

```text
Arrival rate: 100 msg/s
Normal processing capacity: 150 msg/s
DB latency naik 3x
New processing capacity: 50 msg/s
```

Backlog growth:

```text
100 - 50 = 50 msg/s
```

Dalam 1 jam:

```text
50 × 3600 = 180,000 messages
```

### 50.2 Naive Response

Tambah consumer dari 20 ke 60.

### 50.3 Actual Impact

DB makin penuh, latency makin naik, timeout naik, retry naik, backlog makin cepat.

### 50.4 Correct Response

- throttle consumers,
- protect DB,
- pause low-priority queues,
- inspect DB waits,
- reduce retry aggressiveness,
- move permanent failures to DLQ,
- increase DB capacity only if bottleneck resource jelas,
- replay backlog gradually after recovery.

---

## 51. Failure Scenario: External API Rate Limit

### 51.1 Situation

Email provider limit:

```text
100 requests/s
```

Consumer concurrency:

```text
500
```

Efek:

- 429 naik,
- retry naik,
- queue depth naik,
- DLQ mungkin naik,
- provider bisa ban client.

### 51.2 Correct Design

```text
queue.notification.email
  -> token bucket 100/s
  -> retry 429 based on Retry-After
  -> max concurrent 50
  -> DLQ only after exhausted policy
```

---

## 52. Failure Scenario: Poison Message at Head

Jika queue strict ordering dan message pertama poison:

```text
message-1 poison
message-2 valid
message-3 valid
```

Jika broker/consumer selalu rollback message-1, message lain bisa tertahan.

Solusi:

- redelivery limit,
- DLQ poison,
- message group isolation,
- skip/quarantine strategy,
- idempotent repair.

---

## 53. Failure Scenario: Consumer Prefetch Too High

```text
10 consumers
prefetch 1000 each
10,000 messages delivered to clients
```

Satu consumer lambat memegang 1.000 message.

Broker queue depth terlihat rendah, tetapi work belum selesai.

Solusi:

- reduce prefetch/window,
- monitor delivered/unacked,
- tune slow consumer detection,
- ensure graceful shutdown.

---

## 54. Engineering Decision Framework

Saat backlog naik, gunakan urutan diagnosis:

```text
1. Apakah arrival rate naik?
2. Apakah ack/completion rate turun?
3. Apakah oldest message age naik?
4. Apakah redelivery/DLQ naik?
5. Apakah consumer count berubah?
6. Apakah consumer processing latency naik?
7. Apakah DB/downstream latency naik?
8. Apakah broker paging/memory/disk naik?
9. Apakah in-flight terlalu besar?
10. Apakah hot partition/message group terjadi?
11. Apakah retry memperbesar beban?
12. Apakah scaling consumer aman?
```

---

## 55. Anti-Patterns

### 55.1 Infinite Queue Mindset

> "Tidak apa-apa backlog besar, queue durable."

Salah.

Durability bukan capacity.

### 55.2 Scale Consumer Blindly

> "Queue naik, replicas tambah."

Salah jika downstream bottleneck.

### 55.3 Ack Before Processing

> "Ack dulu agar queue cepat turun."

Ini menciptakan data loss.

### 55.4 Prefetch Huge by Default

> "Prefetch besar pasti cepat."

Tidak jika consumer lambat/message besar/fairness penting.

### 55.5 Retry Immediately

> "Kalau gagal, langsung coba lagi."

Ini menciptakan retry storm.

### 55.6 One Queue for Everything

> "Lebih simpel semua message masuk queue yang sama."

Operasionalnya sulit, failure tidak terisolasi.

### 55.7 Queue Depth Only Alert

> "Alert kalau queue > X."

Tidak cukup. Harus lihat rate, age, lag, trend.

### 55.8 Broker as Database

> "Simpan message lama di broker saja."

Broker bukan archive system.

---

## 56. Production Checklist

### 56.1 Per Queue

- [ ] Ada owner.
- [ ] Ada purpose jelas.
- [ ] Ada SLA latency.
- [ ] Ada max acceptable backlog.
- [ ] Ada max oldest message age.
- [ ] Ada retry policy.
- [ ] Ada DLQ policy.
- [ ] Ada replay policy.
- [ ] Ada consumer concurrency limit.
- [ ] Ada payload size expectation.
- [ ] Ada idempotency key.
- [ ] Ada monitoring dashboard.
- [ ] Ada alert.
- [ ] Ada runbook.

### 56.2 Per Consumer

- [ ] Processing latency measured.
- [ ] Ack/commit latency measured.
- [ ] DB pool usage measured.
- [ ] Downstream latency measured.
- [ ] Error classified.
- [ ] Retry bounded.
- [ ] Concurrency bounded.
- [ ] Shutdown graceful.
- [ ] In-flight observable.
- [ ] Duplicate-safe.

### 56.3 Per Broker

- [ ] Memory monitored.
- [ ] Disk monitored.
- [ ] Paging monitored.
- [ ] Journal latency monitored.
- [ ] Producer send latency monitored.
- [ ] Consumer count monitored.
- [ ] DLQ growth monitored.
- [ ] HA/failover tested.
- [ ] Backup/recovery tested.

### 56.4 Per Producer

- [ ] Send timeout configured.
- [ ] Retry bounded.
- [ ] Backoff+jitter configured.
- [ ] Payload size bounded.
- [ ] Rate limiting considered.
- [ ] Outbox used if atomic DB+message needed.
- [ ] Metrics emitted.
- [ ] Failure path observable.

---

## 57. Capacity Review Template

Gunakan template ini saat design review.

```markdown
# JMS Capacity Review

## Destination
- Name:
- Type: queue/topic
- Owner:
- Message type(s):
- Producer(s):
- Consumer(s):

## Load
- Normal arrival rate:
- Peak arrival rate:
- Peak duration:
- Message size avg/p95/p99:
- Expected burst pattern:

## SLA
- Max end-to-end latency:
- Max oldest message age:
- Max drain time after peak:
- Business impact if delayed:

## Consumer
- Avg processing time:
- P95 processing time:
- P99 processing time:
- Concurrency:
- Max concurrency:
- In-flight limit:
- Prefetch/window:
- Ack/transaction mode:

## Downstream
- DB pool:
- External API limit:
- Rate limit:
- Timeout:
- Circuit breaker:
- Bulkhead:

## Failure
- Retry policy:
- DLQ policy:
- Replay policy:
- Idempotency key:
- Dedup store:
- Poison handling:

## Observability
- Queue depth:
- Oldest age:
- Enqueue/dequeue rate:
- Ack rate:
- Processing latency:
- Redelivery:
- DLQ growth:
- Broker memory/disk:
- Downstream latency:

## Capacity Verdict
- Bottleneck:
- Headroom:
- Scaling strategy:
- Risks:
- Required tests:
```

---

## 58. Java Example: Measuring Consumer Processing Latency

Contoh sederhana tanpa framework observability spesifik:

```java
public final class TimingMessageListener implements MessageListener {

    private final BusinessHandler handler;
    private final Metrics metrics;

    public TimingMessageListener(BusinessHandler handler, Metrics metrics) {
        this.handler = handler;
        this.metrics = metrics;
    }

    @Override
    public void onMessage(Message message) {
        long startNanos = System.nanoTime();

        try {
            handler.handle(message);

            long elapsedNanos = System.nanoTime() - startNanos;
            metrics.recordTimer("jms.consumer.processing", elapsedNanos);
            metrics.increment("jms.consumer.success");
        } catch (RuntimeException ex) {
            long elapsedNanos = System.nanoTime() - startNanos;
            metrics.recordTimer("jms.consumer.processing.failed", elapsedNanos);
            metrics.increment("jms.consumer.failure");

            throw ex;
        }
    }
}
```

Catatan:

- Jangan menelan exception.
- Jika exception ditelan, container/broker bisa menganggap message sukses.
- Metrik harus membedakan success/failure.
- Untuk transaction rollback, exception propagation penting.

---

## 59. Java Example: Extracting Message Age

```java
public final class MessageAge {

    public static long ageMillis(Message message, Clock clock) throws JMSException {
        long timestamp = message.getJMSTimestamp();

        if (timestamp <= 0) {
            return -1L;
        }

        return clock.millis() - timestamp;
    }
}
```

Tetapi untuk event domain, lebih baik punya custom timestamp:

```json
{
  "metadata": {
    "messageId": "msg-123",
    "occurredAt": "2026-06-18T10:15:30Z",
    "publishedAt": "2026-06-18T10:15:31Z"
  },
  "data": {}
}
```

Bedakan:

| Timestamp | Makna |
|---|---|
| occurredAt | Kapan event bisnis terjadi |
| publishedAt | Kapan producer publish |
| broker timestamp | Kapan broker/client set JMS timestamp |
| consumedAt | Kapan consumer mulai |
| completedAt | Kapan side effect selesai |

---

## 60. Java Example: Bounded Downstream Calls

```java
public final class BoundedExternalClient {

    private final Semaphore permits;
    private final ExternalClient delegate;

    public BoundedExternalClient(int maxConcurrent, ExternalClient delegate) {
        this.permits = new Semaphore(maxConcurrent);
        this.delegate = delegate;
    }

    public ExternalResponse call(ExternalRequest request) {
        boolean acquired = false;

        try {
            permits.acquire();
            acquired = true;

            return delegate.call(request);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while waiting for external capacity", e);
        } finally {
            if (acquired) {
                permits.release();
            }
        }
    }
}
```

Ini bukan pengganti broker backpressure, tetapi melindungi dependency spesifik.

---

## 61. Java Example: Simple Token Bucket Concept

```java
public final class SimpleRateLimiter {

    private final long intervalNanos;
    private long nextAllowedTime;

    public SimpleRateLimiter(long permitsPerSecond) {
        if (permitsPerSecond <= 0) {
            throw new IllegalArgumentException("permitsPerSecond must be positive");
        }

        this.intervalNanos = 1_000_000_000L / permitsPerSecond;
        this.nextAllowedTime = System.nanoTime();
    }

    public synchronized void acquire() {
        long now = System.nanoTime();

        if (now < nextAllowedTime) {
            long sleepNanos = nextAllowedTime - now;
            sleep(sleepNanos);
            now = System.nanoTime();
        }

        nextAllowedTime = Math.max(now, nextAllowedTime) + intervalNanos;
    }

    private static void sleep(long nanos) {
        long millis = nanos / 1_000_000L;
        int extraNanos = (int) (nanos % 1_000_000L);

        try {
            Thread.sleep(millis, extraNanos);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while rate limiting", e);
        }
    }
}
```

Catatan:

- Ini contoh edukasi, bukan rate limiter production-grade.
- Untuk production gunakan library/platform yang robust.
- Rate limit harus observable.

---

## 62. Practical Capacity Calculation Worksheet

### Input

```text
arrival_rate_normal = 200 msg/s
arrival_rate_peak = 1000 msg/s
peak_duration = 15 minutes
avg_processing_time = 100 ms
p95_processing_time = 300 ms
consumer_threads = 50
target_utilization = 70%
```

### Capacity

```text
per_thread_capacity_avg = 1 / 0.100 = 10 msg/s
raw_capacity = 50 × 10 = 500 msg/s
safe_capacity = 500 × 0.70 = 350 msg/s
```

Normal:

```text
200 < 350 => safe
```

Peak:

```text
1000 > 350 => backlog grows
```

Backlog during peak:

```text
excess = 1000 - 350 = 650 msg/s
duration = 15 × 60 = 900 s
backlog = 650 × 900 = 585,000 messages
```

After peak normal arrival resumes:

```text
drain_rate = 350 - 200 = 150 msg/s
drain_time = 585,000 / 150 = 3,900 s = 65 minutes
```

Question:

> Apakah delay 65 menit acceptable?

Jika tidak:

- increase safe capacity,
- reduce peak arrival,
- prioritize,
- split queue,
- batch/optimize processing,
- pre-stage work,
- scale downstream,
- reject/defer low-priority workload.

---

## 63. Red Flags dalam Production Review

Waspadai kalimat-kalimat ini:

1. "Queue bisa unlimited."
2. "Kalau lambat tinggal tambah consumer."
3. "DLQ nanti dicek manual."
4. "Prefetch default saja."
5. "Retry forever."
6. "Semua message satu queue agar simple."
7. "Tidak perlu monitor oldest age."
8. "Ack dulu supaya cepat."
9. "Message besar tidak masalah karena broker durable."
10. "Autoscale by CPU sudah cukup."
11. "Topic bisa jadi command bus."
12. "Priority menyelesaikan SLA."
13. "Tidak perlu load test karena broker sudah enterprise."

Kalimat-kalimat ini biasanya tanda capacity model belum matang.

---

## 64. Top 1% Heuristics

### 64.1 Queue Is a Meter, Not Just a Buffer

Queue depth adalah meter tekanan sistem.

Jika naik, sistem sedang memberi sinyal.

### 64.2 Completed Work Matters More Than Started Work

Dequeue bukan sukses. Ack/commit/business effect selesai adalah sukses.

### 64.3 Backpressure Must Protect the Bottleneck

Jika bottleneck DB, backpressure harus melindungi DB, bukan hanya broker.

### 64.4 Scaling Without Bottleneck Analysis Is Gambling

Tambah consumer tanpa tahu bottleneck bisa memperburuk incident.

### 64.5 Latency Budget Must Include Waiting Time

SLA async bukan hanya processing time.

```text
end_to_end = waiting_time + processing_time + retry_delay + downstream_delay
```

### 64.6 Retry Is Load

Retry harus dihitung sebagai traffic tambahan.

### 64.7 Prefetch Trades Throughput for Fairness and Memory

Prefetch besar bisa cepat dalam benchmark, tetapi buruk saat failure.

### 64.8 Durable Does Not Mean Infinite

Durable queue tetap punya disk, recovery, paging, dan operational limit.

### 64.9 Each Queue Needs an Owner and Runbook

Queue tanpa owner akan menjadi tempat sampah integration.

### 64.10 Capacity Is a Contract

Capacity bukan hasil tuning dadakan. Capacity adalah kontrak antara producer, broker, consumer, dan downstream.

---

## 65. Mini-Lab: Diagnose Backlog

### Scenario

```text
Queue depth naik dari 0 ke 200,000 dalam 30 menit.
Enqueue rate: 300 msg/s
Ack rate: 180 msg/s
Consumer CPU: 35%
DB connection pool: 100% active
DB p95 query latency: naik dari 50ms ke 600ms
DLQ: 0
Redelivery: rendah
Broker memory: normal
Broker disk: normal
```

### Diagnosis

Bottleneck utama kemungkinan DB.

### Jangan Lakukan

- langsung tambah consumer,
- replay DLQ,
- restart broker,
- naikkan prefetch.

### Lakukan

- throttle consumer,
- inspect DB wait/slow query,
- kurangi concurrency jika DB collapse,
- pisahkan high-priority workload,
- hitung drain time,
- komunikasikan SLA impact,
- scale consumer hanya setelah DB punya headroom.

---

## 66. Mini-Lab: Queue Looks Empty but Users Complain

### Scenario

```text
Queue depth: 0
In-flight: 50,000
Consumer prefetch/window: very high
Oldest processing age: 45 minutes
Consumer CPU: low
External API timeout: high
```

### Diagnosis

Message sudah dipindah dari broker ke consumer buffer/in-flight, bukan selesai diproses.

### Solusi

- reduce prefetch/window,
- monitor delivered/unacked,
- add external API bulkhead/rate limit,
- improve timeout/retry,
- rollback/redelivery safely if consumer stuck,
- alert on end-to-end age, not only queue depth.

---

## 67. Mini-Lab: Retry Storm

### Scenario

```text
External service down 15 minutes.
Consumer retry immediate, max attempts 10.
Queue depth naik.
External service recover.
Traffic tetap tinggi dan service down lagi.
```

### Diagnosis

Retry storm setelah recovery.

### Solusi

- exponential backoff,
- jitter,
- circuit breaker,
- retry budget,
- DLQ/parking lot,
- replay gradually,
- rate limit outbound calls.

---

## 68. Ringkasan

Backpressure and capacity engineering adalah kemampuan melihat JMS sebagai sistem tekanan, bukan sekadar API.

Yang harus diingat:

1. Queue menyerap perbedaan kecepatan, bukan menghilangkan overload.
2. Arrival rate > completion rate berarti backlog tumbuh.
3. Queue depth harus dibaca bersama rate, age, in-flight, dan SLA.
4. Prefetch/window memengaruhi throughput, fairness, memory, dan visibility.
5. Scaling consumer aman hanya jika bottleneck punya headroom.
6. Retry adalah traffic tambahan.
7. DLQ replay harus dikontrol.
8. Backpressure harus melindungi bottleneck sebenarnya.
9. Broker durability bukan infinite capacity.
10. Capacity harus didesain, diuji, dimonitor, dan punya runbook.

---

## 69. Checklist Pemahaman

Kamu memahami part ini jika bisa menjawab:

1. Apa perbedaan queue depth dan consumer lag?
2. Kenapa queue depth 0 belum tentu berarti semua work selesai?
3. Apa hubungan arrival rate, processing rate, dan backlog growth?
4. Bagaimana menggunakan Little's Law untuk sanity check?
5. Kenapa menambah consumer bisa memperburuk sistem?
6. Apa risiko prefetch/window terlalu besar?
7. Kenapa retry storm adalah capacity problem?
8. Bagaimana membedakan broker-bound vs DB-bound vs consumer-bound?
9. Metric apa yang wajib ada untuk JMS production?
10. Bagaimana menentukan drain time setelah peak?
11. Bagaimana mendesain overload policy?
12. Kenapa virtual threads tidak menghilangkan kebutuhan backpressure?

---

## 70. Referensi

- Jakarta Messaging 3.1 Specification — API contract untuk create/send/receive/read message di enterprise messaging system.
- Jakarta Messaging API Documentation — package `jakarta.jms`.
- ActiveMQ Artemis Documentation — flow control, consumer window size, address settings, paging.
- Queueing Theory / Little's Law — relationship antara average number in system, arrival rate, dan average time in system.
- Enterprise Integration Patterns — conceptual vocabulary untuk message channel, routing, dead letter, and integration flow.

---

## 71. Penutup Part 25

Part ini membangun mental model bahwa JMS capacity bukan hanya soal broker tuning.

JMS capacity adalah hasil interaksi antara:

```text
producer rate
+ broker buffering
+ dispatch policy
+ consumer concurrency
+ ack/transaction mode
+ downstream capacity
+ retry behavior
+ observability
+ operational policy
```

Engineer top-tier tidak hanya bertanya:

> "Berapa banyak consumer yang harus saya jalankan?"

Mereka bertanya:

> "Bottleneck mana yang harus saya lindungi, pressure signal mana yang valid, dan keputusan apa yang membuat sistem tetap benar saat overload?"

Pada part berikutnya, kita akan masuk ke **Performance Tuning**: producer, consumer, broker, JVM, network, dan storage secara lebih teknis dan lebih dekat ke konfigurasi/tuning nyata.

---

**Status seri:** belum selesai.  
**Progress:** Part 25 selesai dari total rencana 35 part.  
**Berikutnya:** Part 26 — Performance Tuning: Producer, Consumer, Broker, JVM, Network, Storage.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-024.md">⬅️ Part 24 — Idempotency and Deduplication Engineering: Dari API Design sampai Database Constraint</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-026.md">Part 26 — Performance Tuning: Producer, Consumer, Broker, JVM, Network, Storage ➡️</a>
</div>

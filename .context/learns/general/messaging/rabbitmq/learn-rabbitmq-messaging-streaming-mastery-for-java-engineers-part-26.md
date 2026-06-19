# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-26.md

# Part 26 — Performance Engineering and Benchmarking

> Seri: RabbitMQ, RabbitMQ Streams, dan Messaging Mastery untuk Java Engineers  
> Fokus part ini: memahami performa RabbitMQ secara sistemik, membedakan benchmark yang valid dan misleading, membuat capacity model, menjalankan PerfTest/Stream PerfTest, membaca hasil, dan menerjemahkan angka menjadi keputusan arsitektur.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan perbedaan antara **throughput**, **latency**, **tail latency**, **queue depth**, **consumer lag**, dan **broker saturation**.
2. Mengerti kenapa performa RabbitMQ tidak bisa dinilai dari satu angka “messages per second”.
3. Mendesain benchmark yang menjawab pertanyaan engineering, bukan sekadar menghasilkan angka besar.
4. Menggunakan **RabbitMQ PerfTest** untuk workload AMQP 0-9-1.
5. Menggunakan **RabbitMQ Stream PerfTest** untuk workload RabbitMQ Streams.
6. Menganalisis dampak:
   - message size,
   - durable queue,
   - persistent message,
   - publisher confirms,
   - consumer acknowledgements,
   - prefetch,
   - batching,
   - quorum replication,
   - stream retention,
   - disk I/O,
   - network bandwidth,
   - serialization cost,
   - Java concurrency.
7. Membedakan bottleneck di producer, broker, consumer, disk, network, CPU, GC, dan database downstream.
8. Menyusun capacity planning worksheet untuk sistem RabbitMQ produksi.
9. Menentukan apakah masalah performa harus diselesaikan dengan tuning, topology redesign, workload segregation, scaling, atau mengganti primitive.

---

## 2. Premis Penting: RabbitMQ Performance Bukan Satu Dimensi

Banyak engineer bertanya:

> “RabbitMQ kuat berapa message per second?”

Pertanyaan itu kurang tepat.

Pertanyaan yang lebih benar:

> “Untuk message size tertentu, durability tertentu, queue type tertentu, topology tertentu, jumlah producer/consumer tertentu, confirm/ack policy tertentu, storage tertentu, dan SLO latency tertentu, berapa throughput stabil yang bisa dipertahankan tanpa backlog tidak terkendali?”

RabbitMQ bukan hanya pipe byte. Ia melakukan beberapa pekerjaan sekaligus:

1. menerima koneksi,
2. menerima publish,
3. routing via exchange,
4. menulis message ke memory/disk,
5. mereplikasi untuk quorum queue atau stream,
6. mengirim delivery ke consumer,
7. melacak unacked delivery,
8. menerima ack,
9. melakukan redelivery bila perlu,
10. menerapkan TTL, DLX, queue limit, retention, policy,
11. mengekspos metrics,
12. menjaga broker tetap stabil melalui flow control.

Jadi angka throughput selalu terikat pada **semantics**.

### 2.1 Semantic Cost Model

Setiap jaminan punya biaya.

| Requirement | Biaya umum |
|---|---|
| Persistent message | disk write / fsync behavior / storage pressure |
| Publisher confirm | publisher harus menunggu broker mengakui write path |
| Consumer ack | broker harus menyimpan state unacked |
| Quorum queue | replication, consensus, leader/follower traffic |
| Stream | append log, replication, retention, offset management |
| DLQ/retry | message movement tambahan |
| Ordering kuat | paralelisme lebih rendah |
| Large message | memory pressure, disk pressure, network pressure, GC pressure |
| High fanout | routing dan delivery multiplication |
| Per-message transaction | latency besar |

Top 1% engineer tidak bertanya “setting apa yang paling cepat?”, tetapi:

> “Semantics apa yang benar-benar dibutuhkan oleh workload ini, dan berapa biaya performanya?”

---

## 3. Vocabulary Performa yang Wajib Presisi

### 3.1 Throughput

Jumlah message yang berhasil diproses per unit waktu.

Bisa berarti:

- publish rate,
- confirm rate,
- delivery rate,
- ack rate,
- end-to-end processed rate,
- business completed rate.

Jangan campur.

Contoh:

```text
publish rate     = 20,000 msg/s
confirm rate     = 19,800 msg/s
deliver rate     = 18,000 msg/s
ack rate         = 12,000 msg/s
business success = 8,000 msg/s
```

Yang menentukan backlog bukan publish rate, tetapi selisih antara message masuk dan message selesai.

```text
backlog_growth = publish_rate - ack_rate
```

Jika publish 20k/s dan ack 12k/s, backlog bertambah 8k/s.

Dalam 10 menit:

```text
8,000 * 600 = 4,800,000 messages
```

Ini bukan “RabbitMQ lambat”. Ini sistem overload.

### 3.2 Latency

Latency bukan satu angka.

Minimal pisahkan:

1. **publish latency**: waktu producer mengirim publish call.
2. **confirm latency**: waktu sampai broker mengirim publisher confirm.
3. **queueing latency**: waktu message menunggu di queue.
4. **delivery latency**: waktu dari ready ke consumer delivery.
5. **processing latency**: waktu handler bisnis memproses message.
6. **ack latency**: waktu sampai ack diterima broker.
7. **end-to-end latency**: sejak event terjadi sampai efek bisnis selesai.

RabbitMQ bisa cepat, tetapi end-to-end lambat karena consumer memanggil database lambat.

### 3.3 Tail Latency

Average latency sering menipu.

Yang penting:

- p50,
- p90,
- p95,
- p99,
- p99.9.

Messaging system sering terlihat sehat di average tetapi buruk di tail.

Contoh:

```text
p50  = 20 ms
p95  = 150 ms
p99  = 4 s
p999 = 45 s
```

Ini berarti sebagian kecil message mengalami delay besar. Dalam workflow enforcement, sebagian kecil delay bisa berarti escalation terlambat atau SLA breach.

### 3.4 Queue Depth

Jumlah message yang berada di queue.

RabbitMQ biasanya membagi:

- **ready**: message tersedia untuk dikirim ke consumer,
- **unacked**: message sudah dikirim ke consumer tetapi belum di-ack.

Interpretasi:

```text
ready tinggi      -> consumer tidak mengejar input / consumer down / prefetch terlalu rendah / routing overload
unacked tinggi    -> consumer sedang memproses lambat / prefetch terlalu tinggi / handler macet
ready + unacked   -> total backlog
```

### 3.5 Oldest Message Age

Queue depth tanpa age kurang berguna.

100.000 message bisa normal jika workload batch cepat. 100 message bisa fatal jika oldest age sudah 2 jam untuk SLA 5 menit.

SLO messaging lebih baik berbasis:

```text
oldest_message_age <= allowed_processing_delay
```

bukan hanya:

```text
queue_depth <= arbitrary_number
```

### 3.6 Consumer Utilization

Consumer utilization menunjukkan seberapa sering queue bisa langsung mengirim message ke consumer.

Interpretasi kasar:

- utilization rendah + ready tinggi: consumer tidak cukup / consumer lambat / prefetch/concurrency bottleneck.
- utilization tinggi + ready rendah: queue relatif sehat.
- utilization rendah + ready rendah: tidak ada workload atau consumer idle.

### 3.7 Saturation

Saturation adalah kondisi ketika resource kritis mencapai batas:

- CPU,
- disk IOPS,
- disk throughput,
- memory,
- network,
- file descriptors,
- Erlang scheduler,
- connection/channel count,
- downstream DB connection pool,
- consumer thread pool.

Benchmark yang tidak mengukur saturation tidak menjawab kapasitas.

---

## 4. Performance Mental Model RabbitMQ

Gunakan pipeline berikut:

```text
Producer
  -> client serialization
  -> TCP connection
  -> broker ingress
  -> exchange routing
  -> queue/stream write path
  -> optional replication
  -> publisher confirm
  -> queue ready state
  -> consumer delivery
  -> consumer processing
  -> consumer ack
  -> broker cleanup / offset / retention
```

Setiap stage punya bottleneck sendiri.

### 4.1 Producer-Side Bottleneck

Gejala:

- publish call lambat,
- in-flight confirm menumpuk,
- confirm latency naik,
- publisher blocked,
- CPU producer tinggi,
- GC producer tinggi,
- serialization lambat,
- network client penuh.

Penyebab umum:

- publish synchronous per message,
- confirm ditunggu satu per satu,
- message terlalu besar,
- JSON serialization mahal,
- compression salah tempat,
- terlalu banyak connection/channel,
- broker flow control,
- network latency tinggi.

### 4.2 Broker-Side Bottleneck

Gejala:

- memory/disk alarm,
- queue process CPU tinggi,
- confirm latency naik,
- delivery rate turun,
- redelivery rate naik,
- management UI lambat,
- node imbalance,
- disk utilization tinggi,
- network antar-node tinggi.

Penyebab umum:

- queue terlalu panjang,
- quorum replication overload,
- stream retention terlalu besar untuk disk,
- high fanout topology,
- retry storm,
- unbounded prefetch,
- large messages,
- terlalu banyak queues,
- hot queue leader.

### 4.3 Consumer-Side Bottleneck

Gejala:

- ready naik,
- unacked tinggi,
- ack rate lebih rendah dari deliver rate,
- consumer CPU tinggi,
- DB pool exhausted,
- handler latency naik,
- repeated redelivery.

Penyebab umum:

- handler lambat,
- downstream API lambat,
- DB transaction lambat,
- prefetch terlalu tinggi,
- concurrency terlalu rendah,
- concurrency terlalu tinggi dan membuat DB overload,
- poison message,
- lock contention,
- idempotency table bottleneck.

---

## 5. Performance Invariants

Pegang invariant berikut saat melakukan tuning.

### Invariant 1 — Broker Tidak Bisa Menyelamatkan Consumer yang Lambat

Jika consumer hanya mampu 5.000 msg/s dan producer publish 20.000 msg/s, backlog akan tumbuh.

Tuning broker tidak mengubah kapasitas bisnis consumer.

### Invariant 2 — Queue Depth Adalah Gejala, Bukan Root Cause

Queue depth naik karena:

```text
arrival_rate > completion_rate
```

Yang harus dianalisis:

- kenapa arrival naik?
- kenapa completion turun?
- apakah consumer down?
- apakah downstream lambat?
- apakah retry storm?
- apakah topology fanout memperbanyak message?

### Invariant 3 — Ordering dan Parallelism Saling Menekan

Semakin kuat ordering, semakin terbatas parallelism.

Jika butuh ordering per case, partition by `caseId`, bukan satu global queue untuk semua kasus.

### Invariant 4 — Durability dan Replication Tidak Gratis

Persistent message + quorum queue + confirms memberikan safety lebih tinggi, tetapi biaya disk/network lebih besar.

Jangan benchmark non-persistent classic queue lalu mengklaim kapasitas untuk quorum production workload.

### Invariant 5 — Large Message Merusak Banyak Layer Sekaligus

Large message berdampak pada:

- client memory,
- broker memory,
- disk throughput,
- network,
- GC,
- management inspection,
- DLQ replay,
- retry cost,
- tracing/logging.

Biasanya payload besar lebih baik disimpan di object storage/database, lalu message membawa reference.

### Invariant 6 — Benchmark Harus Mengukur Stable Throughput

Angka throughput 2 menit tidak cukup.

Perlu melihat:

- steady state,
- warm-up,
- disk burst depletion,
- GC cycle,
- queue depth stability,
- confirm latency stability,
- tail latency,
- broker alarm.

---

## 6. Queue Type dan Performance Cost

### 6.1 Classic Queue

Classic queue cocok untuk:

- non-replicated local workload,
- temporary queue,
- short-lived queue,
- low criticality workload,
- development/test.

Performance bisa tinggi pada skenario sederhana, tetapi untuk HA/data safety modern, classic queue bukan default yang tepat.

Cost model:

```text
write cost    = local queue process + optional disk persistence
replication   = none
safety        = depends on durability, persistence, and node survival
```

### 6.2 Quorum Queue

Quorum queue cocok untuk:

- durable command queue,
- work queue critical,
- replicated processing queue,
- workload yang membutuhkan data safety.

Cost model:

```text
write cost    = leader write + replication to followers + majority confirmation
confirm       = setelah write path aman sesuai quorum semantics
network       = antar-node signifikan
latency       = lebih tinggi daripada local-only path
safety        = jauh lebih baik untuk replicated queue
```

Important performance implication:

- quorum queue sering trade latency untuk safety/throughput stabil,
- queue leader placement penting,
- disk dan network antar-node penting,
- publisher confirms dan consumer ack adalah bagian dari flow control stabil.

### 6.3 Stream

Stream cocok untuk:

- append-only event log,
- audit trail,
- replay,
- high-throughput append,
- multiple independent consumers,
- retention-based history.

Cost model:

```text
write cost    = append log + replication
read cost     = sequential read by offset
retention     = disk capacity planning mandatory
consumption   = non-destructive
```

Stream bukan pengganti queue untuk semua work distribution. Ia ideal ketika history/replay adalah requirement utama.

### 6.4 Super Stream

Super stream cocok untuk:

- throughput lebih tinggi daripada single stream,
- partitioned ordering,
- consumer group scaling,
- event history besar.

Cost model:

```text
write cost    = per partition stream
ordering      = per partition, not global
hot key risk  = depends on partition key
operability   = lebih kompleks daripada single stream
```

---

## 7. Publisher Performance

### 7.1 Publish Tanpa Confirm

Paling cepat secara apparent, tetapi tidak aman.

```text
producer -> broker socket buffer -> return immediately
```

Masalah:

- producer tidak tahu apakah broker menerima message dengan aman,
- crash/network failure bisa membuat message hilang,
- benchmark terlihat tinggi tetapi semantics berbeda dari produksi.

Gunakan hanya untuk workload yang memang boleh kehilangan message.

### 7.2 Synchronous Confirm per Message

Paling sederhana, tetapi throughput rendah.

```java
channel.confirmSelect();
channel.basicPublish(exchange, routingKey, props, body);
channel.waitForConfirmsOrDie(5_000);
```

Cost:

```text
1 publish -> wait -> 1 confirm -> next publish
```

Ini membatasi throughput oleh round-trip/confirm latency.

### 7.3 Batched Confirm

Lebih baik.

```java
channel.confirmSelect();

int batchSize = 500;
int outstanding = 0;

for (Message msg : messages) {
    channel.basicPublish(exchange, routingKey, props(msg), msg.body());
    outstanding++;

    if (outstanding >= batchSize) {
        channel.waitForConfirmsOrDie(5_000);
        outstanding = 0;
    }
}

if (outstanding > 0) {
    channel.waitForConfirmsOrDie(5_000);
}
```

Trade-off:

- throughput naik,
- latency per batch naik,
- failure handling lebih kompleks,
- jika batch gagal, perlu tahu message mana yang statusnya unknown.

### 7.4 Asynchronous Confirm

Paling cocok untuk publisher throughput tinggi.

Core idea:

```text
publish message
store sequenceNumber -> message metadata
receive ack/nack asynchronously
remove confirmed messages
retry/mark failed on nack/timeout
```

Pseudo state:

```text
NEW -> PUBLISHED_IN_FLIGHT -> CONFIRMED
                         -> NACKED
                         -> TIMED_OUT_UNKNOWN
```

Bounded in-flight wajib.

```text
max_in_flight = 50_000
```

Jika in-flight terlalu besar:

- memory producer naik,
- recovery sulit,
- confirm timeout massal,
- duplicate retry meningkat.

### 7.5 Publisher Confirm Latency Sebagai Signal

Confirm latency naik berarti write path broker melambat.

Penyebab:

- disk lambat,
- quorum replication lambat,
- stream replica lambat,
- broker flow control,
- network antar-node penuh,
- queue terlalu panjang,
- node leader overload.

Jangan hanya menambah producer thread ketika confirm latency naik. Itu sering memperburuk overload.

---

## 8. Consumer Performance

### 8.1 Ack Mode

Auto ack terlihat cepat tetapi berisiko data loss.

Manual ack memberi safety, tetapi menambah broker state.

Performance decision:

```text
auto ack     -> fastest apparent, weakest reliability
manual ack   -> production default for meaningful work
```

### 8.2 Prefetch

Prefetch menentukan jumlah delivery unacked yang boleh berada di consumer.

```java
channel.basicQos(100);
```

Mental model:

```text
max_unacked_per_consumer = prefetch
```

Jika prefetch terlalu rendah:

- consumer sering idle,
- throughput rendah,
- network round-trip lebih terasa.

Jika prefetch terlalu tinggi:

- message menumpuk di consumer,
- fairness buruk,
- redelivery setelah crash besar,
- memory consumer naik,
- ordering makin kabur,
- slow handler menyembunyikan backlog di unacked.

### 8.3 Concurrency

Total in-flight approximate:

```text
total_in_flight = consumer_instances * consumers_per_instance * prefetch
```

Contoh:

```text
10 pods * 4 listener threads * prefetch 250 = 10,000 unacked messages
```

Pertanyaan:

- Apakah DB sanggup 10.000 concurrent/near-concurrent business operations?
- Apakah redelivery 10.000 message setelah crash bisa diterima?
- Apakah handler idempotent?
- Apakah memory cukup?

### 8.4 Handler Latency Menentukan Throughput

Approximation:

```text
consumer_capacity = concurrency / average_processing_time_seconds
```

Contoh:

```text
concurrency = 100
avg processing = 50 ms = 0.05 s
capacity = 100 / 0.05 = 2,000 msg/s
```

Jika target 10.000 msg/s, kamu butuh:

```text
required_concurrency = target_rate * avg_processing_time_seconds
required_concurrency = 10,000 * 0.05 = 500
```

Tapi concurrency 500 mungkin menghancurkan DB. Maka solusi bukan sekadar menaikkan listener thread.

### 8.5 Consumer CPU vs I/O Bound

CPU-bound handler:

- JSON transform berat,
- crypto,
- compression,
- rule evaluation kompleks.

Solusi:

- optimize code,
- parallelism sesuai CPU core,
- avoid excessive context switching,
- batch where possible.

I/O-bound handler:

- database,
- HTTP API,
- object storage,
- external service.

Solusi:

- tune pool,
- timeout,
- circuit breaker,
- bulkhead,
- async client jika layak,
- reduce round trips,
- cache carefully,
- split workload.

---

## 9. Message Size Impact

Message size adalah salah satu faktor performa paling besar.

### 9.1 Small Message

Contoh: 512 bytes sampai 2 KB.

Karakteristik:

- throughput tinggi,
- routing overhead dominan,
- serialization ringan,
- disk write lebih efisien,
- network lebih kecil.

### 9.2 Medium Message

Contoh: 10 KB sampai 100 KB.

Karakteristik:

- throughput mulai turun,
- network/disk lebih terasa,
- GC pressure naik,
- DLQ/retry lebih mahal.

### 9.3 Large Message

Contoh: > 1 MB.

Karakteristik:

- buruk untuk broker,
- memory pressure,
- disk pressure,
- network pressure,
- slow management operations,
- retry/DLQ mahal,
- consumer memory spike,
- tracing/logging risk.

Pattern yang lebih sehat:

```json
{
  "messageId": "msg-123",
  "messageType": "EvidenceDocumentSubmitted",
  "schemaVersion": 1,
  "payload": {
    "caseId": "CASE-2026-0001",
    "documentId": "DOC-991",
    "storageUri": "s3://bucket/evidence/DOC-991",
    "sha256": "...",
    "contentType": "application/pdf",
    "sizeBytes": 12873642
  }
}
```

Message membawa metadata dan reference, bukan file.

---

## 10. Batching

Batching meningkatkan throughput dengan mengurangi overhead per message.

Tetapi batching mengubah failure semantics.

### 10.1 Producer Batching

Bentuk:

- batch confirm,
- aggregate multiple logical records into one message,
- stream batching.

Trade-off:

| Benefit | Risk |
|---|---|
| throughput naik | latency per item naik |
| overhead turun | partial failure lebih sulit |
| disk/network lebih efisien | replay/idempotency lebih kompleks |
| confirms lebih efisien | message terlalu besar jika batch berlebihan |

### 10.2 Consumer Batching

Consumer bisa memproses batch untuk DB efficiency.

Tetapi RabbitMQ queue delivery dasarnya per message.

Risiko:

- ack batch setelah semua sukses bisa menahan unacked lama,
- partial failure butuh strategi,
- ordering dan retry lebih rumit.

Pattern:

```text
receive N messages
process in DB batch
if all success -> ack all
if partial failure -> ack success? reject failed? republish? quarantine?
```

Hati-hati: `basicAck(deliveryTag, true)` meng-ack semua delivery tag sebelumnya di channel yang sama. Ini powerful tetapi berbahaya jika channel dipakai untuk banyak flow.

---

## 11. Disk dan Storage Engineering

RabbitMQ durable workload sangat dipengaruhi storage.

### 11.1 Disk Metrics yang Penting

Pantau:

- disk utilization,
- write IOPS,
- read IOPS,
- write throughput MB/s,
- read throughput MB/s,
- fsync latency,
- disk queue depth,
- free disk,
- burst credit jika cloud disk.

### 11.2 Cloud Disk Trap

Banyak cloud disk punya burst behavior.

Benchmark 10 menit bisa terlihat bagus karena burst credit masih ada. Setelah 30-60 menit, throughput jatuh.

Benchmark produksi harus cukup lama untuk melewati fase burst.

### 11.3 Quorum Queue Storage

Quorum queue menulis replicated log.

Implication:

- disk tiap replica penting,
- network antar-node penting,
- leader overload memengaruhi latency,
- slow disk pada follower bisa memengaruhi cluster behavior.

### 11.4 Stream Storage

Stream adalah append log dengan retention.

Capacity estimate:

```text
daily_bytes = message_rate_per_sec * avg_message_size_bytes * 86400
retention_bytes = daily_bytes * retention_days * replication_factor
```

Contoh:

```text
rate = 5,000 msg/s
size = 1 KB
retention = 7 days
replication = 3

daily = 5,000 * 1,024 * 86,400
      = 442,368,000,000 bytes
      ≈ 412 GiB/day

retention replicated ≈ 412 GiB * 7 * 3
                    ≈ 8.4 TiB
```

Ini belum termasuk overhead.

---

## 12. Network Engineering

Network sering menjadi bottleneck tersembunyi.

### 12.1 Producer/Broker Network

Bandwidth ingress:

```text
ingress_bytes_per_sec = publish_rate * avg_message_size
```

Dengan overhead protocol, TLS, headers, frame, actual lebih tinggi.

### 12.2 Broker/Consumer Network

Bandwidth egress:

```text
egress_bytes_per_sec = deliver_rate * avg_message_size * fanout_factor
```

Fanout 10 berarti satu message published bisa menjadi 10 delivery ke queue berbeda.

### 12.3 Inter-Node Network

Quorum/stream replication menambah traffic antar-node.

Approximation sederhana:

```text
replication_traffic ~= publish_bytes * (replication_factor - 1)
```

Belum termasuk protocol overhead.

### 12.4 TLS Cost

TLS memberi security tetapi menambah CPU cost.

Jangan disable TLS untuk performa tanpa threat model. Lebih baik:

- ukur CPU overhead,
- gunakan modern JVM,
- tune cipher sesuai platform,
- pastikan hardware cukup,
- offload hanya jika architecture mengizinkan.

---

## 13. Connection dan Channel Tuning

### 13.1 Jangan Connection per Message

Connection RabbitMQ mahal.

Anti-pattern:

```java
for (Message m : messages) {
    Connection c = factory.newConnection();
    Channel ch = c.createChannel();
    ch.basicPublish(...);
    ch.close();
    c.close();
}
```

Gunakan long-lived connection.

### 13.2 Channel per Thread

Channel tidak dirancang untuk sembarang shared concurrent publish dari banyak thread.

Pattern aman:

- satu channel per publisher thread,
- channel pool dengan disiplin ownership,
- Spring `CachingConnectionFactory`,
- bounded publisher concurrency.

### 13.3 Terlalu Banyak Connection/Channel

Masalah:

- memory broker naik,
- file descriptor naik,
- management overhead,
- scheduler overhead,
- observability noisy.

Targetnya bukan “sebanyak mungkin”, tetapi “cukup untuk concurrency yang dibutuhkan”.

---

## 14. Exchange dan Routing Performance

Exchange routing biasanya bukan bottleneck utama untuk workload sederhana, tetapi bisa menjadi signifikan pada topology kompleks.

### 14.1 Direct Exchange

Routing paling sederhana:

```text
routing_key exact match
```

Cocok untuk command queue dan deterministic routing.

### 14.2 Fanout Exchange

Fanout mengirim ke semua binding.

Cost:

```text
publish_count * bound_queue_count
```

Jika satu event difanout ke 50 queue, broker harus menangani 50 enqueue/delivery paths.

### 14.3 Topic Exchange

Topic exchange powerful, tetapi wildcard berlebihan bisa membuat topology sulit dipahami.

Performance biasanya baik, tetapi design risk lebih besar:

- accidental over-routing,
- binding explosion,
- wildcard terlalu lebar,
- sulit audit.

### 14.4 Headers Exchange

Headers exchange bisa berguna, tetapi jangan jadikan rule engine kompleks di broker.

Jika routing logic semakin kompleks, pertimbangkan:

- routing key taxonomy lebih baik,
- application router,
- separate exchange per bounded context.

---

## 15. Benchmarking: Pertanyaan yang Harus Dijawab

Benchmark harus mulai dari pertanyaan.

Contoh pertanyaan buruk:

> “RabbitMQ bisa berapa msg/s?”

Contoh pertanyaan baik:

> “Dengan quorum queue 3 node, persistent JSON message 2 KB, publisher confirms async, 10 producer instances, 20 consumer instances, prefetch 100, handler mock 20 ms, apakah sistem bisa mempertahankan 8.000 completed msg/s selama 2 jam dengan p99 end-to-end latency < 5 detik dan queue depth stabil?”

### 15.1 Benchmark Dimensions

Dokumentasikan:

| Dimension | Example |
|---|---|
| RabbitMQ version | 4.x |
| Queue type | quorum |
| Node count | 3 |
| Replica count | 3 |
| Message size | 2 KB |
| Persistence | persistent |
| Publisher confirms | async confirms |
| Consumer ack | manual ack |
| Prefetch | 100 |
| Producer count | 10 |
| Consumer count | 20 |
| Exchange type | topic |
| Routing fanout | 1 or N |
| TLS | enabled/disabled |
| Disk type | gp3/io2/local SSD/etc |
| Test duration | 2 hours |
| Warm-up | 10 minutes |
| Workload shape | steady/spike/burst |
| Downstream simulation | sleep/db/http |

### 15.2 Benchmark Phases

1. Baseline broker only.
2. Baseline producer publish + confirm.
3. Baseline consumer delivery + ack.
4. End-to-end with handler mock.
5. End-to-end with real serialization.
6. End-to-end with database/API dependency.
7. Failure test: broker restart, consumer crash, producer retry.
8. Soak test.
9. Spike test.
10. Recovery test after backlog.

---

## 16. RabbitMQ PerfTest untuk AMQP Workload

RabbitMQ PerfTest adalah tool resmi untuk load testing AMQP 0-9-1 workload.

Gunakan untuk:

- mengukur broker baseline,
- membandingkan queue type,
- menguji confirms,
- menguji ack/prefetch,
- menguji message size,
- menguji producer/consumer count,
- menjalankan soak test.

### 16.1 Running PerfTest via Docker

Contoh umum:

```bash
 docker run --rm pivotalrabbitmq/perf-test:latest \
  --uri amqp://guest:guest@host.docker.internal:5672/%2f \
  --exchange perf.exchange \
  --queue perf.queue \
  --producers 4 \
  --consumers 4 \
  --rate 10000 \
  --size 1024 \
  --auto-delete false
```

Catatan: image/tag bisa berubah; di lingkungan produksi gunakan versi tool yang dipin.

### 16.2 Running PerfTest JAR

Contoh:

```bash
java -jar perf-test.jar \
  --uri amqp://guest:guest@localhost:5672/%2f \
  --queue perf.quorum.q \
  --producers 8 \
  --consumers 8 \
  --rate 20000 \
  --size 2048 \
  --confirm 100 \
  --qos 100 \
  --flag persistent
```

Interpretasi umum:

- `--rate`: target publish rate.
- `--size`: message size bytes.
- `--producers`: jumlah producer.
- `--consumers`: jumlah consumer.
- `--confirm`: publisher confirm mode/batch tergantung versi PerfTest.
- `--qos`: consumer prefetch.
- `--flag persistent`: persistent message.

Selalu cek help tool versi yang dipakai:

```bash
java -jar perf-test.jar --help
```

### 16.3 Benchmark Quorum Queue

Deklarasikan queue type quorum.

Contoh parameter bisa berbeda antar versi, tetapi konsepnya:

```bash
java -jar perf-test.jar \
  --uri amqp://guest:guest@localhost:5672/%2f \
  --queue perf.qq \
  --queue-args x-queue-type=quorum \
  --producers 4 \
  --consumers 4 \
  --rate 5000 \
  --size 1024 \
  --flag persistent \
  --confirm 100 \
  --qos 100 \
  --time 1800
```

Yang harus diamati:

- publish rate aktual,
- confirm latency,
- ack rate,
- queue depth,
- node disk IO,
- inter-node network,
- leader placement,
- memory watermark,
- redelivery count.

### 16.4 Benchmark Fanout

Gunakan beberapa queue binding ke exchange.

Measure:

```text
published messages != enqueued messages
```

Jika fanout 10:

```text
1,000 publish/s -> 10,000 enqueue/s
```

Jangan salah membaca kapasitas.

---

## 17. RabbitMQ Stream PerfTest

Untuk RabbitMQ Streams via stream protocol, gunakan Stream PerfTest, bukan AMQP PerfTest.

Gunakan untuk:

- append throughput,
- stream consumer throughput,
- super stream benchmark,
- stream replication impact,
- offset/replay workload,
- message size impact.

Contoh konseptual:

```bash
java -jar stream-perf-test.jar \
  --uris rabbitmq-stream://localhost:5552 \
  --stream perf.stream \
  --producers 4 \
  --consumers 4 \
  --rate 100000 \
  --size 1024 \
  --time 1800
```

Untuk super stream, biasanya ada parameter khusus tergantung versi tool.

Selalu cek:

```bash
java -jar stream-perf-test.jar --help
```

### 17.1 Stream Metrics yang Harus Dilihat

- publish rate,
- confirm rate,
- append latency,
- consumer read rate,
- consumer lag,
- disk write throughput,
- disk read throughput,
- retention size,
- replica health,
- partition hot spot.

### 17.2 Stream Benchmark Trap

Stream bisa sangat cepat untuk append/read sequential, tetapi:

- replay consumer bisa membanjiri downstream,
- retention disk bisa sangat besar,
- filtering tidak sama dengan routing isolation,
- global ordering tidak ada pada super stream,
- consumer offset bukan business success.

---

## 18. Benchmark Scenarios yang Wajib Kamu Punya

### Scenario A — Basic Work Queue Baseline

Tujuan: tahu kapasitas minimal non-replicated/simple.

```text
queue type        = classic or quorum depending target
message size      = 1 KB
publish confirms  = enabled
consumer ack      = enabled
prefetch          = 100
producer count    = 4
consumer count    = 4
handler           = no-op
```

### Scenario B — Realistic Command Queue

```text
queue type        = quorum
message size      = realistic p50/p95
persistent        = yes
confirms          = async/batched
manual ack        = yes
handler           = DB transaction simulation
retry             = disabled for baseline
```

Measure:

- completed msg/s,
- DB latency,
- confirm latency,
- queue age,
- p99 end-to-end.

### Scenario C — Retry Storm

Simulasikan 10% transient failure.

Measure:

- retry queue depth,
- DLQ rate,
- redelivery rate,
- broker CPU,
- consumer utilization,
- downstream pressure.

Tujuan: tahu apakah retry policy aman.

### Scenario D — Fanout Event Notification

```text
1 topic exchange
N bound queues
message size 2 KB
persistent
consumer ack
```

Measure multiplication factor.

### Scenario E — Audit Stream

```text
stream/super stream
message size 1-5 KB
retention 7-30 days modeled
producer confirms
consumer replay
```

Measure:

- append throughput,
- replay throughput,
- disk growth,
- lag.

### Scenario F — Backlog Recovery

Buat backlog sengaja:

```text
stop consumers for 30 minutes
publish normal traffic
start consumers
measure catch-up time
```

Key formula:

```text
catch_up_time = backlog_size / (consumer_capacity - live_arrival_rate)
```

Jika live arrival 10k/s dan consumer capacity 12k/s, backlog recovery hanya 2k/s. Backlog 10 juta message butuh:

```text
10,000,000 / 2,000 = 5,000 s ≈ 83 minutes
```

---

## 19. Capacity Planning Worksheet

Gunakan worksheet ini sebelum produksi.

### 19.1 Input Workload

```text
Workload name:
Message type:
Queue/stream type:
Criticality:
Loss tolerance:
Duplicate tolerance:
Ordering requirement:
Replay requirement:
Retention requirement:
```

### 19.2 Traffic Shape

```text
Average publish rate:
Peak publish rate:
Burst duration:
Daily volume:
Fanout factor:
Message p50 size:
Message p95 size:
Message p99 size:
```

### 19.3 Consumer Processing

```text
Average handler latency:
P95 handler latency:
P99 handler latency:
External dependencies:
DB calls per message:
HTTP calls per message:
CPU-bound or I/O-bound:
Idempotency cost:
```

### 19.4 Reliability Semantics

```text
Publisher confirms: yes/no
Persistent message: yes/no
Manual ack: yes/no
Queue type: classic/quorum/stream
Replication factor:
DLQ: yes/no
Retry strategy:
Max attempts:
Parking lot:
```

### 19.5 SLO

```text
Max end-to-end p95 latency:
Max end-to-end p99 latency:
Max oldest message age:
Max DLQ age:
Recovery time objective:
Recovery point objective:
```

### 19.6 Derived Numbers

```text
incoming_bytes_per_sec = peak_rate * avg_message_size * fanout_factor
consumer_capacity = concurrency / avg_processing_time
required_concurrency = target_rate * avg_processing_time
backlog_growth = arrival_rate - completion_rate
catch_up_capacity = completion_rate - arrival_rate
stream_daily_bytes = rate * avg_size * 86400
stream_retention_bytes = daily_bytes * days * replication_factor
```

---

## 20. Example Capacity Model: Regulatory Case Workflow

### 20.1 Scenario

Workload: `EvidenceSubmittedEvent`

```text
avg rate         = 500 msg/s
peak rate        = 5,000 msg/s
burst duration   = 15 minutes
message size     = 3 KB average, 12 KB p95
fanout           = 4 queues
queue type       = quorum for work queues
stream           = audit stream
handler avg      = 40 ms
handler p95      = 200 ms
SLO p99          = under 2 minutes
```

### 20.2 Broker Ingress

Published bytes at peak:

```text
5,000 * 3 KB = 15 MB/s ingress
```

Fanout enqueue logical work:

```text
5,000 * 4 = 20,000 queue enqueues/s
```

This is not a 5,000 msg/s system anymore. It is a 20,000 enqueue/s broker workload plus stream append.

### 20.3 Consumer Capacity

For each queue, suppose peak effective rate is 5,000 msg/s.

Average handler 40 ms:

```text
required_concurrency = 5,000 * 0.04 = 200
```

Per consumer service:

```text
pods = 20
threads per pod = 10
prefetch = 20
```

Total thread concurrency:

```text
20 * 10 = 200
```

Total possible unacked:

```text
20 * 10 * 20 = 4,000
```

Question:

- Is DB okay with 200 concurrent operations?
- Is 4,000 unacked acceptable on crash?
- Is idempotency table indexed well?
- Is handler p95 200 ms under load, or only in local test?

### 20.4 Backlog During Burst

If consumer can process only 3,000 msg/s while peak arrival is 5,000 msg/s:

```text
backlog_growth = 2,000 msg/s
burst = 15 min = 900 s
backlog = 1,800,000 messages
```

After burst, avg arrival returns to 500 msg/s. If consumer remains 3,000 msg/s:

```text
catch_up_capacity = 3,000 - 500 = 2,500 msg/s
catch_up_time = 1,800,000 / 2,500 = 720 s = 12 minutes
```

Total delay can be acceptable if SLA allows it.

If arrival remains 3,000 msg/s, catch-up capacity is zero.

---

## 21. Java Microbenchmark Trap

Jangan menyimpulkan RabbitMQ lambat jika Java handler lambat.

### 21.1 Common Java Bottlenecks

- Jackson object mapping terlalu mahal,
- logging body besar,
- synchronized block global,
- blocking HTTP client tanpa timeout,
- DB pool kecil,
- connection leak,
- thread pool queue unbounded,
- GC pressure karena byte array besar,
- excessive object allocation,
- bad idempotency query,
- no batching for writes,
- lock per tenant/case terlalu lebar.

### 21.2 Measure Handler Separately

Buat benchmark handler tanpa broker:

```java
long start = System.nanoTime();
handler.handle(message);
long elapsedMicros = (System.nanoTime() - start) / 1_000;
```

Tapi jangan hanya manual timing. Gunakan metrics:

```text
handler.duration{message_type, outcome}
idempotency.lookup.duration
business.db.duration
external.api.duration
ack.duration
```

### 21.3 Thread Pool Backpressure

Anti-pattern:

```java
listener receives message
submits to unbounded executor
acks immediately
```

Ini menghilangkan RabbitMQ backpressure dan memindahkan backlog ke memory aplikasi.

Lebih aman:

```text
listener capacity bounded
prefetch bounded
ack after successful processing
executor queue bounded
rejection means nack/retry/backpressure
```

---

## 22. Performance Tuning Levers

### 22.1 Publisher Levers

| Lever | Effect | Risk |
|---|---|---|
| async confirms | throughput naik | complexity naik |
| confirm batching | throughput naik | failure granularity turun |
| bounded in-flight | stabilitas naik | throughput cap |
| more publisher channels | parallelism naik | broker overhead |
| smaller messages | latency/throughput membaik | perlu external storage |
| reduce fanout | broker load turun | architecture change |
| route to partitions | hot queue turun | ordering/global complexity |

### 22.2 Consumer Levers

| Lever | Effect | Risk |
|---|---|---|
| increase prefetch | throughput naik sampai titik tertentu | unacked/memory/redelivery besar |
| increase concurrency | throughput naik jika downstream kuat | DB/API overload |
| optimize handler | capacity naik | engineering effort |
| batch DB writes | throughput naik | partial failure complexity |
| split slow workload | isolation naik | topology lebih kompleks |
| idempotency index | duplicate handling cepat | storage overhead |
| reduce ack delay | unacked turun | must preserve correctness |

### 22.3 Broker Levers

| Lever | Effect | Risk |
|---|---|---|
| faster disk | durable throughput naik | cost |
| more nodes | HA/distribution naik | quorum overhead/ops complexity |
| leader distribution | hot spot turun | placement management |
| queue sharding | parallelism naik | ordering complexity |
| stream/super stream | append/replay throughput naik | semantic shift |
| policies for TTL/limit | overload guardrail | message loss/dead-letter if wrong |
| workload isolation | noisy neighbor turun | more topology/admin |

---

## 23. Reading Benchmark Results

### 23.1 Healthy Result

```text
publish rate ~= confirm rate ~= deliver rate ~= ack rate
queue depth stable
oldest message age stable/low
confirm latency stable
p99 latency within SLO
no memory/disk alarm
CPU/disk/network below saturation
DLQ near zero or expected
```

### 23.2 Producer Overload

```text
publish target > confirm actual
confirm latency increasing
in-flight increasing
publisher blocked maybe true
broker ingress saturated
```

Action:

- reduce rate,
- use bounded in-flight,
- inspect disk/network,
- distribute queue leaders,
- lower fanout,
- change queue type only if semantics allow.

### 23.3 Consumer Overload

```text
ready increasing
ack rate < publish rate
consumer CPU/DB/API high
handler p99 increasing
unacked may be high
```

Action:

- increase consumer capacity carefully,
- optimize handler,
- reduce downstream calls,
- split workload,
- tune prefetch,
- add backpressure/admission control.

### 23.4 Broker Disk Bottleneck

```text
confirm latency increasing
publisher blocked
write IO saturated
disk queue high
quorum/stream workload affected
```

Action:

- faster disk,
- reduce persistence load,
- reduce message size,
- reduce fanout,
- split workload across nodes,
- review retention.

### 23.5 Retry Storm

```text
redelivery rate high
DLQ/retry queue rates high
same message ids repeated
consumer failure rate high
external dependency degraded
```

Action:

- stop immediate requeue,
- use delayed retry,
- cap attempts,
- circuit break downstream,
- parking lot poison messages,
- reduce consumers if they amplify failing dependency.

---

## 24. Benchmark Report Template

Gunakan template ini agar benchmark bisa dipercaya.

```markdown
# RabbitMQ Benchmark Report

## Goal
What decision does this benchmark support?

## Environment
- RabbitMQ version:
- Erlang version:
- Node count:
- CPU/RAM per node:
- Disk type:
- Network:
- Deployment model:
- TLS:

## Topology
- Exchange type:
- Queue/stream type:
- Replica count:
- Queue count:
- Binding count:
- Fanout factor:
- DLX/retry enabled:

## Workload
- Message size p50/p95/p99:
- Publish rate:
- Producer count:
- Consumer count:
- Prefetch:
- Confirm mode:
- Ack mode:
- Persistence:
- Handler simulation:
- Test duration:
- Warm-up:

## Results
- Publish rate actual:
- Confirm rate:
- Deliver rate:
- Ack rate:
- p50/p95/p99 confirm latency:
- p50/p95/p99 end-to-end latency:
- Max queue depth:
- Max oldest message age:
- CPU/RAM/disk/network:
- DLQ/redelivery:

## Observations
What saturated first?

## Failure/Recovery Notes
What happened on restart/crash/backlog?

## Conclusion
Can this workload meet SLO?

## Recommended Capacity
- safe sustained rate:
- safe burst rate:
- required nodes:
- required consumers:
- required storage:

## Risks
Known bottlenecks and assumptions.
```

---

## 25. Common Benchmark Lies

### Lie 1 — “RabbitMQ can do X msg/s”

Without message size, queue type, confirms, ack, persistence, topology, and duration, this number is nearly meaningless.

### Lie 2 — “No confirms benchmark represents production”

If production needs reliability, benchmark without confirms is measuring a different system.

### Lie 3 — “No-op consumer represents real consumer”

No-op consumer only measures broker delivery path, not business completion.

### Lie 4 — “Average latency is fine”

Tail latency matters.

### Lie 5 — “Short benchmark is enough”

Short benchmark misses:

- disk burst exhaustion,
- GC cycles,
- compaction/retention effects,
- slow memory growth,
- retry accumulation,
- downstream throttling.

### Lie 6 — “More consumers always improves throughput”

More consumers can overload DB/API and reduce total throughput.

### Lie 7 — “Queue depth alone is bad”

Queue depth is acceptable if:

- age is within SLO,
- catch-up capacity exists,
- backlog is expected,
- storage is sufficient.

Queue depth is bad if:

- oldest age violates SLA,
- backlog grows unbounded,
- no catch-up capacity,
- message TTL/DLQ risk.

---

## 26. Performance Design Patterns

### 26.1 Workload Segregation

Separate queues for different processing profiles.

Bad:

```text
case.events.all -> one consumer type handles everything
```

Better:

```text
case.review.commands.q
case.notification.commands.q
case.audit.stream
case.ml-screening.commands.q
case.reporting.events.q
```

Slow reporting should not block enforcement review.

### 26.2 Hot Path / Cold Path Split

Hot path:

- minimal payload,
- fast validation,
- durable command queue,
- strict SLO.

Cold path:

- analytics,
- reporting,
- archive,
- replay,
- long retention stream.

### 26.3 Queue Sharding by Key

If one queue is hot, shard by stable key.

```text
case.work.q.00
case.work.q.01
case.work.q.02
...
```

Route by hash(caseId).

Ordering remains per case if all same caseId goes to same shard.

### 26.4 Stream for Audit, Queue for Work

Pattern:

```text
producer -> exchange -> quorum work queues
                  \-> audit stream
```

Work queues handle destructive processing.
Audit stream preserves history/replay.

### 26.5 Admission Control

Do not let unlimited producers overwhelm broker.

Producer should observe:

- confirm latency,
- blocked connection,
- outbox lag,
- broker health,
- downstream capacity.

Then throttle or reject upstream.

---

## 27. Performance Decision Matrix

| Problem | First suspect | Better response |
|---|---|---|
| queue depth growing | consumer capacity | measure ack rate/handler latency |
| confirm latency high | broker write path | inspect disk/quorum/network |
| unacked high | consumer processing/prefetch | reduce prefetch or fix handler |
| redelivery high | handler failure/retry loop | DLQ/delayed retry/poison handling |
| p99 latency high | tail dependency | trace per stage |
| CPU broker high | routing/fanout/queue count | split workload/reduce fanout |
| disk full | retention/backlog | TTL/limit/storage/capacity |
| network high | fanout/replication/large messages | reduce payload/fanout/placement |
| DB overloaded | consumer concurrency | bulkhead/pool/tune/reduce prefetch |
| stream lag high | consumer read/process | partition/scale/replay isolation |

---

## 28. Mini Lab

### Lab 1 — Baseline No Persistence

Run PerfTest with:

```text
classic queue
non-persistent messages
no confirms
no consumer ack
1 KB messages
```

Record throughput.

Purpose: see unrealistic upper bound.

### Lab 2 — Production-ish Quorum

Run with:

```text
quorum queue
persistent messages
publisher confirms
manual consumer ack
prefetch 100
1 KB messages
```

Compare with Lab 1.

Purpose: understand cost of safety.

### Lab 3 — Message Size Sweep

Run same test with:

```text
1 KB
10 KB
100 KB
1 MB
```

Record:

- throughput,
- confirm latency,
- memory,
- disk,
- network.

### Lab 4 — Prefetch Sweep

Run:

```text
prefetch 1
prefetch 10
prefetch 100
prefetch 500
prefetch 1000
```

Measure ack rate and unacked.

Find saturation point.

### Lab 5 — Backlog Recovery

1. Start producer.
2. Stop consumers for 5 minutes.
3. Start consumers.
4. Measure catch-up time.

Calculate theoretical catch-up and compare.

### Lab 6 — Retry Storm Simulation

Make consumer fail 20% of messages.

Compare:

- immediate requeue,
- TTL delayed retry,
- capped retry + DLQ.

Observe redelivery and queue health.

### Lab 7 — Stream Append and Replay

Use Stream PerfTest:

- append 1 KB messages,
- consume live,
- replay from beginning,
- measure lag and disk growth.

---

## 29. Anti-Patterns

1. Benchmarking without publisher confirms, then enabling confirms in production.
2. Benchmarking classic queue, then deploying quorum queue.
3. Benchmarking 1 KB messages, then production sends 500 KB payloads.
4. Measuring publish rate but ignoring ack rate.
5. Ignoring oldest message age.
6. Setting prefetch to huge values because throughput improved in a no-failure test.
7. Increasing consumers until database collapses.
8. Treating DLQ/retry traffic as free.
9. Running benchmark for only a few minutes on burstable cloud disk.
10. Ignoring tail latency.
11. Ignoring fanout multiplication.
12. Using one hot queue for all tenants/workloads.
13. Logging full message body at high throughput.
14. Using unbounded executor after listener.
15. Benchmarking with no security/TLS but deploying with TLS.
16. Ignoring consumer idempotency cost.
17. Measuring broker only when the real bottleneck is business handler.
18. Using global ordering requirement accidentally.
19. Assuming stream offset commit equals business success.
20. Declaring success without failure/recovery test.

---

## 30. Production Readiness Checklist

Before declaring RabbitMQ performance ready:

- [ ] Workload dimensions documented.
- [ ] Message p50/p95/p99 size measured.
- [ ] Queue type matches production semantics.
- [ ] Publisher confirms benchmarked.
- [ ] Consumer manual ack benchmarked.
- [ ] Prefetch tuned under realistic handler latency.
- [ ] Consumer concurrency tested against real downstream capacity.
- [ ] Queue depth and oldest age monitored.
- [ ] p95/p99 latency captured.
- [ ] DLQ/retry behavior tested.
- [ ] Backlog recovery tested.
- [ ] Broker restart tested.
- [ ] Consumer crash redelivery tested.
- [ ] Producer retry duplicate tested.
- [ ] Disk burst risk assessed.
- [ ] Network replication traffic assessed.
- [ ] Stream retention capacity calculated.
- [ ] Fanout multiplication calculated.
- [ ] Alert thresholds tied to SLO, not arbitrary numbers.
- [ ] Benchmark report written.
- [ ] Safe sustained rate defined below maximum observed rate.

---

## 31. Heuristics

1. If you only measure publish rate, you have not measured system throughput.
2. If queue depth grows, compare arrival rate and ack rate first.
3. If unacked grows, inspect consumer handler latency and prefetch.
4. If confirm latency grows, inspect broker disk/network/quorum path.
5. If p99 latency is bad, average latency is irrelevant.
6. If message is large, move payload out of RabbitMQ.
7. If retry is immediate, expect retry storm.
8. If producer has unlimited in-flight confirms, it is an overload amplifier.
9. If consumer has unbounded executor, RabbitMQ backpressure is bypassed.
10. If benchmark duration is too short, disk burst can lie.
11. If production uses quorum queue, benchmark quorum queue.
12. If production uses stream protocol, benchmark with Stream PerfTest.
13. If fanout is N, broker work is multiplied by N.
14. If ordering is per entity, partition by entity key.
15. If downstream is the bottleneck, more RabbitMQ tuning will not fix it.
16. If DLQ is not monitored, failure is only being stored, not handled.
17. If retention is not calculated, stream disk usage will surprise you.
18. If p99 handler latency doubles under load, capacity model must use loaded latency.
19. If consumer capacity barely equals arrival rate, recovery from backlog is impossible.
20. If benchmark cannot be repeated, it is not evidence.

---

## 32. Review Questions

1. Apa bedanya publish rate, confirm rate, deliver rate, ack rate, dan business completion rate?
2. Kenapa benchmark tanpa publisher confirm tidak mewakili durable production workload?
3. Bagaimana prefetch memengaruhi throughput, memory, fairness, dan redelivery blast radius?
4. Kenapa quorum queue punya cost berbeda dari classic queue?
5. Bagaimana cara menghitung backlog growth?
6. Bagaimana cara menghitung catch-up time?
7. Kenapa oldest message age sering lebih penting daripada queue depth?
8. Kapan menambah consumer justru menurunkan throughput?
9. Kenapa large message buruk untuk RabbitMQ?
10. Bagaimana fanout mengubah kapasitas broker?
11. Apa perbedaan benchmark AMQP queue dan benchmark stream protocol?
12. Apa yang harus dicatat dalam benchmark report agar hasilnya bisa dipercaya?
13. Bagaimana membedakan broker bottleneck dan consumer bottleneck?
14. Apa tanda retry storm?
15. Bagaimana kamu mendesain benchmark untuk regulatory case workflow dengan SLA 5 menit?

---

## 33. Kesimpulan

Performance engineering RabbitMQ bukan mencari satu konfigurasi ajaib. Ia adalah proses memahami hubungan antara:

```text
semantics -> topology -> workload -> resource cost -> SLO -> failure behavior
```

RabbitMQ bisa sangat cepat, tetapi performanya sangat bergantung pada keputusan desain:

- queue type,
- persistence,
- confirms,
- acknowledgements,
- prefetch,
- concurrency,
- message size,
- fanout,
- retry strategy,
- downstream capacity,
- disk/network quality,
- observability.

Engineer yang matang tidak sekadar bertanya “berapa msg/s”, tetapi membuktikan:

1. sistem bisa mencapai throughput stabil,
2. latency memenuhi SLO,
3. backlog bisa pulih,
4. failure tidak membuat duplicate/poison/retry storm tidak terkendali,
5. resource bottleneck diketahui,
6. kapasitas punya safety margin,
7. benchmark merepresentasikan semantics produksi.

Part berikutnya akan membahas **Production Topology Design Patterns**: bagaimana memilih dan menggabungkan work queue, pub/sub, routing, retry/DLQ, outbox/inbox, audit stream, delayed job, dan hybrid queue+stream topology untuk sistem nyata.

---

# Status Seri

Progress saat ini:

- [x] Part 00 — Orientation, Mental Model, dan Scope RabbitMQ Modern
- [x] Part 01 — Messaging Fundamentals yang Spesifik RabbitMQ
- [x] Part 02 — AMQP 0-9-1 Deep Dive
- [x] Part 03 — Exchange Routing Mastery
- [x] Part 04 — Queue Semantics: Classic, Quorum, Stream
- [x] Part 05 — Hands-on Local Lab
- [x] Part 06 — Java Client Fundamentals tanpa Spring
- [x] Part 07 — Publisher Reliability
- [x] Part 08 — Consumer Reliability
- [x] Part 09 — Retry, Dead Lettering, Poison Message, Parking Lot
- [x] Part 10 — Spring AMQP Deep Dive
- [x] Part 11 — Spring Boot Integration Patterns
- [x] Part 12 — Message Contract Design untuk Java Systems
- [x] Part 13 — Ordering, Concurrency, Partitioning, and Work Distribution
- [x] Part 14 — RPC, Request/Reply, Correlation, Timeout
- [x] Part 15 — Workflow, Saga, and Enforcement Lifecycle Modelling
- [x] Part 16 — RabbitMQ Streams Mental Model
- [x] Part 17 — RabbitMQ Stream Java Client
- [x] Part 18 — Super Streams and Partitioned Streaming
- [x] Part 19 — Stream Deduplication, Filtering, and Replay Patterns
- [x] Part 20 — Quorum Queues Deep Dive
- [x] Part 21 — Flow Control, Backpressure, Memory, Disk, and Overload
- [x] Part 22 — Clustering, High Availability, Network Partitions
- [x] Part 23 — Federation, Shovel, Multi-Region, and Edge Messaging
- [x] Part 24 — Security, TLS, AuthN/AuthZ, Multi-Tenancy
- [x] Part 25 — Observability: Metrics, Logs, Tracing, and Message Forensics
- [x] Part 26 — Performance Engineering and Benchmarking
- [ ] Part 27 — Production Topology Design Patterns
- [ ] Part 28 — Anti-Patterns and Failure Case Studies
- [ ] Part 29 — Testing Strategy for RabbitMQ-Based Java Systems
- [ ] Part 30 — Migration, Refactoring, and Legacy RabbitMQ Systems
- [ ] Part 31 — Architecture Decision Framework
- [ ] Part 32 — End-to-End Case Study
- [ ] Part 33 — Production Runbook and Operational Playbook
- [ ] Part 34 — Mastery Review, Heuristics, and Final Mental Models

Seri belum selesai. Bagian berikutnya: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-27.md`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-25.md">⬅️ Part 25 — Observability: Metrics, Logs, Tracing, and Message Forensics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-27.md">Part 27 — Production Topology Design Patterns ➡️</a>
</div>

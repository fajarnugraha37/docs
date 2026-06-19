# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-13.md

# Part 13 — Ordering, Concurrency, Partitioning, and Work Distribution

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin mendesain RabbitMQ system secara production-grade  
> Fokus part ini: memahami hubungan antara **ordering**, **parallelism**, **prefetch**, **competing consumers**, **per-key ordering**, **queue sharding**, dan **work distribution**.

---

## 0. Posisi Part Ini Dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi:

1. RabbitMQ bukan Kafka kecil.
2. Exchange melakukan routing.
3. Queue menyimpan work.
4. Consumer memproses delivery.
5. Ack menentukan kapan broker boleh melupakan delivery.
6. Retry/DLQ menentukan jalur kegagalan.
7. Message contract menentukan stabilitas antar service.

Part ini masuk ke salah satu area paling sering membuat desain RabbitMQ rusak di production:

> “Kami ingin processing parallel, throughput tinggi, tetapi juga ingin semua message diproses persis sesuai urutan bisnis.”

Kalimat itu terdengar masuk akal, tetapi sering menyimpan konflik fundamental.

Dalam RabbitMQ, ordering tidak bisa dibahas terpisah dari:

- jumlah consumer,
- prefetch,
- ack timing,
- redelivery,
- retry,
- queue type,
- routing key,
- entity key,
- partitioning,
- idempotency,
- side effect eksternal,
- dan definisi “urutan” yang sebenarnya dibutuhkan domain.

RabbitMQ documentation mendeskripsikan queue sebagai ordered collection dan delivery secara FIFO dalam kondisi normal, tetapi berbagai faktor seperti prefetch, competing consumers, requeue, dan redelivery memengaruhi bagaimana urutan itu terlihat di aplikasi. Dokumentasi RabbitMQ juga menjelaskan prefetch sebagai mekanisme membatasi jumlah delivery yang belum di-ack untuk consumer; ini berarti prefetch secara langsung memengaruhi concurrency dan distribusi kerja. Sumber resmi: RabbitMQ Queues, Consumer Prefetch, Consumers, dan AMQP concepts.  
Referensi: <https://www.rabbitmq.com/docs/queues>, <https://www.rabbitmq.com/docs/consumer-prefetch>, <https://www.rabbitmq.com/docs/consumers>, <https://www.rabbitmq.com/tutorials/amqp-concepts>

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan perbedaan antara:
   - queue order,
   - delivery order,
   - processing start order,
   - completion order,
   - side-effect order,
   - business state transition order.

2. Menentukan kapan ordering benar-benar dibutuhkan.

3. Mendesain consumer concurrency tanpa merusak invariant domain.

4. Menggunakan prefetch sebagai concurrency/backpressure budget.

5. Memahami risiko competing consumers terhadap ordering.

6. Mendesain per-key ordering dengan routing key atau consistent hashing.

7. Menentukan kapan memakai:
   - single queue single consumer,
   - single queue multiple consumers,
   - queue-per-partition,
   - single active consumer,
   - stream/super stream,
   - consistent hash exchange.

8. Membuat decision matrix antara throughput, latency, fairness, ordering, dan operational complexity.

9. Mengenali anti-pattern seperti “global ordering requirement” yang sebenarnya tidak perlu.

10. Mendesain work distribution untuk Java service production-grade.

---

## 2. Mental Model Utama

### 2.1 RabbitMQ Queue Adalah Ordered Mailbox, Bukan Distributed Transaction Scheduler

Queue bisa menyimpan message dalam urutan enqueue. Tetapi saat message keluar dari queue menuju consumer, banyak hal terjadi:

```text
Publisher
   |
   v
Exchange
   |
   v
Queue: [M1, M2, M3, M4, M5]
   |
   +--> Consumer A
   +--> Consumer B
   +--> Consumer C
```

Jika hanya ada satu consumer, prefetch kecil, tidak ada redelivery, dan processing synchronously sequential, maka aplikasi akan melihat urutan yang dekat dengan FIFO.

Tetapi jika ada banyak consumer:

```text
Queue: [M1, M2, M3, M4, M5, M6]

Consumer A receives M1, M4
Consumer B receives M2, M5
Consumer C receives M3, M6
```

Mungkin broker mengirim delivery sesuai aturan distribusinya, tetapi completion order bisa menjadi:

```text
M3 selesai dulu
M2 selesai kedua
M5 selesai ketiga
M1 selesai keempat
```

Dari perspektif sistem bisnis, urutan efek samping sudah berubah.

Inilah inti part ini:

> FIFO queue tidak otomatis berarti FIFO business effect.

---

## 3. Enam Jenis “Ordering” yang Harus Dibedakan

Banyak bug terjadi karena tim hanya memakai kata “order” tanpa menjelaskan order yang mana.

### 3.1 Enqueue Order

Urutan message masuk ke queue.

```text
Queue append order:
M1 -> M2 -> M3
```

Ini adalah urutan broker menerima dan menempatkan message ke queue.

Masalahnya:

- jika ada banyak publisher, urutan antar publisher tidak selalu bermakna bisnis,
- clock publisher bisa berbeda,
- publish confirm bukan global total ordering,
- network delay bisa mengubah arrival order.

### 3.2 Delivery Order

Urutan broker mengirim message ke consumer.

```text
Queue delivers:
M1 to Consumer A
M2 to Consumer B
M3 to Consumer A
```

Delivery order masih belum sama dengan processing order.

### 3.3 Processing Start Order

Urutan consumer mulai menjalankan handler.

Dengan executor thread pool:

```java
handle(M1) submitted first
handle(M2) submitted second

but M2 thread starts first
```

Ini bisa terjadi jika consumer menerima message di satu thread lalu melempar ke worker pool.

### 3.4 Processing Completion Order

Urutan handler selesai.

```text
M1: calls external API, 2 seconds
M2: validates local DB, 20 ms

Completion:
M2 before M1
```

Jika side effect dilakukan saat completion, efeknya tidak lagi sesuai enqueue order.

### 3.5 Ack Order

Urutan consumer mengirim ack ke broker.

Ack order bisa berbeda dari completion order jika aplikasi batching ack atau memakai manual ack dari thread berbeda.

Ini berbahaya jika channel digunakan lintas thread secara sembarangan.

### 3.6 Business State Transition Order

Urutan perubahan state domain.

Contoh:

```text
CaseOpened
EvidenceSubmitted
CaseEscalated
CaseClosed
```

Jika `CaseClosed` diterapkan sebelum `EvidenceSubmitted`, sistem bisa corrupt secara domain meskipun RabbitMQ bekerja normal.

**Top 1% engineer tidak bertanya “apakah RabbitMQ menjaga order?”**  
Mereka bertanya:

> “Order apa yang harus dijaga, untuk key apa, pada boundary mana, dan efek samping mana yang tidak boleh out-of-order?”

---

## 4. Ordering Guarantee Dasar RabbitMQ

### 4.1 Queue FIFO Dalam Kondisi Ideal

RabbitMQ queue adalah ordered collection. Dalam kondisi sederhana:

- satu queue,
- satu consumer,
- no requeue,
- no redelivery,
- no priority,
- no competing consumers,
- prefetch tidak membuat parallel processing,

message akan dikonsumsi mengikuti urutan queue.

Namun dokumentasi RabbitMQ sendiri memberi caveat bahwa FIFO perlu dipahami dengan faktor seperti prefetch, competing consumers, redelivery, dan requeue. Referensi priority queue doc menjelaskan bahwa standar queue adalah FIFO jika mengabaikan prefetch, competing consumers, requeue, dan redeliveries.  
Referensi: <https://www.rabbitmq.com/docs/priority>

### 4.2 Multiple Consumers Melemahkan Completion Ordering

Dengan competing consumers, RabbitMQ mendistribusikan message ke consumer yang tersedia sesuai flow control/prefetch.

Contoh:

```text
Queue order:
M1, M2, M3, M4

Delivery:
M1 -> C1
M2 -> C2
M3 -> C3
M4 -> C1

Completion:
C3 finishes M3 first
C2 finishes M2 second
C1 finishes M1 third
```

Jika handler hanya mengirim email independen, mungkin aman.

Jika handler melakukan transition state yang saling bergantung, ini berbahaya.

### 4.3 Prefetch > 1 Bisa Melemahkan Effective Ordering Bahkan Dengan Satu Consumer Process

Misal consumer process punya prefetch 10.

Broker mengirim:

```text
M1..M10
```

Jika aplikasi memasukkan semuanya ke executor:

```java
executor.submit(() -> process(M1));
executor.submit(() -> process(M2));
...
executor.submit(() -> process(M10));
```

Completion tidak dijamin sama dengan delivery.

Bahkan jika hanya satu consumer registration, parallel worker internal bisa merusak ordering.

### 4.4 Redelivery Bisa Mengubah Urutan Observasi

Misal:

```text
M1 delivered to C1
M2 delivered to C2
C1 crashes before ack
C2 successfully acks M2
M1 redelivered later
```

Aplikasi melihat:

```text
M2 succeeded before M1
```

Dalam at-least-once system, redelivery adalah normal. Maka desain harus tahan out-of-order jika concurrency ada.

---

## 5. The Fundamental Trade-Off: Ordering vs Parallelism

Ada hukum praktis:

> Semakin luas ordering yang ingin dijaga, semakin kecil ruang parallelism.

### 5.1 Global Ordering

Semua message harus diproses sesuai satu urutan total.

Contoh:

```text
M1 -> M2 -> M3 -> M4 -> M5
```

Implikasi:

- satu logical lane,
- biasanya satu active consumer,
- throughput terbatas oleh satu worker sequential,
- failure satu message bisa menahan semua message setelahnya,
- retry menjadi head-of-line blocking.

Global ordering sering terlalu mahal dan jarang benar-benar dibutuhkan.

### 5.2 Per-Key Ordering

Order hanya perlu dijaga untuk entity tertentu.

Contoh:

```text
case-123: M1 -> M3 -> M7
case-456: M2 -> M4 -> M5
case-789: M6 -> M8
```

Message antar case boleh parallel.

Ini jauh lebih scalable.

### 5.3 No Ordering Requirement

Semua message independen.

Contoh:

- send email notification,
- generate thumbnail,
- process independent file,
- recalculate independent report,
- push webhook dengan idempotency.

Bisa pakai competing consumers dan prefetch lebih besar.

---

## 6. Decision Table: Jenis Ordering vs Desain RabbitMQ

| Requirement | Recommended Design | Throughput | Complexity | Notes |
|---|---:|---:|---:|---|
| No order needed | Single queue + competing consumers | High | Low | Cocok untuk independent jobs |
| Per-entity order | Route by entity key ke partition queues | Medium-high | Medium | Skala dengan jumlah partition |
| Strict queue order | Single queue + single active consumer | Low-medium | Medium | Failover ada, parallelism terbatas |
| Audit replay order | Stream / super stream | High | Medium-high | Consumption non-destructive |
| Workflow transition order | Per-case partition + idempotent state machine | Medium | High | Cocok untuk lifecycle/case system |
| Global total order | Single lane sequential processor | Low | Medium | Harus benar-benar dibuktikan perlu |

---

## 7. Competing Consumers Pattern

### 7.1 Apa Itu Competing Consumers?

Beberapa consumer membaca dari queue yang sama.

```text
Queue: case.review.requested.q

C1: review-worker-1
C2: review-worker-2
C3: review-worker-3
```

Tujuannya:

- meningkatkan throughput,
- membagi beban,
- memberi redundancy,
- mengurangi latency antrean.

### 7.2 Cocok Untuk Work Item Independen

Contoh bagus:

```text
Generate PDF for case-123
Generate PDF for case-456
Generate PDF for case-789
```

Tidak ada ketergantungan antar message.

### 7.3 Tidak Cocok Untuk State Transition yang Harus Berurutan

Contoh berbahaya:

```text
case-123: CaseOpened
case-123: EvidenceSubmitted
case-123: CaseEscalated
case-123: CaseClosed
```

Jika semuanya masuk queue yang sama dan diproses competing consumers, urutan completion bisa kacau.

---

## 8. Prefetch Sebagai Concurrency Budget

### 8.1 Apa Itu Prefetch?

Prefetch menentukan berapa banyak message yang boleh dikirim broker ke consumer tanpa ack.

RabbitMQ menerapkan consumer prefetch sebagai extension dari AMQP `basic.qos`. Dokumentasi RabbitMQ menjelaskan bahwa prefetch membatasi jumlah delivery yang belum di-ack, sehingga sangat penting untuk flow control dan distribusi beban consumer.  
Referensi: <https://www.rabbitmq.com/docs/consumer-prefetch>

```java
channel.basicQos(10);
```

Artinya:

```text
Consumer boleh punya sampai 10 unacked deliveries.
```

### 8.2 Prefetch Bukan Sekadar Performance Knob

Prefetch adalah:

- concurrency budget,
- memory budget,
- fairness knob,
- backpressure mechanism,
- ordering risk multiplier.

### 8.3 Prefetch = 1

Kelebihan:

- fairer distribution,
- lebih mudah reason about failure,
- lower duplicate work window,
- safer untuk ordering.

Kekurangan:

- throughput mungkin rendah,
- network round-trip lebih terasa,
- consumer idle saat processing pendek-pendek.

### 8.4 Prefetch Tinggi

Kelebihan:

- throughput lebih tinggi,
- pipeline lebih penuh,
- cocok untuk batch-like processing.

Kekurangan:

- satu consumer bisa “menimbun” banyak unacked message,
- fairness antar consumer menurun,
- crash menyebabkan banyak redelivery,
- memory naik,
- ordering makin sulit,
- slow consumer bisa memegang banyak message.

### 8.5 Prefetch Formula Awal

Sebagai starting point:

```text
prefetch ~= consumer_concurrency_per_process * work_in_flight_per_thread
```

Jika service punya 8 worker thread dan tiap thread proses 1 message:

```text
prefetch = 8 sampai 16
```

Namun untuk per-key ordering, formula ini tidak cukup. Kamu harus memastikan message dengan key sama tidak diproses parallel.

---

## 9. Java Consumer Concurrency Model

### 9.1 Model 1: Synchronous Handler Per Consumer Callback

```java
DeliverCallback callback = (tag, delivery) -> {
    try {
        process(delivery);
        channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
    } catch (Exception e) {
        channel.basicNack(delivery.getEnvelope().getDeliveryTag(), false, false);
    }
};
```

Karakteristik:

- sederhana,
- mudah reason about ack,
- throughput terbatas,
- jangan blok terlalu lama jika callback thread penting.

### 9.2 Model 2: Banyak Consumer, Satu Thread Per Consumer

```text
Consumer process:
  channel-1 -> consumer-1
  channel-2 -> consumer-2
  channel-3 -> consumer-3
```

Lebih aman daripada share satu channel ke banyak worker.

### 9.3 Model 3: Callback Submit ke Executor

```java
DeliverCallback callback = (tag, delivery) -> {
    executor.submit(() -> {
        process(delivery);
        channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
    });
};
```

Ini sering bermasalah:

1. Channel RabbitMQ tidak boleh dipakai sembarangan lintas thread tanpa disiplin.
2. Ack dari thread berbeda bisa race.
3. Completion order berubah.
4. Shutdown lebih kompleks.
5. Error handling lebih mudah bocor.

### 9.4 Pattern Lebih Aman: Channel Per Worker

```text
Worker-1 owns Channel-1
Worker-2 owns Channel-2
Worker-3 owns Channel-3
```

Setiap worker punya consumer sendiri dan ack di channel yang sama.

RabbitMQ docs menyarankan aplikasi dengan concurrency tinggi memulai dari satu channel per thread/process/coroutine sebagai pendekatan praktis.  
Referensi: <https://www.rabbitmq.com/docs/channels>

---

## 10. Ordering Design Pattern #1: Single Queue, Single Consumer

### 10.1 Topology

```text
Exchange -> Queue -> Consumer
```

### 10.2 Cocok Untuk

- global sequential processing,
- low throughput command lane,
- critical transition processor,
- simple local lab,
- legacy integration yang tidak tahan parallelism.

### 10.3 Kelemahan

- throughput rendah,
- no horizontal processing scale,
- satu poison message bisa menahan queue,
- failure recovery bergantung retry/DLQ,
- latency antrean bisa naik saat burst.

### 10.4 Kapan Masuk Akal?

Jika invariant domain benar-benar global:

```text
Only one enforcement batch can be finalized at a time.
```

Namun sering kali “global order” ternyata bisa dipecah per entity.

---

## 11. Ordering Design Pattern #2: Single Queue, Competing Consumers

### 11.1 Topology

```text
Exchange -> Queue -> Consumer-1
                  -> Consumer-2
                  -> Consumer-3
```

### 11.2 Cocok Untuk

- independent jobs,
- notification delivery,
- thumbnail generation,
- report generation,
- webhook delivery per endpoint jika idempotent,
- command yang tidak saling bergantung.

### 11.3 Tuning Awal

```text
consumer_count = number_of_instances * consumers_per_instance
prefetch = worker_threads_per_consumer or small multiple
```

### 11.4 Risk

- no strict completion order,
- duplicate processing still possible,
- uneven work if message cost varies,
- slow consumer may hold unacked messages,
- redelivery can appear later.

### 11.5 Invariant yang Harus Ditulis

Sebelum memakai competing consumers, tulis:

```text
Messages in this queue are independent.
Processing message B before message A is safe.
Duplicate processing is safe through idempotency key X.
```

Jika tidak bisa menulis ini, desain belum matang.

---

## 12. Ordering Design Pattern #3: Per-Key Partition Queues

### 12.1 Masalah yang Diselesaikan

Kita ingin:

- parallelism antar entity,
- order per entity.

Contoh:

```text
case-123 events must be ordered.
case-456 events can run in parallel with case-123.
```

### 12.2 Topology

```text
                 +-> case.workflow.p0.q -> Consumer Group P0
Exchange/Router -+-> case.workflow.p1.q -> Consumer Group P1
                 +-> case.workflow.p2.q -> Consumer Group P2
                 +-> case.workflow.p3.q -> Consumer Group P3
```

Routing function:

```text
partition = hash(caseId) % partitionCount
```

All messages for same `caseId` go to same queue.

### 12.3 Why It Works

Jika semua message untuk key yang sama masuk lane yang sama, kamu bisa menjaga order dengan:

- satu consumer aktif per partition queue, atau
- consumer yang menjamin per-key serial execution dalam queue itu.

### 12.4 Trade-Off

Kelebihan:

- scalable,
- predictable,
- per-key ordering,
- simple reasoning.

Kekurangan:

- partition count harus dipilih,
- hot key bisa bottleneck,
- rebalancing sulit,
- topology lebih banyak,
- monitoring per partition diperlukan.

### 12.5 Jangan Terlalu Banyak Queue

Queue bukan free object. Terlalu banyak queue membuat:

- memory overhead,
- management overhead,
- metrics cardinality tinggi,
- policy management kompleks,
- recovery lebih berat.

Mulai dari jumlah partition kecil dan berbasis kebutuhan throughput.

---

## 13. Routing Per-Key Dengan Direct/Topic Exchange

### 13.1 Manual Partition Routing

Publisher menghitung partition:

```java
int partition = Math.floorMod(caseId.hashCode(), 16);
String routingKey = "case.workflow.p" + partition;
```

Binding:

```text
case.workflow.exchange -- case.workflow.p0 --> case.workflow.p0.q
case.workflow.exchange -- case.workflow.p1 --> case.workflow.p1.q
...
```

### 13.2 Kelebihan

- eksplisit,
- mudah dipahami,
- tidak bergantung plugin,
- bisa dites.

### 13.3 Kekurangan

- publisher harus tahu partition count,
- perubahan partition count sulit,
- risk inconsistent hash implementation antar bahasa,
- topology leak ke publisher.

### 13.4 Partition Count Harus Stabil

Jika kamu mengubah:

```text
hash(key) % 16
```

menjadi:

```text
hash(key) % 32
```

banyak key berpindah partition. Dalam queue system, ini bisa membuat ordering window berbahaya jika old message masih ada di partition lama.

Maka perubahan partition count butuh migration plan.

---

## 14. Routing Per-Key Dengan Consistent Hash Exchange

RabbitMQ memiliki plugin exchange types termasuk consistent hashing exchange. Dokumentasi exchanges/publishers menyebut exchange type tambahan seperti consistent hashing exchange disediakan oleh plugin dan harus di-enable sebelum digunakan.  
Referensi: <https://www.rabbitmq.com/docs/exchanges>, <https://www.rabbitmq.com/docs/plugins>, <https://www.rabbitmq.com/docs/publishers>

### 14.1 Mental Model

```text
Publisher publishes with routing key = caseId
             |
             v
x-consistent-hash exchange
             |
             +-> partition queue 0
             +-> partition queue 1
             +-> partition queue 2
             +-> partition queue 3
```

Exchange memilih queue berdasarkan hash routing key.

### 14.2 Cocok Untuk

- per-key work distribution,
- menghindari partition logic di publisher,
- routing stable berbasis key,
- scalable consumer lanes.

### 14.3 Hal yang Perlu Hati-Hati

1. Plugin harus di-enable dan didukung oleh environment.
2. Perilaku hashing harus dipahami sebelum production.
3. Perubahan binding weight/queue count bisa memindahkan key.
4. Monitoring harus bisa memetakan key ke queue saat debugging.
5. Jangan pakai jika tim belum punya operational maturity terhadap plugin.

### 14.4 Example Topology Conceptual

```text
exchange: case.workflow.hash.x
  type: x-consistent-hash

bindings:
  case.workflow.p0.q weight 1
  case.workflow.p1.q weight 1
  case.workflow.p2.q weight 1
  case.workflow.p3.q weight 1

publish:
  routing_key = caseId
```

---

## 15. Single Active Consumer

### 15.1 Apa Itu Single Active Consumer?

Single Active Consumer membuat hanya satu consumer aktif membaca dari queue pada satu waktu. Consumer lain standby; jika active consumer disconnect, consumer lain mengambil alih.

RabbitMQ consumer documentation menjelaskan Single Active Consumer berguna saat message harus dikonsumsi dan diproses sesuai urutan kedatangan queue; satu consumer aktif, yang lain menunggu failover.  
Referensi: <https://www.rabbitmq.com/docs/consumers>

### 15.2 Topology

```text
Queue -> Active Consumer A
      -> Standby Consumer B
      -> Standby Consumer C
```

### 15.3 Cocok Untuk

- strict order dalam satu queue,
- failover tanpa parallel consumption,
- workflow lane yang tidak boleh parallel,
- transition processor.

### 15.4 Bukan Solusi Throughput

Single active consumer memberi availability/failover, bukan horizontal processing scale.

Jika satu queue single active consumer bottleneck, solusi biasanya:

```text
partition into multiple queues, each with single active consumer
```

Bukan menaikkan active consumer count pada queue yang sama.

### 15.5 Pattern: Partition + Single Active Consumer

```text
case.workflow.p0.q -> SAC group p0
case.workflow.p1.q -> SAC group p1
case.workflow.p2.q -> SAC group p2
case.workflow.p3.q -> SAC group p3
```

Ini memberi:

- order per partition,
- failover per partition,
- parallelism antar partition.

---

## 16. Head-of-Line Blocking

### 16.1 Definisi

Head-of-line blocking terjadi ketika message pertama yang lambat/gagal menahan message setelahnya.

```text
Queue:
M1(slow) -> M2(fast) -> M3(fast)
```

Jika strict order:

```text
M2 and M3 wait behind M1
```

### 16.2 Kapan Ini Diinginkan?

Jika M2/M3 memang tidak boleh diproses sebelum M1.

### 16.3 Kapan Ini Buruk?

Jika M2/M3 independen tapi kebetulan masuk queue yang sama.

### 16.4 Cara Mengurangi

- partition by entity,
- isolate slow workload,
- separate queues by cost class,
- DLQ poison message cepat,
- timeout external call,
- avoid infinite retry,
- use parking lot.

---

## 17. Hot Key Problem

### 17.1 Apa Itu Hot Key?

Satu entity menghasilkan message jauh lebih banyak daripada entity lain.

```text
case-123 gets 10,000 messages/hour
all other cases get 10 messages/hour
```

Jika partition by caseId:

```text
partition(case-123) becomes hot
```

### 17.2 Kenapa Susah?

Per-key ordering berarti message untuk key itu tidak bisa diproses parallel tanpa melanggar order.

### 17.3 Solusi yang Mungkin

1. Terima bottleneck karena invariant memang butuh order.
2. Pecah key menjadi sub-key jika domain mengizinkan.
3. Pisahkan workload berat dari transition lane.
4. Gunakan aggregation/debounce.
5. Pindahkan heavy side effect ke queue independen.
6. Gunakan state machine yang bisa tolerate commutative updates.

### 17.4 Contoh Domain

Buruk:

```text
caseId as key for all operations:
- evidence upload processing
- notification sending
- audit indexing
- state transition
- document OCR
```

Lebih baik:

```text
case.state.transition: key = caseId, strict order
case.evidence.ocr: independent job per evidenceId
case.notification: independent idempotent notificationId
case.audit.stream: append-only record
```

---

## 18. Workload Segregation

Jangan semua message domain masuk queue yang sama.

### 18.1 Pisahkan Berdasarkan Semantics

```text
case.command.review.assign.q
case.command.review.complete.q
case.event.notification.q
case.job.document-render.q
case.job.ocr.q
case.audit.stream
```

### 18.2 Pisahkan Berdasarkan Cost

```text
fast-lane.q      -> validation, state transition
slow-lane.q      -> external API, OCR, report generation
bulk-lane.q      -> batch export
critical-lane.q  -> escalation deadline
```

### 18.3 Pisahkan Berdasarkan Failure Mode

```text
payment-callback.q   -> external idempotency, retry with backoff
email-send.q         -> provider outage retry
case-transition.q    -> DLQ quickly on invalid state
```

### 18.4 Pisahkan Berdasarkan SLA

```text
critical-alert.q     -> low latency
background-index.q   -> high throughput, tolerant delay
```

---

## 19. Designing Consumer Count

### 19.1 Inputs

Sebelum menentukan consumer count, ukur:

- average processing time,
- p95/p99 processing time,
- CPU usage per message,
- DB calls per message,
- external API calls per message,
- duplicate safety,
- ordering requirement,
- queue depth target,
- acceptable latency.

### 19.2 Rough Capacity Formula

```text
throughput_per_worker = 1 / avg_processing_seconds
required_workers = target_messages_per_second / throughput_per_worker
```

Contoh:

```text
avg processing = 200 ms = 0.2 s
throughput per worker = 5 msg/s
needed throughput = 100 msg/s
required workers = 20
```

Kalau satu instance punya 5 workers:

```text
required instances = 4
```

### 19.3 Jangan Lupa Bottleneck Downstream

Consumer count tinggi bisa menghancurkan:

- database connection pool,
- third-party API quota,
- lock contention,
- rate limit,
- cache hot key,
- file storage throughput.

RabbitMQ concurrency bukan hanya broker setting. Ia adalah sistem end-to-end.

---

## 20. Designing Prefetch

### 20.1 Starting Values

| Workload | Starting Prefetch | Reason |
|---|---:|---|
| Slow external API | 1-5 | Avoid hoarding unacked messages |
| CPU-bound processing | worker thread count | Match execution capacity |
| Fast DB update | 10-50 | Pipeline useful, monitor DB |
| Strict ordering | 1 | Reduce order ambiguity |
| Batch processing | 50-300 | Only with memory control |
| Large messages | 1-10 | Limit memory pressure |

### 20.2 Prefetch Too Low Symptoms

- consumers idle between messages,
- broker deliver rate lower than handler capacity,
- network roundtrip dominates,
- CPU underutilized.

### 20.3 Prefetch Too High Symptoms

- high unacked count,
- uneven distribution,
- slow shutdown,
- redelivery storm after crash,
- memory pressure,
- consumer holds messages but not processing,
- latency for other consumers rises.

### 20.4 Prefetch Review Question

For every queue, answer:

```text
If this consumer crashes, how many messages may be redelivered because of prefetch?
Is that duplicate window acceptable?
```

---

## 21. Per-Key Serial Executor Pattern in Java

Kadang kamu ingin satu queue dan multiple deliveries, tetapi menjaga per-key serial execution di aplikasi.

### 21.1 Concept

```text
Message key = caseId

case-123 -> lane A
case-456 -> lane B
case-789 -> lane C
```

Within same lane, process sequentially.

### 21.2 Caution

Ini lebih kompleks daripada partition queues karena:

- ack handling lebih rumit,
- in-memory lane state hilang saat crash,
- redelivery bisa overlap dengan old processing,
- hot key masih hot,
- memory bisa tumbuh jika banyak keys,
- shutdown harus drain.

### 21.3 Simple Sketch

```java
public final class KeySerialDispatcher {
    private final int lanes;
    private final ExecutorService[] executors;

    public KeySerialDispatcher(int lanes) {
        this.lanes = lanes;
        this.executors = new ExecutorService[lanes];
        for (int i = 0; i < lanes; i++) {
            executors[i] = Executors.newSingleThreadExecutor();
        }
    }

    public void dispatch(String key, Runnable task) {
        int lane = Math.floorMod(key.hashCode(), lanes);
        executors[lane].submit(task);
    }
}
```

### 21.4 Ack Problem

Do not ack before task finishes.

But if task finishes in executor thread, you must ensure ack is performed safely on the right channel/thread model.

Often a better design is:

```text
partition queues + one channel/consumer per partition lane
```

rather than trying to build an in-memory scheduler on top of one RabbitMQ consumer.

---

## 22. Idempotency and Ordering

Ordering reduces one class of bug, but does not remove duplicate risk.

Even with perfect order:

```text
M1 delivered
consumer processes M1
consumer crashes before ack
M1 redelivered
```

M1 can be processed twice.

Therefore:

```text
ordering_required != idempotency_optional
```

### 22.1 Idempotency Table Example

```sql
CREATE TABLE processed_message (
    consumer_name VARCHAR(150) NOT NULL,
    message_id VARCHAR(150) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

### 22.2 State Transition Guard Example

```sql
UPDATE case_file
SET status = 'ESCALATED', version = version + 1
WHERE case_id = ?
  AND status = 'UNDER_REVIEW'
  AND version = ?;
```

If affected row count is 0, handler must decide:

- duplicate,
- stale message,
- out-of-order message,
- invalid transition,
- already compensated.

---

## 23. State Machine Thinking for Ordered Work

In case management and regulatory systems, ordering should often be enforced by the aggregate/state machine, not trusted blindly from queue order.

### 23.1 Example State Machine

```text
OPENED
  -> UNDER_REVIEW
  -> EVIDENCE_REQUESTED
  -> EVIDENCE_RECEIVED
  -> ESCALATED
  -> ACTION_PROPOSED
  -> CLOSED
```

### 23.2 Message Handler Should Validate Transition

```java
public void handle(CaseEscalated event) {
    CaseFile file = repository.find(event.caseId());

    if (!file.canEscalateFromCurrentState()) {
        throw new InvalidTransitionException(...);
    }

    file.escalate(event.reasonCode(), event.occurredAt());
    repository.save(file);
}
```

### 23.3 Why This Matters

Even if RabbitMQ mostly delivers FIFO, reality includes:

- retries,
- redeliveries,
- duplicate publisher attempts,
- manual replay,
- DLQ reprocessing,
- deployment bugs,
- old producers,
- multiple queues,
- disaster recovery.

The state machine is the final guardrail.

---

## 24. Priority Queues and Ordering

Priority queue intentionally changes delivery order.

If you enable priority, you are saying:

```text
priority is more important than FIFO
```

Use carefully.

### 24.1 Good Use

- urgent notification,
- escalation deadline,
- operational control message.

### 24.2 Bad Use

- core lifecycle event where order matters,
- fairness-sensitive queue,
- arbitrary “VIP everything” policy.

### 24.3 Design Rule

Do not mix strict ordering requirement with priority queue unless you have explicitly defined priority as part of the ordering semantics.

---

## 25. Requeue and Ordering

Immediate requeue can create ordering anomalies.

Example:

```text
M1 fails and requeues
M2 succeeds
M3 succeeds
M1 is redelivered later
```

Now business effect order is:

```text
M2, M3, M1
```

If M1 must happen before M2/M3, immediate requeue is wrong.

Options:

1. Single-lane blocking retry.
2. Delayed retry with state machine guard.
3. DLQ/parking lot and stop progression.
4. Per-key sequence validation.

---

## 26. Sequence Numbers in Message Contracts

For strict per-entity ordering, add sequence information.

```json
{
  "messageId": "msg-001",
  "messageType": "CaseEvidenceSubmitted",
  "caseId": "case-123",
  "caseVersion": 17,
  "previousCaseVersion": 16,
  "occurredAt": "2026-06-19T10:00:00Z"
}
```

### 26.1 Consumer Logic

```text
If previousCaseVersion == currentVersion:
    apply transition
else if caseVersion <= currentVersion:
    duplicate/stale
else:
    out-of-order, hold/retry/DLQ depending on policy
```

### 26.2 Caveat

Sequence numbers require authoritative owner.

Do not let multiple services independently generate sequence numbers for same aggregate unless you have a coordination model.

---

## 27. Queue Sharding vs Stream/Super Stream

### 27.1 Queue Sharding

Use when:

- destructive consumption is desired,
- work items should be processed once by a worker group,
- per-key order is needed,
- backlog represents pending work.

### 27.2 Stream/Super Stream

Use when:

- replay is required,
- multiple consumers need independent offsets,
- audit/history is important,
- append-only event log semantics fit,
- retention matters more than delete-on-ack.

RabbitMQ streams and super streams support partitioned stream use cases. Documentation describes super streams as partitioned streams and also discusses single active consumer benefits for ordered consumption and continuity.  
Referensi: <https://www.rabbitmq.com/docs/streams>

### 27.3 Hybrid Design

```text
Event published
   |
   +-> stream.audit.case-events        # retention/replay/audit
   |
   +-> quorum queue case.transition.q  # work processing
   |
   +-> notification.q                  # independent side effect
```

This is often better than forcing one primitive to solve everything.

---

## 28. Regulatory Case Management Example

### 28.1 Requirements

System handles enforcement cases:

- case opened,
- evidence submitted,
- officer assigned,
- review completed,
- escalation triggered,
- enforcement action proposed,
- case closed.

Requirement:

1. Events for same case must be applied in order.
2. Different cases can be processed in parallel.
3. Audit history must be replayable.
4. Notifications can be retried independently.
5. Slow document OCR must not block state transition.

### 28.2 Bad Design

```text
case.events.q
  -> many competing consumers
```

All event types, all cases, all side effects in one queue.

Problems:

- per-case ordering broken,
- slow OCR blocks/loads same lane,
- retry storm affects critical transitions,
- DLQ analysis unclear,
- no clean audit replay.

### 28.3 Better Design

```text
case.events.topic.x
  |
  +-- case.state.*        -> case.state.hash.x -> case.state.p0.q
  |                                             -> case.state.p1.q
  |                                             -> case.state.p2.q
  |                                             -> case.state.p3.q
  |
  +-- case.notification.* -> case.notification.q
  |
  +-- case.document.*     -> case.document.ocr.q
  |
  +-- case.audit.*        -> case.audit.stream
```

### 28.4 Processing Rules

State partitions:

```text
routing key/hash key = caseId
single active consumer per partition queue
manual ack after DB commit
transition guard in DB/state machine
```

Notification queue:

```text
competing consumers
prefetch 20
idempotency by notificationId
retry with backoff
parking lot after max attempts
```

Document OCR queue:

```text
competing consumers
prefetch 2-5
long timeout
separate DLQ
does not block case state transition
```

Audit stream:

```text
append-only
retention-based
replayable
not used as immediate work queue
```

---

## 29. Observability for Ordering and Work Distribution

### 29.1 Metrics to Watch

Per queue:

- ready messages,
- unacked messages,
- deliver rate,
- ack rate,
- redelivery rate,
- consumer count,
- consumer utilization,
- message age,
- DLQ rate.

Per consumer:

- processing latency,
- ack latency,
- duplicate detection count,
- invalid transition count,
- out-of-order count,
- retry count,
- external call latency.

Per partition:

- queue depth,
- oldest message age,
- hot partition ratio,
- partition throughput,
- active consumer identity.

### 29.2 Hot Partition Detection

```text
p0 depth: 100
p1 depth: 120
p2 depth: 50,000  <-- hot
p3 depth: 90
```

Then ask:

- Is there a hot key?
- Is one consumer slow?
- Is downstream DB locked?
- Did one partition receive poison messages?
- Is hash distribution bad?

### 29.3 Logs Must Include

Every handler log should include:

```text
messageId
messageType
correlationId
causationId
aggregateId / key
partition / queue
redelivered
attempt
consumerName
deliveryTag if useful locally
```

Without this, ordering bugs are hard to reconstruct.

---

## 30. Testing Ordering and Concurrency

### 30.1 Test: Single Consumer FIFO

Publish:

```text
M1, M2, M3
```

Assert handler applies:

```text
M1, M2, M3
```

### 30.2 Test: Competing Consumers Break Completion Order

Publish messages where M1 sleeps longer.

Expected:

```text
M2 may complete before M1
```

This test is educational. It prevents false assumptions.

### 30.3 Test: Per-Key Partition

Publish:

```text
case-1 seq 1
case-2 seq 1
case-1 seq 2
case-2 seq 2
```

Assert:

```text
case-1 applied 1 -> 2
case-2 applied 1 -> 2
```

Completion across cases may interleave.

### 30.4 Test: Redelivery

Simulate:

1. process M1,
2. crash before ack,
3. redeliver M1,
4. ensure idempotency catches duplicate.

### 30.5 Test: Out-of-Order Protection

Publish:

```text
caseVersion 2 before caseVersion 1
```

Assert:

- handler rejects,
- parks,
- delays,
- or reports deterministic invalid order.

Do not let it silently corrupt state.

---

## 31. Common Anti-Patterns

### 31.1 “RabbitMQ Guarantees Order, So We Are Safe”

Too vague. Ask:

- one consumer or many?
- prefetch?
- redelivery?
- retry?
- priority?
- executor?
- side effect order?

### 31.2 One Queue for All Domain Events

This mixes:

- different cost,
- different SLA,
- different failure mode,
- different ordering needs.

### 31.3 High Prefetch With Slow External Calls

Consumer hoards messages and causes unfairness.

### 31.4 Ack Before Side Effect

Message loss if process crashes after ack but before state update.

### 31.5 Ack After Non-Idempotent Side Effect Without Dedup

Duplicate side effect if process crashes after side effect but before ack.

### 31.6 Parallel Processing for Same Aggregate Without State Guard

Race condition in business state.

### 31.7 Increasing Consumer Count to Fix Hot Key

If hot key requires serial order, more consumers do not help that key.

### 31.8 Partition Count Changed Without Drain/Migration

Key can move partition while old messages remain in old partition.

### 31.9 Retry Immediate Requeue for Ordered Workflow

Can create out-of-order effects or retry storms.

### 31.10 Treating DLQ Replay as Harmless

DLQ replay can reintroduce old messages into a newer state. Always validate sequence/version.

---

## 32. Design Review Checklist

For every RabbitMQ queue, answer:

### 32.1 Ordering

- Is ordering needed?
- Global or per key?
- What is the key?
- What happens if messages complete out of order?
- Is priority enabled?
- Can redelivery violate assumptions?

### 32.2 Concurrency

- How many consumers?
- How many threads per consumer?
- What is prefetch?
- Does one channel cross threads?
- What is max in-flight message count?

### 32.3 Failure

- What happens on handler crash?
- What happens on ack failure?
- What happens on duplicate delivery?
- What happens on poison message?
- What happens on downstream outage?

### 32.4 Partitioning

- Is there a hot key?
- How many partitions?
- Can partition count change safely?
- How do we monitor per partition?
- Is routing deterministic?

### 32.5 State Safety

- Is idempotency implemented?
- Is transition guarded?
- Is version checked?
- Can stale messages be detected?
- Can DLQ replay corrupt state?

---

## 33. Practical Heuristics

1. Use competing consumers only when messages are independent or state is guarded.
2. Use prefetch as a deliberate concurrency budget, not a random performance setting.
3. For strict order, start with prefetch 1.
4. For per-entity order, partition by entity key.
5. For global order, challenge the requirement hard.
6. Do not mix slow side effects with critical state transition queues.
7. Put idempotency in the database or durable store, not memory.
8. Use state machine guards even if queue order seems reliable.
9. Avoid immediate requeue for persistent failures.
10. Monitor unacked count; it represents work already removed from ready queue but not completed.
11. High throughput and strict ordering can coexist only if ordering scope is narrow.
12. A hot key cannot be fixed by adding consumers if that key must remain serial.
13. DLQ replay is a new publish event into a changed world; validate accordingly.
14. A queue is a work lane; design lanes explicitly.
15. If you cannot explain what happens when M2 finishes before M1, the design is incomplete.

---

## 34. Mini Lab

### Lab 1: Observe Completion Out-of-Order

Create one queue with three consumers.

Publish:

```text
M1 sleep 5s
M2 sleep 100ms
M3 sleep 100ms
```

Observe completion.

Expected:

```text
M2/M3 may finish before M1
```

Lesson:

> Queue order is not completion order under concurrency.

### Lab 2: Prefetch Hoarding

Set:

```text
consumer A prefetch 10, slow
consumer B prefetch 10, fast
```

Publish 20 messages.

Observe unacked distribution.

Lesson:

> High prefetch can reduce fairness.

### Lab 3: Per-Key Partition

Implement:

```text
hash(caseId) % 4
```

Publish interleaved case events.

Assert per-case order.

### Lab 4: Hot Key

Publish:

```text
10,000 messages for case-hot
100 messages spread across 100 other cases
```

Observe one partition growing.

### Lab 5: Redelivery and Idempotency

Process message, commit DB, crash before ack.

Assert duplicate delivery does not duplicate business effect.

---

## 35. Summary

RabbitMQ can preserve queue order under specific conditions, but production systems rarely operate under only those conditions. Once you add competing consumers, prefetch, retries, redelivery, executor pools, external calls, and DLQ replay, “FIFO” becomes only one part of a larger correctness model.

The real mastery is not memorizing that RabbitMQ queues are FIFO. The real mastery is knowing how to narrow ordering requirements until the system can scale safely.

A strong RabbitMQ design usually says:

```text
This workload needs no ordering, so it uses competing consumers.
This workload needs per-case ordering, so it is partitioned by caseId.
This workload needs audit replay, so it is written to stream.
This workload has slow side effects, so it has a separate queue.
This state transition is guarded by idempotency and version checks.
```

That is the level of specificity required for production-grade messaging.

---

## 36. Part 13 Completion Checklist

You are ready to move on if you can explain:

- why FIFO queue does not guarantee FIFO business effect,
- how prefetch affects concurrency and fairness,
- why competing consumers weaken ordering assumptions,
- when single active consumer is useful,
- how to design per-key ordering,
- why partition count changes are dangerous,
- how hot keys limit scalability,
- why idempotency is still required even with ordering,
- how to test redelivery and out-of-order handling,
- how to separate workload lanes by semantics, cost, SLA, and failure mode.

---

## 37. What Comes Next

Next part:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-14.md
```

Topic:

```text
RPC, Request/Reply, Correlation, Timeout, and Why It Is Dangerous
```

Part 14 akan membahas kapan request/reply via RabbitMQ masuk akal, kenapa sering menjadi distributed synchronous dependency yang tersembunyi, bagaimana menggunakan `reply-to`, `correlationId`, direct reply-to, timeout, duplicate replies, dan kapan HTTP/gRPC lebih cocok.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-12.md">⬅️ Part 12 — Message Contract Design untuk Java Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-14.md">Part 14 — RPC, Request/Reply, Correlation, Timeout, and Why It Is Dangerous ➡️</a>
</div>

# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-04.md

# Part 04 — Queue Semantics: Classic, Quorum, Stream

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Bagian: `04 / 34`  
> Fokus: memahami queue type RabbitMQ modern sebagai primitive arsitektur, bukan hanya opsi konfigurasi.

---

## 0. Tujuan Bagian Ini

Di part sebelumnya kita membahas exchange routing: bagaimana RabbitMQ menentukan *ke mana* message dikirim. Sekarang kita masuk ke pertanyaan yang lebih fundamental:

> Setelah message sampai ke tujuan, struktur data apa yang menyimpannya, bagaimana message dikonsumsi, dan failure semantics apa yang berlaku?

Dalam RabbitMQ modern, jawaban ini sangat bergantung pada **queue type**.

RabbitMQ bukan hanya punya satu bentuk antrean. RabbitMQ modern menyediakan beberapa primitive yang berbeda:

1. **Classic Queue**  
   Queue tradisional RabbitMQ. Cocok untuk simple work queue, dev/test, ephemeral workload, atau workload non-kritis tertentu.

2. **Quorum Queue**  
   Durable replicated FIFO queue berbasis Raft. Dirancang untuk data safety, predictable failure handling, dan high availability.

3. **Stream**  
   Persistent replicated append-only log dengan konsumsi non-destruktif, retention, offset, dan replay.

Ketiganya sama-sama bisa tampak seperti “tempat message masuk”, tetapi mental model, cost model, dan design implication-nya berbeda jauh.

Kesalahan banyak engineer adalah memperlakukan queue type sebagai detail operasional:

```text
"Nanti ops saja yang pilih classic/quorum/stream. Dari sisi aplikasi sama saja."
```

Itu salah untuk sistem serius.

Queue type menentukan:

- apakah message hilang saat node mati,
- apakah consumer menghapus message dari struktur penyimpanan,
- apakah message bisa direplay,
- apakah ordering relatif stabil,
- bagaimana poison message ditangani,
- bagaimana broker melakukan replication,
- bagaimana storage tumbuh,
- bagaimana sistem bereaksi saat consumer lambat,
- bagaimana recovery dilakukan setelah crash,
- dan berapa operational cost yang harus dibayar.

Bagian ini akan membentuk mental model yang akan dipakai sepanjang seri.

---

## 1. Sumber Resmi dan Baseline RabbitMQ Modern

Beberapa baseline penting untuk RabbitMQ modern:

- Dokumentasi RabbitMQ menyatakan bahwa **quorum queue** adalah queue type modern yang durable dan replicated, berbasis **Raft consensus algorithm**.
- Dokumentasi RabbitMQ menyatakan bahwa **classic queue mirroring** adalah fitur lama yang sudah deprecated lama dan di RabbitMQ 4.x sudah dihapus; pengganti modernnya adalah **quorum queues** dan/atau **streams**.
- Dokumentasi RabbitMQ tentang streams menyebut stream sebagai **append-only log** dengan konsumsi **non-destructive**; membaca stream tidak menghapus message dari stream.
- Dokumentasi RabbitMQ queues membedakan classic queues, quorum queues, dan streams sebagai queue/data structure dengan trade-off berbeda.

Referensi utama:

- RabbitMQ Queues Documentation: <https://www.rabbitmq.com/docs/queues>
- RabbitMQ Quorum Queues Documentation: <https://www.rabbitmq.com/docs/quorum-queues>
- RabbitMQ Classic Queue Mirroring Deprecated/Removed: <https://www.rabbitmq.com/docs/3.13/ha>
- RabbitMQ Streams Overview: <https://www.rabbitmq.com/blog/2021/07/13/rabbitmq-streams-overview>

---

## 2. Mental Model Utama: Queue Type Adalah Contract

Queue type bukan hanya storage implementation. Queue type adalah **runtime contract** antara producer, broker, consumer, dan operator.

Bayangkan ada message:

```json
{
  "message_id": "msg-1001",
  "type": "case.review.requested",
  "case_id": "CASE-7781",
  "occurred_at": "2026-06-19T09:12:00Z"
}
```

Saat message itu masuk ke RabbitMQ, pertanyaan pentingnya:

1. Apakah message harus tetap aman jika node broker mati?
2. Apakah message boleh hilang setelah satu consumer menerima tapi belum selesai proses?
3. Apakah message bisa diproses ulang 3 hari kemudian?
4. Apakah satu message buruk boleh memblokir queue?
5. Apakah throughput lebih penting dari data safety?
6. Apakah consumer group perlu membaca message yang sama dari awal?
7. Apakah workload-nya command/job atau event log?
8. Apakah queue harus highly available?
9. Apakah sistem butuh replay untuk audit atau projection rebuild?
10. Apakah storage broker boleh menjadi historical data store?

Jawaban-jawaban ini menentukan apakah kamu memilih classic queue, quorum queue, atau stream.

---

## 3. Queue Tradisional: Destructive Consumption

Sebelum membahas tipe, pahami dulu konsep “queue tradisional”.

Queue tradisional bekerja seperti mailbox kerja:

```text
Producer
   |
   v
Queue: [M1, M2, M3, M4]
   |
   v
Consumer receives M1
Consumer ack M1
Queue becomes [M2, M3, M4]
```

Jika consumer sukses dan mengirim ack, message dianggap selesai dan dihapus dari queue.

Ini disebut **destructive consumption**.

Artinya:

- message ada untuk dikerjakan,
- setelah selesai, message tidak lagi menjadi bagian dari queue,
- queue bukan historical log,
- queue depth merepresentasikan backlog pekerjaan,
- consumer yang datang belakangan tidak bisa membaca message lama yang sudah diack.

Ini sangat cocok untuk:

- background jobs,
- command processing,
- task distribution,
- asynchronous handoff,
- retryable workload,
- operational work queues.

Tetapi tidak cocok untuk:

- event sourcing,
- analytics replay,
- rebuilding projection dari awal,
- multiple independent consumers yang masing-masing perlu history lengkap,
- audit log jangka panjang.

Classic queue dan quorum queue memakai model konsumsi destruktif. Stream tidak.

---

## 4. Stream: Non-Destructive Consumption

Stream memakai model berbeda.

```text
Stream: [M1, M2, M3, M4, M5, M6]
          ^
          consumer A offset = 2

Stream: [M1, M2, M3, M4, M5, M6]
                  ^
                  consumer B offset = 4
```

Consumer membaca message, tetapi message tidak hilang hanya karena dibaca.

Message tetap ada sampai retention policy menghapusnya.

Ini disebut **non-destructive consumption**.

Konsekuensi:

- consumer punya posisi baca sendiri,
- message bisa direplay,
- banyak consumer bisa membaca message yang sama pada posisi berbeda,
- storage dipengaruhi retention, bukan hanya backlog,
- queue depth bukan satu-satunya konsep penting; offset dan lag menjadi penting,
- stream lebih dekat ke event log dibanding work queue.

RabbitMQ Streams berguna ketika kamu ingin RabbitMQ melakukan sebagian pekerjaan yang biasanya diasosiasikan dengan log-based broker, tetapi tetap berada dalam ekosistem RabbitMQ.

---

## 5. Tiga Primitive, Tiga Pertanyaan

Untuk mengingat perbedaannya, gunakan tiga pertanyaan:

### 5.1 Classic Queue

> “Saya butuh antrean sederhana untuk kerja biasa, dan saya menerima keterbatasan HA/replication modern.”

Classic queue cocok saat:

- workload sederhana,
- tidak butuh replicated queue semantics,
- kehilangan message bukan fatal atau sudah ada compensating mechanism,
- local/dev/test,
- ephemeral task,
- low criticality workload,
- latency ringan lebih penting daripada replication safety.

### 5.2 Quorum Queue

> “Saya butuh queue kerja yang durable, replicated, dan aman untuk command/job penting.”

Quorum queue cocok saat:

- message penting,
- consumer ack harus aman,
- queue harus survive node failure,
- workload berbentuk command/task,
- destructive consumption tetap model yang benar,
- retry/DLQ/poison handling penting,
- production safety lebih penting daripada raw throughput maksimum.

### 5.3 Stream

> “Saya butuh append-only log yang bisa dibaca ulang, bukan queue kerja yang menghapus message setelah ack.”

Stream cocok saat:

- butuh replay,
- butuh retention,
- banyak consumer independent,
- audit/event history,
- projection rebuild,
- high-throughput append/read,
- event stream lebih penting daripada task queue,
- consumer progress berbasis offset.

---

## 6. Classic Queue

### 6.1 Apa Itu Classic Queue?

Classic queue adalah queue tradisional RabbitMQ yang sudah lama ada. Ia mendukung fitur-fitur umum RabbitMQ seperti:

- FIFO-ish ordering dalam batas tertentu,
- competing consumers,
- manual ack,
- TTL,
- dead-lettering,
- priority queue,
- max length,
- lazy behavior internal,
- routing dari exchange,
- persistent messages jika queue durable dan message persistent.

Classic queue adalah primitive yang sederhana dan familiar.

Tetapi dalam RabbitMQ modern, classic queue tidak lagi boleh dianggap sebagai default untuk semua production workload kritis.

### 6.2 Classic Queue dan Replication

Historically, classic queues pernah punya fitur mirrored queues. Itu lama digunakan untuk high availability.

Namun classic queue mirroring sudah deprecated lama dan di RabbitMQ 4.x sudah dihapus. Untuk replicated queue modern, RabbitMQ mengarahkan pengguna ke quorum queues dan/atau streams.

Konsekuensinya:

```text
Classic queue != modern replicated durable queue
```

Classic queue masih valid, tetapi kamu harus sadar bahwa durability dan availability-nya tidak sama dengan quorum queue.

### 6.3 Kapan Classic Queue Masuk Akal?

Classic queue masih bisa masuk akal untuk:

1. **Development dan testing**  
   Simpler, cepat, mudah dipahami.

2. **Ephemeral task**  
   Misalnya image thumbnail generation yang bisa direkonstruksi dari source object.

3. **Low criticality workload**  
   Misalnya cache warmup job, telemetry non-kritis, notification best-effort.

4. **Single-node deployment non-kritis**  
   Misalnya internal tool kecil.

5. **Feature tertentu yang tidak cocok/tersedia di quorum queue**  
   Namun ini harus diverifikasi terhadap versi RabbitMQ yang dipakai.

### 6.4 Kapan Classic Queue Tidak Cocok?

Classic queue tidak cocok sebagai default untuk:

- payment command,
- regulatory case transition,
- enforcement action request,
- legal notification command,
- irreversible side-effect job,
- critical integration handoff,
- any workload where message loss means business inconsistency.

Untuk workload seperti itu, gunakan quorum queue sebagai baseline.

### 6.5 Classic Queue Failure Model

Misal classic queue berada di node A.

```text
Node A hosts queue Q
Producer publishes M1
Consumer has not consumed M1 yet
Node A crashes
```

Pertanyaan:

- Apakah message persistent?
- Apakah queue durable?
- Apakah data sudah fsync?
- Apakah node kembali hidup?
- Apakah ada replica?

Jika kamu butuh reasoning yang sederhana seperti:

```text
Jika satu node mati, queue tetap available di node lain tanpa kehilangan committed message.
```

Classic queue bukan primitive yang tepat. Quorum queue lebih sesuai.

### 6.6 Classic Queue Design Rule

Gunakan rule ini:

```text
Classic queue boleh dipakai ketika kehilangan/penundaan/rebuild queue tidak merusak invariant bisnis.
```

Bukan:

```text
Classic queue dipakai karena default dan lebih familiar.
```

---

## 7. Quorum Queue

### 7.1 Apa Itu Quorum Queue?

Quorum queue adalah queue replicated dan durable yang menggunakan Raft consensus algorithm.

Mental model:

```text
Quorum Queue Q

Node A: leader replica
Node B: follower replica
Node C: follower replica

Publish -> leader -> replicated to followers -> committed by quorum
Consume -> coordinated through leader
Ack -> queue state updated safely
```

Quorum queue dirancang untuk memberikan failure semantics yang lebih aman dan lebih mudah dipahami dibanding classic mirrored queues lama.

### 7.2 Kenapa Namanya Quorum?

Karena perubahan state queue perlu disetujui oleh mayoritas replica.

Untuk 3 replica:

```text
quorum = 2 dari 3
```

Untuk 5 replica:

```text
quorum = 3 dari 5
```

Jika leader mati tetapi mayoritas replica masih tersedia, cluster dapat memilih leader baru.

### 7.3 Apa Yang Direplikasi?

Quorum queue mereplikasi state queue yang penting, termasuk message dan metadata terkait delivery. Detail internal bisa berubah antar versi, tetapi mental model yang harus kamu pegang:

```text
Queue state is replicated as a consensus-backed log.
```

Ini membuat quorum queue cocok untuk message yang harus survive node failure.

### 7.4 Quorum Queue Tetap Queue, Bukan Stream

Ini penting.

Quorum queue bukan Kafka topic.

Quorum queue tetap destructive-consumption queue:

```text
Message delivered -> consumer processes -> consumer ack -> message removed from queue state
```

Ia replicated dan durable, tetapi bukan historical log untuk replay arbitrary.

Jika kamu butuh replay message lama setelah sukses diproses, stream lebih cocok.

### 7.5 Kapan Quorum Queue Cocok?

Gunakan quorum queue untuk:

- command processing,
- background jobs kritis,
- task queue production,
- workflow transition,
- payment/invoice/order command,
- regulatory action command,
- integration handoff yang tidak boleh hilang,
- queue yang harus survive node failure,
- message yang boleh diproses sekali secara logical tetapi secara fisik bisa redelivered.

Contoh:

```text
exchange: enforcement.commands
routing-key: case.review.assign
queue: q.enforcement.case-review.assign.qq
queue-type: quorum
```

Kenapa quorum?

Karena assignment review adalah state transition penting. Kalau message hilang, case bisa stuck tanpa reviewer.

### 7.6 Quorum Queue dan Poison Message

Salah satu fitur penting quorum queue adalah delivery limit.

Poison message problem:

```text
M1 selalu gagal diproses
Consumer nack requeue true
M1 redelivered
Consumer gagal lagi
Loop selamanya
```

Jika tidak dikontrol, poison message bisa:

- membakar CPU,
- menambah log noise,
- membuat queue tidak maju,
- menyebabkan retry storm,
- mengganggu message sehat di belakangnya,
- menyembunyikan failure permanen.

Quorum queue mendukung mekanisme delivery limit agar message yang sudah terlalu sering redelivered bisa dead-lettered atau dropped sesuai konfigurasi.

Mental model:

```text
M1 delivery count exceeds limit
=> M1 no longer requeued endlessly
=> M1 moved to DLQ or handled by configured policy
```

Ini sangat penting untuk sistem produksi.

### 7.7 Quorum Queue Cost Model

Quorum queue lebih aman, tetapi tidak gratis.

Biayanya:

- replication write overhead,
- disk I/O lebih besar,
- latency commit bisa lebih tinggi,
- throughput bisa lebih rendah dibanding classic queue untuk workload tertentu,
- butuh mayoritas node hidup,
- butuh capacity planning yang lebih serius,
- lebih sensitif terhadap disk/network latency.

Trade-off ini normal. Safety memang punya harga.

### 7.8 Quorum Queue Sizing

Umumnya quorum queue dipakai dengan replication factor 3 untuk banyak production cluster.

Mental model:

```text
3 replicas => tolerate 1 node failure
5 replicas => tolerate 2 node failures, cost lebih tinggi
```

Jangan otomatis memilih 5 replica hanya karena “lebih aman”.

Pertanyaan yang harus dijawab:

- Berapa failure domain?
- Berapa latency antar node?
- Apakah semua node dalam satu region/AZ atau multi-AZ?
- Apakah disk cukup cepat?
- Berapa publish rate?
- Berapa message size?
- Berapa backlog maksimum?
- Berapa recovery time yang diterima?

### 7.9 Quorum Queue dan Large Backlog

Quorum queue aman, tetapi bukan berarti boleh dibiarkan menampung backlog tak terbatas.

Backlog besar menyebabkan:

- disk growth,
- recovery lebih lama,
- replication catch-up lebih berat,
- operational debugging lebih sulit,
- DLQ/retry problem terlambat terlihat,
- memory/disk alarm risk.

Rule:

```text
Queue is a buffer, not a data lake.
```

Jika kamu ingin menyimpan event selama hari/bulan untuk replay, gunakan stream atau storage lain.

### 7.10 Quorum Queue Design Rule

Gunakan rule ini:

```text
Quorum queue adalah default production choice untuk durable command/task queue yang tidak boleh hilang.
```

Tetapi jangan gunakan quorum queue untuk:

- long-term event retention,
- analytics replay,
- high fan-out historical consumers,
- arbitrary replay dari awal.

Untuk itu, gunakan stream.

---

## 8. RabbitMQ Stream

### 8.1 Apa Itu Stream?

RabbitMQ stream adalah persistent replicated append-only log.

Mental model:

```text
Stream S:
Offset 0: M0
Offset 1: M1
Offset 2: M2
Offset 3: M3
Offset 4: M4
```

Consumer tidak “menghapus” message. Consumer membaca berdasarkan posisi.

```text
Consumer A offset = 2
Consumer B offset = 4
Consumer C offset = beginning
```

Masing-masing consumer bisa punya progress berbeda.

### 8.2 Stream Berbeda dari Queue

Queue tradisional:

```text
Message exists until acknowledged.
```

Stream:

```text
Message exists until retention removes it.
```

Queue:

```text
Backlog = work not completed.
```

Stream:

```text
Stored data = retained history.
Consumer lag = unread portion for a consumer.
```

Queue:

```text
Ack means remove from queue.
```

Stream:

```text
Offset means consumer progress.
```

### 8.3 Kapan Stream Cocok?

Gunakan stream untuk:

- audit log,
- immutable event history,
- projection rebuild,
- replayable integration events,
- event notification dengan retention,
- high-throughput append/read,
- multiple consumers yang independent,
- rebuilding read model,
- regulatory timeline reconstruction,
- downstream system catch-up.

Contoh:

```text
stream: s.case.lifecycle.events
retention: 30 days or size-based
consumer group: enforcement-projection
consumer group: notification-router
consumer group: audit-exporter
```

### 8.4 Kapan Stream Tidak Cocok?

Stream tidak otomatis cocok untuk semua asynchronous processing.

Hati-hati jika use case kamu:

- hanya butuh satu worker menyelesaikan job,
- butuh delete-on-success semantics,
- butuh retry/DLQ task semantics sederhana,
- butuh per-message work claiming seperti queue,
- tidak butuh replay,
- ingin backlog merepresentasikan “pekerjaan yang belum selesai”.

Untuk itu, queue lebih natural.

### 8.5 Stream Retention

Stream retention menentukan kapan data lama dibuang.

Retention bisa berbasis:

- size,
- time,
- kombinasi konfigurasi tertentu tergantung versi dan setting.

Mental model:

```text
Stream keeps messages because retention says so,
not because consumers have not acked them.
```

Konsekuensinya:

- consumer lambat tidak otomatis mencegah retention menghapus data lama,
- jika consumer terlalu tertinggal melewati retention window, ia bisa kehilangan kemampuan replay dari posisi lama,
- retention harus didesain berdasarkan RPO/replay requirement.

### 8.6 Stream dan Offset

Consumer perlu menentukan dari mana membaca:

- beginning,
- next,
- offset tertentu,
- timestamp tertentu,
- stored offset.

Untuk sistem produksi, offset bukan detail kecil. Offset adalah bagian dari state consumer.

Pertanyaan:

- Di mana offset disimpan?
- Kapan offset dianggap committed?
- Apakah commit offset sebelum side effect aman?
- Apakah commit offset setelah side effect bisa menghasilkan duplicate?
- Bagaimana recovery setelah consumer crash?

Ini sangat mirip dengan problem log consumption lain, tetapi implementasi RabbitMQ Streams punya mekanisme sendiri yang akan dibahas di part khusus.

### 8.7 Stream dan Ordering

Stream mempertahankan ordering dalam stream/partition tertentu.

Tetapi saat skala naik, kamu bisa memakai super streams/partitioning. Maka ordering menjadi per partition, bukan global.

Rule:

```text
Ordering guarantee always has a scope.
```

Jangan pernah mengatakan:

```text
"Stream menjamin ordering."
```

Katakan:

```text
"Stream menjamin ordering dalam scope stream/partition yang sama, sejauh producer dan consumer design tidak merusaknya."
```

### 8.8 Stream Cost Model

Stream cocok untuk throughput dan replay, tetapi punya cost:

- disk retention harus direncanakan,
- offset management lebih kompleks,
- consumer lag harus dimonitor,
- replay bisa membebani downstream,
- message contract harus lebih disiplin karena data hidup lebih lama,
- schema evolution lebih penting,
- tidak semua queue features berlaku sama.

Stream bukan “queue yang lebih keren”. Stream adalah primitive berbeda.

---

## 9. Perbandingan Ringkas

| Dimensi | Classic Queue | Quorum Queue | Stream |
|---|---:|---:|---:|
| Model | Queue tradisional | Replicated durable queue | Append-only log |
| Consumption | Destructive | Destructive | Non-destructive |
| Replay after ack/read | Tidak | Tidak | Ya, selama retention |
| Replication modern | Tidak seperti quorum | Ya, Raft | Ya, replicated stream |
| Best for | Simple/non-critical jobs | Critical jobs/commands | Event history/replay |
| Backlog meaning | Unprocessed messages | Unprocessed messages | Retained data + consumer lag |
| Consumer progress | Ack state | Ack state | Offset |
| Poison handling | DLX/retry design | Delivery limit + DLX/retry | Consumer-specific handling |
| Operational cost | Rendah/sedang | Sedang/tinggi | Sedang/tinggi |
| Data safety | Terbatas | Kuat | Kuat dengan retention model |
| Scaling read | Competing consumers | Competing consumers | Multiple readers/replay |
| Long-term retention | Buruk | Buruk | Cocok |
| Default for critical production queue | Tidak | Ya | Hanya jika use case stream |

---

## 10. Decision Tree

Gunakan decision tree berikut.

### 10.1 Apakah message harus bisa dibaca ulang setelah sukses diproses?

Jika ya:

```text
Gunakan Stream.
```

Jika tidak:

```text
Gunakan Queue.
```

### 10.2 Apakah message penting dan tidak boleh hilang saat node failure?

Jika ya:

```text
Gunakan Quorum Queue.
```

Jika tidak:

```text
Classic Queue bisa dipertimbangkan.
```

### 10.3 Apakah backlog bisa tumbuh besar karena consumer lambat?

Jika ya:

- queue: desain backpressure, autoscaling, DLQ, max length, alerting,
- stream: desain retention, lag alerting, replay plan.

Jangan hanya menaikkan disk.

### 10.4 Apakah message merepresentasikan command atau event?

Command:

```text
Biasanya quorum queue.
```

Event notification tanpa replay:

```text
Topic exchange + quorum queues untuk masing-masing subscriber kritis.
```

Event history/replay:

```text
Stream.
```

### 10.5 Apakah banyak service perlu membaca semua message secara independent?

Jika ya:

```text
Stream atau fanout/topic exchange ke queue masing-masing subscriber.
```

Pilih berdasarkan apakah history/replay dibutuhkan.

---

## 11. Common Design Scenarios

### 11.1 Background Job Non-Kritis

Contoh:

```text
Generate temporary report preview.
```

Sifat:

- bisa dicoba ulang,
- bisa direquest ulang oleh user,
- kehilangan satu job tidak fatal,
- throughput/latency sederhana.

Pilihan:

```text
Classic Queue bisa cukup.
```

Tetapi jika sistem production standar mengharuskan semua queue replicated, quorum queue tetap bisa dipakai.

### 11.2 Payment Capture Command

Contoh:

```text
payment.capture.requested
```

Sifat:

- command penting,
- side effect eksternal,
- tidak boleh hilang,
- duplicate harus dikontrol,
- retry harus hati-hati,
- audit penting.

Pilihan:

```text
Quorum Queue + idempotent consumer + DLQ + outbox/inbox.
```

Bukan stream sebagai default, karena ini adalah work command, bukan historical log. Namun event hasilnya bisa ditulis ke stream audit.

### 11.3 Case Lifecycle Audit

Contoh:

```text
case.opened
case.assigned
case.reviewed
case.escalated
case.closed
```

Sifat:

- perlu historical timeline,
- mungkin perlu replay,
- audit/regulatory reconstruction,
- multiple readers.

Pilihan:

```text
Stream.
```

Bisa juga publish event ke topic exchange untuk live subscribers, tetapi stream adalah tempat history/replay.

### 11.4 Email Notification Sending

Contoh:

```text
notification.email.send
```

Sifat:

- job async,
- bisa retry,
- duplicate bisa dikontrol dengan message id/provider id,
- tidak perlu replay semua email lama dari broker.

Pilihan:

```text
Quorum Queue untuk production.
Classic Queue untuk non-critical/internal.
```

### 11.5 Search Projection Rebuild

Contoh:

```text
Rebuild Elasticsearch projection from case events.
```

Sifat:

- perlu replay dari awal atau timestamp tertentu,
- projection bisa dibangun ulang,
- consumer offset penting.

Pilihan:

```text
Stream.
```

### 11.6 Webhook Delivery

Contoh:

```text
Send webhook to external agency.
```

Sifat:

- external side effect,
- retry/backoff,
- DLQ/manual repair,
- audit.

Pilihan:

```text
Quorum Queue for delivery commands
+ Stream for delivery event audit if needed.
```

---

## 12. Hybrid Pattern: Queue + Stream

Dalam sistem serius, kamu sering tidak memilih hanya satu primitive.

Contoh regulatory case system:

```text
1. User submits evidence
2. Application commits DB transaction
3. Outbox relay publishes event
4. Event goes to exchange
5. Live workflow command goes to quorum queue
6. Audit copy goes to stream
```

Topology:

```text
exchange: case.events.topic

binding -> q.case-risk-evaluator.qq
binding -> q.case-notification.qq
binding -> stream.case-lifecycle
```

Dengan desain ini:

- quorum queue menangani pekerjaan live,
- stream menyimpan sejarah/replay,
- setiap consumer punya primitive yang sesuai.

Mental model:

```text
Use queues for work.
Use streams for history.
Use exchanges for routing.
```

Ini salah satu kalimat paling penting dalam RabbitMQ architecture.

---

## 13. Queue Type dan Message Semantics

### 13.1 Command

Command adalah instruksi untuk melakukan sesuatu.

Contoh:

```json
{
  "type": "case.review.assign.command",
  "case_id": "CASE-1001",
  "assignee": "officer-17"
}
```

Command biasanya:

- punya target handler,
- harus diproses,
- side effect oriented,
- tidak perlu dibaca oleh banyak consumer independent,
- tidak natural untuk replay massal.

Queue type:

```text
Quorum Queue
```

### 13.2 Event

Event menyatakan sesuatu sudah terjadi.

Contoh:

```json
{
  "type": "case.review.assigned",
  "case_id": "CASE-1001",
  "assignee": "officer-17"
}
```

Event bisa dipakai dua cara:

1. **Live notification**  
   Service lain perlu tahu sekarang.

2. **Historical fact**  
   Sistem perlu menyimpan dan replay.

Queue type:

```text
Live notification: exchange + quorum queues per subscriber
Historical/replay: stream
```

### 13.3 Job

Job adalah unit kerja teknis.

Contoh:

```json
{
  "type": "pdf.generate.job",
  "document_id": "DOC-88"
}
```

Queue type:

```text
Classic Queue jika non-kritis
Quorum Queue jika penting
```

### 13.4 Audit Record

Audit record adalah fakta yang harus bisa ditelusuri.

Queue type:

```text
Stream atau external audit store
```

Jangan mengandalkan queue biasa sebagai audit store.

---

## 14. Ordering Semantics per Queue Type

Ordering sering disalahpahami.

### 14.1 Queue FIFO Bukan Global Ordering Guarantee

Queue bisa memberikan FIFO-ish ordering, tetapi beberapa hal bisa mengubah observasi ordering:

- multiple consumers,
- prefetch > 1,
- redelivery,
- nack/requeue,
- priority queue,
- retry topology,
- multiple queues,
- multiple publishers,
- network timing,
- consumer processing time.

Contoh:

```text
Queue: M1, M2
Consumer A receives M1, slow
Consumer B receives M2, fast
M2 side effect committed before M1
```

Queue delivery order tidak sama dengan business effect order.

### 14.2 Quorum Queue Ordering

Quorum queue tetap queue. Ia tidak membuat distributed business ordering magically solved.

Jika kamu butuh per-case ordering:

- route per key ke queue tertentu,
- gunakan single active consumer,
- gunakan prefetch 1,
- atau implement state-machine guard/idempotency di consumer.

### 14.3 Stream Ordering

Stream ordering berlaku dalam stream/partition.

Jika kamu memakai super stream/partitioning, ordering scope menjadi partition.

Untuk per-entity ordering:

```text
entity_id -> partition routing key
```

Akan dibahas lebih lanjut di part stream/super stream.

---

## 15. Durability Semantics

Durability bukan satu checkbox.

Untuk queue tradisional, ada beberapa level:

1. Durable queue/exchange.
2. Persistent message.
3. Publisher confirm.
4. Replication safety jika memakai quorum.
5. Consumer ack setelah side effect aman.
6. Idempotent processing untuk redelivery.

Salah satu kesalahan klasik:

```text
Queue durable, therefore message safe.
```

Tidak cukup.

Jika producer publish tanpa confirm, producer tidak tahu apakah broker benar-benar menerima message.

Jika message tidak persistent, durable queue saja tidak cukup.

Jika classic queue ada di single node dan node/storage gagal, durability story berbeda dari quorum.

Jika consumer auto-ack sebelum proses selesai, message bisa hilang walaupun queue durable.

Mental model lengkap:

```text
Safe messaging = safe publish + safe storage + safe delivery + safe processing + safe recovery.
```

Queue type hanya satu bagian dari safety chain.

---

## 16. Redelivery Semantics

Classic queue dan quorum queue mendukung redelivery ketika message sudah dikirim ke consumer tetapi belum diack lalu channel/connection/consumer mati.

Contoh:

```text
Consumer receives M1
Consumer writes half of side effect
Consumer crashes before ack
RabbitMQ requeues/redelivers M1
Another consumer receives M1
```

Maka consumer harus idempotent.

Quorum queue memberi primitive tambahan seperti delivery limit untuk mengontrol redelivery berulang.

Stream berbeda. Consumer membaca offset. Jika consumer crash sebelum offset disimpan, ia bisa membaca message yang sama lagi saat restart.

Jadi duplicate tetap mungkin di semua model.

Rule:

```text
Every serious consumer must tolerate duplicates.
```

---

## 17. Queue Type dan Backpressure

### 17.1 Classic/Quorum Queue Backpressure

Backpressure utama:

- prefetch,
- consumer concurrency,
- publisher confirms,
- broker memory/disk alarms,
- max queue length,
- TTL,
- operational scaling.

Queue depth berarti pekerjaan belum selesai.

Jika queue depth naik:

```text
producer rate > consumer completion rate
```

Atau:

```text
consumer failing/retrying
```

Atau:

```text
routing bug sends too much work to queue
```

### 17.2 Stream Backpressure

Stream punya konsep consumer lag.

Jika lag naik:

```text
consumer read/process rate < stream append rate
```

Tetapi stream retention bisa tetap menghapus data lama. Lag harus dibandingkan dengan retention window.

Jika consumer lag melewati retention:

```text
consumer cannot replay from lost offset
```

Itu bukan sekadar performa problem. Itu data recovery problem.

---

## 18. Queue Type dan DLQ

### 18.1 Queue DLQ

Classic/quorum queue biasa memakai DLX/DLQ.

Flow:

```text
Main Queue -> processing fails -> reject/nack without requeue or delivery limit exceeded -> DLX -> DLQ
```

DLQ berarti:

- message tidak hilang,
- message dipisahkan dari main flow,
- operator bisa inspeksi,
- repair/replay manual bisa dilakukan.

### 18.2 Stream Failure Handling

Stream tidak memiliki konsep “message dihapus dari main queue lalu masuk DLQ” dengan cara yang sama.

Failure handling stream biasanya consumer-side:

- store failed offset/message id,
- publish failure event,
- write to error queue,
- maintain retry queue separately,
- pause consumer group,
- skip with audit,
- reprocess from offset.

Untuk stream, DLQ bukan primitive yang sama seperti queue. Kamu harus mendesain failure lane.

### 18.3 Hybrid Failure Lane

Pattern umum:

```text
Stream -> consumer -> if processing fails permanently -> publish to quorum DLQ/parking lot
```

Atau:

```text
Quorum Queue -> successful state transition -> append audit event to Stream
```

---

## 19. Naming Convention Queue Type

Gunakan nama yang membuat queue type terlihat.

Contoh:

```text
q.case-review.assign.qq
q.notification-email.send.qq
q.thumbnail-generate.classic
s.case-lifecycle.events
s.audit.enforcement-actions
```

Suffix bisa membantu:

- `.qq` untuk quorum queue,
- `.cq` atau `.classic` untuk classic queue,
- prefix `s.` untuk stream.

Naming bukan kosmetik. Naming membantu reviewer melihat risk.

Buruk:

```text
case_queue
new_queue
events
worker
```

Baik:

```text
q.enforcement.case-review.assign.qq
q.integration.webhook-delivery.qq
s.enforcement.case-lifecycle
```

---

## 20. Java/Spring Declaration Examples

Detail Java/Spring akan dibahas di part khusus. Di sini cukup lihat mental model deklarasinya.

### 20.1 Quorum Queue dengan Spring AMQP

```java
@Bean
Queue caseReviewQueue() {
    return QueueBuilder
            .durable("q.enforcement.case-review.assign.qq")
            .quorum()
            .deadLetterExchange("enforcement.dlx")
            .deadLetterRoutingKey("case-review.assign.failed")
            .build();
}
```

Makna desain:

- durable queue,
- quorum queue,
- failure diarahkan ke DLX,
- nama menunjukkan domain dan type.

### 20.2 Classic Queue dengan Spring AMQP

```java
@Bean
Queue thumbnailQueue() {
    return QueueBuilder
            .durable("q.media.thumbnail-generate.classic")
            .ttl(30 * 60 * 1000)
            .maxLength(100_000)
            .build();
}
```

Makna desain:

- workload non-kritis,
- ada TTL,
- ada max length,
- tidak dibiarkan infinite.

### 20.3 Stream Declaration Conceptual

Deklarasi stream bisa dilakukan dengan argument queue type stream atau stream tooling/client tergantung cara akses.

Konseptual:

```text
name: s.case-lifecycle.events
x-queue-type: stream
retention: size/time-based
```

Makna desain:

- event history,
- replayable,
- retention eksplisit,
- consumer offset harus dikelola.

---

## 21. Architecture Review Checklist

Saat review topology RabbitMQ, tanyakan ini untuk setiap queue/stream.

### 21.1 Identity

- Apa nama queue/stream?
- Siapa owner-nya?
- Domain apa yang direpresentasikan?
- Apakah ini command, event, job, audit, atau integration handoff?

### 21.2 Queue Type

- Kenapa classic/quorum/stream dipilih?
- Apakah choice ini eksplisit atau default?
- Apa failure model yang diterima?
- Apakah queue harus survive node failure?
- Apakah message perlu replay setelah sukses diproses?

### 21.3 Durability

- Queue durable?
- Message persistent?
- Publisher confirm aktif?
- Consumer manual ack?
- Consumer idempotent?
- DLQ tersedia?

### 21.4 Capacity

- Berapa expected publish rate?
- Berapa expected processing rate?
- Berapa message size?
- Berapa max backlog?
- Berapa retention jika stream?
- Apa alert threshold?

### 21.5 Failure

- Apa yang terjadi jika consumer crash?
- Apa yang terjadi jika broker node crash?
- Apa yang terjadi jika message selalu gagal?
- Apa yang terjadi jika downstream lambat?
- Apa yang terjadi jika DLQ penuh?
- Apa manual remediation path?

### 21.6 Compliance/Audit

- Apakah message punya message id?
- Apakah correlation id ada?
- Apakah causation id ada?
- Apakah event bisa direkonstruksi?
- Apakah DLQ decision bisa diaudit?
- Apakah replay aman secara bisnis?

---

## 22. Common Misconceptions

### 22.1 “Durable Queue Berarti Aman”

Tidak cukup.

Aman butuh:

- durable queue,
- persistent message,
- publisher confirm,
- storage safety,
- replication jika butuh HA,
- manual ack,
- idempotent consumer.

### 22.2 “Quorum Queue Selalu Lebih Baik”

Quorum queue lebih aman untuk banyak production queue, tetapi lebih mahal.

Ia bukan pengganti stream.

Ia juga tidak menyelesaikan:

- schema evolution,
- idempotency,
- poison message design,
- bad retry policy,
- downstream side effect duplicate.

### 22.3 “Stream Sama Dengan Kafka Topic”

Mirip dalam beberapa mental model, tetapi bukan identik.

RabbitMQ Streams hidup dalam ekosistem RabbitMQ, punya protocol/client/operational semantics sendiri, dan tidak otomatis menggantikan Kafka untuk semua event streaming use case.

### 22.4 “Queue Bisa Jadi Audit Log”

Queue biasa menghapus message setelah ack.

Jika butuh audit log, gunakan stream atau audit storage.

### 22.5 “Ordering Dijamin Selama Pakai Queue”

Ordering bisa rusak oleh concurrency, redelivery, retry, priority, dan side effect timing.

Ordering harus didesain end-to-end.

---

## 23. RabbitMQ Queue Type Selection Matrix

Gunakan matrix ini sebagai starting point.

| Use Case | Recommended Primitive | Reason |
|---|---|---|
| Critical command | Quorum Queue | Durable replicated destructive work queue |
| Non-critical async job | Classic or Quorum Queue | Depends on loss tolerance |
| Email/webhook delivery | Quorum Queue | Retry/DLQ/side-effect control |
| Audit trail | Stream | Retention and replay |
| Event projection rebuild | Stream | Consumer can replay history |
| Cache invalidation best-effort | Classic or Quorum Queue | Depends on criticality |
| Integration event live subscribers | Topic exchange + queues | Each subscriber owns processing state |
| Integration event with replay | Stream | History retained |
| High fan-out notification without replay | Fanout/topic exchange + per-subscriber queue | Queue backlog per subscriber |
| Per-case workflow command | Quorum Queue | Safety and redelivery control |
| Large binary transfer | Neither directly | Store object externally, send reference |
| Long-term analytics | Usually not queue; stream maybe short/medium retention | Use analytical storage for long-term |

---

## 24. Design Exercise: Enforcement Case Platform

Misal kita punya domain regulatory enforcement.

Events:

```text
case.opened
case.evidence.submitted
case.risk-score.requested
case.risk-score.completed
case.review.assigned
case.escalation.triggered
case.enforcement-action.proposed
case.notice.sent
case.closed
```

Commands:

```text
case.risk-score.calculate
case.review.assign
notice.generate
webhook.deliver
email.send
```

Audit needs:

```text
timeline reconstruction
replay projection
investigation after incident
prove why escalation happened
```

Recommended topology:

```text
exchange: enforcement.events.topic
exchange: enforcement.commands.direct
exchange: enforcement.dlx

quorum queues:
- q.enforcement.risk-score.calculate.qq
- q.enforcement.case-review.assign.qq
- q.enforcement.notice-generate.qq
- q.enforcement.webhook-deliver.qq
- q.enforcement.email-send.qq

streams:
- s.enforcement.case-lifecycle
- s.enforcement.audit-actions

dlq/parking lot:
- q.enforcement.risk-score.calculate.dlq.qq
- q.enforcement.webhook-deliver.dlq.qq
- q.enforcement.manual-review.parking.qq
```

Reasoning:

- commands are work: use quorum queues,
- events are live routed through exchange,
- historical audit is stream,
- poison messages go to DLQ/parking lot,
- every side-effect consumer is idempotent,
- every command has correlation/causation id.

---

## 25. Failure Walkthrough

### Scenario

A service publishes:

```text
case.review.assign
```

Message enters quorum queue:

```text
q.enforcement.case-review.assign.qq
```

Consumer receives message, writes DB assignment, then crashes before ack.

### What Happens?

RabbitMQ sees the delivery was not acknowledged. Message can be redelivered.

Another consumer receives same message.

If consumer is not idempotent:

```text
Duplicate assignment may occur.
```

If consumer is idempotent:

```text
It detects assignment_command_id already applied
=> does not duplicate side effect
=> ack message
```

### What Queue Type Solved

Quorum queue helped ensure the message was not lost due to node failure.

### What Queue Type Did Not Solve

Quorum queue did not solve duplicate side effect.

Application design solved that via idempotency.

Lesson:

```text
Queue type provides broker-level safety.
Application invariants provide business-level safety.
```

---

## 26. Practical Heuristics

1. For critical production command queues, start with quorum queue.
2. For event history and replay, use stream.
3. For simple non-critical workload, classic queue can still be valid.
4. Do not use queue as long-term storage.
5. Do not use stream when you simply need one worker to do one job.
6. Do not assume durable means replicated.
7. Do not assume replicated means exactly-once.
8. Do not let queues grow without explicit policy.
9. Always design DLQ/parking lot for important queues.
10. Always design idempotency for important consumers.
11. Use stream retention based on business replay requirements, not random disk size.
12. Use naming convention that reveals queue type.
13. Make queue type part of architecture review.
14. Treat prefetch as consumer concurrency budget.
15. Treat backlog as symptom, not merely capacity problem.
16. Treat consumer lag in streams as risk against retention.
17. Use queue for work, stream for history, exchange for routing.
18. Do not hide critical state transitions in best-effort classic queues.
19. Avoid large message payloads; send references to external storage.
20. Queue type cannot compensate for bad message contracts.

---

## 27. What Top 1% Engineers Internalize

A strong RabbitMQ engineer does not ask:

```text
"Which queue type is faster?"
```

They ask:

```text
"What semantic contract does this workload need?"
```

Then they reason:

- Is this message work or history?
- Is consumption destructive or non-destructive?
- Is replay required?
- Is broker-level replication required?
- What happens on node failure?
- What happens on consumer crash?
- What happens on duplicate delivery?
- What happens on poison message?
- What happens when consumer is slower than producer?
- What operational signal shows the system is unhealthy?
- What manual remediation path exists?

This is the shift from “using RabbitMQ” to “designing with RabbitMQ”.

---

## 28. Mini Quiz

### Q1

A message represents “send this legal notice to an external agency”. It must not be lost. It may be retried. Duplicate sending must be prevented by application idempotency.

Best primitive?

Answer:

```text
Quorum Queue
```

Reason:

```text
It is a critical side-effect command/job, not a replayable event log.
```

### Q2

A message represents “case status changed” and multiple downstream projections may need to rebuild from the beginning.

Best primitive?

Answer:

```text
Stream
```

Reason:

```text
It needs retention and replay.
```

### Q3

A background task warms a cache. If lost, the cache can warm naturally later.

Best primitive?

Answer:

```text
Classic Queue can be acceptable; Quorum Queue if org standard requires replicated production queues.
```

### Q4

A queue has 1 million ready messages. The team says: “Increase disk.” What should you ask first?

Answer:

```text
Why is producer rate greater than consumer completion rate? Is this slow consumer, downstream failure, retry loop, poison message, routing bug, or insufficient worker capacity?
```

### Q5

A stream consumer is 3 days behind, and stream retention is 2 days. What is the risk?

Answer:

```text
The consumer may no longer be able to resume from its old offset because retained data may have been deleted.
```

---

## 29. Part 04 Summary

RabbitMQ queue type selection is an architectural decision.

Classic queue:

```text
simple traditional queue, useful but not the modern default for critical replicated production workloads.
```

Quorum queue:

```text
replicated durable FIFO queue for critical command/job processing, based on Raft-style consensus.
```

Stream:

```text
persistent replicated append-only log with non-destructive consumption, retention, offset, and replay.
```

The core mental model:

```text
Use queues for work.
Use streams for history.
Use exchanges for routing.
Use quorum queues for critical work.
Use idempotency for business safety.
Use DLQ/parking lot for failure control.
Use retention/offset discipline for replayable streams.
```

---

## 30. Connection to Next Part

Part 04 menjelaskan queue type secara konseptual dan arsitektural.

Part berikutnya akan membawa kita ke praktik:

```text
Part 05 — Hands-on Local Lab: Docker, Management UI, CLI, Definitions
```

Di sana kita akan menjalankan RabbitMQ lokal, membuka Management UI, membuat exchange/queue/binding, mengirim message, melihat ready/unacked, membuat DLX, dan mulai membangun lab yang akan dipakai sepanjang seri.

---

## 31. Status Seri

Progress:

```text
[x] part-00 — Orientation, Mental Model, dan Scope RabbitMQ Modern
[x] part-01 — Messaging Fundamentals yang Spesifik RabbitMQ
[x] part-02 — AMQP 0-9-1 Deep Dive
[x] part-03 — Exchange Routing Mastery
[x] part-04 — Queue Semantics: Classic, Quorum, Stream
[ ] part-05 — Hands-on Local Lab: Docker, Management UI, CLI, Definitions
...
[ ] part-34 — Mastery Review, Heuristics, and Final Mental Models
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-03.md">⬅️ Part 03 — Exchange Routing Mastery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-05.md">Part 05 — Hands-on Local Lab: Docker, Management UI, CLI, Definitions ➡️</a>
</div>

# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-01.md

# Part 01 — Messaging Fundamentals yang Spesifik RabbitMQ

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin menguasai RabbitMQ, RabbitMQ Streams, dan desain sistem messaging produksi.  
> Fokus bagian ini: memahami **semantik RabbitMQ** sebelum menyentuh API Java, Spring AMQP, quorum queues, streams, retry topology, dan operasional produksi.

---

## 0. Posisi Part Ini dalam Seri

Pada part 00, kita sudah membangun orientasi besar:

- RabbitMQ bukan sekadar “message queue”.
- RabbitMQ bukan Kafka kecil.
- RabbitMQ adalah kombinasi dari:
  - broker,
  - routing fabric,
  - queueing system,
  - replicated queue system,
  - streaming broker,
  - operational boundary antar aplikasi.

Part ini masuk lebih dalam ke pertanyaan yang lebih fundamental:

> Ketika satu service mengirim message ke RabbitMQ dan service lain memprosesnya, sebenarnya apa yang dijamin, apa yang tidak dijamin, siapa yang menyimpan state, kapan message dianggap aman, kapan message dianggap selesai, dan failure apa saja yang harus kita desain?

Kalau bagian ini tidak dipahami, engineer biasanya tetap bisa membuat demo RabbitMQ, tetapi sistem produksinya rentan terhadap:

- message hilang,
- message diproses dua kali,
- retry storm,
- infinite requeue loop,
- queue growth tanpa kendali,
- consumer lambat tapi tidak terdeteksi,
- ordering assumption yang salah,
- hidden synchronous coupling,
- sistem yang sulit diaudit saat incident.

Part ini bukan tutorial konfigurasi. Ini adalah fondasi mental model.

---

## 1. RabbitMQ sebagai Broker, Bukan Library, Bukan Database, Bukan Thread Pool

### 1.1 Kesalahan mental model yang sering terjadi

Banyak engineer pertama kali melihat RabbitMQ sebagai:

```text
Service A -> queue -> Service B
```

Model itu tidak salah, tapi terlalu miskin. Model yang lebih tepat adalah:

```text
Producer application
    |
    | publish message
    v
RabbitMQ broker
    |
    | route by exchange + binding + routing key
    v
Queue / Stream
    |
    | deliver message to consumer
    v
Consumer application
```

RabbitMQ bukan hanya buffer di tengah. RabbitMQ adalah sistem yang:

1. menerima message dari publisher,
2. menentukan target message melalui routing topology,
3. menyimpan message sesuai queue type,
4. mengirim message ke consumer,
5. melacak delivery yang belum di-ack,
6. melakukan redelivery jika consumer gagal,
7. menerapkan flow control ketika resource broker tertekan,
8. memberikan observability terhadap backlog, consumer, channel, dan connection,
9. menjadi boundary reliability antar proses.

Dalam Java ecosystem, RabbitMQ kadang keliru diperlakukan seperti `ExecutorService` distributed. Ini berbahaya.

`ExecutorService` punya karakteristik:

- producer dan worker biasanya masih berada dalam satu process boundary,
- object bisa dibagi via heap memory,
- failure model relatif lokal,
- tidak ada broker durability,
- tidak ada routing topology.

RabbitMQ punya karakteristik berbeda:

- producer dan consumer adalah proses berbeda,
- message harus diserialisasi,
- message bisa bertahan melampaui umur proses,
- delivery bisa gagal di tengah jalan,
- message bisa dikirim ulang,
- consumer bisa scale horizontal,
- broker bisa mengalami resource pressure,
- topology adalah bagian dari arsitektur.

Jadi mental model pertama:

> RabbitMQ bukan thread pool jarak jauh. RabbitMQ adalah distributed stateful broker yang menjadi perantara kontrak kerja antar aplikasi.

---

## 2. RabbitMQ sebagai “Routing Fabric”

### 2.1 RabbitMQ tidak mempublish langsung ke queue dalam model normal

Di AMQP 0-9-1, producer mempublish message ke **exchange**, bukan langsung ke queue. Exchange kemudian melakukan routing ke queue atau stream berdasarkan binding dan routing key.

Model konseptual:

```text
Producer
  |
  | publish(exchange = "case.events", routing_key = "case.opened")
  v
Exchange: case.events
  |
  | binding rules
  +--> Queue: audit.case-events
  +--> Queue: notification.case-opened
  +--> Queue: rule-engine.case-events
```

Ini membedakan RabbitMQ dari banyak sistem queue sederhana.

Queue adalah tempat message disimpan dan dikonsumsi. Exchange adalah tempat message dirutekan.

Dokumentasi RabbitMQ menjelaskan bahwa dalam AMQP 0-9-1, exchange adalah entity tempat publisher mengirim message, lalu exchange merutekan message ke queue, stream, atau exchange lain berdasarkan exchange type dan binding properties. Referensi: RabbitMQ Exchanges documentation.

### 2.2 Routing adalah bagian dari desain domain

Routing key bukan sekadar string teknis. Routing key menentukan bagaimana event, command, atau notification dipisahkan ke consumer yang tepat.

Contoh buruk:

```text
exchange: app.exchange
routing_key: data
```

Masalah:

- semua message tampak sama,
- sulit subscribe subset event,
- sulit observability per domain,
- sulit membuat DLQ yang bermakna,
- sulit melakukan evolusi topology.

Contoh lebih baik:

```text
exchange: enforcement.events
routing_key: case.opened
routing_key: case.assigned
routing_key: evidence.received
routing_key: enforcement.action.proposed
routing_key: enforcement.action.approved
```

Dengan topic exchange, consumer bisa memilih subset:

```text
case.*
evidence.*
enforcement.action.*
#.approved
```

Namun routing key juga tidak boleh menjadi dump seluruh domain model.

Contoh terlalu detail:

```text
case.region.jakarta.priority.high.customer.enterprise.status.opened.version.v2.source.mobile
```

Routing key seperti ini sulit dipertahankan karena banyak concern tercampur:

- domain event,
- tenant,
- priority,
- source,
- version,
- status,
- deployment concern.

Sebagian metadata lebih cocok menjadi message headers atau payload envelope.

### 2.3 Routing topology adalah public architecture

Dalam sistem produksi, exchange, queue, binding, dan policy bukan sekadar konfigurasi infra. Itu adalah bagian dari kontrak antar sistem.

Perubahan topology bisa berdampak seperti perubahan API:

- consumer tidak lagi menerima message,
- message masuk queue salah,
- DLQ tidak bekerja,
- audit pipeline kehilangan event,
- retry topology berubah,
- fanout tak sengaja menggandakan load.

Karena itu, engineer top-tier memperlakukan RabbitMQ topology sebagai **architecture artifact**, bukan detail DevOps.

---

## 3. Message Lifecycle: Dari Publish sampai Ack

Mari pecah lifecycle message RabbitMQ secara detail.

### 3.1 Lifecycle normal untuk queue

```text
1. Producer membuat message.
2. Producer publish message ke exchange.
3. Exchange mengevaluasi binding.
4. Message dirutekan ke satu atau lebih queue.
5. Queue menyimpan message.
6. Broker memilih consumer yang eligible.
7. Broker deliver message ke consumer.
8. Consumer memproses message.
9. Consumer mengirim acknowledgement.
10. Broker menghapus message dari queue.
```

Poin penting:

- Message tidak selesai saat producer berhasil menulis ke socket.
- Message tidak selesai saat exchange menerima message.
- Message tidak selesai saat message dikirim ke consumer.
- Untuk queue dengan manual ack, message selesai setelah consumer mengirim ack dan broker menerima ack.

### 3.2 Lifecycle dengan publisher confirms

Jika publisher confirms aktif:

```text
Producer publish
    |
Broker accepts/routes/persists according to target queue semantics
    |
Broker sends confirm ack/nack to producer
```

Publisher confirm menjawab pertanyaan:

> Apakah broker sudah menerima dan menangani publish ini sesuai durability semantics target?

Publisher confirm **tidak** menjawab:

> Apakah consumer sudah memproses message ini?

RabbitMQ documentation menegaskan bahwa publisher confirms dan consumer acknowledgements adalah fitur berbeda; publisher confirms tidak aware terhadap consumer, melainkan mencakup interaksi publisher dengan node broker dan leader replica queue/stream.

### 3.3 Lifecycle dengan consumer acknowledgement

Consumer acknowledgement menjawab pertanyaan:

> Apakah consumer sudah selesai memproses message sehingga broker boleh menghapusnya dari queue?

Manual ack biasanya wajib untuk sistem produksi yang peduli reliability.

Jika consumer mati sebelum ack:

```text
Broker delivers message
Consumer receives message
Consumer crashes before ack
Broker detects channel/connection closed
Broker requeues or redelivers message
```

Artinya consumer harus siap menerima message yang sama lebih dari sekali.

### 3.4 Lifecycle stream berbeda

Untuk RabbitMQ Streams, message bersifat append-only dan tidak hilang hanya karena sudah dikonsumsi.

Model queue:

```text
consume + ack -> message removed from queue
```

Model stream:

```text
consume -> consumer offset advances
message remains until retention removes it
```

Jadi queue consumption itu destructive secara konseptual, sementara stream consumption itu non-destructive.

Ini akan dibahas lebih dalam di part 16–19. Untuk sekarang cukup pahami:

> Queue menyimpan pekerjaan yang harus diselesaikan. Stream menyimpan log yang bisa dibaca ulang.

---

## 4. Apa Itu Message?

### 4.1 Message bukan object Java

Kesalahan umum Java engineer:

```java
rabbitTemplate.convertAndSend(new EnforcementCaseEntity(...));
```

Lalu entity JPA dikirim sebagai JSON/Java serialization.

Ini salah secara arsitektural.

Message bukan object internal. Message adalah contract antar proses.

Message harus dianggap seperti:

- HTTP request/response contract,
- database schema eksternal,
- public event schema,
- audit record,
- workflow transition artifact.

### 4.2 Message terdiri dari envelope dan payload

Model yang lebih sehat:

```json
{
  "message_id": "01JZ...",
  "message_type": "case.opened",
  "schema_version": 1,
  "occurred_at": "2026-06-19T10:15:30Z",
  "producer": "case-service",
  "correlation_id": "corr-123",
  "causation_id": "cmd-456",
  "trace_id": "trace-789",
  "payload": {
    "case_id": "CASE-2026-0001",
    "opened_by": "user-123",
    "jurisdiction": "ID-JK",
    "risk_level": "HIGH"
  }
}
```

Envelope menjawab:

- message ini apa,
- versi schema berapa,
- siapa yang membuat,
- kapan terjadi,
- bagian dari flow apa,
- disebabkan oleh apa,
- bagaimana dilacak.

Payload menjawab:

- data domain apa yang dibutuhkan consumer.

### 4.3 Minimal metadata yang sering dibutuhkan

Untuk sistem serius, message biasanya butuh metadata berikut:

| Metadata | Fungsi |
|---|---|
| `message_id` | idempotency dan tracing |
| `message_type` | interpretasi payload |
| `schema_version` | evolusi kontrak |
| `correlation_id` | menghubungkan satu flow lintas service |
| `causation_id` | menunjukkan message/command penyebab |
| `trace_id` | distributed tracing |
| `producer` | forensic/debugging |
| `occurred_at` | waktu domain event terjadi |
| `published_at` | waktu message dipublish |
| `tenant_id` | isolasi multi-tenant jika relevan |

### 4.4 Message harus cukup untuk consumer, tapi tidak harus seluruh database row

Ada dua ekstrem:

Ekstrem 1: message terlalu kecil.

```json
{
  "case_id": "CASE-123"
}
```

Masalah:

- semua consumer harus call balik ke producer,
- coupling sinkron muncul lagi,
- producer menjadi bottleneck,
- consumer tidak bisa replay tanpa state eksternal,
- audit sulit.

Ekstrem 2: message terlalu besar.

```json
{
  "entire_case_record": { ... 5 MB of nested data ... }
}
```

Masalah:

- broker terbebani,
- memory/disk naik,
- retry mahal,
- DLQ sulit dianalisis,
- schema evolution kompleks,
- data sensitif tersebar.

Prinsip yang lebih baik:

> Message harus membawa data yang cukup untuk consumer melakukan tugasnya secara stabil, tanpa menjadikan broker sebagai database dumping ground.

---

## 5. Queue sebagai “Work Ledger”

### 5.1 Queue bukan hanya buffer

Queue sering dijelaskan sebagai buffer FIFO. Dokumentasi RabbitMQ menyebut queue sebagai ordered collection of messages, dengan message dienqueue dan didequeue/dideliver ke consumer secara FIFO. Namun dalam sistem nyata, queue lebih dari buffer.

Queue adalah work ledger sementara:

- message ready = pekerjaan belum dikirim ke consumer,
- message unacked = pekerjaan sedang diproses consumer,
- ack = pekerjaan selesai,
- nack/reject/requeue = pekerjaan gagal dan harus diputuskan nasibnya,
- dead-letter = pekerjaan tidak bisa diproses normal.

### 5.2 Ready vs unacked

Dua angka paling penting pada queue:

```text
ready messages   = message menunggu dikirim ke consumer
unacked messages = message sudah dikirim tapi belum di-ack
```

Kombinasi keduanya memberi diagnosis awal.

#### Case A: ready tinggi, unacked rendah

```text
ready = 100000
unacked = 0
```

Kemungkinan:

- tidak ada consumer,
- consumer tidak connected,
- binding/topology salah,
- consumer capacity terlalu kecil,
- prefetch terlalu rendah,
- consumer crash loop.

#### Case B: ready rendah, unacked tinggi

```text
ready = 0
unacked = 50000
```

Kemungkinan:

- consumer menerima terlalu banyak message,
- prefetch terlalu tinggi,
- handler lambat,
- downstream dependency lambat,
- consumer stuck,
- ack tidak pernah dikirim.

#### Case C: ready tinggi, unacked tinggi

```text
ready = 100000
unacked = 50000
```

Kemungkinan:

- producer rate jauh lebih tinggi dari consumer throughput,
- consumer sedang kerja tapi kalah cepat,
- broker backlog meningkat,
- kapasitas sistem tidak cukup.

#### Case D: ready rendah, unacked rendah

```text
ready = 0
unacked = 0
```

Bisa berarti sehat, atau bisa berarti tidak ada traffic. Harus dilihat bersama publish/deliver/ack rate.

### 5.3 Ack mengubah state broker

Manual ack bukan formalitas. Ack adalah state transition pada broker:

```text
UNACKED -> REMOVED
```

Nack/reject dengan requeue:

```text
UNACKED -> READY AGAIN
```

Nack/reject tanpa requeue dan DLX configured:

```text
UNACKED -> DEAD-LETTERED
```

Consumer code harus dipikirkan sebagai state transition handler.

---

## 6. Delivery Semantics: At-Most-Once, At-Least-Once, Exactly-Once

### 6.1 At-most-once

At-most-once berarti message diproses nol atau satu kali.

Dalam RabbitMQ, ini biasanya terjadi jika consumer menggunakan auto ack:

```text
Broker delivers message
Broker considers it done immediately
Consumer crashes before processing
Message lost from processing perspective
```

Contoh:

```text
consumer receives message -> auto ack -> process payment -> crash before DB commit
```

Broker berpikir message selesai. Padahal bisnis belum selesai.

At-most-once cocok untuk:

- telemetry non-kritis,
- metric sampling,
- cache invalidation yang boleh hilang dalam batas tertentu,
- notifikasi best-effort.

Tidak cocok untuk:

- payment,
- enforcement action,
- audit event,
- state transition penting,
- job yang harus selesai.

### 6.2 At-least-once

At-least-once berarti message akan diproses satu kali atau lebih.

Dengan manual ack:

```text
Broker delivers message
Consumer processes
Consumer commits side effect
Consumer crashes before ack
Broker redelivers
Consumer processes same message again
```

Message tidak hilang, tetapi bisa duplikat.

Ini default practical target untuk banyak sistem RabbitMQ produksi.

Konsekuensi:

> Consumer harus idempotent.

### 6.3 Exactly-once sebagai ilusi lintas boundary

Exactly-once sering disalahpahami.

RabbitMQ bisa memberikan mekanisme kuat:

- durable queues,
- persistent messages,
- publisher confirms,
- quorum replication,
- manual acknowledgements,
- deduplication tertentu pada streams.

Tetapi begitu consumer melakukan side effect ke sistem eksternal, misalnya:

- update PostgreSQL,
- call REST API,
- send email,
- create ticket,
- call payment gateway,

maka exactly-once end-to-end membutuhkan koordinasi transaksi lintas sistem. Itu jarang praktis dan sering tidak tersedia.

Yang biasanya didesain adalah:

```text
at-least-once delivery + idempotent side effects + deduplication record + deterministic state transition
```

### 6.4 Delivery guarantee matrix

| Setup | Risiko hilang | Risiko duplikat | Cocok untuk |
|---|---:|---:|---|
| auto ack + transient message | tinggi | rendah | best-effort telemetry |
| manual ack + non-idempotent consumer | rendah | tinggi dan berbahaya | sebaiknya dihindari |
| manual ack + idempotent consumer | rendah | terkendali | workflow/job penting |
| publisher confirms + manual ack + idempotency | rendah | terkendali | sistem produksi serius |
| quorum queue + confirms + manual ack | lebih aman terhadap node failure | tetap perlu idempotency | HA work queues |
| stream + offset + dedup/replay | retention-based | tergantung consumer design | replay/audit/projection |

---

## 7. Publisher Side: “Sent” Bukan Berarti “Accepted”

### 7.1 Producer write ke socket bukan guarantee

Ketika producer Java memanggil publish method, ada beberapa kemungkinan:

```text
Application code -> client library buffer -> TCP socket -> broker node -> exchange -> queue leader -> disk/replica
```

Jika code tidak memakai publisher confirms, producer bisa salah mengira publish berhasil padahal:

- connection putus,
- broker menolak,
- route tidak ada,
- message belum durable,
- broker crash sebelum persist,
- queue leader belum confirm.

### 7.2 Publisher confirm sebagai safety boundary

Publisher confirms memberi sinyal dari broker ke publisher bahwa message sudah diterima/ditangani sesuai semantics.

Untuk quorum queues, dokumentasi RabbitMQ menjelaskan bahwa publisher confirms diterbitkan setelah message berhasil direplikasi ke quorum dan dianggap safe dalam konteks sistem. Ini penting karena quorum queue berbasis Raft dan safety-nya bergantung pada replikasi mayoritas.

Mental model:

```text
producer local success != broker durable success
broker confirm ack       = broker-side acceptance signal
```

### 7.3 Publisher confirm tidak berarti consumer success

Ini sangat penting.

```text
Publisher confirm ack
```

hanya berarti broker sudah menerima/routing/persist sesuai target. Bukan berarti:

- consumer sudah menerima,
- consumer sudah memproses,
- DB consumer sudah commit,
- email sudah terkirim,
- workflow sudah selesai.

Untuk mengetahui business completion, kamu butuh mekanisme lain:

- reply event,
- status table,
- saga state,
- audit event,
- callback,
- polling status,
- command result event.

### 7.4 Unroutable message

Jika message dipublish ke exchange tapi tidak cocok binding mana pun, message bisa hilang secara routing unless kamu pakai mekanisme seperti mandatory publish/returns atau alternate exchange.

Contoh:

```text
exchange: case.events
routing_key: case.openedd   // typo
binding: case.opened
```

Tanpa mandatory/alternate exchange, producer bisa tidak sadar message tidak masuk queue.

Part 07 akan membahas ini lebih dalam.

---

## 8. Consumer Side: “Received” Bukan Berarti “Processed”

### 8.1 Delivery bukan completion

Broker mengirim message ke consumer. Consumer menerima bytes. Itu baru awal.

Business processing mungkin terdiri dari:

```text
1. deserialize
2. validate schema
3. check idempotency
4. load aggregate
5. apply state transition
6. write DB transaction
7. call downstream
8. publish follow-up event
9. ack message
```

Failure bisa terjadi di setiap langkah.

### 8.2 Ack setelah side effect berhasil

Untuk workflow penting, ack harus dilakukan setelah side effect yang dianggap final berhasil.

Contoh buruk:

```java
public void handle(Message message) {
    ack(message);
    enforcementService.createAction(message);
}
```

Jika service crash setelah ack tetapi sebelum create action selesai, message hilang dari perspektif bisnis.

Contoh lebih baik:

```java
public void handle(Message message) {
    enforcementService.createActionIdempotently(message);
    ack(message);
}
```

Masih ada failure window:

```text
DB commit success -> crash before ack -> message redelivered
```

Karena itu `createActionIdempotently` wajib.

### 8.3 Ack tidak boleh terlalu terlambat tanpa alasan

Sebaliknya, ack terlalu terlambat juga bermasalah.

Contoh:

```text
process DB update
send email
call external API
write audit
generate PDF
upload file
ack
```

Jika satu message butuh 5 menit sebelum ack, maka:

- unacked count tinggi,
- redelivery setelah crash bisa mengulang banyak side effect,
- prefetch harus sangat hati-hati,
- broker menganggap message masih in-flight,
- scaling consumer menjadi sulit.

Solusi sering berupa memecah workflow:

```text
Message 1: create enforcement action
Message 2: send notification
Message 3: generate document
Message 4: archive audit
```

Setiap step punya idempotency dan ack boundary sendiri.

---

## 9. Redelivery: Bukan Exception Handling Biasa

### 9.1 Kenapa redelivery terjadi

Redelivery bisa terjadi karena:

- consumer crash,
- connection closed,
- channel closed,
- consumer nacks with requeue,
- broker failover,
- precondition failure,
- application timeout,
- manual recovery flow.

### 9.2 Redelivered flag bukan retry count sempurna

RabbitMQ bisa menandai message sebagai redelivered. Namun redelivered flag hanya memberi informasi bahwa message pernah dikirim sebelumnya.

Itu bukan retry count lengkap.

Untuk retry policy serius, kamu butuh:

- header retry count,
- DLX retry topology,
- quorum delivery-limit,
- external attempt record,
- parking lot mechanism.

### 9.3 Infinite requeue loop

Ini salah satu incident RabbitMQ paling umum.

Pseudo-code buruk:

```java
try {
    process(message);
    ack(message);
} catch (Exception e) {
    nack(message, requeue = true);
}
```

Jika message selalu gagal karena payload invalid:

```text
consume -> fail -> requeue -> consume -> fail -> requeue -> ...
```

Akibat:

- CPU consumer habis,
- broker churn tinggi,
- log penuh,
- message lain tertahan,
- error rate meledak,
- sistem terlihat “sibuk” tapi tidak produktif.

Prinsip:

> Requeue langsung hanya cocok untuk failure yang sangat mungkin transient dan harus dibatasi.

Untuk permanent failure:

```text
reject/nack without requeue -> DLQ / parking lot
```

### 9.4 Classify failure before retry

Consumer harus membedakan:

| Failure | Contoh | Aksi |
|---|---|---|
| Transient | DB timeout, HTTP 503 | retry/backoff |
| Permanent | schema invalid, unknown enum | DLQ |
| Business conflict | state transition illegal | record rejection/audit |
| Poison | selalu crash handler | isolate/parking lot |
| Capacity | downstream overloaded | slow down/backpressure |

Tidak semua exception layak retry.

---

## 10. Prefetch: Backpressure di Level Consumer

### 10.1 Apa itu prefetch

Prefetch membatasi jumlah message unacked yang boleh dikirim broker ke consumer/channel.

Contoh:

```text
prefetch = 10
```

Artinya broker tidak akan memberikan lebih dari 10 message unacked kepada consumer tersebut sebelum sebagian di-ack.

### 10.2 Prefetch terlalu tinggi

Misalnya:

```text
consumer count = 10
prefetch = 1000
```

Maka total in-flight bisa 10.000 message.

Masalah:

- memory consumer tinggi,
- crash consumer menyebabkan redelivery batch besar,
- message bisa tertahan di consumer lambat,
- load distribution tidak fair,
- unacked tinggi.

### 10.3 Prefetch terlalu rendah

Misalnya:

```text
prefetch = 1
```

Bagus untuk fairness dan ordering, tetapi throughput bisa turun jika processing cepat dan latency round-trip broker signifikan.

### 10.4 Prefetch harus sesuai cost processing

Rule of thumb:

| Work type | Prefetch awal |
|---|---:|
| slow external API call | 1–10 |
| DB transaction sedang | 10–50 |
| CPU-light transformation | 50–300 |
| batch-friendly processing | lebih tinggi, ukur dulu |
| strict ordering per consumer | 1 |

Namun ini bukan hukum. Harus diukur dengan workload nyata.

### 10.5 Prefetch sebagai concurrency budget

Jangan pikir prefetch hanya RabbitMQ setting. Prefetch adalah concurrency budget terhadap downstream.

Jika consumer melakukan call ke service X, maka:

```text
max concurrent in-flight calls ~= consumer_instances * listener_threads * prefetch
```

Kalau angkanya terlalu besar, RabbitMQ consumer bisa menjadi DDoS internal terhadap dependency sendiri.

---

## 11. Ordering: FIFO Tidak Sama dengan Ordered System

### 11.1 Queue adalah FIFO, tapi delivery reality lebih kompleks

RabbitMQ queue secara dasar adalah ordered collection. Namun ordering end-to-end dipengaruhi oleh:

- jumlah producer,
- jumlah channel,
- exchange routing,
- jumlah queue,
- jumlah consumer,
- prefetch,
- redelivery,
- retry,
- nack/requeue,
- parallel processing,
- quorum/stream behavior,
- application side effects.

### 11.2 Single queue, single consumer, prefetch 1

Ini konfigurasi paling mendekati sequential processing:

```text
one queue
one consumer
prefetch = 1
manual ack
```

Kelemahan:

- throughput rendah,
- satu slow message menahan semua,
- scaling terbatas,
- availability consumer menjadi bottleneck.

### 11.3 Competing consumers mengorbankan global order

```text
Queue -> Consumer A
      -> Consumer B
      -> Consumer C
```

Broker mengirim message ke beberapa consumer. Walaupun delivery dari queue FIFO, completion order bisa berbeda:

```text
M1 -> Consumer A -> slow
M2 -> Consumer B -> fast
M2 completes before M1
```

Jika business membutuhkan order per aggregate, kamu harus desain explicit.

### 11.4 Per-key ordering

Misalnya semua event untuk `case_id = CASE-123` harus diproses berurutan.

Strategi:

1. route berdasarkan hash `case_id` ke queue shard,
2. satu consumer aktif per shard,
3. gunakan consistent hash exchange/plugin atau routing manual,
4. jaga prefetch dan concurrency sesuai requirement,
5. pastikan retry tidak mengubah order secara diam-diam.

Contoh:

```text
case_id hash modulo 16 -> case.workflow.q.00 ... case.workflow.q.15
```

Ini menjaga order per key, bukan global order.

### 11.5 Retry bisa merusak order

Misalnya:

```text
M1: case.updated version 1 -> gagal, dikirim ke retry delay
M2: case.updated version 2 -> sukses
M1 kembali dari retry -> diproses setelah M2
```

Jika order penting, retry design harus mempertimbangkan blocked partition atau sequence validation.

---

## 12. Push vs Pull: RabbitMQ Queue Consumption Berbeda dari Kafka

Karena kamu sudah punya Kafka series, bagian ini dibuat singkat dan spesifik.

Kafka consumer biasanya pull dari partition dan mengelola offset.

RabbitMQ queue consumer biasanya menerima push delivery dari broker, dengan backpressure lewat prefetch.

Model RabbitMQ queue:

```text
broker pushes messages up to prefetch limit
consumer ack/nack
broker tracks unacked deliveries
```

Model Kafka umum:

```text
consumer polls records
consumer commits offset
broker retains log by retention policy
```

Konsekuensi desain:

| Concern | RabbitMQ Queue | Kafka Topic |
|---|---|---|
| Work distribution | natural competing consumers | via consumer group partitioning |
| Routing | exchange/binding kaya | topic/partition lebih sederhana |
| Message removal | ack-driven | retention-driven |
| Replay | tidak natural untuk queue | natural |
| Backpressure | prefetch/flow control | polling rate/consumer lag |
| Per-message ack | natural | offset-based batch position |

RabbitMQ Streams mengisi sebagian gap replay/log, tetapi tetap tidak identik dengan Kafka.

---

## 13. Broker State vs Application State

### 13.1 RabbitMQ menyimpan state messaging

RabbitMQ menyimpan:

- topology,
- queue contents,
- stream contents,
- bindings,
- users/permissions,
- policies,
- unacked deliveries,
- consumer registrations,
- some protocol/session state.

RabbitMQ tidak menyimpan:

- business aggregate state,
- completed workflow truth,
- durable idempotency record milik aplikasi,
- semantic validity message,
- business compensation result.

### 13.2 Jangan jadikan queue sebagai database

Queue bukan tempat menyimpan state jangka panjang entity.

Tanda kamu menyalahgunakan queue sebagai database:

- queue sengaja dibiarkan berisi jutaan message sebagai storage normal,
- consumer sering mencari message tertentu,
- message lama dianggap source of truth,
- purge queue dianggap data loss bisnis,
- tidak ada database state selain queue,
- queue depth dipakai sebagai domain status utama.

RabbitMQ Streams lebih cocok untuk retention/replay, tetapi tetap bukan pengganti database domain transactional.

### 13.3 State machine tetap milik aplikasi

Dalam sistem enforcement lifecycle, misalnya:

```text
CASE_OPENED -> UNDER_REVIEW -> ACTION_PROPOSED -> ACTION_APPROVED -> ENFORCED
```

RabbitMQ bisa membawa command/event antar step. Tetapi validitas transisi harus ada di aplikasi/domain state machine.

Message seperti:

```text
ApproveEnforcementAction(caseId=123)
```

Tidak boleh langsung dianggap valid hanya karena muncul di queue.

Consumer harus melakukan:

```text
load case
check current state
check actor/authorization/context
apply transition if valid
record transition
publish result event
ack
```

RabbitMQ menyampaikan permintaan kerja. Domain model menentukan apakah kerja itu sah.

---

## 14. Durability: Durable Queue + Persistent Message + Confirm

### 14.1 Durability terdiri dari beberapa lapisan

Untuk message bertahan dari broker restart, beberapa kondisi harus benar:

- queue durable,
- message persistent,
- broker berhasil persist message,
- publisher menunggu confirm jika ingin tahu outcome,
- queue type mendukung safety yang diinginkan,
- cluster replication jika ingin survive node failure.

Kesalahan umum:

> “Queue saya durable, berarti semua message aman.”

Tidak cukup.

Queue durable berarti queue definition bertahan setelah restart. Message tetap harus persistent untuk bertahan.

### 14.2 Durable tidak sama dengan replicated

Classic durable queue non-replicated tetap bisa hilang jika node/disk yang menyimpan queue hilang.

Quorum queue memberi replicated durability berbasis Raft.

Stream juga replicated persistent data structure.

### 14.3 Confirm adalah observability durability dari publisher

Tanpa publisher confirm, producer tidak tahu apakah publish benar-benar aman.

Dengan confirm:

```text
publish -> wait confirm -> mark outbox row as sent
```

Ini menjadi bagian penting outbox relay.

---

## 15. Message Loss: Di Mana Bisa Terjadi?

Message loss tidak selalu karena RabbitMQ “hilang”. Sering karena desain aplikasi salah.

### 15.1 Loss sebelum broker menerima

```text
producer creates message
producer crashes before publish
```

Solusi:

- transactional outbox,
- persist intent before publish,
- retry publisher safely.

### 15.2 Loss saat publish tidak confirmed

```text
producer publishes without confirms
connection drops
producer assumes success
```

Solusi:

- publisher confirms,
- retry with idempotency,
- outbox state machine.

### 15.3 Loss karena unroutable

```text
publish to exchange with wrong routing key
no binding matches
```

Solusi:

- mandatory flag,
- returns callback,
- alternate exchange,
- topology tests.

### 15.4 Loss karena non-durable setup

```text
transient message + broker restart
```

Solusi:

- durable queues,
- persistent messages,
- quorum/stream where needed.

### 15.5 Loss karena auto ack

```text
broker delivers
broker considers done
consumer crashes before side effect
```

Solusi:

- manual ack,
- ack after side effect,
- idempotent processing.

### 15.6 Loss karena wrong DLQ handling

```text
message dead-lettered
DLQ purged manually
no audit
```

Solusi:

- DLQ retention policy,
- remediation workflow,
- parking lot,
- audit trail.

---

## 16. Duplicate Processing: Di Mana Bisa Terjadi?

Duplicate processing adalah konsekuensi normal dari at-least-once.

### 16.1 Duplicate karena crash after commit before ack

```text
consumer processes message
DB commit succeeds
consumer crashes before ack
broker redelivers
consumer processes again
```

Solusi:

- idempotency table,
- unique constraint on message_id,
- deterministic state transition,
- natural business key constraint.

### 16.2 Duplicate karena publisher retry

```text
producer publishes
confirm lost due network
producer retries
broker receives duplicate
```

Solusi:

- publisher idempotency,
- message_id,
- stream deduplication where applicable,
- consumer deduplication.

### 16.3 Duplicate karena manual replay

Operator requeues DLQ messages. Sebagian message mungkin sebenarnya sudah diproses sebagian.

Solusi:

- remediation tools check idempotency,
- replay plan,
- side-effect audit,
- dry-run validation.

### 16.4 Idempotency bukan optional

Prinsip:

> Kalau consumer tidak idempotent, RabbitMQ at-least-once akan menjadi bug generator.

Idempotency bisa diwujudkan dengan:

1. `processed_messages` table.
2. Unique business operation id.
3. Natural aggregate version check.
4. State machine guard.
5. External idempotency key.

Contoh SQL-ish:

```sql
CREATE TABLE processed_message (
    consumer_name  VARCHAR(200) NOT NULL,
    message_id     VARCHAR(100) NOT NULL,
    processed_at   TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

Flow:

```text
begin transaction
insert processed_message(consumer, message_id)
if duplicate -> skip safely
apply business change
commit
ack message
```

---

## 17. Backlog: Queue Growth sebagai Signal, Bukan Sekadar Angka

### 17.1 Queue depth adalah symptom

Queue depth naik berarti:

```text
arrival rate > completion rate
```

Tapi penyebabnya bisa banyak:

- producer spike,
- consumer down,
- consumer slow,
- downstream dependency slow,
- retry storm,
- broker flow control,
- hot routing key,
- topology error,
- poison message blocking order,
- insufficient prefetch/concurrency.

### 17.2 Little’s Law intuition

Secara kasar:

```text
average backlog ~= arrival rate * average waiting time
```

Jika arrival 1000 msg/s dan consumer hanya menyelesaikan 800 msg/s, backlog akan tumbuh 200 msg/s.

Dalam 1 jam:

```text
200 * 3600 = 720000 messages
```

Queue tidak boleh diperlakukan sebagai tempat “sementara” tanpa kapasitas planning.

### 17.3 Backlog age lebih penting dari backlog count

1 juta message kecil yang bisa diselesaikan dalam 2 menit mungkin lebih sehat daripada 1000 message yang paling tua sudah menunggu 3 hari.

Metrik penting:

- queue depth,
- oldest message age,
- publish rate,
- ack rate,
- redelivery rate,
- consumer utilization,
- unacked count,
- DLQ rate.

---

## 18. Flow Control: Broker Juga Bisa Melawan

RabbitMQ bukan infinite sink.

Jika resource broker tertekan, RabbitMQ bisa melakukan flow control/blocking pada publisher.

Penyebab:

- memory watermark,
- disk free limit,
- queue terlalu besar,
- consumer tidak ack,
- message besar,
- persistent write pressure,
- replication bottleneck.

Dampak ke aplikasi Java:

- publish latency naik,
- connection blocked,
- thread publisher tertahan,
- request HTTP upstream ikut lambat,
- cascading latency.

Prinsip desain:

> Backpressure dari RabbitMQ harus dianggap signal produksi, bukan sekadar error infra.

Aplikasi harus punya:

- timeout,
- bounded internal queue,
- circuit breaker/admission control,
- outbox relay rate limit,
- alerting.

---

## 19. Message Size: Broker Bukan File Transfer System

### 19.1 Large message berdampak luas

Message besar menyebabkan:

- memory pressure,
- disk pressure,
- network pressure,
- replication cost tinggi,
- consumer deserialization mahal,
- DLQ inspection sulit,
- retry mahal.

Jangan kirim PDF, image, CSV besar, atau binary blob besar langsung lewat RabbitMQ kecuali sudah sangat sadar cost-nya.

### 19.2 Pattern lebih baik

Gunakan pointer/reference:

```json
{
  "message_id": "msg-123",
  "message_type": "document.generated",
  "payload": {
    "document_id": "DOC-456",
    "storage_uri": "s3://bucket/key",
    "checksum": "sha256:...",
    "size_bytes": 10485760
  }
}
```

RabbitMQ membawa event/command. Object storage membawa file.

---

## 20. Command, Event, Notification, Job: Jangan Dicampur

### 20.1 Command

Command adalah permintaan melakukan sesuatu.

```text
ApproveEnforcementAction
GenerateCaseSummary
SendNotification
EvaluateRiskRule
```

Karakteristik:

- imperative,
- biasanya punya satu logical owner,
- bisa ditolak,
- bisa gagal,
- sering masuk work queue,
- butuh idempotency.

### 20.2 Event

Event adalah fakta bahwa sesuatu sudah terjadi.

```text
CaseOpened
EvidenceReceived
EnforcementActionApproved
NotificationSent
```

Karakteristik:

- past tense,
- tidak meminta consumer melakukan hal tertentu,
- bisa punya banyak subscriber,
- cocok untuk fanout/topic exchange,
- sering menjadi audit material.

### 20.3 Notification

Notification adalah informasi untuk pihak tertentu.

```text
UserEmailNotificationRequested
SmsNotificationRequested
WebhookDeliveryRequested
```

Kadang command, kadang event-derived job. Harus jelas.

### 20.4 Job/task

Job adalah unit kerja teknis.

```text
GeneratePdfJob
ReindexCaseJob
SyncExternalRegistryJob
```

Karakteristik:

- work distribution,
- retryable,
- sering tidak penting bagi semua service,
- biasanya queue-specific.

### 20.5 Kenapa taxonomy penting

Kalau semuanya disebut event, topology menjadi kabur.

Contoh buruk:

```text
Exchange: events
Routing key: send.email
```

`send.email` bukan event. Itu command/job.

Contoh lebih jelas:

```text
Exchange: notification.commands
Routing key: email.send
Queue: notification.email.send.q
```

Dan setelah sukses:

```text
Exchange: notification.events
Routing key: email.sent
```

---

## 21. RabbitMQ Queue Type Intuition

Detail queue type ada di part 04 dan part 20. Di sini hanya mental model.

### 21.1 Classic queue

Classic queue cocok untuk use case sederhana, non-replicated, atau temporary/transient.

Gunakan hati-hati untuk workload penting jika tidak ada replication strategy.

### 21.2 Quorum queue

Quorum queue adalah queue modern durable replicated berbasis Raft consensus algorithm. Cocok untuk workload penting yang membutuhkan high availability dan data safety lebih baik.

Gunakan quorum queue sebagai default mental model untuk durable production work queue yang penting.

### 21.3 Stream

Stream adalah persistent replicated append-only data structure.

Cocok untuk:

- replay,
- audit log,
- event history,
- high-throughput append/read,
- multiple consumers dengan offset berbeda,
- time/size retention.

Tidak cocok jika kamu hanya butuh satu pekerjaan diambil satu worker lalu selesai, kecuali ada alasan khusus.

### 21.4 Queue type decision awal

| Pertanyaan | Pilihan cenderung |
|---|---|
| Pekerjaan harus diproses sekali oleh salah satu worker? | quorum queue |
| Message boleh hilang dan temporary? | classic/transient queue |
| Butuh replay/audit/retention? | stream |
| Butuh fanout event ke beberapa consumer? | exchange + beberapa queue, atau stream jika replay penting |
| Butuh HA durable queue? | quorum queue |
| Butuh partitioned log? | super stream |

---

## 22. Consumer Group vs Competing Consumers

RabbitMQ queue punya konsep competing consumers:

```text
Queue Q
  -> Consumer A
  -> Consumer B
  -> Consumer C
```

Setiap message biasanya dikirim ke salah satu consumer, bukan semua.

Jika semua service perlu menerima event yang sama, jangan buat banyak consumer berbeda pada queue yang sama. Buat queue berbeda untuk setiap logical subscriber.

Salah:

```text
Queue: case.events.q
  -> audit-service
  -> notification-service
  -> rule-service
```

Akibat: tiap event hanya diterima salah satu service.

Benar:

```text
Exchange: case.events
  -> Queue: audit.case-events.q        -> audit-service
  -> Queue: notification.case-events.q -> notification-service
  -> Queue: rule.case-events.q         -> rule-service
```

Dalam RabbitMQ, queue biasanya merepresentasikan **subscription/work backlog untuk satu logical consumer group**.

---

## 23. Hidden Coupling: Async Transport Tidak Otomatis Decoupled

Menggunakan RabbitMQ tidak otomatis membuat sistem loosely coupled.

### 23.1 Coupling melalui schema

Jika consumer harus memahami payload internal producer yang sering berubah, coupling tetap kuat.

### 23.2 Coupling melalui timing

Jika producer menunggu response dari consumer via RPC, coupling temporal masih kuat.

### 23.3 Coupling melalui shared database

Jika consumer membaca database producer untuk melengkapi setiap message, coupling data tetap kuat.

### 23.4 Coupling melalui deployment order

Jika producer deploy versi baru yang langsung membuat consumer lama crash, coupling deployment kuat.

### 23.5 Decoupling yang benar

RabbitMQ membantu decoupling jika:

- message contract stabil,
- consumer idempotent,
- versioning jelas,
- topology explicit,
- retry/failure path dirancang,
- producer tidak perlu consumer online saat publish,
- consumer tidak harus call balik producer untuk semua data,
- business state transition robust.

---

## 24. Failure Model Dasar RabbitMQ

### 24.1 Producer crash

Kemungkinan:

```text
A. crash sebelum message disimpan di DB/outbox
B. crash setelah DB commit sebelum publish
C. crash setelah publish sebelum confirm
D. crash setelah confirm sebelum update outbox status
```

Mitigasi:

- outbox table,
- publisher confirms,
- retry relay,
- idempotent consumer.

### 24.2 Broker crash

Dampak tergantung:

- queue durable atau tidak,
- message persistent atau tidak,
- queue classic/quorum/stream,
- confirm sudah diterima atau belum,
- cluster replication sehat atau tidak.

Mitigasi:

- quorum queues untuk workload penting,
- streams untuk log/replay,
- publisher confirms,
- persistent messages,
- monitoring disk/memory,
- backup definitions.

### 24.3 Consumer crash

Kemungkinan:

```text
A. crash sebelum receive -> tidak masalah
B. crash setelah receive sebelum process -> redelivery
C. crash setelah process sebelum ack -> duplicate processing
D. crash setelah ack -> selesai dari broker perspective
```

Mitigasi:

- manual ack,
- idempotency,
- transaction boundary,
- retry/DLQ.

### 24.4 Network partition

Kemungkinan:

- producer tidak bisa reach broker,
- consumer disconnected,
- cluster node terpisah,
- confirms tertunda,
- queue leader unavailable,
- client failover terjadi.

Mitigasi:

- client recovery,
- quorum design,
- timeout,
- idempotent retry,
- cluster topology yang benar.

### 24.5 Poison message

Message yang selalu membuat consumer gagal.

Mitigasi:

- retry limit,
- DLQ,
- parking lot,
- schema validation,
- safe deserialization,
- operator remediation.

### 24.6 Slow consumer

Consumer masih hidup tetapi throughput tidak cukup.

Mitigasi:

- metrics,
- prefetch tuning,
- scale consumers,
- optimize handler,
- protect downstream,
- split workload,
- shard queue.

---

## 25. Designing for Recovery, Not Perfection

Distributed systems tidak bisa dibuat bebas failure. Yang bisa dibuat adalah sistem yang failure-nya:

- terdeteksi,
- dibatasi,
- bisa diulang,
- bisa diaudit,
- bisa diremediasi,
- tidak merusak state secara diam-diam.

Untuk RabbitMQ, pertanyaan desain yang benar bukan:

> Bagaimana agar message tidak pernah gagal?

Melainkan:

> Ketika publish gagal, siapa tahu?  
> Ketika consumer gagal, message ke mana?  
> Ketika message duplikat, apa yang mencegah double side effect?  
> Ketika retry habis, siapa yang menangani?  
> Ketika broker overload, siapa yang melambat?  
> Ketika audit dibutuhkan, bagaimana kita rekonstruksi perjalanan message?

---

## 26. Regulatory/System-of-Record Perspective

Karena konteks kamu kuat di lifecycle modelling dan regulatory systems, RabbitMQ harus dilihat sebagai bagian dari chain-of-custody workflow.

Untuk sistem enforcement, message bisa menjadi bukti bahwa:

- sebuah case dibuka,
- rule evaluation diminta,
- action direkomendasikan,
- escalation dipicu,
- reviewer diberi task,
- notification dikirim,
- DLQ terjadi,
- remediation dilakukan.

Namun message queue sendiri bukan cukup untuk audit legal/regulatory.

Kamu tetap butuh:

- immutable audit record,
- business event store/log,
- state transition table,
- actor attribution,
- timestamp yang jelas,
- correlation id,
- reason code,
- retry/remediation record.

RabbitMQ membantu transport dan decoupling. Audit defensibility harus didesain di application/data layer juga.

---

## 27. The RabbitMQ Design Loop

Setiap kali mendesain RabbitMQ flow, gunakan loop berikut.

### Step 1: Apa jenis message?

- command?
- event?
- job?
- notification?
- reply?
- audit record?

### Step 2: Siapa producer dan siapa logical subscriber?

- satu consumer group?
- banyak subscriber?
- temporary consumer?
- human remediation?

### Step 3: Perlu routing seperti apa?

- direct?
- topic?
- fanout?
- headers?
- exchange-to-exchange?

### Step 4: Perlu storage semantics seperti apa?

- classic queue?
- quorum queue?
- stream?
- super stream?

### Step 5: Apa durability requirement?

- boleh hilang?
- harus survive restart?
- harus replicated?
- harus replayable?

### Step 6: Bagaimana publish diketahui berhasil?

- fire-and-forget?
- publisher confirm?
- outbox?
- mandatory returns?

### Step 7: Bagaimana consume diketahui berhasil?

- auto ack?
- manual ack?
- ack setelah transaksi apa?

### Step 8: Apa failure path?

- retry?
- backoff?
- DLQ?
- parking lot?
- manual remediation?

### Step 9: Apa idempotency key?

- message id?
- business operation id?
- aggregate version?
- natural unique constraint?

### Step 10: Apa observability-nya?

- queue depth?
- oldest age?
- redelivery?
- DLQ rate?
- consumer utilization?
- trace id?

---

## 28. Practical Example: Case Opened Event

Misalnya case-service membuka case baru.

### 28.1 Bad design

```text
case-service publishes JSON to queue "events"
notification-service and audit-service consume same queue
consumer auto ack enabled
no message id
no DLQ
```

Masalah:

- audit dan notification bersaing pada queue yang sama,
- salah satu bisa tidak menerima event,
- auto ack bisa menyebabkan loss,
- tidak ada idempotency,
- tidak ada routing semantics,
- tidak ada retry isolation,
- tidak bisa audit failure.

### 28.2 Better design

```text
Exchange: case.events.topic
Routing key: case.opened

Bindings:
  audit.case-events.q        <- case.*
  notification.case-opened.q <- case.opened
  rule.case-events.q         <- case.*
```

Message:

```json
{
  "message_id": "01JZABC...",
  "message_type": "case.opened",
  "schema_version": 1,
  "producer": "case-service",
  "occurred_at": "2026-06-19T10:00:00Z",
  "correlation_id": "corr-001",
  "payload": {
    "case_id": "CASE-2026-0001",
    "jurisdiction": "ID-JK",
    "risk_level": "HIGH"
  }
}
```

Consumer behavior:

```text
manual ack
idempotency by (consumer_name, message_id)
retry transient failure
DLQ permanent failure
publish follow-up event after success if needed
```

### 28.3 Even better for audit replay

Tambahkan stream:

```text
Exchange: case.events.topic
  -> Stream: case.events.audit.stream
  -> Queue: notification.case-opened.q
  -> Queue: rule.case-events.q
```

Audit stream bisa disimpan dengan retention dan dibaca ulang untuk reconstruction/projection rebuild.

---

## 29. Practical Example: Rule Evaluation Command

Case-service ingin rule-engine mengevaluasi risiko.

### 29.1 Ini command, bukan event

```text
EvaluateCaseRisk(case_id)
```

Routing:

```text
Exchange: rule.commands.direct
Routing key: case-risk.evaluate
Queue: rule.case-risk.evaluate.qq
```

Queue type:

```text
quorum queue
```

Alasan:

- ini work item penting,
- hanya satu logical worker group yang memproses,
- harus survive node failure,
- tidak perlu replay log untuk semua consumer.

Consumer:

```text
manual ack
prefetch tuned
idempotency by command_id
retry transient errors
DLQ after retry exhausted
publish RiskEvaluationCompleted event
```

Result event:

```text
Exchange: rule.events.topic
Routing key: risk.evaluation.completed
```

### 29.2 Jangan pakai RPC kecuali perlu

Case-service sebaiknya tidak selalu menunggu synchronous reply jika evaluation bisa asynchronous.

Lebih sehat:

```text
case-service records status = RISK_EVALUATION_PENDING
publish command
rule-engine processes
rule-engine publishes completed event
case-service consumes event
case-service transitions status
```

Ini menghindari hidden synchronous coupling.

---

## 30. Mini Failure Walkthrough

Flow:

```text
case-service -> RabbitMQ -> rule-engine -> PostgreSQL -> event publish
```

### Scenario A: rule-engine crash before DB commit

```text
message delivered
rule-engine crash
no ack
message redelivered
```

Outcome:

- safe if manual ack,
- no duplicate side effect because DB commit did not happen.

### Scenario B: rule-engine crash after DB commit before ack

```text
message delivered
DB commit success
crash before ack
redelivery
```

Outcome:

- duplicate delivery,
- safe only if DB operation idempotent.

### Scenario C: rule-engine publishes completed event but crash before ack original command

```text
command processed
result event published
crash before ack command
command redelivered
```

Outcome:

- possible duplicate result event,
- need idempotent command handling and/or outbox.

### Scenario D: completed event publish fails after DB commit

```text
DB says evaluation completed
event not published
```

Outcome:

- downstream never notified,
- fix with transactional outbox.

This is why serious messaging design eventually needs outbox/inbox patterns.

---

## 31. RabbitMQ Mindset untuk Java Engineer

### 31.1 Jangan mulai dari annotation

Spring `@RabbitListener` itu nyaman, tapi jangan mulai dari sana.

Mulai dari:

- message type,
- topology,
- delivery semantics,
- ack boundary,
- idempotency,
- retry/DLQ,
- observability.

Baru setelah itu pilih annotation/configuration.

### 31.2 Jangan biarkan framework menyembunyikan semantics

Spring AMQP bisa:

- auto-declare topology,
- auto-convert JSON,
- manage listener containers,
- configure retry,
- configure ack mode.

Tapi framework tidak bisa menentukan:

- message contract yang benar,
- business idempotency,
- DLQ remediation policy,
- state transition validity,
- regulatory audit requirement.

### 31.3 Handler harus kecil dan eksplisit

Consumer handler idealnya memiliki struktur:

```text
receive message
parse envelope
validate schema/version
start transaction
check idempotency
load aggregate
apply business operation
record audit/state
commit transaction
ack
```

Jika handler melakukan terlalu banyak side effect, pecah workflow.

---

## 32. Checklist: Apakah Kamu Memahami RabbitMQ Fundamentals?

Kamu mulai punya mental model yang benar jika bisa menjawab pertanyaan berikut tanpa membuka dokumentasi:

1. Apa perbedaan exchange dan queue?
2. Kenapa publisher confirm tidak berarti consumer sudah sukses?
3. Kenapa manual ack menyebabkan kemungkinan duplicate processing?
4. Kenapa auto ack bisa menyebabkan message loss?
5. Apa beda ready dan unacked messages?
6. Apa itu prefetch dan kenapa ia bagian dari backpressure?
7. Kenapa satu queue dengan tiga service berbeda bukan pub/sub?
8. Kenapa retry dengan `requeue=true` bisa menciptakan infinite loop?
9. Kenapa queue durable saja tidak cukup untuk durability message?
10. Apa beda classic queue, quorum queue, dan stream secara mental model?
11. Kapan RabbitMQ queue lebih cocok dari stream?
12. Kapan stream lebih cocok dari queue?
13. Apa yang terjadi jika consumer crash setelah DB commit sebelum ack?
14. Mengapa idempotency wajib untuk consumer produksi?
15. Apa bedanya command dan event dalam topology RabbitMQ?
16. Kenapa ordering global sulit jika ada competing consumers?
17. Apa failure path untuk unroutable message?
18. Kenapa RabbitMQ bukan database?
19. Bagaimana DLQ membantu audit dan remediation?
20. Apa yang harus dimonitor selain queue depth?

---

## 33. Heuristics Part 01

1. Producer success lokal bukan broker success.
2. Broker confirm bukan consumer success.
3. Consumer receive bukan business success.
4. Ack adalah state transition, bukan formalitas.
5. Auto ack berarti kamu menerima risk at-most-once.
6. Manual ack berarti kamu wajib menangani duplicate.
7. Retry tanpa batas adalah incident yang tertunda.
8. DLQ tanpa owner hanyalah tempat sampah teknis.
9. Queue depth tanpa age/rate bisa menipu.
10. Prefetch adalah concurrency budget.
11. Satu queue merepresentasikan satu logical subscription/work group.
12. Untuk pub/sub, gunakan satu queue per subscriber group.
13. Jangan kirim entity internal sebagai message contract.
14. Jangan kirim file besar sebagai message.
15. RabbitMQ membantu decoupling, tetapi tidak menghapus schema coupling.
16. Quorum queue untuk durable replicated work queue.
17. Stream untuk retained replayable log.
18. Classic queue untuk use case yang memang cocok dan disadari risikonya.
19. Ordering dan parallelism selalu trade-off.
20. Sistem messaging yang baik didesain dari failure path, bukan happy path.

---

## 34. Latihan Desain

Gunakan skenario berikut:

> Sebuah platform enforcement case management menerima laporan pelanggaran. Setelah case dibuka, sistem harus mengevaluasi risiko, mengirim notifikasi ke reviewer, mencatat audit event, dan menghasilkan deadline escalation jika reviewer tidak bertindak dalam 3 hari.

Jawab:

1. Message apa saja yang command?
2. Message apa saja yang event?
3. Exchange apa yang kamu buat?
4. Queue apa yang kamu buat?
5. Queue mana yang harus quorum?
6. Apakah perlu stream?
7. Apa routing key-nya?
8. Di mana idempotency key digunakan?
9. Di mana manual ack dilakukan?
10. Apa retry policy tiap consumer?
11. Message mana yang masuk DLQ jika gagal?
12. Apa audit record yang harus disimpan di database?
13. Apa yang terjadi jika rule-engine crash setelah menyimpan hasil tapi sebelum ack?
14. Apa yang terjadi jika notification-service gagal karena SMTP down?
15. Apa yang terjadi jika payload event punya schema_version yang tidak dikenal?

Jika kamu bisa menjawab ini dengan eksplisit, kamu sudah berpikir seperti engineer yang mendesain sistem messaging, bukan sekadar user library RabbitMQ.

---

## 35. Ringkasan Mental Model

RabbitMQ fundamentals yang paling penting:

```text
Publisher publishes to exchange.
Exchange routes to queue/stream.
Queue holds work until ack.
Consumer receives delivery, not completion.
Ack deletes work from queue.
Nack/reject decides failure path.
Publisher confirm protects publish boundary.
Manual ack protects processing boundary.
Idempotency protects duplicate boundary.
DLQ protects poison boundary.
Prefetch protects concurrency boundary.
Queue type protects storage/failure boundary.
Topology expresses architecture.
```

Jika disederhanakan:

> RabbitMQ adalah sistem untuk memindahkan tanggung jawab kerja antar proses dengan routing, buffering, acknowledgement, retry, dan durability semantics yang eksplisit.

Dan prinsip paling penting:

> Dalam RabbitMQ, reliability bukan satu fitur. Reliability adalah komposisi dari topology, queue type, publisher confirms, durable messages, manual acknowledgements, idempotent consumers, retry policy, DLQ, observability, dan operational discipline.

---

## 36. Sumber Resmi dan Bacaan Lanjutan

Sumber yang digunakan sebagai baseline konseptual part ini:

1. RabbitMQ Documentation — Consumer Acknowledgements and Publisher Confirms  
   https://www.rabbitmq.com/docs/confirms

2. RabbitMQ Documentation — Exchanges  
   https://www.rabbitmq.com/docs/exchanges

3. RabbitMQ Documentation — Queues  
   https://www.rabbitmq.com/docs/queues

4. RabbitMQ Documentation — Quorum Queues  
   https://www.rabbitmq.com/docs/quorum-queues

5. RabbitMQ Documentation — Streams and Superstreams  
   https://www.rabbitmq.com/docs/streams

6. RabbitMQ Documentation — Classic Queue Mirroring Deprecated/Removed  
   https://www.rabbitmq.com/docs/3.13/ha

7. RabbitMQ Stream Java Client Documentation  
   https://rabbitmq.github.io/rabbitmq-stream-java-client/stable/htmlsingle/

---

## 37. Apa Selanjutnya?

Part berikutnya:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-02.md
```

Topik:

```text
AMQP 0-9-1 Deep Dive: Bahasa Internal RabbitMQ
```

Kita akan membahas:

- connection,
- channel,
- exchange,
- queue,
- binding,
- routing key,
- consumer,
- delivery tag,
- AMQP frame-level intuition,
- durable vs persistent,
- basic publish/consume/get,
- mandatory publish,
- kenapa channel bukan thread,
- kesalahan umum Java engineer saat memakai AMQP.

Status seri: **belum selesai**.  
Progress: **part-00 selesai, part-01 selesai**.  
Masih tersisa: **part-02 sampai part-34**.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-00.md">⬅️ Part 00 — Orientation, Mental Model, dan Scope RabbitMQ Modern</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-02.md">Part 02 — AMQP 0-9-1 Deep Dive: Bahasa Internal RabbitMQ ➡️</a>
</div>

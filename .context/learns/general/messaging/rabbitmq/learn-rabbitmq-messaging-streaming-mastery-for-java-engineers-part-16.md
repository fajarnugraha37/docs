# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-16.md

# Part 16 — RabbitMQ Streams Mental Model

> Series: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Audience: Java software engineer yang ingin memahami RabbitMQ, RabbitMQ Streams, dan desain messaging/streaming production-grade.  
> Fokus part ini: membangun mental model RabbitMQ Streams sebagai append-only replicated log, memahami perbedaannya dari queue RabbitMQ biasa, dan tahu kapan Streams layak dipakai dibanding classic/quorum queue atau Kafka.

---

## 0. Posisi Part Ini Dalam Seri

Sampai part sebelumnya, kita sudah melihat RabbitMQ dari sisi:

1. brokered messaging,
2. AMQP routing,
3. exchange-binding-queue topology,
4. delivery acknowledgement,
5. retry/DLQ,
6. Java client,
7. Spring AMQP,
8. workflow dan saga.

Semua itu cenderung memakai RabbitMQ sebagai **work delivery system**:

```text
producer -> exchange -> queue -> consumer -> ack -> message removed
```

RabbitMQ Streams memperkenalkan primitive berbeda:

```text
producer -> stream -> consumer reads at offset -> message remains until retention deletes it
```

Perbedaan paling penting:

- queue biasa: konsumsi bersifat **destructive** secara logika; setelah ack, message selesai untuk consumer group/queue itu.
- stream: konsumsi bersifat **non-destructive**; consumer membaca posisi tertentu, lalu stream tetap menyimpan data sampai retention policy menghapusnya.

Jadi part ini bukan hanya “fitur lain RabbitMQ”. Ini adalah perubahan cara berpikir dari:

```text
message sebagai task yang harus dikerjakan
```

menjadi:

```text
message sebagai record historis yang bisa dibaca ulang
```

---

## 1. Executive Summary

RabbitMQ Streams adalah fitur RabbitMQ untuk menyimpan message sebagai **immutable append-only log**. Setiap message mendapatkan **offset** saat dipublish. Consumer dapat membaca dari awal, offset tertentu, timestamp tertentu, posisi terakhir, atau posisi berikutnya. Karena konsumsi tidak menghapus message, banyak consumer bisa membaca ulang data yang sama tanpa saling mengganggu.

Gunakan RabbitMQ Streams ketika kamu butuh:

- replay,
- audit history,
- event log ringan,
- high-throughput persistent messaging,
- fanout ke banyak consumer independen,
- rebuild projection,
- consumer yang bisa restart dari posisi tertentu,
- kombinasi RabbitMQ routing dengan log-style retention.

Jangan langsung gunakan Streams untuk semua hal. Jika use case adalah **work queue** seperti “proses invoice ini sekali oleh salah satu worker”, quorum queue biasanya lebih cocok. Jika butuh ecosystem stream processing besar, long retention sangat besar, compacted topic, cross-region event backbone mature, atau Kafka-native tooling, Kafka bisa tetap lebih cocok.

Mental model utama:

```text
Queue  = mailbox/worklist
Stream = append-only history/log
```

---

## 2. Sumber Resmi dan Baseline Konsep

Dokumentasi RabbitMQ mendefinisikan stream sebagai queue type yang memodelkan **immutable append-only log**. Setiap message diberi offset saat publish, offset tidak berubah, dan banyak consumer bisa membaca stream secara independen.

Dokumentasi dan blog resmi RabbitMQ juga menekankan bahwa streams memiliki:

- non-destructive consumer semantics,
- publisher confirms,
- publisher-side deduplication,
- server-side offset tracking,
- retention policy berbasis size atau age,
- dukungan protocol khusus RabbitMQ Stream Protocol,
- interoperability dengan AMQP 0-9-1 dalam batas tertentu,
- super streams untuk partitioned streams.

Referensi resmi yang relevan:

- RabbitMQ Streams and Super Streams: <https://www.rabbitmq.com/docs/streams>
- RabbitMQ Queues documentation: <https://www.rabbitmq.com/docs/queues>
- RabbitMQ Streams Overview: <https://www.rabbitmq.com/blog/2021/07/13/rabbitmq-streams-overview>
- RabbitMQ Streams Offset Tracking: <https://www.rabbitmq.com/blog/2021/09/13/rabbitmq-streams-offset-tracking>
- RabbitMQ Streams Interoperability: <https://www.rabbitmq.com/blog/2021/10/07/rabbitmq-streams-interoperability>
- RabbitMQ Stream Java tutorial: <https://www.rabbitmq.com/tutorials/tutorial-one-java-stream>

---

## 3. Kenapa Streams Ada di RabbitMQ?

RabbitMQ awalnya sangat kuat untuk pola:

- routing,
- work distribution,
- command queues,
- pub/sub via exchange,
- RPC,
- retry/DLX,
- task fanout,
- consumer acknowledgement.

Namun ada kategori masalah yang kurang cocok dengan queue biasa:

### 3.1 Replay

Misalnya ada consumer baru yang ingin membangun projection dari seluruh histori event.

Dengan queue biasa:

```text
message lama sudah ack -> hilang dari queue
consumer baru tidak bisa baca ulang
```

Dengan stream:

```text
message lama masih ada selama retention -> consumer baru bisa mulai dari offset awal
```

### 3.2 Banyak Consumer Independen

Dengan queue biasa, satu message dalam satu queue akan dikirim ke salah satu competing consumer. Jika ingin banyak consumer independen, biasanya kita membuat banyak queue yang di-bind ke exchange yang sama.

```text
exchange -> queue A -> service A
         -> queue B -> service B
         -> queue C -> service C
```

Ini valid, tetapi setiap queue punya storage dan lifecycle sendiri.

Dengan stream, banyak consumer bisa membaca log yang sama secara independen.

```text
stream -> consumer A at offset 100
       -> consumer B at offset 50_000
       -> consumer C at offset latest
```

### 3.3 Audit dan Forensics

Dalam sistem enforcement/regulatory, sering ada kebutuhan untuk menjawab:

- event apa yang terjadi?
- urutan event-nya bagaimana?
- consumer apa yang memproses event mana?
- kapan event dipublish?
- bisakah projection dibangun ulang?
- bisakah investigator membaca histori tanpa mengganggu processing utama?

Queue biasa bagus untuk work delivery, tetapi tidak didesain sebagai history store jangka panjang. Stream lebih natural untuk histori yang bisa dibaca ulang.

### 3.4 High-Throughput Persistent Log

Queue biasa punya semantic yang kaya untuk work delivery, ack, requeue, dead-lettering, dan dispatch. Stream dirancang untuk append dan sequential reads. Untuk kategori workload tertentu, model append-only log lebih efisien.

---

## 4. Queue vs Stream: Mental Model Inti

### 4.1 Queue

Queue adalah **work container**.

```text
message masuk -> broker mengirim ke consumer -> consumer ack -> message selesai
```

Queue cocok ketika pesan merepresentasikan:

- command yang harus dieksekusi,
- job yang harus diproses,
- task yang harus diambil salah satu worker,
- notification yang tidak perlu replay panjang,
- workflow step yang butuh redelivery jika gagal.

Queue menjawab pertanyaan:

> “Siapa yang harus mengerjakan pekerjaan ini?”

### 4.2 Stream

Stream adalah **history container**.

```text
message append -> message diberi offset -> consumer membaca offset -> message tetap ada sampai retention
```

Stream cocok ketika pesan merepresentasikan:

- event historis,
- audit record,
- immutable fact,
- data feed,
- projection source,
- log yang bisa dibaca ulang.

Stream menjawab pertanyaan:

> “Apa saja yang pernah terjadi, dan dari posisi mana consumer ini harus membaca?”

### 4.3 Perbedaan Dalam Satu Tabel

| Aspek | Queue biasa | Stream |
|---|---|---|
| Model | Worklist/mailbox | Append-only log |
| Consumption | Destructive secara logika | Non-destructive |
| Setelah ack | Message selesai untuk queue | Message tetap ada sampai retention |
| Posisi consumer | Broker dispatch + unacked state | Offset |
| Replay | Tidak natural | Natural |
| Banyak consumer independen | Biasanya queue per consumer/service | Banyak consumer bisa baca stream sama |
| Work stealing | Natural via competing consumers | Bukan fokus utama single stream |
| Retention | Biasanya sampai ack/TTL/limit | Size/age-based retention |
| Use case utama | command/job/task | event history/replay/audit/feed |
| Failure focus | ack/nack/redelivery/DLQ | offset/progress/replay/retention |

---

## 5. Immutable Append-Only Log

RabbitMQ Stream menyimpan message sebagai log yang bertambah di ujung kanan.

```text
stream: case-events

offset:   0       1       2       3       4       5
        +-------+-------+-------+-------+-------+-------+
record: | E-001 | E-002 | E-003 | E-004 | E-005 | E-006 |
        +-------+-------+-------+-------+-------+-------+
                                      ^
                                      consumer position
```

Append-only berarti:

- producer menambahkan message baru di akhir stream,
- message lama tidak dihapus karena consumer sudah membaca,
- consumer memilih posisi baca,
- deletion terjadi karena retention policy, bukan ack consumer.

Ini penting karena desain stream harus memperlakukan message sebagai **immutable fact**.

Contoh event yang cocok:

```json
{
  "messageId": "evt-01HV...",
  "messageType": "case.evidence.submitted.v1",
  "schemaVersion": 1,
  "caseId": "CASE-2026-000123",
  "evidenceId": "EVD-8842",
  "occurredAt": "2026-06-19T08:12:45Z"
}
```

Event itu tidak “diubah”. Kalau ada koreksi, publish event baru:

```json
{
  "messageId": "evt-01HV...",
  "messageType": "case.evidence.corrected.v1",
  "schemaVersion": 1,
  "caseId": "CASE-2026-000123",
  "evidenceId": "EVD-8842",
  "correctionReason": "metadata_classification_updated",
  "occurredAt": "2026-06-19T09:01:03Z"
}
```

---

## 6. Offset: Posisi Dalam Stream

Offset adalah nomor posisi message di stream.

```text
offset 0 -> first message
offset 1 -> second message
offset 2 -> third message
...
```

Offset berbeda dari delivery tag di AMQP queue.

| Konsep | Scope | Makna |
|---|---|---|
| delivery tag | Channel AMQP consumer | Identitas delivery yang sedang dikirim ke consumer |
| offset | Stream | Posisi permanen message di log |

Delivery tag adalah artefak delivery. Offset adalah posisi historis.

### 6.1 Cara Consumer Mulai Membaca

Consumer stream dapat attach dari beberapa posisi konseptual:

```text
first       -> dari message pertama yang masih tersedia
next        -> hanya message baru setelah attach
last        -> dari message terakhir
absolute    -> dari offset tertentu
timestamp   -> dari posisi berdasarkan waktu
stored      -> dari offset yang pernah disimpan consumer
```

Contoh skenario:

| Skenario | Start offset yang masuk akal |
|---|---|
| consumer baru untuk live notification | next |
| rebuild projection dari awal | first |
| replay incident sejak jam tertentu | timestamp |
| restart consumer production | stored offset |
| debugging satu range histori | absolute offset |

### 6.2 Offset Bukan Bukti Business Success

Ini jebakan penting.

Jika consumer sudah membaca offset 10, bukan berarti business side effect untuk offset 10 sudah committed.

Harus dibedakan:

```text
read offset       = consumer menerima message
decoded offset    = payload valid
processed offset  = business logic selesai
committed offset  = progress aman disimpan
```

Dalam aplikasi serius, offset sebaiknya disimpan setelah business transaction berhasil.

---

## 7. Offset Tracking

RabbitMQ Streams mendukung server-side offset tracking. Consumer dengan nama tertentu bisa menyimpan progress agar saat restart dapat melanjutkan dari posisi terakhir.

Namun, offset tracking bukan sekadar “fitur convenience”. Ini bagian dari correctness boundary.

### 7.1 Server-Side Offset Tracking

Model sederhana:

```text
consumer reads offset 100
consumer processes message
consumer stores offset 100
consumer restarts
consumer resumes at 101
```

Kelebihan:

- sederhana,
- tidak perlu tabel offset sendiri,
- cocok untuk consumer stateless sederhana,
- progress menempel pada broker.

Risiko:

- jika business state ada di database, offset dan database update bisa tidak atomic,
- bisa terjadi state committed tetapi offset belum stored,
- atau offset stored tetapi business state belum committed jika urutan salah.

### 7.2 Application-Side Offset Tracking

Untuk sistem yang update database, sering lebih aman menyimpan offset bersama business effect dalam satu transaction.

Contoh tabel:

```sql
CREATE TABLE stream_consumer_offsets (
  consumer_name VARCHAR(200) NOT NULL,
  stream_name VARCHAR(200) NOT NULL,
  last_processed_offset BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (consumer_name, stream_name)
);
```

Pseudo-flow:

```text
begin db transaction
  if offset <= last_processed_offset:
      skip duplicate
  apply business change
  update last_processed_offset = offset
commit db transaction
```

Dengan ini, business state dan progress consumer bergerak bersama.

### 7.3 Offset Tracking Decision

| Use case | Offset storage yang disarankan |
|---|---|
| logging consumer tanpa DB side effect | server-side offset |
| metrics aggregator ephemeral | server-side offset atau none |
| projection builder ke PostgreSQL | application-side offset di DB |
| regulatory audit projection | application-side offset dengan audit table |
| notification sender | DB-side idempotency + possibly server-side offset |
| replay tool manual | no stored offset atau named replay session |

---

## 8. Retention: Stream Tidak Menyimpan Selamanya Secara Gratis

Karena konsumsi stream tidak menghapus message, harus ada retention policy.

Retention dapat berbasis:

- ukuran,
- umur,
- atau kombinasi konfigurasi yang tersedia.

Mental model:

```text
append indefinitely + finite disk = retention is mandatory
```

Jika retention terlalu pendek:

- consumer lambat bisa kehilangan message yang belum dibaca,
- replay lama tidak mungkin,
- audit history tidak lengkap.

Jika retention terlalu panjang:

- disk membengkak,
- recovery dan replica management lebih berat,
- biaya storage naik,
- backup/DR lebih kompleks.

### 8.1 Retention Harus Berasal Dari Requirement

Jangan set retention karena “kayaknya cukup 7 hari”.

Gunakan pertanyaan:

1. Berapa lama consumer boleh down tanpa data loss?
2. Berapa lama audit replay dibutuhkan?
3. Apakah stream adalah source of truth atau hanya transport history?
4. Apakah data juga tersimpan di database/domain store?
5. Apakah ada kewajiban legal/regulatory retention?
6. Apakah data sensitif boleh disimpan di broker selama periode itu?
7. Berapa message/day dan average payload size?
8. Berapa replica factor?

### 8.2 Retention Capacity Formula

Rumus kasar:

```text
storage_needed = messages_per_day
               * average_message_size
               * retention_days
               * replication_factor
               * overhead_factor
```

Contoh:

```text
messages/day       = 10,000,000
avg message size   = 1 KB
retention          = 7 days
replication factor = 3
overhead factor    = 1.3

storage ≈ 10,000,000 * 1KB * 7 * 3 * 1.3
        ≈ 273 GB
```

Angka ini belum termasuk filesystem, segment overhead, operational headroom, dan variasi payload.

Rule praktis:

```text
jangan sizing stream tanpa menghitung retention * replication
```

---

## 9. Stream Protocol vs AMQP Access

RabbitMQ Streams bisa diakses melalui:

1. RabbitMQ Stream Protocol,
2. sebagian interoperabilitas dengan AMQP 0-9-1.

### 9.1 Stream Protocol

Stream Protocol adalah protocol khusus untuk Streams.

Cocok ketika kamu ingin:

- throughput tinggi,
- stream-native producer/consumer,
- offset control,
- deduplication,
- consumer offset tracking,
- stream-specific features,
- Java Stream Client.

### 9.2 AMQP Access to Streams

RabbitMQ juga menyediakan interoperabilitas agar stream bisa dideklarasikan sebagai queue type tertentu dan berinteraksi lewat AMQP dalam beberapa pola.

Ini berguna untuk:

- integrasi bertahap,
- producer AMQP yang publish ke stream queue,
- consumer AMQP tertentu,
- bridging existing RabbitMQ topology.

Namun jangan menganggap AMQP queue consumer dan Stream Protocol consumer memiliki semua kemampuan yang sama. Untuk stream-native behavior, gunakan Stream Protocol dan client yang sesuai.

### 9.3 Practical Rule

```text
Gunakan Stream Java Client untuk aplikasi yang memang stream-native.
Gunakan AMQP access hanya jika butuh interoperability atau migration path.
```

---

## 10. Stream as Queue Type

Dalam RabbitMQ modern, stream adalah salah satu queue type.

Konseptual declaration:

```text
queue name: case.audit.stream
x-queue-type: stream
```

Namun meskipun disebut queue type, semantics-nya berbeda dari quorum/classic queue.

Jangan berpikir:

```text
stream = queue yang lebih cepat
```

Lebih tepat:

```text
stream = queue-type dengan log semantics
```

Akibatnya, design question berubah.

Untuk queue biasa:

```text
Bagaimana message didistribusikan ke worker?
Bagaimana ack/nack/redelivery?
Bagaimana DLQ?
```

Untuk stream:

```text
Dari offset mana consumer membaca?
Bagaimana offset disimpan?
Berapa retention?
Apakah replay idempotent?
Apakah consumer bisa tertinggal retention?
```

---

## 11. Producer Semantics

Producer stream menambahkan record ke stream.

Critical concerns:

- confirm,
- duplicate publish,
- ordering per producer,
- batching,
- message id,
- deduplication,
- backpressure.

### 11.1 Publisher Confirm

Seperti queue reliability, producer tidak boleh menganggap publish berhasil hanya karena method call return.

Harus ada konfirmasi bahwa broker menerima/menyimpan message sesuai semantic yang diinginkan.

### 11.2 Producer-Side Deduplication

RabbitMQ Streams mendukung deduplication dengan konsep producer identity dan publishing id.

Mental model:

```text
producer = evidence-event-publisher
publishingId = 1001

Jika producer retry message dengan publishingId sama,
broker dapat mengenali duplicate berdasarkan producer identity + publishing id.
```

Ini berguna saat producer tidak tahu apakah publish sebelumnya berhasil.

Tetapi deduplication bukan pengganti contract idempotency end-to-end.

Masih butuh:

- stable messageId,
- idempotent consumer,
- deterministic event generation,
- outbox jika publish berasal dari DB transaction.

### 11.3 Producer Ordering

Jika satu producer publish sequence event untuk entity yang sama, ordering relatif dapat lebih mudah dipahami.

Tetapi dalam distributed system:

- banyak producer bisa publish untuk entity yang sama,
- clock tidak selalu menentukan causal order,
- retry bisa menghasilkan arrival order yang berbeda,
- partitioned stream memperkenalkan ordering per partition, bukan global.

Jadi event contract tetap perlu membawa:

- aggregate id,
- aggregate version,
- occurredAt,
- causationId,
- policy version,
- source system.

---

## 12. Consumer Semantics

Stream consumer membaca message dari posisi tertentu.

Berbeda dari queue consumer:

```text
queue consumer: broker gives work, consumer ack/nack
stream consumer: consumer reads log position, then stores progress
```

### 12.1 Tidak Ada Ack Untuk Menghapus Message

Dalam stream, consumer acknowledgement bukan mekanisme deletion. Message tidak hilang karena satu consumer selesai membaca.

Progress consumer disimpan sebagai offset.

### 12.2 Restart Semantics

Consumer restart scenario:

```text
consumer processed offset 200
consumer stored offset 200
consumer crash
consumer restart from 201
```

Jika consumer crash sebelum offset stored:

```text
consumer processed offset 200
consumer crash before storing offset
consumer restart from 200
message may be processed again
```

Artinya Streams tetap membutuhkan idempotency.

### 12.3 Consumer Lag

Consumer lag adalah jarak antara offset terakhir di stream dan offset terakhir yang sudah diproses consumer.

```text
latest stream offset       = 1,000,000
consumer processed offset  =   920,000
lag                        =    80,000 messages
```

Lag penting untuk:

- alerting,
- capacity planning,
- retention safety,
- incident diagnosis.

Jika lag terus naik:

```text
publish rate > processing rate
```

Solusinya bukan sekadar “tambah consumer” jika ordering per key harus dijaga. Mungkin butuh partitioning/super stream, workload split, payload optimization, atau handler speedup.

---

## 13. Non-Destructive Consumption

Non-destructive consumption berarti message tetap ada setelah dibaca.

Konsekuensi positif:

- replay mudah,
- consumer baru bisa membaca histori,
- projection rebuild possible,
- forensic investigation possible,
- analytics consumer tidak mengganggu operational consumer.

Konsekuensi negatif:

- storage harus dikelola,
- sensitive data exposure window lebih lama,
- consumer bisa membaca data lama yang schema-nya berubah,
- replay bisa menghasilkan side effect duplicate jika handler tidak aman,
- retention miss bisa menyebabkan consumer tidak bisa catch up.

### 13.1 Replay Is a Privilege and a Risk

Replay terdengar menyenangkan, tetapi dalam sistem produksi, replay bisa berbahaya.

Jika consumer mengirim email saat replay:

```text
replay 1 juta event -> kirim 1 juta email duplicate
```

Jika consumer memanggil payment API saat replay:

```text
replay -> duplicate external charge attempt
```

Jadi consumer harus jelas tipe-nya:

| Consumer type | Replay-safe? | Catatan |
|---|---:|---|
| projection rebuild | Ya, jika idempotent/upsert | Natural stream use case |
| audit indexer | Ya | Biasanya append/upsert |
| metrics aggregator | Ya, jika windowing jelas | Bisa rebuild |
| notification sender | Tidak otomatis | Butuh sent table/idempotency |
| external side-effect caller | Berisiko | Harus punya idempotency kuat |
| workflow command issuer | Berisiko | Replay bisa men-trigger command ulang |

---

## 14. RabbitMQ Stream vs RabbitMQ Queue

### 14.1 Command Processing

Use case:

```text
ReviewCaseCommand harus diproses oleh satu worker.
Jika worker gagal, command harus redeliver atau masuk DLQ.
```

Primitive cocok:

```text
quorum queue
```

Kenapa bukan stream?

Karena ini work item. Yang dibutuhkan adalah dispatch, ack, redelivery, DLQ, dan competing consumers.

### 14.2 Audit Event History

Use case:

```text
Setiap perubahan case harus tersimpan sebagai event history dan bisa dibaca ulang.
```

Primitive cocok:

```text
stream
```

Kenapa bukan quorum queue?

Karena event history perlu retention dan replay, bukan sekadar work dispatch.

### 14.3 Notification Fanout

Use case:

```text
CaseUpdatedEvent harus diterima oleh notification service, audit service, search indexer.
```

Pilihan:

- topic exchange + queue per service,
- stream read by multiple consumers,
- hybrid: exchange routes to queues and stream.

Decision:

```text
Jika butuh independent work delivery + DLQ per service -> queue per service.
Jika butuh shared replayable event feed -> stream.
Jika butuh keduanya -> hybrid.
```

### 14.4 Hybrid Pattern

RabbitMQ memungkinkan topology yang kuat:

```text
                     +----------------------+
                     | case.audit.stream    |
                     | x-queue-type=stream  |
                     +----------------------+
                    /
producer -> exchange
                    \
                     +----------------------+
                     | case.review.queue    |
                     | x-queue-type=quorum  |
                     +----------------------+
```

Satu event bisa:

- masuk stream untuk audit/replay,
- masuk quorum queue untuk operational processing.

Ini sering lebih baik daripada memaksa stream melakukan semua peran.

---

## 15. RabbitMQ Streams vs Kafka: Bukan Sekadar “Mini Kafka”

Kamu sudah punya Kafka series, jadi kita tidak akan mengulang Kafka fundamentals. Fokus di sini adalah decision boundary.

RabbitMQ Streams dan Kafka sama-sama punya log-style consumption, offset, retention, dan replay. Tetapi mereka berada dalam ecosystem dan operational model berbeda.

### 15.1 RabbitMQ Streams Sweet Spot

RabbitMQ Streams cocok ketika:

- organisasi sudah memakai RabbitMQ,
- butuh replay/audit dalam RabbitMQ topology,
- butuh exchange routing + stream retention,
- event volume moderate-to-high tapi tidak membutuhkan Kafka ecosystem besar,
- ingin queue dan stream dalam satu broker family,
- ingin stream untuk audit/projection, queue untuk work,
- tim ingin menghindari menjalankan dua platform messaging jika requirement tidak menuntut Kafka.

### 15.2 Kafka Sweet Spot

Kafka tetap unggul ketika:

- event streaming adalah backbone utama perusahaan,
- retention sangat panjang dan volume sangat besar,
- banyak stream processing pipeline,
- ecosystem Kafka Connect/ksqlDB/Flink/Spark sangat dibutuhkan,
- consumer group partition rebalancing dan partition model Kafka adalah inti arsitektur,
- compacted topics diperlukan,
- data platform dan analytics integration dominan.

### 15.3 Better Framing

Pertanyaan yang salah:

```text
RabbitMQ Streams bisa menggantikan Kafka tidak?
```

Pertanyaan yang lebih tepat:

```text
Untuk use case ini, apakah kita butuh routing broker dengan stream capability,
atau distributed event log platform sebagai data backbone?
```

---

## 16. Super Streams: Ketika Satu Stream Tidak Cukup

Single stream punya batas scaling natural. Jika write/read throughput tinggi, atau ingin partitioning per key, RabbitMQ menyediakan konsep **super stream**.

Mental model:

```text
super stream: case-events

partition streams:
  case-events-0
  case-events-1
  case-events-2
  case-events-3
```

Producer memilih partition berdasarkan routing strategy, misalnya hash dari `caseId`.

```text
caseId CASE-001 -> partition 2
caseId CASE-002 -> partition 0
caseId CASE-003 -> partition 2
```

Tujuan:

- scale write,
- scale read,
- preserve order per key,
- distribute load.

### 16.1 Ordering Dalam Super Stream

Ordering global tidak realistis.

Yang biasanya dibutuhkan:

```text
ordering per caseId
ordering per aggregateId
ordering per accountId
ordering per tenantId + entityId
```

Super stream harus dirancang dengan routing key yang sesuai dengan ordering requirement.

### 16.2 Hot Partition

Jika satu key sangat aktif:

```text
CASE-HOT-999 receives 40% of all events
```

Maka partition yang memuat key itu menjadi bottleneck.

Solusi mungkin:

- workload split,
- finer-grained key,
- separate stream for hot entity category,
- domain redesign,
- accept serial bottleneck jika ordering mutlak.

Part khusus super streams akan dibahas lebih detail di part 18.

---

## 17. Designing Stream Message Contract

Stream message harus lebih disiplin daripada queue job biasa, karena message bisa hidup lebih lama dan dibaca oleh consumer masa depan.

Minimal envelope:

```json
{
  "messageId": "evt-01J0Q6Z9F4Y5A6B7C8D9E0F1G2",
  "messageType": "case.status.changed.v1",
  "schemaVersion": 1,
  "streamName": "case-events",
  "subject": "case/CASE-2026-000123",
  "aggregateId": "CASE-2026-000123",
  "aggregateType": "case",
  "aggregateVersion": 42,
  "correlationId": "corr-01J0...",
  "causationId": "cmd-01J0...",
  "producer": "case-service",
  "occurredAt": "2026-06-19T08:15:00Z",
  "publishedAt": "2026-06-19T08:15:01Z",
  "tenantId": "tenant-a",
  "payload": {
    "fromStatus": "UNDER_REVIEW",
    "toStatus": "ESCALATED",
    "reasonCode": "HIGH_RISK_SIGNAL",
    "policyVersion": "ENF-2026.06"
  }
}
```

### 17.1 Important Fields

| Field | Kenapa penting di stream |
|---|---|
| `messageId` | idempotency, dedup, tracing |
| `messageType` | dispatch dan compatibility |
| `schemaVersion` | consumer masa depan bisa decode |
| `aggregateId` | ordering/partitioning/rebuild |
| `aggregateVersion` | detect out-of-order/missing event |
| `correlationId` | trace end-to-end |
| `causationId` | causal chain |
| `occurredAt` | waktu domain |
| `publishedAt` | waktu transport |
| `producer` | ownership dan incident tracing |
| `tenantId` | isolation/security |
| `policyVersion` | regulatory defensibility |

### 17.2 Do Not Put Everything In Stream

Stream retention memperpanjang usia data di broker. Jangan asal menaruh:

- PII besar,
- dokumen mentah,
- file evidence,
- access token,
- credential,
- transient debug dump,
- payload ratusan MB.

Gunakan pointer:

```json
{
  "evidenceId": "EVD-8842",
  "evidenceObjectUri": "s3://restricted-evidence-bucket/...",
  "sha256": "...",
  "classification": "CONFIDENTIAL"
}
```

Broker menyimpan event metadata, object store menyimpan binary besar.

---

## 18. Stream Topology Patterns

### 18.1 Audit Stream Pattern

```text
case-service -> case.events exchange -> case.audit.stream
```

Semua domain events masuk ke audit stream.

Consumer:

- audit indexer,
- compliance report builder,
- investigator replay tool,
- projection rebuild job.

### 18.2 Queue + Stream Dual Write Via Exchange

```text
producer
   |
   v
case.events.topic
   |-- binding: case.* -> case.audit.stream
   |-- binding: case.review.requested -> review-work.q
   |-- binding: case.notification.* -> notification.q
```

Keuntungan:

- stream menyimpan histori,
- queues tetap memproses work,
- setiap service punya DLQ sendiri,
- audit tidak bergantung pada consumer operational.

### 18.3 Projection Rebuild Pattern

```text
case.audit.stream -> projection-rebuilder -> read model database
```

Flow:

1. drop/recreate projection table,
2. start consumer from `first`,
3. process event idempotently,
4. store processed offset,
5. catch up to latest,
6. switch traffic.

### 18.4 Incident Forensics Pattern

```text
case.audit.stream offset/timestamp range -> forensic tool -> timeline report
```

Useful untuk:

- why case escalated,
- which policy version was used,
- which command caused which event,
- whether duplicate processing happened,
- whether event was late/out of order.

### 18.5 Analytics Tap Pattern

```text
operational events -> stream -> analytics consumer
```

Analytics consumer bisa lambat atau replay tanpa mengganggu consumer operational, selama retention cukup.

---

## 19. Stream Failure Model

### 19.1 Producer Publish Unknown

Scenario:

```text
producer sends message
network timeout before confirm
producer does not know whether broker stored it
```

Mitigation:

- publisher confirms,
- producer-side deduplication,
- stable message id,
- outbox.

### 19.2 Consumer Processed But Offset Not Stored

Scenario:

```text
consumer reads offset 500
consumer updates DB
consumer crashes before storing offset
restart reads offset 500 again
```

Consequence:

```text
duplicate processing
```

Mitigation:

- idempotency table,
- offset stored in same DB transaction,
- upsert projection,
- aggregate version guard.

### 19.3 Offset Stored But Business Effect Not Committed

Scenario buruk:

```text
consumer stores offset 500
consumer crashes before DB update
restart starts from 501
business effect for 500 lost
```

Mitigation:

```text
Never store offset before durable business effect.
```

### 19.4 Consumer Falls Behind Retention

Scenario:

```text
retention = 24 hours
consumer down = 72 hours
consumer stored offset points to data already truncated
```

Consequence:

- consumer cannot resume from old offset,
- must rebuild from another source,
- data loss for that consumer.

Mitigation:

- retention > maximum recovery time objective,
- lag alerting,
- durable downstream checkpoints,
- backup source of truth,
- operational runbook.

### 19.5 Replay Causes Side Effects

Scenario:

```text
consumer replay starts from first
handler sends notifications again
```

Mitigation:

- side-effect guard,
- replay mode flag,
- projection-only replay consumers,
- idempotent external calls,
- sent-event table.

---

## 20. Stream Correctness Invariants

Untuk sistem production, tulis invariant eksplisit.

### 20.1 Producer Invariants

```text
P1. Every published event has stable messageId.
P2. Every event is immutable.
P3. Producer waits for confirm or records publish outcome as unknown.
P4. Retry publish uses same logical messageId.
P5. Event is published only after domain transaction commits, or via outbox relay.
P6. Producer identity and publishing id are stable if stream deduplication is used.
```

### 20.2 Consumer Invariants

```text
C1. Consumer can receive the same message more than once.
C2. Consumer stores progress only after business effect is durable.
C3. Consumer can resume from stored offset.
C4. Consumer lag must remain below retention safety window.
C5. Replay mode must not cause duplicate irreversible side effects.
C6. Consumer handles unknown/newer schema versions safely.
```

### 20.3 Retention Invariants

```text
R1. Retention must be longer than expected outage + recovery + investigation window.
R2. Retention capacity must include replication factor and headroom.
R3. Sensitive data retention must be approved by policy.
R4. Lag alerts must fire before data can be truncated under slow consumers.
```

### 20.4 Ordering Invariants

```text
O1. Do not depend on global order unless single stream and single producer constraints are explicit.
O2. Business ordering should be guarded by aggregate version or sequence.
O3. Partitioning key must match ordering key.
O4. Out-of-order or duplicate events must be detectable.
```

---

## 21. Designing A Regulatory Case Audit Stream

Misalnya kita punya enforcement lifecycle:

```text
CASE_OPENED
EVIDENCE_SUBMITTED
RISK_SCORE_CALCULATED
REVIEW_ASSIGNED
ENFORCEMENT_ACTION_PROPOSED
SUPERVISOR_APPROVAL_REQUIRED
CASE_ESCALATED
NOTICE_SENT
CASE_CLOSED
```

### 21.1 Requirements

- Semua lifecycle event harus bisa direkonstruksi.
- Projection bisa dibangun ulang.
- Investigator bisa melihat event timeline.
- Operational worker tetap memakai queue dengan retry/DLQ.
- Stream retention minimal 90 hari untuk replay cepat.
- Long-term immutable audit tetap disimpan di audit database/object storage.
- Sensitive evidence binary tidak disimpan di stream.

### 21.2 Topology

```text
exchange: case.events.topic

bindings:
  case.#              -> case.audit.stream       x-queue-type=stream
  case.review.*       -> case.review.work.q      x-queue-type=quorum
  case.notification.* -> case.notification.q     x-queue-type=quorum
  case.search.*       -> case.search.index.q     x-queue-type=quorum
```

### 21.3 Stream Message Example

```json
{
  "messageId": "evt-20260619-000001",
  "messageType": "case.enforcement_action.proposed.v1",
  "schemaVersion": 1,
  "aggregateType": "case",
  "aggregateId": "CASE-2026-000123",
  "aggregateVersion": 17,
  "correlationId": "corr-case-000123-review-session-9",
  "causationId": "cmd-propose-enforcement-action-44",
  "producer": "case-service",
  "occurredAt": "2026-06-19T10:12:11Z",
  "publishedAt": "2026-06-19T10:12:12Z",
  "tenantId": "regulator-id",
  "payload": {
    "actionType": "FORMAL_NOTICE",
    "proposedBy": "officer-871",
    "reasonCode": "REPEATED_NON_COMPLIANCE",
    "policyVersion": "ENFORCEMENT_POLICY_2026_06",
    "riskScoreSnapshotId": "risk-snapshot-991"
  }
}
```

### 21.4 Projection Rebuild

Projection consumer:

```text
consumer name: case-timeline-projection
stream: case.audit.stream
start: stored offset or first for rebuild
```

DB table:

```sql
CREATE TABLE case_timeline_projection (
  case_id VARCHAR(80) NOT NULL,
  aggregate_version BIGINT NOT NULL,
  message_id VARCHAR(120) NOT NULL,
  message_type VARCHAR(200) NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  payload_json JSONB NOT NULL,
  PRIMARY KEY (case_id, aggregate_version),
  UNIQUE (message_id)
);

CREATE TABLE stream_offsets (
  consumer_name VARCHAR(200) NOT NULL,
  stream_name VARCHAR(200) NOT NULL,
  offset_value BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (consumer_name, stream_name)
);
```

Transaction:

```text
begin
  if message_id already exists: skip safely
  insert timeline event
  update stream offset
commit
```

This gives:

- duplicate safety,
- restart safety,
- projection consistency,
- auditability.

---

## 22. Java-Oriented Mental Model

Part 17 akan masuk ke Stream Java Client detail. Part ini hanya memberi bentuk mental.

Pseudo-code consumer:

```java
handle(StreamMessage message, long offset) {
    transactionTemplate.execute(status -> {
        StreamOffset current = offsetRepository.get("case-timeline", "case.audit.stream");

        if (offset <= current.lastProcessedOffset()) {
            return null; // duplicate or replay overlap
        }

        CaseEventEnvelope event = decoder.decode(message.body());
        validator.validate(event);

        if (eventRepository.existsByMessageId(event.messageId())) {
            offsetRepository.update("case-timeline", "case.audit.stream", offset);
            return null;
        }

        projection.apply(event);
        eventRepository.insertProcessedMessage(event.messageId(), offset);
        offsetRepository.update("case-timeline", "case.audit.stream", offset);
        return null;
    });
}
```

Key idea:

```text
stream offset is part of application state if processing has durable side effects
```

---

## 23. Operational Metrics For Streams

Monitor minimal:

- publish rate,
- confirm latency,
- stream disk usage,
- retention utilization,
- consumer offset,
- consumer lag,
- consumer processing rate,
- oldest retained offset/timestamp,
- replica health,
- leader distribution,
- connection count,
- memory/disk alarms,
- stream segment growth,
- error/decode failure count.

Important alert:

```text
consumer lag time-to-retention < safety threshold
```

Example:

```text
retention = 7 days
consumer lag by timestamp = 6 days 12 hours
alert threshold = 5 days
```

This is not merely performance alert. It is data-loss prevention for that consumer.

---

## 24. Security and Compliance Considerations

Streams often retain data longer than queues. That changes risk.

Checklist:

- Is payload allowed to be retained in broker?
- Does stream contain PII?
- Does stream contain secrets?
- Does stream contain evidence metadata only or full evidence data?
- Who can read from offset `first`?
- Are vhost permissions separated?
- Are investigator/replay tools read-only?
- Is TLS enabled?
- Are credentials rotated?
- Is stream retention aligned with legal policy?
- Is deletion/retention policy documented?
- Is broker storage encrypted at rest by infrastructure layer?

Practical rule:

```text
The ability to replay is also the ability to re-expose old data.
```

---

## 25. Common Misconceptions

### Misconception 1: “Stream means exactly-once.”

No. Stream gives replay and offset semantics. Producer confirms/deduplication help, but consumers still need idempotency.

### Misconception 2: “Stream replaces DLQ.”

No. DLQ is about failed processing isolation. Stream is history. A consumer may still need error table, poison event handling, or separate failed-record workflow.

### Misconception 3: “If we have stream, we do not need database audit.”

Usually false. Broker retention is operational. Regulatory audit may require long-term storage, queryability, immutability policy, access control, and archival guarantees outside broker.

### Misconception 4: “Stream is always better than queue.”

No. If work must be processed once by a worker pool with DLQ/retry semantics, quorum queue may be better.

### Misconception 5: “Replay is safe by default.”

No. Replay can duplicate side effects unless consumer design prevents it.

### Misconception 6: “Offset stored means business state is correct.”

Only if offset storage and business state update are ordered/atomic enough for your correctness requirement.

### Misconception 7: “RabbitMQ Streams means we no longer need Kafka ever.”

No. RabbitMQ Streams and Kafka overlap in some use cases, but their ecosystems and operational sweet spots differ.

---

## 26. Design Decision Matrix

| Requirement | Better primitive |
|---|---|
| One worker should process each job | Quorum queue |
| Worker failure should redeliver job | Quorum queue |
| Need DLQ per service | Quorum queue + DLX |
| Need many services to receive same event independently | Topic exchange + queues, or stream |
| Need replay from beginning | Stream |
| Need projection rebuild | Stream |
| Need audit timeline | Stream + long-term audit DB |
| Need high-throughput sequential event feed | Stream |
| Need strict per-case order with scale | Super stream with caseId routing |
| Need Kafka ecosystem / stream processing platform | Kafka likely |
| Need routing by topic/header before storage | RabbitMQ exchange + queue/stream bindings |
| Need simple command handoff | Quorum queue |

---

## 27. Architecture Review Questions

Before using RabbitMQ Streams, answer these:

1. What is the stream’s business purpose?
2. Is it source of truth, transport history, audit copy, or projection source?
3. What is the retention requirement?
4. What happens if a consumer is behind retention?
5. How is consumer offset stored?
6. Is offset storage atomic with business state?
7. Is replay safe?
8. Which consumers are allowed to replay?
9. What is the message schema evolution plan?
10. What data must not be stored in the stream?
11. What is the partitioning/ordering key if using super stream?
12. What is the expected publish rate and message size?
13. What is the replication factor and storage capacity?
14. How are producer duplicates handled?
15. How are consumer duplicates handled?
16. What metrics and alerts protect retention safety?
17. Is a queue also needed for operational work?
18. What is the disaster recovery story?
19. What is the migration/replay procedure?
20. Why is RabbitMQ Streams preferable to Kafka or a database log for this use case?

---

## 28. Mini Lab — Conceptual Exercises

### Exercise 1: Queue or Stream?

Classify each use case:

1. Send email notification once.
2. Store every case status change for replay.
3. Rebuild search index.
4. Process uploaded evidence virus scan job.
5. Feed analytics with all risk score changes.
6. Assign case review task to one officer worker.
7. Generate compliance report from last 30 days events.

Expected answer:

| Use case | Primitive |
|---|---|
| Send email notification once | Quorum queue, with idempotency |
| Store status change history | Stream |
| Rebuild search index | Stream as source, projection consumer |
| Virus scan job | Quorum queue |
| Analytics feed | Stream |
| Assign review task | Quorum queue/workflow DB |
| Compliance report | Stream or audit DB, depending retention/query needs |

### Exercise 2: Retention Calculation

Given:

```text
2 million events/day
average event = 2 KB
retention = 30 days
replication factor = 3
overhead factor = 1.3
```

Calculate approximate storage:

```text
2,000,000 * 2KB * 30 * 3 * 1.3
= 468,000,000 KB
≈ 468 GB
```

Add operational headroom. Do not provision exactly 468 GB.

### Exercise 3: Replay Safety

Consumer reads `case.enforcement_action.proposed.v1` and sends email to company.

Question:

```text
Can this consumer safely replay from first?
```

Answer:

Not by default. It needs at least:

- sent notification idempotency table,
- replay mode that disables external sends,
- explicit operator-approved replay scope,
- stable notification id,
- audit log of notification attempts.

---

## 29. Part 16 Core Takeaways

1. RabbitMQ Streams are not just faster queues.
2. Queue means work delivery; stream means retained append-only history.
3. Stream consumption is non-destructive.
4. Offset replaces queue-style ack as the consumer progress concept.
5. Offset storage is a correctness decision.
6. Retention is mandatory and must be derived from recovery/audit requirements.
7. Replay is powerful but dangerous if consumers have side effects.
8. Stream message contracts must be long-lived and versioned.
9. Hybrid topology is often best: exchange routes events to both stream and queues.
10. RabbitMQ Streams overlap with Kafka but do not erase Kafka’s sweet spots.
11. Super streams provide partitioning, but ordering becomes per key/partition.
12. For regulatory systems, streams are excellent for audit/replay, but long-term audit often still belongs in dedicated durable storage.

---

## 30. What You Should Be Able To Explain After This Part

You should now be able to explain:

- why RabbitMQ Streams exist,
- how streams differ from classic/quorum queues,
- what non-destructive consumption means,
- what offset means,
- why offset storage is part of correctness,
- how retention affects consumer data safety,
- when to use Stream Protocol,
- why replay can be dangerous,
- why stream does not remove need for idempotency,
- how to design queue + stream hybrid topology,
- when RabbitMQ Streams are enough and when Kafka may be better,
- how streams fit an enforcement lifecycle/audit architecture.

---

## 31. Preview Part 17

Part 17 akan masuk ke:

```text
RabbitMQ Stream Java Client
```

Kita akan membahas:

- dependency dan setup,
- Environment,
- stream creation,
- producer,
- consumer,
- offset specification,
- offset tracking,
- confirm listener,
- deduplication,
- batching,
- flow control,
- graceful shutdown,
- Java production skeleton,
- integration testing.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-15.md">⬅️ Part 15 — Workflow, Saga, and Enforcement Lifecycle Modelling with RabbitMQ</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-17.md">Part 17 — RabbitMQ Stream Java Client ➡️</a>
</div>

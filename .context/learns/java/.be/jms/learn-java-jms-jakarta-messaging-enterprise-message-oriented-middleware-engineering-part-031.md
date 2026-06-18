# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-031

# Part 31 — JMS vs Kafka vs RabbitMQ vs AMQP vs Pulsar: Memilih Teknologi Berdasarkan Semantics

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Bagian: 31 dari 35  
> Target: Java 8 sampai Java 25  
> Fokus: decision framework untuk memilih messaging technology berdasarkan semantics, bukan popularitas

---

## 0. Tujuan Part Ini

Setelah mempelajari Part 31, kamu harus bisa menjawab pertanyaan yang sering terlihat sederhana tetapi sebenarnya sangat berbahaya:

> “Untuk sistem ini sebaiknya pakai JMS, Kafka, RabbitMQ, AMQP, atau Pulsar?”

Jawaban top 1% engineer bukan:

- “Kafka lebih modern.”
- “RabbitMQ lebih simple.”
- “JMS enterprise.”
- “Pulsar cloud-native.”
- “AMQP standard.”

Jawaban yang benar harus dimulai dari **semantics**:

- Apakah message harus hilang setelah diproses, atau harus disimpan untuk replay?
- Apakah consumer baru harus membaca data lama?
- Apakah unit paralelisme ditentukan oleh queue, partition, subscription, atau consumer group?
- Apakah ordering penting per entity, per partition, per queue, atau global?
- Apakah message adalah **command**, **event**, **fact log**, **work item**, **notification**, atau **data stream**?
- Apakah sistem membutuhkan **load distribution**, **fan-out**, **audit replay**, **stream processing**, atau **workflow coordination**?
- Apakah operational team siap mengelola broker stateful, log storage, retention, compaction, partitioning, replication, dan upgrade?

Part ini tidak bertujuan mengajarkan semua API Kafka/RabbitMQ/Pulsar secara detail. Tujuannya adalah memberi **decision model** yang kuat agar kamu tidak salah memilih tool untuk masalah yang salah.

---

## 1. Premis Utama: Messaging Technology Bukan Satu Kategori Tunggal

Banyak engineer menyebut semuanya sebagai “message broker”. Itu terlalu kasar.

Secara engineering, ada beberapa keluarga konsep:

| Keluarga | Mental Model | Contoh Teknologi |
|---|---|---|
| Message queue | Work item dikirim ke satu consumer | JMS Queue, RabbitMQ Queue, IBM MQ |
| Publish/subscribe broker | Message didistribusikan ke banyak subscriber | JMS Topic, RabbitMQ fanout/topic exchange, Pulsar topic subscription |
| Distributed commit log | Event disimpan sebagai log berurutan dan bisa dibaca ulang | Kafka, Pulsar persistent topic |
| Protocol | Wire-level contract antar client dan broker | AMQP 0-9-1, AMQP 1.0, MQTT, STOMP |
| Enterprise messaging API | Java abstraction untuk messaging provider | JMS / Jakarta Messaging |
| Stream platform | Log + consumer group + retention + processing ecosystem | Kafka, Pulsar |

Kesalahan umum adalah membandingkan hal yang berbeda level:

```text
JMS        = Java API/specification
AMQP       = protocol family
RabbitMQ   = broker/product, mainly AMQP 0-9-1 semantics
Kafka      = distributed log/event streaming platform
Pulsar     = messaging + streaming platform with topic/subscription model
IBM MQ     = enterprise messaging broker/product
Artemis    = broker supporting JMS/Jakarta Messaging and other protocols
```

Jadi pertanyaan “JMS vs Kafka” sebenarnya kurang presisi. Yang lebih presisi:

```text
Apakah workload ini lebih cocok memakai:
- JMS queue/topic di atas provider seperti Artemis/IBM MQ,
- Kafka topic partition + consumer group,
- RabbitMQ exchange/queue,
- Pulsar topic/subscription,
- atau protocol AMQP dengan broker tertentu?
```

---

## 2. Quick Semantic Map

Tabel ini bukan final answer, tetapi peta awal.

| Kebutuhan | Bias Teknologi yang Cocok | Alasan |
|---|---|---|
| Work queue untuk command processing | JMS Queue / RabbitMQ Queue / IBM MQ | Message biasanya diproses satu kali oleh satu worker |
| Enterprise app Java dengan app server/JTA/MDB | JMS / Jakarta Messaging | Integrasi container, transaction, resource adapter |
| Event stream dengan replay dan retention panjang | Kafka / Pulsar | Consumer dapat membaca ulang berdasarkan offset/subscription |
| Banyak independent consumer membaca stream yang sama | Kafka / Pulsar / JMS durable topic dalam scope terbatas | Kafka/Pulsar lebih natural untuk replay/retention besar |
| Routing fleksibel berdasarkan key/pattern/header | RabbitMQ / AMQP broker / JMS selector untuk kasus sederhana | Exchange/routing model kuat, selector terbatas dan provider-specific performance |
| High-throughput append-only event log | Kafka / Pulsar | Log partitioning dan retention adalah core design |
| Legacy enterprise integration | JMS / IBM MQ / ActiveMQ Artemis | Standard Java messaging, mature enterprise operations |
| Request/reply enterprise | JMS / IBM MQ / RabbitMQ | Correlation/reply queue pattern matang, meski harus hati-hati anti-pattern RPC |
| Stream processing ecosystem | Kafka | Ecosystem Kafka Streams, Connect, ksqlDB, Debezium kuat |
| Multi-tenant topic/subscription dengan separation kuat | Pulsar / Kafka dengan governance matang | Tergantung operational model dan tenancy requirement |

---

## 3. Jangan Pilih Berdasarkan Nama; Pilih Berdasarkan Message Semantics

Sebelum memilih teknologi, klasifikasikan payload-nya.

### 3.1 Command Message

Command adalah instruksi agar sistem melakukan sesuatu.

Contoh:

```json
{
  "messageType": "ApproveApplicationCommand",
  "applicationId": "APP-123",
  "requestedBy": "user-777"
}
```

Ciri command:

- memiliki intent;
- biasanya ditujukan ke owner capability tertentu;
- tidak semua service boleh memprosesnya;
- duplicate berbahaya jika handler tidak idempotent;
- biasanya cocok dengan queue/work distribution;
- ordering sering penting per aggregate/entity.

Teknologi yang sering cocok:

- JMS Queue;
- RabbitMQ Queue;
- IBM MQ;
- Artemis anycast queue;
- Kafka bisa dipakai, tetapi perlu hati-hati karena Kafka adalah log, bukan command queue tradisional.

### 3.2 Domain Event

Domain event adalah fakta internal dari bounded context.

Contoh:

```json
{
  "messageType": "ApplicationApproved",
  "applicationId": "APP-123",
  "approvedAt": "2026-06-18T10:15:00Z"
}
```

Ciri domain event:

- menyatakan sesuatu sudah terjadi;
- tidak memerintah consumer;
- dapat digunakan untuk audit, projection, notification, integration;
- bisa memiliki banyak consumer;
- sering butuh replay untuk membangun projection ulang.

Teknologi yang sering cocok:

- Kafka;
- Pulsar;
- JMS durable topic untuk skala lebih kecil/enterprise integration;
- RabbitMQ publish/subscribe untuk notification/fan-out, tetapi bukan pilihan utama jika replay panjang menjadi requirement.

### 3.3 Integration Event

Integration event adalah event yang sengaja dipublikasikan untuk sistem lain.

Ciri:

- kontraknya lebih stabil daripada domain event internal;
- schema evolution penting;
- consumer berada di luar bounded context;
- governance penting;
- replay bisa penting untuk downstream recovery.

Bias teknologi:

- Kafka/Pulsar bila replay dan banyak downstream consumer penting;
- JMS Topic bila environment enterprise Java dan retention/replay terbatas;
- RabbitMQ bila routing/fan-out sederhana dan replay bukan kebutuhan utama.

### 3.4 Work Item

Work item adalah unit pekerjaan yang perlu diselesaikan worker.

Contoh:

```json
{
  "messageType": "GeneratePdfWorkItem",
  "documentId": "DOC-999"
}
```

Ciri:

- satu item idealnya diproses oleh satu worker;
- jika worker crash, item perlu kembali;
- retry/DLQ penting;
- backlog merepresentasikan pekerjaan tertunda;
- retention panjang biasanya tidak penting setelah selesai.

Bias teknologi:

- JMS Queue;
- RabbitMQ Queue;
- IBM MQ;
- Artemis;
- Kafka hanya jika kamu sengaja memodelkan work item sebagai stream dengan offset dan consumer group.

### 3.5 Data Stream / Fact Log

Data stream adalah aliran fakta/time-series/activity yang disimpan sebagai log.

Ciri:

- volume tinggi;
- retention eksplisit;
- replay natural;
- consumer group independen;
- partitioning menjadi bagian desain;
- stream processing sering dibutuhkan.

Bias teknologi:

- Kafka;
- Pulsar;
- bukan JMS tradisional.

---

## 4. JMS / Jakarta Messaging: Kapan Cocok?

Jakarta Messaging adalah API standard untuk Java program agar dapat membuat, mengirim, menerima, dan membaca message dari enterprise messaging system. Secara historis JMS menyediakan model queue dan topic; Jakarta Messaging meneruskan model tersebut dengan namespace modern `jakarta.jms`.

### 4.1 Strength JMS

JMS sangat kuat ketika requirement-mu seperti ini:

1. **Aplikasi Java enterprise**

   Kamu bekerja di Jakarta EE, Spring, Quarkus, atau runtime enterprise yang punya integrasi messaging matang.

2. **Command/work queue semantics**

   Message harus diproses satu worker, selesai, lalu tidak perlu terus tersedia sebagai log jangka panjang.

3. **Transaction-aware messaging**

   Kamu butuh local JMS transaction, JTA integration, MDB, resource adapter, atau container-managed transaction.

4. **Enterprise integration maturity**

   JMS sudah lama dipakai di bank, government, insurance, telco, regulated systems.

5. **Provider abstraction**

   Kamu ingin kode Java memakai API relatif standard, meskipun operational behavior tetap provider-specific.

6. **Request/reply dan workflow command**

   JMS punya header/correlation/reply-to yang natural untuk pattern request/reply, walaupun tetap harus hati-hati agar tidak menjadi distributed RPC yang rapuh.

### 4.2 Weakness JMS

JMS kurang ideal jika requirement utama adalah:

- replay event jangka panjang;
- log compaction;
- stream processing large-scale;
- consumer offset sebagai first-class concept;
- fan-out puluhan/ratusan consumer independen dengan retention besar;
- analytics pipeline;
- event sourcing log sebagai source of truth;
- ecosystem data streaming seperti connector/CDC/stream table join.

### 4.3 Mental Model JMS

```text
JMS Queue:
producer -> queue -> one consumer instance processes a message

JMS Topic:
publisher -> topic -> multiple subscribers may receive a copy
```

JMS berpikir dalam model **message delivery**.

Kafka/Pulsar lebih banyak berpikir dalam model **message log consumption**.

Itu perbedaan besar.

---

## 5. Kafka: Kapan Cocok?

Kafka adalah distributed event streaming platform. Core mental model-nya adalah **append-only partitioned log**.

### 5.1 Kafka Strength

Kafka kuat ketika requirement-mu seperti ini:

1. **Replayable event log**

   Consumer bisa membaca ulang data dari offset tertentu selama data masih dalam retention.

2. **Consumer group**

   Banyak instance dalam satu group membagi partition. Banyak group berbeda bisa membaca topic yang sama secara independen.

3. **High throughput**

   Kafka didesain untuk throughput tinggi melalui partitioning, sequential I/O, batching, dan pull-based consumption.

4. **Retention-based storage**

   Message tidak hilang hanya karena sudah dikonsumsi. Retention dikontrol oleh time/size/compaction policy.

5. **Ecosystem data pipeline**

   Kafka Connect, Debezium, Schema Registry, stream processing, ksqlDB/Kafka Streams, observability pipeline.

6. **Event-driven architecture skala besar**

   Banyak service bisa consume event yang sama tanpa producer tahu siapa consumer-nya.

### 5.2 Kafka Weakness

Kafka bukan default terbaik untuk semua messaging.

Kurang cocok jika:

- kamu butuh simple command queue semantics;
- kamu butuh priority queue;
- kamu butuh per-message arbitrary delay scheduling seperti broker queue tradisional;
- kamu butuh broker-side selective routing yang kaya seperti RabbitMQ exchange;
- kamu tidak siap mendesain partition key dengan benar;
- kamu tidak butuh replay, retention, atau stream processing;
- consumer count harus lebih besar dari jumlah partition untuk satu consumer group tanpa redesign.

### 5.3 Kafka Ordering

Kafka memberi ordering dalam partition, bukan global topic.

```text
Topic ApplicationEvents
  Partition 0: APP-1 events ordered
  Partition 1: APP-2 events ordered
  Partition 2: APP-3 events ordered
```

Jika semua event untuk `applicationId=APP-123` masuk partition yang sama, ordering per application bisa dijaga.

Jika partition key salah, ordering rusak secara desain.

### 5.4 Kafka sebagai Command Queue?

Bisa, tetapi harus sadar trade-off.

Kafka consumer group dapat mendistribusikan message ke worker. Namun:

- message tetap berada di log sampai retention habis;
- retry per message tidak senatural queue broker;
- poison message bisa menahan partition jika ordering ketat;
- delayed retry biasanya butuh retry topic;
- DLQ biasanya topic terpisah;
- parallelism dibatasi jumlah partition dalam group;
- rebalancing mempengaruhi consumer assignment.

Jadi Kafka cocok untuk command processing bila kamu sengaja menerima model:

```text
command stream + offset + partition ownership + retry topics + idempotent handler
```

Bukan bila kamu hanya ingin “queue sederhana”.

---

## 6. RabbitMQ dan AMQP: Kapan Cocok?

RabbitMQ adalah broker yang sangat kuat untuk queueing/routing. Ia terkenal dengan AMQP 0-9-1 model: producer mengirim ke exchange, exchange merutekan ke queue berdasarkan binding.

### 6.1 RabbitMQ Strength

RabbitMQ kuat ketika requirement-mu seperti ini:

1. **Flexible routing**

   Direct exchange, topic exchange, fanout exchange, headers exchange.

2. **Work queue**

   Competing consumers, ack/nack, prefetch, DLQ, TTL, dead-letter exchange.

3. **Low-latency operational messaging**

   Banyak workload command/notification cocok.

4. **Protocol/ecosystem luas**

   AMQP, MQTT, STOMP, plugins, management UI.

5. **Simple mental model untuk banyak tim**

   Queue/exchange/binding sering lebih mudah dipahami daripada partitioned log.

### 6.2 RabbitMQ Weakness

RabbitMQ kurang ideal jika requirement utamanya:

- replay event jangka panjang;
- event log sebagai source of truth;
- high-volume analytical stream;
- consumer offset independen dalam jumlah besar;
- storage retention model seperti Kafka/Pulsar;
- stream processing ecosystem yang luas.

RabbitMQ punya fitur stream, tetapi ketika membandingkan mainstream semantics, Kafka/Pulsar lebih natural untuk platform streaming besar.

### 6.3 AMQP Bukan RabbitMQ Saja

AMQP adalah protocol/spec family, bukan produk.

Ada perbedaan besar:

```text
AMQP 0-9-1 -> umum diasosiasikan dengan RabbitMQ exchange/queue model
AMQP 1.0   -> protocol berbeda, digunakan di beberapa enterprise/cloud broker
```

Jangan menyamakan:

```text
AMQP == RabbitMQ
```

Yang benar:

```text
RabbitMQ mendukung AMQP 0-9-1 sebagai protocol utama.
Broker lain dapat mendukung AMQP 1.0 dengan semantics berbeda.
```

### 6.4 RabbitMQ vs JMS

RabbitMQ bukan JMS broker native dalam sense standard JMS semantics, tetapi ada JMS client/facade tertentu. Kalau aplikasi Java butuh pure JMS portability, provider seperti ActiveMQ Artemis/IBM MQ lebih natural.

Kalau aplikasi butuh routing exchange yang kaya dan tidak harus JMS API, RabbitMQ lebih natural.

---

## 7. Pulsar: Kapan Cocok?

Apache Pulsar adalah platform messaging dan streaming. Ia menggabungkan beberapa sifat queue/pub-sub/log dengan model topic dan subscription.

### 7.1 Pulsar Strength

Pulsar kuat ketika requirement-mu seperti ini:

1. **Messaging + streaming dalam satu platform**

   Pulsar dapat melayani queue-like subscription dan stream-like retention.

2. **Subscription model fleksibel**

   Exclusive, shared, failover, key_shared.

3. **Multi-tenancy sebagai first-class concept**

   Tenant/namespace/topic adalah konsep penting di Pulsar.

4. **Storage terpisah dari serving layer**

   Pulsar menggunakan arsitektur broker + BookKeeper untuk persistent storage.

5. **Geo-replication / cloud-native design**

   Banyak deployment Pulsar dipilih karena fitur multi-tenancy dan geo-replication.

6. **Per-message acknowledgment**

   Pulsar subscription model memungkinkan ack per message dalam beberapa mode, berbeda dari Kafka offset sequential per partition.

### 7.2 Pulsar Weakness

Pulsar kurang cocok jika:

- tim belum siap operational complexity broker + BookKeeper;
- ecosystem Kafka sudah menjadi standar organisasi;
- use case sederhana cukup dengan JMS/RabbitMQ;
- workload membutuhkan compatibility dengan library Kafka ecosystem yang luas;
- platform team belum matang untuk multi-component distributed storage.

### 7.3 Pulsar sebagai Middle Ground?

Pulsar sering terlihat seperti gabungan:

```text
Queue-like subscription + stream retention + multi-tenant namespace + distributed storage
```

Tetapi “bisa melakukan banyak hal” bukan berarti selalu pilihan terbaik. Operational complexity harus dihitung.

---

## 8. Perbandingan Core Semantics

## 8.1 Consumption Model

| Teknologi | Consumption Model |
|---|---|
| JMS Queue | Message dikirim ke satu consumer dari queue |
| JMS Topic | Message dikirim ke subscriber; durable subscriber bisa menerima saat offline sesuai provider config |
| Kafka | Consumer group membaca partition berdasarkan offset |
| RabbitMQ | Queue deliver ke consumer; ack/nack menentukan completion |
| Pulsar | Consumer membaca topic via subscription; mode subscription menentukan distribusi |

### Rule of Thumb

Jika kamu berpikir:

```text
Saya punya pekerjaan yang harus diselesaikan oleh salah satu worker.
```

Mulai dari JMS/RabbitMQ.

Jika kamu berpikir:

```text
Saya punya stream fakta yang perlu dibaca banyak consumer dan bisa diulang.
```

Mulai dari Kafka/Pulsar.

---

## 8.2 Retention and Replay

| Teknologi | Retention Natural? | Replay Natural? |
|---|---:|---:|
| JMS Queue | Tidak, message selesai setelah ack | Tidak natural |
| JMS Topic durable | Terbatas, untuk subscriber durability | Terbatas |
| Kafka | Ya | Ya |
| RabbitMQ classic queue | Tidak untuk replay log jangka panjang | Tidak natural |
| Pulsar | Ya, tergantung retention/subscription | Ya |

### Mental Model

Queue broker:

```text
message lifecycle = waiting -> delivered -> acknowledged -> removed
```

Log broker:

```text
message lifecycle = appended -> retained -> consumed by many offsets/subscriptions -> deleted by retention policy
```

Inilah perbedaan paling penting.

---

## 8.3 Ordering

| Teknologi | Ordering Unit |
|---|---|
| JMS Queue | Queue/session/provider dispatch; concurrency dapat mengubah effective ordering |
| Kafka | Partition |
| RabbitMQ Queue | Queue FIFO ideal, tetapi priority/redelivery/multiple consumers dapat mempengaruhi effective order |
| Pulsar | Topic partition/key/shared subscription mode mempengaruhi ordering |

### Heuristik Ordering

Top 1% engineer tidak bertanya:

> “Apakah teknologi ini menjamin ordering?”

Mereka bertanya:

> “Ordering untuk entity apa, dalam boundary apa, saat redelivery/rollback/failover bagaimana, dan apakah parallelism masih mungkin?”

---

## 8.4 Parallelism

| Teknologi | Unit Paralelisme |
|---|---|
| JMS Queue | jumlah consumer/session/thread, tergantung broker dispatch |
| Kafka | jumlah partition per consumer group |
| RabbitMQ | jumlah consumer + prefetch + queue topology |
| Pulsar | subscription mode + partition/key_shared + consumer count |

### Kafka Parallelism Trap

Jika topic punya 6 partition, satu consumer group tidak bisa memproses lebih dari 6 partition secara aktif sekaligus. Menambah consumer ke-7 tidak memberi parallelism tambahan untuk group itu.

### JMS/RabbitMQ Parallelism Trap

Menambah consumer bisa meningkatkan throughput, tetapi bisa menghancurkan ordering dan memperparah downstream bottleneck.

---

## 8.5 Retry and DLQ

| Teknologi | Retry/DLQ Natural? | Catatan |
|---|---:|---|
| JMS | Ya | Redelivery/DLQ provider-specific tapi umum |
| RabbitMQ | Ya | TTL + DLX + nack/requeue pattern umum |
| Kafka | Tidak senatural queue | Biasanya retry topic/DLQ topic |
| Pulsar | Ada support redelivery/DLQ | Subscription semantics penting |

### Rule of Thumb

Jika retry per message dan DLQ triage operator adalah core workflow, JMS/RabbitMQ sering lebih langsung.

Jika replay stream dan consumer rebuild adalah core workflow, Kafka/Pulsar lebih langsung.

---

## 8.6 Transactions

| Teknologi | Transaction Semantics |
|---|---|
| JMS | Local transaction, JTA/XA tergantung provider/runtime |
| Kafka | Producer transaction, idempotent producer, exactly-once semantics dalam batas Kafka pipeline tertentu |
| RabbitMQ | Publisher confirms lebih umum daripada transaction untuk throughput; ack/nack consumer |
| Pulsar | Transaction support ada, tetapi operational/adoption detail perlu dicek sesuai versi/provider |

### Peringatan

Tidak ada teknologi yang otomatis memberi “exactly-once business effect” end-to-end.

Business exactly-once membutuhkan:

- idempotent handler;
- dedup/inbox;
- unique constraint;
- state transition guard;
- outbox untuk publish;
- replay-safe side effects;
- observability.

---

## 9. Decision Framework: 12 Pertanyaan yang Harus Dijawab Sebelum Memilih

### Pertanyaan 1 — Apakah message adalah command atau event?

Jika command:

- satu owner;
- satu handler utama;
- retry/DLQ penting;
- queue semantics kuat.

Bias: JMS/RabbitMQ/IBM MQ.

Jika event:

- banyak consumer;
- producer tidak tahu consumer;
- replay mungkin penting;
- schema evolution penting.

Bias: Kafka/Pulsar/JMS Topic untuk enterprise scale terbatas.

---

### Pertanyaan 2 — Apakah message perlu replay?

Jika tidak:

- queue broker cukup;
- jangan bayar complexity Kafka/Pulsar tanpa benefit.

Jika ya:

- Kafka/Pulsar lebih natural;
- desain retention, compaction, partition key, schema registry.

---

### Pertanyaan 3 — Apakah consumer baru perlu membaca historical data?

Jika ya, JMS queue bukan model yang benar.

Pilih log/stream.

---

### Pertanyaan 4 — Apakah banyak consumer independen perlu membaca data yang sama?

Jika hanya fan-out notification ringan:

- JMS Topic / RabbitMQ fanout/topic exchange bisa cukup.

Jika consumer independent dengan offset/replay masing-masing:

- Kafka/Pulsar lebih natural.

---

### Pertanyaan 5 — Apa ordering boundary?

Jawaban buruk:

```text
Butuh ordering.
```

Jawaban baik:

```text
Butuh ordering per applicationId, tetapi tidak butuh global ordering antar application.
```

Jika ordering per aggregate:

- Kafka partition key = aggregate id;
- Pulsar key_shared bisa dipertimbangkan;
- JMS message group bisa dipertimbangkan;
- RabbitMQ queue per shard/key bisa dipertimbangkan.

---

### Pertanyaan 6 — Apakah retry harus menahan ordering?

Misalnya:

```text
APP-123 event #5 gagal.
Apakah APP-123 event #6 boleh diproses dulu?
```

Jika tidak boleh:

- desain per-entity sequential processing;
- poison message bisa menahan entity;
- perlu repair/parking lot.

Jika boleh:

- throughput lebih mudah;
- consistency model lebih longgar.

---

### Pertanyaan 7 — Apakah routing kompleks?

Jika routing berdasarkan topic/key/header sangat kompleks:

- RabbitMQ exchange/routing bagus;
- JMS selector mungkin cukup untuk filter sederhana;
- Kafka routing biasanya dilakukan oleh topic/partition key atau consumer-side filtering;
- Pulsar namespace/topic/subscription design perlu dirancang.

---

### Pertanyaan 8 — Apakah workload lebih latency-sensitive atau throughput-sensitive?

Latency-sensitive command:

- JMS/RabbitMQ sering cocok.

Throughput-heavy event stream:

- Kafka/Pulsar sering cocok.

Tapi ini bukan hukum mutlak; tuning dan deployment jauh lebih menentukan.

---

### Pertanyaan 9 — Apakah operational team siap?

Kafka/Pulsar bukan hanya library. Mereka adalah platform.

Pertimbangkan:

- cluster sizing;
- retention storage;
- partition planning;
- broker upgrade;
- rebalance;
- schema governance;
- monitoring lag;
- security ACL;
- disaster recovery;
- backup/restore expectation.

Queue broker juga butuh operasi serius, tetapi complexity-nya berbeda.

---

### Pertanyaan 10 — Apakah kamu butuh Java enterprise integration?

Jika aplikasi menggunakan:

- Jakarta EE;
- MDB;
- JTA;
- resource adapter;
- app server managed connection;
- legacy enterprise integration;

JMS/Jakarta Messaging sering paling natural.

---

### Pertanyaan 11 — Apakah kamu butuh ecosystem data platform?

Jika butuh:

- CDC dari database;
- stream processing;
- lake ingestion;
- analytics pipeline;
- schema registry;
- connector ecosystem;

Kafka biasanya paling kuat secara ecosystem.

Pulsar juga punya ecosystem, tetapi Kafka masih sangat dominan dalam banyak organisasi.

---

### Pertanyaan 12 — Apa failure mode paling mahal?

Setiap pilihan mengoptimalkan failure mode berbeda.

| Failure yang Paling Mahal | Bias Solusi |
|---|---|
| Work item hilang | Durable queue + ack + DLQ |
| Event tidak bisa replay | Kafka/Pulsar retention |
| Duplicate menyebabkan side effect | Idempotency/inbox, bukan hanya broker choice |
| Consumer lambat | Backpressure + scaling + lag monitoring |
| Poison message menahan queue | DLQ/parking lot |
| Schema mismatch | Contract governance/schema registry |
| Broker disk penuh | Retention/paging/quota/storage monitoring |

---

## 10. Architecture Examples

## 10.1 Case 1 — Email Notification Worker

Requirement:

- user action menghasilkan email;
- worker mengirim email;
- jika SMTP down, retry;
- jika invalid address, DLQ;
- replay semua email 6 bulan lalu tidak dibutuhkan.

Pilihan natural:

```text
JMS Queue / RabbitMQ Queue
```

Model:

```text
Application Service -> email.command.queue -> Email Worker -> SMTP
                                      -> DLQ if permanent failure
```

Kafka bisa dipakai, tetapi biasanya overkill jika hanya work queue.

---

## 10.2 Case 2 — Application Status Event untuk Banyak Downstream

Requirement:

- setiap perubahan status application harus dipublikasikan;
- reporting, notification, audit projection, SLA engine membaca event;
- service baru tahun depan perlu bootstrap dari event lama;
- event volume tinggi;
- replay penting.

Pilihan natural:

```text
Kafka / Pulsar
```

Model:

```text
Case Service -> outbox -> event log topic application-status-events
                         -> Reporting Consumer Group
                         -> SLA Consumer Group
                         -> Notification Consumer Group
                         -> Audit Projection Consumer Group
```

JMS Topic bisa untuk fan-out, tetapi replay/retention consumer independen lebih natural di Kafka/Pulsar.

---

## 10.3 Case 3 — Enterprise App Server dengan MDB dan Oracle Transaction

Requirement:

- Jakarta EE application;
- MDB consumes queue;
- database update dan message ack harus berada dalam transaction boundary yang jelas;
- ops sudah punya app server dan IBM MQ/Artemis;
- regulated enterprise environment.

Pilihan natural:

```text
JMS / Jakarta Messaging with app server runtime
```

Model:

```text
Broker Queue -> MDB -> Container Managed Transaction -> Database
```

Kafka tidak mustahil, tetapi tidak natural untuk MDB/JTA container integration.

---

## 10.4 Case 4 — Dynamic Routing Berdasarkan Message Type dan Region

Requirement:

- producer publish satu message;
- routing berdasarkan `region`, `messageType`, `priority`;
- beberapa queue menerima subset;
- replay panjang tidak penting;
- routing rule sering berubah.

Pilihan natural:

```text
RabbitMQ exchange/binding
```

Model:

```text
Producer -> topic exchange events
             routing key: sg.case.approved
          -> queue.case.sg
          -> queue.audit.all
          -> queue.notification.sg
```

JMS selector bisa dipakai, tetapi untuk routing topology kaya, RabbitMQ exchange model sering lebih ekspresif.

---

## 10.5 Case 5 — High-Volume Telemetry Stream

Requirement:

- jutaan event telemetry;
- consumer analytics;
- retention 7 hari;
- replay dari offset;
- stream processing;
- partition per device/customer.

Pilihan natural:

```text
Kafka / Pulsar
```

Queue broker tradisional biasanya bukan model ideal.

---

## 11. Common Anti-Patterns

## 11.1 “Kafka untuk Semua Hal”

Kafka sangat kuat, tetapi bukan queue universal.

Gejala anti-pattern:

- butuh retry per message sederhana tetapi malah membuat 5 retry topics;
- butuh priority queue tetapi memaksa topic berbeda;
- butuh RPC tetapi membuat synchronous wait di atas Kafka;
- workload kecil tetapi membawa platform besar;
- partition key tidak dipahami;
- semua event dimasukkan ke satu topic raksasa tanpa governance.

### Koreksi

Gunakan Kafka ketika log/replay/stream semantics memang memberi nilai.

---

## 11.2 “JMS untuk Event Sourcing”

JMS bukan event store.

Gejala:

- durable topic dianggap sama dengan event log;
- consumer baru diharapkan bisa baca semua historical event;
- DLQ dipakai sebagai audit store;
- queue dipakai sebagai database sementara;
- message retention tidak didefinisikan.

### Koreksi

Jika event history adalah source of truth, gunakan event store/log yang memang didesain untuk retention/replay.

---

## 11.3 “RabbitMQ sebagai Kafka Murah”

RabbitMQ kuat untuk routing dan queueing, tetapi tidak otomatis menjadi distributed replay log.

Gejala:

- queue dibiarkan tumbuh menjadi storage historis;
- consumer offline lama lalu backlog sangat besar;
- replay manual dari queue;
- memory/disk alarm sering terjadi;
- queue dipakai sebagai long-term data lake.

### Koreksi

Gunakan RabbitMQ untuk routing/work delivery. Gunakan Kafka/Pulsar untuk retention/replay stream.

---

## 11.4 “Pulsar karena Bisa Semuanya”

Pulsar fleksibel, tetapi operational complexity-nya nyata.

Gejala:

- tim belum memahami broker/bookie/metadata store;
- monitoring belum siap;
- multi-tenancy dipakai tanpa governance;
- subscription mode dipilih sembarangan;
- storage growth tidak dikontrol.

### Koreksi

Pilih Pulsar jika fitur messaging+streaming+multi-tenancy benar-benar dibutuhkan dan platform team siap.

---

## 11.5 “Protocol = Semantics”

AMQP, MQTT, STOMP, HTTP bukan langsung berarti behavior end-to-end sama.

Protocol mendefinisikan cara client bicara dengan broker. Tetapi:

- broker storage;
- ack semantics;
- routing;
- retention;
- transaction;
- clustering;
- DLQ;
- failover;

semuanya tetap dipengaruhi implementasi provider.

---

## 12. Decision Matrix Mendalam

| Dimension | JMS | Kafka | RabbitMQ/AMQP | Pulsar |
|---|---|---|---|---|
| Primary mental model | Enterprise message delivery | Partitioned event log | Exchange/queue routing | Topic/subscription messaging+streaming |
| Java enterprise integration | Sangat kuat | Tidak native JMS | Bisa via client/facade, bukan core JMS | Ada client Java, JMS compatibility tergantung project/provider |
| Work queue | Kuat | Bisa, tapi tidak natural | Sangat kuat | Bisa |
| Replay | Lemah/terbatas | Sangat kuat | Lemah untuk classic queue | Kuat |
| Routing flexibility | Sedang via destinations/selectors | Topic/partition key oriented | Sangat kuat | Namespace/topic/subscription oriented |
| Consumer group | Tidak seperti Kafka | First-class | Competing consumer per queue | Subscription modes |
| Ordering | Queue/session/message group/provider-specific | Per partition | Queue-level with caveats | Tergantung subscription/partition/key |
| Retry/DLQ | Kuat | Perlu pattern retry topic | Kuat | Kuat, tergantung feature/config |
| Long retention | Bukan core | Core | Bukan classic core | Core |
| Stream processing | Tidak core | Sangat kuat | Terbatas | Ada ecosystem |
| Operational complexity | Medium-high tergantung broker | High | Medium | High |
| Best fit | Enterprise command/integration | Event streaming/log/replay | Routing/work queue | Multi-tenant messaging+streaming |

---

## 13. Mapping ke Java 8–25

## 13.1 Java 8

Java 8 sering berada di legacy enterprise environment.

Pilihan realistis:

- JMS 1.1 / JMS 2.0 dengan `javax.jms`;
- app server legacy;
- ActiveMQ Classic/Artemis versi compatible;
- IBM MQ JMS;
- Spring Framework legacy;
- Kafka client masih bisa, tetapi versi modern punya baseline Java berbeda;
- RabbitMQ Java client umumnya compatible untuk banyak versi, tetapi cek baseline library.

Perhatian:

- jangan mencampur `javax.jms` dan `jakarta.jms`;
- dependency conflict sering terjadi;
- classpath hell lebih mungkin;
- TLS/cipher/security baseline harus diperhatikan.

## 13.2 Java 11/17

Java 11/17 adalah transisi modern enterprise.

Pilihan:

- Spring Boot 2.x biasanya masih `javax.jms`;
- Spring Boot 3.x pindah ke Jakarta namespace dan butuh Java 17 baseline;
- Jakarta EE 9+ memakai `jakarta.*`;
- Kafka/RabbitMQ/Pulsar client modern lebih nyaman.

## 13.3 Java 21/25

Java 21/25 membuka pertanyaan baru:

- virtual threads;
- modern GC;
- stronger TLS/security defaults;
- better container awareness;
- structured concurrency sebagai desain aplikasi, meskipun JMS listener container tetap punya threading model sendiri.

Namun jangan salah:

> Virtual threads tidak mengubah broker semantics.

Virtual threads dapat membantu blocking I/O client code tertentu, tetapi:

- JMS `Session` tetap bukan bebas dipakai concurrent sembarangan;
- listener container tetap punya lifecycle;
- ack/transaction boundary tetap harus benar;
- broker backpressure tetap harus dihormati.

---

## 14. Heuristik Top 1%: Pilih Berdasarkan “Invariant yang Harus Dijaga”

Teknologi bukan dipilih dari fitur terbanyak, tetapi dari invariant sistem.

### 14.1 Jika Invariant-nya “setiap pekerjaan diproses satu kali secara efektif”

Gunakan:

- JMS Queue;
- RabbitMQ Queue;
- IBM MQ;
- Artemis.

Tambahkan:

- idempotency;
- DLQ;
- retry policy;
- consumer concurrency control;
- dedup jika perlu.

### 14.2 Jika Invariant-nya “setiap event harus bisa direplay oleh consumer independen”

Gunakan:

- Kafka;
- Pulsar.

Tambahkan:

- retention policy;
- schema registry;
- partition key strategy;
- consumer lag monitoring;
- replay runbook;
- compaction strategy jika perlu.

### 14.3 Jika Invariant-nya “routing harus fleksibel dan cepat berubah”

Gunakan:

- RabbitMQ exchange model;
- AMQP broker dengan routing kuat;
- JMS selector hanya untuk filter sederhana.

Tambahkan:

- routing governance;
- binding audit;
- unroutable message handling;
- DLX.

### 14.4 Jika Invariant-nya “enterprise transaction integration lebih penting daripada replay”

Gunakan:

- JMS/Jakarta Messaging;
- app server resource adapter;
- MDB/container-managed transaction;
- JTA/XA hanya jika benar-benar dibutuhkan.

Tambahkan:

- outbox/inbox sebagai alternatif XA;
- transaction timeout monitoring;
- poison message isolation.

---

## 15. Practical Selection Recipes

## 15.1 Internal Async Command Processing

```text
Default: JMS Queue / RabbitMQ Queue
Use Kafka only if command history/replay/stream processing matters.
```

## 15.2 Cross-Service Integration Event

```text
Default: Kafka / Pulsar
Use JMS Topic only if enterprise environment small/controlled and replay retention is not central.
```

## 15.3 Legacy Enterprise Integration

```text
Default: JMS / IBM MQ / Artemis
Avoid forcing Kafka into app-server transaction workflows unless organization has mature Kafka integration pattern.
```

## 15.4 Notification Fan-Out

```text
Small fan-out: JMS Topic / RabbitMQ fanout/topic exchange
Large replayable fan-out: Kafka / Pulsar
```

## 15.5 Workflow/Saga Command Bus

```text
Command queue: JMS/RabbitMQ
Saga events: Kafka/Pulsar/JMS Topic depending replay needs
Do not mix command and event semantics in the same topic/queue without envelope discipline.
```

## 15.6 Audit/Event History

```text
Use durable database/audit store or event log.
Do not rely on queue backlog as audit source.
```

---

## 16. Failure Mode Comparison

## 16.1 Consumer Crash After Side Effect

Scenario:

```text
Consumer receives message.
Consumer updates database.
Consumer crashes before ack/offset commit.
```

Result by family:

- JMS/RabbitMQ: message redelivered;
- Kafka: offset not committed, message reprocessed;
- Pulsar: unacked message redelivered.

Conclusion:

```text
All major technologies can duplicate business effects.
Idempotency is mandatory.
```

## 16.2 Poison Message

Scenario:

```text
One message always fails due to bad schema/business state.
```

JMS/RabbitMQ:

- redelivery count;
- DLQ;
- parking lot.

Kafka:

- can block partition if consumer stops at failed record;
- common pattern: retry topic / DLQ topic / skip with audit.

Pulsar:

- negative ack/redelivery/DLQ depending config.

Conclusion:

```text
Queue brokers usually provide more direct poison-message workflow.
Log brokers need explicit failure topic strategy.
```

## 16.3 Consumer Offline for 3 Days

JMS Queue:

- backlog grows;
- messages wait;
- broker storage pressure.

JMS Topic non-durable:

- missed messages.

JMS Topic durable:

- retained for subscriber, subject to provider limits/config.

Kafka/Pulsar:

- data retained by retention/subscription policy;
- consumer can catch up if data not expired.

Conclusion:

```text
If offline consumer catch-up is a core requirement, choose retention-aware stream/log technology.
```

## 16.4 Need to Rebuild Projection from 6 Months of Events

JMS/RabbitMQ classic queue:

- not natural;
- likely impossible unless data stored elsewhere.

Kafka/Pulsar:

- natural if retention covers 6 months.

Conclusion:

```text
Replay requirement must be decided before choosing technology.
```

---

## 17. Design Smells Checklist

Hati-hati jika kamu melihat ini:

- “Kita pakai Kafka karena semua orang pakai Kafka.”
- “Queue backlog kita anggap audit trail.”
- “Topic ini berisi command dan event campur.”
- “Consumer baru harus baca event lama, tapi retention tidak didefinisikan.”
- “Ordering global wajib, tapi throughput tinggi juga wajib.”
- “Kita tidak punya partition key strategy.”
- “Kita tidak tahu DLQ replay policy.”
- “Retry infinite sampai sukses.”
- “Semua consumer pakai selector kompleks.”
- “Tidak ada idempotency karena broker katanya exactly-once.”
- “Message schema bisa berubah bebas karena JSON flexible.”
- “Tidak ada owner untuk topic/queue.”
- “Tidak ada runbook saat broker disk full.”

---

## 18. Reference Architecture: Hybrid yang Sering Paling Realistis

Di sistem enterprise besar, jawabannya sering bukan satu teknologi.

Contoh arsitektur realistis:

```text
                         +----------------+
                         | Case Service   |
                         +-------+--------+
                                 |
                     DB transaction + outbox
                                 |
             +-------------------+-------------------+
             |                                       |
             v                                       v
   +---------------------+                +-------------------------+
   | JMS Command Queue   |                | Kafka/Pulsar Event Log  |
   | operational work    |                | integration events      |
   +----------+----------+                +------------+------------+
              |                                        |
              v                                        v
   +---------------------+                +-------------------------+
   | Workers / MDB       |                | Reporting / SLA / Audit |
   +---------------------+                +-------------------------+
```

Interpretasi:

- JMS/RabbitMQ untuk command/work item;
- Kafka/Pulsar untuk event stream/replay;
- database outbox untuk publish reliability;
- inbox/dedup untuk consumer idempotency;
- DLQ untuk operational repair;
- audit store untuk forensic truth.

Top 1% engineer tidak fanatik ke satu tool. Mereka menjaga semantics tetap bersih.

---

## 19. Case Management / Regulatory System Perspective

Untuk sistem enforcement lifecycle, case management, compliance, escalation, SLA, dan auditability, biasanya ada beberapa message type berbeda.

| Use Case | Semantics | Teknologi Bias |
|---|---|---|
| Generate correspondence PDF | Work item | JMS/RabbitMQ |
| Send notification email | Work item | JMS/RabbitMQ |
| Case status changed | Integration event | Kafka/Pulsar/JMS Topic tergantung replay |
| SLA timer expired | Command/event hybrid, hati-hati | JMS Queue untuk command; event log untuk audit |
| Audit trail projection | Replayable event | Kafka/Pulsar atau DB audit log |
| External agency integration | Enterprise messaging | JMS/IBM MQ/Artemis sering cocok |
| Dashboard projection rebuild | Replay stream | Kafka/Pulsar |
| Payment reconciliation batch event | Event stream or queue depending requirement | Kafka/Pulsar jika replay; JMS jika work queue |

### Prinsip

Jangan mendesain semua alur sebagai queue.

Jangan pula mendesain semua alur sebagai event stream.

Pisahkan:

```text
Command = meminta perubahan
Event   = mencatat perubahan yang sudah terjadi
Work    = pekerjaan teknis yang harus diselesaikan
Audit   = catatan kebenaran historis
Signal  = notifikasi ringan
```

Setiap jenis punya teknologi dan failure model berbeda.

---

## 20. Deep Comparison: Queue vs Log

## 20.1 Queue

Queue adalah struktur untuk menahan pekerjaan sampai worker mengambilnya.

```text
enqueue -> wait -> deliver -> ack -> remove
```

Optimized for:

- work distribution;
- completion;
- retry;
- DLQ;
- operational backlog;
- competing consumers.

Danger if used for:

- long-term history;
- analytics replay;
- event sourcing;
- consumer-independent offsets.

## 20.2 Log

Log adalah sequence of records yang tetap ada selama retention.

```text
append -> retain -> consumers read at offsets -> retention deletes/compacts
```

Optimized for:

- replay;
- fan-out independent consumers;
- stream processing;
- event history;
- high throughput append.

Danger if used for:

- arbitrary per-message priority;
- simple one-off tasks where operational complexity is not justified;
- low-skill retry/DLQ model without pattern;
- strict global ordering with high parallelism.

---

## 21. Migration Guidance

## 21.1 JMS to Kafka

Common reason:

- need replay;
- need event streaming;
- need many downstream consumers;
- need data platform integration.

Risks:

- queue semantics accidentally copied to Kafka;
- no partition key strategy;
- retry/DLQ model missing;
- schema governance missing;
- consumer idempotency assumed but not implemented;
- operational team unprepared.

Migration strategy:

1. classify message as command/event/work;
2. do not migrate command queue blindly;
3. introduce outbox for event publishing;
4. define schema/versioning;
5. define partition key;
6. define retention;
7. define replay policy;
8. define DLQ/retry topics;
9. run dual-publish carefully if needed;
10. validate consumer correctness under duplicate/replay.

## 21.2 RabbitMQ to Kafka

Migrate only if routing/work queue requirement has become replayable stream requirement.

Do not migrate simply because queue volume is high. RabbitMQ can handle many queue workloads when designed correctly. Kafka helps when the abstraction changes from **delivery** to **log**.

## 21.3 Kafka to JMS/RabbitMQ

This sounds unusual, but can be right when:

- workload is actually command processing;
- retry/DLQ operations are painful in Kafka;
- strict work queue semantics are needed;
- event retention is not needed;
- app server/JTA integration matters.

## 21.4 JMS to Pulsar

Consider if:

- you need subscription flexibility;
- replay matters;
- multi-tenancy matters;
- cloud-native platform team is ready.

Avoid if:

- you only need simple Java queue;
- ops team is not ready for distributed storage complexity.

---

## 22. Code Perspective: How Semantics Shape Java Code

## 22.1 JMS-Style Handler

```java
public final class ApproveApplicationListener implements jakarta.jms.MessageListener {

    private final ApplicationService service;

    public ApproveApplicationListener(ApplicationService service) {
        this.service = service;
    }

    @Override
    public void onMessage(jakarta.jms.Message message) {
        try {
            String commandId = message.getStringProperty("commandId");
            String applicationId = message.getStringProperty("applicationId");

            service.approveIdempotently(commandId, applicationId);

            // In container/local transaction mode, ack/commit is controlled outside this line.
        } catch (Exception ex) {
            // Throwing lets the container/session rollback/redeliver depending config.
            throw new RuntimeException("Failed to process approval command", ex);
        }
    }
}
```

Mental model:

```text
Handler owns business completion.
Broker redelivery may happen.
Idempotency key is mandatory.
```

## 22.2 Kafka-Style Handler

```java
public final class ApplicationEventConsumer {

    private final ProjectionService projectionService;

    public void handle(ApplicationStatusChanged event, String topic, int partition, long offset) {
        projectionService.applyEventIdempotently(
            event.eventId(),
            event.applicationId(),
            event.newStatus(),
            topic,
            partition,
            offset
        );

        // Offset commit must happen only after side effect is safe.
    }
}
```

Mental model:

```text
Consumer position matters.
Replay is normal.
Handler must be replay-safe.
```

## 22.3 RabbitMQ-Style Handler

```java
public final class WorkItemHandler {

    public void handle(Delivery delivery, Channel channel) throws IOException {
        long tag = delivery.getEnvelope().getDeliveryTag();

        try {
            process(delivery.getBody());
            channel.basicAck(tag, false);
        } catch (TransientFailure ex) {
            channel.basicNack(tag, false, true);
        } catch (PermanentFailure ex) {
            channel.basicReject(tag, false); // DLX if configured
        }
    }
}
```

Mental model:

```text
Ack/nack is explicit delivery control.
Routing/DLX topology defines failure path.
```

## 22.4 Pulsar-Style Handler

```java
public final class PulsarEventHandler {

    public void handle(Message<byte[]> message, Consumer<byte[]> consumer) {
        try {
            process(message.getKey(), message.getValue());
            consumer.acknowledge(message);
        } catch (Exception ex) {
            consumer.negativeAcknowledge(message);
        }
    }
}
```

Mental model:

```text
Subscription controls distribution.
Ack controls subscription progress.
Retention controls replay availability.
```

---

## 23. Interview-Level Reasoning

Jika ditanya:

> “Kapan pilih JMS daripada Kafka?”

Jawaban kuat:

```text
Saya pilih JMS ketika problem utamanya adalah enterprise message delivery atau work/command queue, terutama di Java enterprise runtime yang membutuhkan transaction integration, MDB, JTA/resource adapter, atau operational workflow seperti redelivery dan DLQ. Saya tidak memilih JMS jika requirement utamanya replayable event log, independent consumer offsets, long retention, atau stream processing; untuk itu Kafka/Pulsar lebih natural.
```

Jika ditanya:

> “Kapan Kafka bukan pilihan tepat?”

Jawaban kuat:

```text
Kafka kurang tepat jika requirement-nya hanya simple work queue dengan retry per message, priority, delay, dan DLQ operator workflow; atau jika tim tidak membutuhkan replay/retention dan belum siap dengan partitioning, consumer group, schema governance, dan operational complexity. Kafka adalah log platform, bukan replacement universal untuk queue broker.
```

Jika ditanya:

> “RabbitMQ vs Kafka?”

Jawaban kuat:

```text
RabbitMQ lebih natural untuk routing dan work delivery via exchange/queue/ack/nack. Kafka lebih natural untuk retained event log dengan replay, consumer group, and stream processing. Pertanyaan utamanya bukan throughput semata, tetapi apakah data harus hilang setelah diproses atau tetap ada sebagai log untuk consumer independen.
```

Jika ditanya:

> “Pulsar vs Kafka?”

Jawaban kuat:

```text
Kafka adalah pilihan kuat untuk event streaming dengan ecosystem matang. Pulsar menarik ketika dibutuhkan kombinasi messaging dan streaming, subscription mode fleksibel, multi-tenancy, dan arsitektur storage terpisah. Namun Pulsar membawa operational complexity berbeda, sehingga pemilihannya harus mempertimbangkan kesiapan platform team dan ekosistem organisasi.
```

---

## 24. Final Decision Cheat Sheet

```text
Need simple durable work queue?
  -> JMS / RabbitMQ / IBM MQ / Artemis

Need Java enterprise app server transaction integration?
  -> JMS / Jakarta Messaging

Need flexible broker-side routing?
  -> RabbitMQ / AMQP broker

Need replayable event stream with many independent consumers?
  -> Kafka / Pulsar

Need stream processing ecosystem and CDC pipeline?
  -> Kafka

Need messaging + streaming + multi-tenancy/subscription flexibility?
  -> Pulsar

Need audit history?
  -> Event log or database audit store, not ordinary queue backlog

Need exactly-once business effect?
  -> Idempotency/inbox/outbox/state guards, regardless of broker
```

---

## 25. Production Checklist

Sebelum final memilih teknologi, pastikan semua ini terjawab:

- [ ] Message diklasifikasikan sebagai command/event/work/signal/audit.
- [ ] Replay requirement jelas.
- [ ] Retention requirement jelas.
- [ ] Ordering boundary jelas.
- [ ] Parallelism model jelas.
- [ ] Retry dan DLQ strategy jelas.
- [ ] Poison message behavior jelas.
- [ ] Idempotency key jelas.
- [ ] Schema evolution strategy jelas.
- [ ] Consumer ownership jelas.
- [ ] Topic/queue naming convention jelas.
- [ ] Security model jelas.
- [ ] Monitoring metric jelas.
- [ ] Capacity model jelas.
- [ ] Disaster recovery expectation jelas.
- [ ] Operational team siap.
- [ ] Migration/rollback strategy tersedia.

---

## 26. Ringkasan Mental Model

Inti Part 31:

```text
JMS is about enterprise message delivery.
RabbitMQ is about routing and queue-based delivery.
Kafka is about partitioned retained event logs.
Pulsar is about messaging + streaming with flexible subscriptions and multi-tenancy.
AMQP is a protocol family, not a product or complete application semantics.
```

Pilihan teknologi harus dimulai dari semantics:

```text
delivery vs log
command vs event
completion vs replay
queue depth vs consumer lag
ack vs offset/subscription progress
routing vs partitioning
transaction integration vs stream ecosystem
```

Top 1% engineer tidak bertanya “mana yang paling modern”. Mereka bertanya:

```text
Invariant apa yang harus dijaga saat duplicate, crash, retry, reorder, replay, dan operator intervention terjadi?
```

---

## 27. Referensi

- Jakarta Messaging Specification 3.1 — API standard untuk enterprise messaging di Java/Jakarta EE.
- Apache Kafka Documentation — konsep topic, partition, consumer group, retention, dan design.
- RabbitMQ Documentation — queues, exchanges, consumer acknowledgements, publisher confirms.
- Apache Pulsar Documentation — topics, subscriptions, retention, expiry, acknowledgement.
- Enterprise Integration Patterns — vocabulary konseptual untuk message channel, router, translator, aggregator, resequencer, dead letter channel.

---

## 28. Status Seri

Selesai: Part 31 dari 35.

Berikutnya:

**Part 32 — Enterprise Integration Patterns with JMS**



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-030.md">⬅️ Part 30 — Cloud-Native JMS: Kubernetes, Stateful Broker, Persistence, Service Discovery, dan Anti-Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-032.md">Part 32 — Enterprise Integration Patterns with JMS ➡️</a>
</div>

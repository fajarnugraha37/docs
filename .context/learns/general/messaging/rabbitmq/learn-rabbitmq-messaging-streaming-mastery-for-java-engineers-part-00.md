# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-00.md

# Part 00 — Orientation, Mental Model, dan Scope RabbitMQ Modern

> Seri: **RabbitMQ Messaging & Streaming Mastery for Java Engineers**  
> Target pembaca: **Java software engineer** yang sudah punya dasar backend/distributed systems dan ingin memahami RabbitMQ secara arsitektural, operasional, dan implementatif.  
> Fokus part ini: membangun **peta mental** sebelum masuk ke AMQP, exchange, queue, stream, Java client, Spring AMQP, reliability, dan production design.

---

## 0. Kenapa Part 00 Ini Penting?

Banyak engineer belajar RabbitMQ dengan urutan seperti ini:

1. install RabbitMQ,
2. buka management UI,
3. publish message,
4. consume message,
5. pakai `@RabbitListener`,
6. merasa sudah paham.

Masalahnya, RabbitMQ terlihat sederhana di awal, tetapi sangat mudah menjadi sumber incident produksi ketika mental model-nya salah.

Contoh kesalahan yang sering terjadi:

- mengira publish ke queue, padahal di AMQP 0-9-1 publish terjadi ke exchange;
- mengira message pasti hilang kalau consumer sudah menerima, padahal tergantung acknowledgement;
- memakai auto-ack untuk proses bisnis penting;
- membuat retry dengan `nack(requeue=true)` lalu menciptakan infinite redelivery loop;
- mengira durable queue + persistent message otomatis cukup tanpa publisher confirm;
- memakai satu queue besar untuk semua workflow;
- menyamakan RabbitMQ dengan Kafka lalu salah memilih queue/stream semantics;
- tidak membedakan event notification, command handoff, task distribution, dan audit stream;
- memakai classic queue untuk kebutuhan high availability yang seharusnya memakai quorum queue atau stream;
- tidak punya observability terhadap ready messages, unacked messages, redelivery, dan consumer utilization.

Part 00 bertujuan mencegah kesalahan itu sejak awal.

Kita tidak akan langsung menulis kode. Kita akan membangun **model konseptual** yang akan dipakai sepanjang seri.

---

## 1. Posisi RabbitMQ dalam Distributed Systems

RabbitMQ adalah **messaging and streaming broker**.

Kalimat itu pendek, tetapi isinya besar. RabbitMQ modern bukan hanya “queue server”. Ia bisa berperan sebagai:

1. **Message broker**  
   Menerima message dari producer, menyimpannya sementara, lalu mengirimkannya ke consumer.

2. **Routing fabric**  
   Mengarahkan message dari producer ke satu atau banyak queue berdasarkan exchange, binding, routing key, atau header.

3. **Work distribution engine**  
   Membagi pekerjaan ke beberapa worker dengan competing consumer pattern.

4. **Reliability boundary**  
   Menjadi buffer antara service yang menghasilkan pekerjaan dan service yang memproses pekerjaan.

5. **Backpressure boundary**  
   Menahan tekanan ketika producer lebih cepat daripada consumer, dengan konsekuensi memory/disk/latency yang harus dipahami.

6. **Workflow decoupling layer**  
   Memisahkan service yang memutuskan “apa yang harus terjadi” dari service yang benar-benar menjalankan pekerjaan.

7. **Event notification bus**  
   Menyebarkan notifikasi perubahan state ke banyak subscriber.

8. **Stream broker**  
   Menyimpan log append-only untuk replay, retention-based consumption, dan event history melalui RabbitMQ Streams.

RabbitMQ berada di area yang sangat penting: di antara service, database, user journey, background jobs, workflow engine, dan operasi produksi.

Karena itu, RabbitMQ tidak boleh dipahami hanya sebagai library integration. Ia harus dipahami sebagai **komponen arsitektur**.

---

## 2. Yang Membedakan RabbitMQ dari Kafka

Karena kamu sudah punya seri Kafka, seri RabbitMQ ini harus efisien. Kita tidak perlu mengulang konsep event streaming umum secara berlebihan. Yang perlu ditekankan adalah perbedaan fundamental.

### 2.1 Kafka: log-first

Kafka secara mental lebih dekat ke:

```text
producer -> topic partition append-only log -> consumer group reads offsets
```

Kafka kuat untuk:

- append-only event log;
- high-throughput streaming;
- replay by offset;
- retention-based event history;
- partitioned ordering;
- stream processing;
- analytics/event pipeline;
- event sourcing style architecture;
- durable log sebagai sumber data downstream.

### 2.2 RabbitMQ: broker/routing/queue-first

RabbitMQ secara mental lebih dekat ke:

```text
producer -> exchange -> binding rules -> queue -> consumer delivery/ack
```

RabbitMQ kuat untuk:

- command dispatch;
- background job processing;
- task queue;
- routing yang kaya;
- selective delivery;
- request/reply;
- delayed/retry workflow;
- per-consumer queue semantics;
- short/medium-lived messages;
- competing consumers;
- fine-grained consumer acknowledgement;
- operational routing topology.

Dengan RabbitMQ Streams, RabbitMQ juga punya log-like capability:

```text
producer -> stream append-only replicated log -> consumer offset/replay
```

Tetapi RabbitMQ Streams tidak membuat RabbitMQ identik dengan Kafka. RabbitMQ tetap memiliki desain, operational model, dan sweet spot berbeda.

### 2.3 Perbedaan mental paling penting

| Dimensi | RabbitMQ Queue | RabbitMQ Stream | Kafka |
|---|---|---|---|
| Model utama | Brokered queue | Append-only log | Append-only partitioned log |
| Konsumsi | Delivery ke consumer | Consumer membaca offset | Consumer membaca offset |
| Setelah consumed | Message biasanya hilang/acknowledged dari queue | Message tetap sampai retention | Message tetap sampai retention |
| Routing | Exchange + binding sangat kuat | Lebih stream/log oriented | Topic/partition oriented |
| Work distribution | Sangat natural | Bisa, tapi bukan model default queue tradisional | Consumer group partition assignment |
| Retry/DLQ | Sangat natural | Perlu desain berbeda | Perlu topic retry/DLT pattern |
| Request/reply | Didukung secara natural | Tidak cocok sebagai model utama | Tidak natural |
| Per-key ordering | Per queue / sharding / single active consumer | Per stream/partition | Per partition |
| Use case dominan | task, command, workflow, integration | replayable event stream di RabbitMQ ecosystem | high-scale streaming/log pipeline |

Kesimpulan awal:

> RabbitMQ bukan Kafka yang lebih kecil. Kafka bukan RabbitMQ yang lebih besar. Keduanya menyelesaikan kelas masalah yang saling tumpang tindih, tetapi dengan pusat gravitasi berbeda.

---

## 3. RabbitMQ sebagai Routing Fabric

Konsep paling khas RabbitMQ adalah **exchange**.

Banyak sistem queue sederhana memakai model:

```text
producer -> queue -> consumer
```

RabbitMQ, khususnya AMQP 0-9-1, memakai model:

```text
producer -> exchange -> binding -> queue -> consumer
```

Producer tidak perlu tahu queue mana yang akan menerima message. Producer publish ke exchange dengan routing metadata. Exchange menggunakan binding rules untuk menentukan queue tujuan.

Ini memberi RabbitMQ kekuatan besar:

- producer dan consumer lebih decoupled;
- satu message bisa masuk ke banyak queue;
- routing bisa berubah tanpa mengubah producer;
- consumer bisa punya queue sendiri;
- service baru bisa subscribe ke event lama dengan binding baru;
- topology bisa merepresentasikan kontrak integrasi antar domain.

### 3.1 Exchange sebagai router

Exchange bukan storage utama. Exchange adalah routing component.

Secara sederhana:

```text
[Producer]
    |
    | publish(exchange='case.events', routing_key='case.opened')
    v
[Exchange: case.events]
    |
    | binding rules
    +--> [Queue: notification.case-opened]
    +--> [Queue: audit.case-events]
    +--> [Queue: fraud-screening.case-opened]
```

Producer hanya mengatakan:

> “Ada event `case.opened` pada exchange `case.events`.”

Ia tidak perlu tahu bahwa ada audit consumer, notification consumer, fraud screening consumer, atau service lain.

### 3.2 Binding sebagai subscription rule

Binding adalah relasi antara exchange dan queue.

Misalnya:

```text
exchange: case.events
queue: audit.case-events
binding key: case.*
```

Artinya queue `audit.case-events` tertarik pada message tertentu dari exchange `case.events`.

Binding adalah titik desain yang sangat penting. Ia menjawab:

- consumer mana yang perlu menerima message apa?
- apakah satu message dikirim ke satu queue atau banyak queue?
- apakah routing berbasis event type, severity, tenant, region, workflow stage, atau kombinasi?
- apakah queue dibuat untuk service, use case, workflow step, atau subscription tertentu?

### 3.3 Queue sebagai mailbox/work buffer

Queue adalah tempat message disimpan sampai delivered dan acknowledged.

Queue bisa dipahami sebagai:

- mailbox untuk service;
- buffer pekerjaan;
- backlog;
- retry staging area;
- failure isolation boundary;
- competing consumer coordination point.

Queue bukan sekadar “list message”. Queue punya semantics:

- ordering;
- acknowledgement;
- redelivery;
- durability;
- exclusivity;
- TTL;
- max length;
- dead lettering;
- queue type;
- leader/replica behavior;
- consumer relationship.

---

## 4. RabbitMQ Modern: Core Building Blocks

Untuk seri ini, kita akan memakai RabbitMQ modern sebagai baseline. Ada beberapa building block yang akan terus muncul.

## 4.1 Producer

Producer adalah aplikasi yang membuat message dan publish ke RabbitMQ.

Dalam Java, producer bisa berupa:

- service Spring Boot;
- scheduled job;
- outbox relay;
- batch importer;
- API backend setelah database transaction;
- workflow engine adapter;
- internal domain event publisher.

Producer bertanggung jawab atas:

- memilih exchange;
- memilih routing key;
- membuat payload;
- mengisi metadata;
- mengatur persistence;
- menangani publisher confirm;
- menangani returned message jika unroutable;
- menghindari duplicate publish yang merusak downstream.

Producer yang baik tidak hanya memanggil `convertAndSend`. Producer yang baik punya reliability contract.

---

## 4.2 Exchange

Exchange menerima message dari producer dan merutekannya.

Exchange umum:

1. **Direct exchange**  
   Routing key harus match secara exact.

2. **Fanout exchange**  
   Message dikirim ke semua queue yang ter-bind, mengabaikan routing key.

3. **Topic exchange**  
   Routing key berbentuk dot-separated words dan bisa memakai wildcard.

4. **Headers exchange**  
   Routing berdasarkan headers, bukan routing key.

5. **Default exchange**  
   Exchange built-in tanpa nama yang bisa route ke queue berdasarkan queue name.

Exchange adalah pusat desain topology.

Kesalahan topology exchange biasanya menghasilkan sistem yang:

- sulit dikembangkan;
- terlalu tightly coupled;
- terlalu banyak queue;
- routing key tidak konsisten;
- event taxonomy kacau;
- sulit di-debug saat incident.

---

## 4.3 Binding

Binding adalah aturan yang menghubungkan exchange ke queue.

Binding menjawab:

```text
Dari exchange ini, message seperti apa yang masuk ke queue ini?
```

Binding bisa berubah tanpa mengubah producer. Ini sangat penting untuk extensibility.

Misalnya saat service audit baru dibuat, kita bisa menambahkan queue dan binding baru tanpa mengubah producer event domain.

---

## 4.4 Queue

Queue adalah struktur penyimpanan dan delivery.

RabbitMQ modern punya beberapa queue type penting:

### Classic Queue

Classic queue adalah queue tradisional RabbitMQ.

Mulai RabbitMQ 4.0, classic queue adalah non-replicated queue type. Ini berarti classic queue cocok untuk use case tertentu, tetapi bukan pilihan utama untuk high availability/data safety yang membutuhkan replication.

Cocok untuk:

- transient/non-critical workload;
- local development;
- workload sederhana;
- queue yang bisa direkonstruksi;
- low criticality background jobs.

Tidak cocok sebagai default untuk:

- durable critical business command;
- workflow penting;
- audit-critical processing;
- message yang tidak boleh hilang saat node failure.

### Quorum Queue

Quorum queue adalah replicated durable FIFO queue berbasis Raft.

Cocok untuk:

- command queue penting;
- task queue critical;
- workflow step yang harus durable;
- DLQ penting;
- queue yang butuh safety saat node failure;
- sistem produksi modern.

Quorum queue akan menjadi konsep inti di seri ini karena RabbitMQ modern mendorongnya sebagai pilihan utama untuk replicated queue semantics.

### Stream

Stream adalah append-only replicated log di RabbitMQ.

Cocok untuk:

- replayable event stream;
- event history;
- audit stream;
- large fanout dengan replay;
- time-based retention;
- rebuilding projections;
- stream processing ringan dalam RabbitMQ ecosystem.

Stream bukan queue biasa. Konsumsi stream bersifat non-destructive: message tetap ada sampai retention menghapusnya.

---

## 4.5 Consumer

Consumer menerima delivery dari queue atau membaca stream.

Dalam queue model, consumer biasanya menerima message dari broker dan mengirim ack/nack/reject.

Consumer bertanggung jawab atas:

- pemrosesan bisnis;
- acknowledgement timing;
- idempotency;
- error classification;
- retry decision;
- poison message handling;
- observability;
- backpressure via prefetch;
- graceful shutdown.

Consumer yang baik bukan hanya function handler. Consumer adalah state transition boundary.

---

## 4.6 Virtual Host

Virtual host atau vhost adalah boundary logis dalam RabbitMQ.

Vhost memisahkan:

- exchanges;
- queues;
- bindings;
- permissions;
- policies;
- runtime resources.

Dalam production, vhost bisa dipakai untuk:

- environment isolation;
- tenant isolation;
- domain isolation;
- application boundary;
- migration boundary.

Namun terlalu banyak vhost juga bisa menyulitkan operasi.

---

## 4.7 Policy

Policy adalah cara menerapkan konfigurasi ke queue/exchange berdasarkan pattern nama.

Misalnya policy untuk:

- queue type;
- dead-letter exchange;
- message TTL;
- max length;
- stream retention;
- delivery limit;
- federation;
- queue leader locator.

Policy penting karena topology tidak seharusnya selalu hard-coded di aplikasi.

---

## 4.8 Plugin

RabbitMQ punya plugin system.

Plugin umum:

- management UI;
- Prometheus metrics;
- shovel;
- federation;
- delayed message exchange;
- stream;
- MQTT;
- STOMP;
- OAuth2/JWT auth;
- LDAP auth.

Plugin memperluas RabbitMQ, tetapi juga menambah operational surface area. Seri ini akan membahas plugin yang relevan untuk production design.

---

## 5. Message Lifecycle: Dari Publish sampai Ack

Untuk memahami RabbitMQ, kita harus memahami lifecycle message.

Sederhananya:

```text
1. Producer membuat message
2. Producer publish ke exchange
3. Exchange mengevaluasi binding
4. Message masuk ke satu atau lebih queue
5. Broker mengirim delivery ke consumer
6. Consumer memproses message
7. Consumer mengirim ack/nack/reject
8. Broker menghapus, redeliver, atau dead-letter message sesuai hasilnya
```

Mari uraikan.

### 5.1 Producer membuat message

Message bukan hanya payload.

Message idealnya terdiri dari:

```text
message = envelope + payload
```

Envelope berisi metadata seperti:

- message id;
- correlation id;
- causation id;
- trace id;
- schema version;
- producer name;
- content type;
- occurred at;
- tenant/region jika relevan;
- retry metadata jika relevan.

Payload berisi data domain.

Kesalahan umum: message hanya berisi JSON payload tanpa identity dan metadata. Ini membuat debugging, idempotency, tracing, replay, dan audit menjadi sulit.

---

### 5.2 Producer publish ke exchange

Dalam AMQP 0-9-1, publish dilakukan ke exchange, bukan langsung ke queue.

Producer memilih:

- exchange name;
- routing key;
- properties;
- payload;
- mandatory flag opsional;
- delivery mode/persistence;
- publisher confirm configuration.

Pertanyaan desain producer:

- Apakah message harus durable?
- Apakah producer perlu tahu jika message tidak routable?
- Apakah producer menunggu confirm dari broker?
- Apakah publish terjadi setelah database commit?
- Apakah duplicate publish bisa diterima downstream?

---

### 5.3 Exchange merutekan message

Exchange mencocokkan message dengan binding.

Kemungkinan hasil:

1. Message cocok ke satu queue.
2. Message cocok ke banyak queue.
3. Message tidak cocok ke queue mana pun.

Kasus ketiga sering diabaikan. Jika message unroutable dan producer tidak memakai mandatory/return handling, message bisa hilang dari perspektif aplikasi.

---

### 5.4 Queue menyimpan message

Queue menyimpan message sampai dikirim dan acknowledged.

Namun “disimpan” tidak otomatis berarti aman dalam semua failure. Safety tergantung kombinasi:

- queue durable atau tidak;
- message persistent atau tidak;
- queue type;
- replication;
- publisher confirm;
- broker flush behavior;
- cluster health;
- disk state.

Durability adalah property yang harus dirancang end-to-end, bukan checkbox tunggal.

---

### 5.5 Broker deliver ke consumer

RabbitMQ mendorong message ke consumer yang subscribed.

Consumer bisa banyak. Dalam competing consumer pattern, beberapa consumer membaca dari queue yang sama.

Broker akan membagi delivery berdasarkan availability, prefetch, dan consumer state.

Pertanyaan penting:

- Berapa prefetch?
- Berapa concurrency?
- Apakah handler idempotent?
- Apakah ordering penting?
- Apakah satu message lambat bisa menghambat yang lain?
- Apakah consumer boleh mati saat memproses message?

---

### 5.6 Consumer ack/nack/reject

Consumer memberi tahu broker hasil delivery.

- `ack`: message berhasil diproses, broker boleh menghapusnya dari queue.
- `nack` dengan requeue: message gagal, masukkan kembali ke queue.
- `nack` tanpa requeue: message gagal, jangan requeue; bisa dead-letter jika DLX diset.
- `reject`: mirip untuk satu message, lebih terbatas.

Acknowledge harus dilakukan **setelah** efek bisnis aman.

Contoh salah:

```text
1. consumer receive message
2. consumer ack message
3. consumer update database
4. database update gagal
```

Message sudah hilang, efek bisnis gagal. Ini message loss dari perspektif proses bisnis.

Contoh lebih aman:

```text
1. consumer receive message
2. consumer validate message
3. consumer apply business transaction idempotently
4. database commit sukses
5. consumer ack message
```

Masih ada risiko duplicate jika consumer crash setelah DB commit tetapi sebelum ack. Karena itu idempotency tetap wajib.

---

## 6. Delivery Guarantee: Istilah yang Harus Diluruskan

Messaging sering dijelaskan dengan istilah:

- at-most-once;
- at-least-once;
- exactly-once.

Namun di sistem nyata, istilah ini harus diterjemahkan secara spesifik.

### 6.1 At-most-once

Message diproses nol atau satu kali.

Biasanya terjadi jika:

- auto-ack digunakan;
- ack dilakukan sebelum business processing;
- broker/client tidak retry;
- data loss lebih diterima daripada duplicate.

Cocok untuk:

- metrics non-critical;
- ephemeral notification;
- telemetry yang boleh hilang;
- cache warmup.

Tidak cocok untuk:

- payment;
- enforcement case transition;
- audit trail;
- critical task;
- compliance workflow.

---

### 6.2 At-least-once

Message diproses minimal sekali, tetapi bisa duplicate.

Ini pola paling umum untuk RabbitMQ production.

Biasanya dicapai dengan:

- durable queue;
- persistent message;
- publisher confirm;
- manual ack setelah processing;
- retry/redelivery;
- idempotent consumer.

Konsekuensinya:

> Consumer harus siap menerima message yang sama lebih dari sekali.

At-least-once tanpa idempotency adalah bom waktu.

---

### 6.3 Exactly-once

Exactly-once sering menjadi janji yang menyesatkan.

Dalam konteks RabbitMQ + database + external API, exactly-once end-to-end hampir selalu tidak realistis tanpa desain khusus dan constraint ketat.

Yang lebih realistis:

> At-least-once delivery + idempotent side effect + deduplication key + transactional boundary yang jelas.

Dengan kata lain, tujuan praktisnya bukan “message tidak pernah duplicate”, tetapi:

> Duplicate tidak menyebabkan efek bisnis ganda.

Contoh:

- `case_escalation_requested` boleh diterima dua kali;
- tetapi case hanya boleh masuk state `ESCALATED` sekali;
- consumer memakai `message_id` atau business idempotency key;
- database constraint mencegah duplicate transition.

---

## 7. Problem Taxonomy: Jangan Semua Disebut “Event”

Salah satu sumber kekacauan sistem messaging adalah semua message disebut event.

Dalam RabbitMQ, lebih baik membedakan beberapa jenis message.

## 7.1 Command

Command adalah instruksi untuk melakukan sesuatu.

Contoh:

```text
EvaluateCaseRules
GenerateEnforcementNotice
SendReminderEmail
AssignReviewTask
CreatePaymentInvoice
```

Command biasanya:

- punya satu logical owner;
- dikirim ke queue tertentu;
- diproses oleh worker/service tertentu;
- failure-nya harus diketahui;
- retry-nya harus dikontrol;
- sering cocok dengan quorum queue.

Command merepresentasikan intent:

> “Tolong lakukan ini.”

RabbitMQ sangat kuat untuk command handoff.

---

## 7.2 Event

Event adalah fakta bahwa sesuatu sudah terjadi.

Contoh:

```text
CaseOpened
EvidenceSubmitted
ReviewApproved
EnforcementNoticeIssued
PaymentReceived
```

Event biasanya:

- immutable;
- past tense;
- bisa punya banyak subscriber;
- cocok dengan topic exchange atau stream;
- tidak memerintah subscriber melakukan sesuatu secara langsung;
- dipakai untuk decoupling.

Event merepresentasikan fact:

> “Ini sudah terjadi.”

---

## 7.3 Notification

Notification adalah sinyal bahwa pihak lain mungkin perlu tahu sesuatu.

Contoh:

```text
CaseStatusChangedNotification
DocumentUploadedNotification
SlaThresholdNearNotification
```

Notification bisa lebih ringan dari domain event.

Kadang notification tidak cukup lengkap untuk menjadi source of truth. Consumer mungkin perlu fetch detail dari API/database owner.

---

## 7.4 Task

Task adalah unit kerja background.

Contoh:

```text
GeneratePdfTask
ResizeImageTask
ReindexCaseTask
RecalculateRiskScoreTask
```

Task biasanya:

- queue-based;
- punya worker pool;
- membutuhkan retry;
- bisa parallel;
- bisa punya priority/deadline;
- cocok untuk competing consumers.

---

## 7.5 Request/Reply

Request/reply adalah komunikasi dua arah menggunakan broker.

Contoh:

```text
RiskScoreRequest -> RiskScoreResponse
EligibilityCheckRequest -> EligibilityCheckResponse
```

RabbitMQ mendukung ini, tetapi harus hati-hati.

Risikonya:

- menyembunyikan coupling synchronous di balik broker async;
- timeout rumit;
- duplicate response;
- caller lifecycle problem;
- backpressure buruk jika terlalu banyak pending reply;
- debugging lebih sulit daripada HTTP/gRPC.

Request/reply cocok jika memang ada alasan kuat memakai broker, bukan sekadar agar semua komunikasi “lewat RabbitMQ”.

---

## 7.6 Audit Message

Audit message adalah record untuk rekonstruksi, compliance, dan forensic.

Contoh:

```text
CaseTransitionRecorded
UserActionCaptured
RuleEvaluationDecisionLogged
ExternalNotificationAttemptRecorded
```

Audit message sering lebih cocok dengan stream karena butuh retention dan replay.

Namun audit tidak boleh hanya bergantung pada best-effort event jika regulasi menuntut bukti kuat. Kadang audit harus ditulis langsung ke database transactional dan stream dipakai untuk downstream processing.

---

## 8. Messaging Use Case Matrix

Sebelum memakai RabbitMQ, tanyakan: masalah apa yang sedang diselesaikan?

| Problem | Cocok dengan RabbitMQ? | Primitive awal |
|---|---:|---|
| Background job | Sangat cocok | quorum queue / classic queue tergantung criticality |
| Command handoff | Sangat cocok | direct exchange + quorum queue |
| Pub/sub event notification | Sangat cocok | topic/fanout exchange + per-subscriber queue |
| Retry workflow | Sangat cocok | DLX + TTL/delayed exchange + parking lot |
| Request/reply | Bisa, hati-hati | reply queue/direct reply-to |
| Audit log replay | Bisa dengan Streams | stream |
| High-throughput event pipeline | Bisa, tapi bandingkan Kafka | stream/super stream |
| Stream processing kompleks | Biasanya Kafka/Flink lebih kuat | RabbitMQ stream hanya jika scope cocok |
| Long-running business workflow | Bisa sebagai transport, bukan state owner | queue + state machine/orchestrator |
| Database transaction propagation | Bisa via outbox | outbox relay + publisher confirm |
| Cache invalidation | Cocok | fanout/topic exchange |
| User notification | Cocok | command queue per notification worker |
| Real-time websocket fanout | Bisa sebagai backend signal | fanout/topic + gateway queues |
| Large file transfer | Tidak cocok | store file elsewhere, send reference |

---

## 9. RabbitMQ dan Workflow/State Machine

Untuk sistem case management/regulatory enforcement, RabbitMQ sering muncul di antara state transition.

Contoh lifecycle:

```text
CASE_OPENED
  -> EVIDENCE_REQUIRED
  -> EVIDENCE_SUBMITTED
  -> UNDER_REVIEW
  -> ESCALATED
  -> ENFORCEMENT_PROPOSED
  -> APPROVED
  -> NOTICE_ISSUED
  -> CLOSED
```

RabbitMQ bisa dipakai untuk:

- mengirim command `EvaluateCaseRules` setelah `CaseOpened`;
- memberi event `EvidenceSubmitted` ke reviewer assignment service;
- mengirim task `GenerateNoticePdf`;
- mengatur retry `SendExternalNotification`;
- menaruh poison message ke parking lot;
- mencatat stream audit untuk replay/read model;
- memberi sinyal SLA escalation.

Namun RabbitMQ sebaiknya bukan pemilik utama state case.

State utama tetap harus jelas:

- database case management;
- workflow engine;
- state machine persistence;
- event store jika memakai event sourcing.

RabbitMQ adalah transport dan delivery coordination layer. Ia bisa membantu workflow, tetapi jangan menjadikan keberadaan message di queue sebagai satu-satunya kebenaran state bisnis.

---

## 10. Batasan RabbitMQ: Yang Harus Disadari Sejak Awal

RabbitMQ kuat, tetapi tidak ajaib.

## 10.1 Queue bukan database umum

Queue bukan tempat menyimpan history tak terbatas.

Jika queue terus tumbuh, itu bukan “data lake”; itu gejala consumer tidak sanggup mengejar atau desain flow salah.

Untuk history/replay, gunakan stream atau storage lain yang memang didesain untuk retention.

---

## 10.2 Broker tidak menghapus kebutuhan idempotency

Broker bisa redeliver message.

Consumer bisa memproses message, commit database, lalu crash sebelum ack.

Setelah restart, message bisa dikirim lagi.

Karena itu idempotency adalah property aplikasi, bukan property broker saja.

---

## 10.3 Durable bukan berarti impossible-to-lose

Durable queue + persistent message lebih aman daripada transient, tetapi masih perlu:

- publisher confirm;
- queue type yang tepat;
- disk sehat;
- replication jika butuh HA;
- cluster majority untuk quorum;
- monitoring;
- backup/DR strategy;
- operational discipline.

---

## 10.4 Retry bisa memperparah incident

Retry yang salah bisa membuat sistem makin rusak.

Contoh:

```text
Consumer gagal karena downstream DB down.
Consumer nack requeue=true.
Message langsung dikirim lagi.
Consumer gagal lagi.
Loop ribuan kali per detik.
Broker panas.
Logs membesar.
DLQ tidak pernah dipakai.
Incident makin parah.
```

Retry harus punya:

- klasifikasi error;
- delay;
- max attempt;
- DLQ;
- parking lot;
- alert;
- remediation path.

---

## 10.5 Ordering dan parallelism bertentangan

Jika kamu butuh strict ordering, kamu sering harus mengorbankan parallelism.

Jika kamu menambah banyak consumer pada satu queue, ordering end-to-end bisa berubah karena:

- prefetch;
- processing time berbeda;
- retry;
- redelivery;
- multiple consumers;
- downstream transaction timing.

Ordering harus didesain, bukan diasumsikan.

---

## 10.6 Large message adalah anti-pattern

RabbitMQ message sebaiknya membawa data yang cukup untuk memproses, tetapi bukan file besar.

Untuk file besar:

```text
object storage / file store / database blob
        ^
        |
message berisi reference + metadata
```

Large message berdampak pada:

- memory;
- disk;
- network;
- replication;
- queue paging;
- latency;
- management UI;
- redelivery cost.

---

## 11. RabbitMQ Queue Types: Peta Awal

Kita akan membahas detailnya nanti. Di part 00 cukup pahami peta ini.

## 11.1 Classic Queue

Gunakan jika:

- workload sederhana;
- non-critical;
- tidak butuh replication;
- data bisa direkonstruksi;
- lokal/dev/testing;
- latency sederhana lebih penting daripada safety.

Hati-hati karena classic queue modern bukan replicated queue type.

---

## 11.2 Quorum Queue

Gunakan jika:

- pesan penting;
- data safety penting;
- production command queue;
- workflow critical;
- consumer bisa crash;
- node failure harus ditoleransi;
- ingin failure semantics lebih jelas.

Trade-off:

- lebih mahal secara disk/replication;
- membutuhkan cluster majority;
- throughput/latency perlu dipahami;
- tidak semua fitur classic queue identik.

---

## 11.3 Stream

Gunakan jika:

- ingin replay;
- ingin retention;
- banyak consumer independent;
- event history penting;
- audit/projection/rebuild use case;
- ingin log-like semantics dalam RabbitMQ ecosystem.

Trade-off:

- mental model berbeda dari queue;
- consumer offset harus dipahami;
- retry tidak sama dengan queue retry;
- topology dan operations berbeda;
- untuk stream processing skala besar, tetap bandingkan dengan Kafka.

---

## 12. Exchange Type: Peta Awal

## 12.1 Direct Exchange

Cocok untuk command routing exact.

Contoh:

```text
exchange: enforcement.commands
routing key: evaluate-case
queue: rule-engine.evaluate-case
```

Pesan dengan routing key `evaluate-case` masuk ke queue tersebut.

Gunakan direct exchange jika producer tahu kategori kerja secara jelas.

---

## 12.2 Fanout Exchange

Cocok untuk broadcast.

Contoh:

```text
exchange: case.opened.broadcast
queues:
  - audit.case-opened
  - notification.case-opened
  - metrics.case-opened
```

Routing key diabaikan.

Gunakan fanout jika semua subscriber exchange perlu semua message.

---

## 12.3 Topic Exchange

Cocok untuk event taxonomy.

Contoh routing key:

```text
case.opened
case.evidence.submitted
case.review.approved
case.enforcement.notice-issued
```

Binding:

```text
case.*
case.evidence.*
case.#
*.review.approved
```

Topic exchange sangat powerful tetapi bisa menjadi kacau jika naming taxonomy buruk.

---

## 12.4 Headers Exchange

Cocok jika routing berdasarkan metadata kompleks.

Contoh header:

```text
tenant=banking
region=ap-southeast-1
severity=high
caseType=enforcement
```

Headers exchange lebih fleksibel, tetapi lebih sulit dipahami dan dioperasikan dibanding routing key yang konsisten.

---

## 13. Java Engineer Perspective: Apa yang Akan Kamu Bangun?

Sepanjang seri, kita akan berpikir seperti engineer yang membangun sistem nyata, bukan sekadar menjalankan tutorial.

Kita akan membangun mental model untuk komponen seperti:

```text
case-api
  -> writes case DB transaction
  -> writes outbox record

outbox-relay
  -> reads outbox
  -> publishes CaseOpened event
  -> waits publisher confirm

rabbitmq
  -> topic exchange case.events
  -> routes to queues:
       audit.case-events
       rule-engine.case-opened
       notification.case-opened

rule-engine-worker
  -> consumes EvaluateCaseRules command
  -> idempotently evaluates rules
  -> publishes RuleEvaluationCompleted

notification-worker
  -> consumes SendNotification command
  -> retries with backoff
  -> DLQ on poison message

audit-stream-writer
  -> appends selected events to stream
  -> supports replay/read model rebuild
```

Kita akan terus bertanya:

- Siapa producer?
- Apa contract message-nya?
- Apa exchange-nya?
- Apa routing key-nya?
- Queue type apa?
- Siapa consumer?
- Apakah consumer idempotent?
- Kapan ack dilakukan?
- Bagaimana retry?
- Bagaimana DLQ?
- Bagaimana observability?
- Apa yang terjadi jika broker mati?
- Apa yang terjadi jika consumer mati?
- Apa yang terjadi jika downstream lambat?
- Apa yang terjadi jika message duplicate?
- Apa yang terjadi jika message tidak bisa diproses selamanya?

---

## 14. Production Thinking: RabbitMQ sebagai Sistem yang Harus Dioperasikan

RabbitMQ bukan hanya dependency library. Ia adalah runtime system.

Hal-hal yang harus diperhatikan di production:

## 14.1 Capacity

- publish rate;
- consume rate;
- ack rate;
- queue depth;
- redelivery rate;
- message size;
- memory usage;
- disk usage;
- replication cost;
- connection/channel count;
- consumer count;
- stream retention size.

## 14.2 Reliability

- durable topology;
- persistent messages;
- publisher confirms;
- manual ack;
- quorum queues;
- stream replication;
- DLQ;
- backup/restore;
- cluster majority;
- node failure handling.

## 14.3 Operability

- management UI;
- CLI tools;
- Prometheus metrics;
- alert rules;
- logs;
- tracing headers;
- correlation id;
- runbook;
- safe purge/requeue procedure;
- upgrade plan.

## 14.4 Security

- vhost boundaries;
- user permissions;
- TLS;
- credential rotation;
- least privilege;
- management UI access;
- audit logs;
- network segmentation.

## 14.5 Evolution

- adding new consumers;
- changing routing key taxonomy;
- queue migration;
- classic to quorum migration;
- retry policy changes;
- schema evolution;
- blue-green consumer deployment;
- backward compatibility.

---

## 15. Top 1% RabbitMQ Skill Map

Menjadi top-tier dalam RabbitMQ bukan berarti hafal semua CLI. Skill-nya berada di beberapa layer.

## 15.1 Conceptual Layer

Kamu harus bisa menjelaskan:

- exchange vs queue;
- routing key vs binding key;
- direct/fanout/topic/headers exchange;
- classic/quorum/stream difference;
- ack/nack/reject;
- prefetch;
- publisher confirm;
- DLX/DLQ;
- ordering vs concurrency;
- at-least-once + idempotency;
- queue vs stream semantics.

## 15.2 Design Layer

Kamu harus bisa mendesain:

- topology per domain;
- command queues;
- event fanout;
- retry/DLQ architecture;
- poison message handling;
- outbox/inbox;
- per-service queue ownership;
- stream audit pipeline;
- high availability queue strategy;
- failure recovery flow.

## 15.3 Java Implementation Layer

Kamu harus bisa mengimplementasikan:

- raw RabbitMQ Java client;
- Spring AMQP producer;
- Spring AMQP consumer;
- publisher confirm callback;
- returns callback;
- manual ack listener;
- retry interceptor;
- DLQ handling;
- Testcontainers integration;
- stream Java client producer/consumer;
- idempotency with database constraint.

## 15.4 Operational Layer

Kamu harus bisa mendiagnosis:

- queue depth naik;
- unacked messages tinggi;
- consumer utilization rendah;
- redelivery spike;
- memory alarm;
- disk alarm;
- publisher blocked;
- connection churn;
- channel leak;
- DLQ spike;
- quorum queue leader issue;
- stream lag/replay issue.

## 15.5 Architecture Judgment Layer

Kamu harus bisa memutuskan:

- RabbitMQ atau Kafka?
- queue atau stream?
- classic atau quorum?
- direct atau topic exchange?
- one queue per service atau per use case?
- retry langsung atau delayed?
- DLQ atau parking lot?
- request/reply atau HTTP?
- broker routing atau application routing?
- topology hard-coded atau policy-managed?

---

## 16. Naming Convention Awal

Naming terlihat sepele, tetapi sangat menentukan operability.

Contoh convention:

```text
<domain>.<category>
<domain>.<event-type>
<consumer-group>.<purpose>
<service>.<command>
<service>.<purpose>.retry.<delay>
<service>.<purpose>.dlq
```

Contoh:

```text
Exchange:
  case.events
  enforcement.commands
  notification.commands

Routing keys:
  case.opened
  case.evidence.submitted
  case.review.approved
  enforcement.notice.issue-requested

Queues:
  rule-engine.case-opened
  notification.case-events
  audit.case-events
  enforcement.issue-notice
  enforcement.issue-notice.retry.5m
  enforcement.issue-notice.dlq
  enforcement.issue-notice.parking-lot
```

Prinsip:

- nama harus terbaca saat incident;
- queue owner harus jelas;
- routing key harus konsisten;
- bedakan event dan command;
- jangan encoding terlalu banyak dimensi dalam satu routing key;
- jangan membuat nama yang bergantung pada implementasi internal yang mudah berubah.

---

## 17. Message Contract Awal

Minimal message envelope yang akan kita pakai sepanjang seri:

```json
{
  "messageId": "01JZ8R7YG6T5PZ7E9FZ9R1A4EQ",
  "messageType": "CaseOpened",
  "schemaVersion": 1,
  "correlationId": "01JZ8R7YAJ8B7W9PG3N6KX4BRR",
  "causationId": "01JZ8R7Y9X7P6K01TBDYJWQW6X",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "producer": "case-api",
  "occurredAt": "2026-06-19T10:15:30Z",
  "payload": {
    "caseId": "CASE-2026-000001",
    "caseType": "ENFORCEMENT",
    "openedBy": "system",
    "priority": "HIGH"
  }
}
```

Envelope ini membantu:

- traceability;
- idempotency;
- debugging;
- schema evolution;
- audit;
- correlation antar service;
- replay;
- forensic investigation.

Namun envelope bukan dogma. Di sistem nyata, kadang metadata berada di AMQP headers, bukan payload JSON. Yang penting adalah metadata tersedia dan konsisten.

---

## 18. Failure Model Awal

Setiap desain RabbitMQ harus diuji dengan failure questions.

## 18.1 Producer Failure

Pertanyaan:

- Apa yang terjadi jika producer crash setelah DB commit tetapi sebelum publish?
- Apa yang terjadi jika producer publish tetapi tidak menerima confirm?
- Apa yang terjadi jika message unroutable?
- Apa yang terjadi jika broker memblokir publisher karena memory/disk alarm?
- Apa yang terjadi jika publish retry menghasilkan duplicate?

Mitigasi umum:

- outbox pattern;
- publisher confirms;
- mandatory flag + returns callback;
- idempotent message id;
- retry with deduplication;
- alert on unroutable.

---

## 18.2 Broker Failure

Pertanyaan:

- Queue type apa yang dipakai?
- Apakah queue replicated?
- Apakah node yang memegang queue mati?
- Apakah cluster masih punya majority?
- Apakah disk penuh?
- Apakah memory alarm aktif?
- Apakah client bisa reconnect?
- Apakah topology dideklarasikan ulang dengan aman?

Mitigasi umum:

- quorum queues untuk critical queue;
- cluster design;
- disk/memory alert;
- connection recovery;
- topology idempotent declaration;
- runbook node failure.

---

## 18.3 Consumer Failure

Pertanyaan:

- Apa yang terjadi jika consumer crash saat memproses message?
- Apakah message sudah di-ack?
- Apakah business transaction sudah commit?
- Apakah duplicate aman?
- Apakah retry punya batas?
- Apakah poison message akan memblokir queue?

Mitigasi umum:

- manual ack;
- ack after commit;
- idempotent handler;
- DLQ;
- delivery limit;
- retry with delay;
- parking lot;
- graceful shutdown.

---

## 18.4 Downstream Failure

Pertanyaan:

- Apa yang terjadi jika database lambat?
- Apa yang terjadi jika external API down?
- Apa yang terjadi jika rate limit tercapai?
- Apa yang terjadi jika dependency mengembalikan 400 vs 500?
- Apakah error transient atau permanent?

Mitigasi umum:

- classify error;
- retry only transient;
- do not requeue immediately forever;
- circuit breaker;
- delayed retry;
- DLQ permanent error;
- alert.

---

## 18.5 Message Failure

Pertanyaan:

- Apa yang terjadi jika payload invalid?
- Apa yang terjadi jika schema version tidak didukung?
- Apa yang terjadi jika required entity tidak ada?
- Apa yang terjadi jika business invariant dilanggar?
- Apakah message harus dead-letter atau ignored?

Mitigasi umum:

- validation;
- schema version handling;
- DLQ invalid message;
- poison message tracking;
- remediation UI/process;
- contract tests.

---

## 19. RabbitMQ dalam Clean Architecture / Hexagonal Architecture

Dalam Java service, RabbitMQ sebaiknya tidak bocor ke domain core.

Struktur yang sehat:

```text
application/domain layer
  - command handler
  - domain service
  - state transition
  - business invariant

adapter/inbound/rabbitmq
  - listener
  - message deserialization
  - ack/nack integration
  - error classification

adapter/outbound/rabbitmq
  - publisher
  - exchange/routing metadata
  - confirm handling

infrastructure
  - connection factory
  - RabbitTemplate
  - listener container
  - topology declaration
```

Consumer RabbitMQ jangan langsung menjadi tempat business logic penuh.

Lebih baik:

```java
@RabbitListener(...)
public void onMessage(Message message, Channel channel) {
    // deserialize
    // validate
    // call application service
    // ack/nack based on result
}
```

Business logic tetap di application service:

```java
caseWorkflowService.handleEvidenceSubmitted(command);
```

Ini membuat sistem:

- lebih testable;
- tidak terikat transport;
- lebih mudah migrasi;
- failure handling lebih eksplisit;
- domain invariant lebih terjaga.

---

## 20. What We Will Not Do in This Series

Agar efisien dan tidak mengulang materi sebelumnya, seri ini tidak akan mengulang secara panjang:

- dasar HTTP;
- dasar REST;
- dasar SQL;
- indexing database umum;
- dasar Docker secara generik;
- dasar Kafka internals;
- teori distributed systems umum yang sudah dibahas di seri Kafka;
- generic microservices hype;
- tutorial “hello world” tanpa reasoning;
- copy-paste Spring Boot configuration tanpa failure model.

Kita akan membahas hal-hal itu hanya jika langsung relevan dengan RabbitMQ.

---

## 21. Learning Roadmap Setelah Part 00

Setelah part ini, urutan belajar akan seperti ini:

1. memahami messaging fundamentals spesifik RabbitMQ;
2. memahami AMQP 0-9-1 model;
3. menguasai exchange routing;
4. memahami queue semantics;
5. menjalankan local lab;
6. memakai Java client raw;
7. menambahkan reliability producer;
8. menambahkan reliability consumer;
9. mendesain retry/DLQ;
10. memakai Spring AMQP;
11. mendesain contract;
12. memahami ordering/concurrency;
13. masuk ke RabbitMQ Streams;
14. masuk ke quorum queues;
15. masuk ke clustering/operations;
16. membangun case study end-to-end.

Urutan ini sengaja dibuat dari mental model → primitive → reliability → integration → operations → architecture.

---

## 22. First Principles Checklist

Sebelum mendesain flow RabbitMQ, jawab checklist ini.

### Message Intent

- Apakah ini command, event, notification, task, request, atau audit record?
- Apakah message merepresentasikan intent atau fact?
- Siapa owner contract message ini?

### Routing

- Producer publish ke exchange apa?
- Routing key-nya apa?
- Queue mana yang menerima?
- Apakah routing perlu direct, fanout, topic, atau header?
- Apakah producer terlalu tahu consumer?

### Storage Semantics

- Queue type apa?
- Apakah butuh replication?
- Apakah butuh replay?
- Apakah message boleh hilang?
- Apakah message harus persistent?

### Processing Semantics

- Berapa consumer?
- Apakah ordering penting?
- Apakah handler idempotent?
- Kapan ack dilakukan?
- Apa yang terjadi jika consumer crash?

### Failure Handling

- Error mana yang retryable?
- Error mana yang permanent?
- Apakah retry punya delay?
- Apakah retry punya max attempt?
- Apakah ada DLQ?
- Apakah ada parking lot?
- Siapa yang memonitor DLQ?

### Observability

- Apa correlation id-nya?
- Apa metric pentingnya?
- Apa alert-nya?
- Bagaimana menemukan message bermasalah?
- Bagaimana merekonstruksi incident?

### Evolution

- Bagaimana schema versioning?
- Bagaimana menambah subscriber baru?
- Bagaimana migrasi queue?
- Bagaimana rolling deployment consumer?
- Bagaimana backward compatibility?

Jika kamu tidak bisa menjawab checklist ini, desain RabbitMQ-nya belum matang.

---

## 23. Mini Case: Salah dan Benar

## 23.1 Desain naif

```text
case-api -> publish JSON to queue "caseQueue"
worker -> auto-ack -> process -> call external API
```

Masalah:

- producer tightly coupled ke queue;
- tidak ada exchange routing design;
- queue name generik;
- auto-ack berisiko message loss;
- tidak ada DLQ;
- tidak ada retry strategy;
- tidak ada idempotency;
- tidak ada message id;
- tidak ada schema version;
- tidak ada observability;
- external API failure bisa menyebabkan loss atau silent failure;
- sulit menambah subscriber lain.

---

## 23.2 Desain lebih matang

```text
case-api
  -> DB transaction creates case
  -> writes outbox record CaseOpened

outbox-relay
  -> publishes to exchange case.events
  -> routing key case.opened
  -> waits publisher confirm

exchange case.events topic
  -> queue rule-engine.case-opened      binding case.opened
  -> queue notification.case-events     binding case.*
  -> stream audit.case-events           binding case.# or stream bridge

rule-engine.case-opened quorum queue
  -> manual ack consumer
  -> idempotent processing by messageId/caseId
  -> publishes RuleEvaluationCompleted
  -> retry transient failure with delayed retry
  -> DLQ permanent failure

notification.case-events quorum queue
  -> sends user notification
  -> backoff retry for external provider failure
  -> parking lot after max attempts

audit.case-events stream
  -> retention 30/90/365 days depending policy
  -> replayable for audit projection rebuild
```

Keuntungan:

- producer tidak tahu semua consumer;
- routing extensible;
- critical queues replicated;
- stream dipakai untuk replay/audit;
- retry eksplisit;
- DLQ/parking lot jelas;
- idempotency dirancang;
- publisher confirm menutup sebagian failure window;
- outbox mengurangi risiko DB commit tanpa publish;
- observability bisa dibangun dari metadata.

---

## 24. RabbitMQ Decision Heuristics Awal

Gunakan heuristik berikut sebagai pegangan awal.

1. Jika message adalah **command penting**, mulai dari quorum queue.
2. Jika message adalah **event notification ke banyak service**, mulai dari topic exchange + queue per subscriber.
3. Jika butuh **replay/history**, pertimbangkan stream.
4. Jika butuh **high-throughput event streaming lintas banyak tim**, bandingkan serius dengan Kafka.
5. Jika consumer melakukan side effect, asumsikan duplicate mungkin terjadi.
6. Jika duplicate berbahaya, desain idempotency sebelum go-live.
7. Jika retry tidak punya batas, itu bukan reliability; itu incident generator.
8. Jika DLQ tidak dimonitor, DLQ hanya tempat menyembunyikan kerusakan.
9. Jika queue terus tumbuh, jangan hanya tambah broker; cari bottleneck consumer/downstream.
10. Jika ordering penting, jangan sembarang menambah consumer concurrency.
11. Jika message besar, kirim reference, bukan file.
12. Jika producer harus tahu semua consumer, topology-mu mungkin salah.
13. Jika queue name generik seperti `events` atau `tasks`, operability akan buruk.
14. Jika tidak ada correlation id, incident forensic akan mahal.
15. Jika memakai RabbitMQ hanya untuk synchronous RPC, evaluasi ulang apakah HTTP/gRPC lebih tepat.

---

## 25. Glossary Awal

**Producer**  
Aplikasi yang publish message ke RabbitMQ.

**Consumer**  
Aplikasi yang menerima atau membaca message dari RabbitMQ.

**Exchange**  
Router message dalam AMQP 0-9-1.

**Queue**  
Buffer/storage yang menyimpan message sampai delivered dan acknowledged.

**Binding**  
Relasi/rule antara exchange dan queue.

**Routing Key**  
String routing yang dikirim producer bersama message.

**Binding Key**  
Pattern/key pada binding yang dipakai exchange untuk routing.

**Ack**  
Acknowledgement bahwa consumer berhasil memproses message.

**Nack**  
Negative acknowledgement; message gagal dan bisa requeue/dead-letter.

**DLX**  
Dead-letter exchange, exchange tujuan message yang gagal/expired/rejected.

**DLQ**  
Dead-letter queue, queue tempat message gagal dikumpulkan.

**Prefetch**  
Jumlah message unacked yang boleh dikirim broker ke consumer.

**Publisher Confirm**  
Mekanisme broker memberi acknowledgement ke publisher bahwa message telah diterima/ditangani oleh broker sesuai semantics.

**Quorum Queue**  
Replicated durable queue berbasis Raft.

**Stream**  
Append-only replicated log di RabbitMQ dengan retention dan replay.

**Vhost**  
Namespace/logical isolation boundary dalam RabbitMQ.

**Policy**  
Aturan konfigurasi RabbitMQ yang diterapkan ke resource berdasarkan pattern.

---

## 26. Latihan Berpikir

Sebelum lanjut ke part 01, coba jawab pertanyaan ini untuk sistemmu sendiri.

1. Sebutkan tiga proses background yang saat ini lebih cocok sebagai command queue.
2. Sebutkan tiga domain event yang layak dipublish ke topic exchange.
3. Untuk tiap event, siapa subscriber-nya?
4. Apakah subscriber butuh message lengkap atau hanya notification untuk fetch data?
5. Message mana yang critical dan seharusnya masuk quorum queue?
6. Message mana yang butuh replay dan mungkin cocok menjadi stream?
7. Apa failure paling berbahaya: producer gagal publish, consumer duplicate, downstream timeout, atau poison message?
8. Bagaimana cara membuktikan bahwa satu case transition tidak diproses dua kali?
9. Apa alert pertama yang harus dibuat setelah RabbitMQ go-live?
10. Apa yang harus terjadi jika DLQ berisi 10.000 message dalam 10 menit?

Jika jawaban pertanyaan ini belum jelas, jangan buru-buru menulis listener.

---

## 27. Ringkasan Part 00

Di part ini kita membangun fondasi:

- RabbitMQ adalah messaging and streaming broker, bukan hanya queue sederhana.
- RabbitMQ berbeda dari Kafka karena pusat gravitasinya adalah brokered routing, queue delivery, acknowledgement, dan workflow/task distribution.
- Model inti AMQP 0-9-1 adalah producer → exchange → binding → queue → consumer.
- RabbitMQ modern memiliki classic queues, quorum queues, dan streams dengan semantics berbeda.
- Command, event, notification, task, request/reply, dan audit message harus dibedakan.
- Reliability tidak datang dari satu fitur, tetapi dari kombinasi publisher confirm, durable/persistent configuration, queue type, manual ack, idempotency, retry, DLQ, dan observability.
- Retry yang salah bisa memperparah incident.
- Consumer harus diasumsikan bisa menerima duplicate.
- Topology design adalah bagian dari arsitektur, bukan detail konfigurasi.
- Untuk sistem regulasi/case management, RabbitMQ sangat berguna sebagai command/event/workflow transport, tetapi state bisnis utama tetap harus dikelola dengan jelas.

---

## 28. Apa yang Akan Dibahas di Part 01

Part berikutnya:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-01.md
```

Topik:

# Messaging Fundamentals yang Spesifik RabbitMQ

Kita akan masuk lebih dalam ke:

- queue vs broker vs log;
- push delivery vs pull consumption;
- message ownership;
- acknowledgement sebagai state transition;
- redelivery semantics;
- ordering dan concurrency;
- queue sebagai backpressure boundary;
- failure modelling detail;
- kapan RabbitMQ membuat sistem lebih baik dan kapan justru memperburuk sistem.

---

## 29. Status Seri

Seri belum selesai.

Progress saat ini:

```text
[x] part-00 — Orientation, Mental Model, dan Scope RabbitMQ Modern
[ ] part-01 — Messaging Fundamentals yang Spesifik RabbitMQ
[ ] part-02 — AMQP 0-9-1 Deep Dive
[ ] part-03 — Exchange Routing Mastery
[ ] part-04 — Queue Semantics: Classic, Quorum, Stream
[ ] part-05 — Hands-on Local Lab
[ ] part-06 — Java Client Fundamentals tanpa Spring
[ ] part-07 — Publisher Reliability
[ ] part-08 — Consumer Reliability
[ ] part-09 — Retry, Dead Lettering, Poison Message
[ ] part-10 — Spring AMQP Deep Dive
[ ] part-11 — Spring Boot Integration Patterns
[ ] part-12 — Message Contract Design
[ ] part-13 — Ordering, Concurrency, Partitioning
[ ] part-14 — RPC, Request/Reply
[ ] part-15 — Workflow, Saga, Enforcement Lifecycle
[ ] part-16 — RabbitMQ Streams Mental Model
[ ] part-17 — RabbitMQ Stream Java Client
[ ] part-18 — Super Streams
[ ] part-19 — Stream Deduplication, Filtering, Replay
[ ] part-20 — Quorum Queues Deep Dive
[ ] part-21 — Flow Control and Backpressure
[ ] part-22 — Clustering and Network Partitions
[ ] part-23 — Federation, Shovel, Multi-Region
[ ] part-24 — Security
[ ] part-25 — Observability
[ ] part-26 — Performance Engineering
[ ] part-27 — Production Topology Design Patterns
[ ] part-28 — Anti-Patterns and Failure Case Studies
[ ] part-29 — Testing Strategy
[ ] part-30 — Migration and Refactoring
[ ] part-31 — Architecture Decision Framework
[ ] part-32 — End-to-End Case Study
[ ] part-33 — Production Runbook
[ ] part-34 — Mastery Review
```

---

## 30. Referensi Utama

Referensi yang dipakai sebagai baseline resmi dan teknis:

- RabbitMQ Documentation — https://www.rabbitmq.com/docs
- RabbitMQ AMQP 0-9-1 Model Explained — https://www.rabbitmq.com/tutorials/amqp-concepts
- RabbitMQ Queues — https://www.rabbitmq.com/docs/queues
- RabbitMQ Classic Queues — https://www.rabbitmq.com/docs/classic-queues
- RabbitMQ Quorum Queues — https://www.rabbitmq.com/docs/quorum-queues
- RabbitMQ Streams and Superstreams — https://www.rabbitmq.com/docs/streams
- RabbitMQ Publishers — https://www.rabbitmq.com/docs/publishers
- RabbitMQ Java Tutorial — https://www.rabbitmq.com/tutorials/tutorial-one-java
- RabbitMQ 4.3 Release Highlights — https://www.rabbitmq.com/blog/2026/04/23/rabbitmq-4.3-release
- Spring AMQP Reference — https://docs.spring.io/spring-amqp/reference/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-01.md">Part 01 — Messaging Fundamentals yang Spesifik RabbitMQ ➡️</a>
</div>

# learn-aws-cloud-architecture-mastery-for-java-engineers-part-014.md

# Part 014 — Event Integration on AWS: SQS, SNS, EventBridge, Kinesis, Step Functions

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS sebagai platform produksi  
> Fokus part ini: memilih dan merancang primitive integrasi event/message/workflow AWS dengan benar, tanpa mengulang teori Kafka/RabbitMQ yang sudah dipelajari

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda diharapkan mampu:

1. Membedakan secara tegas kapan memakai **queue**, **pub/sub**, **event bus**, **stream**, dan **workflow orchestration**.
2. Menjelaskan perbedaan SQS, SNS, EventBridge, Kinesis, dan Step Functions dari sisi semantics, delivery, ordering, retry, failure, dan observability.
3. Mendesain integrasi antar Java service yang tahan terhadap duplicate event, poison message, retry storm, partial failure, dan downstream outage.
4. Menentukan kapan AWS-native integration cukup, kapan harus memakai MSK/Kafka, dan kapan desain event-driven justru berlebihan.
5. Membuat kontrak event yang defensible untuk sistem regulated, audit-heavy, dan workflow-heavy seperti enforcement lifecycle atau case management platform.
6. Mengimplementasikan consumer Java yang production-ready: idempotent, observable, bounded, backpressure-aware, dan recoverable.

Bagian ini sengaja tidak mengulang detail broker internals Kafka/RabbitMQ yang sudah Anda pelajari. Fokusnya adalah **AWS integration architecture**: kontrak, boundary, failure mode, dan pilihan primitive.

---

## 1. Mental Model: Integration Primitive Bukan Sekadar “Event”

Banyak sistem cloud gagal bukan karena salah memilih database atau compute, tetapi karena semua komunikasi dipukul rata sebagai “event”. Padahal setiap primitive integrasi membawa semantics berbeda.

Secara sederhana:

| Primitive | Pertanyaan Utama | Cocok Untuk | Risiko Jika Salah Pakai |
|---|---|---|---|
| Queue | “Ada work item yang harus diproses worker?” | buffering, decoupling, load leveling | duplicate processing, poison message, stuck visibility |
| Pub/Sub | “Satu perubahan perlu diberitahukan ke banyak subscriber?” | fanout notification | subscriber gagal sebagian, contract menyebar liar |
| Event Bus | “Ada domain event yang perlu dirutekan berdasarkan rule?” | event-driven integration antar domain/team | event taxonomy kacau, ownership kabur |
| Stream | “Ada ordered append log yang perlu dibaca banyak consumer dalam waktu tertentu?” | high-throughput ingestion, analytics, replay terbatas | shard hot, consumer lag, retention salah |
| Workflow | “Ada proses bisnis multi-step yang perlu state, retry, timeout, compensation?” | orchestration, saga, approval, long-running process | state tersembunyi di banyak service jika tidak dipakai |

Kuncinya: **event integration bukan hanya transport**. Ia menentukan:

- siapa pemilik state;
- siapa bertanggung jawab retry;
- bagaimana ordering dijamin atau tidak;
- bagaimana duplicate ditangani;
- bagaimana failure terlihat;
- bagaimana audit dilakukan;
- bagaimana perubahan kontrak dikelola;
- bagaimana biaya tumbuh saat volume naik.

Top engineer tidak bertanya, “pakai SQS atau EventBridge?” terlebih dahulu. Ia bertanya:

1. Apakah ini command, event, notification, job, stream record, atau workflow transition?
2. Apakah konsumen harus memproses semua item, sebagian item, atau hanya latest state?
3. Apakah ordering penting secara global, per entity, atau tidak penting?
4. Apakah pemrosesan boleh duplicate?
5. Berapa lama event harus bisa di-replay?
6. Siapa pemilik schema?
7. Siapa yang membayar cost fanout dan retry?
8. Bagaimana kita tahu bahwa event tidak hilang secara operasional?

---

## 2. Vocabulary: Command, Event, Message, Notification, Job, Stream Record, Workflow State

Sebelum masuk service AWS, luruskan istilah.

### 2.1 Command

Command adalah instruksi untuk melakukan sesuatu.

Contoh:

```text
ApproveCaseCommand
GenerateInvoiceCommand
SuspendAccountCommand
```

Karakteristik:

- biasanya imperative;
- biasanya punya satu target handler;
- caller mengharapkan efek tertentu;
- gagal/suksesnya penting;
- sering butuh idempotency key;
- cocok masuk queue jika asynchronous.

Command buruk jika disebar sebagai broadcast event, karena consumer tidak tahu siapa yang wajib bertindak.

### 2.2 Event

Event adalah fakta bahwa sesuatu sudah terjadi.

Contoh:

```text
CaseApproved
InvoiceGenerated
AccountSuspended
DocumentUploaded
```

Karakteristik:

- past tense;
- tidak memerintah consumer;
- bisa dikonsumsi banyak pihak;
- publisher tidak semestinya tahu semua consumer;
- event harus cukup stabil sebagai kontrak domain.

Event buruk jika dipakai untuk menyembunyikan command. Misalnya `UserNeedsEmailSent` terdengar seperti event tetapi sebenarnya command.

### 2.3 Notification

Notification adalah sinyal ringan bahwa sesuatu berubah.

Contoh:

```text
CaseChanged
DocumentAvailable
CacheInvalidationRequested
```

Karakteristik:

- payload bisa minimal;
- consumer mungkin harus fetch state terbaru;
- cocok untuk SNS atau EventBridge;
- tidak selalu menjadi source of truth.

### 2.4 Job / Work Item

Job adalah unit kerja yang harus diproses.

Contoh:

```text
RenderPdfJob
SendReminderEmailJob
IndexCaseDocumentJob
```

Karakteristik:

- perlu worker;
- bisa retry;
- perlu DLQ;
- cocok dengan SQS;
- completion bisa menghasilkan event.

### 2.5 Stream Record

Stream record adalah entry dalam ordered append log.

Contoh:

```json
{
  "partitionKey": "tenant-123",
  "sequence": "...",
  "payload": {...}
}
```

Karakteristik:

- throughput tinggi;
- ordering biasanya per partition/shard;
- retention terbatas;
- consumer bisa membaca ulang dalam window retention;
- cocok untuk Kinesis.

### 2.6 Workflow State

Workflow state adalah state eksplisit dari proses multi-step.

Contoh:

```text
CaseReviewStarted -> EvidenceValidated -> SupervisorApprovalPending -> EnforcementNoticeIssued
```

Karakteristik:

- ada state machine;
- ada timeout;
- ada retry;
- ada compensation;
- perlu audit trail;
- cocok dengan Step Functions atau workflow engine lain.

---

## 3. AWS Integration Services: Peta Besar

Part ini fokus pada lima primitive utama.

| Service | Mental Model | Core Use Case |
|---|---|---|
| SQS | durable queue | decouple producer-worker, buffer workload |
| SNS | pub/sub topic | fanout notification ke banyak subscriber |
| EventBridge | event bus + rule router | domain/integration event routing |
| Kinesis Data Streams | ordered streaming log | high-throughput ingestion, near-real-time processing |
| Step Functions | managed state machine | orchestrate multi-step workflows |

Tambahan service yang sering terkait tetapi bukan fokus utama:

- Lambda event source mapping;
- ECS/Fargate workers;
- EventBridge Scheduler;
- EventBridge Pipes;
- CloudWatch Logs/metrics;
- DynamoDB Streams;
- S3 event notification;
- MSK untuk Kafka-compatible workloads.

---

## 4. SQS: Durable Queue untuk Work Items dan Load Leveling

### 4.1 Mental Model SQS

Amazon SQS adalah managed message queue. Producer mengirim message ke queue. Consumer mengambil message, memproses, lalu menghapus message. Message tidak otomatis hilang saat dibaca; ia hanya menjadi tidak terlihat selama **visibility timeout**.

Flow dasar:

```text
Producer -> SendMessage -> SQS queue -> ReceiveMessage -> Worker -> DeleteMessage
                                      \-> visibility timeout
                                      \-> retry if not deleted
                                      \-> DLQ if maxReceiveCount exceeded
```

SQS cocok untuk:

- asynchronous background processing;
- worker pool;
- buffering saat downstream lambat;
- decoupling producer dan consumer;
- smoothing traffic spike;
- retryable task;
- Lambda/ECS worker trigger.

SQS bukan pilihan terbaik untuk:

- complex routing banyak subscriber;
- event discovery antar domain;
- ordered replay stream jangka panjang;
- workflow multi-step yang perlu state eksplisit;
- low-latency synchronous command.

### 4.2 Standard Queue vs FIFO Queue

| Tipe | Karakteristik | Cocok Untuk |
|---|---|---|
| Standard | very high throughput, at-least-once, best-effort ordering | mayoritas workload async |
| FIFO | ordering per message group, deduplication window, throughput lebih terbatas | workflow per entity yang butuh ordering |

Standard queue bisa mengirim duplicate. FIFO juga tetap perlu idempotency secara desain, walaupun ada deduplication semantics, karena distributed system tidak boleh bergantung pada ilusi exactly-once end-to-end.

### 4.3 Visibility Timeout

Visibility timeout adalah salah satu konsep paling penting di SQS.

Saat worker menerima message:

1. message masih ada di queue;
2. message tidak terlihat oleh consumer lain selama visibility timeout;
3. jika worker sukses, worker memanggil `DeleteMessage`;
4. jika worker gagal/crash/tidak delete, message muncul lagi setelah timeout;
5. receive count naik;
6. jika receive count melewati threshold, message dipindahkan ke DLQ.

Kesalahan umum:

- visibility timeout lebih pendek dari waktu proses;
- worker memproses 5 menit, visibility timeout 30 detik;
- message muncul lagi dan diproses paralel;
- terjadi duplicate side effect.

Rule praktis:

```text
visibility_timeout >= worst_case_processing_time + retry/delete margin
```

Untuk proses yang durasinya tidak pasti, worker perlu memperpanjang visibility timeout secara eksplisit atau memecah pekerjaan menjadi unit lebih kecil.

### 4.4 Long Polling

Long polling mengurangi empty receive dan cost. Worker menunggu beberapa detik sampai message tersedia.

Untuk Java worker, gunakan long polling daripada polling agresif 100ms yang membuat biaya, noise metric, dan CPU meningkat.

Pseudo-config:

```text
ReceiveMessageWaitTimeSeconds = 10-20 seconds
MaxNumberOfMessages = sesuai batch size
VisibilityTimeout = sesuai processing budget
```

### 4.5 DLQ: Dead-Letter Queue

DLQ bukan tempat sampah. DLQ adalah **failure evidence queue**.

Message masuk DLQ ketika gagal diproses setelah beberapa percobaan.

DLQ harus punya:

- alarm ketika ada message masuk;
- retention cukup panjang untuk investigasi;
- runbook triage;
- redrive strategy;
- payload aman dari data sensitif berlebihan;
- correlation id;
- failure reason di log, bukan hanya di message.

Anti-pattern:

```text
DLQ dibuat tetapi tidak pernah dimonitor.
```

Itu sama saja dengan silent data loss yang ditunda.

### 4.6 Poison Message

Poison message adalah message yang selalu gagal karena payload invalid, state tidak konsisten, dependency tidak tersedia permanen, atau bug consumer.

Contoh:

```json
{
  "caseId": "C-123",
  "eventType": "GenerateNotice",
  "templateId": "deleted-template"
}
```

Jika tidak dikelola, poison message menyebabkan:

- retry loop;
- cost meningkat;
- queue lag;
- worker capacity habis;
- valid messages tertunda;
- DLQ penuh.

Pattern:

1. Validate payload early.
2. Classify error: transient vs permanent.
3. Permanent error jangan retry terlalu lama.
4. Kirim ke DLQ dengan observability cukup.
5. Buat redrive tooling yang aman.

### 4.7 Idempotency untuk SQS Consumer

Karena SQS menggunakan at-least-once delivery, consumer harus idempotent.

Idempotency berarti message yang sama diproses lebih dari sekali tetapi efek akhirnya tetap benar.

Contoh buruk:

```text
Message: SendPenaltyNotice(caseId=C-123)
Consumer: insert notice row + send email
Duplicate: insert notice row kedua + send email kedua
```

Contoh lebih baik:

```text
idempotencyKey = commandId / eventId / business key
consumer:
  if key already processed -> return success
  else execute side effect in controlled transaction
  mark key processed
```

Di AWS, idempotency store sering memakai DynamoDB conditional write atau relational unique constraint.

### 4.8 Java SQS Worker Pattern

Consumer Java yang baik harus memperhatikan:

- batch receive;
- bounded concurrency;
- visibility timeout;
- delete hanya setelah sukses;
- partial failure;
- structured logging;
- idempotency;
- graceful shutdown;
- backpressure ke downstream;
- metrics per outcome.

Pseudo-flow:

```java
while (running) {
    ReceiveMessageResponse response = sqs.receiveMessage(r -> r
        .queueUrl(queueUrl)
        .maxNumberOfMessages(10)
        .waitTimeSeconds(20)
        .visibilityTimeout(120)
    );

    for (Message message : response.messages()) {
        executor.submit(() -> {
            try {
                WorkItem item = parse(message.body());
                processIdempotently(item);
                sqs.deleteMessage(d -> d
                    .queueUrl(queueUrl)
                    .receiptHandle(message.receiptHandle())
                );
            } catch (PermanentBusinessException e) {
                logPermanentFailure(message, e);
                // allow receive count to move it to DLQ, or route explicitly
                // depending on policy
            } catch (Exception e) {
                logTransientFailure(message, e);
                // do not delete; message will return after visibility timeout
            }
        });
    }
}
```

Production detail:

- jangan parse payload setelah melakukan side effect;
- jangan delete sebelum side effect selesai;
- jangan retry internal terlalu lama sampai visibility timeout habis;
- jangan log seluruh payload jika mengandung PII;
- jangan membuat thread unbounded.

---

## 5. SNS: Pub/Sub Topic untuk Fanout Notification

### 5.1 Mental Model SNS

Amazon SNS adalah pub/sub notification service. Publisher mengirim message ke topic. Topic mengirim message ke subscriber.

Subscriber bisa berupa:

- SQS queue;
- Lambda;
- HTTP/S endpoint;
- email/SMS/mobile push;
- Firehose, tergantung integrasi.

Pattern paling umum dan sehat untuk backend:

```text
Publisher -> SNS Topic -> SQS Queue per subscriber -> Consumer service
```

Mengapa SNS -> SQS sering lebih baik daripada SNS -> Lambda langsung?

Karena SQS memberi buffer, DLQ, visibility timeout, retry control, dan isolasi subscriber. Jika satu subscriber lambat/gagal, subscriber lain tidak terdampak.

### 5.2 Fanout

SNS cocok ketika satu event perlu diketahui banyak sistem.

Contoh:

```text
CaseApproved
  -> notification service sends email
  -> audit service records event
  -> analytics service updates projection
  -> search service indexes case
```

Publisher tidak perlu tahu subscriber. Ini mengurangi coupling.

Namun fanout membawa risiko:

- event contract menjadi dependency banyak tim;
- payload sulit diubah;
- failure tiap subscriber berbeda;
- debugging end-to-end lebih sulit;
- event volume dikalikan jumlah subscriber.

### 5.3 SNS Filtering

SNS subscription filter policy memungkinkan subscriber menerima subset message berdasarkan attributes.

Contoh:

```json
{
  "eventType": ["CaseApproved", "CaseRejected"],
  "tenantTier": ["REGULATED", "ENTERPRISE"]
}
```

Filtering berguna untuk mengurangi noise, tetapi jangan menyembunyikan domain model yang buruk. Jika semua consumer memakai filter aneh, mungkin topic terlalu generik.

### 5.4 Topic Design

Pilihan desain topic:

1. Topic per domain.
2. Topic per event category.
3. Topic per environment.
4. Topic per tenant tier.
5. Topic per sensitivity level.

Contoh:

```text
prod-case-domain-events
prod-document-domain-events
prod-notification-events
```

Hindari:

```text
prod-all-events
```

Topic terlalu besar membuat filtering, security, schema evolution, dan audit menjadi sulit.

### 5.5 SNS FIFO

SNS FIFO dapat dipakai bersama SQS FIFO untuk fanout yang perlu ordering dan deduplication per message group.

Gunakan hanya jika ordering memang requirement. Ordering global biasanya mahal dan membatasi throughput. Lebih sering ordering yang benar adalah **per aggregate/entity**, misalnya per `caseId`.

### 5.6 Failure Mode SNS

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Subscriber gagal | Lambda/downstream error | SQS subscriber, DLQ, alarm |
| Payload terlalu besar | event membawa data berlebihan | store body di S3, kirim reference |
| Filter salah | message tidak terkirim ke subscriber | contract test, IaC review |
| Fanout liar | terlalu banyak subscriber tidak terkontrol | event catalog, ownership, schema governance |
| PII tersebar | payload mengandung data sensitif | minimal payload, classification, encryption |

---

## 6. EventBridge: Event Bus dan Rule-Based Routing

### 6.1 Mental Model EventBridge

Amazon EventBridge adalah event bus yang menerima event dan merutekannya ke target berdasarkan rule pattern.

Flow:

```text
Producer -> EventBridge Bus -> Rule Pattern -> Target(s)
```

EventBridge cocok untuk:

- domain event routing;
- SaaS/event integration;
- cross-account event delivery;
- decoupling antar domain/team;
- event filtering berdasarkan structure;
- scheduled events;
- lightweight integration glue.

EventBridge kurang cocok untuk:

- high-throughput stream analytics;
- queue worker dengan visibility semantics;
- strict per-message processing control;
- long-running business workflow tanpa state machine;
- large payload transfer.

### 6.2 Event Structure

EventBridge event umumnya memiliki struktur:

```json
{
  "source": "com.example.case",
  "detail-type": "CaseApproved",
  "detail": {
    "caseId": "C-123",
    "tenantId": "T-456",
    "approvedBy": "user-789",
    "approvedAt": "2026-06-20T10:15:30Z"
  }
}
```

Field penting:

- `source`: domain/system owner;
- `detail-type`: tipe event;
- `detail`: payload domain;
- `time`: waktu event diterima/dikirim;
- `id`: event id.

Naming yang baik:

```text
source      = com.company.case-management
 detail-type = CaseApproved
```

Naming yang buruk:

```text
source      = backend
 detail-type = update
```

### 6.3 Rule Pattern

Rule pattern menentukan event mana yang cocok.

Contoh:

```json
{
  "source": ["com.company.case-management"],
  "detail-type": ["CaseApproved"],
  "detail": {
    "riskLevel": ["HIGH", "CRITICAL"]
  }
}
```

Rule pattern adalah bagian dari contract. Jika event producer mengubah field `riskLevel` menjadi `severity`, subscriber bisa diam-diam tidak menerima event.

Karena itu perlu:

- event schema governance;
- contract test;
- deployment coordination;
- observability untuk matched/failed invocation;
- archive/replay jika perlu recovery.

### 6.4 EventBridge Archive and Replay

EventBridge dapat mengarsipkan event dan replay ke bus. Ini berguna untuk:

- recovery dari bug consumer;
- backfill projection;
- testing rule baru;
- audit investigation terbatas.

Namun archive/replay bukan pengganti event store permanen. Untuk audit legal/regulatory, biasanya event juga disimpan di durable audit store seperti S3 Object Lock, database audit table, atau dedicated event log.

### 6.5 Cross-Account EventBridge

EventBridge kuat untuk multi-account architecture.

Contoh:

```text
Workload Account A -> central audit event bus in Security/Log Account
Workload Account B -> central audit event bus in Security/Log Account
```

Manfaat:

- central audit;
- cross-domain integration;
- blast radius lebih terkendali;
- account boundary tetap dipertahankan.

Risiko:

- policy bus salah;
- event sensitif bocor antar account;
- routing loop;
- ownership rule tidak jelas.

### 6.6 EventBridge Scheduler

EventBridge Scheduler cocok untuk scheduled invocation:

- run job harian;
- trigger reminder;
- delayed workflow step;
- one-time schedule.

Namun untuk workflow kompleks dengan state, retry, dan branching, Step Functions lebih tepat.

### 6.7 EventBridge Pipes

EventBridge Pipes membantu menghubungkan source ke target dengan filtering/enrichment sederhana.

Contoh:

```text
SQS -> EventBridge Pipe -> Lambda/ECS/Step Functions
DynamoDB Stream -> Pipe -> EventBridge bus
Kinesis -> Pipe -> target
```

Gunakan Pipes untuk mengurangi glue code, tetapi jangan sampai business logic penting tersembunyi di konfigurasi yang sulit dites.

### 6.8 Failure Mode EventBridge

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Event tidak match rule | schema berubah, pattern salah | contract test, metric matched events |
| Target gagal | target permission/error | DLQ, retry policy, alarm |
| Event terlalu besar | payload berlebihan | payload reference pattern |
| Bus policy bocor | cross-account terlalu broad | least privilege, SCP, review |
| Event taxonomy kacau | source/detail-type tidak konsisten | event catalog, governance |
| Replay menyebabkan side effect ulang | consumer tidak idempotent | idempotency wajib |

---

## 7. Kinesis Data Streams: Ordered Streaming Log untuk High-Throughput Ingestion

### 7.1 Mental Model Kinesis

Kinesis Data Streams adalah append-only stream yang terdiri dari shards. Producer menulis records dengan partition key. Consumer membaca records dari shard dalam urutan sequence.

Flow:

```text
Producer -> PutRecord(partitionKey) -> Stream -> Shard -> Consumer(s)
```

Kinesis cocok untuk:

- telemetry ingestion;
- clickstream;
- near-real-time analytics;
- log/event stream high throughput;
- ordered processing per partition key;
- multiple consumers membaca stream yang sama;
- replay dalam retention window.

Kinesis kurang cocok untuk:

- simple background job;
- low-volume domain event routing;
- long-running process orchestration;
- command queue dengan DLQ semantics sederhana;
- indefinite event retention sebagai audit ledger.

### 7.2 Shard dan Partition Key

Partition key menentukan shard target. Ordering dijamin di dalam shard, bukan seluruh stream.

Jika partition key buruk, terjadi hot shard.

Contoh buruk:

```text
partitionKey = tenantId
```

Jika satu tenant sangat besar, satu shard panas.

Contoh lebih baik tergantung requirement:

```text
partitionKey = tenantId + '#' + hash(entityId)
```

Tetapi jika ordering per `caseId` penting:

```text
partitionKey = caseId
```

Trade-off:

- ordering lebih kuat -> distribusi bisa lebih buruk;
- distribusi lebih baik -> ordering per entity mungkin hilang;
- desain partition key selalu domain-specific.

### 7.3 Consumer Lag

Consumer lag menunjukkan consumer tertinggal dari producer.

Penyebab:

- throughput consumer kurang;
- downstream lambat;
- batch terlalu besar/kecil;
- hot shard;
- error/retry loop;
- consumer checkpoint tidak maju.

Lag bukan hanya metric teknis. Dalam sistem bisnis, lag berarti state downstream makin stale.

Contoh:

```text
Case event stream lag 30 menit
-> search index stale
-> officer melihat data lama
-> keputusan operasional salah
```

### 7.4 Kinesis Client Library

Untuk Java, Kinesis Client Library membantu:

- shard lease coordination;
- checkpointing;
- reshard handling;
- multi-worker consumption.

Namun tetap perlu memahami:

- checkpoint hanya setelah record aman diproses;
- batch partial failure harus dirancang;
- downstream idempotency tetap wajib;
- replay dapat memicu side effect ulang;
- worker scale tidak boleh melebihi shard parallelism secara efektif.

### 7.5 Enhanced Fan-Out

Enhanced fan-out memberi dedicated throughput per consumer. Cocok jika banyak consumer perlu membaca stream yang sama tanpa saling berebut read throughput.

Trade-off: cost lebih tinggi dan kompleksitas tambahan.

### 7.6 Retention

Kinesis retention terbatas dan dapat dikonfigurasi dalam rentang tertentu. Jangan menjadikan Kinesis sebagai audit archive utama.

Pattern umum:

```text
Kinesis stream -> Firehose/Lambda consumer -> S3 data lake / audit archive
```

### 7.7 Kinesis vs Kafka/MSK

Karena Anda sudah belajar Kafka, bandingkan dari sisi platform decision:

| Dimensi | Kinesis | MSK/Kafka |
|---|---|---|
| Operational burden | lebih managed | lebih banyak kontrol dan beban |
| Ecosystem Kafka | tidak native Kafka protocol | native Kafka ecosystem |
| Partition model | shard | partition |
| Consumer model | KCL/EFO/shared throughput | consumer group Kafka |
| Replay | retention window | retention topic sesuai config |
| Use case | AWS-native streaming ingestion | Kafka-compatible event platform |
| Control | lebih terbatas | lebih fleksibel |

Kinesis sering lebih cepat untuk tim yang AWS-native dan butuh streaming ingestion tanpa mengoperasikan Kafka ecosystem. MSK masuk akal jika organisasi sudah punya Kafka contract, tooling, stream processing, dan consumer group semantics yang kuat.

### 7.8 Failure Mode Kinesis

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Hot shard | partition key skew | better key, sharding, resharding |
| Consumer lag | downstream lambat | scale consumer, optimize batch, backpressure |
| Data expired before processed | retention terlalu pendek | alarm lag, increase retention, S3 archival |
| Duplicate side effect | replay/retry | idempotency |
| Checkpoint terlalu awal | record belum aman | checkpoint after durable processing |
| Reshard surprise | consumer tidak handle shard changes | KCL, test resharding |

---

## 8. Step Functions: State Machine untuk Business Workflow

### 8.1 Mental Model Step Functions

AWS Step Functions adalah managed workflow orchestration service. Ia menjalankan state machine yang mendefinisikan langkah, branching, retry, timeout, parallelism, dan error handling.

Flow sederhana:

```text
Start -> ValidateInput -> ReserveResource -> Approve -> Notify -> End
```

Step Functions cocok untuk:

- proses bisnis multi-step;
- approval workflow;
- saga orchestration;
- long-running operation;
- human-in-the-loop;
- data processing pipeline;
- explicit retry/timeout/compensation;
- audit-friendly execution trace.

Step Functions kurang cocok untuk:

- simple one-step async job;
- extremely high-throughput tiny event processing jika Express/cost tidak cocok;
- low-latency synchronous hot path dengan banyak state transition;
- menggantikan domain model dalam aplikasi.

### 8.2 Standard vs Express

| Tipe | Cocok Untuk | Karakteristik |
|---|---|---|
| Standard | long-running, auditable workflow | durable execution, history, up to long duration |
| Express | high-volume short workflow | lower-latency/high-throughput, different history/cost semantics |

Untuk regulated process, Standard sering lebih cocok karena execution history dan durability semantics lebih sesuai untuk audit dan human process.

### 8.3 State Types

State umum:

- `Task`: menjalankan pekerjaan;
- `Choice`: branching;
- `Wait`: menunggu waktu tertentu;
- `Parallel`: menjalankan cabang paralel;
- `Map`: iterasi banyak item;
- `Pass`: transformasi/passing data;
- `Succeed` / `Fail`: terminal state.

### 8.4 Retry dan Catch

Step Functions membuat retry eksplisit dalam definition.

Contoh konsep:

```json
"Retry": [
  {
    "ErrorEquals": ["TransientDependencyError"],
    "IntervalSeconds": 2,
    "MaxAttempts": 3,
    "BackoffRate": 2.0
  }
],
"Catch": [
  {
    "ErrorEquals": ["States.ALL"],
    "Next": "Compensate"
  }
]
```

Keunggulan dibanding retry tersembunyi di service:

- terlihat di diagram/state history;
- bisa direview;
- bisa diaudit;
- bisa diubah sebagai workflow policy;
- failure path eksplisit.

### 8.5 Callback Token untuk Human Approval

Untuk proses yang menunggu tindakan eksternal, Step Functions mendukung callback token pattern.

Contoh:

```text
State machine starts
-> Create approval task
-> Wait for callback token
-> Human approves/rejects via application
-> Application sends task success/failure
-> Workflow continues
```

Pattern ini sangat cocok untuk case management:

```text
SupervisorApprovalPending
RegulatorReviewPending
ExternalAgencyResponsePending
```

Namun token harus diamankan. Jangan expose token mentah ke client publik tanpa kontrol.

### 8.6 Saga Orchestration

Step Functions dapat mengorkestrasi saga:

```text
CreateCaseRecord
ReserveCaseNumber
StoreEvidence
NotifySupervisor
If Notify fails -> compensate / mark notification pending
```

Saga tidak berarti semua harus di-rollback seperti database transaction. Dalam proses bisnis, compensation sering berupa state baru:

```text
NoticeDeliveryFailed
ManualReviewRequired
CaseEscalationPending
```

Ini penting untuk sistem regulatory: kegagalan teknis sering harus menjadi fakta operasional, bukan dihapus.

### 8.7 Step Functions vs Event Choreography

Choreography:

```text
Service A emits event
Service B reacts emits event
Service C reacts emits event
Service D reacts
```

Orchestration:

```text
Workflow controls sequence A -> B -> C -> D
```

Choreography cocok untuk loose integration. Orchestration cocok untuk proses yang:

- butuh visibility end-to-end;
- punya SLA step;
- butuh approval;
- butuh compensation;
- butuh audit defensibility;
- punya branching kompleks.

Untuk enforcement lifecycle, orchestration sering lebih defensible daripada choreography murni karena alur proses harus bisa dijelaskan.

### 8.8 Failure Mode Step Functions

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Execution stuck | waiting callback tidak pernah datang | timeout, alarm, escalation |
| Retry side effect | task tidak idempotent | idempotency key per state/execution |
| Payload terlalu besar | state membawa dokumen/data besar | store in S3, pass reference |
| Workflow definition terlalu gemuk | business logic masuk ASL semua | keep orchestration in SFN, domain logic in service |
| Compensation salah | rollback disamakan dengan delete | model business compensation |
| Cost surprise | terlalu banyak state transitions | cost model, Express where appropriate |

---

## 9. Decision Matrix: SQS vs SNS vs EventBridge vs Kinesis vs Step Functions

### 9.1 Pertanyaan Pertama

Gunakan pertanyaan ini sebelum memilih service.

#### Apakah ada satu unit kerja yang harus diproses worker?

Gunakan SQS.

Contoh:

```text
Generate PDF
Send email
Index document
Process uploaded file
```

#### Apakah satu event perlu diberitahukan ke banyak subscriber?

Gunakan SNS atau EventBridge.

- SNS jika fanout sederhana dan subscriber teknis jelas.
- EventBridge jika event routing, filtering, cross-account, dan domain event governance lebih penting.

#### Apakah event perlu dirutekan berdasarkan schema/rule antar domain?

Gunakan EventBridge.

#### Apakah data volume tinggi dan consumer perlu membaca ordered stream?

Gunakan Kinesis atau MSK.

#### Apakah proses memiliki banyak langkah, retry, timeout, branching, dan audit trail?

Gunakan Step Functions.

### 9.2 Matrix

| Requirement | SQS | SNS | EventBridge | Kinesis | Step Functions |
|---|---:|---:|---:|---:|---:|
| Work queue | Excellent | Poor | Limited | Poor | Limited |
| Fanout | Limited | Excellent | Excellent | Consumer-specific | Limited |
| Rule-based routing | Poor | Basic filter | Excellent | Consumer-side | Choice states |
| High-throughput stream | Poor | Poor | Limited | Excellent | Poor |
| Replay | DLQ/redrive, not stream replay | no native stream replay | archive/replay | retention replay | execution history/retry |
| Ordering | FIFO option | FIFO option | not primary model | per shard | explicit state sequence |
| Long-running workflow | Poor | Poor | Poor | Poor | Excellent |
| Human approval | Poor | Poor | Poor | Poor | Excellent |
| Backpressure buffering | Excellent | via SQS | via target/SQS | stream lag | workflow queues indirectly |
| Multi-account event routing | Possible | Possible | Excellent | Possible but heavier | Possible |
| Java worker simplicity | Excellent | via SQS | via target | Medium | Medium |

### 9.3 Common Combinations

#### SNS -> SQS Fanout

```text
Domain service -> SNS topic -> SQS queue per consumer -> Java worker
```

Good for:

- independent subscribers;
- buffering per consumer;
- DLQ per consumer;
- decoupled scaling.

#### EventBridge -> SQS Target

```text
Domain service -> EventBridge bus -> rule -> SQS queue -> Java worker
```

Good for:

- domain event routing;
- durable consumer processing;
- rule-based filtering;
- async worker isolation.

#### S3 -> EventBridge/SQS -> Worker

```text
S3 object created -> EventBridge/SQS -> processing worker -> result stored
```

Good for:

- document ingestion;
- virus scan;
- OCR;
- metadata extraction.

#### Step Functions + SQS Worker

```text
Step Functions -> enqueue job -> worker processes -> callback/status -> continue
```

Good for:

- long-running tasks;
- human approval;
- external system integration;
- controlled orchestration.

#### Kinesis -> Lambda/ECS Consumer -> S3/DynamoDB Projection

```text
High-volume stream -> consumer -> analytics/projection/archive
```

Good for:

- telemetry;
- audit event ingestion;
- clickstream;
- near-real-time projections.

---

## 10. Event Contract Design

### 10.1 Event Contract as Public API

Event schema adalah API publik internal. Begitu event dipublikasikan, consumer mulai bergantung padanya.

Event contract harus menjelaskan:

- event name;
- source;
- semantic meaning;
- producer owner;
- version;
- payload fields;
- required/optional fields;
- PII classification;
- ordering expectation;
- idempotency key;
- correlation id;
- retention/audit policy;
- compatibility rule.

### 10.2 Naming

Gunakan past tense untuk event:

```text
CaseCreated
CaseAssigned
EvidenceUploaded
EnforcementNoticeIssued
PenaltyCalculated
```

Hindari:

```text
CaseUpdate
ProcessCase
DoNotification
StatusChanged
```

`StatusChanged` terlalu generik. Lebih baik event domain-specific:

```text
CaseEscalated
CaseClosed
CaseReopened
```

### 10.3 Minimal Payload vs Rich Payload

Ada dua style:

#### Minimal Event

```json
{
  "eventId": "evt-123",
  "eventType": "CaseApproved",
  "caseId": "C-123",
  "tenantId": "T-456",
  "occurredAt": "2026-06-20T10:15:30Z"
}
```

Consumer fetch detail dari source API/database.

Kelebihan:

- payload kecil;
- data sensitif lebih terkendali;
- schema lebih stabil.

Kekurangan:

- consumer tergantung source availability;
- risk N+1 fetch;
- consumer melihat state terbaru, bukan state saat event terjadi.

#### Rich Event

```json
{
  "eventId": "evt-123",
  "eventType": "CaseApproved",
  "caseId": "C-123",
  "tenantId": "T-456",
  "approvedBy": "user-789",
  "riskLevel": "HIGH",
  "previousStatus": "UNDER_REVIEW",
  "newStatus": "APPROVED",
  "occurredAt": "2026-06-20T10:15:30Z"
}
```

Kelebihan:

- consumer lebih mandiri;
- lebih baik untuk audit/projection;
- mengurangi fetch.

Kekurangan:

- schema lebih berat;
- PII risk;
- compatibility lebih sulit.

Rule praktis:

```text
Kirim data yang dibutuhkan mayoritas consumer untuk memahami event,
tetapi jangan kirim seluruh aggregate tanpa alasan.
```

### 10.4 Versioning

Event versioning harus backward-compatible jika memungkinkan.

Safe changes:

- menambah optional field;
- menambah enum value jika consumer siap;
- menambah metadata.

Dangerous changes:

- rename field;
- remove field;
- mengubah meaning field;
- mengubah type;
- mengubah event semantic dengan nama sama.

Pattern:

```json
{
  "schemaVersion": "1.2",
  "eventType": "CaseApproved"
}
```

Jika semantic benar-benar berubah, buat event baru:

```text
CaseApprovedV2
```

atau lebih baik nama domain baru jika meaning berbeda:

```text
CaseProvisionallyApproved
CaseFinallyApproved
```

### 10.5 Correlation dan Causation

Event harus membawa metadata tracing:

```json
{
  "eventId": "evt-123",
  "correlationId": "corr-abc",
  "causationId": "cmd-789",
  "tenantId": "T-456",
  "actorId": "user-111",
  "occurredAt": "2026-06-20T10:15:30Z"
}
```

- `eventId`: identitas event untuk idempotency;
- `correlationId`: menghubungkan satu user journey/process;
- `causationId`: event/command yang menyebabkan event ini;
- `actorId`: siapa yang memicu perubahan;
- `tenantId`: isolation/cost/audit dimension.

Untuk sistem regulatory, metadata ini sangat penting untuk defensibility.

---

## 11. Delivery Semantics dan Exactly-Once Illusion

### 11.1 At-Least-Once

Mayoritas integration primitive cloud memberi at-least-once delivery.

Artinya:

```text
message/event bisa dikirim lebih dari sekali
```

Konsekuensi:

- consumer harus idempotent;
- side effect harus dilindungi;
- duplicate harus dianggap normal, bukan exception;
- monitoring duplicate bisa dilakukan, tetapi tidak boleh mengandalkan zero duplicate.

### 11.2 At-Most-Once

At-most-once berarti message bisa hilang tetapi tidak duplicate. Ini jarang cocok untuk business-critical workflow.

Contoh risk:

```text
PenaltyNoticeIssued event hilang
-> citizen tidak mendapat notice
-> legal process invalid
```

### 11.3 Exactly-Once End-to-End

Exactly-once sering disalahpahami. Sebuah service mungkin memiliki deduplication atau exactly-once-ish behavior pada boundary tertentu, tetapi end-to-end business side effect tetap perlu idempotency.

Jika consumer:

1. menerima event;
2. menulis database;
3. mengirim email;
4. crash sebelum checkpoint/delete;
5. event di-deliver ulang;

maka duplicate side effect tetap mungkin terjadi kecuali desain menahannya.

Rule:

```text
Assume delivery is at-least-once.
Design handlers as idempotent.
Make side effects explicitly guarded.
```

---

## 12. Idempotency Patterns

### 12.1 Idempotency Key

Idempotency key harus stabil.

Pilihan umum:

- event id;
- command id;
- aggregate id + transition version;
- business natural key;
- deterministic hash dari request.

Contoh:

```text
CaseApproved:C-123:v17
GenerateNotice:C-123:NOTICE_TYPE_A
```

### 12.2 Processed Event Table

Relational pattern:

```sql
CREATE TABLE processed_events (
    event_id VARCHAR(128) PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL,
    consumer_name VARCHAR(128) NOT NULL
);
```

Flow:

```text
begin transaction
  insert processed_events(event_id)
  if duplicate -> return success
  perform business state change
commit
```

Caveat: side effect eksternal seperti email/API call tidak mudah dimasukkan dalam satu database transaction.

### 12.3 DynamoDB Conditional Write

DynamoDB pattern:

```text
PutItem idempotencyKey with condition attribute_not_exists(pk)
```

Jika conditional check gagal, event sudah pernah diproses.

### 12.4 Business-State Idempotency

Kadang lebih baik memakai state bisnis daripada processed event table.

Contoh:

```text
If notice.status == SENT -> no-op
Else send notice and mark SENT
```

Namun hati-hati dengan race condition.

### 12.5 Outbox Pattern

Outbox pattern berguna saat service perlu mengubah database dan publish event secara atomik-ish.

Flow:

```text
transaction:
  update business table
  insert outbox_event row

outbox publisher:
  read unpublished rows
  publish to SNS/EventBridge/Kinesis
  mark published
```

Manfaat:

- tidak kehilangan event setelah database commit;
- event publish retryable;
- event audit lebih jelas.

Risiko:

- publisher duplicate;
- outbox backlog;
- schema drift;
- ordering per aggregate perlu perhatian.

### 12.6 Inbox Pattern

Inbox pattern menyimpan inbound message sebelum diproses.

Flow:

```text
receive event
store inbox record if new
process inbox record
mark processed
```

Berguna untuk:

- audit inbound events;
- replay internal;
- idempotency;
- decoupling receive dari process.

---

## 13. Backpressure dan Load Leveling

### 13.1 Backpressure Problem

Dalam synchronous system, overload cepat terlihat sebagai timeout/error. Dalam asynchronous system, overload berubah menjadi backlog.

Backlog bukan masalah jika terkontrol. Backlog berbahaya jika:

- tumbuh lebih cepat dari drain rate;
- melewati SLA;
- message expired;
- DLQ naik;
- retry memperparah load;
- downstream recovery menyebabkan thundering herd.

### 13.2 Queue Depth sebagai Signal

Untuk SQS, monitor:

- visible messages;
- not visible messages;
- age of oldest message;
- messages received/deleted;
- DLQ depth;
- consumer error rate.

`ApproximateAgeOfOldestMessage` sering lebih penting daripada jumlah message. Jumlah 10.000 message mungkin aman jika drain cepat, tetapi oldest age 2 jam bisa melanggar SLA.

### 13.3 Scaling Worker

Worker scaling dapat berdasarkan:

- queue depth;
- age of oldest message;
- CPU/memory;
- custom metric processing latency;
- downstream capacity.

Jangan scale worker hanya karena queue naik jika downstream database sudah jenuh. Itu akan memperparah outage.

Better model:

```text
worker concurrency <= downstream safe throughput
```

### 13.4 Retry Storm

Retry storm terjadi saat banyak worker retry dependency yang sedang down.

Mitigasi:

- exponential backoff + jitter;
- circuit breaker;
- bounded concurrency;
- DLQ untuk permanent failure;
- visibility timeout yang masuk akal;
- Step Functions retry policy yang eksplisit;
- queue redrive bertahap.

---

## 14. Observability untuk Event Integration

### 14.1 Apa yang Harus Dilihat

Event-driven system harus bisa menjawab:

1. Event dikirim atau tidak?
2. Event masuk bus/topic/queue/stream atau tidak?
3. Event match rule mana?
4. Target dipanggil atau tidak?
5. Consumer menerima event atau tidak?
6. Consumer sukses atau gagal?
7. Jika gagal, retry ke berapa?
8. Jika masuk DLQ, kenapa?
9. Berapa lama end-to-end latency?
10. Apakah duplicate terjadi?
11. Apakah ordering rusak untuk entity tertentu?

### 14.2 Correlation ID

Semua event/message harus membawa correlation id.

Log format minimal:

```json
{
  "timestamp": "2026-06-20T10:15:30Z",
  "level": "INFO",
  "service": "notice-worker",
  "correlationId": "corr-123",
  "eventId": "evt-456",
  "caseId": "C-789",
  "message": "Notice generated"
}
```

### 14.3 Metrics per Consumer

Metric yang berguna:

- messages received;
- messages processed success;
- messages failed transient;
- messages failed permanent;
- processing duration;
- idempotency duplicate count;
- downstream latency;
- DLQ count;
- queue age;
- consumer lag;
- workflow execution failed/timed out.

### 14.4 Tracing

Distributed tracing pada async system lebih sulit daripada HTTP synchronous call. Anda perlu propagate trace context melalui message attributes atau payload metadata.

Untuk Java:

- gunakan OpenTelemetry jika tersedia;
- inject/extract context pada message boundaries;
- trace producer dan consumer sebagai span terpisah yang terhubung;
- jangan bergantung pada satu continuous call stack.

### 14.5 DLQ Dashboard

DLQ harus terlihat sebagai operational surface:

```text
DLQ depth by queue
oldest DLQ message age
top error class
top event type
top tenant
redrive status
```

DLQ tanpa dashboard dan owner adalah risiko operasional.

---

## 15. Security dan Data Protection

### 15.1 IAM Boundary

Setiap producer dan consumer harus punya permission minimal.

Contoh:

- service A boleh `sqs:SendMessage` ke queue tertentu;
- worker B boleh `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` dari queue tertentu;
- publisher boleh `events:PutEvents` ke bus tertentu;
- target invocation role spesifik.

Hindari:

```json
"Action": "sqs:*",
"Resource": "*"
```

### 15.2 Resource Policy

SNS topic, SQS queue, dan EventBridge bus dapat memakai resource policy untuk cross-account access.

Cross-account integration harus dirancang seperti API publik internal:

- siapa producer;
- source account;
- allowed actions;
- encryption requirements;
- event type allowed;
- audit trail.

### 15.3 Encryption

Pertimbangkan:

- SSE untuk SQS/SNS/Kinesis;
- KMS customer-managed key untuk regulated data;
- key policy dan IAM policy;
- encryption context jika relevan;
- audit akses KMS;
- cost dan throttle KMS pada volume tinggi.

### 15.4 PII in Event Payload

Event menyebar. Semakin banyak subscriber, semakin sulit mengontrol PII.

Rule:

```text
Jangan kirim PII ke event payload kecuali consumer benar-benar membutuhkannya.
```

Gunakan reference pattern:

```json
{
  "eventType": "EvidenceUploaded",
  "caseId": "C-123",
  "evidenceObjectRef": "s3://restricted-evidence-bucket/...",
  "classification": "CONFIDENTIAL"
}
```

Consumer harus punya permission eksplisit untuk mengambil object.

### 15.5 Tenant Isolation

Untuk multi-tenant system:

- masukkan `tenantId` di event metadata;
- jangan rely hanya pada queue/topic per tenant kecuali isolation requirement tinggi;
- pertimbangkan account/queue/bus per tenant tier untuk regulated tenant;
- enforce tenant authorization saat consumer fetch detail;
- jangan membuat consumer global bisa membaca data semua tenant tanpa alasan.

---

## 16. Cost Engineering

### 16.1 Cost Model Berbeda per Primitive

Asynchronous integration bisa terlihat murah sampai volume naik.

Cost driver umum:

- jumlah API request;
- jumlah event/message;
- payload size;
- fanout multiplier;
- state transitions;
- stream shard hours;
- enhanced fan-out;
- data transfer;
- CloudWatch logs;
- KMS request;
- retry/DLQ/redrive.

### 16.2 Fanout Multiplier

Jika 1 event dikirim ke 12 subscriber, volume efektif bukan 1 juta event/hari tetapi 12 juta delivery/hari plus retry/log/processing.

Cost model:

```text
effective_delivery = published_events * subscriber_count * average_retry_factor
```

### 16.3 Step Functions State Transition Cost

Workflow dengan banyak state transition pada traffic tinggi bisa mahal.

Pertanyaan:

- Apakah semua step perlu menjadi state eksplisit?
- Apakah workflow short high-volume lebih cocok Express?
- Apakah beberapa transformasi bisa dilakukan di satu task?
- Apakah observability/audit benefit membenarkan cost?

Jangan mengorbankan audit-critical visibility hanya untuk mengurangi satu atau dua state, tetapi cost harus dipahami.

### 16.4 Log Cost

Event-driven systems menghasilkan banyak log. Structured logging penting, tetapi logging payload penuh bisa mahal dan berisiko.

Gunakan:

- log metadata, bukan seluruh payload;
- sampling untuk high-volume success logs;
- full detail hanya untuk error aman;
- retention policy;
- metric filter/EMF untuk metric penting.

---

## 17. Architecture Patterns

### 17.1 Pattern: Async Command Queue

Use case:

```text
User submits request to generate report.
API returns 202 Accepted.
Worker generates report asynchronously.
```

Architecture:

```text
API Service -> SQS report-jobs -> ECS/Lambda worker -> S3 report -> EventBridge ReportGenerated
```

Key design:

- request id sebagai idempotency key;
- status table;
- DLQ;
- report object in S3;
- notification event setelah selesai;
- polling or callback to user.

### 17.2 Pattern: Domain Event Fanout

Use case:

```text
Case approved; multiple downstream services need to react.
```

Architecture:

```text
Case Service -> EventBridge/SNS -> SQS per subscriber -> Consumers
```

Key design:

- event schema stable;
- event id;
- correlation id;
- consumer idempotency;
- DLQ per subscriber;
- event catalog.

### 17.3 Pattern: Document Processing Pipeline

Use case:

```text
Evidence uploaded, needs virus scan, OCR, metadata extraction, classification.
```

Architecture:

```text
S3 upload -> EventBridge -> Step Functions
  -> VirusScan
  -> OCR
  -> ExtractMetadata
  -> Classify
  -> PersistResult
  -> Notify
```

Key design:

- S3 object reference, not file in event;
- immutable original object;
- quarantine state;
- task timeout;
- compensation/manual review;
- audit event per stage.

### 17.4 Pattern: High-Volume Ingestion

Use case:

```text
Application emits high-volume activity/audit telemetry.
```

Architecture:

```text
Producer -> Kinesis -> Consumer -> S3 partitioned archive + analytics projection
```

Key design:

- partition key strategy;
- retention;
- consumer lag alarm;
- S3 archival;
- schema evolution;
- replay strategy.

### 17.5 Pattern: Human-in-the-Loop Workflow

Use case:

```text
High-risk enforcement case requires supervisor approval.
```

Architecture:

```text
CaseSubmitted -> Step Functions Standard
  -> ValidateCase
  -> CreateApprovalTask
  -> WaitForCallback
  -> IfApproved: IssueNotice
  -> IfRejected: RequestRevision
```

Key design:

- callback token protected;
- timeout to escalation;
- approval actor audited;
- state visible to UI;
- domain service remains source of truth;
- workflow execution id stored.

---

## 18. Anti-Patterns

### 18.1 Everything Is an Event

Tidak semua hal harus menjadi event.

Jika caller perlu hasil langsung, mungkin synchronous API lebih tepat.

Jika ada satu worker yang harus melakukan task, queue lebih tepat daripada event bus.

Jika ada proses stateful multi-step, workflow lebih tepat daripada chain event acak.

### 18.2 Event as Database

Event bus bukan database. Queue bukan database. Stream retention bukan audit archive permanen.

Jika state harus queryable dan durable secara bisnis, simpan di database/object storage yang sesuai.

### 18.3 Generic Event Type

Buruk:

```text
EntityChanged
StatusUpdated
DataModified
```

Lebih baik:

```text
CaseEscalated
EvidenceVerified
PenaltyWaived
NoticeDelivered
```

Generic event memindahkan complexity ke consumer.

### 18.4 Payload Dumping

Mengirim seluruh aggregate ke event payload menyebabkan:

- PII menyebar;
- schema rapuh;
- payload besar;
- consumer coupling;
- cost naik.

### 18.5 No Idempotency

Jika consumer tidak idempotent, sistem asynchronous akan gagal pada duplicate normal.

### 18.6 DLQ Without Owner

DLQ tanpa owner, alarm, dan runbook adalah delayed incident.

### 18.7 Hidden Workflow in Event Choreography

Jika alur bisnis penting tersebar di 12 subscriber, tidak ada satu tempat untuk melihat state proses. Ini buruk untuk regulated workflow.

### 18.8 Retry Forever

Retry tanpa batas bisa mengubah bug kecil menjadi outage besar.

### 18.9 Ignoring Downstream Capacity

Queue bisa menahan spike, tetapi worker scaling tetap harus menghormati kapasitas database/API downstream.

### 18.10 Cross-Account Event Bus Without Governance

Cross-account event routing tanpa schema, policy, dan owner dapat menjadi security and compliance risk.

---

## 19. Case Study: Regulated Case Management Platform

### 19.1 Context

Sistem menangani lifecycle enforcement case:

```text
Case intake -> triage -> evidence upload -> review -> approval -> notice issuance -> appeal -> closure
```

Requirement:

- audit trail kuat;
- setiap transition defensible;
- beberapa step asynchronous;
- beberapa step butuh human approval;
- dokumen besar disimpan di S3;
- tenant regulated;
- downstream notification/search/analytics harus eventually consistent;
- tidak boleh duplicate legal notice;
- failure harus terlihat.

### 19.2 Domain Events

Event utama:

```text
CaseCreated
EvidenceUploaded
EvidenceVerified
CaseEscalated
SupervisorApprovalRequested
SupervisorApproved
EnforcementNoticeIssued
NoticeDeliveryFailed
CaseClosed
```

Metadata wajib:

```json
{
  "eventId": "evt-...",
  "schemaVersion": "1.0",
  "source": "com.company.case-management",
  "tenantId": "tenant-...",
  "caseId": "case-...",
  "correlationId": "corr-...",
  "causationId": "cmd-...",
  "actorId": "user-...",
  "occurredAt": "...",
  "classification": "CONFIDENTIAL"
}
```

### 19.3 Architecture

```text
Case API
  -> database transaction updates case state
  -> outbox_event inserted

Outbox Publisher
  -> EventBridge case-domain bus

EventBridge rules
  -> SQS search-indexer queue
  -> SQS notification queue
  -> central audit bus
  -> Step Functions for document workflow

Document upload
  -> S3 restricted bucket
  -> EventBridge
  -> Step Functions document processing

Approval workflow
  -> Step Functions Standard
  -> create approval task
  -> wait for callback
  -> issue notice if approved
```

### 19.4 Why This Design

- Outbox prevents losing event after database commit.
- EventBridge gives domain event routing and cross-account audit integration.
- SQS per subscriber isolates failure and backlog.
- Step Functions makes approval/document process explicit and auditable.
- S3 stores large evidence; event only carries reference.
- Consumers are idempotent using eventId/business key.
- DLQ per queue creates operational accountability.

### 19.5 Critical Invariants

```text
A legal notice must not be issued twice for the same case/version.
```

```text
No confidential evidence content may appear in event payload or logs.
```

```text
Every case state transition must have actor, timestamp, causation, and audit event.
```

```text
A failed notification must become a visible operational state, not silent retry forever.
```

```text
Workflow timeout must escalate to manual review.
```

### 19.6 Failure Walkthrough

#### Scenario: Notification Service Down

1. `EnforcementNoticeIssued` event published.
2. EventBridge routes to notification SQS queue.
3. Notification worker fails to call email provider.
4. Message retries with visibility timeout.
5. After max receive count, message goes to DLQ.
6. DLQ alarm fires.
7. Runbook checks provider outage.
8. Redrive after fix.
9. Consumer idempotency prevents duplicate email if provider actually accepted previous attempt.

#### Scenario: Evidence OCR Fails Permanently

1. S3 upload triggers workflow.
2. Virus scan passes.
3. OCR task fails due unsupported file format.
4. Step Functions catches permanent error.
5. Workflow transitions to `ManualReviewRequired`.
6. Case UI shows evidence processing issue.
7. Audit event emitted.

This is better than hiding failure in Lambda logs.

---

## 20. Java Implementation Guidance

### 20.1 AWS SDK Client Reuse

Create AWS SDK clients once per application lifecycle when possible.

Bad:

```java
void handle(Message m) {
    SqsClient client = SqsClient.create();
    // process
}
```

Better:

```java
public final class WorkerApp {
    private final SqsClient sqs;

    public WorkerApp(SqsClient sqs) {
        this.sqs = sqs;
    }
}
```

### 20.2 Bounded Executor

Never use unbounded concurrency for queue processing.

```java
ExecutorService executor = new ThreadPoolExecutor(
    8,
    8,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(100),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Adjust based on downstream capacity, not just CPU.

### 20.3 Message Envelope

Define a consistent envelope.

```java
public record EventEnvelope<T>(
    String eventId,
    String eventType,
    String schemaVersion,
    String tenantId,
    String correlationId,
    String causationId,
    Instant occurredAt,
    T detail
) {}
```

### 20.4 Error Classification

Consumer should classify errors.

```java
sealed interface ProcessingFailure permits TransientFailure, PermanentFailure {}

record TransientFailure(String reason, Throwable cause) implements ProcessingFailure {}
record PermanentFailure(String reason, Throwable cause) implements ProcessingFailure {}
```

Transient:

- network timeout;
- dependency 5xx;
- throttling;
- temporary lock.

Permanent:

- invalid schema;
- missing required field;
- business invariant violation;
- unsupported version.

### 20.5 Idempotency Guard

Pseudo-code:

```java
public void process(EventEnvelope<?> event) {
    boolean acquired = idempotencyStore.tryStart(event.eventId(), consumerName);
    if (!acquired) {
        log.info("duplicate_event_noop eventId={} consumer={}", event.eventId(), consumerName);
        return;
    }

    try {
        handle(event);
        idempotencyStore.markSucceeded(event.eventId(), consumerName);
    } catch (PermanentBusinessException e) {
        idempotencyStore.markFailed(event.eventId(), consumerName, e.getMessage());
        throw e;
    } catch (RuntimeException e) {
        idempotencyStore.releaseOrMarkRetryable(event.eventId(), consumerName);
        throw e;
    }
}
```

Implementation details depend on your idempotency store and retry semantics.

### 20.6 Safe JSON Handling

Use explicit schema models. Avoid passing raw maps everywhere.

Bad:

```java
Map<String, Object> event = objectMapper.readValue(json, Map.class);
```

Better:

```java
EventEnvelope<CaseApprovedDetail> event = objectMapper.readValue(
    json,
    new TypeReference<EventEnvelope<CaseApprovedDetail>>() {}
);
```

For versioning, keep deserializers tolerant to unknown fields but strict for required fields.

### 20.7 Logging

Log metadata:

```java
log.info("processing_event eventId={} eventType={} tenantId={} caseId={} correlationId={}",
    event.eventId(),
    event.eventType(),
    event.tenantId(),
    detail.caseId(),
    event.correlationId());
```

Avoid:

```java
log.info("payload={}", rawJson);
```

especially for regulated data.

---

## 21. Testing Strategy

### 21.1 Unit Tests

Test:

- event parsing;
- schema validation;
- idempotency behavior;
- error classification;
- handler business logic.

### 21.2 Contract Tests

Producer contract:

- event name;
- required fields;
- version;
- allowed enum;
- sample payload.

Consumer contract:

- can consume current and previous compatible versions;
- rejects invalid payload safely;
- no PII log.

### 21.3 Integration Tests

Test with real or realistic AWS integration:

- SQS send/receive/delete;
- visibility timeout behavior;
- DLQ redrive;
- EventBridge rule matching;
- Step Functions execution path;
- Kinesis consumer checkpoint.

### 21.4 Failure Injection

Test:

- duplicate message;
- out-of-order events;
- downstream timeout;
- malformed payload;
- DLQ path;
- consumer crash after side effect before delete;
- replay event;
- throttling.

If a consumer cannot survive duplicate event in test, it is not production-ready.

---

## 22. Runbooks

### 22.1 SQS Queue Backlog

Questions:

1. Is producer spike expected?
2. Is consumer running?
3. Is downstream dependency slow?
4. Is error rate high?
5. Is oldest message age breaching SLA?
6. Can worker concurrency be safely increased?
7. Is DLQ receiving messages?

Actions:

- inspect CloudWatch metrics;
- check recent deploy;
- check downstream health;
- scale workers if safe;
- pause producer if needed;
- redrive DLQ only after root cause understood.

### 22.2 DLQ Messages Present

Questions:

1. Which event type?
2. Which tenant?
3. Which error class?
4. Is this permanent or transient?
5. Was side effect partially completed?
6. Is redrive safe?

Actions:

- sample messages securely;
- inspect logs by correlation id;
- patch consumer if bug;
- fix data if invalid;
- redrive gradually;
- document incident.

### 22.3 EventBridge Rule Not Firing

Check:

- event source/detail-type;
- event pattern;
- bus name;
- account/region;
- target permission;
- failed invocation metric;
- DLQ target;
- schema change.

### 22.4 Step Functions Execution Failed

Check:

- failed state;
- input/output size;
- error name;
- retry attempts;
- timeout;
- downstream logs;
- whether compensation ran;
- whether business state needs manual correction.

### 22.5 Kinesis Consumer Lag

Check:

- producer rate;
- shard count;
- hot shard;
- consumer worker count;
- downstream latency;
- checkpoint progress;
- iterator age;
- error loop.

---

## 23. ADR Template

```markdown
# ADR: Integration Primitive for <Use Case>

## Context
<Business process, volume, latency, ordering, audit, tenant, compliance requirements.>

## Decision
Use <SQS/SNS/EventBridge/Kinesis/Step Functions/Combination> for <specific boundary>.

## Options Considered
- SQS
- SNS
- EventBridge
- Kinesis
- Step Functions
- MSK/Kafka
- Synchronous API

## Rationale
- Delivery semantics:
- Ordering requirement:
- Retry ownership:
- Failure visibility:
- Consumer isolation:
- Audit requirement:
- Cost consideration:
- Operational maturity:

## Event/Message Contract
- Name:
- Owner:
- Schema version:
- Idempotency key:
- Correlation id:
- PII classification:

## Failure Handling
- Retry:
- DLQ:
- Timeout:
- Redrive:
- Compensation:

## Observability
- Metrics:
- Logs:
- Traces:
- Alarms:

## Consequences
Positive:
- ...

Negative:
- ...

## Review Date
<date>
```

---

## 24. Production Checklist

### 24.1 Contract

- [ ] Event/message type named with clear domain meaning.
- [ ] Owner documented.
- [ ] Schema version included.
- [ ] Required/optional fields documented.
- [ ] Idempotency key defined.
- [ ] Correlation id propagated.
- [ ] PII classification reviewed.
- [ ] Compatibility policy defined.

### 24.2 Delivery and Failure

- [ ] At-least-once assumed.
- [ ] Consumer idempotent.
- [ ] Retry policy bounded.
- [ ] DLQ configured where applicable.
- [ ] DLQ alarm configured.
- [ ] Redrive runbook exists.
- [ ] Visibility timeout sized correctly.
- [ ] Poison message behavior defined.
- [ ] Timeout behavior defined.

### 24.3 Security

- [ ] Least privilege IAM.
- [ ] Resource policy reviewed.
- [ ] KMS/encryption requirements met.
- [ ] Cross-account access restricted.
- [ ] Sensitive payload minimized.
- [ ] Logs do not expose PII.

### 24.4 Observability

- [ ] Producer success/failure metric.
- [ ] Consumer success/failure metric.
- [ ] Queue depth/age metric.
- [ ] DLQ metric.
- [ ] Consumer lag metric for stream.
- [ ] Workflow failed/timed-out alarms.
- [ ] Structured logs include event id and correlation id.
- [ ] Trace context propagated where appropriate.

### 24.5 Cost

- [ ] Fanout multiplier understood.
- [ ] Retry volume estimated.
- [ ] State transition cost reviewed.
- [ ] Kinesis shard/EFO cost reviewed.
- [ ] CloudWatch log cost reviewed.
- [ ] KMS request cost reviewed.

---

## 25. Exercises

### Exercise 1: Choose the Primitive

For each use case, choose SQS, SNS, EventBridge, Kinesis, Step Functions, or combination.

1. Generate PDF after user request.
2. Notify search, audit, and analytics when case is approved.
3. Process high-volume clickstream events.
4. Run a 5-step approval workflow with human approval.
5. Send delayed reminder 3 days after case assignment.
6. Distribute document-upload notification to OCR and virus scan.
7. Capture immutable audit events for analytics and long-term archive.

Expected direction:

1. SQS + worker.
2. EventBridge/SNS + SQS per consumer.
3. Kinesis + consumers + S3 archive.
4. Step Functions Standard.
5. EventBridge Scheduler or Step Functions Wait depending workflow context.
6. Step Functions if ordered pipeline; SNS/EventBridge if independent fanout.
7. EventBridge/Kinesis to S3 archive; not queue alone.

### Exercise 2: Design Idempotency

Design idempotency for:

```text
Event: EnforcementNoticeIssued
Side effect: send email + create immutable notice record
Constraint: no duplicate notice for same case/version
```

Think through:

- idempotency key;
- database constraint;
- external email provider idempotency;
- retry after crash;
- duplicate event;
- DLQ redrive.

### Exercise 3: Failure Walkthrough

Simulate:

```text
CaseApproved event is published.
Search indexer has a bug and all messages fail.
Notification service succeeds.
Audit service succeeds.
```

Explain:

- which primitive isolates failure;
- where backlog appears;
- where DLQ appears;
- how to replay only search indexing;
- why publisher should not rollback approval.

### Exercise 4: Event Schema Review

Review this event:

```json
{
  "type": "update",
  "data": {
    "id": "123",
    "status": "DONE",
    "user": "john@example.com",
    "payload": { "...": "entire aggregate" }
  }
}
```

Identify problems and redesign it.

---

## 26. Key Takeaways

1. SQS is for durable work queues and load leveling.
2. SNS is for fanout notification.
3. EventBridge is for event bus routing, domain integration, and cross-account event architecture.
4. Kinesis is for ordered high-throughput streaming ingestion and replay within retention.
5. Step Functions is for explicit multi-step workflows, especially where audit, timeout, compensation, and human approval matter.
6. At-least-once delivery is the default mental model. Idempotency is not optional.
7. DLQ without owner, alarm, and runbook is delayed data loss.
8. Event contracts are APIs. Version and govern them.
9. Async systems convert immediate failure into backlog. Backlog must be observable and bounded.
10. For regulated systems, workflow state and audit events must be explicit, not hidden in informal event chains.

---

## 27. References

Referensi resmi AWS yang relevan untuk pendalaman:

- Amazon SQS Developer Guide — queue, visibility timeout, dead-letter queue, FIFO queue.
- Amazon SNS Developer Guide — topics, subscriptions, filtering, fanout.
- Amazon EventBridge User Guide — event bus, rules, event patterns, archive/replay, scheduler, pipes.
- Amazon Kinesis Data Streams Developer Guide — shards, partition keys, consumers, enhanced fan-out, retention.
- AWS Step Functions Developer Guide — Standard/Express workflows, state types, error handling, callback pattern.
- AWS SDK for Java 2.x Developer Guide — clients, retries, timeouts, async/sync clients.
- AWS Well-Architected Framework — operational excellence, reliability, security, cost optimization.

---

## Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-015.md
```

Judul:

```text
Workflow and Orchestration: Step Functions for Long-Running Business Processes
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — DynamoDB for System Designers: Partition, Access Pattern, Transaction, Stream, dan Global Table</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-015.md">Part 015 — Workflow and Orchestration: Step Functions for Long-Running Business Processes ➡️</a>
</div>

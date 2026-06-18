# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-035

# Part 35 — Final Mastery: Design Review Checklist, Interview-Level Reasoning, dan Top 1% Engineering Heuristics

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: `035 / 035`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: final synthesis, design review, production reasoning, failure-model thinking, dan heuristik engineering tingkat lanjut untuk JMS / Jakarta Messaging.

---

## 0. Tujuan Part Ini

Part ini adalah penutup seluruh seri JMS / Jakarta Messaging. Tujuannya bukan menambah API baru, tetapi membentuk kemampuan yang lebih sulit: **menilai apakah sebuah desain JMS benar, aman, scalable, observable, dan dapat dioperasikan dalam production**.

Setelah menyelesaikan part ini, Anda diharapkan mampu:

1. Mengevaluasi desain JMS bukan dari “apakah bisa jalan”, tetapi dari **apakah masih benar saat gagal**.
2. Membedakan requirement yang cocok untuk JMS dari requirement yang lebih cocok untuk Kafka, database polling, HTTP/gRPC, workflow engine, atau event log.
3. Melakukan review architecture dengan checklist yang konkret.
4. Mengidentifikasi failure window antara producer, broker, consumer, database, external system, dan operator.
5. Mendesain invariant agar duplicate, redelivery, retry, replay, dan partial failure tidak merusak state bisnis.
6. Menjawab pertanyaan interview atau design review level senior/principal dengan reasoning yang defensible.
7. Menutup seri dengan mental model utuh: JMS sebagai **coordination substrate** untuk asynchronous enterprise systems.

---

## 1. Ringkasan Besar: Apa yang Sebenarnya Kita Pelajari?

Sepanjang seri ini, kita tidak hanya mempelajari `ConnectionFactory`, `Session`, `MessageProducer`, `MessageConsumer`, `JMSContext`, `Queue`, `Topic`, dan message types. Itu hanya permukaan.

Hal yang lebih penting adalah ini:

> JMS adalah kontrak koordinasi asinkron antara producer, broker, consumer, storage, transaction boundary, dan operator.

Artinya, desain JMS yang matang harus menjawab pertanyaan berikut:

- Siapa yang boleh membuat message?
- Message merepresentasikan command, event, document, atau request?
- Kapan message dianggap “diterima”?
- Kapan side effect dianggap “selesai”?
- Apa yang terjadi jika consumer crash setelah commit DB tetapi sebelum ack?
- Apa yang terjadi jika producer sukses commit DB tetapi gagal publish?
- Apa yang terjadi jika broker menerima message tetapi producer tidak menerima acknowledgement?
- Apa yang terjadi jika message dideliver dua kali?
- Apa yang terjadi jika message lama tiba setelah state sudah berubah?
- Apa yang terjadi jika schema berubah sebelum semua consumer upgrade?
- Apa yang terjadi jika DLQ penuh?
- Siapa yang boleh replay message?
- Bagaimana membuktikan dalam audit bahwa keputusan sistem benar?

Engineer biasa biasanya berhenti di API.
Engineer kuat mengejar throughput.
Engineer top-level mengejar **correctness under failure**.

---

## 2. Mental Model Akhir: JMS sebagai Sistem dengan Banyak Boundary

Sistem JMS bukan satu boundary. Ia terdiri dari beberapa boundary yang masing-masing bisa gagal secara independen.

```text
[Producer Code]
      |
      | 1. create message
      v
[Producer Session / Transaction]
      |
      | 2. send / commit
      v
[Broker Network Boundary]
      |
      | 3. accept / persist / route
      v
[Broker Storage / Queue / Topic]
      |
      | 4. dispatch / flow control
      v
[Consumer Session / Prefetch]
      |
      | 5. receive / listener
      v
[Business Handler]
      |
      | 6. validate / dedup / mutate state
      v
[Database / External Side Effect]
      |
      | 7. commit / call / emit next event
      v
[Ack / Commit / Rollback]
```

Setiap panah adalah failure window.

Top 1% JMS reasoning berarti Anda tidak bertanya:

> “Bagaimana cara consume queue?”

Tetapi bertanya:

> “Di boundary mana message bisa hilang, duplicate, reorder, tertahan, atau sudah diproses tetapi belum di-ack?”

---

## 3. The Core Invariant: Side Effect dan Ack Tidak Boleh Dipisahkan Tanpa Strategi

Jika ada satu prinsip paling penting dalam JMS, ini dia:

> Jangan biarkan acknowledgement message menyatakan “pekerjaan selesai” sebelum side effect bisnis benar-benar aman.

Contoh salah:

```text
1. Consumer menerima message.
2. AUTO_ACK terjadi terlalu awal atau setelah listener return.
3. Handler memanggil external service.
4. External service gagal.
5. Message sudah dianggap selesai.
6. Work hilang.
```

Contoh juga salah:

```text
1. Consumer menerima message.
2. Handler commit DB.
3. Consumer crash sebelum ack.
4. Broker redeliver.
5. Handler commit ulang tanpa idempotency.
6. State corrupt / duplicate side effect.
```

Desain yang matang harus memilih strategi:

| Kondisi | Strategi defensible |
|---|---|
| JMS only side effect | Local JMS transaction cukup |
| DB + JMS harus sinkron | JTA/XA, atau outbox/inbox |
| External API non-transactional | Idempotency key + retry policy + compensation |
| Duplicate mungkin terjadi | Dedup/inbox + idempotent handler |
| Replay dibutuhkan | Handler replay-safe + audit trail |
| Ordering penting | Partition/message group per aggregate |

Tidak ada mode ack yang secara ajaib menyelesaikan semua masalah.

Ack hanyalah sinyal ke broker.
Correctness adalah properti desain end-to-end.

---

## 4. JMS Mastery Map

Berikut peta kemampuan yang harus Anda kuasai.

```text
JMS / Jakarta Messaging Mastery
|
+-- API Literacy
|   +-- ConnectionFactory
|   +-- Connection / JMSContext
|   +-- Session
|   +-- Queue / Topic
|   +-- Producer / Consumer
|   +-- Header / Properties / Body
|
+-- Semantic Literacy
|   +-- Queue vs Topic
|   +-- Command vs Event
|   +-- Ack modes
|   +-- Transaction modes
|   +-- Redelivery
|   +-- Ordering
|
+-- Distributed Systems Literacy
|   +-- Duplicate
|   +-- Loss
|   +-- Reordering
|   +-- Partial failure
|   +-- Backpressure
|   +-- Idempotency
|
+-- Broker Literacy
|   +-- Persistence
|   +-- Dispatch
|   +-- Paging
|   +-- Flow control
|   +-- Clustering
|   +-- Failover
|
+-- Production Literacy
|   +-- Metrics
|   +-- Logs
|   +-- Tracing
|   +-- DLQ triage
|   +-- Replay governance
|   +-- Security
|   +-- Runbook
|
+-- Architecture Literacy
    +-- Outbox
    +-- Inbox
    +-- Saga
    +-- Contract versioning
    +-- Capacity model
    +-- Operational ownership
```

Anda belum benar-benar menguasai JMS jika hanya bisa menulis producer/consumer.
Anda mulai menguasai JMS ketika bisa menjelaskan **apa yang terjadi saat sistem gagal di tiap boundary**.

---

## 5. Checklist 1 — Apakah JMS Teknologi yang Tepat?

Sebelum mendesain queue/topic, tanyakan dulu: apakah JMS memang cocok?

### 5.1 JMS Cocok Jika

JMS biasanya cocok jika requirement Anda seperti ini:

- Work distribution dengan competing consumers.
- Enterprise integration dengan aplikasi Java/Jakarta EE/Spring.
- Command processing asynchronous.
- Durable message delivery.
- Need broker-managed retry / redelivery / DLQ.
- Transactional integration dengan container atau JTA.
- Sistem internal enterprise yang butuh predictable operational semantics.
- Request/reply asynchronous dengan correlation dan timeout yang jelas.
- Workload yang lebih “task queue / integration queue” daripada immutable event log.

### 5.2 JMS Kurang Cocok Jika

JMS mungkin bukan pilihan terbaik jika requirement utama Anda:

- Replay historis skala besar oleh banyak consumer independen.
- Long-term event retention sebagai source of truth.
- Stream processing / windowed aggregation / log compaction.
- Analytics pipeline high-throughput berbasis append-only log.
- Banyak consumer group yang perlu membaca ulang semua event dari offset berbeda.
- Cross-language ecosystem yang lebih condong ke Kafka/AMQP-native/Pulsar.
- Public cloud fully managed event streaming dengan retention panjang.

### 5.3 Heuristik Pemilihan

| Need | Bias teknologi |
|---|---|
| Work queue | JMS / RabbitMQ |
| Enterprise Java integration | JMS / Jakarta Messaging |
| Durable event log | Kafka / Pulsar |
| Broadcast short-lived integration event | JMS topic / AMQP topic / broker pub-sub |
| Replayable event stream | Kafka / Pulsar |
| Long-running business process | BPMN/workflow engine + messaging |
| Low-latency synchronous query | HTTP/gRPC |
| Simple scheduled background task | Scheduler/job framework |
| Strong queryable state | Database |

Prinsipnya:

> Pilih teknologi berdasarkan semantics, bukan popularitas.

---

## 6. Checklist 2 — Message Semantics

Setiap message harus punya semantic category yang jelas.

### 6.1 Apakah Message Ini Command atau Event?

Command:

```text
ApproveApplicationCommand
GenerateInvoiceCommand
SendNotificationCommand
RecalculateRiskScoreCommand
```

Karakteristik command:

- Ditujukan ke handler tertentu.
- Berisi intent.
- Biasanya diproses satu kali secara logical.
- Cocok dengan queue.
- Consumer boleh menolak jika invalid.
- Harus idempotent jika redelivery terjadi.

Event:

```text
ApplicationApprovedEvent
InvoiceGeneratedEvent
RiskScoreRecalculatedEvent
NotificationSentEvent
```

Karakteristik event:

- Mengumumkan fakta yang sudah terjadi.
- Bisa punya banyak subscriber.
- Cocok dengan topic.
- Tidak boleh meminta consumer melakukan sesuatu secara imperative.
- Producer tidak boleh tahu semua consumer.

Anti-pattern:

```text
ApplicationApprovedEvent
```

Tetapi payload-nya bermakna:

```text
Please update module X, send email Y, create task Z, and call API W
```

Itu bukan event. Itu command yang menyamar.

### 6.2 Apakah Message Ini Immutable?

Message yang sudah dipublish harus diperlakukan sebagai immutable fact atau immutable request.

Jangan mengandalkan:

- Consumer membaca ulang state mutable tanpa version check.
- Message hanya berisi ID tanpa snapshot minimal padahal state bisa berubah.
- Message berubah makna karena field lama diinterpretasi ulang.

Checklist:

- Apakah message punya `schemaVersion`?
- Apakah message punya `eventType` / `commandType`?
- Apakah message punya `messageId` application-level?
- Apakah message punya `correlationId`?
- Apakah message punya `causationId`?
- Apakah message punya `aggregateId` bila ordering per entity penting?
- Apakah message punya `occurredAt` atau `requestedAt`?
- Apakah message punya `producer`?
- Apakah message punya contract compatibility rule?

---

## 7. Checklist 3 — Destination Design

Destination bukan sekadar nama queue/topic. Ia adalah boundary ownership.

### 7.1 Queue Design Questions

Untuk setiap queue:

- Siapa owner queue?
- Siapa producer resmi?
- Siapa consumer resmi?
- Apakah message command atau work item?
- Apakah ordering penting?
- Apakah concurrent consumer aman?
- Berapa max retry?
- Apa DLQ-nya?
- Apa parking lot-nya?
- Apa SLA processing time?
- Apa alert threshold queue depth?
- Apa alert threshold oldest message age?
- Bagaimana replay dilakukan?
- Bagaimana message dikoreksi jika payload salah?
- Apakah queue boleh menerima message dari versi lama?

### 7.2 Topic Design Questions

Untuk setiap topic:

- Apakah event yang dipublish benar-benar fakta domain?
- Apakah subscriber boleh bertambah tanpa perubahan producer?
- Apakah durable subscriber dibutuhkan?
- Apakah shared subscription dibutuhkan?
- Apakah late subscriber perlu menerima event lama?
- Apakah JMS topic cukup, atau butuh log retention seperti Kafka?
- Apakah event ordering penting per aggregate?
- Bagaimana schema evolution dilakukan?
- Apa yang terjadi jika satu subscriber gagal lama?

### 7.3 Destination Naming

Nama destination harus memperlihatkan semantic, bukan implementation accident.

Kurang baik:

```text
Q1
APP_QUEUE
PROCESS_QUEUE
TEMP_EVENT
MODULE_QUEUE
```

Lebih baik:

```text
case.command.evaluate-risk.v1
case.command.generate-letter.v1
case.event.case-created.v1
case.event.case-status-changed.v1
notification.command.send-email.v1
appeal.event.appeal-submitted.v1
```

Untuk regulated systems, naming membantu audit dan incident response.

---

## 8. Checklist 4 — Producer Review

Producer sering terlihat sederhana, tetapi banyak failure dimulai dari producer.

### 8.1 Producer Correctness

Tanyakan:

- Apakah producer publish message sebelum atau setelah DB commit?
- Jika DB commit sukses tetapi publish gagal, apa recovery-nya?
- Jika publish sukses tetapi producer tidak menerima response dari broker, apakah bisa publish duplicate?
- Apakah producer memakai application-level message ID?
- Apakah producer bisa retry send dengan aman?
- Apakah message creation deterministic?
- Apakah payload berisi data cukup untuk consumer?
- Apakah producer mengisi correlation metadata?
- Apakah TTL digunakan secara sadar?
- Apakah priority benar-benar dibutuhkan?

### 8.2 Producer Anti-Patterns

Anti-pattern umum:

1. Publish message langsung setelah mutasi DB tanpa outbox.
2. Menganggap `send()` sukses berarti bisnis selesai.
3. Tidak mengisi correlation ID.
4. Payload terlalu kecil sehingga consumer harus melakukan banyak lookup rapuh.
5. Payload terlalu besar sehingga broker menjadi file transport.
6. Menggunakan priority untuk business escalation tanpa fairness model.
7. Menggunakan TTL untuk menyembunyikan backlog.
8. Tidak punya retry policy untuk send failure.
9. Membuat connection/session/producer per message tanpa pooling/reuse.
10. Mengirim event sebelum state benar-benar committed.

### 8.3 Producer Decision Matrix

| Problem | Better design |
|---|---|
| DB commit dan publish harus konsisten | Outbox atau XA |
| Producer duplicate karena retry | Application message ID + consumer dedup |
| Payload besar | Claim check pattern |
| Publish ke banyak downstream | Topic / event bus |
| Downstream harus menjalankan action tertentu | Command queue |
| Publish perlu audit | Outbox table + publish status |

---

## 9. Checklist 5 — Consumer Review

Consumer adalah tempat correctness benar-benar diuji.

### 9.1 Consumer Correctness Questions

Untuk setiap consumer:

- Apakah handler idempotent?
- Apakah handler bisa dipanggil ulang dengan message yang sama?
- Apakah handler bisa menerima message lama?
- Apakah handler bisa menerima message out-of-order?
- Apakah handler melakukan validation sebelum side effect?
- Apakah handler memisahkan transient dan permanent failure?
- Apakah handler rollback untuk error yang retryable?
- Apakah handler ack hanya setelah side effect aman?
- Apakah handler memakai dedup/inbox?
- Apakah handler punya timeout untuk external call?
- Apakah handler punya circuit breaker/bulkhead bila perlu?
- Apakah handler punya observability per message?

### 9.2 Consumer Idempotency Levels

| Level | Deskripsi | Risiko |
|---|---|---|
| None | Duplicate merusak state | Tidak production-grade |
| Technical dedup | Simpan processed message ID | Baik untuk redelivery sederhana |
| Business idempotency | State transition aman secara domain | Lebih kuat |
| Replay-safe | Bisa replay message lama tanpa corrupt state | Terbaik untuk enterprise/audit |

### 9.3 Consumer Handler Skeleton

Pseudocode defensible:

```java
void handle(MessageEnvelope envelope) {
    validateEnvelope(envelope);

    if (inboxAlreadyProcessed(envelope.messageId(), consumerName)) {
        return;
    }

    beginDatabaseTransaction();
    try {
        insertInboxProcessing(envelope.messageId(), consumerName);

        DomainState state = loadStateForUpdate(envelope.aggregateId());
        Decision decision = decide(state, envelope);

        if (decision.shouldApply()) {
            applyStateTransition(state, decision);
            appendAuditRecord(envelope, decision);
            appendOutboxEvents(decision.events());
        } else {
            appendNoOpAuditRecord(envelope, decision.reason());
        }

        markInboxProcessed(envelope.messageId(), consumerName);
        commitDatabaseTransaction();
    } catch (RetryableException e) {
        rollbackDatabaseTransaction();
        throw e;
    } catch (PermanentException e) {
        rollbackDatabaseTransaction();
        throw e; // or route to handled failure flow depending policy
    }
}
```

Prinsipnya:

> Ack/commit JMS dilakukan setelah database transaction selesai, atau JMS transaction rollback membiarkan broker redeliver.

---

## 10. Checklist 6 — Transaction Strategy Review

Tidak semua sistem perlu XA. Tidak semua sistem aman tanpa XA.

### 10.1 Pilihan Transaction Strategy

| Strategy | Cocok untuk | Risiko |
|---|---|---|
| No transaction | Fire-and-forget non-critical | Loss/duplicate sulit dikontrol |
| Local JMS transaction | JMS-only work | Tidak atomic dengan DB |
| DB transaction + manual ack | Consumer DB side effect | Duplicate jika crash before ack |
| JTA/XA | Atomic DB+JMS kuat | Complexity, performance, heuristic failure |
| Outbox | DB mutation + publish reliable | Relay delay, eventual consistency |
| Inbox | Consumer dedup reliable | Storage/cleanup complexity |
| Outbox + Inbox | Enterprise async correctness | Lebih banyak moving parts |

### 10.2 Decision Heuristic

Gunakan XA jika:

- Runtime dan broker support matang.
- Throughput masih masuk.
- Operasi memahami XA recovery.
- Konsistensi atomic lebih penting daripada simplicity.
- Failure recovery XA bisa diobservasi dan dioperasikan.

Gunakan outbox/inbox jika:

- Anda mengutamakan simplicity operational dibanding distributed transaction.
- Eventual consistency acceptable.
- Anda butuh auditability tinggi.
- Anda ingin replay/reconciliation jelas.
- Anda menghindari heuristic XA failure.

Jangan gunakan “best effort send after commit” untuk sistem critical kecuali ada reconciliation job yang jelas.

---

## 11. Checklist 7 — Reliability and Delivery Guarantee Review

### 11.1 Delivery Claim Harus Didefinisikan End-to-End

Jangan menulis:

```text
The system guarantees exactly-once delivery.
```

Lebih jujur:

```text
The broker may redeliver messages. Consumers are designed for at-least-once delivery and effectively-once business effect using application-level idempotency keys, inbox deduplication, and monotonic state transition checks.
```

### 11.2 Reliability Questions

- Apakah message persistent?
- Apakah broker storage durable?
- Apakah broker replication/backup jelas?
- Apakah producer retry bisa duplicate?
- Apakah consumer duplicate-safe?
- Apakah redelivery count dipantau?
- Apakah DLQ bukan akhir yang dilupakan?
- Apakah replay governance ada?
- Apakah audit bisa membuktikan message mana menghasilkan state mana?

### 11.3 Delivery Semantics Table

| Claim | Arti nyata |
|---|---|
| At-most-once | Bisa hilang, tidak duplicate |
| At-least-once | Tidak hilang jika durability benar, bisa duplicate |
| Effectively-once | Duplicate mungkin, efek bisnis satu kali secara logical |
| Exactly-once | Harus dibatasi konteks; jarang benar end-to-end |

Top-level engineer sangat hati-hati memakai kata “exactly once”.

---

## 12. Checklist 8 — Ordering Review

Ordering adalah salah satu sumber ilusi paling umum.

### 12.1 Pertanyaan Kunci

- Ordering dibutuhkan global atau per entity?
- Jika global, apakah throughput rendah acceptable?
- Jika per entity, apa aggregate key-nya?
- Apakah concurrent consumer bisa reorder?
- Apakah rollback bisa membuat message lama muncul ulang?
- Apakah priority/TTL/delay bisa mengubah order?
- Apakah consumer handler monotonic?
- Apakah event punya version/sequence?

### 12.2 Heuristik

> Jangan mengejar global ordering kecuali benar-benar perlu. Kejar ordering per aggregate.

Contoh aggregate:

```text
caseId
applicationId
customerId
appealId
invoiceId
```

Desain state transition:

```text
Current status: SUBMITTED
Incoming event: APPROVED with version 5

Apply only if:
- event.version == current.version + 1, or
- transition is explicitly allowed, or
- event is stale and can be ignored safely
```

### 12.3 Ordering Anti-Patterns

- Menggunakan satu queue global untuk semua workflow critical.
- Menambah consumer concurrency lalu mengira FIFO tetap utuh.
- Tidak menyimpan aggregate version.
- Menganggap redelivery tidak memengaruhi ordering.
- Menggunakan priority untuk urgent case tanpa memikirkan starvation.

---

## 13. Checklist 9 — Retry, Redelivery, DLQ, dan Replay Review

### 13.1 Retry Classification

Setiap error harus dikategorikan.

| Error | Contoh | Action |
|---|---|---|
| Transient | DB timeout, network glitch | Retry/redelivery |
| Downstream degraded | API 503, broker bridge down | Backoff/circuit breaker |
| Permanent data issue | Invalid schema, missing required field | DLQ / reject / repair |
| Business conflict | Invalid transition | No-op + audit, atau business error flow |
| Security issue | Unauthorized tenant | Quarantine + alert |
| Unknown | Unexpected exception | Limited retry then DLQ |

### 13.2 DLQ Review

Untuk setiap DLQ:

- Apakah ada owner?
- Apakah ada alert?
- Apakah ada dashboard?
- Apakah ada SOP triage?
- Apakah ada kategori error?
- Apakah replay aman?
- Apakah replay butuh approval?
- Apakah message bisa diedit?
- Apakah edit message diaudit?
- Apakah ada retention policy?
- Apakah ada purge policy?

### 13.3 Replay Governance

Replay bukan sekadar “send ulang”. Replay adalah operasi produksi yang bisa mengubah state.

Replay harus menjawab:

- Siapa yang request replay?
- Apa alasan replay?
- Message mana yang direplay?
- Apakah payload asli atau payload diperbaiki?
- Apakah replay dry-run tersedia?
- Apakah handler idempotent?
- Apakah replay window aman?
- Bagaimana rollback jika replay salah?
- Bagaimana audit mencatat replay?

---

## 14. Checklist 10 — Performance and Capacity Review

### 14.1 Jangan Mulai dari Tuning

Performance review yang matang dimulai dari model:

```text
Arrival rate: berapa message/sec masuk?
Service rate: berapa message/sec bisa diproses?
Queue depth: backlog saat service rate < arrival rate
Oldest message age: seberapa lama pekerjaan tertunda
Latency: waktu dari publish sampai side effect selesai
```

Little’s Law secara intuitif:

```text
Average items in system = arrival rate x average time in system
```

Jika arrival rate 100 message/sec dan average time in system 60 detik, rata-rata ada 6000 message dalam sistem.

### 14.2 Capacity Questions

- Peak arrival rate berapa?
- Sustained arrival rate berapa?
- Service time per message berapa?
- P95/P99 processing time berapa?
- Bottleneck ada di broker, consumer CPU, DB, network, atau downstream API?
- Consumer concurrency aman untuk DB?
- Prefetch terlalu besar atau terlalu kecil?
- Persistent message membuat storage bottleneck?
- Broker paging terjadi?
- Queue depth naik terus atau sawtooth normal?
- Oldest message age melanggar SLA?

### 14.3 Scaling Heuristics

| Symptom | Kemungkinan penyebab | Aksi |
|---|---|---|
| Queue depth naik, CPU consumer rendah | Downstream/DB blocking | Investigasi dependency |
| Queue depth naik, CPU tinggi | Consumer CPU bottleneck | Scale consumers / optimize code |
| Broker disk tinggi | Persistent write bottleneck/paging | Storage tuning / batching |
| Redelivery tinggi | Handler failure | Fix error classification |
| DLQ naik | Permanent data/contract issue | Contract/schema governance |
| Latency tinggi, depth rendah | Slow handler per message | Optimize handler |
| Depth tinggi, oldest age tinggi | Under-capacity | Scale / throttle producer |

---

## 15. Checklist 11 — Observability Review

Tanpa observability, JMS menjadi kotak hitam.

### 15.1 Minimum Metrics

Broker/destination:

- Queue depth.
- Oldest message age.
- Enqueue rate.
- Dequeue rate.
- Consumer count.
- Delivering count.
- Redelivery count.
- DLQ count.
- Paging status.
- Broker disk usage.
- Broker memory usage.

Consumer:

- Processing count.
- Success count.
- Failure count.
- Retry count.
- Processing latency.
- End-to-end latency.
- Dedup hit count.
- Business no-op count.
- External call latency.
- DB transaction latency.

Producer:

- Publish count.
- Publish failure count.
- Publish latency.
- Outbox pending count.
- Outbox oldest age.
- Duplicate publish retry count.

### 15.2 Minimum Logs

Setiap message processing log harus bisa menjawab:

- Message ID apa?
- Correlation ID apa?
- Causation ID apa?
- Aggregate ID apa?
- Destination apa?
- Consumer apa?
- Attempt ke berapa?
- Decision apa?
- State before/after apa?
- Side effect apa?
- Error category apa?

### 15.3 Trace Across Async Boundary

Trace synchronous mudah. Trace asynchronous lebih sulit.

Minimal propagation:

```text
traceId
spanId / parentSpanId
correlationId
causationId
messageId
aggregateId
```

Jika tool tracing belum sempurna, log structured + audit table tetap harus cukup untuk forensic reconstruction.

---

## 16. Checklist 12 — Security Review

Security JMS bukan hanya TLS.

### 16.1 Security Questions

- Apakah connection ke broker encrypted?
- Apakah authentication per service?
- Apakah credential unique per aplikasi?
- Apakah permission per destination least privilege?
- Apakah producer boleh publish hanya ke destination tertentu?
- Apakah consumer boleh consume hanya dari destination tertentu?
- Apakah DLQ/parking lot dilindungi?
- Apakah replay tool butuh approval?
- Apakah payload mengandung PII/secrets?
- Apakah message at rest encrypted?
- Apakah secret broker rotation ada?
- Apakah audit mencatat administrative action?

### 16.2 Least Privilege Example

Service `case-service`:

```text
Can send:
- case.event.case-created.v1
- case.event.case-status-changed.v1

Can consume:
- case.command.evaluate-risk.v1

Cannot consume:
- notification.command.send-email.v1
- payment.command.capture-payment.v1

Cannot send:
- audit.event.admin-action.v1
```

### 16.3 Security Anti-Patterns

- Semua service memakai credential broker yang sama.
- Semua service punya wildcard access.
- DLQ bisa dibaca siapa saja.
- Replay tool tidak diaudit.
- Payload menyimpan secret/token.
- Message property berisi PII sensitif tanpa masking/log discipline.
- Broker console exposed tanpa network restriction.

---

## 17. Checklist 13 — Schema and Contract Review

### 17.1 Contract Questions

- Apakah schema version eksplisit?
- Apakah perubahan additive atau breaking?
- Apakah consumer lama bisa membaca message baru?
- Apakah producer baru bisa coexist dengan consumer lama?
- Apakah field removal punya deprecation window?
- Apakah enum evolution aman?
- Apakah default value jelas?
- Apakah unknown field diabaikan aman?
- Apakah message contract diuji?
- Apakah ada sample payload canonical?

### 17.2 Compatibility Heuristics

Aman biasanya:

- Menambah optional field.
- Menambah nullable field dengan default jelas.
- Menambah event type baru jika consumer ignore unknown type secara aman.
- Menambah enum jika consumer punya fallback.

Berbahaya:

- Menghapus required field.
- Mengubah tipe field.
- Mengubah semantic field lama.
- Mengganti unit tanpa nama baru.
- Mengubah arti status enum.
- Mengubah idempotency key.

---

## 18. Checklist 14 — Operational Readiness Review

Sebelum go-live, JMS solution harus punya operational readiness.

### 18.1 Readiness Questions

- Apakah destination dibuat otomatis atau managed IaC?
- Apakah broker config versioned?
- Apakah redelivery/DLQ config jelas?
- Apakah secret injection aman?
- Apakah consumer graceful shutdown sudah diuji?
- Apakah rolling deployment aman?
- Apakah backward compatibility message diuji?
- Apakah failover broker diuji?
- Apakah backup/restore diuji?
- Apakah DLQ replay diuji?
- Apakah dashboard ada?
- Apakah alert threshold disepakati?
- Apakah runbook tersedia?

### 18.2 Go-Live Minimum

Minimum untuk production:

```text
[ ] Destination inventory
[ ] Producer inventory
[ ] Consumer inventory
[ ] Message contract documentation
[ ] Retry/redelivery policy
[ ] DLQ owner and SOP
[ ] Replay SOP
[ ] Security ACL
[ ] Dashboard
[ ] Alerts
[ ] Capacity estimate
[ ] Failure test result
[ ] Rollback plan
[ ] Compatibility plan
[ ] On-call runbook
```

---

## 19. Interview-Level Reasoning Questions

Bagian ini adalah latihan untuk menguji apakah pemahaman sudah melewati level API.

### 19.1 Question: Apa Perbedaan Queue dan Topic?

Jawaban junior:

> Queue satu consumer, topic banyak consumer.

Jawaban lebih matang:

> Queue merepresentasikan work distribution: satu message diproses oleh satu consumer secara logical, meskipun ada banyak competing consumers. Topic merepresentasikan publish/subscribe: satu publication bisa dikirim ke banyak subscription. Queue cocok untuk command/work item; topic cocok untuk event/fact. Namun detail seperti durable subscription, shared subscription, redelivery, dan provider behavior memengaruhi semantics production.

### 19.2 Question: Apakah JMS Menjamin Exactly Once?

Jawaban kuat:

> JMS dapat mendukung delivery acknowledgement, persistent message, transaction, dan redelivery semantics, tetapi exactly-once end-to-end jarang bisa diklaim hanya dari broker. Crash, retry, network uncertainty, dan side effect eksternal membuat duplicate tetap harus diasumsikan. Desain production biasanya memakai at-least-once delivery dengan effectively-once business effect melalui idempotency key, inbox deduplication, business state transition guard, dan audit trail.

### 19.3 Question: Consumer Crash Setelah Commit DB Tetapi Sebelum Ack. Apa yang Terjadi?

Jawaban kuat:

> Broker dapat redeliver message karena ack belum diterima. Jika handler tidak idempotent, side effect DB bisa terjadi dua kali. Solusi defensible adalah inbox/dedup table, unique business constraint, idempotent state transition, atau transaction strategy yang menyatukan ack dan DB commit. Jika memakai local DB transaction + manual/JMS ack, duplicate harus dianggap normal.

### 19.4 Question: Producer Commit DB Sukses Tetapi Publish Message Gagal. Bagaimana Mengatasinya?

Jawaban kuat:

> Ini adalah dual-write problem. Solusi umum adalah transactional outbox: dalam transaksi DB yang sama, simpan state change dan outbox record. Relay terpisah publish ke broker dan menandai status publish. Jika publish duplicate terjadi, consumer harus idempotent. Alternatifnya JTA/XA jika benar-benar perlu atomic DB+JMS dan operasional mendukung.

### 19.5 Question: Kapan Memilih JMS Dibanding Kafka?

Jawaban kuat:

> JMS lebih cocok untuk enterprise work queue, command processing, broker-managed delivery/redelivery/DLQ, dan integrasi Java/Jakarta EE/Spring. Kafka lebih cocok untuk append-only event log, replay historis, multiple consumer groups, stream processing, dan retention panjang. Pilihan tidak berdasarkan throughput semata, tetapi semantics: queue vs log, ownership, replay, ordering, retention, operational model, dan failure recovery.

### 19.6 Question: Apa Risiko Prefetch Terlalu Besar?

Jawaban kuat:

> Message sudah dikirim ke consumer buffer tetapi belum selesai diproses. Jika consumer lambat, message bisa tertahan di client dan tidak tersedia untuk consumer lain, menyebabkan unfair distribution, memory pressure, shutdown lebih sulit, dan redelivery burst saat crash. Prefetch/window harus disesuaikan dengan processing time, concurrency, payload size, dan fairness requirement.

### 19.7 Question: Apa Bedanya Retry dan Redelivery?

Jawaban kuat:

> Retry bisa terjadi di banyak layer: producer retry send, consumer retry operation internal, broker redelivery setelah rollback/no ack, atau replay manual dari DLQ. Redelivery biasanya berarti broker mengirim ulang message yang sama karena belum dianggap selesai. Desain harus menghindari retry multiplication, misalnya 3 retry HTTP di handler dikali 5 redelivery broker menjadi 15 call downstream per message.

### 19.8 Question: Apa yang Harus Ada di Message Envelope?

Jawaban kuat:

> Minimal application message ID, correlation ID, causation ID, message type, schema version, producer, timestamp, aggregate ID jika ordering/idempotency perlu, tenant/context jika multi-tenant, dan metadata audit. Header JMS berguna, tetapi application envelope memberi stabilitas lintas provider, replay, log, dan contract evolution.

---

## 20. Top 1% Heuristics untuk JMS Engineering

### Heuristic 1 — Treat Every Message as a Durable Claim

Message bukan object transient. Dalam enterprise system, message adalah klaim bahwa sesuatu harus dilakukan atau sesuatu telah terjadi.

Maka message harus:

- Bernama jelas.
- Punya semantic stabil.
- Punya version.
- Bisa diaudit.
- Bisa dikorelasikan.
- Bisa gagal dan dipulihkan.

### Heuristic 2 — Assume Duplicate Before You See Duplicate

Jangan menunggu duplicate terjadi.

Desain dari awal dengan asumsi:

```text
Any message may be delivered more than once.
Any send may be retried.
Any ack may be lost.
Any consumer may crash after side effect.
```

Jika duplicate tidak merusak state, banyak masalah production menjadi lebih kecil.

### Heuristic 3 — Separate Transport Success from Business Success

Transport success:

```text
Message accepted by broker.
Message delivered to consumer.
Message acknowledged.
```

Business success:

```text
State transition valid.
DB committed.
Audit recorded.
External side effect completed or safely scheduled.
```

Jangan mencampur keduanya.

### Heuristic 4 — Queue Depth Is Not the Only Lag Signal

Queue depth rendah belum tentu sehat.

Mungkin:

- Message tertahan di prefetch consumer.
- Handler lambat tapi queue kosong karena dispatch cepat.
- Topic subscriber backlog tersembunyi.
- Outbox pending menumpuk sebelum broker.
- Downstream side effect gagal tetapi ack tetap jalan.

Pantau end-to-end latency dan oldest work age, bukan hanya depth.

### Heuristic 5 — DLQ Is a Workflow, Not a Trash Bin

DLQ harus punya:

- Owner.
- Alert.
- Classification.
- Repair path.
- Replay path.
- Audit.
- Retention.

DLQ tanpa proses adalah kuburan data.

### Heuristic 6 — Ordering Is Usually Per Aggregate, Not Global

Global ordering mahal dan sering tidak perlu.

Lebih sering requirement sebenarnya:

```text
Events for the same case/application/customer must be applied in order.
```

Maka desain dengan aggregate key, message group, partitioning, atau state version.

### Heuristic 7 — Broker Is Not a Database

Broker menyimpan message untuk delivery, bukan untuk query bisnis.

Jangan memakai broker untuk:

- Query status bisnis.
- Long-term audit utama.
- Reporting.
- Search.
- Permanent system of record.

Gunakan database/audit store untuk state dan evidence.

### Heuristic 8 — Database Is Not Always a Queue

Database table polling bisa cukup untuk outbox/job sederhana, tetapi bukan pengganti universal broker.

Database queue sering bermasalah jika:

- High concurrency claiming.
- Need broker dispatch.
- Need consumer flow control.
- Need DLQ/redelivery semantics.
- Need fan-out pub/sub.
- Need protocol-level integration.

### Heuristic 9 — Version Contracts Before You Need Migration

Message contract hidup lebih lama dari kode producer.

Semua message production harus diasumsikan masih bisa muncul setelah deploy berikutnya karena:

- Backlog.
- DLQ replay.
- Backup restore.
- Delayed message.
- Durable subscriber.
- Cross-system latency.

### Heuristic 10 — Operational Simplicity Is a Feature

Desain yang terlalu canggih tapi sulit dioperasikan akan gagal.

XA, clustering, priority, selector kompleks, dynamic destination, custom retry engine, dan replay mutation tool bisa berguna, tetapi masing-masing menambah operational burden.

Top engineer tidak hanya bertanya “bisa atau tidak”, tetapi:

> “Siapa yang akan mengoperasikan ini jam 3 pagi saat gagal?”

---

## 21. Architecture Review Template

Gunakan template ini saat mereview solusi JMS.

### 21.1 Context

```text
System:
Business capability:
Producer services:
Consumer services:
Broker/provider:
Runtime:
Java version:
Framework:
Environment:
Criticality:
SLA/SLO:
```

### 21.2 Message Inventory

```text
Message name:
Type: command/event/document/request/reply
Destination:
Producer:
Consumer(s):
Schema version:
Payload format:
Ordering key:
Idempotency key:
TTL:
Priority:
Durability:
```

### 21.3 Correctness Model

```text
Delivery expectation:
Duplicate handling:
Ordering expectation:
Transaction boundary:
Ack boundary:
DB side effect:
External side effect:
Outbox/inbox:
Replay safety:
```

### 21.4 Failure Model

```text
Producer publish failure:
Producer duplicate publish:
Broker down:
Broker failover:
Consumer crash before side effect:
Consumer crash after side effect before ack:
DB down:
External API down:
Poison message:
Schema mismatch:
DLQ growth:
Replay error:
```

### 21.5 Observability

```text
Metrics:
Logs:
Trace propagation:
Dashboard:
Alerts:
Audit table:
Runbook:
```

### 21.6 Security

```text
Authentication:
Authorization:
TLS/mTLS:
Secret rotation:
Tenant isolation:
Payload sensitivity:
Admin access:
Replay permission:
Audit permission:
```

### 21.7 Operations

```text
Deployment model:
Broker topology:
Persistence:
Backup:
DR:
Upgrade:
Rollback:
Capacity plan:
Load test result:
Failure test result:
```

---

## 22. Red Flag List

Jika Anda melihat hal-hal berikut dalam desain JMS, lakukan review serius.

### 22.1 Semantic Red Flags

- “Queue event” tetapi hanya boleh diproses oleh satu service tertentu.
- “Event” yang memberi instruksi imperative.
- Message tanpa version.
- Message tanpa correlation ID.
- Message tanpa stable business key.
- Payload hanya berisi database ID tetapi consumer butuh historical snapshot.

### 22.2 Reliability Red Flags

- “Tidak mungkin duplicate.”
- “AUTO_ACK cukup untuk semua.”
- “Kalau gagal tinggal retry terus.”
- “DLQ nanti saja.”
- “Replay tinggal kirim ulang.”
- “Exactly once dijamin broker.”
- “DB commit lalu send message langsung aman.”

### 22.3 Performance Red Flags

- Membuat connection per message.
- Consumer concurrency dinaikkan tanpa cek DB capacity.
- Prefetch besar untuk slow handler.
- Payload besar dikirim inline tanpa claim check.
- Persistent message high-volume tanpa storage sizing.
- Selector kompleks di hot path.
- Priority dipakai untuk semua urgent flow.

### 22.4 Operational Red Flags

- Tidak ada dashboard.
- Tidak ada alert oldest message age.
- Tidak ada owner DLQ.
- Tidak ada runbook replay.
- Tidak ada broker backup/restore test.
- Tidak ada failover test.
- Tidak ada contract compatibility test.
- Tidak ada graceful shutdown test.

### 22.5 Security Red Flags

- Semua service pakai user broker yang sama.
- Wildcard permission.
- DLQ bebas dibaca banyak role.
- Broker console terbuka luas.
- Payload mengandung token/password.
- Replay tool tanpa approval/audit.

---

## 23. Green Flag List

Desain JMS yang matang biasanya punya tanda-tanda ini.

- Message contract jelas dan versioned.
- Command dan event dipisahkan.
- Destination ownership jelas.
- Producer memakai outbox untuk DB-driven event.
- Consumer memakai inbox/dedup untuk side effect critical.
- Handler idempotent.
- Redelivery policy eksplisit.
- DLQ punya owner dan SOP.
- Replay punya governance.
- Ordering didefinisikan per aggregate.
- Observability mencakup queue depth, oldest age, redelivery, DLQ, processing latency, end-to-end latency.
- Security memakai least privilege.
- Capacity model punya angka.
- Failure mode diuji, bukan hanya dibahas.
- Upgrade/rollback plan mempertimbangkan message backlog versi lama.

---

## 24. Final Reference Architecture Mini-Blueprint

Berikut blueprint singkat yang menggabungkan prinsip seri ini.

```text
[API / UI / Batch]
       |
       v
[Application Service]
       |
       | DB transaction
       | - mutate aggregate
       | - append audit
       | - insert outbox event/command
       v
[Application DB]
       |
       v
[Outbox Relay]
       |
       | publish with messageId/correlationId/schemaVersion
       v
[JMS Broker]
       |
       +--> command queue: module.command.do-work.v1
       |
       +--> event topic: module.event.something-happened.v1
       |
       +--> DLQ / parking lot
       v
[Consumer Service]
       |
       | - validate envelope
       | - inbox dedup
       | - load aggregate/state
       | - apply idempotent transition
       | - append audit
       | - append outbox if needed
       v
[Consumer DB]
       |
       v
[Monitoring / Audit / Replay Console]
```

Core invariant:

```text
Every externally visible business effect is either:
1. committed with audit and dedup evidence, or
2. safely retryable, or
3. parked in an observable recovery workflow.
```

---

## 25. Java 8–25 Practical Positioning

### 25.1 Java 8

Di Java 8, banyak enterprise JMS system masih memakai:

- `javax.jms`.
- JMS 1.1 / JMS 2.0 depending provider.
- Java EE / older Spring Boot.
- App server integration.
- MDB/JCA patterns.

Practical advice:

- Hati-hati dependency conflict.
- Jangan campur `javax.jms` dan `jakarta.jms` sembarangan.
- Fokus pada stable reliability pattern: outbox, inbox, idempotency.
- Upgrade framework sering lebih sulit daripada upgrade code.

### 25.2 Java 11/17

Di Java 11/17, transisi modern biasanya mulai:

- Spring Boot 2/3 boundary.
- Jakarta namespace migration.
- Containerized deployment.
- Modern observability.
- Better TLS/runtime defaults.

Practical advice:

- Audit library compatibility.
- Perjelas provider client version.
- Pisahkan migration namespace dari migration broker.
- Jangan upgrade semuanya sekaligus.

### 25.3 Java 21/25

Di Java 21/25, Anda mendapat runtime modern:

- Virtual threads tersedia sejak Java 21.
- GC dan runtime diagnostics lebih matang.
- Better profiling/observability ecosystem.
- Modern build/deployment.

Tetapi:

- JMS `Session` tetap punya thread-safety/lifecycle rule.
- Virtual threads bukan alasan memakai satu session dari banyak thread.
- Broker bottleneck/storage/downstream tetap nyata.
- Correctness pattern tidak berubah.

Practical advice:

- Gunakan virtual threads secara hati-hati untuk blocking orchestration, bukan untuk melanggar JMS object lifecycle.
- Tetap ukur dengan benchmark realistis.
- Fokus pada end-to-end latency, bukan hanya thread count.

---

## 26. How to Think Like a Top-Level Engineer in JMS Design

### 26.1 Mulai dari Domain, Bukan Broker

Jangan mulai dari:

```text
Kita butuh queue apa?
```

Mulai dari:

```text
Business state apa yang berubah?
Siapa owner state?
Command apa yang valid?
Event apa yang merupakan fakta?
Failure apa yang acceptable?
Audit evidence apa yang dibutuhkan?
```

### 26.2 Modeling First, Configuration Later

Broker config penting, tetapi tidak bisa menyelamatkan model yang salah.

Urutan yang sehat:

1. Domain semantics.
2. Message contract.
3. Transaction/ack strategy.
4. Idempotency strategy.
5. Failure/retry/DLQ strategy.
6. Observability strategy.
7. Broker/provider config.
8. Performance tuning.

### 26.3 Bias ke Explicitness

Dalam sistem asynchronous, implicit behavior membunuh debugging.

Buat eksplisit:

- Message type.
- Version.
- Correlation.
- Causation.
- Aggregate key.
- Retry policy.
- DLQ route.
- Replay decision.
- Handler decision.
- State transition.

### 26.4 Design for the Operator

Operator perlu menjawab:

- Message apa yang macet?
- Dari mana asalnya?
- Kenapa gagal?
- Apakah aman diretry?
- Apakah aman direplay?
- Siapa yang harus approve?
- Apa dampak bisnis?

Jika desain tidak membantu operator, desain belum selesai.

---

## 27. Final Exercises

### Exercise 1 — Dual Write Failure

Scenario:

```text
A service updates application status to APPROVED in DB.
After commit, it sends ApplicationApprovedEvent to JMS topic.
The DB commit succeeds, but broker send fails.
```

Jawab:

1. Apa state sistem sekarang?
2. Consumer apa yang tidak menerima event?
3. Apakah retry send aman?
4. Bagaimana outbox menyelesaikan ini?
5. Apa observability yang dibutuhkan?

### Exercise 2 — Duplicate Consumer Side Effect

Scenario:

```text
Consumer receives SendEmailCommand.
It sends email successfully.
Then consumer crashes before JMS ack.
Broker redelivers message.
```

Jawab:

1. Apa risiko bisnis?
2. Apakah dedup by JMSMessageID cukup?
3. Apa idempotency key yang lebih baik?
4. Bagaimana audit mencatat email sent?
5. Bagaimana handler menjadi replay-safe?

### Exercise 3 — Out-of-Order Case Status Event

Scenario:

```text
CaseStatusChangedEvent(version=5, status=CLOSED) processed first.
Later version=4, status=UNDER_REVIEW arrives due to redelivery/reorder.
```

Jawab:

1. Apakah event version 4 harus diterapkan?
2. Apa state transition guard-nya?
3. Apa yang dicatat di audit?
4. Apakah ini error atau stale no-op?
5. Bagaimana monitoring mendeteksi out-of-order rate?

### Exercise 4 — DLQ Replay Gone Wrong

Scenario:

```text
Operator replays 5000 DLQ messages after fixing schema issue.
Consumers overload DB and downstream API.
```

Jawab:

1. Apa yang salah dalam replay governance?
2. Bagaimana throttling replay didesain?
3. Apa dry-run yang seharusnya ada?
4. Bagaimana rollback dilakukan?
5. Apa dashboard yang harus dipantau?

### Exercise 5 — Selector Abuse

Scenario:

```text
One topic receives all enterprise events.
Each consumer uses complex JMS selector with many properties.
Broker CPU spikes.
```

Jawab:

1. Apa anti-pattern-nya?
2. Kapan selector masih pantas?
3. Apakah topic perlu dipecah?
4. Apakah routing service lebih tepat?
5. Apa contract governance yang dibutuhkan?

---

## 28. Summary of the Entire Series

Seri ini membangun pemahaman JMS/Jakarta Messaging dari dasar sampai production-grade.

Kita mulai dari:

- Mental model asynchronous messaging.
- Evolusi JMS ke Jakarta Messaging.
- Domain model API.
- Queue dan topic semantics.
- Message anatomy dan message types.
- Producer/consumer engineering.
- Ack, transaction, reliability, ordering.
- Retry, DLQ, request/reply, selectors.
- Security, broker architecture, provider differences.
- Jakarta EE runtime dan Spring integration.
- Microservices, schema contract, idempotency.
- Capacity, performance, observability, testing.
- Deployment, Kubernetes, technology comparison.
- Enterprise Integration Patterns.
- Failure modeling.
- Production blueprint.
- Final design review heuristics.

Inti akhirnya:

> JMS mastery bukan kemampuan memakai API. JMS mastery adalah kemampuan membangun asynchronous system yang tetap benar, bisa dipulihkan, bisa diaudit, dan bisa dioperasikan saat real-world failure terjadi.

---

## 29. Final Top-Level Checklist

Sebelum menyebut desain JMS Anda production-ready, pastikan ini benar:

```text
[ ] Message semantics jelas: command/event/document/request/reply
[ ] Destination ownership jelas
[ ] Message contract versioned
[ ] Correlation/causation/message ID tersedia
[ ] Ack boundary selaras dengan side effect
[ ] Transaction strategy eksplisit
[ ] Duplicate handling tersedia
[ ] Ordering requirement didefinisikan
[ ] Retry/redelivery policy jelas
[ ] DLQ punya owner, alert, SOP
[ ] Replay governance tersedia
[ ] Schema compatibility diuji
[ ] Security least privilege diterapkan
[ ] Metrics/logs/traces/audit tersedia
[ ] Capacity model tersedia
[ ] Failure mode diuji
[ ] Graceful shutdown diuji
[ ] Upgrade/rollback mempertimbangkan backlog
[ ] Operator bisa menjelaskan dan memulihkan incident
```

Jika semua ini ada, desain Anda sudah jauh melewati level “bisa consume queue”.

---

## 30. Penutup

Ini adalah **bagian terakhir** dari seri `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`.

Seri selesai pada **Part 35 dari 35**.

Kemampuan berikutnya yang secara natural bisa dilanjutkan setelah JMS adalah:

1. **Advanced Message Broker Internals**: journal, paging, replication, clustering, dispatch algorithm, storage engine.
2. **Kafka Deep Engineering**: log semantics, partitioning, consumer group, exactly-once processing boundary, stream processing.
3. **RabbitMQ / AMQP Deep Engineering**: exchange, binding, routing, quorum queue, stream queue, publisher confirm.
4. **Distributed Transactions and Consistency Patterns**: XA, saga, outbox/inbox, escrow, reconciliation.
5. **Workflow Engine / BPMN Deep Dive**: Camunda/Zeebe/Temporal-style orchestration and durable execution.
6. **Enterprise Integration Architecture**: EIP, ESB anti-pattern, API gateway, event mesh, integration governance.

Namun untuk seri JMS ini, fondasi sampai production mastery sudah lengkap.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-034.md">⬅️ Part 34 — Production Blueprint: Reference Architecture JMS untuk Sistem Enterprise Regulated Case Management</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>

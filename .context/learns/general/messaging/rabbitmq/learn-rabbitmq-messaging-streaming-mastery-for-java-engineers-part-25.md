# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-25.md

# Part 25 — Observability: Metrics, Logs, Tracing, and Message Forensics

> Seri: RabbitMQ, RabbitMQ Streams, and Messaging Mastery for Java Engineers  
> Bagian: 25 dari 34  
> Status seri: belum selesai  
> Fokus: membuat RabbitMQ dapat dipahami, di-debug, diaudit, dan dioperasikan saat sistem nyata mengalami backlog, duplicate, retry storm, DLQ spike, blocked publisher, slow consumer, atau kehilangan korelasi end-to-end.

---

## 1. Tujuan Bagian Ini

Sampai bagian sebelumnya, kita sudah membangun mental model RabbitMQ dari sisi routing, queue semantics, publisher reliability, consumer reliability, retry, stream, quorum queue, cluster, multi-region, dan security.

Bagian ini menjawab pertanyaan yang lebih operasional:

> Ketika sistem RabbitMQ bermasalah, bagaimana kita tahu apa yang sedang terjadi, mengapa terjadi, siapa yang terdampak, dan tindakan mana yang aman?

Observability RabbitMQ bukan hanya melihat dashboard queue depth. Queue depth hanya satu sinyal. Sistem RabbitMQ yang sehat harus bisa menjawab pertanyaan seperti:

- Producer mana yang publish terlalu cepat?
- Queue mana yang backlog-nya naik?
- Backlog itu karena consumer mati, consumer lambat, prefetch salah, external dependency lambat, atau broker overload?
- Message banyak di `ready` atau `unacked`?
- Redelivery naik karena retry normal, poison message, atau consumer crash loop?
- DLQ spike berasal dari message type apa?
- Apakah publisher sedang blocked karena memory/disk alarm?
- Apakah confirm latency naik?
- Apakah consumer utilization rendah karena consumer kurang, prefetch terlalu rendah, atau workload CPU/IO berat?
- Apakah message tertentu sudah pernah diproses sebelumnya?
- Apakah action bisnis bisa direkonstruksi dari message, DB transition, log, dan trace?

Untuk Java engineer senior, observability bukan afterthought. Ia adalah bagian dari desain topology dan contract.

---

## 2. Baseline Sumber Resmi

Beberapa baseline penting dari dokumentasi RabbitMQ modern:

- RabbitMQ monitoring didefinisikan sebagai proses menangkap perilaku sistem melalui health checks dan metrics dari waktu ke waktu, tidak hanya untuk anomaly detection tetapi juga root cause analysis, trend detection, dan capacity planning.
- Management UI menyediakan subset metrics, tetapi bukan long-term metrics store. Untuk long-term collection, RabbitMQ menyediakan integrasi Prometheus/Grafana.
- RabbitMQ memiliki firehose/tracing plugin untuk capture publish/deliver events, tetapi tracing message level harus dipakai hati-hati karena bisa mahal dan membuka payload sensitif.
- RabbitMQ consumer adalah subscription untuk message delivery; consumer metrics harus dipahami sebagai hubungan broker dengan subscription, bukan hanya thread aplikasi.
- RabbitMQ Java client menyediakan message properties dan headers yang bisa dipakai untuk metadata correlation, message id, content type, dan tracing.

Referensi:

- RabbitMQ Monitoring: <https://www.rabbitmq.com/docs/monitoring>
- RabbitMQ Prometheus: <https://www.rabbitmq.com/docs/prometheus>
- RabbitMQ Firehose/Tracing: <https://www.rabbitmq.com/docs/firehose>
- RabbitMQ Consumers: <https://www.rabbitmq.com/docs/consumers>
- RabbitMQ Java Client API Guide: <https://www.rabbitmq.com/client-libraries/java-api-guide>

---

## 3. Observability Bukan Monitoring Saja

Banyak tim memakai istilah monitoring dan observability secara longgar. Untuk RabbitMQ, bedanya penting.

### 3.1 Monitoring

Monitoring menjawab:

> Apakah sistem sedang berada dalam kondisi yang kita kenal sebagai sehat atau tidak sehat?

Contoh:

- Queue depth > threshold.
- Consumer count = 0.
- Disk free alarm active.
- Memory alarm active.
- Publish rate turun drastis.
- Redelivery rate naik.
- DLQ depth naik.

Monitoring biasanya berbasis metrics dan alert.

### 3.2 Observability

Observability menjawab:

> Dari output eksternal sistem, bisakah kita mengerti internal state dan causal chain tanpa harus menebak?

Contoh:

- Message `msg-123` dipublish oleh service A karena command `cmd-456`.
- Message itu diroute ke queue B.
- Consumer C mencoba proses 3 kali.
- Percobaan pertama timeout ke service D.
- Percobaan kedua gagal validasi schema.
- Percobaan ketiga masuk parking lot.
- Case transition tidak terjadi karena state machine guard menolak event version lama.

Observability membutuhkan kombinasi:

- metrics,
- logs,
- traces,
- message metadata,
- topology metadata,
- DB state,
- audit trail,
- operational runbook.

### 3.3 Message Forensics

Message forensics menjawab:

> Bisakah kita merekonstruksi apa yang terjadi terhadap message tertentu atau business action tertentu?

Forensics sangat penting untuk sistem enforcement/regulatory, fraud, payment, healthcare, audit, compliance, case management, dan workflow yang melibatkan human decision.

---

## 4. Mental Model: RabbitMQ State yang Harus Bisa Dilihat

Dalam RabbitMQ, state observability tersebar di beberapa layer:

```text
Application Producer
  |
  | publish + metadata + confirm
  v
Exchange
  |
  | routing via binding
  v
Queue / Quorum Queue / Stream
  |
  | deliver
  v
Consumer
  |
  | side effect + DB transaction
  v
Ack / Nack / Reject / Offset Store
```

Setiap edge punya observability sendiri.

### 4.1 Producer-side state

Yang harus terlihat:

- publish attempts,
- publish success,
- publish failure,
- confirm latency,
- nack count,
- return/unroutable count,
- blocked connection duration,
- in-flight publish count,
- outbox pending count,
- outbox age,
- serialization failure,
- contract version distribution.

### 4.2 Broker routing state

Yang harus terlihat:

- exchange exists,
- binding exists,
- route count,
- unroutable messages,
- alternate exchange traffic,
- topology drift,
- permission failure,
- vhost isolation,
- policy application.

### 4.3 Queue state

Yang harus terlihat:

- ready messages,
- unacked messages,
- total messages,
- publish rate,
- deliver rate,
- ack rate,
- redelivery rate,
- consumer count,
- consumer utilization,
- oldest message age,
- queue growth slope,
- memory/disk footprint,
- dead-letter rate,
- queue type,
- leader/replica status for quorum/stream.

### 4.4 Consumer-side state

Yang harus terlihat:

- receive count,
- handler latency,
- ack latency,
- success count,
- business failure count,
- technical failure count,
- validation failure count,
- duplicate ignored count,
- idempotency conflict count,
- retry decision count,
- DLQ decision count,
- external dependency latency,
- DB transaction latency,
- consumer active threads,
- JVM pressure.

### 4.5 Business state

Yang harus terlihat:

- business entity id,
- case id,
- command id,
- event id,
- workflow state before/after,
- actor,
- reason code,
- policy/rule version,
- decision timestamp,
- message correlation/causation.

RabbitMQ metrics tanpa business metadata sering cukup untuk menjaga broker hidup, tetapi tidak cukup untuk menjelaskan bisnis.

---

## 5. Empat Pilar Observability RabbitMQ

### 5.1 Metrics

Metrics adalah angka time-series.

Contoh:

```text
rabbitmq_queue_messages_ready{queue="case.review.requested.q"} 1200
rabbitmq_queue_messages_unacked{queue="case.review.requested.q"} 40
rabbitmq_queue_consumers{queue="case.review.requested.q"} 8
app_consumer_handler_seconds_bucket{message_type="ReviewRequested"} ...
app_message_dlq_total{reason="validation_failed"} 23
```

Metrics bagus untuk alert, trend, capacity planning, dan dashboard.

### 5.2 Logs

Logs adalah event tekstual/structured dari aplikasi atau broker.

Contoh structured log:

```json
{
  "level": "INFO",
  "event": "rabbit.consumer.ack",
  "messageId": "msg-01HR...",
  "messageType": "CaseReviewRequested",
  "correlationId": "corr-8c1f",
  "causationId": "cmd-77a",
  "caseId": "CASE-2026-00091",
  "queue": "case.review.requested.q",
  "deliveryTag": 98231,
  "redelivered": false,
  "attempt": 1,
  "handlerMs": 184,
  "result": "success"
}
```

Logs bagus untuk forensic detail, tetapi buruk untuk aggregate trend jika tidak distandardisasi.

### 5.3 Traces

Trace menunjukkan causal path lintas service.

Contoh flow:

```text
HTTP POST /cases/{id}/review-request
  -> DB transaction: insert review request
  -> outbox relay publish ReviewRequested
  -> RabbitMQ exchange route
  -> review-service consumer
  -> DB transaction: create review task
  -> publish ReviewTaskCreated
```

Trace bagus untuk latency breakdown dan causal chain.

### 5.4 Message Metadata

Metadata adalah observability yang dibawa oleh message.

Minimal metadata:

```json
{
  "messageId": "msg-...",
  "messageType": "CaseReviewRequested",
  "schemaVersion": 3,
  "correlationId": "corr-...",
  "causationId": "cmd-...",
  "idempotencyKey": "case:123:review-requested:v7",
  "producer": "case-service",
  "occurredAt": "2026-06-19T10:15:30Z",
  "publishedAt": "2026-06-19T10:15:31Z"
}
```

Tanpa metadata, message broker menjadi “pipa gelap”.

---

## 6. RabbitMQ Metrics yang Harus Dipahami

Bagian ini bukan daftar hafalan. Kita akan pahami arti tiap metric secara diagnostik.

### 6.1 Queue Ready Messages

`ready` adalah message yang berada di queue dan siap dikirim ke consumer.

Interpretasi:

- Ready naik, consumer count 0: consumer mati atau tidak terhubung.
- Ready naik, consumer count > 0, unacked rendah: consumer terlalu lambat atau publish rate terlalu tinggi.
- Ready naik, unacked tinggi: consumer sudah menerima banyak message tetapi belum ack.
- Ready stabil tinggi: backlog lama tidak turun; kapasitas consumer kurang.
- Ready naik tiba-tiba: burst producer, incident downstream, deployment consumer gagal, atau poison message blocking.

Jangan alert hanya pada absolute ready count. Alert lebih baik memakai kombinasi:

- ready count,
- oldest message age,
- growth rate,
- business criticality,
- consumer count,
- publish/deliver/ack rates.

### 6.2 Unacked Messages

`unacked` adalah message yang sudah dikirim broker ke consumer tetapi belum di-ack/nack/reject.

Interpretasi:

- Unacked tinggi dan consumer CPU tinggi: handler lambat.
- Unacked tinggi dan external dependency latency tinggi: downstream lambat.
- Unacked tinggi dan consumer log diam: handler hang/deadlock/thread starvation.
- Unacked tinggi mendekati `consumer_count * prefetch`: semua consumer saturated.
- Unacked tinggi dengan DB lock: transaction contention.

Rule of thumb:

```text
expected_max_unacked ≈ consumer_instances × consumers_per_instance × prefetch
```

Jika unacked jauh di atas ekspektasi, cek apakah ada channel/consumer tambahan, bug ack, atau prefetch tidak seperti yang diasumsikan.

### 6.3 Total Messages

Total messages umumnya:

```text
messages_total = ready + unacked
```

Total berguna untuk backlog, tetapi ready/unacked breakdown lebih diagnostik.

### 6.4 Publish Rate

Publish rate adalah laju message masuk ke broker/exchange/queue.

Interpretasi:

- Publish rate naik dan ack rate tidak naik: backlog akan tumbuh.
- Publish rate turun mendadak: producer outage, upstream traffic turun, publisher blocked, credential/permission issue.
- Publish rate normal tetapi business action hilang: routing error, mandatory disabled, consumer side issue.

### 6.5 Deliver/Get Rate

Deliver rate adalah laju message dikirim ke consumer.

Interpretasi:

- Deliver rate 0, ready > 0, consumer > 0: consumer mungkin blocked, prefetch saturated, channel issue, permission issue, single active consumer inactive, atau broker flow issue.
- Deliver rate tinggi tetapi ack rendah: consumer menerima tetapi gagal/slow.
- Deliver rate sejalan dengan ack rate: processing sehat.

### 6.6 Ack Rate

Ack rate adalah laju message berhasil diselesaikan oleh consumer.

Ack rate adalah indikator throughput consumer yang lebih bermakna daripada deliver rate.

Interpretasi:

- Ack rate turun: consumer processing turun.
- Ack rate < publish rate dalam periode lama: backlog tumbuh.
- Ack rate naik setelah scaling consumer: scaling efektif.
- Ack rate tidak naik setelah scaling: bottleneck bukan jumlah consumer, mungkin DB/external dependency/ordering/hot key.

### 6.7 Redelivery Rate

Redelivery menunjukkan message dikirim ulang.

Interpretasi:

- Redelivery rendah sesekali: normal saat restart/consumer crash minor.
- Redelivery spike: consumer failure, nack/requeue loop, deployment bug, downstream outage.
- Redelivery terus-menerus pada queue sama: poison message atau retry strategy salah.
- Redelivery + unacked tinggi: consumer crash/hang after delivery.

Redelivery adalah salah satu sinyal paling penting untuk reliability.

### 6.8 Consumer Count

Consumer count menunjukkan subscription aktif ke queue.

Interpretasi:

- Consumer count 0 untuk queue critical: incident.
- Consumer count lebih rendah dari expected replicas: deployment issue.
- Consumer count normal tetapi utilization rendah: consumer tidak efektif karena bottleneck internal.
- Consumer count terlalu tinggi: excessive channel/connection churn atau thundering herd.

### 6.9 Consumer Utilization / Capacity

RabbitMQ management sering menampilkan consumer utilization/capacity-like signal yang menunjukkan seberapa sering queue bisa langsung deliver ke consumer.

Interpretasi kasar:

- Utilization tinggi: consumer siap menerima; bottleneck mungkin producer rendah.
- Utilization rendah + backlog tinggi: consumer tidak cukup cepat/available.
- Utilization rendah + unacked tinggi: prefetch saturated atau handler lambat.

Nama dan detail metric bisa berbeda antar versi/exporter, tetapi konsepnya tetap: apakah queue punya consumer yang siap menerima message?

### 6.10 Connection and Channel Count

Connection/channel count penting untuk mendeteksi abuse.

Interpretasi:

- Connection count naik tak terkendali: connection leak, autoscaling storm, reconnect loop.
- Channel count sangat tinggi: channel leak, per-message channel anti-pattern.
- Connection churn tinggi: network instability, TLS/cert issue, credential issue.

Untuk Java:

- connection mahal,
- channel lebih ringan tetapi tidak gratis,
- channel tidak boleh dibuat per message,
- channel harus dikelola sesuai threading model.

### 6.11 Memory and Disk

RabbitMQ adalah broker stateful. Memory/disk bukan detail ops belaka.

Signal penting:

- memory used,
- memory high watermark,
- disk free,
- disk alarm,
- queue storage size,
- stream retention storage,
- quorum queue disk growth.

Interpretasi:

- Disk alarm: publisher akan diblokir untuk melindungi broker.
- Memory alarm: publishing bisa diblokir.
- Disk growth cepat: backlog, stream retention terlalu besar, DLQ/parking lot tidak dibersihkan, large messages.

### 6.12 Publisher Confirm Latency

Ini application-side metric yang sering dilupakan.

Confirm latency adalah waktu dari publish sampai broker confirm.

Interpretasi:

- Confirm latency naik: broker/disk/replication overload, quorum queue slow, network issue.
- Confirm latency timeout: outcome unknown.
- Confirm latency tinggi + blocked connection: broker overload.
- Confirm latency tinggi di quorum queue: replication/disk bottleneck.

### 6.13 Outbox Metrics

Jika memakai outbox pattern:

- outbox pending rows,
- oldest pending age,
- publish attempt count,
- publish failure count,
- confirm timeout count,
- relay lag,
- duplicate publish skipped.

Outbox lag sering lebih penting daripada queue depth karena message bahkan belum masuk broker.

### 6.14 DLQ Metrics

DLQ harus punya metrics khusus:

- DLQ depth,
- DLQ ingress rate,
- DLQ oldest age,
- DLQ by reason,
- DLQ by message type,
- DLQ by producer,
- DLQ replay success/failure,
- parking lot count.

DLQ tanpa alert adalah kuburan gelap.

---

## 7. Dashboard RabbitMQ yang Berguna

Dashboard yang baik bukan penuh grafik. Dashboard harus menjawab pertanyaan operasional.

### 7.1 Broker Overview Dashboard

Tujuan: apakah cluster/broker sehat?

Panel:

- node up/down,
- memory used vs watermark,
- disk free vs limit,
- file descriptors,
- sockets,
- Erlang processes,
- connection count,
- channel count,
- publisher blocked count/duration,
- cluster partition/leader status,
- queue count,
- stream count.

### 7.2 Queue Health Dashboard

Tujuan: apakah workload queue sehat?

Panel per queue critical:

- ready messages,
- unacked messages,
- total messages,
- publish rate,
- deliver rate,
- ack rate,
- redelivery rate,
- consumer count,
- consumer utilization/capacity,
- oldest message age,
- DLQ ingress.

### 7.3 Producer Reliability Dashboard

Tujuan: apakah message benar-benar masuk broker dengan aman?

Panel:

- publish attempt rate,
- confirm success rate,
- confirm latency p50/p95/p99,
- nack count,
- return/unroutable count,
- mandatory return count,
- blocked publisher duration,
- outbox pending,
- outbox oldest age.

### 7.4 Consumer Reliability Dashboard

Tujuan: apakah consumer memproses message dengan benar?

Panel:

- handler success rate,
- handler failure rate by category,
- handler latency p50/p95/p99,
- ack latency,
- duplicate ignored count,
- validation failure count,
- retry decision count,
- DLQ decision count,
- external dependency latency,
- DB transaction latency.

### 7.5 Retry/DLQ Dashboard

Tujuan: apakah retry sedang sehat atau menjadi storm?

Panel:

- retry queue depth by delay bucket,
- retry ingress rate,
- retry egress rate,
- DLQ ingress rate,
- parking lot count,
- top message types in DLQ,
- top error categories,
- oldest DLQ message age,
- replay attempts.

### 7.6 Stream Dashboard

Tujuan: apakah stream storage dan consumer replay sehat?

Panel:

- stream publish rate,
- stream confirm latency,
- stream storage size,
- retention headroom,
- consumer offset lag,
- replay consumer rate,
- super stream partition imbalance,
- hot partition detection,
- deduplication rejection/skip metrics if available/app-level.

---

## 8. Alert Design: Dari Noise ke Signal

Alert yang buruk membuat tim kebal. Alert RabbitMQ harus actionable.

### 8.1 Jangan Alert Hanya Queue Depth

Queue depth 10.000 bisa normal untuk batch queue, tetapi queue depth 50 bisa fatal untuk fraud real-time decision.

Gunakan severity berdasarkan:

- workload criticality,
- oldest message age,
- growth slope,
- consumer presence,
- ack rate vs publish rate,
- DLQ rate,
- business SLA.

### 8.2 Alert: Consumer Missing

Contoh rule konseptual:

```text
IF queue is critical
AND consumer_count == 0
FOR 2 minutes
THEN page
```

Tetapi untuk queue batch low-priority, mungkin hanya ticket.

### 8.3 Alert: Backlog Growing

```text
IF ready_messages increasing for 10 minutes
AND ack_rate < publish_rate
AND oldest_message_age > SLA/2
THEN alert
```

Ini lebih baik daripada threshold statis.

### 8.4 Alert: Unacked Saturation

```text
IF unacked_messages >= expected_prefetch_capacity * 0.9
AND ack_rate low
FOR 5 minutes
THEN alert slow/hung consumers
```

### 8.5 Alert: Redelivery Spike

```text
IF redelivery_rate > baseline * N
OR redelivery_rate > absolute_threshold
THEN alert consumer failure/retry storm
```

### 8.6 Alert: DLQ Ingress

Untuk queue critical:

```text
IF dlq_ingress_rate > 0
FOR 5 minutes
THEN alert
```

Untuk non-critical:

```text
IF dlq_depth > threshold
OR oldest_dlq_age > 1 hour
THEN alert
```

### 8.7 Alert: Publisher Blocked

```text
IF publisher_blocked_duration > 30s
THEN alert broker resource pressure
```

### 8.8 Alert: Confirm Latency

```text
IF confirm_latency_p99 > 2s
FOR 5 minutes
THEN warn

IF confirm_timeout_rate > 0
THEN page for critical publisher
```

### 8.9 Alert: Outbox Lag

```text
IF outbox_oldest_pending_age > SLA
THEN alert publish pipeline stuck
```

Outbox lag bisa terjadi walaupun RabbitMQ terlihat sehat.

---

## 9. Structured Logging Discipline

RabbitMQ forensics sangat bergantung pada structured logging.

### 9.1 Log Minimal di Producer

Saat publish attempt:

```json
{
  "event": "rabbit.publish.attempt",
  "messageId": "msg-123",
  "messageType": "EvidenceSubmitted",
  "schemaVersion": 2,
  "correlationId": "corr-abc",
  "causationId": "cmd-789",
  "exchange": "case.events.x",
  "routingKey": "case.evidence.submitted.v2",
  "producer": "case-service",
  "outboxId": "outbox-991"
}
```

Saat confirm:

```json
{
  "event": "rabbit.publish.confirmed",
  "messageId": "msg-123",
  "exchange": "case.events.x",
  "routingKey": "case.evidence.submitted.v2",
  "confirmLatencyMs": 42,
  "outboxId": "outbox-991"
}
```

Saat returned/unroutable:

```json
{
  "event": "rabbit.publish.returned",
  "messageId": "msg-123",
  "exchange": "case.events.x",
  "routingKey": "case.evidence.submitted.v2",
  "replyCode": 312,
  "replyText": "NO_ROUTE"
}
```

### 9.2 Log Minimal di Consumer

Saat receive:

```json
{
  "event": "rabbit.consumer.received",
  "messageId": "msg-123",
  "messageType": "EvidenceSubmitted",
  "queue": "case.evidence.submitted.q",
  "consumer": "evidence-worker-3",
  "deliveryTag": 3812,
  "redelivered": false,
  "correlationId": "corr-abc",
  "causationId": "cmd-789",
  "attempt": 1
}
```

Saat success:

```json
{
  "event": "rabbit.consumer.ack",
  "messageId": "msg-123",
  "queue": "case.evidence.submitted.q",
  "handlerMs": 268,
  "dbTransactionMs": 91,
  "result": "success"
}
```

Saat retry:

```json
{
  "event": "rabbit.consumer.retry_scheduled",
  "messageId": "msg-123",
  "queue": "case.evidence.submitted.q",
  "attempt": 2,
  "retryDelayMs": 30000,
  "reasonCategory": "external_timeout",
  "externalSystem": "document-service"
}
```

Saat DLQ/parking lot:

```json
{
  "event": "rabbit.consumer.dead_lettered",
  "messageId": "msg-123",
  "queue": "case.evidence.submitted.q",
  "dlq": "case.evidence.submitted.dlq",
  "reasonCategory": "schema_validation_failed",
  "schemaVersion": 2,
  "errorCode": "MISSING_EVIDENCE_ID"
}
```

### 9.3 Jangan Log Payload Sembarangan

Payload RabbitMQ sering mengandung:

- PII,
- evidence metadata,
- customer info,
- internal decision reason,
- token,
- legal/regulatory info.

Default policy:

- log metadata, not payload,
- log payload only in redacted/debug mode,
- never log secrets,
- never log full document/evidence content,
- restrict DLQ inspection access.

---

## 10. Correlation and Causation

### 10.1 Correlation ID

Correlation ID mengelompokkan seluruh action dalam satu business flow.

Contoh:

```text
HTTP request: submit evidence
correlationId: corr-100
  -> EvidenceSubmitted event
  -> VirusScanRequested command
  -> VirusScanCompleted event
  -> ReviewRequested event
```

Semua message memakai correlation ID yang sama.

### 10.2 Causation ID

Causation ID menunjuk message/command/event yang menyebabkan message sekarang.

Contoh:

```text
Command: SubmitEvidenceCommand
  messageId = cmd-1
  correlationId = corr-100
  causationId = http-request-9

Event: EvidenceSubmitted
  messageId = evt-2
  correlationId = corr-100
  causationId = cmd-1

Command: ScanEvidenceCommand
  messageId = cmd-3
  correlationId = corr-100
  causationId = evt-2
```

Correlation menjawab “satu flow besar”.  
Causation menjawab “apa penyebab langsungnya”.

### 10.3 Message ID

Message ID harus stabil dan unik.

Gunakan untuk:

- idempotency,
- log lookup,
- trace annotation,
- DLQ investigation,
- replay tracking,
- duplicate detection.

### 10.4 Trace Context

Untuk distributed tracing modern, gunakan W3C trace context di headers jika stack mendukung:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: vendor-specific-state
```

Jangan hanya bergantung pada broker untuk tracing. Producer dan consumer aplikasi harus propagate trace context lewat message headers.

---

## 11. Distributed Tracing Pattern untuk RabbitMQ

### 11.1 Producer Span

Saat publish message, buat span:

```text
span: rabbitmq.publish
attributes:
  messaging.system = rabbitmq
  messaging.destination.name = case.events.x
  messaging.rabbitmq.routing_key = case.evidence.submitted.v2
  messaging.message.id = msg-123
  messaging.operation = publish
```

Inject trace context ke headers.

### 11.2 Consumer Span

Saat consume message, extract trace context dari headers, lalu buat span:

```text
span: rabbitmq.process
attributes:
  messaging.system = rabbitmq
  messaging.source.name = case.evidence.submitted.q
  messaging.message.id = msg-123
  messaging.operation = process
```

Handler span anak:

```text
rabbitmq.process
  -> validate.contract
  -> db.transaction
  -> document-service.call
  -> publish.next_event
```

### 11.3 Trace Boundary dengan Retry

Retry menghasilkan attempt berbeda.

Ada dua pendekatan:

1. Satu trace untuk semua attempt.
2. Trace baru per attempt dengan link ke original trace/message.

Untuk forensics, yang penting metadata attempt jelas:

- originalMessageId,
- currentMessageId if republished,
- attempt,
- retryReason,
- previousError,
- correlationId.

### 11.4 Trace Boundary dengan DLQ

Saat message masuk DLQ, jangan hilangkan metadata.

DLQ event harus menyimpan:

- original exchange,
- original routing key,
- original queue,
- reason,
- attempt count,
- trace id,
- correlation id,
- causation id.

---

## 12. Java Implementation: Observability Context

### 12.1 Message Envelope

```java
public record MessageEnvelope<T>(
    String messageId,
    String messageType,
    int schemaVersion,
    String correlationId,
    String causationId,
    String idempotencyKey,
    String producer,
    Instant occurredAt,
    Instant publishedAt,
    T payload
) {}
```

### 12.2 Observability Context

```java
public record MessagingObservationContext(
    String messageId,
    String messageType,
    int schemaVersion,
    String correlationId,
    String causationId,
    String idempotencyKey,
    String exchange,
    String routingKey,
    String queue,
    boolean redelivered,
    Long deliveryTag,
    Integer attempt
) {}
```

### 12.3 Extracting Context from AMQP Message

```java
public final class AmqpObservationExtractor {

    public MessagingObservationContext extract(
            String queue,
            com.rabbitmq.client.Envelope envelope,
            com.rabbitmq.client.AMQP.BasicProperties props
    ) {
        Map<String, Object> headers = props.getHeaders() == null
                ? Map.of()
                : props.getHeaders();

        return new MessagingObservationContext(
                props.getMessageId(),
                stringHeader(headers, "messageType"),
                intHeader(headers, "schemaVersion", 1),
                props.getCorrelationId(),
                stringHeader(headers, "causationId"),
                stringHeader(headers, "idempotencyKey"),
                envelope.getExchange(),
                envelope.getRoutingKey(),
                queue,
                envelope.isRedeliver(),
                envelope.getDeliveryTag(),
                intHeader(headers, "attempt", 1)
        );
    }

    private static String stringHeader(Map<String, Object> headers, String key) {
        Object value = headers.get(key);
        return value == null ? null : value.toString();
    }

    private static int intHeader(Map<String, Object> headers, String key, int defaultValue) {
        Object value = headers.get(key);
        if (value == null) return defaultValue;
        if (value instanceof Number n) return n.intValue();
        return Integer.parseInt(value.toString());
    }
}
```

### 12.4 MDC for Logs

```java
public final class MessagingMdc implements AutoCloseable {

    public static MessagingMdc put(MessagingObservationContext ctx) {
        org.slf4j.MDC.put("messageId", ctx.messageId());
        org.slf4j.MDC.put("messageType", ctx.messageType());
        org.slf4j.MDC.put("correlationId", ctx.correlationId());
        org.slf4j.MDC.put("causationId", ctx.causationId());
        org.slf4j.MDC.put("queue", ctx.queue());
        org.slf4j.MDC.put("routingKey", ctx.routingKey());
        org.slf4j.MDC.put("redelivered", String.valueOf(ctx.redelivered()));
        return new MessagingMdc();
    }

    @Override
    public void close() {
        org.slf4j.MDC.remove("messageId");
        org.slf4j.MDC.remove("messageType");
        org.slf4j.MDC.remove("correlationId");
        org.slf4j.MDC.remove("causationId");
        org.slf4j.MDC.remove("queue");
        org.slf4j.MDC.remove("routingKey");
        org.slf4j.MDC.remove("redelivered");
    }
}
```

Usage:

```java
try (MessagingMdc ignored = MessagingMdc.put(ctx)) {
    log.info("rabbit.consumer.received");
    handler.handle(payload);
    channel.basicAck(deliveryTag, false);
    log.info("rabbit.consumer.ack");
}
```

### 12.5 Metrics Interface

```java
public interface RabbitAppMetrics {
    void publishAttempt(String messageType, String exchange, String routingKey);
    void publishConfirmed(String messageType, String exchange, String routingKey, Duration latency);
    void publishReturned(String messageType, String exchange, String routingKey, String replyText);
    void publishNacked(String messageType, String exchange, String routingKey);

    Timer.Sample startConsumerTimer();
    void consumerSuccess(String messageType, String queue, Timer.Sample sample);
    void consumerFailure(String messageType, String queue, String category, Timer.Sample sample);
    void consumerRetry(String messageType, String queue, String reason, Duration delay);
    void consumerDlq(String messageType, String queue, String reason);
    void duplicateIgnored(String messageType, String queue);
}
```

Concrete implementation can use Micrometer.

---

## 13. Spring Boot Observability Pattern

### 13.1 Listener Skeleton

```java
@RabbitListener(
    queues = "case.evidence.submitted.q",
    containerFactory = "manualAckListenerContainerFactory"
)
public void onMessage(
        Message message,
        Channel channel,
        @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag,
        @Header(name = AmqpHeaders.REDELIVERED, required = false) Boolean redelivered
) throws IOException {
    long started = System.nanoTime();
    MessagingObservationContext ctx = observationExtractor.extract(message, redelivered);

    try (MessagingMdc ignored = MessagingMdc.put(ctx)) {
        log.info("rabbit.consumer.received");

        EvidenceSubmitted payload = converter.fromMessage(message, EvidenceSubmitted.class);
        handler.handle(payload, ctx);

        channel.basicAck(deliveryTag, false);
        metrics.consumerSuccess(ctx.messageType(), ctx.queue(), Duration.ofNanos(System.nanoTime() - started));
        log.info("rabbit.consumer.ack");
    } catch (DuplicateMessageException e) {
        channel.basicAck(deliveryTag, false);
        metrics.duplicateIgnored(ctx.messageType(), ctx.queue());
        log.info("rabbit.consumer.duplicate_ignored");
    } catch (BusinessValidationException e) {
        channel.basicReject(deliveryTag, false);
        metrics.consumerDlq(ctx.messageType(), ctx.queue(), "business_validation");
        log.warn("rabbit.consumer.rejected_business_validation", e);
    } catch (TransientDependencyException e) {
        channel.basicNack(deliveryTag, false, false);
        metrics.consumerRetry(ctx.messageType(), ctx.queue(), "transient_dependency", Duration.ofSeconds(30));
        log.warn("rabbit.consumer.retryable_failure", e);
    } catch (Exception e) {
        channel.basicNack(deliveryTag, false, false);
        metrics.consumerFailure(ctx.messageType(), ctx.queue(), "unexpected", Duration.ofNanos(System.nanoTime() - started));
        log.error("rabbit.consumer.unexpected_failure", e);
    }
}
```

Note:

- Jangan `ack` sebelum side effect aman.
- Jangan `requeue=true` default untuk exception tanpa batas.
- Jangan hilangkan metadata saat republish retry.

### 13.2 Publisher with Observability

```java
public void publish(String exchange, String routingKey, MessageEnvelope<?> envelope) {
    Instant started = Instant.now();

    Message message = messageBuilder.toAmqpMessage(envelope);

    metrics.publishAttempt(envelope.messageType(), exchange, routingKey);
    log.info("rabbit.publish.attempt messageId={} messageType={} exchange={} routingKey={}",
            envelope.messageId(), envelope.messageType(), exchange, routingKey);

    CorrelationData correlationData = new CorrelationData(envelope.messageId());
    rabbitTemplate.convertAndSend(exchange, routingKey, message, correlationData);

    // In real production, confirm callback updates outbox/metric asynchronously.
}
```

### 13.3 RabbitTemplate Confirm Callback

```java
rabbitTemplate.setConfirmCallback((correlationData, ack, cause) -> {
    String messageId = correlationData == null ? null : correlationData.getId();

    if (ack) {
        log.info("rabbit.publish.confirmed messageId={}", messageId);
    } else {
        log.warn("rabbit.publish.nacked messageId={} cause={}", messageId, cause);
    }
});
```

### 13.4 Returns Callback

```java
rabbitTemplate.setReturnsCallback(returned -> {
    MessageProperties props = returned.getMessage().getMessageProperties();
    log.error(
        "rabbit.publish.returned messageId={} exchange={} routingKey={} replyCode={} replyText={}",
        props.getMessageId(),
        returned.getExchange(),
        returned.getRoutingKey(),
        returned.getReplyCode(),
        returned.getReplyText()
    );
});
```

---

## 14. Forensic Workflow: Investigating One Message

Misalnya user bertanya:

> Mengapa case `CASE-2026-00091` tidak masuk review padahal evidence sudah disubmit?

Langkah forensic:

### 14.1 Cari Business Entity di DB

Cari case transition/audit:

```sql
select *
from case_transition_log
where case_id = 'CASE-2026-00091'
order by created_at;
```

Cari outbox:

```sql
select *
from outbox_message
where aggregate_id = 'CASE-2026-00091'
order by created_at;
```

Pertanyaan:

- Apakah event `EvidenceSubmitted` dibuat?
- Apakah outbox row ada?
- Apakah outbox status `PUBLISHED`, `FAILED`, atau `PENDING`?
- Apa `message_id` dan `correlation_id`?

### 14.2 Cari Producer Logs

Filter by:

```text
messageId = msg-123
correlationId = corr-abc
caseId = CASE-2026-00091
```

Cari:

- `rabbit.publish.attempt`,
- `rabbit.publish.confirmed`,
- `rabbit.publish.returned`,
- `rabbit.publish.nacked`,
- outbox relay errors.

### 14.3 Cek Broker Metrics

Pada waktu kejadian:

- publish rate ke exchange,
- unroutable/return count,
- queue ready/unacked,
- consumer count,
- redelivery rate,
- DLQ ingress,
- memory/disk alarm.

### 14.4 Cek Consumer Logs

Cari message id/correlation id.

Jika ditemukan:

- received?
- validation failed?
- duplicate ignored?
- state transition rejected?
- retry scheduled?
- acked?
- dead-lettered?

Jika tidak ditemukan:

- routing issue,
- queue binding missing,
- consumer queue berbeda,
- message returned/unroutable,
- message masih ready,
- message di DLQ/retry queue.

### 14.5 Cek DLQ/Parking Lot

Cari berdasarkan metadata.

Minimal DLQ payload harus masih punya:

- messageId,
- messageType,
- correlationId,
- causationId,
- aggregate id/case id,
- reason category,
- original queue,
- original routing key.

### 14.6 Rekonstruksi Causal Chain

Tulis timeline:

```text
10:15:30.120 case-service DB commit evidence submitted
10:15:30.141 outbox row created: msg-123
10:15:30.230 outbox relay publish attempt
10:15:30.244 broker confirm received
10:15:30.246 message routed to case.evidence.submitted.q
10:15:30.310 evidence-worker received msg-123
10:15:30.601 document-service timeout
10:15:30.605 message nacked to retry-30s
10:16:00.800 retry attempt 2
10:16:01.100 validation failed: missing documentChecksum
10:16:01.101 message rejected to DLQ
```

Tanpa timeline, incident review menjadi opini.

---

## 15. Forensic Workflow: Investigating Queue Backlog

Misalnya alert:

```text
case.review.requested.q backlog growing; oldest message age 18 minutes
```

### 15.1 First Split: Ready vs Unacked

```text
ready high, unacked low
```

Kemungkinan:

- consumer count rendah,
- consumer lambat tetapi tidak saturated,
- publish rate terlalu tinggi,
- prefetch terlalu rendah,
- single active consumer bottleneck,
- routing terlalu terkonsentrasi.

```text
ready low, unacked high
```

Kemungkinan:

- consumer menerima message tetapi handler lambat/hang,
- DB lock,
- external dependency lambat,
- thread pool saturated,
- ack bug.

```text
ready high, unacked high
```

Kemungkinan:

- consumer saturated total,
- downstream outage,
- retry/requeue loop,
- insufficient capacity.

### 15.2 Compare Rates

```text
publish_rate > ack_rate
```

Backlog akan tumbuh.

```text
deliver_rate high, ack_rate low
```

Consumer processing bottleneck.

```text
deliver_rate low, consumer_count > 0
```

Consumer tidak ready, prefetch saturated, or queue/consumer configuration issue.

### 15.3 Check Consumer Logs

Cari:

- latency spike,
- error rate,
- downstream timeout,
- DB deadlock,
- validation failures,
- duplicate handling,
- GC pause,
- thread pool rejection.

### 15.4 Check Recent Deployments

Banyak backlog RabbitMQ bukan karena RabbitMQ, tetapi karena:

- consumer deployment gagal,
- config prefetch berubah,
- DB migration lock,
- new validation rule rejects messages,
- downstream service degraded,
- autoscaler removed consumers.

### 15.5 Safe Actions

Aman:

- scale consumers jika bottleneck CPU/stateless,
- temporarily reduce producer rate,
- pause non-critical producer,
- increase consumer resources,
- inspect DLQ sample,
- rollback bad consumer release.

Berbahaya:

- purge queue tanpa business approval,
- requeue entire DLQ blindly,
- set prefetch huge tanpa memahami downstream,
- add consumers untuk workload per-key ordered tanpa partitioning,
- disable retry/DLQ karena ingin backlog turun.

---

## 16. Forensic Workflow: Investigating Redelivery Storm

Symptoms:

- redelivery rate tinggi,
- same messages repeatedly processed,
- logs repeated error,
- queue ready/unacked oscillating,
- CPU high,
- downstream hammered.

### 16.1 Root Causes

- consumer uses `nack(requeue=true)` for all exceptions,
- poison message,
- DB constraint violation repeated,
- invalid schema version,
- missing reference data,
- external service outage,
- consumer crash after delivery before ack,
- ack bug.

### 16.2 Immediate Containment

- stop affected consumer if it is hammering dependencies,
- inspect sample message,
- route failures to DLQ/parking lot,
- disable immediate requeue,
- use delayed retry,
- deploy patch with failure classification.

### 16.3 Permanent Fix

- classify exceptions,
- use bounded retry,
- use DLQ/parking lot,
- record attempt count,
- alert on redelivery rate,
- implement idempotency,
- implement safe replay tool.

---

## 17. Forensic Workflow: Investigating Publisher Blocked

Symptoms:

- producer latency high,
- publish calls hang/slow,
- confirm latency high,
- RabbitMQ memory/disk alarm,
- broker logs show blocked connection,
- outbox pending grows.

### 17.1 Root Causes

- disk free below limit,
- memory watermark reached,
- queue backlog huge,
- DLQ/parking lot unbounded,
- stream retention too large,
- large messages,
- consumer outage,
- too many connections/channels.

### 17.2 Safe Actions

- identify top growing queues,
- identify consumer outages,
- scale/restore consumers,
- reduce producer rate,
- clean DLQ only with approval,
- increase disk if needed,
- reduce stream retention if safe,
- move large payloads to object storage.

### 17.3 Unsafe Actions

- deleting queue blindly,
- raising disk alarm limit without capacity,
- disabling publisher confirms,
- purging business-critical queues,
- restarting broker repeatedly without cause.

---

## 18. Message Sampling and Payload Inspection

### 18.1 Sampling Policy

Sampling helps investigation, but must be controlled.

Allowed:

- sample metadata,
- sample redacted payload,
- sample only non-sensitive fields,
- sample DLQ messages with restricted access.

Avoid:

- logging all payloads,
- dumping full PII,
- exposing message body in generic dashboard,
- giving broad developer access to DLQ production.

### 18.2 RabbitMQ Management UI Get Message Warning

Using UI to “get messages” can remove or requeue depending on mode. Treat it as a state-changing operation unless clearly configured.

Safer approach:

- inspect DLQ copy,
- use read-only forensic tooling,
- query application audit store,
- use stream replay copy,
- use sample consumers in staging.

### 18.3 Firehose/Tracing Plugin Warning

RabbitMQ firehose/tracing can capture publish/deliver events, useful for debugging routing. But it can be expensive and sensitive.

Use only:

- temporarily,
- scoped,
- in non-production where possible,
- with payload redaction/security review,
- with clear disable plan.

---

## 19. Observability for RabbitMQ Streams

Streams introduce different questions.

### 19.1 Stream Metrics

Track:

- publish rate,
- confirm latency,
- storage size,
- retention headroom,
- segment/chunk behavior if exposed,
- consumer offset,
- consumer lag,
- replay rate,
- partition imbalance for super streams,
- deduplication behavior if available/app-level.

### 19.2 Offset Lag

Lag means consumer position is behind stream tail.

Interpretation:

- lag growing: consumer cannot keep up,
- lag stable: consumer processing at same rate as publish,
- lag shrinking: consumer catching up,
- lag huge during replay: expected if intentional.

Dashboard must distinguish:

- live consumer lag,
- replay job lag,
- backfill job lag,
- audit export lag.

### 19.3 Replay Observability

Replay must log:

- replay job id,
- stream name,
- offset range,
- timestamp range,
- filter criteria,
- side-effect mode: disabled/shadow/active,
- records scanned,
- records applied,
- records skipped duplicate,
- records failed,
- replay operator/requester.

### 19.4 Stream Forensics

For audit stream, forensic query should answer:

- What events exist for case X?
- Which producer wrote them?
- What schema version?
- What correlation/causation chain?
- Which consumer projections processed them?
- Which replay jobs touched them?

---

## 20. Observability for Quorum Queues

Quorum queues introduce replication and consensus dimensions.

Track:

- queue leader node,
- replica health,
- Raft-related availability if exposed,
- leader changes,
- publish confirm latency,
- queue length,
- delivery-limit/dead-letter count,
- disk growth,
- node resource imbalance.

Operationally important:

- confirm latency can rise if replication/disk slows,
- majority loss means queue unavailable,
- leader placement affects locality/load,
- delivery-limit can protect against poison loops.

---

## 21. Topology Drift Detection

Topology drift happens when actual broker topology differs from intended topology.

Examples:

- queue exists with wrong type,
- queue missing DLX,
- queue has wrong delivery limit,
- exchange missing,
- binding missing,
- routing key changed,
- permission too broad,
- policy not applied,
- consumer points to old queue.

### 21.1 Detect with Definitions

Use RabbitMQ definitions export/import as source comparison.

In CI/CD:

- expected definitions in Git,
- deploy topology via controlled job,
- export actual definitions,
- diff important fields,
- alert on drift.

### 21.2 Spring Auto-Declaration Risk

Spring auto-declaration is convenient, but in production it can hide drift or create topology from app lifecycle.

Recommended:

- app may validate topology,
- dedicated topology deployer declares topology,
- app fails fast if critical topology mismatch,
- queue type changes require migration plan.

---

## 22. SLOs for RabbitMQ Workloads

RabbitMQ SLO should be workload-specific.

### 22.1 Example SLO: Critical Command Queue

```text
99% of ReviewRequested commands are acknowledged by review-service within 2 minutes of publish.
DLQ rate < 0.1% per 24h.
No message remains in ready state older than 5 minutes during business hours.
```

### 22.2 Example SLO: Audit Stream

```text
99.9% of audit events are confirmed by broker within 1 second of outbox relay attempt.
Audit stream retention is at least 365 days.
Replay projection lag for compliance dashboard is less than 15 minutes.
```

### 22.3 Example SLO: Notification Queue

```text
95% of notifications processed within 10 minutes.
DLQ reviewed daily.
No notification DLQ message older than 7 days without triage status.
```

### 22.4 Why SLO Matters

Without SLO, alerts are arbitrary. With SLO, queue metrics become business-relevant.

---

## 23. Incident Review Template

Use this after RabbitMQ incidents.

```markdown
# RabbitMQ Incident Review

## Summary
- Incident ID:
- Date/time:
- Duration:
- Affected services:
- Affected queues/streams:
- Business impact:

## Detection
- How was it detected?
- Which alert fired?
- Was detection timely?
- Were there missing alerts?

## Timeline
- T0:
- T1:
- T2:

## Technical Symptoms
- Queue ready:
- Queue unacked:
- Publish rate:
- Ack rate:
- Redelivery rate:
- DLQ ingress:
- Consumer count:
- Broker alarms:
- Confirm latency:

## Root Cause
- Immediate cause:
- Contributing factors:
- Why existing controls failed:

## Message Forensics
- Example message IDs:
- Correlation IDs:
- DLQ samples:
- Retry path:
- Final disposition:

## Remediation
- Immediate mitigation:
- Permanent fixes:
- Tests added:
- Alerts added/changed:
- Runbook changes:

## Lessons
- What worked:
- What failed:
- What we will change:
```

---

## 24. Case Study: Enforcement Lifecycle Message Forensics

### 24.1 Domain Flow

```text
EvidenceSubmitted
  -> EvidenceIntegrityCheckRequested
  -> EvidenceIntegrityCheckCompleted
  -> RuleEvaluationRequested
  -> EnforcementActionProposed
  -> SupervisorReviewRequested
```

### 24.2 Incident

Symptom:

```text
Supervisor review queue backlog grew for 45 minutes.
Some high-risk cases were not assigned for review within SLA.
```

### 24.3 Observed Metrics

```text
case.supervisor.review.q ready: 8 -> 4,800
case.supervisor.review.q unacked: 160 stable
consumer count: 8
prefetch: 20
publish rate: 150/s
ack rate: 30/s
redelivery rate: low
DLQ ingress: 0
DB latency: p99 3.8s
external identity-service latency: p99 4.5s
```

### 24.4 Diagnosis

Unacked stable at `8 consumers * prefetch 20 = 160`, meaning all consumer capacity is occupied.

Redelivery low and DLQ 0 means not poison/retry storm.

Ack rate much lower than publish rate. Handler is slow.

Trace shows `identity-service` latency increased. Consumer calls identity-service synchronously for each review assignment.

### 24.5 Immediate Mitigation

- Enable cache for identity lookup.
- Increase consumer instances from 8 to 20 after verifying DB can handle load.
- Rate-limit producer for non-critical review requests.
- Prioritize high-risk cases via separate queue if already designed.

### 24.6 Permanent Fix

- Split high-risk and normal review queues.
- Preload identity data asynchronously.
- Add circuit breaker and fallback.
- Add alert on ack rate < publish rate for 10 minutes.
- Add handler latency by downstream dependency.
- Add SLO for review assignment.

### 24.7 Lesson

Queue backlog was not a RabbitMQ problem. RabbitMQ revealed downstream coupling.

---

## 25. Observability Anti-Patterns

### 25.1 Only Monitoring Broker, Not Applications

Broker metrics say messages are unacked. They do not say why handler is slow.

Need application metrics.

### 25.2 Logging Payloads Instead of Metadata

Payload logs create security and compliance risk.

Log metadata by default.

### 25.3 No Correlation ID

Without correlation ID, debugging async systems becomes grep archaeology.

### 25.4 No DLQ Alert

DLQ without alert is silent data loss by delay.

### 25.5 Alert on Queue Depth Alone

Queue depth alone lacks context.

Use age, rate, consumer count, and SLA.

### 25.6 No Publisher Confirm Metrics

Producer can think it published while broker never confirmed.

### 25.7 No Outbox Lag Metrics

Message may be stuck before RabbitMQ.

### 25.8 No Topology Drift Detection

Routing bugs can be caused by missing binding, wrong queue type, or stale policy.

### 25.9 Using Firehose Permanently in Production

Message tracing can become expensive and sensitive.

### 25.10 No Runbook

Alert without runbook causes panic operations: purge, requeue everything, restart everything.

---

## 26. Production Checklist

### 26.1 Broker Metrics

- [ ] Node up/down.
- [ ] Memory usage and alarm.
- [ ] Disk usage and alarm.
- [ ] Connection count.
- [ ] Channel count.
- [ ] Queue count.
- [ ] Publisher blocked events.
- [ ] Cluster health.
- [ ] Quorum/stream replica health.

### 26.2 Queue Metrics

- [ ] Ready messages.
- [ ] Unacked messages.
- [ ] Publish rate.
- [ ] Deliver rate.
- [ ] Ack rate.
- [ ] Redelivery rate.
- [ ] Consumer count.
- [ ] Consumer utilization/capacity.
- [ ] Oldest message age.
- [ ] DLQ ingress rate.

### 26.3 Producer Metrics

- [ ] Publish attempts.
- [ ] Confirm success.
- [ ] Confirm latency.
- [ ] Nacks.
- [ ] Returned/unroutable messages.
- [ ] Blocked duration.
- [ ] Outbox pending.
- [ ] Oldest outbox age.

### 26.4 Consumer Metrics

- [ ] Handler success/failure.
- [ ] Handler latency.
- [ ] Ack latency.
- [ ] Failure by category.
- [ ] Retry decisions.
- [ ] DLQ decisions.
- [ ] Duplicate ignored.
- [ ] Idempotency conflicts.
- [ ] External dependency latency.

### 26.5 Logs

- [ ] Structured JSON logs.
- [ ] messageId in logs.
- [ ] correlationId in logs.
- [ ] causationId in logs.
- [ ] queue/exchange/routingKey in logs.
- [ ] retry attempt in logs.
- [ ] no sensitive payload by default.

### 26.6 Tracing

- [ ] Trace context injected on publish.
- [ ] Trace context extracted on consume.
- [ ] Consumer span includes message metadata.
- [ ] Retry attempt visible.
- [ ] DLQ path visible.

### 26.7 Forensics

- [ ] Can find message by ID.
- [ ] Can find messages by case/entity ID.
- [ ] Can reconstruct publish-confirm-consume-ack timeline.
- [ ] Can inspect DLQ safely.
- [ ] Can replay safely.
- [ ] Can map queue incident to business impact.

---

## 27. Mini Lab

### Lab 1: Dashboard the Basic Queue

Create dashboard panels for:

- ready,
- unacked,
- publish rate,
- ack rate,
- consumer count,
- redelivery rate.

Then run:

- producer faster than consumer,
- consumer stopped,
- consumer slow,
- consumer throwing exception with requeue.

Observe differences.

### Lab 2: Add Application Metrics

Instrument Java consumer:

- success count,
- failure count,
- handler latency,
- duplicate ignored.

Compare broker metrics vs app metrics.

### Lab 3: Correlation Search

Publish message with:

- messageId,
- correlationId,
- causationId,
- caseId.

Ensure you can find it in:

- producer logs,
- consumer logs,
- DB audit table,
- trace UI if available.

### Lab 4: DLQ Forensics

Force validation failure.

Confirm:

- message goes to DLQ,
- original metadata preserved,
- reason logged,
- alert/dashboards show DLQ ingress.

### Lab 5: Redelivery Storm

Create a consumer that nacks with requeue true.

Observe:

- redelivery rate,
- CPU/log spam,
- queue oscillation.

Then fix with delayed retry/DLQ.

### Lab 6: Publisher Confirm Latency

Use persistent messages to quorum queue. Increase load.

Observe:

- confirm latency,
- outbox pending,
- broker resource metrics.

---

## 28. Review Questions

1. Why is queue depth alone a weak alert signal?
2. What does high `ready` but low `unacked` usually indicate?
3. What does high `unacked` near `consumer_count * prefetch` indicate?
4. Why must producer confirm latency be measured application-side?
5. What is the difference between correlation ID and causation ID?
6. Why should DLQ ingress alert differently from normal queue backlog?
7. Why is `redelivered=true` not enough to count retry attempt?
8. What metadata must survive retry and DLQ republish?
9. Why can outbox lag happen even when RabbitMQ is healthy?
10. What is unsafe about inspecting production messages through Management UI?
11. How would you reconstruct whether a message was published, routed, consumed, retried, or dead-lettered?
12. Why is firehose tracing not a permanent observability solution?
13. What is the difference between consumer count and consumer effectiveness?
14. Why must RabbitMQ observability include business entity IDs in application logs?
15. What metrics would you put in an SLO for regulatory case escalation?

---

## 29. Key Takeaways

- RabbitMQ observability is not just broker monitoring.
- Metrics tell you what is changing; logs and traces explain why.
- Queue state must be interpreted as `ready`, `unacked`, rates, consumer count, and age together.
- Publisher confirms need metrics; otherwise producer reliability is invisible.
- Consumer reliability needs handler metrics, not just broker ack rate.
- DLQ is not a trash bin. It is a failure evidence store.
- Redelivery spikes are early warning for retry storm, poison messages, or consumer instability.
- Correlation ID and causation ID are mandatory for serious async systems.
- Outbox lag is part of RabbitMQ observability even though it lives in the database.
- Forensics must reconstruct timeline, not only identify final error.
- Observability must be designed into message contract, topology, Java code, dashboards, alerts, and runbooks.

---

## 30. How This Connects to the Next Part

Bagian ini menjelaskan bagaimana melihat dan memahami sistem RabbitMQ saat berjalan.

Bagian berikutnya akan membahas performance engineering dan benchmarking:

- throughput vs latency,
- message size,
- publisher confirms batching,
- consumer prefetch,
- channel/connection tuning,
- queue type performance,
- quorum vs classic vs stream,
- CPU/disk/network bottleneck,
- benchmark yang tidak menipu,
- capacity planning.

Observability memberi data. Performance engineering memakai data itu untuk membuat keputusan kapasitas dan tuning.

---

# Status Seri

- Part 00: selesai
- Part 01: selesai
- Part 02: selesai
- Part 03: selesai
- Part 04: selesai
- Part 05: selesai
- Part 06: selesai
- Part 07: selesai
- Part 08: selesai
- Part 09: selesai
- Part 10: selesai
- Part 11: selesai
- Part 12: selesai
- Part 13: selesai
- Part 14: selesai
- Part 15: selesai
- Part 16: selesai
- Part 17: selesai
- Part 18: selesai
- Part 19: selesai
- Part 20: selesai
- Part 21: selesai
- Part 22: selesai
- Part 23: selesai
- Part 24: selesai
- Part 25: selesai
- Part 26: berikutnya — Performance Engineering and Benchmarking

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-24.md">⬅️ Part 24 — Security, TLS, AuthN/AuthZ, Multi-Tenancy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-26.md">Part 26 — Performance Engineering and Benchmarking ➡️</a>
</div>

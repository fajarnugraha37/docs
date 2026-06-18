# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-027

# Part 27 — Observability: Metrics, Logs, Tracing, Correlation, Auditability, dan Forensic Debugging

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Target Java: Java 8 sampai Java 25  
> Fokus: JMS / Jakarta Messaging observability untuk sistem enterprise production-grade  
> Status: Part 27 dari 35

---

## 0. Tujuan Bagian Ini

Setelah mempelajari bagian ini, kamu harus mampu:

1. Mendesain observability untuk sistem JMS/Jakarta Messaging dari producer sampai consumer side effect.
2. Membedakan observability **broker**, **client**, **business handler**, dan **operational workflow**.
3. Menentukan metric yang benar-benar signal, bukan sekadar banyak angka.
4. Mendesain log correlation untuk asynchronous boundary.
5. Melakukan tracing lintas producer -> broker -> consumer -> database/API side effect.
6. Melakukan forensic debugging ketika message hilang, duplicate, stuck, redelivered, masuk DLQ, atau diproses lambat.
7. Mendesain audit trail yang defensible untuk sistem regulated/case-management.
8. Membuat alert yang action-oriented, bukan noise.
9. Membuat runbook investigasi JMS incident.
10. Menghindari observability anti-pattern yang umum di sistem messaging.

Bagian ini penting karena JMS sering gagal bukan karena API salah dipakai, tetapi karena sistem tidak bisa menjawab pertanyaan sederhana saat incident:

- Message ini sudah pernah dikirim atau belum?
- Producer sukses send atau hanya merasa sukses?
- Message sedang di broker, di client prefetch buffer, sedang diproses, sudah ack, atau masuk DLQ?
- Consumer mana yang memproses?
- Side effect database/API sudah terjadi atau belum?
- Duplicate ini berasal dari retry, redelivery, replay manual, failover, atau producer double-send?
- Delay terjadi di producer, broker queue, dispatch, consumer, database, external API, atau lock contention?
- Kalau message direplay, apakah aman?

Top engineer tidak hanya membuat messaging berjalan. Top engineer membuat sistem bisa **dibuktikan** perilakunya ketika gagal.

---

## 1. Mental Model: Observability JMS Bukan Hanya Broker Dashboard

Banyak tim mengira observability JMS berarti:

- lihat queue depth,
- lihat consumer count,
- lihat DLQ count,
- lihat broker up/down.

Itu hanya sebagian kecil.

Sistem JMS production memiliki beberapa boundary:

```text
[Business Action]
      |
      v
[Producer Code]
      |
      v
[JMS Client Library]
      |
      v
[Network]
      |
      v
[Broker: address/queue/topic/journal/paging/dispatch]
      |
      v
[JMS Client Library]
      |
      v
[Consumer Handler]
      |
      v
[Side Effects: DB/API/File/Email/State Machine]
      |
      v
[Ack / Commit / Rollback]
```

Observability harus menjawab status pada setiap boundary.

Jika hanya broker yang dimonitor, kamu bisa tahu queue naik, tetapi tidak tahu kenapa.  
Jika hanya aplikasi yang logging, kamu bisa tahu handler error, tetapi tidak tahu message stuck di broker atau client buffer.  
Jika hanya tracing HTTP, kamu kehilangan async boundary karena producer dan consumer tidak berada pada call stack yang sama.

**Mental model utama:**

> JMS observability adalah kemampuan menghubungkan lifecycle message, lifecycle processing, dan lifecycle business state melewati asynchronous boundary.

---

## 2. Apa yang Resmi Dijamin API dan Apa yang Harus Kamu Tambahkan

Jakarta Messaging menyediakan API umum untuk membuat, mengirim, menerima, dan membaca message pada enterprise messaging system. API ini menyediakan message header seperti message id, correlation id, destination, reply-to, timestamp, delivery mode, expiration, priority, redelivery flag, dan property tertentu seperti `JMSXDeliveryCount` jika provider mendukung sesuai spec. Tetapi API JMS tidak otomatis memberikan end-to-end observability, trace propagation, business audit, atau dashboard operasional.

Artinya:

```text
JMS API gives message transport metadata.
You must design operational metadata.
```

Contoh metadata dari API:

- `JMSMessageID`
- `JMSCorrelationID`
- `JMSDestination`
- `JMSReplyTo`
- `JMSDeliveryMode`
- `JMSExpiration`
- `JMSPriority`
- `JMSRedelivered`
- `JMSTimestamp`
- `JMSXDeliveryCount` jika tersedia

Contoh metadata yang harus kamu desain sendiri:

- `traceId`
- `spanId` / `parentSpanId`
- `correlationId`
- `causationId`
- `businessProcessId`
- `caseId`
- `tenantId`
- `messageType`
- `messageVersion`
- `producerService`
- `producerInstance`
- `consumerService`
- `commandId` / `eventId`
- `idempotencyKey`
- `schemaVersion`
- `retryPolicyName`
- `replayBatchId`
- `operatorId` untuk manual replay/repair

JMS bisa mengangkut metadata tersebut sebagai properties atau body envelope. Tetapi JMS tidak bisa memaksa kamu mendesainnya dengan benar.

---

## 3. Empat Lapisan Observability JMS

Observability JMS harus dibagi menjadi empat lapisan.

### 3.1 Broker Observability

Menjawab:

- Broker hidup atau tidak?
- Queue depth berapa?
- Message masuk/keluar berapa per detik?
- Consumer aktif berapa?
- Message sedang delivering berapa?
- Redelivery/DLQ berapa?
- Storage/journal/paging sehat atau tidak?
- Disk/CPU/memory/network broker saturation atau tidak?

Broker observability melihat **transport runtime**.

### 3.2 Client Observability

Menjawab:

- Producer berhasil connect/send/commit atau tidak?
- Consumer connect atau reconnect terus?
- Receive latency berapa?
- Handler processing time berapa?
- Ack/commit sukses atau rollback?
- Client prefetch/window terlalu besar atau kecil?
- Consumer thread pool saturated atau tidak?

Client observability melihat **application-broker interaction**.

### 3.3 Business Observability

Menjawab:

- Business command/event apa yang diproses?
- Entity/case/order/application mana yang terdampak?
- State transition apa yang terjadi?
- Side effect apa yang berhasil/gagal?
- Idempotency result duplicate/new/conflict?
- SLA bisnis terancam atau tidak?

Business observability melihat **meaning**, bukan hanya message.

### 3.4 Operational Workflow Observability

Menjawab:

- DLQ item sudah ditriage atau belum?
- Siapa yang melakukan replay?
- Replay batch id apa?
- Message diperbaiki dengan payload asli atau payload patched?
- Ada approval sebelum replay?
- Apakah replay menyebabkan duplicate side effect?

Operational workflow observability melihat **human + system recovery process**.

Untuk sistem regulated, lapisan keempat sering sama pentingnya dengan lapisan pertama.

---

## 4. Core Signal: RED, USE, dan Queue-Specific Signals

Observability bagus dimulai dari signal yang benar.

### 4.1 RED untuk Handler

RED = Rate, Errors, Duration.

Untuk consumer handler:

| Signal | Arti |
|---|---|
| Rate | message processed per second/minute |
| Errors | failed processing, rollback, retryable/non-retryable error |
| Duration | handler processing latency |

Metric contoh:

```text
jms_consumer_messages_started_total
jms_consumer_messages_completed_total
jms_consumer_messages_failed_total
jms_consumer_processing_duration_seconds
jms_consumer_ack_duration_seconds
jms_consumer_commit_duration_seconds
```

### 4.2 USE untuk Resource

USE = Utilization, Saturation, Errors.

Untuk broker dan client:

| Resource | Utilization | Saturation | Errors |
|---|---|---|---|
| Broker CPU | CPU % | run queue | broker exception |
| Broker memory | heap/direct memory | paging pressure | OOM |
| Broker disk | disk throughput | fsync latency | IO error |
| Network | bandwidth | retransmit/queueing | connection reset |
| Consumer thread pool | active threads | queue size | rejected task |
| DB connection pool | active connections | pending waiters | timeout |

### 4.3 Queue-Specific Signals

JMS butuh signal tambahan:

| Signal | Kenapa penting |
|---|---|
| Queue depth | backlog mentah |
| Enqueue rate | incoming workload |
| Dequeue/ack rate | completed transport workload |
| Dispatch rate | broker mengirim ke consumer |
| Delivering/in-flight count | message sudah dikirim ke consumer tapi belum selesai |
| Consumer count | kapasitas aktif |
| Redelivery count/rate | processing failure atau ack/transaction issue |
| DLQ count/rate | unrecoverable atau retry exhausted |
| Message age | latency backlog lebih meaningful daripada depth saja |
| Oldest message age | SLA risk |
| Expired count | TTL policy aktif atau delay terlalu tinggi |
| Paging/store usage | broker storage pressure |
| Connection/reconnect count | network/client instability |

Queue depth tanpa age bisa menipu. 100.000 message bisa normal jika throughput 50.000/s. 500 message bisa kritikal jika oldest age 3 hari.

---

## 5. Metric Model yang Harus Ada

### 5.1 Producer Metrics

Producer harus merekam:

```text
jms_producer_send_attempt_total{destination,message_type,service}
jms_producer_send_success_total{destination,message_type,service}
jms_producer_send_failure_total{destination,message_type,service,error_class}
jms_producer_send_duration_seconds{destination,message_type,service}
jms_producer_transaction_commit_total{destination,service}
jms_producer_transaction_rollback_total{destination,service,error_class}
jms_producer_payload_bytes{destination,message_type}
jms_producer_message_ttl_seconds{destination,message_type}
jms_producer_async_callback_failure_total{destination,error_class}
```

Yang perlu diperhatikan:

- `send_success` bukan berarti business processed.
- Untuk persistent message, send latency bisa dipengaruhi broker storage/journal.
- Untuk transacted session, message belum benar-benar visible sampai commit.
- Async send harus diukur dari callback, bukan hanya method invocation.

### 5.2 Broker Metrics

Broker metric minimal:

```text
broker_queue_message_count{queue}
broker_queue_messages_added_total{queue}
broker_queue_messages_acknowledged_total{queue}
broker_queue_delivering_count{queue}
broker_queue_consumer_count{queue}
broker_queue_scheduled_count{queue}
broker_queue_messages_expired_total{queue}
broker_queue_messages_killed_total{queue}
broker_queue_redelivered_total{queue}
broker_queue_oldest_message_age_seconds{queue}
broker_queue_dlq_message_count{queue}
broker_address_paging_active{address}
broker_address_page_usage_bytes{address}
broker_journal_write_duration_seconds
broker_connection_count
broker_session_count
broker_consumer_count
```

Nama metric bergantung broker/exporter, tetapi konsepnya harus ada.

ActiveMQ Artemis, misalnya, memiliki fasilitas management dan metrics/exporter yang dapat mengekspos queue/broker/JVM metrics. Dokumentasi Artemis juga membahas operasi management seperti expire/move/send messages to dead letter address, serta metric queue/JVM melalui subsystem metrics.

### 5.3 Consumer Metrics

Consumer metric minimal:

```text
jms_consumer_receive_total{destination,message_type,consumer_group}
jms_consumer_start_processing_total{destination,message_type,consumer_group}
jms_consumer_success_total{destination,message_type,consumer_group}
jms_consumer_failure_total{destination,message_type,consumer_group,error_class,error_type}
jms_consumer_redelivered_total{destination,message_type,consumer_group}
jms_consumer_delivery_count{destination,message_type,consumer_group}
jms_consumer_processing_duration_seconds{destination,message_type,consumer_group}
jms_consumer_business_latency_seconds{message_type}
jms_consumer_queue_wait_seconds{destination,message_type}
jms_consumer_ack_success_total{destination}
jms_consumer_ack_failure_total{destination,error_class}
jms_consumer_transaction_commit_total{destination}
jms_consumer_transaction_rollback_total{destination,error_class}
```

Important distinction:

```text
queue_wait_seconds = consumer_receive_time - producer_send_time_or_message_timestamp
processing_duration = handler_done_time - handler_start_time
business_latency = business_done_time - business_action_time
```

`business_latency` sering lebih penting daripada `processing_duration`.

### 5.4 DLQ and Repair Metrics

DLQ bukan tempat sampah. DLQ adalah operational workflow.

Metric minimal:

```text
jms_dlq_message_count{dlq,source_destination}
jms_dlq_messages_added_total{dlq,source_destination,error_type}
jms_dlq_oldest_message_age_seconds{dlq}
jms_dlq_triaged_total{dlq,decision}
jms_dlq_replayed_total{dlq,replay_mode,operator}
jms_dlq_replay_success_total{dlq,replay_batch_id}
jms_dlq_replay_failure_total{dlq,replay_batch_id,error_class}
jms_dlq_discarded_total{dlq,reason,operator}
```

Tanpa metric triage/replay, tim tidak tahu apakah DLQ sedang diselesaikan atau hanya bertambah.

---

## 6. Metric Cardinality: Kesalahan yang Diam-Diam Membunuh Observability

Jangan jadikan semua metadata sebagai label metric.

Buruk:

```text
jms_consumer_success_total{messageId="ID:abc...",caseId="CASE-123",userId="U-99"}
```

Ini high cardinality dan akan menghancurkan time-series database.

Baik:

```text
jms_consumer_success_total{destination="case.command.approve",message_type="ApproveCaseCommand",consumer_group="case-service"}
```

Metadata detail seperti `messageId`, `caseId`, `correlationId`, `traceId` masuk ke log/tracing, bukan metric label.

Rule praktis:

| Metadata | Metric label? | Log field? | Trace attribute? |
|---|---:|---:|---:|
| destination | Ya | Ya | Ya |
| message type | Ya | Ya | Ya |
| service name | Ya | Ya | Ya |
| error category | Ya | Ya | Ya |
| message id | Tidak | Ya | Kadang |
| correlation id | Tidak | Ya | Ya |
| business id / case id | Biasanya tidak | Ya | Kadang, hati-hati cardinality |
| tenant id | Kadang | Ya | Kadang |
| user id | Tidak | Ya, jika aman | Tidak/kadang |
| payload field | Tidak | Terbatas | Tidak |

---

## 7. Logging Model: Structured Logs atau Kamu Akan Buta Saat Incident

Untuk JMS, log biasa seperti ini tidak cukup:

```text
Processing message
Success
Failed to process message
```

Gunakan structured logging.

Contoh field minimal:

```json
{
  "timestamp": "2026-06-18T10:15:30.123Z",
  "level": "INFO",
  "service": "case-service",
  "event": "jms.consumer.processing.success",
  "destination": "case.command.approve",
  "messageType": "ApproveCaseCommand",
  "messageVersion": "2.1",
  "jmsMessageId": "ID:broker-123:...",
  "jmsCorrelationId": "corr-7f3a...",
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "causationId": "evt-previous-step",
  "businessProcessId": "BP-2026-0001",
  "caseId": "CASE-12345",
  "tenantId": "agency-a",
  "deliveryCount": 1,
  "redelivered": false,
  "consumerInstance": "case-service-7d9f8f5f4b-abcde",
  "processingDurationMs": 173,
  "idempotencyResult": "NEW",
  "stateTransition": "PENDING_REVIEW -> APPROVED"
}
```

### 7.1 Log Events yang Harus Ada

Producer:

```text
jms.producer.send.attempt
jms.producer.send.success
jms.producer.send.failure
jms.producer.transaction.commit
jms.producer.transaction.rollback
```

Consumer:

```text
jms.consumer.receive
jms.consumer.processing.start
jms.consumer.processing.success
jms.consumer.processing.retryable_failure
jms.consumer.processing.permanent_failure
jms.consumer.ack.success
jms.consumer.ack.failure
jms.consumer.transaction.commit
jms.consumer.transaction.rollback
```

DLQ/repair:

```text
jms.dlq.detected
jms.dlq.triage.started
jms.dlq.triage.classified
jms.dlq.replay.requested
jms.dlq.replay.approved
jms.dlq.replay.started
jms.dlq.replay.success
jms.dlq.replay.failure
jms.dlq.discarded
```

### 7.2 Log Level Discipline

| Event | Level |
|---|---|
| normal send success | DEBUG/INFO tergantung criticality |
| normal receive start | DEBUG atau sampled INFO |
| business success | INFO jika regulated/auditable, else DEBUG/sample |
| retryable failure | WARN |
| permanent failure | ERROR |
| DLQ movement | ERROR/WARN + alert metric |
| replay started | INFO/AUDIT |
| replay failed | ERROR |
| broker reconnect | WARN |
| credential/auth failure | ERROR/SECURITY |

Jangan log setiap payload penuh di INFO. Itu berbahaya untuk PII/security dan mahal.

---

## 8. Correlation Model: Correlation ID, Causation ID, Trace ID, Message ID

Banyak sistem mencampur semua ID menjadi satu. Itu buruk.

### 8.1 Empat ID Utama

| ID | Scope | Tujuan |
|---|---|---|
| `JMSMessageID` | Transport message instance | Identitas provider untuk message tertentu |
| `correlationId` / `JMSCorrelationID` | Business/request flow | Menghubungkan message dalam satu flow |
| `causationId` | Causal chain | Message/event mana yang menyebabkan message ini dibuat |
| `traceId` | Observability trace | Menghubungkan span producer/consumer/downstream |

Contoh:

```text
HTTP Request: traceId=T1, correlationId=C1
  -> producer sends ApproveCaseCommand messageId=M1 causationId=HTTP-REQ-1
       -> consumer processes M1
            -> emits CaseApprovedEvent messageId=M2 correlationId=C1 causationId=M1
                 -> notification service consumes M2
```

### 8.2 Jangan Andalkan `JMSMessageID` sebagai Business Idempotency Key

`JMSMessageID` biasanya dibuat provider setelah send. Jika producer retry menghasilkan dua message, setiap message bisa memiliki `JMSMessageID` berbeda padahal business command sama.

Idempotency key harus business-level:

```text
idempotencyKey = commandId
atau
idempotencyKey = aggregateId + commandType + commandSequence
atau
idempotencyKey = eventId dari producer business transaction
```

### 8.3 `JMSCorrelationID` Bukan Selalu Trace ID

Trace ID untuk observability. Correlation ID untuk business flow. Keduanya boleh sama di sistem sederhana, tetapi untuk sistem besar sebaiknya dipisah.

Kenapa?

- Trace bisa sampled; correlation tidak boleh hilang.
- Trace span bisa berbeda antar replay; correlation business tetap sama.
- Replay manual mungkin membuat trace baru tetapi correlation lama.

---

## 9. Distributed Tracing untuk Async Messaging

Tracing synchronous HTTP relatif mudah karena call stack berantai. JMS tidak begitu.

Producer dan consumer tidak berada dalam stack yang sama:

```text
Producer thread sends message at 10:00:00
Consumer thread receives message at 10:05:00
```

Trace harus dipropagasi lewat message properties atau envelope.

### 9.1 Span Model

Model umum:

```text
HTTP SERVER span
  -> business operation span
     -> JMS PRODUCER span: send ApproveCaseCommand

Later:
JMS CONSUMER span: process ApproveCaseCommand
  -> DB span
  -> HTTP CLIENT span
  -> JMS PRODUCER span: emit CaseApprovedEvent
```

OpenTelemetry mendefinisikan semantic conventions untuk messaging spans dan messaging metrics. Konvensi ini memberikan vocabulary umum untuk mendeskripsikan interaksi messaging system, termasuk destination, operation, dan konsep producer/consumer.

### 9.2 Trace Context Propagation

Gunakan property:

```text
traceparent
tracestate
baggage
```

Jika memakai OpenTelemetry instrumentation, banyak framework dapat melakukan inject/extract otomatis. Jika manual JMS client, kamu perlu inject property ke message.

Pseudo-code modern:

```java
// Producer side pseudo-code
TextMessage message = session.createTextMessage(payloadJson);

message.setStringProperty("traceparent", currentTraceParent);
message.setStringProperty("tracestate", currentTraceState);
message.setStringProperty("correlationId", correlationId);
message.setStringProperty("causationId", causationId);
message.setStringProperty("messageType", "ApproveCaseCommand");
message.setStringProperty("messageVersion", "2.1");

producer.send(message);
```

Consumer:

```java
// Consumer side pseudo-code
String traceparent = message.getStringProperty("traceparent");
String correlationId = message.getStringProperty("correlationId");
String messageType = message.getStringProperty("messageType");

// Extract trace context, start CONSUMER span, put correlation fields into MDC/log context.
```

### 9.3 Trace Attribute Cardinality

Trace attributes boleh lebih detail daripada metric label, tetapi tetap hati-hati.

Recommended attributes:

```text
messaging.system = "jms" or provider name if known
messaging.destination.name = "case.command.approve"
messaging.operation.name = "send" / "receive" / "process"
messaging.message.id = JMSMessageID
messaging.conversation_id = correlationId
messaging.message.body.size = payload size
service.name = producer/consumer service
```

Hindari memasukkan payload penuh sebagai span attribute.

---

## 10. Auditability: Observability untuk Bukti, Bukan Hanya Debug

Observability dan audit tidak sama.

| Observability | Audit |
|---|---|
| Untuk debugging/operasi | Untuk bukti dan accountability |
| Bisa sampled | Tidak boleh sampled untuk event penting |
| Bisa short retention | Retention sesuai regulasi |
| Fokus technical signal | Fokus business/legal/system action |
| Bisa berubah format cepat | Harus stabil dan governance-friendly |

Untuk sistem regulated, JMS processing harus meninggalkan audit trail untuk action penting.

### 10.1 Audit Event Minimal

Untuk setiap business message kritikal:

```json
{
  "auditEventType": "MESSAGE_PROCESSED",
  "occurredAt": "2026-06-18T10:15:30.123Z",
  "service": "case-service",
  "destination": "case.command.approve",
  "messageType": "ApproveCaseCommand",
  "messageVersion": "2.1",
  "businessProcessId": "BP-2026-0001",
  "caseId": "CASE-12345",
  "correlationId": "corr-7f3a",
  "causationId": "cmd-123",
  "idempotencyKey": "cmd-123",
  "idempotencyResult": "NEW",
  "deliveryCount": 1,
  "handlerResult": "SUCCESS",
  "stateBefore": "PENDING_REVIEW",
  "stateAfter": "APPROVED",
  "sideEffects": [
    {"type": "DB_UPDATE", "status": "SUCCESS"},
    {"type": "OUTBOX_EVENT", "status": "SUCCESS", "eventType": "CaseApprovedEvent"}
  ]
}
```

### 10.2 Audit untuk Failure

Failure juga perlu audit jika berdampak pada business process.

```json
{
  "auditEventType": "MESSAGE_PROCESSING_FAILED",
  "messageType": "ApproveCaseCommand",
  "caseId": "CASE-12345",
  "correlationId": "corr-7f3a",
  "deliveryCount": 5,
  "failureClass": "RetryableDownstreamTimeout",
  "failureCategory": "TRANSIENT_EXTERNAL_DEPENDENCY",
  "decision": "ROLLBACK_FOR_REDELIVERY"
}
```

### 10.3 Audit untuk Replay

Replay manual harus lebih ketat.

```json
{
  "auditEventType": "DLQ_REPLAY_APPROVED",
  "sourceDlq": "DLQ.case.command.approve",
  "sourceMessageId": "ID:broker-123",
  "replayBatchId": "RP-2026-0009",
  "operatorId": "ops-user-17",
  "approvalId": "APPROVAL-321",
  "reason": "External API outage resolved",
  "payloadChanged": false,
  "targetDestination": "case.command.approve"
}
```

Tanpa audit replay, kamu tidak bisa menjelaskan kenapa state berubah ulang setelah incident.

---

## 11. Forensic Debugging: Pertanyaan yang Harus Bisa Dijawab

### 11.1 Message Hilang

Pertanyaan:

1. Producer menerima request?
2. Producer mencoba send?
3. Producer send berhasil atau gagal?
4. Jika transacted, commit berhasil?
5. Message masuk broker?
6. Message expired karena TTL?
7. Message dikonsumsi dan ack?
8. Consumer crash sebelum log success?
9. Message masuk DLQ?
10. Ada manual delete/move?
11. Ada selector yang membuat consumer tidak menerima?
12. Ada wrong destination?
13. Ada bridge/federation issue?
14. Ada non-persistent message hilang saat broker restart?

Data yang dibutuhkan:

- producer log `send.attempt/success/failure`
- broker enqueue/dequeue metrics
- broker management query by message id/correlation id jika tersedia
- consumer logs
- DLQ metrics
- audit trail
- transaction/outbox table

### 11.2 Message Duplicate

Pertanyaan:

1. Producer mengirim dua kali?
2. Message sama business id tetapi beda JMSMessageID?
3. Consumer rollback setelah side effect?
4. Ack/commit gagal setelah side effect?
5. Broker failover menyebabkan redelivery?
6. Manual replay dilakukan?
7. DLQ replay mengirim ulang payload lama?
8. Consumer idempotency tidak aktif?
9. Dedup key salah pilih?

Data yang dibutuhkan:

- idempotency table
- business command id/event id
- `JMSRedelivered`
- `JMSXDeliveryCount`
- replay audit
- state transition audit

### 11.3 Message Lambat

Pisahkan latency:

```text
producer_time_to_send
broker_queue_wait
dispatch_wait
consumer_processing_time
side_effect_time
ack_commit_time
end_to_end_business_latency
```

Jika hanya punya total latency, kamu tidak tahu bottleneck.

### 11.4 Message Masuk DLQ

Pertanyaan:

1. Error transient atau permanent?
2. Delivery count berapa?
3. Retry policy apa?
4. Semua message gagal atau hanya subset?
5. Error karena payload/schema, downstream, data state, auth, timeout, atau bug?
6. Aman replay tanpa patch?
7. Perlu repair data dulu?
8. Ada ordering dependency?
9. Ada poison flood?

---

## 12. Dashboard yang Berguna

### 12.1 Executive / Business Dashboard

Untuk non-engineering stakeholders:

- Business messages processed/hour
- Failed business messages/hour
- Oldest pending business message age
- SLA breach risk count
- DLQ unresolved count
- Replay count today
- Affected case/application count

### 12.2 Application Team Dashboard

Untuk service owner:

- Producer send rate/error/duration
- Consumer processing rate/error/duration
- Queue wait p50/p95/p99
- Handler processing p50/p95/p99
- Redelivery rate
- DLQ rate
- Idempotency duplicate/conflict count
- Downstream dependency latency/error
- Consumer thread pool/DB pool saturation

### 12.3 Broker Ops Dashboard

Untuk platform/SRE:

- Broker node up/down
- Connections/sessions/consumers
- Queue depth per destination
- Enqueue/dequeue/dispatch rate
- Delivering/in-flight count
- Paging active/page size
- Journal write latency
- Disk usage/free space
- Heap/direct memory
- GC pause
- Network IO
- Cluster/replication status

### 12.4 DLQ Operations Dashboard

Untuk support/ops:

- DLQ count by source queue
- Oldest DLQ age
- DLQ by error category
- Triage status
- Replay status
- Failed replay count
- Messages requiring data repair
- Messages requiring product/business decision

---

## 13. Alerting: Jangan Alert Semua Queue Depth

Alert harus action-oriented.

Buruk:

```text
Queue depth > 1000
```

Kenapa buruk?

- Tidak mempertimbangkan arrival rate.
- Tidak mempertimbangkan consumer rate.
- Tidak mempertimbangkan SLA.
- Bisa false positive saat batch normal.

Lebih baik:

```text
oldest_message_age_seconds > SLA_threshold
AND consumer_success_rate < expected_rate
FOR 10 minutes
```

Atau:

```text
queue_depth increasing for 15 minutes
AND dequeue_rate < enqueue_rate * 0.8
AND consumer_count > 0
```

### 13.1 Alert Minimal

| Alert | Signal | Action |
|---|---|---|
| Broker down | broker availability | failover / platform action |
| No consumers | consumer_count = 0 for critical queue | restart/check deployment |
| Oldest message age high | oldest_message_age > SLA | scale/fix bottleneck |
| DLQ increasing | dlq_added_rate > 0 | triage failures |
| Redelivery storm | redelivery_rate high | stop consumers/check dependency |
| Paging active too long | paging active + depth increasing | capacity/storage tuning |
| Journal/disk latency high | write latency high | storage/platform action |
| Consumer error spike | handler failure rate high | app owner action |
| Idempotency conflict spike | duplicate/conflict high | producer/replay investigation |
| Reconnect storm | reconnect count high | network/broker/client auth action |

### 13.2 Alert dengan Severity

```text
P1:
- critical queue oldest age exceeds hard SLA
- broker unavailable without failover
- DLQ rapidly increasing for critical command queue
- consumer count zero for critical queue

P2:
- redelivery rate elevated
- processing p99 > threshold for 15 min
- queue backlog growth projected to breach SLA

P3:
- queue depth above normal but SLA safe
- replay backlog older than target
- non-critical topic subscriber lag
```

---

## 14. Java Implementation Pattern: MDC Context untuk JMS Consumer

### 14.1 Java 8 Style

```java
public final class JmsLogContext implements AutoCloseable {
    private final Map<String, String> previous = new HashMap<>();
    private final List<String> keys = new ArrayList<>();

    public JmsLogContext(Message message) throws JMSException {
        put("jmsMessageId", safe(message.getJMSMessageID()));
        put("jmsCorrelationId", safe(message.getJMSCorrelationID()));
        put("jmsDestination", safe(String.valueOf(message.getJMSDestination())));
        put("jmsRedelivered", String.valueOf(message.getJMSRedelivered()));

        String messageType = getStringProperty(message, "messageType");
        String messageVersion = getStringProperty(message, "messageVersion");
        String businessProcessId = getStringProperty(message, "businessProcessId");
        String caseId = getStringProperty(message, "caseId");
        String traceId = getStringProperty(message, "traceId");

        put("messageType", messageType);
        put("messageVersion", messageVersion);
        put("businessProcessId", businessProcessId);
        put("caseId", caseId);
        put("traceId", traceId);

        try {
            if (message.propertyExists("JMSXDeliveryCount")) {
                put("deliveryCount", String.valueOf(message.getIntProperty("JMSXDeliveryCount")));
            }
        } catch (JMSException ignored) {
            put("deliveryCount", "unknown");
        }
    }

    private void put(String key, String value) {
        if (value == null || value.isEmpty()) {
            return;
        }
        previous.put(key, MDC.get(key));
        keys.add(key);
        MDC.put(key, value);
    }

    private static String getStringProperty(Message message, String key) throws JMSException {
        if (!message.propertyExists(key)) {
            return null;
        }
        return message.getStringProperty(key);
    }

    private static String safe(String value) {
        return value == null ? null : value;
    }

    @Override
    public void close() {
        for (String key : keys) {
            String old = previous.get(key);
            if (old == null) {
                MDC.remove(key);
            } else {
                MDC.put(key, old);
            }
        }
    }
}
```

Usage:

```java
public final class CaseCommandListener implements MessageListener {
    private static final Logger log = LoggerFactory.getLogger(CaseCommandListener.class);

    @Override
    public void onMessage(Message message) {
        long startNanos = System.nanoTime();

        try (JmsLogContext ignored = new JmsLogContext(message)) {
            log.info("event=jms.consumer.processing.start");

            process(message);

            long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
            log.info("event=jms.consumer.processing.success durationMs={}", durationMs);
        } catch (RetryableBusinessException e) {
            log.warn("event=jms.consumer.processing.retryable_failure errorClass={} message={}",
                    e.getClass().getName(), e.getMessage(), e);
            throw e;
        } catch (RuntimeException e) {
            log.error("event=jms.consumer.processing.failure errorClass={} message={}",
                    e.getClass().getName(), e.getMessage(), e);
            throw e;
        } catch (JMSException e) {
            log.error("event=jms.consumer.context_failure errorClass={} message={}",
                    e.getClass().getName(), e.getMessage(), e);
            throw new RuntimeException(e);
        }
    }

    private void process(Message message) {
        // business processing
    }
}
```

### 14.2 Java 17/21/25 Style

Gunakan record untuk extracted metadata.

```java
public record JmsMessageTelemetry(
        String jmsMessageId,
        String jmsCorrelationId,
        String destination,
        String messageType,
        String messageVersion,
        String businessProcessId,
        String caseId,
        String traceId,
        boolean redelivered,
        Integer deliveryCount
) {
    public static JmsMessageTelemetry from(Message message) throws JMSException {
        Integer deliveryCount = null;
        if (message.propertyExists("JMSXDeliveryCount")) {
            deliveryCount = message.getIntProperty("JMSXDeliveryCount");
        }

        return new JmsMessageTelemetry(
                message.getJMSMessageID(),
                message.getJMSCorrelationID(),
                String.valueOf(message.getJMSDestination()),
                stringProperty(message, "messageType"),
                stringProperty(message, "messageVersion"),
                stringProperty(message, "businessProcessId"),
                stringProperty(message, "caseId"),
                stringProperty(message, "traceId"),
                message.getJMSRedelivered(),
                deliveryCount
        );
    }

    private static String stringProperty(Message message, String key) throws JMSException {
        return message.propertyExists(key) ? message.getStringProperty(key) : null;
    }
}
```

---

## 15. Metrics Instrumentation Pattern

### 15.1 Consumer Timing Wrapper

Pseudo-code:

```java
public final class InstrumentedMessageHandler {
    private final BusinessHandler delegate;
    private final MeterRegistry meterRegistry;

    public void handle(Message message) {
        JmsMessageTelemetry telemetry = extract(message);
        Timer.Sample sample = Timer.start(meterRegistry);

        Counter.builder("jms_consumer_receive_total")
                .tag("destination", normalize(telemetry.destination()))
                .tag("message_type", telemetry.messageType())
                .register(meterRegistry)
                .increment();

        try {
            delegate.handle(message);

            Counter.builder("jms_consumer_success_total")
                    .tag("destination", normalize(telemetry.destination()))
                    .tag("message_type", telemetry.messageType())
                    .register(meterRegistry)
                    .increment();
        } catch (RuntimeException e) {
            Counter.builder("jms_consumer_failure_total")
                    .tag("destination", normalize(telemetry.destination()))
                    .tag("message_type", telemetry.messageType())
                    .tag("error_class", e.getClass().getSimpleName())
                    .register(meterRegistry)
                    .increment();
            throw e;
        } finally {
            sample.stop(Timer.builder("jms_consumer_processing_duration_seconds")
                    .tag("destination", normalize(telemetry.destination()))
                    .tag("message_type", telemetry.messageType())
                    .register(meterRegistry));
        }
    }
}
```

Dalam production, hindari register builder setiap message jika library tidak cache meter dengan baik. Pre-register atau cache meter per low-cardinality tag combination.

---

## 16. Queue Wait dan End-to-End Latency

### 16.1 Menggunakan `JMSTimestamp`

`JMSTimestamp` bisa dipakai sebagai approximate send time. Tetapi hati-hati:

- timestamp bisa bergantung provider/config,
- clock antar node bisa skew,
- producer time bukan selalu business action time,
- transacted send bisa membuat visibility berbeda dari timestamp.

Tetap berguna sebagai estimasi:

```java
long now = System.currentTimeMillis();
long jmsTimestamp = message.getJMSTimestamp();
long queueWaitMs = Math.max(0L, now - jmsTimestamp);
```

### 16.2 Lebih Baik: Business Envelope Time

Tambahkan:

```json
{
  "eventId": "evt-123",
  "occurredAt": "2026-06-18T10:00:00Z",
  "publishedAt": "2026-06-18T10:00:03Z"
}
```

Lalu ukur:

```text
business_event_age = consumer_done_time - occurredAt
transport_queue_wait = consumer_receive_time - publishedAt/JMSTimestamp
processing_time = consumer_done_time - consumer_start_time
```

---

## 17. Broker Management dan Message Inspection

Broker management penting untuk forensic, tetapi harus dibatasi.

Kemampuan umum:

- list queues/topics,
- check message count,
- browse message,
- move message,
- expire message,
- send to DLQ,
- retry/replay,
- check consumers,
- check connections/sessions,
- check address settings,
- check paging.

ActiveMQ Artemis menyediakan management operations untuk berbagai tindakan operasional seperti expiring messages, moving messages, dan sending messages to dead letter address. Ini sangat berguna untuk support, tetapi juga berbahaya jika tanpa governance.

Rule:

```text
Management operation must be auditable.
Manual broker operation must be treated as production change.
```

Jangan izinkan semua engineer move/delete/replay message tanpa:

- reason,
- approval untuk critical queue,
- audit log,
- batch id,
- dry-run/preview,
- rollback plan jika applicable.

---

## 18. Observability untuk Prefetch / Consumer Window

Bug JMS sering muncul karena message sudah tidak terlihat di queue depth tetapi belum selesai diproses.

Kenapa?

Broker sudah dispatch message ke consumer, tetapi consumer belum ack. Message berada di in-flight/delivering state atau client buffer.

Jika prefetch/window besar:

```text
Queue depth terlihat turun.
Consumer buffer memegang banyak message.
Processing tetap lambat.
Crash consumer menyebabkan banyak redelivery.
Ordering bisa terlihat aneh.
```

Monitor:

```text
queue_message_count
queue_delivering_count
consumer_count
consumer_processing_active
consumer_processing_duration
consumer_redelivery_after_crash
```

Jika `delivering_count` tinggi dan success rate rendah, masalah ada di consumer/handler/downstream, bukan arrival rate saja.

---

## 19. Observability untuk Transaction Boundary

Jika memakai local transaction atau JTA/XA, log dan metric harus membedakan:

```text
handler_success
transaction_commit_success
ack_success
```

Jangan log `processing.success` sebelum commit jika user akan mengartikannya sebagai final.

Lebih presisi:

```text
jms.consumer.business_effect.success
jms.consumer.transaction.commit.success
jms.consumer.message.completed
```

Failure window:

```text
DB commit success
JMS ack/commit fails
=> message redelivered, side effect already happened
=> idempotency required
```

Audit harus mencatat idempotency result pada redelivery.

---

## 20. Observability untuk Outbox / Inbox

Jika memakai outbox:

Metric:

```text
outbox_pending_count
outbox_oldest_age_seconds
outbox_publish_attempt_total
outbox_publish_success_total
outbox_publish_failure_total
outbox_relay_lag_seconds
```

Log:

```text
outbox.relay.pick
outbox.relay.publish.success
outbox.relay.publish.failure
outbox.relay.mark_published.success
```

Jika memakai inbox/dedup:

Metric:

```text
inbox_insert_success_total
inbox_duplicate_total
inbox_conflict_total
inbox_processing_success_total
inbox_processing_failure_total
```

Top engineer akan selalu menghubungkan JMS observability dengan outbox/inbox observability, karena reliability end-to-end tidak selesai di broker.

---

## 21. Sampling Strategy

Jangan sampling audit critical event. Tetapi tracing/log debug bisa sampling.

Recommended:

| Data | Sampling |
|---|---|
| Metrics | Tidak sampled secara event; aggregate normal |
| Critical audit | 100% |
| DLQ/replay audit | 100% |
| Error logs | 100% |
| Success logs high-volume | sampled atau aggregate |
| Distributed traces | probabilistic + tail-based for error/slow |
| Payload snapshot | sangat terbatas, masked, encrypted, access-controlled |

Tail-based sampling berguna:

- keep traces with error,
- keep traces with DLQ,
- keep traces with p99 latency,
- keep traces for specific correlation id during incident.

---

## 22. PII, Secrets, dan Payload Safety

JMS message sering membawa data sensitif.

Rule keras:

1. Jangan log payload penuh by default.
2. Mask PII.
3. Jangan masukkan token/password/cert/private key ke log, metric, trace, atau DLQ UI.
4. Batasi browse message di broker console.
5. Encrypt sensitive payload at rest/in transit jika diperlukan.
6. Audit siapa yang melihat payload DLQ.
7. Gunakan payload hash untuk correlation tanpa membuka isi.

Contoh payload fingerprint:

```text
payloadSha256 = SHA-256(canonicalPayload)
```

Fingerprint membantu membuktikan payload berubah/tidak berubah saat replay tanpa menyimpan payload di log.

---

## 23. Runbook Investigasi Incident JMS

### 23.1 Queue Backlog Naik

Checklist:

1. Cek enqueue rate vs dequeue/ack rate.
2. Cek oldest message age.
3. Cek consumer count.
4. Cek delivering/in-flight count.
5. Cek consumer error rate.
6. Cek handler p95/p99.
7. Cek downstream DB/API latency/error.
8. Cek thread pool/DB pool saturation.
9. Cek broker paging/journal/disk.
10. Cek deploy/release terakhir.
11. Tentukan action:
    - scale consumer,
    - reduce prefetch,
    - stop poison consumer,
    - fix downstream,
    - pause producer,
    - enable backpressure/load shedding.

### 23.2 DLQ Bertambah

Checklist:

1. Group by source destination.
2. Group by message type/version.
3. Group by error category.
4. Sample message metadata, bukan payload penuh sembarangan.
5. Tentukan transient/permanent.
6. Jika transient sudah resolved, replay dengan batch id.
7. Jika permanent schema/data bug, patch code/data lalu replay.
8. Jika poison, park/discard sesuai approval.
9. Update known-error classification.
10. Tambahkan test/alert agar tidak berulang.

### 23.3 Duplicate Side Effect

Checklist:

1. Cari business id/idempotency key.
2. Cari semua message dengan correlation id/command id.
3. Cek producer double-send.
4. Cek delivery count/redelivery.
5. Cek consumer rollback setelah side effect.
6. Cek replay audit.
7. Cek idempotency table.
8. Cek state transition guard.
9. Repair state jika perlu.
10. Perkuat invariant handler.

---

## 24. Anti-Pattern Observability JMS

### 24.1 Broker Dashboard Only

Masalah:

```text
Queue terlihat normal, tapi business process gagal.
```

Solusi:

- hubungkan broker metrics dengan handler metrics dan business audit.

### 24.2 Log Payload Penuh

Masalah:

- PII leak,
- log mahal,
- sulit dicari,
- security incident.

Solusi:

- log metadata + hash + masked fields.

### 24.3 Tidak Ada Correlation ID

Masalah:

- incident investigation menjadi grep manual berdasarkan timestamp.

Solusi:

- wajibkan correlation id dan causation id di envelope/properties.

### 24.4 Menggunakan Message ID sebagai Business Identity

Masalah:

- duplicate business command tidak terdeteksi karena JMSMessageID berbeda.

Solusi:

- gunakan command/event id business-level.

### 24.5 Alert Queue Depth Mentah

Masalah:

- noisy, tidak SLA-aware.

Solusi:

- alert based on oldest age, growth rate, error, and processing capacity.

### 24.6 Tidak Ada Replay Audit

Masalah:

- impossible to prove why state changed after incident.

Solusi:

- replay workflow with batch id, operator, approval, reason.

### 24.7 Trace Tidak Melewati Async Boundary

Masalah:

- producer trace terputus dari consumer trace.

Solusi:

- propagate trace context in message properties/envelope.

### 24.8 Metric Label High Cardinality

Masalah:

- metrics backend mahal/rusak.

Solusi:

- keep message id/case id in logs/traces, not metric labels.

---

## 25. Production Checklist

### 25.1 Producer

- [ ] Log send attempt/success/failure.
- [ ] Metric send rate/error/duration.
- [ ] Trace producer span.
- [ ] Correlation id propagated.
- [ ] Causation id set.
- [ ] Message type/version set.
- [ ] Payload size measured.
- [ ] Async send callback observed.
- [ ] Transaction commit/rollback observed.

### 25.2 Broker

- [ ] Queue depth monitored.
- [ ] Oldest message age monitored.
- [ ] Enqueue/dequeue/dispatch monitored.
- [ ] Delivering/in-flight monitored.
- [ ] Consumer count monitored.
- [ ] Redelivery/DLQ monitored.
- [ ] Paging/storage/journal monitored.
- [ ] Connection/session count monitored.
- [ ] Broker availability/cluster/failover monitored.

### 25.3 Consumer

- [ ] Receive/start/success/failure logged.
- [ ] Handler duration measured.
- [ ] Queue wait measured.
- [ ] Redelivery/delivery count logged.
- [ ] Ack/commit result observed.
- [ ] Idempotency result logged.
- [ ] Business state transition audited.
- [ ] Downstream calls traced.
- [ ] MDC/log context cleared after processing.

### 25.4 DLQ/Repair

- [ ] DLQ count and oldest age alerting.
- [ ] Error classification exists.
- [ ] Replay process has audit.
- [ ] Replay batch id exists.
- [ ] Operator/approval/reason captured.
- [ ] Payload patching governed.
- [ ] Replay idempotency safe.

### 25.5 Security/Compliance

- [ ] No raw sensitive payload in normal logs.
- [ ] DLQ browsing access controlled.
- [ ] Payload hash/fingerprint available.
- [ ] Audit retention defined.
- [ ] Trace/log retention defined.
- [ ] Tenant/business identifiers handled safely.

---

## 26. Mini Case Study: Consumer Lambat tapi Queue Depth Tidak Naik

Gejala:

```text
Business team complains approval notification is delayed.
Queue depth is low.
No obvious errors.
```

Kemungkinan:

1. Broker dispatches messages to consumer prefetch buffer.
2. Queue depth turun karena message already delivering.
3. Consumer handler lambat karena external API timeout.
4. `delivering_count` tinggi.
5. Processing p99 naik.
6. Oldest in-flight age tinggi.

Tanpa observing delivering/in-flight dan handler latency, tim salah menyimpulkan queue sehat.

Diagnosis yang benar:

```text
queue_depth low
+ delivering_count high
+ consumer_processing_duration p99 high
+ downstream_notification_api latency high
= bottleneck in consumer side effect, not broker queueing
```

Action:

- reduce external API timeout,
- add circuit breaker,
- separate notification retry queue,
- tune consumer concurrency carefully,
- lower prefetch if in-flight hoarding hurts fairness,
- add alert on delivering age / processing latency.

---

## 27. Mini Case Study: DLQ Spike Setelah Deployment

Gejala:

```text
DLQ for case.command.approve increased from 0 to 5,000 after deployment.
```

Investigation:

1. Group DLQ by `messageType` and `messageVersion`.
2. Check error class.
3. Check deployment version.
4. Check schema compatibility.
5. Check idempotency and state transition errors.

Possible finding:

```text
Consumer v3 expects mandatory field approvalReasonCode.
Producer v2 does not send it.
Consumer throws validation error.
Messages retry 10 times then DLQ.
```

Root cause:

```text
Backward incompatible consumer change deployed before producer migration.
```

Fix:

- make field optional/defaultable,
- redeploy consumer,
- replay DLQ with replay batch id,
- add contract test,
- add schema compatibility gate.

Observability lesson:

- DLQ by message type/version is critical.
- Error classification must distinguish schema error from downstream timeout.

---

## 28. Reference: Suggested Log Field Names

Recommended common fields:

```text
timestamp
level
service
environment
region
instance
thread
event
traceId
spanId
correlationId
causationId
businessProcessId
tenantId
caseId
messageType
messageVersion
jmsMessageId
jmsCorrelationId
jmsDestination
jmsReplyTo
jmsRedelivered
deliveryCount
idempotencyKey
idempotencyResult
processingDurationMs
queueWaitMs
handlerResult
errorClass
errorCategory
errorMessage
replayBatchId
operatorId
```

Naming consistency matters more than perfect naming.

---

## 29. Ringkasan Mental Model

Observability JMS harus menjawab empat hal:

```text
Where is the message?
What is happening to it?
What business state did it affect?
Can we prove and recover safely?
```

Jika sistem hanya punya queue depth, belum observable.  
Jika sistem hanya punya log error, belum forensic-ready.  
Jika sistem hanya punya tracing tanpa audit, belum defensible.  
Jika sistem punya audit tanpa metrics, incident response lambat.  
Jika sistem punya metrics tanpa correlation, root cause sulit.

Top 1% engineer mendesain observability sebagai bagian dari correctness model, bukan add-on setelah production incident.

---

## 30. Latihan

### Latihan 1 — Metric Design

Untuk queue `case.command.approve`, desain metric minimal untuk:

- producer send,
- broker backlog,
- consumer processing,
- DLQ,
- replay.

Pastikan metric label tidak high-cardinality.

### Latihan 2 — Correlation Design

Desain envelope untuk flow:

```text
User approves application
-> ApproveApplicationCommand
-> ApplicationApprovedEvent
-> NotificationRequestedCommand
-> EmailSentEvent
```

Tentukan:

- correlation id,
- causation id,
- command/event id,
- trace id,
- business process id.

### Latihan 3 — Incident Timeline

Diberikan data:

```text
10:00 producer send success
10:01 broker enqueue count +1
10:05 consumer processing start
10:06 DB update success
10:06 consumer crash before ack
10:07 message redelivered
10:08 consumer duplicate detected
10:08 ack success
```

Tuliskan incident timeline dan jelaskan kenapa idempotency wajib.

### Latihan 4 — Alert Improvement

Ubah alert berikut menjadi SLA-aware:

```text
Queue depth > 1000 for 5 minutes
```

Tambahkan condition untuk:

- oldest message age,
- enqueue/dequeue rate,
- consumer count,
- error rate.

### Latihan 5 — Replay Governance

Desain audit event untuk replay 100 message dari DLQ setelah external API outage resolved.

Harus mencakup:

- replay batch id,
- source DLQ,
- target destination,
- operator,
- reason,
- approval,
- payload changed or not,
- result summary.

---

## 31. Referensi Resmi dan Utama

- Jakarta Messaging 3.1 Specification — message model, headers, properties, delivery metadata, JMS API contract.  
  https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html

- Jakarta EE Tutorial — Messaging concepts and asynchronous/loosely coupled messaging model.  
  https://jakarta.ee/learn/docs/jakartaee-tutorial/current/messaging/jms-concepts/jms-concepts.html

- Apache ActiveMQ Artemis Documentation — management, address settings, redelivery, DLQ, metrics, paging, broker operations.  
  https://artemis.apache.org/components/artemis/documentation/latest/management.html  
  https://artemis.apache.org/components/artemis/documentation/latest/address-settings.html  
  https://artemis.apache.org/components/artemis/documentation/latest/undelivered-messages.html  
  https://artemis.apache.org/components/artemis/documentation/latest/metrics.html

- OpenTelemetry Semantic Conventions for Messaging — tracing/metrics vocabulary for messaging systems.  
  https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/  
  https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/

---

## 32. Status Seri

Selesai:

- Part 0 sampai Part 27

Belum selesai:

- Part 28 sampai Part 35

Part berikutnya:

**Part 28 — Testing JMS Systems: Unit, Integration, Contract, Failure Injection, dan Deterministic Async Test**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-026.md">⬅️ Part 26 — Performance Tuning: Producer, Consumer, Broker, JVM, Network, Storage</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-028.md">Part 28 — Testing JMS Systems: Unit, Integration, Contract, Failure Injection, dan Deterministic Async Test ➡️</a>
</div>

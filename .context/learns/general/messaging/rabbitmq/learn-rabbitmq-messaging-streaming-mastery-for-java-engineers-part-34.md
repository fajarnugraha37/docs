# Learn RabbitMQ Messaging & Streaming Mastery for Java Engineers — Part 34

# Mastery Review, Heuristics, and Final Mental Models

> File: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-34.md`  
> Series: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Part: `34 / 34`  
> Status: Final part of the series

---

## 0. Tujuan Bagian Ini

Bagian ini adalah bagian penutup seri RabbitMQ.

Kita tidak akan memperkenalkan primitive baru secara besar-besaran. Fokusnya adalah menyatukan seluruh seri menjadi cara berpikir yang bisa dipakai saat:

- melakukan architecture review,
- memilih RabbitMQ vs Kafka vs HTTP vs database queue,
- mendesain topology baru,
- mengaudit sistem RabbitMQ existing,
- melakukan incident response,
- menulis consumer/publisher Java yang aman,
- membedakan masalah business workflow dari masalah broker,
- menjawab pertanyaan produksi: “Apa yang bisa gagal, bagaimana kita tahu, dan apa tindakan aman berikutnya?”

Target akhir: kamu tidak hanya tahu istilah RabbitMQ, tetapi bisa **membela desain RabbitMQ secara teknis dan operasional**.

---

## 1. Final Mental Model: RabbitMQ dalam Satu Kalimat

RabbitMQ adalah **broker message yang menggabungkan routing fabric, work distribution engine, replicated queue system, dan stream/log capability**, dengan semantics yang sangat kuat untuk command dispatch, asynchronous work, retry/DLQ, fanout notification, dan selective routing.

Kalimat ini sengaja panjang karena RabbitMQ bukan satu hal saja.

RabbitMQ bisa berperan sebagai:

1. **Routing fabric**  
   Exchange dan binding menentukan pesan mengalir ke mana.

2. **Work distribution engine**  
   Queue mendistribusikan pekerjaan ke competing consumers.

3. **Reliability boundary**  
   Publisher confirms, durable queues, persistent messages, consumer acknowledgements, DLX, dan idempotency bekerja bersama.

4. **Replicated queue system**  
   Quorum queues memberi HA untuk workload queue yang durable.

5. **Stream/log system**  
   RabbitMQ Streams memberi append-only log, replay, offset, retention, dan deduplication.

6. **Operational contract**  
   Topology RabbitMQ adalah kontrak antara producer, broker, consumer, operator, dan domain owner.

Jika kamu menganggap RabbitMQ hanya “tempat taruh message”, desainmu akan rapuh.

---

## 2. RabbitMQ Bukan Kafka Kecil

Perbedaan paling penting:

| Dimensi | RabbitMQ | Kafka |
|---|---|---|
| Primitive utama | exchange, queue, binding, routing key, stream | topic, partition, offset, consumer group |
| Model utama | routed messaging + work distribution | replicated distributed log |
| Konsumsi queue tradisional | destructive consumption | non-destructive consumption |
| Routing | broker-side routing kaya | topic/partition-oriented |
| Ack | consumer ack per delivery | offset commit |
| Retry/DLQ | native queue topology kuat | biasanya topic-based/retry topic pattern |
| Use case natural | command, job, workflow step, notification, fanout, routing | event log, replay, analytics, data pipeline, event sourcing skala besar |
| Ordering | queue/partition/topology dependent | partition dependent |
| Backpressure | prefetch, blocked connection, queue depth | consumer lag, producer throttling, broker quotas |
| Replay | via streams atau manual DLQ/requeue | native topic retention/replay |

RabbitMQ unggul ketika problem-mu berbentuk:

- “Kirim command ini ke worker yang tepat.”
- “Distribusikan pekerjaan ke N consumer.”
- “Jika gagal, retry lalu DLQ.”
- “Fanout event ke beberapa service dengan queue masing-masing.”
- “Butuh routing berdasarkan topic/routing key.”
- “Butuh broker mengelola delivery dan ack.”
- “Butuh workflow handoff asynchronous.”

Kafka unggul ketika problem-mu berbentuk:

- “Simpan event history jangka panjang.”
- “Banyak consumer group membaca event yang sama.”
- “Replay besar-besaran adalah requirement utama.”
- “Event stream adalah source of truth atau data pipeline.”
- “Throughput log-scale lebih penting daripada routing granular broker-side.”

RabbitMQ Streams membuat batas ini lebih fleksibel, tetapi tidak menghapus perbedaan mental model.

---

## 3. Core Primitive Recap

### 3.1 Exchange

Exchange adalah router.

Exchange tidak menyimpan message untuk consumer. Exchange menerima publish dari producer lalu mencocokkan binding untuk menentukan queue/stream tujuan.

Jenis penting:

- `direct`
- `fanout`
- `topic`
- `headers`
- default exchange
- exchange-to-exchange binding
- alternate exchange

Heuristic:

> Jika pertanyaanmu adalah “pesan ini harus dikirim ke siapa?”, pikirkan exchange dan binding.

---

### 3.2 Queue

Queue adalah mailbox/work buffer.

Queue menyimpan message sampai consumer menerima dan meng-ack.

Jenis utama:

- classic queue,
- quorum queue,
- stream queue/stream.

Heuristic:

> Jika pertanyaanmu adalah “pekerjaan ini harus diproses oleh worker mana dan kapan aman dihapus?”, pikirkan queue.

---

### 3.3 Binding

Binding adalah aturan routing.

Binding menghubungkan exchange ke queue atau exchange lain.

Heuristic:

> Binding adalah infrastructure-level subscription. Jangan perlakukan binding sebagai detail minor.

---

### 3.4 Routing Key

Routing key adalah label routing yang dipakai exchange untuk mencocokkan binding.

Routing key yang baik:

- stabil,
- domain-aware,
- tidak terlalu teknis,
- tidak terlalu granular,
- punya taxonomy yang jelas.

Contoh baik:

```text
case.evidence.submitted
case.review.assigned
case.enforcement.proposed
notification.email.requested
```

Contoh buruk:

```text
serviceA.methodX.dtoV3.fast
```

---

### 3.5 Message

Message bukan Java object.

Message adalah contract lintas boundary.

Message harus punya:

- stable message id,
- message type,
- schema version,
- correlation id,
- causation id,
- occurred timestamp,
- producer identity,
- tenant/context jika relevan,
- payload yang backward/forward compatible.

Heuristic:

> Publish JPA entity ke RabbitMQ adalah smell berat.

---

### 3.6 Publisher Confirm

Publisher confirm menjawab:

> “Apakah broker sudah menerima dan menangani publish ini sesuai durability semantics yang berlaku?”

Tanpa confirm, publisher tidak tahu apakah pesan benar-benar aman.

---

### 3.7 Consumer Ack

Consumer ack menjawab:

> “Apakah consumer sudah selesai memproses delivery ini sehingga broker boleh menghapusnya dari queue?”

Ack bukan “saya sudah menerima message”.  
Ack adalah “side effect yang saya tanggung sudah cukup aman.”

---

### 3.8 Prefetch

Prefetch adalah budget jumlah unacked deliveries yang boleh berada di consumer.

Prefetch bukan tuning kecil.

Prefetch menentukan:

- memory pressure consumer,
- fairness,
- throughput,
- redelivery burst setelah crash,
- ordering behavior,
- effective concurrency.

---

## 4. Queue Type Decision Cheat Sheet

### 4.1 Classic Queue

Gunakan untuk:

- local/dev workload,
- non-critical queue,
- temporary queue,
- reply queue,
- low criticality transient work,
- workload yang tidak butuh replication safety tinggi.

Hindari untuk:

- critical durable command,
- HA workload,
- audit trail,
- long backlog critical,
- replicated production queue modern.

---

### 4.2 Quorum Queue

Gunakan untuk:

- durable command queue,
- critical work queue,
- workflow step queue,
- queue yang harus survive node failure,
- at-least-once processing dengan HA,
- poison handling dengan delivery-limit.

Trade-off:

- lebih mahal dari classic queue,
- butuh majority replica,
- write/ack path melibatkan replication,
- bukan untuk jutaan queue kecil,
- tidak menyelesaikan idempotency consumer.

Heuristic:

> Jika message adalah command penting yang tidak boleh hilang, mulai dari quorum queue.

---

### 4.3 RabbitMQ Stream

Gunakan untuk:

- audit trail,
- event history,
- replay,
- projection rebuild,
- non-destructive consumption,
- high-throughput append-only data,
- bridge antara messaging dan historical log.

Hindari untuk:

- simple work distribution yang tidak butuh replay,
- workflow command queue sederhana,
- queue dengan semantics ack/delete tradisional,
- kasus yang sebenarnya butuh Kafka-scale ecosystem.

Heuristic:

> Jika consumer harus bisa membaca ulang history, pikirkan stream. Jika message harus hilang setelah kerja selesai, pikirkan queue.

---

### 4.4 Super Stream

Gunakan untuk:

- stream dengan throughput lebih tinggi dari single stream,
- partitioned event history,
- per-key ordering,
- parallel consumer group,
- scaling stream writes/reads.

Trade-off:

- ordering hanya per partition,
- partition key menjadi keputusan arsitektur,
- hot key bisa merusak distribusi,
- reprocessing lebih kompleks.

---

## 5. Delivery Semantics Cheat Sheet

### 5.1 At-most-once

Message bisa hilang, tetapi tidak diproses ulang.

Biasanya terjadi jika:

- auto ack dipakai,
- consumer ack sebelum side effect selesai,
- producer tidak pakai confirm,
- persistent/durable tidak disiapkan.

Cocok untuk:

- telemetry non-critical,
- best-effort notification,
- cache invalidation yang bisa recover.

Tidak cocok untuk:

- payment,
- enforcement action,
- case workflow,
- evidence processing,
- audit event critical.

---

### 5.2 At-least-once

Message tidak boleh hilang, tetapi bisa diproses lebih dari sekali.

RabbitMQ production workload mayoritas berada di sini.

Membutuhkan:

- durable queue,
- persistent message,
- publisher confirm,
- manual consumer ack,
- ack after durable side effect,
- idempotent consumer.

Heuristic:

> At-least-once tanpa idempotency adalah bug yang hanya menunggu traffic nyata.

---

### 5.3 Exactly-once

Exactly-once end-to-end lintas broker, database, external API, dan consumer crash hampir selalu ilusi.

Yang realistis:

- exactly-once effect melalui idempotency,
- state transition guard,
- unique constraint,
- inbox table,
- transactional outbox,
- idempotent external API key.

Heuristic:

> Jangan tanya “apakah RabbitMQ exactly once?” Tanyakan “bagaimana sistem ini mencegah duplicate business effect?”

---

## 6. Reliability Ladder

Reliability publisher:

1. Fire-and-forget publish.
2. Durable exchange/queue + persistent message.
3. Publisher confirms.
4. Mandatory publish + return handling.
5. Stable message id.
6. Retry with bounded in-flight state.
7. Transactional outbox.
8. Observability: confirm latency, returned message count, publish failure rate.

Reliability consumer:

1. Auto ack.
2. Manual ack.
3. Ack after durable side effect.
4. Idempotent handler.
5. Exception taxonomy.
6. Retry/DLQ/parking lot.
7. Inbox table / processed message registry.
8. Observability: processing latency, redelivery, DLQ, oldest message age.

Reliability topology:

1. Queue exists.
2. Durable queue/exchange.
3. Quorum queue for critical workload.
4. DLX/DLQ.
5. Retry queues or delayed strategy.
6. Alternate exchange for unroutable messages.
7. Policies and guardrails.
8. Runbook.

---

## 7. Ack Timing Rules

### Rule 1: Ack after durable local commit

For a DB-backed consumer:

```text
receive message
  validate
  start DB transaction
    check idempotency/inbox
    apply business transition
    write audit/outbox if needed
    mark message processed
  commit DB transaction
ack message
```

Ack before commit risks message loss.

---

### Rule 2: Do not hold message unacked while waiting indefinitely

Long external call with no timeout causes:

- high unacked count,
- blocked redelivery,
- stuck consumer capacity,
- incident ambiguity.

Use:

- timeout,
- circuit breaker,
- bounded retry,
- async command split,
- DLQ for unrecoverable cases.

---

### Rule 3: Nack/requeue is not retry strategy

Immediate requeue can create tight retry loop.

Prefer:

- delayed retry queue,
- delivery-limit for quorum queues,
- retry counter,
- DLQ,
- parking lot.

---

### Rule 4: Every consumer must decide failure class

At minimum:

```java
enum FailureClass {
  TRANSIENT_RETRYABLE,
  PERMANENT_INVALID_MESSAGE,
  BUSINESS_REJECTED,
  UNKNOWN_INFRA_FAILURE,
  POISON_MESSAGE
}
```

Without classification, every exception becomes random infrastructure behavior.

---

## 8. Retry Decision Cheat Sheet

| Failure | Example | Action |
|---|---|---|
| Temporary dependency outage | HTTP 503 from downstream | delayed retry |
| Timeout unknown | downstream timeout after side effect maybe happened | retry only if idempotent/correlated |
| Invalid schema | missing required field | reject/DLQ/parking lot |
| Business rule rejection | case already closed | ack + business event, not retry |
| Poison handler bug | same message crashes consumer repeatedly | DLQ/parking lot, alert |
| Rate limit | downstream 429 | delayed retry with backoff |
| Auth/config bug | invalid credential | pause consumer or DLQ carefully; retry storm risk |
| Data dependency missing | referenced entity not yet available | short delayed retry or event ordering fix |

Heuristic:

> Retry is appropriate only when another attempt can plausibly succeed without creating duplicate harmful side effects.

---

## 9. DLQ and Parking Lot Rules

DLQ is for failed messages that need analysis or controlled replay.

Parking lot is for messages that require human/business remediation or long-lived quarantine.

DLQ should have:

- owner,
- alert,
- dashboard,
- replay procedure,
- max age policy,
- security control,
- reason classification,
- sample inspection process.

Never:

- ignore DLQ forever,
- auto-replay DLQ blindly,
- purge DLQ without ticket/approval,
- treat DLQ as success path.

---

## 10. Routing Design Cheat Sheet

### 10.1 Routing Key Shape

Recommended:

```text
<domain>.<aggregate-or-capability>.<event-or-command>
```

Examples:

```text
case.evidence.submitted
case.review.assigned
enforcement.action.proposed
notification.email.requested
audit.case.transition.recorded
```

Avoid:

```text
fast.high.priority.v2.serviceA
method.invoke.processThing
java.package.ClassName
```

---

### 10.2 Exchange per Domain Boundary

Prefer:

```text
case.events.topic
enforcement.events.topic
notification.commands.direct
audit.events.stream
```

Over:

```text
all.messages.exchange
main.topic
system.bus
```

Heuristic:

> Exchange names should reveal ownership and purpose.

---

### 10.3 Binding as Subscription Contract

A queue binding means:

> “This workload is expected to receive these messages.”

Therefore, binding changes require review like API subscription changes.

---

## 11. Ordering Cheat Sheet

Ordering is not one thing.

Different orderings:

1. Publish order.
2. Broker enqueue order.
3. Delivery order.
4. Processing start order.
5. Processing completion order.
6. Ack order.
7. Database commit order.
8. Business state transition order.

If your business cares about order, enforce it in business state.

Use:

- per-key queue,
- consistent hash exchange,
- single active consumer,
- stream/super stream partition key,
- version guard,
- state machine transition guard.

Do not rely on:

- “RabbitMQ queue is FIFO” as full system guarantee,
- competing consumers preserving business order,
- prefetch > 1 preserving completion order.

---

## 12. Idempotency Cheat Sheet

### 12.1 Consumer Idempotency

Minimum pattern:

```sql
CREATE TABLE processed_messages (
  consumer_name varchar(200) NOT NULL,
  message_id varchar(200) NOT NULL,
  processed_at timestamp NOT NULL,
  PRIMARY KEY (consumer_name, message_id)
);
```

Processing:

```text
begin transaction
  insert processed_messages(consumer, message_id)
  if duplicate: commit; ack
  apply business effect
commit
ack
```

---

### 12.2 Business Idempotency

Sometimes message id is not enough.

Use business keys:

- `caseId + transitionId`,
- `externalRequestId`,
- `evidenceId + version`,
- `actionProposalId`,
- `notificationIntentId`.

Heuristic:

> Technical idempotency prevents duplicate message handling. Business idempotency prevents duplicate meaning.

---

### 12.3 External Side Effect Idempotency

For email/payment/external API:

- pass idempotency key if supported,
- record outbound attempt,
- record provider response,
- do not ack until state is durable,
- handle timeout as unknown,
- reconcile unknown outcomes.

---

## 13. Publisher Outbox Cheat Sheet

Use transactional outbox when DB change and message publish must be tied.

Pattern:

```text
business transaction:
  update domain table
  insert outbox row
commit

outbox relay:
  read pending outbox
  publish to RabbitMQ
  wait for confirm
  mark sent
```

This solves:

- DB committed but publish failed,
- publish succeeded but app crashed before marking success,
- retry publish with stable message id,
- auditability.

It does not remove need for:

- idempotent consumer,
- duplicate-safe relay,
- monitoring outbox lag.

---

## 14. Queue Growth Diagnosis

When queue grows, ask:

1. Are publishers faster than consumers?
2. Are there enough consumers?
3. Are consumers alive but slow?
4. Are messages stuck unacked?
5. Are consumers failing and redelivering?
6. Is downstream dependency slow?
7. Is prefetch too high or too low?
8. Is there a poison message blocking progress?
9. Is message size too large?
10. Is retry queue feeding back too aggressively?
11. Is broker in memory/disk alarm?
12. Is one routing key/hot partition dominating?

Do not immediately add consumers before knowing bottleneck.

---

## 15. Redelivery Diagnosis

Redelivery spike means:

- consumer crashed,
- consumer nacked/requeued,
- handler exception with requeue,
- connection reset,
- broker recovered unacked messages,
- timeout/shutdown without ack.

Checklist:

- inspect consumer logs by `messageId`,
- inspect `redelivered` flag,
- inspect `x-death` if DLX involved,
- compare ack rate vs deliver rate,
- check dependency errors,
- check recent deploy,
- isolate sample message,
- route to DLQ/parking lot if poison.

---

## 16. Publisher Blocked Diagnosis

Publisher blocked usually means broker protects itself.

Common causes:

- memory alarm,
- disk alarm,
- slow consumers causing queue growth,
- huge messages,
- retry storm,
- persistent message backlog,
- stream retention/capacity issue.

Safe response:

1. Stop increasing publish pressure.
2. Identify top growing queues.
3. Check consumer health.
4. Check memory/disk metrics.
5. Scale consumers only if consumer CPU-bound and horizontally scalable.
6. Pause low-priority producers if needed.
7. Avoid purging without business approval.

---

## 17. Stream Replay Rules

Replay is powerful and dangerous.

Before replay:

- define target stream,
- define offset/time range,
- define replay consumer identity,
- ensure idempotency,
- isolate side effects,
- disable external calls unless intended,
- produce derived result to separate projection/table,
- record replay run id,
- monitor lag and errors.

Never:

- point old replay at live side-effecting consumer accidentally,
- reset offset without understanding side effects,
- assume replay is harmless because stream is immutable.

Heuristic:

> Replay is a production operation, not a debugging shortcut.

---

## 18. RabbitMQ Streams vs Queues Final Rule

Use queue when the message represents **work to be completed**.

Use stream when the message represents **history to be retained and reread**.

Use both when:

- one path drives work,
- another path stores audit/event history.

Example:

```text
case.evidence.submitted event
  -> quorum queue: evidence processor does work
  -> stream: audit/event history retained for replay
```

This hybrid pattern is one of the most powerful RabbitMQ modern designs.

---

## 19. Security Cheat Sheet

Security primitives:

- vhost,
- user/service account,
- permissions: configure/write/read,
- TLS,
- secret rotation,
- management UI restriction,
- payload policy,
- DLQ access policy,
- audit logging.

Rules:

1. Application runtime should not have broad configure permission unless justified.
2. Topology deployer can have configure; normal producer/consumer often should not.
3. Use separate vhosts for strong isolation.
4. Do not put sensitive data in routing key.
5. Do not treat DLQ as less sensitive than main queue.
6. Limit Management UI/API access.
7. Prefer short-lived/rotatable credentials.
8. Review Shovel/Federation credentials carefully.

---

## 20. Observability Cheat Sheet

### 20.1 Broker Metrics

Track:

- node memory,
- disk free,
- file descriptors,
- socket descriptors,
- connection count,
- channel count,
- Erlang process count,
- alarm status,
- network throughput.

### 20.2 Queue Metrics

Track:

- ready messages,
- unacked messages,
- total messages,
- publish rate,
- deliver rate,
- ack rate,
- redelivery rate,
- consumer count,
- consumer utilization,
- oldest message age.

### 20.3 Producer Metrics

Track:

- publish attempts,
- publish success,
- confirm latency,
- nack count,
- returned message count,
- outbox lag,
- in-flight confirms,
- blocked duration.

### 20.4 Consumer Metrics

Track:

- processing latency,
- success/failure count,
- ack/nack/reject count,
- redelivered count,
- dependency latency,
- DB commit latency,
- duplicate detected count,
- DLQ count.

### 20.5 Stream Metrics

Track:

- publish rate,
- consumer lag,
- offset progress,
- retention size,
- deduplication behavior,
- replay run progress,
- partition skew for super streams.

---

## 21. Production Readiness Rubric

Score each dimension from 0 to 3.

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Topology ownership | unknown | informal | documented | versioned + reviewed |
| Publisher reliability | fire-and-forget | persistent only | confirms | confirms + outbox + metrics |
| Consumer reliability | auto ack | manual ack | idempotent | idempotent + inbox + retry taxonomy |
| Retry/DLQ | none | basic DLQ | delayed retry | DLQ + parking lot + runbook |
| Queue type | accidental | classic default | mixed intentionally | quorum/stream chosen by semantics |
| Observability | UI only | basic metrics | dashboards | alerts + forensics + SLO |
| Security | shared admin | app users | least privilege | vhost/TLS/rotation/audit |
| Failure testing | none | manual | integration tests | chaos/load/replay tests |
| Operations | tribal knowledge | notes | runbook | rehearsed incident playbook |
| Contract design | object dump | DTO | versioned envelope | compatibility-tested contracts |

Interpretation:

- 0–10: high production risk.
- 11–20: basic system, fragile under incident.
- 21–25: reasonable production baseline.
- 26–30: mature RabbitMQ platform.

---

## 22. Architecture Review Questions

Before approving a RabbitMQ design, ask these.

### 22.1 Message Semantics

1. Is this a command, event, job, notification, reply, or audit record?
2. Is the message work or history?
3. Who owns the contract?
4. What is the message id?
5. What is the idempotency key?
6. What schema versioning strategy exists?
7. Can old consumers survive new messages?
8. Can new consumers read old messages?

### 22.2 Topology

1. Which exchange receives the message?
2. What exchange type is used and why?
3. Which routing key is used?
4. Which queues are bound and why?
5. Who owns each queue?
6. Is there an alternate exchange?
7. Is unroutable publish handled?
8. Are queue names environment-safe and domain-readable?

### 22.3 Reliability

1. Is publisher confirm enabled?
2. Is mandatory publish used where necessary?
3. Are returned messages handled?
4. Is the queue durable?
5. Are messages persistent?
6. Is this queue classic/quorum/stream and why?
7. Is the consumer manual ack?
8. When exactly does it ack?
9. Is the consumer idempotent?
10. What happens after consumer crash?

### 22.4 Failure and Retry

1. What failures are retryable?
2. What failures are permanent?
3. What failures are unknown?
4. Is retry immediate or delayed?
5. Is there a max retry count?
6. Where do poison messages go?
7. Who monitors DLQ?
8. How is DLQ replay performed safely?

### 22.5 Operations

1. What dashboard shows health?
2. What alert fires before SLA breach?
3. What is the oldest acceptable message age?
4. What is the max queue depth?
5. What happens when broker blocks publishers?
6. How are memory/disk alarms handled?
7. How is topology drift detected?
8. What is the runbook for node failure?

### 22.6 Security

1. Which vhost is used?
2. Which service account publishes?
3. Which service account consumes?
4. Does runtime app need configure permission?
5. Is TLS enabled?
6. Are secrets rotated?
7. Does message contain sensitive data?
8. Is DLQ access controlled?

---

## 23. Java Engineering Checklist

### 23.1 Publisher

- Use long-lived connection.
- Do not open connection per message.
- Use channel safely; avoid unsafe sharing across threads.
- Enable publisher confirms.
- Use mandatory publish for important routing.
- Handle returned messages.
- Bound in-flight confirms.
- Use stable `messageId`.
- Include correlation/causation IDs.
- Avoid publishing internal entity object.
- Prefer outbox for DB-coupled events.
- Emit metrics for confirm latency and failures.

### 23.2 Consumer

- Use manual ack for critical workload.
- Set explicit prefetch.
- Ack after durable local commit.
- Use idempotency/inbox.
- Classify exceptions.
- Do not blindly requeue.
- Send invalid messages to DLQ/parking lot.
- Use bounded thread pools.
- Shutdown gracefully.
- Log message id, correlation id, delivery tag, redelivered flag.
- Protect sensitive payloads.
- Test redelivery and duplicate behavior.

### 23.3 Spring AMQP

- Understand what `@RabbitListener` hides.
- Configure listener container factory intentionally.
- Set ack mode deliberately.
- Set prefetch deliberately.
- Set concurrency deliberately.
- Configure error handling.
- Avoid default requeue surprises.
- Configure publisher confirm/return callbacks.
- Use explicit message converter.
- Avoid Java serialization.
- Test topology with Testcontainers.

---

## 24. Operational Command Mindset

Commands like purge, requeue, delete queue, or replay are not technical housekeeping. They are business-impacting operations.

Before destructive operation:

1. Identify queue/stream precisely.
2. Identify message class and owner.
3. Estimate count/age/criticality.
4. Capture sample evidence.
5. Decide whether messages represent work, history, or invalid data.
6. Get approval if business effect is possible.
7. Record ticket/change id.
8. Execute smallest safe action.
9. Verify outcome.
10. Document lessons.

Heuristic:

> In regulated systems, operator action is part of the system behavior.

---

## 25. Failure Model Matrix

| Failure | Expected Design Response |
|---|---|
| Producer crash before publish | outbox row remains pending |
| Producer crash after publish before marking sent | duplicate publish possible; stable id + idempotent consumer handles it |
| Broker rejects/nacks publish | publisher retry or mark failed with alert |
| Message unroutable | mandatory return or alternate exchange captures it |
| Broker node fails | quorum queue/stream leader failover if majority exists |
| Consumer crash before ack | message redelivered |
| Consumer crash after DB commit before ack | duplicate delivery; idempotency handles it |
| Consumer receives invalid message | reject/DLQ/parking lot |
| Downstream dependency down | delayed retry with backoff |
| Retry storm | throttle/pause/parking lot, fix dependency |
| DLQ spike | classify, sample, owner escalation |
| Memory alarm | reduce publish pressure, drain queues, inspect consumers |
| Disk alarm | stop growth, free space, inspect retention/backlog |
| Network partition | quorum majority rules; no magic global availability |
| Replay bug | isolate replay consumers and side effects |

---

## 26. Naming Convention Reference

### 26.1 Exchanges

```text
<domain>.<purpose>.<type>
```

Examples:

```text
case.events.topic
case.commands.direct
audit.events.stream
audit.dlx.topic
notification.commands.direct
```

### 26.2 Queues

```text
<domain>.<consumer-or-capability>.<purpose>.q
```

Examples:

```text
case.review-assignment.commands.q
case.evidence-indexer.events.q
audit.dead-letter.q
notification.email-sender.commands.q
```

### 26.3 Retry Queues

```text
<base-queue>.retry.<delay>
```

Examples:

```text
notification.email-sender.commands.retry.30s
notification.email-sender.commands.retry.5m
notification.email-sender.commands.retry.1h
```

### 26.4 DLQ and Parking Lot

```text
<base-queue>.dlq
<base-queue>.parking-lot
```

---

## 27. Top 100 RabbitMQ Heuristics

1. RabbitMQ is not just a queue; it is a routing and delivery system.
2. Exchange routes; queue stores.
3. Binding is a subscription contract.
4. Routing key is an API design element.
5. Queue type is an architecture decision.
6. Classic queue is not the default answer for critical HA workload.
7. Quorum queue is for durable replicated work.
8. Stream is for retained history and replay.
9. Super stream scales stream throughput via partitioning.
10. Destructive consumption and non-destructive consumption are different worlds.
11. Publisher confirm protects against silent publish uncertainty.
12. Mandatory publish protects against silent unroutable messages.
13. Persistent message without durable queue is incomplete.
14. Durable queue without publisher confirm is incomplete.
15. Manual ack is mandatory for important work.
16. Ack after commit, not before.
17. Requeue is not retry strategy.
18. Immediate requeue can create infinite loop.
19. DLQ must be monitored.
20. Parking lot needs an owner.
21. Retry count belongs in design, not panic handling.
22. Poison messages are normal; design for them.
23. Idempotency is not optional for at-least-once.
24. Exactly-once end-to-end is usually marketing or misunderstanding.
25. Business idempotency is stronger than message idempotency.
26. Outbox solves DB-to-broker atomicity gap.
27. Inbox solves duplicate consumer effects.
28. Timeout means unknown, not failed.
29. External API calls need idempotency keys.
30. Prefetch is concurrency budget.
31. High prefetch can create redelivery bursts.
32. Low prefetch can underutilize consumers.
33. Ordering and parallelism fight each other.
34. FIFO queue does not imply FIFO business effect.
35. Use per-key partitioning for per-key order.
36. Single active consumer is useful but not free.
37. Large messages belong in object storage, not broker.
38. Queue depth alone is insufficient; track oldest message age.
39. Unacked count reveals consumer-side backlog.
40. Redelivery rate reveals failure loops.
41. Publish rate without ack rate can hide backlog growth.
42. Confirm latency can reveal broker pressure.
43. Consumer utilization can reveal insufficient consumer capacity.
44. RabbitMQ Management UI is not long-term monitoring.
45. Use Prometheus/Grafana for production metrics.
46. Firehose tracing is powerful but expensive and sensitive.
47. Correlation ID is mandatory for forensics.
48. Causation ID explains why a message exists.
49. Message type must be explicit.
50. Schema version must be explicit.
51. Do not publish Java class names as contract identity.
52. Do not publish JPA entities.
53. JSON is fine if compatibility discipline exists.
54. Protobuf/Avro do not save bad semantics.
55. DLQ payload is sensitive data.
56. Routing keys must not leak PII.
57. Vhost is an isolation boundary.
58. Runtime app rarely needs broad configure permission.
59. Separate topology deployer from runtime services.
60. TLS is not optional in serious environments.
61. RabbitMQ cluster is for LAN, not arbitrary WAN.
62. Shovel/Federation are links, not magic global cluster.
63. Multi-region active-active messaging is hard.
64. Duplicate cross-region messages are expected.
65. Network partition does not create free availability.
66. Quorum needs majority.
67. Two-node quorum cluster is usually a poor HA story.
68. Odd node counts are usually better for quorum.
69. Queue leader placement affects performance.
70. Persistent volume quality matters.
71. Disk alarm is a production incident.
72. Memory alarm is a production incident.
73. Publisher blocked is a backpressure signal, not random bug.
74. Retry storm can be worse than original outage.
75. Downstream outage should reduce traffic, not amplify it.
76. Consumer crash after commit before ack is normal failure mode.
77. Producer crash after publish before marking sent is normal failure mode.
78. Unknown publish outcome requires duplicate-safe design.
79. Stream offset is not business progress.
80. Replay must isolate side effects.
81. Stream filtering is optimization, not authorization.
82. Deduplication requires durable publishing id strategy.
83. Producer name ownership matters for stream dedup.
84. Hot partition can break super stream scaling.
85. Partition key is business architecture.
86. Testcontainers should be part of integration testing.
87. Unit test handlers without RabbitMQ.
88. Contract test message samples.
89. Test redelivery explicitly.
90. Test DLQ paths explicitly.
91. Test duplicate messages explicitly.
92. Test topology drift.
93. Runbook should exist before incident.
94. Purge is a destructive business operation.
95. Requeue can re-trigger side effects.
96. Replay can create new production effects.
97. Observability without owner is noise.
98. Topology without owner decays.
99. Messaging increases system complexity; use it for real decoupling, not fashion.
100. A mature RabbitMQ design is mostly about explicit failure semantics.

---

## 28. Final Architecture Patterns

### 28.1 Critical Command Queue Pattern

Use for:

- enforcement action request,
- case assignment,
- notification send command,
- rule evaluation request.

Topology:

```text
producer
  -> domain.commands.direct
  -> quorum queue per capability
  -> manual ack consumer
  -> retry/DLQ/parking lot
```

Properties:

- publisher confirm,
- mandatory publish,
- durable/persistent,
- manual ack,
- idempotent consumer,
- delayed retry,
- DLQ ownership.

---

### 28.2 Domain Event Fanout Pattern

Use for:

- case opened,
- evidence submitted,
- review assigned,
- enforcement action proposed.

Topology:

```text
producer
  -> domain.events.topic
  -> queue per consumer subscription
```

Properties:

- each consumer owns its queue,
- independent retry/DLQ,
- topic routing taxonomy,
- contract versioning.

---

### 28.3 Audit Stream Pattern

Use for:

- immutable domain history,
- compliance audit,
- replayable projections,
- forensic reconstruction.

Topology:

```text
domain event
  -> audit.events.stream
  -> replay consumers / projection consumers / forensic readers
```

Properties:

- stream retention,
- offset tracking,
- replay governance,
- side-effect isolation.

---

### 28.4 Outbox Relay Pattern

Use for:

- DB state change + message publish consistency.

Topology:

```text
service DB transaction
  -> outbox table
  -> relay
  -> RabbitMQ publish with confirm
```

Properties:

- stable message id,
- idempotent relay,
- outbox lag metric.

---

### 28.5 Inbox Consumer Pattern

Use for:

- duplicate-safe consumer.

Topology:

```text
RabbitMQ delivery
  -> consumer
  -> inbox/processed_messages table
  -> business transition
  -> ack
```

Properties:

- duplicate detection,
- transaction boundary,
- idempotency.

---

### 28.6 Queue + Stream Hybrid Pattern

Use when:

- event must trigger work,
- event must also be retained for audit/replay.

Topology:

```text
domain.events.topic
  -> work queue(s)
  -> audit stream
```

Properties:

- queue for work completion,
- stream for history,
- independent consumers.

---

## 29. RabbitMQ Design ADR Template

```markdown
# ADR: Use RabbitMQ for <capability>

## Status
Proposed / Accepted / Superseded

## Context
What problem are we solving?
Is the message a command, event, job, notification, reply, or audit record?
Why is synchronous HTTP/database polling insufficient?

## Decision
We will use RabbitMQ with:
- exchange:
- exchange type:
- routing keys:
- queue type:
- retry strategy:
- DLQ/parking lot:
- publisher reliability:
- consumer ack strategy:
- idempotency strategy:
- observability:

## Alternatives Considered
- HTTP/gRPC
- Kafka
- Database queue/outbox only
- Workflow engine
- Redis Streams

## Consequences
Positive:
- ...

Negative/trade-offs:
- ...

## Failure Model
- producer crash:
- broker failure:
- consumer crash:
- duplicate message:
- poison message:
- downstream outage:
- backlog growth:

## Operations
Dashboards:
Alerts:
Runbooks:
Owners:

## Security
Vhost:
Permissions:
TLS:
Payload sensitivity:
DLQ access:
```

---

## 30. Final Mini Case Review

Suppose you design this flow:

> Evidence is submitted for a regulatory case. A rule evaluation must run. Review team must be notified. The event must be auditable and replayable.

A mature RabbitMQ design:

```text
Evidence Service DB transaction
  -> save evidence
  -> insert outbox EvidenceSubmitted

Outbox Relay
  -> publish EvidenceSubmitted to case.events.topic
  -> confirm
  -> mark outbox sent

RabbitMQ routing
  -> rule-evaluator.commands.q or rule-evaluator.events.q
  -> review-notification.commands.q
  -> audit.events.stream

Rule Evaluator Consumer
  -> manual ack
  -> inbox idempotency
  -> transition rule evaluation state
  -> produce RuleEvaluationCompleted via outbox
  -> ack after commit

Notification Consumer
  -> manual ack
  -> external provider idempotency key
  -> retry transient failure
  -> DLQ/parking lot invalid recipient

Audit Stream
  -> retained
  -> replayable
  -> used for reconstruction
```

This design has:

- clear message semantics,
- transactional outbox,
- publisher confirms,
- explicit topology,
- work queues,
- audit stream,
- idempotent consumers,
- retry/DLQ,
- observability,
- replay ability,
- defensible operational behavior.

That is the level expected from top-tier RabbitMQ engineering.

---

## 31. What “Top 1% RabbitMQ Engineer” Means

It does not mean memorizing every CLI command.

It means you can:

1. Choose the correct primitive for the workload.
2. Explain delivery semantics precisely.
3. Design duplicate-safe producers and consumers.
4. Model failure before it happens.
5. Build topology that reflects domain boundaries.
6. Avoid retry storms and poison message loops.
7. Make RabbitMQ observable.
8. Operate RabbitMQ under pressure.
9. Secure broker access correctly.
10. Migrate legacy topology safely.
11. Use streams when replay/history is real requirement.
12. Say “RabbitMQ is wrong here” when another tool is better.

The best RabbitMQ engineers are not RabbitMQ maximalists. They are system designers who understand where RabbitMQ creates leverage and where it creates risk.

---

## 32. Recommended Personal Practice Plan

### Week 1: Core AMQP and Queue Work

- Build local Docker lab.
- Publish/consume with Java client.
- Implement manual ack consumer.
- Implement publisher confirms.
- Create direct/topic/fanout examples.
- Create DLQ topology.

### Week 2: Reliability

- Implement transactional outbox.
- Implement inbox/idempotent consumer.
- Simulate consumer crash before ack.
- Simulate producer crash after publish.
- Build delayed retry queues.
- Build parking lot workflow.

### Week 3: Spring Boot Production Shape

- Build Spring AMQP service.
- Configure listener factory.
- Configure confirm/return callbacks.
- Test with Testcontainers.
- Add metrics/logging/tracing.
- Add topology validation.

### Week 4: Streams and Operations

- Enable stream plugin.
- Publish/consume via Stream Java Client.
- Implement offset tracking.
- Run replay consumer.
- Test stream deduplication.
- Create super stream lab.
- Build Grafana dashboard.

### Week 5: Architecture Case Study

- Build regulatory case mini-platform.
- Use command queues, event exchange, audit stream.
- Implement outbox/inbox.
- Add DLQ and parking lot.
- Write ADR.
- Perform failure drill.

---

## 33. Interview / Review Questions

Use these to test mastery.

1. What exactly does publisher confirm guarantee?
2. What does consumer ack mean?
3. Why is auto ack dangerous?
4. What happens if consumer commits DB and crashes before ack?
5. How do you prevent duplicate business effects?
6. When should you use quorum queues?
7. When should you use streams?
8. Why is RabbitMQ cluster not ideal across WAN?
9. What is the difference between DLQ and retry queue?
10. Why is immediate requeue dangerous?
11. How do you design routing keys?
12. How do you detect slow consumers?
13. What is prefetch?
14. What is the relationship between ordering and competing consumers?
15. How do you safely replay stream messages?
16. How do you migrate classic queue to quorum queue?
17. How do you handle unroutable messages?
18. How do you observe publisher reliability?
19. How do you secure RabbitMQ per service?
20. When is Kafka better?
21. When is HTTP better?
22. When is a workflow engine better?
23. What is the outbox pattern?
24. What is the inbox pattern?
25. Why is queue depth alone insufficient?

---

## 34. Final Summary

RabbitMQ mastery is the ability to reason across five layers at once:

1. **Protocol layer**  
   AMQP, channel, exchange, queue, binding, routing key, ack, nack, confirm.

2. **Application layer**  
   Java publisher, consumer, handler, transaction, idempotency, contract.

3. **Topology layer**  
   exchange design, queue type, DLQ, retry, stream, super stream, vhost.

4. **Failure layer**  
   crash, duplicate, poison, backlog, retry storm, node failure, partition, replay hazard.

5. **Operational layer**  
   metrics, logs, tracing, dashboards, alerts, runbooks, security, migration.

If you can hold all five layers in your head, you can design RabbitMQ systems that survive real production conditions.

---

# Series Completion Status

This is the final part of the series.

Completed files:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-00.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-01.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-02.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-03.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-04.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-05.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-06.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-07.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-08.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-09.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-10.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-11.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-12.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-13.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-14.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-15.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-16.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-17.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-18.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-19.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-20.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-21.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-22.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-23.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-24.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-25.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-26.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-27.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-28.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-29.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-30.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-31.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-32.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-33.md
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-34.md
```

Seri selesai.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-33.md">⬅️ Part 33 — Production Runbook and Operational Playbook</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>

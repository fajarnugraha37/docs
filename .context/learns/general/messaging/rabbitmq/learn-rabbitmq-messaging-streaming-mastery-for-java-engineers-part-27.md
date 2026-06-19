# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-27.md

# Part 27 — Production Topology Design Patterns

> Seri: RabbitMQ, RabbitMQ Streams, dan Messaging Mastery untuk Java Engineers  
> Bagian: 27 dari 34  
> Fokus: menerjemahkan primitive RabbitMQ menjadi pola topologi produksi yang aman, evolvable, observable, dan defensible.

---

## 1. Tujuan Bagian Ini

Sampai titik ini kita sudah membahas banyak primitive:

- exchange
- queue
- binding
- routing key
- classic queue
- quorum queue
- stream
- super stream
- publisher confirm
- return listener
- acknowledgement
- redelivery
- prefetch
- DLX/DLQ
- retry
- parking lot
- outbox
- inbox/idempotency
- observability
- flow control
- clustering
- security
- performance

Bagian ini menyatukan semuanya menjadi **production topology patterns**.

Tujuannya bukan menghafal pattern, tetapi mampu menjawab pertanyaan arsitektural:

1. Primitive RabbitMQ apa yang cocok untuk masalah ini?
2. Topologi exchange/queue/stream seperti apa yang menjaga reliability?
3. Di mana retry harus terjadi?
4. Di mana idempotency harus diletakkan?
5. Bagaimana topologi ini diobservasi?
6. Bagaimana topologi ini berevolusi tanpa menghancurkan consumer lama?
7. Apa failure mode utama pattern ini?
8. Apa anti-pattern yang mirip tetapi berbahaya?

RabbitMQ topology yang baik biasanya tidak rumit. Yang rumit adalah memahami **konsekuensi semantics** dari tiap garis di diagram.

---

## 2. Core Mental Model: Topology Is an Operational Contract

Banyak engineer melihat topology RabbitMQ sebagai konfigurasi teknis:

```text
exchange -> queue -> consumer
```

Cara pikir yang lebih matang:

```text
producer intent
  -> routing responsibility
  -> workload isolation
  -> delivery semantics
  -> failure isolation
  -> retry semantics
  -> observability boundary
  -> operational ownership
```

Topology bukan hanya “message lewat mana”. Topology adalah kontrak tentang:

- siapa boleh publish
- siapa menerima
- apakah message bisa hilang
- apakah message bisa duplicate
- apakah message bisa replay
- apakah consumer lambat mengganggu consumer lain
- apakah poison message menghalangi seluruh workload
- apakah incident bisa direkonstruksi
- apakah perubahan schema/routing bisa dilakukan bertahap

Dalam sistem produksi, topology adalah bagian dari desain domain dan operasional.

---

## 3. Pattern Selection Axes

Sebelum memilih pattern, jawab beberapa axis berikut.

### 3.1 Command atau Event?

Command:

```text
Do this.
```

Contoh:

- `EvaluateCaseRiskCommand`
- `GenerateNoticeCommand`
- `AssignReviewerCommand`

Event:

```text
This happened.
```

Contoh:

- `CaseOpenedEvent`
- `EvidenceSubmittedEvent`
- `RiskScoreCalculatedEvent`

Command biasanya:

- punya intended handler
- perlu work queue
- failure harus ditangani eksplisit
- idempotency penting
- retry biasanya bermakna

Event biasanya:

- bisa punya banyak subscriber
- producer tidak tahu semua consumer
- fanout/topic routing cocok
- consumer lag tidak boleh menghambat consumer lain
- replay kadang diperlukan

### 3.2 Work atau History?

Work:

```text
Message harus diproses satu/lebih worker dan kemudian selesai.
```

History:

```text
Message adalah catatan kejadian yang mungkin dibaca ulang.
```

RabbitMQ queue cocok untuk work. RabbitMQ stream cocok untuk history/replay.

### 3.3 One Consumer Group atau Banyak Subscriber Independen?

Satu work pool:

```text
queue -> competing consumers
```

Banyak subscriber independen:

```text
exchange -> queue A -> service A consumers
         -> queue B -> service B consumers
         -> queue C -> service C consumers
```

Kesalahan umum: beberapa service consume dari queue yang sama padahal mereka butuh semua message. Itu bukan pub/sub; itu competing consumers.

### 3.4 Ordering Penting atau Parallelism Penting?

Kalau ordering global penting, parallelism turun.

Kalau parallelism tinggi, ordering harus didefinisikan lebih sempit:

- per case
- per account
- per tenant
- per aggregate
- per workflow instance

Topology produksi biasanya tidak menjanjikan global ordering kecuali benar-benar diperlukan.

### 3.5 Message Harus Bisa Replay?

Kalau ya, queue biasa bukan primitive utama.

Pilihan:

- tulis event ke database/audit table
- tulis event ke RabbitMQ Stream
- tulis ke event store lain
- bridge queue to stream

Queue destructive consumption tidak cocok untuk historical replay.

### 3.6 Latency, Throughput, atau Durability?

Tidak semua bisa dimaksimalkan bersamaan.

- latency rendah: batching kecil, queue pendek, consumer cepat
- throughput tinggi: batching, async confirms, parallelism
- durability tinggi: persistent messages, quorum queues, confirms, idempotency
- replay: streams, retention, offset tracking

Pattern harus eksplisit tentang prioritas.

---

## 4. Pattern 1 — Simple Work Queue

### 4.1 Intent

Mendistribusikan pekerjaan ke sekelompok worker, di mana setiap message diproses oleh tepat satu consumer instance secara logis.

Contoh:

- generate PDF
- calculate risk score
- process uploaded evidence
- send email notification
- enrich case data

### 4.2 Topology

```text
producer
  -> exchange: cmd.case.direct
  -> queue: q.risk-evaluator.commands
  -> consumers: risk-evaluator workers
```

Untuk command sederhana, direct exchange biasanya cukup.

```text
routing key: risk.evaluate
```

### 4.3 Recommended Queue Type

Gunakan quorum queue untuk workload penting.

```text
x-queue-type = quorum
```

Classic queue bisa dipakai untuk local/dev atau workload ephemeral yang kehilangan message dapat diterima, tetapi default produksi yang aman untuk command penting adalah quorum.

### 4.4 Reliability Requirements

Producer:

- durable exchange
- durable queue
- persistent message
- publisher confirm
- mandatory publish
- stable message id

Consumer:

- manual ack
- bounded prefetch
- idempotent handler
- DLQ
- retry policy

### 4.5 Example Naming

```text
exchange: ex.case.command.direct
queue:    q.risk-evaluator.evaluate-case.v1
routing:  case.risk.evaluate.v1
DLX:      ex.case.command.dlx
DLQ:      q.risk-evaluator.evaluate-case.dlq.v1
```

### 4.6 Java/Spring Sketch

```java
@Bean
DirectExchange caseCommandExchange() {
    return ExchangeBuilder
            .directExchange("ex.case.command.direct")
            .durable(true)
            .build();
}

@Bean
Queue riskEvaluatorQueue() {
    return QueueBuilder
            .durable("q.risk-evaluator.evaluate-case.v1")
            .quorum()
            .deadLetterExchange("ex.case.command.dlx")
            .deadLetterRoutingKey("risk.evaluate.failed.v1")
            .build();
}

@Bean
Binding riskEvaluatorBinding() {
    return BindingBuilder
            .bind(riskEvaluatorQueue())
            .to(caseCommandExchange())
            .with("case.risk.evaluate.v1");
}
```

### 4.7 Failure Modes

| Failure | Consequence | Mitigation |
|---|---|---|
| producer publishes without confirm | message may be lost silently | publisher confirms |
| no mandatory publish | unroutable command disappears from app perspective | mandatory + return handling |
| consumer auto ack | crash loses message | manual ack |
| immediate requeue on poison | retry storm | DLQ/parking lot |
| high prefetch + slow handler | large unacked backlog | tune prefetch |
| no idempotency | duplicate causes repeated side effect | inbox/idempotency table |

### 4.8 When Not to Use

Do not use simple work queue if:

- many services must independently receive every message
- replay is required
- ordering per aggregate is critical and worker pool breaks it
- task has long-running human lifecycle
- side effect is not idempotent and cannot be guarded

---

## 5. Pattern 2 — Pub/Sub Event Fanout

### 5.1 Intent

Producer announces that something happened, and multiple independent consumers react.

Contoh:

- case opened
- evidence submitted
- violation detected
- enforcement action approved

### 5.2 Topology

```text
producer
  -> exchange: ex.case.event.topic
       -> q.notification.case-events
       -> q.audit.case-events
       -> q.analytics.case-events
       -> q.escalation.case-events
```

Setiap service punya queue sendiri.

### 5.3 Why Each Subscriber Needs Its Own Queue

Kalau dua service consume dari queue yang sama:

```text
q.case-events -> service A
              -> service B
```

maka mereka bersaing. Service A bisa mengambil message yang seharusnya juga dilihat Service B.

Pub/sub yang benar:

```text
ex.case.event.topic
  -> q.service-a.case-events
  -> q.service-b.case-events
```

Setiap subscriber punya backlog, retry, DLQ, dan scaling sendiri.

### 5.4 Routing Key Design

Contoh taxonomy:

```text
domain.entity.event.version
```

```text
case.lifecycle.opened.v1
case.evidence.submitted.v1
case.risk.calculated.v1
case.enforcement.action-approved.v1
```

Binding:

```text
q.audit.case-events        <- case.#
q.notification.case-events <- case.lifecycle.*.v1
q.analytics.case-events    <- case.*.*.v1
q.risk.case-events         <- case.evidence.submitted.v1
```

### 5.5 Queue Type

Untuk event subscriber penting, gunakan quorum queue.

Untuk subscriber transient/low-value, classic queue dengan TTL/limit bisa masuk akal.

Untuk audit/replay, jangan hanya queue. Gunakan stream atau persistent audit store.

### 5.6 Failure Isolation

Keuntungan besar pattern ini:

- analytics lambat tidak menghambat notification
- audit DLQ tidak menghambat risk service
- setiap subscriber punya retry policy sendiri
- setiap service bisa deploy/scale sendiri

### 5.7 Anti-Pattern

```text
ex.case.event.topic -> q.shared.all-events -> all services
```

Ini bukan pub/sub. Ini hidden load-balancing antar service yang kemungkinan salah.

### 5.8 Design Checklist

Untuk setiap subscriber event, tentukan:

- apakah subscriber wajib menerima semua event?
- apakah boleh skip event lama?
- apakah butuh retry?
- apakah butuh DLQ?
- apakah butuh replay?
- apakah queue backlog subscriber boleh tumbuh tanpa batas?
- siapa owner queue?
- apa schema version yang dikonsumsi?

---

## 6. Pattern 3 — Topic Event Bus per Bounded Context

### 6.1 Intent

Membuat event exchange yang melayani satu bounded context atau domain, bukan seluruh perusahaan.

Contoh:

```text
ex.case.event.topic
ex.payment.event.topic
ex.identity.event.topic
ex.notification.event.topic
```

### 6.2 Why Not One Global Event Exchange?

Satu exchange global seperti:

```text
ex.events
```

terlihat sederhana, tetapi sering menyebabkan:

- routing key taxonomy kacau
- ownership tidak jelas
- permission terlalu lebar
- subscriber sulit menemukan event relevan
- observability noisy
- perubahan domain mengganggu semua service

Lebih baik exchange per bounded context.

### 6.3 Recommended Topology

```text
case-service
  -> ex.case.event.topic
       -> q.audit.case
       -> q.risk.case
       -> q.notification.case
       -> q.reporting.case
```

Lalu untuk cross-context integration:

```text
ex.case.event.topic
  -> q.payment.case-integration

payment-service consumes q.payment.case-integration
  -> ex.payment.command.direct
```

Jangan membuat semua domain saling bind langsung tanpa ownership.

### 6.4 Integration Boundary Queue

Untuk consumer lintas bounded context, gunakan queue eksplisit:

```text
q.<consumer-context>.<source-context>-events.<purpose>.v1
```

Contoh:

```text
q.risk.case-events.evidence-intake.v1
q.notification.case-events.public-notice.v1
q.reporting.case-events.case-timeline.v1
```

Nama queue harus menjawab:

- siapa owner consumer?
- source event dari mana?
- purpose apa?
- versi contract apa?

---

## 7. Pattern 4 — Command Queue per Capability

### 7.1 Intent

Mengirim command ke capability tertentu secara eksplisit.

Contoh command:

- `EvaluateRisk`
- `GenerateNotice`
- `AssignReviewer`
- `ArchiveCase`
- `RequestEvidenceValidation`

### 7.2 Topology

```text
ex.enforcement.command.direct
  -> q.risk.evaluate-case.v1
  -> q.notice.generate-notice.v1
  -> q.assignment.assign-reviewer.v1
```

Routing key:

```text
risk.evaluate-case.v1
notice.generate-notice.v1
assignment.assign-reviewer.v1
```

### 7.3 Command Should Have One Logical Owner

Sebuah command bukan event umum. Command punya intended capability.

Kalau command dikonsumsi banyak service secara independen, kemungkinan sebenarnya itu event.

### 7.4 Command Contract

Minimal metadata:

```json
{
  "messageId": "msg-...",
  "messageType": "EvaluateCaseRiskCommand",
  "schemaVersion": 1,
  "correlationId": "corr-...",
  "causationId": "msg-previous",
  "idempotencyKey": "case-123:risk-evaluation:rule-v7",
  "requestedAt": "2026-06-19T09:30:00Z",
  "requestedBy": "system:case-service",
  "payload": {
    "caseId": "case-123",
    "ruleSetVersion": "risk-rules-2026.06"
  }
}
```

### 7.5 Handler State Machine

Command handler idealnya bukan:

```text
consume -> do stuff -> ack
```

Tetapi:

```text
consume
  -> validate contract
  -> check idempotency
  -> lock/load aggregate
  -> verify command is still applicable
  -> perform transition/effect
  -> persist outcome
  -> publish resulting event via outbox
  -> commit
  -> ack
```

### 7.6 Failure Boundary

Jika handler gagal sebelum commit:

- nack/retry aman jika idempotency ada

Jika handler gagal setelah commit sebelum ack:

- duplicate delivery mungkin terjadi
- idempotency harus mendeteksi sudah diproses

Jika handler gagal publish resulting event:

- outbox relay harus publish ulang

---

## 8. Pattern 5 — Audit Tap

### 8.1 Intent

Menyimpan semua event penting ke audit trail tanpa mengganggu consumer bisnis.

### 8.2 Topology

```text
ex.case.event.topic
  -> q.audit.case-events.v1
  -> q.notification.case-events.v1
  -> q.risk.case-events.v1
```

Audit queue consume dan tulis ke audit store.

### 8.3 Better: Event Exchange + Stream Audit

Untuk replay/audit historis, gunakan stream:

```text
producer
  -> ex.case.event.topic
       -> q.business-consumer-a
       -> q.business-consumer-b
       -> stream.case.audit.v1
```

Ada dua cara:

1. producer publish ke exchange dan audit bridge menulis ke stream
2. producer/outbox relay menulis ke queue topology dan stream topology secara terkendali

### 8.4 Audit Invariants

Audit pattern harus menjawab:

- event apa yang wajib tersimpan?
- apakah audit write bagian dari transaction boundary?
- bagaimana mendeteksi gap?
- apakah event audit immutable?
- bagaimana masking/encryption data sensitif?
- retention berapa lama?
- siapa boleh replay?

### 8.5 Failure Mode

Kalau audit consumer mati:

- audit queue backlog naik
- business consumer tetap jalan
- tetapi compliance risk meningkat

Maka alert audit backlog biasanya lebih penting daripada backlog analytics.

---

## 9. Pattern 6 — Retry + DLQ + Parking Lot

### 9.1 Intent

Menghindari infinite retry loop dan menjaga poison message tidak memblokir workload sehat.

### 9.2 Basic Topology

```text
ex.case.command.direct
  -> q.notice.generate.v1
       DLX -> ex.case.command.dlx
              -> q.notice.generate.dlq.v1
```

### 9.3 Delayed Retry Topology

```text
q.notice.generate.v1
  -- failure transient --> ex.retry.direct
       -> q.notice.generate.retry.30s.v1
          TTL 30s + DLX back to ex.case.command.direct
```

Multi-level:

```text
q.main
  -> q.retry.10s
  -> q.retry.1m
  -> q.retry.10m
  -> q.parking-lot
```

### 9.4 Parking Lot

Parking lot bukan DLQ biasa.

DLQ adalah tempat message gagal secara teknis.

Parking lot adalah tempat message yang butuh human/system remediation.

Contoh:

```text
q.notice.generate.parking-lot.v1
```

Metadata tambahan:

- failure class
- failure reason
- retry attempts
- first failed at
- last failed at
- handler version
- remediation status

### 9.5 Retry Decision Table

| Failure | Action |
|---|---|
| database transient timeout | delayed retry |
| downstream HTTP 503 | delayed retry + circuit breaker |
| validation schema invalid | DLQ/parking lot |
| business invariant violated | parking lot or terminal failure event |
| duplicate command | ack as already processed |
| unauthorized side effect | DLQ/security alert |
| unknown exception | bounded retry then parking lot |

### 9.6 Rule

Never use unbounded `nack(requeue=true)` as retry strategy.

That is not retry. That is a loop.

---

## 10. Pattern 7 — Outbox Relay

### 10.1 Intent

Mengatasi dual-write problem antara database transaction dan message publish.

Problem:

```text
DB commit succeeds
message publish fails
```

atau:

```text
message publish succeeds
DB commit fails
```

### 10.2 Topology

```text
application transaction
  -> business table
  -> outbox table

outbox relay
  -> RabbitMQ exchange
```

### 10.3 Outbox Table Example

```sql
CREATE TABLE outbox_message (
    id                VARCHAR(64) PRIMARY KEY,
    aggregate_type    VARCHAR(100) NOT NULL,
    aggregate_id      VARCHAR(100) NOT NULL,
    message_type      VARCHAR(200) NOT NULL,
    schema_version    INT NOT NULL,
    routing_key       VARCHAR(255) NOT NULL,
    payload_json      TEXT NOT NULL,
    headers_json      TEXT NOT NULL,
    status            VARCHAR(30) NOT NULL,
    attempts          INT NOT NULL DEFAULT 0,
    next_attempt_at   TIMESTAMP NULL,
    created_at        TIMESTAMP NOT NULL,
    published_at      TIMESTAMP NULL
);
```

### 10.4 Relay State Machine

```text
NEW
  -> PUBLISHING
  -> PUBLISHED
  -> FAILED_RETRYABLE
  -> FAILED_TERMINAL
```

But be careful: `PUBLISHING` can be left behind if relay crashes.

Alternative:

```text
select NEW/FAILED_RETRYABLE due rows
publish with confirms
only mark PUBLISHED after confirm
```

### 10.5 Publisher Confirm Required

Outbox relay without publisher confirm is incomplete.

The relay must know broker accepted the message.

### 10.6 Duplicate Publish Still Possible

If relay publishes, broker confirms, then relay crashes before marking row as published:

```text
message is in RabbitMQ
outbox row still not marked published
relay publishes again later
```

Therefore consumers must be idempotent.

### 10.7 Routing Responsibility

Outbox rows should store:

- exchange
- routing key
- message type
- schema version
- message id
- correlation id
- causation id

Do not recompute routing from mutable business state later unless intentionally designed.

---

## 11. Pattern 8 — Inbox / Idempotent Consumer

### 11.1 Intent

Make duplicate delivery safe.

RabbitMQ at-least-once delivery means duplicate processing is possible.

### 11.2 Inbox Table Example

```sql
CREATE TABLE inbox_message (
    message_id      VARCHAR(64) PRIMARY KEY,
    consumer_name   VARCHAR(150) NOT NULL,
    received_at     TIMESTAMP NOT NULL,
    processed_at    TIMESTAMP NULL,
    status          VARCHAR(30) NOT NULL,
    error_code      VARCHAR(100) NULL
);
```

Better key:

```text
consumer_name + idempotency_key
```

because the same message may be consumed by multiple services.

### 11.3 Handler Flow

```text
consume message
  -> begin transaction
  -> insert inbox record / detect duplicate
  -> if duplicate and already processed: commit + ack
  -> apply business effect
  -> mark inbox processed
  -> commit
  -> ack
```

### 11.4 Idempotency Scope

Idempotency is not always message id.

Examples:

```text
case-123:evidence-456:validate
case-123:risk-evaluation:risk-rules-2026.06
notice-789:send:email
```

Business idempotency key is often better.

### 11.5 Failure Window

If DB commit succeeds but ack fails, broker redelivers.

Inbox detects duplicate and ack safely.

This is the core protection.

---

## 12. Pattern 9 — Event Notification Pattern

### 12.1 Intent

Notify other services something changed without sending full internal state.

Example:

```json
{
  "messageType": "CaseStatusChangedEvent",
  "payload": {
    "caseId": "case-123",
    "oldStatus": "UNDER_REVIEW",
    "newStatus": "ACTION_PROPOSED"
  }
}
```

Consumer fetches details if needed.

### 12.2 When It Works

Good when:

- producer does not want to expose full model
- consumers can query source of truth
- eventual consistency is acceptable
- payload minimization matters

### 12.3 Risks

- consumer causes read spike to source service
- event replay may fetch current state, not historical state
- source service availability affects consumer processing
- historical reconstruction becomes harder

### 12.4 Mitigation

- include enough facts for common consumers
- include version number
- include occurredAt
- include state transition reason
- expose read model endpoint if necessary
- for audit, store full audit event separately

---

## 13. Pattern 10 — Event-Carried State Transfer

### 13.1 Intent

Event includes enough data for consumers to update their own read model without calling producer.

Example:

```json
{
  "messageType": "EvidenceSubmittedEvent",
  "payload": {
    "caseId": "case-123",
    "evidenceId": "ev-456",
    "evidenceType": "BANK_STATEMENT",
    "submittedBy": "party:abc",
    "submittedAt": "2026-06-19T10:15:00Z",
    "classification": "CONFIDENTIAL"
  }
}
```

### 13.2 Pros

- consumers independent
- replay more meaningful
- less synchronous coupling
- easier analytics/read model update

### 13.3 Cons

- payload can grow
- schema evolution more complex
- sensitive data exposure risk
- producer may leak internal model

### 13.4 Rule

Event-carried state transfer should carry **stable domain facts**, not internal database shape.

---

## 14. Pattern 11 — Hybrid Queue + Stream

### 14.1 Intent

Use queue for work distribution and stream for audit/replay/history.

### 14.2 Topology

```text
case-service outbox relay
  -> ex.case.event.topic
       -> q.risk.case-events.v1
       -> q.notification.case-events.v1
       -> q.reporting.case-events.v1
  -> stream.case.audit.v1
```

Alternative bridge:

```text
ex.case.event.topic
  -> q.audit-bridge.case-events.v1
       -> audit bridge consumer
            -> stream.case.audit.v1
```

### 14.3 Why Hybrid Is Useful

Queue:

- work assignment
- destructive consumption
- retry/DLQ
- competing consumers

Stream:

- immutable history
- replay
- independent historical consumers
- audit timeline

### 14.4 Failure Consideration

If producer writes queue but not stream, audit gap.

If producer writes stream but not queue, business consumer misses work.

This is why outbox relay design matters.

Option:

- one outbox row per target
- separate relay states
- detect mismatch
- audit reconciliation job

### 14.5 Defensible Design

For regulated systems, define:

```text
system of record for message history = stream/audit store
system of work distribution = queues
```

Do not pretend work queue is an audit log.

---

## 15. Pattern 12 — Priority Queue

### 15.1 Intent

Process more urgent messages earlier.

Example:

- urgent enforcement action
- safety-critical alert
- fraud escalation

### 15.2 Risk

Priority queues are often misused.

Problems:

- lower-priority messages can starve
- ordering becomes weaker
- high priority flood can break fairness
- priority adds broker overhead

### 15.3 Better Alternative Sometimes

Use separate queues:

```text
q.review.high-priority.v1
q.review.normal-priority.v1
q.review.low-priority.v1
```

Consumers allocate capacity explicitly:

```text
high priority: 5 workers
normal:        10 workers
low:           2 workers
```

This is more observable and controllable.

### 15.4 Use Priority Queue Only When

- priority levels are few
- starvation policy is defined
- ordering is not strict
- workload is bounded
- metrics are monitored

---

## 16. Pattern 13 — Delayed Job Pattern

### 16.1 Intent

Execute work later.

Examples:

- send reminder after 3 days
- escalate case if no response by deadline
- retry after cooldown

### 16.2 Options

RabbitMQ patterns:

1. TTL queue + DLX
2. delayed message exchange plugin
3. application scheduler table + publisher
4. workflow engine/timer service

### 16.3 TTL Queue Pattern

```text
producer
  -> q.delay.5m
       TTL 5m
       DLX -> ex.command.direct
```

### 16.4 Problem with Per-Message Delay on Single Queue

Queue-level TTL is simple. Per-message TTL can have head-of-line surprises depending on queue behavior and ordering.

For complex business deadlines, a database-backed scheduler is often more explicit.

### 16.5 Deadline Pattern for Regulatory Workflow

Better:

```text
case_deadline table
  -> scheduler scans due deadlines
  -> publishes EscalateCaseCommand
  -> command queue handles escalation
```

Why better:

- queryable deadlines
- cancel/reschedule possible
- auditability clearer
- no hidden timer in broker

Use RabbitMQ for delivery, not as the only source of truth for business deadlines.

---

## 17. Pattern 14 — Routing Slip / Process Manager Command Fanout

### 17.1 Intent

A coordinator decides next steps and publishes commands to different queues.

Example:

```text
CaseOpenedEvent
  -> process manager
      -> EvaluateRiskCommand
      -> AssignInitialReviewerCommand
      -> GenerateCaseTimelineCommand
```

### 17.2 Topology

```text
ex.case.event.topic
  -> q.workflow.case-opened.v1
       workflow-orchestrator
          -> ex.case.command.direct
               -> q.risk.evaluate.v1
               -> q.assignment.assign.v1
               -> q.timeline.generate.v1
```

### 17.3 State Store Required

Do not keep orchestration state only in broker.

Store:

- workflow id
- current state
- commands issued
- events observed
- deadlines
- compensation state
- correlation id

### 17.4 Failure Handling

If orchestrator crashes after issuing one command but before issuing another:

- state store/outbox must allow recovery
- commands need idempotency

---

## 18. Pattern 15 — Queue per Tenant / Region / Segment

### 18.1 Intent

Isolate workload by tenant, region, customer segment, or regulatory boundary.

```text
q.case-processing.tenant-a.v1
q.case-processing.tenant-b.v1
q.case-processing.tenant-c.v1
```

### 18.2 Benefits

- noisy tenant isolation
- independent scaling
- separate retention/limits
- clearer operational triage
- data residency boundary

### 18.3 Costs

- queue explosion
- topology management complexity
- monitoring cardinality
- permission complexity
- migration difficulty

### 18.4 Alternative

Use routing key by tenant but fewer queues:

```text
case.tenant-a.evidence.submitted.v1
case.tenant-b.evidence.submitted.v1
```

Or partition by segment:

```text
q.case-processing.high-volume-tenants.v1
q.case-processing.normal-tenants.v1
```

### 18.5 Decision Rule

Create queue per tenant only if operational isolation is worth the cost.

For thousands of tenants, avoid queue-per-tenant unless lifecycle automation is mature.

---

## 19. Pattern 16 — Workload Segregation by Criticality

### 19.1 Intent

Separate critical and non-critical work so overload in one does not damage the other.

Bad:

```text
q.all-case-work
  - send notification
  - run analytics
  - calculate risk
  - generate audit
```

Good:

```text
q.case-risk-evaluation.critical.v1
q.case-notification.normal.v1
q.case-analytics.low.v1
q.case-audit.critical.v1
```

### 19.2 Why It Matters

Different workloads have different:

- SLA
- retry policy
- DLQ severity
- consumer concurrency
- scaling strategy
- data sensitivity
- failure response

One queue for all workloads hides those differences.

### 19.3 Operational Benefit

During incident you can:

- pause analytics
- keep audit running
- allocate more consumers to risk evaluation
- drain notification later
- alert only on critical queues

---

## 20. Pattern 17 — Alternate Exchange for Unroutable Events

### 20.1 Intent

Capture messages that could not be routed because no binding matched.

### 20.2 Topology

```text
ex.case.event.topic
  alternate-exchange -> ex.case.event.unroutable.fanout
                          -> q.case.event.unroutable.v1
```

### 20.3 Use Cases

- detect routing key typo
- detect missing subscriber topology
- detect deployment drift
- detect producer publishing unsupported event type

### 20.4 Do Not Abuse

Alternate exchange should not become normal route.

If many messages go there, routing taxonomy is broken.

### 20.5 Observability

Alert on:

```text
q.case.event.unroutable.v1 ready > 0
```

For command exchange, unroutable command is usually serious.

---

## 21. Pattern 18 — Dead Letter Event Stream

### 21.1 Intent

Centralize failure facts without centralizing failed message ownership.

Each queue has own DLQ. But a failure event can be published to a central failure stream.

```text
consumer fails terminally
  -> original message to DLQ
  -> FailureRecordedEvent to ex.platform.failure.topic
       -> stream.platform.failure.v1
```

### 21.2 Why Useful

- cross-system incident analysis
- trend detection
- SLA reporting
- regulatory audit
- poison message pattern detection

### 21.3 Payload Example

```json
{
  "messageType": "MessageProcessingFailedEvent",
  "schemaVersion": 1,
  "payload": {
    "sourceQueue": "q.notice.generate.v1",
    "originalMessageId": "msg-123",
    "originalMessageType": "GenerateNoticeCommand",
    "failureClass": "VALIDATION_ERROR",
    "failureReasonCode": "MISSING_TEMPLATE",
    "attempts": 5,
    "terminal": true
  }
}
```

### 21.4 Important Boundary

Do not move all failed messages into one shared DLQ unless ownership is clear.

Central failure stream is for visibility, not necessarily remediation.

---

## 22. Pattern 19 — Consumer-Specific Queue Versioning

### 22.1 Intent

Evolve consumer topology without breaking current production consumers.

Example:

```text
q.risk.case-events.v1
q.risk.case-events.v2
```

Both may bind to same exchange temporarily.

### 22.2 Migration Flow

```text
1. create q.risk.case-events.v2
2. deploy v2 consumer consuming v2 queue
3. bind v2 queue to new/old routing keys
4. compare outputs shadow mode
5. switch traffic/disable v1 binding
6. drain v1 queue
7. remove v1 queue
```

### 22.3 Why Queue Versioning Helps

- no destructive migration
- rollback easier
- shadow processing possible
- contract compatibility testing easier

### 22.4 Cost

- duplicate processing during migration
- more queue monitoring
- more topology definitions

Use intentionally.

---

## 23. Pattern 20 — Shadow Consumer

### 23.1 Intent

Run a new consumer implementation against production-like messages without producing side effects.

```text
ex.case.event.topic
  -> q.risk.case-events.v1        -> current consumer
  -> q.risk.case-events.shadow.v2 -> shadow consumer
```

### 23.2 Use Cases

- new rule engine
- migration to new schema
- performance comparison
- validation of idempotency logic
- replay testing

### 23.3 Side Effect Control

Shadow consumer must not:

- send real notifications
- mutate production business state
- call external irreversible APIs

It can:

- write to shadow tables
- emit metrics
- compare decisions
- log differences

### 23.4 Exit Criteria

Define before running:

- mismatch threshold
- latency target
- error rate target
- completeness target
- data retention policy

---

## 24. Pattern 21 — Bridge Pattern: Queue to Stream

### 24.1 Intent

Move selected queue-delivered messages into stream for replay/history.

```text
ex.case.event.topic
  -> q.audit-bridge.case-events.v1
       -> bridge consumer
            -> stream.case.audit.v1
```

### 24.2 Reliability Challenge

The bridge consumes from queue and publishes to stream.

Failure windows:

```text
consume queue message
publish to stream succeeds
ack queue fails
```

Duplicate stream publish possible.

Mitigation:

- stream deduplication
- stable message id / publishing id
- idempotent stream append semantics where possible
- bridge state table

### 24.3 Bridge State

```sql
CREATE TABLE queue_to_stream_bridge_state (
    source_message_id VARCHAR(64) PRIMARY KEY,
    stream_name       VARCHAR(200) NOT NULL,
    publish_status    VARCHAR(30) NOT NULL,
    published_at      TIMESTAMP NULL
);
```

### 24.4 When to Avoid

Avoid bridge if producer can write to outbox and stream directly with stronger consistency controls.

Bridge is useful for legacy integration.

---

## 25. Pattern 22 — Stream to Queue Replay

### 25.1 Intent

Replay historical stream messages into work queues for reprocessing.

```text
stream.case.audit.v1
  -> replay tool/consumer
       -> ex.case.command.direct
            -> q.projection-rebuild.v1
```

### 25.2 Use Cases

- rebuild projection
- recompute risk score
- resend derived notification in safe mode
- backfill analytics

### 25.3 Safety Rules

Replay must have:

- explicit replay id
- dry-run option
- side-effect mode control
- rate limit
- idempotency key
- target queue isolation
- audit record

Never replay directly into the same live command queue without understanding consequences.

### 25.4 Replay Message Envelope

Add replay metadata:

```json
{
  "replay": {
    "isReplay": true,
    "replayId": "replay-2026-06-risk-rules-v8",
    "sourceStream": "stream.case.audit.v1",
    "sourceOffset": 928372,
    "requestedBy": "platform-ops",
    "reason": "risk projection rebuild"
  }
}
```

Consumers must know whether replay side effects are allowed.

---

## 26. Pattern 23 — Platform-Level Event Ingress

### 26.1 Intent

Provide one controlled ingress for external systems before routing into internal topology.

```text
external system
  -> ingress service
       -> validation
       -> authn/authz
       -> normalization
       -> outbox
       -> RabbitMQ internal exchange
```

### 26.2 Why Not Let External Systems Publish Directly?

Direct broker access from external systems creates:

- permission risk
- schema chaos
- routing chaos
- difficult audit
- unclear ownership
- weak validation

### 26.3 Ingress Responsibilities

- authenticate source
- validate contract
- normalize schema
- assign message id/correlation id
- enforce rate limits
- mask sensitive data
- persist ingress audit
- publish with confirms

RabbitMQ should not be the only validation boundary.

---

## 27. Pattern 24 — Bulkhead by Exchange/VHost

### 27.1 Intent

Prevent one domain/workload from overwhelming others.

Levels:

1. separate queue
2. separate exchange
3. separate vhost
4. separate cluster

### 27.2 Example

```text
vhost: /case-core
vhost: /case-analytics
vhost: /external-ingress
vhost: /sandbox
```

### 27.3 Trade-off

More isolation means more operational cost.

Use stronger isolation for:

- untrusted publishers
- noisy workloads
- sensitive data
- regulatory boundaries
- high criticality paths

---

## 28. Pattern Decision Matrix

| Problem | Recommended Pattern | Primitive |
|---|---|---|
| distribute one job to one worker | Simple Work Queue | direct exchange + quorum queue |
| notify many services | Pub/Sub Event Fanout | topic exchange + per-subscriber queues |
| preserve event history | Audit Stream | RabbitMQ Stream |
| support replay/rebuild | Stream + replay consumer | stream offsets |
| safe DB + publish | Outbox Relay | DB outbox + publisher confirms |
| duplicate-safe consumer | Inbox | DB unique key + manual ack |
| transient downstream failure | Delayed Retry | TTL retry queue / delayed exchange |
| permanent message failure | Parking Lot | DLQ + remediation workflow |
| cross-region transfer | Shovel/Federation/Application Relay | bridge topology |
| high parallel ordered stream | Super Stream | partitioned streams |
| route by event taxonomy | Topic Bus | topic exchange |
| command to one capability | Command Queue | direct exchange |
| unknown routing detection | Alternate Exchange | AE + unroutable queue |
| migration to new consumer | Queue Versioning/Shadow Consumer | new queue binding |
| long business deadline | Scheduler + Command | DB timer + RabbitMQ command |
| noisy tenant isolation | Queue/VHost per segment | routing/bulkhead |

---

## 29. Topology Naming Convention

Good naming convention makes operations easier.

### 29.1 Exchanges

```text
ex.<bounded-context>.<message-kind>.<exchange-type>
```

Examples:

```text
ex.case.event.topic
ex.case.command.direct
ex.notice.command.direct
ex.platform.failure.topic
```

### 29.2 Queues

```text
q.<owner-service>.<source-or-capability>.<purpose>.v<version>
```

Examples:

```text
q.risk.case-events.evidence-intake.v1
q.notice.generate-notice.commands.v1
q.audit.case-events.writer.v1
q.reporting.case-events.timeline.v2
```

### 29.3 DLQ

```text
q.<owner>.<purpose>.dlq.v<version>
```

Example:

```text
q.notice.generate-notice.dlq.v1
```

### 29.4 Retry Queue

```text
q.<owner>.<purpose>.retry.<delay>.v<version>
```

Example:

```text
q.notice.generate-notice.retry.30s.v1
q.notice.generate-notice.retry.5m.v1
```

### 29.5 Streams

```text
stream.<bounded-context>.<purpose>.v<version>
```

Examples:

```text
stream.case.audit.v1
stream.platform.failure.v1
stream.notice.delivery-events.v1
```

---

## 30. Topology Ownership Rules

### 30.1 Producer Owns Exchange Contract

The producer/domain owner owns:

- event type
- command type if command exchange is domain-owned
- routing key taxonomy
- message schema
- compatibility policy

### 30.2 Consumer Owns Its Queue

Consumer owns:

- queue name
- binding interest
- retry policy
- DLQ handling
- prefetch/concurrency
- idempotency store
- alert thresholds

### 30.3 Platform Owns Guardrails

Platform owns:

- vhost policy
- queue type policies
- retention/limits
- permission model
- monitoring baseline
- naming convention
- cluster capacity

### 30.4 Avoid Producer-Created Consumer Queues Without Agreement

A producer should not casually create queues for consumers it does not own.

That creates ownership confusion.

---

## 31. Production Topology Review Template

For every topology proposal, review these sections.

### 31.1 Intent

```text
What business/technical problem does this topology solve?
```

### 31.2 Message Classification

```text
Command, event, job, notification, reply, audit record?
```

### 31.3 Routing

```text
Exchange:
Type:
Routing key:
Bindings:
Alternate exchange:
```

### 31.4 Queue/Stream Semantics

```text
Queue type:
Durability:
Replication:
Retention:
Ordering assumptions:
Replay requirement:
```

### 31.5 Reliability

```text
Publisher confirms:
Mandatory publish:
Manual ack:
Prefetch:
Retry:
DLQ:
Parking lot:
Idempotency:
```

### 31.6 Failure Model

```text
Producer crash:
Broker crash:
Consumer crash:
Network partition:
Poison message:
Slow consumer:
Downstream outage:
Duplicate delivery:
Unroutable publish:
```

### 31.7 Operations

```text
Owner:
Dashboard:
Alerts:
Runbook:
Safe purge policy:
Replay policy:
Backlog threshold:
DLQ threshold:
```

### 31.8 Security

```text
Vhost:
User/service account:
Permissions:
Sensitive fields:
Retention policy:
Who can replay/read DLQ:
```

---

## 32. End-to-End Example: Enforcement Case Messaging Topology

### 32.1 Domain Flow

```text
CaseOpenedEvent
  -> risk evaluation
  -> reviewer assignment
  -> notification
  -> audit timeline
```

### 32.2 Topology

```text
ex.case.event.topic
  binding case.lifecycle.opened.v1
    -> q.risk.case-opened.v1
    -> q.assignment.case-opened.v1
    -> q.notification.case-opened.v1
    -> q.audit.case-events.v1

ex.case.command.direct
  routing risk.evaluate.v1
    -> q.risk.evaluate-case.v1
  routing assignment.assign-reviewer.v1
    -> q.assignment.assign-reviewer.v1
  routing notice.generate.v1
    -> q.notice.generate.v1

stream.case.audit.v1
  <- audit bridge / outbox relay
```

### 32.3 Retry/DLQ

```text
q.risk.evaluate-case.v1
  -> q.risk.evaluate-case.retry.30s.v1
  -> q.risk.evaluate-case.retry.5m.v1
  -> q.risk.evaluate-case.parking-lot.v1
```

### 32.4 Why This Is Defensible

- events and commands separated
- each service owns its queue
- command processing uses quorum queues
- audit has stream/history path
- slow notification does not block risk evaluation
- poison message is isolated
- duplicate command safe via idempotency
- workflow can be reconstructed via correlation/causation/audit stream
- operations can alert per workload

---

## 33. Common Anti-Patterns

### 33.1 One Queue for Everything

```text
q.all-messages
```

Problems:

- no workload isolation
- impossible retry policy
- hidden ordering assumptions
- noisy consumer affects critical consumer
- DLQ meaningless

### 33.2 One Exchange for the Entire Company

```text
ex.events
```

Problems:

- unclear ownership
- routing taxonomy chaos
- security too broad
- operational noise

### 33.3 Multiple Services Compete on Same Event Queue

```text
q.case-events -> risk-service
              -> notification-service
```

This loses pub/sub semantics.

### 33.4 Queue as Database

Using queue backlog as source of truth is dangerous.

A queue is for delivery/work, not durable queryable business history.

### 33.5 DLQ as Graveyard

If nobody owns DLQ, it is not a failure strategy.

### 33.6 Retry Without Classification

Retrying validation errors wastes capacity and hides bad contracts.

### 33.7 No Idempotency Because “RabbitMQ Won’t Duplicate”

RabbitMQ can redeliver. Your consumer can crash after commit before ack. Duplicate is real.

### 33.8 Publish Without Confirm

Durable queue and persistent message are not enough if publisher never verifies broker acceptance.

### 33.9 Routing Key as Internal Class Name

Bad:

```text
com.company.case.internal.CaseEntityUpdated
```

Better:

```text
case.lifecycle.status-changed.v1
```

### 33.10 Stream Used as Work Queue Without Understanding Offset

Stream consumption is not queue ack semantics. Offset is progress, not deletion.

---

## 34. Practical Heuristics

1. Use direct exchange for commands.
2. Use topic exchange for domain events.
3. Use one queue per subscriber service for pub/sub.
4. Use quorum queue for important command/work queues.
5. Use stream for history/replay/audit.
6. Use outbox for DB + publish consistency.
7. Use inbox/idempotency for duplicate-safe consumers.
8. Use DLQ for terminal technical failure.
9. Use parking lot for remediation workflows.
10. Use delayed retry, not immediate requeue loops.
11. Use alternate exchange for unroutable detection.
12. Prefer bounded context exchange over global event exchange.
13. Separate critical and non-critical workloads.
14. Do not use queue backlog as business state.
15. Do not let consumer failures block unrelated consumers.
16. Do not create queue per tenant unless isolation justifies operational cost.
17. Keep routing keys stable and domain-oriented.
18. Version contracts, not every implementation detail.
19. Monitor oldest message age, not just queue depth.
20. Every queue needs an owner.

---

## 35. Mini Lab

### Lab 1 — Build a Command Queue Topology

Create:

```text
ex.case.command.direct
q.risk.evaluate-case.v1
q.risk.evaluate-case.dlq.v1
```

Add:

- quorum queue
- DLX
- routing key
- mandatory publish test

Verify:

- valid command routes
- invalid routing key is returned/unroutable
- failed message goes to DLQ

### Lab 2 — Build Pub/Sub Event Topology

Create:

```text
ex.case.event.topic
q.audit.case-events.v1
q.notification.case-events.v1
q.analytics.case-events.v1
```

Bindings:

```text
q.audit.case-events.v1        <- case.#
q.notification.case-events.v1 <- case.lifecycle.*.v1
q.analytics.case-events.v1    <- case.*.*.v1
```

Publish:

```text
case.lifecycle.opened.v1
case.evidence.submitted.v1
case.risk.calculated.v1
```

Observe which queue receives which event.

### Lab 3 — Queue Versioning

Create:

```text
q.reporting.case-events.v1
q.reporting.case-events.v2
```

Bind both to same event.

Run two consumers:

- v1 normal consumer
- v2 shadow consumer

Compare outputs without side effects.

### Lab 4 — Hybrid Queue + Stream

Create:

```text
ex.case.event.topic
q.audit-bridge.case-events.v1
stream.case.audit.v1
```

Bridge from queue to stream with stable message id.

Simulate bridge crash and verify duplicate handling strategy.

---

## 36. Self-Assessment Questions

1. Why does each pub/sub subscriber need its own queue?
2. When is direct exchange better than topic exchange?
3. Why is a DLQ not enough as remediation strategy?
4. What failure window does outbox solve?
5. What failure window remains after outbox?
6. Why does consumer idempotency remain necessary with publisher confirms?
7. When should you choose stream instead of queue?
8. Why is queue-per-tenant dangerous at scale?
9. What does alternate exchange protect against?
10. Why is immediate requeue usually a bad retry strategy?
11. How do you migrate a consumer without losing messages?
12. How do you prevent replay from triggering real side effects?
13. What topology would you use for audit reconstruction?
14. What topology would you use for one command processed by one service?
15. What metrics prove topology health?

---

## 37. Part 27 Summary

Production RabbitMQ topology design is not about drawing exchange and queue boxes. It is about mapping business intent to delivery semantics.

The most important patterns:

- work queue for one logical worker group
- pub/sub event fanout for independent subscribers
- command queue per capability
- topic event bus per bounded context
- retry + DLQ + parking lot for failure isolation
- outbox relay for DB/publish consistency
- inbox/idempotent consumer for duplicate safety
- audit stream for replay/history
- hybrid queue + stream for work/history separation
- queue versioning and shadow consumers for safe migration

The most important principle:

```text
A RabbitMQ topology is a reliability, ownership, and operational contract.
```

If the topology does not define failure handling, ownership, observability, and evolution path, it is incomplete.

---

# End of Part 27

Part berikutnya: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-28.md` — **Anti-Patterns and Failure Case Studies**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-26.md">⬅️ Part 26 — Performance Engineering and Benchmarking</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-28.md">Part 28 — Anti-Patterns and Failure Case Studies ➡️</a>
</div>

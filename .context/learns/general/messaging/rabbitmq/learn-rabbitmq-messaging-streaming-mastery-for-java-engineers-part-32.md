# Learn RabbitMQ Messaging & Streaming Mastery for Java Engineers — Part 32

# End-to-End Case Study: Regulatory Case Management Messaging Platform

> File: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-32.md`  
> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Bagian: 32 dari 34  
> Target pembaca: Java software engineer / tech lead yang ingin mampu mendesain RabbitMQ-based messaging platform untuk sistem case management, enforcement lifecycle, auditability, dan workflow produksi.

---

## 0. Tujuan Bagian Ini

Bagian ini adalah **case study integratif**.

Sampai part sebelumnya, kita sudah membahas primitive RabbitMQ secara terpisah:

- exchange
- queue
- binding
- routing key
- classic/quorum/stream
- publisher confirms
- consumer ack
- retry/DLQ/parking lot
- Spring AMQP
- Java client
- contract design
- ordering/concurrency
- workflow/saga
- stream replay
- observability
- performance
- migration
- decision framework

Di part ini, semua itu digabung menjadi satu rancangan nyata:

> **Regulatory Case Management Messaging Platform**

Domain contoh:

- laporan masuk
- kasus dibuka
- evidence dikirim
- rule evaluation diminta
- enforcement action diusulkan
- reviewer ditugaskan
- escalation dijalankan
- notification dikirim
- audit trail disimpan
- deadline/SLAs dipantau
- DLQ/parking lot diremediasi
- stream audit dapat direplay untuk investigasi

Tujuan part ini bukan membuat “contoh aplikasi mainan”, tetapi membangun mental model desain yang bisa dibawa ke sistem nyata.

---

## 1. Problem Statement

Bayangkan organisasi regulator memiliki platform untuk mengelola kasus enforcement.

Sistem harus mendukung:

1. **Case lifecycle**
   - case opened
   - evidence received
   - triage completed
   - rule evaluation requested
   - enforcement proposal created
   - legal review assigned
   - decision approved/rejected
   - enforcement action issued
   - case closed

2. **Asynchronous processing**
   - evidence scanning
   - document classification
   - risk scoring
   - rule evaluation
   - notification
   - audit archive

3. **Human workflow**
   - reviewer assignment
   - supervisor escalation
   - manual remediation
   - deadline handling

4. **Reliability requirements**
   - tidak boleh silent data loss
   - duplicate harus aman
   - retry harus bounded
   - poison message tidak boleh mengunci queue
   - audit trail harus bisa direkonstruksi

5. **Operational requirements**
   - observable
   - debuggable
   - bisa di-migrate bertahap
   - bisa di-scale per workload
   - failure mode jelas

6. **Regulatory defensibility**
   - siapa melakukan apa
   - kapan action terjadi
   - policy/rule version apa yang dipakai
   - pesan apa yang memicu transition
   - retry path apa yang terjadi
   - apakah ada manual override

---

## 2. Core Design Principle

Prinsip utama:

> RabbitMQ tidak menjadi source of truth untuk case state.

Source of truth tetap berada di database domain:

- `cases`
- `case_transitions`
- `evidence_items`
- `review_tasks`
- `outbox_messages`
- `inbox_messages`
- `workflow_timers`
- `manual_remediations`

RabbitMQ dipakai untuk:

- routing
- asynchronous work distribution
- decoupling antar capability
- retry/DLQ boundary
- audit/event streaming
- fanout notification
- replayable history via streams

### 2.1 Jangan Jadikan Queue sebagai Database Workflow

Anti-pattern:

```text
Case state = message sedang ada di queue mana
```

Ini rapuh karena:

- message bisa redelivered
- consumer bisa crash
- message bisa masuk DLQ
- queue bisa dipurge oleh operator
- topology bisa berubah
- queue depth bukan business state

Yang benar:

```text
Case state = durable state di database
RabbitMQ = transport dan work distribution
```

---

## 3. Bounded Context dan Service Map

Kita definisikan beberapa service/capability.

```text
+-----------------------+
| Intake Service        |
| - receive complaint   |
| - open case           |
+-----------------------+

+-----------------------+
| Evidence Service      |
| - receive evidence    |
| - validate metadata   |
| - scan document       |
+-----------------------+

+-----------------------+
| Case Workflow Service |
| - state machine       |
| - transition guard    |
| - assign tasks        |
| - deadlines           |
+-----------------------+

+-----------------------+
| Rule Evaluation       |
| - policy/rule engine  |
| - risk scoring        |
+-----------------------+

+-----------------------+
| Review Service        |
| - human review tasks  |
| - supervisor review   |
+-----------------------+

+-----------------------+
| Notification Service  |
| - email/SMS/in-app    |
+-----------------------+

+-----------------------+
| Audit Archive Service |
| - append audit record |
| - immutable history   |
+-----------------------+

+-----------------------+
| Remediation Console   |
| - DLQ inspection      |
| - replay/requeue      |
+-----------------------+
```

---

## 4. Message Taxonomy untuk Platform Ini

Kita tidak mencampur semua message menjadi “event”.

Gunakan taxonomy eksplisit.

| Jenis | Makna | Contoh | RabbitMQ Primitive |
|---|---|---|---|
| Command | Instruksi agar capability melakukan sesuatu | `EvaluateRulesCommand` | quorum queue |
| Event | Fakta domain yang sudah terjadi | `EvidenceSubmittedEvent` | topic exchange + audit stream |
| Job | Work teknis/asynchronous task | `ScanEvidenceDocumentJob` | quorum queue |
| Notification | Signal ke channel komunikasi | `NotifyReviewerAssigned` | queue/topic exchange |
| Audit Record | Immutable fact untuk rekonstruksi | `CaseTransitionAuditRecord` | RabbitMQ Stream |
| Reply | Response untuk request/reply terbatas | `RuleEvaluationCompletedReply` | reply queue/direct reply-to, atau event lebih disukai |

### 4.1 Rule of Thumb

- Kalau message memerintah service lain: **command**.
- Kalau message menyatakan fakta selesai: **event**.
- Kalau message adalah kerja teknis: **job**.
- Kalau message harus disimpan untuk investigasi/replay: **audit stream**.
- Kalau butuh jawaban langsung: pertimbangkan HTTP/gRPC dulu, lalu RabbitMQ RPC hanya kalau benar-benar tepat.

---

## 5. Exchange Topology

Kita buat topology per bounded context, bukan satu exchange global kacau.

```text
ex.case.events.topic
ex.case.commands.direct
ex.case.audit.topic
ex.evidence.events.topic
ex.evidence.commands.direct
ex.review.commands.direct
ex.notification.commands.direct
ex.deadletter.topic
ex.unroutable.fanout
```

### 5.1 Event Exchange

Event domain memakai topic exchange.

```text
ex.case.events.topic
```

Routing key contoh:

```text
case.opened.v1
case.triage.completed.v1
case.escalation.triggered.v1
case.closed.v1
```

Evidence event:

```text
ex.evidence.events.topic
```

Routing key:

```text
evidence.submitted.v1
evidence.scan.completed.v1
evidence.scan.failed.v1
```

### 5.2 Command Exchange

Command lebih cocok direct exchange karena command biasanya ditujukan ke capability tertentu.

```text
ex.case.commands.direct
```

Routing key:

```text
case.evaluate-rules
case.assign-review
case.escalate
case.close
```

### 5.3 Dead Letter Exchange

```text
ex.deadletter.topic
```

Routing key DLQ bisa membawa context:

```text
dlq.case.evaluate-rules
dlq.evidence.scan
dlq.notification.email
dlq.review.assign
```

### 5.4 Alternate Exchange

Untuk unroutable message:

```text
ex.unroutable.fanout
```

Queue:

```text
q.platform.unroutable
```

Ini menghindari silent drop saat publisher salah routing key.

---

## 6. Queue Topology

### 6.1 Command Queues

Gunakan quorum queue untuk critical command.

```text
q.case.evaluate-rules.qq
q.case.assign-review.qq
q.case.escalate.qq
q.evidence.scan.qq
q.notification.send.qq
```

Kenapa quorum?

- command critical
- butuh durability
- redelivery semantics jelas
- poison handling via delivery-limit
- replicated queue untuk HA

### 6.2 Retry Queues

Contoh untuk rule evaluation:

```text
q.case.evaluate-rules.retry.1m
q.case.evaluate-rules.retry.10m
q.case.evaluate-rules.retry.1h
```

Atau gunakan delayed exchange bila plugin tersedia dan disetujui secara operasional.

### 6.3 DLQ dan Parking Lot

```text
q.case.evaluate-rules.dlq
q.case.evaluate-rules.parking-lot
```

DLQ = pesan gagal secara teknis setelah retry policy.

Parking lot = pesan butuh keputusan manusia.

### 6.4 Audit Streams

```text
s.case.audit
s.evidence.audit
s.workflow.audit
```

Atau super stream bila volume besar:

```text
ss.case.audit
```

Stream menyimpan immutable history untuk:

- audit reconstruction
- projection rebuild
- investigation
- analytics feed
- data lake relay

---

## 7. High-Level Architecture

```text
                         +----------------------+
                         |      API / UI         |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |  Case Workflow Svc    |
                         |  DB + Outbox + Inbox  |
                         +----------+-----------+
                                    |
                       publish via outbox relay
                                    |
                                    v
+----------------+     +----------------------+       +--------------------+
| Evidence Svc   | --> | RabbitMQ Exchanges   | ----> | Rule Evaluation    |
| DB + Outbox    |     | events/commands/DLX   |       | DB + Inbox         |
+----------------+     +----------+-----------+       +--------------------+
                                  |
                                  v
                       +----------------------+
                       | Quorum Command Queues|
                       +----------+-----------+
                                  |
                                  v
                       +----------------------+
                       | Consumers / Workers  |
                       +----------+-----------+
                                  |
                                  v
                       +----------------------+
                       | Domain DB Commit     |
                       +----------+-----------+
                                  |
                                  v
                       +----------------------+
                       | Publish Result Event |
                       +----------------------+

Audit path:

Domain events / transition records --> RabbitMQ Stream --> Audit Archive / Replay / BI
```

---

## 8. Database Tables

### 8.1 `cases`

```sql
CREATE TABLE cases (
    case_id UUID PRIMARY KEY,
    status TEXT NOT NULL,
    version BIGINT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    tenant_id TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    risk_level TEXT,
    assigned_reviewer_id TEXT
);
```

### 8.2 `case_transitions`

```sql
CREATE TABLE case_transitions (
    transition_id UUID PRIMARY KEY,
    case_id UUID NOT NULL,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    triggered_by TEXT NOT NULL,
    message_id TEXT,
    correlation_id TEXT,
    causation_id TEXT,
    policy_version TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
```

### 8.3 `outbox_messages`

```sql
CREATE TABLE outbox_messages (
    outbox_id UUID PRIMARY KEY,
    aggregate_id UUID NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    exchange TEXT NOT NULL,
    routing_key TEXT NOT NULL,
    message_type TEXT NOT NULL,
    schema_version INT NOT NULL,
    payload_json JSONB NOT NULL,
    headers_json JSONB NOT NULL,
    status TEXT NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ
);
```

### 8.4 `inbox_messages`

```sql
CREATE TABLE inbox_messages (
    message_id TEXT PRIMARY KEY,
    consumer_name TEXT NOT NULL,
    aggregate_id UUID,
    status TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT
);
```

Untuk idempotency per consumer, primary key bisa gabungan:

```sql
PRIMARY KEY (consumer_name, message_id)
```

### 8.5 `workflow_timers`

```sql
CREATE TABLE workflow_timers (
    timer_id UUID PRIMARY KEY,
    case_id UUID NOT NULL,
    timer_type TEXT NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    command_message_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    fired_at TIMESTAMPTZ
);
```

---

## 9. Message Envelope Standard

Semua pesan memakai envelope konsisten.

```json
{
  "messageId": "msg-01JABCDE...",
  "messageType": "EvidenceSubmittedEvent",
  "schemaVersion": 1,
  "correlationId": "corr-01JCASE...",
  "causationId": "msg-previous...",
  "idempotencyKey": "evidence-submitted:case-123:evidence-456:v1",
  "tenantId": "tenant-a",
  "jurisdiction": "ID-JK",
  "subject": {
    "type": "Case",
    "id": "case-123"
  },
  "actor": {
    "type": "System",
    "id": "evidence-service"
  },
  "policy": {
    "version": "policy-2026.06",
    "ruleSet": "evidence-intake-rules-v4"
  },
  "occurredAt": "2026-06-20T10:15:30Z",
  "publishedAt": "2026-06-20T10:15:31Z",
  "payload": {
    "caseId": "case-123",
    "evidenceId": "evidence-456",
    "documentType": "BANK_STATEMENT",
    "classification": "FINANCIAL_RECORD"
  }
}
```

### 9.1 Required Metadata

Minimum untuk sistem serius:

```text
messageId
messageType
schemaVersion
correlationId
causationId
idempotencyKey
subject.type
subject.id
tenantId
occurredAt
publishedAt
producer
```

Untuk regulatory system, tambahkan:

```text
jurisdiction
actor
reasonCode
policyVersion
ruleSetVersion
caseVersion
```

---

## 10. End-to-End Flow 1: Evidence Submitted → Rule Evaluation

### 10.1 Business Flow

1. Evidence Service menerima dokumen.
2. Evidence Service menyimpan metadata evidence di DB.
3. Evidence Service menulis `EvidenceSubmittedEvent` ke outbox.
4. Outbox relay publish ke `ex.evidence.events.topic`.
5. Case Workflow Service consume event.
6. Case Workflow Service memutuskan perlu rule evaluation.
7. Case Workflow Service menyimpan transition dan outbox command.
8. Outbox relay publish `EvaluateRulesCommand` ke `ex.case.commands.direct`.
9. Rule Evaluation Service consume command dari quorum queue.
10. Rule Evaluation Service proses rule.
11. Rule Evaluation Service commit result ke DB.
12. Rule Evaluation Service publish `RuleEvaluationCompletedEvent`.
13. Case Workflow Service consume result event.
14. Case Workflow Service transition case ke state berikutnya.
15. Audit record dipublish ke stream.

### 10.2 Message Flow Diagram

```text
Evidence API
   |
   v
Evidence Service DB commit
   |
   v
outbox: EvidenceSubmittedEvent
   |
   v
Outbox Relay --confirm--> ex.evidence.events.topic
   |
   +--> q.case.workflow.evidence-submitted.qq
            |
            v
      Case Workflow Consumer
            |
            v
      DB transition + outbox EvaluateRulesCommand
            |
            v
      Outbox Relay --confirm--> ex.case.commands.direct
            |
            v
      q.case.evaluate-rules.qq
            |
            v
      Rule Evaluation Consumer
            |
            v
      DB result + outbox RuleEvaluationCompletedEvent
            |
            v
      ex.case.events.topic
            |
            +--> q.case.workflow.rule-result.qq
            |
            +--> s.case.audit
```

---

## 11. Topology Definition Example

### 11.1 RabbitMQ Definitions Style

```json
{
  "exchanges": [
    {
      "name": "ex.evidence.events.topic",
      "vhost": "/regulatory",
      "type": "topic",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "alternate-exchange": "ex.unroutable.fanout"
      }
    },
    {
      "name": "ex.case.commands.direct",
      "vhost": "/regulatory",
      "type": "direct",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "alternate-exchange": "ex.unroutable.fanout"
      }
    },
    {
      "name": "ex.deadletter.topic",
      "vhost": "/regulatory",
      "type": "topic",
      "durable": true,
      "auto_delete": false,
      "arguments": {}
    },
    {
      "name": "ex.unroutable.fanout",
      "vhost": "/regulatory",
      "type": "fanout",
      "durable": true,
      "auto_delete": false,
      "arguments": {}
    }
  ],
  "queues": [
    {
      "name": "q.case.workflow.evidence-submitted.qq",
      "vhost": "/regulatory",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-queue-type": "quorum",
        "x-dead-letter-exchange": "ex.deadletter.topic",
        "x-dead-letter-routing-key": "dlq.case.workflow.evidence-submitted",
        "x-delivery-limit": 5
      }
    },
    {
      "name": "q.case.evaluate-rules.qq",
      "vhost": "/regulatory",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-queue-type": "quorum",
        "x-dead-letter-exchange": "ex.deadletter.topic",
        "x-dead-letter-routing-key": "dlq.case.evaluate-rules",
        "x-delivery-limit": 5
      }
    },
    {
      "name": "q.case.evaluate-rules.dlq",
      "vhost": "/regulatory",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-queue-type": "quorum"
      }
    },
    {
      "name": "q.platform.unroutable",
      "vhost": "/regulatory",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-queue-type": "quorum"
      }
    }
  ],
  "bindings": [
    {
      "source": "ex.evidence.events.topic",
      "vhost": "/regulatory",
      "destination": "q.case.workflow.evidence-submitted.qq",
      "destination_type": "queue",
      "routing_key": "evidence.submitted.v1",
      "arguments": {}
    },
    {
      "source": "ex.case.commands.direct",
      "vhost": "/regulatory",
      "destination": "q.case.evaluate-rules.qq",
      "destination_type": "queue",
      "routing_key": "case.evaluate-rules",
      "arguments": {}
    },
    {
      "source": "ex.deadletter.topic",
      "vhost": "/regulatory",
      "destination": "q.case.evaluate-rules.dlq",
      "destination_type": "queue",
      "routing_key": "dlq.case.evaluate-rules",
      "arguments": {}
    },
    {
      "source": "ex.unroutable.fanout",
      "vhost": "/regulatory",
      "destination": "q.platform.unroutable",
      "destination_type": "queue",
      "routing_key": "",
      "arguments": {}
    }
  ]
}
```

---

## 12. Spring Boot Topology Beans

```java
@Configuration
public class CaseMessagingTopology {

    public static final String CASE_COMMANDS_EXCHANGE = "ex.case.commands.direct";
    public static final String EVIDENCE_EVENTS_EXCHANGE = "ex.evidence.events.topic";
    public static final String DEADLETTER_EXCHANGE = "ex.deadletter.topic";

    public static final String EVALUATE_RULES_QUEUE = "q.case.evaluate-rules.qq";
    public static final String EVIDENCE_SUBMITTED_QUEUE = "q.case.workflow.evidence-submitted.qq";
    public static final String EVALUATE_RULES_DLQ = "q.case.evaluate-rules.dlq";

    @Bean
    DirectExchange caseCommandsExchange() {
        return ExchangeBuilder.directExchange(CASE_COMMANDS_EXCHANGE)
                .durable(true)
                .alternate("ex.unroutable.fanout")
                .build();
    }

    @Bean
    TopicExchange evidenceEventsExchange() {
        return ExchangeBuilder.topicExchange(EVIDENCE_EVENTS_EXCHANGE)
                .durable(true)
                .alternate("ex.unroutable.fanout")
                .build();
    }

    @Bean
    TopicExchange deadletterExchange() {
        return ExchangeBuilder.topicExchange(DEADLETTER_EXCHANGE)
                .durable(true)
                .build();
    }

    @Bean
    Queue evaluateRulesQueue() {
        return QueueBuilder.durable(EVALUATE_RULES_QUEUE)
                .quorum()
                .deadLetterExchange(DEADLETTER_EXCHANGE)
                .deadLetterRoutingKey("dlq.case.evaluate-rules")
                .deliveryLimit(5)
                .build();
    }

    @Bean
    Queue evidenceSubmittedQueue() {
        return QueueBuilder.durable(EVIDENCE_SUBMITTED_QUEUE)
                .quorum()
                .deadLetterExchange(DEADLETTER_EXCHANGE)
                .deadLetterRoutingKey("dlq.case.workflow.evidence-submitted")
                .deliveryLimit(5)
                .build();
    }

    @Bean
    Binding evaluateRulesBinding() {
        return BindingBuilder.bind(evaluateRulesQueue())
                .to(caseCommandsExchange())
                .with("case.evaluate-rules");
    }

    @Bean
    Binding evidenceSubmittedBinding() {
        return BindingBuilder.bind(evidenceSubmittedQueue())
                .to(evidenceEventsExchange())
                .with("evidence.submitted.v1");
    }
}
```

Production note:

- Untuk organisasi besar, topology biasanya dikelola oleh platform/infrastructure pipeline.
- Aplikasi boleh validate topology, tetapi tidak selalu menjadi owner topology.
- Hindari banyak service saling mendeklarasikan resource yang sama dengan argument berbeda.

---

## 13. Outbox Relay Design

### 13.1 Kenapa Outbox?

Tanpa outbox:

```text
DB commit succeeds
RabbitMQ publish fails
=> domain state changed, event missing
```

Atau:

```text
RabbitMQ publish succeeds
DB commit fails
=> event published for state that never committed
```

Outbox membuat boundary eksplisit:

```text
Business transaction:
  - update domain state
  - insert outbox row
commit

Async relay:
  - read outbox pending rows
  - publish with confirms
  - mark as published
```

### 13.2 Relay State Machine

```text
PENDING
  -> PUBLISHING
  -> PUBLISHED
  -> RETRY_PENDING
  -> DEAD
```

Unknown publish outcome harus ditangani sebagai status tersendiri.

```text
publish sent
connection lost before confirm
=> UNKNOWN
=> safe retry requires stable messageId/idempotency
```

### 13.3 Java Skeleton

```java
@Component
public class OutboxRelay {

    private final OutboxRepository outboxRepository;
    private final ReliableRabbitPublisher publisher;

    @Scheduled(fixedDelayString = "${outbox.relay.delay-ms:500}")
    public void publishPending() {
        List<OutboxMessage> batch = outboxRepository.claimBatch(100);

        for (OutboxMessage message : batch) {
            try {
                PublishResult result = publisher.publishAndConfirm(
                        message.exchange(),
                        message.routingKey(),
                        message.body(),
                        message.properties()
                );

                if (result.confirmed()) {
                    outboxRepository.markPublished(message.outboxId());
                } else if (result.returned()) {
                    outboxRepository.markFailed(
                            message.outboxId(),
                            "UNROUTABLE",
                            result.reason()
                    );
                } else {
                    outboxRepository.scheduleRetry(
                            message.outboxId(),
                            "NOT_CONFIRMED"
                    );
                }
            } catch (Exception ex) {
                outboxRepository.scheduleRetry(
                        message.outboxId(),
                        classify(ex)
                );
            }
        }
    }
}
```

### 13.4 Relay Invariant

```text
A domain event is publishable only if the domain transaction committed.
```

```text
A publish is considered complete only after broker confirm and no unroutable return.
```

---

## 14. Reliable Publisher Adapter

```java
public final class ReliableRabbitPublisher {

    private final RabbitTemplate rabbitTemplate;

    public PublishResult publishAndConfirm(
            String exchange,
            String routingKey,
            byte[] body,
            MessageProperties properties
    ) {
        CorrelationData correlationData = new CorrelationData(properties.getMessageId());

        Message message = new Message(body, properties);

        rabbitTemplate.send(exchange, routingKey, message, correlationData);

        CorrelationData.Confirm confirm = correlationData.getFuture()
                .orTimeout(5, TimeUnit.SECONDS)
                .join();

        if (!confirm.isAck()) {
            return PublishResult.notConfirmed(confirm.getReason());
        }

        ReturnedMessage returned = correlationData.getReturned();
        if (returned != null) {
            return PublishResult.returned(
                    returned.getReplyCode(),
                    returned.getReplyText()
            );
        }

        return PublishResult.confirmed();
    }
}
```

Conceptual note:

- Jangan publish critical event tanpa confirm.
- Jangan abaikan returned message.
- Jangan retry publish tanpa stable message id.
- Jangan menandai outbox row published sebelum confirm.

---

## 15. Consumer Design: Inbox + Transaction + Manual Ack

### 15.1 Consumer Invariant

```text
Ack happens after durable business effect is committed.
```

Bukan:

```text
Ack first, then DB commit
```

### 15.2 Evidence Submitted Consumer

```java
@Component
public class EvidenceSubmittedListener {

    private final CaseWorkflowService workflowService;
    private final InboxRepository inboxRepository;
    private final ObjectMapper objectMapper;

    @RabbitListener(
            queues = "q.case.workflow.evidence-submitted.qq",
            containerFactory = "manualAckListenerContainerFactory"
    )
    public void onMessage(Message message, Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();
        String consumerName = "case-workflow.evidence-submitted.v1";
        String messageId = message.getMessageProperties().getMessageId();

        try {
            EvidenceSubmittedEnvelope envelope = objectMapper.readValue(
                    message.getBody(),
                    EvidenceSubmittedEnvelope.class
            );

            ProcessingResult result = workflowService.handleEvidenceSubmitted(
                    consumerName,
                    messageId,
                    envelope
            );

            if (result.alreadyProcessed()) {
                channel.basicAck(deliveryTag, false);
                return;
            }

            channel.basicAck(deliveryTag, false);

        } catch (PermanentMessageException ex) {
            channel.basicReject(deliveryTag, false);
        } catch (TransientProcessingException ex) {
            channel.basicNack(deliveryTag, false, false);
        } catch (Exception ex) {
            channel.basicNack(deliveryTag, false, false);
        }
    }
}
```

### 15.3 Transactional Handler

```java
@Service
public class CaseWorkflowService {

    private final InboxRepository inbox;
    private final CaseRepository cases;
    private final OutboxRepository outbox;

    @Transactional
    public ProcessingResult handleEvidenceSubmitted(
            String consumerName,
            String messageId,
            EvidenceSubmittedEnvelope event
    ) {
        if (!inbox.tryStart(consumerName, messageId, event.payload().caseId())) {
            return ProcessingResult.alreadyProcessed();
        }

        CaseRecord caseRecord = cases.findForUpdate(event.payload().caseId())
                .orElseThrow(() -> new PermanentMessageException("CASE_NOT_FOUND"));

        if (!caseRecord.canAcceptEvidenceSubmitted(event.payload().evidenceId())) {
            inbox.markProcessed(consumerName, messageId);
            return ProcessingResult.noop();
        }

        CaseRecord updated = caseRecord.markEvidenceReceived(
                event.payload().evidenceId(),
                event.policy().version(),
                event.messageId(),
                event.correlationId()
        );

        cases.save(updated);

        outbox.insert(EvaluateRulesCommand.create(
                updated.caseId(),
                event.messageId(),
                event.correlationId(),
                event.policy().version()
        ));

        outbox.insert(CaseTransitionAuditRecord.evidenceReceived(
                updated.caseId(),
                event.messageId(),
                event.correlationId(),
                event.policy().version()
        ));

        inbox.markProcessed(consumerName, messageId);

        return ProcessingResult.processed();
    }
}
```

### 15.4 Consumer Invariants

```text
Duplicate message => no duplicate transition.
```

```text
DB commit succeeds but ack fails => message redelivered, inbox prevents duplicate effect.
```

```text
DB commit fails => no ack, message can be retried/DLQed.
```

---

## 16. State Machine Design

### 16.1 Case States

```text
OPENED
  -> EVIDENCE_RECEIVED
  -> TRIAGE_PENDING
  -> RULE_EVALUATION_PENDING
  -> RULE_EVALUATED
  -> REVIEW_PENDING
  -> REVIEW_ASSIGNED
  -> ENFORCEMENT_PROPOSED
  -> LEGAL_REVIEW_PENDING
  -> APPROVED
  -> ACTION_ISSUED
  -> CLOSED
```

Exceptional states:

```text
ESCALATED
ON_HOLD
REMEDIATION_REQUIRED
REJECTED
CANCELLED
```

### 16.2 Transition Guard

```java
public CaseRecord transitionTo(
        CaseStatus target,
        String reasonCode,
        String triggeringMessageId,
        String policyVersion
) {
    if (!this.status.canTransitionTo(target)) {
        throw new InvalidTransitionException(this.status, target);
    }

    return this.withStatus(target)
            .incrementVersion()
            .recordTransition(reasonCode, triggeringMessageId, policyVersion);
}
```

### 16.3 Why State Machine Belongs in DB/App, Not Queue

RabbitMQ tells you:

```text
this message was delivered
```

It does not tell you:

```text
this business transition is valid
```

That validation must live in domain model/service.

---

## 17. Retry and DLQ Design

### 17.1 Failure Classification

| Failure | Example | Handling |
|---|---|---|
| Transient technical | DB timeout, HTTP 503 | delayed retry |
| Permanent message | invalid schema, missing required field | DLQ/parking lot |
| Permanent business | case closed, invalid transition | ack + audit/no-op, or business exception event |
| Unknown | timeout after side effect | idempotency + reconciliation |
| Poison | always crashes handler | bounded retry then DLQ/parking lot |

### 17.2 Retry Flow

```text
q.case.evaluate-rules.qq
   |
   | failure
   v
ex.deadletter.topic
   |
   v
q.case.evaluate-rules.dlq
   |
   | operator or remediation service
   v
q.case.evaluate-rules.parking-lot
```

For delayed retry:

```text
main queue
  -> retry.1m
  -> main queue
  -> retry.10m
  -> main queue
  -> retry.1h
  -> main queue
  -> DLQ
  -> parking lot
```

### 17.3 DLQ Message Context

Saat masuk DLQ, pesan harus cukup kaya untuk investigasi:

- original exchange
- original routing key
- message id
- correlation id
- causation id
- consumer name
- exception class
- error code
- retry count
- first failure time
- last failure time
- `x-death`

### 17.4 Parking Lot Decision

Parking lot dipakai jika:

- butuh manual classification
- butuh data correction
- butuh policy decision
- butuh legal/compliance approval
- replay otomatis berbahaya

---

## 18. Audit Stream Design

### 18.1 Why Stream?

Queue cocok untuk work.

Stream cocok untuk history.

Audit requirement:

```text
We need to know what happened, when, why, and because of which message.
```

Queue tidak cocok untuk long-term audit karena consumption bersifat destructive.

### 18.2 Audit Stream Event

```json
{
  "messageId": "audit-01JXYZ",
  "messageType": "CaseTransitionAuditRecord",
  "schemaVersion": 1,
  "correlationId": "corr-01JCASE",
  "causationId": "msg-evidence-submitted-123",
  "caseId": "case-123",
  "fromStatus": "OPENED",
  "toStatus": "EVIDENCE_RECEIVED",
  "reasonCode": "EVIDENCE_SUBMITTED",
  "actorType": "SYSTEM",
  "actorId": "case-workflow-service",
  "policyVersion": "policy-2026.06",
  "ruleSetVersion": "evidence-rules-v4",
  "occurredAt": "2026-06-20T10:15:35Z",
  "payloadHash": "sha256:..."
}
```

### 18.3 Audit Stream Consumers

Consumers:

```text
Audit Archive Service
Compliance Reporting Projection
Investigation Search Indexer
Data Lake Relay
Replay Tool
```

Each consumer tracks its own offset.

### 18.4 Replay Rule

Replay must be explicit:

```text
Replay must not send external notifications unless explicitly allowed.
```

Side-effect policy:

| Consumer | Replay Safe? | Notes |
|---|---:|---|
| Search projection | Yes | rebuild index |
| Compliance report projection | Yes | rebuild aggregate |
| Email notification | No by default | would resend email |
| Case state transition | Dangerous | must use idempotent transition guard |
| Audit archive | Usually yes | dedupe by audit id |

---

## 19. Observability Design

### 19.1 Messaging Dashboard

Dashboard sections:

1. **Publisher health**
   - outbox pending count
   - outbox oldest pending age
   - publish confirm latency
   - publish nack count
   - returned message count

2. **Broker health**
   - node memory
   - disk free
   - file descriptors
   - connection count
   - channel count
   - alarms

3. **Queue health**
   - ready messages
   - unacked messages
   - oldest message age
   - redelivery rate
   - consumer count
   - consumer utilization

4. **Consumer health**
   - processing latency
   - ack rate
   - error rate
   - idempotency hit rate
   - DB transaction latency

5. **Retry/DLQ health**
   - DLQ depth
   - DLQ ingress rate
   - retry queue depth
   - parking lot count
   - oldest parking lot age

6. **Stream health**
   - publish rate
   - segment growth
   - retention usage
   - consumer lag
   - replay activity

### 19.2 Log Fields

Every producer log:

```text
messageId
messageType
exchange
routingKey
correlationId
causationId
aggregateId
outboxId
confirmStatus
```

Every consumer log:

```text
messageId
messageType
queue
consumerName
deliveryTag
redelivered
correlationId
causationId
aggregateId
processingResult
ackDecision
```

### 19.3 Trace Propagation

Use W3C trace context where possible:

```text
traceparent
tracestate
```

Also keep business correlation:

```text
correlationId
causationId
caseId
```

Tracing and business correlation are related but not identical.

---

## 20. Security Design

### 20.1 Vhost Strategy

```text
/regulatory-prod
/regulatory-staging
/regulatory-dev
```

Or for strict tenant isolation:

```text
/regulatory-prod-tenant-a
/regulatory-prod-tenant-b
```

### 20.2 Service Accounts

```text
svc-case-workflow
svc-evidence
svc-rule-evaluation
svc-review
svc-notification
svc-audit-archive
svc-topology-deployer
svc-remediation-console
```

### 20.3 Permission Example

Case workflow service:

```text
configure: ^$
write:     ^(ex\.case\.commands\.direct|ex\.case\.events\.topic|ex\.case\.audit\.topic)$
read:      ^q\.case\.workflow\..*$
```

Topology deployer:

```text
configure: ^.*$
write:     ^.*$
read:      ^.*$
```

Runtime services should not need broad configure permission.

### 20.4 Payload Security

Do not put raw sensitive documents into RabbitMQ message body.

Prefer:

```json
{
  "evidenceId": "evidence-456",
  "documentUri": "s3://bucket/key-or-internal-ref",
  "contentHash": "sha256:...",
  "classification": "CONFIDENTIAL"
}
```

Message should carry reference + metadata, not full large payload.

---

## 21. Performance and Capacity Model

### 21.1 Critical Queues

```text
q.case.evaluate-rules.qq
q.evidence.scan.qq
q.notification.send.qq
q.case.workflow.evidence-submitted.qq
```

For each queue, estimate:

```text
peak publish rate
average handler latency
p95 handler latency
consumer concurrency
prefetch
message size
retry rate
DLQ rate
acceptable oldest message age
```

### 21.2 Consumer Sizing Formula

Approximate sustainable throughput:

```text
throughput ~= consumer_count * handler_threads_per_consumer / average_handler_latency_seconds
```

Example:

```text
handler latency = 200 ms = 0.2 s
consumer threads = 20
throughput ~= 20 / 0.2 = 100 msg/s
```

But this ignores:

- DB saturation
- downstream service latency
- lock contention
- prefetch
- ack delay
- retry storm
- CPU serialization cost

### 21.3 Queue Age SLO

Better than only queue depth:

```text
oldest message age < 2 minutes for critical workflow command
```

Queue depth can be misleading if rate changes.

---

## 22. Failure Walkthroughs

### 22.1 Publisher Publishes but Connection Drops Before Confirm

State:

```text
outbox row = PUBLISHING/UNKNOWN
message may or may not be in broker
```

Safe handling:

```text
retry publish using same messageId
consumer idempotency handles duplicate
```

Do not assume not published.

### 22.2 Consumer Commits DB but Crashes Before Ack

State:

```text
business effect committed
message still unacked
broker redelivers
```

Safe handling:

```text
inbox detects already processed
consumer acks duplicate
```

### 22.3 Consumer Acks Before DB Commit and Then DB Fails

State:

```text
message gone
business effect missing
```

This is data loss.

Prevention:

```text
commit before ack
```

### 22.4 Poison Message Causes Infinite Requeue

Bad:

```text
basicNack(requeue=true) forever
```

Good:

```text
bounded retries
DLQ
parking lot
manual remediation
```

### 22.5 Rule Evaluation Service Down

Expected behavior:

```text
q.case.evaluate-rules.qq grows
oldest message age increases
alert fires
case workflow remains durable but delayed
```

Recovery:

```text
restart consumers
scale workers if downstream allows
monitor drain rate
```

### 22.6 Audit Stream Consumer Lagging

Impact:

```text
audit stream still stores records
projection/search may lag
core workflow should not be blocked
```

Unless compliance requires synchronous audit archive before transition, but then architecture must explicitly encode that requirement.

---

## 23. Operational Runbook

### 23.1 DLQ Spike

Steps:

1. Identify queue and routing key.
2. Check error classifier.
3. Sample messages safely.
4. Group by message type/error code/schema version.
5. Determine transient vs permanent vs poison.
6. Check deployment timeline.
7. Check schema compatibility.
8. Check downstream dependency.
9. Decide:
   - replay
   - parking lot
   - data correction
   - code rollback
   - patch consumer
10. Record remediation action.

### 23.2 Queue Backlog

Steps:

1. Check publish rate vs ack rate.
2. Check ready vs unacked.
3. Check oldest message age.
4. Check consumer count.
5. Check consumer utilization.
6. Check DB/downstream latency.
7. Check retry/redelivery storm.
8. Scale consumers only if bottleneck is not downstream.
9. Apply admission control if backlog threatens SLO.

### 23.3 Publisher Blocked

Steps:

1. Check memory alarm.
2. Check disk alarm.
3. Check queue growth.
4. Check large messages.
5. Check stuck consumers.
6. Reduce publish rate.
7. Drain or isolate non-critical workloads.
8. Do not blindly restart broker unless root cause known.

### 23.4 Unroutable Messages

Steps:

1. Inspect `q.platform.unroutable`.
2. Identify exchange/routing key.
3. Check deployment/config drift.
4. Check missing binding.
5. Check message type version.
6. Fix topology or publisher config.
7. Republish if safe.

---

## 24. Testing Strategy for This Case Study

### 24.1 Unit Tests

Test:

- state transition guard
- failure classifier
- idempotency key generation
- routing key builder
- envelope validation
- outbox message creation

### 24.2 Contract Tests

Golden samples:

```text
EvidenceSubmittedEvent.v1.json
EvaluateRulesCommand.v1.json
RuleEvaluationCompletedEvent.v1.json
CaseTransitionAuditRecord.v1.json
```

Validate:

- required fields
- semantic rules
- compatibility
- routing key expectation

### 24.3 Integration Tests

Using Testcontainers:

- topology exists
- publisher confirm works
- unroutable messages returned
- consumer commits DB then ack
- duplicate message processed once
- permanent failure goes DLQ
- retry queue returns message
- parking lot flow works

### 24.4 Failure Tests

Simulate:

- broker restart
- consumer crash before ack
- DB failure
- downstream timeout
- duplicate delivery
- invalid schema
- poison message
- outbox relay crash
- stream replay

---

## 25. Deployment Strategy

### 25.1 Safe Rollout Order

For new message type:

1. Add contract sample.
2. Add queue/exchange/binding topology.
3. Deploy consumer capable of handling message.
4. Deploy publisher disabled by feature flag.
5. Enable publisher for small tenant/case subset.
6. Observe metrics.
7. Gradually ramp up.
8. Remove feature flag only after stable period.

### 25.2 Consumer Versioning

When breaking change unavoidable:

```text
q.case.workflow.evidence-submitted.v1.qq
q.case.workflow.evidence-submitted.v2.qq
```

Bind both during migration:

```text
evidence.submitted.v1 -> v1 queue
evidence.submitted.v2 -> v2 queue
```

Or use compatible envelope and one queue if safe.

### 25.3 Rollback

Rollback must answer:

- can old consumer handle new messages?
- can publisher stop producing new version?
- are v2 messages already in queue?
- do we need drain/quarantine?
- is replay safe?

---

## 26. Architecture Decision Record Example

```markdown
# ADR: Use RabbitMQ Quorum Queues for Case Workflow Commands

## Status
Accepted

## Context
Case workflow commands must be durable, replicated, acknowledged after processing, and recoverable after consumer crash. Commands do not require long-term replay after successful processing.

## Decision
Use RabbitMQ quorum queues for critical workflow commands:

- q.case.evaluate-rules.qq
- q.case.assign-review.qq
- q.case.escalate.qq

Publisher must use confirms. Consumers must use manual acknowledgement and inbox idempotency.

## Consequences
Positive:

- durable replicated command delivery
- bounded redelivery
- poison handling via delivery-limit and DLQ
- operationally observable queue state

Negative:

- higher write cost than classic queues
- requires careful capacity planning
- duplicate processing still possible and must be handled by idempotency

## Alternatives Considered
- Kafka topic: better for event history, less direct command queue semantics.
- Database polling: simpler transactionally, weaker routing and operational decoupling.
- HTTP/gRPC: synchronous coupling and poor buffering during downstream outage.
```

---

## 27. Design Review Checklist

### 27.1 Message Semantics

- [ ] Is each message clearly command/event/job/notification/audit?
- [ ] Is `messageId` stable?
- [ ] Is `correlationId` propagated?
- [ ] Is `causationId` meaningful?
- [ ] Is schema version explicit?
- [ ] Is idempotency key defined?
- [ ] Is sensitive data minimized?

### 27.2 Publisher Reliability

- [ ] Is outbox used for DB + publish boundary?
- [ ] Are publisher confirms enabled?
- [ ] Are returned/unroutable messages handled?
- [ ] Is retry bounded?
- [ ] Is unknown publish outcome handled?

### 27.3 Consumer Reliability

- [ ] Is manual ack used for critical queues?
- [ ] Does ack happen after commit?
- [ ] Is duplicate delivery safe?
- [ ] Is failure classification explicit?
- [ ] Is poison message bounded?

### 27.4 Topology

- [ ] Are exchange/queue names domain meaningful?
- [ ] Are command queues quorum queues?
- [ ] Are audit/history needs mapped to streams?
- [ ] Is DLQ configured?
- [ ] Is alternate exchange configured?
- [ ] Is queue growth bounded by policy/alerts?

### 27.5 Workflow

- [ ] Is case state stored outside RabbitMQ?
- [ ] Are state transitions guarded?
- [ ] Are deadlines/timers durable?
- [ ] Are escalations idempotent?
- [ ] Are compensation actions explicit?

### 27.6 Observability

- [ ] Are queue depth and oldest age monitored?
- [ ] Are DLQ and parking lot monitored?
- [ ] Are outbox lag and confirm latency monitored?
- [ ] Are consumer errors classified?
- [ ] Can one case be traced end-to-end?
- [ ] Can one message be reconstructed?

### 27.7 Operations

- [ ] Is there a replay policy?
- [ ] Is there a DLQ remediation runbook?
- [ ] Is there a safe purge policy?
- [ ] Is there a credential rotation plan?
- [ ] Is topology drift detected?

---

## 28. Common Design Mistakes in This Case Study

### Mistake 1: All Events Go to One Queue

Bad:

```text
q.case.all-events
```

Problem:

- mixed workload
- poor ownership
- hard scaling
- hard DLQ triage
- one poison event can affect unrelated consumers

Better:

```text
q.case.workflow.evidence-submitted.qq
q.case.workflow.rule-result.qq
q.notification.case-events.qq
q.audit.case-events.stream
```

### Mistake 2: Queue Used as Case State

Bad:

```text
If message is in q.review.pending, case is pending review.
```

Better:

```text
cases.status = REVIEW_PENDING
message in queue = work item to process transition/notification
```

### Mistake 3: Retry Everything

Bad:

```text
catch Exception => retry forever
```

Better:

```text
Transient => delayed retry
Permanent schema => DLQ
Permanent business => ack + audit/no-op
Unknown side effect => reconciliation
```

### Mistake 4: Audit Only in Logs

Logs are useful, but not enough for durable audit.

Better:

```text
case_transitions table + RabbitMQ audit stream + immutable archive
```

### Mistake 5: Replaying Stream Sends Notifications Again

Replay must separate projection rebuild from external side effects.

---

## 29. Mini Lab

### Lab 1: Build Core Topology

Create:

```text
ex.evidence.events.topic
ex.case.commands.direct
ex.deadletter.topic
ex.unroutable.fanout
q.case.workflow.evidence-submitted.qq
q.case.evaluate-rules.qq
q.case.evaluate-rules.dlq
q.platform.unroutable
```

Publish:

```text
evidence.submitted.v1
```

Verify:

```text
message arrives at q.case.workflow.evidence-submitted.qq
```

### Lab 2: Outbox Relay

Implement:

- outbox table
- scheduled relay
- publisher confirm
- returned message handling
- mark published only after confirm

Test:

- valid route
- invalid routing key
- broker unavailable

### Lab 3: Idempotent Consumer

Send same message twice.

Expected:

```text
case transition created once
inbox records duplicate hit
both deliveries acked safely
```

### Lab 4: Poison Message

Send invalid message.

Expected:

```text
consumer rejects/nacks without requeue
message reaches DLQ
operator can inspect metadata
```

### Lab 5: Audit Stream Replay

Publish audit records to stream.

Create replay consumer that rebuilds projection table.

Expected:

```text
projection rebuild is deterministic
no external notification sent during replay
```

---

## 30. Final Mental Model

A robust RabbitMQ-based regulatory workflow platform is not:

```text
producer sends message, consumer does thing
```

It is:

```text
Domain state changes transactionally.
Outbox records intended messages.
Publisher confirms make broker acceptance explicit.
Exchange topology routes by capability and fact type.
Quorum queues distribute critical work durably.
Consumers commit business effect before ack.
Inbox makes duplicate delivery safe.
Retry policy classifies failure.
DLQ and parking lot make poison visible.
Streams preserve immutable history.
Observability lets humans reconstruct what happened.
Runbooks make failure response repeatable.
```

That is the difference between “using RabbitMQ” and designing a messaging platform.

---

## 31. Part 32 Completion Checklist

Kamu dianggap memahami part ini jika bisa menjelaskan:

- kenapa RabbitMQ bukan source of truth untuk case state
- kapan memakai command queue vs event exchange vs audit stream
- kenapa outbox dibutuhkan
- kenapa inbox/idempotency tetap dibutuhkan walau broker durable
- kenapa ack harus setelah commit
- bagaimana DLQ berbeda dari parking lot
- bagaimana stream replay bisa aman atau berbahaya
- bagaimana trace/correlation/causation membantu investigasi
- bagaimana desain ini bertahan dari publisher crash, consumer crash, poison message, backlog, dan duplicate delivery

---

## 32. Seri Status

Bagian ini adalah **part-32**.

Seri belum selesai.

Bagian berikutnya:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-33.md
```

Topik berikutnya:

```text
Production Runbook and Operational Playbook
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-31.md">⬅️ Part 31 — Architecture Decision Framework: RabbitMQ vs Kafka vs Database vs HTTP</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-33.md">Part 33 — Production Runbook and Operational Playbook ➡️</a>
</div>

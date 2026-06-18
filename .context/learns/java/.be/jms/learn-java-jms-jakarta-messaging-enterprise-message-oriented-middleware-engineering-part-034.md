# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-034

# Part 34 — Production Blueprint: Reference Architecture JMS untuk Sistem Enterprise Regulated Case Management

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Scope Java: Java 8 sampai Java 25  
> API: JMS 1.1/2.0 (`javax.jms`) dan Jakarta Messaging 3.x (`jakarta.jms`)  
> Fokus part ini: menyusun blueprint produksi end-to-end untuk sistem enterprise regulated case management berbasis JMS/Jakarta Messaging.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas banyak komponen secara terpisah:

- queue semantics;
- topic semantics;
- message anatomy;
- producer dan consumer engineering;
- acknowledgement;
- transaction model;
- reliability;
- ordering;
- retry, redelivery, DLQ, parking lot;
- request/reply;
- selector;
- security;
- broker architecture;
- provider differences;
- Jakarta EE runtime;
- Spring runtime;
- microservices;
- schema contract;
- idempotency;
- backpressure;
- performance;
- observability;
- testing;
- operations;
- Kubernetes;
- comparison dengan Kafka/RabbitMQ/Pulsar;
- Enterprise Integration Patterns;
- failure modeling.

Part ini menggabungkan semuanya menjadi satu **reference architecture**.

Bukan blueprint main-main seperti:

```text
Service A -> Queue -> Service B
```

Melainkan blueprint yang menjawab pertanyaan produksi:

1. bagaimana message dibuat;
2. bagaimana message dipersist;
3. bagaimana side effect dijamin tidak merusak state;
4. bagaimana retry dilakukan;
5. bagaimana DLQ ditangani;
6. bagaimana audit trail dibangun;
7. bagaimana replay dilakukan secara aman;
8. bagaimana operator bisa melakukan triage;
9. bagaimana keamanan dijaga;
10. bagaimana sistem bisa dipertanggungjawabkan dalam environment regulated.

Jakarta Messaging mendeskripsikan API untuk aplikasi Java membuat, mengirim, dan menerima message melalui komunikasi asynchronous yang reliable dan loosely-coupled. Artinya, JMS/Jakarta Messaging adalah **kontrak komunikasi**, bukan otomatis menjadi arsitektur yang benar. Arsitektur benar tetap harus dirancang di atasnya.

---

## 2. Problem Domain: Regulated Case Management

Kita gunakan contoh domain yang realistis:

```text
Regulated Case Management System

Entity utama:
- Application
- Case
- ComplianceFinding
- Appeal
- Investigation
- EnforcementAction
- Document
- OfficerTask
- SLAClock
- Notification
- AuditTrail
```

Karakteristik domain:

1. **stateful**  
   Case memiliki lifecycle panjang.

2. **auditable**  
   Semua keputusan harus bisa dijelaskan.

3. **multi-actor**  
   Officer, supervisor, applicant, system job, external agency.

4. **multi-step**  
   Validation, assignment, review, escalation, approval, notification.

5. **eventual consistency acceptable untuk beberapa flow**  
   Misalnya notification boleh asynchronous.

6. **strong consistency diperlukan untuk keputusan hukum/regulatory**  
   Misalnya status enforcement tidak boleh berubah dua kali secara kontradiktif.

7. **failure tidak boleh silently lost**  
   Message gagal harus bisa ditemukan, diperbaiki, dan direplay.

8. **operational action harus governed**  
   Replay message tidak boleh sembarangan karena bisa berdampak ke case state.

Sistem seperti ini bukan sekadar membutuhkan message broker. Sistem ini membutuhkan **message governance architecture**.

---

## 3. Prinsip Utama Blueprint

Blueprint ini berdiri di atas beberapa prinsip.

### 3.1 JMS is transport; domain correctness lives above it

JMS memberi primitive:

- queue;
- topic;
- producer;
- consumer;
- session;
- acknowledgement;
- transaction;
- selector;
- delivery mode;
- redelivery;
- DLQ.

Tetapi JMS tidak tahu:

- apakah `CaseApproved` valid;
- apakah `OfficerAssigned` boleh terjadi dua kali;
- apakah `EnforcementIssued` harus menunggu `LegalReviewCompleted`;
- apakah replay message lama masih legal;
- apakah duplicate notification boleh dikirim.

Domain correctness harus hidup di:

- aggregate invariant;
- state machine;
- idempotency key;
- optimistic locking;
- command validation;
- audit trail;
- replay policy.

### 3.2 Queue for work, topic for facts

Gunakan queue untuk command/work:

```text
case.assignment.command.queue
case.escalation.command.queue
notification.email.command.queue
sla.evaluation.command.queue
```

Gunakan topic untuk fact/event:

```text
case.lifecycle.event.topic
application.lifecycle.event.topic
compliance.finding.event.topic
notification.delivery.event.topic
```

Command berarti:

```text
Please do this work.
```

Event berarti:

```text
This already happened.
```

Mencampur keduanya adalah sumber banyak kerusakan arsitektur.

### 3.3 Message processing must be idempotent by default

Setiap handler harus diasumsikan bisa menerima:

- message duplicate;
- redelivery;
- replay;
- out-of-order event;
- message lama setelah state sudah berubah;
- late reply;
- retry setelah partial side effect.

Handler production tidak boleh bergantung pada asumsi:

```text
Message pasti hanya datang sekali.
```

Asumsi yang benar:

```text
Message boleh datang lebih dari sekali; handler harus membuat hasil akhirnya tetap benar.
```

### 3.4 Acknowledgement follows durable side effect

Ack tidak boleh dilakukan sebelum durable side effect aman.

Salah:

```text
receive message
ack message
update database
```

Jika proses mati setelah ack sebelum update DB, message hilang dan side effect tidak terjadi.

Lebih aman:

```text
receive message
begin transaction
validate idempotency
update database
write audit
commit transaction
ack message
```

Atau dengan JMS transacted session:

```text
receive message
begin local/db transaction
update database
commit database
commit JMS session
```

Namun jika DB dan JMS tidak satu transaksi atomik, masih ada failure window. Karena itu blueprint production biasanya memakai inbox/outbox.

### 3.5 Replay is a governed operation, not a developer trick

Replay bukan sekadar:

```text
move message from DLQ back to original queue
```

Replay harus punya:

- approval;
- reason;
- operator identity;
- dry-run validation;
- idempotency check;
- state compatibility check;
- replay batch limit;
- audit record;
- rollback/compensation plan;
- observability.

Dalam regulated system, replay adalah action yang bisa mengubah outcome. Maka replay harus diperlakukan seperti administrative operation, bukan hanya broker operation.

---

## 4. High-Level Architecture

Blueprint konseptual:

```text
+-------------------+
| User / API / Job  |
+---------+---------+
          |
          v
+-------------------+        +------------------+
| Application Svc   | -----> | Domain Database  |
| Case Svc          |        | + Outbox Table    |
| Compliance Svc    |        | + Inbox Table     |
+---------+---------+        | + Audit Trail     |
          |                  +------------------+
          | outbox relay
          v
+-------------------+
| JMS Broker        |
| - command queues  |
| - event topics    |
| - DLQ             |
| - expiry queues   |
+---------+---------+
          |
          v
+-------------------+        +------------------+
| Consumers         | -----> | Local DB / State |
| - processors      |        | Inbox / Audit    |
| - projectors      |        +------------------+
| - notifiers       |
+---------+---------+
          |
          v
+-------------------+
| Ops Console       |
| - DLQ triage      |
| - replay          |
| - quarantine      |
| - audit review    |
+-------------------+
```

Lebih detail:

```text
                         +-----------------------------+
                         | Identity / Access Control   |
                         +--------------+--------------+
                                        |
                                        v
+----------------+       +-----------------------------+
| REST / UI /    | ----> | Command Application Layer   |
| Batch / API    |       | - validate request          |
+----------------+       | - load aggregate            |
                         | - enforce transition        |
                         | - persist state             |
                         | - write outbox              |
                         | - write audit               |
                         +--------------+--------------+
                                        |
                               same DB transaction
                                        |
                                        v
                         +-----------------------------+
                         | Domain DB                   |
                         | - business tables           |
                         | - outbox_message            |
                         | - inbox_message             |
                         | - audit_event               |
                         +--------------+--------------+
                                        |
                                 polling/CDC relay
                                        |
                                        v
                         +-----------------------------+
                         | Outbox Relay                |
                         | - fetch unpublished         |
                         | - publish to JMS            |
                         | - mark published            |
                         +--------------+--------------+
                                        |
                                        v
+---------------------------------------------------------------+
| JMS Broker                                                     |
|                                                               |
| Queues:                                                       |
| - case.assignment.command.queue                               |
| - case.escalation.command.queue                               |
| - document.index.command.queue                                |
| - notification.email.command.queue                            |
|                                                               |
| Topics:                                                       |
| - case.lifecycle.event.topic                                  |
| - application.lifecycle.event.topic                           |
| - compliance.finding.event.topic                              |
|                                                               |
| Failure:                                                      |
| - *.dlq                                                       |
| - *.parking.queue                                             |
| - *.expiry.queue                                              |
+--------------------------+------------------------------------+
                           |
                           v
          +------------------------------------+
          | Message Consumers                  |
          | - inbox dedup                      |
          | - state validation                 |
          | - side effect                      |
          | - audit write                      |
          | - ack/commit                       |
          +----------------+-------------------+
                           |
                           v
          +------------------------------------+
          | Observability / Ops / Governance   |
          | - metrics                          |
          | - traces                           |
          | - structured logs                  |
          | - DLQ console                      |
          | - replay workflow                  |
          | - operator audit                   |
          +------------------------------------+
```

---

## 5. Bounded Context dan Message Boundary

Sebelum membuat queue/topic, tentukan bounded context.

Contoh:

```text
Application Context
- menerima aplikasi baru
- validasi completeness
- submission lifecycle

Case Context
- case creation
- assignment
- review
- escalation
- decision

Compliance Context
- findings
- breach assessment
- inspection result

Enforcement Context
- enforcement recommendation
- notice issuance
- penalty lifecycle

Notification Context
- email/SMS/inbox notification
- delivery tracking

Document Context
- document ingestion
- virus scan
- indexing
- retention

SLA Context
- due date computation
- reminder
- escalation trigger
```

Jangan mulai dari:

```text
Kita butuh berapa queue?
```

Mulai dari:

```text
State apa yang dimiliki tiap context?
Command apa yang boleh diterima?
Event apa yang dipublikasikan?
Siapa owner lifecycle?
Apa invariant yang harus dijaga?
```

---

## 6. Command, Domain Event, Integration Event

### 6.1 Command

Command meminta suatu pekerjaan dilakukan.

Contoh:

```json
{
  "messageType": "AssignCaseCommand",
  "messageVersion": 1,
  "messageId": "msg-001",
  "correlationId": "corr-991",
  "causationId": "cmd-123",
  "aggregateType": "Case",
  "aggregateId": "CASE-2026-0001",
  "issuedAt": "2026-06-18T10:15:30Z",
  "issuedBy": "system:sla-evaluator",
  "payload": {
    "caseId": "CASE-2026-0001",
    "assignmentReason": "AUTO_ASSIGNMENT",
    "candidateOfficerGroup": "COMPLIANCE_REVIEW"
  }
}
```

Command destination:

```text
case.assignment.command.queue
```

Command consumer:

```text
Case Assignment Worker
```

Command rules:

- satu command biasanya ditangani oleh satu logical owner;
- command boleh ditolak;
- command handler harus memvalidasi state terbaru;
- command harus idempotent;
- command result biasanya event atau audit, bukan reply synchronous.

### 6.2 Domain Event

Domain event menyatakan fakta yang sudah terjadi di dalam bounded context.

Contoh:

```json
{
  "messageType": "CaseAssignedEvent",
  "messageVersion": 1,
  "messageId": "evt-001",
  "correlationId": "corr-991",
  "causationId": "msg-001",
  "aggregateType": "Case",
  "aggregateId": "CASE-2026-0001",
  "occurredAt": "2026-06-18T10:15:33Z",
  "payload": {
    "caseId": "CASE-2026-0001",
    "assignedOfficerId": "OFFICER-123",
    "assignmentMode": "AUTO"
  }
}
```

Event destination:

```text
case.lifecycle.event.topic
```

Event rules:

- event tidak boleh meminta consumer melakukan sesuatu secara implisit;
- event adalah fakta masa lalu;
- event tidak boleh berubah makna setelah dipublish;
- event schema harus backward/forward compatible;
- event harus bisa diproses duplicate-safe.

### 6.3 Integration Event

Integration event adalah event yang disiapkan untuk sistem lain.

Perbedaannya dari domain event:

```text
Domain event:
- internal vocabulary
- detail domain mungkin lebih kaya
- bisa berubah mengikuti model domain internal

Integration event:
- external contract
- lebih stabil
- payload disanitasi
- field dipilih berdasarkan kebutuhan integrasi
- versioning lebih ketat
```

Contoh:

```text
Domain event:
CaseLegalReviewCompleted

Integration event:
RegulatoryCaseStatusChanged
```

---

## 7. Destination Naming Blueprint

Naming harus membantu operasi.

Format yang disarankan:

```text
<context>.<entity-or-process>.<semantic>.<kind>
```

Contoh queue command:

```text
case.assignment.command.queue
case.escalation.command.queue
case.review.command.queue
document.indexing.command.queue
notification.email.command.queue
sla.evaluation.command.queue
```

Contoh topic event:

```text
case.lifecycle.event.topic
application.lifecycle.event.topic
document.lifecycle.event.topic
compliance.finding.event.topic
notification.delivery.event.topic
```

Contoh DLQ:

```text
case.assignment.command.dlq
case.escalation.command.dlq
notification.email.command.dlq
```

Contoh parking lot:

```text
case.assignment.command.parking
notification.email.command.parking
```

Contoh expiry:

```text
notification.email.command.expiry
sla.reminder.command.expiry
```

### 7.1 Jangan gunakan nama ambigu

Buruk:

```text
queue1
caseQueue
eventQueue
notification
integration
```

Lebih baik:

```text
case.assignment.command.queue
case.lifecycle.event.topic
notification.email.command.queue
```

Nama destination adalah bagian dari operational interface.

---

## 8. Message Envelope Standard

Gunakan envelope standar untuk semua message.

```json
{
  "messageId": "uuid",
  "messageType": "CaseAssignedEvent",
  "messageVersion": 1,
  "schemaId": "case-assigned-event-v1",
  "correlationId": "uuid",
  "causationId": "uuid",
  "traceId": "otel-trace-id",
  "tenantId": "agency-a",
  "sourceService": "case-service",
  "sourceInstance": "case-service-7c9f9d7f4b-z9xq2",
  "aggregateType": "Case",
  "aggregateId": "CASE-2026-0001",
  "aggregateVersion": 42,
  "occurredAt": "2026-06-18T10:15:33Z",
  "publishedAt": "2026-06-18T10:15:34Z",
  "actor": {
    "type": "USER",
    "id": "officer-123"
  },
  "classification": {
    "dataClass": "CONFIDENTIAL",
    "containsPii": true,
    "retentionClass": "REGULATORY_CASE"
  },
  "payload": {}
}
```

### 8.1 Required metadata

Minimal:

```text
messageId
messageType
messageVersion
correlationId
causationId
sourceService
aggregateId, jika terkait aggregate
occurredAt/publishedAt
```

Untuk regulated system tambahkan:

```text
tenantId / agencyId
actor
classification
data retention class
schemaId
business operation id
```

### 8.2 JMS header vs payload envelope

Sebagian metadata bisa ditempatkan sebagai JMS properties agar selector/ops mudah:

```text
JMSCorrelationID = correlationId
property messageType = CaseAssignedEvent
property messageVersion = 1
property tenantId = agency-a
property aggregateType = Case
property aggregateId = CASE-2026-0001
property dataClass = CONFIDENTIAL
```

Namun jangan hanya mengandalkan JMS headers/properties. Simpan metadata penting juga di body envelope agar tetap terbawa ketika message disalin ke audit store, DLQ archive, object storage, atau sistem observability.

---

## 9. Database Tables Blueprint

### 9.1 Outbox table

```sql
CREATE TABLE outbox_message (
    id                 VARCHAR(64) PRIMARY KEY,
    aggregate_type     VARCHAR(100) NOT NULL,
    aggregate_id       VARCHAR(100) NOT NULL,
    aggregate_version  BIGINT,
    message_type       VARCHAR(200) NOT NULL,
    message_version    INT NOT NULL,
    destination_name   VARCHAR(300) NOT NULL,
    destination_type   VARCHAR(20) NOT NULL, -- QUEUE/TOPIC
    correlation_id     VARCHAR(100) NOT NULL,
    causation_id       VARCHAR(100),
    payload_json       CLOB NOT NULL,
    status             VARCHAR(30) NOT NULL, -- NEW, PUBLISHING, PUBLISHED, FAILED
    attempt_count      INT NOT NULL DEFAULT 0,
    next_attempt_at    TIMESTAMP,
    created_at         TIMESTAMP NOT NULL,
    published_at       TIMESTAMP,
    last_error         CLOB
);

CREATE INDEX idx_outbox_status_next_attempt
ON outbox_message(status, next_attempt_at);

CREATE INDEX idx_outbox_aggregate
ON outbox_message(aggregate_type, aggregate_id, aggregate_version);

CREATE INDEX idx_outbox_correlation
ON outbox_message(correlation_id);
```

Outbox invariant:

```text
Business state change and outbox insert must be committed in the same database transaction.
```

Jika state berubah tetapi outbox gagal ditulis, event hilang.

Jika outbox ditulis tetapi state gagal commit, event palsu bisa terbit.

Maka harus satu transaksi.

### 9.2 Inbox table

```sql
CREATE TABLE inbox_message (
    message_id         VARCHAR(64) PRIMARY KEY,
    consumer_name      VARCHAR(200) NOT NULL,
    message_type       VARCHAR(200) NOT NULL,
    aggregate_type     VARCHAR(100),
    aggregate_id       VARCHAR(100),
    correlation_id     VARCHAR(100) NOT NULL,
    received_at        TIMESTAMP NOT NULL,
    processed_at       TIMESTAMP,
    status             VARCHAR(30) NOT NULL, -- RECEIVED, PROCESSED, FAILED, IGNORED
    result_code        VARCHAR(100),
    error_code         VARCHAR(100),
    error_message      CLOB
);

CREATE UNIQUE INDEX uq_inbox_consumer_message
ON inbox_message(consumer_name, message_id);

CREATE INDEX idx_inbox_correlation
ON inbox_message(correlation_id);

CREATE INDEX idx_inbox_aggregate
ON inbox_message(aggregate_type, aggregate_id);
```

Inbox invariant:

```text
A consumer must record message processing identity before or within the same transaction as side effect.
```

### 9.3 Audit table

```sql
CREATE TABLE audit_event (
    id                 VARCHAR(64) PRIMARY KEY,
    event_time         TIMESTAMP NOT NULL,
    actor_type         VARCHAR(50) NOT NULL,
    actor_id           VARCHAR(100),
    operation          VARCHAR(200) NOT NULL,
    aggregate_type     VARCHAR(100),
    aggregate_id       VARCHAR(100),
    before_state       CLOB,
    after_state        CLOB,
    correlation_id     VARCHAR(100) NOT NULL,
    causation_id       VARCHAR(100),
    message_id         VARCHAR(100),
    source_service     VARCHAR(100) NOT NULL,
    result             VARCHAR(50) NOT NULL,
    reason             CLOB,
    created_at         TIMESTAMP NOT NULL
);

CREATE INDEX idx_audit_aggregate
ON audit_event(aggregate_type, aggregate_id, event_time);

CREATE INDEX idx_audit_correlation
ON audit_event(correlation_id);
```

Audit invariant:

```text
Every state-changing message handler must write an audit event in the same durable unit as the business state change.
```

---

## 10. Producer Blueprint with Outbox

### 10.1 Synchronous request handling

Contoh user action:

```text
Officer approves case.
```

Flow:

```text
1. REST API receives ApproveCase request.
2. Application layer authenticates and authorizes actor.
3. Load Case aggregate.
4. Validate current state allows APPROVE.
5. Apply state transition.
6. Persist case state.
7. Write audit_event.
8. Write outbox_message: CaseApprovedEvent.
9. Commit DB transaction.
10. Return response to user.
11. Outbox relay later publishes message to JMS.
```

Sequence:

```text
User/API
  |
  v
Case Service
  |
  | begin DB tx
  | update case status
  | insert audit_event
  | insert outbox_message
  | commit DB tx
  v
Response OK

Outbox Relay
  |
  | read NEW outbox row
  | publish to JMS topic
  | mark PUBLISHED
  v
case.lifecycle.event.topic
```

### 10.2 Java 8 style producer relay sketch

```java
public final class OutboxRelay implements Runnable {
    private final OutboxRepository outboxRepository;
    private final ConnectionFactory connectionFactory;
    private final String serviceName;
    private volatile boolean running = true;

    public OutboxRelay(OutboxRepository outboxRepository,
                       ConnectionFactory connectionFactory,
                       String serviceName) {
        this.outboxRepository = outboxRepository;
        this.connectionFactory = connectionFactory;
        this.serviceName = serviceName;
    }

    @Override
    public void run() {
        while (running) {
            List<OutboxMessage> batch = outboxRepository.claimBatch(100, serviceName);
            if (batch.isEmpty()) {
                sleepQuietly(500L);
                continue;
            }

            for (OutboxMessage message : batch) {
                publishOne(message);
            }
        }
    }

    private void publishOne(OutboxMessage outbox) {
        Connection connection = null;
        Session session = null;

        try {
            connection = connectionFactory.createConnection();
            session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);

            Destination destination = resolveDestination(session, outbox);
            MessageProducer producer = session.createProducer(destination);
            producer.setDeliveryMode(DeliveryMode.PERSISTENT);

            TextMessage jmsMessage = session.createTextMessage(outbox.payloadJson());
            jmsMessage.setJMSCorrelationID(outbox.correlationId());
            jmsMessage.setStringProperty("messageId", outbox.id());
            jmsMessage.setStringProperty("messageType", outbox.messageType());
            jmsMessage.setIntProperty("messageVersion", outbox.messageVersion());
            jmsMessage.setStringProperty("aggregateType", outbox.aggregateType());
            jmsMessage.setStringProperty("aggregateId", outbox.aggregateId());
            jmsMessage.setStringProperty("sourceService", serviceName);

            producer.send(jmsMessage);
            outboxRepository.markPublished(outbox.id());
        } catch (Exception ex) {
            outboxRepository.markPublishFailed(outbox.id(), ex);
        } finally {
            closeQuietly(session);
            closeQuietly(connection);
        }
    }

    private Destination resolveDestination(Session session, OutboxMessage outbox) throws JMSException {
        if ("QUEUE".equals(outbox.destinationType())) {
            return session.createQueue(outbox.destinationName());
        }
        if ("TOPIC".equals(outbox.destinationType())) {
            return session.createTopic(outbox.destinationName());
        }
        throw new IllegalArgumentException("Unsupported destination type: " + outbox.destinationType());
    }

    public void stop() {
        running = false;
    }

    private static void closeQuietly(AutoCloseable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (Exception ignored) {
            // log in real implementation
        }
    }

    private static void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

Catatan production:

Kode di atas adalah skeleton pembelajaran. Implementasi serius perlu:

- connection/session reuse atau pooling;
- batch claim dengan locking benar;
- backoff;
- relay ownership;
- graceful shutdown;
- metric;
- poison outbox handling;
- publisher confirm semantics sesuai provider;
- retry cap;
- operational dashboard.

### 10.3 Jakarta Messaging 3.x style producer relay sketch

```java
public final class JakartaOutboxPublisher {
    private final ConnectionFactory connectionFactory;

    public JakartaOutboxPublisher(ConnectionFactory connectionFactory) {
        this.connectionFactory = connectionFactory;
    }

    public void publish(OutboxMessage outbox) {
        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            Destination destination = resolveDestination(context, outbox);

            TextMessage message = context.createTextMessage(outbox.payloadJson());
            message.setJMSCorrelationID(outbox.correlationId());
            message.setStringProperty("messageId", outbox.id());
            message.setStringProperty("messageType", outbox.messageType());
            message.setIntProperty("messageVersion", outbox.messageVersion());
            message.setStringProperty("aggregateId", outbox.aggregateId());

            context.createProducer()
                    .setDeliveryMode(DeliveryMode.PERSISTENT)
                    .send(destination, message);
        } catch (JMSException ex) {
            throw new MessagePublishException("Failed to publish outbox message " + outbox.id(), ex);
        }
    }

    private Destination resolveDestination(JMSContext context, OutboxMessage outbox) {
        if ("QUEUE".equals(outbox.destinationType())) {
            return context.createQueue(outbox.destinationName());
        }
        if ("TOPIC".equals(outbox.destinationType())) {
            return context.createTopic(outbox.destinationName());
        }
        throw new IllegalArgumentException("Unsupported destination type: " + outbox.destinationType());
    }
}
```

---

## 11. Consumer Blueprint with Inbox

Consumer flow:

```text
1. Receive message.
2. Parse envelope.
3. Validate schema/version.
4. Begin DB transaction.
5. Insert inbox row with unique consumer/message id.
6. If duplicate, decide skip/return success.
7. Load current aggregate/state.
8. Validate message is still applicable.
9. Apply side effect.
10. Write audit event.
11. Mark inbox processed.
12. Commit DB transaction.
13. Ack/commit JMS session.
```

Sequence:

```text
JMS Queue/Topic Subscription
  |
  v
Consumer
  |
  | receive message
  | parse envelope
  | begin DB tx
  | insert inbox marker
  | apply side effect
  | write audit
  | mark inbox processed
  | commit DB tx
  | ack message
  v
Done
```

### 11.1 Java 8 listener skeleton

```java
public final class CaseAssignmentListener implements MessageListener {
    private final InboxRepository inboxRepository;
    private final CaseRepository caseRepository;
    private final AuditRepository auditRepository;
    private final JsonCodec jsonCodec;

    public CaseAssignmentListener(InboxRepository inboxRepository,
                                  CaseRepository caseRepository,
                                  AuditRepository auditRepository,
                                  JsonCodec jsonCodec) {
        this.inboxRepository = inboxRepository;
        this.caseRepository = caseRepository;
        this.auditRepository = auditRepository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public void onMessage(Message message) {
        try {
            String body = ((TextMessage) message).getText();
            AssignCaseCommand command = jsonCodec.decode(body, AssignCaseCommand.class);

            process(command, message);
        } catch (Exception ex) {
            // Let container/session redeliver by throwing runtime exception if applicable.
            throw new MessageProcessingRuntimeException("Failed to process case assignment message", ex);
        }
    }

    private void process(AssignCaseCommand command, Message rawMessage) throws Exception {
        String consumerName = "case-assignment-worker";
        String messageId = command.messageId();

        TransactionTemplate.required(() -> {
            boolean firstTime = inboxRepository.tryInsertReceived(
                    consumerName,
                    messageId,
                    command.messageType(),
                    command.aggregateId(),
                    command.correlationId()
            );

            if (!firstTime) {
                return null;
            }

            CaseRecord caseRecord = caseRepository.findForUpdate(command.caseId());

            if (!caseRecord.canBeAssigned()) {
                inboxRepository.markIgnored(
                        consumerName,
                        messageId,
                        "STATE_NOT_APPLICABLE"
                );
                auditRepository.writeIgnoredMessage(command, "Case state is no longer assignable");
                return null;
            }

            OfficerId officerId = selectOfficer(command, caseRecord);
            caseRepository.assign(caseRecord.id(), officerId, caseRecord.version());

            auditRepository.writeStateChange(
                    "CASE_ASSIGNED",
                    caseRecord.id(),
                    command.correlationId(),
                    command.messageId()
            );

            inboxRepository.markProcessed(consumerName, messageId);
            return null;
        });
    }

    private OfficerId selectOfficer(AssignCaseCommand command, CaseRecord caseRecord) {
        // real implementation uses workload, eligibility, conflict rules
        return new OfficerId("OFFICER-123");
    }
}
```

### 11.2 Important invariant

Jika duplicate message datang setelah sukses pertama:

```text
inbox unique key catches duplicate
consumer exits successfully
message is acked
business state not changed again
```

Ini lebih baik daripada throw exception karena duplicate. Duplicate yang sudah diproses bukan error, melainkan expected distributed systems behavior.

---

## 12. State Machine Integration

Dalam case management, message handler sebaiknya tidak langsung mengubah status bebas.

Buruk:

```java
case.status = "APPROVED";
```

Lebih baik:

```java
case.transition(CaseTrigger.APPROVE, actor, reason);
```

State machine contoh:

```text
DRAFT
  -> SUBMITTED
  -> UNDER_REVIEW
  -> PENDING_INFORMATION
  -> UNDER_REVIEW
  -> RECOMMENDED_APPROVAL
  -> APPROVED
  -> NOTIFIED

UNDER_REVIEW
  -> ESCALATED
  -> LEGAL_REVIEW
  -> ENFORCEMENT_RECOMMENDED
  -> ENFORCEMENT_ISSUED
```

Message handler harus melakukan:

```text
load current state
validate trigger allowed
apply transition
persist new state/version
write audit
publish event through outbox
```

### 12.1 Command mapped to trigger

```text
ApproveCaseCommand -> APPROVE trigger
EscalateCaseCommand -> ESCALATE trigger
IssueEnforcementNoticeCommand -> ISSUE_NOTICE trigger
RequestMoreInformationCommand -> REQUEST_INFORMATION trigger
```

### 12.2 Event emitted after transition

```text
CaseApprovedEvent
CaseEscalatedEvent
EnforcementNoticeIssuedEvent
InformationRequestedEvent
```

### 12.3 Invalid command handling

Jika message datang saat state tidak applicable:

```text
Command: ApproveCaseCommand
Current state: WITHDRAWN
```

Jangan retry terus.

Classification:

```text
Permanent domain rejection
```

Action:

```text
mark inbox ignored/rejected
write audit
optionally emit CommandRejectedEvent
ack message
```

Jangan lempar exception yang membuat redelivery infinite.

---

## 13. Retry and DLQ Blueprint

### 13.1 Error classification

Setiap exception harus diklasifikasikan.

```text
Transient technical error:
- database connection timeout
- HTTP 503 from downstream
- broker temporary issue
- lock timeout
- network hiccup

Permanent technical error:
- schema cannot be parsed
- required field missing
- unknown message type
- unsupported version

Permanent domain error:
- command no longer applicable
- aggregate not found and should exist
- actor not authorized
- illegal state transition

Operationally repairable error:
- missing reference data
- downstream config missing
- temporary data mismatch
- external id mapping missing
```

### 13.2 Retry policy matrix

| Error Type | Retry? | DLQ? | Parking Lot? | Ack? | Notes |
|---|---:|---:|---:|---:|---|
| DB transient | yes | after cap | maybe | no before success | backoff |
| Downstream 503 | yes | after cap | maybe | no before success | protect downstream |
| Schema invalid | no | yes | no | after DLQ | needs producer fix |
| Unknown version | no | yes | maybe | after DLQ | compatibility issue |
| Illegal state transition | no | maybe audit only | no | yes | not technical failure |
| Missing reference data | limited | yes | yes | after parking | operator repair |
| Duplicate already processed | no | no | no | yes | success path |

### 13.3 DLQ design

DLQ message should preserve:

```text
original destination
original message id
correlation id
causation id
message type/version
failure timestamp
failure reason
exception class
consumer name
delivery count
last processing node
stack trace reference, not necessarily full huge trace in broker
```

### 13.4 Parking lot design

DLQ is for failed delivery/processing.

Parking lot is for messages that should not be retried automatically until human/system repair.

Example:

```text
Message cannot be processed because officer group mapping missing.
```

Do not retry every 5 seconds.

Move to:

```text
case.assignment.command.parking
```

After reference data is fixed:

```text
operator replays selected messages through governed replay workflow
```

---

## 14. Replay Governance Blueprint

Replay process:

```text
1. Operator opens DLQ/parking console.
2. Selects message or batch.
3. System shows message metadata, aggregate state, failure reason, replay risk.
4. Operator provides reason and ticket/change id.
5. System performs dry-run validation.
6. Approval if required.
7. System republishes to replay queue or original queue with replay metadata.
8. Consumer processes idempotently.
9. Audit records replay action and result.
```

### 14.1 Replay metadata

Add properties:

```text
isReplay = true
replayId = uuid
replayRequestedBy = user id
replayRequestedAt = timestamp
replayReason = text/ticket id
originalMessageId = original id
originalDestination = original queue/topic
replayAttempt = n
```

### 14.2 Never mutate original message silently

Bad:

```text
edit payload in DLQ and resend without trace
```

Better:

```text
create correction record
link original message
link corrected message
audit who changed what and why
```

### 14.3 Replay safety checks

Before replay:

```text
Does aggregate still exist?
Is current state compatible?
Was this message already processed?
Would replay violate version/order?
Is message schema still supported?
Is downstream dependency healthy?
Is replay within retention/legal boundary?
```

### 14.4 Replay destination strategy

Prefer dedicated replay queue for high-risk flows:

```text
case.assignment.command.replay.queue
```

Replay consumer can apply stricter rules:

- lower concurrency;
- stronger logging;
- manual approval;
- batch limit;
- dry-run first;
- no automatic cascading for certain actions.

---

## 15. SLA and Timer Blueprint

Regulated case management often has SLA timers.

Example:

```text
Case must be reviewed within 5 working days.
If not reviewed, escalate to supervisor.
```

Naive design:

```text
send JMS message with 5-day delivery delay
```

Problem:

- business calendar changes;
- holiday updates;
- case paused;
- case withdrawn;
- SLA recalculated;
- broker retention/persistence risk;
- operational visibility poor.

Better design:

```text
SLA table as source of truth
scheduled evaluator job scans due SLA
emits EscalateCaseCommand through outbox/JMS
```

Blueprint:

```text
case_state_change
  -> write sla_clock row
  -> outbox CaseSlaStartedEvent

sla_evaluator_job
  -> find due SLA rows
  -> validate current case state
  -> insert outbox EscalateCaseCommand

case_escalation_worker
  -> process command idempotently
  -> transition case
  -> audit
  -> publish CaseEscalatedEvent
```

### 15.1 SLA table

```sql
CREATE TABLE sla_clock (
    id              VARCHAR(64) PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    VARCHAR(100) NOT NULL,
    sla_type        VARCHAR(100) NOT NULL,
    status          VARCHAR(30) NOT NULL, -- RUNNING, PAUSED, COMPLETED, BREACHED, CANCELLED
    due_at          TIMESTAMP NOT NULL,
    calendar_id     VARCHAR(100),
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL,
    version         BIGINT NOT NULL
);

CREATE INDEX idx_sla_due
ON sla_clock(status, due_at);
```

Do not make broker delayed message the primary SLA database.

---

## 16. Notification Blueprint

Notifications are usually asynchronous and retryable.

Flow:

```text
CaseApprovedEvent
  -> notification projection decides recipients/templates
  -> NotificationEmailCommand
  -> notification.email.command.queue
  -> email sender worker
  -> NotificationDeliveryAttemptedEvent
```

Key decisions:

1. notification should not block case approval;
2. duplicate email may be unacceptable depending on content;
3. email provider failure is transient;
4. template rendering failure is permanent/config error;
5. recipient invalid may be permanent;
6. delivery status should be audited.

### 16.1 Notification idempotency

Use business idempotency key:

```text
notificationType + recipient + aggregateId + aggregateVersion
```

Example:

```text
CASE_APPROVED_EMAIL:applicant@example.com:CASE-2026-0001:42
```

Store:

```sql
CREATE TABLE notification_request (
    id                    VARCHAR(64) PRIMARY KEY,
    idempotency_key       VARCHAR(300) NOT NULL UNIQUE,
    aggregate_type        VARCHAR(100),
    aggregate_id          VARCHAR(100),
    recipient             VARCHAR(300) NOT NULL,
    channel               VARCHAR(50) NOT NULL,
    template_id           VARCHAR(100) NOT NULL,
    status                VARCHAR(30) NOT NULL,
    created_at            TIMESTAMP NOT NULL,
    last_attempt_at       TIMESTAMP,
    delivery_provider_id  VARCHAR(200)
);
```

---

## 17. Document Processing Blueprint

Document flows are often heavy and failure-prone.

Example:

```text
DocumentUploadedEvent
  -> virus scan command
  -> OCR command
  -> indexing command
  -> retention classification command
```

Do not put large binary documents directly in JMS message.

Use claim check pattern:

```json
{
  "messageType": "DocumentIndexCommand",
  "payload": {
    "documentId": "DOC-001",
    "storageRef": "s3://bucket/key-or-internal-ref",
    "checksum": "sha256:...",
    "contentType": "application/pdf",
    "sizeBytes": 10485760
  }
}
```

Message carries reference, not binary payload.

Security requirement:

- storageRef must be access-controlled;
- checksum validates integrity;
- PII classification propagated;
- document access audited;
- processing result linked to document version.

---

## 18. Security Blueprint

### 18.1 Authentication

Each service should use distinct broker credential.

```text
case-service-producer
case-assignment-worker
notification-worker
document-worker
ops-replay-service
```

Avoid shared superuser credential.

### 18.2 Authorization

Destination-level ACL:

| Principal | Send | Consume | Manage |
|---|---|---|---|
| case-service | case.*.event.topic, case.*.command.queue | limited | no |
| notification-worker | notification.*.event.topic | notification.email.command.queue | no |
| ops-replay-service | replay queues | DLQ/parking selected | limited |
| admin | controlled | controlled | yes with MFA/change control |

### 18.3 TLS/mTLS

Use TLS for broker connections. For high-regulation environment, consider mTLS or broker-level client certificate mapping.

### 18.4 Secret handling

Do:

```text
- store broker credentials in secret manager
- rotate credentials
- use least privilege
- avoid credentials in application properties committed to git
- audit credential usage
```

Do not:

```text
- embed broker password in image
- share one credential for all services
- give all consumers admin permission
```

### 18.5 Message confidentiality

Transport TLS protects in transit. It does not protect:

- broker storage;
- DLQ inspection;
- logs;
- exported message archive;
- operator console;
- backup.

For sensitive payload:

- minimize PII;
- use reference token instead of full data;
- encrypt payload field when necessary;
- redact logs;
- protect DLQ access.

---

## 19. Observability Blueprint

### 19.1 Metrics

Broker metrics:

```text
queue_depth
enqueue_rate
dequeue_rate
consumer_count
redelivery_count
DLQ_depth
expired_message_count
paging_active
journal_latency
connection_count
```

Application metrics:

```text
message_processing_duration
message_processing_success_total
message_processing_failure_total
message_duplicate_total
message_ignored_total
message_replayed_total
outbox_lag_seconds
outbox_publish_failure_total
inbox_insert_conflict_total
handler_retry_total
```

Business metrics:

```text
case_assignment_lag
case_escalation_lag
notification_delivery_lag
sla_breach_count
pending_case_count_by_state
DLQ_count_by_message_type
```

### 19.2 Logs

Every processing log should include:

```text
messageId
messageType
messageVersion
correlationId
causationId
aggregateType
aggregateId
consumerName
destination
redeliveryCount
traceId
```

Example structured log:

```json
{
  "level": "INFO",
  "event": "message.processed",
  "messageId": "msg-001",
  "messageType": "AssignCaseCommand",
  "correlationId": "corr-991",
  "aggregateId": "CASE-2026-0001",
  "consumerName": "case-assignment-worker",
  "durationMs": 87,
  "result": "SUCCESS"
}
```

### 19.3 Trace

Async boundary breaks naive tracing.

Propagate:

```text
traceparent
tracestate
correlationId
causationId
```

Model span:

```text
HTTP request span
  -> DB transaction span
  -> outbox insert span
  -> outbox relay publish span
  -> broker enqueue
  -> consumer receive span
  -> handler DB span
  -> downstream call span
```

### 19.4 Forensic dashboard

Given `CASE-2026-0001`, operator should see:

```text
case state timeline
audit events
outbox messages
JMS messages
consumer processing attempts
DLQ entries
replay actions
notification attempts
SLA clock changes
```

The question should be answerable:

```text
Why did this case become ESCALATED?
Who/what caused it?
Which message triggered it?
Was it retried or replayed?
Was any duplicate ignored?
Was notification sent?
```

---

## 20. Operational Console Blueprint

Ops console should not expose raw broker power only.

It should expose governed actions.

### 20.1 DLQ triage view

Fields:

```text
message id
message type
version
source service
original destination
aggregate id
correlation id
first failed at
last failed at
delivery count
failure class
failure reason
current aggregate state
suggested action
```

### 20.2 Suggested action engine

Example:

```text
SchemaInvalidException -> reject/archive, notify producer owner
ReferenceDataMissing -> parking lot, request data fix
DatabaseTimeout -> retry after dependency healthy
IllegalStateTransition -> mark ignored/rejected, audit
ExternalProvider503 -> retry with backoff
```

### 20.3 Actions

Supported actions:

```text
view message
view aggregate state
view correlation timeline
move to parking
request replay approval
replay selected
replay batch
archive as rejected
attach operator note
export evidence packet
```

Every action writes audit.

---

## 21. Architecture for Multi-Tenant / Multi-Agency Environment

Possible strategies:

### 21.1 Separate broker per tenant

Pros:

- strong isolation;
- easier blast-radius control;
- separate credentials;
- simpler retention/legal boundary.

Cons:

- operational overhead;
- more deployment complexity;
- harder shared services.

### 21.2 Shared broker, separate destinations

```text
agency-a.case.assignment.command.queue
agency-b.case.assignment.command.queue
```

Pros:

- simpler infra footprint;
- moderate isolation;
- destination ACL possible.

Cons:

- many destinations;
- naming complexity;
- risk of misconfigured ACL.

### 21.3 Shared destination with tenantId selector

```text
case.assignment.command.queue
property tenantId = agency-a
```

Usually weaker isolation.

Risk:

- selector mistake;
- noisy neighbor;
- operational confusion;
- harder DLQ separation.

For regulated systems, prefer either:

```text
separate broker per high-isolation tenant
```

or:

```text
shared broker with separate destinations and strict ACL
```

Avoid relying only on selectors for security isolation.

---

## 22. Deployment Topology Blueprint

### 22.1 Minimal production topology

```text
2+ application instances per service
JMS broker HA pair/cluster depending provider
persistent storage
DLQ configured per critical destination
monitoring + alerting
backup/restore tested
runbook tested
```

### 22.2 Kubernetes topology

```text
StatefulSet broker
PersistentVolumeClaims
PodDisruptionBudget
anti-affinity
readiness/liveness probes
stable service names
TLS secrets
broker config ConfigMap/Secret
separate worker deployments
HPA for consumers based on queue depth/custom metrics
```

### 22.3 Consumer scaling rule

Scale consumers when:

```text
arrival rate > processing rate
queue depth increasing
consumer CPU/memory not saturated
DB/downstream has headroom
ordering constraints allow concurrency
```

Do not scale consumers when DB is already bottleneck.

That only converts queue backlog into database overload.

---

## 23. Capacity Blueprint

For each queue define:

```text
arrival_rate_per_second
average_processing_time_ms
p95_processing_time_ms
max_acceptable_lag_seconds
max_queue_depth
consumer_concurrency
prefetch/window
retry_rate
DLQ_rate
payload_size
```

Example:

```text
Queue: case.assignment.command.queue
Arrival: 20 msg/s peak
Average processing: 80 ms
p95 processing: 250 ms
SLA lag: < 60 seconds
Consumer concurrency: 8
DB max safe TPS for this handler: 200 TPS
Prefetch: modest, e.g. 10-50 depending provider
Retry cap: 5 attempts
DLQ alert threshold: > 0 for critical messages
```

### 23.1 Capacity math

If one consumer thread processes average 80 ms/message:

```text
capacity/thread = 1000 / 80 = 12.5 msg/s
```

With 8 threads:

```text
capacity = 100 msg/s theoretical
```

But real capacity is bounded by:

- DB locks;
- downstream calls;
- broker dispatch;
- serialization;
- network;
- GC;
- transaction cost.

Use load test and production metrics.

---

## 24. Java Version Strategy: 8 sampai 25

### 24.1 Java 8 baseline

Constraints:

- no records;
- no var;
- no virtual threads;
- older TLS defaults depending runtime;
- older GC options;
- older library compatibility.

Use:

- explicit DTO classes;
- try-with-resources;
- executor pools carefully;
- JMS 1.1/2.0 depending provider;
- strong test coverage.

### 24.2 Java 11/17

Better baseline for enterprise:

- stronger runtime;
- modern TLS;
- better GC options;
- records available from Java 16+;
- better observability tooling.

### 24.3 Java 21/25

Virtual threads can help blocking workloads, but not magically fix JMS session rules.

Use virtual threads carefully for:

- blocking side-effect orchestration;
- request/reply waiting;
- outbox relay workers;
- administrative replay jobs.

Be careful:

- JMS `Session` is still not freely shared concurrently;
- provider client may use internal blocking/locking;
- broker and DB remain bottlenecks;
- concurrency explosion can overload downstream.

Blueprint rule:

```text
Virtual threads reduce cost of waiting; they do not remove the need for capacity control.
```

---

## 25. Spring Boot Blueprint

For Spring-based services:

```text
REST Controller
  -> Application Service
  -> Domain Model
  -> Repository
  -> Outbox Writer
  -> Transaction Commit

OutboxRelay @Scheduled / worker
  -> JmsTemplate
  -> broker

@JmsListener
  -> InboxService
  -> Handler
  -> AuditService
```

### 25.1 Listener transaction sketch

```java
@Component
public class CaseAssignmentSpringListener {
    private final CaseAssignmentHandler handler;

    public CaseAssignmentSpringListener(CaseAssignmentHandler handler) {
        this.handler = handler;
    }

    @JmsListener(destination = "case.assignment.command.queue", containerFactory = "caseListenerFactory")
    public void onMessage(String payload,
                          @Header("messageId") String messageId,
                          @Header("JMSCorrelationID") String correlationId) {
        handler.handle(payload, messageId, correlationId);
    }
}
```

Critical config:

- listener container concurrency;
- session transacted or transaction manager;
- error handler;
- backoff;
- message converter;
- connection factory caching;
- shutdown timeout;
- observation/tracing integration.

Do not hide all complexity behind `@JmsListener`. The annotation starts consumption, but correctness is in handler design.

---

## 26. Jakarta EE Blueprint

For Jakarta EE runtime:

```text
@MessageDriven MDB
  -> injected service
  -> container-managed transaction
  -> resource adapter
  -> broker
```

Conceptual MDB:

```java
@MessageDriven(activationConfig = {
        @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/caseAssignmentQueue"),
        @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue")
})
public class CaseAssignmentMdb implements MessageListener {
    @Inject
    CaseAssignmentApplicationService service;

    @Override
    public void onMessage(Message message) {
        service.handle(message);
    }
}
```

Blueprint concern:

- activation config provider-specific;
- concurrency/pool controlled by container;
- transaction rollback can trigger redelivery;
- resource adapter config is operationally important;
- deployment descriptors may matter;
- observability must be explicit.

---

## 27. Governance Checklist

### 27.1 Before adding a new queue

Ask:

```text
What work does this queue represent?
Who owns the consumer?
Is ordering required?
What is retry policy?
What is DLQ policy?
What is max acceptable lag?
What is idempotency key?
What audit is required?
What metrics/alerts are required?
What is replay policy?
```

### 27.2 Before adding a new topic

Ask:

```text
What fact does this event represent?
Who owns the schema?
Is it domain or integration event?
What compatibility policy?
What consumers exist?
What happens to late subscribers?
Is event replay expected?
Does payload contain PII?
What retention applies?
```

### 27.3 Before enabling replay

Ask:

```text
Can handler safely process duplicate?
Can current aggregate state reject stale message safely?
Is operator action audited?
Is replay batch bounded?
Is downstream healthy?
Is there approval for high-impact replay?
```

---

## 28. Example End-to-End Flow: Case Approval

### 28.1 User approves case

```text
Officer clicks Approve
  -> REST API
  -> CaseService.approveCase
  -> DB tx:
       update case status UNDER_REVIEW -> APPROVED
       insert audit_event CASE_APPROVED
       insert outbox CaseApprovedEvent
     commit
  -> response to user
```

### 28.2 Event publication

```text
OutboxRelay
  -> reads CaseApprovedEvent
  -> sends to case.lifecycle.event.topic
  -> marks outbox published
```

### 28.3 Notification consumer

```text
NotificationProjection
  -> receives CaseApprovedEvent
  -> inbox dedup
  -> creates notification_request if absent
  -> inserts outbox NotificationEmailCommand
  -> commit
```

### 28.4 Email worker

```text
EmailWorker
  -> receives NotificationEmailCommand
  -> inbox dedup
  -> sends email provider
  -> updates notification_request
  -> audit delivery attempt
  -> publish NotificationDeliveryAttemptedEvent
```

### 28.5 SLA consumer

```text
SLAService
  -> receives CaseApprovedEvent
  -> completes review SLA clock
  -> starts notification SLA if needed
```

### 28.6 Failure case

If email provider down:

```text
EmailWorker throws transient exception
broker redelivers with backoff
after max attempts -> notification.email.command.dlq
ops sees DLQ
operator waits until provider healthy
replay selected message
inbox/idempotency avoids duplicate request corruption
```

---

## 29. Example End-to-End Flow: Case Escalation by SLA

```text
SLAClock due
  -> SLA evaluator job claims due clock
  -> validates case still UNDER_REVIEW
  -> writes EscalateCaseCommand to outbox
  -> relay publishes command queue
  -> case escalation worker consumes
  -> inbox dedup
  -> state transition UNDER_REVIEW -> ESCALATED
  -> audit CASE_ESCALATED
  -> outbox CaseEscalatedEvent
```

Failure handling:

```text
If case already APPROVED before escalation command processed:
  command no longer applicable
  mark inbox ignored
  audit ignored stale escalation
  ack message
```

This is correct. Not every ignored message is a failure.

---

## 30. Common Anti-Patterns in Production Blueprint

### 30.1 Direct publish inside DB transaction without outbox

```text
update DB
send JMS
commit DB
```

Failure between send and commit can publish event for state that never committed.

### 30.2 Ack before durable side effect

```text
ack
update DB
```

Failure loses work.

### 30.3 Infinite retry for permanent error

Schema invalid message should not retry forever.

### 30.4 Topic as command bus

Publishing `ApproveCase` to topic causes multiple consumers to think they should approve.

### 30.5 Business state hidden in broker

Broker queue depth is not a case state machine.

### 30.6 Replay without idempotency

Replay becomes data corruption tool.

### 30.7 One mega queue

```text
all.messages.queue
```

This destroys ownership, alerting, scaling, and failure isolation.

### 30.8 Overusing selectors for routing

Selectors are filtering, not a full business routing engine.

### 30.9 Large payload in message

Huge document payload causes broker storage/memory/network pressure.

### 30.10 DLQ nobody owns

A DLQ without owner and SLA is just delayed data loss.

---

## 31. Production Readiness Checklist

### 31.1 Message design

- [ ] Every message has `messageId`.
- [ ] Every message has `correlationId`.
- [ ] Every message has `messageType` and `messageVersion`.
- [ ] Every message has owner service.
- [ ] Payload schema is versioned.
- [ ] PII classification is known.
- [ ] Large binary payload uses claim check.

### 31.2 Producer

- [ ] Business state and outbox insert in one DB transaction.
- [ ] Outbox relay is idempotent.
- [ ] Publish failures are retried with backoff.
- [ ] Outbox lag is monitored.
- [ ] Poison outbox rows have operational path.

### 31.3 Consumer

- [ ] Inbox dedup exists.
- [ ] Handler is idempotent.
- [ ] State transition validates current state.
- [ ] Audit is written.
- [ ] Ack happens after durable success.
- [ ] Permanent vs transient errors are classified.

### 31.4 Broker

- [ ] Persistent delivery for critical messages.
- [ ] DLQ configured.
- [ ] Redelivery cap configured.
- [ ] Redelivery delay/backoff configured.
- [ ] Expiry policy configured where needed.
- [ ] Queue depth alerts exist.
- [ ] Broker storage alerts exist.

### 31.5 Operations

- [ ] DLQ owner defined.
- [ ] DLQ triage runbook exists.
- [ ] Replay process is governed.
- [ ] Operator actions audited.
- [ ] Backup/restore tested.
- [ ] Failover tested.
- [ ] Load test completed.

### 31.6 Security

- [ ] Service-specific credentials.
- [ ] Destination-level ACL.
- [ ] TLS enabled.
- [ ] Secret rotation defined.
- [ ] DLQ access restricted.
- [ ] Payload/log redaction implemented.

### 31.7 Observability

- [ ] Correlation ID propagated.
- [ ] Structured logs include message metadata.
- [ ] Metrics for queue depth and lag.
- [ ] Metrics for processing success/failure.
- [ ] Tracing across async boundary.
- [ ] Audit timeline available per aggregate.

---

## 32. Mental Model Akhir

Blueprint production JMS yang benar bukan:

```text
send message and hope consumer runs
```

Blueprint production JMS yang benar adalah:

```text
persist state transition
record intent/fact in outbox
publish reliably
consume idempotently
validate current state
commit side effect durably
ack after success
route failure intentionally
observe every step
govern replay
preserve auditability
```

Dalam regulated case management, JMS bukan pusat kebenaran domain. JMS adalah **transport and coordination fabric**.

Source of truth tetap:

```text
domain database + state machine + audit trail + governed replay history
```

Broker membantu sistem menjadi asynchronous dan resilient. Tetapi tanpa outbox, inbox, idempotency, DLQ ownership, audit, dan replay governance, broker hanya memindahkan kompleksitas ke tempat yang lebih sulit dilihat.

---

## 33. Ringkasan

Part ini menyusun reference architecture JMS untuk sistem enterprise regulated case management.

Poin utama:

1. JMS/Jakarta Messaging adalah API komunikasi asynchronous reliable/loosely-coupled, bukan arsitektur lengkap.
2. Queue cocok untuk command/work; topic cocok untuk event/fact.
3. Outbox menjaga state change dan message publication tetap recoverable.
4. Inbox menjaga consumer idempotent dan duplicate-safe.
5. Ack harus mengikuti durable side effect.
6. Retry harus berdasarkan klasifikasi error.
7. DLQ harus punya owner, SLA, triage, dan replay process.
8. Replay harus governed dan audited.
9. State machine menjaga legal/regulatory transition tetap valid.
10. Observability harus memungkinkan forensic timeline per case/message/correlation.
11. Security harus mencakup credential, ACL, TLS, confidentiality, dan audit operator.
12. Production readiness bukan hanya kode consumer, tetapi juga broker config, database schema, metrics, runbook, dan governance.

---

## 34. Referensi

- Jakarta Messaging 3.1 Specification — API untuk aplikasi Java membuat, mengirim, menerima message melalui komunikasi asynchronous reliable dan loosely-coupled.
- ActiveMQ Artemis Documentation — redelivery, undelivered messages, dead letter address, address settings, management operations, persistence, broker operation.
- Enterprise Integration Patterns — vocabulary dan pattern umum untuk messaging dan enterprise integration.

---

## 35. Status Seri

Seri belum selesai.

Progress:

```text
Selesai: Part 0 sampai Part 34
Tersisa: Part 35
```

Part berikutnya:

```text
Part 35 — Final Mastery: Design Review Checklist, Interview-Level Reasoning, dan Top 1% Engineering Heuristics
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-033.md">⬅️ Learn Java JMS / Jakarta Messaging Enterprise Message-Oriented Middleware Engineering — Part 33</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-035.md">Part 35 — Final Mastery: Design Review Checklist, Interview-Level Reasoning, dan Top 1% Engineering Heuristics ➡️</a>
</div>

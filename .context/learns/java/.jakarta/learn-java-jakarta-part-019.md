# learn-java-jakarta-part-019.md

# Bagian 19 — Jakarta Messaging (`jakarta.jms`): Queue, Topic, Reliability, dan Event-Driven Boundary

> Target pembaca: Java engineer yang ingin memahami Jakarta Messaging / JMS bukan hanya “kirim pesan ke queue”, tetapi sebagai **asynchronous communication model** untuk sistem enterprise: decoupling, reliability, backpressure, delivery guarantee, acknowledgment, transaction, redelivery, dead-letter queue, ordering, idempotency, dan observability.
>
> Fokus bagian ini: Jakarta Messaging 3.1 API (`jakarta.jms`), mental model messaging, queue vs topic, producer/consumer, `JMSContext`, `JMSProducer`, `JMSConsumer`, message types, headers/properties, acknowledgment, transactions, durable subscription, MDB, request-reply, retry/DLQ, idempotency, outbox, testing, performance, dan failure modes production.

---

## Daftar Isi

1. [Orientasi: Kenapa Messaging Penting?](#1-orientasi-kenapa-messaging-penting)
2. [Mental Model: Message-Oriented Middleware](#2-mental-model-message-oriented-middleware)
3. [Jakarta Messaging 3.1 dan Package `jakarta.jms`](#3-jakarta-messaging-31-dan-package-jakartajms)
4. [Messaging vs REST vs Event Streaming](#4-messaging-vs-rest-vs-event-streaming)
5. [Provider, Broker, Resource Adapter, dan Runtime](#5-provider-broker-resource-adapter-dan-runtime)
6. [Dependency dan Packaging](#6-dependency-dan-packaging)
7. [Core Concepts: Destination, Queue, Topic, Message, Producer, Consumer](#7-core-concepts-destination-queue-topic-message-producer-consumer)
8. [Queue: Point-to-Point Messaging](#8-queue-point-to-point-messaging)
9. [Topic: Publish/Subscribe Messaging](#9-topic-publishsubscribe-messaging)
10. [Temporary Queue/Topic dan Request-Reply](#10-temporary-queuetopic-dan-request-reply)
11. [JMSContext: Simplified API](#11-jmscontext-simplified-api)
12. [ConnectionFactory dan Administered Objects](#12-connectionfactory-dan-administered-objects)
13. [JMSProducer: Mengirim Pesan](#13-jmsproducer-mengirim-pesan)
14. [JMSConsumer: Menerima Pesan](#14-jmsconsumer-menerima-pesan)
15. [Message Listener: Async Consumption](#15-message-listener-async-consumption)
16. [Message-Driven Bean / MDB](#16-message-driven-bean--mdb)
17. [Message Types](#17-message-types)
18. [Message Headers](#18-message-headers)
19. [Message Properties](#19-message-properties)
20. [Message Selectors](#20-message-selectors)
21. [Delivery Mode: Persistent vs Non-Persistent](#21-delivery-mode-persistent-vs-non-persistent)
22. [Priority, TTL, Expiration, Delay](#22-priority-ttl-expiration-delay)
23. [Acknowledgment Modes](#23-acknowledgment-modes)
24. [Transactions dalam Jakarta Messaging](#24-transactions-dalam-jakarta-messaging)
25. [JMS + JTA: Atomic Message dan Database Operation](#25-jms--jta-atomic-message-dan-database-operation)
26. [Redelivery, Retry, Poison Message, dan DLQ](#26-redelivery-retry-poison-message-dan-dlq)
27. [Ordering Guarantees](#27-ordering-guarantees)
28. [Idempotency: Kunci Reliability](#28-idempotency-kunci-reliability)
29. [Exactly-Once: Mitos dan Realita](#29-exactly-once-mitos-dan-realita)
30. [Outbox Pattern vs XA Transaction](#30-outbox-pattern-vs-xa-transaction)
31. [Saga dan Process Manager](#31-saga-dan-process-manager)
32. [Request-Reply over JMS](#32-request-reply-over-jms)
33. [Correlation ID dan Traceability](#33-correlation-id-dan-traceability)
34. [Message Contract Design](#34-message-contract-design)
35. [Schema Evolution dan Versioning](#35-schema-evolution-dan-versioning)
36. [Security](#36-security)
37. [Performance Engineering](#37-performance-engineering)
38. [Observability](#38-observability)
39. [Testing Strategy](#39-testing-strategy)
40. [Production Failure Modes](#40-production-failure-modes)
41. [Best Practices dan Anti-Patterns](#41-best-practices-dan-anti-patterns)
42. [Checklist Review](#42-checklist-review)
43. [Case Study 1: Email Notification Queue](#43-case-study-1-email-notification-queue)
44. [Case Study 2: Compliance Event Topic](#44-case-study-2-compliance-event-topic)
45. [Case Study 3: Poison Message dan DLQ](#45-case-study-3-poison-message-dan-dlq)
46. [Case Study 4: Outbox untuk Database + Message Reliability](#46-case-study-4-outbox-untuk-database--message-reliability)
47. [Latihan Bertahap](#47-latihan-bertahap)
48. [Mini Project: Jakarta Messaging Reliability Lab](#48-mini-project-jakarta-messaging-reliability-lab)
49. [Referensi Resmi](#49-referensi-resmi)

---

# 1. Orientasi: Kenapa Messaging Penting?

Sistem enterprise jarang hanya request-response synchronous.

Contoh flow:

```text
User submit application
  ↓
application saved
  ↓
send email
  ↓
generate document
  ↓
sync to external agency
  ↓
audit event
  ↓
update reporting read model
```

Jika semuanya dilakukan synchronous dalam satu HTTP request:

```text
HTTP request waits for DB + email + document + external API + report update
```

Masalah:

- latency tinggi;
- user experience buruk;
- dependency failure menggagalkan request;
- retry sulit;
- coupling tinggi;
- scaling sulit;
- external dependency menjadi bottleneck;
- transaction terlalu panjang;
- observability rumit.

Messaging memungkinkan decoupling:

```text
application saved
  ↓
publish message/event/command
  ↓
workers process asynchronously
```

## 1.1 Apa yang messaging selesaikan?

Messaging membantu:

- asynchronous processing;
- temporal decoupling;
- load leveling;
- retry;
- buffering saat downstream lambat;
- fan-out;
- integration antar aplikasi;
- failure isolation;
- workflow orchestration;
- event-driven architecture.

## 1.2 Apa yang messaging tidak selesaikan otomatis?

Messaging tidak otomatis menyelesaikan:

- idempotency;
- schema evolution;
- ordering across partitions/consumers;
- exactly-once business effect;
- poison message;
- duplicate delivery;
- distributed transaction complexity;
- observability;
- security;
- data contract governance.

Messaging memberi alat. Reliability tetap perlu desain.

## 1.3 Jakarta Messaging

Jakarta Messaging adalah standard API Jakarta untuk membuat, mengirim, menerima, dan membaca pesan enterprise messaging.

Package modern:

```java
jakarta.jms
```

Sebelumnya dikenal sebagai JMS / Java Message Service.

---

# 2. Mental Model: Message-Oriented Middleware

Message-Oriented Middleware / MOM adalah middleware yang memfasilitasi komunikasi lewat pesan.

## 2.1 Basic model

```text
Producer
  ↓ send message
Broker / Provider
  ↓ deliver message
Consumer
```

## 2.2 Producer

Producer membuat dan mengirim message.

Contoh:

```text
Application service sends EmailRequested command
```

## 2.3 Broker/provider

Broker menyimpan, mengatur, dan mengirim message.

Contoh provider/broker:

- ActiveMQ Artemis;
- IBM MQ;
- OpenMQ;
- RabbitMQ JMS adapter;
- vendor Jakarta EE messaging provider;
- broker dengan resource adapter.

## 2.4 Consumer

Consumer menerima dan memproses message.

Contoh:

```text
Email worker consumes EmailRequested
```

## 2.5 Destination

Message dikirim ke destination:

- queue;
- topic.

## 2.6 Loose coupling

Producer tidak perlu tahu consumer langsung.

Producer hanya tahu destination dan message contract.

## 2.7 Temporal decoupling

Consumer tidak harus online saat producer mengirim.

Jika persistent queue dan broker tersedia, message bisa disimpan untuk diproses nanti.

## 2.8 Failure model

Messaging introduces new failure modes:

- duplicate message;
- delayed message;
- out-of-order message;
- poison message;
- stuck consumer;
- full queue;
- broker outage;
- DLQ accumulation.

Engineer kuat mendesain untuk failure ini.

---

# 3. Jakarta Messaging 3.1 dan Package `jakarta.jms`

Jakarta Messaging 3.1 mendefinisikan API standard untuk Java programs membuat, mengirim, menerima, dan membaca messages dari enterprise messaging system.

Package utama:

```java
jakarta.jms
```

## 3.1 Modern API

Sejak JMS 2.0, API simplified diperkenalkan:

```java
JMSContext
JMSProducer
JMSConsumer
```

Ini lebih ringkas dibanding classic API:

```java
Connection
Session
MessageProducer
MessageConsumer
```

## 3.2 Jakarta namespace

Old:

```java
javax.jms
```

New:

```java
jakarta.jms
```

Migration Jakarta EE modern perlu mengganti namespace.

## 3.3 Jakarta Messaging 3.1 release note

Jakarta Messaging 3.1 adalah release yang menjaga API modern dan melakukan update seperti repeatable annotation untuk connection factory dan destination definition.

## 3.4 Jakarta EE profile caution

Messaging biasanya bagian dari full Platform atau runtime yang menyediakan messaging provider/resource adapter.

Tidak semua minimal profile/cloud runtime menyediakan broker/JMS provider out of the box.

Selalu cek runtime yang dipakai.

## 3.5 API jar bukan broker

`jakarta.jms-api` hanya API.

Kamu tetap membutuhkan:

- Jakarta Messaging provider;
- broker;
- connection factory;
- destination configuration;
- resource adapter jika di app server.

---

# 4. Messaging vs REST vs Event Streaming

## 4.1 REST

REST cocok untuk synchronous request-response:

```text
Client asks service for current data
```

Example:

```http
GET /cases/123
```

## 4.2 Messaging queue

Queue cocok untuk asynchronous work distribution:

```text
Submit command to be processed by one consumer
```

Example:

```text
EmailRequested queue
```

## 4.3 Topic

Topic cocok untuk fan-out events:

```text
One event broadcast to multiple subscribers
```

Example:

```text
CaseApproved topic
  → notification subscriber
  → reporting subscriber
  → audit subscriber
```

## 4.4 Event streaming

Kafka-like event streaming cocok untuk append-only log, replay, stream processing, high-throughput events.

JMS topic tidak selalu sama dengan event stream log.

## 4.5 Decision table

| Need | Good fit |
|---|---|
| Immediate query result | REST |
| Background job | Queue |
| One message to one worker | Queue |
| Broadcast event to multiple systems | Topic |
| Durable replayable event log | Event streaming platform |
| Request with async completion | Queue + status API / callback |
| Integration with legacy enterprise broker | Jakarta Messaging |
| Complex stream processing | Kafka/Flink/etc. |

## 4.6 Don't force everything into messaging

If caller needs immediate answer, message may add complexity.

If event must be replayed for months, queue/topic may not be enough.

---

# 5. Provider, Broker, Resource Adapter, dan Runtime

## 5.1 Provider

Jakarta Messaging provider implements API.

It may be:

- broker client library;
- app server integrated messaging;
- resource adapter to external broker.

## 5.2 Broker

Broker is server/middleware that stores/routes messages.

## 5.3 Resource adapter

In Jakarta EE, resource adapter integrates external EIS/broker with app server through Jakarta Connectors.

## 5.4 Administered objects

Connection factories and destinations are often administered/configured by operations/runtime, not created dynamically in app code.

Examples:

```text
jms/CaseConnectionFactory
jms/EmailQueue
jms/CaseEventTopic
```

## 5.5 Why administered objects?

Because production config includes:

- broker URL;
- credentials;
- TLS;
- pooling;
- reconnect;
- destination physical name;
- DLQ policy;
- redelivery policy;
- resource adapter config.

Application code should not hardcode broker internals.

## 5.6 Runtime integration

Jakarta EE runtime can manage:

- connection pooling;
- transactions;
- MDB activation;
- injection;
- resource lifecycle;
- security;
- monitoring.

---

# 6. Dependency dan Packaging

## 6.1 Maven API dependency

```xml
<dependency>
  <groupId>jakarta.jms</groupId>
  <artifactId>jakarta.jms-api</artifactId>
  <version>3.1.0</version>
  <scope>provided</scope>
</dependency>
```

## 6.2 In Jakarta EE runtime

If deployed to runtime with Messaging support, API should be provided.

Use `provided`.

## 6.3 Standalone client

For standalone Java client, you need:

- `jakarta.jms-api`;
- provider client library;
- broker connection config.

## 6.4 Do not bundle duplicate API into WAR/EAR

If server provides API, bundling another API jar can cause classloading issues.

## 6.5 Provider-specific dependencies

Example provider clients differ:

- Artemis client;
- IBM MQ Jakarta client;
- OpenMQ;
- etc.

These are implementation dependencies.

## 6.6 Config separation

Keep:

```text
API dependency
```

separate from:

```text
broker/provider configuration
```

and:

```text
message contract
```

---

# 7. Core Concepts: Destination, Queue, Topic, Message, Producer, Consumer

## 7.1 Destination

Destination is where message is sent.

Types:

```java
Queue
Topic
```

## 7.2 Queue

Point-to-point.

Each message consumed by one consumer.

## 7.3 Topic

Publish-subscribe.

Each subscriber can receive copy.

## 7.4 Message

Envelope containing:

- header;
- properties;
- body.

## 7.5 Producer

Sends messages.

Simplified API:

```java
JMSProducer producer = context.createProducer();
producer.send(queue, "hello");
```

## 7.6 Consumer

Receives messages.

```java
JMSConsumer consumer = context.createConsumer(queue);
String body = consumer.receiveBody(String.class);
```

## 7.7 JMSContext

Combines connection and session.

It is central simplified API.

---

# 8. Queue: Point-to-Point Messaging

Queue means:

```text
one message → one consumer
```

## 8.1 Use cases

- email sending;
- document generation;
- batch job task;
- payment command;
- integration command;
- retryable background work.

## 8.2 Competing consumers

Multiple consumers can read same queue.

Broker distributes messages.

```text
EmailQueue
  → worker 1
  → worker 2
  → worker 3
```

Each message should go to only one worker.

## 8.3 Scaling

Add consumers to scale throughput.

But consider:

- ordering;
- concurrency;
- DB contention;
- downstream rate limit;
- idempotency.

## 8.4 Queue depth

Queue depth is backpressure signal.

If depth grows:

- producer faster than consumer;
- consumer failing;
- broker issue;
- downstream slow;
- poison message loop.

## 8.5 Queue is not database

Do not use queue as long-term storage.

Use database/event store for durable business record.

---

# 9. Topic: Publish/Subscribe Messaging

Topic means:

```text
one message → many subscribers
```

## 9.1 Use cases

- domain event fan-out;
- audit event broadcast;
- read model update;
- integration event;
- cache invalidation;
- notification event.

## 9.2 Non-durable subscription

Subscriber only receives while active.

Good for:

- transient updates;
- local cache invalidation;
- live dashboard.

## 9.3 Durable subscription

Subscriber receives messages even if temporarily offline, subject to broker retention/policy.

Good for:

- important integration;
- event consumers that must catch up.

## 9.4 Shared durable subscription

Modern JMS supports shared durable subscription patterns where multiple consumers can share a durable subscription.

Useful for scaling topic subscriber group.

## 9.5 Topic not always replay log

Durable topic retains messages for subscriptions according to broker policy.

It is not automatically equivalent to Kafka topic with long replay retention.

## 9.6 Subscriber identity

Durable subscription needs stable identity.

Changing client/subscription name can create duplicate backlog or miss messages.

---

# 10. Temporary Queue/Topic dan Request-Reply

Temporary destination exists for lifetime of connection/context.

## 10.1 Use case

Request-reply over JMS:

```text
client sends request to service queue
sets JMSReplyTo = temporary queue
sets JMSCorrelationID
service replies to temporary queue
client waits for reply
```

## 10.2 Example flow

```text
Client
  ↓ request message
RequestQueue
  ↓
Service Consumer
  ↓ reply
TemporaryQueue
  ↓
Client receives response
```

## 10.3 Caution

Request-reply over messaging can reintroduce synchronous coupling.

If caller waits, you still have latency/timeout issues.

## 10.4 Better for long work

For long-running process:

```text
POST request returns 202 Accepted + operation ID
worker processes asynchronously
client polls/subscribes for status
```

## 10.5 Timeouts

Always set timeout for reply wait.

Never block indefinitely.

---

# 11. JMSContext: Simplified API

`JMSContext` combines connection and session in a single object and provides active connection plus single-threaded context for sending and receiving messages.

## 11.1 Creating application-managed context

```java
try (JMSContext context = connectionFactory.createContext()) {
    context.createProducer().send(queue, "Hello");
}
```

Application-managed `JMSContext` must be closed.

## 11.2 Container-managed injection

In Jakarta EE environment, you may inject:

```java
@Inject
JMSContext context;
```

depending runtime/provider integration.

## 11.3 Single-threaded context

`JMSContext` represents session-like context. Do not share same context across concurrent threads unless provider explicitly permits.

Use per-thread/per-operation context.

## 11.4 Methods create objects

Use `JMSContext` to create:

- producers;
- consumers;
- messages;
- queue browsers;
- temporary destinations.

## 11.5 Classic API still exists

Classic:

```java
Connection
Session
MessageProducer
MessageConsumer
```

Simplified API is preferred for new code unless classic behavior needed.

## 11.6 Context lifecycle

Application-managed:

```text
create → use → close
```

Container-managed:

```text
container owns lifecycle
```

Do not close injected container-managed context unless spec/provider says so.

---

# 12. ConnectionFactory dan Administered Objects

## 12.1 ConnectionFactory

Factory for creating connection/context.

```java
@Resource(lookup = "jms/CaseConnectionFactory")
ConnectionFactory connectionFactory;
```

## 12.2 Queue injection

```java
@Resource(lookup = "jms/EmailQueue")
Queue emailQueue;
```

## 12.3 Topic injection

```java
@Resource(lookup = "jms/CaseEventTopic")
Topic caseEventTopic;
```

## 12.4 Admin config

Operations configures administered objects in app server/broker.

## 12.5 Repeatable definitions

Jakarta Messaging 3.1 includes repeatable annotations for connection factory and destination definitions.

But production often uses server config rather than source-code definitions.

## 12.6 Avoid hardcoding broker URL in code

Bad:

```java
new ActiveMQConnectionFactory("tcp://broker:61616")
```

inside business service.

Better: external config / administered object.

## 12.7 Naming convention

Use clear names:

```text
jms/CaseCommandQueue
jms/EmailNotificationQueue
jms/CaseDomainEventTopic
```

---

# 13. JMSProducer: Mengirim Pesan

## 13.1 Basic send string

```java
context.createProducer().send(queue, "Hello");
```

## 13.2 Send object body

```java
context.createProducer().send(queue, payload);
```

But object serialization has portability/security concerns.

Prefer JSON/bytes/text contract for integration.

## 13.3 Set properties

```java
context.createProducer()
    .setProperty("eventType", "CaseApproved")
    .setProperty("schemaVersion", 1)
    .send(topic, json);
```

## 13.4 Set delivery mode

```java
context.createProducer()
    .setDeliveryMode(DeliveryMode.PERSISTENT)
    .send(queue, message);
```

## 13.5 Set correlation ID

```java
TextMessage message = context.createTextMessage(json);
message.setJMSCorrelationID(correlationId);
context.createProducer().send(queue, message);
```

## 13.6 Set TTL

```java
context.createProducer()
    .setTimeToLive(60_000)
    .send(queue, message);
```

## 13.7 Producer failure

Send can fail due to:

- broker unavailable;
- authorization failure;
- connection issue;
- quota full;
- transaction rollback;
- serialization error.

## 13.8 Don't ignore send errors

If sending command/event is part of business correctness, handle failure with transaction/outbox strategy.

---

# 14. JMSConsumer: Menerima Pesan

## 14.1 Synchronous receive

```java
try (JMSContext context = connectionFactory.createContext()) {
    JMSConsumer consumer = context.createConsumer(queue);
    Message message = consumer.receive(5000);
}
```

## 14.2 Receive body

```java
String body = consumer.receiveBody(String.class, 5000);
```

## 14.3 No timeout danger

```java
consumer.receive();
```

blocks indefinitely.

Use timeout unless worker design expects blocking loop with controlled shutdown.

## 14.4 Null means timeout

If no message within timeout, receive returns null.

## 14.5 Consumer close

Application-managed consumer/context should be closed.

## 14.6 Consumer concurrency

Do not share consumer across threads.

Use multiple consumers/sessions/contexts for concurrency.

## 14.7 Polling loop

```java
while (running) {
    Message m = consumer.receive(1000);
    if (m != null) {
        handle(m);
    }
}
```

Need shutdown signal and error handling.

## 14.8 Prefer MDB in Jakarta EE

For server-side message consumption in Jakarta EE, MDB/container-managed listener can simplify lifecycle, transactions, pooling, and redelivery integration.

---

# 15. Message Listener: Async Consumption

## 15.1 Listener

```java
consumer.setMessageListener(message -> {
    try {
        String body = message.getBody(String.class);
        handle(body);
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
});
```

## 15.2 Async listener needs active connection/context

Provider manages callback thread.

## 15.3 Exception behavior

If listener throws runtime exception, provider/container redelivery behavior depends transaction/ack mode/provider.

## 15.4 Thread safety

Listener may be invoked concurrently depending setup.

Ensure handler is thread-safe or configure concurrency.

## 15.5 Backpressure

Async listener can receive faster than processing if provider prefetch/concurrency high.

Tune broker/provider.

## 15.6 In Jakarta EE

Prefer MDB or managed message endpoint for server-side async processing.

---

# 16. Message-Driven Bean / MDB

Message-driven bean is Jakarta Enterprise Beans component that consumes messages.

## 16.1 Basic MDB

```java
@MessageDriven(activationConfig = {
    @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/EmailQueue"),
    @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue")
})
public class EmailMessageBean implements MessageListener {

    @Override
    public void onMessage(Message message) {
        ...
    }
}
```

## 16.2 Why MDB?

Container manages:

- lifecycle;
- concurrency/pool;
- transaction;
- redelivery;
- injection;
- resource adapter integration.

## 16.3 Use cases

- enterprise server-side consumers;
- transactional processing;
- integration with app server JMS provider;
- legacy Jakarta EE applications.

## 16.4 MDB vs standalone worker

MDB good in full Jakarta EE runtime.

Standalone worker may be better for:

- containerized microservice with custom scaling;
- non-Jakarta broker features;
- event streaming;
- reactive clients;
- custom observability.

## 16.5 MDB hidden complexity

Activation config can be provider-specific.

Test in target runtime.

---

# 17. Message Types

Jakarta Messaging defines several message body types.

## 17.1 TextMessage

String payload.

Good for JSON/XML/text.

```java
TextMessage msg = context.createTextMessage(json);
```

## 17.2 BytesMessage

Binary payload.

Good for bytes/protobuf/custom binary.

## 17.3 MapMessage

Key-value pairs.

Less common for integration across languages.

## 17.4 ObjectMessage

Serialized Java object.

Avoid for integration/security.

Risks:

- Java serialization vulnerabilities;
- version compatibility;
- classpath coupling;
- language lock-in;
- schema evolution hard.

## 17.5 StreamMessage

Stream of primitive values.

Less common.

## 17.6 Message without body

Can carry signal via headers/properties.

## 17.7 Recommendation

For integration:

- JSON text;
- Avro/Protobuf bytes;
- CloudEvents-like envelope if appropriate;
- explicit schema/version.

Avoid Java `ObjectMessage` for cross-service contract.

---

# 18. Message Headers

Headers are standard metadata.

Important headers:

- `JMSMessageID`;
- `JMSCorrelationID`;
- `JMSReplyTo`;
- `JMSDestination`;
- `JMSDeliveryMode`;
- `JMSExpiration`;
- `JMSPriority`;
- `JMSTimestamp`;
- `JMSType`;
- `JMSRedelivered`.

## 18.1 JMSMessageID

Assigned by provider.

Useful for tracing but not always business idempotency key.

## 18.2 JMSCorrelationID

Use to correlate request/reply or trace related messages.

## 18.3 JMSReplyTo

Destination where reply should be sent.

## 18.4 JMSRedelivered

Indicates message may have been delivered before.

Do not rely solely on it for idempotency.

## 18.5 JMSType

Can identify message type, but many systems prefer explicit property such as `eventType`.

## 18.6 Timestamp

Provider timestamp when sent.

Not necessarily business event time.

## 18.7 Header design

Keep technical metadata in headers/properties and business data in body.

---

# 19. Message Properties

Properties are application-defined metadata.

## 19.1 Example

```java
message.setStringProperty("eventType", "CaseApproved");
message.setIntProperty("schemaVersion", 1);
message.setStringProperty("tenantId", tenantId);
message.setStringProperty("traceId", traceId);
```

## 19.2 Use cases

- selectors;
- routing;
- tracing;
- schema version;
- tenant;
- source service;
- event type;
- content type.

## 19.3 Properties are not payload replacement

Do not put huge business data in properties.

## 19.4 Type limitations

Properties support simple types.

## 19.5 Naming convention

Use stable names:

```text
eventType
schemaVersion
tenantId
correlationId
traceId
sourceService
```

## 19.6 Sensitive data

Avoid PII/secrets in properties because brokers/logs may expose them.

---

# 20. Message Selectors

Selectors filter messages based on properties using SQL-like syntax.

## 20.1 Example

```java
JMSConsumer consumer = context.createConsumer(
    queue,
    "eventType = 'CaseApproved' AND schemaVersion = 1"
);
```

## 20.2 Use cases

- consumer wants subset;
- routing by type;
- filtering by priority/category.

## 20.3 Risk

Selectors can reduce consumer code but may create broker-side complexity.

## 20.4 Performance

Selectors may be expensive depending broker.

Use destinations/routing topology if selectors become complex/high-volume.

## 20.5 Avoid business authorization by selector

Do not rely on selectors for tenant security unless broker-level isolation/security also configured.

## 20.6 Selector evolution

Changing property names breaks selectors.

Version message properties carefully.

---

# 21. Delivery Mode: Persistent vs Non-Persistent

## 21.1 Persistent

```java
DeliveryMode.PERSISTENT
```

Broker should persist message so it can survive provider failure according to broker guarantees.

Good for business-critical messages.

## 21.2 Non-persistent

```java
DeliveryMode.NON_PERSISTENT
```

May be faster but message can be lost on failure.

Good for transient telemetry or low-value notifications.

## 21.3 Persistent is not magic

Persistent message can still be lost if:

- transaction not committed;
- broker misconfigured;
- disk failure without replication;
- producer thinks sent but app transaction rolls back;
- operator purges queue;
- retention expires.

## 21.4 Choose by business value

Email notification may be persistent.

Live dashboard ping may be non-persistent.

## 21.5 Broker durability config

Check:

- storage sync;
- replication;
- HA;
- journal;
- DLQ;
- backup.

---

# 22. Priority, TTL, Expiration, Delay

## 22.1 Priority

JMS priority ranges 0-9.

Higher priority may be delivered earlier, but exact behavior provider-dependent.

Do not rely on priority as strict ordering.

## 22.2 TTL

Time-to-live controls expiration.

```java
producer.setTimeToLive(300_000);
```

Use for stale commands.

## 22.3 Expiration

Expired messages should not be delivered normally.

Broker may route to expiry queue depending config.

## 22.4 Delivery delay

Messaging supports scheduled/delayed delivery.

Use for:

- retry delay;
- delayed notification;
- time-based workflow.

## 22.5 Retry delay warning

Repeated immediate redelivery can hammer failing dependency.

Use backoff/delay.

## 22.6 Business deadline

Do not model important business deadline solely with TTL.

Store business state in database.

---

# 23. Acknowledgment Modes

Ack mode determines when message is considered successfully consumed.

## 23.1 AUTO_ACKNOWLEDGE

Session automatically acknowledges after receive/listener returns successfully.

## 23.2 CLIENT_ACKNOWLEDGE

Application explicitly acknowledges.

```java
message.acknowledge();
```

## 23.3 DUPS_OK_ACKNOWLEDGE

Lazy acknowledgement; duplicates possible.

## 23.4 Transacted session

Ack tied to commit/rollback.

## 23.5 Jakarta EE container-managed transaction

MDB can process message within container-managed transaction.

If transaction commits, message acknowledged.

If rollback, message redelivered.

## 23.6 Important

Acknowledgment is about broker delivery state, not business side effect completion unless transaction/design ties them together.

## 23.7 Wrong ack timing

Bad:

```text
ack message
then update database
database fails
message lost from queue
business effect missing
```

Tie ack after processing or use transaction/outbox/idempotency.

---

# 24. Transactions dalam Jakarta Messaging

## 24.1 Local JMS transaction

A JMS session/context can be transacted.

```java
JMSContext context = connectionFactory.createContext(JMSContext.SESSION_TRANSACTED);
```

Then:

```java
context.commit();
context.rollback();
```

## 24.2 What it covers

Local JMS transaction covers JMS operations in that session/context.

## 24.3 It does not cover DB automatically

If you update DB and send JMS in separate local transactions, partial failure possible.

## 24.4 JTA transaction

In Jakarta EE, JMS can participate in JTA transaction if provider/resource adapter supports XA/JTA enlistment.

## 24.5 Transaction boundaries

For message consumer:

```text
receive message
process
update DB
send outgoing message
commit transaction
```

If rollback, message redelivered and DB changes rollback.

## 24.6 Transaction timeout

Long message processing can exceed transaction timeout.

Keep transactions bounded.

## 24.7 Don't hold transaction during slow external calls

Bad:

```text
start tx
receive message
call external API for 30 seconds
update DB
commit
```

This holds locks/resources.

Use saga/outbox where possible.

---

# 25. JMS + JTA: Atomic Message dan Database Operation

## 25.1 Problem

Need atomicity:

```text
update database
send message
```

If DB commit succeeds but message send fails, system inconsistent.

## 25.2 XA / distributed transaction

JTA can coordinate DB and JMS provider using XA/two-phase commit.

```text
prepare DB
prepare JMS
commit both
```

## 25.3 Benefits

- atomic commit across resources;
- simpler mental model for some enterprise apps.

## 25.4 Costs

- complexity;
- performance overhead;
- heuristic outcomes;
- operational difficulty;
- broker/DB XA support needed;
- harder cloud-native scaling.

## 25.5 Alternative: outbox pattern

Write event to DB outbox in same DB transaction.

Separate relay publishes to broker.

## 25.6 Decision

Use XA when:

- runtime supports well;
- resources are XA-capable;
- operation volume acceptable;
- consistency requirement strong;
- ops team understands XA.

Use outbox when:

- microservices/cloud-native;
- database is source of truth;
- broker publish can be eventually consistent;
- idempotent relay possible.

---

# 26. Redelivery, Retry, Poison Message, dan DLQ

## 26.1 Redelivery

If consumer fails before ack/commit, broker may redeliver.

## 26.2 Duplicate delivery

Message may be delivered more than once.

Your consumer must be idempotent.

## 26.3 Poison message

Message that always fails.

Example:

- invalid schema;
- missing required field;
- business entity deleted;
- consumer bug;
- unexpected enum value.

## 26.4 Redelivery loop

Without limit/backoff, poison message can block queue and burn CPU.

## 26.5 DLQ

Dead-letter queue stores messages that exceed redelivery attempts or cannot be delivered.

## 26.6 DLQ handling

DLQ needs:

- alerting;
- dashboard;
- replay tool;
- quarantine;
- manual triage;
- root cause classification;
- safe reprocessing.

## 26.7 Retry taxonomy

Failures:

| Failure | Strategy |
|---|---|
| transient DB deadlock | retry |
| downstream timeout | retry with backoff |
| invalid schema | DLQ immediately |
| authorization denied | DLQ/business error |
| duplicate message | idempotent no-op |
| missing dependency data | retry or park depending SLA |

## 26.8 Don't infinite retry

Infinite retry hides failure and blocks progress.

---

# 27. Ordering Guarantees

## 27.1 Single queue, single consumer

Likely preserves order of delivery for that consumer.

## 27.2 Multiple consumers

Ordering across consumers is not guaranteed globally.

## 27.3 Redelivery affects order

Failed message redelivery can reorder relative to later messages depending broker.

## 27.4 Topic subscribers

Each subscription has its own ordering semantics.

## 27.5 Priority and delay affect order

Priority/delay/expiration can change order.

## 27.6 Business ordering

If order matters per aggregate:

```text
CaseCreated
CaseAssigned
CaseApproved
```

Design:

- use per-aggregate sequencing;
- idempotent state transitions;
- reject stale version;
- route same aggregate to same partition/consumer if broker supports;
- store version in DB.

## 27.7 Don't rely on global order

Distributed systems rarely preserve total order at scale.

Use causal/version checks.

---

# 28. Idempotency: Kunci Reliability

## 28.1 Why idempotency?

Because duplicate delivery happens.

Consumer may process same message twice.

## 28.2 Idempotency key

Use stable business key:

```text
messageId / eventId / commandId
```

Not necessarily `JMSMessageID`.

Prefer producer-generated ID stored in source system.

## 28.3 Dedup table

```sql
processed_message(
  message_id primary key,
  processed_at,
  consumer_name
)
```

Consumer:

```text
begin tx
insert processed_message(message_id)
if duplicate → already processed → ack/commit
perform business update
commit
```

## 28.4 Idempotent state transition

Example:

```text
if notification already sent for eventId → no-op
```

## 28.5 Natural idempotency

Some operations naturally idempotent:

```text
set status = APPROVED if version matches
```

Others not:

```text
charge credit card
send email
increment counter
```

## 28.6 Side effects

External side effects need idempotency at external system too if possible.

## 28.7 Idempotency is application responsibility

Broker redelivery flag is not enough.

---

# 29. Exactly-Once: Mitos dan Realita

## 29.1 Broker delivery vs business effect

A broker may provide strong delivery semantics within broker.

But business effect spans:

- message broker;
- database;
- external API;
- email;
- files;
- downstream systems.

Exactly-once business effect is hard.

## 29.2 Aim for effectively-once

Design:

```text
at-least-once delivery + idempotent consumer + transactional state update
```

Result: effectively-once outcome.

## 29.3 Duplicate-safe consumer

Always assume:

```text
message can arrive more than once
```

## 29.4 Lost message prevention

Use:

- persistent delivery;
- transaction;
- outbox;
- monitoring;
- DLQ;
- replay.

## 29.5 Exactly-once claim

When someone says exactly-once, ask:

1. exactly once where?
2. broker delivery?
3. DB update?
4. external side effect?
5. across crash/retry?
6. with duplicate producer sends?
7. with consumer timeout?

## 29.6 Top-tier stance

Be skeptical. Design explicitly.

---

# 30. Outbox Pattern vs XA Transaction

## 30.1 Outbox pattern

Within DB transaction:

```text
update business table
insert outbox_event
commit
```

Relay:

```text
read outbox_event
publish to broker
mark published
```

## 30.2 Benefits

- DB remains source of truth;
- no XA needed;
- reliable publish eventually;
- replay possible;
- audit trail.

## 30.3 Costs

- eventual consistency;
- relay complexity;
- duplicate publish possible;
- need idempotent consumers;
- outbox cleanup.

## 30.4 XA

Atomic but operationally heavier.

## 30.5 Decision table

| Requirement | Prefer |
|---|---|
| Legacy monolith with app server + XA-capable resources | JTA/XA possible |
| Microservices/cloud-native | Outbox |
| Need event replay/audit | Outbox/event log |
| Low throughput internal admin | Either |
| High throughput integration | Outbox/streaming often better |

## 30.6 Outbox with JMS

Relay can publish outbox rows to JMS queue/topic.

Consumers still idempotent.

---

# 31. Saga dan Process Manager

## 31.1 Long-running workflow

Some processes cannot be one transaction:

```text
submit application
verify payment
generate license
notify applicant
sync external system
```

## 31.2 Saga

Saga coordinates steps with compensating actions.

## 31.3 Process manager

Stores workflow state and reacts to messages/events.

## 31.4 JMS role

JMS can carry commands/events between steps.

## 31.5 Avoid transaction across long workflow

Do not hold DB/JMS transaction for minutes/hours.

## 31.6 Store state

Workflow state belongs in database/process manager, not only queue.

## 31.7 Idempotency again

Each saga step must be idempotent.

---

# 32. Request-Reply over JMS

## 32.1 Pattern

```text
requester sends message with JMSReplyTo and JMSCorrelationID
responder sends response to reply destination
requester matches correlation ID
```

## 32.2 Use cases

- legacy integration;
- async transport but sync semantic;
- backend-to-backend RPC where broker required.

## 32.3 Risks

- timeout;
- duplicate response;
- lost response;
- responder down;
- resource leak for temporary destinations;
- reintroduces tight coupling.

## 32.4 Better alternative

For long task:

```http
POST /jobs → 202 operationId
worker processes via JMS
GET /jobs/{id}
```

## 32.5 Correlation

Always set correlation ID.

## 32.6 Timeout policy

Define:

- client wait timeout;
- server processing timeout;
- retry policy;
- duplicate response behavior.

---

# 33. Correlation ID dan Traceability

## 33.1 Correlation ID

A stable ID linking related operations.

Can map to HTTP correlation ID.

## 33.2 Set on message

```java
message.setJMSCorrelationID(correlationId);
message.setStringProperty("traceId", traceId);
message.setStringProperty("sourceService", "case-service");
```

## 33.3 Propagate

HTTP request:

```text
X-Correlation-ID
```

becomes message property/header.

Consumer logs same ID.

## 33.4 Trace context

For distributed tracing, use W3C trace context fields if integrated.

## 33.5 Avoid high-cardinality metrics

Correlation ID in logs/traces, not metric labels.

## 33.6 Audit

Audit event should include correlation ID and message event ID.

---

# 34. Message Contract Design

## 34.1 Envelope

Example JSON envelope:

```json
{
  "eventId": "uuid",
  "eventType": "CaseApproved",
  "schemaVersion": 1,
  "occurredAt": "2026-06-12T10:00:00Z",
  "source": "case-service",
  "tenantId": "cea",
  "correlationId": "uuid",
  "payload": {
    "caseId": "..."
  }
}
```

## 34.2 Required metadata

- event/command ID;
- type;
- version;
- timestamp;
- source;
- correlation ID;
- tenant;
- payload.

## 34.3 Command vs event

Command:

```text
Do something
EmailRequested
GenerateDocument
```

Event:

```text
Something happened
CaseApproved
DocumentGenerated
```

## 34.4 Don't confuse

Command has intended consumer/handler.

Event is fact for subscribers.

## 34.5 Naming

Commands imperative/past request:

```text
SendEmail
GenerateLicenseDocument
```

Events past tense:

```text
EmailSent
LicenseDocumentGenerated
CaseApproved
```

## 34.6 Payload size

Messages should be reasonably small.

For large files, store in object storage and send reference.

## 34.7 Sensitive data

Do not put secrets/PII unless necessary and protected.

---

# 35. Schema Evolution dan Versioning

## 35.1 Backward compatibility

Consumer should handle old/new versions.

## 35.2 Additive changes

Adding optional field is usually safer.

## 35.3 Breaking changes

Changing field type/name can break consumers.

## 35.4 Version field

Use:

```json
"schemaVersion": 2
```

or content type:

```text
application/vnd.case-approved.v2+json
```

## 35.5 Consumer tolerance

Consumers should ignore unknown fields.

## 35.6 Contract testing

Test message compatibility.

## 35.7 Deprecation

Keep old version until all consumers migrate.

## 35.8 Registry

For large systems, use schema registry or contract repository.

---

# 36. Security

## 36.1 Broker authentication

Use credentials/certificates.

## 36.2 Authorization

Broker permissions:

- send to destination;
- consume from destination;
- manage destination;
- browse queue.

## 36.3 TLS

Use TLS for broker connections.

## 36.4 Message confidentiality

If broker/admins should not see payload, consider application-level encryption.

## 36.5 Tenant isolation

Use separate destinations/credentials or enforce tenant properties with care.

Do not rely solely on consumer filtering for tenant isolation.

## 36.6 Sensitive data

Avoid putting raw PII/secrets in messages.

If needed:

- encrypt;
- mask;
- minimize;
- apply retention policy.

## 36.7 Replay attack

For commands, include idempotency key and expiration where appropriate.

## 36.8 Audit

Audit who produced/consumed critical messages if broker/runtime supports.

---

# 37. Performance Engineering

## 37.1 Throughput factors

- broker capacity;
- persistence mode;
- message size;
- consumer concurrency;
- prefetch;
- transaction batch size;
- acknowledgment mode;
- network latency;
- serialization;
- DB downstream speed.

## 37.2 Message size

Small messages scale better.

Avoid huge payload.

## 37.3 Batching

Batch processing can improve throughput but increases latency and duplicate complexity.

## 37.4 Concurrency

More consumers increase throughput until bottleneck shifts.

Watch:

- DB pool;
- external API rate limit;
- lock contention;
- CPU.

## 37.5 Prefetch

Broker may prefetch messages to consumers.

High prefetch can hurt fairness/redelivery latency.

## 37.6 Persistent message cost

Persistent messages require broker disk/journal.

Tune carefully.

## 37.7 Transactions

Transaction per message is simple but overhead high.

Batch transaction can improve throughput but duplicate/retry impact bigger.

## 37.8 Backpressure

If downstream slow, queue grows.

Have:

- queue depth alert;
- producer throttling;
- consumer scaling;
- DLQ strategy.

---

# 38. Observability

## 38.1 Broker metrics

Monitor:

- queue depth;
- enqueue rate;
- dequeue rate;
- consumer count;
- DLQ depth;
- redelivery count;
- expired messages;
- broker disk;
- broker memory;
- connection count.

## 38.2 Application metrics

Producer:

- send count;
- send latency;
- send failure;
- message type count.

Consumer:

- processing latency;
- success/failure;
- redelivery;
- DLQ publish;
- idempotent duplicate count.

## 38.3 Logs

Include:

- eventId/messageId;
- correlationId;
- destination;
- eventType;
- attempt/redelivery;
- consumer name;
- outcome.

No secrets.

## 38.4 Tracing

Propagate trace context in message properties.

Create span for send and consume.

## 38.5 DLQ dashboard

DLQ must be visible.

Hidden DLQ is operational debt.

## 38.6 Lag/SLA

Track time from message sent to processed.

---

# 39. Testing Strategy

## 39.1 Unit tests

Test handler logic with plain object/message DTO.

## 39.2 Integration tests

Use real broker/provider.

Test:

- send/receive;
- transaction commit;
- rollback redelivery;
- DLQ;
- selectors;
- durable subscription;
- connection failure.

## 39.3 Contract tests

Test message schema compatibility.

## 39.4 Idempotency tests

Send same message twice.

Expected: one business effect.

## 39.5 Redelivery tests

Consumer throws exception.

Verify redelivery count and DLQ behavior.

## 39.6 Ordering tests

Send sequence and consume with concurrency.

Observe real guarantees.

## 39.7 Performance tests

Load test producer/consumer.

Measure queue depth and processing latency.

## 39.8 Chaos tests

- broker restart;
- consumer crash mid-processing;
- DB deadlock;
- network partition;
- slow downstream;
- DLQ replay.

---

# 40. Production Failure Modes

## 40.1 Message sent but DB rollback

Cause:

- message send outside DB transaction.

Fix:

- JTA/XA or outbox.

## 40.2 DB commit but message not sent

Cause:

- send after commit fails.

Fix:

- outbox.

## 40.3 Duplicate processing

Cause:

- redelivery after crash/rollback;
- producer duplicate;
- retry.

Fix:

- idempotent consumer.

## 40.4 Poison message blocks queue

Cause:

- invalid message repeatedly redelivered.

Fix:

- redelivery limit + DLQ.

## 40.5 Queue grows forever

Cause:

- consumers down/slow;
- downstream failure;
- poison messages;
- throughput mismatch.

Fix:

- alert, scale, fix downstream, DLQ.

## 40.6 Lost non-persistent message

Cause:

- broker crash.

Fix:

- persistent delivery for important messages.

## 40.7 Out-of-order processing

Cause:

- multiple consumers/redelivery.

Fix:

- design with version/idempotency.

## 40.8 Consumer memory leak

Cause:

- large messages;
- caching processed IDs without bounds;
- not closing resources.

## 40.9 Broker disk full

Cause:

- persistent backlog;
- DLQ accumulation;
- expired messages not cleaned.

## 40.10 Silent DLQ

Cause:

- DLQ not monitored.

## 40.11 Selector mismatch

Cause:

- wrong property name/type.

Messages never consumed.

## 40.12 Durable subscription backlog surprise

Cause:

- subscriber offline for long time.

## 40.13 Transaction timeout

Cause:

- slow handler.

Message redelivered repeatedly.

## 40.14 Security misconfig

Producer can send to unauthorized destination or consumer can read other tenant messages.

---

# 41. Best Practices dan Anti-Patterns

## 41.1 Best practices

- Use queue for one-consumer work.
- Use topic for fan-out events.
- Use persistent delivery for business-critical messages.
- Make consumers idempotent.
- Include eventId/correlationId/schemaVersion.
- Use DLQ with alerting.
- Use outbox for DB + message reliability.
- Keep messages small.
- Avoid Java ObjectMessage for integration.
- Monitor queue depth and DLQ.
- Set timeouts.
- Handle redelivery explicitly.
- Test crash/retry scenarios.
- Document message contracts.

## 41.2 Anti-pattern: Message as database

Queue is not long-term queryable storage.

## 41.3 Anti-pattern: No idempotency

Assuming no duplicates is wrong.

## 41.4 Anti-pattern: Infinite retry

Poison message loops forever.

## 41.5 Anti-pattern: Huge payload

Send file content through queue.

Better send object storage reference.

## 41.6 Anti-pattern: ObjectMessage across services

Tight Java class coupling and serialization risk.

## 41.7 Anti-pattern: No DLQ monitoring

DLQ without alert is message graveyard.

## 41.8 Anti-pattern: Transaction around external call

Long transaction and lock/resource risk.

---

# 42. Checklist Review

## 42.1 Message design

- [ ] Is it command or event?
- [ ] Has eventId/messageId?
- [ ] Has correlationId?
- [ ] Has schemaVersion?
- [ ] Payload small?
- [ ] Sensitive data minimized?
- [ ] Contract documented?

## 42.2 Destination design

- [ ] Queue or topic chosen correctly?
- [ ] Durable subscription needed?
- [ ] Naming clear?
- [ ] DLQ configured?
- [ ] Redelivery policy configured?
- [ ] Security permissions configured?

## 42.3 Producer

- [ ] Persistent delivery if critical?
- [ ] Send failure handled?
- [ ] Outbox/XA decision made?
- [ ] Correlation/trace propagated?
- [ ] TTL/delay appropriate?

## 42.4 Consumer

- [ ] Idempotent?
- [ ] Transaction boundary correct?
- [ ] Ack after successful processing?
- [ ] Redelivery handled?
- [ ] Poison message path defined?
- [ ] Side effects safe?

## 42.5 Operations

- [ ] Queue depth monitored?
- [ ] DLQ monitored?
- [ ] Broker disk/memory monitored?
- [ ] Consumer lag/SLA tracked?
- [ ] Replay tool exists?
- [ ] Runbook exists?

---

# 43. Case Study 1: Email Notification Queue

## 43.1 Requirement

After case approved, send email.

Email failure should not rollback case approval.

## 43.2 Design

```text
ApproveCaseUseCase
  ↓
commit case approval
  ↓
outbox event EmailRequested
  ↓
relay publishes to EmailQueue
  ↓
EmailConsumer sends email
```

## 43.3 Why queue?

One email should be sent by one worker.

## 43.4 Idempotency

Use `emailRequestId`.

Consumer checks if email already sent for request.

## 43.5 Retry

Transient SMTP failure: retry with backoff.

Permanent invalid address: DLQ/business failure.

## 43.6 Audit

Record email attempt/success/failure.

---

# 44. Case Study 2: Compliance Event Topic

## 44.1 Requirement

When compliance case closes, multiple systems need event:

- reporting;
- audit;
- notification;
- data warehouse.

## 44.2 Design

```text
CaseClosed topic
  → Reporting subscriber
  → Audit subscriber
  → Notification subscriber
  → Warehouse subscriber
```

## 44.3 Why topic?

Fan-out.

## 44.4 Durable subscriptions

Critical subscribers should be durable.

## 44.5 Schema

Event includes:

- eventId;
- caseId;
- closedAt;
- closedBy;
- outcome;
- schemaVersion;
- correlationId.

## 44.6 Consumer independence

One subscriber failure should not block others.

---

# 45. Case Study 3: Poison Message dan DLQ

## 45.1 Problem

Consumer fails on enum value:

```json
{"status":"UNKNOWN_NEW_STATUS"}
```

Consumer deployed old schema.

## 45.2 Behavior

Message redelivered repeatedly.

Queue stuck.

## 45.3 Fix

- schema compatibility;
- tolerant reader;
- redelivery limit;
- DLQ;
- alert;
- deploy fix;
- replay DLQ.

## 45.4 Lesson

Schema evolution and DLQ are reliability features, not extras.

---

# 46. Case Study 4: Outbox untuk Database + Message Reliability

## 46.1 Problem

Application approves case and publishes event.

If event publish fails after DB commit, downstream never knows.

## 46.2 Outbox design

Within DB transaction:

```text
update case status
insert outbox_event(CaseApproved)
commit
```

Relay:

```text
select unpublished events
publish JMS message
mark published
```

## 46.3 Duplicate publish

Relay may publish then crash before marking published.

Therefore consumers must be idempotent.

## 46.4 Benefits

- no lost event after DB commit;
- replayable outbox;
- no XA;
- clear audit.

## 46.5 Cost

- eventual consistency;
- relay process;
- idempotency;
- cleanup.

---

# 47. Latihan Bertahap

## Latihan 1 — Simple producer

Send text message to queue using `JMSContext`.

## Latihan 2 — Simple consumer

Receive message with timeout.

## Latihan 3 — Message properties

Add `eventType`, `schemaVersion`, `correlationId`.

Create selector.

## Latihan 4 — Topic fan-out

Create topic and two subscribers.

Verify both receive event.

## Latihan 5 — Durable subscription

Make subscriber offline, publish message, bring subscriber back.

## Latihan 6 — Redelivery

Throw exception in consumer.

Observe redelivery.

## Latihan 7 — DLQ

Configure redelivery limit and DLQ.

Send poison message.

## Latihan 8 — Idempotency

Send same message twice.

Ensure one business effect.

## Latihan 9 — Transaction rollback

Receive message, update DB, rollback.

Observe redelivery and DB rollback.

## Latihan 10 — Outbox

Implement outbox table and relay to JMS.

Crash relay after publish before mark.

Verify duplicate-safe consumer.

---

# 48. Mini Project: Jakarta Messaging Reliability Lab

## 48.1 Goal

Create:

```text
jakarta-messaging-reliability-lab/
```

## 48.2 Modules

```text
basic-producer-consumer/
queue-email-worker/
topic-case-events/
durable-subscription/
redelivery-dlq/
idempotent-consumer/
jta-transaction/
outbox-relay/
request-reply/
observability/
```

## 48.3 Deliverables

```text
README.md
MESSAGING-MENTAL-MODEL.md
DESTINATION-DESIGN.md
MESSAGE-CONTRACT.md
IDEMPOTENCY.md
TRANSACTION-BOUNDARY.md
OUTBOX-PATTERN.md
DLQ-RUNBOOK.md
OBSERVABILITY.md
FAILURE-MODES.md
```

## 48.4 Required experiments

1. Send/receive queue.
2. Publish/subscribe topic.
3. Durable subscription.
4. Redelivery.
5. DLQ.
6. Idempotent consumer.
7. DB + JMS transaction.
8. Outbox relay duplicate publish.
9. Request-reply timeout.
10. Broker restart during processing.

## 48.5 Evaluation questions

1. Queue or topic?
2. What happens if consumer crashes after DB update before ack?
3. Why are duplicates possible?
4. What is DLQ?
5. What is poison message?
6. Why is `ObjectMessage` risky?
7. When use outbox instead of XA?
8. How do you preserve per-aggregate order?
9. What metrics must be monitored?
10. What is effectively-once processing?

---

# 49. Referensi Resmi

Referensi utama:

1. Jakarta Messaging 3.1  
   https://jakarta.ee/specifications/messaging/3.1/

2. Jakarta Messaging 3.1 Specification  
   https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html

3. Jakarta Messaging API Docs — `jakarta.jms`  
   https://jakarta.ee/specifications/messaging/3.1/apidocs/jakarta.messaging/jakarta/jms/package-summary

4. `JMSContext` API Docs  
   https://jakarta.ee/specifications/messaging/3.1/apidocs/jakarta.messaging/jakarta/jms/jmscontext

5. Jakarta EE Tutorial — Jakarta Messaging Concepts  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/messaging/jms-concepts/jms-concepts.html

6. Jakarta EE Tutorial — Jakarta Messaging Examples  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/messaging/jms-examples/jms-examples.html

7. Jakarta Enterprise Beans — Message-Driven Beans  
   https://jakarta.ee/specifications/enterprise-beans/4.0/jakarta-enterprise-beans-spec-core-4.0

8. Jakarta Transactions 2.0  
   https://jakarta.ee/specifications/transactions/2.0/

9. Jakarta Connectors 2.1  
   https://jakarta.ee/specifications/connectors/2.1/

10. Jakarta EE Platform 11  
   https://jakarta.ee/specifications/platform/11/

---

# Penutup

Jakarta Messaging adalah API standard untuk asynchronous enterprise messaging.

Mental model ringkas:

```text
Queue:
  one message processed by one consumer

Topic:
  one event distributed to many subscribers

JMSContext:
  simplified connection/session API

Producer:
  sends message

Consumer/MDB:
  receives message

Transaction/Ack:
  decides when broker considers message processed

DLQ:
  quarantine for messages that cannot be processed

Idempotency:
  application guarantee against duplicates
```

Prinsip paling penting:

```text
Messaging gives delivery mechanisms.
Reliability comes from design.
```

Jangan percaya bahwa broker otomatis memberikan exactly-once business effect. Desain yang benar biasanya:

```text
persistent message
+ bounded retry
+ DLQ
+ idempotent consumer
+ transaction boundary
+ outbox where DB and message must align
+ observability
```

Engineer top-tier tidak hanya bisa mengirim pesan ke queue. Ia tahu apa yang terjadi saat consumer crash, saat DB commit tapi publish gagal, saat message duplicate, saat poison message masuk, saat topic subscriber offline, dan saat queue depth tumbuh tanpa batas.

Bagian berikutnya akan membahas **Jakarta Mail (`jakarta.mail`)**: SMTP/IMAP, MIME message, attachment, template, retry, bounce handling, deliverability, security, and production email pipeline design.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-jakarta-part-018.md](./learn-java-jakarta-part-018.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-020.md](./learn-java-jakarta-part-020.md)

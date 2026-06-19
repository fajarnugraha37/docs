# Part 15 — SNS Fundamentals and Pub/Sub Integration

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-15-sns-fundamentals-and-pubsub-integration.md`  
Scope: Java 8–25, AWS SDK for Java 2.x, production-grade pub/sub integration  
Status: Part 15 of 35

---

## 0. Why This Part Exists

Amazon SNS is often introduced as a simple notification service: create topic, publish message, subscribe queue, done.

That explanation is dangerously incomplete.

In production systems, SNS is not merely a notification API. It is a **fan-out boundary**. It lets one producer publish a message once and lets multiple subscribers receive their own copy independently. This changes the coupling model of a system.

Without SNS, a Java service often looks like this:

```text
Case Service
  ├── calls Screening Service
  ├── calls Notification Service
  ├── calls Audit Service
  ├── calls Reporting Service
  └── calls Workflow Service
```

That design couples the producer to every downstream consumer. The producer must know who needs the event, how to call each one, how to retry each failure, how to handle partial success, and how to evolve all integrations together.

With SNS, the shape changes:

```text
Case Service
  └── publishes CaseCreated event to SNS topic
          ├── Screening Queue
          ├── Notification Queue
          ├── Audit Queue
          ├── Reporting Queue
          └── Workflow Queue
```

The producer expresses that something happened. Subscribers decide whether they care.

That is the core mental shift:

> SNS is not primarily about sending messages. SNS is about decoupling publication from subscription.

But this decoupling is not free. SNS introduces new engineering concerns:

- message contract design;
- delivery retry semantics;
- duplicate delivery;
- subscriber-level dead-letter queues;
- filter policy correctness;
- raw vs enveloped delivery;
- cross-account permissions;
- topic ownership;
- event versioning;
- observability;
- replay strategy;
- ordering expectations;
- cost and fan-out amplification.

This part builds the foundation for all later event-driven architecture parts.

---

## 1. Learning Objectives

After this part, you should be able to:

1. Explain SNS as a pub/sub fan-out service, not merely a notification mechanism.
2. Decide when SNS is appropriate and when SQS, EventBridge, Kafka, direct HTTP, or database outbox is a better fit.
3. Model topic, subscription, publisher, subscriber, protocol, message attributes, filter policy, and DLQ correctly.
4. Publish messages from Java using AWS SDK for Java 2.x with correct client lifecycle, timeout, retry, idempotency, and observability boundaries.
5. Design SNS topics and messages that survive schema evolution and multi-subscriber growth.
6. Understand SNS-to-SQS fan-out as the default robust integration pattern.
7. Avoid common anti-patterns such as one giant topic, business logic inside filter policy, missing DLQ, overusing raw delivery, relying on ordering in standard topics, and treating publish success as business completion.

---

## 2. What SNS Is

Amazon SNS is a managed publish/subscribe messaging service.

The main entities are:

```text
Publisher
  publishes message
      ↓
SNS Topic
  has subscriptions
      ↓
Subscriber endpoints
  SQS, Lambda, HTTP/S, email, SMS, mobile push, Firehose, etc.
```

A topic is a logical channel. A publisher sends a message to the topic. SNS attempts to deliver that message to each matching subscription.

The topic does not mean all consumers must process the same way. Each subscription can have different:

- protocol;
- endpoint;
- filter policy;
- raw message delivery setting;
- retry behavior depending on protocol;
- dead-letter queue;
- access policy;
- encryption settings.

The most production-friendly pattern for backend systems is usually:

```text
Producer Service
  ↓ Publish
SNS Topic
  ↓ Fan-out
SQS Queue per Subscriber
  ↓ Poll
Subscriber Worker / Lambda / Service
```

This gives every subscriber its own buffer, retry lifecycle, concurrency model, and DLQ.

---

## 3. What SNS Is Not

SNS is not a general replacement for every messaging system.

It is not a database transaction log.

It is not a workflow engine.

It is not a durable replayable event store by default.

It is not a guarantee that every consumer has completed work once `PublishResponse` returns.

It is not a guarantee of exactly-once business processing.

It is not a substitute for idempotency.

It is not a magic way to avoid schema governance.

It is not an ideal choice when consumers need long-term replay, arbitrary stream processing, complex ordering, or high-volume partitioned log semantics. For that, Kafka/Kinesis/EventBridge archive or custom event store might be better depending on the case.

The production-safe statement is:

> SNS is excellent for fan-out notification and event distribution, especially when each subscriber can own its own queue and processing lifecycle.

---

## 4. Core Mental Model: Fan-Out Boundary

A direct call says:

```text
I need this other system to do something now.
```

An SNS event says:

```text
Something happened. Whoever cares may react.
```

That distinction matters.

Direct call:

```text
Case Service ──HTTP──> Notification Service
```

The producer knows the target. It waits for response. Failure is immediately visible to the producer. Latency is coupled.

SNS publish:

```text
Case Service ──Publish──> case-events topic
                         ├── notification queue
                         ├── audit queue
                         └── reporting queue
```

The producer does not know how many consumers exist. It only knows it successfully handed an event to SNS.

Therefore, SNS creates a boundary between:

- **fact production**: something happened;
- **fact distribution**: SNS delivers to matching subscriptions;
- **fact consumption**: subscribers process independently.

A top-tier engineer treats these as separate reliability domains.

---

## 5. Publish Success Is Not Subscriber Success

This is one of the most important rules.

When Java code calls `snsClient.publish(...)` and receives a successful response, it means SNS accepted the publish request. It does not mean:

- every subscriber received it;
- every SQS queue stored it;
- every Lambda processed it;
- every HTTP endpoint returned 200;
- every business side effect completed.

The publisher owns successful publication. Subscribers own their own processing.

Wrong mental model:

```text
publish CaseApproved event
therefore notification was sent
therefore audit was written
therefore reporting was updated
```

Correct mental model:

```text
CaseApproved event was accepted by SNS.
Downstream outcomes must be observed independently.
```

This affects API design. A synchronous user action should not claim downstream completion unless the system has actually observed it.

Example:

```text
Bad response:
"Case approved and all downstream systems updated."

Better response:
"Case approved. Downstream updates have been queued."
```

---

## 6. Topic, Subscription, Endpoint, Protocol

### 6.1 Topic

A topic is the publish target.

Topic examples:

```text
case-events
case-command-events
notification-events
payment-events
application-domain-events
```

Bad topic examples:

```text
events
messages
backend
integration
all-events
```

A topic should represent a meaningful publication boundary.

### 6.2 Subscription

A subscription connects a topic to an endpoint.

Example:

```text
Topic: case-events
Subscription 1: SQS queue screening-case-events
Subscription 2: SQS queue notification-case-events
Subscription 3: SQS queue audit-case-events
```

Each subscription can filter messages.

### 6.3 Endpoint

Endpoint is the destination.

Common endpoints:

- SQS queue;
- Lambda function;
- HTTP/S endpoint;
- email;
- SMS;
- mobile push;
- Firehose delivery stream.

For backend service integration, SQS is usually the safest subscriber endpoint.

### 6.4 Protocol

Protocol defines delivery mechanism.

Examples:

```text
sqs
lambda
https
email
sms
application
firehose
```

Protocol choice changes failure behavior.

SQS gives durable queueing. Lambda invokes function. HTTP/S makes outbound delivery attempt. Email/SMS/mobile push have external delivery characteristics.

---

## 7. SNS Standard Topic vs FIFO Topic

SNS has two broad topic categories:

1. Standard topic.
2. FIFO topic.

### 7.1 Standard Topic

Standard topics are optimized for high throughput and broad fan-out.

Properties:

- very high throughput;
- best-effort ordering;
- at-least-once delivery;
- possible duplicate delivery;
- supports many protocols.

Use standard topic when:

- ordering is not business-critical;
- consumers are idempotent;
- throughput matters;
- subscribers can tolerate duplicates;
- event processing can be eventually consistent.

Most domain event fan-out uses standard topics.

### 7.2 FIFO Topic

FIFO topics are for ordered, deduplicated message delivery to compatible endpoints such as SQS FIFO queues.

Properties:

- message group based ordering;
- deduplication support;
- stricter throughput trade-offs;
- compatible with FIFO-oriented processing.

Use FIFO topic when:

- per-entity ordering matters;
- events must be processed in sequence per group;
- throughput is acceptable under FIFO constraints;
- consumers are designed around message group parallelism.

Example message group IDs:

```text
case:{caseId}
application:{applicationId}
customer:{customerId}
```

Avoid FIFO topics if you only want “less duplication.” FIFO does not remove the need for business idempotency.

---

## 8. SNS vs SQS vs EventBridge vs Kafka

A strong engineer chooses integration tools by semantics, not popularity.

### 8.1 SNS vs SQS

SQS is queueing.

SNS is pub/sub fan-out.

SQS has consumers pull messages from a queue.

SNS pushes/copies messages to subscriptions.

Use SQS when one logical consumer group should process work:

```text
Job Producer → SQS Queue → Worker Pool
```

Use SNS when multiple independent consumers may need the same event:

```text
Producer → SNS Topic → many subscriptions
```

Use SNS + SQS when you want fan-out plus durable independent processing:

```text
Producer → SNS Topic
              ├→ Consumer A SQS Queue
              ├→ Consumer B SQS Queue
              └→ Consumer C SQS Queue
```

### 8.2 SNS vs EventBridge

SNS is simple, high-throughput fan-out.

EventBridge is an event routing service with richer event pattern matching, SaaS integration, buses, archive/replay, scheduler, and event governance features.

Use SNS when:

- simple fan-out is enough;
- SNS-to-SQS pattern fits;
- filtering on attributes/body is enough;
- latency and simple delivery matter.

Use EventBridge when:

- event bus semantics matter;
- complex routing patterns are needed;
- archive/replay is important;
- SaaS/partner integration is needed;
- scheduled events are needed;
- you want centralized event governance.

### 8.3 SNS vs Kafka

Kafka is a durable append-only log with consumer offsets, partitioning, replay, and stream processing ecosystem.

SNS is managed pub/sub notification/fan-out.

Use Kafka/Kinesis-like log when:

- replay is a first-class requirement;
- consumers need independent offsets;
- event history is the source of truth;
- ordered partition processing is central;
- high-volume streaming analytics is required.

Use SNS when:

- you need notification fan-out;
- events are transient but important;
- SQS queues provide enough durability per subscriber;
- you do not need a long-term ordered log.

### 8.4 SNS vs Direct HTTP

Direct HTTP is request-response coupling.

SNS is asynchronous distribution.

Use direct HTTP when:

- caller needs immediate answer;
- operation is query-like;
- transaction cannot proceed without downstream result;
- user experience requires synchronous validation.

Use SNS when:

- event can be processed asynchronously;
- producer should not depend on subscriber availability;
- fan-out may grow over time;
- downstream side effects can complete eventually.

---

## 9. Delivery Semantics

SNS delivery semantics depend on topic type and subscription protocol, but a safe baseline is:

> Design for at-least-once delivery and duplicate messages.

This means consumers must be idempotent.

Publisher-side idempotency is also useful, but it is not enough. A message may be delivered more than once even if published once.

### 9.1 At-Least-Once Delivery

At-least-once means the system tries to deliver, but duplicate delivery can happen.

Consumer rule:

```text
Processing the same message twice must not corrupt business state.
```

### 9.2 Best-Effort Ordering

Standard topics should not be used when strict ordering is required.

If your workflow requires:

```text
CaseCreated → CaseSubmitted → CaseApproved → CaseClosed
```

then consumers must tolerate out-of-order arrival or use a FIFO design per case/application ID.

### 9.3 Subscriber-Level Delivery

SNS delivery is per subscription.

If one subscription fails, another can still receive the message.

That is good for isolation, but it also means operational state is distributed:

```text
Topic publish success = accepted by SNS
Subscription A = delivered
Subscription B = retrying
Subscription C = moved to DLQ
```

You need observability per subscription, not just per topic.

---

## 10. SNS Message Shape

An SNS publish request can include:

- topic ARN;
- message body;
- subject for some protocols;
- message attributes;
- message group ID for FIFO;
- message deduplication ID for FIFO;
- message structure for protocol-specific payloads.

A basic Java domain event should usually separate:

1. transport metadata;
2. event envelope;
3. domain payload.

Example envelope:

```json
{
  "eventId": "01JZ8AA7R9W5F4R7PK5F7M2J2X",
  "eventType": "case.approved.v1",
  "eventVersion": 1,
  "occurredAt": "2026-06-19T10:15:30Z",
  "producer": "case-service",
  "correlationId": "corr-7c3a9c4a",
  "causationId": "cmd-924aa1",
  "tenantId": "cea",
  "aggregateType": "case",
  "aggregateId": "CASE-2026-000123",
  "payload": {
    "caseId": "CASE-2026-000123",
    "approvedBy": "officer-001",
    "approvedAt": "2026-06-19T10:15:29Z"
  }
}
```

Important point:

> SNS does not force an event envelope. You must design one.

Without a stable envelope, every consumer invents its own assumptions.

---

## 11. Message Body vs Message Attributes

SNS supports message body and message attributes.

Use message body for business payload.

Use message attributes for routing, filtering, and transport-visible metadata.

Example message attributes:

```text
eventType       = case.approved
version         = 1
tenantId        = cea
source          = case-service
aggregateType   = case
priority        = normal
```

Message attributes are useful because subscription filter policies can evaluate them.

Do not put the full domain object into attributes. Attributes are for concise classification metadata.

Bad:

```text
attribute fullCaseJson = "{... huge payload ...}"
```

Good:

```text
attribute eventType = "case.approved"
attribute tenantId = "cea"
attribute version = "1"
```

---

## 12. Subscription Filter Policies

By default, a subscriber receives every message published to the topic. A subscription filter policy allows the subscription to receive only matching messages.

Example:

```json
{
  "eventType": ["case.approved", "case.rejected"],
  "tenantId": ["cea"]
}
```

This means:

```text
Deliver only messages where:
  eventType is case.approved OR case.rejected
  AND tenantId is cea
```

### 12.1 Filter Policy as Routing Optimization

Filter policy is routing logic, not business logic.

Good filter policy:

```json
{
  "eventType": ["document.uploaded"]
}
```

Bad filter policy:

```json
{
  "caseAmount": [{ "numeric": [">", 100000] }],
  "officerRegion": ["east"],
  "appealWindowRemainingDays": [{ "numeric": ["<", 3] }]
}
```

Why bad?

Because now subscription filtering becomes hidden business logic outside application code. It becomes difficult to test, audit, version, and reason about.

A good principle:

> Use SNS filters to reduce irrelevant traffic, not to encode critical business decisions.

### 12.2 Attribute-Based vs Payload-Based Filtering

SNS supports filtering based on message attributes and, in supported configurations, message body filtering.

Attribute filtering is explicit and stable.

Payload filtering can be convenient but increases coupling to payload shape.

Prefer attributes for stable event classification.

Use payload filtering only when:

- the payload schema is tightly governed;
- filtering fields are stable;
- consumers understand that payload changes affect routing;
- tests cover filter behavior.

### 12.3 Filter Policy Failure Mode

A wrong filter policy can silently prevent delivery.

Example:

```json
{
  "eventType": ["case.approve"]
}
```

But publisher sends:

```text
eventType = case.approved
```

Result: no delivery.

No Java exception occurs in publisher.

Therefore, filter policies must be treated as deployable configuration with tests.

---

## 13. Raw Message Delivery

When SNS delivers to SQS, by default it can wrap the original message inside an SNS envelope.

Envelope-style message contains fields such as:

```json
{
  "Type": "Notification",
  "MessageId": "...",
  "TopicArn": "...",
  "Message": "{ actual payload as string }",
  "Timestamp": "...",
  "SignatureVersion": "...",
  "Signature": "...",
  "SigningCertURL": "...",
  "UnsubscribeURL": "...",
  "MessageAttributes": { ... }
}
```

Raw message delivery sends only the original message body to the endpoint.

### 13.1 Pros of Raw Delivery

- Consumer receives cleaner payload.
- Less parsing ceremony.
- SQS message body directly equals domain event JSON.
- Easier local testing.

### 13.2 Cons of Raw Delivery

- Less SNS metadata in body.
- Some diagnostic information may be unavailable unless captured elsewhere.
- Consumer may lose visibility of topic metadata if not included in your event envelope or attributes.

### 13.3 Recommendation

For backend SNS-to-SQS integration, raw delivery is often fine if your domain event envelope already includes the metadata you need:

- eventId;
- eventType;
- version;
- occurredAt;
- producer;
- correlationId;
- aggregateId.

If you rely on SNS delivery metadata for verification or diagnostics, do not use raw delivery casually.

The decision should be explicit.

---

## 14. SNS to SQS Fan-Out Pattern

This is the most common robust backend pattern.

```text
Producer Java Service
   |
   | Publish domain event
   v
SNS Topic: case-events
   |
   | fan-out
   +--> SQS Queue: screening-case-events
   +--> SQS Queue: notification-case-events
   +--> SQS Queue: audit-case-events
   +--> SQS Queue: reporting-case-events
```

Each queue has its own:

- visibility timeout;
- DLQ;
- redrive policy;
- consumer concurrency;
- retry lifecycle;
- monitoring;
- owner team;
- deployment cadence.

This is much better than one shared queue consumed by multiple unrelated systems.

### 14.1 Why Queue Per Subscriber

A queue per subscriber gives isolation.

If notification service is down:

```text
notification-case-events queue grows
```

But audit and reporting continue.

If all subscribers shared one queue, one consumer might steal messages intended for another, or slow consumers would block unrelated processing.

Rule:

> In SNS-to-SQS fan-out, each independent subscriber should have its own queue.

### 14.2 Queue Policy Requirement

For SNS to deliver to SQS, the SQS queue must allow `sns.amazonaws.com` to call `sqs:SendMessage`, usually constrained by `aws:SourceArn`.

Conceptual queue policy:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Service": "sns.amazonaws.com"
  },
  "Action": "sqs:SendMessage",
  "Resource": "arn:aws:sqs:ap-southeast-1:123456789012:notification-case-events",
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:sns:ap-southeast-1:123456789012:case-events"
    }
  }
}
```

Without this, subscription may exist but delivery fails.

---

## 15. Subscriber Dead-Letter Queues

SNS DLQ is attached to a subscription, not to the topic.

This is important.

```text
SNS Topic
  ├── Subscription A → Queue A        → Queue A DLQ
  ├── Subscription B → Lambda B       → Subscription B DLQ
  └── Subscription C → HTTPS Endpoint → Subscription C DLQ
```

Why subscription-level?

Because delivery failure belongs to the endpoint.

If subscriber A fails, subscriber B should not be treated as failed.

### 15.1 What Goes to SNS DLQ

SNS subscription DLQ captures messages that SNS cannot deliver successfully to that subscription after retry policy is exhausted.

This is different from SQS consumer DLQ.

For SNS-to-SQS:

```text
SNS subscription DLQ: SNS could not deliver to SQS queue.
SQS queue DLQ: consumer received message but failed processing repeatedly.
```

Both can exist.

### 15.2 Two DLQ Layers

Production SNS-to-SQS setup may have:

```text
SNS Topic
  ↓
Subscription delivery to SQS Queue
  ↓
SQS Queue consumed by Java Worker
  ↓
SQS DLQ after processing failures
```

Potential DLQ points:

1. SNS subscription DLQ: delivery-to-queue failure.
2. SQS redrive DLQ: consumer-processing failure.

They diagnose different failure classes.

### 15.3 DLQ Is Not a Recovery Strategy By Itself

DLQ only preserves failed messages.

You still need:

- ownership;
- alerting;
- triage procedure;
- replay tool;
- poison message classification;
- retention setting;
- audit trail;
- decision process for discard/reprocess/patch.

A DLQ without a runbook is a delayed outage.

---

## 16. SNS Retry Model

SNS retries delivery depending on subscription protocol.

For backend design, the exact retry schedule matters less than the principle:

> SNS retries delivery to a subscription, but your architecture must not rely on infinite retry.

If delivery ultimately fails, configure DLQ.

For SQS subscriptions, delivery is usually highly reliable once permission/configuration is correct, because SQS is an AWS managed durable endpoint. For HTTP/S subscriptions, delivery can fail due to endpoint availability, TLS, auth, network, or response code.

### 16.1 HTTP Endpoint Caution

SNS-to-HTTP can look attractive:

```text
SNS Topic → HTTPS endpoint
```

But this reintroduces operational coupling:

- endpoint must be reachable from SNS;
- endpoint must respond quickly;
- endpoint must handle retries;
- duplicate HTTP delivery is possible;
- auth and signature verification matter;
- backpressure is harder than with SQS.

For internal backend consumers, prefer SNS-to-SQS unless you have strong reason otherwise.

---

## 17. Java Publisher Fundamentals

A Java publisher should be designed as a reusable infrastructure component, not scattered `sns.publish(...)` calls everywhere.

Bad design:

```java
snsClient.publish(PublishRequest.builder()
    .topicArn(topicArn)
    .message(json)
    .build());
```

This works technically, but misses:

- event envelope construction;
- validation;
- consistent attributes;
- correlation ID;
- timeout policy;
- retry policy;
- metrics;
- logging;
- error mapping;
- test seam;
- idempotency record;
- schema version governance.

Better design:

```text
Domain service
  ↓
DomainEventPublisher interface
  ↓
SnsDomainEventPublisher implementation
  ↓
SnsClient
```

Application code publishes a domain event, not raw SNS request.

---

## 18. Minimal AWS SDK for Java 2.x SNS Client

Dependency example with Maven BOM:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>bom</artifactId>
      <version>${aws.sdk.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>sns</artifactId>
  </dependency>
</dependencies>
```

Basic client:

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sns.SnsClient;

public final class SnsClients {
    private SnsClients() {
    }

    public static SnsClient create(Region region) {
        return SnsClient.builder()
                .region(region)
                .build();
    }
}
```

Production version should configure:

- credentials provider explicitly or via default chain;
- region;
- HTTP client;
- timeout;
- retry strategy;
- execution interceptor;
- metrics/logging wrapper.

Client lifecycle rule:

> Create one SNS client per configuration boundary and reuse it. Do not create one client per publish.

---

## 19. Publishing a Domain Event from Java

Example event model compatible with Java 8+.

```java
import java.time.Instant;
import java.util.Map;
import java.util.Objects;

public final class DomainEvent<T> {
    private final String eventId;
    private final String eventType;
    private final int eventVersion;
    private final Instant occurredAt;
    private final String producer;
    private final String correlationId;
    private final String causationId;
    private final String aggregateType;
    private final String aggregateId;
    private final T payload;
    private final Map<String, String> attributes;

    public DomainEvent(
            String eventId,
            String eventType,
            int eventVersion,
            Instant occurredAt,
            String producer,
            String correlationId,
            String causationId,
            String aggregateType,
            String aggregateId,
            T payload,
            Map<String, String> attributes
    ) {
        this.eventId = requireText(eventId, "eventId");
        this.eventType = requireText(eventType, "eventType");
        this.eventVersion = eventVersion;
        this.occurredAt = Objects.requireNonNull(occurredAt, "occurredAt");
        this.producer = requireText(producer, "producer");
        this.correlationId = requireText(correlationId, "correlationId");
        this.causationId = causationId;
        this.aggregateType = requireText(aggregateType, "aggregateType");
        this.aggregateId = requireText(aggregateId, "aggregateId");
        this.payload = Objects.requireNonNull(payload, "payload");
        this.attributes = Objects.requireNonNull(attributes, "attributes");
    }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }

    public String eventId() { return eventId; }
    public String eventType() { return eventType; }
    public int eventVersion() { return eventVersion; }
    public Instant occurredAt() { return occurredAt; }
    public String producer() { return producer; }
    public String correlationId() { return correlationId; }
    public String causationId() { return causationId; }
    public String aggregateType() { return aggregateType; }
    public String aggregateId() { return aggregateId; }
    public T payload() { return payload; }
    public Map<String, String> attributes() { return attributes; }
}
```

For Java 16+, this could be a record, but Java 8 compatibility means normal immutable class is more portable.

Publisher interface:

```java
public interface DomainEventPublisher {
    PublishResult publish(DomainEvent<?> event);
}
```

Result type:

```java
public final class PublishResult {
    private final String messageId;
    private final String eventId;

    public PublishResult(String messageId, String eventId) {
        this.messageId = messageId;
        this.eventId = eventId;
    }

    public String messageId() {
        return messageId;
    }

    public String eventId() {
        return eventId;
    }
}
```

SNS implementation:

```java
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sns.model.MessageAttributeValue;
import software.amazon.awssdk.services.sns.model.PublishRequest;
import software.amazon.awssdk.services.sns.model.PublishResponse;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public final class SnsDomainEventPublisher implements DomainEventPublisher {
    private final SnsClient snsClient;
    private final String topicArn;
    private final JsonSerializer jsonSerializer;

    public SnsDomainEventPublisher(
            SnsClient snsClient,
            String topicArn,
            JsonSerializer jsonSerializer
    ) {
        this.snsClient = Objects.requireNonNull(snsClient, "snsClient");
        this.topicArn = requireText(topicArn, "topicArn");
        this.jsonSerializer = Objects.requireNonNull(jsonSerializer, "jsonSerializer");
    }

    @Override
    public PublishResult publish(DomainEvent<?> event) {
        Objects.requireNonNull(event, "event");

        String body = jsonSerializer.toJson(event);

        PublishRequest request = PublishRequest.builder()
                .topicArn(topicArn)
                .message(body)
                .messageAttributes(toMessageAttributes(event))
                .build();

        PublishResponse response = snsClient.publish(request);
        return new PublishResult(response.messageId(), event.eventId());
    }

    private static Map<String, MessageAttributeValue> toMessageAttributes(DomainEvent<?> event) {
        Map<String, MessageAttributeValue> attributes = new HashMap<String, MessageAttributeValue>();

        putString(attributes, "eventId", event.eventId());
        putString(attributes, "eventType", event.eventType());
        putString(attributes, "eventVersion", Integer.toString(event.eventVersion()));
        putString(attributes, "producer", event.producer());
        putString(attributes, "correlationId", event.correlationId());
        putString(attributes, "aggregateType", event.aggregateType());
        putString(attributes, "aggregateId", event.aggregateId());

        for (Map.Entry<String, String> entry : event.attributes().entrySet()) {
            putString(attributes, entry.getKey(), entry.getValue());
        }

        return attributes;
    }

    private static void putString(Map<String, MessageAttributeValue> attributes, String key, String value) {
        if (value == null) {
            return;
        }
        attributes.put(key, MessageAttributeValue.builder()
                .dataType("String")
                .stringValue(value)
                .build());
    }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
```

The serializer can be backed by Jackson, JSON-B, Gson, or custom JSON logic. The publisher should not care.

```java
public interface JsonSerializer {
    String toJson(Object value);
}
```

---

## 20. Exception Handling in Publisher

SNS publish can fail for many reasons:

- invalid topic ARN;
- authorization failure;
- throttling;
- network timeout;
- DNS/TLS failure;
- service unavailable;
- payload too large;
- KMS permission/encryption failure;
- endpoint/account/region mismatch.

Do not leak raw SDK exceptions everywhere in domain code.

Better:

```java
public final class EventPublishException extends RuntimeException {
    private final String eventId;
    private final String eventType;

    public EventPublishException(String eventId, String eventType, String message, Throwable cause) {
        super(message, cause);
        this.eventId = eventId;
        this.eventType = eventType;
    }

    public String eventId() {
        return eventId;
    }

    public String eventType() {
        return eventType;
    }
}
```

Publisher mapping:

```java
@Override
public PublishResult publish(DomainEvent<?> event) {
    Objects.requireNonNull(event, "event");

    try {
        String body = jsonSerializer.toJson(event);
        PublishRequest request = PublishRequest.builder()
                .topicArn(topicArn)
                .message(body)
                .messageAttributes(toMessageAttributes(event))
                .build();

        PublishResponse response = snsClient.publish(request);
        return new PublishResult(response.messageId(), event.eventId());
    } catch (RuntimeException ex) {
        throw new EventPublishException(
                event.eventId(),
                event.eventType(),
                "Failed to publish domain event to SNS: eventId=" + event.eventId()
                        + ", eventType=" + event.eventType(),
                ex
        );
    }
}
```

This keeps domain/application layer aware of publication failure without coupling to SNS details.

In infrastructure-level logging, you can still inspect AWS exception details.

---

## 21. Publish in Transactional Systems

This is where many systems go wrong.

Suppose a Java service updates database and publishes SNS event:

```java
@Transactional
public void approveCase(String caseId) {
    caseRepository.markApproved(caseId);
    snsPublisher.publish(caseApprovedEvent(caseId));
}
```

Failure scenarios:

```text
DB commit succeeds, SNS publish fails → state changed but no event.
SNS publish succeeds, DB commit fails → event says approved but DB says not approved.
```

This is a dual-write problem.

### 21.1 Avoid Naive Dual Write

Naive dual write is unsafe when both state change and event publication must be reliable.

Better options:

1. Transactional outbox pattern.
2. Publish after commit with compensating reconciliation.
3. Use workflow engine/orchestration where appropriate.
4. Make event publication retryable from durable state.

### 21.2 Transactional Outbox Pattern

The service writes domain state and outbox event in the same database transaction:

```text
BEGIN
  update case status = APPROVED
  insert into outbox_events(event_id, event_type, payload, status=NEW)
COMMIT
```

Then an outbox publisher reads `NEW` events and publishes to SNS:

```text
outbox_events NEW → publish to SNS → mark PUBLISHED
```

This avoids losing events after DB commit.

SNS publisher becomes part of an event relay, not inside the domain transaction.

### 21.3 When Direct Publish Is Acceptable

Direct publish may be acceptable when:

- event is non-critical notification;
- state can be reconciled later;
- publisher failure can fail the whole operation safely;
- no database state transition is involved;
- upstream already has durable retry.

But for regulatory state transitions, direct dual write should be treated with suspicion.

---

## 22. Event Contract Design

An SNS topic is only as good as its event contract.

A contract includes:

- event name;
- version;
- payload schema;
- required fields;
- optional fields;
- semantic meaning;
- producer ownership;
- backward compatibility rule;
- deprecation policy;
- example payloads;
- privacy/security classification;
- ordering expectation;
- idempotency key;
- replay behavior.

### 22.1 Event Naming

Use stable, past-tense, domain-oriented names for facts.

Good:

```text
case.created
case.submitted
case.approved
case.rejected
document.uploaded
payment.received
```

Bad:

```text
sendNotification
processCase
doScreening
updateData
```

Past-tense event names mean the event describes something that already happened.

Commands are different:

```text
screening.requested
notification.requested
```

These may still be events, but semantically they represent requested work.

Be explicit.

### 22.2 Versioning

Two common strategies:

1. Version in event type.
2. Version in envelope field.

Example:

```text
case.approved.v1
```

or:

```json
{
  "eventType": "case.approved",
  "eventVersion": 1
}
```

Both can work. Choose one standard and enforce it.

Practical recommendation:

```json
{
  "eventType": "case.approved",
  "eventVersion": 1
}
```

Then use attributes:

```text
eventType=case.approved
eventVersion=1
```

### 22.3 Backward Compatibility

Compatible changes:

- adding optional fields;
- adding new event types;
- adding new attributes not used by existing filters;
- widening enum only if consumers tolerate unknown values.

Breaking changes:

- removing required field;
- changing field meaning;
- changing type of field;
- renaming event type;
- changing timestamp semantics;
- changing idempotency key;
- changing filter attribute meaning.

### 22.4 Unknown Field Rule

Consumers should ignore unknown fields unless there is strong reason not to.

This allows producers to add optional fields without breaking old consumers.

### 22.5 Required Field Discipline

Do not mark every field required. Required fields are expensive long-term commitments.

Ask:

```text
Can all future producers always provide this field?
Can all historical replayed events contain this field?
Will all subscribers truly need this field?
```

---

## 23. Topic Design

Topic design is a boundary design problem.

### 23.1 One Topic Per Domain Event Family

Example:

```text
case-events
application-events
document-events
payment-events
```

This is often a good balance.

### 23.2 One Topic Per Event Type

Example:

```text
case-created
case-approved
case-rejected
```

Pros:

- simple subscription;
- IAM can be event-specific;
- less need for filtering.

Cons:

- many topics;
- operational overhead;
- harder discovery;
- more infrastructure management.

### 23.3 One Giant Topic

Example:

```text
all-domain-events
```

Pros:

- easy to start;
- one publish target;
- centralized subscription.

Cons:

- noisy;
- filter policies become critical;
- unrelated domains couple through one topic;
- IAM is too broad;
- blast radius grows;
- schema governance becomes hard.

Avoid unless you have strong event bus governance.

### 23.4 Recommended Practical Default

For Java enterprise systems:

```text
one topic per bounded context or domain event family
```

Example:

```text
aceas-case-events
aceas-document-events
aceas-notification-events
aceas-payment-events
```

Then use attributes for event type filtering.

---

## 24. Message Size and Payload Strategy

SNS has message size limits. Even when under limits, large messages are often a bad idea.

Large event payloads cause:

- higher network cost;
- slower publish;
- slower fan-out;
- higher SQS storage cost;
- parsing overhead;
- duplicated data across subscribers;
- more PII leakage risk.

### 24.1 Event Should Not Be a Database Dump

Bad:

```json
{
  "eventType": "case.updated",
  "payload": {
    "entireCase": { "...": "hundreds of fields" },
    "allDocuments": [ ... ],
    "fullAuditHistory": [ ... ]
  }
}
```

Better:

```json
{
  "eventType": "case.approved",
  "payload": {
    "caseId": "CASE-2026-000123",
    "approvedAt": "2026-06-19T10:15:29Z",
    "approvedBy": "officer-001"
  }
}
```

### 24.2 Claim Check Pattern

If payload is large, store it in S3 and publish a reference.

```json
{
  "eventType": "document.analysis.requested",
  "payload": {
    "caseId": "CASE-2026-000123",
    "documentId": "DOC-001",
    "s3Bucket": "case-document-staging",
    "s3Key": "cases/CASE-2026-000123/documents/DOC-001/input.pdf",
    "checksumSha256": "..."
  }
}
```

This is the claim check pattern.

But it introduces new concerns:

- S3 object must be available when consumer reads it;
- permission must allow consumer access;
- object lifecycle must not delete too soon;
- event and object consistency must be designed;
- checksum/integrity should be verified.

---

## 25. Security Model

SNS security includes:

- publisher IAM permission;
- topic policy;
- subscriber endpoint policy;
- KMS key policy if encrypted;
- cross-account trust;
- network considerations for HTTP endpoints;
- message content classification.

### 25.1 Publisher Permission

Publisher needs:

```text
sns:Publish
```

Constrained to the topic ARN.

Bad:

```json
{
  "Action": "sns:*",
  "Resource": "*"
}
```

Better:

```json
{
  "Action": "sns:Publish",
  "Resource": "arn:aws:sns:ap-southeast-1:123456789012:case-events"
}
```

### 25.2 Topic Policy

Topic policy controls who can publish or subscribe at the resource level.

Useful for:

- cross-account publish;
- cross-account subscribe;
- service principal permissions;
- organization-level constraints.

### 25.3 SQS Queue Policy

For SNS-to-SQS, queue policy must allow SNS topic to send messages.

Constrain with `aws:SourceArn`.

### 25.4 Encryption

SNS supports server-side encryption with KMS.

If topic is encrypted, publisher and SNS service interactions must have correct KMS permissions depending on configuration.

Do not assume `sns:Publish` alone is always enough when KMS is involved.

### 25.5 Sensitive Data

Avoid publishing secrets, credentials, tokens, full NRIC/PII, or unnecessary sensitive data.

Event fan-out multiplies exposure.

A message sent to one topic may reach many queues and logs.

Rule:

> Publish the minimum data needed for subscribers to do their job.

---

## 26. Observability for SNS

SNS integration needs visibility at several points.

### 26.1 Publisher Metrics

Measure:

- publish count;
- publish latency;
- publish failure count;
- throttling count;
- retry count if available;
- payload size;
- event type count;
- success by topic;
- failure by exception class.

### 26.2 Publisher Logs

Log successful publish at debug/info depending on volume:

```json
{
  "message": "Published SNS event",
  "topicArn": "arn:aws:sns:ap-southeast-1:123456789012:case-events",
  "eventId": "01JZ8AA7R9W5F4R7PK5F7M2J2X",
  "eventType": "case.approved",
  "messageId": "sns-message-id",
  "correlationId": "corr-7c3a9c4a"
}
```

On failure:

```json
{
  "message": "Failed to publish SNS event",
  "topicArn": "arn:aws:sns:ap-southeast-1:123456789012:case-events",
  "eventId": "01JZ8AA7R9W5F4R7PK5F7M2J2X",
  "eventType": "case.approved",
  "correlationId": "corr-7c3a9c4a",
  "exceptionClass": "AuthorizationErrorException",
  "awsRequestId": "..."
}
```

Do not log full payload by default.

### 26.3 Subscription Metrics

Monitor:

- number of messages published;
- number of notifications delivered;
- number of failed notifications;
- DLQ depth;
- delivery latency if available;
- SQS queue age;
- SQS visible message count;
- Lambda errors if Lambda subscription;
- HTTP delivery failures if HTTP subscription.

### 26.4 End-to-End Trace

Correlation ID should flow:

```text
HTTP request correlationId
  → domain event envelope
  → SNS message attribute
  → SQS message
  → consumer logs
  → downstream calls
```

This makes incident reconstruction possible.

---

## 27. Java Publisher with Observability Wrapper

Instead of mixing metrics/logs in every caller, wrap publisher.

```java
public final class ObservedDomainEventPublisher implements DomainEventPublisher {
    private final DomainEventPublisher delegate;
    private final EventPublisherMetrics metrics;
    private final EventPublisherLogger logger;

    public ObservedDomainEventPublisher(
            DomainEventPublisher delegate,
            EventPublisherMetrics metrics,
            EventPublisherLogger logger
    ) {
        this.delegate = delegate;
        this.metrics = metrics;
        this.logger = logger;
    }

    @Override
    public PublishResult publish(DomainEvent<?> event) {
        long startNanos = System.nanoTime();
        try {
            PublishResult result = delegate.publish(event);
            long elapsedNanos = System.nanoTime() - startNanos;

            metrics.recordSuccess(event.eventType(), elapsedNanos);
            logger.published(event, result, elapsedNanos);

            return result;
        } catch (RuntimeException ex) {
            long elapsedNanos = System.nanoTime() - startNanos;

            metrics.recordFailure(event.eventType(), ex, elapsedNanos);
            logger.publishFailed(event, ex, elapsedNanos);

            throw ex;
        }
    }
}
```

Interfaces:

```java
public interface EventPublisherMetrics {
    void recordSuccess(String eventType, long elapsedNanos);
    void recordFailure(String eventType, Throwable error, long elapsedNanos);
}

public interface EventPublisherLogger {
    void published(DomainEvent<?> event, PublishResult result, long elapsedNanos);
    void publishFailed(DomainEvent<?> event, Throwable error, long elapsedNanos);
}
```

This lets you adapt to Micrometer, OpenTelemetry, CloudWatch EMF, or custom logging without changing publisher semantics.

---

## 28. Async Publishing

AWS SDK for Java 2.x supports async clients.

Async publishing can improve throughput, but it can also hide failure if used carelessly.

Bad:

```java
snsAsyncClient.publish(request);
return success;
```

This returns before publish completes.

Better:

```java
CompletableFuture<PublishResponse> future = snsAsyncClient.publish(request);
return future.thenApply(response -> new PublishResult(response.messageId(), event.eventId()));
```

### 28.1 When Async Helps

Async helps when:

- high publish volume;
- many concurrent remote calls;
- non-blocking application framework;
- carefully controlled backpressure;
- result completion is observed.

### 28.2 When Async Hurts

Async hurts when:

- futures are ignored;
- unbounded concurrency is allowed;
- executor/event-loop is blocked;
- publish failure is detached from transaction semantics;
- application shuts down before futures complete;
- metrics only count submission, not completion.

### 28.3 Async Boundary Rule

> An async publish is not complete when scheduled. It is complete when the future completes successfully.

For critical events, use durable outbox rather than fire-and-forget async publish.

---

## 29. Backpressure for Publishers

SNS publish can be throttled. Network calls can slow down. If your service produces events faster than SNS can accept, you need backpressure.

Options:

1. Fail request if event publish is required and SNS is unavailable.
2. Use outbox table and background publisher.
3. Use bounded in-memory queue only for non-critical best-effort events.
4. Apply rate limiting to event production.
5. Batch only if using APIs/features that support batching in your chosen flow.

Do not use unbounded queues.

Bad:

```java
ExecutorService executor = Executors.newCachedThreadPool();
```

with fire-and-forget publish under burst load.

This can create:

- thread explosion;
- heap pressure;
- connection pool exhaustion;
- retry storm;
- downstream throttling;
- process crash.

Better:

```text
bounded executor + bounded queue + rejection policy + metrics
```

For critical business events, prefer durable outbox over in-memory buffering.

---

## 30. FIFO Publishing from Java

For FIFO topics, you must provide message group ID and usually deduplication strategy.

Example:

```java
PublishRequest request = PublishRequest.builder()
        .topicArn(topicArn)
        .message(body)
        .messageGroupId("case:" + event.aggregateId())
        .messageDeduplicationId(event.eventId())
        .messageAttributes(toMessageAttributes(event))
        .build();
```

### 30.1 Message Group ID

Message group ID controls ordering scope.

Bad:

```text
messageGroupId = "global"
```

This serializes all messages and destroys throughput.

Better:

```text
messageGroupId = case:{caseId}
```

This preserves order per case while allowing parallelism across cases.

### 30.2 Deduplication ID

Use stable event ID as deduplication ID.

Do not use random value if deduplication matters.

Bad:

```java
.messageDeduplicationId(UUID.randomUUID().toString())
```

Good:

```java
.messageDeduplicationId(event.eventId())
```

### 30.3 FIFO Does Not Replace Idempotency

Even with FIFO deduplication, consumers should still be idempotent because:

- business operation may be retried outside FIFO window;
- replay may happen;
- downstream side effects may fail after partial success;
- duplicate can occur from producer/outbox behavior.

---

## 31. Cross-Account SNS Integration

Enterprise AWS setups often use separate accounts:

```text
producer account
shared integration account
consumer account
```

Cross-account SNS requires resource policy and IAM alignment.

Example patterns:

1. Producer in account A publishes to topic in account B.
2. Topic in account A sends to SQS queue in account B.
3. Central event topic fans out to subscribers across accounts.

### 31.1 Cross-Account Publish

Needs:

- producer role permission: `sns:Publish` to target topic ARN;
- topic policy allowing that principal/account to publish;
- KMS permissions if encrypted.

### 31.2 Cross-Account SQS Subscription

Needs:

- subscription setup;
- SQS queue policy allowing SNS topic ARN;
- topic policy if required;
- KMS key permissions on topic/queue encryption;
- consistent region.

### 31.3 Operational Concern

Cross-account integration creates ownership questions:

- Who owns the topic?
- Who approves new subscribers?
- Who monitors failed delivery?
- Who owns schema evolution?
- Who responds to DLQ alarms?
- Who pays for fan-out?

Do not solve cross-account SNS with only IAM JSON. Solve it as an ownership model.

---

## 32. Message Filtering and Schema Governance

Filter policies depend on stable attribute names and values.

Therefore, attributes are part of your public contract.

Changing this:

```text
eventType=case.approved
```

to this:

```text
eventName=case.approved
```

can break subscription delivery.

### 32.1 Attribute Contract

Define standard attributes:

```text
eventId
  globally unique event identifier

eventType
  stable logical event name

eventVersion
  integer version

producer
  producing service name

correlationId
  request/workflow correlation id

aggregateType
  domain aggregate type

aggregateId
  aggregate identifier

tenantId
  tenant/agency if multi-tenant

sensitivity
  public/internal/confidential/restricted
```

### 32.2 Filter Policy Test

Treat filter policies as testable artifacts.

Example test idea:

```text
Given event attributes for case.approved
When notification subscription filter is evaluated
Then message matches

Given event attributes for document.uploaded
When notification subscription filter is evaluated
Then message does not match
```

You can implement tests by evaluating JSON filter rules in build tooling or integration tests against deployed SNS in sandbox.

---

## 33. SNS and Lambda

SNS can invoke Lambda directly.

```text
SNS Topic → Lambda Function
```

This is simple and useful for lightweight subscribers.

But compare with SNS-to-SQS-to-Lambda:

```text
SNS Topic → SQS Queue → Lambda Event Source Mapping → Lambda Function
```

### 33.1 Direct SNS-to-Lambda Pros

- fewer resources;
- simple setup;
- low latency;
- good for lightweight async handlers.

### 33.2 Direct SNS-to-Lambda Cons

- less buffering control;
- retry semantics differ from queue-based worker;
- concurrency spikes can hit Lambda directly;
- DLQ/retry design must be explicit;
- operational isolation may be weaker than queue-per-subscriber.

### 33.3 Recommendation

For production backend workflows where reliability and backpressure matter, prefer:

```text
SNS → SQS → Lambda/Worker
```

Use direct SNS-to-Lambda for simple, low-risk, well-bounded tasks.

---

## 34. SNS and HTTP/S Endpoints

SNS can deliver to HTTP/S endpoints.

Use cases:

- external webhook style notification;
- legacy integration;
- partner endpoint;
- simple internal callback.

But HTTP/S endpoints must handle:

- subscription confirmation;
- message signature verification;
- retry behavior;
- idempotency;
- auth;
- TLS;
- availability;
- scaling;
- duplicate messages.

For Java services, it is often better to subscribe an SQS queue and have the Java service poll it. That way downtime does not immediately cause delivery failures.

---

## 35. Standard Subscriber Message Flow with SNS-to-SQS

```text
1. Producer publishes message to SNS topic.
2. SNS evaluates subscription filter policies.
3. SNS delivers matching message to each subscribed SQS queue.
4. Java consumer polls its own SQS queue.
5. Consumer parses event envelope.
6. Consumer validates event type/version.
7. Consumer checks idempotency store.
8. Consumer performs business side effect.
9. Consumer marks idempotency record completed.
10. Consumer deletes SQS message.
```

Failure points:

```text
Publish fails
SNS accepted but delivery to queue fails
Queue receives but consumer fails
Consumer succeeds but delete fails
Consumer partially succeeds then crashes
Message goes to SQS DLQ
Message is replayed
```

Every step must be designed.

---

## 36. Idempotency in SNS Consumers

Because SNS/SQS delivery can be duplicate, consumers need idempotency.

A basic idempotency table:

```sql
CREATE TABLE processed_events (
    consumer_name      VARCHAR(100) NOT NULL,
    event_id           VARCHAR(100) NOT NULL,
    event_type         VARCHAR(100) NOT NULL,
    aggregate_id       VARCHAR(100),
    status             VARCHAR(20) NOT NULL,
    first_seen_at      TIMESTAMP NOT NULL,
    completed_at       TIMESTAMP NULL,
    error_message      VARCHAR(1000) NULL,
    PRIMARY KEY (consumer_name, event_id)
);
```

Consumer logic:

```text
if processed_events contains COMPLETED for this consumer/eventId:
    delete message
else:
    insert PROCESSING if absent
    process event
    mark COMPLETED
    delete message
```

The idempotency key should normally be:

```text
consumerName + eventId
```

not just eventId globally, because different consumers independently process the same event.

---

## 37. Publish Error Decision Matrix

| Failure | Likely Cause | Retry? | Recommended Action |
|---|---|---:|---|
| Access denied | IAM/topic/KMS policy | No automatic blind retry | Fail fast, alert, fix permission |
| Invalid parameter | bad ARN, bad message shape | No | Fail fast, fix code/config |
| Throttling | rate/quota exceeded | Yes with backoff | Retry, rate limit, outbox backlog |
| Timeout | network/service slowness | Maybe | Retry if idempotent, observe latency |
| Service unavailable | AWS transient | Yes | Retry with jitter, circuit breaker/outbox |
| Payload too large | message design issue | No | Use claim check/S3 |
| KMS access error | key policy/grants | Usually no | Fix KMS policy/config |
| Region mismatch | wrong config | No | Fail startup or config validation |

---

## 38. Startup Validation

A Java application can validate SNS configuration at startup, but carefully.

Possible checks:

- topic ARN configured;
- region configured;
- topic exists via `GetTopicAttributes`;
- publish role has permission, if using a controlled smoke test;
- KMS permission if encrypted topic;
- expected attributes names configured.

Do not publish fake business events during startup unless topic has a test contract.

Better smoke event:

```json
{
  "eventType": "system.publisher.healthcheck",
  "eventVersion": 1,
  "producer": "case-service",
  "payload": {
    "purpose": "startup-validation"
  }
}
```

But even this may annoy subscribers unless filtered properly.

For many services, `GetTopicAttributes` plus IAM deployment tests are safer than startup publish.

---

## 39. Topic Naming

A naming convention should include:

- system/application;
- environment;
- domain;
- purpose;
- FIFO suffix if FIFO.

Example:

```text
aceas-dev-case-events
aceas-uat-case-events
aceas-prod-case-events

aceas-prod-case-events.fifo
```

Avoid names like:

```text
prod-topic
notifications
sns-topic-1
backend-events
```

A topic name should be understandable in alarms, logs, IAM policies, and incident reports.

---

## 40. Environment Separation

Do not share topics across DEV/UAT/PROD.

Bad:

```text
all environments publish to same case-events topic
```

This can cause:

- test events reaching production consumers;
- accidental data leak;
- impossible debugging;
- unsafe IAM widening;
- schema experiments affecting production.

Use account and/or naming separation:

```text
DEV account: aceas-dev-case-events
UAT account: aceas-uat-case-events
PROD account: aceas-prod-case-events
```

---

## 41. Consumer Ownership Model

Every subscription must have an owner.

Ownership metadata should answer:

```text
Subscription: notification-service-case-events
Owner team: Notification Team
Purpose: send officer/user notifications for case lifecycle events
Filter: eventType in case.approved, case.rejected, case.reopened
DLQ: notification-service-case-events-dlq
Runbook: link
SLO: process 99% within 5 minutes
Data classification: internal/confidential
```

Subscriptions without owners become ghost integrations.

Ghost integrations are dangerous because no one knows whether a message can be changed, removed, or replayed.

---

## 42. Event Catalog

A mature system maintains an event catalog.

For each event:

```text
Event type: case.approved
Version: 1
Producer: case-service
Topic: aceas-prod-case-events
Meaning: A case has moved into APPROVED state after officer approval.
Aggregate ID: caseId
Idempotency key: eventId
Ordering key: caseId if FIFO
Payload schema: link
PII: approvedBy officer ID, no applicant PII
Subscribers:
  - notification-service
  - audit-service
  - reporting-service
Compatibility: additive optional fields only for v1
Deprecation: requires 90-day notice
Replay safe: yes, if consumers use eventId idempotency
```

This prevents tribal knowledge.

---

## 43. SNS in Regulatory / Case Management Systems

For regulatory systems, SNS can distribute state transition events.

Example lifecycle:

```text
application.submitted
screening.requested
screening.completed
case.created
case.assigned
case.escalated
case.approved
case.rejected
appeal.submitted
appeal.decided
```

But events must be defensible.

A defensible event should answer:

- what happened;
- when it happened;
- who/what caused it;
- which aggregate it affects;
- which version of event schema;
- which correlation/workflow it belongs to;
- whether processing is replay-safe;
- where audit evidence is stored.

Avoid vague events:

```text
case.updated
status.changed
data.modified
```

These are hard to audit and hard for subscribers to interpret.

Prefer specific facts:

```text
case.assigned
case.approved
case.reopened
case.escalation.deadline.missed
```

---

## 44. SNS Anti-Patterns

### 44.1 Treating SNS as RPC

Bad:

```text
publish command and wait mentally for result
```

SNS is asynchronous fan-out. If you need a result, model the response event or use direct call/workflow.

### 44.2 No DLQ

Without DLQ, undeliverable messages can disappear after retries.

### 44.3 No Idempotency

Duplicate delivery will eventually hurt you.

### 44.4 One Giant Topic

A giant topic causes filter chaos and broad blast radius.

### 44.5 Business Logic in Filter Policies

Filters should route, not decide complex business rules.

### 44.6 Logging Full Payloads

Event payloads often contain sensitive data. Fan-out plus logs can leak data widely.

### 44.7 Ignoring Message Size

Large messages create performance, cost, and privacy issues.

### 44.8 Fire-and-Forget Critical Events

Critical events need durable publication strategy, usually outbox.

### 44.9 Missing Schema Version

Without versioning, safe evolution becomes guesswork.

### 44.10 No Subscription Ownership

Unowned subscribers block event evolution.

---

## 45. Production Readiness Checklist

Before using SNS in production, answer:

### Topic

- [ ] Is topic boundary clear?
- [ ] Is topic name environment-specific?
- [ ] Is topic encrypted if needed?
- [ ] Is topic policy least-privilege?
- [ ] Is owner documented?

### Publisher

- [ ] Is `SnsClient` reused?
- [ ] Are timeout/retry settings explicit?
- [ ] Are publish failures handled?
- [ ] Is event envelope stable?
- [ ] Are message attributes standardized?
- [ ] Is payload size controlled?
- [ ] Is sensitive data minimized?
- [ ] Is dual-write problem solved?
- [ ] Are metrics/logs emitted?

### Subscription

- [ ] Does each subscriber have its own queue if independent?
- [ ] Is filter policy tested?
- [ ] Is DLQ configured?
- [ ] Is queue policy constrained by source topic ARN?
- [ ] Is subscription owner documented?
- [ ] Is raw delivery decision explicit?

### Consumer

- [ ] Is consumer idempotent?
- [ ] Does consumer validate event type/version?
- [ ] Does consumer handle unknown fields?
- [ ] Does consumer have DLQ triage runbook?
- [ ] Does consumer propagate correlation ID?

### Operations

- [ ] Are publish failures alerted?
- [ ] Are DLQ depths alerted?
- [ ] Are SQS queue age metrics monitored?
- [ ] Is replay procedure documented?
- [ ] Is event catalog maintained?
- [ ] Is schema evolution process defined?

---

## 46. Design Exercise: Case Events Topic

Suppose we design a topic for case lifecycle events.

Topic:

```text
aceas-prod-case-events
```

Publisher:

```text
case-service
```

Events:

```text
case.created
case.assigned
case.approved
case.rejected
case.reopened
case.escalated
```

Subscribers:

```text
notification-service
  filter: case.assigned, case.approved, case.rejected, case.escalated

audit-service
  filter: all case events

reporting-service
  filter: case.created, case.approved, case.rejected

screening-service
  filter: case.created
```

Architecture:

```text
case-service
    |
    v
SNS: aceas-prod-case-events
    |
    +--> SQS: notification-case-events
    |       +--> DLQ: notification-case-events-dlq
    |
    +--> SQS: audit-case-events
    |       +--> DLQ: audit-case-events-dlq
    |
    +--> SQS: reporting-case-events
    |       +--> DLQ: reporting-case-events-dlq
    |
    +--> SQS: screening-case-events
            +--> DLQ: screening-case-events-dlq
```

Event envelope for `case.approved`:

```json
{
  "eventId": "01JZ8AA7R9W5F4R7PK5F7M2J2X",
  "eventType": "case.approved",
  "eventVersion": 1,
  "occurredAt": "2026-06-19T10:15:30Z",
  "producer": "case-service",
  "correlationId": "corr-7c3a9c4a",
  "causationId": "approve-command-1001",
  "aggregateType": "case",
  "aggregateId": "CASE-2026-000123",
  "payload": {
    "caseId": "CASE-2026-000123",
    "approvedAt": "2026-06-19T10:15:29Z",
    "approvedBy": "officer-001",
    "previousStatus": "UNDER_REVIEW",
    "newStatus": "APPROVED"
  }
}
```

Message attributes:

```text
eventId=01JZ8AA7R9W5F4R7PK5F7M2J2X
eventType=case.approved
eventVersion=1
producer=case-service
correlationId=corr-7c3a9c4a
aggregateType=case
aggregateId=CASE-2026-000123
tenantId=cea
```

Notification filter:

```json
{
  "eventType": ["case.assigned", "case.approved", "case.rejected", "case.escalated"]
}
```

Reporting filter:

```json
{
  "eventType": ["case.created", "case.approved", "case.rejected"]
}
```

Audit filter:

```json
{
  "aggregateType": ["case"]
}
```

This design gives:

- producer decoupling;
- subscriber isolation;
- testable filtering;
- replay-safe event ID;
- correlation traceability;
- regulated audit path.

---

## 47. How to Think Like a Top 1% Engineer Here

A surface-level engineer asks:

```text
How do I publish an SNS message from Java?
```

A strong engineer asks:

```text
What fact am I publishing?
Who owns the event contract?
Can this event be duplicated?
Can it arrive out of order?
What if the publish succeeds but subscriber fails?
What if DB commit succeeds but publish fails?
Who owns each subscription?
What is the DLQ recovery process?
Can the message be replayed safely?
Does the payload leak sensitive data?
Can this topic evolve for five years?
What metrics prove the system is healthy?
```

SNS itself is simple. The system around SNS is where engineering maturity shows.

---

## 48. Summary

SNS is a managed pub/sub fan-out service. Its value is not only sending messages, but decoupling producers from subscribers.

The most reliable backend pattern is often:

```text
Producer → SNS Topic → SQS Queue per Subscriber → Java Worker/Lambda
```

Design assumptions:

- publish success is not subscriber success;
- delivery can be duplicate;
- standard topics do not guarantee strict ordering;
- subscribers must be idempotent;
- filter policies are part of the contract;
- DLQ must have owner and runbook;
- event schema must be governed;
- critical events need durable publication, often outbox;
- observability must cover publisher, topic, subscription, queue, and consumer.

If you internalize this, SNS becomes more than a notification service. It becomes a reliable integration boundary for distributed Java systems.

---

## 49. References

Primary references used for this part:

- AWS SDK for Java 2.x — Amazon SNS examples.
- Amazon SNS Developer Guide — publishing messages.
- Amazon SNS Developer Guide — subscription filter policies and message filtering.
- Amazon SNS Developer Guide — SNS to SQS subscription setup.
- Amazon SNS Developer Guide — SNS dead-letter queues.
- Amazon SNS Developer Guide — SNS message delivery retries.
- AWS SDK for Java 2.x API Reference — `SnsClient` and `PublishRequest`.

---

## 50. Next Part

Next: **Part 16 — SNS + SQS Event-Driven Architecture Patterns**.

Part 15 focused on SNS fundamentals and pub/sub integration. Part 16 will combine SNS and SQS into deeper event-driven architecture patterns: fan-out per bounded context, async command vs domain event, replay strategy, event versioning, subscriber isolation, ordering trade-offs, idempotent projection, and auditability.


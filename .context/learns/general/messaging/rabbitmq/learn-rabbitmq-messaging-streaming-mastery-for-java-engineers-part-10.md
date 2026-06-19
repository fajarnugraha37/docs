# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-10.md

# Part 10 — Spring AMQP Deep Dive

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Bagian: `10 / 34`  
> Fokus: memahami Spring AMQP sebagai abstraction layer di atas AMQP/RabbitMQ, bukan sekadar memakai annotation.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membangun fondasi dari sisi RabbitMQ native:

- exchange, queue, binding, routing key;
- classic/quorum/stream queue semantics;
- Java RabbitMQ client tanpa Spring;
- publisher confirms, returns, mandatory publish;
- consumer ack, nack, reject, redelivery, prefetch;
- retry, DLX, DLQ, poison message, parking lot.

Part ini naik satu layer: **Spring AMQP**.

Tujuan part ini bukan membuat kamu sekadar tahu:

```java
@RabbitListener(queues = "some.queue")
public void handle(SomeMessage message) { }
```

Itu terlalu dangkal.

Yang harus kamu kuasai adalah:

- Spring AMQP menyembunyikan apa?
- Spring AMQP tidak menyembunyikan apa?
- abstraction mana yang aman dipakai default?
- abstraction mana yang bisa membuat reliability behavior menjadi tidak jelas?
- kapan perlu turun ke `Channel` native?
- bagaimana men-design topology, publisher, consumer, retry, DLQ, dan converter secara explicit?
- bagaimana memastikan Spring config tidak membuat RabbitMQ system tampak reliable padahal sebenarnya tidak?

Spring AMQP sangat produktif, tetapi abstraction yang terlalu nyaman bisa berbahaya kalau engineer tidak paham AMQP primitive di bawahnya.

---

## 1. Mental Model Utama

Spring AMQP adalah **programming model**, bukan pengganti RabbitMQ semantics.

RabbitMQ tetap bekerja dengan primitive berikut:

```text
Producer
  -> Exchange
      -> Binding
          -> Queue
              -> Consumer
```

Spring AMQP memberi wrapper di atas primitive tersebut:

```text
RabbitTemplate
  -> publish/send abstraction

RabbitAdmin
  -> declare exchange/queue/binding

MessageConverter
  -> Java object <-> AMQP message body/properties

Listener Container
  -> connection/channel/consumer thread/ack/error lifecycle

@RabbitListener
  -> declarative message handler endpoint
```

Jadi mapping mentalnya:

| RabbitMQ / AMQP Concept | Spring AMQP Abstraction |
|---|---|
| connection factory | `ConnectionFactory`, usually `CachingConnectionFactory` |
| channel | managed by template/container |
| exchange | `Exchange`, `DirectExchange`, `TopicExchange`, etc. |
| queue | `Queue`, `QueueBuilder` |
| binding | `Binding`, `BindingBuilder` |
| publish | `RabbitTemplate` / `AmqpTemplate` |
| consume | listener container / `@RabbitListener` |
| message body | `Message` / converter-mapped POJO |
| message properties | `MessageProperties` |
| ack/nack | container ack mode or manual `Channel` ack |
| retry | advice chain / error handler / recoverer / DLQ |

The key principle:

> Spring can manage ceremony, but your architecture still owns semantics.

---

## 2. What Spring AMQP Actually Provides

Spring AMQP applies common Spring concepts to AMQP-based messaging:

- dependency injection;
- template-based publishing;
- declarative listener endpoints;
- listener containers;
- message conversion;
- resource declaration;
- error handling hooks;
- retry integration;
- transaction integration;
- connection/channel caching;
- observability integration depending on stack.

It is useful because raw RabbitMQ Java client code quickly accumulates boilerplate:

- create connection;
- create channel;
- declare topology;
- serialize payload;
- set properties;
- publish;
- wait confirm;
- consume;
- map bytes to object;
- handle exception;
- ack/nack;
- recover connection;
- shutdown cleanly.

Spring AMQP compresses this into application-level code.

But compression has a cost: many critical decisions move into configuration.

A weak Spring AMQP system usually fails because the team does not know which defaults they accepted.

---

## 3. Important Source Baseline

This part is aligned with the current official Spring AMQP and Spring Boot AMQP references:

- Spring AMQP provides template abstraction for sending/receiving and support for message-driven POJOs.
- Spring Boot auto-configures Rabbit infrastructure and allows `@RabbitListener` endpoints when Rabbit infrastructure is present.
- Spring AMQP listener containers support acknowledgement modes including `NONE`, `AUTO`, and `MANUAL`.
- `RabbitTemplate` supports publisher confirms and returns when configured with the proper connection factory/template settings.
- Spring AMQP provides both `SimpleMessageListenerContainer` and `DirectMessageListenerContainer`, with different threading and concurrency behavior.

References are listed at the end of the document.

---

## 4. Core Components Overview

A production Spring AMQP application usually has these major pieces:

```text
@Configuration
  -> Rabbit topology beans
  -> RabbitTemplate customization
  -> ConnectionFactory customization
  -> ListenerContainerFactory customization
  -> MessageConverter customization
  -> Retry/ErrorHandler configuration

@Service Publisher
  -> RabbitTemplate.convertAndSend(...)

@Component Consumer
  -> @RabbitListener(...)
  -> handler method

Infrastructure
  -> RabbitAdmin declares topology
  -> listener container consumes messages
  -> converter maps payloads
  -> error handler decides retry/reject/recover
```

If this looks “simple”, be careful. Most behavior lives in:

- container factory;
- template callbacks;
- converter;
- retry advice;
- queue arguments;
- DLQ topology;
- transaction boundary;
- idempotency code.

---

## 5. Dependency Setup

For a Spring Boot Java service:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

Typical test dependencies:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-test</artifactId>
  <scope>test</scope>
</dependency>

<dependency>
  <groupId>org.testcontainers</groupId>
  <artifactId>rabbitmq</artifactId>
  <scope>test</scope>
</dependency>
```

For JSON messages:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
</dependency>
```

In most Boot apps, the starter pulls the right Spring AMQP modules transitively.

---

## 6. Baseline Configuration

Example `application.yml`:

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: app
    password: app
    virtual-host: app_vhost
    connection-timeout: 5s

    publisher-confirm-type: correlated
    publisher-returns: true

    template:
      mandatory: true
      retry:
        enabled: false

    listener:
      type: simple
      simple:
        acknowledge-mode: manual
        prefetch: 20
        concurrency: 2
        max-concurrency: 8
        default-requeue-rejected: false
        retry:
          enabled: false
```

This baseline says:

- publisher confirms are enabled;
- publisher returns are enabled;
- unroutable messages are returned when mandatory publish is used;
- consumers use manual ack;
- each consumer can have up to 20 unacked messages;
- listener errors do not silently requeue by default;
- application-level retry is intentionally disabled until explicitly designed.

The exact properties may evolve across Spring Boot versions, so always verify with your project’s Boot version. But the semantics are stable: make publisher reliability and consumer ack behavior explicit.

---

## 7. ConnectionFactory and CachingConnectionFactory

Spring AMQP normally uses a `CachingConnectionFactory`.

Do not read “caching” as “connection pooling like JDBC”. AMQP connections and channels have different economics.

RabbitMQ Java client model:

```text
Connection = TCP connection to broker
Channel    = virtual AMQP session multiplexed over connection
```

Spring model:

```text
CachingConnectionFactory
  -> maintains underlying connection(s)
  -> caches channels
  -> supports publisher confirms/returns
  -> used by RabbitTemplate and listener containers
```

Why channel caching matters:

- creating channels constantly has overhead;
- templates need channels for publish;
- listener containers need channels for consumers;
- publisher confirms are channel-scoped;
- delivery tags are channel-scoped.

A minimal explicit bean:

```java
@Configuration
public class RabbitConnectionConfig {

    @Bean
    CachingConnectionFactory rabbitConnectionFactory(
            RabbitProperties properties
    ) {
        CachingConnectionFactory factory = new CachingConnectionFactory();
        factory.setHost(properties.getHost());
        factory.setPort(properties.getPort());
        factory.setUsername(properties.getUsername());
        factory.setPassword(properties.getPassword());
        factory.setVirtualHost(properties.getVirtualHost());

        factory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        factory.setPublisherReturns(true);

        return factory;
    }
}
```

In many Boot apps you do not need to define this manually; Boot auto-configures it. But knowing the underlying object is essential because publisher confirm/return support depends on it.

### Design Rule

For production publishing:

```text
publisher confirms enabled
+ returns enabled
+ template mandatory true
+ callback/confirm handling
```

Without this, your publisher may silently lose routing failures or treat “sent to socket” as “safely accepted by broker”.

---

## 8. RabbitAdmin and Declarative Topology

`RabbitAdmin` declares AMQP resources at application startup:

- exchanges;
- queues;
- bindings.

Example:

```java
@Configuration
public class CaseMessagingTopology {

    public static final String CASE_EVENTS_EXCHANGE = "case.events.v1";
    public static final String REVIEW_QUEUE = "case.review.assignment.v1.q";
    public static final String REVIEW_DLQ = "case.review.assignment.v1.dlq";
    public static final String REVIEW_DLX = "case.review.assignment.v1.dlx";

    @Bean
    TopicExchange caseEventsExchange() {
        return ExchangeBuilder
                .topicExchange(CASE_EVENTS_EXCHANGE)
                .durable(true)
                .build();
    }

    @Bean
    DirectExchange reviewDlx() {
        return ExchangeBuilder
                .directExchange(REVIEW_DLX)
                .durable(true)
                .build();
    }

    @Bean
    Queue reviewAssignmentQueue() {
        return QueueBuilder
                .durable(REVIEW_QUEUE)
                .quorum()
                .deadLetterExchange(REVIEW_DLX)
                .deadLetterRoutingKey(REVIEW_DLQ)
                .deliveryLimit(5)
                .build();
    }

    @Bean
    Queue reviewAssignmentDlq() {
        return QueueBuilder
                .durable(REVIEW_DLQ)
                .quorum()
                .build();
    }

    @Bean
    Binding reviewAssignmentBinding() {
        return BindingBuilder
                .bind(reviewAssignmentQueue())
                .to(caseEventsExchange())
                .with("case.review.assignment.requested");
    }

    @Bean
    Binding reviewDlqBinding() {
        return BindingBuilder
                .bind(reviewAssignmentDlq())
                .to(reviewDlx())
                .with(REVIEW_DLQ);
    }
}
```

### Why Declarative Topology Is Good

It keeps infrastructure close to code:

- queue names are versioned;
- binding keys are explicit;
- DLQ behavior is visible;
- integration tests can load the same topology;
- local/dev environments become easier.

### Why Declarative Topology Can Be Dangerous

Application startup can mutate broker topology.

Danger cases:

- app accidentally creates queues in production with wrong arguments;
- two versions of service declare same queue differently;
- immutable queue arguments conflict;
- startup fails because queue already exists with incompatible type;
- developer changes routing key casually and silently changes production routing.

### Production Rule

For serious systems, topology should be treated like schema:

```text
versioned
reviewed
migrated intentionally
observable
owned by a service or platform team
```

Spring declaration is excellent for local/test and controlled deployments, but topology governance still matters.

---

## 9. Exchange, Queue, Binding Beans

Spring AMQP has builders for common topology types:

```java
@Bean
DirectExchange commandExchange() {
    return ExchangeBuilder.directExchange("case.commands.v1")
            .durable(true)
            .build();
}

@Bean
TopicExchange eventExchange() {
    return ExchangeBuilder.topicExchange("case.events.v1")
            .durable(true)
            .build();
}

@Bean
FanoutExchange auditFanoutExchange() {
    return ExchangeBuilder.fanoutExchange("case.audit.fanout.v1")
            .durable(true)
            .build();
}
```

Queue examples:

```java
@Bean
Queue classicShortLivedQueue() {
    return QueueBuilder
            .durable("case.notification.short.v1.q")
            .build();
}

@Bean
Queue quorumCommandQueue() {
    return QueueBuilder
            .durable("case.command.evaluate-risk.v1.q")
            .quorum()
            .deliveryLimit(5)
            .build();
}

@Bean
Queue ttlRetryQueue() {
    return QueueBuilder
            .durable("case.command.evaluate-risk.v1.retry.30s.q")
            .ttl(30_000)
            .deadLetterExchange("case.commands.v1")
            .deadLetterRoutingKey("case.evaluate-risk")
            .build();
}
```

Binding example:

```java
@Bean
Binding evaluateRiskBinding() {
    return BindingBuilder
            .bind(quorumCommandQueue())
            .to(commandExchange())
            .with("case.evaluate-risk");
}
```

### Design Rule

Queue arguments are architecture decisions.

Examples:

- `x-queue-type=quorum` says: replicated durable work queue.
- `x-dead-letter-exchange=...` says: failed processing has an explicit route.
- `x-message-ttl=...` says: messages expire or delay by broker policy.
- `x-delivery-limit=...` says: poison messages must stop cycling.

Do not hide these decisions inside random config snippets.

---

## 10. RabbitTemplate Deep Dive

`RabbitTemplate` is the main publishing abstraction.

Common methods:

```java
rabbitTemplate.convertAndSend(exchange, routingKey, object);
rabbitTemplate.send(exchange, routingKey, message);
rabbitTemplate.receive(queueName);
rabbitTemplate.convertSendAndReceive(exchange, routingKey, request);
```

For production publishing, prefer wrapping `RabbitTemplate` behind a domain-specific publisher.

Bad:

```java
@Service
public class SomeService {
    private final RabbitTemplate rabbitTemplate;

    public void doSomething() {
        rabbitTemplate.convertAndSend("x", "rk", new HashMap<>());
    }
}
```

Better:

```java
@Service
public class CaseEventPublisher {

    private final RabbitTemplate rabbitTemplate;

    public CaseEventPublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    public void publishReviewAssignmentRequested(ReviewAssignmentRequested event) {
        rabbitTemplate.convertAndSend(
                "case.events.v1",
                "case.review.assignment.requested",
                event,
                message -> {
                    MessageProperties props = message.getMessageProperties();
                    props.setMessageId(event.messageId().toString());
                    props.setCorrelationId(event.correlationId());
                    props.setContentType(MessageProperties.CONTENT_TYPE_JSON);
                    props.setHeader("event_type", "ReviewAssignmentRequested");
                    props.setHeader("schema_version", "1");
                    props.setHeader("producer", "case-service");
                    return message;
                }
        );
    }
}
```

Why this is better:

- routing decision is centralized;
- metadata is consistent;
- message type is explicit;
- future outbox integration is easier;
- observability hooks are easier;
- tests can verify publication behavior.

---

## 11. Message vs POJO Publishing

Spring lets you publish plain Java objects:

```java
rabbitTemplate.convertAndSend(exchange, routingKey, event);
```

This uses a `MessageConverter`.

The convenience is good, but beware:

- Java class name leakage;
- missing schema version;
- inconsistent headers;
- ambiguous content type;
- unsafe deserialization assumptions;
- tight coupling between producer and consumer codebase.

For internal systems, POJO conversion is fine if you explicitly govern the message contract.

For cross-service systems, treat payload as a contract document:

```json
{
  "caseId": "CASE-2026-000123",
  "assignmentId": "ASSIGN-789",
  "reviewerRole": "SENIOR_REVIEWER",
  "requestedAt": "2026-06-19T10:15:30Z"
}
```

With metadata:

```text
message_id: 7c4d...
correlation_id: case-flow-...
causation_id: previous-message-id
event_type: ReviewAssignmentRequested
schema_version: 1
producer: case-service
content_type: application/json
```

---

## 12. MessageConverter

A typical JSON converter:

```java
@Configuration
public class RabbitMessageConverterConfig {

    @Bean
    Jackson2JsonMessageConverter jsonMessageConverter(ObjectMapper objectMapper) {
        return new Jackson2JsonMessageConverter(objectMapper);
    }

    @Bean
    RabbitTemplate rabbitTemplate(
            ConnectionFactory connectionFactory,
            Jackson2JsonMessageConverter converter
    ) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(converter);
        template.setMandatory(true);
        return template;
    }
}
```

### Converter Risk

Some converters include Java type metadata headers. That can be convenient inside a single application, but problematic across services.

Questions to ask:

- Can a non-Java consumer understand this message?
- Does the payload contract depend on package names?
- What happens if the class is renamed?
- Can old consumers read new messages?
- Can new consumers read old messages?

For serious service boundaries, prefer explicit contract metadata rather than relying blindly on Java type mapping.

---

## 13. Publisher Confirms with RabbitTemplate

Publisher confirms answer:

> Did the broker accept responsibility for this published message?

They do **not** answer:

> Did a consumer process this message?

Enable confirms and returns:

```yaml
spring:
  rabbitmq:
    publisher-confirm-type: correlated
    publisher-returns: true
    template:
      mandatory: true
```

Configure callbacks:

```java
@Configuration
public class RabbitPublisherConfirmConfig {

    @Bean
    RabbitTemplate rabbitTemplate(
            ConnectionFactory connectionFactory,
            MessageConverter messageConverter
    ) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter);
        template.setMandatory(true);

        template.setConfirmCallback((correlationData, ack, cause) -> {
            String id = correlationData != null ? correlationData.getId() : "unknown";

            if (ack) {
                // Broker confirmed publish.
                // Mark outbox row as published, or record success metric.
                return;
            }

            // Broker nacked publish.
            // Do not assume message is safe.
            // Trigger retry/reconciliation via durable outbox.
            logPublishNack(id, cause);
        });

        template.setReturnsCallback(returned -> {
            // Message reached exchange but was unroutable.
            // This is a topology/routing failure, not a consumer failure.
            logReturnedMessage(returned);
        });

        return template;
    }

    private void logPublishNack(String id, String cause) {
        // replace with structured logging/metrics/outbox state update
    }

    private void logReturnedMessage(ReturnedMessage returned) {
        // replace with structured logging/metrics/alerting
    }
}
```

Publishing with correlation data:

```java
public void publish(ReviewAssignmentRequested event) {
    CorrelationData correlationData = new CorrelationData(event.messageId().toString());

    rabbitTemplate.convertAndSend(
            "case.events.v1",
            "case.review.assignment.requested",
            event,
            message -> enrich(message, event),
            correlationData
    );
}
```

### Critical Distinction

| Mechanism | Meaning |
|---|---|
| confirm ack | broker accepted the publish |
| confirm nack | broker did not accept the publish |
| return callback | message was unroutable with mandatory publish |
| consumer ack | consumer successfully processed delivery |

Do not mix these layers.

---

## 14. RabbitTemplate and Outbox

For high-integrity systems, do not rely only on in-memory confirm callback.

Use transactional outbox:

```text
DB transaction:
  1. update domain state
  2. insert outbox message
  3. commit

Outbox relay:
  1. read unpublished outbox row
  2. publish to RabbitMQ with correlation data
  3. wait/observe confirm
  4. mark outbox row published
```

Spring AMQP participates in publication, but it does not magically solve the DB+message atomicity problem.

Bad assumption:

```text
@Transactional method + rabbitTemplate.convertAndSend = atomic DB+RabbitMQ commit
```

That is not generally true.

A safe design makes the failure window explicit.

---

## 15. @RabbitListener Basics

Basic listener:

```java
@Component
public class ReviewAssignmentListener {

    @RabbitListener(queues = "case.review.assignment.v1.q")
    public void handle(ReviewAssignmentRequested event) {
        // process event
    }
}
```

This is convenient, but incomplete for production.

A more explicit listener:

```java
@Component
public class ReviewAssignmentListener {

    @RabbitListener(
            queues = "case.review.assignment.v1.q",
            containerFactory = "manualAckRabbitListenerContainerFactory"
    )
    public void handle(
            ReviewAssignmentRequested event,
            Message message,
            Channel channel
    ) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();

        try {
            process(event, message);
            channel.basicAck(deliveryTag, false);
        } catch (PermanentBusinessException ex) {
            channel.basicReject(deliveryTag, false); // DLQ if configured
        } catch (TransientBusinessException ex) {
            channel.basicReject(deliveryTag, false); // DLQ/retry topology handles delay
        } catch (Exception ex) {
            channel.basicReject(deliveryTag, false); // avoid uncontrolled immediate requeue
        }
    }

    private void process(ReviewAssignmentRequested event, Message message) {
        // domain logic
    }
}
```

This shows the real mechanics:

- the listener receives a delivery;
- processing succeeds or fails;
- the consumer explicitly acknowledges or rejects;
- DLQ/retry topology receives failed messages.

---

## 16. Listener Containers

`@RabbitListener` is implemented by listener containers.

Spring AMQP commonly provides:

- `SimpleMessageListenerContainer` / SMLC;
- `DirectMessageListenerContainer` / DMLC.

### SimpleMessageListenerContainer

SMLC is widely used and mature.

Conceptually:

```text
RabbitMQ consumer
  -> internal handoff
      -> listener execution thread
```

It supports:

- configurable concurrency;
- dynamic scaling with max concurrency;
- batch-related behavior;
- many configuration options.

Typical config:

```java
@Bean
SimpleRabbitListenerContainerFactory manualAckRabbitListenerContainerFactory(
        ConnectionFactory connectionFactory,
        MessageConverter messageConverter
) {
    SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setMessageConverter(messageConverter);
    factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
    factory.setPrefetchCount(20);
    factory.setConcurrentConsumers(2);
    factory.setMaxConcurrentConsumers(8);
    factory.setDefaultRequeueRejected(false);
    return factory;
}
```

### DirectMessageListenerContainer

DMLC gives a more direct consumer-to-listener execution model.

Typical config:

```java
@Bean
DirectRabbitListenerContainerFactory directManualAckContainerFactory(
        ConnectionFactory connectionFactory,
        MessageConverter messageConverter
) {
    DirectRabbitListenerContainerFactory factory = new DirectRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setMessageConverter(messageConverter);
    factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
    factory.setPrefetchCount(20);
    factory.setConsumersPerQueue(2);
    factory.setDefaultRequeueRejected(false);
    return factory;
}
```

### Choosing Container Type

Use SMLC when:

- you want mature defaults;
- dynamic concurrency is useful;
- you need broad feature compatibility;
- the team is familiar with it.

Use DMLC when:

- you want more direct consumption behavior;
- you need different latency/threading characteristics;
- you understand its operational differences.

Do not choose based on “newer sounds better”. Choose based on measured behavior and operational needs.

---

## 17. Acknowledgement Modes

Spring AMQP listener containers support three key ack modes:

| Mode | Broker Meaning | When to Use |
|---|---|---|
| `NONE` | broker treats delivery as auto-acked | rare, only for disposable messages |
| `AUTO` | container acks if listener succeeds; failure path depends on exceptions/config | acceptable for simple use cases |
| `MANUAL` | listener explicitly calls ack/nack/reject | preferred for high-integrity workflows |

### NONE

```text
message delivered -> broker considers it done immediately
```

If consumer crashes during processing, the message is gone.

Use only when data loss is acceptable.

### AUTO

```text
listener returns normally -> container ack
listener throws -> container handles failure based on config
```

This is convenient, but failure behavior can become implicit.

Questions:

- Does it requeue?
- Does it reject?
- Does it retry in-memory?
- Does it send to DLQ?
- Does it wrap exception?

If the team cannot answer, AUTO is dangerous.

### MANUAL

```text
listener owns ack decision
```

Manual mode is verbose but clear.

For regulatory/case-management style systems, manual ack is often easier to reason about because the handler can align acknowledgement with application state transition.

---

## 18. defaultRequeueRejected

One of the most important container settings:

```java
factory.setDefaultRequeueRejected(false);
```

If messages are requeued immediately after failure, you can create a tight poison-message loop:

```text
consume -> fail -> requeue -> consume -> fail -> requeue -> ...
```

This causes:

- CPU churn;
- log spam;
- queue starvation;
- consumer saturation;
- failure amplification;
- ordering disruption;
- observability noise.

Safer default:

```text
on failure -> reject without requeue -> DLX/DLQ/retry topology handles next step
```

This creates a visible failure path instead of an invisible loop.

---

## 19. Prefetch in Spring AMQP

Prefetch controls how many unacked messages a consumer can hold.

Example:

```java
factory.setPrefetchCount(20);
factory.setConcurrentConsumers(4);
```

Upper bound of in-flight deliveries:

```text
prefetch * consumers = 20 * 4 = 80 unacked messages
```

This matters for:

- memory;
- fairness;
- ordering;
- redelivery after crash;
- external API pressure;
- DB connection pool pressure.

### Example Capacity Reasoning

Suppose each message handler:

- calls database;
- uses one DB connection;
- takes 200 ms average;
- has consumer concurrency 8;
- prefetch 50.

Potential unacked messages:

```text
8 * 50 = 400
```

But actual concurrent processing might be 8 threads, while 392 messages wait buffered by consumers. If the process dies, those 400 messages may be redelivered.

For fairness and crash recovery, too-large prefetch can be harmful.

### Rule of Thumb

For work queues:

```text
prefetch should roughly match actual parallelism and downstream capacity
```

For slow expensive tasks:

```text
prefetch = 1..N small
```

For fast idempotent tasks:

```text
prefetch can be higher
```

But measure.

---

## 20. Concurrency Configuration

SMLC:

```java
factory.setConcurrentConsumers(2);
factory.setMaxConcurrentConsumers(8);
```

Or via properties:

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        concurrency: 2
        max-concurrency: 8
        prefetch: 20
```

DMLC:

```java
factory.setConsumersPerQueue(2);
```

Concurrency is not just throughput. It changes semantics.

Higher concurrency means:

- more parallelism;
- more unacked messages;
- more duplicate risk during crash;
- weaker apparent ordering;
- more downstream pressure;
- faster poison message amplification if retry is wrong.

Architecture question:

```text
What is the maximum number of messages this service may process concurrently without violating domain invariants?
```

For example, if a case transition must be serialized per `caseId`, concurrency across cases is fine, but concurrency within the same case may be unsafe.

RabbitMQ queue concurrency alone does not enforce per-key serialization unless you design routing/partitioning accordingly.

---

## 21. Error Handling Model

Spring AMQP has several layers where errors can be handled:

```text
handler method
  -> listener adapter
      -> error handler
          -> retry interceptor / advice chain
              -> message recoverer
                  -> container rejection behavior
                      -> broker DLX/DLQ
```

This is powerful but can become confusing.

### Local Handler Try/Catch

Manual ack style:

```java
try {
    service.process(event);
    channel.basicAck(tag, false);
} catch (PermanentBusinessException e) {
    channel.basicReject(tag, false);
} catch (TransientBusinessException e) {
    channel.basicReject(tag, false);
} catch (Exception e) {
    channel.basicReject(tag, false);
}
```

Pros:

- explicit;
- easy to reason;
- failure taxonomy is visible.

Cons:

- repetitive;
- easy to implement inconsistently;
- can bypass common retry/error infrastructure.

### Container-Level Error Handling

AUTO ack style often relies on container error handling.

Example:

```java
factory.setErrorHandler(t -> {
    // inspect ListenerExecutionFailedException, log, classify, etc.
});
```

Pros:

- centralized;
- less boilerplate.

Cons:

- easy to hide business semantics;
- harder to align ack with domain transaction;
- config must be well understood.

### Recommended Approach

For high-value systems:

- keep domain failure classification explicit;
- use DLQ/retry topology for durable retry;
- avoid infinite immediate requeue;
- avoid in-memory retry for long delays;
- centralize common logging/metrics;
- ensure handler behavior is testable.

---

## 22. Retry in Spring AMQP

Spring AMQP can integrate retry advice.

Conceptually:

```text
consume delivery
  -> try listener
  -> retry in memory N times
  -> recover or reject
```

This is useful for very short transient glitches.

Example:

```java
@Bean
SimpleRabbitListenerContainerFactory retryingContainerFactory(
        ConnectionFactory connectionFactory,
        MessageConverter messageConverter
) {
    SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setMessageConverter(messageConverter);
    factory.setAcknowledgeMode(AcknowledgeMode.AUTO);
    factory.setDefaultRequeueRejected(false);

    RetryInterceptorBuilder.StatelessRetryInterceptorBuilder retryBuilder =
            RetryInterceptorBuilder.stateless()
                    .maxAttempts(3)
                    .backOffOptions(100, 2.0, 1_000)
                    .recoverer(new RejectAndDontRequeueRecoverer());

    factory.setAdviceChain(retryBuilder.build());
    return factory;
}
```

### In-Memory Retry vs Broker-Based Retry

| Retry Type | Good For | Bad For |
|---|---|---|
| in-memory retry | tiny transient failures, milliseconds/seconds | long delays, process restart, overload |
| broker TTL retry | durable delayed retry | complex topology, x-death handling |
| app-scheduled retry | precise control and audit | more code/state |
| parking lot | human remediation | not automatic recovery |

### Rule

Use in-memory retry only for short, cheap, bounded retries.

For durable retry with minutes/hours delays, use RabbitMQ topology or application state.

---

## 23. MessageRecoverer

A `MessageRecoverer` decides what happens after retries are exhausted.

Examples:

- reject and do not requeue;
- republish to another exchange;
- log and swallow;
- custom recoverer.

A dangerous recoverer is one that makes failure disappear.

Bad:

```text
retry exhausted -> log only -> ack/swallow
```

Unless message loss is explicitly acceptable, this is wrong.

Safer:

```text
retry exhausted -> reject without requeue -> DLQ
```

or:

```text
retry exhausted -> republish to failure exchange with metadata -> ack original only after confirm
```

Be careful with republishing recoverers: if you republish without confirm and then ack original, you can lose the failure record.

---

## 24. Manual Ack with Spring Listener

Manual ack listener signature:

```java
@RabbitListener(
        queues = "case.review.assignment.v1.q",
        containerFactory = "manualAckRabbitListenerContainerFactory"
)
public void handle(
        ReviewAssignmentRequested event,
        Message message,
        Channel channel
) throws IOException {
    long tag = message.getMessageProperties().getDeliveryTag();

    try {
        reviewService.assign(event);
        channel.basicAck(tag, false);
    } catch (DuplicateMessageException e) {
        // Already processed means safe to ack.
        channel.basicAck(tag, false);
    } catch (PermanentBusinessException e) {
        channel.basicReject(tag, false);
    } catch (Exception e) {
        channel.basicReject(tag, false);
    }
}
```

### Why Duplicate Can Be Acked

If idempotency table says message already processed, redelivery is safe to ack:

```text
message redelivered
  -> idempotency key exists with success
  -> no need to repeat side effect
  -> ack
```

This prevents duplicate messages from becoming permanent DLQ noise.

---

## 25. Transaction Boundary with Manual Ack

A common reliable pattern:

```text
receive message
  -> begin DB transaction
      -> check idempotency key
      -> apply domain transition
      -> write idempotency processed marker
  -> commit DB transaction
  -> ack message
```

If crash happens before ack but after DB commit:

```text
message redelivered
  -> idempotency key exists
  -> handler skips duplicate side effect
  -> ack
```

This is at-least-once done correctly.

Pseudo-code:

```java
@Transactional
public ProcessingResult process(ReviewAssignmentRequested event) {
    if (processedMessageRepository.exists(event.messageId())) {
        return ProcessingResult.duplicateAlreadyProcessed();
    }

    caseReviewService.assignReviewer(
            event.caseId(),
            event.assignmentId(),
            event.reviewerRole()
    );

    processedMessageRepository.save(
            new ProcessedMessage(event.messageId(), Instant.now())
    );

    return ProcessingResult.processed();
}
```

Listener:

```java
try {
    ProcessingResult result = service.process(event);
    channel.basicAck(tag, false);
} catch (PermanentBusinessException e) {
    channel.basicReject(tag, false);
} catch (Exception e) {
    channel.basicReject(tag, false);
}
```

Important: avoid acking before commit.

---

## 26. `@RabbitListener` Method Signatures

Spring AMQP supports flexible listener method signatures.

Examples:

```java
public void handle(MyEvent event)
```

```java
public void handle(MyEvent event, Message rawMessage)
```

```java
public void handle(MyEvent event, Channel channel, Message rawMessage)
```

```java
public void handle(
    @Payload MyEvent event,
    @Header("event_type") String eventType,
    @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag,
    Message message,
    Channel channel
)
```

For production handlers, having access to the raw `Message` is often useful because you need:

- message id;
- correlation id;
- headers;
- redelivered flag;
- delivery tag;
- received exchange;
- received routing key;
- retry/death metadata.

A domain handler should not depend on AMQP classes, but the adapter/listener layer can.

Recommended separation:

```text
Rabbit listener adapter
  -> extract metadata
  -> convert to domain command/event
  -> call application service
  -> ack/reject based on result
```

---

## 27. Avoid Business Logic Directly in Listener

Bad:

```java
@RabbitListener(queues = "q")
public void handle(Event event) {
    // 300 lines of domain logic, DB update, HTTP call, branching, retry, ack concerns
}
```

Better:

```java
@Component
public class ReviewAssignmentListener {
    private final ReviewAssignmentUseCase useCase;

    @RabbitListener(queues = "case.review.assignment.v1.q")
    public void handle(ReviewAssignmentRequested event, Message message, Channel channel) {
        // transport-level adapter only
    }
}
```

Application service:

```java
@Service
public class ReviewAssignmentUseCase {
    @Transactional
    public ProcessingResult handle(ReviewAssignmentRequested event, MessageMetadata metadata) {
        // domain/application logic
    }
}
```

Benefits:

- unit tests do not need RabbitMQ;
- idempotency is explicit;
- transport concerns stay at boundary;
- future Kafka/HTTP/manual replay adapter is easier;
- ack semantics remain visible.

---

## 28. Message Metadata Object

Define your own metadata object:

```java
public record MessageMetadata(
        String messageId,
        String correlationId,
        String causationId,
        String eventType,
        String schemaVersion,
        String producer,
        String receivedExchange,
        String receivedRoutingKey,
        boolean redelivered,
        Map<String, Object> headers
) { }
```

Mapper:

```java
public final class MessageMetadataMapper {

    public static MessageMetadata from(Message message) {
        MessageProperties props = message.getMessageProperties();
        Map<String, Object> headers = props.getHeaders();

        return new MessageMetadata(
                props.getMessageId(),
                props.getCorrelationId(),
                asString(headers.get("causation_id")),
                asString(headers.get("event_type")),
                asString(headers.get("schema_version")),
                asString(headers.get("producer")),
                props.getReceivedExchange(),
                props.getReceivedRoutingKey(),
                props.isRedelivered(),
                Map.copyOf(headers)
        );
    }

    private static String asString(Object value) {
        return value == null ? null : value.toString();
    }
}
```

This gives your application a stable boundary independent of Spring/Rabbit classes.

---

## 29. Validation Boundary

Do not assume every message is valid just because converter can deserialize it.

Validation layers:

```text
transport validity
  -> can decode body?

contract validity
  -> required fields present?
  -> schema version supported?
  -> event type expected?

domain validity
  -> state transition allowed?
  -> referenced entity exists?
  -> command still relevant?
```

Example:

```java
public void validateContract(ReviewAssignmentRequested event, MessageMetadata metadata) {
    if (!"ReviewAssignmentRequested".equals(metadata.eventType())) {
        throw new PermanentBusinessException("Unexpected event_type: " + metadata.eventType());
    }

    if (!"1".equals(metadata.schemaVersion())) {
        throw new PermanentBusinessException("Unsupported schema_version: " + metadata.schemaVersion());
    }

    if (event.caseId() == null || event.assignmentId() == null) {
        throw new PermanentBusinessException("Missing required fields");
    }
}
```

Permanent contract failures should not be retried forever.

They should go to DLQ/parking lot with diagnostic metadata.

---

## 30. Spring Transactions and RabbitMQ

Spring has transaction concepts, but do not over-assume.

There are several different things:

- database transaction;
- AMQP channel transaction;
- listener transaction management;
- publisher confirms;
- outbox transaction.

AMQP transactions are usually not the preferred high-throughput reliability strategy. Publisher confirms are typically preferred for publisher safety.

For consumer processing, the most common safe pattern is:

```text
DB transaction handles domain state
manual ack happens after DB commit
idempotency handles redelivery
```

Do not assume a single `@Transactional` annotation automatically covers RabbitMQ delivery acknowledgement exactly how you intend.

Always test crash windows.

---

## 31. Listener Error Taxonomy

Define your exception classes intentionally:

```java
public abstract class MessageProcessingException extends RuntimeException {
    protected MessageProcessingException(String message) {
        super(message);
    }
}

public final class PermanentMessageException extends MessageProcessingException {
    public PermanentMessageException(String message) {
        super(message);
    }
}

public final class TransientMessageException extends MessageProcessingException {
    public TransientMessageException(String message) {
        super(message);
    }
}

public final class DuplicateMessageException extends MessageProcessingException {
    public DuplicateMessageException(String message) {
        super(message);
    }
}
```

Then map exceptions to ack decisions:

| Exception | Meaning | Ack Decision |
|---|---|---|
| duplicate already processed | safe duplicate | ack |
| permanent contract error | bad message | reject no requeue |
| invalid state permanent | cannot process | reject no requeue |
| transient DB/API failure | retry later | reject no requeue to retry/DLQ topology |
| unknown exception | unsafe unknown | reject no requeue, inspect |

This explicit mapping is more important than the specific class names.

---

## 32. A Production-Shaped Listener Adapter

```java
@Component
public class ReviewAssignmentRabbitListener {

    private final ReviewAssignmentUseCase useCase;

    public ReviewAssignmentRabbitListener(ReviewAssignmentUseCase useCase) {
        this.useCase = useCase;
    }

    @RabbitListener(
            queues = "case.review.assignment.v1.q",
            containerFactory = "manualAckRabbitListenerContainerFactory"
    )
    public void onMessage(
            ReviewAssignmentRequested payload,
            Message message,
            Channel channel
    ) throws IOException {
        long tag = message.getMessageProperties().getDeliveryTag();
        MessageMetadata metadata = MessageMetadataMapper.from(message);

        try {
            ProcessingResult result = useCase.handle(payload, metadata);

            if (result.isProcessed() || result.isDuplicateAlreadyProcessed()) {
                channel.basicAck(tag, false);
                return;
            }

            // Defensive fallback: unknown non-exception result should not loop.
            channel.basicReject(tag, false);

        } catch (DuplicateMessageException e) {
            channel.basicAck(tag, false);
        } catch (PermanentMessageException e) {
            channel.basicReject(tag, false);
        } catch (TransientMessageException e) {
            channel.basicReject(tag, false);
        } catch (Exception e) {
            channel.basicReject(tag, false);
        }
    }
}
```

This looks verbose because reliability is explicit.

In a real codebase, you might extract common ack mapping into a reusable component. But avoid hiding too much.

---

## 33. Publishing with Domain Publisher and Metadata

```java
@Service
public class RabbitCaseEventPublisher implements CaseEventPublisher {

    private static final String EXCHANGE = "case.events.v1";

    private final RabbitTemplate rabbitTemplate;

    public RabbitCaseEventPublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @Override
    public void publishReviewAssignmentRequested(ReviewAssignmentRequested event) {
        String routingKey = "case.review.assignment.requested";
        CorrelationData correlationData = new CorrelationData(event.messageId().toString());

        rabbitTemplate.convertAndSend(
                EXCHANGE,
                routingKey,
                event,
                message -> enrich(message, event, routingKey),
                correlationData
        );
    }

    private Message enrich(
            Message message,
            ReviewAssignmentRequested event,
            String routingKey
    ) {
        MessageProperties props = message.getMessageProperties();
        props.setMessageId(event.messageId().toString());
        props.setCorrelationId(event.correlationId());
        props.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        props.setHeader("event_type", "ReviewAssignmentRequested");
        props.setHeader("schema_version", "1");
        props.setHeader("producer", "case-service");
        props.setHeader("routing_key", routingKey);
        props.setTimestamp(Date.from(event.requestedAt()));
        return message;
    }
}
```

Design note:

- `messageId` supports idempotent consumer;
- `correlationId` supports trace across workflow;
- `event_type` supports dispatch/debugging;
- `schema_version` supports compatibility;
- `producer` supports accountability;
- `routing_key` helps forensic analysis.

---

## 34. Topology Ownership Pattern

For each service, define topology in one place:

```text
com.example.caseapp.messaging
  RabbitTopologyConfig
  RabbitPublisherConfig
  RabbitListenerConfig
  RabbitMessageConverterConfig
  CaseEventPublisher
  ReviewAssignmentRabbitListener
```

Avoid scattering queue names across random classes.

Use constants or configuration objects:

```java
public final class RabbitNames {
    private RabbitNames() {}

    public static final String CASE_EVENTS_EXCHANGE = "case.events.v1";
    public static final String REVIEW_ASSIGNMENT_QUEUE = "case.review.assignment.v1.q";
    public static final String REVIEW_ASSIGNMENT_DLQ = "case.review.assignment.v1.dlq";
    public static final String REVIEW_ASSIGNMENT_DLX = "case.review.assignment.v1.dlx";

    public static final String RK_REVIEW_ASSIGNMENT_REQUESTED =
            "case.review.assignment.requested";
}
```

This is not just code style. It prevents topology drift.

---

## 35. Conditional Topology Declaration

Sometimes you want topology declaration only in local/test, not production.

Example:

```java
@Configuration
@Profile({"local", "test"})
public class LocalRabbitTopologyConfig {
    // declare exchange/queue/binding beans
}
```

Or:

```yaml
app:
  rabbit:
    declare-topology: true
```

```java
@Configuration
@ConditionalOnProperty(
        prefix = "app.rabbit",
        name = "declare-topology",
        havingValue = "true"
)
public class RabbitTopologyConfig {
    // topology beans
}
```

This allows production topology to be managed by IaC/platform pipelines while tests still use application declarations.

### Rule

Do not let every service instance freely mutate critical production topology unless your org deliberately accepts that model.

---

## 36. Request/Reply with RabbitTemplate

Spring AMQP supports request/reply:

```java
Object response = rabbitTemplate.convertSendAndReceive(
        "case.commands.v1",
        "case.evaluate-risk",
        request
);
```

This can be useful, but it reintroduces synchronous coupling.

Be careful:

- caller blocks;
- timeout must be configured;
- duplicate replies can happen;
- consumer may process request after caller timed out;
- retry can trigger duplicate command processing;
- error propagation is not like HTTP;
- scaling and backpressure become harder to reason about.

Use request/reply when:

- you really need synchronous semantics;
- timeouts are short and explicit;
- command is idempotent;
- failure behavior is defined;
- HTTP/gRPC is not a better fit.

Do not use it just because it feels convenient.

---

## 37. Multiple Listener Methods and Type Dispatch

Spring can dispatch based on payload type:

```java
@RabbitListener(queues = "case.events.consumer.v1.q")
public class CaseEventListener {

    @RabbitHandler
    public void handle(ReviewAssignmentRequested event) {
    }

    @RabbitHandler
    public void handle(EvidenceSubmitted event) {
    }
}
```

This is convenient but can hide contract routing problems.

Questions:

- How is the target Java type determined?
- Does it depend on Java type headers?
- What happens for unknown event type?
- Can non-Java publishers interoperate?

For cross-service systems, explicit event envelope + dispatch may be more robust:

```json
{
  "eventType": "ReviewAssignmentRequested",
  "schemaVersion": 1,
  "payload": { ... }
}
```

Then your dispatcher controls compatibility.

---

## 38. Headers and MessageProperties

Access headers:

```java
@RabbitListener(queues = "q")
public void handle(Message message) {
    MessageProperties props = message.getMessageProperties();
    String messageId = props.getMessageId();
    String correlationId = props.getCorrelationId();
    Object eventType = props.getHeaders().get("event_type");
}
```

Using annotations:

```java
@RabbitListener(queues = "q")
public void handle(
        @Payload ReviewAssignmentRequested event,
        @Header("event_type") String eventType,
        @Header("schema_version") String schemaVersion
) {
}
```

For robust handlers, prefer tolerant metadata extraction because headers may be missing or malformed.

A missing required header is a contract error, not a transient failure.

---

## 39. Observability Hooks

At minimum, instrument:

Publisher metrics:

- publish attempts;
- publish confirm ack;
- publish confirm nack;
- returned messages;
- publish latency;
- outbox pending count;
- outbox oldest age.

Consumer metrics:

- deliveries received;
- processing success;
- duplicate detected;
- permanent failure;
- transient failure;
- rejected to DLQ;
- processing latency;
- ack latency;
- redelivery count;
- consumer concurrency;
- queue depth;
- unacked count.

Structured log fields:

```text
message_id
correlation_id
causation_id
event_type
schema_version
exchange
routing_key
queue
redelivered
attempt
case_id
handler
exception_class
failure_classification
```

Do not log sensitive payload blindly.

---

## 40. Security and Deserialization

Message conversion is a security boundary.

Avoid unsafe polymorphic deserialization from untrusted messages.

Questions:

- Which packages/classes are trusted for deserialization?
- Can a malicious producer inject type headers?
- Are consumers exposed to external tenants?
- Does the queue receive messages from multiple apps?
- Are payload size limits enforced?
- Are schema versions validated?

Security rule:

```text
Treat message payload as external input unless proven otherwise.
```

Even internal queues can be polluted by bugs or compromised services.

---

## 41. Testing Spring AMQP Configuration

You need several test levels.

### Unit Test Domain Handler

No RabbitMQ:

```java
@Test
void assignsReviewerWhenMessageIsValid() {
    useCase.handle(event, metadata);
    assertThat(repository.findAssignment(...)).isPresent();
}
```

### Listener Adapter Test

Mock use case and channel:

```java
@Test
void acksWhenUseCaseSucceeds() throws Exception {
    Channel channel = mock(Channel.class);
    Message message = messageWithDeliveryTag(42L);

    listener.onMessage(event, message, channel);

    verify(channel).basicAck(42L, false);
}
```

### Integration Test with Testcontainers

Use real RabbitMQ:

```java
@Testcontainers
@SpringBootTest
class RabbitIntegrationTest {

    @Container
    static RabbitMQContainer rabbit = new RabbitMQContainer("rabbitmq:4-management")
            .withExposedPorts(5672, 15672);

    @DynamicPropertySource
    static void rabbitProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.rabbitmq.host", rabbit::getHost);
        registry.add("spring.rabbitmq.port", rabbit::getAmqpPort);
        registry.add("spring.rabbitmq.username", rabbit::getAdminUsername);
        registry.add("spring.rabbitmq.password", rabbit::getAdminPassword);
    }
}
```

Test cases:

- topology declared;
- publish routes to expected queue;
- unroutable message triggers return;
- listener acks success;
- listener rejects permanent failure;
- failed message lands in DLQ;
- duplicate message is acked;
- prefetch/concurrency behavior under load.

---

## 42. Common Production Configuration Template

```yaml
spring:
  rabbitmq:
    host: ${RABBITMQ_HOST}
    port: ${RABBITMQ_PORT:5672}
    username: ${RABBITMQ_USERNAME}
    password: ${RABBITMQ_PASSWORD}
    virtual-host: ${RABBITMQ_VHOST}
    connection-timeout: 5s
    requested-heartbeat: 30s

    publisher-confirm-type: correlated
    publisher-returns: true

    template:
      mandatory: true
      retry:
        enabled: false

    listener:
      type: simple
      simple:
        acknowledge-mode: manual
        prefetch: ${RABBITMQ_PREFETCH:20}
        concurrency: ${RABBITMQ_CONCURRENCY:2}
        max-concurrency: ${RABBITMQ_MAX_CONCURRENCY:8}
        default-requeue-rejected: false
        retry:
          enabled: false
```

Application-specific:

```yaml
app:
  rabbit:
    declare-topology: false
    exchanges:
      case-events: case.events.v1
    queues:
      review-assignment: case.review.assignment.v1.q
      review-assignment-dlq: case.review.assignment.v1.dlq
```

---

## 43. Spring AMQP Anti-Patterns

### Anti-Pattern 1: `@RabbitListener` Everywhere

Sprinkling listeners across codebase makes message flow invisible.

Better:

- centralize messaging adapters;
- document queue ownership;
- map listener to use case explicitly.

### Anti-Pattern 2: Default Ack Mode Without Understanding

If nobody knows whether failed messages are requeued, rejected, retried, or acked, the system is not production-ready.

### Anti-Pattern 3: No Publisher Confirms

`rabbitTemplate.convertAndSend()` returning normally is not a complete reliability guarantee.

### Anti-Pattern 4: No Mandatory Returns

Unroutable messages can be lost from the publisher’s perspective if mandatory returns are not handled.

### Anti-Pattern 5: Java Class as Message Contract

Cross-service contracts should not depend on package names and internal class structure.

### Anti-Pattern 6: Infinite Requeue by Container Config

Immediate requeue loops are one of the fastest ways to turn a single poison message into an incident.

### Anti-Pattern 7: In-Memory Retry for Long Delays

A listener thread sleeping/retrying for minutes is usually bad resource management.

### Anti-Pattern 8: Topology Auto-Declaration in Production Without Governance

A bad deployment can mutate broker topology.

### Anti-Pattern 9: Business Logic Hidden in Listener

Hard to test, hard to reason about ack boundary, hard to reuse.

### Anti-Pattern 10: No Idempotency

At-least-once delivery without idempotency is duplicate side effects waiting to happen.

---

## 44. Design Checklist

Before approving a Spring AMQP service, answer these:

### Publisher

- Are publisher confirms enabled?
- Are returns enabled?
- Is mandatory publish enabled?
- Is there a confirm callback?
- Is there a returns callback?
- Is publication backed by outbox when DB consistency matters?
- Is message id stable across retries?
- Are routing keys centrally owned?

### Consumer

- What acknowledgement mode is used?
- What happens when handler throws?
- Is default requeue disabled unless deliberately needed?
- Is prefetch sized against downstream capacity?
- Is concurrency bounded?
- Is the handler idempotent?
- Is ack after durable state change?
- Are duplicate redeliveries safe?

### Retry / DLQ

- Are transient and permanent failures classified?
- Is retry durable or in-memory?
- Is retry bounded?
- Is DLQ monitored?
- Is there a parking lot for poison messages?
- Can operators replay safely?

### Contract

- Is schema version present?
- Is event/command type explicit?
- Are Java type headers avoided or controlled?
- Can old/new consumers coexist?
- Are required metadata fields validated?

### Operations

- Are queue depth and unacked count monitored?
- Are redeliveries monitored?
- Are return/nack counts alerted?
- Are connection/channel counts sane?
- Is topology managed intentionally?

---

## 45. Mini Case Study: Review Assignment Consumer

Business requirement:

> When a case requires senior review, assign a reviewer. The assignment must not be duplicated. If assignment fails due to temporary database/API outage, retry later. If message is invalid, isolate it for investigation.

Topology:

```text
Exchange: case.events.v1                  type=topic durable
Queue:    case.review.assignment.v1.q      type=quorum durable
DLX:      case.review.assignment.v1.dlx    type=direct durable
DLQ:      case.review.assignment.v1.dlq    type=quorum durable
Binding:  case.review.assignment.requested -> main queue
```

Publisher:

```text
RabbitTemplate
  -> mandatory=true
  -> correlated confirms
  -> returns callback
  -> message_id/correlation_id/schema_version/event_type
```

Consumer:

```text
@RabbitListener
  -> manual ack
  -> prefetch=20
  -> concurrency=2..8
  -> defaultRequeueRejected=false
```

Processing:

```text
begin DB transaction
  -> check processed_message(message_id)
  -> validate case state
  -> assign reviewer
  -> insert processed_message(message_id)
commit
ack
```

Failure behavior:

| Failure | Action |
|---|---|
| duplicate message | ack |
| invalid schema | reject no requeue -> DLQ |
| case not found but expected eventually | reject no requeue -> retry path |
| DB timeout | reject no requeue -> retry path |
| repeated poison | delivery limit / DLQ / parking lot |
| handler bug | DLQ + alert |

This is defensible because every failure state has a named path.

---

## 46. What Spring AMQP Should Not Hide from You

Even with Spring, you must still understand:

- exchange routing;
- queue type semantics;
- ack timing;
- redelivery;
- idempotency;
- publisher confirm;
- returned messages;
- DLQ routing;
- prefetch;
- concurrency;
- topology migration;
- message contracts;
- operational metrics.

Spring AMQP removes repetitive code. It does not remove distributed system failure modes.

---

## 47. Practical Exercises

### Exercise 1 — Manual Ack Listener

Create a listener with:

- manual ack;
- prefetch 5;
- concurrency 2;
- DLQ on reject.

Test:

- success ack;
- exception rejects;
- invalid message goes DLQ.

### Exercise 2 — Publisher Returns

Publish to a non-existing routing key with:

- mandatory false;
- mandatory true.

Observe the difference.

### Exercise 3 — Confirm Callback

Enable correlated confirms and log confirm result using `CorrelationData`.

### Exercise 4 — Idempotent Consumer

Process the same message id twice.

Expected:

- first message applies side effect;
- second message is acked as duplicate;
- side effect is not repeated.

### Exercise 5 — Prefetch Experiment

Run consumer with:

- prefetch 1;
- prefetch 20;
- prefetch 100.

Simulate slow handler. Observe:

- unacked messages;
- fairness;
- redelivery after consumer crash.

---

## 48. Summary

Spring AMQP is powerful because it gives a clean Spring programming model for RabbitMQ:

- `RabbitTemplate` for publishing;
- `RabbitAdmin` for topology;
- `@RabbitListener` for consumption;
- listener containers for lifecycle/concurrency/ack behavior;
- converters for payload mapping;
- retry/error hooks for failure handling.

But the high-level API is only safe when the low-level semantics are understood.

The most important production lessons:

1. `RabbitTemplate.convertAndSend()` is not enough; use confirms and returns.
2. `@RabbitListener` is not enough; define ack, retry, and failure behavior.
3. `AUTO` ack can be fine, but only if the team understands exception behavior.
4. `MANUAL` ack is often clearer for high-integrity workflows.
5. `defaultRequeueRejected=false` prevents many poison-message loops.
6. Prefetch is a backpressure/concurrency budget, not a random performance knob.
7. Message converter choice affects contract compatibility and security.
8. Topology declaration is schema management, not incidental startup code.
9. Idempotency is mandatory for at-least-once delivery.
10. Spring reduces boilerplate, not responsibility.

---

## 49. References

- Spring AMQP Reference Documentation — template abstraction, message-driven POJO support, listener containers, RabbitTemplate, message conversion, and broker resource management: https://docs.spring.io/spring-amqp/reference/index.html
- Spring Boot AMQP Reference — auto-configuration, `@RabbitListener`, default listener container factory behavior: https://docs.spring.io/spring-boot/reference/messaging/amqp.html
- Spring AMQP Listener Container Attributes — acknowledgement modes including `NONE`, `AUTO`, and `MANUAL`: https://docs.spring.io/spring-amqp/reference/amqp/containerAttributes.html
- Spring AMQP RabbitTemplate Reference — publisher confirms and returns support, mandatory returns behavior: https://docs.spring.io/spring-amqp/reference/amqp/template.html
- Spring AMQP Choosing a Container — SMLC and DMLC differences: https://docs.spring.io/spring-amqp/reference/amqp/receiving-messages/choose-container.html
- RabbitMQ Consumer Acknowledgements and Publisher Confirms — broker-level reliability semantics: https://www.rabbitmq.com/docs/confirms

---

## 50. Status Seri

Selesai:

- Part 00 — Orientation, Mental Model, dan Scope RabbitMQ Modern
- Part 01 — Messaging Fundamentals yang Spesifik RabbitMQ
- Part 02 — AMQP 0-9-1 Deep Dive
- Part 03 — Exchange Routing Mastery
- Part 04 — Queue Semantics: Classic, Quorum, Stream
- Part 05 — Hands-on Local Lab
- Part 06 — Java Client Fundamentals tanpa Spring
- Part 07 — Publisher Reliability
- Part 08 — Consumer Reliability
- Part 09 — Retry, Dead Lettering, Poison Message, Parking Lot
- Part 10 — Spring AMQP Deep Dive

Berikutnya:

- Part 11 — Spring Boot Integration Patterns

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-09.md">⬅️ Part 09 — Retry, Dead Lettering, Poison Message, dan Parking Lot</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-11.md">Part 11 — Spring Boot Integration Patterns ➡️</a>
</div>
